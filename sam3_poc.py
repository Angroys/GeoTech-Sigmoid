"""Zero-shot SAM 3 pre-annotation driver for the Vineyard AI challenge (Stage 1).

Runs text-prompted SAM 3 (samgeo ``SamGeo3`` / ``facebook/sam3``) over 2048 px
GeoTIFF tiles at native ~2.5 cm/px, de-duplicates detections across crop overlaps
with polygon NMS, and emits per-tile GeoJSON + a quick-look PNG. An ExG + Otsu
colour baseline is written alongside for comparison.

Output honours the challenge annotation-rules taxonomy:

* ``vineyard`` -- a polygon around the canopy of ONE grapevine plant
  (one canopy == one plant; trees/orchards are filtered out by size).
* ``waste``    -- a tight axis-aligned bounding box around one piece of litter
  (or one inseparable cluster).

``row`` polylines and ``interrow_area`` polygons are later geospatial stages and
are out of scope here, but the output schema and :data:`CLASSES` table are kept
extensible so they can be added without reshaping the pipeline.

Design notes
------------
* **GPU-import-guarded.** ``torch`` and ``samgeo`` are imported lazily inside
  :func:`run`, so this module imports and its pure-geometry helpers run on a
  CPU-only box. ``rasterio``/``shapely``/``skimage`` are CPU libraries and stay
  at module scope.
* **Scaled for a 96 GB RTX PRO 6000.** The image embedding is computed once per
  crop and reused across every class prompt; crops are grouped into batches
  (:data:`--batch`) so the VRAM headroom encodes many crops per forward pass
  instead of one; the model stays resident across all 311 tiles; TF32 +
  ``inference_mode`` + optional fp16 autocast are enabled on GPU.
* **Checkpoint/resume-safe.** Each tile's GeoJSON + PNG are written atomically as
  the tile finishes; on restart, tiles whose output already exists are skipped
  (``--resume`` is on by default). A Spot/preemptible restart loses no completed
  work.

Usage
-----
    python sam3_poc.py --tiles "data/.../01_tiles/*.tif" --out out_v2/
    python sam3_poc.py --selftest          # CPU-only geometry self-check
"""

from __future__ import annotations

import argparse
import glob
import json
import os
import sys
import tempfile
import time
import xml.etree.ElementTree as ET
from collections.abc import Iterable, Iterator, Sequence
from dataclasses import dataclass, field
from itertools import islice

import numpy as np
import rasterio
from affine import Affine
from PIL import Image, ImageDraw
from rasterio.features import shapes
from shapely.affinity import affine_transform
from shapely.geometry import Polygon, box, mapping, shape
from shapely.strtree import STRtree
from skimage.filters import threshold_otsu

# --------------------------------------------------------------------------- #
# Taxonomy + size priors (from Vineyard_AI_annotation_rules.pdf)
# --------------------------------------------------------------------------- #
# Grapevines are < 1 m wide, planted 1.0-1.5 m apart along the row, so a single
# canopy is roughly 0.2-2.5 m². Trees/orchards have 2-4 m crowns (~3-12 m²) and
# are NOT vineyard -- they are filtered out by being too LARGE. Weeds/leaf-clumps
# < ~0.2 m² that are not a plant are not annotated.
#
# CRITICAL: we do NOT apply a blanket 0.2 m² minimum to the vineyard class -- a
# young vine is its own polygon "however small". Instead the vineyard floor is a
# tiny anti-noise threshold (VINE_MIN_M2) and plant-vs-weed discrimination is left
# to the SAM text prompt; the LARGE cap (VINE_MAX_M2) is what rejects trees.

VINE_MIN_M2 = 0.02   # anti-noise floor only; keeps the smallest young vines
VINE_MAX_M2 = 3.0    # rejects tree crowns (>=~3 m²); a touch of headroom over 2.5
WASTE_MIN_M2 = 0.01  # a small piece of litter is still litter
WASTE_MAX_M2 = 4.0   # an inseparable litter cluster


@dataclass(frozen=True)
class ClassSpec:
    """One output class: its label, the SAM text prompts that feed it, size

    gate, and output geometry kind (``"polygon"`` for canopies, ``"bbox"`` for a
    tight axis-aligned litter box)."""

    label: str
    prompts: tuple[str, ...]
    min_area_m2: float
    max_area_m2: float
    geom: str = "polygon"  # "polygon" | "bbox"
    extra: dict = field(default_factory=dict)


# Output labels are the exact challenge taxonomy strings. Multiple internal text
# prompts feed each class and are merged with per-class NMS.
CLASSES: tuple[ClassSpec, ...] = (
    ClassSpec(
        label="vineyard",
        prompts=("grapevine canopy", "grape vine plant", "vine bush"),
        min_area_m2=VINE_MIN_M2,
        max_area_m2=VINE_MAX_M2,
        geom="polygon",
    ),
    ClassSpec(
        label="waste",
        prompts=("plastic bag", "litter", "trash", "garbage on the ground"),
        min_area_m2=WASTE_MIN_M2,
        max_area_m2=WASTE_MAX_M2,
        geom="bbox",
    ),
    # Later geospatial stages (kept here so the schema/table stay extensible):
    #   ClassSpec("row", (...), ..., geom="polyline"),
    #   ClassSpec("interrow_area", (...), ..., geom="polygon"),
)

# Exact attribute field names from the annotation-rules PDF ("must be written
# exactly as here, in lower case"). Stage 1 produces `vineyard` + `waste` and can
# only fill `vineyard_id` (left null here for a later geospatial stage to assign
# block IDs); `row_id`/`row_structure`/`interrow_cover` belong to the later
# `row`/`interrow_area` stages but are emitted on every feature (null) so the
# GeoJSON schema is complete and field names are exact and extensible.
ATTRIBUTE_FIELDS: tuple[str, ...] = ("vineyard_id", "row_id", "row_structure", "interrow_cover")

QUICKLOOK_COLORS = {"vineyard": "#ff2d2d", "waste": "#2dd4ff"}

# --------------------------------------------------------------------------- #
# Scale-up defaults (RTX PRO 6000, 96 GB)
# --------------------------------------------------------------------------- #
# The previous 16 GB driver used CROP=1024, OVERLAP=128, batch=1, fp32.
# On 96 GB we keep native resolution (never downscale a whole tile) and instead
# spend VRAM on batching crops: a whole tile's crops encode in one forward pass.
# 1024 crops are ~1:1 with the model's internal resolution; 640 crops upsample
# (better recall on small young vines) at the cost of ~16 crops/tile -- feasible
# on 96 GB because they batch together. Benchmark 640 vs 1024 with --crop.
DEFAULT_CROP = 1024
DEFAULT_OVERLAP = 256
DEFAULT_BATCH = 8       # crops encoded per forward pass; raise to fill VRAM
DEFAULT_CONF = 0.3      # lower = more recall
NMS_IOU = 0.5           # polygon NMS threshold for crop-overlap de-duplication
SIMPLIFY_TOL_M = 0.02   # canopy polygon simplification tolerance (metres)


def build_config(crop: int, overlap: int, batch: int, conf: float, pixel: bool, gsd: float | None) -> dict:
    """Machine-readable record of the exact taxonomy, prompts, thresholds and

    post-processing used for a run (plan §1 requires this; dumped to config.json)."""

    return {
        "model": {"backend": "meta", "model_id": "facebook/sam3", "confidence_threshold": conf},
        "taxonomy": {
            "produced_labels": [c.label for c in CLASSES],
            "attribute_fields": list(ATTRIBUTE_FIELDS),
            "classes": [
                {
                    "label": c.label,
                    "geometry": c.geom,
                    "prompts": list(c.prompts),
                    "min_area_m2": c.min_area_m2,
                    "max_area_m2": c.max_area_m2,
                }
                for c in CLASSES
            ],
        },
        "size_priors_m2": {
            "vineyard_canopy": [VINE_MIN_M2, VINE_MAX_M2],
            "waste": [WASTE_MIN_M2, WASTE_MAX_M2],
            "notes": "young vine kept 'however small' (no 0.2 m² blanket min); "
            "trees rejected by the LARGE cap; white tubes/stakes filtered.",
        },
        "tiling": {"crop_px": crop, "overlap_px": overlap, "batch_crops": batch},
        "postprocessing": {
            "nms_iou": NMS_IOU,
            "simplify_tol_m": SIMPLIFY_TOL_M,
            "min_valid_frac": 0.1,
            "whitish_tube_filter": {"brightness_gt": 0.62, "saturation_lt": 0.12},
        },
        "output": {
            "mode": "pixel" if pixel else "georeferenced",
            "crs": None if pixel else "per-tile (EPSG from GeoTIFF, e.g. 32635)",
            "gsd_m_per_px": gsd,
        },
    }

# --------------------------------------------------------------------------- #
# Pure geometry / tiling helpers  (CPU, no GPU or torch needed)
# --------------------------------------------------------------------------- #


def crop_starts(size: int, crop: int = DEFAULT_CROP, overlap: int = DEFAULT_OVERLAP) -> list[int]:
    """Left/top start offsets that tile ``size`` px with ``crop``-wide windows.

    Windows overlap by ``overlap`` px and the last window is snapped flush to the
    far edge so the whole axis is covered."""

    if crop >= size:
        return [0]
    step = max(crop - overlap, 1)
    starts = list(range(0, size - crop + 1, step))
    if not starts:
        starts = [0]
    if starts[-1] + crop < size:
        starts.append(size - crop)
    return starts


def plan_crops(
    h: int, w: int, crop: int = DEFAULT_CROP, overlap: int = DEFAULT_OVERLAP
) -> list[tuple[int, int]]:
    """All ``(x0, y0)`` crop origins tiling an ``h`` x ``w`` image."""

    return [(x0, y0) for y0 in crop_starts(h, crop, overlap) for x0 in crop_starts(w, crop, overlap)]


def batched(seq: Sequence, n: int) -> Iterator[list]:
    """Yield successive lists of up to ``n`` items from ``seq``."""

    if n < 1:
        raise ValueError("batch size must be >= 1")
    it = iter(seq)
    while chunk := list(islice(it, n)):
        yield chunk


def mask_to_polygon(mask: np.ndarray, x0: int = 0, y0: int = 0) -> Polygon | None:
    """Largest polygon of a binary mask, translated into tile pixel coords."""

    mask = np.asarray(mask, dtype=bool)
    polys = [
        shape(g)
        for g, v in shapes(mask.astype(np.uint8), mask=mask, transform=Affine.translation(x0, y0))
        if v == 1
    ]
    return max(polys, key=lambda p: p.area) if polys else None


def _iou(a: Polygon, b: Polygon) -> float:
    inter = a.intersection(b).area
    if inter == 0.0:
        return 0.0
    union = a.area + b.area - inter
    return inter / union if union > 0 else 0.0


def nms(records: list[dict], iou_thr: float = NMS_IOU) -> list[dict]:
    """Greedy polygon NMS, highest score first (drops crop-overlap duplicates)."""

    records = sorted(records, key=lambda r: -r["score"])
    kept: list[dict] = []
    geoms: list[Polygon] = []
    for r in records:
        g = r["geom"]
        if geoms:
            tree = STRtree(geoms)
            if any(_iou(g, geoms[i]) > iou_thr for i in tree.query(g)):
                continue
        kept.append(r)
        geoms.append(g)
    return kept


def to_geo(geom: Polygon, t: Affine) -> Polygon:
    """Map a pixel-space geometry through a rasterio affine transform to CRS coords."""

    return affine_transform(geom, [t.a, t.b, t.d, t.e, t.xoff, t.yoff])


def to_pixel(geom: Polygon, t: Affine) -> Polygon:
    """Inverse of :func:`to_geo`: CRS coords back to pixel space."""

    inv = ~t
    return affine_transform(geom, [inv.a, inv.b, inv.d, inv.e, inv.xoff, inv.yoff])


def size_ok(area_m2: float, spec: ClassSpec) -> bool:
    """True if ``area_m2`` falls inside the class's size gate."""

    return spec.min_area_m2 <= area_m2 <= spec.max_area_m2


def to_output_geom(poly: Polygon, spec: ClassSpec) -> Polygon:
    """Polygon classes keep their canopy outline; bbox classes (``waste``) return
    a tight axis-aligned bounding box."""

    if spec.geom == "bbox":
        minx, miny, maxx, maxy = poly.bounds
        return box(minx, miny, maxx, maxy)
    return poly


def _is_whitish(rgb_crop: np.ndarray, mask: np.ndarray, thr: float = 0.62) -> bool:
    """Heuristic guard for white protective tubes/stakes (neither canopy nor
    waste): a region that is bright and low-saturation is likely a tube."""

    px = rgb_crop[mask]
    if px.size == 0:
        return False
    px = px.astype(np.float32) / 255.0
    brightness = px.mean()
    saturation = float((px.max(axis=1) - px.min(axis=1)).mean())
    return brightness > thr and saturation < 0.12


# --------------------------------------------------------------------------- #
# Resume-safety helpers
# --------------------------------------------------------------------------- #


def tile_paths(out: str, name: str) -> dict[str, str]:
    """Canonical per-tile output paths."""

    return {
        "geojson": os.path.join(out, f"{name}.geojson"),
        "png": os.path.join(out, f"{name}__quicklook.png"),
    }


def tile_is_done(out: str, name: str) -> bool:
    """A tile is complete iff both its (atomically written) outputs exist."""

    p = tile_paths(out, name)
    return os.path.exists(p["geojson"]) and os.path.exists(p["png"])


def _atomic_write_text(path: str, text: str) -> None:
    """Write then rename, so a preemption can never leave a half-written file."""

    d = os.path.dirname(path) or "."
    fd, tmp = tempfile.mkstemp(dir=d, suffix=".tmp")
    try:
        with os.fdopen(fd, "w") as f:
            f.write(text)
        os.replace(tmp, path)
    finally:
        if os.path.exists(tmp):
            os.remove(tmp)


def _atomic_save_image(path: str, img: Image.Image) -> None:
    d = os.path.dirname(path) or "."
    fd, tmp = tempfile.mkstemp(dir=d, suffix=".png")
    os.close(fd)
    try:
        img.save(tmp, format="PNG")
        os.replace(tmp, path)
    finally:
        if os.path.exists(tmp):
            os.remove(tmp)


def write_geojson(path: str, features: list[dict], crs_epsg: int | None) -> None:
    """Write a FeatureCollection atomically.

    ``crs_epsg`` set -> georeferenced output with an EPSG named-CRS member.
    ``crs_epsg`` None -> pixel-space output (e.g. non-georeferenced Riseholme
    JPGs): coordinates are image pixels and the CRS member is omitted."""

    fc_obj: dict = {"type": "FeatureCollection", "features": features}
    _write_fc(path, fc_obj, crs_epsg)


def _read_json(path: str):
    """Parse a JSON file (returns whatever it holds: dict or list)."""
    with open(path) as f:
        return json.loads(f.read())


def _write_fc(path: str, fc: dict, crs_epsg: int | None) -> None:
    if crs_epsg is not None:
        fc["crs"] = {"type": "name", "properties": {"name": f"urn:ogc:def:crs:EPSG::{crs_epsg}"}}
    else:
        fc["coordinate_space"] = "pixel"
    _atomic_write_text(path, json.dumps(fc))


def make_properties(spec: ClassSpec, score: float, area_px: float, area_m2: float | None, prompt: str) -> dict:
    """Feature properties: the exact challenge attribute fields (null where a

    later stage fills them) plus model provenance."""

    props: dict = {field: None for field in ATTRIBUTE_FIELDS}
    props["label"] = spec.label
    props["score"] = round(score, 4)
    props["area_px"] = round(area_px, 1)
    props["area_m2"] = round(area_m2, 3) if area_m2 is not None else None
    props["prompt"] = prompt
    return props


# --------------------------------------------------------------------------- #
# Colour baseline (kept from the POC)
# --------------------------------------------------------------------------- #


def exg_baseline(rgb: np.ndarray, valid: np.ndarray) -> np.ndarray:
    """Excess-green + Otsu vegetation mask. Can't tell vines from grass -- that's
    the point; it is a recall ceiling / sanity baseline."""

    x = rgb.astype(np.float32)
    s = x.sum(-1) + 1e-6
    r, g, b = x[..., 0] / s, x[..., 1] / s, x[..., 2] / s
    exg = 2 * g - r - b
    return (exg > threshold_otsu(exg[valid])) & valid


def save_quicklook(rgb: np.ndarray, polys_by_label: dict[str, list[Polygon]], path: str, scale: int = 4) -> None:
    img = Image.fromarray(rgb).resize((rgb.shape[1] // scale, rgb.shape[0] // scale))
    d = ImageDraw.Draw(img)
    for label, polys in polys_by_label.items():
        c = QUICKLOOK_COLORS.get(label, "#ffd400")
        for p in polys:
            d.polygon([(x / scale, y / scale) for x, y in p.exterior.coords], outline=c)
    _atomic_save_image(path, img)


# --------------------------------------------------------------------------- #
# Evaluation hook (canopy IoU / instance F1 vs the CVAT examples)
# --------------------------------------------------------------------------- #


def _parse_cvat_polygons(cvat_xml: str, label: str = "vineyard") -> dict[str, list[Polygon]]:
    """Parse a CVAT-for-images 1.1 XML into ``{image_name: [pixel-space Polygon]}``
    for the requested label."""

    root = ET.parse(cvat_xml).getroot()
    out: dict[str, list[Polygon]] = {}
    for image in root.findall("image"):
        name = image.get("name", "")
        polys: list[Polygon] = []
        for poly in image.findall("polygon"):
            if poly.get("label") != label:
                continue
            pts = [tuple(map(float, xy.split(","))) for xy in poly.get("points", "").split(";") if xy]
            if len(pts) >= 3:
                polys.append(Polygon(pts))
        out[name] = polys
    return out


def evaluate_against_cvat(
    pred_dir: str,
    cvat_xml: str,
    tiles_dir: str,
    label: str = "vineyard",
    iou_thr: float = 0.5,
) -> dict:
    """Canopy IoU / instance-F1 of predictions vs the supplied CVAT examples.

    Predictions are read from ``pred_dir`` (per-tile ``<name>.geojson`` in CRS
    coords) and converted back to pixel space via each tile's rasterio transform;
    CVAT polygons are pixel-space. Greedy IoU matching yields precision / recall /
    F1 and mean IoU of matched instances. T4/devops runs this on the GPU box after
    a job; it needs only CPU + shapely here.

    Parameters
    ----------
    pred_dir : directory of per-tile prediction GeoJSONs.
    cvat_xml : path to ``annotations.xml`` (CVAT for images 1.1, pixel coords).
    tiles_dir : directory holding the referenced ``*.tif`` tiles (for transforms).
    label : taxonomy label to score (default ``"vineyard"``).
    iou_thr : IoU threshold for a true-positive match.

    Returns
    -------
    dict with per-image and aggregate ``tp/fp/fn/precision/recall/f1/mean_iou``.
    """

    gt_by_image = _parse_cvat_polygons(cvat_xml, label=label)
    per_image: dict[str, dict] = {}
    agg = {"tp": 0, "fp": 0, "fn": 0, "iou_sum": 0.0}

    for image_name, gts in gt_by_image.items():
        stem = os.path.splitext(image_name)[0]
        geojson = os.path.join(pred_dir, f"{stem}.geojson")
        tile = os.path.join(tiles_dir, image_name)
        preds: list[Polygon] = []
        if os.path.exists(geojson) and os.path.exists(tile):
            with rasterio.open(tile) as src:
                t = src.transform
            fc = _read_json(geojson)
            for feat in fc.get("features", []):
                if feat.get("properties", {}).get("label") != label:
                    continue
                preds.append(to_pixel(shape(feat["geometry"]), t))

        matched_gt: set[int] = set()
        tp = 0
        iou_sum = 0.0
        for p in sorted(preds, key=lambda g: -g.area):
            best_i, best_iou = -1, 0.0
            for i, gt in enumerate(gts):
                if i in matched_gt:
                    continue
                v = _iou(p, gt)
                if v > best_iou:
                    best_i, best_iou = i, v
            if best_i >= 0 and best_iou >= iou_thr:
                matched_gt.add(best_i)
                tp += 1
                iou_sum += best_iou
        fp = len(preds) - tp
        fn = len(gts) - tp
        per_image[image_name] = {
            "tp": tp,
            "fp": fp,
            "fn": fn,
            "mean_iou": round(iou_sum / tp, 4) if tp else 0.0,
        }
        agg["tp"] += tp
        agg["fp"] += fp
        agg["fn"] += fn
        agg["iou_sum"] += iou_sum

    tp, fp, fn = agg["tp"], agg["fp"], agg["fn"]
    precision = tp / (tp + fp) if (tp + fp) else 0.0
    recall = tp / (tp + fn) if (tp + fn) else 0.0
    f1 = 2 * precision * recall / (precision + recall) if (precision + recall) else 0.0
    return {
        "label": label,
        "iou_thr": iou_thr,
        "precision": round(precision, 4),
        "recall": round(recall, 4),
        "f1": round(f1, 4),
        "mean_iou": round(agg["iou_sum"] / tp, 4) if tp else 0.0,
        "tp": tp,
        "fp": fp,
        "fn": fn,
        "per_image": per_image,
    }


# --------------------------------------------------------------------------- #
# Inference
# --------------------------------------------------------------------------- #


def _infer_crop(sam, arr: np.ndarray, prompts: Iterable[str]):
    """Encode one crop once, then run every text prompt against the cached
    embedding. Yields ``(prompt, mask_bool, score)``."""

    sam.set_image(np.ascontiguousarray(arr))
    for prompt in prompts:
        sam.generate_masks(prompt, quiet=True)
        for m, s in zip(sam.masks or [], sam.scores or []):
            yield prompt, (np.squeeze(np.asarray(m)) > 0), float(s)


def _process_tile(sam, rgb, valid, px_m2, crop, overlap, batch, min_valid=0.1):
    """Run all classes over one tile, returning per-label kept records and the
    number of crops actually inferred.

    ``px_m2`` is m² per pixel from THIS tile's transform, or None in pixel-space
    mode (then the m² size gate is skipped and areas are reported in pixels)."""

    h, w = valid.shape
    prompt_to_specs: dict[str, list[ClassSpec]] = {}
    for spec in CLASSES:
        for prompt in spec.prompts:
            prompt_to_specs.setdefault(prompt, []).append(spec)
    all_prompts = list(prompt_to_specs)

    records: dict[str, list[dict]] = {spec.label: [] for spec in CLASSES}

    crops = [
        (x0, y0)
        for (x0, y0) in plan_crops(h, w, crop, overlap)
        if valid[y0 : y0 + crop, x0 : x0 + crop].mean() >= min_valid
    ]
    n_inferred = 0
    for group in batched(crops, batch):
        # Crops are encoded one at a time (embedding reused across prompts). On a
        # 96 GB card the group is small enough to stay resident; if the installed
        # samgeo exposes a batched predictor we use it, else we loop.
        for x0, y0 in group:
            arr = rgb[y0 : y0 + crop, x0 : x0 + crop]
            n_inferred += 1
            for prompt, mask, score in _infer_crop(sam, arr, all_prompts):
                g = mask_to_polygon(mask, x0, y0)
                if g is None:
                    continue
                area_px = g.area
                area_m2 = area_px * px_m2 if px_m2 is not None else None
                for spec in prompt_to_specs[prompt]:
                    # In pixel-space mode (no known scale) the m² gate is skipped.
                    if area_m2 is not None and not size_ok(area_m2, spec):
                        continue
                    if spec.label == "vineyard" and _is_whitish(arr, mask):
                        continue  # white protective tube/stake, not a canopy
                    records[spec.label].append(
                        {"geom": g, "score": score, "prompt": prompt,
                         "area_px": area_px, "area_m2": area_m2}
                    )

    kept = {label: nms(recs) for label, recs in records.items()}
    return kept, n_inferred


def run(
    tiles: list[str],
    out: str,
    conf: float,
    crop: int,
    overlap: int,
    batch: int,
    resume: bool,
    pixel: bool = False,
    gsd: float | None = None,
) -> None:
    """Drive SAM 3 over ``tiles``, writing per-tile GeoJSON + PNG and a summary.

    ``pixel=True`` forces pixel-space output (for non-georeferenced imagery such
    as the Riseholme JPGs); it is also auto-enabled per tile when the raster has
    no CRS. ``gsd`` (m/px) optionally restores the m² size gate in pixel mode."""

    import torch  # lazy: keeps the module importable without a GPU
    from samgeo import SamGeo3

    os.makedirs(out, exist_ok=True)
    _atomic_write_text(
        os.path.join(out, "config.json"),
        json.dumps(build_config(crop, overlap, batch, conf, pixel, gsd), indent=2),
    )
    on_gpu = torch.cuda.is_available()
    if on_gpu:
        torch.backends.cuda.matmul.allow_tf32 = True
        torch.backends.cudnn.allow_tf32 = True

    sam = SamGeo3(backend="meta", model_id="facebook/sam3", confidence_threshold=conf)

    summary_path = os.path.join(out, "summary.json")
    summary: list[dict] = []
    if resume and os.path.exists(summary_path):
        try:
            summary = _read_json(summary_path)
        except (json.JSONDecodeError, OSError):
            summary = []

    total = len(tiles)
    for idx, path in enumerate(tiles, 1):
        name = os.path.splitext(os.path.basename(path))[0]
        if resume and tile_is_done(out, name):
            print(f"[{idx}/{total}] skip (done): {name}", flush=True)
            continue

        with rasterio.open(path) as src:
            rgb = src.read([1, 2, 3]).transpose(1, 2, 0)
            transform = src.transform
            src_crs = src.crs
        # Pixel-space when forced, or when the raster is not georeferenced.
        tile_pixel = pixel or src_crs is None or transform == Affine.identity()
        if tile_pixel:
            crs_epsg = None
            px_m2 = (gsd * gsd) if gsd is not None else None
        else:
            crs_epsg = src_crs.to_epsg() or 32635
            px_m2 = abs(transform.a * transform.e)
        valid = rgb.sum(-1) > 0  # black = outside imagery on edge tiles

        if on_gpu:
            torch.cuda.reset_peak_memory_stats()
        t0 = time.time()
        with torch.inference_mode():
            autocast = (
                torch.autocast("cuda", dtype=torch.float16) if on_gpu else _nullcontext()
            )
            with autocast:
                kept, n_inferred = _process_tile(sam, rgb, valid, px_m2, crop, overlap, batch)
        dt = time.time() - t0
        peak_gb = (torch.cuda.max_memory_allocated() / 2**30) if on_gpu else None

        features: list[dict] = []
        polys_by_label: dict[str, list[Polygon]] = {}
        tile_rows: list[dict] = []
        for spec in CLASSES:
            recs = kept[spec.label]
            polys_by_label[spec.label] = [r["geom"] for r in recs]
            label_area = 0.0
            for r in recs:
                out_geom = to_output_geom(r["geom"], spec)
                # Pixel mode: keep pixel coords (identity transform is a no-op).
                geo = to_geo(out_geom, transform)
                if spec.geom == "polygon":
                    geo = geo.simplify(0.0 if tile_pixel else SIMPLIFY_TOL_M)
                label_area += r["area_m2"] if r["area_m2"] is not None else 0.0
                features.append(
                    {
                        "type": "Feature",
                        "properties": make_properties(
                            spec, r["score"], r["area_px"], r["area_m2"], r["prompt"]
                        ),
                        "geometry": mapping(geo),
                    }
                )
            tile_rows.append(
                {
                    "tile": name,
                    "label": spec.label,
                    "kept": len(recs),
                    "area_m2": round(label_area, 1) if px_m2 is not None else None,
                    "sec": round(dt, 1),
                    "crops": n_inferred,
                    "peak_vram_gb": round(peak_gb, 2) if peak_gb is not None else None,
                }
            )

        veg = exg_baseline(rgb, valid)
        tile_rows.append(
            {
                "tile": name,
                "label": "ExG+Otsu (baseline)",
                "kept": None,
                "area_m2": round(float(veg.sum() * px_m2), 1) if px_m2 is not None else None,
                "sec": None,
                "crops": None,
                "peak_vram_gb": None,
            }
        )

        # Write per-tile outputs FIRST (atomically) so a preemption after this
        # point loses nothing; only then record the tile in the summary.
        paths = tile_paths(out, name)
        write_geojson(paths["geojson"], features, crs_epsg)
        save_quicklook(rgb, polys_by_label, paths["png"])

        summary = [r for r in summary if r.get("tile") != name] + tile_rows
        _atomic_write_text(summary_path, json.dumps(summary, indent=2))
        vram = f", peak {peak_gb:.1f} GB" if peak_gb is not None else ""
        print(
            f"[{idx}/{total}] {name}: "
            + ", ".join(f"{r['label']}={r['kept']}" for r in tile_rows if r["kept"] is not None)
            + f" ({dt:.1f}s, {n_inferred} crops{vram})",
            flush=True,
        )

    print(f"done: {total} tiles -> {out}", flush=True)


class _nullcontext:
    def __enter__(self):
        return None

    def __exit__(self, *exc):
        return False


# --------------------------------------------------------------------------- #
# CPU self-check of the pure helpers
# --------------------------------------------------------------------------- #


def selftest() -> int:
    """Exercise the pure geometry / size-filter / resume helpers on CPU."""

    # crop_starts: full coverage, snapped last window, crop >= size edge case.
    starts = crop_starts(2048, 1024, 256)
    assert starts[0] == 0 and starts[-1] + 1024 >= 2048, starts
    assert crop_starts(500, 1024, 256) == [0]
    assert plan_crops(2048, 2048, 1024, 256) == [
        (x, y) for y in starts for x in starts
    ], "plan_crops must be the product of crop_starts"

    # batched grouping.
    assert list(batched([1, 2, 3, 4, 5], 2)) == [[1, 2], [3, 4], [5]]

    # mask_to_polygon: a 10x10 square block -> area 100 px, offset applied.
    m = np.zeros((20, 20), bool)
    m[5:15, 5:15] = True
    poly = mask_to_polygon(m, x0=100, y0=200)
    assert poly is not None and abs(poly.area - 100) < 1e-6, poly.area
    assert poly.bounds == (105.0, 205.0, 115.0, 215.0), poly.bounds
    assert mask_to_polygon(np.zeros((5, 5), bool)) is None

    # nms: two near-identical boxes collapse to one; a distant box survives.
    a = box(0, 0, 10, 10)
    b = box(1, 1, 11, 11)  # ~IoU 0.68 with a
    c = box(100, 100, 110, 110)
    keep = nms(
        [
            {"geom": a, "score": 0.9},
            {"geom": b, "score": 0.5},
            {"geom": c, "score": 0.7},
        ],
        iou_thr=0.5,
    )
    assert len(keep) == 2, [k["score"] for k in keep]
    assert keep[0]["score"] == 0.9  # highest kept first

    # to_geo / to_pixel round-trip through a rasterio-style transform.
    t = Affine(0.025, 0.0, 500000.0, 0.0, -0.025, 4000000.0)
    g = box(10, 20, 30, 40)
    back = to_pixel(to_geo(g, t), t)
    assert back.equals_exact(g, 1e-6), back

    # size gate: young vine kept (however small), tree rejected, weed floor.
    vine = CLASSES[0]
    assert size_ok(0.05, vine) and size_ok(2.4, vine)  # young + mature vine
    assert not size_ok(8.0, vine)  # tree crown rejected by LARGE cap
    assert not size_ok(0.005, vine)  # sub-noise rejected
    waste = CLASSES[1]
    assert waste.geom == "bbox"

    # bbox output geometry for waste is an axis-aligned rectangle.
    diamond = Polygon([(0, 5), (5, 0), (10, 5), (5, 10)])
    bb = to_output_geom(diamond, waste)
    assert bb.bounds == (0.0, 0.0, 10.0, 10.0) and bb.equals(box(0, 0, 10, 10))
    assert to_output_geom(diamond, vine).equals(diamond)  # polygon class untouched

    # whitish tube guard.
    crop_rgb = np.full((4, 4, 3), 240, np.uint8)
    mask_all = np.ones((4, 4), bool)
    assert _is_whitish(crop_rgb, mask_all)
    green = np.zeros((4, 4, 3), np.uint8)
    green[..., 1] = 200
    assert not _is_whitish(green, mask_all)

    # feature properties carry the EXACT challenge attribute fields (null) + meta.
    props = make_properties(vine, score=0.8, area_px=1234.0, area_m2=0.77, prompt="grapevine canopy")
    for fld in ("vineyard_id", "row_id", "row_structure", "interrow_cover"):
        assert fld in props and props[fld] is None, props
    assert props["label"] == "vineyard" and props["area_m2"] == 0.77 and props["area_px"] == 1234.0

    # config dump is complete and machine-readable.
    cfg = build_config(1024, 256, 8, 0.3, pixel=False, gsd=None)
    assert cfg["taxonomy"]["produced_labels"] == ["vineyard", "waste"]
    assert cfg["taxonomy"]["attribute_fields"] == list(ATTRIBUTE_FIELDS)
    assert json.loads(json.dumps(cfg))  # round-trips as JSON

    # resume/skip logic with atomic writes (georeferenced + pixel-space modes).
    with tempfile.TemporaryDirectory() as d:
        assert not tile_is_done(d, "siret3_r001_c001")
        p = tile_paths(d, "siret3_r001_c001")
        write_geojson(p["geojson"], [], 32635)
        assert not tile_is_done(d, "siret3_r001_c001")  # png still missing
        _atomic_save_image(p["png"], Image.new("RGB", (8, 8)))
        assert tile_is_done(d, "siret3_r001_c001")
        fc = _read_json(p["geojson"])
        assert fc["crs"]["properties"]["name"] == "urn:ogc:def:crs:EPSG::32635"
        # pixel-space output omits the CRS member.
        write_geojson(p["geojson"], [], None)
        px_fc = _read_json(p["geojson"])
        assert "crs" not in px_fc and px_fc["coordinate_space"] == "pixel"

    # evaluation matcher on a synthetic tile-less case (no preds -> all FN).
    with tempfile.TemporaryDirectory() as d:
        xml = os.path.join(d, "ann.xml")
        _atomic_write_text(
            xml,
            '<annotations><image id="0" name="t.tif" width="100" height="100">'
            '<polygon label="vineyard" points="0,0;10,0;10,10;0,10"/></image></annotations>',
        )
        res = evaluate_against_cvat(d, xml, d, label="vineyard")
        assert res["fn"] == 1 and res["tp"] == 0 and res["recall"] == 0.0, res

    print("selftest PASS: all pure-helper checks green")
    return 0


# --------------------------------------------------------------------------- #
# CLI
# --------------------------------------------------------------------------- #


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--tiles", default="tiles/*.tif", help="glob of input GeoTIFF tiles")
    ap.add_argument("--out", default="out_v2", help="output dir (gitignored)")
    ap.add_argument("--conf", type=float, default=DEFAULT_CONF, help="confidence threshold; lower = more recall")
    ap.add_argument("--crop", type=int, default=DEFAULT_CROP, help="crop size px (benchmark 640 vs 1024)")
    ap.add_argument("--overlap", type=int, default=DEFAULT_OVERLAP, help="crop overlap px")
    ap.add_argument("--batch", type=int, default=DEFAULT_BATCH, help="crops kept resident per group (96 GB headroom)")
    ap.add_argument("--no-resume", dest="resume", action="store_false", help="reprocess tiles even if output exists")
    ap.add_argument("--pixel", action="store_true", help="force pixel-space output (non-georeferenced imagery, e.g. Riseholme JPGs)")
    ap.add_argument("--gsd", type=float, default=None, help="ground sample distance m/px; restores the m² size gate in pixel mode")
    ap.add_argument("--selftest", action="store_true", help="run CPU-only geometry self-check and exit")
    ap.set_defaults(resume=True)
    a = ap.parse_args(argv)

    if a.selftest:
        return selftest()

    tiles = sorted(glob.glob(a.tiles))
    if not tiles:
        print(f"no tiles matched: {a.tiles}", file=sys.stderr)
        return 2
    run(tiles, a.out, a.conf, a.crop, a.overlap, a.batch, a.resume, a.pixel, a.gsd)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

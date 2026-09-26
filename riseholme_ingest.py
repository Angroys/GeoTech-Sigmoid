"""Riseholme COCO -> challenge-schema ground-truth ingest (Stage 1 companion).

This is the ground-truth (GT) side of the pipeline that :mod:`sam3_poc` predicts
against. It parses each Riseholme season/split ``_annotations.coco.json`` and
emits **per-image** GeoJSON in the *exact same output schema* as ``sam3_poc.py``
(pixel-space FeatureCollection; feature ``properties`` = the challenge attribute
fields ``vineyard_id/row_id/row_structure/interrow_cover`` plus
``label/score/area_px/area_m2/prompt``), so SAM 3 predictions and Riseholme GT
can be compared later with a single polygon matcher.

Riseholme is **non-georeferenced** drone JPG (4056x3040, no CRS), so output is
always pixel-space (``coordinate_space: "pixel"``, no CRS member, ``area_m2``
null) -- identical to ``sam3_poc`` running with ``--pixel``.

Class mapping -- READ THIS (plan.md §4)
---------------------------------------
The confirmed COCO categories are ``{0: vineyard, 1: pole, 2: trunk,
3: vine_row}``, but inspection of the actual annotations (see
:func:`inspect_categories`) shows:

* ``vineyard`` (id 0) is the Roboflow **supercategory placeholder**
  (``supercategory: "none"``) and carries **ZERO annotations** across all
  855 images / 3 seasons. There is therefore **no individual-plant canopy GT
  in Riseholme at all.**
* ``vine_row`` (id 3) is a **WHOLE-ROW** polygon: median bbox height ~1520-1580
  px (a full row spanning most of the 3040 px frame), NOT one plant. The
  challenge convention is *one canopy == one plant*, so ``vine_row`` is
  **NOT** mapped to the individual-plant ``vineyard`` class. It is emitted
  faithfully as a clearly-named **row-level** context label (challenge
  ``row``), and it is **not split** into plant-sized segments: these JPGs have
  no CRS / known GSD, so the 1.0-1.5 m in-row spacing needed to split
  defensibly cannot be recovered. We keep the raw whole-row geometry and record
  the caveat rather than invent per-plant geometry.
* ``pole`` (id 1) and ``trunk`` (id 2) are planting **infrastructure**: neither
  canopy nor waste. They are kept as clearly-named context labels
  (``pole`` / ``trunk``) with provenance, never folded into ``vineyard`` or
  ``waste``. (``trunk`` is the closest thing to a per-plant marker but is a
  trunk mask, not a canopy polygon, so it stays out of ``vineyard``.)

Every emitted feature preserves its original COCO category name in a
``source_class`` property for provenance, and the machine-readable mapping
report (:func:`build_mapping_report`, written to ``mapping_report.json`` and
printed) documents every raw->challenge decision with counts.

Usage
-----
    python riseholme_ingest.py                          # ingest all seasons/splits
    python riseholme_ingest.py --limit 5 --out /tmp/gt  # smoke test (5 images)
    python riseholme_ingest.py --selftest               # CPU-only self-check
"""

from __future__ import annotations

import argparse
import glob
import json
import os
import sys
import tempfile
from collections import Counter
from dataclasses import dataclass

import numpy as np
from PIL import Image, ImageDraw
from shapely.geometry import MultiPolygon, Polygon, mapping, shape
from shapely.validation import make_valid

# --------------------------------------------------------------------------- #
# Schema constants -- kept byte-for-byte compatible with sam3_poc.py
# --------------------------------------------------------------------------- #
# The exact challenge attribute fields (lower-case, verbatim from the annotation
# rules). GT emits them null just like the SAM 3 driver, so both sides share one
# FeatureCollection schema.
ATTRIBUTE_FIELDS: tuple[str, ...] = ("vineyard_id", "row_id", "row_structure", "interrow_cover")


# --------------------------------------------------------------------------- #
# Class mapping: raw COCO category -> challenge taxonomy (see module docstring)
# --------------------------------------------------------------------------- #
@dataclass(frozen=True)
class ClassMap:
    """One raw COCO category and how it maps into the challenge taxonomy."""

    coco_id: int
    source_class: str          # original COCO category name (provenance)
    challenge_label: str | None  # emitted `label`; None = not emitted
    kind: str                  # "canopy" | "row" | "infrastructure" | "placeholder"
    emit: bool
    rationale: str


# Order matches COCO ids 0..3. `vineyard`(0) is an empty placeholder; `vine_row`
# is row-level context (NOT individual-plant vineyard); pole/trunk are
# infrastructure context. None are mapped to the individual-plant `vineyard`
# canopy class, because Riseholme contains no canopy annotations.
CLASS_MAPS: tuple[ClassMap, ...] = (
    ClassMap(
        coco_id=0,
        source_class="vineyard",
        challenge_label=None,
        kind="placeholder",
        emit=False,
        rationale=(
            "Roboflow supercategory placeholder (supercategory='none') with ZERO "
            "annotations across all splits; nothing to emit."
        ),
    ),
    ClassMap(
        coco_id=1,
        source_class="pole",
        challenge_label="pole",
        kind="infrastructure",
        emit=True,
        rationale=(
            "Planting infrastructure (trellis/end pole); neither canopy nor waste. "
            "Kept as a clearly-named context layer, never folded into 'vineyard'."
        ),
    ),
    ClassMap(
        coco_id=2,
        source_class="trunk",
        challenge_label="trunk",
        kind="infrastructure",
        emit=True,
        rationale=(
            "Individual vine trunk mask (per-plant marker) but NOT a canopy polygon; "
            "kept as context. Closest to per-plant GT but out of the 'vineyard' set."
        ),
    ),
    ClassMap(
        coco_id=3,
        source_class="vine_row",
        challenge_label="row",
        kind="row",
        emit=True,
        rationale=(
            "WHOLE-ROW polygon (median bbox height ~1520-1580 px = a full row, not "
            "one plant). Emitted faithfully as row-level context (challenge 'row'); "
            "NOT mapped to individual-plant 'vineyard' and NOT split into plant "
            "segments (no CRS/GSD on these JPGs to place 1.0-1.5 m in-row spacing "
            "defensibly)."
        ),
    ),
)

CLASS_MAP_BY_ID: dict[int, ClassMap] = {c.coco_id: c for c in CLASS_MAPS}

# Quick-look colours per emitted challenge label.
QUICKLOOK_COLORS = {"row": "#ff2d2d", "pole": "#ffd400", "trunk": "#2dd4ff"}

SEASON_GLOB = "*coco-segmentation"
SPLITS: tuple[str, ...] = ("train", "valid", "test")
DEFAULT_DATASET = (
    "data/riseholme_vineyard_2024_2025_19234907/dataset"
)
DEFAULT_OUT = "out_v2/riseholme_gt"


# --------------------------------------------------------------------------- #
# Atomic / IO helpers (mirror sam3_poc.py for resume-safety)
# --------------------------------------------------------------------------- #
def _atomic_write_text(path: str, text: str) -> None:
    """Write then rename, so a preemption can never leave a half-written file."""

    d = os.path.dirname(path) or "."
    os.makedirs(d, exist_ok=True)
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
    os.makedirs(d, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=d, suffix=".png")
    os.close(fd)
    try:
        img.save(tmp, format="PNG")
        os.replace(tmp, path)
    finally:
        if os.path.exists(tmp):
            os.remove(tmp)


def _read_json(path: str):
    with open(path) as f:
        return json.loads(f.read())


def write_geojson(path: str, features: list[dict]) -> None:
    """Write a pixel-space FeatureCollection atomically (no CRS member).

    Matches ``sam3_poc.write_geojson(..., crs_epsg=None)``: emits
    ``coordinate_space: "pixel"`` since Riseholme JPGs are non-georeferenced."""

    fc = {"type": "FeatureCollection", "features": features, "coordinate_space": "pixel"}
    _atomic_write_text(path, json.dumps(fc))


def make_properties(cm: ClassMap, area_px: float) -> dict:
    """Feature properties in the sam3_poc schema, plus ``source_class`` provenance.

    GT has no model score/prompt: ``score`` is 1.0 (perfect GT), ``prompt`` is
    None, ``area_m2`` is None (pixel-space, no known GSD). The four challenge
    attribute fields are emitted null exactly as the SAM 3 driver does."""

    props: dict = {field: None for field in ATTRIBUTE_FIELDS}
    props["label"] = cm.challenge_label
    props["score"] = 1.0
    props["area_px"] = round(area_px, 1)
    props["area_m2"] = None
    props["prompt"] = None
    props["source_class"] = cm.source_class  # provenance: raw COCO category name
    return props


# --------------------------------------------------------------------------- #
# Geometry
# --------------------------------------------------------------------------- #
def coco_seg_to_geom(segmentation: list) -> Polygon | MultiPolygon | None:
    """Build a shapely geometry from a COCO polygon segmentation.

    COCO ``segmentation`` is a list of flat ``[x0, y0, x1, y1, ...]`` rings; a
    single annotation may have several parts. We return a ``Polygon`` (one part)
    or ``MultiPolygon`` (several), repaired with ``make_valid`` if self-touching.
    RLE segmentations (dict) are not present in this dataset and are skipped."""

    if not isinstance(segmentation, list):
        return None
    parts: list[Polygon] = []
    for ring in segmentation:
        if not isinstance(ring, list) or len(ring) < 6:
            continue
        pts = [(ring[i], ring[i + 1]) for i in range(0, len(ring) - 1, 2)]
        if len(pts) >= 3:
            p = Polygon(pts)
            if not p.is_valid:
                p = make_valid(p)
            if not p.is_empty and p.area > 0:
                parts.append(p)
    if not parts:
        return None
    geom = parts[0] if len(parts) == 1 else MultiPolygon(
        [g for pp in parts for g in (pp.geoms if pp.geom_type == "MultiPolygon" else [pp])]
    )
    # make_valid may have produced a GeometryCollection; keep polygonal area only.
    if geom.geom_type not in ("Polygon", "MultiPolygon"):
        polys = [g for g in getattr(geom, "geoms", []) if g.geom_type in ("Polygon", "MultiPolygon")]
        if not polys:
            return None
        geom = polys[0] if len(polys) == 1 else MultiPolygon(
            [g for pp in polys for g in (pp.geoms if pp.geom_type == "MultiPolygon" else [pp])]
        )
    return geom


# --------------------------------------------------------------------------- #
# Inspection + mapping report (plan.md §4)
# --------------------------------------------------------------------------- #
def inspect_categories(coco_files: list[str]) -> dict:
    """Measure per-category counts and polygon extents across the given COCO files.

    Returns a machine-readable dict of ``{coco_id: {name, count, bbox height/width
    and area percentiles}}`` -- the evidence behind the class-mapping decisions."""

    cats: dict[int, str] = {}
    heights: dict[int, list[float]] = {}
    widths: dict[int, list[float]] = {}
    areas: dict[int, list[float]] = {}
    counts: Counter = Counter()
    n_images = 0
    for path in coco_files:
        d = _read_json(path)
        n_images += len(d.get("images", []))
        for c in d.get("categories", []):
            cats[c["id"]] = c["name"]
        for a in d.get("annotations", []):
            cid = a["category_id"]
            counts[cid] += 1
            bb = a.get("bbox")
            if bb and len(bb) == 4:
                widths.setdefault(cid, []).append(bb[2])
                heights.setdefault(cid, []).append(bb[3])
            areas.setdefault(cid, []).append(a.get("area", 0.0))

    def _pct(vals: list[float]) -> dict | None:
        if not vals:
            return None
        arr = np.asarray(vals, dtype=float)
        return {
            "min": round(float(arr.min()), 1),
            "median": round(float(np.median(arr)), 1),
            "max": round(float(arr.max()), 1),
        }

    per_cat = {}
    for cid, name in sorted(cats.items()):
        per_cat[cid] = {
            "name": name,
            "count": int(counts.get(cid, 0)),
            "bbox_height_px": _pct(heights.get(cid, [])),
            "bbox_width_px": _pct(widths.get(cid, [])),
            "area_px2": _pct(areas.get(cid, [])),
        }
    return {"n_images": n_images, "n_files": len(coco_files), "categories": per_cat}


def build_mapping_report(inspection: dict) -> dict:
    """Machine-readable raw->challenge class-mapping report with the evidence."""

    per_cat = inspection["categories"]
    decisions = []
    for cm in CLASS_MAPS:
        ev = per_cat.get(cm.coco_id, {})
        decisions.append(
            {
                "coco_id": cm.coco_id,
                "source_class": cm.source_class,
                "challenge_label": cm.challenge_label,
                "kind": cm.kind,
                "emitted": cm.emit,
                "annotation_count": ev.get("count", 0),
                "bbox_height_px": ev.get("bbox_height_px"),
                "rationale": cm.rationale,
            }
        )
    return {
        "dataset": "riseholme_vineyard_2024_2025 (COCO segmentation)",
        "coordinate_space": "pixel",
        "images_inspected": inspection["n_images"],
        "annotation_files": inspection["n_files"],
        "challenge_attribute_fields": list(ATTRIBUTE_FIELDS),
        "vine_row_handling": (
            "WHOLE-ROW polygons kept faithfully as row-level context (label 'row'); "
            "NOT mapped to individual-plant 'vineyard' and NOT split into plant "
            "segments (no CRS/GSD to place in-row spacing defensibly)."
        ),
        "vineyard_canopy_note": (
            "No individual-plant canopy annotations exist in Riseholme (COCO cat 0 "
            "'vineyard' is an empty supercategory placeholder), so nothing maps to "
            "the challenge 'vineyard' class here."
        ),
        "decisions": decisions,
    }


def print_mapping_report(report: dict) -> None:
    print("\n=== Riseholme class-mapping report =====================================")
    print(f"images inspected: {report['images_inspected']}  files: {report['annotation_files']}")
    print(f"{'coco_id':>7}  {'source_class':<12} {'->':^2} {'challenge':<12} "
          f"{'kind':<14} {'count':>7}  emitted")
    for d in report["decisions"]:
        print(f"{d['coco_id']:>7}  {d['source_class']:<12} {'->':^2} "
              f"{d['challenge_label']!s:<12} {d['kind']:<14} {d['annotation_count']:>7}  {d['emitted']}")
    print(f"\nvine_row: {report['vine_row_handling']}")
    print(f"vineyard: {report['vineyard_canopy_note']}")
    print("========================================================================\n")


# --------------------------------------------------------------------------- #
# Quick-look
# --------------------------------------------------------------------------- #
def save_quicklook(
    image_path: str,
    polys_by_label: dict[str, list],
    out_path: str,
    scale: int = 4,
) -> None:
    """Downscaled preview of the source JPG with GT outlines drawn per label."""

    with Image.open(image_path) as im:
        im = im.convert("RGB")
        w, h = im.size
        img = im.resize((max(1, w // scale), max(1, h // scale)))
    d = ImageDraw.Draw(img)
    for label, geoms in polys_by_label.items():
        c = QUICKLOOK_COLORS.get(label, "#ffffff")
        for g in geoms:
            polys = g.geoms if g.geom_type == "MultiPolygon" else [g]
            for p in polys:
                d.polygon([(x / scale, y / scale) for x, y in p.exterior.coords], outline=c)
    _atomic_save_image(out_path, img)


# --------------------------------------------------------------------------- #
# Ingest
# --------------------------------------------------------------------------- #
def _season_tag(season_dir: str) -> str:
    """Short season tag, e.g. 'riseholme-august-2024' from the folder name."""

    base = os.path.basename(season_dir.rstrip("/"))
    return base.replace("-full-resolution.coco-segmentation", "")


def find_coco_files(dataset_dir: str) -> list[str]:
    """All ``_annotations.coco.json`` under each season/split."""

    files = []
    for season in sorted(glob.glob(os.path.join(dataset_dir, SEASON_GLOB))):
        for split in SPLITS:
            p = os.path.join(season, split, "_annotations.coco.json")
            if os.path.exists(p):
                files.append(p)
    return files


def output_stem(season_tag: str, split: str, image_file: str) -> str:
    """Clear per-image output stem: ``<season>__<split>__<image_stem>``."""

    stem = os.path.splitext(os.path.basename(image_file))[0]
    return f"{season_tag}__{split}__{stem}"


def ingest_coco_file(
    coco_path: str,
    out_dir: str,
    quicklook: bool = True,
    resume: bool = True,
    limit_remaining: int | None = None,
) -> tuple[int, Counter]:
    """Emit per-image GT GeoJSON (+ optional PNG) for one COCO file.

    Returns ``(n_images_written, label_counter)``. Atomic per-file writes make it
    resume-safe: an image whose GeoJSON already exists is skipped."""

    d = _read_json(coco_path)
    season_dir = os.path.dirname(os.path.dirname(coco_path))
    split = os.path.basename(os.path.dirname(coco_path))
    season_tag = _season_tag(season_dir)
    img_dir = os.path.dirname(coco_path)

    images = {im["id"]: im for im in d.get("images", [])}
    anns_by_image: dict[int, list[dict]] = {}
    for a in d.get("annotations", []):
        anns_by_image.setdefault(a["image_id"], []).append(a)

    label_counts: Counter = Counter()
    written = 0
    for img_id, im in images.items():
        if limit_remaining is not None and written >= limit_remaining:
            break
        stem = output_stem(season_tag, split, im["file_name"])
        geojson_path = os.path.join(out_dir, f"{stem}.geojson")
        png_path = os.path.join(out_dir, f"{stem}__quicklook.png")
        if resume and os.path.exists(geojson_path) and (not quicklook or os.path.exists(png_path)):
            written += 1
            continue

        features: list[dict] = []
        polys_by_label: dict[str, list] = {}
        for a in anns_by_image.get(img_id, []):
            cm = CLASS_MAP_BY_ID.get(a["category_id"])
            if cm is None or not cm.emit:
                continue
            geom = coco_seg_to_geom(a.get("segmentation", []))
            if geom is None:
                continue
            area_px = float(a.get("area") or geom.area)
            features.append(
                {
                    "type": "Feature",
                    "properties": make_properties(cm, area_px),
                    "geometry": mapping(geom),
                }
            )
            polys_by_label.setdefault(cm.challenge_label, []).append(geom)
            label_counts[cm.challenge_label] += 1

        write_geojson(geojson_path, features)
        if quicklook:
            src_img = os.path.join(img_dir, im["file_name"])
            if os.path.exists(src_img):
                save_quicklook(src_img, polys_by_label, png_path)
        written += 1

    return written, label_counts


def run(
    dataset_dir: str,
    out_dir: str,
    quicklook: bool = True,
    resume: bool = True,
    limit: int | None = None,
) -> dict:
    """Ingest every season/split under ``dataset_dir`` into ``out_dir``.

    Writes ``mapping_report.json`` + ``summary.json`` and returns the report."""

    coco_files = find_coco_files(dataset_dir)
    if not coco_files:
        raise FileNotFoundError(f"no _annotations.coco.json under {dataset_dir}")

    inspection = inspect_categories(coco_files)
    report = build_mapping_report(inspection)
    os.makedirs(out_dir, exist_ok=True)
    _atomic_write_text(os.path.join(out_dir, "mapping_report.json"), json.dumps(report, indent=2))
    print_mapping_report(report)

    total_written = 0
    total_labels: Counter = Counter()
    summary: list[dict] = []
    for coco_path in coco_files:
        remaining = None if limit is None else max(0, limit - total_written)
        if remaining == 0:
            break
        n, labels = ingest_coco_file(coco_path, out_dir, quicklook, resume, remaining)
        total_written += n
        total_labels.update(labels)
        rel = os.path.relpath(coco_path, dataset_dir)
        summary.append({"coco_file": rel, "images_written": n, "labels": dict(labels)})
        print(f"[{rel}] {n} images -> {dict(labels)}", flush=True)

    summary_obj = {
        "images_written": total_written,
        "labels_total": dict(total_labels),
        "per_file": summary,
    }
    _atomic_write_text(os.path.join(out_dir, "summary.json"), json.dumps(summary_obj, indent=2))
    print(f"\ndone: {total_written} images -> {out_dir}  labels={dict(total_labels)}", flush=True)
    return report


# --------------------------------------------------------------------------- #
# Comparison helper: SAM 3 predictions vs Riseholme GT (per-image polygon match)
# --------------------------------------------------------------------------- #
def _iou(a, b) -> float:
    inter = a.intersection(b).area
    if inter == 0.0:
        return 0.0
    union = a.area + b.area - inter
    return inter / union if union > 0 else 0.0


def _load_label_polys(geojson_path: str, label: str) -> list:
    """Pixel-space polygons of ``label`` from a FeatureCollection GeoJSON."""

    if not os.path.exists(geojson_path):
        return []
    fc = _read_json(geojson_path)
    polys = []
    for feat in fc.get("features", []):
        if feat.get("properties", {}).get("label") != label:
            continue
        g = shape(feat["geometry"])
        if not g.is_empty:
            polys.append(g)
    return polys


def evaluate_against_riseholme(
    pred_dir: str,
    gt_dir: str,
    label: str = "row",
    iou_thr: float = 0.5,
) -> dict:
    """Greedy per-image IoU match of SAM 3 predictions vs Riseholme GT.

    Both sides are pixel-space GeoJSON in the shared sam3_poc schema, so features
    of ``label`` are compared directly (no reprojection). GT files are the ones
    this module emits (``<season>__<split>__<image_stem>.geojson``); prediction
    files in ``pred_dir`` must share the same stem. Mirrors
    ``sam3_poc.evaluate_against_cvat`` and returns aggregate + per-image
    ``tp/fp/fn/precision/recall/f1/mean_iou``.

    Parameters
    ----------
    pred_dir : directory of SAM 3 prediction GeoJSONs (matching stems).
    gt_dir   : directory of this module's GT GeoJSONs.
    label    : challenge label to score (e.g. "row", "pole", "trunk").
    iou_thr  : IoU threshold for a true-positive match.
    """

    per_image: dict[str, dict] = {}
    agg = {"tp": 0, "fp": 0, "fn": 0, "iou_sum": 0.0}

    for gt_path in sorted(glob.glob(os.path.join(gt_dir, "*.geojson"))):
        stem = os.path.splitext(os.path.basename(gt_path))[0]
        gts = _load_label_polys(gt_path, label)
        preds = _load_label_polys(os.path.join(pred_dir, f"{stem}.geojson"), label)

        matched: set[int] = set()
        tp = 0
        iou_sum = 0.0
        for p in sorted(preds, key=lambda g: -g.area):
            best_i, best_iou = -1, 0.0
            for i, gt in enumerate(gts):
                if i in matched:
                    continue
                v = _iou(p, gt)
                if v > best_iou:
                    best_i, best_iou = i, v
            if best_i >= 0 and best_iou >= iou_thr:
                matched.add(best_i)
                tp += 1
                iou_sum += best_iou
        fp = len(preds) - tp
        fn = len(gts) - tp
        if preds or gts:
            per_image[stem] = {
                "tp": tp, "fp": fp, "fn": fn,
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
        "tp": tp, "fp": fp, "fn": fn,
        "per_image": per_image,
    }


# --------------------------------------------------------------------------- #
# CPU self-check
# --------------------------------------------------------------------------- #
def selftest() -> int:
    """Exercise geometry, schema, mapping and the comparison matcher on CPU."""

    # coco_seg_to_geom: a 10x10 square ring -> area 100.
    g = coco_seg_to_geom([[0, 0, 10, 0, 10, 10, 0, 10]])
    assert g is not None and abs(g.area - 100) < 1e-6, g
    # multipart -> MultiPolygon.
    mp = coco_seg_to_geom([[0, 0, 5, 0, 5, 5, 0, 5], [100, 100, 110, 100, 110, 110, 100, 110]])
    assert mp.geom_type == "MultiPolygon" and abs(mp.area - 125) < 1e-6, mp
    # degenerate ring -> None.
    assert coco_seg_to_geom([[0, 0, 1, 1]]) is None
    assert coco_seg_to_geom([]) is None

    # class mapping: cat0 not emitted, vine_row -> 'row', pole/trunk kept, none -> 'vineyard'.
    assert not CLASS_MAP_BY_ID[0].emit
    assert CLASS_MAP_BY_ID[3].challenge_label == "row"
    assert CLASS_MAP_BY_ID[1].challenge_label == "pole"
    assert CLASS_MAP_BY_ID[2].challenge_label == "trunk"
    assert all(cm.challenge_label != "vineyard" for cm in CLASS_MAPS), "no canopy GT in Riseholme"

    # properties carry EXACT challenge fields (null) + provenance, in sam3_poc schema.
    props = make_properties(CLASS_MAP_BY_ID[3], area_px=1234.0)
    for fld in ATTRIBUTE_FIELDS:
        assert fld in props and props[fld] is None, props
    assert props["label"] == "row" and props["score"] == 1.0 and props["area_px"] == 1234.0
    assert props["area_m2"] is None and props["prompt"] is None
    assert props["source_class"] == "vine_row"  # provenance

    # write_geojson is pixel-space (no CRS member) -- matches sam3_poc --pixel.
    with tempfile.TemporaryDirectory() as tmp:
        p = os.path.join(tmp, "img.geojson")
        write_geojson(p, [{"type": "Feature", "properties": props, "geometry": mapping(g)}])
        fc = _read_json(p)
        assert "crs" not in fc and fc["coordinate_space"] == "pixel", fc
        assert fc["features"][0]["properties"]["source_class"] == "vine_row"

    # output_stem is clear and season/split-scoped.
    assert output_stem("riseholme-august-2024", "train", "DJI_0001.jpg") == \
        "riseholme-august-2024__train__DJI_0001"

    # mapping report round-trips as JSON and records vine_row handling.
    inspection = {
        "n_images": 3, "n_files": 1,
        "categories": {
            0: {"name": "vineyard", "count": 0, "bbox_height_px": None},
            3: {"name": "vine_row", "count": 5, "bbox_height_px": {"min": 40, "median": 1520, "max": 3039}},
        },
    }
    report = build_mapping_report(inspection)
    assert json.loads(json.dumps(report))
    assert any(d["source_class"] == "vine_row" and d["challenge_label"] == "row" for d in report["decisions"])

    # comparison matcher: identical GT/pred rows -> perfect; missing pred -> FN.
    with tempfile.TemporaryDirectory() as tmp:
        gt = os.path.join(tmp, "gt")
        pred = os.path.join(tmp, "pred")
        os.makedirs(gt)
        os.makedirs(pred)
        feat = {"type": "Feature", "properties": {"label": "row"},
                "geometry": mapping(Polygon([(0, 0), (10, 0), (10, 10), (0, 10)]))}
        write_geojson(os.path.join(gt, "a.geojson"), [feat])
        write_geojson(os.path.join(pred, "a.geojson"), [feat])
        res = evaluate_against_riseholme(pred, gt, label="row")
        assert res["tp"] == 1 and res["fp"] == 0 and res["fn"] == 0 and res["f1"] == 1.0, res
        # GT with no matching pred file -> all FN.
        write_geojson(os.path.join(gt, "b.geojson"), [feat])
        res2 = evaluate_against_riseholme(pred, gt, label="row")
        assert res2["fn"] == 1 and res2["recall"] == 0.5, res2

    print("selftest PASS: geometry, schema, mapping and matcher checks green")
    return 0


# --------------------------------------------------------------------------- #
# CLI
# --------------------------------------------------------------------------- #
def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    ap.add_argument("--dataset", default=DEFAULT_DATASET,
                    help="Riseholme dataset dir holding the season folders")
    ap.add_argument("--out", default=DEFAULT_OUT, help="output dir (gitignored)")
    ap.add_argument("--limit", type=int, default=None,
                    help="stop after N images total (smoke test)")
    ap.add_argument("--no-quicklook", dest="quicklook", action="store_false",
                    help="skip the per-image quick-look PNG")
    ap.add_argument("--no-resume", dest="resume", action="store_false",
                    help="re-emit images even if their GeoJSON exists")
    ap.add_argument("--selftest", action="store_true",
                    help="run CPU-only self-check and exit")
    ap.set_defaults(quicklook=True, resume=True)
    a = ap.parse_args(argv)

    if a.selftest:
        return selftest()

    if not os.path.isdir(a.dataset):
        print(f"dataset dir not found: {a.dataset}", file=sys.stderr)
        return 2
    run(a.dataset, a.out, a.quicklook, a.resume, a.limit)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

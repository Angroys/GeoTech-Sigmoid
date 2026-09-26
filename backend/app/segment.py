"""Classic-CV "magic draw" segmentation for a scribble over a tile.

The user drags a scribble across the tile image; this module grows the object
under that scribble into a mask, polygonises it, and auto-classifies the label.
It uses ONLY classic computer vision computed from the tile raster -- there are
no ML model calls.

Pipeline
--------
1. Read the tile RGB at native resolution. Compute (and cache per tile, keyed by
   name + mtime) an ExG + Otsu vegetation mask (``veg``, reusing the recipe from
   the repo-root ``sam3_poc.exg_baseline``) and a validity mask (``valid`` =
   non-black pixels).
2. Rasterise the scribble ``path`` (tile pixel coords) into seed pixels. A single
   point becomes a small disk of seeds.
3. Region-grow from the seeds on the connected component of the appropriate mask
   (vegetation if the seeds sit mostly on vegetation, otherwise non-vegetation
   within ``valid``).
4. Polygonise the grown mask with ``rasterio.features.shapes`` (like
   ``sam3_poc.mask_to_polygon``), take the largest polygon, simplify it, and cap
   the vertex count so the UI stays responsive.
5. Classify the region: vegetation -> ``vineyard`` (polygon); a straight,
   elongated non-veg strip near a passage road -> ``row`` (polyline centreline)
   or ``interrow_area`` (polygon); any other compact non-veg blob -> ``waste``.
6. Restrict to the SAM-3 vineyard parcels (union of existing ``vineyard``
   annotations for the tile). A region entirely outside the parcels is still
   returned, but with lower confidence and a ``reason`` noting it.

Optional dependencies (``scikit-image`` / ``scipy``) are used for connected-
component labelling when present; otherwise a pure-numpy flood fill is used. The
passages road file is optional -- road proximity is skipped if it is missing.
"""
from __future__ import annotations

import json
import logging
import math
from pathlib import Path
from typing import Any

import numpy as np
import rasterio
from affine import Affine
from rasterio.features import shapes as rio_shapes
from shapely.affinity import affine_transform
from shapely.geometry import MultiPolygon, Polygon, shape
from shapely.ops import unary_union

from . import config, db, tiles

logger = logging.getLogger(__name__)

# ------------------------------------------------------- optional deps ----
try:  # scipy gives the fastest connected-component labelling.
    from scipy import ndimage as _ndimage  # type: ignore

    _HAVE_SCIPY = True
except Exception:  # noqa: BLE001 - optional dependency, degrade gracefully
    _ndimage = None
    _HAVE_SCIPY = False

try:  # scikit-image is the fallback labeller / skeletoniser.
    from skimage import measure as _sk_measure  # type: ignore

    _HAVE_SKIMAGE = True
except Exception:  # noqa: BLE001 - optional dependency, degrade gracefully
    _sk_measure = None
    _HAVE_SKIMAGE = False


def available_backends() -> dict[str, bool]:
    """Report which optional acceleration libraries are installed."""
    return {"scipy": _HAVE_SCIPY, "skimage": _HAVE_SKIMAGE}


# --------------------------------------------------------------- tuning ----
_SEED_POINT_RADIUS = 5  # px radius for a single-point (hover) scribble
_VEG_SEED_FRACTION = 0.5  # >this share of seeds on veg -> grow vegetation
_GROW_PAD = 400  # px padding around the seed bbox for the flood-fill window

# ---- locality window ------------------------------------------------------
# The grown mask is intersected with a clip window built around the scribble so
# the returned region stays LOCAL to where the user drew. Without this a large
# connected soil/road/inter-row blob floods the whole tile and the polygon lands
# in the tile centre regardless of the seed (the "label spawns in the middle"
# bug). Canopy components are small and already fit inside the window, so
# vegetation behaviour is unchanged. All values are in tile pixels.
_LOCAL_MARGIN_BASE_PX = 80  # base dilation of the scribble bbox
_LOCAL_MARGIN_MIN_PX = 80  # floor for the dilation margin
_LOCAL_MARGIN_MAX_PX = 300  # ceiling: a big drag can grab a bigger area
_LOCAL_MARGIN_SCALE = 0.5  # margin also grows with the scribble bbox size
_LOCAL_POINT_RADIUS_PX = 140  # fixed half-window for a single hover point
_GROW_MAX_ITERS = 800  # cap the vectorised dilation flood fill
_MAX_VERTICES = 60  # simplify polygons down to at most this many exterior pts
_ROW_ASPECT = 4.0  # oriented-bbox aspect ratio to call something elongated
_ROW_FILL = 0.55  # region-area / obb-area to call it "straight / well filled"
_ROW_MAX_WIDTH_M = 1.2  # a strip narrower than this (in metres) -> row polyline
_ROAD_DIST_M = 3.0  # region within this distance of a passage -> road-like
_PARCEL_BUFFER_PX = 12  # buffer applied to the vineyard-parcel union

# label constants (match config.CLASS_VALUE_MAP keys)
_VINEYARD = "vineyard"
_ROW = "row"
_INTERROW = "interrow_area"
_WASTE = "waste"


# --------------------------------------------------------- mask caching ----
# Keyed by (tile name, mtime_ns); holds the derived masks so a drag producing
# many calls only computes the ExG/Otsu mask once.
_MASK_CACHE: dict[tuple[str, int], dict[str, Any]] = {}
_MASK_CACHE_MAX = 8


def _exg_veg_mask(rgb: np.ndarray, valid: np.ndarray) -> np.ndarray:
    """Excess-green + Otsu vegetation mask (reuses the ``sam3_poc`` recipe).

    ``skimage.filters.threshold_otsu`` is unavailable in this venv, so Otsu's
    threshold is computed with a small pure-numpy implementation.
    """
    x = rgb.astype(np.float32)
    s = x.sum(-1) + 1e-6
    r, g, b = x[..., 0] / s, x[..., 1] / s, x[..., 2] / s
    exg = 2 * g - r - b
    vals = exg[valid]
    if vals.size == 0:
        return np.zeros(valid.shape, dtype=bool)
    thr = _otsu_threshold(vals)
    return (exg > thr) & valid


def _otsu_threshold(values: np.ndarray, bins: int = 256) -> float:
    """Otsu's threshold for a 1-D array of values (pure numpy)."""
    finite = values[np.isfinite(values)]
    if finite.size == 0:
        return 0.0
    lo = float(finite.min())
    hi = float(finite.max())
    if hi <= lo:
        return lo
    hist, edges = np.histogram(finite, bins=bins, range=(lo, hi))
    hist = hist.astype(np.float64)
    total = hist.sum()
    if total == 0:
        return lo
    centers = (edges[:-1] + edges[1:]) / 2.0
    weight_bg = np.cumsum(hist)
    weight_fg = total - weight_bg
    cumsum_val = np.cumsum(hist * centers)
    total_val = cumsum_val[-1]
    # Guard divisions where a class is empty.
    with np.errstate(divide="ignore", invalid="ignore"):
        mean_bg = cumsum_val / weight_bg
        mean_fg = (total_val - cumsum_val) / weight_fg
        between = weight_bg * weight_fg * (mean_bg - mean_fg) ** 2
    between[~np.isfinite(between)] = -1.0
    idx = int(np.argmax(between))
    return float(centers[idx])


def _load_masks(name: str) -> dict[str, Any]:
    """Return cached ``veg``/``valid`` masks + geotransform for a tile."""
    path = tiles.tile_path(name)
    key = (name, path.stat().st_mtime_ns)
    cached = _MASK_CACHE.get(key)
    if cached is not None:
        return cached

    with rasterio.open(str(path)) as ds:
        n = min(ds.count, 3)
        arr = ds.read(indexes=list(range(1, n + 1)))
        transform = ds.transform
        crs = str(ds.crs)
        width, height = ds.width, ds.height
    if arr.shape[0] < 3:
        # Grey tile -> replicate the single band so ExG is defined (all zero).
        arr = np.repeat(arr[:1], 3, axis=0)
    rgb = np.ascontiguousarray(np.transpose(arr[:3], (1, 2, 0)))
    valid = rgb.sum(-1) > 0
    veg = _exg_veg_mask(rgb, valid)

    entry = {
        "veg": veg,
        "valid": valid,
        "transform": transform,
        "crs": crs,
        "width": width,
        "height": height,
    }
    # Evict oldest entries if the cache grows unbounded.
    if len(_MASK_CACHE) >= _MASK_CACHE_MAX:
        _MASK_CACHE.pop(next(iter(_MASK_CACHE)))
    _MASK_CACHE[key] = entry
    return entry


# --------------------------------------------------------- seed pixels ----
def _rasterize_path(
    path: list[list[float]], width: int, height: int
) -> np.ndarray:
    """Rasterise the scribble into a boolean seed mask (tile pixel space)."""
    seed = np.zeros((height, width), dtype=bool)
    pts = [
        (float(x), float(y))
        for x, y in path
        if x is not None and y is not None
    ]
    if not pts:
        return seed

    def _plot(col: float, row: float) -> None:
        c = int(round(col))
        r = int(round(row))
        if 0 <= r < height and 0 <= c < width:
            seed[r, c] = True

    if len(pts) == 1:
        cx, cy = pts[0]
        rad = _SEED_POINT_RADIUS
        r0 = max(0, int(cy) - rad)
        r1 = min(height, int(cy) + rad + 1)
        c0 = max(0, int(cx) - rad)
        c1 = min(width, int(cx) + rad + 1)
        yy, xx = np.ogrid[r0:r1, c0:c1]
        disk = (yy - cy) ** 2 + (xx - cx) ** 2 <= rad * rad
        seed[r0:r1, c0:c1] |= disk
        return seed

    # Densely sample each segment (~1px spacing) so the polyline is connected.
    for (x0, y0), (x1, y1) in zip(pts[:-1], pts[1:]):
        steps = int(max(abs(x1 - x0), abs(y1 - y0))) + 1
        for x, y in zip(
            np.linspace(x0, x1, steps), np.linspace(y0, y1, steps)
        ):
            _plot(x, y)
    return seed


# --------------------------------------------------------- clip window ----
def _clip_window(
    path: list[list[float]], width: int, height: int
) -> tuple[int, int, int, int]:
    """Bounding window (r0, r1, c0, c1) around the scribble, clamped to bounds.

    The window is the scribble's bounding box dilated by a margin. For a single
    hover point a fixed half-window (``_LOCAL_POINT_RADIUS_PX``) is used; for a
    drag the margin scales a little with the bbox so a longer drag grabs a
    bigger area, clamped to ``[_LOCAL_MARGIN_MIN_PX, _LOCAL_MARGIN_MAX_PX]``.
    """
    pts = [
        (float(x), float(y))
        for x, y in path
        if x is not None and y is not None
    ]
    if not pts:
        return 0, height, 0, width

    xs = [p[0] for p in pts]
    ys = [p[1] for p in pts]
    min_x, max_x = min(xs), max(xs)
    min_y, max_y = min(ys), max(ys)

    if len(pts) == 1:
        margin = float(_LOCAL_POINT_RADIUS_PX)
    else:
        bbox_extent = max(max_x - min_x, max_y - min_y)
        margin = _LOCAL_MARGIN_BASE_PX + _LOCAL_MARGIN_SCALE * bbox_extent
        margin = min(_LOCAL_MARGIN_MAX_PX, max(_LOCAL_MARGIN_MIN_PX, margin))

    r0 = max(0, int(math.floor(min_y - margin)))
    r1 = min(height, int(math.ceil(max_y + margin)) + 1)
    c0 = max(0, int(math.floor(min_x - margin)))
    c1 = min(width, int(math.ceil(max_x + margin)) + 1)
    return r0, r1, c0, c1


# --------------------------------------------------------- region grow ----
def _grow_region(target: np.ndarray, seed: np.ndarray) -> np.ndarray:
    """Grow the connected component(s) of ``target`` that ``seed`` touches.

    Uses scipy/skimage labelling when available; otherwise a windowed,
    vectorised dilation flood fill (pure numpy).
    """
    seeded = seed & target
    if not seeded.any():
        return np.zeros_like(target)

    if _HAVE_SCIPY:
        labels, _ = _ndimage.label(target)  # 4-connectivity
        touched = np.unique(labels[seeded])
        touched = touched[touched != 0]
        return np.isin(labels, touched)
    if _HAVE_SKIMAGE:
        labels = _sk_measure.label(target, connectivity=1)
        touched = np.unique(labels[seeded])
        touched = touched[touched != 0]
        return np.isin(labels, touched)
    return _flood_fill_numpy(target, seeded)


def _flood_fill_numpy(target: np.ndarray, seeded: np.ndarray) -> np.ndarray:
    """Windowed 8-connectivity flood fill using vectorised dilation."""
    rows, cols = np.nonzero(seeded)
    r0 = max(0, int(rows.min()) - _GROW_PAD)
    r1 = min(target.shape[0], int(rows.max()) + _GROW_PAD + 1)
    c0 = max(0, int(cols.min()) - _GROW_PAD)
    c1 = min(target.shape[1], int(cols.max()) + _GROW_PAD + 1)

    tgt = target[r0:r1, c0:c1]
    grown = seeded[r0:r1, c0:c1].copy()
    prev_count = -1
    for _ in range(_GROW_MAX_ITERS):
        d = grown.copy()
        d[1:, :] |= grown[:-1, :]
        d[:-1, :] |= grown[1:, :]
        d[:, 1:] |= grown[:, :-1]
        d[:, :-1] |= grown[:, 1:]
        # diagonals (8-connectivity spreads ~1.4x faster)
        d[1:, 1:] |= grown[:-1, :-1]
        d[1:, :-1] |= grown[:-1, 1:]
        d[:-1, 1:] |= grown[1:, :-1]
        d[:-1, :-1] |= grown[1:, 1:]
        d &= tgt
        count = int(d.sum())
        if count == prev_count:
            break
        prev_count = count
        grown = d

    out = np.zeros_like(target)
    out[r0:r1, c0:c1] = grown
    return out


# --------------------------------------------------------- polygonise ----
def _largest_polygon(mask: np.ndarray) -> Polygon | None:
    """Largest polygon of a boolean mask, in tile pixel coordinates."""
    m = mask.astype(np.uint8)
    polys = [
        shape(g)
        for g, v in rio_shapes(m, mask=mask, transform=Affine.identity())
        if v == 1
    ]
    if not polys:
        return None
    return max(polys, key=lambda p: p.area)


def _simplify_capped(poly: Polygon) -> Polygon:
    """Simplify a polygon so its exterior has <= ``_MAX_VERTICES`` points."""
    tol = 1.0
    simplified = poly.simplify(tol, preserve_topology=True)
    while (
        simplified.geom_type == "Polygon"
        and len(simplified.exterior.coords) > _MAX_VERTICES
        and tol < 256
    ):
        tol *= 1.8
        simplified = poly.simplify(tol, preserve_topology=True)
    if simplified.is_empty or simplified.geom_type != "Polygon":
        return poly
    return simplified


def _ring_points(poly: Polygon) -> list[list[float]]:
    """Exterior ring as ``[[x, y], ...]`` (drops the duplicate closing point)."""
    coords = list(poly.exterior.coords)
    if len(coords) > 1 and coords[0] == coords[-1]:
        coords = coords[:-1]
    return [[float(x), float(y)] for x, y in coords]


# ------------------------------------------------------- geometry stats ----
def _obb_stats(poly: Polygon) -> dict[str, Any]:
    """Oriented bounding box aspect ratio, fill fraction and long-axis line."""
    rect = poly.minimum_rotated_rectangle
    if rect.geom_type != "Polygon":
        return {
            "aspect": 1.0,
            "fill": 1.0,
            "long_m_px": 0.0,
            "short_px": 0.0,
            "centerline": None,
        }
    rc = list(rect.exterior.coords)[:4]
    e1 = math.dist(rc[0], rc[1])
    e2 = math.dist(rc[1], rc[2])
    long_px = max(e1, e2)
    short_px = min(e1, e2)
    aspect = long_px / short_px if short_px > 1e-6 else float("inf")
    obb_area = rect.area
    fill = poly.area / obb_area if obb_area > 1e-6 else 0.0

    # Centreline: midpoints of the two short edges of the oriented rectangle.
    if e1 >= e2:
        mid_a = ((rc[0][0] + rc[3][0]) / 2, (rc[0][1] + rc[3][1]) / 2)
        mid_b = ((rc[1][0] + rc[2][0]) / 2, (rc[1][1] + rc[2][1]) / 2)
    else:
        mid_a = ((rc[0][0] + rc[1][0]) / 2, (rc[0][1] + rc[1][1]) / 2)
        mid_b = ((rc[2][0] + rc[3][0]) / 2, (rc[2][1] + rc[3][1]) / 2)
    return {
        "aspect": float(aspect),
        "fill": float(fill),
        "long_px": float(long_px),
        "short_px": float(short_px),
        "centerline": [
            [float(mid_a[0]), float(mid_a[1])],
            [float(mid_b[0]), float(mid_b[1])],
        ],
    }


# ------------------------------------------------------- road proximity ----
_PASSAGES_CACHE: dict[str, Any] = {"path": None, "geom": None, "loaded": False}


def _passages_path() -> Path:
    return (
        config.BACKEND_ROOT.parent.parent.parent
        / "data"
        / "marcaj-data"
        / "assets_for_participants"
        / "02_route"
        / "passages.geojson"
    )


def _load_passages() -> Any | None:
    """Load and cache the passage (road) geometries in world coords (EPSG:32635)."""
    p = _passages_path()
    if _PASSAGES_CACHE["loaded"] and _PASSAGES_CACHE["path"] == str(p):
        return _PASSAGES_CACHE["geom"]
    geom = None
    try:
        if p.is_file():
            data = json.loads(p.read_text())
            geoms = [
                shape(f["geometry"])
                for f in data.get("features", [])
                if f.get("geometry")
            ]
            if geoms:
                geom = unary_union(geoms)
    except Exception as exc:  # noqa: BLE001 - optional file; degrade gracefully
        logger.warning("could not load passages.geojson: %s", exc)
        geom = None
    _PASSAGES_CACHE.update({"path": str(p), "geom": geom, "loaded": True})
    return geom


def _pixel_to_world(poly: Polygon, transform: Affine) -> Polygon:
    t = transform
    return affine_transform(poly, [t.a, t.b, t.d, t.e, t.xoff, t.yoff])


def _near_road(poly_px: Polygon, transform: Affine) -> tuple[bool, float]:
    """Whether the region (world coords) is within ``_ROAD_DIST_M`` of a passage."""
    passages = _load_passages()
    if passages is None:
        return False, float("inf")
    world = _pixel_to_world(poly_px, transform)
    dist = world.distance(passages)
    return dist <= _ROAD_DIST_M, float(dist)


# ------------------------------------------------------------- parcels ----
def _parcel_union(name: str) -> Polygon | MultiPolygon | None:
    """Union of existing ``vineyard`` annotations for a tile (SAM-3 parcels)."""
    polys: list[Polygon] = []
    for ann in db.list_annotations(name):
        if ann.get("label") != _VINEYARD:
            continue
        pts = ann.get("points") or []
        if ann.get("shape_type") == "polygon" and len(pts) >= 3:
            try:
                poly = Polygon([(float(x), float(y)) for x, y in pts])
                if poly.is_valid and not poly.is_empty:
                    polys.append(poly)
            except Exception:  # noqa: BLE001 - skip malformed stored geometry
                continue
    if not polys:
        return None
    union = unary_union(polys)
    if union.is_empty:
        return None
    return union.buffer(_PARCEL_BUFFER_PX)


# --------------------------------------------------------------- public ----
def segment(
    name: str, path: list[list[float]], hint: str = "auto"
) -> dict[str, Any]:
    """Grow, polygonise and classify the object under a scribble.

    Returns a shape dict ``{shape_type, points, label, confidence, reason}`` or
    ``{"found": False}`` when nothing segmentable sits under the scribble.
    """
    if not path:
        return {"found": False}

    masks = _load_masks(name)
    veg: np.ndarray = masks["veg"]
    valid: np.ndarray = masks["valid"]
    transform: Affine = masks["transform"]
    height, width = veg.shape

    seed = _rasterize_path(path, width, height)
    seed_valid = seed & valid
    if not seed_valid.any():
        return {"found": False}

    veg_fraction = float(veg[seed_valid].mean())
    on_vegetation = veg_fraction > _VEG_SEED_FRACTION

    if on_vegetation:
        target = veg
    else:
        target = valid & ~veg

    # Constrain the target to a window around the scribble so region-growing
    # cannot flood the whole tile's soil/road blob. The connected piece touching
    # the seeds is then computed WITHIN this window, keeping the result local to
    # where the user drew (fixes the "label spawns in the middle" bug). Small
    # canopy components already fit inside the window, so veg is unaffected.
    r0, r1, c0, c1 = _clip_window(path, width, height)
    window = np.zeros_like(target)
    window[r0:r1, c0:c1] = True
    target = target & window

    grown = _grow_region(target, seed)
    if not grown.any():
        return {"found": False}

    poly = _largest_polygon(grown)
    if poly is None or poly.is_empty or poly.area < 1.0:
        return {"found": False}

    poly = _simplify_capped(poly)

    # ------------------------------------------------ classification ----
    result = _classify(
        poly=poly,
        on_vegetation=on_vegetation,
        veg_fraction=veg_fraction,
        transform=transform,
        hint=hint,
    )

    # --------------------------------------------- parcel restriction ----
    result = _apply_parcels(name, poly, result)
    return result


def _classify(
    poly: Polygon,
    on_vegetation: bool,
    veg_fraction: float,
    transform: Affine,
    hint: str,
) -> dict[str, Any]:
    """Assign a label + shape + confidence + reason to a grown region."""
    stats = _obb_stats(poly)
    aspect = stats["aspect"]
    fill = stats["fill"]
    short_px = stats["short_px"]
    pixel_size_m = abs(transform.a) if transform.a else 0.025
    short_m = short_px * pixel_size_m

    # Explicit UI-forced class (except "auto").
    forced = hint if hint in {"canopy", "waste", "road"} else None

    if forced == "canopy" or (forced is None and on_vegetation):
        conf = 0.55 + 0.4 * min(1.0, max(0.0, (veg_fraction - 0.5) / 0.5))
        return {
            "shape_type": "polygon",
            "points": _ring_points(poly),
            "label": _VINEYARD,
            "confidence": round(float(conf), 3),
            "reason": f"vegetation region (veg fraction {veg_fraction:.2f})",
        }

    # Non-vegetation region -> waste / road / inter-row.
    near_road, road_dist = _near_road(poly, transform)
    elongated = aspect >= _ROW_ASPECT and fill >= _ROW_FILL

    if forced == "road" or elongated or near_road:
        aspect_margin = min(1.0, (aspect - _ROW_ASPECT) / _ROW_ASPECT) if math.isfinite(aspect) else 1.0
        base = 0.5 + 0.3 * max(0.0, aspect_margin)
        if near_road:
            base = min(0.95, base + 0.2)
        # A thin near-linear strip -> row polyline (centreline); else inter-row.
        if short_m <= _ROW_MAX_WIDTH_M and stats["centerline"] is not None:
            reason = "thin straight non-veg strip"
            if near_road:
                reason += f" near passage ({road_dist:.1f} m)"
            return {
                "shape_type": "polyline",
                "points": stats["centerline"],
                "label": _ROW,
                "confidence": round(float(min(0.95, base)), 3),
                "reason": reason,
            }
        reason = f"elongated non-veg region (aspect {aspect:.1f})"
        if near_road:
            reason += f" near passage ({road_dist:.1f} m)"
        return {
            "shape_type": "polygon",
            "points": _ring_points(poly),
            "label": _INTERROW,
            "confidence": round(float(min(0.9, base)), 3),
            "reason": reason,
        }

    # Compact non-veg blob, not elongated, not near a road -> waste.
    conf = 0.45 + 0.25 * min(1.0, fill)
    return {
        "shape_type": "polygon",
        "points": _ring_points(poly),
        "label": _WASTE,
        "confidence": round(float(conf), 3),
        "reason": f"compact non-veg blob (aspect {aspect:.1f}, fill {fill:.2f})",
    }


def _apply_parcels(
    name: str, poly: Polygon, result: dict[str, Any]
) -> dict[str, Any]:
    """Clip/keep the result to the SAM-3 vineyard parcels for the tile.

    If there are no parcel annotations, the restriction is skipped. If the
    region lies entirely outside the parcels it is still returned, but with a
    lower confidence and a ``reason`` note (the user can decide).
    """
    if "points" not in result:
        return result
    parcels = _parcel_union(name)
    if parcels is None:
        return result

    # Flood-filled regions can be topologically invalid (self-touching holes);
    # repair both operands with a zero-width buffer before any set operation.
    if not poly.is_valid:
        poly = poly.buffer(0)
    if not parcels.is_valid:
        parcels = parcels.buffer(0)

    try:
        intersects = poly.intersects(parcels)
    except Exception as exc:  # noqa: BLE001 - GEOS topology edge case; degrade
        logger.warning("parcel intersects() failed for %s: %s", name, exc)
        return result

    if not intersects:
        result["confidence"] = round(result["confidence"] * 0.5, 3)
        result["reason"] = f"{result['reason']}; outside parcels"
        return result

    # Polyline (row centreline): keep as-is if it touches a parcel.
    if result["shape_type"] == "polyline":
        return result

    try:
        clipped = poly.intersection(parcels)
    except Exception as exc:  # noqa: BLE001 - GEOS topology edge case; degrade
        logger.warning("parcel intersection() failed for %s: %s", name, exc)
        return result
    if clipped.is_empty:
        return result
    if clipped.geom_type == "MultiPolygon":
        clipped = max(clipped.geoms, key=lambda g: g.area)
    if clipped.geom_type != "Polygon" or clipped.area < 1.0:
        return result
    clipped = _simplify_capped(clipped)
    result["points"] = _ring_points(clipped)
    return result

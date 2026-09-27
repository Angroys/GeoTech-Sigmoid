"""Turn merged canopy/waste segments into the survey layers the web app reads.

Pipeline per block (cluster of canopy):
1. sample canopy on a 0.25 m grid;
2. find the row direction that makes the across-row projection most peaked;
3. peaks of the across-row histogram are rows; each row's along extent gives
   its centerline, and along-row holes of 1.5-10 m become ``row_gap``
   inspection points;
4. interrows are the strips between adjacent row centerlines, extended to the
   block's headlands so that neighbouring aisles connect for the route planner.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Any

import numpy as np
import shapely
from shapely.geometry import LineString, Point, Polygon, mapping, shape
from shapely.geometry.base import BaseGeometry
from shapely.ops import nearest_points, unary_union

CANOPY_CLASSES = {"canopy", "vineyard"}
CRS_MEMBER = {"type": "name", "properties": {"name": "urn:ogc:def:crs:EPSG::32635"}}
RESULT_FILES = ("blocks", "rows", "canopy", "interrows", "waste", "inspection_points", "start")

GRID_M = 0.25
CLUSTER_BUFFER_M = 1.5
BLOCK_MARGIN_M = 3.0
HEADLAND_M = 2.0
MIN_BLOCK_CANOPY_M2 = 15.0
MIN_ROW_SPACING_M = 1.2
MIN_ROW_LENGTH_M = 2.0
GAP_MIN_M = 1.5
GAP_MAX_M = 10.0
MAX_TARGETS = 200
MAX_INSPECTION_POINTS = 60
PRECISION_M = 0.01
CANOPY_CLOSE_M = 0.06
VISIT_RADIUS_M = 2.0


class ProcessingError(ValueError):
    """The segments cannot be turned into a survey."""


@dataclass
class Row:
    row_id: str
    offset: float
    a0: float
    a1: float
    structure: str
    gaps: list[tuple[float, float]] = field(default_factory=list)  # (along midpoint, length)


@dataclass
class Frame:
    ox: float
    oy: float
    theta: float

    def to_local(self, x: np.ndarray, y: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        c, s = math.cos(self.theta), math.sin(self.theta)
        dx, dy = x - self.ox, y - self.oy
        return dx * c + dy * s, -dx * s + dy * c

    def to_world(self, along: float, offset: float) -> tuple[float, float]:
        c, s = math.cos(self.theta), math.sin(self.theta)
        return self.ox + along * c - offset * s, self.oy + along * s + offset * c


def _polygons(geoms: list[BaseGeometry], min_area: float) -> list[Polygon]:
    result: list[Polygon] = []
    for geom in geoms:
        if geom is None or geom.is_empty:
            continue
        if not geom.is_valid:
            geom = shapely.make_valid(geom)
        parts = [geom] if geom.geom_type == "Polygon" else list(getattr(geom, "geoms", []))
        result.extend(p for p in parts if p.geom_type == "Polygon" and p.area >= min_area)
    return result


def _clean(geom: BaseGeometry, kind: str) -> BaseGeometry | None:
    """Snap to 1 cm and keep one valid geometry of the requested kind."""
    geom = shapely.set_precision(geom, PRECISION_M)
    if geom.is_empty:
        return None
    if kind == "Polygon" and geom.geom_type != "Polygon":
        parts = _polygons([geom], 0)
        if not parts:
            return None
        geom = max(parts, key=lambda p: p.area)
    if geom.geom_type != kind or not geom.is_valid or geom.is_empty:
        return None
    return geom


def _feature(geom: BaseGeometry, properties: dict[str, Any]) -> dict[str, Any]:
    return {"type": "Feature", "geometry": mapping(geom), "properties": properties}


def _grid_samples(area: BaseGeometry) -> tuple[np.ndarray, np.ndarray, float]:
    minx, miny, maxx, maxy = area.bounds
    step = max(GRID_M, math.sqrt((maxx - minx) * (maxy - miny) / 4e6))
    xs = np.arange(minx + step / 2, maxx, step)
    ys = np.arange(miny + step / 2, maxy, step)
    gx, gy = np.meshgrid(xs, ys)
    gx, gy = gx.ravel(), gy.ravel()
    shapely.prepare(area)
    inside = shapely.contains_xy(area, gx, gy)
    return gx[inside], gy[inside], step


def _row_direction(x: np.ndarray, y: np.ndarray) -> float:
    rng = np.random.default_rng(0)
    if len(x) > 40000:
        pick = rng.choice(len(x), 40000, replace=False)
        x, y = x[pick], y[pick]
    x, y = x - x.mean(), y - y.mean()
    n = len(x)

    def score(theta: float) -> float:
        off = -x * math.sin(theta) + y * math.cos(theta)
        lo, hi = np.percentile(off, [2, 98])
        span = max((hi - lo) / 0.2, 1.0)
        counts = np.bincount(((off - off.min()) / 0.2).astype(np.int64))
        # Concentration relative to a uniform spread over the same span.
        return float((counts.astype(np.float64) ** 2).sum() / (n * n) * span)

    coarse = max(np.radians(np.arange(0, 180, 1.0)), key=score)
    fine = np.radians(np.arange(-1.0, 1.01, 0.1)) + coarse
    return float(max(fine, key=score))


def _peaks(off: np.ndarray) -> list[float]:
    bin_m = 0.1
    lo = off.min() - 1.0
    counts = np.bincount(((off - lo) / bin_m).astype(np.int64)).astype(np.float64)
    sigma = 0.25 / bin_m
    kernel_x = np.arange(-int(3 * sigma), int(3 * sigma) + 1)
    kernel = np.exp(-0.5 * (kernel_x / sigma) ** 2)
    smooth = np.convolve(counts, kernel / kernel.sum(), mode="same")
    positive = smooth[smooth > 0]
    if positive.size == 0:
        return []
    threshold = 0.15 * float(np.percentile(positive, 95))
    candidates = [
        i for i in range(1, len(smooth) - 1)
        if smooth[i] >= smooth[i - 1] and smooth[i] > smooth[i + 1] and smooth[i] >= threshold
    ]
    chosen: list[int] = []
    for i in sorted(candidates, key=lambda k: -smooth[k]):
        if all(abs(i - j) * bin_m >= MIN_ROW_SPACING_M for j in chosen):
            chosen.append(i)
    return sorted(lo + (i + 0.5) * bin_m for i in chosen)


@dataclass
class Block:
    vineyard_id: str
    polygon: Polygon
    frame: Frame
    rows: list[Row]
    canopy: list[tuple[Polygon, str]]
    interrows: list[tuple[Polygon, tuple[str, str]]]


def _analyse_block(vid: str, canopy: list[Polygon]) -> Block | None:
    union = unary_union(canopy)
    x, y, step = _grid_samples(union)
    if len(x) < 20:
        return None
    theta = _row_direction(x, y)
    frame = Frame(float(x.mean()), float(y.mean()), theta)
    along, off = frame.to_local(x, y)
    peaks = _peaks(off)
    if not peaks:
        return None
    spacing = float(np.median(np.diff(peaks))) if len(peaks) > 1 else 2.5
    reach = min(0.9, 0.45 * spacing)
    peak_arr = np.asarray(peaks)
    nearest = np.abs(off[:, None] - peak_arr[None, :]).argmin(axis=1)
    rows: list[Row] = []
    for k in range(len(peaks)):
        member = (nearest == k) & (np.abs(off - peak_arr[k]) <= reach)
        if member.sum() * step * step < 0.5:
            continue
        a = np.unique(np.round(along[member] / step).astype(np.int64)) * step
        a0, a1 = float(a.min()), float(a.max())
        if a1 - a0 < MIN_ROW_LENGTH_M:
            continue
        holes = np.diff(a) - step
        gaps = [(float(a[i] + step / 2 + holes[i] / 2), float(holes[i]))
                for i in np.nonzero((holes >= GAP_MIN_M) & (holes <= GAP_MAX_M))[0]]
        missing = float(holes[holes >= 1.0].sum())
        structure = "regular" if missing / (a1 - a0) < 0.1 else "disrupted"
        rows.append(Row("", float(np.median(off[member])), a0, a1, structure, gaps))
    if not rows:
        return None
    for index, row in enumerate(rows, start=1):
        row.row_id = f"{vid}-R{index:03d}"
    hull = union.convex_hull.buffer(BLOCK_MARGIN_M, join_style="mitre")
    block_polygon = _clean(hull, "Polygon")
    if block_polygon is None:
        return None
    # Canopy -> nearest row (by centroid offset).
    offsets = np.asarray([r.offset for r in rows])
    cx = np.asarray([p.centroid.x for p in canopy])
    cy = np.asarray([p.centroid.y for p in canopy])
    _, coff = frame.to_local(cx, cy)
    distance = np.abs(coff[:, None] - offsets[None, :])
    owner = distance.argmin(axis=1)
    assigned = [(p, rows[int(o)].row_id) for p, o, d in zip(canopy, owner, distance.min(axis=1)) if d <= reach + 0.5]
    # Interrows between adjacent row centerlines, spanning the block headlands.
    a_lo = min(r.a0 for r in rows) - HEADLAND_M
    a_hi = max(r.a1 for r in rows) + HEADLAND_M
    row_spacing = np.diff(offsets)
    typical = float(np.median(row_spacing)) if len(row_spacing) else spacing
    interrows: list[tuple[Polygon, tuple[str, str]]] = []
    for left, right in zip(rows, rows[1:]):
        if right.offset - left.offset > 2.6 * typical:
            continue
        corners = [frame.to_world(a, o) for a, o in (
            (a_lo, left.offset), (a_hi, left.offset), (a_hi, right.offset), (a_lo, right.offset))]
        strip = _clean(Polygon(corners).intersection(block_polygon), "Polygon")
        if strip is not None and strip.area > 0.5:
            interrows.append((strip, (left.row_id, right.row_id)))
    return Block(vid, block_polygon, frame, rows, assigned, interrows)


def build_results(segments: list[dict[str, Any]]) -> dict[str, list[dict[str, Any]]]:
    """Map segmenter features (class canopy|waste, EPSG:32635) to result features per file."""
    canopy_raw: list[BaseGeometry] = []
    waste_raw: list[BaseGeometry] = []
    for feature in segments:
        cls = (feature.get("properties") or {}).get("class")
        try:
            geom = shape(feature["geometry"])
        except (KeyError, TypeError, ValueError, AttributeError):
            continue
        if cls in CANOPY_CLASSES:
            canopy_raw.append(geom)
        elif cls == "waste":
            waste_raw.append(geom)
    # Dissolve overlapping segments (tile seams, duplicate masks) and close
    # gaps under CANOPY_CLOSE_M*2 so the route planner never has to thread
    # centimetre-wide pinches between near-touching outlines.
    snapped = shapely.set_precision(np.asarray(_polygons(canopy_raw, 0), dtype=object), PRECISION_M)
    dissolved = (
        unary_union(shapely.buffer(snapped, CANOPY_CLOSE_M, join_style="mitre"))
        .buffer(-CANOPY_CLOSE_M, join_style="mitre")
        .simplify(0.02)
        if len(snapped) else Polygon()
    )
    canopy = _polygons([dissolved], 0.02)
    if not canopy:
        raise ProcessingError("No vine canopy was detected in the uploaded tiles.")

    clusters = _polygons([unary_union(shapely.buffer(np.asarray(canopy, dtype=object), CLUSTER_BUFFER_M))], 0)
    tree = shapely.STRtree(canopy)
    groups = []
    for cluster in clusters:
        members = [canopy[int(i)] for i in tree.query(cluster, predicate="intersects")]
        if sum(p.area for p in members) >= MIN_BLOCK_CANOPY_M2:
            groups.append((cluster.centroid.x, members))
    groups.sort(key=lambda item: item[0])
    blocks: list[Block] = []
    for members_x, members in groups:
        block = _analyse_block(f"V{len(blocks) + 1}", members)
        if block is not None:
            blocks.append(block)
    if not blocks:
        raise ProcessingError("Canopy was detected but no vine rows could be recognised in it.")

    canopy_union = unary_union([p for b in blocks for p, _ in b.canopy])
    walkable = unary_union([s for b in blocks for s, _ in b.interrows]).difference(canopy_union)

    def reachable(point: Point) -> bool:
        return not walkable.is_empty and point.distance(walkable) <= VISIT_RADIUS_M

    out: dict[str, list[dict[str, Any]]] = {name: [] for name in RESULT_FILES}
    for block in blocks:
        out["blocks"].append(_feature(block.polygon, {"vineyard_id": block.vineyard_id}))
        for row in block.rows:
            line = _clean(LineString([block.frame.to_world(row.a0, row.offset),
                                      block.frame.to_world(row.a1, row.offset)]), "LineString")
            if line is not None:
                out["rows"].append(_feature(line, {
                    "label": "row", "vineyard_id": block.vineyard_id, "row_id": row.row_id,
                    "row_structure": row.structure, "length_m": round(line.length, 2),
                }))
        for polygon, row_id in block.canopy:
            clean = _clean(polygon, "Polygon")
            if clean is not None:
                out["canopy"].append(_feature(clean, {
                    "label": "vineyard", "vineyard_id": block.vineyard_id, "row_id": row_id,
                    "area_m2": round(clean.area, 2),
                }))
        for index, (strip, (left, right)) in enumerate(block.interrows, start=1):
            out["interrows"].append(_feature(strip, {
                "label": "interrow_area", "vineyard_id": block.vineyard_id,
                "interrow_id": f"{block.vineyard_id}-I{index:03d}", "row_ids": [left, right],
                "interrow_cover": "unassessable", "area_m2": round(strip.area, 2),
            }))

    waste = [w for w in (_clean(g, "Polygon") for g in _polygons(waste_raw, 0.01)) if w is not None]
    waste = waste[:MAX_TARGETS // 2]
    for index, polygon in enumerate(waste, start=1):
        centre = polygon.centroid
        owner = next((b.vineyard_id for b in blocks if b.polygon.covers(centre)), None)
        out["waste"].append(_feature(polygon, {
            "label": "waste", "waste_id": f"W-{index:03d}", "vineyard_id": owner, "reachable": reachable(centre),
        }))

    gaps = [(length, block, row, along) for block in blocks for row in block.rows for along, length in row.gaps]
    budget = max(0, min(MAX_INSPECTION_POINTS, MAX_TARGETS - len(waste)))
    gaps = sorted(gaps, key=lambda g: -g[0])[:budget]
    order = {id(b): i for i, b in enumerate(blocks)}
    gaps.sort(key=lambda g: (order[id(g[1])], g[2].row_id, g[3]))
    for index, (_, block, row, along) in enumerate(gaps, start=1):
        point = _clean(Point(block.frame.to_world(along, row.offset)), "Point")
        if point is not None:
            out["inspection_points"].append(_feature(point, {
                "point_id": f"IP-{index:03d}", "vineyard_id": block.vineyard_id, "row_id": row.row_id,
                "reason": "row_gap", "reachable": reachable(point),
            }))

    start = _start_point(blocks, walkable, out)
    out["start"].append(_feature(start, {}))
    return out


def _start_point(blocks: list[Block], walkable: BaseGeometry, out: dict[str, list[dict[str, Any]]]) -> Point:
    """A point inside the walkable aisles near the south corner of the busiest block."""
    if walkable.is_empty:
        raise ProcessingError("No walkable inter-row area could be derived; at least two parallel rows are needed.")
    targets = {b.vineyard_id: 0 for b in blocks}
    for name in ("waste", "inspection_points"):
        for feature in out[name]:
            vid = feature["properties"]["vineyard_id"]
            if vid in targets:
                targets[vid] += 1
    candidates = [b for b in blocks if b.interrows]
    if not candidates:
        raise ProcessingError("No walkable inter-row area could be derived; at least two parallel rows are needed.")
    block = max(candidates, key=lambda b: (targets[b.vineyard_id], b.polygon.area))
    area = unary_union([s for s, _ in block.interrows]).intersection(walkable)
    # Start in the largest connected walking area: slivers cut off by canopy
    # would leave every target unreachable.
    parts = _polygons([area], 0)
    if not parts:
        raise ProcessingError("No walkable inter-row area could be derived; at least two parallel rows are needed.")
    main = max(parts, key=lambda p: p.area)
    corner = min(block.polygon.exterior.coords, key=lambda c: (c[1], c[0]))
    for inset in (0.4, 0.2, 0.05):
        inner = main.buffer(-inset)
        if inner.is_empty:
            continue
        candidate = nearest_points(Point(corner), inner)[1]
        point = Point(round(candidate.x, 2), round(candidate.y, 2))
        if main.covers(point):
            return point
    return main.representative_point()


def feature_collection(features: list[dict[str, Any]], source: str) -> dict[str, Any]:
    return {"type": "FeatureCollection", "crs": CRS_MEMBER, "source": source, "features": features}

"""Build the root submission files route.geojson and measurements.csv.

Reads the per-tile annotations (``<tile>__labels.geojson``, EPSG:32635, the same
labels packaged for Marcaj) and the organizer route assets, then:

* merges objects across tile edges by ``vineyard_id`` / ``row_id``;
* writes ``measurements.csv`` (block/row counts, row lengths, canopy and
  inter-row areas in m² and ha, per vineyard_id / row_id and in total);
* derives inspection targets (visible row gaps) plus waste targets and plans
  one closed walking route from the supplied start with ``route_algo``.

Usage (from the repository root)::

    uv run --project route-algo python scripts/make_submission.py \
        --labels data/tested-on-vm/sam3_ft/run3c/labels \
        --route-assets data/marcaj-data/assets_for_participants/02_route
"""

from __future__ import annotations

import argparse
import csv
import json
import sys
import time
from collections import defaultdict
from pathlib import Path

from shapely.geometry import box, LineString, MultiLineString, Point, mapping, shape
from shapely.ops import linemerge, unary_union

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "route-algo"))

from route_algo.geometry import PlanningError  # noqa: E402
from route_algo.models import FeatureCollection, PlanRequest  # noqa: E402
from route_algo import geometry as ra_geometry  # noqa: E402
from route_algo import planner as ra_planner  # noqa: E402
from route_algo.planner import plan_route  # noqa: E402


def _tolerant_length(line, operation):
    """Planner check, ignoring sub-millimetre floating-point slivers per segment."""
    total = 0.0
    for a, b in zip(line.coords, list(line.coords)[1:]):
        piece = operation(LineString([a, b])).length
        if piece > 1e-3:
            total += piece
    return total


ra_planner.traversed_length = _tolerant_length
_Network = ra_geometry.WalkingNetwork


class _BigNetwork(_Network):
    """Same network; the full 311-tile study area needs more than 100k triangles."""

    def __init__(self, walkable):
        from shapely import constrained_delaunay_triangles
        import route_algo.geometry as g
        tris = constrained_delaunay_triangles(walkable)
        orig = g.constrained_delaunay_triangles
        g.constrained_delaunay_triangles = lambda _w: tris
        count = len(tris.geoms)
        print(f"walking network: {count} triangles")
        try:
            if count > 100000:
                big = list(tris.geoms)
                self._init_big(walkable, big)
            else:
                super().__init__(walkable)
        finally:
            g.constrained_delaunay_triangles = orig

    def _init_big(self, walkable, triangles):
        import networkx as nx
        from shapely import STRtree
        self.walkable = walkable
        self.triangles = triangles
        self.graph = nx.Graph()
        self.positions, self.triangle_nodes, shared = {}, {}, {}
        for i, t in enumerate(triangles):
            self.add_node(i, tuple(t.centroid.coords[0]))
            self.triangle_nodes[i] = [i]
            c = list(t.exterior.coords)
            for a, b in zip(c, c[1:]):
                shared.setdefault(tuple(sorted((a, b))), []).append(i)
        for (a, b), nb in shared.items():
            if len(nb) == 2:
                portal = len(self.positions)
                self.add_node(portal, ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2))
                for i in nb:
                    self.connect(i, portal)
                    self.triangle_nodes[i].append(portal)
        self.tree = STRtree(triangles)


ra_planner.WalkingNetwork = _BigNetwork

CRS = {"type": "name", "properties": {"name": "urn:ogc:def:crs:EPSG::32635"}}
MAX_TARGETS = 200
GAP_MIN_M = 1.5


def fc(features):
    return {"type": "FeatureCollection", "crs": CRS, "features": list(features)}


def feature(geom, **props):
    return {"type": "Feature", "geometry": mapping(geom), "properties": props}


def polygons(geom):
    if geom.is_empty:
        return []
    if geom.geom_type == "Polygon":
        return [geom]
    return [g for g in getattr(geom, "geoms", []) if g.geom_type == "Polygon"]


def load_labels(directory: Path):
    canopy, interrow, waste = defaultdict(list), defaultdict(list), []
    rows = defaultdict(list)
    row_structure = defaultdict(list)
    for path in sorted(directory.glob("*__labels.geojson")):
        for f in json.loads(path.read_text()).get("features", []):
            props = f.get("properties") or {}
            label = props.get("label")
            try:
                geom = shape(f["geometry"])
            except Exception:
                continue
            if geom.is_empty:
                continue
            if not geom.is_valid:
                geom = geom.buffer(0)
            vid = props.get("vineyard_id") or ""
            if label == "vineyard":
                canopy[vid].append(geom)
            elif label == "interrow_area":
                interrow[vid].append(geom)
            elif label == "waste":
                waste.append((vid, geom))
            elif label == "row" and props.get("row_id"):
                rows[(vid, props["row_id"])].append(geom)
                row_structure[(vid, props["row_id"])].append(props.get("row_structure") or "unassessable")
    return canopy, interrow, waste, rows, row_structure


def merged_line(parts):
    """Deduplicate a row's per-tile pieces (overlaps at tile edges count once)."""
    lines = []
    for g in parts:
        lines.extend([g] if g.geom_type == "LineString" else list(getattr(g, "geoms", [])))
    merged = unary_union(lines)
    if merged.geom_type == "MultiLineString":
        merged = linemerge(merged)
    return merged


def row_gaps(row_geom, canopy_union):
    """Midpoints of visible planting gaps along one row axis."""
    points = []
    lines = [row_geom] if row_geom.geom_type == "LineString" else list(row_geom.geoms)
    for line in lines:
        if line.length < 2 * GAP_MIN_M:
            continue
        covered = line.intersection(canopy_union)
        # Intervals along the line covered by canopy.
        spans = []
        for seg in ([covered] if covered.geom_type == "LineString" else list(getattr(covered, "geoms", []))):
            if seg.geom_type != "LineString" or seg.length == 0:
                continue
            a, b = line.project(Point(seg.coords[0])), line.project(Point(seg.coords[-1]))
            spans.append((min(a, b), max(a, b)))
        spans.sort()
        if not spans:
            continue
        # Gaps strictly inside the planted extent (row ends are not gaps).
        end = spans[0][1]
        for a, b in spans[1:]:
            if a - end >= GAP_MIN_M:
                points.append((a - end, line.interpolate((a + end) / 2)))
            end = max(end, b)
    return points


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--labels", type=Path, default=ROOT / "data/tested-on-vm/sam3_ft/run3c/labels")
    ap.add_argument("--route-assets", type=Path, default=ROOT / "data/marcaj-data/assets_for_participants/02_route")
    ap.add_argument("--waste-labels", type=Path, default=None,
                    help="per-tile labels to take waste boxes from (default: --labels)")
    ap.add_argument("--out-dir", type=Path, default=ROOT)
    ap.add_argument("--solver-seconds", type=int, default=10)
    ap.add_argument("--clearance", type=float, default=0.05)
    args = ap.parse_args()
    t0 = time.perf_counter()

    canopy, interrow, waste, rows, row_structure = load_labels(args.labels)
    if args.waste_labels:
        waste = load_labels(args.waste_labels)[2]
    # Waste is annotated as boxes: use each object's axis-aligned bounding box.
    waste = [(vid, box(*g.bounds)) for vid, g in waste]
    canopy_by_block = {vid: unary_union(gs) for vid, gs in canopy.items() if vid}
    interrow_by_block = {
        vid: unary_union(gs).difference(canopy_by_block.get(vid, Point().buffer(0)))
        for vid, gs in interrow.items() if vid
    }
    row_geoms = {key: merged_line(parts) for key, parts in rows.items()}
    blocks = sorted({vid for vid in list(canopy_by_block) + [k[0] for k in row_geoms] if vid})

    # ---- measurements.csv -------------------------------------------------
    header = ["level", "vineyard_id", "row_id", "row_structure", "row_count", "row_length_m",
              "canopy_area_m2", "canopy_area_ha", "interrow_area_m2", "interrow_area_ha", "block_count"]
    out_rows = []
    total_len = 0.0
    for vid in blocks:
        block_rows = sorted(k for k in row_geoms if k[0] == vid)
        blen = sum(row_geoms[k].length for k in block_rows)
        total_len += blen
        ca = canopy_by_block.get(vid).area if vid in canopy_by_block else 0.0
        ia = interrow_by_block.get(vid).area if vid in interrow_by_block else 0.0
        out_rows.append(["block", vid, "", "", len(block_rows), round(blen, 2), round(ca, 2), round(ca / 1e4, 4),
                         round(ia, 2), round(ia / 1e4, 4), 1])
        for key in block_rows:
            structures = row_structure[key]
            structure = "disrupted" if "disrupted" in structures else max(set(structures), key=structures.count)
            out_rows.append(["row", vid, key[1], structure, 1, round(row_geoms[key].length, 2), "", "", "", "", ""])
    canopy_total = unary_union(list(canopy_by_block.values()) + canopy.get("", [])).area
    interrow_total = unary_union(list(interrow_by_block.values())).area
    out_rows.insert(0, ["total", "", "", "", len(row_geoms), round(total_len, 2), round(canopy_total, 2),
                        round(canopy_total / 1e4, 4), round(interrow_total, 2), round(interrow_total / 1e4, 4),
                        len(blocks)])
    with open(args.out_dir / "measurements.csv", "w", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(header)
        w.writerows(out_rows)
    print(f"measurements.csv: {len(blocks)} blocks, {len(row_geoms)} rows, row length {total_len:.0f} m, "
          f"canopy {canopy_total:.0f} m², inter-row {interrow_total:.0f} m²")

    # ---- targets ------------------------------------------------------------
    all_canopy = unary_union(list(canopy_by_block.values()))
    gaps = []
    for (vid, rid), geom in row_geoms.items():
        for length, pt in row_gaps(geom, canopy_by_block.get(vid, all_canopy)):
            gaps.append((length, vid, rid, pt))
    waste_feats = [feature(g, waste_id=f"W{i:03d}", vineyard_id=vid) for i, (vid, g) in enumerate(waste, 1)]
    gaps.sort(key=lambda g: -g[0])
    budget = MAX_TARGETS - len(waste_feats)
    inspection = [feature(pt, point_id=f"I{i:03d}", vineyard_id=vid, row_id=rid, reason="row_gap",
                          gap_length_m=round(length, 2))
                  for i, (length, vid, rid, pt) in enumerate(gaps[:budget], 1)]
    print(f"targets: {len(waste_feats)} waste + {len(inspection)} inspection (of {len(gaps)} gaps)")

    # ---- route ---------------------------------------------------------------
    assets = {k: json.loads((args.route_assets / f"{k}.geojson").read_text())
              for k in ("start", "passages", "forbidden", "study_area")}
    start = tuple(assets["start"]["features"][0]["geometry"]["coordinates"][:2])
    interrow_feats = [feature(p.simplify(0.05), vineyard_id=vid) for vid, g in interrow_by_block.items()
                      for p in polygons(g) if p.area > 0.5 and p.simplify(0.05).is_valid]
    canopy_feats = [feature(p.simplify(0.03)) for p in polygons(all_canopy) if p.simplify(0.03).is_valid]
    request = PlanRequest.model_construct(
        crs="EPSG:32635", purpose="inspection", constraint_set=None, path_mode="supplied", start=start,
        interrows=FeatureCollection(features=interrow_feats, crs=CRS),
        blocks=FeatureCollection(), rows=FeatureCollection(),
        canopy=FeatureCollection.model_construct(type="FeatureCollection", features=canopy_feats, crs=CRS),
        inspection_points=FeatureCollection(features=inspection, crs=CRS),
        waste=FeatureCollection(features=waste_feats, crs=CRS),
        passages=FeatureCollection(**assets["passages"]), forbidden=FeatureCollection(**assets["forbidden"]),
        barriers=FeatureCollection(), study_area=FeatureCollection(**assets["study_area"]),
        clearance_m=args.clearance, solver_seconds=args.solver_seconds,
    )
    try:
        result = plan_route(request)
    except PlanningError as exc:
        print(f"route planning failed: {exc}", file=sys.stderr)
        return 1
    route = result["route"]
    report = {k: v for k, v in result["report"].items() if k != "targets"}
    print(json.dumps(report, default=str))
    if route is None:
        print("no reachable targets: route not written", file=sys.stderr)
        return 1
    line_feature = next(f for f in route["features"] if f["geometry"]["type"] == "LineString")
    line = shape(line_feature["geometry"])
    coords = list(line.coords)
    if Point(coords[0]).distance(Point(start)) > 1e-6:
        coords.insert(0, start)
    if Point(coords[-1]).distance(Point(start)) > 1e-6:
        coords.append(start)
    line = LineString(coords)
    props = {k: v for k, v in (line_feature.get("properties") or {}).items() if not isinstance(v, (list, dict))}
    props.update(coverage_ratio=report["coverage_ratio"], outside_length_m=report["outside_length_m"])
    props.update(length_m=round(line.length, 2), start=list(start), crs="EPSG:32635",
                 targets_total=len(waste_feats) + len(inspection))
    out = fc([{"type": "Feature", "geometry": mapping(line), "properties": props}])
    (args.out_dir / "route.geojson").write_text(json.dumps(out))
    (args.out_dir / "route_targets.geojson").write_text(json.dumps(fc(inspection + waste_feats)))
    print(f"route.geojson: {line.length:.0f} m, closed={coords[0] == coords[-1]}, "
          f"{time.perf_counter() - t0:.0f} s total")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

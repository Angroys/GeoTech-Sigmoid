"""Per-tile model labels -> the challenge deliverable (CVAT 1.1 annotations.xml + GeoJSON).

Ported from the fine-tuning pipeline's finalize step (feat/finetune-sam, finetune_sam3/finalize_cvat.py).
Input: for every uploaded tile its TileInfo and its features in the team label schema
(``properties.label`` in vineyard / row / interrow_area / waste / dead_vine, EPSG:32635 geometry).

Rules applied (annotation rules + the team's golden rules):
  * IDs survive tile edges: rows of all tiles are grouped into blocks (parallel neighbouring rows,
    ``vineyard_id`` V01, V02, ...) and physical rows (same across-row offset, ``row_id`` V01-R03), so a
    row keeps its IDs in every tile it crosses.
  * one row = one straight polyline per tile from its first to its last vine, through gaps;
    ``row_structure`` = disrupted when the canopy along it has a gap >= 5 m inside the tile.
  * a tree crown over a row removes only that stretch (the row continues on the other side).
  * a plant (vineyard polygon) must stand on a row; dead_vine is never exported (rules: draw nothing).
  * every tile gets an <image>, even when empty. Labels are exactly vineyard (polygon), waste
    (rectangle), row (polyline), interrow_area (polygon), with the organiser's attributes.
"""
from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from typing import Any
from xml.etree import ElementTree as ET

import numpy as np
from shapely.geometry import LineString, box, mapping, shape
from shapely.geometry.base import BaseGeometry
from shapely.ops import unary_union
from shapely.strtree import STRtree

from .geotiff import TileInfo

BLOCK_ANGLE_DEG = 6.0     # rows of one block are parallel within this
BLOCK_LINK_M = 4.5        # ... and a neighbouring row is at most this far (about 1.5 x row spacing)
ROW_MERGE_M = 0.8         # segments whose offsets differ by less than this are the same physical row
DISRUPT_GAP_M = 5.0
VINE_ON_ROW_M = 0.6
TREE_BUFFER_M = 0.2
MIN_ROW_M = 1.0
EXPORT_LABELS = ("vineyard", "waste", "row", "interrow_area")
REQUIRED_LABELS = {"vineyard": "polygon", "waste": "rectangle", "row": "polyline", "interrow_area": "polygon"}
XML_TAG = {"polygon": "polygon", "rectangle": "box", "polyline": "polyline"}
CRS = {"type": "name", "properties": {"name": "urn:ogc:def:crs:EPSG::32635"}}

_ATTR = "<attribute><name>{}</name><mutable>False</mutable><input_type>{}</input_type><default_value>{}</default_value><values>{}</values></attribute>"
LABELS_XML = (
    "<labels>"
    "<label><name>vineyard</name><type>polygon</type><attributes>" + _ATTR.format("vineyard_id", "text", "", "") + "</attributes></label>"
    "<label><name>waste</name><type>rectangle</type><attributes>" + _ATTR.format("vineyard_id", "text", "", "") + "</attributes></label>"
    "<label><name>row</name><type>polyline</type><attributes>" + _ATTR.format("vineyard_id", "text", "", "")
    + _ATTR.format("row_id", "text", "", "") + _ATTR.format("row_structure", "select", "regular", "regular\ndisrupted\nunassessable")
    + "</attributes></label>"
    "<label><name>interrow_area</name><type>polygon</type><attributes>" + _ATTR.format("vineyard_id", "text", "", "")
    + _ATTR.format("interrow_cover", "select", "bare_soil", "bare_soil\nvegetation\nmixed\nunassessable") + "</attributes></label>"
    "</labels>"
)


@dataclass
class Tile:
    name: str                       # file name, e.g. siret3_r005_c004.tif
    info: TileInfo
    features: list[dict[str, Any]]  # GeoJSON features, label schema

    @property
    def bounds(self) -> BaseGeometry:
        i = self.info
        return box(i.origin_x, i.origin_y - i.height * i.pixel_size_m, i.origin_x + i.width * i.pixel_size_m, i.origin_y)

    def to_px(self, x: float, y: float) -> tuple[float, float]:
        i = self.info
        return (x - i.origin_x) / i.pixel_size_m, (i.origin_y - y) / i.pixel_size_m


def _unit(line: LineString) -> np.ndarray:
    c = np.array(line.coords)
    d = c[-1] - c[0]
    d = d / (np.linalg.norm(d) + 1e-9)
    return d if d[0] > 0 or (d[0] == 0 and d[1] > 0) else -d


def _group_blocks(segs: list[dict[str, Any]]) -> list[list[int]]:
    """Union-find over row segments: same block when parallel and a neighbour."""
    parent = list(range(len(segs)))

    def find(i: int) -> int:
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    geoms = [s["geom"] for s in segs]
    tree = STRtree(geoms)
    cos = np.cos(np.radians(BLOCK_ANGLE_DEG))
    for i, s in enumerate(segs):
        for j in tree.query(s["geom"].buffer(BLOCK_LINK_M)):
            if j <= i or abs(float(s["d"] @ segs[j]["d"])) < cos:
                continue
            if s["geom"].distance(geoms[j]) <= BLOCK_LINK_M:
                parent[find(i)] = find(int(j))
    comp: dict[int, list[int]] = defaultdict(list)
    for i in range(len(segs)):
        comp[find(i)].append(i)
    return list(comp.values())


def finalize(tiles: list[Tile], trees: list[BaseGeometry] | None = None) -> tuple[dict[str, list[dict[str, Any]]], dict[str, int]]:
    """-> ({tile name: final features with vineyard_id / row_id}, counts)."""
    crowns = [t.buffer(TREE_BUFFER_M) for t in (trees or [])]
    ctree = STRtree(crowns) if crowns else None
    feats = {t.name: [(f["properties"], shape(f["geometry"])) for f in t.features if f.get("geometry")] for t in tiles}

    segs = []
    for n, fs in feats.items():
        for p, g in fs:
            if p.get("label") == "row" and g.length > 0.5:
                segs.append({"tile": n, "geom": g, "d": _unit(g), "st": p.get("row_structure") or "regular"})
    blocks = [b for b in _group_blocks(segs) if sum(segs[i]["geom"].length for i in b) >= 5.0] if segs else []

    def order(b: list[int]) -> tuple[float, float]:     # north-west first
        c = np.array([segs[i]["geom"].centroid.coords[0] for i in b])
        return (-c[:, 1].max() // 50, c[:, 0].min())

    blocks.sort(key=order)
    rows_by_tile: dict[str, list[Any]] = defaultdict(list)
    block_rows = []
    for bi, b in enumerate(blocks, 1):
        vid = f"V{bi:02d}"
        L = np.array([segs[i]["geom"].length for i in b])
        ds = np.array([segs[i]["d"] for i in b])
        th = 0.5 * np.arctan2((L * np.sin(2 * np.arctan2(ds[:, 1], ds[:, 0]))).sum(),
                              (L * np.cos(2 * np.arctan2(ds[:, 1], ds[:, 0]))).sum())
        d = np.array([np.cos(th), np.sin(th)])
        nrm = np.array([-d[1], d[0]])
        offs = np.array([np.array(segs[i]["geom"].centroid.coords[0]) @ nrm for i in b])
        idx = np.argsort(offs)
        groups, cur = [], [idx[0]]
        for k in idx[1:]:
            if offs[k] - offs[cur[-1]] < ROW_MERGE_M:
                cur.append(k)
            else:
                groups.append(cur)
                cur = [k]
        groups.append(cur)
        for ri, gidx in enumerate(groups, 1):
            rid = f"{vid}-R{ri:02d}"
            o = float(np.average(offs[gidx], weights=L[gidx]))
            tt = np.concatenate([np.array(segs[b[k]]["geom"].coords) @ d for k in gidx])
            block_rows.append((vid, rid, d, nrm, o, tt.min() - 10.0, tt.max() + 10.0))
            for k in gidx:
                rows_by_tile[segs[b[k]]["tile"]].append((vid, rid, d, nrm, segs[b[k]]))
    br_lines = [LineString([tuple(nrm * o + d * t0), tuple(nrm * o + d * t1)]) for _, _, d, nrm, o, t0, t1 in block_rows]
    br_tree = STRtree(br_lines) if br_lines else None

    def nearest_ids(pt: BaseGeometry, maxd: float) -> tuple[str, str] | None:
        if br_tree is None:
            return None
        k = int(br_tree.nearest(pt))
        return block_rows[k][:2] if br_lines[k].distance(pt) <= maxd else None

    counts: dict[str, int] = defaultdict(int)
    counts["blocks"], counts["physical_rows"] = len(blocks), len(block_rows)
    out: dict[str, list[dict[str, Any]]] = {}
    for t in tiles:
        fs = feats[t.name]
        tb = t.bounds
        vines = [g for p, g in fs if p.get("label") == "vineyard"]
        vtree = STRtree(vines) if vines else None
        by_rid: dict[tuple, list] = defaultdict(list)
        for vid, rid, d, nrm, s in rows_by_tile.get(t.name, []):
            by_rid[(vid, rid, tuple(d), tuple(nrm))].append(s)
        rows = []
        for (vid, rid, d, nrm), ss in by_rid.items():       # one line per row per tile
            d, nrm = np.array(d), np.array(nrm)
            pts = np.concatenate([np.array(s["geom"].coords) for s in ss])
            tv, o = pts @ d, float(np.median(pts @ nrm))
            line0 = LineString([tuple(d * tv.min() + nrm * o), tuple(d * tv.max() + nrm * o)])
            near = [vines[k] for k in vtree.query(line0.buffer(VINE_ON_ROW_M + 40))] if vtree else []
            near = [g for g in near if abs(np.array(g.centroid.coords[0]) @ nrm - o) <= VINE_ON_ROW_M]
            iv = sorted((min(np.array(g.exterior.coords) @ d), max(np.array(g.exterior.coords) @ d)) for g in near)
            lo, hi = tv.min(), tv.max()
            if iv:
                lo, hi = min(lo, iv[0][0]), max(hi, max(x1 for _, x1 in iv))
            line = LineString([tuple(d * lo + nrm * o), tuple(d * hi + nrm * o)]).intersection(tb)
            if line.is_empty or line.length < MIN_ROW_M:
                continue
            if line.geom_type != "LineString":
                line = max(line.geoms, key=lambda q: q.length)
            tl = np.array(line.coords) @ d
            a0, a1 = tl.min(), tl.max()
            gap, cur = 0.0, a0
            for x0, x1 in iv:
                if x1 < a0 or x0 > a1:
                    continue
                gap = max(gap, x0 - cur)
                cur = max(cur, x1)
            gap = max(gap, a1 - cur)
            st = "disrupted" if gap >= DISRUPT_GAP_M or any(s["st"] == "disrupted" for s in ss) else "regular"
            pieces = [line]
            if ctree is not None:                             # a tree removes that stretch, not the row
                hit = [crowns[k] for k in ctree.query(line) if crowns[k].intersects(line)]
                if hit:
                    rest = line.difference(unary_union(hit))
                    pieces = [q for q in (rest.geoms if rest.geom_type == "MultiLineString" else [rest])
                              if q.geom_type == "LineString" and q.length >= MIN_ROW_M]
                    counts["rows_cut_by_trees"] += 1
            for q in pieces:
                rows.append({"label": "row", "vineyard_id": vid, "row_id": rid, "row_structure": st, "geometry": q})
                counts["row"] += 1
        res = list(rows)
        for p, g in fs:
            lab = p.get("label")
            if lab not in ("vineyard", "interrow_area", "waste"):
                continue                                      # rows rebuilt above; dead_vine not exported
            ids = nearest_ids(g.centroid, 1.5 if lab == "vineyard" else 4.0)
            if lab == "vineyard" and not ids:
                counts["vineyard_dropped_no_row"] += 1        # a plant stands on a vine row
                continue
            q = {"label": lab, "vineyard_id": ids[0] if ids else "", "geometry": g}
            if lab == "interrow_area":
                q["interrow_cover"] = p.get("interrow_cover") or "unassessable"
            res.append(q)
            counts[lab] += 1
        out[t.name] = res
    return out, dict(counts)


def _pts(tile: Tile, coords: Any, lo: float, hi: float, integer: bool = False) -> str:
    s = []
    for c in coords:
        x, y = tile.to_px(c[0], c[1])
        x, y = min(max(x, lo), hi), min(max(y, lo), hi)
        if integer:
            x, y = round(x), round(y)
        s.append(f"{x:.1f},{y:.1f}")
    return ";".join(s)


def _polys(g: BaseGeometry) -> list[BaseGeometry]:
    return list(g.geoms) if g.geom_type == "MultiPolygon" else [g] if g.geom_type == "Polygon" else []


def cvat_xml(tiles: list[Tile], final: dict[str, list[dict[str, Any]]], task_name: str) -> str:
    """CVAT 1.1 annotations.xml, one <image> per tile (empty ones too), exactly the four labels."""
    def att(k: str, v: Any) -> str:
        return f'<attribute name="{k}">{v}</attribute>'

    images = []
    for i, t in enumerate(sorted(tiles, key=lambda t: t.name)):
        W, H = t.info.width, t.info.height
        fs, el = final.get(t.name, []), []
        for f in fs:
            if f["label"] == "row":
                el.append(f'<polyline label="row" source="auto" occluded="0" points="{_pts(t, f["geometry"].coords, 0, W)}" z_order="0">'
                          f'{att("vineyard_id", f["vineyard_id"])}{att("row_id", f["row_id"])}{att("row_structure", f["row_structure"])}</polyline>')
        for f in fs:
            if f["label"] == "interrow_area":
                for p in _polys(f["geometry"]):
                    el.append(f'<polygon label="interrow_area" source="auto" occluded="0" points="{_pts(t, p.exterior.coords[:-1], 0, W)}" z_order="0">'
                              f'{att("vineyard_id", f["vineyard_id"])}{att("interrow_cover", f["interrow_cover"])}</polygon>')
        for f in fs:
            if f["label"] == "vineyard":
                for p in _polys(f["geometry"].simplify(0.03)):
                    el.append(f'<polygon label="vineyard" source="auto" occluded="0" points="{_pts(t, p.exterior.coords[:-1], 0, W - 1, True)}" z_order="0">'
                              f'{att("vineyard_id", f["vineyard_id"])}</polygon>')
        for f in fs:
            if f["label"] == "waste":
                x0, y0, x1, y1 = f["geometry"].bounds
                (a0, b0), (a1, b1) = t.to_px(x0, y1), t.to_px(x1, y0)
                a0, b0, a1, b1 = (min(max(v, 0), W) for v in (a0, b0, a1, b1))
                el.append(f'<box label="waste" source="auto" occluded="0" xtl="{a0:.1f}" ytl="{b0:.1f}" xbr="{a1:.1f}" ybr="{b1:.1f}" z_order="0">'
                          f'{att("vineyard_id", f["vineyard_id"])}</box>')
        images.append(f'<image id="{i}" name="{t.name}" width="{W}" height="{H}">\n' + "\n".join(el) + ("\n" if el else "") + "</image>")
    return ('<?xml version="1.0" encoding="utf-8"?>\n<annotations>\n<version>1.1</version>\n'
            f"<meta><task><name>{task_name}</name>{LABELS_XML}</task></meta>\n" + "\n".join(images) + "\n</annotations>\n")


def geojson(final: dict[str, list[dict[str, Any]]]) -> dict[str, Any]:
    feats = []
    for n, fs in sorted(final.items()):
        for f in fs:
            props = {k: v for k, v in f.items() if k != "geometry"}
            props["tile"] = n
            feats.append({"type": "Feature", "properties": props, "geometry": mapping(f["geometry"])})
    return {"type": "FeatureCollection", "crs": CRS, "features": feats}


def verify(xml: str, tile_names: list[str]) -> list[str]:
    """Check an annotations.xml against the challenge rules; [] means valid."""
    problems: list[str] = []
    root = ET.fromstring(xml)
    labels = {lab.findtext("name"): lab.findtext("type") for lab in root.iter("label")}
    if labels != REQUIRED_LABELS:
        problems.append(f"label config {labels} != {REQUIRED_LABELS}")
    seen = set()
    for img in root.iter("image"):
        n, w, h = img.get("name"), float(img.get("width") or 0), float(img.get("height") or 0)
        if n in seen:
            problems.append(f"{n} appears twice")
        seen.add(n)
        for el in img:
            lab = el.get("label")
            if lab not in REQUIRED_LABELS or el.tag != XML_TAG[REQUIRED_LABELS[lab]]:
                problems.append(f"{n}: <{el.tag} label={lab}> is not allowed")
                continue
            if el.tag == "box":
                xs = [float(el.get("xtl")), float(el.get("xbr"))]
                ys = [float(el.get("ytl")), float(el.get("ybr"))]
            else:
                pts = [tuple(map(float, p.split(","))) for p in (el.get("points") or "").split(";") if p]
                if len(pts) < (3 if el.tag == "polygon" else 2):
                    problems.append(f"{n}: {lab} with {len(pts)} points")
                    continue
                xs, ys = [p[0] for p in pts], [p[1] for p in pts]
            if min(xs) < 0 or min(ys) < 0 or max(xs) > w or max(ys) > h:
                problems.append(f"{n}: {lab} outside the image")
    missing = set(tile_names) - seen
    if missing:
        problems.append(f"{len(missing)} tiles have no <image>: {sorted(missing)[:3]}")
    return problems


def build(tiles: list[Tile], trees: list[BaseGeometry] | None = None, task_name: str = "Vineyard AI Field Challenge") -> dict[str, Any]:
    """-> {"xml": str, "geojson": dict, "counts": dict, "problems": list[str]}"""
    final, counts = finalize(tiles, trees)
    xml = cvat_xml(tiles, final, task_name)
    return {"xml": xml, "geojson": geojson(final), "counts": counts, "problems": verify(xml, [t.name for t in tiles])}

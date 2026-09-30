"""v9 finishing pass over a vine_labeler.py run: golden rules 3, 5, 6 + CVAT 1.1 packages.

  rule 5  IDs survive tile edges: rows are grouped over the WHOLE site into blocks (parallel,
          neighbouring rows) and physical rows (same offset across tiles and gaps), so vineyard_id
          and row_id are identical in every tile a block / row appears in.
  rule 3  one row = one straight line per tile, from its first to its last vine, through gaps;
          `disrupted` when the canopy along it has a gap >= 5 m inside the tile.
  rule 6  every tile gets an <image> (empty = no objects); ZIPs of the supplied GeoTIFFs,
          byte-unchanged, < 90 MB each.

dead_vine (leafless / dead plants) is kept in the per-tile GeoJSON as its own label but is NOT
written to CVAT: the annotation rules say "missing or dead plant: draw nothing".

Usage:
    python finalize_v9.py --labels data/tested-on-vm/v8/labels --tiles data/marcaj-data/assets_for_participants/01_tiles \
        --out data/tested-on-vm/v9
"""
from __future__ import annotations

import argparse
import glob
import json
import os
import shutil
import zipfile
from collections import defaultdict

import numpy as np
import rasterio
from shapely.geometry import LineString, Point, box, mapping, shape
from shapely.ops import unary_union
from shapely.strtree import STRtree

BLOCK_ANGLE_DEG = 6.0     # rows of one block are parallel within this
BLOCK_LINK_M = 4.5        # ... and a neighbouring row is at most this far (about 1.5 x row spacing)
ROW_MERGE_M = 0.8         # segments whose offsets differ by less than this are the same physical row
DISRUPT_GAP_M = 5.0
VINE_ON_ROW_M = 0.6
TREE_BUFFER_M = 0.2
ZIP_MAX_MB = 88
LABELS_XML = """<labels>
<label><name>vineyard</name><type>polygon</type><attributes>
<attribute><name>vineyard_id</name><mutable>False</mutable><input_type>text</input_type><default_value></default_value><values></values></attribute></attributes></label>
<label><name>waste</name><type>rectangle</type><attributes>
<attribute><name>vineyard_id</name><mutable>False</mutable><input_type>text</input_type><default_value></default_value><values></values></attribute></attributes></label>
<label><name>row</name><type>polyline</type><attributes>
<attribute><name>vineyard_id</name><mutable>False</mutable><input_type>text</input_type><default_value></default_value><values></values></attribute>
<attribute><name>row_id</name><mutable>False</mutable><input_type>text</input_type><default_value></default_value><values></values></attribute>
<attribute><name>row_structure</name><mutable>False</mutable><input_type>select</input_type><default_value>regular</default_value><values>regular
disrupted
unassessable</values></attribute></attributes></label>
<label><name>interrow_area</name><type>polygon</type><attributes>
<attribute><name>vineyard_id</name><mutable>False</mutable><input_type>text</input_type><default_value></default_value><values></values></attribute>
<attribute><name>interrow_cover</name><mutable>False</mutable><input_type>select</input_type><default_value>bare_soil</default_value><values>bare_soil
vegetation
mixed
unassessable</values></attribute></attributes></label>
</labels>"""


def load(labels_dir, tiles):
    feats = defaultdict(list)
    for t in tiles:
        n = os.path.basename(t)[:-4]
        f = f"{labels_dir}/{n}__labels.geojson"
        if os.path.exists(f):
            for ft in json.load(open(f))["features"]:
                if ft["geometry"]:
                    feats[n].append((ft["properties"], shape(ft["geometry"])))
    return feats


def unit(line):
    c = np.array(line.coords)
    d = c[-1] - c[0]
    d = d / (np.linalg.norm(d) + 1e-9)
    return d if d[0] > 0 or (d[0] == 0 and d[1] > 0) else -d


def group_blocks(segs):
    """Union-find over row segments: same block when parallel and a neighbour."""
    parent = list(range(len(segs)))

    def find(i):
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
                parent[find(i)] = find(j)
    comp = defaultdict(list)
    for i in range(len(segs)):
        comp[find(i)].append(i)
    return list(comp.values())


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--labels", required=True)
    ap.add_argument("--tiles", default="data/marcaj-data/assets_for_participants/01_tiles")
    ap.add_argument("--out", required=True)
    ap.add_argument("--parts", type=int, default=5)
    ap.add_argument("--no-zip", action="store_true")
    ap.add_argument("--trees", default="", help="tree-crown GeoJSON (trees_sam3.py): the part of a row under a crown is cut out")
    a = ap.parse_args()
    crowns = [shape(f["geometry"]).buffer(0).buffer(TREE_BUFFER_M) for f in json.load(open(a.trees))["features"]] if a.trees else []
    ctree = STRtree(crowns) if crowns else None
    tiles = sorted(glob.glob(f"{a.tiles}/*.tif"))
    feats = load(a.labels, tiles)
    meta = {}
    for t in tiles:
        with rasterio.open(t) as s:
            meta[os.path.basename(t)[:-4]] = (s.transform, s.width, s.height, box(*s.bounds))

    # ---- rule 5: site-wide blocks and physical rows
    segs = []
    for n, fs in feats.items():
        for p, g in fs:
            if p["label"] == "row" and g.length > 0.5:
                segs.append({"tile": n, "geom": g, "d": unit(g), "st": p.get("row_structure", "regular")})
    blocks = group_blocks(segs)
    blocks = [b for b in blocks if sum(segs[i]["geom"].length for i in b) >= 5.0]
    # block order: north-west first (by the block's top-left-most point)
    def key(b):
        c = np.array([segs[i]["geom"].centroid.coords[0] for i in b])
        return (-c[:, 1].max() // 50, c[:, 0].min())
    blocks.sort(key=key)
    rows_by_tile = defaultdict(list)
    block_rows = []   # (vid, rid, axis_d, n, offset) for id lookup
    for bi, b in enumerate(blocks, 1):
        vid = f"V{bi:02d}"
        L = np.array([segs[i]["geom"].length for i in b])
        ds = np.array([segs[i]["d"] for i in b])
        th = 0.5 * np.arctan2((L * np.sin(2 * np.arctan2(ds[:, 1], ds[:, 0]))).sum(),
                              (L * np.cos(2 * np.arctan2(ds[:, 1], ds[:, 0]))).sum())
        d = np.array([np.cos(th), np.sin(th)])
        nrm = np.array([-d[1], d[0]])
        offs = np.array([np.array(segs[i]["geom"].centroid.coords[0]) @ nrm for i in b])
        order = np.argsort(offs)
        groups, cur = [], [order[0]]
        for k in order[1:]:
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
                s = segs[b[k]]
                rows_by_tile[s["tile"]].append((vid, rid, d, nrm, s))
    br_lines = [LineString([tuple(nrm * o + d * t0), tuple(nrm * o + d * t1)]) for _, _, d, nrm, o, t0, t1 in block_rows]
    br_tree = STRtree(br_lines) if br_lines else None

    def nearest_ids(pt, maxd):
        if br_tree is None:
            return None
        k = br_tree.nearest(pt)
        vid, rid = block_rows[k][:2]
        return (vid, rid) if br_lines[k].distance(pt) <= maxd else None

    os.makedirs(f"{a.out}/labels", exist_ok=True)
    out_tiles = {}
    stats = defaultdict(int)
    for n, (T, W, H, tb) in meta.items():
        fs = feats.get(n, [])
        vines = [g for p, g in fs if p["label"] == "vineyard"]
        vtree = STRtree(vines) if vines else None
        rows = []
        by_rid = defaultdict(list)
        for vid, rid, d, nrm, s in rows_by_tile.get(n, []):
            by_rid[(vid, rid, tuple(d), tuple(nrm))].append(s)
        for (vid, rid, d, nrm), ss in by_rid.items():      # ---- rule 3: one line per row per tile
            d, nrm = np.array(d), np.array(nrm)
            pts = np.concatenate([np.array(s["geom"].coords) for s in ss])
            t = pts @ d
            o = float(np.median(pts @ nrm))
            # the vines on this row stretch the line to the first / last vine
            line0 = LineString([tuple(d * t.min() + nrm * o), tuple(d * t.max() + nrm * o)])
            near = [vines[k] for k in vtree.query(line0.buffer(VINE_ON_ROW_M + 40))] if vtree else []
            near = [g for g in near if abs(np.array(g.centroid.coords[0]) @ nrm - o) <= VINE_ON_ROW_M]
            iv = sorted((min(np.array(g.exterior.coords) @ d), max(np.array(g.exterior.coords) @ d)) for g in near)
            lo, hi = t.min(), t.max()
            if iv:
                lo, hi = min(lo, iv[0][0]), max(hi, max(b for _, b in iv))
            line = LineString([tuple(d * lo + nrm * o), tuple(d * hi + nrm * o)]).intersection(tb)
            if line.is_empty or line.length < 1.0:
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
            if ctree is not None:               # a tree over the row removes that stretch, not the row
                hit = [crowns[k] for k in ctree.query(line) if crowns[k].intersects(line)]
                if hit:
                    rest = line.difference(unary_union(hit))
                    pieces = [q for q in (rest.geoms if rest.geom_type == "MultiLineString" else [rest])
                              if q.geom_type == "LineString" and q.length >= 1.0]
                    stats["rows_cut_by_trees"] += 1
            for q in pieces:
                rows.append({"label": "row", "vineyard_id": vid, "row_id": rid, "row_structure": st, "geometry": q})
                stats["rows"] += 1
        out = list(rows)
        for p, g in fs:
            lab = p["label"]
            if lab == "row":
                continue
            ids = nearest_ids(g.centroid, 1.5 if lab in ("vineyard", "dead_vine") else 4.0)
            vid = ids[0] if ids else ""
            if lab in ("vineyard", "dead_vine") and not ids:
                stats[f"{lab}_dropped_no_row"] += 1      # rule 2: plants stand on a vine row
                continue
            q = {k: v for k, v in p.items() if k not in ("score",)}
            q.update(vineyard_id=vid, geometry=g)
            out.append(q)
            stats[lab] += 1
        out_tiles[n] = out
        json.dump({"type": "FeatureCollection",
                   "crs": {"type": "name", "properties": {"name": "urn:ogc:def:crs:EPSG::32635"}},
                   "features": [{"type": "Feature", "properties": {k: v for k, v in f.items() if k != "geometry"},
                                 "geometry": mapping(f["geometry"])} for f in out]},
                  open(f"{a.out}/labels/{n}__labels.geojson", "w"))

    # ---- rule 6: CVAT 1.1
    inv = {n: ~m[0] for n, m in meta.items()}

    def px(n, coords, lo, hi, integer=False):
        P = [inv[n] * c[:2] for c in coords]
        out = []
        for x, y in P:
            x, y = min(max(x, lo), hi), min(max(y, lo), hi)
            if integer:
                x, y = round(x), round(y)
            out.append(f"{x:.1f},{y:.1f}")
        return ";".join(out)

    def image_xml(i, n):
        W, H = meta[n][1], meta[n][2]
        el = []
        att = lambda k, v: f'<attribute name="{k}">{v}</attribute>'
        fs = out_tiles[n]
        for f in fs:
            if f["label"] == "row":
                el.append(f'<polyline label="row" source="manual" occluded="0" points="{px(n, f["geometry"].coords, 0, W)}" z_order="0">'
                          f'{att("vineyard_id", f["vineyard_id"])}{att("row_id", f["row_id"])}{att("row_structure", f["row_structure"])}</polyline>')
        for f in fs:
            if f["label"] == "interrow_area" and f["geometry"].geom_type == "Polygon":
                el.append(f'<polygon label="interrow_area" source="manual" occluded="0" points="{px(n, f["geometry"].exterior.coords[:-1], 0, W)}" z_order="0">'
                          f'{att("vineyard_id", f["vineyard_id"])}{att("interrow_cover", f.get("interrow_cover", "unassessable"))}</polygon>')
        for f in fs:
            if f["label"] == "vineyard" and f["geometry"].geom_type == "Polygon":
                g = f["geometry"]                  # full precision (vectorize already simplifies to 0.7 px)
                el.append(f'<polygon label="vineyard" source="manual" occluded="0" points="{px(n, g.exterior.coords[:-1], 0, W - 1, True)}" z_order="0">'
                          f'{att("vineyard_id", f["vineyard_id"])}</polygon>')
        for f in fs:
            if f["label"] == "waste":
                x0, y0, x1, y1 = f["geometry"].bounds
                (a0, b0), (a1, b1) = inv[n] * (x0, y1), inv[n] * (x1, y0)
                cl = lambda v: min(max(v, 0), W)
                el.append(f'<box label="waste" source="manual" occluded="0" xtl="{cl(a0):.1f}" ytl="{cl(b0):.1f}" xbr="{cl(a1):.1f}" ybr="{cl(b1):.1f}" z_order="0">'
                          f'{att("vineyard_id", f["vineyard_id"])}</box>')
        return (f'<image id="{i}" name="{n}.tif" width="{W}" height="{H}">\n' + "\n".join(el) +
                ("\n" if el else "") + "</image>")

    names = sorted(meta)
    os.makedirs(f"{a.out}/cvat", exist_ok=True)
    parts = np.array_split(np.arange(len(names)), max(1, min(a.parts, len(names))))
    report = []
    for pi, idx in enumerate(parts, 1):
        part = [names[i] for i in idx]
        xml = ('<?xml version="1.0" encoding="utf-8"?>\n<annotations>\n<version>1.1</version>\n'
               f'<meta><task><name>Vineyard AI Field Challenge - part {pi}</name>{LABELS_XML}</task></meta>\n'
               + "\n".join(image_xml(i, n) for i, n in enumerate(part)) + "\n</annotations>\n")
        d = f"{a.out}/cvat/part{pi}"
        os.makedirs(d, exist_ok=True)
        open(f"{d}/annotations.xml", "w", encoding="utf-8").write(xml)
        nobj = xml.count("<polyline") + xml.count("<polygon") + xml.count("<box")
        empty = sum(1 for n in part if not any(f["label"] in ("row", "interrow_area", "vineyard", "waste") for f in out_tiles[n]))
        rep = {"part": pi, "tiles": len(part), "first": part[0], "last": part[-1], "objects": nobj, "empty_tiles": empty}
        if not a.no_zip:
            z = f"{a.out}/cvat/marcaj_part{pi}.zip"
            with zipfile.ZipFile(z, "w", zipfile.ZIP_DEFLATED) as zf:
                zf.write(f"{d}/annotations.xml", "annotations.xml")
                for n in part:
                    zf.write(f"{a.tiles}/{n}.tif", f"images/{n}.tif", compress_type=zipfile.ZIP_STORED)
            rep["zip_mb"] = round(os.path.getsize(z) / 2 ** 20, 1)
            assert rep["zip_mb"] < ZIP_MAX_MB, rep
        report.append(rep)
    summ = {"blocks": len(blocks), "physical_rows": len(block_rows), **stats, "parts": report}
    json.dump(summ, open(f"{a.out}/summary.json", "w"), indent=1)
    print(json.dumps(summ, indent=1))


if __name__ == "__main__":
    main()

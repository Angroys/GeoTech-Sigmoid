"""Probability maps from predict.py -> per-tile GeoJSON in the team label schema (EPSG:32635).

Only inside the vineyard parcels (edited set, buffered PARCEL_BUFFER_M); everything else is
background. Per class:
  vineyard       canopy > T; seeds = canopy minus the predicted plant edges; a watershed grows
                 the seeds back over the canopy, so touching plants become separate polygons
                 (one canopy = one plant)
  row            row > T, skeletonised; each skeleton piece becomes a straight line (principal
                 axis, first to last pixel). finalize_cvat.py then merges the pieces into one
                 line per row per tile with IDs that survive tile edges
  interrow_area  interrow > T minus canopy, polygons; interrow_cover from the share of green
                 pixels (bare_soil < 0.2 <= mixed < 0.6 <= vegetation)
  waste          waste > T, bounding boxes
  dead_vine      dead > T, polygons (kept in GeoJSON, never written to CVAT)

Usage:
    python finetune_sam3/vectorize.py --prob run1/prob --tiles dataset/images \
        --parcels parcels_v2_edited.geojson --out run1/labels
"""
from __future__ import annotations

import argparse
import glob
import json
import os
from multiprocessing import Pool

import cv2
import numpy as np
import rasterio
from rasterio.features import rasterize
from scipy import ndimage as ndi
from shapely.geometry import LineString, Polygon, box, mapping, shape
from shapely.ops import unary_union
from skimage.morphology import skeletonize
from skimage.segmentation import watershed

PX_M = 0.025
PARCEL_BUFFER_M = 3.0
T = {"vineyard": 0.5, "plant_edge": 0.5, "row": 0.5, "interrow_area": 0.5, "waste": 0.5, "dead_vine": 0.5}
MIN_PLANT_PX = 80           # 0.05 m2
MIN_SEED_PX = 8
MIN_IR_PX = 1600            # 1 m2
MIN_WASTE_PX = 160          # 0.1 m2
MIN_ROW_LEN_PX = 40         # 1 m
MIN_PIECE_PX = 20           # skeleton pieces shorter than 0.5 m are noise
ROW_ANGLE_DEG = 8.0
ROW_SEP_M = 1.2             # rows closer than this are the same row
IR_MIN_GAP_M = 1.0           # neighbouring rows closer / farther than this have no inter-row
IR_MAX_GAP_M = 4.5
IR_STRAIGHT = False          # True: inter-rows as straight strips; False: precise polygons like the team labels
IR_EDGE_Q = 0.03             # straight inter-row sides: offset quantiles of the inter-row pixels (canopy edge)
IR_END_Q = 0.005             # ... and its ends along the rows
IR_MIN_WIDTH_M = 0.4
IR_MIN_FILL = 0.5            # a strip must be at least half inter-row pixels
IR_EXTEND_M = 15.0          # quads reach this far past the rows' ends; the mask clips them
ROW_HALF_W_PX = 12          # 0.3 m: skeleton pixels this close to a row offset belong to it
SIMPLIFY_PX = {"vineyard": 0.7, "interrow_area": 2.0, "dead_vine": 0.7}
CLASS_IDX = {"vineyard": 0, "plant_edge": 1, "row": 2, "interrow_area": 3, "waste": 4, "dead_vine": 5}

_PARCELS = None
_TREES = None               # tree crowns (trees_sam3.py); vineyard labels are never drawn inside them
TREE_BUFFER_M = 0.2


def _contours(mask, eps):
    cs, hier = cv2.findContours(mask.astype(np.uint8), cv2.RETR_CCOMP, cv2.CHAIN_APPROX_NONE)
    if hier is None:
        return []
    out = []
    for i, c in enumerate(cs):
        if hier[0][i][3] != -1 or len(c) < 3:
            continue
        ext = cv2.approxPolyDP(c, eps, True)[:, 0, :] + 0.5
        holes = []
        j = hier[0][i][2]
        while j != -1:
            h = cv2.approxPolyDP(cs[j], eps, True)[:, 0, :] + 0.5
            if len(h) >= 3:
                holes.append(h)
            j = hier[0][j][0]
        if len(ext) >= 3:
            p = Polygon(ext, holes).buffer(0)
            if not p.is_empty:
                out.extend(p.geoms if p.geom_type == "MultiPolygon" else [p])
    return out


def _to_world(geom, T_):
    from shapely.affinity import affine_transform
    return affine_transform(geom, [T_.a, T_.b, T_.d, T_.e, T_.c, T_.f])


def _row_lines(mask):
    """Row mask -> one straight line per row per tile.

    Skeleton pieces are grouped by direction (within ROW_ANGLE_DEG); in each group the skeleton
    pixels are projected on the group's normal and every offset peak (rows are >= ROW_SEP_M apart)
    becomes one line from the first to the last row pixel at that offset, through gaps.
    """
    sk = skeletonize(mask)
    lab, n = ndi.label(sk, structure=np.ones((3, 3)))
    segs = []
    for i, sl in enumerate(ndi.find_objects(lab), 1):
        ys, xs = np.nonzero(lab[sl] == i)
        if len(xs) < MIN_PIECE_PX:
            continue
        pts = np.c_[xs + sl[1].start + 0.5, ys + sl[0].start + 0.5]
        c = pts.mean(0)
        _, sv, vt = np.linalg.svd(pts - c, full_matrices=False)
        if sv[1] > 0.35 * sv[0]:          # blob, not a line piece
            continue
        d = vt[0] if vt[0][0] > 0 or (vt[0][0] == 0 and vt[0][1] > 0) else -vt[0]
        segs.append((pts, float(np.degrees(np.arctan2(d[1], d[0]))) % 180, len(pts)))
    lines = []
    used = np.zeros(len(segs), bool)
    for k in np.argsort([-w for _, _, w in segs]):
        if used[k]:
            continue
        a0 = segs[k][1]
        grp = [j for j in range(len(segs)) if not used[j]
               and min(abs(segs[j][1] - a0), 180 - abs(segs[j][1] - a0)) <= ROW_ANGLE_DEG]
        used[grp] = True
        pts = np.concatenate([segs[j][0] for j in grp])
        if len(pts) < MIN_ROW_LEN_PX:
            continue
        # length-weighted mean direction (doubled angles handle the 0/180 wrap)
        ang = np.radians([segs[j][1] for j in grp])
        w = np.array([segs[j][2] for j in grp], float)
        th = 0.5 * np.arctan2((w * np.sin(2 * ang)).sum(), (w * np.cos(2 * ang)).sum())
        d = np.array([np.cos(th), np.sin(th)])
        nrm = np.array([-d[1], d[0]])
        off, t = pts @ nrm, pts @ d
        lo = off.min()
        hist = np.bincount(((off - lo) / 2).astype(int)).astype(float)
        hist = ndi.gaussian_filter1d(hist, 2)
        sep = ROW_SEP_M / PX_M
        taken = []
        for pk in np.argsort(-hist):
            if hist[pk] < 1.0:
                break
            o = lo + pk * 2 + 1
            if any(abs(o - q) < sep for q in taken):
                continue
            sel = np.abs(off - o) <= ROW_HALF_W_PX
            if sel.sum() < MIN_ROW_LEN_PX:
                continue
            taken.append(o)
            oo = float(np.median(off[sel]))
            t0, t1 = t[sel].min(), t[sel].max()
            if t1 - t0 >= MIN_ROW_LEN_PX:
                lines.append({"line": LineString([tuple(d * t0 + nrm * oo), tuple(d * t1 + nrm * oo)]),
                              "group": k, "d": d, "nrm": nrm, "off": oo, "t0": t0, "t1": t1})
    return lines


def _interrow_quads(rows):
    """One quadrilateral per pair of neighbouring parallel rows (pixel coords): the gap between
    the two row axes, over both rows' extent plus IR_EXTEND_M, so every row gap gets its own inter-row."""
    quads = []
    groups = {}
    for r in rows:
        groups.setdefault(r["group"], []).append(r)
    for rs in groups.values():
        rs.sort(key=lambda r: r["off"])
        gaps = np.diff([r["off"] for r in rs])
        ok = gaps[(gaps >= IR_MIN_GAP_M / PX_M) & (gaps <= IR_MAX_GAP_M / PX_M)]
        spacing = float(np.median(ok)) if len(ok) else None
        for a, b in zip(rs, rs[1:]):
            gap = b["off"] - a["off"]
            if gap < IR_MIN_GAP_M / PX_M:
                continue
            # a gap of ~k row spacings means k-1 rows were missed: split it into k inter-rows
            k = max(1, int(round(gap / spacing))) if spacing else 1
            if gap / k > IR_MAX_GAP_M / PX_M:
                continue
            d, nrm = a["d"], a["nrm"]
            ext = IR_EXTEND_M / PX_M            # the inter-row mask itself decides where the gap ends
            t0, t1 = min(a["t0"], b["t0"]) - ext, max(a["t1"], b["t1"]) + ext
            for j in range(k):
                o0, o1 = a["off"] + gap * j / k, a["off"] + gap * (j + 1) / k
                quads.append({"d": d, "nrm": nrm, "poly": Polygon(
                    [tuple(d * t0 + nrm * o0), tuple(d * t1 + nrm * o0),
                     tuple(d * t1 + nrm * o1), tuple(d * t0 + nrm * o1)])})
    return quads


def _straight_interrow(qm, d, nrm):
    """Inter-row pixels of one row gap -> a straight strip (pixel coords): long sides parallel to the
    rows at the canopy edges (IR_EDGE_Q quantiles of the across-row offset, the mask already excludes
    canopy), short sides where the inter-row starts and ends. None when the strip is mostly not inter-row."""
    ys, xs = np.nonzero(qm)
    pts = np.c_[xs + 0.5, ys + 0.5]
    off, t = pts @ nrm, pts @ d
    o0, o1 = np.quantile(off, [IR_EDGE_Q, 1 - IR_EDGE_Q])
    t0, t1 = np.quantile(t, [IR_END_Q, 1 - IR_END_Q])
    if o1 - o0 < IR_MIN_WIDTH_M / PX_M or t1 - t0 < MIN_ROW_LEN_PX:
        return None
    rect = Polygon([tuple(d * t0 + nrm * o0), tuple(d * t1 + nrm * o0), tuple(d * t1 + nrm * o1), tuple(d * t0 + nrm * o1)])
    return rect if len(xs) >= IR_MIN_FILL * rect.area else None


def _cover(rgb, poly_mask):
    px = rgb[poly_mask].astype(np.float32)
    if len(px) == 0:
        return "unassessable"
    r, g, b = px[:, 0], px[:, 1], px[:, 2]
    exg = (2 * g - r - b) / (r + g + b + 1e-6)
    f = float((exg > 0.05).mean())
    return "bare_soil" if f < 0.2 else ("vegetation" if f >= 0.6 else "mixed")


def vectorize_tile(args):
    npz, tile, out = args
    n = os.path.basename(tile)[:-4]
    with rasterio.open(tile) as s:
        T_, W, H, bounds = s.transform, s.width, s.height, box(*s.bounds)
    feats = []
    near = [p for p in _PARCELS if p.intersects(bounds)]
    if near and os.path.exists(npz):
        valid = rasterize([(g, 1) for g in near], out_shape=(H, W), transform=T_, dtype=np.uint8).astype(bool)
        if _TREES:
            crowns = [t for t in _TREES if t.intersects(bounds)]
            if crowns:
                valid &= ~rasterize([(g, 1) for g in crowns], out_shape=(H, W), transform=T_, dtype=np.uint8).astype(bool)
        P = np.load(npz)["prob"].astype(np.float32) / 255.0
        m = {k: (P[i] > T[k]) & valid for k, i in CLASS_IDX.items()}
        with rasterio.open(tile) as s:
            rgb = s.read([1, 2, 3]).transpose(1, 2, 0)

        vine = m["vineyard"]
        seeds, ns = ndi.label(vine & ~m["plant_edge"])
        sizes = np.bincount(seeds.ravel())
        seeds[sizes[seeds] < MIN_SEED_PX] = 0
        # canopy pieces the edge channel swallowed completely still become a plant of their own
        comp, nc = ndi.label(vine)
        orphan = np.setdiff1d(np.arange(1, nc + 1), np.unique(comp[seeds > 0]))
        if len(orphan):
            om = np.isin(comp, orphan)
            seeds[om] = comp[om] + ns
        inst = watershed(-P[CLASS_IDX["vineyard"]], markers=seeds, mask=vine)
        for sl_i, sl in enumerate(ndi.find_objects(inst), 1):
            if sl is None:
                continue
            sub = inst[sl] == sl_i
            if sub.sum() < MIN_PLANT_PX:
                continue
            for p in _contours(np.pad(sub, 1), SIMPLIFY_PX["vineyard"]):
                p = _to_world(p, T_ * rasterio.Affine.translation(sl[1].start - 1, sl[0].start - 1))
                feats.append(({"label": "vineyard", "row_structure": None, "interrow_cover": None}, p))

        rows = _row_lines(m["row"])
        # canopy and the row axis both separate inter-rows (gappy canopy alone would let one leak into the next)
        ir = m["interrow_area"] & ~ndi.binary_dilation(vine, iterations=1) & ~m["row"]
        claimed = np.zeros((H, W), bool)          # inter-rows never overlap each other
        crowns = [t for t in (_TREES or []) if t.intersects(bounds)]
        for q in _interrow_quads(rows):
            qm = rasterize([(q["poly"], 1)], out_shape=(H, W), dtype=np.uint8).astype(bool) & ir & ~claimed
            if qm.sum() < MIN_IR_PX:
                continue
            if IR_STRAIGHT:
                rect = _straight_interrow(qm, q["d"], q["nrm"])
                if rect is None:
                    continue
                rm = rasterize([(rect, 1)], out_shape=(H, W), dtype=np.uint8).astype(bool) & ~claimed
                geoms, cov = [_to_world(rect, T_)], _cover(rgb, rm & ir)
            else:                                   # the inter-row pixels themselves, as a precise polygon
                rm = qm
                ys, xs = np.nonzero(qm)
                sl = (slice(ys.min(), ys.max() + 1), slice(xs.min(), xs.max() + 1))
                polys = _contours(np.pad(qm[sl], 1), SIMPLIFY_PX["interrow_area"])
                if not polys:
                    continue
                p = max(polys, key=lambda g: g.area)          # one inter-row per row gap
                geoms = [_to_world(p, T_ * rasterio.Affine.translation(sl[1].start - 1, sl[0].start - 1))]
                cov = _cover(rgb[sl], qm[sl])
            claimed |= rm
            for g in geoms:
                hit = [c for c in crowns if c.intersects(g)]
                if hit:                             # a tree crown cuts the inter-row
                    g = g.difference(unary_union(hit))
                for piece in (g.geoms if g.geom_type == "MultiPolygon" else [g]):
                    if piece.geom_type == "Polygon" and piece.area >= MIN_IR_PX * PX_M ** 2:
                        feats.append(({"label": "interrow_area", "row_structure": None, "interrow_cover": cov}, piece))

        lab, _ = ndi.label(m["waste"])
        for i, sl in enumerate(ndi.find_objects(lab), 1):
            if (lab[sl] == i).sum() < MIN_WASTE_PX:
                continue
            b = box(sl[1].start, sl[0].start, sl[1].stop, sl[0].stop)
            feats.append(({"label": "waste", "row_structure": None, "interrow_cover": None}, _to_world(b, T_)))

        lab, _ = ndi.label(m["dead_vine"] & ~vine)
        for i, sl in enumerate(ndi.find_objects(lab), 1):
            sub = lab[sl] == i
            if sub.sum() < MIN_PLANT_PX:
                continue
            for p in _contours(np.pad(sub, 1), SIMPLIFY_PX["dead_vine"]):
                p = _to_world(p, T_ * rasterio.Affine.translation(sl[1].start - 1, sl[0].start - 1))
                feats.append(({"label": "dead_vine", "row_structure": None, "interrow_cover": None}, p))

        for r in rows:
            feats.append(({"label": "row", "row_structure": "regular", "interrow_cover": None}, _to_world(r["line"], T_)))

    json.dump({"type": "FeatureCollection", "name": f"{n}__labels",
               "crs": {"type": "name", "properties": {"name": "urn:ogc:def:crs:EPSG::32635"}},
               "features": [{"type": "Feature", "properties": p, "geometry": mapping(g)} for p, g in feats]},
              open(f"{out}/{n}__labels.geojson", "w"))
    return n, len(feats)


def _init(parcels, trees=None):
    global _PARCELS, _TREES
    _PARCELS, _TREES = parcels, trees


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--prob", required=True)
    ap.add_argument("--tiles", required=True)
    ap.add_argument("--parcels", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--trees", default="", help="tree-crown GeoJSON from trees_sam3.py; masked out of every label")
    ap.add_argument("--only", nargs="*", help="tile names to process (default: all)")
    ap.add_argument("--workers", type=int, default=os.cpu_count())
    ap.add_argument("--set", nargs="*", default=[], metavar="NAME=VALUE",
                    help="override a module constant, e.g. MIN_SEED_PX=12 or T.plant_edge=0.6")
    a = ap.parse_args()
    for kv in a.set:
        k, v = kv.split("=")
        if k.startswith("T."):
            T[k[2:]] = float(v)
        else:
            globals()[k] = type(globals()[k])(float(v))
    os.makedirs(a.out, exist_ok=True)
    parcels = [shape(f["geometry"]).buffer(0).buffer(PARCEL_BUFFER_M) for f in json.load(open(a.parcels))["features"]]
    u = unary_union(parcels)
    parcels = list(u.geoms) if u.geom_type == "MultiPolygon" else [u]
    tiles = sorted(glob.glob(f"{a.tiles}/*.tif"))
    if a.only:
        tiles = [t for t in tiles if os.path.basename(t)[:-4] in a.only]
    jobs = [(f"{a.prob}/{os.path.basename(t)[:-4]}.npz", t, a.out) for t in tiles]
    trees = None
    if a.trees:
        trees = [shape(f["geometry"]).buffer(0).buffer(TREE_BUFFER_M) for f in json.load(open(a.trees))["features"]]
    with Pool(a.workers, initializer=_init, initargs=(parcels, trees)) as pool:
        res = pool.map(vectorize_tile, jobs, chunksize=1)
    print(f"{len(res)} tiles, {sum(k for _, k in res)} features")


if __name__ == "__main__":
    main()

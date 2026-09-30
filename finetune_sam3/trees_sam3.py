"""Tree crowns over the Sireț3 tiles with SAM 3 (samgeo) text prompts -> GeoJSON (EPSG:32635).

Each 2048 px tile (2.5 cm/px) is read with a PAD_PX border from its neighbours, downsampled by
FACTOR (10 cm/px: a 3-10 m crown is 30-100 px, the scale SAM 3 handles well), and prompted with
PROMPTS. Masks become polygons in world coordinates; crowns cut by tile edges are dissolved
across tiles, and every crown keeps its best score, area and equivalent diameter.

Usage (GPU VM):
    python trees_sam3.py --tiles data/images --out trees
writes <out>/trees.geojson and <out>/trees_summary.json
"""
from __future__ import annotations

import argparse
import glob
import json
import os
import time

import cv2
import numpy as np
import rasterio
from rasterio.merge import merge
from shapely.affinity import affine_transform
from shapely.geometry import Polygon, mapping, shape
from shapely.ops import unary_union

PROMPTS = ("tree",)
CONF = 0.4
FACTOR = 4
PAD_PX = 256                  # native px of neighbour context around each tile
MIN_CROWN_M2 = 1.0
SIMPLIFY_M = 0.1


def to_np(x):
    return x.detach().float().cpu().numpy() if hasattr(x, "detach") else np.asarray(x)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--tiles", required=True)
    ap.add_argument("--out", required=True)
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    os.environ.setdefault("SAM3_CHECKPOINT_PATH", "/home/jupyter/marcaj/weights/sam3/sam3.pt")
    from samgeo.samgeo3 import SamGeo3
    sam = SamGeo3(backend="meta", model_id="facebook/sam3", confidence_threshold=CONF)
    paths = sorted(glob.glob(f"{a.tiles}/*.tif"))
    srcs = [rasterio.open(p) for p in paths]
    crowns, t0 = [], time.time()
    for i, s in enumerate(srcs):
        res = s.res[0]
        b = s.bounds
        pad = PAD_PX * res
        box_ = (b.left - pad, b.bottom - pad, b.right + pad, b.top + pad)
        near = [o for o in srcs if not (o.bounds.right < box_[0] or o.bounds.left > box_[2]
                                        or o.bounds.top < box_[1] or o.bounds.bottom > box_[3])]
        mos, tr = merge(near, bounds=box_, res=res * FACTOR, indexes=[1, 2, 3], resampling=rasterio.enums.Resampling.average)
        img = np.ascontiguousarray(mos.transpose(1, 2, 0))
        if img.max() == 0:
            continue
        sam.set_image(img)
        m_aff = [tr.a, tr.b, tr.d, tr.e, tr.c, tr.f]
        for p in PROMPTS:
            sam.generate_masks(p, min_size=int(MIN_CROWN_M2 / (res * FACTOR) ** 2), quiet=True)
            if sam.masks is None:
                continue
            for m, sc in zip(sam.masks, sam.scores):
                m = (to_np(m).squeeze() > 0.5).astype(np.uint8)
                if m.shape != img.shape[:2]:
                    continue
                cs, _ = cv2.findContours(m, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
                for c in cs:
                    if len(c) < 3:
                        continue
                    g = affine_transform(Polygon(c[:, 0, :] + 0.5).buffer(0), m_aff)
                    if g.area >= MIN_CROWN_M2:
                        crowns.append((g, float(to_np(sc)), p))
        if (i + 1) % 25 == 0:
            print(f"{i + 1}/{len(paths)} tiles, {len(crowns)} masks, {time.time() - t0:.0f}s", flush=True)
    # dissolve duplicates from overlapping tile contexts; keep the best score per dissolved crown
    merged = unary_union([g for g, _, _ in crowns])
    parts = list(merged.geoms) if merged.geom_type == "MultiPolygon" else [merged]
    from shapely.strtree import STRtree
    tree = STRtree([g for g, _, _ in crowns])
    feats = []
    for g in parts:
        g = g.simplify(SIMPLIFY_M)
        if g.area < MIN_CROWN_M2:
            continue
        sc = max(crowns[k][1] for k in tree.query(g) if crowns[k][0].intersects(g))
        feats.append({"type": "Feature", "geometry": mapping(g),
                      "properties": {"label": "tree", "score": round(sc, 3), "area_m2": round(g.area, 2),
                                     "diameter_m": round(2 * np.sqrt(g.area / np.pi), 2)}})
    json.dump({"type": "FeatureCollection", "crs": {"type": "name", "properties": {"name": "EPSG:32635"}},
               "features": feats}, open(f"{a.out}/trees.geojson", "w"))
    areas = np.array([f["properties"]["area_m2"] for f in feats]) if feats else np.zeros(1)
    summ = {"crowns": len(feats), "total_area_m2": round(float(areas.sum()), 1),
            "median_area_m2": round(float(np.median(areas)), 2), "prompts": PROMPTS, "conf": CONF,
            "gsd_m": 0.025 * FACTOR, "seconds": round(time.time() - t0)}
    json.dump(summ, open(f"{a.out}/trees_summary.json", "w"), indent=1)
    print("TREES DONE", json.dumps(summ), flush=True)


if __name__ == "__main__":
    main()

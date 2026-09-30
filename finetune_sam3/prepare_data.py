"""Turn the team labels in dataset/ into SAM 3 fine-tuning targets.

For every tile in dataset/current/manifest.json (verified and invalid alike; invalid tiles and
verified-empty tiles become all-background targets) this writes

  <out>/targets/<tile>.png   uint8, 2048x2048, one bit per class (model.CLASSES order):
      bit 0 vineyard      canopy polygons, filled
      bit 1 plant_edge    outline of every canopy polygon (splits touching plants apart)
      bit 2 row           row polylines, drawn ROW_WIDTH_M wide (rows stay lines; this is only
                          the training footprint of the line)
      bit 3 interrow_area polygons, filled
      bit 4 waste         boxes, filled
      bit 5 dead_vine     polygons, filled
  <out>/split.json          train / val / test tile names

Split: test = the two organiser ground-truth tiles; val = whole 4x4-tile blocks (spatially
separate from training) until about VAL_FRAC of the labelled tiles; train = everything else.

Usage:
    python finetune_sam3/prepare_data.py --dataset dataset --out build/sam3_ft
"""
from __future__ import annotations

import argparse
import json
import os
import random
import re

import cv2
import numpy as np
import rasterio
from shapely.geometry import shape

GT_TILES = ("siret3_r006_c004", "siret3_r021_c012")
PX_M = 0.025
ROW_WIDTH_M = 0.25
EDGE_PX = 3
VAL_FRAC = 0.10
BLOCK = 4
BITS = {"vineyard": 0, "row": 2, "interrow_area": 3, "waste": 4, "dead_vine": 5}


def to_px(coords, inv):
    return np.array([inv * (x, y) for x, y in coords], np.float64)


def rings(geom):
    polys = geom.geoms if geom.geom_type == "MultiPolygon" else [geom]
    for p in polys:
        yield p.exterior.coords, [i.coords for i in p.interiors]


def rasterize(features, inv, size=2048):
    layers = np.zeros((6, size, size), np.uint8)
    for ft in features:
        if not ft.get("geometry"):
            continue
        lab = ft["properties"].get("label")
        if lab not in BITS:
            continue
        g = shape(ft["geometry"])
        L = layers[BITS[lab]]
        if g.geom_type in ("LineString", "MultiLineString"):
            lines = g.geoms if g.geom_type == "MultiLineString" else [g]
            for ln in lines:
                pts = np.round(to_px(ln.coords, inv) * 4).astype(np.int32)
                cv2.polylines(L, [pts], False, 1, thickness=max(1, round(ROW_WIDTH_M / PX_M)),
                              lineType=cv2.LINE_8, shift=2)
            continue
        for ext, holes in rings(g):
            pe = np.round(to_px(ext, inv) * 4).astype(np.int32)
            ph = [np.round(to_px(h, inv) * 4).astype(np.int32) for h in holes]
            cv2.fillPoly(L, [pe], 1, shift=2)
            if ph:
                cv2.fillPoly(L, ph, 0, shift=2)
            if lab == "vineyard":
                cv2.polylines(layers[1], [pe] + ph, True, 1, thickness=EDGE_PX, shift=2)
    out = np.zeros((size, size), np.uint8)
    for b in range(6):
        out |= (layers[b] << b)
    return out


def split(tiles, labelled, seed=0):
    rc = {t: tuple(map(int, re.search(r"_r(\d+)_c(\d+)", t).groups())) for t in tiles}
    blocks = {}
    for t in tiles:
        if t in GT_TILES:
            continue
        blocks.setdefault((rc[t][0] // BLOCK, rc[t][1] // BLOCK), []).append(t)
    keys = sorted(blocks)
    random.Random(seed).shuffle(keys)
    target = VAL_FRAC * sum(t in labelled for t in tiles if t not in GT_TILES)
    val, n = [], 0
    for k in keys:
        lab = sum(t in labelled for t in blocks[k])
        if lab == 0 or n + lab > target * 1.5:
            continue
        val += blocks[k]
        n += lab
        if n >= target:
            break
    test = [t for t in tiles if t in GT_TILES]
    train = [t for t in tiles if t not in val and t not in test]
    return {"train": sorted(train), "val": sorted(val), "test": sorted(test)}


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--dataset", default="dataset")
    ap.add_argument("--out", required=True)
    a = ap.parse_args()
    man = json.load(open(f"{a.dataset}/current/manifest.json"))["tiles"]
    os.makedirs(f"{a.out}/targets", exist_ok=True)
    tiles, labelled, stats = [], set(), np.zeros(6, np.int64)
    for m in man:
        n = m["tile"][:-4]
        tiles.append(n)
        with rasterio.open(f"{a.dataset}/images/{n}.tif") as src:
            inv, size = ~src.transform, src.width
        f = f"{a.dataset}/current/labels/{n}__labels.geojson"
        feats = json.load(open(f))["features"] if (os.path.exists(f) and m["status"] != "invalid") else []
        tgt = rasterize(feats, inv, size)
        if feats:
            labelled.add(n)
        for b in range(6):
            stats[b] += int(((tgt >> b) & 1).sum())
        cv2.imwrite(f"{a.out}/targets/{n}.png", tgt)
    s = split(tiles, labelled)
    s["labelled"] = sorted(labelled)
    s["status"] = {m["tile"][:-4]: m["status"] for m in man}
    json.dump(s, open(f"{a.out}/split.json", "w"), indent=1)
    tot = len(tiles) * 2048 * 2048
    print(f"{len(tiles)} tiles, {len(labelled)} labelled | train {len(s['train'])} "
          f"(labelled {sum(t in labelled for t in s['train'])}) val {len(s['val'])} "
          f"(labelled {sum(t in labelled for t in s['val'])}) test {s['test']}")
    print("pixel fraction per class:", dict(zip(("vineyard", "plant_edge", "row", "interrow_area", "waste", "dead_vine"),
                                               np.round(stats / tot, 4).tolist())))


if __name__ == "__main__":
    main()

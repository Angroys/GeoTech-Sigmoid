"""
Minimal zero-shot SAM 3 POC on Siret3 tiles (samgeo, 16 GB GPU).

Runs text-prompted SAM 3 on 1024 px crops of each 2048 px tile (native 2.5 cm/px),
de-duplicates masks across crop overlaps, and writes per-tile GeoJSON (EPSG:32635)
plus a quick-look PNG. An ExG + Otsu colour baseline is written alongside for comparison.

Usage:
    python sam3_poc.py --tiles "tiles/*.tif" --out out/
"""
import argparse, glob, json, os, time

import numpy as np
import rasterio
from rasterio.features import shapes
from affine import Affine
from shapely.geometry import shape
from shapely.affinity import affine_transform
from shapely.strtree import STRtree
import geopandas as gpd
from skimage.filters import threshold_otsu
from PIL import Image, ImageDraw

PX_M2 = 0.025 ** 2  # 2.5 cm/px -> m² per pixel

# prompt -> (min_area_m2, max_area_m2). Size filters encode the annotation rules:
# vines < ~1 m wide, 1-1.5 m apart (so ~0.2-2.5 m²); trees are 2-4 m crowns; weeds < 0.2 m².
PROMPTS = {
    "grapevine": (0.2, 2.5),
    "small green plant": (0.2, 2.5),
    "plastic bag": (0.02, 4.0),
    "trash": (0.02, 4.0),
}

CROP, OVERLAP = 1024, 128  # SAM 3 runs at 1008 px, so 1024 crops keep ~native resolution


def crop_starts(size, crop=CROP, overlap=OVERLAP):
    step = crop - overlap
    starts = list(range(0, max(size - crop, 0) + 1, step))
    if starts[-1] + crop < size:
        starts.append(size - crop)
    return starts


def mask_to_polygon(mask, x0, y0):
    """Largest polygon of a binary mask, in tile pixel coordinates."""
    polys = [shape(g) for g, v in shapes(mask.astype(np.uint8), mask=mask,
                                         transform=Affine.translation(x0, y0)) if v == 1]
    return max(polys, key=lambda p: p.area) if polys else None


def nms(records, iou_thr=0.5):
    """Greedy polygon NMS, highest score first (removes duplicates from crop overlaps)."""
    records = sorted(records, key=lambda r: -r["score"])
    kept, geoms = [], []
    for r in records:
        g = r["geom"]
        if geoms:
            tree = STRtree(geoms)
            dup = any(g.intersection(geoms[i]).area / g.union(geoms[i]).area > iou_thr
                      for i in tree.query(g))
            if dup:
                continue
        kept.append(r); geoms.append(g)
    return kept


def to_geo(geom, t):
    return affine_transform(geom, [t.a, t.b, t.d, t.e, t.xoff, t.yoff])


def exg_baseline(rgb, valid):
    """Excess-green + Otsu vegetation mask. Can't tell vines from grass — that's the point."""
    x = rgb.astype(np.float32)
    s = x.sum(-1) + 1e-6
    r, g, b = x[..., 0] / s, x[..., 1] / s, x[..., 2] / s
    exg = 2 * g - r - b
    return (exg > threshold_otsu(exg[valid])) & valid


def save_quicklook(rgb, polys_by_prompt, path, scale=4):
    img = Image.fromarray(rgb).resize((rgb.shape[1] // scale, rgb.shape[0] // scale))
    d = ImageDraw.Draw(img)
    colors = ["#ff2d2d", "#2dd4ff", "#ffd400", "#ff00ff"]
    for (prompt, polys), c in zip(polys_by_prompt.items(), colors):
        for p in polys:
            d.polygon([(x / scale, y / scale) for x, y in p.exterior.coords], outline=c)
    img.save(path)


def run(tiles, out, conf):
    from samgeo import SamGeo3  # imported late so the rest of the file is testable without a GPU
    import torch

    os.makedirs(out, exist_ok=True)
    sam = SamGeo3(backend="meta", model_id="facebook/sam3", confidence_threshold=conf)
    summary = []

    for path in tiles:
        name = os.path.splitext(os.path.basename(path))[0]
        with rasterio.open(path) as src:
            rgb = src.read([1, 2, 3]).transpose(1, 2, 0)
            T, crs = src.transform, src.crs
        valid = rgb.sum(-1) > 0  # black = outside the imagery on edge tiles
        H, W = valid.shape
        t0 = time.time()

        records = {p: [] for p in PROMPTS}
        for y0 in crop_starts(H):
            for x0 in crop_starts(W):
                if valid[y0:y0 + CROP, x0:x0 + CROP].mean() < 0.1:
                    continue
                sam.set_image(np.ascontiguousarray(rgb[y0:y0 + CROP, x0:x0 + CROP]))
                for prompt, (amin, amax) in PROMPTS.items():
                    sam.generate_masks(prompt, min_size=int(amin / PX_M2),
                                       max_size=int(amax / PX_M2), quiet=True)
                    for m, s in zip(sam.masks or [], sam.scores or []):
                        m = np.squeeze(np.asarray(m)) > 0
                        g = mask_to_polygon(m, x0, y0)
                        if g is not None:
                            records[prompt].append({"geom": g, "score": float(s)})
        dt = time.time() - t0

        polys_px = {}
        for prompt, recs in records.items():
            kept = nms(recs)
            polys_px[prompt] = [r["geom"] for r in kept]
            gdf = gpd.GeoDataFrame(
                {"prompt": prompt, "score": [r["score"] for r in kept],
                 "area_m2": [r["geom"].area * PX_M2 for r in kept]},
                geometry=[to_geo(r["geom"], T).simplify(0.02) for r in kept], crs=crs)
            if len(gdf):
                gdf.to_file(f"{out}/{name}__{prompt.replace(' ', '_')}.geojson", driver="GeoJSON")
            summary.append({"tile": name, "prompt": prompt, "raw": len(recs), "kept": len(kept),
                            "area_m2": round(float(gdf.area_m2.sum()), 1) if len(gdf) else 0.0,
                            "sec": round(dt, 1)})

        veg = exg_baseline(rgb, valid)
        summary.append({"tile": name, "prompt": "ExG+Otsu (baseline)", "raw": None, "kept": None,
                        "area_m2": round(float(veg.sum() * PX_M2), 1), "sec": None})
        save_quicklook(rgb, polys_px, f"{out}/{name}__quicklook.png")

    if torch.cuda.is_available():
        print(f"peak VRAM: {torch.cuda.max_memory_allocated() / 2**30:.1f} GB")
    for row in summary:
        print(row)
    json.dump(summary, open(f"{out}/summary.json", "w"), indent=2)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--tiles", default="tiles/*.tif")
    ap.add_argument("--out", default="out")
    ap.add_argument("--conf", type=float, default=0.3, help="lower = more recall")
    a = ap.parse_args()
    run(sorted(glob.glob(a.tiles)), a.out, a.conf)
"""Run the v6 Marcaj labeler (SAM 3 evidence + vine_labeler.py) on the Riseholme drone photos.

Riseholme photos are 4056x3040 JPGs at ~3 mm/px with no georeference; the labeler is tuned at
2.5 cm/px. Each photo is therefore resampled to 2.5 cm/px (GSD from the season's row spacing in the
COCO vine_row annotations, assuming ROW_SPACING_M between rows) and written as a GeoTIFF on a
synthetic grid (photos 2*PAD apart, so no photo sees another as context). SAM 3 runs on 512 px
windows with a 100 px overlap. Results are mapped back to the original photo pixels.

Stages (per shard, so several shards can share one GPU / run on several VMs):
    python riseholme_v6.py prep   --dataset DIR --shard I --nshards N --out rh
    python riseholme_v6.py sam    --shard I --out rh
    python riseholme_v6.py label  --shard I --out rh --params best_params_v4.json --workers 12
    python riseholme_v6.py export --shard I --out rh --dataset DIR
"""
from __future__ import annotations

import argparse
import collections
import glob
import json
import os

import numpy as np
import rasterio
from PIL import Image, ImageDraw
from rasterio.transform import Affine

import pseudo_labels as pl

DORMANT_SEASONS = ("march-2025",)   # leafless photos: canopy -> dead_vine (leafless) label
ROW_SPACING_M = 2.2       # assumed Riseholme inter-row distance (m) -> GSD per season
PX_OUT = pl.PX            # 0.025 m/px, the labeler's resolution
SAM_WIN, SAM_OVERLAP = 512, 100
CELL_GAP = 2 * pl.PAD
COLS = 20
PERIOD_MIN_PX, PERIOD_MAX_PX = 150, 1300   # plausible row period in the photo (full-res px)
MIN_STRENGTH = 0.3   # weaker autocorrelation peak -> season median period (checked vs COCO rows: 86% within 20%)
CRS = "EPSG:32635"        # synthetic: any metric CRS works, the grid is not a real location


def list_images(dataset):
    out = []
    for season in sorted(glob.glob(f"{dataset}/*/")):
        s = os.path.basename(season.rstrip("/")).split("-full")[0].replace("riseholme-", "")
        for split in ("train", "valid", "test"):
            for p in sorted(glob.glob(f"{season}{split}/*.jpg")):
                out.append((s, split, p))
    return out


def season_row_spacing_px(dataset):
    """Median distance between neighbouring annotated rows, per season (px of the original photo)."""
    res = {}
    for season in sorted(glob.glob(f"{dataset}/*/")):
        s = os.path.basename(season.rstrip("/")).split("-full")[0].replace("riseholme-", "")
        gaps = []
        for split in ("train", "valid", "test"):
            f = f"{season}{split}/_annotations.coco.json"
            if not os.path.exists(f):
                continue
            c = json.load(open(f))
            cat = {x["id"]: x["name"] for x in c["categories"]}
            by = collections.defaultdict(list)
            for a in c["annotations"]:
                if cat[a["category_id"]] == "vine_row" and a["segmentation"]:
                    by[a["image_id"]].append(np.array(a["segmentation"][0], float).reshape(-1, 2))
            for P in by.values():
                if len(P) < 2:
                    continue
                big = max(P, key=lambda q: np.ptp(q, 0).max())
                d = np.linalg.svd(big - big.mean(0))[2][0]
                n = np.array([-d[1], d[0]])
                offs = np.sort([float(q.mean(0) @ n) for q in P])
                g = np.diff(offs)
                gaps += list(g[(g > 450) & (g < 1100)])       # neighbouring rows, not split polygons
        res[s] = float(np.median(gaps))
    return res


def row_period_px(im):
    """Row period of a photo (px, full resolution): row direction from the whitened 2D spectrum of
    high-passed greenness, then the first autocorrelation peak of the profile across the rows.
    Returns (period_px, strength = autocorrelation at that lag, row_angle_deg)."""
    from scipy import ndimage as ndi
    f = 4
    g = np.asarray(im.resize((im.width // f, im.height // f), Image.BILINEAR), np.float32)
    r, gg, b = g[..., 0], g[..., 1], g[..., 2]
    x = (2 * gg - r - b) / (r + gg + b + 1) + 0.5 * (g.mean(-1) / 255)   # ExG + brightness (dormant rows)
    x = x - ndi.gaussian_filter(x, 30)                                     # remove lighting / field-scale trends
    h, w = x.shape
    n = 1 << int(np.floor(np.log2(min(h, w))))
    y0, x0 = (h - n) // 2, (w - n) // 2
    c = x[y0:y0 + n, x0:x0 + n]
    P = np.abs(np.fft.fft2((c - c.mean()) * np.outer(np.hanning(n), np.hanning(n)))) ** 2
    fy, fx = np.meshgrid(np.fft.fftfreq(n), np.fft.fftfreq(n), indexing="ij")
    fr = np.hypot(fy, fx)
    rb = np.minimum((fr * n).astype(int), n)                               # whiten: / radial median
    rad = ndi.median(P, rb, np.arange(n + 1))
    Pw = P / (np.asarray(rad)[rb] + 1e-12)
    per = f / np.maximum(fr, 1e-9)
    band = (per >= PERIOD_MIN_PX) & (per <= PERIOD_MAX_PX)
    iy, ix = np.unravel_index(np.argmax(np.where(band, Pw, 0)), P.shape)
    ang = float(np.degrees(np.arctan2(fy[iy, ix], fx[iy, ix])))           # direction ACROSS the rows
    # rotate so the across-row direction is horizontal, profile = column means of the valid area
    rot = ndi.rotate(x, ang, reshape=True, order=1, cval=np.nan)
    ok = ndi.rotate(np.ones_like(x), ang, reshape=True, order=0, cval=0) > 0.5
    rows_ok = ok.mean(1) > 0.5
    with np.errstate(all="ignore"), __import__("warnings").catch_warnings():
        __import__("warnings").simplefilter("ignore")
        prof = np.nanmean(np.where(ok, rot, np.nan)[rows_ok], axis=0)
    prof = prof[np.isfinite(prof)]
    prof = prof - prof.mean()
    ac = np.correlate(prof, prof, "full")[len(prof) - 1:]
    ac = ac / (ac[0] + 1e-12)
    lo, hi = int(PERIOD_MIN_PX / f), min(int(PERIOD_MAX_PX / f), len(ac) // 2)
    pk = [k for k in range(max(lo, 1), hi) if ac[k] > ac[k - 1] and ac[k] >= ac[k + 1]]
    if not pk:
        return float(per[iy, ix]), 0.0, float((ang + 90) % 180)
    best = max(ac[k] for k in pk)
    k = next(k for k in pk if ac[k] >= 0.7 * best)                         # first strong peak = fundamental
    return float(k * f), float(ac[k]), float((ang + 90) % 180)

def shard_dir(a):
    return f"{a.out}/shard{a.shard}"


def prep(a):
    imgs = [x for i, x in enumerate(list_images(a.dataset)) if i % a.nshards == a.shard]
    sp = season_row_spacing_px(a.dataset)
    d = shard_dir(a)
    os.makedirs(f"{d}/tiles", exist_ok=True)
    meta, est = {}, []
    for season, split, p in imgs:                       # pass 1: per-photo GSD from its own row period
        im = Image.open(p).convert("RGB")
        per, strength, ang = row_period_px(im)
        est.append((per, strength, ang))
    good = collections.defaultdict(list)
    for (season, _, _), (per, st, _) in zip(imgs, est):
        if st >= MIN_STRENGTH:
            good[season].append(per)
    med = {s: float(np.median(v)) if v else sp[s] for s, v in
           ((s, good.get(s, [])) for s in {x[0] for x in imgs})}
    sizes = []
    for (season, _, p), (per, st, _) in zip(imgs, est):
        use = per if st >= MIN_STRENGTH else med[season]
        gsd = ROW_SPACING_M / use
        W, H = Image.open(p).size
        sizes.append((gsd, use, int(round(W * gsd / PX_OUT)), int(round(H * gsd / PX_OUT))))
    TILE_W, TILE_H = max(s[2] for s in sizes), max(s[3] for s in sizes)     # pl.Mosaic: one tile size
    x_cursor = y_cursor = row_h = 0
    for k, ((season, split, p), (per, strength, ang), (gsd, used, w, h)) in enumerate(zip(imgs, est, sizes)):
        im = Image.open(p).convert("RGB")
        W, H = im.size
        arr = np.asarray(im.resize((w, h), Image.LANCZOS))
        arr = np.where(arr.sum(-1, keepdims=True) == 0, 1, arr)        # 0,0,0 is no-data for the labeler
        canvas = np.zeros((TILE_H, TILE_W, 3), np.uint8)               # padded with no-data
        canvas[:h, :w] = arr
        arr = canvas
        if k % COLS == 0 and k:
            x_cursor, y_cursor, row_h = 0, y_cursor + row_h + CELL_GAP, 0
        T = Affine(PX_OUT, 0, 500000 + x_cursor * PX_OUT, 0, -PX_OUT, 5000000 - y_cursor * PX_OUT)
        x_cursor += TILE_W + CELL_GAP
        row_h = TILE_H
        stem = os.path.basename(p).split("_JPG")[0]
        name = f"rh_{season}_{split}_{stem}_{os.path.basename(p).split('.rf.')[-1][:6]}"
        with rasterio.open(f"{d}/tiles/{name}.tif", "w", driver="GTiff", width=TILE_W, height=TILE_H, count=3,
                           dtype="uint8", crs=CRS, transform=T, compress="deflate") as dst:
            dst.write(arr.transpose(2, 0, 1))
        meta[name] = {"src": p, "season": season, "split": split, "gsd_m": gsd, "W": W, "H": H, "w": w, "h": h,
                      "period_px_fft": per, "fft_strength": strength, "row_angle_deg": ang, "period_px_used": used,
                      "gsd_source": "photo_fft" if strength >= MIN_STRENGTH else "season_median"}
    json.dump({"row_spacing_px_coco": sp, "row_spacing_px_fft_median": med, "row_spacing_m_assumed": ROW_SPACING_M,
               "tile_px": [TILE_W, TILE_H], "images": meta},
              open(f"{d}/meta.json", "w"), indent=1)
    print(f"shard {a.shard}: {len(meta)} photos, fft period median per season {med}, tile {TILE_W}x{TILE_H}, "
          f"weak-peak fallbacks {sum(m['gsd_source'] != 'photo_fft' for m in meta.values())}")


def sam(a):
    d = shard_dir(a)
    paths = sorted(glob.glob(f"{d}/tiles/*.tif"))
    mosaic = pl.Mosaic(paths)
    if a.params and os.path.exists(a.params):             # tuned SAM prompt (optimize_params)
        import optimize_params as o
        p = json.load(open(a.params))
        o.apply_params(p.get("best_params", p))
    pl.sam_phase(mosaic, paths, f"{d}/_sam_cache", a.conf, SAM_WIN, SAM_WIN - SAM_OVERLAP)


def label(a):
    import vine_labeler as vl
    d = shard_dir(a)
    vl.main(["--tiles-dir", f"{d}/tiles", "--sam-cache", f"{d}/_sam_cache", "--out", f"{d}/labels",
             "--params", a.params, "--workers", str(a.workers), "--conf", str(a.conf)])


def export(a):
    """Labels back to original photo pixels (GeoJSON + overlay) and a row check against COCO vine_row."""
    from shapely.affinity import affine_transform
    from shapely.geometry import Polygon, mapping, shape
    from shapely.ops import unary_union
    d = shard_dir(a)
    meta = json.load(open(f"{d}/meta.json"))["images"]
    gt = {}
    for season in sorted(glob.glob(f"{a.dataset}/*/")):
        for split in ("train", "valid", "test"):
            f = f"{season}{split}/_annotations.coco.json"
            if not os.path.exists(f):
                continue
            c = json.load(open(f))
            cat = {x["id"]: x["name"] for x in c["categories"]}
            fn = {x["id"]: os.path.join(season + split, x["file_name"]) for x in c["images"]}
            for an in c["annotations"]:
                if cat[an["category_id"]] == "vine_row" and an["segmentation"]:
                    q = Polygon(np.array(an["segmentation"][0], float).reshape(-1, 2)).buffer(0)
                    gt.setdefault(os.path.normpath(fn[an["image_id"]]), []).append(q)
    os.makedirs(f"{d}/export", exist_ok=True)
    colors = {"vineyard": (255, 0, 255), "interrow_area": (0, 200, 255), "waste": (255, 40, 0), "dead_vine": (255, 140, 0)}
    rows_out = []
    for name, m in meta.items():
        with rasterio.open(f"{d}/tiles/{name}.tif") as s:
            inv = ~s.transform
        k = m["W"] / m["w"]                                          # model px -> photo px
        A = [inv.a * k, inv.b * k, inv.d * k, inv.e * k, inv.c * k, inv.f * k]
        feats = []
        gj = f"{d}/labels/{name}__labels.geojson"
        if os.path.exists(gj):
            for f in json.load(open(gj))["features"]:
                g = affine_transform(shape(f["geometry"]), A)
                if m["season"] in DORMANT_SEASONS and f["properties"]["label"] == "vineyard":
                    # dormant vines carry no leaves: canopy of its own kind, never mixed with leafy canopy
                    f["properties"] = {**f["properties"], "label": "dead_vine", "canopy_state": "leafless_dormant"}
                feats.append({"type": "Feature", "properties": f["properties"], "geometry": mapping(g)})
        json.dump({"type": "FeatureCollection", "coordinate_space": "pixel", "image": os.path.basename(m["src"]),
                   "gsd_m_assumed": m["gsd_m"], "features": feats}, open(f"{d}/export/{name}.geojson", "w"))
        im = Image.open(m["src"]).convert("RGB").resize((m["W"] // 4, m["H"] // 4))
        ov = Image.new("RGBA", im.size, (0, 0, 0, 0))
        dr = ImageDraw.Draw(ov)
        for f in feats:
            g, lab = shape(f["geometry"]), f["properties"]["label"]
            if lab == "row":
                dr.line([(x / 4, y / 4) for x, y in g.coords], fill=(255, 30, 30, 220), width=3)
            elif g.geom_type == "Polygon":
                xy = [(x / 4, y / 4) for x, y in g.exterior.coords]
                c = colors.get(lab, (255, 255, 255))
                dr.polygon(xy, fill=c + (110,), outline=(255, 230, 0, 255) if lab in ("vineyard", "dead_vine") else c + (255,))
        Image.alpha_composite(im.convert("RGBA"), ov).convert("RGB").save(f"{d}/export/{name}.jpg", quality=85)
        g_rows = gt.get(os.path.normpath(m["src"]), [])
        p_rows = [shape(f["geometry"]) for f in feats if f["properties"]["label"] == "row"]
        if g_rows:
            U = unary_union(g_rows).buffer(20)
            def long_side(q):
                c = np.array(q.minimum_rotated_rectangle.exterior.coords)
                return float(np.hypot(*np.diff(c, axis=0).T)[:2].max())
            hit = sum(any(r.intersection(q.buffer(20)).length >= 0.5 * long_side(q) for r in p_rows) for q in g_rows)
            prec = (sum(r.intersection(U).length for r in p_rows) / max(sum(r.length for r in p_rows), 1e-9)) if p_rows else float("nan")
            rows_out.append({"image": name, "gt_rows": len(g_rows), "pred_rows": len(p_rows),
                             "gt_rows_found": int(hit), "row_precision": prec})
    json.dump(rows_out, open(f"{d}/export/row_check.json", "w"), indent=1)
    if rows_out:
        rec = sum(r["gt_rows_found"] for r in rows_out) / max(sum(r["gt_rows"] for r in rows_out), 1)
        pr = np.nanmean([r["row_precision"] for r in rows_out])
        print(f"shard {a.shard}: {len(meta)} photos, GT rows found {rec:.3f}, predicted row length on GT rows {pr:.3f}")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("stage", choices=["prep", "sam", "label", "export"])
    ap.add_argument("--dataset", default="data/riseholme_vineyard_2024_2025_19234907/dataset")
    ap.add_argument("--out", default="rh")
    ap.add_argument("--shard", type=int, default=0)
    ap.add_argument("--nshards", type=int, default=1)
    ap.add_argument("--params", default="best_params_v4.json")
    ap.add_argument("--conf", type=float, default=0.2)
    ap.add_argument("--workers", type=int, default=12)
    a = ap.parse_args()
    {"prep": prep, "sam": sam, "label": label, "export": export}[a.stage](a)


if __name__ == "__main__":
    main()

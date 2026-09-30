#!/usr/bin/env python3
"""Vineyard parcel detector: SAM 3 text prompts on a coarse (10-20 cm/px) mosaic.

Plant-scale prompting fails (top-down vines are too small / textureless for SAM 3), but at
parcel scale a vineyard block is a striped rectangle that SAM 3 segments from "vineyard"-like
prompts.  Negatives (orchard, ploughed field, road, ...) are segmented too and subtracted.

Stages (each cached so the post-processing can be re-tuned without the GPU):
  build : downsample all tiles into one georeferenced RGB mosaic  (mosaic_f{F}.tif)
  sam   : SAM 3 on half-overlapping windows, per-prompt blended evidence (evidence_f{F}.npz)
  post  : vineyard = vine evidence - negative evidence -> cleanup -> polygons, raster, csv, png

  python parcels_sam3.py all --tiles ~/marcaj/tiles --out out --factor 8
"""
import argparse, glob, json, os, time

import numpy as np
import rasterio
from rasterio.enums import Resampling
from rasterio.transform import Affine

VINE_PROMPTS = ["vineyard", "vineyard rows", "rows of grapevines"]
NEG_PROMPTS = ["orchard", "fruit trees", "ploughed field", "grass field", "road", "house"]
# SAM 3 fires "ploughed field"/"grass field" on vineyards too (any field): they only veto when they
# clearly beat the vine evidence.  Hard negatives veto whenever they are confident.
HARD_NEG = ["orchard", "fruit trees", "road", "house"]
SOFT_NEG = ["ploughed field", "grass field"]
TILE_RES = 0.025


# ---------------------------------------------------------------------------- build
def tile_grid(paths):
    b = {}
    for p in paths:
        with rasterio.open(p) as s:
            b[p] = (s.bounds, s.width, s.height, s.crs)
    x0 = min(v[0].left for v in b.values())
    y0 = max(v[0].top for v in b.values())
    off = {p: (int(round((v[0].left - x0) / TILE_RES)), int(round((y0 - v[0].top) / TILE_RES)))
           for p, v in b.items()}
    tw, th, crs = next(iter(b.values()))[1:]
    return x0, y0, off, tw, th, crs


def build(tiles_dir, out, f):
    paths = sorted(glob.glob(os.path.join(tiles_dir, "*.tif")))
    x0, y0, off, tw, th, crs = tile_grid(paths)
    W = (max(o[0] for o in off.values()) + tw) // f
    H = (max(o[1] for o in off.values()) + th) // f
    mos = np.zeros((3, H, W), np.uint8)
    for p in paths:
        ox, oy = off[p]
        with rasterio.open(p) as s:
            full = s.read([1, 2, 3])
        blk = full.reshape(3, th // f, f, tw // f, f).astype(np.float32)
        a = blk.mean((2, 4))
        # nodata-aware: block valid if >= half its pixels are non-black; mean over valid pixels only
        v = (full.max(0) > 0).reshape(th // f, f, tw // f, f).mean((1, 3))
        a = np.where(v[None] > 0, a / np.maximum(v[None], 1e-6), 0)
        a = np.clip(a, 1, 255).astype(np.uint8)
        a[:, v < 0.5] = 0
        mos[:, oy // f:oy // f + th // f, ox // f:ox // f + tw // f] = a
    tr = Affine(TILE_RES * f, 0, x0, 0, -TILE_RES * f, y0)
    fn = os.path.join(out, f"mosaic_f{f}.tif")
    with rasterio.open(fn, "w", driver="GTiff", width=W, height=H, count=3, dtype="uint8",
                       crs=crs, transform=tr, compress="deflate", tiled=True) as d:
        d.write(mos)
    meta = {os.path.basename(p)[:-4]: [off[p][0] // f, off[p][1] // f, tw // f, th // f] for p in paths}
    json.dump(meta, open(os.path.join(out, f"tiles_f{f}.json"), "w"))
    print(f"mosaic f={f}: {W}x{H} -> {fn}")
    return fn


# ---------------------------------------------------------------------------- sam
def to_np(x):
    try:
        import torch
        if isinstance(x, torch.Tensor):
            return x.detach().float().cpu().numpy()
    except ImportError:
        pass
    return np.asarray(x, dtype=np.float32)


def sam_stage(out, f, crop, stride, conf, prompts, ev_tag=""):
    from samgeo.samgeo3 import SamGeo3
    os.environ.setdefault("SAM3_CHECKPOINT_PATH", "/home/jupyter/marcaj/weights/sam3/sam3.pt")
    with rasterio.open(os.path.join(out, f"mosaic_f{f}.tif")) as s:
        mos = s.read().transpose(1, 2, 0)
    H, W = mos.shape[:2]
    valid = mos.max(2) > 0
    sam = SamGeo3(backend="meta", model_id="facebook/sam3", confidence_threshold=conf)
    wv = np.sin(np.pi * (np.arange(crop) + 0.5) / crop) ** 2 + 1e-3
    wgt = np.outer(wv, wv).astype(np.float32)
    acc = {p: np.zeros((H, W), np.float32) for p in prompts}
    mx = {p: np.zeros((H, W), np.float16) for p in prompts}
    wsum = np.zeros((H, W), np.float32)
    t0, n = time.time(), 0
    for y in range(-stride, H, stride):
        for x in range(-stride, W, stride):
            ys, xs = max(y, 0), max(x, 0)
            ye, xe = min(y + crop, H), min(x + crop, W)
            if ye <= ys or xe <= xs or valid[ys:ye, xs:xe].mean() < 0.05:
                continue
            win = np.zeros((crop, crop, 3), np.uint8)
            win[ys - y:ye - y, xs - x:xe - x] = mos[ys:ye, xs:xe]
            sam.set_image(win)
            sl = (slice(ys - y, ye - y), slice(xs - x, xe - x))
            ww = wgt[sl]
            wsum[ys:ye, xs:xe] += ww
            for p in prompts:
                sam.generate_masks(p, min_size=int(0.002 * crop * crop), quiet=True)
                ev = np.zeros((crop, crop), np.float32)
                if sam.masks is not None and len(sam.masks):
                    for m, sc in zip(sam.masks, sam.scores):
                        m = to_np(m).squeeze() > 0.5
                        sc = float(to_np(sc))
                        if m.shape != ev.shape:
                            continue
                        ev[m] = np.maximum(ev[m], sc)
                acc[p][ys:ye, xs:xe] += ev[sl] * ww
                mx[p][ys:ye, xs:xe] = np.maximum(mx[p][ys:ye, xs:xe], ev[sl] * (ww > 0.25))
            n += 1
            if n % 20 == 0:
                print(f"  {n} windows  {time.time() - t0:.0f}s", flush=True)
    dt = time.time() - t0
    ev = {p: (acc[p] / np.maximum(wsum, 1e-6)).astype(np.float16) for p in prompts}
    np.savez_compressed(os.path.join(out, f"evidence_f{f}{ev_tag}.npz"),
                        **{"avg|" + p: ev[p] for p in prompts}, **{"max|" + p: mx[p] for p in prompts})
    json.dump({"windows": n, "seconds": dt, "crop": crop, "stride": stride, "conf": conf,
               "prompts": prompts}, open(os.path.join(out, f"sam_f{f}{ev_tag}.json"), "w"))
    print(f"SAM f={f}: {n} windows x {len(prompts)} prompts in {dt:.0f}s")


# ---------------------------------------------------------------------------- post
def post(out, f, vine_thr, neg_margin, neg_thr, min_area, close_m, tag, vine_prompts=None, neg_prompts=None,
         mode="avg", soft_prompts=None, soft_margin=0.2, combine="max", crown_px=0.5, crown_parcel=0.3):
    import cv2
    import geopandas as gpd
    from rasterio.features import shapes
    from shapely.geometry import shape
    from skimage import morphology

    with rasterio.open(os.path.join(out, f"mosaic_f{f}.tif")) as s:
        mos, tr, crs = s.read().transpose(1, 2, 0), s.transform, s.crs
    valid = mos.max(2) > 0
    z = {}
    for fn in sorted(glob.glob(os.path.join(out, f"evidence_f{f}*.npz"))):
        zz = np.load(fn)
        z.update({k: zz[k] for k in zz.files})
    keys = {k.split("|", 1)[1] for k in z}
    vp = [p for p in (vine_prompts or VINE_PROMPTS) if p in keys]
    npz = [p for p in (neg_prompts or HARD_NEG) if p in keys]
    spz = [p for p in (soft_prompts or SOFT_NEG) if p in keys]
    get = lambda p: z[f"{mode}|{p}"].astype(np.float32)
    # "vineyard" alone also fires on orchards / tree plantations; "vineyard rows" does not, but is
    # patchier -> combine="mean" requires both prompts to agree.
    vine = (np.mean if combine == "mean" else np.max)([get(p) for p in vp], 0)
    vine_arg = np.argmax([get(p) for p in vp], 0)
    neg = np.max([get(p) for p in npz], 0) if npz else np.zeros_like(vine)
    soft = np.max([get(p) for p in spz], 0) if spz else np.zeros_like(vine)
    gsd = TILE_RES * f
    # orchard veto (SAM 3 "orchard"/"fruit trees" never fire here): tree crowns survive a morphological
    # opening with a ~2.5 m disk, vine rows (< 1 m wide) do not.
    rgbf = mos.astype(np.float32)
    veg = ((2 * rgbf[..., 1] - rgbf[..., 0] - rgbf[..., 2]) > 25).astype(np.uint8)
    kd = max(3, int(round(2.5 / gsd)) | 1)
    crown = cv2.morphologyEx(veg, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (kd, kd)))
    bw = max(3, int(round(10 / gsd)) | 1)
    crown_d = cv2.blur(crown.astype(np.float32), (bw, bw))
    m = (vine >= vine_thr) & ~((neg >= neg_thr) & (neg > vine - neg_margin)) & ~(soft > vine + soft_margin) & valid
    m &= crown_d < crown_px
    r = max(1, int(round(close_m / gsd)))
    el = lambda rr: cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * rr + 1, 2 * rr + 1))
    m = cv2.morphologyEx(m.astype(np.uint8), cv2.MORPH_OPEN, el(max(1, r // 2)))
    m = cv2.morphologyEx(m, cv2.MORPH_CLOSE, el(r)).astype(bool)
    m = morphology.remove_small_holes(m, int(min_area / gsd ** 2))
    m = morphology.remove_small_objects(m, int(min_area / gsd ** 2))
    m &= valid
    # drop whole components that are mostly tree crowns
    lab0 = morphology.label(m).astype(np.int32)
    n0 = np.maximum(np.bincount(lab0.ravel()), 1)
    cf = np.bincount(lab0.ravel(), weights=crown.ravel().astype(np.float64), minlength=len(n0)) / n0
    bad = np.where(cf > crown_parcel)[0]
    m &= ~np.isin(lab0, bad[bad > 0])

    # polygons
    lab = morphology.label(m).astype(np.int32)
    nl = lab.max() + 1
    cnt = np.maximum(np.bincount(lab.ravel(), minlength=nl), 1)
    mean_sc = np.bincount(lab.ravel(), weights=vine.ravel(), minlength=nl) / cnt
    arg_hist = np.stack([np.bincount(lab.ravel(), weights=(vine_arg == i).ravel(), minlength=nl)
                         for i in range(len(vp))], 1)
    recs = []
    for geom, val in shapes(lab, mask=lab > 0, transform=tr):
        g = shape(geom).simplify(gsd * 1.5)
        if g.area < min_area:
            continue
        v = int(val)
        recs.append({"geometry": g, "score": round(float(mean_sc[v]), 3),
                     "prompt": vp[int(arg_hist[v].argmax())],
                     "area_m2": round(g.area, 1)})
    gdf = gpd.GeoDataFrame(recs, geometry="geometry", crs=crs)
    od = os.path.join(out, tag)
    os.makedirs(od, exist_ok=True)
    gdf.to_file(os.path.join(od, "parcels.geojson"), driver="GeoJSON")

    # 10 cm raster
    up = f / 4
    H10, W10 = int(round(m.shape[0] * up)), int(round(m.shape[1] * up))
    m10 = cv2.resize(m.astype(np.uint8) * 255, (W10, H10), interpolation=cv2.INTER_NEAREST)
    with rasterio.open(os.path.join(od, "parcels_10cm.tif"), "w", driver="GTiff", width=W10, height=H10,
                       count=1, dtype="uint8", crs=crs, transform=Affine(0.1, 0, tr.c, 0, -0.1, tr.f),
                       compress="deflate", tiled=True, nodata=0) as d:
        d.write(m10[None])

    # per-tile coverage
    tiles = json.load(open(os.path.join(out, f"tiles_f{f}.json")))
    rows = []
    for t, (ox, oy, tw, th) in sorted(tiles.items()):
        mm, vv = m[oy:oy + th, ox:ox + tw], valid[oy:oy + th, ox:ox + tw]
        rows.append((t, mm.mean(), mm.sum() / max(vv.sum(), 1)))
    with open(os.path.join(od, "parcel_cover.csv"), "w") as fh:
        fh.write("tile,frac_tile,frac_valid\n")
        for t, a, b in rows:
            fh.write(f"{t},{a:.4f},{b:.4f}\n")

    # overview png (left: RGB + outlines, right: vine evidence R / neg evidence B)
    s = max(1, int(np.ceil(max(m.shape) / 3000)))
    rgb = np.ascontiguousarray(mos[::s, ::s])
    mm = np.ascontiguousarray(m[::s, ::s]).astype(np.uint8)
    cnts, _ = cv2.findContours(mm, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    ov = rgb.copy()
    tint = ov.copy(); tint[mm > 0] = (0, 255, 255)
    ov = cv2.addWeighted(ov, 0.8, tint, 0.2, 0)
    cv2.drawContours(ov, cnts, -1, (255, 0, 255), 2)
    ev = np.zeros_like(rgb)
    ev[..., 0] = (vine[::s, ::s] * 255).clip(0, 255)
    ev[..., 2] = (np.maximum(neg, soft - soft_margin)[::s, ::s] * 255).clip(0, 255)
    ev[..., 1] = (valid[::s, ::s] * 40)
    # grid labels every 5 tiles
    for t, (ox, oy, tw, th) in tiles.items():
        rr, cc = int(t.split("_r")[1][:3]), int(t.split("_c")[1][:3])
        if rr % 5 == 0 and cc % 5 == 0:
            cv2.putText(ov, f"r{rr}c{cc}", (ox // s, oy // s + 12), cv2.FONT_HERSHEY_SIMPLEX, 0.4,
                        (255, 255, 255), 1)
    big = np.concatenate([ov, ev], 1)
    cv2.imwrite(os.path.join(od, "overview.png"), cv2.cvtColor(big, cv2.COLOR_RGB2BGR))

    cov = dict((t, b) for t, _, b in rows)
    summ = {"tag": tag, "factor": f, "n_parcels": len(gdf), "hectares": round(gdf.area.sum() / 1e4, 2),
            "vine_thr": vine_thr, "neg_margin": neg_margin, "neg_thr": neg_thr, "mode": mode,
            "vine_prompts": vp, "neg_prompts": npz, "soft_prompts": spz, "soft_margin": soft_margin, "combine": combine, "crown_px": crown_px, "crown_parcel": crown_parcel, "min_area": min_area, "close_m": close_m,
            "r006_c004": round(cov.get("siret3_r006_c004", -1), 3),
            "r021_c012": round(cov.get("siret3_r021_c012", -1), 3)}
    json.dump(summ, open(os.path.join(od, "summary.json"), "w"), indent=1)
    print(json.dumps(summ))
    return summ


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("stage", choices=["build", "sam", "post", "all"])
    ap.add_argument("--tiles", default=os.path.expanduser("~/marcaj/tiles"))
    ap.add_argument("--out", default="parcels_out")
    ap.add_argument("--factor", type=int, default=8)
    ap.add_argument("--crop", type=int, default=1008)
    ap.add_argument("--stride", type=int, default=504)
    ap.add_argument("--conf", type=float, default=0.2)
    ap.add_argument("--prompts", default="|".join(VINE_PROMPTS + NEG_PROMPTS))
    ap.add_argument("--vine-thr", type=float, default=0.35)
    ap.add_argument("--neg-thr", type=float, default=0.35)
    ap.add_argument("--neg-margin", type=float, default=0.0)
    ap.add_argument("--min-area", type=float, default=100.0)
    ap.add_argument("--close-m", type=float, default=3.0)
    ap.add_argument("--mode", default="avg", choices=["avg", "max"])
    ap.add_argument("--vine-prompts", default=None)
    ap.add_argument("--neg-prompts", default=None)
    ap.add_argument("--soft-prompts", default=None)
    ap.add_argument("--soft-margin", type=float, default=0.2)
    ap.add_argument("--tag", default=None)
    ap.add_argument("--ev-tag", default="")
    ap.add_argument("--combine", default="max", choices=["max", "mean"])
    ap.add_argument("--crown-px", type=float, default=0.5)
    ap.add_argument("--crown-parcel", type=float, default=0.3)
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    if a.stage in ("build", "all"):
        build(a.tiles, a.out, a.factor)
    if a.stage in ("sam", "all"):
        sam_stage(a.out, a.factor, a.crop, a.stride, a.conf, a.prompts.split("|"), a.ev_tag)
    if a.stage in ("post", "all"):
        post(a.out, a.factor, a.vine_thr, a.neg_margin, a.neg_thr, a.min_area, a.close_m,
             a.tag or f"f{a.factor}", a.vine_prompts.split("|") if a.vine_prompts else None,
             a.neg_prompts.split("|") if a.neg_prompts else None, a.mode,
             a.soft_prompts.split("|") if a.soft_prompts else None, a.soft_margin, a.combine, a.crown_px, a.crown_parcel)

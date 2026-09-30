"""
v2 vine canopy POC — row-guided hybrid.

Why v1 failed: SAM 3 text prompts ("grapevine" -> 0 hits) under-detect top-down vines, lock onto
white stakes/tubes, and fire on weed clumps in grassy inter-rows.

v2 pipeline per tile (2048 px, 2.5 cm/px):
  1. vine colour mask  : bright yellow-green leaves, brighter than their 2 m surroundings.
                         White stakes/tubes have low G-B and drop out.
  2. row field         : local FFT (12.8 m windows) finds row spacing/orientation/phase from the
                         colour mask -> band of +-~0.45 m around every row centre line.
                         Kills weeds, grass, trees and the track between blocks.
  3. SAM 3 (optional)  : text-prompt masks add recall where colour misses (shade, darker leaves),
                         but only pixels that are greenish, not white, and inside a row band count.
  4. instances         : per row stripe, canopy pixels are projected on the row axis; gaps > 0.3 m
                         separate plants, runs > 1.7 m are cut at profile minima every ~1.25 m
                         (the annotation rules' planting-distance split).
  5. outputs           : <tile>__vineyard.geojson (one polygon per plant), <tile>__rows.geojson
                         (row-axis polylines, bonus), <tile>__v2_quicklook.png, summary_v2.json

Usage:
    python vines_v2.py --tiles "tiles/*.tif" --out out_v2            # with SAM 3
    python vines_v2.py --tiles "tiles/*.tif" --out out_v2 --no-sam   # classical only, CPU
"""
import argparse, glob, json, os, time

import numpy as np
import rasterio
from rasterio.features import shapes
from scipy import ndimage as ndi
from skimage.measure import label
from skimage.morphology import disk
from shapely.geometry import shape, LineString
from shapely.ops import unary_union
import geopandas as gpd
import shapely
from PIL import Image, ImageDraw

PX = 0.025  # m per pixel


# ---------- 1. colour ----------
def _colour(rgb, local_t, gb_t, g_t):
    R, G, B = [rgb[..., i].astype(np.float32) for i in range(3)]
    local = G - ndi.uniform_filter(G, 81)                       # brighter than ~2 m surroundings
    m = (local > local_t) & ((G - B) > gb_t) & (R > 0.75 * G) & (G > g_t)
    m = ndi.binary_opening(m, np.ones((3, 3)))
    return ndi.binary_closing(m, np.ones((5, 5)))


def vine_mask(rgb, trees=None):
    """Two tiers: strict = bright yellow-green leaves (safe in grassy inter-rows), relaxed = also
    darker/shaded leaves (recall on bare soil). White stakes/tubes fail G-B in both.
    Grassy tracks/weed patches: removed locally (rows touching them survive).
    Tree crowns: near big shadows, whole thick blobs of the relaxed mask are removed from both tiers."""
    if trees is None:
        trees = near_trees(rgb, rgb.sum(-1) > 0)
    strict = _colour(rgb, 18, 50, 120)
    relaxed = _colour(rgb, 8, 35, 95)
    crowns = thick_blobs(relaxed) & trees
    return (drop_thick(strict) | drop_thick(relaxed)) & ~crowns


def drop_thick(m, max_half_width_m=0.55):
    """Remove the *bodies* of thick green blobs (grassy tracks, weed patches) while keeping thin
    vine rows, including rows that touch those blobs (block edges next to a track).
    Body = every pixel a 1.1 m-wide disk reaches when it fits inside the gap-bridged mask
    (a morphological opening, done with distance transforms for speed)."""
    closed = ndi.binary_closing(m, disk(8))
    r = max_half_width_m / PX
    core = ndi.distance_transform_edt(closed) > r
    if not core.any():
        return m
    return m & ~(ndi.distance_transform_edt(~core) <= r + 4)


def thick_blobs(m, max_half_width_m=0.55):
    """Region of whole gap-bridged blobs that are thick anywhere (tree crowns: their sunlit leaves
    are too patchy for the opening in drop_thick, but as a blob they are clearly > 1.1 m wide)."""
    closed = ndi.binary_closing(m, disk(8))
    lab = label(closed)
    if lab.max() == 0:
        return np.zeros(m.shape, bool)
    thick = ndi.maximum(ndi.distance_transform_edt(closed), lab, index=np.arange(1, lab.max() + 1))
    return np.isin(lab, np.nonzero(thick * PX > max_half_width_m)[0] + 1)


def near_trees(rgb, valid, radius_m=5.0):
    """Zone around trees, found by their large shadows (vine and stake shadows are thin strips)."""
    dark = ndi.binary_opening((rgb.max(-1) < 70) & valid, disk(3))
    lab = label(dark)
    if lab.max() == 0:
        return np.zeros(dark.shape, bool)
    half_w = ndi.maximum(ndi.distance_transform_edt(dark), lab, index=np.arange(1, lab.max() + 1))
    big = np.isin(lab, np.nonzero(half_w * PX > 0.6)[0] + 1)
    return ndi.distance_transform_edt(~big) * PX < radius_m


def green_blobs(rgb, rf, valid):
    """Thick green blobs that are not vine rows: grassy tracks, weed patches, crowns cut by the tile
    edge. Whole blobs are taken, except pixels that sit on a row centre (rf > 0.6) AND next to a
    cast shadow - vines throw shadows, flat grass does not. That keeps edge rows touching a track."""
    relaxed = _colour(rgb, 8, 35, 95)
    blob = thick_blobs(relaxed)
    dark = ndi.binary_opening((rgb.max(-1) < 80) & valid, np.ones((3, 3)))
    shadowed = ndi.distance_transform_edt(~dark) * PX < 0.4
    return blob & ~((rf > 0.6) & shadowed)


def not_white(rgb):
    mx, mn = rgb.max(-1).astype(np.float32), rgb.min(-1).astype(np.float32)
    return ~((mx > 160) & ((mx - mn) / (mx + 1e-6) < 0.3))


# ---------- 2. rows ----------
def row_field(v, valid, win=512, step=128, pmin=2.0, pmax=3.6, min_snr=4.0):
    """Blend of local cosine waves fitted to the dominant row frequency. ~+1 on row centres."""
    H, W = v.shape
    acc, wsum = np.zeros((H, W)), np.zeros((H, W))
    yy, xx = np.mgrid[0:win, 0:win]
    han = np.outer(np.hanning(win), np.hanning(win))
    f = np.fft.fftfreq(win)
    FY, FX = np.meshgrid(f, f, indexing="ij")
    FR = np.hypot(FY, FX)
    band = (FR >= PX / pmax) & (FR <= PX / pmin) & (FY >= 0)
    ys = sorted(set(range(0, H - win + 1, step)) | {H - win})
    xs = sorted(set(range(0, W - win + 1, step)) | {W - win})
    for y0 in ys:
        for x0 in xs:
            if valid[y0:y0 + win, x0:x0 + win].mean() < 0.3:
                continue
            p = v[y0:y0 + win, x0:x0 + win]
            F = np.fft.fft2((p - p.mean()) * han)
            A = np.abs(F)
            i = np.argmax(A * band)
            if A.flat[i] / (A[band].mean() + 1e-9) < min_snr:     # no periodic rows here
                continue
            wave = np.cos(2 * np.pi * (FX.flat[i] * xx + FY.flat[i] * yy) + np.angle(F.flat[i]))
            acc[y0:y0 + win, x0:x0 + win] += wave * han
            wsum[y0:y0 + win, x0:x0 + win] += han
    return np.where(wsum > 0.05, acc / np.maximum(wsum, 1e-9), -1.0)


# ---------- 3. SAM 3 recall ----------
def sam_canopy(sam, rgb, band, crop=1024, overlap=128, prompt="small green plant"):
    H, W = band.shape
    out = np.zeros((H, W), bool)
    R, G, B = [rgb[..., i].astype(np.float32) for i in range(3)]
    greenish = ((G - B) > 35) & (G > R * 0.9) & not_white(rgb)
    step = crop - overlap
    starts = lambda n: sorted(set(range(0, n - crop + 1, step)) | {n - crop})
    for y0 in starts(H):
        for x0 in starts(W):
            if band[y0:y0 + crop, x0:x0 + crop].mean() < 0.02:
                continue
            sam.set_image(np.ascontiguousarray(rgb[y0:y0 + crop, x0:x0 + crop]))
            sam.generate_masks(prompt, min_size=int(0.03 / PX**2), max_size=int(3.0 / PX**2), quiet=True)
            for m in sam.masks or []:
                m = np.squeeze(np.asarray(m)) > 0
                sl = (slice(y0, y0 + crop), slice(x0, x0 + crop))
                n = m.sum()
                if n == 0 or (m & band[sl]).sum() / n < 0.5 or (m & greenish[sl]).sum() / n < 0.5:
                    continue                                   # off-row (weed/tree) or mostly stake
                out[sl] |= m & greenish[sl]
    return out


# ---------- 4. instances + row axes ----------
def instances(canopy, band, gap_m=0.3, plant_len=1.25, max_len=1.7, min_area=0.03, bin_m=0.05):
    stripes = label(band)
    lab = np.zeros(canopy.shape, np.int32)
    axes = []
    k = 0
    for sid, sl in enumerate(ndi.find_objects(stripes), 1):
        if sl is None:
            continue
        sm = stripes[sl] == sid
        ys, xs = np.nonzero(sm)
        if len(ys) < 500:
            continue
        P = np.stack([ys, xs], 1).astype(np.float32)
        mu = P.mean(0)
        ax = np.linalg.svd(P - mu, full_matrices=False)[2][0]    # row direction (row, col)
        cy, cx = np.nonzero(sm & canopy[sl])
        if len(cy) == 0:
            continue
        t = ((np.stack([cy, cx], 1) - mu) @ ax) * PX             # metres along the row
        b = ((t - t.min()) / bin_m).astype(int)
        occ = np.bincount(b)
        filled = ndi.binary_closing(occ > 0, np.ones(int(gap_m / bin_m) + 1)) | (occ > 0)
        runs = label(filled)
        prof = ndi.uniform_filter1d(occ.astype(float), 5)
        for r in range(1, runs.max() + 1):
            bins = np.nonzero(runs == r)[0]
            L = (bins[-1] - bins[0] + 1) * bin_m
            n = max(1, int(round(L / plant_len))) if L > max_len else 1
            cuts = []
            for j in range(1, n):                                # cut at the thinnest point near each ~1.25 m mark
                c = bins[0] + int(len(bins) * j / n)
                w = int(0.3 / bin_m)
                cuts.append(c - w + int(np.argmin(prof[c - w:c + w])))
            edges = [bins[0]] + cuts + [bins[-1] + 1]
            for a, e in zip(edges[:-1], edges[1:]):
                s = (b >= a) & (b < e)
                if s.sum() * PX**2 < min_area:
                    continue
                k += 1
                lab[sl][cy[s], cx[s]] = k
        # row axes: line fitted to this stripe's canopy pixels, split where the row has a gap > 4 m
        # (tracks between blocks); smaller gaps stay inside one axis, as the annotation rules require
        C = np.stack([cy, cx], 1).astype(np.float32)
        if len(C) < 200:
            continue
        cmu = C.mean(0)
        cax = np.linalg.svd(C - cmu, full_matrices=False)[2][0]
        tc = np.sort((C - cmu) @ cax)
        breaks = np.nonzero(np.diff(tc) * PX > 4.0)[0]
        off = np.array([sl[0].start, sl[1].start])
        for seg in np.split(tc, breaks + 1):
            if (seg[-1] - seg[0]) * PX < 2.0:
                continue
            p0, p1 = cmu + cax * seg[0] + off, cmu + cax * seg[-1] + off
            axes.append(((p0[1], p0[0]), (p1[1], p1[0])))
    return lab, axes


def label_polygons(lab, transform):
    parts = {}
    for g, v in shapes(lab, mask=lab > 0, transform=transform):
        parts.setdefault(int(v), []).append(shape(g))
    polys = []
    for v, ps in parts.items():
        g = unary_union(ps).buffer(0.10).buffer(-0.10)           # bridge leaf gaps without inflating area
        if g.geom_type != "Polygon":
            g = shapely.concave_hull(g, ratio=0.3)               # one outline (convex hull ~doubles area)
            g = g.buffer(0.04).buffer(-0.04)                     # smooth the hull's thin spikes
        if g.geom_type != "Polygon":
            g = max(g.geoms, key=lambda q: q.area)
        polys.append(g.simplify(0.02))
    return polys


def quicklook(rgb, lab, axes, path, scale=2):
    rng = np.random.default_rng(0)
    col = rng.integers(60, 255, (lab.max() + 1, 3)).astype(np.uint8)
    ov = rgb.copy()
    m = lab > 0
    ov[m] = (rgb[m] * 0.3 + col[lab[m]] * 0.7).astype(np.uint8)
    im = Image.fromarray(ov).resize((rgb.shape[1] // scale, rgb.shape[0] // scale))
    d = ImageDraw.Draw(im)
    for (x0, y0), (x1, y1) in axes:
        d.line([(x0 / scale, y0 / scale), (x1 / scale, y1 / scale)], fill=(255, 0, 0), width=2)
    im.save(path)


def main(tiles, out, use_sam, conf):
    os.makedirs(out, exist_ok=True)
    sam = None
    if use_sam:
        from samgeo import SamGeo3
        sam = SamGeo3(backend="meta", model_id="facebook/sam3", confidence_threshold=conf)
    summary = []
    for path in tiles:
        name = os.path.splitext(os.path.basename(path))[0]
        t0 = time.time()
        with rasterio.open(path) as src:
            rgb = src.read([1, 2, 3]).transpose(1, 2, 0)
            T, crs = src.transform, src.crs
        valid = rgb.sum(-1) > 0

        vm = vine_mask(rgb) & valid
        rf = row_field(ndi.gaussian_filter(vm.astype(np.float32), 4), valid)
        band = (rf > 0.3) & valid
        canopy = vm & band
        n_sam = 0
        if sam is not None:
            extra = sam_canopy(sam, rgb, band)
            n_sam = int((extra & ~canopy).sum())
            canopy = drop_thick(canopy | extra)
        lab, axes = instances(canopy, band)

        polys = label_polygons(lab, T)
        gdf = gpd.GeoDataFrame({"label": "vineyard", "area_m2": [p.area for p in polys]},
                               geometry=polys, crs=crs)
        if len(gdf):
            gdf.to_file(f"{out}/{name}__vineyard.geojson", driver="GeoJSON")
        rows = [LineString([T * a, T * b]) for a, b in axes]
        if rows:
            gpd.GeoDataFrame({"label": "row", "length_m": [r.length for r in rows]},
                             geometry=rows, crs=crs).to_file(f"{out}/{name}__rows.geojson", driver="GeoJSON")
        quicklook(rgb, lab, axes, f"{out}/{name}__v2_quicklook.png")
        summary.append({"tile": name, "plants": len(polys),
                        "canopy_m2": round(float(gdf.area_m2.sum()), 1) if len(gdf) else 0.0,
                        "row_segments": len(rows), "row_band_share": round(float(band.mean()), 3),
                        "sam_added_px": n_sam, "sec": round(time.time() - t0, 1)})
        print(summary[-1])
    json.dump(summary, open(f"{out}/summary_v2.json", "w"), indent=2)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--tiles", default="tiles/*.tif")
    ap.add_argument("--out", default="out_v2")
    ap.add_argument("--no-sam", action="store_true")
    ap.add_argument("--conf", type=float, default=0.2, help="low on purpose: row/colour filters remove junk")
    a = ap.parse_args()
    main(sorted(glob.glob(a.tiles)), a.out, not a.no_sam, a.conf)
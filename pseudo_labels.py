"""
Pseudo-labels for training, over the whole Sireț3 tile set, for every object in the guide.

Two phases:
  1. SAM 3 over the mosaic (optional). The tiles are stitched into one virtual mosaic and SAM runs
     on windows that overlap by half on both axes, i.e. windows that sit across tile corners and
     edges as well as on the tiles. Each window's soft canopy mask is weighted with a smooth
     (sin^2) window and blended, so no pixel depends on a window edge -> no seams at tile borders.
     Result: one canopy-evidence GeoTIFF per tile + waste candidates, cached in <out>/_sam_cache.
  2. Per tile, with a 6.4 m margin from the neighbours: leaves delimited by saturation x brightness,
     row bands, plants split at saturation/brightness valleys along the row, rows, inter-rows, void.

Emits per tile (EPSG:32635, 2.5 cm/px):
  <tile>__labels.geojson  vineyard (polygon per plant), waste (box), row (polyline, row_structure),
                          interrow_area (polygon)
  <tile>__labels.tif      band 1: 0 void/ignore, 1 vineyard, 2 waste, 3 interrow_area, 4 background
                          band 2: instance id (vineyard + waste)
  <tile>__labels.png      quick-look
vineyard_id / row_id across tiles and interrow_cover are left to post-processing.

Run from the GeoTech-Sigmoid folder:
    python pseudo_labels.py                               # all tiles, with SAM 3
    python pseudo_labels.py --only "siret3_r007_*"        # a subset (neighbours still used as context)
    python pseudo_labels.py --no-sam                      # colour + geometry only, CPU
"""
import argparse, fnmatch, glob, json, os, time

import numpy as np
import rasterio
from rasterio.features import rasterize, shapes
from rasterio.transform import Affine
from rasterio.windows import Window
from scipy import ndimage as ndi
from shapely import wkt
from shapely.affinity import affine_transform
from shapely.geometry import LineString, Polygon, box, shape
from shapely.ops import unary_union
import geopandas as gpd
from PIL import Image, ImageDraw
from skimage.color import rgb2hsv
from skimage.filters import threshold_otsu
from skimage.measure import label
from skimage.morphology import disk

from vines_v2 import PX, _colour, label_polygons, near_trees, not_white, row_field, thick_blobs

TILES_DIR = "data/marcaj-data/assets_for_participants/01_tiles"
VOID, VINE, WASTE, INTERROW, BG = 0, 1, 2, 3, 4
CLASSES = {VINE: "vineyard", WASTE: "waste", INTERROW: "interrow_area", BG: "background"}
CANOPY_PROMPT = "small green plant"
WASTE_PROMPTS = ["trash", "rubbish pile", "plastic bag", "tire"]
WASTE_SURE = 0.5            # score >= this -> waste; below (but >= --conf) -> void
PAD = 256                   # 6.4 m context around each tile in phase 2


# ====================================================================== mosaic
class Mosaic:
    """All tiles as one virtual raster in mosaic pixel coords (0,0 = top-left of the tile set).
    read() stitches any window from the tiles it touches; outside the tiles -> 0."""

    def __init__(self, paths, bands=(1, 2, 3), origin=None):
        self.paths, self.bands, self._open = sorted(paths), list(bands), {}
        self.bounds = {}
        for p in self.paths:
            with rasterio.open(p) as s:
                self.bounds[p] = s.bounds
                self.res, self.crs, self.tw, self.th, self.profile = s.res[0], s.crs, s.width, s.height, s.profile
        self.x0 = origin[0] if origin else min(b.left for b in self.bounds.values())
        self.y0 = origin[1] if origin else max(b.top for b in self.bounds.values())
        self.off = {p: (int(round((b.left - self.x0) / self.res)), int(round((self.y0 - b.top) / self.res)))
                    for p, b in self.bounds.items()}
        self.W = max(ox for ox, _ in self.off.values()) + self.tw
        self.H = max(oy for _, oy in self.off.values()) + self.th
        self.transform = Affine(self.res, 0, self.x0, 0, -self.res, self.y0)

    def _f(self, p):
        if p not in self._open:
            self._open[p] = rasterio.open(p)
        return self._open[p]

    def read(self, x, y, w, h):
        out = np.zeros((len(self.bands), h, w), np.uint8)
        for p, (ox, oy) in self.off.items():
            ix0, iy0 = max(x, ox), max(y, oy)
            ix1, iy1 = min(x + w, ox + self.tw), min(y + h, oy + self.th)
            if ix0 < ix1 and iy0 < iy1:
                out[:, iy0 - y:iy1 - y, ix0 - x:ix1 - x] = self._f(p).read(
                    self.bands, window=Window(ix0 - ox, iy0 - oy, ix1 - ix0, iy1 - iy0))
        return out

    def window_transform(self, x, y):
        return self.transform * Affine.translation(x, y)


def clean_profile(profile, count, dtype):
    p = dict(profile)
    p.update(count=count, dtype=dtype, compress="deflate", nodata=None)
    for k in ("photometric", "jpeg_quality", "jpegtablesmode"):
        p.pop(k, None)
    return p


# ====================================================================== phase 1: SAM
def sam_phase(mosaic, targets, cache, conf, crop=1024, stride=512):
    """SAM 3 on half-overlapping windows over the mosaic; blended canopy evidence per tile."""
    from samgeo import SamGeo3
    sam = SamGeo3(backend="meta", model_id="facebook/sam3", confidence_threshold=conf)
    os.makedirs(cache, exist_ok=True)
    tw, th = mosaic.tw, mosaic.th
    # only windows that can influence the target tiles (tile + phase-2 margin)
    need = [(ox - PAD, oy - PAD, ox + tw + PAD, oy + th + PAD) for ox, oy in (mosaic.off[p] for p in targets)]
    touches = lambda x, y: any(x < r[2] and x + crop > r[0] and y < r[3] and y + crop > r[1] for r in need)
    xs = range(-stride, mosaic.W, stride)            # first window centred on the mosaic edge
    ys = range(-stride, mosaic.H, stride)
    wv = np.sin(np.pi * (np.arange(crop) + 0.5) / crop) ** 2
    weight = np.outer(wv, wv).astype(np.float32)     # smooth: ~0 at a window's edge, 1 in its centre
    acc, waste = {}, []
    t0, n_win = time.time(), 0

    def flush(done):
        for p in done:
            num, den = acc.pop(p)
            ev = np.where(den > 1e-3, num / np.maximum(den, 1e-6), 0)
            with rasterio.open(p) as src:                  # this tile's own georeference
                prof = clean_profile(src.profile, 1, "uint8")
            prof["transform"] = mosaic.window_transform(*mosaic.off[p])   # this tile's own grid
            with rasterio.open(f"{cache}/ev_{os.path.basename(p)}", "w", **prof) as dst:
                dst.write((np.clip(ev, 0, 1) * 255).astype(np.uint8), 1)

    for y in ys:
        for x in xs:
            if not touches(x, y):
                continue
            rgb = mosaic.read(x, y, crop, crop).transpose(1, 2, 0)
            valid = rgb.sum(-1) > 0
            if valid.mean() < 0.05:
                continue
            n_win += 1
            sam.set_image(np.ascontiguousarray(rgb))
            # canopy evidence: best score of any mask covering the pixel
            sam.generate_masks(CANOPY_PROMPT, min_size=int(0.02 / PX**2), max_size=int(3.0 / PX**2), quiet=True)
            ev = np.zeros((crop, crop), np.float32)
            for m, s in zip(sam.masks or [], sam.scores or []):
                m = np.squeeze(np.asarray(m)) > 0
                ev[m] = np.maximum(ev[m], float(s))
            for p, (ox, oy) in mosaic.off.items():
                ix0, iy0, ix1, iy1 = max(x, ox), max(y, oy), min(x + crop, ox + tw), min(y + crop, oy + th)
                if ix0 >= ix1 or iy0 >= iy1:
                    continue
                if p not in acc:
                    acc[p] = [np.zeros((th, tw), np.float32), np.zeros((th, tw), np.float32)]
                src = (slice(iy0 - y, iy1 - y), slice(ix0 - x, ix1 - x))
                dst = (slice(iy0 - oy, iy1 - oy), slice(ix0 - ox, ix1 - ox))
                acc[p][0][dst] += ev[src] * weight[src]
                acc[p][1][dst] += weight[src]
            # waste candidates, filtered here while we have the pixels
            G, B, R = [rgb[..., i].astype(np.float32) for i in (1, 2, 0)]
            greenish = ((G - B) > 35) & (G > R * 0.9)
            white = ~not_white(rgb)
            T = mosaic.window_transform(x, y)
            for prompt in WASTE_PROMPTS:
                sam.generate_masks(prompt, min_size=int(0.02 / PX**2), max_size=int(6.0 / PX**2), quiet=True)
                for m, s in zip(sam.masks or [], sam.scores or []):
                    m = np.squeeze(np.asarray(m)) > 0
                    n = m.sum()
                    if n == 0 or (m & greenish).sum() / n > 0.5:
                        continue                                  # vegetation
                    if m[:6].any() or m[-6:].any() or m[:, :6].any() or m[:, -6:].any():
                        continue                                  # cut by the window: a neighbour sees it whole
                    g = unary_union([shape(q) for q, v in shapes(m.astype(np.uint8), mask=m, transform=T) if v == 1])
                    r = g.minimum_rotated_rectangle
                    sides = sorted(np.hypot(*np.diff(np.array(r.exterior.coords)[:3], axis=0).T))
                    if (m & white).sum() / n > 0.4 and sides[0] < 0.15:
                        continue                                  # thin white = stake / vine tube
                    waste.append({"wkt": g.wkt, "score": float(s), "prompt": prompt})
        # tiles no later window can touch are complete
        flush([p for p in list(acc) if mosaic.off[p][1] + th <= y + stride])
        print(f"  SAM rows up to y={y + crop}/{mosaic.H}px, {n_win} windows, {time.time() - t0:.0f}s", flush=True)
    flush(list(acc))
    json.dump(nms(waste), open(f"{cache}/waste.json", "w"))


def nms(recs, iou=0.3):
    recs = sorted(recs, key=lambda r: -r["score"])
    kept, env = [], []
    for r in recs:
        e = wkt.loads(r["wkt"]).envelope
        if all(e.intersection(k).area / e.union(k).area < iou for k in env):
            kept.append(r)
            env.append(e)
    return kept


# ====================================================================== phase 2 pieces
def leafiness(rgb):
    """Saturation x brightness, for green-yellow hues only; plus its contrast to ~2 m around."""
    hsv = rgb2hsv(rgb)
    hue = hsv[..., 0] * 360
    hue_ok = (hue > 40) & (hue < 100)
    sv = hsv[..., 1] * hsv[..., 2] * hue_ok
    local = np.clip(sv - ndi.uniform_filter(sv, 81), 0, None)
    return sv, local, hue_ok, hsv[..., 2]


def leaf_pixels(local, hue_ok, V, band, valid, rgb, ev=None):
    """Leaves = saturated AND bright compared with their surroundings. Threshold: Otsu on the
    row-band pixels of this tile (adapts to light), clamped to a sane range. SAM evidence may
    extend a leaf into shade, but only where it is still somewhat saturated and bright."""
    sample = local[band & hue_ok & valid]
    t = float(np.clip(threshold_otsu(sample), 0.03, 0.12)) if sample.size > 1000 else 0.06
    leaf = hue_ok & (local > t) & (V > 0.25) & not_white(rgb)
    if ev is not None:
        leaf |= (ev > 0.35) & hue_ok & (local > 0.5 * t)
    leaf = ndi.binary_opening(leaf, np.ones((3, 3)))
    return ndi.binary_closing(leaf, np.ones((5, 5))), t


def split_plants(canopy, band, sv, gap_m=0.25, min_len=0.5, max_len=1.8, plant_len=1.25,
                 valley=0.6, min_area=0.02, bin_m=0.05):
    """Individual vines along each row, delimited by saturation x brightness:
      - a stretch with no leaf pixels >= 0.25 m separates two plants;
      - inside a stretch, a dip of the along-row leafiness profile below 60 % of the peaks on
        both sides (within 0.6 m) is where two canopies touch -> cut there (>= 0.5 m apart);
      - a stretch still longer than 1.8 m (continuous canopy) is cut at its weakest points near
        every ~1.25 m (the guide's planting-distance rule)."""
    stripes = label(band)
    lab = np.zeros(canopy.shape, np.int32)
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
        ax = np.linalg.svd(P - mu, full_matrices=False)[2][0]
        cy, cx = np.nonzero(sm & canopy[sl])
        if len(cy) < 30:
            continue
        t = ((np.stack([cy, cx], 1) - mu) @ ax) * PX
        b = ((t - t.min()) / bin_m).astype(int)
        prof = ndi.gaussian_filter1d(np.bincount(b, weights=sv[sl][cy, cx]), 2.0)
        occ = np.bincount(b) > 0
        runs = label(ndi.binary_closing(occ, np.ones(int(gap_m / bin_m) + 1)) | occ)
        w = int(0.6 / bin_m)
        for r in range(1, runs.max() + 1):
            bins = np.nonzero(runs == r)[0]
            a0, a1 = bins[0], bins[-1] + 1
            cuts = []
            if (a1 - a0) * bin_m > 2 * min_len:
                cand = []
                for i in range(a0 + int(min_len / bin_m), a1 - int(min_len / bin_m)):
                    lo, hi = max(a0, i - w), min(a1, i + w + 1)
                    if prof[i] > prof[lo:hi].min():
                        continue                                   # not a local minimum
                    left, right = prof[lo:i].max(), prof[i + 1:hi].max()
                    if prof[i] < valley * min(left, right):
                        cand.append((prof[i] / max(min(left, right), 1e-9), i))
                for _, i in sorted(cand):                          # deepest valleys first
                    if all(abs(i - c) * bin_m >= min_len for c in cuts):
                        cuts.append(i)
            edges = [a0] + sorted(cuts) + [a1]
            final = [edges[0]]
            for e0, e1 in zip(edges[:-1], edges[1:]):
                L = (e1 - e0) * bin_m
                if L > max_len:                                    # continuous canopy: planting distance
                    n = int(round(L / plant_len))
                    for j in range(1, n):
                        c = e0 + int((e1 - e0) * j / n)
                        hw = int(0.25 / bin_m)
                        final.append(c - hw + int(np.argmin(prof[c - hw:c + hw + 1])))
                final.append(e1)
            for e0, e1 in zip(final[:-1], final[1:]):
                s = (b >= e0) & (b < e1)
                if s.sum() * PX**2 < min_area:
                    continue
                k += 1
                lab[sl][cy[s], cx[s]] = k
    return lab


def row_axes(canopy, band, tree_body, track, split_gap_m=10.0, disrupted_gap_m=5.0, check_gap_m=1.5):
    """One axis per physical row stretch, fitted to the canopy pixels of each row stripe.
    Along-row gaps (>= 1.5 m) are classified the way the annotation guide wants:
      - crosses a grassy track       -> split, even next to a tree (a track always separates blocks)
      - under a tree                 -> row continues, row_structure = disrupted
      - plain gap >= 5 m             -> row continues, disrupted;  > 10 m -> split (headland)
    Returns [((x0, y0), (x1, y1), structure)] in padded-array pixel coords."""
    stripes = label(band)
    H, W = band.shape
    out = []
    for sid, sl in enumerate(ndi.find_objects(stripes), 1):
        if sl is None:
            continue
        sm = stripes[sl] == sid
        cy, cx = np.nonzero(sm & canopy[sl])
        if len(cy) < 200:
            continue
        C = np.stack([cy, cx], 1).astype(np.float32)
        mu = C.mean(0)
        ax = np.linalg.svd(C - mu, full_matrices=False)[2][0]
        t = np.sort((C - mu) @ ax)
        off = np.array([sl[0].start, sl[1].start], np.float32)
        pt = lambda s_: mu + ax * s_ + off                       # (row, col) in padded array
        seg_start, disrupted = t[0], False
        for g in list(np.nonzero(np.diff(t) * PX >= check_gap_m)[0]) + [None]:
            if g is not None:
                a, b_ = t[g], t[g + 1]
                L = (b_ - a) * PX
                smp = np.array([pt(s_) for s_ in np.linspace(a, b_, max(3, int(L / 0.25)))]).astype(int)
                smp = smp[(smp[:, 0] >= 0) & (smp[:, 0] < H) & (smp[:, 1] >= 0) & (smp[:, 1] < W)]
                on_track = track[smp[:, 0], smp[:, 1]].mean() if len(smp) else 0.0
                on_tree = tree_body[smp[:, 0], smp[:, 1]].mean() if len(smp) else 0.0
                if on_track < 0.15 and (on_tree > 0.3 or L <= split_gap_m):
                    disrupted |= L >= disrupted_gap_m or (on_tree > 0.3 and L >= 2.0)
                    continue                                      # same row, carries on
                end = a
            else:
                end = t[-1]
            # also cut wherever the axis runs >= 1.5 m over a track, even if grass there was
            # (wrongly) taken as canopy and left no gap
            ss = np.arange(seg_start, end, 0.25 / PX)
            smp = np.array([pt(s_) for s_ in ss]).astype(int) if len(ss) else np.zeros((0, 2), int)
            inside = (smp[:, 0] >= 0) & (smp[:, 0] < H) & (smp[:, 1] >= 0) & (smp[:, 1] < W)
            on = np.zeros(len(ss), bool)
            on[inside] = track[smp[inside, 0], smp[inside, 1]]
            runs = label(on)
            cuts = [(ss[runs == k][0], ss[runs == k][-1]) for k in range(1, int(runs.max(initial=0)) + 1)
                    if (runs == k).sum() * 0.25 >= 1.5]
            pieces, a0 = [], seg_start
            for c0, c1 in cuts:
                pieces.append((a0, c0))
                a0 = c1
            pieces.append((a0, end))
            for q0, q1 in pieces:
                if (q1 - q0) * PX >= 2.0:
                    p0, p1 = pt(q0), pt(q1)
                    out.append(((p0[1], p0[0]), (p1[1], p1[0]), "disrupted" if disrupted else "regular"))
            if g is not None:
                seg_start, disrupted = t[g + 1], False
    return out


def interrow_polygons(axes_px, T, spacing=(1.6, 3.8), max_angle_deg=8, min_overlap_m=1.0):
    """Quadrilateral between each row axis and its nearest parallel neighbour on one side,
    over the stretch both rows cover (so it ends where the shorter row ends)."""
    lines = []
    for (x0, y0), (x1, y1) in axes_px:
        p0, p1 = np.array(T * (x0, y0)), np.array(T * (x1, y1))
        d = (p1 - p0) / np.linalg.norm(p1 - p0)
        if d[0] < 0 or (d[0] == 0 and d[1] < 0):                # same direction for parallel rows
            p0, p1, d = p1, p0, -d
        lines.append((p0, p1, d))
    cos_max = np.cos(np.radians(max_angle_deg))
    polys = []
    for i, (a0, a1, d) in enumerate(lines):
        n = np.array([-d[1], d[0]])
        La = np.dot(a1 - a0, d)
        best = None
        for j, (b0, b1, e) in enumerate(lines):
            if i == j or abs(np.dot(d, e)) < cos_max:
                continue
            s = np.array([np.dot(b0 - a0, d), np.dot(b1 - a0, d)])
            o = np.array([np.dot(b0 - a0, n), np.dot(b1 - a0, n)])
            lo, hi = max(0.0, s.min()), min(La, s.max())
            om = o.mean()
            if hi - lo < min_overlap_m or not spacing[0] <= om <= spacing[1]:
                continue
            if best is None or om < best[0]:
                best = (om, lo, hi, s, o)
        if best is None:
            continue
        _, lo, hi, s, o = best
        off = lambda t: np.interp(t, np.sort(s), o[np.argsort(s)])
        polys.append(Polygon([a0 + d * lo, a0 + d * hi, a0 + d * hi + n * off(hi), a0 + d * lo + n * off(lo)]))
    return polys


def clip_to_tile(geoms, tile_box):
    out = []
    for g in geoms:
        c = g.intersection(tile_box)
        if c.is_empty:
            out.append(None)
            continue
        if c.geom_type.startswith("Multi") or c.geom_type == "GeometryCollection":
            c = max(c.geoms, key=lambda q: q.area if q.area else q.length)
        out.append(c)
    return out


def oblique_blobs(not_rows, band, min_area_m2=3.0, max_parallel_deg=20.0):
    """Tracks among the thick green blobs: a grassy inter-row is a blob running along the rows,
    a track crosses them. Keep blobs that are not elongated parallel to the row direction."""
    from skimage.measure import regionprops
    stripes = [r for r in regionprops(label(band)) if r.area > 3000]
    if not stripes:
        return ndi.binary_closing(not_rows, disk(8))
    wts = np.array([r.area for r in stripes], float)
    ang = np.array([r.orientation for r in stripes])
    row_theta = 0.5 * np.arctan2((wts * np.sin(2 * ang)).sum(), (wts * np.cos(2 * ang)).sum())
    lab = label(ndi.binary_closing(not_rows, disk(8)))
    out = np.zeros(not_rows.shape, bool)
    for r in regionprops(lab):
        if r.area * PX**2 < min_area_m2:
            continue
        d = abs(np.degrees((r.orientation - row_theta + np.pi / 2) % np.pi - np.pi / 2))
        elong = r.axis_major_length / max(r.axis_minor_length, 1.0)
        if d < max_parallel_deg and elong > 2.0:
            continue                                   # grass strip along the rows, not a track
        sl = r.slice
        out[sl] |= lab[sl] == r.label
    return out


def merge_collinear(segs, track, H, W, max_gap_m=10.0, max_off_m=0.3, max_angle_deg=3.0):
    """Join fragments of the same physical row (row bands can break into pieces), unless a track
    lies in between. Keeps the guide's rule that gaps do not split a row."""
    segs = [[np.array(a, float), np.array(b, float), st] for a, b, st in segs]
    cos_max = np.cos(np.radians(max_angle_deg))
    changed = True
    while changed:
        changed = False
        for i in range(len(segs)):
            for j in range(i + 1, len(segs)):
                a0, a1, sa = segs[i]
                b0, b1, sb = segs[j]
                d = (a1 - a0) / np.linalg.norm(a1 - a0)
                e = (b1 - b0) / np.linalg.norm(b1 - b0)
                if abs(d @ e) < cos_max:
                    continue
                n = np.array([-d[1], d[0]])
                if max(abs((b0 - a0) @ n), abs((b1 - a0) @ n)) * PX > max_off_m:
                    continue
                ta, tb = sorted([0.0, (a1 - a0) @ d]), sorted([(b0 - a0) @ d, (b1 - a0) @ d])
                gap = (max(ta[0], tb[0]) - min(ta[1], tb[1])) * PX      # < 0 means overlap
                if gap > max_gap_m:
                    continue
                if gap > 0:
                    g0 = a0 + d * min(ta[1], tb[1])
                    g1 = a0 + d * max(ta[0], tb[0])
                    smp = np.linspace(g0, g1, max(3, int(gap / 0.25))).astype(int)
                    ok = (smp[:, 0] >= 0) & (smp[:, 0] < W) & (smp[:, 1] >= 0) & (smp[:, 1] < H)
                    if ok.any() and track[smp[ok, 1], smp[ok, 0]].mean() > 0.15:
                        continue                                   # a track in between: separate rows
                lo, hi = min(ta[0], tb[0]), max(ta[1], tb[1])
                st = "disrupted" if (sa == "disrupted" or sb == "disrupted" or gap >= 5.0) else "regular"
                segs[i] = [a0 + d * lo, a0 + d * hi, st]
                segs.pop(j)
                changed = True
                break
            if changed:
                break
    return [(tuple(a), tuple(b), st) for a, b, st in segs]


def label_tile(path, mosaic, ev_mosaic, waste_all, out, conf):
    name = os.path.splitext(os.path.basename(path))[0]
    t0 = time.time()
    ox, oy = mosaic.off[path]
    tw, th = mosaic.tw, mosaic.th
    x, y = ox - PAD, oy - PAD
    rgb = mosaic.read(x, y, tw + 2 * PAD, th + 2 * PAD).transpose(1, 2, 0)
    T = mosaic.window_transform(x, y)
    T0 = mosaic.window_transform(ox, oy)
    ev = ev_mosaic.read(x, y, tw + 2 * PAD, th + 2 * PAD)[0] / 255.0 if ev_mosaic else None
    valid = rgb.sum(-1) > 0
    shape_ = valid.shape
    inner = (slice(PAD, PAD + th), slice(PAD, PAD + tw))
    b = mosaic.bounds[path]
    tile_box = box(b.left, b.bottom, b.right, b.top)

    # --- leafiness (saturation x brightness) drives rows and leaves. A vine casts a shadow right
    # next to itself, grass does not: gating leafiness by shadow proximity keeps grassy
    # inter-rows from pulling the row bands between the rows.
    sv, local, hue_ok, V = leafiness(rgb)
    dark = ndi.binary_opening((rgb.max(-1) < 80) & valid, np.ones((3, 3)))
    shadow_dist = ndi.distance_transform_edt(~dark) * PX
    rf = row_field(ndi.gaussian_filter(local * (shadow_dist < 0.5), 4), valid)
    band = (rf > 0.3) & valid

    # --- things that are green but not vines
    trees = near_trees(rgb, valid)
    relaxed = _colour(rgb, 8, 35, 95)
    blobs = thick_blobs(relaxed)
    crowns = ndi.binary_closing(blobs & near_trees(rgb, valid, radius_m=3.0), disk(10))
    shadowed = shadow_dist < 0.4
    not_rows = blobs & ~((rf > 0.6) & shadowed)        # tracks/weed patches; shadowed row centres kept
    tree_body = (ndi.distance_transform_edt(~crowns) * PX < 2.0) | near_trees(rgb, valid, radius_m=0.5)
    track = (ndi.distance_transform_edt(~oblique_blobs(not_rows, band)) * PX < 0.5) & ~crowns

    # --- leaves and plants
    leaf, t_leaf = leaf_pixels(local, hue_ok, V, band, valid, rgb, ev)
    # keep leaf clusters that touch a cast shadow (vines); drop the ones that don't (grass, weeds)
    lc = label(leaf)
    touching = np.unique(lc[(shadow_dist < 0.3) & (lc > 0)])
    leaf &= np.isin(lc, touching)
    canopy = leaf & band & ~crowns & ~not_rows & valid
    lab = split_plants(canopy, band, sv)
    vines = label_polygons(lab, T)

    # --- rows and inter-rows
    rows_px = merge_collinear(row_axes(canopy, band, tree_body, track), track, *shape_)
    quads = interrow_polygons([(a, b_) for a, b_, _ in rows_px], T)
    ir_mask = (rasterize(quads, out_shape=shape_, transform=T).astype(bool) if quads
               else np.zeros(shape_, bool)) & ~track & ~crowns & valid     # grassy inter-rows stay (interrow_cover = vegetation)

    # --- waste from phase 1
    sure, unsure = [], []
    for w in waste_all:
        g = wkt.loads(w["wkt"])
        if not tile_box.buffer(PAD * PX).intersects(g):
            continue
        (sure if w["score"] >= WASTE_SURE else unsure).append((w, g))

    # ---- label raster (padded) ----
    sem = np.full(shape_, BG, np.uint8)
    inst = np.zeros(shape_, np.uint16)
    sem[ir_mask] = INTERROW
    if vines:
        vi = rasterize([(g, k) for k, g in enumerate(vines, 1)], out_shape=shape_, transform=T, dtype="uint16")
        sem[vi > 0], inst[vi > 0] = VINE, vi[vi > 0]
    # void = "don't know", so the model is not taught our mistakes
    if band.mean() > 0.01:     # rowless tiles stay clean negatives (false-canopy penalty)
        maybe_vine = leaf & ~band & ~crowns
        sem[(ndi.distance_transform_edt(~maybe_vine) * PX < 1.0) & (sem == BG)] = VOID
        sem[(ndi.distance_transform_edt(~band) * PX < 1.5) & (sem == BG)] = VOID
    sem[(ndi.distance_transform_edt(~crowns) * PX < 1.0) & ~crowns & (sem != VINE)] = VOID
    sem[crowns] = BG                                     # tree crowns = hard negatives
    for _, g in unsure:
        sem[rasterize([g.envelope], out_shape=shape_, transform=T).astype(bool)] = VOID
    for k, (_, g) in enumerate(sure, int(inst.max()) + 1):
        m = rasterize([g], out_shape=shape_, transform=T).astype(bool)
        sem[m], inst[m] = WASTE, k
    sem[~valid] = VOID

    # ---- cut back to the tile ----
    sem, inst = sem[inner], inst[inner]
    with rasterio.open(path) as src:                   # this tile's own georeference
        prof = clean_profile(src.profile, 2, "uint16")
    prof["transform"] = T0
    with rasterio.open(f"{out}/{name}__labels.tif", "w", **prof) as dst:
        dst.write(sem.astype(np.uint16), 1)
        dst.write(inst, 2)
    ir_parts = [shape(g) for g, v in shapes((sem == INTERROW).astype(np.uint8), mask=sem == INTERROW,
                                            transform=T0) if v == 1]
    ir_parts = [g.simplify(0.05) for g in ir_parts if g.area > 0.5]
    rows_clip = clip_to_tile([LineString([T * a, T * b_]) for a, b_, _ in rows_px], tile_box)
    vines_clip = [g for g in clip_to_tile(vines, tile_box) if g is not None and g.area > 0.01]
    feats = ([{"label": "vineyard", "geometry": g} for g in vines_clip]
             + [{"label": "waste", "score": w["score"], "geometry": box(*g.bounds)}
                for w, g in sure if tile_box.contains(g.centroid)]
             + [{"label": "row", "row_structure": st, "geometry": g}
                for g, (_, _, st) in zip(rows_clip, rows_px) if g is not None and g.length >= 1.0]
             + [{"label": "interrow_area", "geometry": g} for g in ir_parts])
    if feats:
        gpd.GeoDataFrame(feats, geometry="geometry", crs=mosaic.crs).to_file(
            f"{out}/{name}__labels.geojson", driver="GeoJSON")
    rows_tile_px = [[~T0 * c for c in g.coords] for g in rows_clip if g is not None]
    quicklook(rgb[inner], sem, rows_tile_px, f"{out}/{name}__labels.png")
    counts = {"vineyard": len(vines_clip), "waste": sum(f["label"] == "waste" for f in feats),
              "row": sum(f["label"] == "row" for f in feats),
              "row_disrupted": sum(f.get("row_structure") == "disrupted" for f in feats),
              "interrow_parts": len(ir_parts), "leaf_threshold": round(t_leaf, 3)}
    share = {CLASSES.get(c, "void"): round(float((sem == c).mean()), 3) for c in (VOID, VINE, WASTE, INTERROW, BG)}
    return {"tile": name, **counts, "share": share, "sec": round(time.time() - t0, 1)}


def quicklook(rgb, sem, rows_px, path, scale=2):
    colors = {VOID: (40, 40, 40), VINE: (255, 0, 255), WASTE: (255, 40, 0), INTERROW: (0, 200, 255)}
    ov = rgb.astype(np.float32)
    for c, col in colors.items():
        m = sem == c
        ov[m] = ov[m] * 0.45 + np.array(col) * 0.55
    im = Image.fromarray(ov.astype(np.uint8)).resize((rgb.shape[1] // scale, rgb.shape[0] // scale)).convert("RGBA")
    lines = Image.new("RGBA", im.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(lines)
    for coords in rows_px:                               # thin, ~60 % opaque
        d.line([(x / scale, y / scale) for x, y in coords], fill=(255, 30, 30, 150), width=1)
    Image.alpha_composite(im, lines).convert("RGB").save(path)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--tiles-dir", default=TILES_DIR)
    ap.add_argument("--only", default="*", help='filename pattern of tiles to label, e.g. "siret3_r007_*"')
    ap.add_argument("--out", default="data/pseudo_labels")
    ap.add_argument("--no-sam", action="store_true")
    ap.add_argument("--reuse-sam", action="store_true", help="skip phase 1 if its cache exists")
    ap.add_argument("--conf", type=float, default=0.1)
    ap.add_argument("--sam-window", type=int, default=1024, help="SAM input window (px)")
    ap.add_argument("--sam-stride", type=int, default=512, help="half the window = half-overlap")
    a = ap.parse_args()

    paths = sorted(glob.glob(os.path.join(a.tiles_dir, "*.tif")))
    if not paths:
        raise SystemExit(f"no tiles in {a.tiles_dir} (run from the GeoTech-Sigmoid folder)")
    pat = a.only if a.only.endswith((".tif", "*")) else a.only + ".tif"
    targets = [p for p in paths if fnmatch.fnmatch(os.path.basename(p), pat)]
    os.makedirs(a.out, exist_ok=True)
    mosaic = Mosaic(paths)
    print(f"{len(paths)} tiles in mosaic ({mosaic.W}x{mosaic.H}px), labelling {len(targets)}")

    cache = os.path.join(a.out, "_sam_cache")
    ev_mosaic, waste_all = None, []
    if not a.no_sam:
        if not (a.reuse_sam and os.path.exists(f"{cache}/waste.json")):
            print("phase 1: SAM 3 on half-overlapping windows")
            sam_phase(mosaic, targets, cache, a.conf, a.sam_window, a.sam_stride)
        ev_paths = glob.glob(f"{cache}/ev_*.tif")
        if ev_paths:
            ev_mosaic = Mosaic(ev_paths, bands=(1,), origin=(mosaic.x0, mosaic.y0))
        waste_all = json.load(open(f"{cache}/waste.json"))

    print("phase 2: labels per tile")
    summary = []
    for p in targets:
        summary.append(label_tile(p, mosaic, ev_mosaic, waste_all, a.out, a.conf))
        print(summary[-1], flush=True)
    json.dump({"classes": {**CLASSES, VOID: "void/ignore"}, "tiles": summary},
              open(f"{a.out}/summary.json", "w"), indent=2)


if __name__ == "__main__":
    main()
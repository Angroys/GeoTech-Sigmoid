"""Row-guided vine labeller: pseudo_labels.py (teammate, unmodified) + fixes found on the full-site run.

Reuses every building block of pseudo_labels.py and replaces only label_tile() with a copy that:
  1. extends each row axis to the real end of the row — the FFT row band fades near block ends,
     so rows (and the inter-rows built between them) used to stop short of the last vines;
  2. exports one `interrow_area` polygon per pair of neighbouring rows (the annotation design),
     instead of one merged blob per block, each with `interrow_cover`
     (vegetation share < 25 % bare_soil, 25-75 % mixed, > 75 % vegetation);
  3. drops vine/row detections within 1 m of the imagery's no-data border (false vines there);
  4. drops vine polygons smaller than --min-plant-m2 (smallest real plant in the examples 0.19 m²);
  5. optionally applies tuned parameters (optimize_params.py best_params.json);
  6. joins the patchy leaf pixels of each plant into one solid, smoothed canopy shape;
  7. detects paths between vineyard blocks (leafless corridors crossing several rows, bare or
     grassy) and cuts rows there, so inter-rows are delimited by them; paths -> <tile>__paths.geojson
     (off by default: false cuts inside the GT blocks);
  8. snaps row axes onto the vine lines and inserts rows the FFT band merged/missed (grassy vineyards
     had 2x row spacing, so every other inter-row was skipped);
  9. drops rows without vines along them or at odds with the local row direction (furrows, tracks,
     field edges produced crossing inter-rows);
 10. inter-rows run from canopy edge to canopy edge (golden rule 4), not axis to axis;
 11. keeps only vines standing on a vine row (golden rule 2: weeds/shrubs off the rows dropped).

Usage (same layout as pseudo_labels.py; SAM cache from a previous pseudo_labels/optimize run):
    python vine_labeler.py --sam-cache out/_sam_cache --out v2 [--params best_params.json] [--only "siret3_r007_*"]
"""
from __future__ import annotations

import argparse
import fnmatch
import glob
import json
import multiprocessing as mp
import os
import time

import numpy as np
import rasterio
from rasterio.features import rasterize, shapes
from scipy import ndimage as ndi
from shapely import wkt
from shapely.geometry import LineString, Polygon, box, shape
from shapely.strtree import STRtree
from skimage.measure import label
from skimage.segmentation import expand_labels
from skimage.morphology import disk
import geopandas as gpd

import pseudo_labels as pl
from pseudo_labels import (BG, CLASSES, INTERROW, PAD, PX, VINE, VOID, WASTE, WASTE_SURE, _colour,
                           clean_profile, clip_to_tile, leaf_pixels, leafiness, near_trees,
                           oblique_blobs, thick_blobs)

EDGE_M = 0.0          # ignore vines/rows this close to the no-data border (1.0 cost 0.013 on the GT tiles: real vines at the mosaic edge)
EXT_STEP_M = 0.25     # row-end extension: march step
EXT_HALF_W_M = 0.35   # ... half-width of the corridor searched for leaves around the axis
EXT_MAX_GAP_M = 1.5   # ... stop after this much leafless row
EXT_MAX_M = 40.0      # ... never extend a row end by more than this
EXTEND_ROWS = True
SPLIT_AT_PATHS = False   # block-path cutting: off (made false cuts inside the GT blocks)
VINES_ON_ROWS_M = 0.6    # rule 2: a vine must lie on a vine row (centroid within this of a row axis)
IR_EDGE_PCT = 90         # rule 4: inter-row edge at this percentile of the canopy half-width per row side
IR_EDGE_TO_EDGE = True
IR_EXTEND_M = 0.0        # extend each inter-row past the two rows' overlap up to the longer row's end (<= this)
CLEAN_ROWS = True        # drop rows without vines along them / at odds with the local row angle
ROW_MIN_EVIDENCE = 0.10  # ... min fraction of canopy pixels in a +-0.2 m corridor along the row
ANGLE_TOL_DEG = 8.0      # ... max deviation from the length-weighted row angle within ANGLE_RADIUS_M
ANGLE_RADIUS_M = 20.0
REFINE_ROWS = True       # snap row axes onto the vine lines + insert rows missed between two rows
SNAP_MAX_M = 1.4         # ... search this far sideways for the vine line
FILL_MIN_EVIDENCE = 0.5  # ... inserted row needs this x the median vine evidence of detected rows
LEAF_T_SCALE = 1.0    # leaf detector (pseudo_labels.leaf_pixels rule): x Otsu threshold of leafiness contrast
LEAF_V_MIN = 0.25     # ... min brightness
LEAF_EV_THR = 0.35    # ... SAM canopy evidence that may extend a leaf into shade
LEAF_EV_FRAC = 0.5    # ... fraction of the threshold required there
SHADOW_TOUCH_M = 0.3  # leaf clusters must touch a cast shadow within this distance (vines cast shadows)
CONNECT_M = 0.45      # canopy: close gaps up to this long ALONG the row (leaves of one plant are patchy)
SMOOTH_M = 0.06       # canopy polygon smoothing (open/close by this buffer), holes filled
CANOPY_GROW_M = 0.0   # grow every plant outward by this much (no overlap between plants): the leaf
                      # detector only keeps sunlit leaves, the annotated canopy is the whole crown
CANOPY_GROW_GREEN = True  # ... only into vegetation-hued pixels
PATH_MIN_M = 2.5      # leafless stretch along a row that may be a path between vineyard blocks ...
PATH_CONFIRM = 2      # ... confirmed when this many neighbouring rows are also interrupted there
PATH_NEIGHBOUR_M = 8.0  # rows within this perpendicular distance count as neighbours
IR_KEEP_TRACK = True
DEAD_VINES = True       # leafless / dead plants on the row axis -> own label "dead_vine" (raster class DEAD)
DEAD_HALF_W_M = 0.2     # ... searched within this of the row axis
DEAD_DARK_K = 2.0       # ... darker than the corridor's soil median by k robust sigmas (trunk, cordon + its shadow)
DEAD_MIN_M2 = 0.10
DEAD_LEN_M = (0.5, 1.8)
DEAD_MIN_W_M = 0.12     # ... and at least this wide (a plant, not a wire shadow or a speck)
DEAD_CLEAR_M = 0.3      # ... this far from any leafy canopy (else it is part of a living plant or its shadow)
DEAD = 5
CANOPY_MODE = "leaf"    # "leaf": sunlit leaves over soil (Siret). "texture": hedge-trained rows over grass
                        # (Riseholme) - the canopy is the rough textured strip, the smooth grass is inter-row
TEXTURE_WIN_PX = 5
FOLIAGE_HUE = (65.0, 170.0)
FOLIAGE_S_MIN = 0.15
FOLIAGE_V_PCT = 60
FOLIAGE_MAX_FRAC = 0.45
CANOPY_MODE_BY_NAME = {}   # tile-name substring -> canopy mode (e.g. dormant season -> texture)
LEAFLESS_ROWS = False   # rows of leafless / dormant vines: row field fitted to dark stems, away from leafy rows
LEAFLESS_MIN_LEN_M = 4.0
LEAFLESS_ANGLE_DEG = 8.0
PARCELS = None        # shapely geometry of the SAM 3 vineyard parcels (--parcels): label only inside
PARCEL_BUFFER_M = 1.5  # ... grown by this much so row ends at the parcel border are not cut
BAND_DILATE_M = 0.0   # widen the FFT row band: it is fitted to shadow-gated leafiness, so it sits on the
                      # shadow side of each vine. Swept 0-0.6 m on the GT tiles: every widening scored lower, so off.



CANOPY_BORDER = (255, 230, 0)   # quicklook: outline of every plant (one canopy = one plant)


def quicklook(rgb, sem, rows_px, path, inst=None, scale=2):
    """pseudo_labels.quicklook + a coloured border around every canopy instance."""
    from PIL import Image, ImageDraw
    colors = {VOID: (40, 40, 40), VINE: (255, 0, 255), WASTE: (255, 40, 0), INTERROW: (0, 200, 255),
              DEAD: (255, 140, 0)}
    ov = rgb.astype(np.float32)
    for c, col in colors.items():
        m = sem == c
        ov[m] = ov[m] * 0.45 + np.array(col) * 0.55
    if inst is not None:
        vi = np.where((sem == VINE) | (sem == DEAD), inst, 0)
        edge = (vi > 0) & ((ndi.grey_erosion(vi, size=3) != vi) | (ndi.grey_dilation(vi, size=3) != vi))
        ov[ndi.binary_dilation(edge, iterations=scale // 2)] = CANOPY_BORDER
    im = Image.fromarray(ov.astype(np.uint8)).resize((rgb.shape[1] // scale, rgb.shape[0] // scale)).convert("RGBA")
    lines = Image.new("RGBA", im.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(lines)
    for coords in rows_px:                               # thin, ~60 % opaque
        d.line([(x / scale, y / scale) for x, y in coords], fill=(255, 30, 30, 150), width=1)
    Image.alpha_composite(im, lines).convert("RGB").save(path)

def extend_rows(rows_px, leaf, stop, max_gap_m=None):
    """March each row axis outwards from both ends while leaves continue along it.
    rows_px: [((x0, y0), (x1, y1), structure)] in padded-array px; leaf/stop: bool (H, W)."""
    max_gap_m = EXT_MAX_GAP_M if max_gap_m is None else max_gap_m
    H, W = leaf.shape
    hw = int(round(EXT_HALF_W_M / PX))
    step = EXT_STEP_M / PX
    out = []
    for (x0, y0), (x1, y1), st in rows_px:
        p0, p1 = np.array([x0, y0], float), np.array([x1, y1], float)
        L = np.linalg.norm(p1 - p0)
        if L < 1:
            out.append(((x0, y0), (x1, y1), st))
            continue
        d = (p1 - p0) / L
        n = np.array([-d[1], d[0]])
        offs = np.arange(-hw, hw + 1, 2)

        def march(p, sgn):
            last, gap, s = p.copy(), 0.0, 0.0
            while s < EXT_MAX_M / PX:
                s += step
                q = p + sgn * d * s
                pts = (q[None, :] + offs[:, None] * n[None, :]).round().astype(int)
                ok = (pts[:, 0] >= 0) & (pts[:, 0] < W) & (pts[:, 1] >= 0) & (pts[:, 1] < H)
                if not ok.all():
                    break
                if stop[pts[:, 1], pts[:, 0]].mean() > 0.5:
                    break
                if leaf[pts[:, 1], pts[:, 0]].any():
                    last, gap = q.copy(), 0.0
                else:
                    gap += EXT_STEP_M
                    if gap > max_gap_m:
                        break
            return last

        a, b = march(p0, -1), march(p1, +1)
        out.append(((a[0], a[1]), (b[0], b[1]), st))
    return out


def leaf_pixels_t(local, hue_ok, V, band, valid, rgb, ev=None):
    """pseudo_labels.leaf_pixels with its constants exposed (LEAF_* above)."""
    from skimage.filters import threshold_otsu
    sample = local[band & hue_ok & valid]
    t = float(np.clip(threshold_otsu(sample), 0.03, 0.12)) if sample.size > 1000 else 0.06
    t *= LEAF_T_SCALE
    leaf = hue_ok & (local > t) & (V > LEAF_V_MIN) & pl.not_white(rgb)
    if ev is not None:
        leaf |= (ev > LEAF_EV_THR) & hue_ok & (local > LEAF_EV_FRAC * t)
    leaf = ndi.binary_opening(leaf, np.ones((3, 3)))
    return ndi.binary_closing(leaf, np.ones((5, 5))), t


def _line_fp(length_px, angle_rad):
    """Line structuring element of the given length/angle (row direction)."""
    n = max(3, int(length_px) | 1)
    fp = np.zeros((n, n), bool)
    c = n // 2
    for t in np.linspace(-c, c, 2 * n):
        fp[int(round(c + t * np.sin(angle_rad))), int(round(c + t * np.cos(angle_rad)))] = True
    return fp


def connect_canopy(canopy, band, length_m=None):
    """Join the patchy leaf pixels of one plant: per row stripe, close along the row direction,
    then fill holes. Only gaps shorter than length_m are bridged, so plant-to-plant gaps survive."""
    length_m = CONNECT_M if length_m is None else length_m
    if length_m <= 0:
        return canopy
    out = canopy.copy()
    stripes = label(band)
    for sid, sl in enumerate(ndi.find_objects(stripes), 1):
        if sl is None:
            continue
        sm = stripes[sl] == sid
        ys, xs = np.nonzero(sm)
        if len(ys) < 500:
            continue
        P = np.stack([ys, xs], 1).astype(np.float32)
        ax = np.linalg.svd(P - P.mean(0), full_matrices=False)[2][0]          # (dy, dx)
        fp = _line_fp(length_m / PX, np.arctan2(ax[0], ax[1]))
        c = canopy[sl] & sm
        pad = fp.shape[0]
        cp = np.pad(c, pad)
        cc = ndi.binary_closing(cp, fp)[pad:-pad, pad:-pad]
        cc = ndi.binary_closing(cc, disk(2))
        out[sl] |= ndi.binary_fill_holes(cc) & ndi.binary_dilation(sm, disk(4))
    return out


def smooth_polys(polys, r=None):
    r = SMOOTH_M if r is None else r
    from shapely.geometry import Polygon as _P
    out = []
    for g in polys:
        h = g.buffer(r).buffer(-2 * r).buffer(r) if r > 0 else g
        if h.is_empty:
            h = g
        if h.geom_type == "MultiPolygon":
            h = max(h.geoms, key=lambda q: q.area)
        out.append(_P(h.exterior))
    return out


def _row_occupancy(a, b, leaf, step_px):
    """Leaf presence along a row axis (a, b in px x/y), sampled every step_px, corridor +-0.35 m."""
    H, W = leaf.shape
    a, b = np.asarray(a, float), np.asarray(b, float)
    L = np.linalg.norm(b - a)
    d = (b - a) / max(L, 1e-9)
    n = np.array([-d[1], d[0]])
    ts = np.arange(0, L, step_px)
    offs = np.arange(-int(0.35 / PX), int(0.35 / PX) + 1, 2)
    pts = (a[None, None, :] + ts[:, None, None] * d + offs[None, :, None] * n).round().astype(int)
    ok = (pts[..., 0] >= 0) & (pts[..., 0] < W) & (pts[..., 1] >= 0) & (pts[..., 1] < H)
    v = np.zeros(ok.shape, bool)
    v[ok] = leaf[pts[..., 1][ok], pts[..., 0][ok]]
    return ts, v.any(1), d, n, L


def split_rows_at_paths(rows_px, leaf, crowns, min_gap_m=None, confirm=None, neigh_m=None):
    """Paths between vineyard blocks are leafless corridors that cross several neighbouring rows.
    A gap >= min_gap_m inside a row is a path if >= `confirm` neighbouring rows are also leafless
    (or end) over the same stretch; rows are cut there, so inter-rows stop at the path too.
    Returns (rows, paths) with paths as [(p0, p1)] gap segments in px."""
    min_gap_m = PATH_MIN_M if min_gap_m is None else min_gap_m
    confirm = PATH_CONFIRM if confirm is None else confirm
    neigh_m = PATH_NEIGHBOUR_M if neigh_m is None else neigh_m
    step = 0.1 / PX
    info = []
    for a, b, st in rows_px:
        ts, occ, d, n, L = _row_occupancy(a, b, leaf, step)
        gaps = []
        if occ.any():
            runs = label(~occ)
            for k in range(1, int(runs.max(initial=0)) + 1):
                idx = np.nonzero(runs == k)[0]
                if idx[0] == 0 or idx[-1] == len(occ) - 1:
                    continue                                        # row end, not an inner gap
                if (idx[-1] - idx[0] + 1) * 0.1 >= min_gap_m:
                    gaps.append((ts[idx[0]], ts[idx[-1]]))
        info.append((np.asarray(a, float), np.asarray(b, float), st, d, n, L, occ, ts, gaps))

    def blocked(j, p0, p1):
        a, b, _, d, n, L, occ, ts, _g = info[j]
        t0, t1 = sorted([np.dot(p0 - a, d), np.dot(p1 - a, d)])
        if t1 < 0 or t0 > L:
            return True                                             # row j does not reach here: ends
        i0, i1 = int(max(t0, 0) / step), int(min(t1, L) / step)
        seg = occ[i0:i1 + 1]
        return len(seg) == 0 or seg.mean() < 0.2

    rows_out, paths = [], []
    for i, (a, b, st, d, n, L, occ, ts, gaps) in enumerate(info):
        cuts = []
        for g0, g1 in gaps:
            p0, p1 = a + d * g0, a + d * g1
            smp = np.linspace(p0, p1, 8).round().astype(int)
            smp = smp[(smp[:, 0] >= 0) & (smp[:, 0] < leaf.shape[1]) & (smp[:, 1] >= 0) & (smp[:, 1] < leaf.shape[0])]
            if len(smp) and crowns[smp[:, 1], smp[:, 0]].mean() > 0.3:
                continue                                            # a tree in the row, not a path
            votes = 0
            for j, oj in enumerate(info):
                if j == i or abs(np.dot(d, oj[3])) < np.cos(np.radians(6)):
                    continue
                dist = abs(np.dot((p0 + p1) / 2 - oj[0], oj[4])) * PX
                if 1.0 < dist <= neigh_m and blocked(j, p0, p1):
                    votes += 1
            if votes >= confirm:
                cuts.append((g0, g1))
                paths.append(((p0[0], p0[1]), (p1[0], p1[1])))
        edges = [0.0] + [v for c in cuts for v in c] + [L]
        for q0, q1 in zip(edges[0::2], edges[1::2]):
            if (q1 - q0) * PX < 2.0:
                continue
            i0, i1 = int(q0 / step), int(q1 / step)
            inner = label(~occ[i0:i1 + 1])
            dis = any((inner == k).sum() * 0.1 >= 5.0 for k in range(1, int(inner.max(initial=0)) + 1))
            st2 = "disrupted" if (dis or (st == "disrupted" and not cuts)) else "regular"
            p, q = a + d * q0, a + d * q1
            rows_out.append(((p[0], p[1]), (q[0], q[1]), st2))
    return rows_out, paths


def _line_evidence(a, d, n, L, ev, delta_px, half_w_px):
    """Mean of ev over a corridor at perpendicular offset delta_px from the axis a + t d, t in [0, L]."""
    H, W = ev.shape
    ts = np.arange(0, max(L, 1), 4.0)
    offs = np.arange(-half_w_px, half_w_px + 1, 2)
    pts = (a[None, None, :] + ts[:, None, None] * d + (delta_px + offs)[None, :, None] * n).round().astype(int)
    ok = (pts[..., 0] >= 0) & (pts[..., 0] < W) & (pts[..., 1] >= 0) & (pts[..., 1] < H)
    if not ok.any():
        return 0.0
    return float(ev[pts[..., 1][ok], pts[..., 0][ok]].mean())


def refine_rows(rows_px, vine_ev):
    """Rows found by the FFT band can sit between two vine lines (two rows merged into one stripe in
    grassy vineyards) or be missing, leaving 2x spacing -> every other inter-row was skipped.
      1. snap every axis sideways (<= SNAP_MAX_M) onto the strongest vine line;
      2. drop duplicates (parallel, < 0.8 m apart, overlapping);
      3. where two neighbouring rows are ~2x (or 3x) the local spacing apart, insert the missing
         row(s) if a vine line is really there (evidence >= FILL_MIN_EVIDENCE x median of rows).
    rows_px: [((x0, y0), (x1, y1), st)] padded px; vine_ev: float (H, W) vine evidence."""
    if len(rows_px) < 2:
        return rows_px
    hw = int(0.2 / PX)
    R = []
    for (x0, y0), (x1, y1), st in rows_px:
        a, b = np.array([x0, y0], float), np.array([x1, y1], float)
        L = np.linalg.norm(b - a)
        if L < 1:
            continue
        d = (b - a) / L
        if d[0] < 0 or (d[0] == 0 and d[1] < 0):
            a, b, d = b, a, -d
        R.append([a, b, d, np.array([-d[1], d[0]]), L, st])
    # 1. snap
    deltas = np.arange(-SNAP_MAX_M, SNAP_MAX_M + 1e-6, 0.05) / PX
    for r in R:
        a, b, d, n, L, st = r
        sc = np.array([_line_evidence(a, d, n, L, vine_ev, dl, hw) for dl in deltas])
        sc = np.convolve(sc, np.ones(3) / 3, mode="same")
        k0 = int(np.argmin(np.abs(deltas)))
        k = int(np.argmax(sc))
        if sc[k] > 1.2 * sc[k0] + 1e-6:
            r[0], r[1] = a + n * deltas[k], b + n * deltas[k]
    # 2. dedupe
    def overlap(r, q):
        s = sorted([np.dot(q[0] - r[0], r[2]), np.dot(q[1] - r[0], r[2])])
        return min(r[4], s[1]) - max(0.0, s[0])
    keep = []
    for r in sorted(R, key=lambda r: -r[4]):
        dup = any(abs(np.dot(r[2], q[2])) > np.cos(np.radians(6))
                  and abs(np.dot((r[0] + r[1]) / 2 - q[0], q[3])) * PX < 0.8 and overlap(q, r) > 0.3 * r[4]
                  for q in keep)
        if not dup:
            keep.append(r)
    R = keep
    # 3. fill missing rows
    offs = []
    for r in R:
        for q in R:
            if q is r or abs(np.dot(r[2], q[2])) < np.cos(np.radians(6)) or overlap(r, q) < 2 / PX:
                continue
            om = np.dot((q[0] + q[1]) / 2 - r[0], r[3]) * PX
            if 1.6 <= om <= 4.2:
                offs.append(om)
    if not offs:
        return [((r[0][0], r[0][1]), (r[1][0], r[1][1]), r[5]) for r in R]
    s0 = float(np.median(offs))
    base = np.median([_line_evidence(r[0], r[2], r[3], r[4], vine_ev, 0, hw) for r in R]) or 1e-6
    for _ in range(2):
        added = []
        for r in R:
            best = None
            for q in R:
                if q is r or abs(np.dot(r[2], q[2])) < np.cos(np.radians(6)):
                    continue
                om = np.mean([np.dot(q[0] - r[0], r[3]), np.dot(q[1] - r[0], r[3])]) * PX
                if om > 0.8 and (best is None or om < best[0]):
                    best = (om, q)
            if best is None:
                continue
            om, q = best
            k = int(round(om / s0))
            if k < 2 or k > 3 or abs(om - k * s0) > 0.35 * s0:
                continue
            s = sorted([np.dot(q[0] - r[0], r[2]), np.dot(q[1] - r[0], r[2])])
            lo, hi = max(0.0, s[0]), min(r[4], s[1])
            if (hi - lo) * PX < 3.0:
                continue
            for m in range(1, k):
                off = om * m / k / PX
                a = r[0] + r[2] * lo + r[3] * off
                Lm = hi - lo
                cand = [(_line_evidence(a, r[2], r[3], Lm, vine_ev, dl, hw), dl) for dl in np.arange(-0.4, 0.41, 0.05) / PX]
                e, dl = max(cand)
                if e >= FILL_MIN_EVIDENCE * base:
                    a2 = a + r[3] * dl
                    added.append([a2, a2 + r[2] * Lm, r[2], r[3], Lm, "regular"])
        if not added:
            break
        R += added
    return [((r[0][0], r[0][1]), (r[1][0], r[1][1]), r[5]) for r in R]


def clean_rows(rows_px, vine_ev):
    """Rows must be vine rows: enough canopy along the axis, and the same direction as the rows around
    them (plough furrows, tractor tracks and field edges gave rows at odd angles whose inter-rows
    crossed the real ones)."""
    if not rows_px:
        return rows_px
    hw = int(0.2 / PX)
    R = []
    for (x0, y0), (x1, y1), st in rows_px:
        a, b = np.array([x0, y0], float), np.array([x1, y1], float)
        L = np.linalg.norm(b - a)
        if L < 1:
            continue
        d = (b - a) / L
        e = _line_evidence(a, d, np.array([-d[1], d[0]]), L, vine_ev, 0, hw)
        if e < ROW_MIN_EVIDENCE:
            continue
        R.append((a, b, st, L, np.arctan2(d[1], d[0]) % np.pi, (a + b) / 2))
    out = []
    rad = ANGLE_RADIUS_M / PX
    for i, (a, b, st, L, th, m) in enumerate(R):
        w, c2, s2 = 0.0, 0.0, 0.0
        for j, (_, _, _, Lj, thj, mj) in enumerate(R):
            if np.linalg.norm(mj - m) <= rad:
                w += Lj
                c2 += Lj * np.cos(2 * thj)
                s2 += Lj * np.sin(2 * thj)
        loc = 0.5 * np.arctan2(s2, c2) % np.pi
        dev = abs((th - loc + np.pi / 2) % np.pi - np.pi / 2)
        if np.degrees(dev) <= ANGLE_TOL_DEG:
            out.append(((a[0], a[1]), (b[0], b[1]), st))
    return out


def canopy_halfwidths(rows_px, canopy, pct=None, max_m=0.9):
    """Per row: canopy extent on the -n and +n side of the axis (px), pct-th percentile of the
    perpendicular distance of canopy pixels within max_m of the axis."""
    pct = IR_EDGE_PCT if pct is None else pct
    H, W = canopy.shape
    out = []
    for (x0, y0), (x1, y1), _ in rows_px:
        a, b = np.array([x0, y0], float), np.array([x1, y1], float)
        L = np.linalg.norm(b - a)
        d = (b - a) / max(L, 1e-9)
        if d[0] < 0 or (d[0] == 0 and d[1] < 0):
            a, d = b, -d
        n = np.array([-d[1], d[0]])
        lo, hi = np.floor(np.minimum([x0, y0], [x1, y1]) - max_m / PX).astype(int), np.ceil(np.maximum([x0, y0], [x1, y1]) + max_m / PX).astype(int)
        lo, hi = np.maximum(lo, 0), np.minimum(hi, [W - 1, H - 1])
        ys, xs = np.nonzero(canopy[lo[1]:hi[1] + 1, lo[0]:hi[0] + 1])
        P = np.stack([xs + lo[0], ys + lo[1]], 1).astype(float) - a
        t, o = P @ d, P @ n
        m = (t >= 0) & (t <= L) & (np.abs(o) <= max_m / PX)
        o = o[m]
        wm = np.percentile(-o[o < 0], pct) if (o < 0).sum() > 20 else 0.3 / PX
        wp = np.percentile(o[o > 0], pct) if (o > 0).sum() > 20 else 0.3 / PX
        out.append((min(wm, max_m / PX), min(wp, max_m / PX)))
    return out


def interrow_edge_polygons(rows_px, T, canopy, spacing=(1.6, 3.8), max_angle_deg=8, min_overlap_m=1.0):
    """pseudo_labels.interrow_polygons, but the polygon runs from canopy edge to canopy edge
    (golden rule 4) instead of axis to axis: each side is pushed off its row axis by that row's
    canopy half-width on the side facing the inter-row."""
    hw = canopy_halfwidths(rows_px, canopy)
    lines = []
    for ((x0, y0), (x1, y1), _), (wm, wp) in zip(rows_px, hw):
        p0, p1 = np.array(T * (x0, y0)), np.array(T * (x1, y1))
        dd = (p1 - p0) / np.linalg.norm(p1 - p0)
        if dd[0] < 0 or (dd[0] == 0 and dd[1] < 0):
            p0, p1, dd = p1, p0, -dd
        # both frames orient d with x >= 0 (T.a > 0); the pixel y axis points down, so the +n side in
        # world coordinates is the -n side in pixels: (+n world, -n world) widths = (wm, wp)
        lines.append((p0, p1, dd, wm * abs(T.e), wp * abs(T.e)))
    cos_max = np.cos(np.radians(max_angle_deg))
    polys = []
    for i, (a0, a1, d, wa_plus, _) in enumerate(lines):
        n = np.array([-d[1], d[0]])
        La = np.dot(a1 - a0, d)
        best = None
        for j, (b0, b1, e, _, wb_minus) in enumerate(lines):
            if i == j or abs(np.dot(d, e)) < cos_max:
                continue
            s = np.array([np.dot(b0 - a0, d), np.dot(b1 - a0, d)])
            o = np.array([np.dot(b0 - a0, n), np.dot(b1 - a0, n)])
            lo, hi = max(0.0, s.min()), min(La, s.max())
            om = o.mean()
            if hi - lo < min_overlap_m or not spacing[0] <= om <= spacing[1]:
                continue
            if best is None or om < best[0]:
                best = (om, lo, hi, s, o, wb_minus)
        if best is None:
            continue
        om, lo, hi, s, o, wb_minus = best
        if IR_EXTEND_M > 0:   # the road between two rows runs to the end of the LONGER row, not only the overlap
            lo = max(min(0.0, s.min()), lo - IR_EXTEND_M)
            hi = min(max(La, s.max()), hi + IR_EXTEND_M)
        off = lambda t: np.interp(t, np.sort(s), o[np.argsort(s)])
        wa, wb = wa_plus, wb_minus
        if wa + wb > 0.8 * om:                                   # keep a strip even for bushy rows
            k = 0.8 * om / (wa + wb)
            wa, wb = wa * k, wb * k
        polys.append(Polygon([a0 + d * lo + n * wa, a0 + d * hi + n * wa,
                              a0 + d * hi + n * (off(hi) - wb), a0 + d * lo + n * (off(lo) - wb)]))
    return polys




def leafless_rows(rows_px, rgb, V, hue_ok, ok, tree_body, track):
    """Rows whose vines carry no leaves: periodic dark, non-green stems + shadows, in stripes that
    no leafy row explains. Returned rows are then treated like the others (dead_vine blobs, inter-rows)."""
    from rasterio.features import rasterize as _rz
    H, W = V.shape
    f = rgb.astype(np.float32)
    exg = (2 * f[..., 1] - f[..., 0] - f[..., 2]) / (f.sum(-1) + 1)
    soil = V[ok & ~hue_ok]
    if soil.size < 5000:
        return []
    med = np.median(soil)
    sig = 1.4826 * np.median(np.abs(soil - med)) + 1e-3
    dark = ok & (V < med - 1.5 * sig) & (exg < 0.05)
    taken = np.zeros((H, W), bool)
    if rows_px:
        taken = _rz([LineString([a, b]).buffer(1.0 / PX) for a, b, _ in rows_px], out_shape=(H, W)).astype(bool)
    dark &= ~taken
    if dark.mean() < 0.005:
        return []
    rf = pl.row_field(ndi.gaussian_filter(dark.astype(np.float32), 3), ok)
    band = (rf > 0.3) & ok & ~taken
    new = pl.merge_collinear(pl.row_axes(dark & band, band, tree_body, track), track, H, W)
    new = [r for r in new if np.hypot(r[1][0] - r[0][0], r[1][1] - r[0][1]) * PX >= LEAFLESS_MIN_LEN_M]
    if rows_px and new:     # a leafless block keeps the local row direction
        th = np.array([np.arctan2(b[1] - a[1], b[0] - a[0]) % np.pi for a, b, _ in rows_px])
        L = np.array([np.hypot(b[0] - a[0], b[1] - a[1]) for a, b, _ in rows_px])
        m = 0.5 * np.arctan2((L * np.sin(2 * th)).sum(), (L * np.cos(2 * th)).sum()) % np.pi
        dev = lambda r: abs((np.arctan2(r[1][1] - r[0][1], r[1][0] - r[0][0]) % np.pi - m + np.pi / 2) % np.pi - np.pi / 2)
        new = [r for r in new if np.degrees(dev(r)) <= LEAFLESS_ANGLE_DEG]
    return new

def dead_vines(rows_px, rgb, V, leafy, ok, T):
    """Leafless or dead plants: along each row axis, in the stretches without leaves, compact
    dark non-green blobs (bare trunk + cordon and their shadow) of plant length. Returns polygons."""
    from rasterio.features import rasterize as _rz
    H, W = V.shape
    f = rgb.astype(np.float32)
    exg = (2 * f[..., 1] - f[..., 0] - f[..., 2]) / (f.sum(-1) + 1)
    free = ok & ~(ndi.distance_transform_edt(~leafy) * PX < DEAD_CLEAR_M)
    acc = np.zeros((H, W), np.int32)
    k = 0
    for (x0, y0), (x1, y1), _ in rows_px:
        L = np.hypot(x1 - x0, y1 - y0)
        if L * PX < 2.0:
            continue
        d = np.array([x1 - x0, y1 - y0]) / L
        r = int(DEAD_HALF_W_M / PX) + 2                  # work in the row's bounding window only
        wx0, wy0 = max(int(min(x0, x1)) - r, 0), max(int(min(y0, y1)) - r, 0)
        wx1, wy1 = min(int(max(x0, x1)) + r + 1, W), min(int(max(y0, y1)) + r + 1, H)
        if wx1 <= wx0 or wy1 <= wy0:
            continue
        win = (slice(wy0, wy1), slice(wx0, wx1))
        corr = np.zeros((H, W), bool)
        corr[win] = _rz([LineString([(x0 - wx0, y0 - wy0), (x1 - wx0, y1 - wy0)]).buffer(DEAD_HALF_W_M / PX, cap_style=2)],
                        out_shape=(wy1 - wy0, wx1 - wx0)).astype(bool)
        c = corr & free
        if c.sum() < 100:
            continue
        v = V[c]
        med = np.median(v)
        sig = 1.4826 * np.median(np.abs(v - med)) + 1e-3
        dark = (c & (V < med - DEAD_DARK_K * sig) & (exg < 0.05))[win]
        dark = ndi.binary_closing(dark, _line_fp(0.3 / PX, np.arctan2(d[1], d[0])))
        dark = ndi.binary_opening(dark, disk(1)) & corr[win]
        lab_, n = ndi.label(dark)
        for sl_i, sl in enumerate(ndi.find_objects(lab_), 1):
            ys, xs = np.nonzero(lab_[sl] == sl_i)
            if len(ys) * PX ** 2 < DEAD_MIN_M2:
                continue
            ys, xs = ys + sl[0].start + wy0, xs + sl[1].start + wx0
            P = np.stack([xs, ys], 1) - np.array([x0, y0])
            t, o = P @ d, P @ np.array([-d[1], d[0]])
            if (not DEAD_LEN_M[0] <= np.ptp(t) * PX <= DEAD_LEN_M[1] or abs(np.median(o)) * PX > 0.12
                    or np.percentile(o, 90) - np.percentile(o, 10) < DEAD_MIN_W_M / PX):
                continue
            k += 1
            acc[ys, xs] = k
    if not k:
        return []
    return [g for g in smooth_polys(pl.label_polygons(acc, T)) if g.area >= DEAD_MIN_M2]

def interrow_cover(rgb, m):
    """Share of vegetation (excess-green) inside an inter-row mask -> the guide's classes."""
    if m.sum() < 50:
        return "unassessable"
    r, g, b = [rgb[..., i][m].astype(np.float32) for i in range(3)]
    s = r + g + b + 1e-6
    exg = (2 * g - r - b) / s
    veg = float((exg > 0.08).mean())
    return "bare_soil" if veg < 0.25 else ("vegetation" if veg > 0.75 else "mixed")


def label_tile(path, mosaic, ev_mosaic, waste_all, out, conf, min_plant_m2=0.2):
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
    core = ndi.binary_erosion(valid, disk(int(EDGE_M / PX)))          # [3] away from the no-data border
    shape_ = valid.shape
    inpar = np.ones(shape_, bool)
    if PARCELS is not None:   # [13] only inside the vineyard parcels: everything else is noise
        wbox = box(*rasterio.transform.array_bounds(*shape_, T))
        g = PARCELS.intersection(wbox.buffer(1.0))
        inpar = (rasterize([g], out_shape=shape_, transform=T).astype(bool) if not g.is_empty
                 else np.zeros(shape_, bool))
        core &= inpar
    inner = (slice(PAD, PAD + th), slice(PAD, PAD + tw))
    b = mosaic.bounds[path]
    tile_box = box(b.left, b.bottom, b.right, b.top)

    # ---- identical to pseudo_labels.label_tile (functions resolved through pl.* so tuned
    #      parameters injected by optimize_params.apply_params() apply here too) ----
    sv, local, hue_ok, V = leafiness(rgb)
    mode = next((v for k, v in CANOPY_MODE_BY_NAME.items() if k in name), CANOPY_MODE)
    if mode == "auto":   # green lawn alleys -> foliage colour cannot separate vines from grass -> texture
        from skimage.color import rgb2hsv
        hsv = rgb2hsv(rgb)
        ok_ = rgb.sum(-1) > 0
        fol0 = ok_ & (hsv[..., 0] * 360 > FOLIAGE_HUE[0]) & (hsv[..., 0] * 360 < FOLIAGE_HUE[1]) & (hsv[..., 1] > FOLIAGE_S_MIN)
        mode = "texture" if fol0.sum() > FOLIAGE_MAX_FRAC * max(ok_.sum(), 1) else "foliage"
    tex_mode = mode in ("texture", "foliage", "texture_nongreen")
    if mode == "foliage":   # [16b] whole foliage incl. its shaded part, not the sunlit rim; dry
        from skimage.color import rgb2hsv                   # grass alleys are yellower and brighter
        hsv = rgb2hsv(rgb)
        hue, S_, V_ = hsv[..., 0] * 360, hsv[..., 1], hsv[..., 2]
        ok_ = rgb.sum(-1) > 0
        fol = ok_ & (hue > FOLIAGE_HUE[0]) & (hue < FOLIAGE_HUE[1]) & (S_ > FOLIAGE_S_MIN) & (V_ > 0.06)
        if fol.any() and (ok_ & ~fol).any():
            fol &= V_ < np.percentile(V_[ok_ & ~fol], FOLIAGE_V_PCT)      # darker than the alley surface
        sv = local = ndi.gaussian_filter(fol.astype(np.float32), 2) * 0.2
    elif mode in ("texture", "texture_nongreen"):   # [16] grassy inter-rows are greener and brighter than the vines: use roughness instead
        g = rgb.astype(np.float32).mean(-1) / 255.0
        m1, m2 = ndi.uniform_filter(g, TEXTURE_WIN_PX), ndi.uniform_filter(g * g, TEXTURE_WIN_PX)
        tex = np.sqrt(np.clip(m2 - m1 * m1, 0, None)) * (rgb.sum(-1) > 0)
        tloc = np.clip(tex - ndi.uniform_filter(tex, 81), 0, None)
        sv = local = tloc / (np.percentile(tloc[rgb.sum(-1) > 0], 99) + 1e-6) * 0.2
        if mode == "texture_nongreen":   # dormant season: everything green is grass, vines are bare wood
            from skimage.color import rgb2hsv
            hsv_ = rgb2hsv(rgb)
            green = ((hsv_[..., 0] * 360 > FOLIAGE_HUE[0]) & (hsv_[..., 0] * 360 < FOLIAGE_HUE[1])
                     & (hsv_[..., 1] > FOLIAGE_S_MIN))
            sv = local = local * ~ndi.binary_dilation(green, disk(2))
    dark = ndi.binary_opening((rgb.max(-1) < 80) & valid, np.ones((3, 3)))
    shadow_dist = ndi.distance_transform_edt(~dark) * PX
    rf = pl.row_field(ndi.gaussian_filter(local * (True if tex_mode else shadow_dist < 0.5), 4), valid)
    band = (rf > 0.3) & valid
    relaxed = _colour(rgb, 8, 35, 95)
    blobs = thick_blobs(relaxed)
    crowns = ndi.binary_closing(blobs & near_trees(rgb, valid, radius_m=3.0), disk(10))
    shadowed = shadow_dist < 0.4
    not_rows = blobs & ~((rf > 0.6) & shadowed)
    tree_body = (ndi.distance_transform_edt(~crowns) * PX < 2.0) | near_trees(rgb, valid, radius_m=0.5)
    track = (ndi.distance_transform_edt(~oblique_blobs(not_rows, band)) * PX < 0.5) & ~crowns
    if tex_mode:
        from skimage.filters import threshold_otsu
        smp = ndi.gaussian_filter(local, 2)
        t_leaf = float(threshold_otsu(smp[band & valid])) if (band & valid).sum() > 1000 else 0.06
        leaf = ndi.binary_closing(ndi.binary_opening((smp > t_leaf) & valid, np.ones((3, 3))), np.ones((5, 5)))
    else:
        leaf, t_leaf = leaf_pixels_t(local, hue_ok, V, band, valid, rgb, ev)
    band0 = band                                   # original band: void logic below stays as before
    if BAND_DILATE_M > 0:
        band = ndi.binary_dilation(band, disk(max(1, int(round(BAND_DILATE_M / PX))))) & valid
    lc = label(leaf)
    touching = np.unique(lc[((shadow_dist < SHADOW_TOUCH_M) | tex_mode) & (lc > 0)])
    leaf &= np.isin(lc, touching)
    canopy = leaf & band & ~crowns & ~not_rows & core
    canopy_rows = canopy                              # row axes still fitted to the raw leaves
    canopy = connect_canopy(canopy, band) & ~crowns & core   # [6] one solid shape per plant
    lab = pl.split_plants(canopy, band, sv)
    if CANOPY_GROW_M > 0:   # [12] whole crown, not just the sunlit leaves; plants never overlap
        lab = expand_labels(lab, int(round(CANOPY_GROW_M / PX)))
        lab[crowns | ~core | (~hue_ok if CANOPY_GROW_GREEN else False)] = 0
        canopy = lab > 0
    vines = smooth_polys(pl.label_polygons(lab, T))
    vines = [g for g in vines if g.area >= min_plant_m2]                     # [4]

    rows_px = pl.merge_collinear(pl.row_axes(canopy_rows, band, tree_body, track), track, *shape_)
    # [1] extend to the real row end: leaves along the axis, not only inside the FFT band
    # The track mask (grass blobs + 0.5 m) is far wider than real tracks at headlands and used to
    # swallow row ends; extension follows leaf continuity instead and stops only at tree crowns,
    # a leafless gap > EXT_MAX_GAP_M, or the imagery edge.
    rows_px = extend_rows(rows_px, leaf & ~crowns & core, crowns | ~core) if EXTEND_ROWS else rows_px
    # [7] paths between vineyard blocks (bare or grassy): leafless corridors crossing several rows;
    #     rows are cut there, so inter-rows are delimited by the paths
    if REFINE_ROWS:   # [8] rows onto the vine lines, missing rows inserted
        vine_ev = ndi.uniform_filter(canopy.astype(np.float32), 5)
        rows_px = refine_rows(rows_px, vine_ev)
        if EXTEND_ROWS:   # inserted/snapped rows also run to the last vine
            rows_px = extend_rows(rows_px, leaf & ~crowns & core, crowns | ~core)
    if CLEAN_ROWS:    # [9] vine rows only, consistent direction
        if not REFINE_ROWS:
            vine_ev = ndi.uniform_filter(canopy.astype(np.float32), 5)
        rows_px = clean_rows(rows_px, vine_ev)
    if LEAFLESS_ROWS:  # [15] leafless / dormant rows (their plants become dead_vine below)
        rows_px = rows_px + leafless_rows(rows_px, rgb, V, hue_ok, valid & core & ~crowns, tree_body, track)
    paths_px = []
    if SPLIT_AT_PATHS:
        rows_px, paths_px = split_rows_at_paths(rows_px, leaf & ~crowns, crowns)
    if IR_EDGE_TO_EDGE:   # [10] canopy edge to canopy edge (golden rule 4), tuned spacing/angle kept
        kw = getattr(pl.interrow_polygons, "keywords", {}) or {}
        quads = interrow_edge_polygons(rows_px, T, canopy, **kw)
    else:
        quads = pl.interrow_polygons([(a, b_) for a, b_, _ in rows_px], T)
    if VINES_ON_ROWS_M > 0:   # [11] golden rule 2: grapevines only = vines standing on a vine row
        row_lines = [LineString([T * a, T * b_]) for a, b_, _ in rows_px]
        if row_lines:
            tree = STRtree(row_lines)
            vines = [g for g in vines if any(row_lines[k].distance(g.centroid) <= VINES_ON_ROWS_M
                                             for k in tree.query(g.centroid.buffer(VINES_ON_ROWS_M)))]
        else:
            vines = []
    dead = []
    if DEAD_VINES and rows_px:   # [14] leafless / dead plants: own class, never mixed with living canopy
        leafy = (lab > 0) | leaf
        dead = dead_vines(rows_px, rgb, V, leafy, valid & core & ~crowns, T)
    ir_id = (rasterize([(q, k) for k, q in enumerate(quads, 1)], out_shape=shape_, transform=T,
                       dtype="uint16") if quads else np.zeros(shape_, np.uint16))
    # inter-rows lie between two rows that both have leaves there, so the over-wide track mask is
    # not applied to them any more (it cut them short of the row ends)
    ir_mask = (ir_id > 0) & ~crowns & valid & inpar & (True if IR_KEEP_TRACK else ~track)

    sure, unsure = [], []
    for w in waste_all:
        g = wkt.loads(w["wkt"])
        if not tile_box.buffer(PAD * PX).intersects(g):
            continue
        (sure if w["score"] >= WASTE_SURE else unsure).append((w, g))

    sem = np.full(shape_, BG, np.uint8)
    inst = np.zeros(shape_, np.uint16)
    sem[ir_mask] = INTERROW
    if vines:
        vi = rasterize([(g, k) for k, g in enumerate(vines, 1)], out_shape=shape_, transform=T, dtype="uint16")
        sem[vi > 0], inst[vi > 0] = VINE, vi[vi > 0]
    if dead:
        di = rasterize([(g, k) for k, g in enumerate(dead, int(inst.max()) + 1)], out_shape=shape_, transform=T,
                       dtype="uint16")
        m = (di > 0) & (sem != VINE)
        sem[m], inst[m] = DEAD, di[m]
    if band0.mean() > 0.01:
        maybe_vine = leaf & ~band & ~crowns
        sem[(ndi.distance_transform_edt(~maybe_vine) * PX < 1.0) & (sem == BG)] = VOID
        sem[(ndi.distance_transform_edt(~band0) * PX < 1.5) & (sem == BG)] = VOID
    sem[(ndi.distance_transform_edt(~crowns) * PX < 1.0) & ~crowns & (sem != VINE) & (sem != DEAD)] = VOID
    sem[crowns] = BG
    for _, g in unsure:
        sem[rasterize([g.envelope], out_shape=shape_, transform=T).astype(bool)] = VOID
    for k, (_, g) in enumerate(sure, int(inst.max()) + 1):
        m = rasterize([g], out_shape=shape_, transform=T).astype(bool)
        sem[m], inst[m] = WASTE, k
    sem[~inpar & valid & (sem != WASTE)] = BG   # outside the parcels: not vineyard
    sem[~valid] = VOID

    sem_i, inst_i, ir_i, rgb_i = sem[inner], inst[inner], ir_id[inner], rgb[inner]
    with rasterio.open(path) as src:
        prof = clean_profile(src.profile, 2, "uint16")
    prof["transform"] = T0
    with rasterio.open(f"{out}/{name}__labels.tif", "w", **prof) as dst:
        dst.write(sem_i.astype(np.uint16), 1)
        dst.write(inst_i, 2)

    # [2] one inter-row polygon per neighbouring-row pair, with its cover class
    interrows = []
    for k in np.unique(ir_i[(sem_i == INTERROW)]):
        if k == 0:
            continue
        m = (sem_i == INTERROW) & (ir_i == k)
        parts = [shape(g) for g, v in shapes(m.astype(np.uint8), mask=m, transform=T0) if v == 1]
        parts = [g for g in parts if g.area > 0.5]
        if not parts:
            continue
        g = max(parts, key=lambda q: q.area).simplify(0.05)
        interrows.append((g, interrow_cover(rgb_i, m)))
    clip_box = tile_box if PARCELS is None else tile_box.intersection(PARCELS)
    rows_clip = [None if g is None or g.is_empty else g for g in
                 clip_to_tile([LineString([T * a, T * b_]) for a, b_, _ in rows_px], clip_box)]
    vines_clip = [g for g in clip_to_tile(vines, tile_box) if g is not None and g.area > 0.01]
    dead_clip = [g for g in clip_to_tile(dead, tile_box) if g is not None and g.area > 0.01]
    feats = ([{"label": "vineyard", "geometry": g} for g in vines_clip]
             + [{"label": "dead_vine", "canopy_state": "leafless_or_dead", "geometry": g} for g in dead_clip]
             + [{"label": "waste", "score": w["score"], "geometry": box(*g.bounds)}
                for w, g in sure if tile_box.contains(g.centroid)]
             + [{"label": "row", "row_structure": st, "geometry": g}
                for g, (_, _, st) in zip(rows_clip, rows_px) if g is not None and g.length >= 1.0]
             + [{"label": "interrow_area", "interrow_cover": c, "geometry": g} for g, c in interrows])
    if feats:
        gpd.GeoDataFrame(feats, geometry="geometry", crs=mosaic.crs).to_file(
            f"{out}/{name}__labels.geojson", driver="GeoJSON")
    path_lines = [g for g in clip_to_tile([LineString([T * a, T * b_]) for a, b_ in paths_px], tile_box)
                  if g is not None and g.length > 0]
    if path_lines:
        gpd.GeoDataFrame({"label": ["path"] * len(path_lines)}, geometry=path_lines, crs=mosaic.crs).to_file(
            f"{out}/{name}__paths.geojson", driver="GeoJSON")
    rows_tile_px = [[~T0 * c for c in g.coords] for g in rows_clip if g is not None]
    quicklook(rgb_i, sem_i, rows_tile_px, f"{out}/{name}__labels.png", inst_i)
    counts = {"vineyard": len(vines_clip), "dead_vine": len(dead_clip), "waste": sum(f["label"] == "waste" for f in feats),
              "row": sum(f["label"] == "row" for f in feats),
              "row_disrupted": sum(f.get("row_structure") == "disrupted" for f in feats),
              "interrow_area": len(interrows), "path_cuts": len(paths_px), "leaf_threshold": round(t_leaf, 3)}
    share = {{**CLASSES, DEAD: "dead_vine"}.get(c, "void"): round(float((sem_i == c).mean()), 3)
             for c in (VOID, VINE, WASTE, INTERROW, BG, DEAD)}
    return {"tile": name, **counts, "share": share, "sec": round(time.time() - t0, 1)}


_CTX = {}


def _one(path):
    try:
        return label_tile(path, _CTX["mosaic"], _CTX["ev"], _CTX["waste"], _CTX["out"], _CTX["conf"],
                          _CTX["min_plant"])
    except Exception as e:
        return {"tile": os.path.splitext(os.path.basename(path))[0], "error": repr(e)}


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--tiles-dir", default=pl.TILES_DIR)
    ap.add_argument("--only", default="*")
    ap.add_argument("--sam-cache", required=True, help="dir with ev_*.tif + waste.json from pseudo_labels phase 1")
    ap.add_argument("--out", required=True)
    ap.add_argument("--params", default=None, help="optimize_params best_params.json (uses best_params)")
    ap.add_argument("--min-plant-m2", type=float, default=0.2)
    ap.add_argument("--conf", type=float, default=0.2)
    ap.add_argument("--workers", type=int, default=32)
    ap.add_argument("--parcels", default=None, help="vineyard parcels (GeoJSON, mosaic CRS): label only inside")
    a = ap.parse_args(argv)

    if a.params:
        import optimize_params
        p = json.load(open(a.params))
        p = p.get("best_params", p)
        optimize_params.apply_params(p)
        a.min_plant_m2 = max(a.min_plant_m2, p.get("min_plant_m2", 0.0))
        g = globals()                                  # vine_labeler settings tuned by optimize_v3.py
        for k, v in p.items():
            if k.isupper() and k in g:
                g[k] = v
    if a.parcels:
        global PARCELS
        PARCELS = gpd.read_file(a.parcels).geometry.buffer(PARCEL_BUFFER_M).unary_union
    paths = sorted(glob.glob(os.path.join(a.tiles_dir, "*.tif")))
    pat = a.only if a.only.endswith((".tif", "*")) else a.only + ".tif"
    targets = [p for p in paths if fnmatch.fnmatch(os.path.basename(p), pat)]
    mosaic = pl.Mosaic(paths)
    evp = glob.glob(f"{a.sam_cache}/ev_*.tif")
    ev = pl.Mosaic(evp, bands=(1,), origin=(mosaic.x0, mosaic.y0)) if evp else None
    waste = json.load(open(f"{a.sam_cache}/waste.json")) if os.path.exists(f"{a.sam_cache}/waste.json") else []
    os.makedirs(a.out, exist_ok=True)
    _CTX.update(mosaic=mosaic, ev=ev, waste=waste, out=a.out, conf=a.conf, min_plant=a.min_plant_m2)
    summary = []
    with mp.get_context("fork").Pool(min(a.workers, len(targets))) as pool:
        for i, r in enumerate(pool.imap_unordered(_one, targets), 1):
            summary.append(r)
            print(f"[{i}/{len(targets)}] {r}", flush=True)
    json.dump({"classes": {**CLASSES, VOID: "void/ignore"}, "min_plant_m2": a.min_plant_m2,
               "params": a.params, "tiles": sorted(summary, key=lambda r: r["tile"])},
              open(f"{a.out}/summary.json", "w"), indent=2)


if __name__ == "__main__":
    main()

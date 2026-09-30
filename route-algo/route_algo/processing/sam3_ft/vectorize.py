"""Probability maps -> per-tile GeoJSON features in the team label schema (EPSG:32635).

Vendored from gs://marcaj-sam3-ajai-0957394607/code/ft/vectorize.py (the run3c "peaks" settings).
Deviations: works on in-memory arrays for one tile; the parcel mask is optional (without parcels
the whole tile is valid); tree-crown masking dropped; each feature gets a ``score`` (mean class
probability over its pixels). finalize_cvat.py (site-wide row/block IDs) is NOT applied here.

Per class:
  vineyard       canopy > T split into plants by a watershed from canopy-minus-plant-edge seeds
  row            row > T, skeletonised, grouped by direction, one straight line per offset peak
  interrow_area  interrow > T minus canopy/rows, one polygon per neighbouring row gap
  waste          waste > T, bounding boxes
  dead_vine      dead > T, polygons
"""

from __future__ import annotations

from itertools import pairwise
from typing import Any

import cv2
import numpy as np
from scipy import ndimage as ndi
from shapely.affinity import affine_transform
from shapely.geometry import LineString, Polygon, box, mapping
from shapely.geometry.base import BaseGeometry

PX_M = 0.025
PARCEL_BUFFER_M = 3.0
T = {"vineyard": 0.5, "plant_edge": 0.5, "row": 0.5, "interrow_area": 0.5, "waste": 0.5, "dead_vine": 0.5}
MIN_PLANT_PX = 80
MIN_SEED_PX = 8
MIN_IR_PX = 1600
MIN_WASTE_PX = 160
MIN_ROW_LEN_PX = 40
MIN_PIECE_PX = 20
ROW_ANGLE_DEG = 8.0
ROW_SEP_M = 1.2
IR_MIN_GAP_M = 1.0
IR_MAX_GAP_M = 4.5
IR_EXTEND_M = 15.0
ROW_HALF_W_PX = 12
SIMPLIFY_PX = {"vineyard": 0.7, "interrow_area": 2.0, "dead_vine": 0.7}
CLASS_IDX = {"vineyard": 0, "plant_edge": 1, "row": 2, "interrow_area": 3, "waste": 4, "dead_vine": 5}


def _contours(mask: np.ndarray, eps: float) -> list[Polygon]:
    cs, hier = cv2.findContours(mask.astype(np.uint8), cv2.RETR_CCOMP, cv2.CHAIN_APPROX_NONE)
    if hier is None:
        return []
    out: list[Polygon] = []
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


def _to_world(geom: BaseGeometry, t: Any, dx: int = 0, dy: int = 0) -> BaseGeometry:
    """Pixel (col, row) geometry offset by (dx, dy) -> world coords via rasterio Affine `t`."""
    return affine_transform(geom, [t.a, t.b, t.d, t.e, t.a * dx + t.b * dy + t.c, t.d * dx + t.e * dy + t.f])


def _row_lines(mask: np.ndarray, prob: np.ndarray) -> list[dict[str, Any]]:
    from skimage.morphology import skeletonize

    sk = skeletonize(mask)
    lab, _ = ndi.label(sk, structure=np.ones((3, 3)))
    segs = []
    for i, sl in enumerate(ndi.find_objects(lab), 1):
        ys, xs = np.nonzero(lab[sl] == i)
        if len(xs) < MIN_PIECE_PX:
            continue
        pts = np.c_[xs + sl[1].start + 0.5, ys + sl[0].start + 0.5]
        c = pts.mean(0)
        _, sv, vt = np.linalg.svd(pts - c, full_matrices=False)
        if sv[1] > 0.35 * sv[0]:
            continue
        d = vt[0] if vt[0][0] > 0 or (vt[0][0] == 0 and vt[0][1] > 0) else -vt[0]
        segs.append((pts, float(np.degrees(np.arctan2(d[1], d[0]))) % 180, len(pts)))
    lines: list[dict[str, Any]] = []
    used = np.zeros(len(segs), bool)
    for k in np.argsort([-w for _, _, w in segs]):
        if used[k]:
            continue
        a0 = segs[k][1]
        grp = [
            j
            for j in range(len(segs))
            if not used[j] and min(abs(segs[j][1] - a0), 180 - abs(segs[j][1] - a0)) <= ROW_ANGLE_DEG
        ]
        used[grp] = True
        pts = np.concatenate([segs[j][0] for j in grp])
        if len(pts) < MIN_ROW_LEN_PX:
            continue
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
        taken: list[float] = []
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
                p = pts[sel].astype(int)
                score = float(prob[p[:, 1], p[:, 0]].mean())
                lines.append(
                    {
                        "line": LineString([tuple(d * t0 + nrm * oo), tuple(d * t1 + nrm * oo)]),
                        "group": k,
                        "d": d,
                        "nrm": nrm,
                        "off": oo,
                        "t0": t0,
                        "t1": t1,
                        "score": score,
                    }
                )
    return lines


def _interrow_quads(rows: list[dict[str, Any]]) -> list[Polygon]:
    quads: list[Polygon] = []
    groups: dict[int, list[dict[str, Any]]] = {}
    for r in rows:
        groups.setdefault(r["group"], []).append(r)
    for rs in groups.values():
        rs.sort(key=lambda r: r["off"])
        gaps = np.diff([r["off"] for r in rs])
        ok = gaps[(gaps >= IR_MIN_GAP_M / PX_M) & (gaps <= IR_MAX_GAP_M / PX_M)]
        spacing = float(np.median(ok)) if len(ok) else None
        for a, b in pairwise(rs):
            gap = b["off"] - a["off"]
            if gap < IR_MIN_GAP_M / PX_M:
                continue
            k = max(1, round(gap / spacing)) if spacing else 1
            if gap / k > IR_MAX_GAP_M / PX_M:
                continue
            d, nrm = a["d"], a["nrm"]
            ext = IR_EXTEND_M / PX_M
            t0, t1 = min(a["t0"], b["t0"]) - ext, max(a["t1"], b["t1"]) + ext
            for j in range(k):
                o0, o1 = a["off"] + gap * j / k, a["off"] + gap * (j + 1) / k
                quads.append(
                    Polygon(
                        [
                            tuple(d * t0 + nrm * o0),
                            tuple(d * t1 + nrm * o0),
                            tuple(d * t1 + nrm * o1),
                            tuple(d * t0 + nrm * o1),
                        ]
                    )
                )
    return quads


def _cover(rgb: np.ndarray, poly_mask: np.ndarray) -> str:
    px = rgb[poly_mask].astype(np.float32)
    if len(px) == 0:
        return "unassessable"
    r, g, b = px[:, 0], px[:, 1], px[:, 2]
    exg = (2 * g - r - b) / (r + g + b + 1e-6)
    f = float((exg > 0.05).mean())
    return "bare_soil" if f < 0.2 else ("vegetation" if f >= 0.6 else "mixed")


def _feature(label: str, geom: BaseGeometry, score: float, **extra: Any) -> dict[str, Any]:
    props = {"class": label, "label": label, "score": round(float(score), 4)}
    props.update(extra)
    return {"type": "Feature", "properties": props, "geometry": mapping(geom)}


def vectorize(
    prob: np.ndarray,
    rgb: np.ndarray,
    transform: Any,
    valid: np.ndarray | None = None,
    disabled: frozenset[str] = frozenset(),
) -> list[dict[str, Any]]:
    """prob: (C, H, W) float in [0, 1]; rgb: (H, W, 3) uint8; transform: rasterio Affine of the tile;
    valid: optional (H, W) bool mask (e.g. rasterised vineyard parcels); disabled: classes the weights
    were not trained on (their untrained channels must never produce objects). Returns GeoJSON Features."""
    from rasterio.features import rasterize
    from skimage.segmentation import watershed

    _, H, W = prob.shape
    if valid is None:
        valid = np.ones((H, W), bool)
    m = {k: (prob[i] > T[k]) & valid if k not in disabled else np.zeros((H, W), bool) for k, i in CLASS_IDX.items()}
    feats: list[dict[str, Any]] = []

    p_vine = prob[CLASS_IDX["vineyard"]]
    vine = m["vineyard"]
    seeds, ns = ndi.label(vine & ~m["plant_edge"])
    sizes = np.bincount(seeds.ravel())
    seeds[sizes[seeds] < MIN_SEED_PX] = 0
    comp, nc = ndi.label(vine)
    orphan = np.setdiff1d(np.arange(1, nc + 1), np.unique(comp[seeds > 0]))
    if len(orphan):
        om = np.isin(comp, orphan)
        seeds[om] = comp[om] + ns
    inst = watershed(-p_vine, markers=seeds, mask=vine)
    for sl_i, sl in enumerate(ndi.find_objects(inst), 1):
        if sl is None:
            continue
        sub = inst[sl] == sl_i
        if sub.sum() < MIN_PLANT_PX:
            continue
        score = p_vine[sl][sub].mean()
        for p in _contours(np.pad(sub, 1), SIMPLIFY_PX["vineyard"]):
            geom = _to_world(p, transform, sl[1].start - 1, sl[0].start - 1)
            feats.append(_feature("vineyard", geom, score, row_structure=None, interrow_cover=None))

    rows = _row_lines(m["row"], prob[CLASS_IDX["row"]])
    ir = m["interrow_area"] & ~ndi.binary_dilation(vine, iterations=1) & ~m["row"]
    p_ir = prob[CLASS_IDX["interrow_area"]]
    claimed = np.zeros((H, W), bool)
    for q in _interrow_quads(rows):
        qm = rasterize([(q, 1)], out_shape=(H, W), dtype=np.uint8).astype(bool) & ir & ~claimed
        if qm.sum() < MIN_IR_PX:
            continue
        ys, xs = np.nonzero(qm)
        sl = (slice(ys.min(), ys.max() + 1), slice(xs.min(), xs.max() + 1))
        sub = qm[sl]
        polys = _contours(np.pad(sub, 1), SIMPLIFY_PX["interrow_area"])
        if not polys:
            continue
        p = max(polys, key=lambda g: g.area)
        claimed |= qm
        geom = _to_world(p, transform, sl[1].start - 1, sl[0].start - 1)
        feats.append(
            _feature("interrow_area", geom, p_ir[qm].mean(), row_structure=None, interrow_cover=_cover(rgb[sl], sub))
        )

    p_w = prob[CLASS_IDX["waste"]]
    lab, _ = ndi.label(m["waste"])
    for i, sl in enumerate(ndi.find_objects(lab), 1):
        sub = lab[sl] == i
        if sub.sum() < MIN_WASTE_PX:
            continue
        b = box(sl[1].start, sl[0].start, sl[1].stop, sl[0].stop)
        feats.append(
            _feature("waste", _to_world(b, transform), p_w[sl][sub].mean(), row_structure=None, interrow_cover=None)
        )

    p_d = prob[CLASS_IDX["dead_vine"]]
    lab, _ = ndi.label(m["dead_vine"] & ~vine)
    for i, sl in enumerate(ndi.find_objects(lab), 1):
        sub = lab[sl] == i
        if sub.sum() < MIN_PLANT_PX:
            continue
        score = p_d[sl][sub].mean()
        for p in _contours(np.pad(sub, 1), SIMPLIFY_PX["dead_vine"]):
            geom = _to_world(p, transform, sl[1].start - 1, sl[0].start - 1)
            feats.append(_feature("dead_vine", geom, score, row_structure=None, interrow_cover=None))

    for r in rows:
        feats.append(
            _feature("row", _to_world(r["line"], transform), r["score"], row_structure="regular", interrow_cover=None)
        )
    return feats

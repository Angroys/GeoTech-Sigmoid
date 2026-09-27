"""Model-free parts of SAM-Road's graph pipeline (TopoNet query building + edge voting).

Mirrors ``third_party/sam_road/inferencer.py::infer_one_img`` pass 2, but in
vectorised numpy and with *undirected* edge voting: the scores for ``(i, j)``
and ``(j, i)`` (from every window that sees both points) are averaged together
and each undirected edge is emitted once as ``(min, max)``.

Coordinates here are ``(x, y)`` = ``(col, row)`` pixels, as used by upstream
``graph_extraction.extract_graph_points`` and ``SAMRoad.infer_toponet``.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
import numpy.typing as npt
from scipy.spatial import KDTree

from road_extraction.windows import PixelWindow

IntArray = npt.NDArray[np.int64]
FloatArray = npt.NDArray[np.float64]
BoolArray = npt.NDArray[np.bool_]


@dataclass
class TopoQuery:
    """TopoNet inputs for one window.

    ``points`` are ``(n, 2)`` xy in *model* pixels (window-relative, scaled by
    ``model_px / window_px``); ``pairs`` ``(n, k, 2)`` index into ``points``;
    ``valid`` ``(n, k)``; ``global_idx`` ``(n,)`` maps local -> global point ids.
    """

    points: FloatArray
    pairs: IntArray
    valid: BoolArray
    global_idx: IntArray


def points_in_window(points_xy: FloatArray, win: PixelWindow) -> IntArray:
    """Indices of ``points_xy`` inside ``win`` (half-open: ``col <= x < col+width``)."""
    if len(points_xy) == 0:
        return np.zeros(0, dtype=np.int64)
    x, y = points_xy[:, 0], points_xy[:, 1]
    inside = (x >= win.col) & (x < win.col + win.width) & (y >= win.row) & (y < win.row + win.height)
    return np.nonzero(inside)[0].astype(np.int64)


def knn_pairs(points: FloatArray, k: int, radius: float) -> tuple[IntArray, BoolArray]:
    """For each point, up to ``k`` nearest *other* points within ``radius``.

    Returns ``pairs`` ``(n, k, 2)`` (src, tgt) and ``valid`` ``(n, k)``; invalid
    slots point to ``src`` itself, exactly like upstream.
    """
    n = len(points)
    if n == 0:
        return np.zeros((0, k, 2), dtype=np.int64), np.zeros((0, k), dtype=bool)
    _, idx = KDTree(points).query(points, k=k + 1, distance_upper_bound=radius)
    idx = np.asarray(idx).reshape(n, k + 1)
    # drop self: upstream drops column 0; do it robustly for duplicate points too
    src = np.arange(n)[:, None]
    nbr = np.where(idx == src, n, idx)
    nbr = np.sort(nbr, axis=1)[:, :k]  # self (-> n) sorts last; order is irrelevant to TopoNet
    valid = nbr < n
    tgt = np.where(valid, nbr, np.broadcast_to(src, nbr.shape))
    pairs = np.stack([np.broadcast_to(src, tgt.shape), tgt], axis=-1).astype(np.int64)
    return pairs, valid


def build_query(points_xy: FloatArray, win: PixelWindow, model_px: int, k: int, radius_model_px: float) -> TopoQuery:
    """TopoNet query for the points falling in ``win`` (radius in model pixels)."""
    gidx = points_in_window(points_xy, win)
    scale = model_px / win.width
    local = (points_xy[gidx] - np.array([[win.col, win.row]], dtype=np.float64)) * scale
    pairs, valid = knn_pairs(local, k, radius_model_px)
    return TopoQuery(points=local, pairs=pairs, valid=valid, global_idx=gidx)


def collate(queries: list[TopoQuery], k: int) -> tuple[FloatArray, IntArray, BoolArray]:
    """Pad a batch of queries to a common ``n`` -> ``points[B,n,2]``, ``pairs[B,n,k,2]``, ``valid[B,n,k]``."""
    n = max((len(q.points) for q in queries), default=0)
    b = len(queries)
    pts = np.zeros((b, n, 2), dtype=np.float32)
    pairs = np.zeros((b, n, k, 2), dtype=np.int64)
    valid = np.zeros((b, n, k), dtype=bool)
    for i, q in enumerate(queries):
        m = len(q.points)
        pts[i, :m] = q.points
        pairs[i, :m] = q.pairs
        valid[i, :m] = q.valid
    return pts.astype(np.float64), pairs, valid


@dataclass
class EdgeVotes:
    """Accumulates TopoNet scores per undirected edge across windows."""

    sums: dict[tuple[int, int], float] = field(default_factory=dict)
    counts: dict[tuple[int, int], int] = field(default_factory=dict)

    def add(self, query: TopoQuery, scores: FloatArray) -> None:
        """Add ``scores`` ``(n', k)`` (n' >= n, padded rows ignored) for ``query``."""
        n = len(query.points)
        if n == 0:
            return
        sc = np.asarray(scores, dtype=np.float64)[:n]
        v = query.valid
        src = query.global_idx[query.pairs[..., 0][v]]
        tgt = query.global_idx[query.pairs[..., 1][v]]
        s = sc[v]
        a, b = np.minimum(src, tgt), np.maximum(src, tgt)
        for i, j, val in zip(a.tolist(), b.tolist(), s.tolist(), strict=True):
            if i == j:
                continue
            key = (i, j)
            self.sums[key] = self.sums.get(key, 0.0) + val
            self.counts[key] = self.counts.get(key, 0) + 1

    def result(self, threshold: float) -> tuple[IntArray, FloatArray]:
        """Edges ``(E, 2)`` with mean score ``> threshold`` and their scores ``(E,)``."""
        keys = sorted(self.sums)
        if not keys:
            return np.zeros((0, 2), dtype=np.int64), np.zeros(0, dtype=np.float64)
        mean = np.array([self.sums[kk] / self.counts[kk] for kk in keys])
        e = np.array(keys, dtype=np.int64).reshape(-1, 2)
        keep = mean > threshold
        return e[keep], mean[keep]

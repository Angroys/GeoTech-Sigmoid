from __future__ import annotations

import numpy as np

from road_extraction.topo import EdgeVotes, build_query, collate, knn_pairs, points_in_window
from road_extraction.windows import PixelWindow


def test_points_in_window_half_open() -> None:
    pts = np.array([[0, 0], [9.9, 5], [10, 5], [5, 10]], dtype=float)
    assert points_in_window(pts, PixelWindow(0, 0, 10, 10)).tolist() == [0, 1]


def test_knn_pairs_radius_and_self() -> None:
    pts = np.array([[0, 0], [3, 0], [100, 0]], dtype=float)
    pairs, valid = knn_pairs(pts, k=2, radius=10)
    assert pairs.shape == (3, 2, 2) and valid.shape == (3, 2)
    assert (pairs[..., 0] == np.arange(3)[:, None]).all()
    assert valid.sum() == 2  # 0<->1 only; 2 is isolated
    assert {tuple(p) for p in pairs[valid].tolist()} == {(0, 1), (1, 0)}
    # invalid slots point to self
    assert (pairs[~valid][:, 1] == pairs[~valid][:, 0]).all()


def test_build_query_scales_to_model_px() -> None:
    pts = np.array([[110, 220], [150, 220], [400, 400]], dtype=float)
    q = build_query(pts, PixelWindow(200, 100, 128, 128), model_px=256, k=4, radius_model_px=200)
    assert q.global_idx.tolist() == [0, 1]
    np.testing.assert_allclose(q.points, [[20, 40], [100, 40]])


def test_collate_pads() -> None:
    a = build_query(np.array([[1, 1], [2, 2]], float), PixelWindow(0, 0, 10, 10), 10, 3, 5)
    b = build_query(np.array([[50, 50]], float), PixelWindow(0, 0, 10, 10), 10, 3, 5)
    pts, pairs, valid = collate([a, b], 3)
    assert pts.shape == (2, 2, 2) and pairs.shape == (2, 2, 3, 2) and valid.shape == (2, 2, 3)
    assert not valid[1].any()


def test_edge_votes_undirected_average_and_threshold() -> None:
    pts = np.array([[0, 0], [5, 0], [10, 0]], dtype=float)
    win = PixelWindow(0, 0, 20, 20)
    q = build_query(pts, win, 20, 2, 6)  # 0-1 and 1-2 are neighbours; 0-2 too far
    votes = EdgeVotes()
    scores = np.zeros(q.valid.shape)
    for s in range(3):
        for j in range(2):
            if q.valid[s, j]:
                t = q.pairs[s, j, 1]
                scores[s, j] = 0.9 if {s, t} == {0, 1} else 0.4
    votes.add(q, scores)
    votes.add(q, np.pad(scores, ((0, 2), (0, 0))))  # padded rows ignored
    edges, sc = votes.result(0.5)
    assert edges.tolist() == [[0, 1]]
    np.testing.assert_allclose(sc, [0.9])
    assert votes.counts[(0, 1)] == 4  # both directions x 2 windows

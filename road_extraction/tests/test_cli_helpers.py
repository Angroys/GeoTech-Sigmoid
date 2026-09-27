"""CLI wiring + small helpers added for the extraction CLI (no model is loaded)."""

from __future__ import annotations

import numpy as np
from affine import Affine
from PIL import Image
from shapely.geometry import LineString

from road_extraction import extract_roads
from road_extraction.geo import crop_raster, pixel_to_crs
from road_extraction.graph import edges_to_graph, graph_to_lines, prune_spurs
from road_extraction.render import blend_overlay, block_reduce_mean, render_overlay


def test_parser_defaults_and_subset_args(tmp_path) -> None:
    args = extract_roads.build_parser().parse_args(
        ["--tiles-dir", str(tmp_path), "--rows", "20:24", "--tiles", "r20_c12", "--scale", "20"]
    )
    assert args.model == extract_roads.DEFAULT_MODEL
    assert args.rows == (20, 24) and args.scale == 20 and args.gsd is None
    assert str(args.out_dir).endswith("data/road")


def test_crop_raster_transform_and_clamp() -> None:
    arr = np.arange(100).reshape(10, 10)
    tf = Affine(0.5, 0, 1000, 0, -0.5, 2000)
    sub, stf = crop_raster(arr, tf, slice(2, 5), slice(3, 6), margin=1)
    assert sub.shape == (5, 5) and sub[0, 0] == arr[1, 2]
    assert pixel_to_crs(stf, 0, 0) == pixel_to_crs(tf, 1, 2)
    sub2, stf2 = crop_raster(arr, tf, slice(0, 3), slice(8, 10), margin=4)
    assert sub2.shape == (7, 6) and stf2.c == tf.c + 4 * 0.5 and stf2.f == tf.f


def test_edges_to_graph_merges_chain() -> None:
    nodes = np.array([[0, 0], [0, 10], [0, 20], [10, 20]], dtype=float)
    edges = np.array([[0, 1], [1, 0], [1, 2], [2, 3], [3, 3]])
    g = edges_to_graph(nodes, edges)
    assert g.number_of_edges() == 3  # duplicate + self-loop dropped
    g = prune_spurs(g, 0)
    assert g.number_of_edges() == 1  # degree-2 nodes contracted into one polyline
    (line,) = graph_to_lines(g, Affine.identity(), simplify_px=0)
    assert abs(line.length - 30) < 1e-9


def test_render_helpers() -> None:
    rgb = np.zeros((4, 4, 3), np.uint8)
    out = blend_overlay(rgb, np.full((4, 4), 1.0), (200, 0, 0))
    assert out[0, 0].tolist() == [200, 0, 0]
    assert block_reduce_mean(np.eye(4), 2).tolist() == [[0.5, 0.0], [0.0, 0.5]]
    img = render_overlay(
        np.zeros((8, 8, 3), np.uint8),
        Affine(1, 0, 0, 0, -1, 8),
        lines=[LineString([(0, 4), (8, 4)])],
        min_side=16,
        line_width=1,
    )
    assert isinstance(img, Image.Image) and img.size == (16, 16)
    arr = np.asarray(img)
    assert arr[8].any() and not arr[0].any()

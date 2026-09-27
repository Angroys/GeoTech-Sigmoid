from __future__ import annotations

import json

import numpy as np
import pytest
from affine import Affine
from shapely.geometry import LineString, Point

from road_extraction.geo import pixel_to_crs
from road_extraction.graph import (
    clip_lines,
    edges_to_lines,
    graph_to_lines,
    lines_to_feature_collection,
    mask_to_graph,
    mask_to_skeleton,
    prune_spurs,
    skeleton_to_graph,
    write_geojson,
)

T = Affine(1.0, 0.0, 629000.0, 0.0, -1.0, 5221000.0)  # 1 m/px, UTM 35N


def _crs(r: float, c: float) -> tuple[float, float]:
    x, y = pixel_to_crs(T, r, c)
    return float(x), float(y)


def _endpoints(lines: list[LineString]) -> set[tuple[int, int]]:
    return {(round(p[0]), round(p[1])) for ln in lines for p in (ln.coords[0], ln.coords[-1])}


def _cross(width: int) -> np.ndarray:
    m = np.zeros((101, 101), dtype=bool)
    h = width // 2
    m[50 - h : 50 + h + 1, 10:91] = True
    m[10:91, 50 - h : 50 + h + 1] = True
    return m


def test_thin_cross_to_four_lines() -> None:
    g = mask_to_graph(_cross(1))
    assert g.number_of_nodes() == 5 and g.number_of_edges() == 4
    lines = graph_to_lines(g, T)
    assert len(lines) == 4
    assert sum(ln.length for ln in lines) == pytest.approx(160.0, abs=1e-6)
    centre = Point(_crs(50, 50))
    for ln in lines:
        assert min(Point(ln.coords[0]).distance(centre), Point(ln.coords[-1]).distance(centre)) < 1e-6
    expected = {_crs(50, 10), _crs(50, 90), _crs(10, 50), _crs(90, 50), _crs(50, 50)}
    assert _endpoints(lines) == {(round(x), round(y)) for x, y in expected}


def test_thick_cross_spurs_pruned() -> None:
    g = mask_to_graph(_cross(7).astype(np.float32) * 0.9, threshold=0.5, min_spur_px=8)
    lines = graph_to_lines(g, T, simplify_px=1.0)
    assert len(lines) == 4
    degs = sorted(d for _, d in g.degree())
    assert degs == [1, 1, 1, 1, 4]
    centre = Point(_crs(50, 50))
    assert all(min(Point(ln.coords[0]).distance(centre), Point(ln.coords[-1]).distance(centre)) < 3 for ln in lines)
    assert 140 < sum(ln.length for ln in lines) < 170


def test_l_shape_is_one_line() -> None:
    m = np.zeros((60, 60), dtype=bool)
    m[10:51, 10] = True  # vertical leg
    m[50, 10:51] = True  # horizontal leg
    g = mask_to_graph(m)
    assert g.number_of_edges() == 1
    (line,) = graph_to_lines(g, T, simplify_px=0.5)
    assert len(line.coords) <= 4  # endpoint - (skeletonize may bevel the corner) - endpoint
    assert {tuple(np.round(line.coords[0])), tuple(np.round(line.coords[-1]))} == {
        tuple(np.round(_crs(10, 10))),
        tuple(np.round(_crs(50, 50))),
    }
    assert line.distance(Point(_crs(50, 10))) < 1.5
    assert line.length == pytest.approx(80.0, abs=1.0)


def test_loop_and_small_objects() -> None:
    m = np.zeros((40, 40), dtype=bool)
    m[5, 5:30] = m[25, 5:30] = True
    m[5:26, 5] = m[5:26, 29] = True  # closed square ring
    m[35, 35] = True  # speck
    g = skeleton_to_graph(mask_to_skeleton(m, min_object_px=3))
    assert g.number_of_edges() == 1
    (line,) = graph_to_lines(g, T, simplify_px=0)
    assert line.is_closed and 80 < line.length <= 4 * 24  # corners may be bevelled


def test_prune_min_component() -> None:
    m = np.zeros((30, 60), dtype=bool)
    m[5, 5:55] = True
    m[20, 5:10] = True
    g = prune_spurs(skeleton_to_graph(m), 0, min_component_px=10)
    assert g.number_of_edges() == 1


def test_edges_to_lines_rc_and_xy() -> None:
    pts_rc = np.array([[10.0, 20.0], [10.0, 40.0], [30.0, 40.0], [30.0, 40.0]])
    edges = np.array([[0, 1], [1, 2], [2, 3]])  # last one degenerate
    lines = edges_to_lines(pts_rc, edges, T)
    assert len(lines) == 2
    assert lines[0].coords[0] == pytest.approx(_crs(10, 20))
    assert lines[1].coords[-1] == pytest.approx(_crs(30, 40))
    lines_xy = edges_to_lines(pts_rc[:, ::-1], edges, T, order="xy")
    assert [ln.coords[:] for ln in lines_xy] == [ln.coords[:] for ln in lines]


def test_geojson_crs_and_coords(tmp_path) -> None:
    lines = graph_to_lines(mask_to_graph(_cross(1)), T)
    fc = lines_to_feature_collection(lines, properties={"source": "test"})
    assert fc["crs"] == {"type": "name", "properties": {"name": "urn:ogc:def:crs:EPSG::32635"}}
    p = write_geojson(tmp_path / "x" / "roads.geojson", lines, properties={"tile": "r005_c004"})
    data = json.loads(p.read_text())
    assert data["type"] == "FeatureCollection" and len(data["features"]) == 4
    f0 = data["features"][0]
    assert f0["geometry"]["type"] == "LineString"
    assert f0["properties"]["tile"] == "r005_c004" and f0["properties"]["length_m"] == pytest.approx(40.0)
    for x, y in (c for f in data["features"] for c in f["geometry"]["coordinates"]):
        assert 629000 <= x <= 629101 and 5220899 <= y <= 5221000  # UTM metres, not degrees


def test_per_feature_properties() -> None:
    lines = [LineString([(0, 0), (1, 0)]), LineString([(0, 0), (0, 2)])]
    fc = lines_to_feature_collection(lines, properties=[{"a": 1}, {"a": 2}])
    assert [f["properties"]["a"] for f in fc["features"]] == [1, 2]
    assert fc["features"][1]["properties"]["length_m"] == 2.0


def test_clip_lines_to_tile_bounds() -> None:
    lines = [
        LineString([(0, 5), (20, 5)]),  # crosses the box
        LineString([(2, 2), (8, 8)]),  # fully inside
        LineString([(20, 20), (30, 30)]),  # outside
        LineString([(0, 1), (5, 1), (5, 20), (7, 20), (7, 1), (12, 1)]),  # leaves and re-enters -> 2 parts
    ]
    out = clip_lines(lines, (0.0, 0.0, 10.0, 10.0))
    assert len(out) == 4
    assert out[0].coords[:] == [(0.0, 5.0), (10.0, 5.0)]
    assert all(0 <= x <= 10 and 0 <= y <= 10 for ln in out for x, y in ln.coords)
    assert sum(ln.length for ln in out[2:]) == pytest.approx(5 + 9 + 9 + 3)

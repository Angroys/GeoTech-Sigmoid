import math
import subprocess
import sys

import pytest
from fastapi.testclient import TestClient
from shapely.affinity import rotate, translate
from shapely.geometry import LineString, Point, box, mapping, shape

from route_algo.api import app
from route_algo.geometry import PlanningError, WalkingNetwork, walkable_geometry
from route_algo.models import PlanRequest
from route_algo.planner import plan_route


def collection(*items):
    return {"type": "FeatureCollection", "features": [
        {"type": "Feature", "geometry": mapping(geom), "properties": props}
        for geom, props in items
    ]}


def request(**changes):
    data = {
        "crs": "EPSG:32635", "start": [1, 1], "solver_seconds": 1,
        "interrows": collection((box(0, 0, 20, 10), {})),
        "inspection_points": collection((Point(19, 1), {"point_id": "far"})),
    }
    data.update(changes)
    return PlanRequest.model_validate(data)


def route_of(result):
    return shape(result["route"]["features"][0]["geometry"])


def test_utm_boundary_roundoff_is_repaired_inward_without_moving_start():
    area = box(629000, 5220000, 629020, 5220010)
    network = WalkingNetwork(area)
    start = Point(629001, 5220001)
    start_node = network.attach(start)
    rounded_projection = Point(629010, 5220000 - 1e-9)
    assert not area.covers(rounded_projection)
    with pytest.raises(PlanningError):
        network.attach(rounded_projection)  # An invalid requested start stays invalid.
    target_node = network.attach(rounded_projection, allow_boundary_nudge=True)
    repaired = Point(network.positions[target_node])
    assert repaired.distance(rounded_projection) < 2e-6
    assert network.positions[start_node] == tuple(start.coords[0])
    assert area.covers(LineString(network.path(start_node, target_node)))
    for neighbour in network.graph.neighbors(target_node):
        assert area.covers(LineString([network.positions[target_node], network.positions[neighbour]]))


def test_closed_detour_avoids_forbidden_and_canopies():
    req = request(
        forbidden=collection((box(8, 0, 12, 8), {})),
        canopy=collection((box(2, 2, 4, 4), {})),
    )
    result = plan_route(req)
    line = route_of(result)
    assert tuple(line.coords[0]) == tuple(line.coords[-1]) == req.start
    assert line.length > 36  # Straight return route would cross the obstacle.
    assert walkable_geometry(req).covers(line)
    assert result["report"]["visited_count"] == 1
    assert result["report"]["outside_length_m"] == 0
    assert math.isclose(result["route"]["features"][0]["properties"]["length_m"], line.length)


def test_disconnected_targets_are_reported_and_not_snapped_across_gap():
    req = request(
        interrows=collection((box(0, 0, 5, 5), {}), (box(10, 0, 20, 5), {})),
        inspection_points=collection((Point(19, 1), {"point_id": "isolated"})),
    )
    result = plan_route(req)
    assert result["report"]["visited_count"] == 0
    assert result["report"]["targets"][0]["reachable"] is False
    assert result["route"] is None
    assert result["report"]["closed"] is False


def test_two_metre_approach_and_incidental_stop_order():
    req = request(inspection_points=collection(
        (Point(19, 1), {"point_id": "far"}),
        (Point(1, -1), {"point_id": "at-start"}),
        (Point(1, -2.01), {"point_id": "too-far"}),
    ))
    result = plan_route(req)
    props = result["route"]["features"][0]["properties"]
    assert props["stop_ids"][0] == "at-start"
    assert props["stop_distances_m"][0] == 0
    assert "too-far" not in props["stop_ids"]
    assert result["report"]["coverage_ratio"] == pytest.approx(2 / 3)
    assert props["stop_distances_m"] == sorted(props["stop_distances_m"])


def test_authorised_passage_connects_narrow_corridors():
    req = request(
        start=[1, 0.1],
        interrows=collection((box(0, 0, 10, 0.2), {}), (box(0, 2, 10, 2.2), {})),
        passages=collection((box(9.8, 0, 10.2, 2.2), {})),
        inspection_points=collection((Point(1, 2.1), {"point_id": "other-aisle"})),
    )
    result = plan_route(req)
    assert result["report"]["visited_count"] == 1
    assert walkable_geometry(req).covers(route_of(result))
    assert route_of(result).length > 15
    assert result["map"]["supplied_passages"]["features"] == req.passages.features
    assert result["report"]["outside_blocks_length_m"] is None


def test_block_crossing_is_context_not_a_route_violation():
    req = request(
        start=[1, 1],
        interrows=collection((box(0, 0, 5, 2), {})),
        passages=collection((box(5, 0, 12, 2), {})),
        blocks=collection((box(0, 0, 5, 2), {"vineyard_id": "v1"})),
        inspection_points=collection((Point(11, 1), {"point_id": "on-passage"})),
    )
    result = plan_route(req)
    assert result["report"]["outside_length_m"] == 0
    assert result["report"]["outside_blocks_length_m"] > 0
    evidence_kinds = {feature["properties"]["kind"] for feature in result["map"]["route_evidence"]["features"]}
    assert evidence_kinds == {"outside_blocks"}


def test_waste_mode_excludes_inspection_targets():
    req = request(purpose="waste_collection", waste=collection((box(4, 0, 6, 2), {"waste_id": "waste"})))
    result = plan_route(req)
    assert result["route"]["features"][0]["properties"]["stop_ids"] == ["waste"]
    assert result["report"]["target_count"] == 1


def test_empty_targets_returns_no_route_without_fake_coverage():
    result = plan_route(request(inspection_points=collection()))
    assert result["route"] is None
    assert result["report"]["coverage_ratio"] is None


def test_rotated_utm_corridor_and_boundary_approach():
    def world(geometry):
        return translate(rotate(geometry, 31, origin=(0, 0)), xoff=629500, yoff=5220250)

    req = request(
        start=list(world(Point(1, 1)).coords[0]),
        interrows=collection((world(box(0, 0, 40, 2)), {})),
        inspection_points=collection((world(Point(35, 3.5)), {"point_id": "near-edge"})),
    )
    result = plan_route(req)
    assert result["report"]["visited_count"] == 1
    assert result["report"]["outside_length_m"] < 1e-6
    assert result["report"]["targets"][0]["approach_distance_m"] == pytest.approx(1.5)


def test_per_collection_crs_cannot_override_request_crs():
    interrows = collection((box(0, 0, 20, 10), {}))
    interrows["crs"] = {"type": "name", "properties": {"name": "EPSG:4326"}}
    with pytest.raises(PlanningError, match="EPSG:32635"):
        plan_route(request(interrows=interrows))


@pytest.mark.parametrize("changes, message", [
    ({"start": [-1, 1]}, "starting point"),
    ({"study_area": collection((box(5, 0, 20, 10), {}))}, "starting point"),
    ({"inspection_points": collection((Point(2, 2), {"point_id": "x"}), (Point(3, 3), {"point_id": "x"}))}, "unique"),
    ({"interrows": {"type": "FeatureCollection", "features": [{"type": "Feature", "geometry": None}]}}, "interrows"),
])
def test_rejects_invalid_input(changes, message):
    with pytest.raises(PlanningError, match=message):
        plan_route(request(**changes))


def test_api_contract_and_validation(monkeypatch, tmp_path):
    client = TestClient(app)
    response = client.post("/plan", json=request().model_dump())
    assert response.status_code == 200
    assert response.json()["route"]["crs"]["properties"]["name"].endswith("32635")
    assert response.json()["map"]["route_evidence"]["crs"]["properties"]["name"].endswith("32635")
    assert client.post("/plan", json={"crs": "EPSG:4326"}).status_code == 422
    assert client.post("/plan", json=request(start=[-1, 1]).model_dump()).status_code == 422
    monkeypatch.setenv("ROUTE_CONSTRAINTS_DIR", str(tmp_path))
    missing = client.post("/plan", json=request(constraint_set="siret3").model_dump())
    assert missing.status_code == 503


def test_cli_does_not_leave_stale_route_when_no_targets_are_reachable(tmp_path):
    input_file = tmp_path / "request.json"
    input_file.write_text(request(inspection_points=collection()).model_dump_json())
    output = tmp_path / "output"
    output.mkdir()
    (output / "route.geojson").write_text("stale route")
    result = subprocess.run(
        [sys.executable, "-m", "route_algo", str(input_file), "--output", str(output)],
        capture_output=True, text=True,
    )
    assert result.returncode == 2
    assert "No route available" in result.stdout
    assert not (output / "route.geojson").exists()
    assert (output / "report.json").exists()


def headland_request(**changes):
    values = {
        "start": [1, 1],
        "interrows": collection((box(4.5, 4, 11.5, 16), {}), (box(12.5, 4, 19.5, 16), {})),
        "passages": collection((box(0, 0, 24, 2), {})),
        "blocks": collection((box(0, 0, 24, 20), {"vineyard_id": "v1"})),
        "rows": collection(*[(LineString([(x, 4), (x, 16)]), {"vineyard_id": "v1"}) for x in (4, 12, 20)]),
        "inspection_points": collection((Point(8, 10), {"point_id": "left"}), (Point(16, 10), {"point_id": "right"})),
    }
    values.update(changes)
    return request(**values)


def test_inferred_headlands_are_opt_in_and_measure_departure_from_supplied_areas():
    supplied = plan_route(headland_request())
    assert supplied["route"] is None
    demo = plan_route(headland_request(path_mode="demo_headlands"))
    assert demo["report"]["visited_count"] == 2
    assert demo["report"]["outside_length_m"] < 1e-6
    assert demo["report"]["outside_supplied_length_m"] > 0
    assert demo["report"]["path_mode"] == "demo_headlands"
    assert demo["route"]["features"][0]["properties"]["path_mode"] == "demo_headlands"
    assert "not validated" in demo["report"]["warnings"][0]
    assert demo["map"]["inferred_headlands"]["features"]
    evidence_kinds = {feature["properties"]["kind"] for feature in demo["map"]["route_evidence"]["features"]}
    assert "outside_supplied" in evidence_kinds
    assert "outside_permitted" not in evidence_kinds
    assert demo["report"]["outside_study_area_length_m"] is None


def test_inferred_headlands_cannot_cross_forbidden_land():
    forbidden = box(10, 0, 14, 20)
    demo = plan_route(headland_request(path_mode="demo_headlands", forbidden=collection((forbidden, {}))))
    assert demo["report"]["visited_count"] == 1
    assert route_of(demo).intersection(forbidden).length == 0
    assert demo["report"]["targets"][1]["reachable"] is False


def test_demo_requires_block_and_row_geometry():
    with pytest.raises(PlanningError, match="block polygons and row axes"):
        plan_route(request(path_mode="demo_headlands"))

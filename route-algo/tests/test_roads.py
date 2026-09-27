import json

from fastapi.testclient import TestClient
from shapely.geometry import LineString, Point, box, mapping, shape

from route_algo import api
from route_algo.models import PlanRequest
from route_algo.sam3c import load_request

CRS = {"type": "name", "properties": {"name": "urn:ogc:def:crs:EPSG::32635"}}


def collection(*geoms, **props):
    return {"type": "FeatureCollection", "crs": CRS, "features": [
        {"type": "Feature", "geometry": mapping(g), "properties": dict(props)} for g in geoms]}


def write(path, data):
    path.write_text(json.dumps(data))


def constraints(tmp_path):
    """Two inter-row aisles that only a road along y=12 connects."""
    directory = tmp_path / "constraints"
    directory.mkdir()
    write(directory / "passages.geojson", collection())
    write(directory / "forbidden.geojson", collection())
    write(directory / "study_area.geojson", collection(box(0, 0, 30, 15)))
    return directory


def roads(tmp_path):
    path = tmp_path / "roads_field.geojson"
    write(path, collection(LineString([(1, 12), (25, 12)]), model="test"))
    return path


def request(constraint_set):
    return PlanRequest.model_validate({
        "crs": "EPSG:32635", "start": [1, 1], "solver_seconds": 1, "constraint_set": constraint_set,
        "interrows": collection(box(0, 0, 2, 13), box(23, 0, 25, 13)),
        "canopy": collection(box(10, 11, 11, 11.2)),
        "inspection_points": collection(Point(24, 1), point_id="far"),
    })


def test_roads_merged_into_passages_only_for_siret3(tmp_path, monkeypatch):
    monkeypatch.setenv("ROUTE_ROADS_FILE", str(roads(tmp_path)))
    merged, geom, warning = api.with_roads(request("siret3"))
    assert warning is None and geom is not None
    assert [f["properties"]["source"] for f in merged.passages.features] == ["extracted_road", "interrow_extension"]
    road = merged.passages.features[0]
    assert road["properties"]["source"] == "extracted_road"
    assert abs(shape(road["geometry"]).area - (24 * 3 + 3.14159 * 1.5**2)) < 0.5

    untouched, geom, warning = api.with_roads(request(None))
    assert untouched.passages.features == [] and geom is None and warning is None


def test_missing_roads_file_is_skipped_with_warning(tmp_path, monkeypatch):
    monkeypatch.setenv("ROUTE_ROADS_FILE", str(tmp_path / "missing.geojson"))
    merged, geom, warning = api.with_roads(request("siret3"))
    assert geom is None and merged.passages.features == []
    assert "not found" in warning


def test_siret3_plan_uses_roads_to_connect_aisles(tmp_path, monkeypatch):
    monkeypatch.setenv("ROUTE_CONSTRAINTS_DIR", str(constraints(tmp_path)))
    client = TestClient(api.app)
    body = request("siret3").model_dump(exclude={"passages", "forbidden", "study_area"})

    monkeypatch.setenv("ROUTE_ROADS_FILE", str(tmp_path / "missing.geojson"))
    without = client.post("/plan", json=body).json()
    assert without["report"]["visited_count"] == 0 and without["report"]["roads_used"] is False

    monkeypatch.setenv("ROUTE_ROADS_FILE", str(roads(tmp_path)))
    result = client.post("/plan", json=body).json()
    report = result["report"]
    assert report["roads_used"] is True and report["visited_count"] == 1
    assert report["on_extracted_roads_length_m"] > 20
    assert report["outside_length_m"] < 1e-6
    assert any("Extracted roads" in w for w in report["warnings"])
    assert result["map"]["supplied_passages"]["features"] == []
    assert len(result["map"]["extracted_roads"]["features"]) == 2
    # The route never enters the canopy strip on the road.
    route = shape(result["route"]["features"][0]["geometry"])
    assert route.intersection(box(10, 11, 11, 11.2)).length < 1e-6


def test_non_siret3_plan_ignores_roads(tmp_path, monkeypatch):
    monkeypatch.setenv("ROUTE_ROADS_FILE", str(roads(tmp_path)))
    body = request(None).model_dump()
    report = TestClient(api.app).post("/plan", json=body).json()["report"]
    assert "roads_used" not in report and report["visited_count"] == 0


def test_stored_dataset_request_gets_roads(tmp_path, monkeypatch):
    data = tmp_path / "dataset"
    data.mkdir()
    for name in ("blocks", "rows", "canopy", "waste", "inspection_points"):
        write(data / f"{name}.geojson", collection())
    write(data / "interrows.geojson", collection(box(0, 0, 2, 13), box(23, 0, 25, 13)))
    write(data / "waste.geojson", collection(box(23.5, 0.5, 24.5, 1.5), waste_id="w1"))
    monkeypatch.setenv("ROUTE_CONSTRAINTS_DIR", str(constraints(tmp_path)))
    monkeypatch.setenv("ROUTE_ROADS_FILE", str(roads(tmp_path)))
    monkeypatch.setattr(api, "load_request", lambda r: load_request(r, data))
    body = {"dataset": "siret3-sam3c", "crs": "EPSG:32635", "start": [1, 1], "purpose": "waste_collection"}
    report = TestClient(api.app).post("/plan", json=body).json()["report"]
    assert report["roads_used"] is True and report["visited_count"] == 1


def test_interrow_extension_reaches_road_across_gap(tmp_path, monkeypatch):
    """Row ends 3 m short of the road only connect through the inter-row extension."""
    monkeypatch.setenv("ROUTE_CONSTRAINTS_DIR", str(constraints(tmp_path)))
    monkeypatch.setenv("ROUTE_ROADS_FILE", str(roads(tmp_path)))
    body = request("siret3").model_dump(exclude={"passages", "forbidden", "study_area"})
    body["interrows"] = collection(box(0, 0, 2, 7.5), box(23, 0, 25, 7.5))
    client = TestClient(api.app)
    monkeypatch.setenv("ROUTE_INTERROW_EXTEND_M", "0")
    assert client.post("/plan", json=body).json()["report"]["visited_count"] == 0
    monkeypatch.setenv("ROUTE_INTERROW_EXTEND_M", "5")
    report = client.post("/plan", json=body).json()["report"]
    assert report["visited_count"] == 1 and report["outside_length_m"] < 1e-6


def test_complexity_failure_retries_without_interrow_extension(tmp_path, monkeypatch):
    monkeypatch.setenv("ROUTE_CONSTRAINTS_DIR", str(constraints(tmp_path)))
    monkeypatch.setenv("ROUTE_ROADS_FILE", str(roads(tmp_path)))
    real = api.plan_route

    def fussy(req):
        if any(f["properties"].get("source") == "interrow_extension" for f in req.passages.features):
            raise api.PlanningError("Walkable geometry is empty or too complex (limit: 100,000 triangles).")
        return real(req)

    monkeypatch.setattr(api, "plan_route", fussy)
    body = request("siret3").model_dump(exclude={"passages", "forbidden", "study_area"})
    response = TestClient(api.app).post("/plan", json=body)
    assert response.status_code == 200
    report = response.json()["report"]
    assert report["roads_used"] is True and report["visited_count"] == 1
    assert any("roads only" in w for w in report["warnings"])

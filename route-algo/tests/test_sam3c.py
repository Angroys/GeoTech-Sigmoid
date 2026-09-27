import json

from fastapi.testclient import TestClient
import pytest
from shapely.geometry import LineString, Point, box, mapping

from route_algo import api
from route_algo.models import FeatureCollection, StoredPlanRequest
from route_algo.sam3c import collection, convert, load_request


def feature(geometry, **properties):
    return {"type": "Feature", "geometry": mapping(geometry), "properties": properties}


def write(path, data):
    path.write_text(json.dumps(data))


def test_conversion_preserves_all_geometries_and_unknown_associations(tmp_path):
    labels = tmp_path / "labels"
    labels.mkdir()
    row = feature(LineString([(0, 0), (0, 8)]), label="row", vineyard_id="V01", row_id="R1", row_structure="regular")
    canopy = feature(box(-1, 0, 1, 2), label="vineyard", vineyard_id="V01")
    interrow = feature(box(1, 0, 3, 8), label="interrow_area", vineyard_id="", interrow_cover="bare_soil")
    waste = feature(box(2, 4, 2.5, 4.5), label="waste", vineyard_id="")
    write(labels / "a__labels.geojson", collection([row, canopy, interrow, waste]))
    write(labels / "b__labels.geojson", collection([row]))
    write(labels / "c__labels.geojson", collection())
    start = tmp_path / "start.geojson"
    write(start, collection([feature(Point(2, 1))]))

    layers, manifest = convert(labels, start)
    assert manifest["tile_count"] == 3  # Empty tiles are part of the dataset too.
    assert manifest["physical_row_count"] == 1
    assert len(layers["rows"]["features"]) == 2
    assert len({f["properties"]["row_id"] for f in layers["rows"]["features"]}) == 2
    assert layers["canopy"]["features"][0]["geometry"] == json.loads(json.dumps(canopy["geometry"]))
    assert layers["canopy"]["features"][0]["properties"]["row_id"] is None
    assert layers["interrows"]["features"][0]["properties"]["vineyard_id"] is None
    assert layers["interrows"]["features"][0]["properties"]["row_ids"] is None
    assert layers["waste"]["features"][0]["properties"]["vineyard_id"] is None
    assert layers["inspection_points"]["features"] == []
    assert layers["start"]["features"][0]["geometry"]["coordinates"] == [2, 1]
    assert convert(labels, start) == (layers, manifest)


def test_full_canopy_layer_fits_bounded_request():
    layer = collection([feature(box(0, 0, 1, 1))] * 32404)
    assert len(FeatureCollection.model_validate(layer).features) == 32404
    with pytest.raises(ValueError):
        FeatureCollection.model_validate(collection([{}] * 50001))


def test_stored_dataset_uses_official_constraints_and_requested_start(tmp_path, monkeypatch):
    for name in ("blocks", "rows", "canopy", "interrows", "waste", "inspection_points", "forbidden"):
        write(tmp_path / f"{name}.geojson", collection())
    write(tmp_path / "waste.geojson", collection([feature(box(8, 0, 9, 1), waste_id="w1")]))
    write(tmp_path / "passages.geojson", collection([feature(box(0, 0, 10, 2))]))
    write(tmp_path / "study_area.geojson", collection([feature(box(0, 0, 10, 2))]))
    monkeypatch.setenv("ROUTE_CONSTRAINTS_DIR", str(tmp_path))
    monkeypatch.setattr(api, "load_request", lambda request: load_request(request, tmp_path))
    client = TestClient(api.app)
    body = {"dataset": "siret3-sam3c", "crs": "EPSG:32635", "start": [1, 1], "purpose": "waste_collection"}
    response = client.post("/plan", json=body)
    assert response.status_code == 200
    result = response.json()
    assert result["report"]["visited_count"] == 1
    assert result["report"]["outside_length_m"] == 0
    route = result["route"]["features"][0]
    assert route["geometry"]["coordinates"][0] == route["geometry"]["coordinates"][-1] == [1, 1]
    assert route["properties"]["data_kind"] == "model_prediction_mock"
    assert client.post("/plan", json={**body, "start": [100, 100]}).status_code == 422
    assert client.post("/plan", json={**body, "canopy": collection()}).status_code == 422
    assert client.post("/plan", json={**body, "path_mode": "demo_headlands"}).status_code == 422


def test_missing_dataset_does_not_fall_back_to_empty_obstacles(tmp_path, monkeypatch):
    monkeypatch.setattr(api, "load_request", lambda request: load_request(request, tmp_path))
    response = TestClient(api.app).post("/plan", json=StoredPlanRequest(
        dataset="siret3-sam3c", crs="EPSG:32635", start=(1, 1),
    ).model_dump())
    assert response.status_code == 503
    assert "SAM3 mock data is unavailable" in response.json()["detail"]

from fastapi.testclient import TestClient

from route_algo.api import app

CRS = {"type": "name", "properties": {"name": "urn:ogc:def:crs:EPSG::32635"}}


def fc(features):
    return {"type": "FeatureCollection", "crs": CRS, "features": features}


def poly(x0, y0, x1, y1):
    return {"type": "Polygon", "coordinates": [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]]}


def request(start):
    return {
        "crs": "EPSG:32635",
        "start": start,
        "interrows": fc([{"type": "Feature", "geometry": poly(0, 0, 40, 4), "properties": {}}]),
        "waste": fc([{"type": "Feature", "geometry": poly(30, 1, 31, 2), "properties": {"waste_id": "W1"}}]),
        "purpose": "waste_collection",
    }


def test_start_just_outside_is_connected():
    response = TestClient(app).post("/plan", json=request([-0.34, 2.0]))
    assert response.status_code == 200, response.text
    body = response.json()
    coords = body["route"]["features"][0]["geometry"]["coordinates"]
    assert coords[0] == [-0.34, 2.0] and coords[-1] == [-0.34, 2.0]
    assert body["report"]["visited_count"] == 1
    assert 0.3 < body["report"]["start_connector_m"] < 1.0


def test_start_far_outside_still_rejected():
    response = TestClient(app).post("/plan", json=request([-20.0, 2.0]))
    assert response.status_code == 422

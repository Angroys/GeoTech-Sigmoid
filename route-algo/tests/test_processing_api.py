import json
import re
import time
from pathlib import Path

import numpy as np
import pytest
import tifffile
from fastapi.testclient import TestClient
from shapely.geometry import box, mapping, shape

from route_algo.api import app
from route_algo.processing import segmenter as seg

FIXTURES = Path(__file__).parent / "fixtures" / "fallback_labels"
FIXTURE_TILE = "siret3_r000_c000.tif"
ORIGIN = (600000.0, 5200000.0)
LAYERS = ("blocks", "rows", "canopy", "interrows", "waste", "inspection_points", "start")
CRS_NAME = "urn:ogc:def:crs:EPSG::32635"


def geotiff(path: Path, epsg=32635, size=2048, gsd=0.025, origin=ORIGIN) -> bytes:
    geokeys = [1, 1, 0, 4, 1024, 0, 1, 1, 1025, 0, 1, 1, 3072, 0, 1, epsg, 3076, 0, 1, 9001]
    tifffile.imwrite(
        path, np.zeros((size, size), dtype=np.uint8), compression="zlib",
        extratags=[
            (33550, "d", 3, (gsd, gsd, 0.0), True),
            (33922, "d", 6, (0.0, 0.0, 0.0, origin[0], origin[1], 0.0), True),
            (34735, "H", len(geokeys), geokeys, True),
        ],
    )
    return path.read_bytes()


def fixture_segments():
    data = json.loads((FIXTURES / "siret3_r000_c000__labels.geojson").read_text())
    classes = {"vineyard": "canopy", "waste": "waste"}
    return [
        {"type": "Feature", "geometry": f["geometry"], "properties": {"class": classes[f["properties"]["label"]]}}
        for f in data["features"] if f["properties"]["label"] in classes
    ]


def assert_axis_aligned_box(geometry):
    polygon = shape(geometry)
    assert polygon.geom_type == "Polygon" and not polygon.interiors
    assert polygon.area > 0
    assert polygon.equals(box(*polygon.bounds))


def test_run_name_and_run5_default(monkeypatch, tmp_path):
    assert seg.run_name(Path("/d/sam3_ft/run5/best_effective.pth")) == "run5"
    assert seg.run_name(Path("/d/sam3_ft/run3c/labels")) == "run3c"
    run5, run3c = tmp_path / "run5", tmp_path / "run3c"
    run5.mkdir()
    monkeypatch.setattr(seg, "RUN5_DIR", run5)
    monkeypatch.setattr(seg, "RUN3C_DIR", run3c)
    assert seg.default_run_dir() == run3c
    (run5 / "best.pth").write_bytes(b"")
    assert seg.default_run_dir() == run5


def test_waste_masks_become_axis_aligned_boxes():
    from shapely.affinity import rotate
    from shapely.geometry import Polygon

    from route_algo.processing.postprocess import waste_boxes

    x, y = ORIGIN
    blob = rotate(box(x, y, x + 1.0, y + 0.3), 30)  # rotated mask
    l_shape = Polygon([(x + 5, y), (x + 6, y), (x + 6, y + 0.4), (x + 5.4, y + 0.4), (x + 5.4, y + 1), (x + 5, y + 1)])
    boxes = waste_boxes([blob, l_shape])
    assert len(boxes) == 2
    for rect, source in zip(boxes, (blob, l_shape)):
        assert_axis_aligned_box(mapping(rect))
        assert rect.covers(source.buffer(-0.01))
        assert all(abs(a - b) < 0.011 for a, b in zip(rect.bounds, source.bounds))


class StubSegmenter:
    def __init__(self, fail=False):
        self.fail = fail
        self.calls = []

    def segment_tile(self, tif_path):
        self.calls.append(Path(tif_path).name)
        if self.fail:
            raise RuntimeError("CUDA out of memory")
        return fixture_segments()


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("PROCESSING_DATA_DIR", str(tmp_path / "data"))
    monkeypatch.setenv("SAM3_FALLBACK_LABELS_DIR", str(FIXTURES))
    monkeypatch.delenv("PROCESSING_FORCE_FALLBACK", raising=False)
    monkeypatch.setattr(seg, "get_segmenter", lambda: None)
    return TestClient(app)


@pytest.fixture
def good_tile(tmp_path):
    return geotiff(tmp_path / "good.tif")


def create(client, survey_id="new-vineyard"):
    response = client.post("/api/surveys", json={
        "id": survey_id, "name": "New vineyard", "location": "Sireț", "capturedOn": "2026-07-01", "imageryUrl": None,
    })
    assert response.status_code == 201, response.text
    assert response.json() == {"id": survey_id}
    return survey_id


def wait_done(client, survey_id, timeout=60):
    deadline = time.time() + timeout
    while time.time() < deadline:
        body = client.get(f"/api/surveys/{survey_id}").json()
        if body["status"] in {"ready", "failed"}:
            return body
        time.sleep(0.05)
    raise AssertionError("processing did not finish")


def test_create_rejects_bad_id(client):
    response = client.post("/api/surveys", json={
        "id": "Bad_ID", "name": "x", "location": "y", "capturedOn": "2026-07-01", "imageryUrl": None,
    })
    assert response.status_code == 422
    assert "id" in response.json()["message"]


def test_unknown_survey_is_json_404(client):
    for method, path in [("get", "/api/surveys/nope"), ("post", "/api/surveys/nope/process"),
                         ("get", "/api/surveys/nope/results/blocks.geojson")]:
        response = getattr(client, method)(path)
        assert response.status_code == 404
        assert "nope" in response.json()["message"]
    response = client.put("/api/surveys/nope/tiles/a.tif", content=b"x")
    assert response.status_code == 404 and "message" in response.json()


@pytest.mark.parametrize(("kwargs", "needle"), [
    ({"epsg": 4326}, "EPSG:4326"),
    ({"size": 1024}, "1024 x 1024"),
    ({"gsd": 0.05}, "0.05"),
])
def test_bad_geotiffs_are_rejected(client, tmp_path, kwargs, needle):
    survey_id = create(client)
    response = client.put(f"/api/surveys/{survey_id}/tiles/t.tif", content=geotiff(tmp_path / "bad.tif", **kwargs))
    assert response.status_code == 422
    assert needle in response.json()["message"]


def test_non_tiff_and_plain_tiff_are_rejected(client, tmp_path):
    survey_id = create(client)
    response = client.put(f"/api/surveys/{survey_id}/tiles/t.tif", content=b"not a tiff at all")
    assert response.status_code == 422 and "not a TIFF" in response.json()["message"]
    tifffile.imwrite(tmp_path / "plain.tif", np.zeros((8, 8), dtype=np.uint8))
    response = client.put(f"/api/surveys/{survey_id}/tiles/t.tif", content=(tmp_path / "plain.tif").read_bytes())
    assert response.status_code == 422 and "GeoTIFF" in response.json()["message"]


def test_tile_names_are_sanitised(client, good_tile):
    survey_id = create(client)
    for name in ["..%2Fsurvey.json", ".hidden.tif", "evil.exe"]:
        response = client.put(f"/api/surveys/{survey_id}/tiles/{name}", content=good_tile)
        assert response.status_code in {404, 422}
        assert "message" in response.json()


def test_process_without_tiles_is_rejected(client):
    survey_id = create(client)
    response = client.post(f"/api/surveys/{survey_id}/process")
    assert response.status_code == 422 and "tile" in response.json()["message"]


def test_model_lifecycle_and_result_schema(client, monkeypatch, good_tile):
    stub = StubSegmenter()
    monkeypatch.setattr(seg, "get_segmenter", lambda: stub)
    survey_id = create(client)
    assert client.get(f"/api/surveys/{survey_id}").json() == {"status": "uploading"}
    assert client.put(f"/api/surveys/{survey_id}/tiles/{FIXTURE_TILE}", content=good_tile).status_code == 201
    # Same name replaces the tile.
    assert client.put(f"/api/surveys/{survey_id}/tiles/{FIXTURE_TILE}", content=good_tile).status_code == 201
    assert client.get(f"/api/surveys/{survey_id}/results/blocks.geojson").status_code == 409
    assert client.post(f"/api/surveys/{survey_id}/process").status_code == 202
    status = wait_done(client, survey_id)
    assert status["status"] == "ready" and status["source"] == "model"
    assert re.match(r"Live SAM 3 run\w+ inference on 1 tile \(", status["message"])
    assert "fallback" not in status["message"]
    assert stub.calls == [FIXTURE_TILE]

    files = {}
    for layer in LAYERS:
        response = client.get(f"/api/surveys/{survey_id}/results/{layer}.geojson")
        assert response.status_code == 200
        body = response.json()
        assert body["type"] == "FeatureCollection"
        assert body["crs"]["properties"]["name"] == CRS_NAME
        assert body["source"] == "model"
        files[layer] = body["features"]

    assert [f["properties"] for f in files["blocks"]] == [{"vineyard_id": "V1"}]
    assert len(files["rows"]) == 5
    for row in files["rows"]:
        assert row["geometry"]["type"] == "LineString"
        assert set(row["properties"]) == {"label", "vineyard_id", "row_id", "row_structure", "length_m"}
        assert row["properties"]["row_structure"] in {"regular", "disrupted", "unassessable"}
    assert len(files["interrows"]) == 4
    for interrow in files["interrows"]:
        props = interrow["properties"]
        assert interrow["geometry"]["type"] == "Polygon"
        assert props["label"] == "interrow_area" and len(props["row_ids"]) == 2
        assert props["interrow_cover"] in {"bare_soil", "vegetation", "mixed", "unassessable"}
    assert all(f["properties"]["label"] == "vineyard" and f["properties"]["row_id"] for f in files["canopy"])
    assert len(files["canopy"]) == 5 * 31 - 3
    [waste] = files["waste"]
    assert waste["properties"] == {"label": "waste", "waste_id": "W-001", "vineyard_id": "V1", "reachable": True}
    assert_axis_aligned_box(waste["geometry"])
    [gap] = files["inspection_points"]
    assert gap["properties"]["reason"] == "row_gap" and gap["properties"]["reachable"] is True
    assert shape(gap["geometry"]).distance(shape({"type": "Point", "coordinates": [600021, 5199975]})) < 0.6
    [start] = files["start"]
    assert start["properties"] == {} and start["geometry"]["type"] == "Point"

    # The processed survey plans a route the way the web app requests it.
    request = {
        "crs": "EPSG:32635", "purpose": "inspection", "path_mode": "supplied", "constraint_set": None,
        "start": start["geometry"]["coordinates"], "solver_seconds": 1,
        **{key: {"type": "FeatureCollection", "features": files[layer]} for key, layer in [
            ("interrows", "interrows"), ("blocks", "blocks"), ("canopy", "canopy"),
            ("inspection_points", "inspection_points"), ("waste", "waste")]},
    }
    plan = client.post("/plan", json=request)
    assert plan.status_code == 200, plan.text
    assert plan.json()["report"]["visited_count"] == 2


def test_inference_error_falls_back_to_precomputed_labels(client, monkeypatch, good_tile):
    monkeypatch.setattr(seg, "get_segmenter", lambda: StubSegmenter(fail=True))
    survey_id = create(client)
    client.put(f"/api/surveys/{survey_id}/tiles/{FIXTURE_TILE}", content=good_tile)
    client.post(f"/api/surveys/{survey_id}/process")
    status = wait_done(client, survey_id)
    assert status["status"] == "ready" and status["source"] == "fallback"
    assert "fallback" in status["message"] and "CUDA out of memory" in status["message"]
    body = client.get(f"/api/surveys/{survey_id}/results/rows.geojson").json()
    assert body["source"] == "fallback" and len(body["features"]) == 5


def test_no_model_non_siret_tiles_fail_clearly(client, good_tile):
    survey_id = create(client)
    client.put(f"/api/surveys/{survey_id}/tiles/farm_a.tif", content=good_tile)
    client.post(f"/api/surveys/{survey_id}/process")
    status = wait_done(client, survey_id)
    assert status["status"] == "failed"
    assert "unavailable" in status["message"] and "Sireț3" in status["message"]


def test_empty_segmentation_fails(client, monkeypatch, good_tile):
    class Empty:
        def segment_tile(self, tif_path):
            return [{"type": "Feature", "geometry": mapping(box(0, 0, 1, 1)), "properties": {"class": "other"}}]

    monkeypatch.setattr(seg, "get_segmenter", lambda: Empty())
    survey_id = create(client)
    client.put(f"/api/surveys/{survey_id}/tiles/{FIXTURE_TILE}", content=good_tile)
    client.post(f"/api/surveys/{survey_id}/process")
    status = wait_done(client, survey_id)
    assert status["status"] == "failed" and "canopy" in status["message"]


def test_force_fallback_and_missing_adapter(monkeypatch):
    monkeypatch.setenv("PROCESSING_FORCE_FALLBACK", "1")
    assert seg.get_segmenter() is None
    assert "FORCE_FALLBACK" in seg.unavailable_reason()


def test_plan_errors_keep_detail_shape(client):
    response = client.post("/plan", json={"crs": "EPSG:4326"})
    assert response.status_code == 422
    assert "detail" in response.json()


def test_factory_uses_adapter_availability(monkeypatch):
    import sys
    import types

    class FakeSam3:
        ok = False

        def __init__(self, weights):
            self.weights = weights

        @classmethod
        def available(cls):
            return cls.ok

        def segment_tile(self, tif_path):
            return []

    module = types.ModuleType("route_algo.processing.sam3_model")
    module.Sam3Segmenter = FakeSam3
    monkeypatch.setitem(sys.modules, "route_algo.processing.sam3_model", module)
    monkeypatch.delenv("PROCESSING_FORCE_FALLBACK", raising=False)
    monkeypatch.setenv("SAM3_FT_WEIGHTS", "/nonexistent/best.pth")
    monkeypatch.setattr(seg, "_cached", None)
    assert seg.get_segmenter() is None
    assert "unavailable" in seg.unavailable_reason()
    FakeSam3.ok = True
    segmenter = seg.get_segmenter()
    assert isinstance(segmenter, FakeSam3) and str(segmenter.weights) == "/nonexistent/best.pth"
    monkeypatch.setattr(seg, "_cached", None)


def test_factory_passes_parcels_and_prefers_baked_weights(monkeypatch, tmp_path):
    import sys
    import types

    class FakeSam3:
        def __init__(self, weights, parcels=None):
            self.weights, self.parcels = weights, parcels

        @classmethod
        def available(cls):
            return True

    module = types.ModuleType("route_algo.processing.sam3_model")
    module.Sam3Segmenter = FakeSam3
    monkeypatch.setitem(sys.modules, "route_algo.processing.sam3_model", module)
    monkeypatch.delenv("PROCESSING_FORCE_FALLBACK", raising=False)
    monkeypatch.setenv("SAM3_FT_WEIGHTS", "/w/best_effective.pth")
    monkeypatch.setenv("SAM3_PARCELS", "/p/parcels.geojson")
    monkeypatch.setattr(seg, "_cached", None)
    segmenter = seg.get_segmenter()
    assert str(segmenter.parcels) == "/p/parcels.geojson"
    monkeypatch.setattr(seg, "_cached", None)

    baked, raw = tmp_path / "best_effective.pth", tmp_path / "best.pth"
    monkeypatch.setattr(seg, "BAKED_WEIGHTS", baked)
    monkeypatch.setattr(seg, "RAW_WEIGHTS", raw)
    monkeypatch.delenv("SAM3_FT_WEIGHTS")
    assert seg.weights_path() == raw
    baked.write_bytes(b"")
    assert seg.weights_path() == baked


def test_fallback_disabled_by_default(client, monkeypatch, good_tile):
    monkeypatch.delenv("PROCESSING_ALLOW_FALLBACK", raising=False)
    monkeypatch.delenv("PROCESSING_FORCE_FALLBACK", raising=False)
    monkeypatch.setattr(seg, "get_segmenter", lambda: None)
    survey_id = create(client)
    client.put(f"/api/surveys/{survey_id}/tiles/{FIXTURE_TILE}", content=good_tile)
    client.post(f"/api/surveys/{survey_id}/process")
    status = wait_done(client, survey_id)
    assert status["status"] == "failed" and "fallback labels are disabled" in status["message"]
    assert "source" not in status

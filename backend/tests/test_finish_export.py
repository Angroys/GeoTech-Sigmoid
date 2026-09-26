"""Saving annotations also writes finished outputs into the ``finish`` dataset.

A ``PUT /api/tiles/{name}/annotations`` must, after persisting the annotations,
emit ``{tilebase}_mask.tif`` (georeferenced EPSG:32635 label mask) and
``{tilebase}__labels.geojson`` (EPSG:32635 world coordinates) into
``config.finish_dir()``.

Skips cleanly when the tiles dir / sample tile is absent so CI without the
dataset still passes.
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest
import rasterio
from rasterio.crs import CRS

from app import api, config, db

# Prefer a real HTTP round-trip via the FastAPI TestClient. It needs httpx,
# which is not a runtime dependency here, so fall back to invoking the wired
# endpoint handler directly when httpx is absent (still exercises the save +
# finish-export path). This keeps the suite green without adding deps.
try:
    from fastapi.testclient import TestClient  # noqa: F401  (requires httpx)

    _HAVE_TESTCLIENT = True
except Exception:  # pragma: no cover - depends on optional httpx install
    _HAVE_TESTCLIENT = False

TILE = "siret3_r007_c002.tif"
TILEBASE = "siret3_r007_c002"

ANNOTATIONS = [
    {
        "label": "vineyard",
        "shape_type": "polygon",
        "points": [[100, 100], [500, 100], [500, 500], [100, 500]],
        "attributes": {"vineyard_id": "V01"},
    },
    {
        "label": "row",
        "shape_type": "polyline",
        "points": [[120, 120], [480, 480]],
        "attributes": {"vineyard_id": "V01", "row_id": "V01-R01", "row_structure": "regular"},
    },
]


class _DirectResponse:
    """Minimal stand-in for an httpx Response when TestClient is unavailable."""

    def __init__(self, body):
        self._body = body
        self.status_code = 200

    def json(self):
        return self._body


class _DirectClient:
    """Invokes the wired endpoint handler directly (no HTTP layer)."""

    def put(self, url, json):  # noqa: A002 - mirror httpx client signature
        name = url.rsplit("/", 2)[1]  # /api/tiles/{name}/annotations
        payload = api.AnnotationsReplace(**json)
        return _DirectResponse(api.put_annotations(name, payload))


@pytest.fixture
def client(tmp_path, monkeypatch):
    tiles_dir = config.tiles_dir()
    if not tiles_dir.is_dir() or not (tiles_dir / TILE).is_file():
        pytest.skip(f"sample tile {TILE} not present in {tiles_dir}")
    finish = tmp_path / "finish"
    monkeypatch.setenv("GEOTECH_FINISH_DIR", str(finish))
    db.init_db()
    if _HAVE_TESTCLIENT:
        from app.main import app

        return TestClient(app)
    return _DirectClient()


def test_put_annotations_writes_finish_outputs(client, tmp_path):
    resp = client.put(f"/api/tiles/{TILE}/annotations", json={"annotations": ANNOTATIONS})
    assert resp.status_code == 200
    body = resp.json()
    # Response shape is unchanged: tile_name + persisted annotations.
    assert body["tile_name"] == TILE
    assert len(body["annotations"]) == len(ANNOTATIONS)

    finish = Path(config.finish_dir())
    mask_path = finish / f"{TILEBASE}_mask.tif"
    geojson_path = finish / f"{TILEBASE}__labels.geojson"
    assert mask_path.is_file(), f"missing mask GeoTIFF at {mask_path}"
    assert geojson_path.is_file(), f"missing labels GeoJSON at {geojson_path}"

    # Mask GeoTIFF is georeferenced in EPSG:32635.
    with rasterio.open(str(mask_path)) as ds:
        assert str(ds.crs) == "EPSG:32635"
        assert ds.count == 1
        assert ds.dtypes[0] == "uint8"

    # GeoJSON is EPSG:32635, has features, and preserves labels + attributes.
    fc = json.loads(geojson_path.read_text())
    assert fc["type"] == "FeatureCollection"
    crs_name = fc["crs"]["properties"]["name"]
    assert CRS.from_user_input(crs_name).to_epsg() == 32635
    features = fc["features"]
    assert len(features) > 0
    labels = {f["properties"]["label"] for f in features}
    assert "vineyard" in labels
    assert "row" in labels
    # Attribute carried through.
    assert any(f["properties"].get("vineyard_id") == "V01" for f in features)

    geom_types = {f["geometry"]["type"] for f in features}
    assert "Polygon" in geom_types
    assert "LineString" in geom_types


def test_save_succeeds_when_export_fails(client, monkeypatch):
    # Force the finish export to blow up; the save must still return 200.
    from app import finish_export

    def _boom(*args, **kwargs):
        raise RuntimeError("simulated export failure")

    monkeypatch.setattr(finish_export, "write_finish_outputs", _boom)
    resp = client.put(f"/api/tiles/{TILE}/annotations", json={"annotations": ANNOTATIONS})
    assert resp.status_code == 200
    assert len(resp.json()["annotations"]) == len(ANNOTATIONS)

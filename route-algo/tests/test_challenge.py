import json
from xml.etree import ElementTree as ET

import test_processing_api as api_tests
from route_algo.processing import challenge
from route_algo.processing.geotiff import TileInfo
from shapely.geometry import shape
from test_processing_api import (
    FIXTURE_TILE,
    FIXTURES,
    ORIGIN,
    create,
    geotiff,
    wait_done,
)

client = api_tests.client  # reuse the processing API fixture (fallback labels, temp data dir)

LABELS = json.loads((FIXTURES / "siret3_r000_c000__labels.geojson").read_text())["features"]
INFO = TileInfo(2048, 2048, 32635, 0.025, *ORIGIN)


def tile(features=LABELS, name=FIXTURE_TILE):
    return challenge.Tile(name, INFO, features)


def test_export_follows_the_challenge_label_contract():
    result = challenge.build([tile(), tile([], "siret3_r000_c001.tif")])
    assert result["problems"] == []
    root = ET.fromstring(result["xml"])
    labels = {lab.findtext("name"): lab.findtext("type") for lab in root.iter("label")}
    assert labels == {"vineyard": "polygon", "waste": "rectangle", "row": "polyline", "interrow_area": "polygon"}
    images = {img.get("name"): img for img in root.iter("image")}
    assert set(images) == {FIXTURE_TILE, "siret3_r000_c001.tif"}      # empty tiles still get an <image>
    assert len(images["siret3_r000_c001.tif"]) == 0
    tags = [el.tag for el in images[FIXTURE_TILE]]
    # the fixture has one row line: only the plants standing on it are kept
    assert tags.count("polyline") == 1 and tags.count("box") == 1
    assert tags.count("polygon") == result["counts"]["vineyard"] > 0
    row = images[FIXTURE_TILE].find("polyline")
    attrs = {a.get("name"): a.text for a in row.findall("attribute")}
    assert attrs["vineyard_id"] == "V01" and attrs["row_id"] == "V01-R01"
    assert attrs["row_structure"] in {"regular", "disrupted"}


def test_dead_vines_are_not_exported_and_plants_need_a_row():
    dead = {**LABELS[0], "properties": {**LABELS[0]["properties"], "label": "dead_vine"}}
    no_rows = [f for f in LABELS if f["properties"]["label"] != "row"] + [dead]
    result = challenge.build([tile(no_rows)])
    assert result["problems"] == []
    assert result["counts"].get("vineyard", 0) == 0 and result["counts"]["vineyard_dropped_no_row"] > 0
    assert "dead_vine" not in result["xml"]


def test_a_tree_cuts_only_the_covered_stretch_of_a_row():
    row = next(f for f in LABELS if f["properties"]["label"] == "row")
    line = shape(row["geometry"])
    crown = line.interpolate(0.5, normalized=True).buffer(1.0)
    plain = challenge.finalize([tile()])[0][FIXTURE_TILE]
    cut, counts = challenge.finalize([tile()], trees=[crown])
    rows = [f for f in cut[FIXTURE_TILE] if f["label"] == "row"]
    assert counts["rows_cut_by_trees"] == 1 and len(rows) == 2
    assert {f["row_id"] for f in rows} == {"V01-R01"}
    full = next(f["geometry"].length for f in plain if f["label"] == "row")
    assert full - 3.0 < sum(f["geometry"].length for f in rows) < full


def test_verify_rejects_renamed_labels():
    xml = challenge.build([tile()])["xml"].replace("<name>interrow_area</name>", "<name>interrow</name>")
    assert any("label config" in p for p in challenge.verify(xml, [FIXTURE_TILE]))


def test_processing_serves_the_challenge_files(client, tmp_path):
    survey_id = create(client)
    assert client.put(f"/api/surveys/{survey_id}/tiles/{FIXTURE_TILE}", content=geotiff(tmp_path / "t.tif")).status_code == 201
    assert client.get(f"/api/surveys/{survey_id}/results/annotations.xml").status_code == 409
    assert client.post(f"/api/surveys/{survey_id}/process").status_code == 202
    status = wait_done(client, survey_id)
    assert status["status"] == "ready", status
    assert "challenge export:" in status["message"]
    xml = client.get(f"/api/surveys/{survey_id}/results/annotations.xml")
    assert xml.status_code == 200 and xml.headers["content-type"].startswith("application/xml")
    assert challenge.verify(xml.text, [FIXTURE_TILE]) == []
    body = client.get(f"/api/surveys/{survey_id}/results/challenge.geojson").json()
    assert body["crs"]["properties"]["name"] == "urn:ogc:def:crs:EPSG::32635"
    assert {f["properties"]["label"] for f in body["features"]} == {"vineyard", "row", "waste"}

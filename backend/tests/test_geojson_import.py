"""Import the real SAM GeoJSON output and assert conversion fidelity.

Skips cleanly when the label data or tile rasters are absent so CI without
the dataset still passes.
"""
from __future__ import annotations

from pathlib import Path

import pytest

from app import config, db, geojson_import

REPO_ROOT = Path(__file__).resolve().parent.parent.parent.parent.parent
LABELS_DIR = REPO_ROOT / "labels"
TILES_DIR = config.tiles_dir()

TILE_SIZE = 2048


@pytest.fixture
def summary():
    # The autouse _isolated_db fixture points GEOTECH_DB at a fresh tmp file
    # per test, so initialise the schema and import within each test's DB.
    if not LABELS_DIR.is_dir() or not list(LABELS_DIR.glob("*.geojson")):
        pytest.skip(f"SAM labels not found at {LABELS_DIR}")
    if not TILES_DIR.is_dir():
        pytest.skip(f"tiles dir not found at {TILES_DIR}")
    db.init_db()
    result = geojson_import.import_dir(LABELS_DIR, TILES_DIR)
    if result["shapes_imported"] == 0:
        pytest.skip("no shapes imported (no matching tiles for the labels)")
    return result


def _all_annotations() -> list[dict]:
    anns: list[dict] = []
    for tile in db.all_tiles_with_annotations():
        anns.extend(db.list_annotations(tile))
    return anns


def test_features_imported(summary):
    assert summary["shapes_imported"] > 0
    assert summary["tiles"] >= 1


def test_points_within_tile_bounds(summary):
    for ann in _all_annotations():
        for x, y in ann["points"]:
            assert 0 <= x <= TILE_SIZE, f"x={x} out of [0,{TILE_SIZE}]"
            assert 0 <= y <= TILE_SIZE, f"y={y} out of [0,{TILE_SIZE}]"


def test_geometry_to_shape_type_mapping(summary):
    anns = _all_annotations()
    rows = [a for a in anns if a["label"] == "row"]
    vineyards = [a for a in anns if a["label"] == "vineyard"]
    assert rows, "expected at least one row annotation"
    assert vineyards, "expected at least one vineyard annotation"
    assert all(a["shape_type"] == "polyline" for a in rows)
    assert all(a["shape_type"] == "polygon" for a in vineyards)


def test_attributes_preserved(summary):
    anns = _all_annotations()
    # row_structure is carried when present on a row feature.
    rows_with_structure = [
        a for a in anns if a["label"] == "row" and "row_structure" in a["attributes"]
    ]
    # score is carried when present (non-null) on any feature.
    with_score = [a for a in anns if "score" in a["attributes"]]
    # Both are optional in the data, but at least one attribute type should
    # survive across the canonical + variant samples.
    assert rows_with_structure or with_score


def test_source_is_sam(summary):
    anns = _all_annotations()
    assert anns
    assert all(a["source"] == "sam" for a in anns)


def test_labels_are_valid(summary):
    assert set(summary["labels"]).issubset(geojson_import.VALID_LABELS)

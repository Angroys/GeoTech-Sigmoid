"""Verify the ``dead_vine`` label (CLASS_VALUE_MAP value 5) burns into masks.

Skips cleanly when the real tile raster is absent so CI without the dataset
still passes.
"""
from __future__ import annotations

from pathlib import Path

import numpy as np
import pytest
import rasterio

from app import config, db, masks

TILE = "siret3_r007_c002.tif"

# A polygon well inside a 2048x2048 tile (points are [col, row] pixel coords).
DEAD_VINE_POLY = [[200, 200], [400, 200], [400, 400], [200, 400]]


def test_dead_vine_in_class_value_map():
    assert config.CLASS_VALUE_MAP["dead_vine"] == 5
    # Existing values stay put.
    assert config.CLASS_VALUE_MAP["background"] == 0
    assert config.CLASS_VALUE_MAP["vineyard"] == 1
    assert config.CLASS_VALUE_MAP["waste"] == 4


def test_build_mask_array_burns_dead_vine():
    """Unit-level: dead_vine polygon rasterizes to value 5 (no tile needed)."""
    mask = masks.build_mask_array(
        [
            {
                "label": "dead_vine",
                "shape_type": "polygon",
                "points": DEAD_VINE_POLY,
                "attributes": {},
            }
        ],
        width=512,
        height=512,
    )
    present = set(np.unique(mask).tolist())
    assert 5 in present, f"expected value 5 in mask, got {present}"
    # Interior pixel of the polygon carries the dead_vine value.
    assert mask[300, 300] == 5


@pytest.fixture
def tile_present(tiles_dir: Path) -> Path:
    p = tiles_dir / TILE
    if not p.exists():
        pytest.skip(f"tile {TILE} not present at {p}")
    return p


def test_dead_vine_burns_into_geotiff(tile_present: Path, tmp_path: Path):
    db.init_db()
    db.replace_annotations(
        TILE,
        [
            {
                "label": "vineyard",
                "shape_type": "polygon",
                "points": [[600, 600], [900, 600], [900, 900], [600, 900]],
                "attributes": {"vineyard_id": "V01"},
            },
            {
                "label": "dead_vine",
                "shape_type": "polygon",
                "points": DEAD_VINE_POLY,
                "attributes": {"vineyard_id": "V01"},
            },
        ],
    )

    out = tmp_path / "mask.tif"
    masks.write_mask_geotiff(TILE, out)

    with rasterio.open(str(out)) as dst:
        assert str(dst.crs) == "EPSG:32635"
        data = dst.read(1)

    present = set(np.unique(data).tolist())
    assert 1 in present  # vineyard still burns
    assert 5 in present, f"dead_vine (5) missing from mask; got {present}"
    # A pixel inside the dead_vine polygon should carry value 5.
    assert data[300, 300] == 5

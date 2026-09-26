"""Assert mask GeoTIFF preserves CRS, transform, dimensions and bounds."""
from __future__ import annotations

from pathlib import Path

import pytest
import rasterio

from app import db, masks

TILE = "siret3_r006_c004.tif"


@pytest.fixture
def tile_present(tiles_dir: Path) -> Path:
    p = tiles_dir / TILE
    if not p.exists():
        pytest.skip(f"tile {TILE} not present at {p}")
    return p


def test_mask_matches_source_georef(tile_present: Path, tmp_path: Path):
    db.init_db()
    # Seed a couple of annotations so the mask has real burned pixels.
    db.replace_annotations(
        TILE,
        [
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
                "attributes": {"vineyard_id": "V01", "row_id": "V01-R01",
                               "row_structure": "regular"},
            },
        ],
    )

    out = tmp_path / "mask.tif"
    masks.write_mask_geotiff(TILE, out)

    with rasterio.open(str(tile_present)) as src, rasterio.open(str(out)) as dst:
        assert str(dst.crs) == "EPSG:32635"
        assert dst.crs == src.crs
        assert dst.transform == src.transform
        assert (dst.width, dst.height) == (src.width, src.height)
        assert dst.bounds == src.bounds
        assert dst.count == 1
        assert dst.dtypes[0] == "uint8"
        data = dst.read(1)

    import numpy as np

    # class values present: background(0), vineyard(1), row(2)
    present = set(np.unique(data).tolist())
    assert 1 in present  # vineyard burned
    assert 2 in present  # row burned

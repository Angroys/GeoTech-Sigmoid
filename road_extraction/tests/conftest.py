"""Shared fixtures: tiny synthetic GeoTIFF tile grids written to ``tmp_path``."""

from __future__ import annotations

from collections.abc import Callable
from pathlib import Path

import numpy as np
import pytest
import rasterio
from affine import Affine

TILE_PX = 64
RES = 0.025  # 2.5 cm/px, like the real Siret3 tiles
ORIGIN_X = 628992.0  # corner of virtual tile (0, 0) on the real grid
ORIGIN_Y = 5221222.4
CRS = "EPSG:32635"


def tile_transform(row: int, col: int, tile_px: int = TILE_PX, res: float = RES) -> Affine:
    """Affine of lattice tile (row, col): row+1 is south, col+1 is east."""
    return Affine(res, 0.0, ORIGIN_X + col * tile_px * res, 0.0, -res, ORIGIN_Y - row * tile_px * res)


def write_tile(path: Path, data: np.ndarray, transform: Affine) -> Path:
    """Write a (C, H, W) uint8 array as a GeoTIFF in EPSG:32635."""
    count, h, w = data.shape
    with rasterio.open(
        path, "w", driver="GTiff", height=h, width=w, count=count, dtype="uint8", crs=CRS, transform=transform
    ) as dst:
        dst.write(data)
    return path


@pytest.fixture
def make_tiles(tmp_path: Path) -> Callable[[dict[tuple[int, int], int]], Path]:
    """Factory: ``{(row, col): value}`` -> directory of constant-valued 3-band tiles."""

    def _make(values: dict[tuple[int, int], int]) -> Path:
        d = tmp_path / "tiles"
        d.mkdir(exist_ok=True)
        for (r, c), v in values.items():
            data = np.full((3, TILE_PX, TILE_PX), v, dtype=np.uint8)
            write_tile(d / f"siret3_r{r:03d}_c{c:03d}.tif", data, tile_transform(r, c))
        return d

    return _make

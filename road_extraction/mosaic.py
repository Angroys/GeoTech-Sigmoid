"""Downscaled field mosaic built with decimated (overview-style) rasterio reads.

Each source tile is read straight into its block of the output array with
``out_shape`` + ``Resampling.average``, so the full-resolution field is never
held in memory. Every tile maps to exactly ``out_px x out_px`` mosaic pixels,
which keeps the mosaic lattice aligned with the tile lattice; the effective
GSD is therefore ``tile_size_m / out_px`` (see :func:`tile_out_px`).
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass

import numpy as np
import numpy.typing as npt
import rasterio
from affine import Affine
from rasterio.crs import CRS
from rasterio.enums import Resampling

from road_extraction.tiles import TileGrid, TileInfo


@dataclass
class Mosaic:
    """A north-up raster with its own affine.

    ``image`` is ``(H, W, C)``; ``valid`` is ``(H, W)`` bool (False where no tile
    or where treated as nodata).
    """

    image: npt.NDArray[np.generic]
    valid: npt.NDArray[np.bool_]
    transform: Affine
    crs: CRS
    tile_px: int
    row_min: int
    col_min: int

    @property
    def shape(self) -> tuple[int, int]:
        return (int(self.image.shape[0]), int(self.image.shape[1]))

    @property
    def gsd(self) -> float:
        """Ground sample distance (metres per pixel, x direction)."""
        return float(self.transform.a)

    def tile_slice(self, row: int, col: int) -> tuple[slice, slice]:
        """Mosaic pixel slices ``(rows, cols)`` covered by lattice tile ``(row, col)``."""
        r0 = (row - self.row_min) * self.tile_px
        c0 = (col - self.col_min) * self.tile_px
        return slice(r0, r0 + self.tile_px), slice(c0, c0 + self.tile_px)


def tile_out_px(tile_size_px: int, tile_res: float, target_gsd: float) -> int:
    """Pixels per tile side in the mosaic so that GSD is as close as possible to ``target_gsd``."""
    if target_gsd <= 0:
        raise ValueError("target_gsd must be > 0")
    return max(1, round(tile_size_px * tile_res / target_gsd))


def tile_out_px_from_scale(tile_size_px: int, scale: float) -> int:
    """Pixels per tile side for a downscale factor ``scale`` (e.g. 40 -> 2048/40 ~= 51)."""
    if scale <= 0:
        raise ValueError("scale must be > 0")
    return max(1, round(tile_size_px / scale))


def read_tile_decimated(
    tile: TileInfo,
    out_px: int,
    bands: Sequence[int] | None = None,
    resampling: Resampling = Resampling.average,
) -> npt.NDArray[np.generic]:
    """Read ``tile`` decimated to ``(out_px, out_px, C)`` in one rasterio call."""
    indexes = list(bands) if bands is not None else list(range(1, tile.count + 1))
    with rasterio.open(tile.path) as ds:
        arr = ds.read(indexes, out_shape=(len(indexes), out_px, out_px), resampling=resampling)
    return np.moveaxis(arr, 0, -1)


def _nodata_mask(block: npt.NDArray[np.generic], nodata: float | None, black_as_nodata: bool) -> npt.NDArray[np.bool_]:
    invalid = np.zeros(block.shape[:2], dtype=bool)
    if nodata is not None:
        invalid |= np.all(block == nodata, axis=-1)
    if black_as_nodata:
        invalid |= np.all(block == 0, axis=-1)
    return invalid


def build_mosaic(
    grid: TileGrid,
    out_px: int,
    bands: Sequence[int] | None = None,
    rows: tuple[int, int] | None = None,
    cols: tuple[int, int] | None = None,
    resampling: Resampling = Resampling.average,
    black_as_nodata: bool = True,
    fill_value: int = 0,
) -> Mosaic:
    """Mosaic of ``grid`` (or the inclusive tile sub-range ``rows``/``cols``) at ``out_px`` per tile.

    Missing tiles are filled with ``fill_value`` and marked invalid. When
    ``black_as_nodata`` is set, pixels that are 0 in every band are also marked
    invalid (the Siret3 tiles have ``nodata=None`` but pad outside the field with
    RGB black).
    """
    r_lo, r_hi = rows if rows is not None else (grid.row_min, grid.row_max)
    c_lo, c_hi = cols if cols is not None else (grid.col_min, grid.col_max)
    if r_hi < r_lo or c_hi < c_lo:
        raise ValueError("empty tile range")
    ref = next(iter(grid.tiles.values()))
    n_bands = len(bands) if bands is not None else ref.count
    h, w = (r_hi - r_lo + 1) * out_px, (c_hi - c_lo + 1) * out_px
    image = np.full((h, w, n_bands), fill_value, dtype=np.dtype(ref.dtype))
    valid = np.zeros((h, w), dtype=bool)
    for (r, c), tile in grid.tiles.items():
        if not (r_lo <= r <= r_hi and c_lo <= c <= c_hi):
            continue
        block = read_tile_decimated(tile, out_px, bands, resampling)
        r0, c0 = (r - r_lo) * out_px, (c - c_lo) * out_px
        image[r0 : r0 + out_px, c0 : c0 + out_px] = block
        valid[r0 : r0 + out_px, c0 : c0 + out_px] = ~_nodata_mask(block, tile.nodata, black_as_nodata)
    ox, oy = grid.tile_origin(r_lo, c_lo)
    transform = Affine(grid.tile_width_m / out_px, 0.0, ox, 0.0, -grid.tile_height_m / out_px, oy)
    return Mosaic(
        image=image, valid=valid, transform=transform, crs=grid.crs, tile_px=out_px, row_min=r_lo, col_min=c_lo
    )

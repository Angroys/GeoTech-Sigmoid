"""Pixel <-> CRS transforms, resampling mosaic rasters to tile grids, GeoTIFF writing.

Pixel convention: ``(row, col)`` integer indices address pixel *centres* when
``offset="center"``, i.e. pixel ``(0, 0)`` covers ``[0, 1) x [0, 1)`` in
continuous image space and its centre is at ``(0.5, 0.5)``.
"""

from __future__ import annotations

from pathlib import Path
from typing import Literal

import numpy as np
import numpy.typing as npt
import rasterio
from affine import Affine
from rasterio.crs import CRS
from rasterio.enums import Resampling
from rasterio.warp import reproject

Offset = Literal["center", "ul"]
ArrayLike = npt.ArrayLike
FloatArray = npt.NDArray[np.float64]


def _shift(offset: Offset) -> float:
    if offset == "center":
        return 0.5
    if offset == "ul":
        return 0.0
    raise ValueError(f"unknown offset: {offset}")


def pixel_to_crs(
    transform: Affine, rows: ArrayLike, cols: ArrayLike, offset: Offset = "center"
) -> tuple[FloatArray, FloatArray]:
    """Map (fractional) pixel ``rows``/``cols`` to CRS ``(xs, ys)`` using ``transform``."""
    s = _shift(offset)
    r = np.asarray(rows, dtype=np.float64) + s
    c = np.asarray(cols, dtype=np.float64) + s
    xs = transform.a * c + transform.b * r + transform.c
    ys = transform.d * c + transform.e * r + transform.f
    return xs, ys


def crs_to_pixel(
    transform: Affine, xs: ArrayLike, ys: ArrayLike, offset: Offset = "center"
) -> tuple[FloatArray, FloatArray]:
    """Inverse of :func:`pixel_to_crs`: CRS ``(xs, ys)`` to fractional ``(rows, cols)``."""
    inv = ~transform
    x = np.asarray(xs, dtype=np.float64)
    y = np.asarray(ys, dtype=np.float64)
    cols = inv.a * x + inv.b * y + inv.c
    rows = inv.d * x + inv.e * y + inv.f
    s = _shift(offset)
    return rows - s, cols - s


def resample_to_grid(
    src: npt.NDArray[np.generic],
    src_transform: Affine,
    dst_transform: Affine,
    dst_shape: tuple[int, int],
    crs: CRS | str,
    resampling: Resampling = Resampling.bilinear,
    src_nodata: float | None = None,
    dst_fill: float = 0.0,
) -> FloatArray:
    """Resample a 2-D ``src`` raster onto a destination grid (same CRS) and return float64."""
    dst = np.full(dst_shape, dst_fill, dtype=np.float64)
    reproject(
        source=np.ascontiguousarray(src, dtype=np.float64),
        destination=dst,
        src_transform=src_transform,
        src_crs=crs,
        dst_transform=dst_transform,
        dst_crs=crs,
        resampling=resampling,
        src_nodata=src_nodata,
        dst_nodata=dst_fill,
        init_dest_nodata=True,
    )
    return dst


def crop_raster(
    arr: npt.NDArray[np.generic],
    transform: Affine,
    rows: slice,
    cols: slice,
    margin: int = 0,
) -> tuple[npt.NDArray[np.generic], Affine]:
    """Crop ``arr[rows, cols]`` grown by ``margin`` px (clamped to the array) and return its affine.

    Used to hand :func:`resample_to_grid` only the neighbourhood of one tile
    instead of the whole field mosaic.
    """
    h, w = arr.shape[:2]
    r0 = max(0, (rows.start or 0) - margin)
    r1 = min(h, (rows.stop if rows.stop is not None else h) + margin)
    c0 = max(0, (cols.start or 0) - margin)
    c1 = min(w, (cols.stop if cols.stop is not None else w) + margin)
    if r1 <= r0 or c1 <= c0:
        raise ValueError("crop is empty")
    return arr[r0:r1, c0:c1], transform @ Affine.translation(c0, r0)


def resample_mask_to_tile(
    mask: npt.NDArray[np.generic],
    mosaic_transform: Affine,
    tile_transform: Affine,
    tile_shape: tuple[int, int],
    crs: CRS | str,
    method: Literal["nearest", "bilinear"] = "bilinear",
    threshold: float = 0.5,
) -> npt.NDArray[np.bool_]:
    """Resample a mosaic-level mask/probability back to one source tile's grid.

    ``method="nearest"`` keeps the blocky mosaic pixels; ``"bilinear"``
    interpolates then thresholds at ``threshold`` (smoother edges).
    """
    rs = Resampling.nearest if method == "nearest" else Resampling.bilinear
    vals = resample_to_grid(mask.astype(np.float64), mosaic_transform, tile_transform, tile_shape, crs, rs)
    return vals >= threshold


def to_uint8_mask(mask: npt.NDArray[np.generic], on_value: int = 255) -> npt.NDArray[np.uint8]:
    """Boolean/0-1 mask -> uint8 with ``on_value`` for road pixels."""
    return np.where(np.asarray(mask) > 0, on_value, 0).astype(np.uint8)


def write_mask_geotiff(
    path: str | Path,
    mask: npt.NDArray[np.generic],
    transform: Affine,
    crs: CRS | str,
    on_value: int = 255,
    nodata: int | None = None,
) -> Path:
    """Write a single-band uint8 mask GeoTIFF (deflate, tiled) with the given georeferencing.

    Bool masks are written as ``0/on_value``; uint8 input is written as-is.
    """
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    data = mask if mask.dtype == np.uint8 else to_uint8_mask(mask, on_value)
    h, w = data.shape
    profile = {
        "driver": "GTiff",
        "height": h,
        "width": w,
        "count": 1,
        "dtype": "uint8",
        "crs": crs,
        "transform": transform,
        "compress": "deflate",
        "nodata": nodata,
    }
    if h % 16 == 0 and w % 16 == 0 and h >= 256 and w >= 256:
        profile.update(tiled=True, blockxsize=256, blockysize=256)
    with rasterio.open(path, "w", **profile) as dst:
        dst.write(data, 1)
    return path

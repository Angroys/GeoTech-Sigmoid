"""Serve a survey's uploaded GeoTIFF tiles as Web Mercator XYZ map tiles (its orthomosaic background)."""
from __future__ import annotations

import io
import math
from functools import lru_cache
from pathlib import Path

import numpy as np

from . import service

TILE_PX = 256
ORIGIN = 20037508.342789244  # half the Web Mercator world width, metres


def tile_bounds(z: int, x: int, y: int) -> tuple[float, float, float, float]:
    """(west, south, east, north) of an XYZ tile in EPSG:3857 metres."""
    size = 2 * ORIGIN / 2**z
    west = -ORIGIN + x * size
    north = ORIGIN - y * size
    return west, north - size, west + size, north


@lru_cache(maxsize=4096)
def _mercator_bounds(path: str, mtime: float) -> tuple[float, float, float, float]:
    import rasterio
    from rasterio.warp import transform_bounds

    with rasterio.open(path) as src:
        return transform_bounds(src.crs, "EPSG:3857", *src.bounds, densify_pts=21)


def _tiles_with_bounds(survey_id: str) -> list[tuple[Path, tuple[float, float, float, float]]]:
    return [(p, _mercator_bounds(str(p), p.stat().st_mtime)) for p in service.tiles(survey_id)]


def lnglat_bounds(survey_id: str) -> list[float] | None:
    boxes = [b for _, b in _tiles_with_bounds(survey_id)]
    if not boxes:
        return None
    w, s = min(b[0] for b in boxes), min(b[1] for b in boxes)
    e, n = max(b[2] for b in boxes), max(b[3] for b in boxes)

    def lng(xm: float) -> float:
        return xm / ORIGIN * 180

    def lat(ym: float) -> float:
        return math.degrees(2 * math.atan(math.exp(ym / ORIGIN * math.pi)) - math.pi / 2)

    return [lng(w), lat(s), lng(e), lat(n)]


def render_tile(survey_id: str, z: int, x: int, y: int) -> bytes | None:
    """PNG of the uploaded tiles covering this XYZ tile, or None when none overlap."""
    import rasterio
    from PIL import Image
    from rasterio.transform import from_bounds
    from rasterio.warp import Resampling, reproject

    west, south, east, north = tile_bounds(z, x, y)
    overlapping = [p for p, (w, s, e, n) in _tiles_with_bounds(survey_id)
                   if w < east and e > west and s < north and n > south]
    if not overlapping:
        return None
    dst_transform = from_bounds(west, south, east, north, TILE_PX, TILE_PX)
    rgba = np.zeros((4, TILE_PX, TILE_PX), dtype=np.uint8)
    for path in overlapping:
        with rasterio.open(path) as src:
            bands = min(src.count, 3)
            out = np.zeros((3, TILE_PX, TILE_PX), dtype=np.uint8)
            for band in range(bands):
                reproject(
                    source=rasterio.band(src, band + 1), destination=out[band],
                    dst_transform=dst_transform, dst_crs="EPSG:3857",
                    resampling=Resampling.bilinear if z >= 18 else Resampling.average,
                )
            if bands < 3:
                out[bands:] = out[0]
            valid = out.max(axis=0) > 0  # black padding stays transparent
            rgba[:3, valid] = out[:, valid]
            rgba[3, valid] = 255
    buffer = io.BytesIO()
    Image.fromarray(rgba.transpose(1, 2, 0), "RGBA").save(buffer, "PNG", optimize=False)
    return buffer.getvalue()

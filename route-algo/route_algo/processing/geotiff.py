"""Light GeoTIFF header validation (tifffile + GeoKeys, no GDAL)."""
from __future__ import annotations

import io
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import tifffile

EXPECTED_EPSG = 32635
EXPECTED_SIZE = 2048
EXPECTED_GSD_M = 0.025
GSD_TOLERANCE_M = 0.0005


class TileError(ValueError):
    """A tile does not satisfy the challenge tile contract."""


@dataclass(frozen=True)
class TileInfo:
    width: int
    height: int
    epsg: int
    pixel_size_m: float
    # World coordinates (EPSG:32635) of the tile's top-left corner.
    origin_x: float
    origin_y: float

    def pixel_to_world(self, col: float, row: float) -> tuple[float, float]:
        return self.origin_x + col * self.pixel_size_m, self.origin_y - row * self.pixel_size_m


def _epsg(tags: dict[str, Any]) -> int | None:
    for key in ("ProjectedCSTypeGeoKey", "GeographicTypeGeoKey"):
        value = tags.get(key)
        if value is not None:
            return int(value)
    return None


def _georeference(tags: dict[str, Any]) -> tuple[float, float, float, float]:
    """Return (scale_x, scale_y, origin_x, origin_y)."""
    transform = tags.get("ModelTransformation")
    if transform is not None:
        values = [float(v) for v in (transform.flatten() if hasattr(transform, "flatten") else transform)]
        if len(values) >= 8 and values[1] == 0 and values[4] == 0:
            return values[0], -values[5], values[3], values[7]
        raise TileError("The tile is rotated; only north-up GeoTIFFs are supported.")
    scale = tags.get("ModelPixelScale")
    tiepoint = tags.get("ModelTiepoint")
    if scale is None or tiepoint is None:
        raise TileError("The GeoTIFF has no georeferencing (ModelPixelScale/ModelTiepoint).")
    sx, sy = float(scale[0]), float(scale[1])
    i, j, x, y = (float(tiepoint[k]) for k in (0, 1, 3, 4))
    return sx, sy, x - i * sx, y + j * sy


def read_tile_info(source: bytes | Path) -> TileInfo:
    """Parse and validate a challenge tile. Raises TileError naming the problem."""
    try:
        handle = tifffile.TiffFile(io.BytesIO(source) if isinstance(source, bytes) else source)
    except Exception as exc:  # tifffile raises many types for garbage input
        raise TileError("The file is not a TIFF image.") from exc
    with handle:
        if not handle.pages:
            raise TileError("The TIFF file contains no image.")
        page = handle.pages[0]
        tags = getattr(page, "geotiff_tags", None)
        if not tags:
            raise TileError("The TIFF has no GeoTIFF tags; it is not a GeoTIFF.")
        epsg = _epsg(tags)
        if epsg != EXPECTED_EPSG:
            raise TileError(f"The tile uses CRS EPSG:{epsg}; expected EPSG:{EXPECTED_EPSG} (WGS 84 / UTM 35N).")
        height, width = int(page.shape[0]), int(page.shape[1])
        if (width, height) != (EXPECTED_SIZE, EXPECTED_SIZE):
            raise TileError(f"The tile is {width} x {height} px; expected {EXPECTED_SIZE} x {EXPECTED_SIZE} px.")
        sx, sy, ox, oy = _georeference(tags)
        if abs(sx - EXPECTED_GSD_M) > GSD_TOLERANCE_M or abs(sy - EXPECTED_GSD_M) > GSD_TOLERANCE_M:
            raise TileError(f"The tile resolution is {sx:g} x {sy:g} m per pixel; expected {EXPECTED_GSD_M} m per pixel.")
        return TileInfo(width, height, epsg, sx, ox, oy)

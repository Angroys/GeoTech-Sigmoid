"""Tile discovery and raster rendering (rasterio-backed).

Reads GeoTIFF tiles, exposes their geotransform + CRS, and renders 8-bit RGB
PNGs (full-ish resolution for the viewer, downscaled for thumbnails).
"""
from __future__ import annotations

import io
from pathlib import Path
from typing import Any

import numpy as np
import rasterio
from PIL import Image
from rasterio.enums import Resampling

from . import config

THUMB_SIZE = 512
VIEWER_MAX = 1536  # cap the viewer PNG so responses stay light


def list_tile_names() -> list[str]:
    tdir = config.tiles_dir()
    if not tdir.is_dir():
        return []
    return sorted(p.name for p in tdir.glob("*.tif"))


def tile_path(name: str) -> Path:
    """Resolve a tile filename to its absolute path (guards traversal)."""
    if "/" in name or "\\" in name or not name.endswith(".tif"):
        raise ValueError(f"invalid tile name {name!r}")
    p = config.tiles_dir() / name
    if not p.is_file():
        raise FileNotFoundError(f"tile not found: {name}")
    return p


def tile_geo(name: str) -> dict[str, Any]:
    """Return CRS, geotransform and dimensions for a tile."""
    with rasterio.open(str(tile_path(name))) as ds:
        t = ds.transform
        return {
            "name": name,
            "crs": str(ds.crs),
            "width": ds.width,
            "height": ds.height,
            "transform": [t.a, t.b, t.c, t.d, t.e, t.f],
            "bounds": list(ds.bounds),
            "count": ds.count,
            "dtypes": [str(d) for d in ds.dtypes],
        }


def _to_uint8_rgb(arr: np.ndarray) -> np.ndarray:
    """Normalise a (bands, h, w) array into an (h, w, 3) uint8 RGB image."""
    if arr.dtype != np.uint8:
        arr = arr.astype(np.float32)
        flat = arr.reshape(arr.shape[0], -1)
        lo = np.nanpercentile(flat, 2, axis=1).reshape(-1, 1, 1)
        hi = np.nanpercentile(flat, 98, axis=1).reshape(-1, 1, 1)
        span = np.where(hi - lo > 0, hi - lo, 1.0)
        arr = np.clip((arr - lo) / span, 0, 1) * 255.0
        arr = arr.astype(np.uint8)

    bands = arr.shape[0]
    if bands >= 3:
        rgb = np.transpose(arr[:3], (1, 2, 0))
    else:
        gray = arr[0]
        rgb = np.stack([gray, gray, gray], axis=-1)
    return np.ascontiguousarray(rgb)


def render_png(name: str, thumb: bool = False) -> bytes:
    """Render a tile to PNG bytes (RGB, 8-bit)."""
    target = THUMB_SIZE if thumb else VIEWER_MAX
    with rasterio.open(str(tile_path(name))) as ds:
        scale = min(1.0, target / max(ds.width, ds.height))
        out_w = max(1, int(ds.width * scale))
        out_h = max(1, int(ds.height * scale))
        n = min(ds.count, 3) if ds.count >= 3 else ds.count
        arr = ds.read(
            indexes=list(range(1, n + 1)),
            out_shape=(n, out_h, out_w),
            resampling=Resampling.bilinear,
        )
    rgb = _to_uint8_rgb(arr)
    buf = io.BytesIO()
    Image.fromarray(rgb, mode="RGB").save(buf, format="PNG")
    return buf.getvalue()

"""Whole-area imagery mosaic for the progress map.

Every tile (siret3_rRRR_cCCC) is downsampled to ``cell`` px and placed at its
survey grid position (row → y, col → x), producing one small JPEG of the real
imagery. The frontend draws status colours on top. Imagery is static, so the
result is cached on disk per cell size.
"""
from __future__ import annotations

import io
import re
import threading
from pathlib import Path

import numpy as np
import rasterio
from PIL import Image
from rasterio.enums import Resampling

from . import config, tiles

_RC = re.compile(r"_r(\d+)_c(\d+)")
_lock = threading.Lock()


def layout() -> dict:
    """Grid extent of all tiles: min row/col and number of rows/cols."""
    rcs = [m for m in (_RC.search(n) for n in tiles.list_tile_names()) if m]
    rows = [int(m.group(1)) for m in rcs]
    cols = [int(m.group(2)) for m in rcs]
    if not rows:
        return {"r0": 0, "c0": 0, "rows": 0, "cols": 0}
    return {"r0": min(rows), "c0": min(cols), "rows": max(rows) - min(rows) + 1, "cols": max(cols) - min(cols) + 1}


def mosaic_path(cell: int) -> Path:
    return config.exports_dir() / f"mosaic_{cell}.jpg"


def build_mosaic(cell: int = 48) -> Path:
    """Build (or reuse) the cached mosaic JPEG for the given cell size."""
    out = mosaic_path(cell)
    with _lock:
        if out.exists():
            return out
        lay = layout()
        canvas = np.full((lay["rows"] * cell, lay["cols"] * cell, 3), 14, dtype=np.uint8)
        for name in tiles.list_tile_names():
            m = _RC.search(name)
            if not m:
                continue
            r, c = int(m.group(1)) - lay["r0"], int(m.group(2)) - lay["c0"]
            try:
                with rasterio.open(tiles.tile_path(name)) as src:
                    arr = src.read([1, 2, 3], out_shape=(3, cell, cell), resampling=Resampling.average)
            except Exception:  # noqa: BLE001 - a bad tile just stays dark
                continue
            canvas[r * cell:(r + 1) * cell, c * cell:(c + 1) * cell] = arr.transpose(1, 2, 0)
        buf = io.BytesIO()
        Image.fromarray(canvas).save(buf, format="JPEG", quality=82)
        out.write_bytes(buf.getvalue())
        return out

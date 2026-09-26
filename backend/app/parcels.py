"""Vineyard parcel outlines, reprojected into the views the frontend draws.

Parcels are EPSG:32635 polygons. The tile viewer needs them in a tile's pixel
space (clipped to that tile's footprint); the progress map needs them in grid
units (1 unit = one tile, origin = top-left of the mosaic).
"""
from __future__ import annotations

import json
import re
from functools import lru_cache
from typing import Any

import rasterio
from shapely.geometry import box, mapping, shape

from . import config, mosaic, tiles

_RC = re.compile(r"_r(\d+)_c(\d+)")


@lru_cache(maxsize=1)
def _load(mtime: float) -> list[dict[str, Any]]:
    data = json.loads(config.parcels_path().read_text())
    out = []
    for i, f in enumerate(data.get("features", [])):
        g = shape(f["geometry"])
        if g.is_empty:
            continue
        out.append({"id": i, "geom": g if g.is_valid else g.buffer(0), "props": f.get("properties", {})})
    return out


def _parcels() -> list[dict[str, Any]]:
    p = config.parcels_path()
    if not p.exists():
        return []
    return _load(p.stat().st_mtime)


def _rings(geom) -> list[list[tuple[float, float]]]:
    polys = [geom] if geom.geom_type == "Polygon" else list(getattr(geom, "geoms", []))
    return [list(p.exterior.coords) for p in polys if p.geom_type == "Polygon" and not p.is_empty]


def for_tile(name: str) -> list[dict[str, Any]]:
    """Parcel outlines clipped to a tile, in that tile's pixel coords."""
    with rasterio.open(tiles.tile_path(name)) as ds:
        t, w, h = ds.transform, ds.width, ds.height
    x0, y1 = t * (0, 0)
    x1, y0 = t * (w, h)
    foot = box(min(x0, x1), min(y0, y1), max(x0, x1), max(y0, y1))
    inv = ~t
    out = []
    for p in _parcels():
        if not p["geom"].intersects(foot):
            continue
        clipped = p["geom"].intersection(foot)
        for ring in _rings(clipped):
            pts = [[round(c, 2), round(r, 2)] for c, r in (inv * (x, y) for x, y in ring)]
            out.append({"id": p["id"], "points": pts, "area_m2": p["props"].get("area_m2")})
    return out


def for_map() -> dict[str, Any]:
    """Parcel outlines in mosaic grid units (x = col, y = row; 1 unit = 1 tile)."""
    lay = mosaic.layout()
    names = tiles.list_tile_names()
    ref = next((n for n in names if _RC.search(n)), None)
    if not ref:
        return {"layout": lay, "parcels": []}
    m = _RC.search(ref)
    r, c = int(m.group(1)), int(m.group(2))
    with rasterio.open(tiles.tile_path(ref)) as ds:
        t, w = ds.transform, ds.width
    size = t.a * w  # tile edge in metres (north-up grid)
    x_origin = t.c - (c - lay["c0"]) * size
    y_origin = t.f + (r - lay["r0"]) * size
    out = []
    for p in _parcels():
        for ring in _rings(p["geom"]):
            out.append({
                "id": p["id"],
                "points": [[round((x - x_origin) / size, 4), round((y_origin - y) / size, 4)] for x, y in ring],
                "area_m2": p["props"].get("area_m2"),
            })
    return {"layout": lay, "parcels": out}

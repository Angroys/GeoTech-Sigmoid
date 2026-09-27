"""Vineyard parcel outlines, reprojected into the views the frontend draws.

Parcels are EPSG:32635 polygons. The tile viewer needs them in a tile's pixel
space (clipped to that tile's footprint); the progress map needs them in grid
units (1 unit = one tile, origin = top-left of the mosaic).
"""
from __future__ import annotations

import json
import re
from pathlib import Path
from functools import lru_cache
from typing import Any

import rasterio
from shapely.geometry import box, mapping, shape

from . import config, mosaic, tiles

_RC = re.compile(r"_r(\d+)_c(\d+)")
MAP_SIMPLIFY_M = 0.5  # metres; parcel outlines sent to the map/editor


def _active_path():
    """Edited copy if one exists (edits never overwrite the original file)."""
    src = config.parcels_path()
    edited = src.with_name(src.stem.replace("_edited", "") + "_edited.geojson")
    return edited if edited.exists() else src


def _edited_path():
    src = config.parcels_path()
    return src.with_name(src.stem.replace("_edited", "") + "_edited.geojson")


@lru_cache(maxsize=2)
def _load(path_str: str, mtime: float) -> list[dict[str, Any]]:
    data = json.loads(Path(path_str).read_text())
    out = []
    for i, f in enumerate(data.get("features", [])):
        g = shape(f["geometry"])
        if g.is_empty:
            continue
        props = dict(f.get("properties") or {})
        pid = int(props.get("pid", i))
        props["pid"] = pid
        out.append({"id": pid, "geom": g if g.is_valid else g.buffer(0), "props": props})
    return out


def _parcels() -> list[dict[str, Any]]:
    p = _active_path()
    if not p.exists():
        return []
    return _load(str(p), p.stat().st_mtime)


def _save(items: list[dict[str, Any]]) -> None:
    """Write the edited parcel set (EPSG:32635) next to the original."""
    fc = {
        "type": "FeatureCollection",
        "crs": {"type": "name", "properties": {"name": "urn:ogc:def:crs:EPSG::32635"}},
        "features": [
            {"type": "Feature", "properties": {**it["props"], "pid": it["id"], "area_m2": round(it["geom"].area, 2)},
             "geometry": mapping(it["geom"])}
            for it in items
        ],
    }
    _edited_path().write_text(json.dumps(fc))


def _grid_frame() -> tuple[float, float, float, dict]:
    """(x_origin, y_origin, tile_size_m, layout) mapping grid units <-> world."""
    lay = mosaic.layout()
    names = tiles.list_tile_names()
    ref = next((n for n in names if _RC.search(n)), None)
    if not ref:
        raise RuntimeError("no tiles")
    m = _RC.search(ref)
    r, c = int(m.group(1)), int(m.group(2))
    with rasterio.open(tiles.tile_path(ref)) as ds:
        t, w = ds.transform, ds.width
    size = t.a * w
    return t.c - (c - lay["c0"]) * size, t.f + (r - lay["r0"]) * size, size, lay


def update_parcel(pid: int, grid_points: list[list[float]]) -> dict[str, Any]:
    """Replace a parcel's outline with points given in map grid units."""
    from shapely.geometry import Polygon
    if len(grid_points) < 3:
        raise ValueError("a parcel needs at least 3 points")
    xo, yo, size, _ = _grid_frame()
    ring = [(xo + x * size, yo - y * size) for x, y in grid_points]
    poly = Polygon(ring)
    if not poly.is_valid:
        poly = poly.buffer(0)
    items = [dict(it) for it in _parcels()]
    for it in items:
        if it["id"] == pid:
            it["geom"] = poly
            _save(items)
            return {"id": pid, "area_m2": round(poly.area, 2)}
    raise KeyError(pid)


def delete_parcel(pid: int) -> None:
    items = _parcels()
    keep = [it for it in items if it["id"] != pid]
    if len(keep) == len(items):
        raise KeyError(pid)
    _save(keep)


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
    try:
        xo, yo, size, lay = _grid_frame()
    except RuntimeError:
        return {"layout": mosaic.layout(), "parcels": [], "edited": False}
    out = []
    for p in _parcels():
        # Auto-traced parcels have 1000+ corners; 0.5 m simplification is
        # invisible at map scale and leaves an editable handful of corners.
        g = p["geom"].simplify(MAP_SIMPLIFY_M, preserve_topology=True)
        for ring in _rings(g):
            out.append({
                "id": p["id"],
                "points": [[round((x - xo) / size, 4), round((yo - y) / size, 4)] for x, y in ring[:-1]],
                "area_m2": round(p["geom"].area, 1),
                "rings": len(_rings(g)),
            })
    return {"layout": lay, "parcels": out, "edited": _active_path() != config.parcels_path()}

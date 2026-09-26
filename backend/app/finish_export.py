"""Write finished, georeferenced per-tile outputs into the ``finish`` dataset.

When a tile's annotations are saved (``PUT /tiles/{name}/annotations``), the
platform also emits that tile's finished deliverables into ``config.finish_dir()``:

    * ``{tilebase}_mask.tif``       -- the georeferenced label-mask GeoTIFF
      (reuses :func:`app.masks.write_mask_geotiff`); the primary deliverable.
    * ``{tilebase}__labels.geojson`` -- a ``FeatureCollection`` in EPSG:32635
      world coordinates.

The GeoJSON is the reverse of :mod:`app.geojson_import`: each stored annotation's
pixel points ``[x, y]`` (``[col, row]``) are mapped to world coordinates via the
tile's affine transform ``T`` (``x_world, y_world = T * (col, row)``). Closed
shapes (``polygon`` / ``box``) become GeoJSON ``Polygon`` features (closed
exterior ring), ``polyline`` shapes become ``LineString`` features. The
annotation ``label`` and every attribute are carried into feature properties,
and a named ``crs`` member records EPSG:32635 so the round-trip through the
importer is lossless.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import rasterio
from rasterio.transform import xy as transform_xy

from . import config, db, masks, tiles

# GeoJSON named-CRS member for the tiles' world coordinate system.
GEOJSON_CRS: dict[str, Any] = {
    "type": "name",
    "properties": {"name": "EPSG:32635"},
}


def _tilebase(tile_name: str) -> str:
    """Return the tile name without its ``.tif`` extension."""
    return tile_name[: -len(".tif")] if tile_name.endswith(".tif") else tile_name


def _pixels_to_world(points: list[list[float]], transform: Any) -> list[list[float]]:
    """Map pixel ``[x=col, y=row]`` points to world ``[x, y]`` via the affine ``T``.

    Exact inverse of the importer's ``rowcol`` (upper-left/corner convention),
    so a save -> import round-trip is lossless.
    """
    world: list[list[float]] = []
    for x, y in points:
        # xy(transform, row, col, offset="ul") == transform * (col, row).
        wx, wy = transform_xy(transform, float(y), float(x), offset="ul")
        world.append([wx, wy])
    return world


def _feature_for(ann: dict[str, Any], transform: Any) -> dict[str, Any] | None:
    """Build a GeoJSON feature (world coords) for one stored annotation."""
    shape_type = ann["shape_type"]
    pts = ann.get("points") or []

    if shape_type in ("polygon", "box"):
        if shape_type == "box":
            # Box is stored as [top-left, bottom-right]; expand to a rectangle.
            if len(pts) < 2:
                return None
            (xtl, ytl), (xbr, ybr) = pts[0], pts[1]
            pts = [[xtl, ytl], [xbr, ytl], [xbr, ybr], [xtl, ybr]]
        if len(pts) < 3:
            return None
        ring = _pixels_to_world(pts, transform)
        if ring[0] != ring[-1]:
            ring.append(ring[0])  # close the ring for a valid GeoJSON Polygon
        geometry = {"type": "Polygon", "coordinates": [ring]}
    elif shape_type == "polyline":
        if len(pts) < 2:
            return None
        geometry = {
            "type": "LineString",
            "coordinates": _pixels_to_world(pts, transform),
        }
    else:  # unknown shape type -- skip
        return None

    properties: dict[str, Any] = {"label": ann["label"]}
    for key, value in (ann.get("attributes") or {}).items():
        properties[key] = value

    return {"type": "Feature", "geometry": geometry, "properties": properties}


def write_labels_geojson(tile_name: str, out_path: str | Path) -> Path:
    """Write a tile's stored annotations as an EPSG:32635 GeoJSON FeatureCollection."""
    src_path = tiles.tile_path(tile_name)
    annotations = db.export_annotations(tile_name)
    out_path = Path(out_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)

    with rasterio.open(str(src_path)) as src:
        transform = src.transform

    features: list[dict[str, Any]] = []
    for ann in annotations:
        feat = _feature_for(ann, transform)
        if feat is not None:
            features.append(feat)

    fc = {
        "type": "FeatureCollection",
        "crs": GEOJSON_CRS,
        "features": features,
    }
    out_path.write_text(json.dumps(fc))
    return out_path


def write_finish_outputs(tile_name: str, finish_directory: Path | None = None) -> dict[str, Path]:
    """Write the finished mask GeoTIFF + labels GeoJSON for a tile into ``finish``.

    Returns ``{"mask": <path>, "geojson": <path>}``. Raises on failure (missing
    tile, unreadable raster); callers that must stay robust guard the call.
    """
    finish_directory = finish_directory or config.finish_dir()
    finish_directory.mkdir(parents=True, exist_ok=True)
    base = _tilebase(tile_name)

    mask_path = finish_directory / f"{base}_mask.tif"
    geojson_path = finish_directory / f"{base}__labels.geojson"

    masks.write_mask_geotiff(tile_name, mask_path)
    write_labels_geojson(tile_name, geojson_path)
    return {"mask": mask_path, "geojson": geojson_path}


def remove_finish_outputs(tile_name: str, finish_directory: Path | None = None) -> list[Path]:
    """Delete a tile's files from the ``finish`` dataset (used when a tile is
    invalidated, so rejected images never enter the dataset). Returns removed paths."""
    finish_directory = finish_directory or config.finish_dir()
    base = _tilebase(tile_name)
    removed: list[Path] = []
    for path in (finish_directory / f"{base}_mask.tif", finish_directory / f"{base}__labels.geojson"):
        if path.exists():
            path.unlink()
            removed.append(path)
    return removed

"""Rasterize annotations into per-class label-mask GeoTIFFs.

The source tile's CRS (EPSG:32635) and geotransform are read and copied
verbatim onto the output so the mask is pixel-aligned and georeferenced
identically to the source.

Class -> mask value map (config.CLASS_VALUE_MAP)
    0 = background
    1 = vineyard
    2 = row
    3 = interrow_area
    4 = waste

Rasterization
    Annotation points are in image/pixel coordinates, so geometries are burned
    with an identity transform onto the (height, width) pixel grid; the source
    geotransform + CRS are then written to the output GeoTIFF metadata.

    Polylines (``row``) are BUFFERED into thin polygons (ROW_BUFFER_PX pixels
    wide) so they occupy real pixels in the label mask.

    Burn priority (later overwrites earlier at overlaps): vineyard, then
    interrow_area, then waste, then row on top — so thin row lines stay visible.
"""
from __future__ import annotations

from pathlib import Path
from typing import Any, Iterable

import numpy as np
import rasterio
from affine import Affine
from rasterio.features import rasterize
from shapely.geometry import LineString, Polygon

from . import config, db, tiles

ROW_BUFFER_PX = 1.5  # half-width in pixels -> ~3px wide burned line

# Lower number burns first; higher overwrites at overlaps.
_BURN_PRIORITY = {"vineyard": 0, "interrow_area": 1, "waste": 2, "row": 3}


def _geom_for(ann: dict[str, Any]):
    pts = [(float(x), float(y)) for x, y in ann["points"]]
    shape_type = ann["shape_type"]
    label = ann["label"]
    if shape_type == "box":
        (xtl, ytl), (xbr, ybr) = pts
        return Polygon([(xtl, ytl), (xbr, ytl), (xbr, ybr), (xtl, ybr)])
    if shape_type == "polyline" or label == "row":
        if len(pts) < 2:
            return None
        return LineString(pts).buffer(ROW_BUFFER_PX)
    if len(pts) < 3:
        return None
    return Polygon(pts)


def build_mask_array(annotations: Iterable[dict[str, Any]], width: int, height: int) -> np.ndarray:
    """Burn annotations into a single-band uint8 label mask (pixel space)."""
    ordered = sorted(
        annotations, key=lambda a: _BURN_PRIORITY.get(a["label"], 99)
    )
    shapes: list[tuple[Any, int]] = []
    for ann in ordered:
        value = config.CLASS_VALUE_MAP.get(ann["label"])
        if value is None:
            continue
        geom = _geom_for(ann)
        if geom is None or geom.is_empty:
            continue
        shapes.append((geom, value))

    if not shapes:
        return np.zeros((height, width), dtype=np.uint8)

    return rasterize(
        shapes,
        out_shape=(height, width),
        fill=0,
        transform=Affine.identity(),
        all_touched=False,
        dtype=np.uint8,
    )


def write_mask_geotiff(tile_name: str, out_path: str | Path) -> Path:
    """Rasterize a tile's stored annotations and write a georeferenced mask."""
    src_path = tiles.tile_path(tile_name)
    annotations = db.list_annotations(tile_name)
    out_path = Path(out_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)

    with rasterio.open(str(src_path)) as src:
        mask = build_mask_array(annotations, src.width, src.height)
        profile = {
            "driver": "GTiff",
            "height": src.height,
            "width": src.width,
            "count": 1,
            "dtype": "uint8",
            "crs": src.crs,
            "transform": src.transform,
            "compress": "deflate",
            "nodata": None,
        }
        with rasterio.open(str(out_path), "w", **profile) as dst:
            dst.write(mask, 1)

    return out_path

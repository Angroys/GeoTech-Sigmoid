"""SAM (Segment Anything Model) GeoJSON pre-annotation importer.

The SAM pipeline emits one GeoJSON ``FeatureCollection`` per tile in world
coordinates (EPSG:32635). This module discovers those files, matches each to
its GeoTIFF tile, converts every feature's world coordinates into pixel
coordinates via the tile's inverse affine transform, maps geometries onto the
platform's annotation record shape (the same shape produced by ``app.cvat``
and consumed by ``app.db``), and inserts them with ``source="sam"``.

Canonical form
--------------
``{tilebase}__labels.geojson`` with a ``label`` property in
{vineyard, waste, interrow_area, row}. Polygons -> ``polygon`` (exterior ring
only), LineStrings -> ``polyline``. Multi* geometries explode into one
annotation per part.

Earlier, less-refined variants are also supported:
    * ``{tile}__vineyard.geojson`` / ``{tile}__rows.geojson`` (``label`` set).
    * ``{tile}__{prompt}.geojson`` carrying only a ``prompt`` property, mapped
      to a label via :data:`PROMPT_LABEL_MAP`.

Label derivation order: ``properties.label`` -> prompt map -> filename suffix
after ``__``. A feature with no derivable label is skipped and counted.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Iterable

import rasterio
from rasterio.crs import CRS
from rasterio.transform import rowcol
from rasterio.warp import transform as warp_transform

from . import config, db, tiles

# Recognised platform labels.
VALID_LABELS = {"vineyard", "waste", "interrow_area", "row", "dead_vine"}

# prompt property -> platform label (earlier ``out/`` variant).
PROMPT_LABEL_MAP = {
    "grapevine": "vineyard",
    "small green plant": "vineyard",
    "plastic bag": "waste",
    "trash": "waste",
}

# filename suffix (after ``__``, sans ``.geojson``) -> platform label.
SUFFIX_LABEL_MAP = {
    "vineyard": "vineyard",
    "vineyards": "vineyard",
    "rows": "row",
    "row": "row",
    "waste": "waste",
    "interrow_area": "interrow_area",
    "interrow": "interrow_area",
    "dead_vine": "dead_vine",
    "dead_vines": "dead_vine",
}

# Optional feature-property keys carried into annotation attributes when present.
_ATTR_KEYS = ("score", "row_structure", "area_m2", "length_m", "prompt")


def _split_filename(path: Path) -> tuple[str, str]:
    """Return (tilebase, suffix) for a ``{tilebase}__{suffix}.geojson`` name.

    ``suffix`` is the part after the first ``__`` (minus the ``.geojson``
    extension), or ``""`` when the name has no ``__`` separator.
    """
    stem = path.name[: -len(".geojson")] if path.name.endswith(".geojson") else path.stem
    if "__" in stem:
        tilebase, suffix = stem.split("__", 1)
        return tilebase, suffix
    return stem, ""


def _derive_label(props: dict[str, Any], suffix: str) -> str | None:
    """Derive a platform label from properties or the filename suffix."""
    label = props.get("label")
    if isinstance(label, str) and label.strip():
        return label.strip()
    prompt = props.get("prompt")
    if isinstance(prompt, str) and prompt.strip().lower() in PROMPT_LABEL_MAP:
        return PROMPT_LABEL_MAP[prompt.strip().lower()]
    if suffix:
        return SUFFIX_LABEL_MAP.get(suffix.lower())
    return None


def _feature_crs(fc: dict[str, Any]) -> CRS | None:
    """Extract a CRS from a GeoJSON FeatureCollection ``crs`` member, if any."""
    crs = fc.get("crs")
    if not isinstance(crs, dict):
        return None
    name = crs.get("properties", {}).get("name")
    if not name:
        return None
    try:
        return CRS.from_user_input(name)
    except Exception:  # pragma: no cover - malformed CRS strings
        return None


def _iter_parts(geom: dict[str, Any]) -> Iterable[tuple[str, Any]]:
    """Yield (shape_type, coordinates) parts for a GeoJSON geometry.

    Explodes Multi* geometries into one part each. ``shape_type`` is the
    platform value ("polygon" or "polyline"). Unsupported geometry types
    yield nothing.
    """
    gtype = geom.get("type")
    coords = geom.get("coordinates")
    if coords is None:
        return
    if gtype == "Polygon":
        yield "polygon", coords
    elif gtype == "MultiPolygon":
        for poly in coords:
            yield "polygon", poly
    elif gtype == "LineString":
        yield "polyline", coords
    elif gtype == "MultiLineString":
        for line in coords:
            yield "polyline", line


def _ring_to_points(
    coords: list[list[float]],
    transform: Any,
    reproject: tuple[CRS, CRS] | None,
    drop_closing: bool,
) -> list[list[float]]:
    """Convert a ring/line of world coords to pixel ``[col, row]`` points."""
    xs = [float(c[0]) for c in coords]
    ys = [float(c[1]) for c in coords]
    if reproject is not None:
        src, dst = reproject
        xs, ys = warp_transform(src, dst, xs, ys)
    points: list[list[float]] = []
    for x, y in zip(xs, ys):
        r, c = rowcol(transform, x, y, op=float)
        points.append([float(c), float(r)])
    if drop_closing and len(points) >= 2 and points[0] == points[-1]:
        points = points[:-1]
    return points


def _build_attributes(props: dict[str, Any]) -> dict[str, Any]:
    """Carry known optional keys into the annotation attributes dict."""
    return {k: props[k] for k in _ATTR_KEYS if k in props and props[k] is not None}


def discover_files(directory: Path) -> list[Path]:
    """Return sorted ``*.geojson`` files directly under ``directory``."""
    if not directory.is_dir():
        return []
    return sorted(directory.glob("*.geojson"))


def import_dir(
    directory: str | Path | None = None,
    tiles_directory: str | Path | None = None,
) -> dict[str, Any]:
    """Import all SAM GeoJSON files in ``directory`` into the annotation store.

    Returns a summary dict:
    ``{source, tiles, images, shapes_imported, skipped, labels: {label: count}}``.
    """
    directory = Path(directory) if directory is not None else config.sam_dir()
    tiles_directory = (
        Path(tiles_directory) if tiles_directory is not None else config.tiles_dir()
    )

    files = discover_files(directory)

    # Group files by tilebase so all features for a tile are inserted together.
    by_tile: dict[str, list[Path]] = {}
    for f in files:
        tilebase, _ = _split_filename(f)
        by_tile.setdefault(tilebase, []).append(f)

    shapes_imported = 0
    skipped = 0
    label_counts: dict[str, int] = {}
    tiles_seen = 0
    images: list[str] = []

    for tilebase, tile_files in sorted(by_tile.items()):
        tif_path = tiles_directory / f"{tilebase}.tif"
        if not tif_path.is_file():
            # No matching tile raster: cannot convert world -> pixel; skip all.
            for f in tile_files:
                try:
                    fc = json.loads(f.read_text())
                except (ValueError, OSError):
                    continue
                skipped += len(fc.get("features", []))
            continue

        with rasterio.open(str(tif_path)) as ds:
            transform = ds.transform
            tile_crs = ds.crs

        annotations: list[dict[str, Any]] = []
        for f in tile_files:
            _, suffix = _split_filename(f)
            try:
                fc = json.loads(f.read_text())
            except (ValueError, OSError):
                continue
            src_crs = _feature_crs(fc)
            reproject: tuple[CRS, CRS] | None = None
            if src_crs is not None and tile_crs is not None and src_crs != tile_crs:
                reproject = (src_crs, tile_crs)

            for feat in fc.get("features", []):
                props = feat.get("properties") or {}
                geom = feat.get("geometry") or {}
                label = _derive_label(props, suffix)
                if label is None:
                    skipped += 1
                    continue
                attributes = _build_attributes(props)
                emitted = False
                for shape_type, part in _iter_parts(geom):
                    if shape_type == "polygon":
                        # Polygon coords = [exterior_ring, *holes]; use exterior.
                        ring = part[0] if part else []
                        points = _ring_to_points(
                            ring, transform, reproject, drop_closing=True
                        )
                    else:
                        points = _ring_to_points(
                            part, transform, reproject, drop_closing=False
                        )
                    if len(points) < 2:
                        continue
                    annotations.append(
                        {
                            "label": label,
                            "shape_type": shape_type,
                            "points": points,
                            "attributes": attributes,
                            "source": "sam",
                        }
                    )
                    label_counts[label] = label_counts.get(label, 0) + 1
                    shapes_imported += 1
                    emitted = True
                if not emitted:
                    skipped += 1

        tile_name = f"{tilebase}.tif"
        db.replace_annotations(tile_name, annotations)
        images.append(tile_name)
        tiles_seen += 1

    return {
        "source": str(directory),
        "tiles": tiles_seen,
        "images": len(images),
        "shapes_imported": shapes_imported,
        "skipped": skipped,
        "labels": label_counts,
    }

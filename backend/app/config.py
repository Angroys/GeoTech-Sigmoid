"""Central configuration resolved from environment variables.

All paths are resolved to absolute paths so the app behaves the same
regardless of the working directory it is launched from.
"""
from __future__ import annotations

import os
from pathlib import Path

# backend/ root (this file lives in backend/app/config.py)
BACKEND_ROOT = Path(__file__).resolve().parent.parent

# Repo root is two levels above the worktree's backend dir in the normal
# layout, but we derive the default tiles path relative to the known data dir.
_DEFAULT_TILES = (
    BACKEND_ROOT.parent.parent.parent
    / "data"
    / "marcaj-data"
    / "assets_for_participants"
    / "01_tiles"
)

_DEFAULT_CVAT_EXAMPLE = (
    BACKEND_ROOT.parent.parent.parent
    / "data"
    / "marcaj-data"
    / "assets_for_participants"
    / "05_examples"
    / "siret3_examples_cvat"
)

# SAM (Segment Anything Model) GeoJSON pre-annotation output lives at the repo
# root by default (three levels above backend/, same base as the tiles path).
_DEFAULT_SAM = BACKEND_ROOT.parent.parent.parent / "labels"


def db_path() -> Path:
    p = Path(os.environ.get("GEOTECH_DB", str(BACKEND_ROOT / "data" / "geotech.db")))
    p.parent.mkdir(parents=True, exist_ok=True)
    return p


def tiles_dir() -> Path:
    return Path(os.environ.get("GEOTECH_TILES", str(_DEFAULT_TILES)))


def cvat_example_path() -> Path:
    return Path(os.environ.get("GEOTECH_CVAT_EXAMPLE", str(_DEFAULT_CVAT_EXAMPLE)))


def sam_dir() -> Path:
    """Directory of SAM GeoJSON pre-annotation output (EPSG:32635)."""
    return Path(os.environ.get("GEOTECH_SAM_DIR", str(_DEFAULT_SAM)))


def exports_dir() -> Path:
    p = Path(os.environ.get("GEOTECH_EXPORTS", str(BACKEND_ROOT / "exports")))
    p.mkdir(parents=True, exist_ok=True)
    return p


def finish_dir() -> Path:
    """Directory for finished, georeferenced per-tile outputs ("finish" dataset).

    Default: ``<repo_root>/data/finish`` (three levels above backend/, same base
    as the tiles path). Override with GEOTECH_FINISH_DIR. Created if missing.

    NOTE: ``data/`` is gitignored -- writing finished outputs here is intended
    and must NOT be committed.
    """
    p = Path(
        os.environ.get(
            "GEOTECH_FINISH_DIR",
            str(BACKEND_ROOT.parent.parent.parent / "data" / "finish"),
        )
    )
    p.mkdir(parents=True, exist_ok=True)
    return p


def parcels_path() -> Path:
    """Vineyard parcel outlines (EPSG:32635 GeoJSON) shown on the site.

    Env GEOTECH_PARCELS; default <repo_root>/data/tested-on-vm/parcels/parcels_v2.geojson.
    """
    return Path(os.environ.get(
        "GEOTECH_PARCELS",
        str(BACKEND_ROOT.parent.parent.parent / "data" / "tested-on-vm" / "parcels" / "parcels_v2.geojson"),
    ))


def frontend_dist() -> Path:
    """Built frontend (Vite dist) to serve as a single-origin SPA.

    Default: the sibling frontend/dist next to backend/. Override with
    GEOTECH_FRONTEND_DIST. When present, the API app also serves the UI so the
    whole thing runs on one origin/port (no separate dev server or proxy).
    """
    return Path(os.environ.get("GEOTECH_FRONTEND_DIST", str(BACKEND_ROOT.parent / "frontend" / "dist")))


# Fixed class -> mask value map (documented; used by app/masks.py).
CLASS_VALUE_MAP: dict[str, int] = {
    "background": 0,
    "vineyard": 1,
    "row": 2,
    "interrow_area": 3,
    "waste": 4,
    "dead_vine": 5,
}

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


# Fixed class -> mask value map (documented; used by app/masks.py).
CLASS_VALUE_MAP: dict[str, int] = {
    "background": 0,
    "vineyard": 1,
    "row": 2,
    "interrow_area": 3,
    "waste": 4,
}

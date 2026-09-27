"""Shared test fixtures and path resolution."""
from __future__ import annotations

import os
from pathlib import Path

import pytest

BACKEND_ROOT = Path(__file__).resolve().parent.parent
DATA_ROOT = BACKEND_ROOT.parent.parent.parent / "data" / "marcaj-data" / "assets_for_participants"
CVAT_EXAMPLE = DATA_ROOT / "05_examples" / "siret3_examples_cvat"
TILES_DIR = DATA_ROOT / "01_tiles"


@pytest.fixture(scope="session")
def cvat_example() -> Path:
    return CVAT_EXAMPLE


@pytest.fixture(scope="session")
def tiles_dir() -> Path:
    return TILES_DIR


@pytest.fixture(autouse=True)
def _isolated_db(tmp_path, monkeypatch):
    """Point the app at a throwaway DB + meta store for each test."""
    monkeypatch.setenv("GEOTECH_DB", str(tmp_path / "test.db"))
    monkeypatch.setenv("GEOTECH_TILES", str(TILES_DIR))
    yield

"""End-to-end checks for the "magic draw" segmentation endpoint.

CV is approximate, so assertions are deliberately tolerant -- the point is that
the endpoint runs end-to-end and returns a valid, in-bounds shape. The route
handler is exercised directly (like the other tests in this suite) so no HTTP
client dependency is required.
"""
from __future__ import annotations

from pathlib import Path

import pytest
from fastapi import HTTPException

from app import api, db, segment
from app.api import SegmentRequest

TILE = "siret3_r007_c002.tif"
TILE_SIZE = 2048

# Seed points chosen from the tile's ExG vegetation mask (see the module docs):
# a dense-vegetation spot and an obvious bare-soil spot.
VEG_SEED = [[416, 1632], [430, 1640], [445, 1650]]
SOIL_SEED = [[1696, 32], [1710, 40]]


@pytest.fixture
def tile_present(tiles_dir: Path) -> Path:
    p = tiles_dir / TILE
    if not p.exists():
        pytest.skip(f"tile {TILE} not present at {p}")
    return p


def _call(path: list[list[float]], hint: str = "auto") -> dict:
    return api.segment_tile(TILE, SegmentRequest(path=path, hint=hint))


def _in_bounds(points: list[list[float]]) -> bool:
    return all(0 <= x <= TILE_SIZE and 0 <= y <= TILE_SIZE for x, y in points)


def test_vegetation_scribble_returns_vineyard_polygon(tile_present: Path):
    db.init_db()
    body = _call(VEG_SEED)
    assert body.get("found") is not False, body
    assert body["label"] == "vineyard"
    assert body["shape_type"] == "polygon"
    assert len(body["points"]) >= 3
    assert _in_bounds(body["points"])
    assert 0.0 <= body["confidence"] <= 1.0
    assert isinstance(body["reason"], str) and body["reason"]


def test_soil_scribble_is_not_vineyard(tile_present: Path):
    db.init_db()
    body = _call(SOIL_SEED)
    # A non-veg area should either segment to a non-vineyard class or find
    # nothing segmentable -- but never call bare soil "vineyard".
    if body.get("found") is False:
        return
    assert body["label"] in {"waste", "row", "interrow_area"}
    if "points" in body:
        assert _in_bounds(body["points"])
        assert len(body["points"]) >= 2


def test_single_point_hover_grows_a_region(tile_present: Path):
    db.init_db()
    body = _call([[416, 1632]])
    assert body.get("found") is not False
    assert len(body["points"]) >= 3
    assert _in_bounds(body["points"])


def test_empty_path_is_rejected(tile_present: Path):
    with pytest.raises(HTTPException) as exc:
        _call([])
    assert exc.value.status_code == 400


def test_unknown_tile_is_404():
    with pytest.raises(HTTPException) as exc:
        api.segment_tile("does_not_exist.tif", SegmentRequest(path=[[1, 1]]))
    assert exc.value.status_code == 404


def test_vertex_cap_respected(tile_present: Path):
    db.init_db()
    body = _call(VEG_SEED)
    if body.get("found") is not False and body["shape_type"] == "polygon":
        assert len(body["points"]) <= 60


def _centroid(points: list[list[float]]) -> tuple[float, float]:
    xs = [p[0] for p in points]
    ys = [p[1] for p in points]
    return sum(xs) / len(xs), sum(ys) / len(ys)


def test_soil_segmentation_stays_local_to_the_seed(tile_present: Path):
    """Two far-apart soil seeds must return polygons near their OWN seed.

    Regression for the "label spawns in the middle" bug: a large connected
    soil/inter-row blob used to flood the whole tile, so every seed returned the
    same tile-centre polygon. The clip window keeps each result local.
    """
    db.init_db()
    seed_a = (1700, 400)
    seed_b = (600, 700)
    res_a = segment.segment(TILE, [list(seed_a)])
    res_b = segment.segment(TILE, [list(seed_b)])

    assert res_a.get("points"), res_a
    assert res_b.get("points"), res_b

    cax, cay = _centroid(res_a["points"])
    cbx, cby = _centroid(res_b["points"])

    # Each region stays near its own seed (roughly within the point window).
    dist_a = ((cax - seed_a[0]) ** 2 + (cay - seed_a[1]) ** 2) ** 0.5
    dist_b = ((cbx - seed_b[0]) ** 2 + (cby - seed_b[1]) ** 2) ** 0.5
    assert dist_a <= 400, (seed_a, (cax, cay), dist_a)
    assert dist_b <= 400, (seed_b, (cbx, cby), dist_b)

    # The two centroids must be substantially different (not one shared blob).
    sep = ((cax - cbx) ** 2 + (cay - cby) ** 2) ** 0.5
    assert sep >= 500, ((cax, cay), (cbx, cby), sep)


def test_available_backends_reported():
    backends = segment.available_backends()
    assert set(backends) == {"scipy", "skimage"}
    assert all(isinstance(v, bool) for v in backends.values())

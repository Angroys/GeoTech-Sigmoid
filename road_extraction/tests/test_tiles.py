from __future__ import annotations

import pytest

from road_extraction.tests.conftest import ORIGIN_X, ORIGIN_Y, RES, TILE_PX, tile_transform
from road_extraction.tiles import build_grid, find_tile_paths, parse_tile_name, read_tile_info, scan_tiles


@pytest.mark.parametrize(
    ("name", "expected"),
    [
        ("siret3_r005_c004.tif", (5, 4)),
        ("siret3_r039_c023.tif", (39, 23)),
        ("/some/dir/siret3_r100_c000.TIF", (100, 0)),
        ("field_x_r1_c2.tiff", (1, 2)),
        ("overview.png", None),
        ("siret3_r005.tif", None),
        ("siret3_rAA_c004.tif", None),
    ],
)
def test_parse_tile_name(name: str, expected: tuple[int, int] | None) -> None:
    assert parse_tile_name(name) == expected


def test_scan_and_grid(make_tiles) -> None:
    d = make_tiles({(5, 4): 10, (6, 4): 20, (6, 5): 30})
    (d / "overview.png").write_bytes(b"x")
    assert set(find_tile_paths(d)) == {(5, 4), (6, 4), (6, 5)}
    tiles = scan_tiles(d)
    grid = build_grid(tiles)
    assert (grid.row_min, grid.row_max, grid.col_min, grid.col_max) == (5, 6, 4, 5)
    assert grid.missing() == [(5, 5)]
    assert grid.tile_width_m == pytest.approx(TILE_PX * RES)
    assert grid.origin_x == pytest.approx(ORIGIN_X + 4 * TILE_PX * RES)
    assert grid.origin_y == pytest.approx(ORIGIN_Y - 5 * TILE_PX * RES)
    # r+1 is south, c+1 is east, tiles abut exactly
    a, s, e = grid.tiles[(5, 4)].bounds, grid.tiles[(6, 4)].bounds, grid.tiles[(6, 5)].bounds
    assert s.top == pytest.approx(a.bottom)
    assert e.left == pytest.approx(s.right)
    assert grid.bounds.left == pytest.approx(a.left) and grid.bounds.top == pytest.approx(a.top)


def test_read_tile_info(make_tiles) -> None:
    d = make_tiles({(2, 3): 1})
    info = read_tile_info(d / "siret3_r002_c003.tif")
    assert (info.row, info.col, info.count, info.dtype, info.shape) == (2, 3, 3, "uint8", (TILE_PX, TILE_PX))
    assert info.transform.almost_equals(tile_transform(2, 3))
    assert info.crs.to_epsg() == 32635


def test_build_grid_rejects_off_lattice(make_tiles) -> None:
    import dataclasses

    tiles = scan_tiles(make_tiles({(0, 0): 1, (0, 1): 1}))
    shifted = dataclasses.replace(tiles[1], transform=tiles[1].transform @ tiles[1].transform.translation(3, 0))
    with pytest.raises(ValueError, match="off-lattice"):
        build_grid([tiles[0], shifted])

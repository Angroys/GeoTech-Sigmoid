from __future__ import annotations

import numpy as np
import pytest
import rasterio
from affine import Affine

from road_extraction.geo import crs_to_pixel, pixel_to_crs, resample_mask_to_tile, write_mask_geotiff
from road_extraction.mosaic import build_mosaic, tile_out_px, tile_out_px_from_scale
from road_extraction.tests.conftest import CRS, RES, TILE_PX, tile_transform, write_tile
from road_extraction.tiles import build_grid, scan_tiles

KNOWN = Affine(0.5, 0.0, 629000.0, 0.0, -0.5, 5221000.0)


def test_pixel_to_crs_known_affine() -> None:
    xs, ys = pixel_to_crs(KNOWN, [0, 10], [0, 4])
    np.testing.assert_allclose(xs, [629000.25, 629002.25])
    np.testing.assert_allclose(ys, [5220999.75, 5220994.75])
    xs, ys = pixel_to_crs(KNOWN, 0, 0, offset="ul")
    assert (float(xs), float(ys)) == (629000.0, 5221000.0)


@pytest.mark.parametrize("transform", [KNOWN, tile_transform(7, 3), Affine(1.0, 0.2, 10.0, -0.1, -1.0, 50.0)])
def test_pixel_crs_roundtrip(transform: Affine) -> None:
    rng = np.random.default_rng(0)
    rows, cols = rng.uniform(0, 2048, 100), rng.uniform(0, 2048, 100)
    r2, c2 = crs_to_pixel(transform, *pixel_to_crs(transform, rows, cols))
    np.testing.assert_allclose(r2, rows, atol=1e-6)
    np.testing.assert_allclose(c2, cols, atol=1e-6)


def test_matches_rasterio_xy() -> None:
    t = tile_transform(5, 4)
    x, y = rasterio.transform.xy(t, 17, 33)
    xs, ys = pixel_to_crs(t, 17, 33)
    assert float(xs) == pytest.approx(x) and float(ys) == pytest.approx(y)


def test_out_px_helpers() -> None:
    assert tile_out_px(2048, 0.025, 1.0) == 51
    assert tile_out_px(2048, 0.025, 0.5) == 102
    assert tile_out_px_from_scale(2048, 32) == 64


def test_mosaic_from_synthetic_tiles(make_tiles) -> None:
    d = make_tiles({(5, 4): 10, (6, 4): 20, (6, 5): 30})
    grid = build_grid(scan_tiles(d))
    out_px = 16
    m = build_mosaic(grid, out_px)
    assert m.shape == (32, 32) and m.image.shape == (32, 32, 3)
    assert m.gsd == pytest.approx(TILE_PX * RES / out_px)
    assert m.transform.c == pytest.approx(grid.origin_x) and m.transform.f == pytest.approx(grid.origin_y)
    assert (m.image[:16, :16] == 10).all()
    assert (m.image[16:, :16] == 20).all()
    assert (m.image[16:, 16:] == 30).all()
    assert (m.image[:16, 16:] == 0).all()
    assert m.valid[:16, :16].all() and not m.valid[:16, 16:].any()
    # a mosaic pixel centre maps inside the matching source tile
    xs, ys = pixel_to_crs(m.transform, 20, 25)
    b = grid.tiles[(6, 5)].bounds
    assert b.left < float(xs) < b.right and b.bottom < float(ys) < b.top
    rs, cs = m.tile_slice(6, 5)
    assert (rs.start, cs.start) == (16, 16)


def test_mosaic_average_and_black_nodata(tmp_path) -> None:
    data = np.zeros((3, TILE_PX, TILE_PX), dtype=np.uint8)
    data[:, :, TILE_PX // 2 :] = 200  # left half black (outside field), right half imagery
    data[:, : TILE_PX // 4, TILE_PX // 2 : TILE_PX // 2 + 2] = 100
    write_tile(tmp_path / "siret3_r000_c000.tif", data, tile_transform(0, 0))
    grid = build_grid(scan_tiles(tmp_path))
    m = build_mosaic(grid, 4)
    assert not m.valid[:, :2].any() and m.valid[:, 2:].all()
    m2 = build_mosaic(grid, 4, black_as_nodata=False)
    assert m2.valid.all()
    # decimation uses averaging: block (0, 2) mixes 100 and 200
    assert 100 < int(m.image[0, 2, 0]) < 200


def test_mosaic_subrange(make_tiles) -> None:
    grid = build_grid(scan_tiles(make_tiles({(0, 0): 1, (0, 1): 2, (1, 1): 3})))
    m = build_mosaic(grid, 8, rows=(1, 1), cols=(1, 1))
    assert m.shape == (8, 8) and (m.image == 3).all()
    assert m.transform.c == pytest.approx(grid.tiles[(1, 1)].transform.c)


def test_mask_resampled_back_to_tile_aligns(make_tiles) -> None:
    grid = build_grid(scan_tiles(make_tiles({(0, 0): 1, (0, 1): 1, (1, 0): 1, (1, 1): 1})))
    out_px = 16
    m = build_mosaic(grid, out_px)
    mask = np.zeros(m.shape, dtype=bool)
    mask[20:24, 5:9] = True  # lies in tile (1, 0), mosaic pixels rows 4..7 / cols 5..8 of that tile
    tile = grid.tiles[(1, 0)]
    scale = TILE_PX // out_px
    for method in ("nearest", "bilinear"):
        tm = resample_mask_to_tile(mask, m.transform, tile.transform, tile.shape, grid.crs, method=method)
        assert tm.shape == tile.shape
        expected = np.zeros(tile.shape, dtype=bool)
        expected[4 * scale : 8 * scale, 5 * scale : 9 * scale] = True
        if method == "nearest":
            np.testing.assert_array_equal(tm, expected)
        else:
            assert (tm != expected).mean() < 0.02
    empty = resample_mask_to_tile(mask, m.transform, grid.tiles[(0, 1)].transform, tile.shape, grid.crs)
    assert not empty.any()


def test_write_mask_geotiff(tmp_path) -> None:
    t = tile_transform(3, 2, tile_px=512)
    mask = np.zeros((512, 512), dtype=bool)
    mask[100:110, :] = True
    p = write_mask_geotiff(tmp_path / "out" / "m.tif", mask, t, CRS)
    with rasterio.open(p) as ds:
        assert ds.crs.to_epsg() == 32635 and ds.transform.almost_equals(t)
        assert ds.dtypes[0] == "uint8" and ds.count == 1
        assert ds.profile["compress"].lower() == "deflate"
        arr = ds.read(1)
    assert set(np.unique(arr)) == {0, 255} and (arr[100:110] == 255).all()

from __future__ import annotations

from pathlib import Path

import pytest

from road_extraction import paths


def test_env_override_wins(tmp_path: Path) -> None:
    assert paths.resolve_repo_root({paths.REPO_ROOT_ENV: str(tmp_path)}) == tmp_path.resolve()


def test_resolves_main_repo_from_worktree() -> None:
    root = paths.resolve_repo_root({})
    # the main checkout owns `.git` (a dir); a worktree only has a `.git` file
    assert (root / ".git").is_dir()
    assert (root / "road_extraction").exists() or (root / "worktrees").exists()


def test_fallback_outside_git(tmp_path: Path) -> None:
    pkg = tmp_path / "road_extraction"
    pkg.mkdir()
    assert paths.resolve_repo_root({}, start=pkg) == tmp_path.resolve()


def test_default_dirs_and_names(tmp_path: Path) -> None:
    assert paths.default_tiles_dir(tmp_path) == tmp_path / "data/marcaj-data/assets_for_participants/01_tiles"
    assert paths.default_out_dir(tmp_path) == tmp_path / "data/road"
    assert paths.tile_stem(5, 12) == "siret3_r005_c012"
    assert paths.mask_path(tmp_path, 5, 12) == tmp_path / "masks/siret3_r005_c012_road.tif"
    assert paths.geojson_path(tmp_path, 5, 12) == tmp_path / "geojson/siret3_r005_c012_roads.geojson"
    assert paths.preview_path(tmp_path, 5, 12).parent == tmp_path / "previews"


@pytest.mark.parametrize(
    ("token", "rc"),
    [
        ("r12_c5", (12, 5)),
        ("siret3_r012_c005", (12, 5)),
        ("/x/siret3_r012_c005.tif", (12, 5)),
        ("12,5", (12, 5)),
        ("12:5", (12, 5)),
    ],
)
def test_parse_tile_selector(token: str, rc: tuple[int, int]) -> None:
    assert paths.parse_tile_selector(token) == rc


def test_parse_tile_selector_bad() -> None:
    with pytest.raises(ValueError):
        paths.parse_tile_selector("foo")


def test_parse_range() -> None:
    assert paths.parse_range("10:15") == (10, 15)
    assert paths.parse_range("10-15") == (10, 15)
    assert paths.parse_range("7") == (7, 7)
    with pytest.raises(ValueError):
        paths.parse_range("5:3")


def test_select_tiles() -> None:
    avail = [(5, 4), (6, 2), (6, 3), (7, 3), (8, 9)]
    assert paths.select_tiles(avail) == sorted(avail)
    assert paths.select_tiles(avail, tiles=["r6_c3", "8,9"]) == [(6, 3), (8, 9)]
    assert paths.select_tiles(avail, rows=(6, 7), cols=(3, 3)) == [(6, 3), (7, 3)]
    assert paths.select_tiles(avail, limit=2) == [(5, 4), (6, 2)]
    with pytest.raises(ValueError):
        paths.select_tiles(avail, tiles=["r1_c1"])

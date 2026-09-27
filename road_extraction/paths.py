"""Repo-root / default path resolution and output file naming for the road extraction CLI.

The repo root is resolved so that defaults point at the *main* checkout's
``data/`` even when the code runs from a git worktree (``worktrees/<branch>``
has no ``data/`` of its own):

1. ``$GEOTECH_REPO_ROOT`` if set;
2. else the parent of ``git rev-parse --git-common-dir`` (the main repo's
   ``.git`` for both the main checkout and any linked worktree);
3. else the directory containing ``road_extraction/``.
"""

from __future__ import annotations

import os
import re
import subprocess
from collections.abc import Iterable, Mapping
from pathlib import Path

REPO_ROOT_ENV = "GEOTECH_REPO_ROOT"
PACKAGE_DIR = Path(__file__).resolve().parent
TILES_SUBDIR = Path("data/marcaj-data/assets_for_participants/01_tiles")
OUT_SUBDIR = Path("data/road")
DEFAULT_PREFIX = "siret3"

_TILE_SEL_RE = re.compile(r"^(?:(?P<prefix>.+?)_)?r(?P<row>\d+)_c(?P<col>\d+)(?:\.tiff?)?$", re.IGNORECASE)


def git_common_dir(cwd: str | Path) -> Path | None:
    """Absolute ``git rev-parse --git-common-dir`` for ``cwd``, or ``None`` if not in a repo / no git."""
    try:
        out = subprocess.run(
            ["git", "rev-parse", "--path-format=absolute", "--git-common-dir"],
            cwd=str(cwd),
            capture_output=True,
            text=True,
            check=True,
            timeout=10,
        ).stdout.strip()
    except (OSError, subprocess.SubprocessError):
        return None
    return Path(out) if out else None


def resolve_repo_root(
    env: Mapping[str, str] | None = None,
    start: str | Path = PACKAGE_DIR,
) -> Path:
    """Main repository root (see module docstring for the resolution order)."""
    environ = os.environ if env is None else env
    override = environ.get(REPO_ROOT_ENV)
    if override:
        return Path(override).expanduser().resolve()
    common = git_common_dir(start)
    if common is not None and common.name == ".git":
        return common.parent
    return Path(start).resolve().parent


def default_tiles_dir(repo_root: Path) -> Path:
    return repo_root / TILES_SUBDIR


def default_out_dir(repo_root: Path) -> Path:
    return repo_root / OUT_SUBDIR


def tile_stem(row: int, col: int, prefix: str = DEFAULT_PREFIX) -> str:
    """``siret3_r005_c012``-style stem (3-digit zero padding, as in the source tiles)."""
    return f"{prefix}_r{row:03d}_c{col:03d}"


def mask_path(out_dir: Path, row: int, col: int, prefix: str = DEFAULT_PREFIX) -> Path:
    return out_dir / "masks" / f"{tile_stem(row, col, prefix)}_road.tif"


def geojson_path(out_dir: Path, row: int, col: int, prefix: str = DEFAULT_PREFIX) -> Path:
    return out_dir / "geojson" / f"{tile_stem(row, col, prefix)}_roads.geojson"


def preview_path(out_dir: Path, row: int, col: int, prefix: str = DEFAULT_PREFIX) -> Path:
    return out_dir / "previews" / f"{tile_stem(row, col, prefix)}_roads.png"


def parse_tile_selector(token: str) -> tuple[int, int]:
    """Parse ``r12_c5`` / ``siret3_r012_c005`` / ``siret3_r012_c005.tif`` / ``12,5`` / ``12:5`` -> ``(row, col)``."""
    tok = Path(token.strip()).name
    m = _TILE_SEL_RE.match(tok)
    if m:
        return int(m["row"]), int(m["col"])
    parts = re.split(r"[,:]", tok)
    if len(parts) == 2 and all(p.strip().isdigit() for p in parts):
        return int(parts[0]), int(parts[1])
    raise ValueError(f"cannot parse tile selector {token!r} (use e.g. r12_c5 or 12,5)")


def parse_range(spec: str) -> tuple[int, int]:
    """Inclusive integer range ``"10:15"`` / ``"10-15"`` / ``"7"`` -> ``(lo, hi)``."""
    parts = re.split(r"[:\-]", spec.strip())
    if len(parts) == 1:
        v = int(parts[0])
        return v, v
    if len(parts) == 2:
        lo, hi = int(parts[0]), int(parts[1])
        if hi < lo:
            raise ValueError(f"empty range {spec!r}")
        return lo, hi
    raise ValueError(f"bad range {spec!r}")


def select_tiles(
    available: Iterable[tuple[int, int]],
    tiles: Iterable[str] | None = None,
    rows: tuple[int, int] | None = None,
    cols: tuple[int, int] | None = None,
    limit: int | None = None,
) -> list[tuple[int, int]]:
    """Filter ``(row, col)`` keys by explicit selectors, row/col ranges and a count limit (sorted)."""
    keys = sorted(set(available))
    if tiles:
        wanted = {parse_tile_selector(t) for tok in tiles for t in tok.split() if t}
        missing = wanted - set(keys)
        if missing:
            raise ValueError(f"requested tiles not found: {sorted(missing)}")
        keys = [k for k in keys if k in wanted]
    if rows is not None:
        keys = [k for k in keys if rows[0] <= k[0] <= rows[1]]
    if cols is not None:
        keys = [k for k in keys if cols[0] <= k[1] <= cols[1]]
    if limit is not None:
        keys = keys[: max(0, limit)]
    return keys

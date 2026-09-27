"""Tile index: parse ``siret3_rRRR_cCCC.tif`` names and describe the tile grid.

Grid convention (verified on the real data): row ``r+1`` lies directly *south*
of row ``r`` and column ``c+1`` directly *east* of column ``c``; neighbouring
tiles abut exactly (no overlap, no gap) on a regular lattice.
"""

from __future__ import annotations

import re
from collections.abc import Iterable
from dataclasses import dataclass
from pathlib import Path

import rasterio
from affine import Affine
from rasterio.coords import BoundingBox
from rasterio.crs import CRS
from rasterio.transform import array_bounds

TILE_NAME_RE = re.compile(r"^(?P<prefix>.+?)_r(?P<row>\d+)_c(?P<col>\d+)\.tiff?$", re.IGNORECASE)


@dataclass(frozen=True)
class TileInfo:
    """Georeferencing metadata of one source tile."""

    row: int
    col: int
    path: Path
    transform: Affine
    crs: CRS
    width: int
    height: int
    count: int
    dtype: str
    nodata: float | None

    @property
    def shape(self) -> tuple[int, int]:
        """``(height, width)`` in pixels."""
        return (self.height, self.width)

    @property
    def bounds(self) -> BoundingBox:
        """Tile bounds ``(left, bottom, right, top)`` in CRS units."""
        return BoundingBox(*array_bounds(self.height, self.width, self.transform))


def parse_tile_name(name: str | Path) -> tuple[int, int] | None:
    """Return ``(row, col)`` parsed from a tile filename, or ``None`` if it does not match."""
    match = TILE_NAME_RE.match(Path(name).name)
    if match is None:
        return None
    return int(match["row"]), int(match["col"])


def find_tile_paths(tiles_dir: str | Path, pattern: str = "*.tif") -> dict[tuple[int, int], Path]:
    """Map ``(row, col) -> path`` for every file in ``tiles_dir`` with a parseable name."""
    found: dict[tuple[int, int], Path] = {}
    for path in sorted(Path(tiles_dir).glob(pattern)):
        rc = parse_tile_name(path)
        if rc is not None:
            found[rc] = path
    return found


def read_tile_info(path: str | Path, row: int | None = None, col: int | None = None) -> TileInfo:
    """Open ``path`` and return its :class:`TileInfo` (row/col parsed from the name if omitted)."""
    path = Path(path)
    if row is None or col is None:
        rc = parse_tile_name(path)
        if rc is None:
            raise ValueError(f"cannot parse row/col from tile name: {path.name}")
        row, col = rc
    with rasterio.open(path) as ds:
        if ds.crs is None:
            raise ValueError(f"tile has no CRS: {path}")
        return TileInfo(
            row=row,
            col=col,
            path=path,
            transform=ds.transform,
            crs=ds.crs,
            width=ds.width,
            height=ds.height,
            count=ds.count,
            dtype=ds.dtypes[0],
            nodata=ds.nodata,
        )


def scan_tiles(tiles_dir: str | Path, pattern: str = "*.tif") -> list[TileInfo]:
    """Read :class:`TileInfo` for every parseable tile in ``tiles_dir`` (sorted by row, col)."""
    return [read_tile_info(p, r, c) for (r, c), p in sorted(find_tile_paths(tiles_dir, pattern).items())]


@dataclass(frozen=True)
class TileGrid:
    """Regular lattice of equally sized, north-up tiles sharing one CRS.

    ``origin_x``/``origin_y`` is the top-left corner of the (virtual) tile at
    ``(row_min, col_min)``; tile ``(r, c)`` has its top-left corner at
    ``(origin_x + (c - col_min) * tile_w_m, origin_y - (r - row_min) * tile_h_m)``.
    """

    tiles: dict[tuple[int, int], TileInfo]
    crs: CRS
    tile_width_px: int
    tile_height_px: int
    res_x: float
    res_y: float
    row_min: int
    row_max: int
    col_min: int
    col_max: int
    origin_x: float
    origin_y: float

    @property
    def n_rows(self) -> int:
        return self.row_max - self.row_min + 1

    @property
    def n_cols(self) -> int:
        return self.col_max - self.col_min + 1

    @property
    def tile_width_m(self) -> float:
        return self.tile_width_px * self.res_x

    @property
    def tile_height_m(self) -> float:
        return self.tile_height_px * self.res_y

    @property
    def transform(self) -> Affine:
        """Full-resolution affine of the whole grid extent (top-left at ``(row_min, col_min)``)."""
        return Affine(self.res_x, 0.0, self.origin_x, 0.0, -self.res_y, self.origin_y)

    @property
    def bounds(self) -> BoundingBox:
        """Bounds of the full grid rectangle (including missing tiles)."""
        return BoundingBox(
            self.origin_x,
            self.origin_y - self.n_rows * self.tile_height_m,
            self.origin_x + self.n_cols * self.tile_width_m,
            self.origin_y,
        )

    def missing(self) -> list[tuple[int, int]]:
        """``(row, col)`` of lattice cells inside the bounding rectangle with no tile."""
        return [
            (r, c)
            for r in range(self.row_min, self.row_max + 1)
            for c in range(self.col_min, self.col_max + 1)
            if (r, c) not in self.tiles
        ]

    def tile_origin(self, row: int, col: int) -> tuple[float, float]:
        """Top-left CRS corner of lattice cell ``(row, col)`` (present or not)."""
        return (
            self.origin_x + (col - self.col_min) * self.tile_width_m,
            self.origin_y - (row - self.row_min) * self.tile_height_m,
        )


def build_grid(tiles: Iterable[TileInfo], atol: float = 1e-6) -> TileGrid:
    """Build a :class:`TileGrid` and validate that tiles form one regular abutting lattice.

    Raises ``ValueError`` if CRS, size, resolution or placement is inconsistent,
    or if a tile is rotated / not north-up.
    """
    tiles = list(tiles)
    if not tiles:
        raise ValueError("no tiles given")
    ref = tiles[0]
    t = ref.transform
    if t.b != 0 or t.d != 0 or t.a <= 0 or t.e >= 0:
        raise ValueError(f"tile {ref.path} is not north-up: {t}")
    res_x, res_y = t.a, -t.e
    tw_m, th_m = ref.width * res_x, ref.height * res_y
    ox = t.c - ref.col * tw_m  # corner of virtual tile (0, 0)
    oy = t.f + ref.row * th_m
    by_rc: dict[tuple[int, int], TileInfo] = {}
    for tile in tiles:
        tt = tile.transform
        if tile.crs != ref.crs:
            raise ValueError(f"CRS mismatch: {tile.path} {tile.crs} != {ref.crs}")
        if tile.shape != ref.shape:
            raise ValueError(f"shape mismatch: {tile.path} {tile.shape} != {ref.shape}")
        if abs(tt.a - t.a) > atol or abs(tt.e - t.e) > atol or tt.b != 0 or tt.d != 0:
            raise ValueError(f"resolution/rotation mismatch: {tile.path}")
        exp_x, exp_y = ox + tile.col * tw_m, oy - tile.row * th_m
        if abs(tt.c - exp_x) > atol * 1e3 or abs(tt.f - exp_y) > atol * 1e3:
            raise ValueError(f"tile {tile.path} at ({tt.c}, {tt.f}) is off-lattice; expected ({exp_x}, {exp_y})")
        if (tile.row, tile.col) in by_rc:
            raise ValueError(f"duplicate tile index ({tile.row}, {tile.col})")
        by_rc[(tile.row, tile.col)] = tile
    rows = [r for r, _ in by_rc]
    cols = [c for _, c in by_rc]
    row_min, col_min = min(rows), min(cols)
    return TileGrid(
        tiles=by_rc,
        crs=ref.crs,
        tile_width_px=ref.width,
        tile_height_px=ref.height,
        res_x=res_x,
        res_y=res_y,
        row_min=row_min,
        row_max=max(rows),
        col_min=col_min,
        col_max=max(cols),
        origin_x=ox + col_min * tw_m,
        origin_y=oy - row_min * th_m,
    )

"""Preview rendering: RGB + road mask / probability overlay + CRS line drawing (PIL, no model)."""

from __future__ import annotations

from collections.abc import Sequence
from pathlib import Path

import numpy as np
import numpy.typing as npt
from affine import Affine
from PIL import Image, ImageDraw
from shapely.geometry import LineString

from road_extraction.geo import crs_to_pixel

Color = tuple[int, int, int]
ROAD_RGB: Color = (255, 40, 40)
LINE_RGB: Color = (255, 230, 0)


def to_rgb8(image: npt.NDArray[np.generic]) -> npt.NDArray[np.uint8]:
    """First three bands of an ``(H, W, C)`` array as uint8 RGB (grey if single band)."""
    arr = np.asarray(image)
    if arr.ndim == 2:
        arr = np.repeat(arr[..., None], 3, axis=-1)
    if arr.shape[-1] == 1:
        arr = np.repeat(arr, 3, axis=-1)
    arr = arr[..., :3]
    if arr.dtype != np.uint8:
        arr = np.clip(arr, 0, 255).astype(np.uint8)
    return arr


def blend_overlay(
    rgb: npt.NDArray[np.uint8],
    alpha: npt.NDArray[np.floating],
    color: Color = ROAD_RGB,
) -> npt.NDArray[np.uint8]:
    """Alpha-blend a solid ``color`` onto ``rgb`` with per-pixel ``alpha`` in 0..1."""
    a = np.clip(np.asarray(alpha, dtype=np.float32), 0.0, 1.0)[..., None]
    out = rgb.astype(np.float32) * (1.0 - a) + np.asarray(color, dtype=np.float32) * a
    return np.clip(out + 0.5, 0, 255).astype(np.uint8)


def block_reduce_mean(arr: npt.NDArray[np.generic], factor: int) -> npt.NDArray[np.float32]:
    """Mean-pool a 2-D array by an integer ``factor`` (shape must be divisible)."""
    h, w = arr.shape
    if h % factor or w % factor:
        raise ValueError(f"shape {arr.shape} not divisible by {factor}")
    return np.asarray(arr, dtype=np.float32).reshape(h // factor, factor, w // factor, factor).mean(axis=(1, 3))


def draw_lines(
    img: Image.Image,
    lines: Sequence[LineString],
    transform: Affine,
    color: Color = LINE_RGB,
    width: int = 2,
) -> Image.Image:
    """Draw CRS ``lines`` onto ``img`` whose pixel grid is described by ``transform`` (in place)."""
    draw = ImageDraw.Draw(img)
    for line in lines:
        xy = np.asarray(line.coords, dtype=np.float64)
        if len(xy) < 2:
            continue
        rows, cols = crs_to_pixel(transform, xy[:, 0], xy[:, 1], offset="ul")
        draw.line(list(zip(cols.tolist(), rows.tolist(), strict=True)), fill=color, width=width)
    return img


def render_overlay(
    rgb: npt.NDArray[np.generic],
    transform: Affine,
    road_alpha: npt.NDArray[np.floating] | None = None,
    lines: Sequence[LineString] = (),
    invalid: npt.NDArray[np.bool_] | None = None,
    max_side: int | None = None,
    min_side: int | None = None,
    line_width: int = 2,
) -> Image.Image:
    """Compose RGB + road overlay (+ darkened ``invalid``) + lines, resized to fit ``max_side``/``min_side``.

    Lines are drawn after resizing (so they stay crisp) using the rescaled transform.
    """
    base = to_rgb8(rgb)
    if invalid is not None:
        base = np.where(invalid[..., None], (base * 0.35).astype(np.uint8), base)
    if road_alpha is not None:
        base = blend_overlay(base, road_alpha)
    img = Image.fromarray(base)
    h, w = base.shape[:2]
    scale = 1.0
    if max_side is not None and max(h, w) > max_side:
        scale = max_side / max(h, w)
    elif min_side is not None and max(h, w) < min_side:
        scale = min_side / max(h, w)
    if scale != 1.0:
        size = (max(1, round(w * scale)), max(1, round(h * scale)))
        img = img.resize(size, Image.Resampling.BILINEAR if scale < 1 else Image.Resampling.NEAREST)
        transform = transform @ Affine.scale(w / size[0], h / size[1])
    if lines:
        draw_lines(img, lines, transform, width=line_width)
    return img


def save_png(img: Image.Image, path: str | Path) -> Path:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    img.save(path, optimize=False)
    return path

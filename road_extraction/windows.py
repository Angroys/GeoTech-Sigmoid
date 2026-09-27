"""Overlapping sliding windows over a raster and blended stitching of predictions."""

from __future__ import annotations

from collections.abc import Iterable
from typing import Literal, NamedTuple

import numpy as np
import numpy.typing as npt

BlendMode = Literal["uniform", "cosine", "linear"]


class PixelWindow(NamedTuple):
    """Window in raster pixel coordinates; may extend past the raster edge (padded on read)."""

    row: int
    col: int
    height: int
    width: int


def _starts(length: int, size: int, stride: int) -> list[int]:
    if length <= size:
        return [0]
    starts = list(range(0, length - size + 1, stride))
    if starts[-1] != length - size:
        starts.append(length - size)
    return starts


def generate_windows(
    shape: tuple[int, int],
    size: int,
    overlap: int = 0,
    stride: int | None = None,
) -> list[PixelWindow]:
    """Square ``size`` windows covering a ``(H, W)`` raster.

    ``stride`` defaults to ``size - overlap``. The last window in each axis is
    shifted back to end exactly at the edge; if the raster is smaller than
    ``size`` a single window starting at 0 is used (it is padded on extraction).
    """
    step = stride if stride is not None else size - overlap
    if size <= 0 or step <= 0:
        raise ValueError(f"invalid window size/stride: size={size}, stride={step}")
    h, w = shape
    return [PixelWindow(r, c, size, size) for r in _starts(h, size, step) for c in _starts(w, size, step)]


def extract_window(image: npt.NDArray[np.generic], win: PixelWindow, pad_value: float = 0) -> npt.NDArray[np.generic]:
    """Return ``image[win]`` as a full ``(height, width, ...)`` array, padding past the edge."""
    h, w = image.shape[:2]
    out = np.full((win.height, win.width, *image.shape[2:]), pad_value, dtype=image.dtype)
    r1, c1 = min(win.row + win.height, h), min(win.col + win.width, w)
    out[: r1 - win.row, : c1 - win.col] = image[win.row : r1, win.col : c1]
    return out


def blend_weights(height: int, width: int, mode: BlendMode = "cosine", floor: float = 1e-3) -> npt.NDArray[np.float64]:
    """2-D weight map for blending overlapping windows (peaks at the centre for cosine/linear)."""

    def axis(n: int) -> npt.NDArray[np.float64]:
        if mode == "uniform":
            return np.ones(n)
        t = (np.arange(n) + 0.5) / n  # in (0, 1)
        if mode == "cosine":
            return np.sin(np.pi * t) ** 2
        if mode == "linear":
            return 1.0 - np.abs(2.0 * t - 1.0)
        raise ValueError(f"unknown blend mode: {mode}")

    return np.maximum(np.outer(axis(height), axis(width)), floor)


class Stitcher:
    """Accumulate per-window predictions into a full ``(H, W[, C])`` raster with weighted averaging."""

    def __init__(self, shape: tuple[int, ...], mode: BlendMode = "cosine") -> None:
        self.shape = shape
        self.mode: BlendMode = mode
        self._sum = np.zeros(shape, dtype=np.float64)
        self._wsum = np.zeros(shape[:2], dtype=np.float64)
        self._cache: dict[tuple[int, int], npt.NDArray[np.float64]] = {}

    def _weights(self, h: int, w: int) -> npt.NDArray[np.float64]:
        if (h, w) not in self._cache:
            self._cache[(h, w)] = blend_weights(h, w, self.mode)
        return self._cache[(h, w)]

    def add(self, pred: npt.NDArray[np.generic], win: PixelWindow) -> None:
        """Add window prediction ``pred`` (``(win.height, win.width[, C])``); padded part is ignored."""
        if pred.shape[:2] != (win.height, win.width):
            raise ValueError(f"prediction shape {pred.shape[:2]} != window {(win.height, win.width)}")
        h, w = self.shape[:2]
        r1, c1 = min(win.row + win.height, h), min(win.col + win.width, w)
        wt = self._weights(win.height, win.width)[: r1 - win.row, : c1 - win.col]
        p = pred[: r1 - win.row, : c1 - win.col].astype(np.float64)
        wexp = wt if p.ndim == 2 else wt[..., None]
        self._sum[win.row : r1, win.col : c1] += p * wexp
        self._wsum[win.row : r1, win.col : c1] += wt

    def result(self, fill: float = 0.0) -> npt.NDArray[np.float64]:
        """Weighted mean; pixels never covered get ``fill``."""
        wsum = self._wsum if self._sum.ndim == 2 else self._wsum[..., None]
        with np.errstate(invalid="ignore", divide="ignore"):
            out = np.where(wsum > 0, self._sum / np.where(wsum > 0, wsum, 1.0), fill)
        return out


def stitch(
    preds: Iterable[npt.NDArray[np.generic]],
    windows: Iterable[PixelWindow],
    shape: tuple[int, ...],
    mode: BlendMode = "cosine",
) -> npt.NDArray[np.float64]:
    """Stitch per-window predictions (same order as ``windows``) into one ``shape`` raster."""
    st = Stitcher(shape, mode)
    for pred, win in zip(preds, windows, strict=True):
        st.add(pred, win)
    return st.result()

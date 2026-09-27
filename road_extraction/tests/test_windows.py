from __future__ import annotations

import numpy as np
import pytest

from road_extraction.windows import PixelWindow, Stitcher, blend_weights, extract_window, generate_windows, stitch


@pytest.mark.parametrize(
    ("shape", "size", "overlap"),
    [((100, 100), 32, 8), ((1741, 1792), 512, 128), ((50, 20), 64, 16), ((64, 64), 64, 0), ((97, 130), 30, 0)],
)
def test_windows_cover_full_extent(shape: tuple[int, int], size: int, overlap: int) -> None:
    wins = generate_windows(shape, size, overlap)
    cover = np.zeros(shape, dtype=int)
    for w in wins:
        assert w.height == w.width == size
        assert w.row >= 0 and w.col >= 0
        cover[w.row : w.row + w.height, w.col : w.col + w.width] += 1
    assert (cover > 0).all()
    if shape[0] >= size and shape[1] >= size:  # no window hangs off the edge
        assert all(w.row + size <= shape[0] and w.col + size <= shape[1] for w in wins)


def test_window_stride_respected() -> None:
    wins = generate_windows((100, 10), 10, stride=30)
    assert sorted({w.row for w in wins}) == [0, 30, 60, 90]


def test_invalid_stride() -> None:
    with pytest.raises(ValueError):
        generate_windows((10, 10), 8, overlap=8)


def test_extract_window_pads() -> None:
    img = np.arange(12, dtype=np.uint8).reshape(3, 4)
    out = extract_window(img, PixelWindow(1, 2, 4, 4), pad_value=255)
    assert out.shape == (4, 4)
    np.testing.assert_array_equal(out[:2, :2], img[1:3, 2:4])
    assert (out[2:, :] == 255).all() and (out[:, 2:] == 255).all()


@pytest.mark.parametrize("mode", ["uniform", "cosine", "linear"])
@pytest.mark.parametrize("channels", [None, 3])
def test_stitch_split_roundtrip(mode: str, channels: int | None) -> None:
    rng = np.random.default_rng(0)
    shape = (157, 203) if channels is None else (157, 203, channels)
    img = rng.random(shape)
    wins = generate_windows(shape[:2], 64, overlap=20)
    out = stitch((extract_window(img, w) for w in wins), wins, shape, mode=mode)  # type: ignore[arg-type]
    np.testing.assert_allclose(out, img, atol=1e-12)


def test_stitch_small_image_padded() -> None:
    img = np.random.default_rng(1).random((20, 30))
    wins = generate_windows(img.shape, 64)
    assert wins == [PixelWindow(0, 0, 64, 64)]
    np.testing.assert_allclose(stitch([extract_window(img, w) for w in wins], wins, img.shape), img)


def test_blend_weights_center_peak() -> None:
    w = blend_weights(9, 9, "cosine")
    assert w.argmax() == 40 and w.min() > 0


def test_stitcher_averages_overlap() -> None:
    st = Stitcher((4, 6), mode="uniform")
    st.add(np.ones((4, 4)), PixelWindow(0, 0, 4, 4))
    st.add(np.full((4, 4), 3.0), PixelWindow(0, 2, 4, 4))
    out = st.result()
    np.testing.assert_allclose(out[:, :2], 1.0)
    np.testing.assert_allclose(out[:, 2:4], 2.0)
    np.testing.assert_allclose(out[:, 4:], 3.0)

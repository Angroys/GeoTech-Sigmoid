import builtins
import importlib
import sys

import pytest

_preloaded = {m for m in ("torch", "sam3", "cv2") if m in sys.modules}


def test_module_imports_without_heavy_deps():
    mod = importlib.import_module("route_algo.processing.sam3_model")
    assert hasattr(mod, "Sam3Segmenter")
    for heavy in ("torch", "sam3", "cv2"):
        # importing the adapter must not pull in the model stack
        assert heavy not in sys.modules or heavy in _preloaded
    assert mod.OUTPUT_CLASSES == ("vineyard", "row", "interrow_area", "waste", "dead_vine")


def test_available_false_when_weights_missing(monkeypatch, tmp_path):
    from route_algo.processing.sam3_model import Sam3Segmenter

    monkeypatch.setenv("SAM3_FT_WEIGHTS", str(tmp_path / "nope" / "best.pth"))
    assert Sam3Segmenter.available() is False


def test_available_false_when_torch_missing(monkeypatch, tmp_path):
    from route_algo.processing import sam3_model

    weights = tmp_path / "best_effective.pth"
    weights.write_bytes(b"x")
    monkeypatch.setenv("SAM3_FT_WEIGHTS", str(weights))
    real_find_spec = importlib.util.find_spec
    real_import = builtins.__import__

    def fake_find_spec(name, *args, **kwargs):
        if name in ("torch", "sam3"):
            return None
        return real_find_spec(name, *args, **kwargs)

    def fake_import(name, *args, **kwargs):
        if name.split(".")[0] in ("torch", "sam3"):
            raise ImportError(name)
        return real_import(name, *args, **kwargs)

    monkeypatch.setattr(sam3_model.importlib.util, "find_spec", fake_find_spec)
    monkeypatch.setattr(builtins, "__import__", fake_import)
    assert sam3_model.Sam3Segmenter.available() is False


def test_available_never_raises(monkeypatch, tmp_path):
    from route_algo.processing import sam3_model

    weights = tmp_path / "best_effective.pth"
    weights.write_bytes(b"x")
    monkeypatch.setenv("SAM3_FT_WEIGHTS", str(weights))

    def boom(*args, **kwargs):
        raise RuntimeError("broken install")

    monkeypatch.setattr(sam3_model.importlib.util, "find_spec", boom)
    assert sam3_model.Sam3Segmenter.available() is False


def test_segment_tile_missing_weights_raises_clear_error(monkeypatch, tmp_path):
    from route_algo.processing.sam3_model import Sam3Segmenter

    seg = Sam3Segmenter(weights=tmp_path / "missing.pth", device="cpu")
    with pytest.raises(FileNotFoundError):
        seg.model()

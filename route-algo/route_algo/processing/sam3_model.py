"""Optional, lazily loaded fine-tuned SAM 3 (run3c) tile segmenter.

Importing this module never imports torch / sam3 / cv2 / rasterio; those live behind
``Sam3Segmenter.available()`` and the first ``segment_tile`` call. The model is built once per
(weights, device) and cached for the life of the process.

Environment:
  SAM3_FT_WEIGHTS   fine-tuned checkpoint: either the raw best.pth or a baked "effective" file written
                    by scripts/sam3_infer_tile.py --bake-out (default: the newest of
                    <repo>/data/tested-on-vm/sam3_ft/{run5,run3c}/best_effective.pth, then best.pth)
  SAM3_DISABLED_CLASSES  comma-separated classes to switch off (default: drop_classes from the
                    args.json next to the weights; run5 was trained without waste and dead_vine)
  SAM3_BASE_WEIGHTS base SAM 3 sam3.pt, needed only for a raw best.pth (default:
                    <repo>/data/weights/sam3/sam3.pt); see sam3_ft/model.py for why
  SAM3_ALLOW_CPU=1  allow running without CUDA (very slow; for debugging only)
  SAM3_PARCELS      optional vineyard-parcel GeoJSON (EPSG:32635); when set, labels are restricted
                    to the parcels buffered by 3 m, exactly like the precomputed run3c labels
  SAM3_TTA=0        disable flip test-time augmentation (3x faster, slightly worse)
"""

from __future__ import annotations

import functools
import importlib.util
import json
import logging
import os
import threading
from pathlib import Path
from typing import Any

log = logging.getLogger(__name__)

REPO_ROOT = Path(__file__).resolve().parents[3]
SAM3_FT_DIR = REPO_ROOT / "data/tested-on-vm/sam3_ft"
# Newest fine-tuned run first (run5: labelled tiles, batch 16, 100 epochs, waste/dead_vine not trained).
RUN_DIRS = (SAM3_FT_DIR / "run5", SAM3_FT_DIR / "run3c")
RUN3C_DIR = SAM3_FT_DIR / "run3c"
DEFAULT_BASE = REPO_ROOT / "data/weights/sam3/sam3.pt"
# The class names written in `properties.class` (same as `label` in run3c/labels/*__labels.geojson).
OUTPUT_CLASSES = ("vineyard", "row", "interrow_area", "waste", "dead_vine")

_LOCK = threading.Lock()


def weights_path() -> Path:
    env = os.environ.get("SAM3_FT_WEIGHTS")
    if env:
        return Path(env).expanduser()
    for run in RUN_DIRS:
        for name in ("best_effective.pth", "best.pth"):
            if (run / name).is_file():
                return run / name
    return RUN3C_DIR / "best.pth"


def disabled_classes(weights: Path) -> frozenset[str]:
    """Classes left out of training (train.py --drop-classes, recorded in args.json next to the
    weights); SAM3_DISABLED_CLASSES (comma-separated) overrides."""
    env = os.environ.get("SAM3_DISABLED_CLASSES")
    if env is not None:
        return frozenset(c.strip() for c in env.split(",") if c.strip())
    args = weights.parent / "args.json"
    try:
        return frozenset(json.loads(args.read_text()).get("drop_classes") or ())
    except (OSError, ValueError):
        return frozenset()


def base_weights_path() -> Path:
    return Path(os.environ.get("SAM3_BASE_WEIGHTS") or DEFAULT_BASE).expanduser()


def _is_baked(path: Path) -> bool:
    return "effective" in path.name


def load_effective_state(weights: Path, base: Path | None = None) -> dict[str, Any]:
    """Effective run3c weights: loaded as-is if baked, else baked from best.pth + sam3.pt."""
    import torch

    from .sam3_ft.model import EFFECTIVE_MARKER, bake_effective

    state = torch.load(weights, map_location="cpu", weights_only=True)
    if EFFECTIVE_MARKER in state:
        return state
    base = base or base_weights_path()
    if not base.is_file():
        raise FileNotFoundError(f"{weights} is a raw run3c checkpoint; it needs the base SAM 3 weights at {base}")
    return bake_effective(state, str(base))


def _cpu_allowed() -> bool:
    return os.environ.get("SAM3_ALLOW_CPU", "") == "1"


@functools.lru_cache(maxsize=2)
def _load_model(weights: str, device: str) -> Any:
    import torch

    from .sam3_ft.model import Sam3Seg

    log.info("Loading SAM 3 run3c weights from %s on %s", weights, device)
    state = load_effective_state(Path(weights))
    model = Sam3Seg().load_effective(state).to(device)
    del state
    if device.startswith("cuda"):
        torch.cuda.empty_cache()
    return model


@functools.lru_cache(maxsize=4)
def _load_parcels(path: str) -> list[Any]:
    from shapely.geometry import shape
    from shapely.ops import unary_union

    from .sam3_ft.vectorize import PARCEL_BUFFER_M

    data = json.loads(Path(path).read_text())
    polys = [shape(f["geometry"]).buffer(0).buffer(PARCEL_BUFFER_M) for f in data["features"]]
    u = unary_union(polys)
    return list(u.geoms) if u.geom_type == "MultiPolygon" else [u]


class Sam3Segmenter:
    """Fine-tuned SAM 3 semantic segmenter for 2048 px, 0.025 m, EPSG:32635 GeoTIFF tiles."""

    def __init__(self, weights: Path | None = None, device: str | None = None, parcels: Path | None = None) -> None:
        self.weights = Path(weights) if weights is not None else weights_path()
        self.device = device
        env_parcels = os.environ.get("SAM3_PARCELS")
        self.parcels = parcels if parcels is not None else (Path(env_parcels) if env_parcels else None)
        self.tta = os.environ.get("SAM3_TTA", "1") != "0"
        self.disabled = disabled_classes(self.weights)

    @classmethod
    def available(cls) -> bool:
        """True only if torch + sam3 import, CUDA works (or SAM3_ALLOW_CPU=1) and the weights exist.

        Never raises."""
        try:
            weights = weights_path()
            if not weights.is_file():
                return False
            if not _is_baked(weights) and not base_weights_path().is_file():
                return False
            for mod in ("torch", "sam3", "cv2", "rasterio", "skimage", "scipy"):
                if importlib.util.find_spec(mod) is None:
                    return False
            import torch

            return bool(torch.cuda.is_available()) or _cpu_allowed()
        except Exception:  # availability probe must never raise (broken CUDA/driver installs)
            log.debug("SAM 3 availability probe failed", exc_info=True)
            return False

    def _device(self) -> str:
        if self.device:
            return self.device
        import torch

        if torch.cuda.is_available():
            return "cuda"
        if _cpu_allowed():
            return "cpu"
        raise RuntimeError("SAM 3 needs CUDA (set SAM3_ALLOW_CPU=1 to force CPU)")

    def model(self) -> Any:
        if not self.weights.is_file():
            raise FileNotFoundError(f"SAM 3 weights not found: {self.weights}")
        with _LOCK:
            return _load_model(str(self.weights.resolve()), self._device())

    def segment_tile(self, tif_path: Path) -> list[dict[str, Any]]:
        """Segment one GeoTIFF tile -> GeoJSON Feature dicts in the tile CRS (EPSG:32635).

        properties: class (one of OUTPUT_CLASSES), label (same value, run3c schema), score (mean
        class probability over the feature's pixels), row_structure, interrow_cover."""
        import numpy as np
        import rasterio
        from rasterio.features import rasterize
        from shapely.geometry import box

        from .sam3_ft.predict import predict_tile
        from .sam3_ft.vectorize import vectorize

        with rasterio.open(tif_path) as src:
            img = np.ascontiguousarray(src.read([1, 2, 3]).transpose(1, 2, 0))
            transform, width, height, bounds = src.transform, src.width, src.height, box(*src.bounds)
        if img.dtype != np.uint8:
            img = np.clip(img, 0, 255).astype(np.uint8)

        valid = None
        if self.parcels is not None:
            near = [p for p in _load_parcels(str(self.parcels)) if p.intersects(bounds)]
            if not near:
                return []
            valid = rasterize(
                [(g, 1) for g in near], out_shape=(height, width), transform=transform, dtype=np.uint8
            ).astype(bool)

        model = self.model()
        device = self._device()
        with _LOCK:  # one tile at a time on the GPU
            prob = predict_tile(model, img, device=device, tta=self.tta)
        return vectorize(prob, img, transform, valid, disabled=self.disabled)


def feature_collection(features: list[dict[str, Any]]) -> dict[str, Any]:
    return {
        "type": "FeatureCollection",
        "crs": {"type": "name", "properties": {"name": "urn:ogc:def:crs:EPSG::32635"}},
        "features": features,
    }

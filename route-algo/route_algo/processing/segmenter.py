"""Segmentation model contract, lazy model factory and the precomputed-label fallback.

Segmenter contract (implemented by ``sam3_model.Sam3Segmenter``)::

    class Segmenter(Protocol):
        def segment_tile(self, tif_path: Path) -> list[dict]: ...

``segment_tile`` returns GeoJSON Feature dicts whose geometry is a Polygon or
MultiPolygon in EPSG:32635 map coordinates (metres, not pixels) and whose
``properties["class"]`` is ``"canopy"`` (vine canopy; ``"vineyard"``, the run3c
label name, is accepted as a synonym) or ``"waste"`` (waste object on the
ground). Other classes (row, interrow_area, dead_vine, ...) are ignored: rows
and interrows are derived from the canopy. Optional ``properties["score"]``.
"""
from __future__ import annotations

import json
import logging
import os
import re
import threading
from pathlib import Path
from typing import Any, Protocol, runtime_checkable

log = logging.getLogger(__name__)

# Repo-relative default; scripts/start-all.sh exports SAM3_* env vars (incl. worktree fallback to the main checkout).
REPO_ROOT = Path(__file__).resolve().parents[3]
SAM3_FT_DIR = REPO_ROOT / "data/tested-on-vm/sam3_ft"
# Newest fine-tuned run first; each holds best.pth (+ optional baked best_effective.pth) and labels/.
RUN_DIRS = (SAM3_FT_DIR / "run5", SAM3_FT_DIR / "run3c")
RUN3C_DIR = SAM3_FT_DIR / "run3c"
# Baked weights are self-contained; the raw best.pth also needs SAM3_BASE_WEIGHTS (sam3.pt).
BAKED_WEIGHTS = RUN3C_DIR / "best_effective.pth"
RAW_WEIGHTS = RUN3C_DIR / "best.pth"
DEFAULT_FALLBACK_LABELS = next((r / "labels" for r in RUN_DIRS if (r / "labels").is_dir()), RUN3C_DIR / "labels")
SIRET3_TILE = re.compile(r"^siret3_r\d{3}_c\d{3}$")
SEGMENT_CLASSES = ("canopy", "waste")
# Label names used by the precomputed run3c files -> segmenter classes.
FALLBACK_CLASS_MAP = {"vineyard": "canopy", "waste": "waste"}


@runtime_checkable
class Segmenter(Protocol):
    def segment_tile(self, tif_path: Path) -> list[dict[str, Any]]: ...


class SegmenterUnavailable(RuntimeError):
    pass


_lock = threading.Lock()
_cached: Segmenter | None = None
_last_reason = "not loaded"


def default_weights() -> Path:
    """Newest run that has weights (baked before raw); run3c's BAKED/RAW paths last."""
    for run in RUN_DIRS[:-1]:
        for name in ("best_effective.pth", "best.pth"):
            if (run / name).is_file():
                return run / name
    return BAKED_WEIGHTS if BAKED_WEIGHTS.is_file() else RAW_WEIGHTS


def weights_path() -> Path:
    env = os.environ.get("SAM3_FT_WEIGHTS")
    return Path(env) if env else default_weights()


def parcels_path() -> Path | None:
    env = os.environ.get("SAM3_PARCELS", "").strip()
    return Path(env) if env else None


def fallback_labels_dir() -> Path:
    return Path(os.environ.get("SAM3_FALLBACK_LABELS_DIR", DEFAULT_FALLBACK_LABELS))


def force_fallback() -> bool:
    return os.environ.get("PROCESSING_FORCE_FALLBACK", "").strip().lower() in {"1", "true", "yes"}


def unavailable_reason() -> str:
    return _last_reason


def get_segmenter() -> Segmenter | None:
    """Return the live SAM 3 segmenter, or None when it cannot run here.

    Loads lazily once per process; the reason for a None result is available
    from ``unavailable_reason()``.
    """
    global _cached, _last_reason
    if force_fallback():
        _last_reason = "PROCESSING_FORCE_FALLBACK is set"
        return None
    with _lock:
        if _cached is not None:
            return _cached
        try:
            from route_algo.processing.sam3_model import Sam3Segmenter  # type: ignore[import-not-found,unused-ignore]  # optional module owned by the model adapter
        except ImportError as exc:
            _last_reason = f"SAM 3 model adapter not importable ({exc})"
            return None
        weights = weights_path()
        # The adapter's own availability probe reads SAM3_FT_WEIGHTS; share our default.
        os.environ.setdefault("SAM3_FT_WEIGHTS", str(weights))
        try:
            if not Sam3Segmenter.available():
                _last_reason = f"SAM 3 segmenter unavailable (no CUDA/model deps, or weights missing at {weights})"
                return None
            parcels = parcels_path()
            segmenter = Sam3Segmenter(weights, parcels=parcels) if parcels else Sam3Segmenter(weights)
        except Exception as exc:  # model construction can fail on CUDA/weights in many ways
            log.exception("SAM 3 segmenter failed to initialise")
            _last_reason = f"SAM 3 segmenter failed to initialise ({exc})"
            return None
        _cached = segmenter
        _last_reason = "loaded"
        return segmenter


def device_label(model: Segmenter) -> str | None:
    """"GPU"/"CPU" for the real adapter (which resolves its device lazily), None for other segmenters."""
    resolve = getattr(model, "_device", None)
    if not callable(resolve):
        return None
    try:
        device = str(resolve())
    except (RuntimeError, ImportError):  # label only; inference reports real device errors
        return None
    return "GPU" if device.startswith("cuda") else device.upper()


def is_siret3_tile(tile: Path) -> bool:
    return bool(SIRET3_TILE.match(tile.stem))


def fallback_labels(tiles: list[Path]) -> dict[str, list[dict[str, Any]]]:
    """Precomputed labels per tile (all classes, team label schema) for the challenge export."""
    directory = fallback_labels_dir()
    out: dict[str, list[dict[str, Any]]] = {}
    for tile in tiles:
        path = directory / f"{tile.stem}__labels.geojson"
        out[tile.name] = json.loads(path.read_text()).get("features", []) if path.is_file() else []
    return out


def fallback_features(tiles: list[Path]) -> list[dict[str, Any]]:
    """Precomputed run3c labels for Sireț3 tiles, converted to segmenter features."""
    directory = fallback_labels_dir()
    foreign = [tile.name for tile in tiles if not is_siret3_tile(tile)]
    if foreign:
        raise SegmenterUnavailable(
            f"precomputed labels exist only for Sireț3 tiles (siret3_rXXX_cYYY.tif); got {', '.join(foreign[:3])}"
        )
    if not directory.is_dir():
        raise SegmenterUnavailable(f"precomputed label directory {directory} is missing (set SAM3_FALLBACK_LABELS_DIR)")
    features: list[dict[str, Any]] = []
    found = 0
    for tile in tiles:
        path = directory / f"{tile.stem}__labels.geojson"
        if not path.is_file():
            continue
        found += 1
        data = json.loads(path.read_text())
        for feature in data.get("features", []):
            properties = feature.get("properties") or {}
            cls = FALLBACK_CLASS_MAP.get(properties.get("label", ""))
            geometry = feature.get("geometry") or {}
            if cls and geometry.get("type") in {"Polygon", "MultiPolygon"}:
                features.append({"type": "Feature", "geometry": geometry, "properties": {"class": cls}})
    if not found:
        raise SegmenterUnavailable(f"no precomputed labels found in {directory} for the uploaded tiles")
    return features

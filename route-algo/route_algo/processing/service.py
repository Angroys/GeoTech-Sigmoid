"""File-backed survey store and the background processing job."""
from __future__ import annotations

import json
import logging
import os
import re
import shutil
import threading
import time
from pathlib import Path
from typing import Any

from . import segmenter as seg
from .postprocess import RESULT_FILES, ProcessingError, build_results, feature_collection

log = logging.getLogger(__name__)

SURVEY_ID = re.compile(r"^[a-z0-9-]+$")
TILE_NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]*\.tiff?$", re.IGNORECASE)
DEFAULT_DATA_DIR = Path(__file__).resolve().parents[2] / ".processing-data"
FALLBACK_NOTE = "Results from precomputed {run} labels (fallback, not live inference)"

_lock = threading.RLock()


class SurveyError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status
        self.message = message


def data_dir() -> Path:
    return Path(os.environ.get("PROCESSING_DATA_DIR", DEFAULT_DATA_DIR))


def survey_dir(survey_id: str) -> Path:
    if not SURVEY_ID.match(survey_id):
        raise SurveyError(404, f"Survey {survey_id!r} does not exist.")
    return data_dir() / survey_id


def _write_json(path: Path, data: dict[str, Any]) -> None:
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(data))
    tmp.replace(path)


def load(survey_id: str) -> dict[str, Any]:
    path = survey_dir(survey_id) / "survey.json"
    try:
        return json.loads(path.read_text())
    except FileNotFoundError:
        raise SurveyError(404, f"Survey {survey_id!r} does not exist.") from None


def update(survey_id: str, **changes: Any) -> dict[str, Any]:
    with _lock:
        record = load(survey_id)
        record.update(changes)
        _write_json(survey_dir(survey_id) / "survey.json", record)
        return record


def create(meta: dict[str, Any]) -> str:
    survey_id = meta["id"]
    if not SURVEY_ID.match(survey_id):
        raise SurveyError(422, "Survey id must contain only lowercase letters, digits and hyphens.")
    directory = survey_dir(survey_id)
    with _lock:
        if (directory / "survey.json").exists() and load(survey_id).get("status") == "processing":
            raise SurveyError(409, f"Survey {survey_id!r} is being processed; wait until it finishes.")
        shutil.rmtree(directory, ignore_errors=True)
        (directory / "tiles").mkdir(parents=True)
        (directory / "results").mkdir()
        _write_json(directory / "survey.json", {**meta, "status": "uploading", "message": None, "source": None})
    return survey_id


def tile_path(survey_id: str, file_name: str) -> Path:
    if not TILE_NAME.match(file_name) or Path(file_name).name != file_name or ".." in file_name:
        raise SurveyError(422, f"Tile name {file_name!r} is not allowed; use the original .tif file name.")
    return survey_dir(survey_id) / "tiles" / file_name


def save_tile(survey_id: str, file_name: str, data: bytes) -> None:
    path = tile_path(survey_id, file_name)
    with _lock:
        record = load(survey_id)
        if record["status"] == "processing":
            raise SurveyError(409, "Tiles cannot change while the survey is processing.")
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_name(f".{path.name}.part")
        tmp.write_bytes(data)
        tmp.replace(path)
        if record["status"] != "uploading":
            update(survey_id, status="uploading", message=None, source=None)


def tiles(survey_id: str) -> list[Path]:
    return sorted(p for p in (survey_dir(survey_id) / "tiles").iterdir() if TILE_NAME.match(p.name))


def start(survey_id: str) -> None:
    with _lock:
        record = load(survey_id)
        if record["status"] == "processing":
            return
        if not tiles(survey_id):
            raise SurveyError(422, "Upload at least one tile before processing.")
        update(survey_id, status="processing", message=None, source=None)
    threading.Thread(target=run_job, args=(survey_id,), name=f"process-{survey_id}", daemon=True).start()


def _model_note(model: seg.Segmenter, tile_count: int, seconds: float) -> str:
    details = [d for d in (seg.device_label(model), f"{seconds:.0f} s") if d]
    if seg.parcels_path() is not None:
        details.append("restricted to vineyard parcels")
    plural = "tile" if tile_count == 1 else "tiles"
    return f"Live SAM 3 {seg.run_name(seg.weights_path())} inference on {tile_count} {plural} ({', '.join(details)})"


def _segment(tile_paths: list[Path]) -> tuple[list[dict[str, Any]], str, str]:
    """Return (features, source, message): a model note, or the fallback reason."""
    model = seg.get_segmenter()
    reason = seg.unavailable_reason()
    if model is not None:
        try:
            started = time.monotonic()
            features: list[dict[str, Any]] = []
            for tile in tile_paths:
                features.extend(model.segment_tile(tile))
            return features, "model", _model_note(model, len(tile_paths), time.monotonic() - started)
        except Exception as exc:  # inference failure must degrade to fallback, not crash the job
            log.exception("SAM 3 inference failed")
            reason = f"live inference failed ({exc})"
    try:
        return seg.fallback_features(tile_paths), "fallback", reason
    except seg.SegmenterUnavailable as exc:
        raise ProcessingError(f"The segmentation model is unavailable: {reason}; fallback impossible: {exc}.") from exc


def run_job(survey_id: str) -> None:
    try:
        tile_paths = tiles(survey_id)
        features, source, note = _segment(tile_paths)
        results = build_results(features)
        out = survey_dir(survey_id) / "results"
        out.mkdir(exist_ok=True)
        for name in RESULT_FILES:
            _write_json(out / f"{name}.geojson", feature_collection(results[name], source))
        message = f"{FALLBACK_NOTE.format(run=seg.run_name(seg.fallback_labels_dir()))}: {note}" if source == "fallback" else note
        update(survey_id, status="ready", message=message, source=source)
    except ProcessingError as exc:
        update(survey_id, status="failed", message=str(exc), source=None)
    except Exception as exc:  # report unexpected errors to the owner instead of hanging in "processing"
        log.exception("Processing job for %s failed", survey_id)
        update(survey_id, status="failed", message=f"Processing failed unexpectedly: {exc}", source=None)


def status(survey_id: str) -> dict[str, Any]:
    record = load(survey_id)
    body: dict[str, Any] = {"status": record["status"]}
    if record.get("message"):
        body["message"] = record["message"]
    if record.get("source"):
        body["source"] = record["source"]
    return body


def result_path(survey_id: str, file_name: str) -> Path:
    record = load(survey_id)
    stem = file_name.removesuffix(".geojson").removesuffix(".json")
    if stem not in RESULT_FILES:
        raise SurveyError(404, f"Unknown result file {file_name!r}.")
    if record["status"] != "ready":
        raise SurveyError(409, f"Results are not ready (status: {record['status']}).")
    return survey_dir(survey_id) / "results" / f"{stem}.geojson"

"""Export pipelines: CVAT annotations.xml (+ tiles) and per-tile mask GeoTIFFs.

Exports are synchronous but tracked through a simple in-memory job registry so
the API can report progress. Artifacts are written under ``backend/exports``
(never into ``data/``) and split into ZIP parts of at most MAX_PART_BYTES.
"""
from __future__ import annotations

import threading
import uuid
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from . import config, cvat, db, masks, tiles

MAX_PART_BYTES = 90 * 1024 * 1024  # 90 MB per zip part
TILE_WIDTH = TILE_HEIGHT = 2048

_jobs: dict[str, dict[str, Any]] = {}
_jobs_lock = threading.Lock()


def _new_job(kind: str) -> str:
    job_id = uuid.uuid4().hex[:12]
    with _jobs_lock:
        _jobs[job_id] = {
            "id": job_id,
            "kind": kind,
            "status": "pending",
            "total": 0,
            "done": 0,
            "artifacts": [],
            "error": None,
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
    return job_id


def _update(job_id: str, **fields: Any) -> None:
    with _jobs_lock:
        _jobs[job_id].update(fields)


def _bump(job_id: str) -> None:
    with _jobs_lock:
        _jobs[job_id]["done"] += 1


def get_job(job_id: str) -> dict[str, Any] | None:
    with _jobs_lock:
        job = _jobs.get(job_id)
        return dict(job) if job else None


def artifact_path(job_id: str, filename: str) -> Path | None:
    """Return the absolute path of a produced artifact if it belongs to a job."""
    job = get_job(job_id)
    if not job:
        return None
    for art in job["artifacts"]:
        if Path(art).name == filename:
            return Path(art)
    return None


def _dims(tile_name: str) -> tuple[int, int]:
    try:
        geo = tiles.tile_geo(tile_name)
        return geo["width"], geo["height"]
    except (FileNotFoundError, ValueError):
        return TILE_WIDTH, TILE_HEIGHT


def _store_to_images(tile_names: list[str]) -> list[dict[str, Any]]:
    images: list[dict[str, Any]] = []
    for idx, name in enumerate(tile_names):
        width, height = _dims(name)
        images.append(
            {
                "id": idx,
                "name": name,
                "width": width,
                "height": height,
                "shapes": db.export_annotations(name),
            }
        )
    return images


# --------------------------------------------------------- CVAT export ----
def export_cvat(tile_names: list[str] | None = None, include_images: bool = True) -> str:
    """Export CVAT annotations.xml (+ optional tile images) as zip part(s)."""
    job_id = _new_job("cvat")
    names = tile_names if tile_names is not None else db.all_tiles_with_annotations()
    _update(job_id, status="running", total=len(names) + 1)
    out_dir = config.exports_dir() / f"cvat_{job_id}"
    out_dir.mkdir(parents=True, exist_ok=True)

    try:
        images = _store_to_images(names)
        xml_bytes = cvat.serialize_cvat(images)
        _bump(job_id)

        artifacts: list[str] = []
        part_idx = 1
        part_path = out_dir / f"cvat_export_part{part_idx}.zip"
        zf = zipfile.ZipFile(str(part_path), "w", zipfile.ZIP_DEFLATED)
        zf.writestr("annotations.xml", xml_bytes)
        cur_bytes = len(xml_bytes)

        if include_images:
            for name in names:
                try:
                    src = tiles.tile_path(name)
                except (FileNotFoundError, ValueError):
                    _bump(job_id)
                    continue
                size = src.stat().st_size
                if cur_bytes + size > MAX_PART_BYTES and cur_bytes > 0:
                    zf.close()
                    artifacts.append(str(part_path))
                    part_idx += 1
                    part_path = out_dir / f"cvat_export_part{part_idx}.zip"
                    zf = zipfile.ZipFile(str(part_path), "w", zipfile.ZIP_STORED)
                    cur_bytes = 0
                zf.write(str(src), arcname=f"images/{name}")
                cur_bytes += size
                _bump(job_id)
        else:
            for _ in names:
                _bump(job_id)

        zf.close()
        artifacts.append(str(part_path))
        _update(job_id, status="done", artifacts=artifacts)
    except Exception as exc:  # noqa: BLE001 - surface failure into job state
        _update(job_id, status="error", error=str(exc))
        raise
    return job_id


# --------------------------------------------------------- mask export ----
def export_masks(tile_names: list[str] | None = None) -> str:
    """Rasterize each tile's annotations into a mask GeoTIFF, packaged in zip(s)."""
    job_id = _new_job("masks")
    names = tile_names if tile_names is not None else db.all_tiles_with_annotations()
    _update(job_id, status="running", total=len(names))
    out_dir = config.exports_dir() / f"masks_{job_id}"
    out_dir.mkdir(parents=True, exist_ok=True)

    try:
        artifacts: list[str] = []
        part_idx = 1
        part_path = out_dir / f"masks_export_part{part_idx}.zip"
        zf = zipfile.ZipFile(str(part_path), "w", zipfile.ZIP_STORED)
        cur_bytes = 0

        for name in names:
            mask_name = name.replace(".tif", "_mask.tif")
            mask_path = out_dir / mask_name
            try:
                masks.write_mask_geotiff(name, mask_path)
            except (FileNotFoundError, ValueError):
                _bump(job_id)
                continue
            size = mask_path.stat().st_size
            if cur_bytes + size > MAX_PART_BYTES and cur_bytes > 0:
                zf.close()
                artifacts.append(str(part_path))
                part_idx += 1
                part_path = out_dir / f"masks_export_part{part_idx}.zip"
                zf = zipfile.ZipFile(str(part_path), "w", zipfile.ZIP_STORED)
                cur_bytes = 0
            zf.write(str(mask_path), arcname=mask_name)
            mask_path.unlink()  # keep only the zip
            cur_bytes += size
            _bump(job_id)

        zf.close()
        artifacts.append(str(part_path))
        _update(job_id, status="done", artifacts=artifacts)
    except Exception as exc:  # noqa: BLE001 - surface failure into job state
        _update(job_id, status="error", error=str(exc))
        raise
    return job_id

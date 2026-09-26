"""REST API router. Mounted under /api by app.main."""
from __future__ import annotations

import tempfile
from pathlib import Path
from typing import Any

from fastapi import APIRouter, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel, Field

from . import config, cvat, db, export, geojson_import, tiles

router = APIRouter(prefix="/api")


# ------------------------------------------------------------- schemas ----
class AnnotationIn(BaseModel):
    label: str
    shape_type: str = Field(..., description="polygon | polyline | box")
    points: list[list[float]] = []
    attributes: dict[str, Any] = {}
    source: str = "manual"
    occluded: int = 0
    z_order: int = 0


class AnnotationCreate(AnnotationIn):
    tile_name: str


class AnnotationPatch(BaseModel):
    label: str | None = None
    shape_type: str | None = None
    points: list[list[float]] | None = None
    attributes: dict[str, Any] | None = None
    source: str | None = None
    occluded: int | None = None
    z_order: int | None = None


class AnnotationsReplace(BaseModel):
    annotations: list[AnnotationIn]


class StatusIn(BaseModel):
    status: str
    updated_by: str | None = None


class ExportRequest(BaseModel):
    tiles: list[str] | None = None
    include_images: bool = True


class GeojsonImportRequest(BaseModel):
    dir: str | None = None


# --------------------------------------------------------------- tiles ----
@router.get("/tiles")
def get_tiles() -> dict[str, Any]:
    names = tiles.list_tile_names()
    db.sync_tiles(names)
    counts = db.annotation_counts()
    out = []
    for name in names:
        st = db.get_tile_status(name) or {}
        out.append(
            {
                "name": name,
                "verification_status": st.get("verification_status", "unchecked"),
                "updated_at": st.get("updated_at"),
                "updated_by": st.get("updated_by"),
                "annotation_count": counts.get(name, 0),
            }
        )
    return {"tiles": out, "count": len(out)}


@router.get("/tiles/{name}/raster.png")
def get_raster(name: str, thumb: int = Query(0)) -> Response:
    try:
        png = tiles.render_png(name, thumb=bool(thumb))
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail=f"tile not found: {name}")
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return Response(content=png, media_type="image/png")


@router.get("/tiles/{name}/geo")
def get_tile_geo(name: str) -> dict[str, Any]:
    try:
        return tiles.tile_geo(name)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail=f"tile not found: {name}")
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


# --------------------------------------------------------- annotations ----
@router.get("/tiles/{name}/annotations")
def get_annotations(name: str) -> dict[str, Any]:
    return {"tile_name": name, "annotations": db.list_annotations(name)}


@router.put("/tiles/{name}/annotations")
def put_annotations(name: str, payload: AnnotationsReplace) -> dict[str, Any]:
    anns = db.replace_annotations(name, [a.model_dump() for a in payload.annotations])
    return {"tile_name": name, "annotations": anns}


@router.post("/annotations", status_code=201)
def create_annotation(payload: AnnotationCreate) -> dict[str, Any]:
    try:
        return db.create_annotation(
            tile_name=payload.tile_name,
            label=payload.label,
            shape_type=payload.shape_type,
            points=payload.points,
            attributes=payload.attributes,
            source=payload.source,
            occluded=payload.occluded,
            z_order=payload.z_order,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.get("/annotations/{ann_id}")
def read_annotation(ann_id: int) -> dict[str, Any]:
    ann = db.get_annotation(ann_id)
    if ann is None:
        raise HTTPException(status_code=404, detail="annotation not found")
    return ann


@router.patch("/annotations/{ann_id}")
def patch_annotation(ann_id: int, payload: AnnotationPatch) -> dict[str, Any]:
    if db.get_annotation(ann_id) is None:
        raise HTTPException(status_code=404, detail="annotation not found")
    try:
        return db.update_annotation(ann_id, **payload.model_dump(exclude_none=True))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.delete("/annotations/{ann_id}")
def remove_annotation(ann_id: int) -> dict[str, Any]:
    if not db.delete_annotation(ann_id):
        raise HTTPException(status_code=404, detail="annotation not found")
    return {"deleted": ann_id}


# -------------------------------------------------------------- status ----
@router.get("/tiles/{name}/status")
def get_status(name: str) -> dict[str, Any]:
    st = db.get_tile_status(name)
    if st is None:
        db.ensure_tile(name)
        st = db.get_tile_status(name)
    return st


@router.put("/tiles/{name}/status")
def put_status(name: str, payload: StatusIn) -> dict[str, Any]:
    try:
        return db.set_tile_status(name, payload.status, payload.updated_by)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


# -------------------------------------------------------------- import ----
@router.post("/import/cvat")
async def import_cvat(
    path: str | None = Form(None),
    file: UploadFile | None = File(None),
) -> dict[str, Any]:
    tmp_path: Path | None = None
    try:
        if file is not None:
            suffix = Path(file.filename or "upload.zip").suffix or ".zip"
            fd, tmp = tempfile.mkstemp(suffix=suffix)
            tmp_path = Path(tmp)
            with open(fd, "wb") as fh:
                fh.write(await file.read())
            source: str | Path = tmp_path
        elif path:
            source = path
        else:
            source = config.cvat_example_path()

        parsed = cvat.parse_cvat(source)
        cvat.save_meta(parsed["labels"], parsed["task_name"])
        imported = 0
        for img in parsed["images"]:
            db.replace_annotations(img["name"], img["shapes"])
            imported += len(img["shapes"])
        return {
            "source": str(source),
            "images": len(parsed["images"]),
            "shapes_imported": imported,
            "labels": [lb["name"] for lb in parsed["labels"]],
        }
    except (FileNotFoundError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    finally:
        if tmp_path and tmp_path.exists():
            tmp_path.unlink()


@router.post("/import/geojson")
def import_geojson(payload: GeojsonImportRequest | None = None) -> dict[str, Any]:
    """Import SAM GeoJSON (EPSG:32635) pre-annotations from a directory.

    Body is optional ``{"dir": "<path>"}``; defaults to ``config.sam_dir()``.
    """
    payload = payload or GeojsonImportRequest()
    directory = payload.dir or str(config.sam_dir())
    try:
        return geojson_import.import_dir(directory)
    except (FileNotFoundError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=str(exc))


# -------------------------------------------------------------- export ----
@router.post("/export/cvat")
def post_export_cvat(payload: ExportRequest | None = None) -> dict[str, Any]:
    payload = payload or ExportRequest()
    job_id = export.export_cvat(payload.tiles, include_images=payload.include_images)
    return export.get_job(job_id)


@router.post("/export/masks")
def post_export_masks(payload: ExportRequest | None = None) -> dict[str, Any]:
    payload = payload or ExportRequest()
    job_id = export.export_masks(payload.tiles)
    return export.get_job(job_id)


@router.get("/export/{job_id}/status")
def export_status(job_id: str) -> dict[str, Any]:
    job = export.get_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="job not found")
    job["download_urls"] = [
        f"/api/export/{job_id}/download/{Path(a).name}" for a in job["artifacts"]
    ]
    return job


@router.get("/export/{job_id}/download/{filename}")
def export_download(job_id: str, filename: str) -> FileResponse:
    art = export.artifact_path(job_id, filename)
    if art is None or not art.exists():
        raise HTTPException(status_code=404, detail="artifact not found")
    return FileResponse(str(art), media_type="application/zip", filename=filename)


# ------------------------------------------------------------ progress ----
@router.get("/progress")
def get_progress() -> dict[str, Any]:
    names = tiles.list_tile_names()
    db.sync_tiles(names)
    counts = db.status_counts()
    total = sum(counts.values())
    return {
        "total": total,
        "verified": counts["verified"],
        "in_progress": counts["in_progress"],
        "unchecked": counts["unchecked"],
        "percent_verified": round(100 * counts["verified"] / total, 2) if total else 0.0,
    }

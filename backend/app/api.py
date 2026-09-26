"""REST API router. Mounted under /api by app.main."""
from __future__ import annotations

import logging
import tempfile
from pathlib import Path
from typing import Any

from fastapi import APIRouter, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel, Field

from . import config, collab, cvat, db, export, finish_export, geojson_import, mosaic, parcels, segment, tiles

router = APIRouter(prefix="/api")
logger = logging.getLogger(__name__)


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


class SegmentRequest(BaseModel):
    path: list[list[float]] = Field(
        ..., description="scribble in tile pixel coords; 1+ [x,y] points"
    )
    hint: str = Field("auto", description="auto | canopy | waste | road")


class StatusIn(BaseModel):
    status: str
    updated_by: str | None = None


class ExportRequest(BaseModel):
    tiles: list[str] | None = None
    include_images: bool = True


class GeojsonImportRequest(BaseModel):
    dir: str | None = None


class SegmentRequest(BaseModel):
    path: list[list[float]] = Field(..., description="scribble in tile pixel coords")
    hint: str = "auto"


class PresenceIn(BaseModel):
    client_id: str
    name: str
    tile: str | None = None


class ClaimIn(BaseModel):
    client_id: str
    name: str


class ReleaseIn(BaseModel):
    client_id: str


# --------------------------------------------------------------- tiles ----
@router.get("/tiles")
def get_tiles() -> dict[str, Any]:
    names = tiles.list_tile_names()
    db.sync_tiles(names)
    counts = db.annotation_counts()
    locks = collab.locks_by_tile()
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
                "locked_by": locks.get(name),
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


# ------------------------------------------------------------- segment ----
@router.post("/tiles/{name}/segment")
def segment_tile(name: str, payload: SegmentRequest) -> dict[str, Any]:
    """"Magic draw": grow the object under a scribble into a classified shape.

    Classic CV only (ExG vegetation mask + region grow); no ML model calls and
    no DB writes -- the frontend adds the returned shape as an annotation.
    """
    try:
        tiles.tile_path(name)  # 404 for unknown tiles
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail=f"tile not found: {name}")
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    if not payload.path:
        raise HTTPException(status_code=400, detail="path must have >= 1 point")
    return segment.segment(name, payload.path, payload.hint)


# --------------------------------------------------------- annotations ----
@router.get("/tiles/{name}/annotations")
def get_annotations(name: str) -> dict[str, Any]:
    return {"tile_name": name, "annotations": db.list_annotations(name)}


@router.put("/tiles/{name}/annotations")
def put_annotations(name: str, payload: AnnotationsReplace) -> dict[str, Any]:
    anns = db.replace_annotations(name, [a.model_dump() for a in payload.annotations])
    # After the save is persisted, also write this tile's finished,
    # georeferenced outputs into the ``finish`` dataset. Guard it so a failed
    # export (e.g. a missing tile raster) never fails the save.
    try:
        # Invalidated tiles never enter the finish dataset.
        if (db.get_tile_status(name) or {}).get("verification_status") != "invalid":
            finish_export.write_finish_outputs(name)
    except Exception as exc:  # noqa: BLE001 - export is best-effort; never fail the save
        logger.warning("finish export skipped for %s: %s", name, exc)
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
        result = db.set_tile_status(name, payload.status, payload.updated_by)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    # A finished ("verified") or rejected ("invalid") tile frees up:
    # auto-release any edit lock on it.
    if payload.status == "invalid":
        # Rejected image: remove it from the finish dataset too.
        try:
            finish_export.remove_finish_outputs(name)
        except Exception:  # noqa: BLE001 - never fail the status change
            logger.warning("could not remove finish outputs for %s", name, exc_info=True)
    if payload.status in ("verified", "invalid"):
        collab.release_any(name)
    return result


# --------------------------------------------------------------- collab ----
@router.post("/presence")
def post_presence(payload: PresenceIn) -> dict[str, Any]:
    """Heartbeat: upsert presence + refresh this client's lock; return state."""
    return collab.heartbeat(payload.client_id, payload.name, payload.tile)


@router.get("/presence")
def get_presence() -> dict[str, Any]:
    """Read-only live-state snapshot (no upsert)."""
    return collab.snapshot()


@router.post("/tiles/{name}/claim")
def claim_tile(name: str, payload: ClaimIn) -> dict[str, Any]:
    """Acquire the tile's edit lock if free or already held by this client."""
    return collab.claim(name, payload.client_id, payload.name)


@router.post("/tiles/{name}/release")
def release_tile(name: str, payload: ReleaseIn) -> dict[str, Any]:
    """Release the tile's edit lock if this client holds it (no-op otherwise)."""
    return collab.release(name, payload.client_id)


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
def _export_tiles(requested: list[str] | None) -> list[str] | None:
    """Invalidated tiles are never exported. None = all tiles minus invalid."""
    invalid = db.tiles_with_status("invalid")
    if requested is None:
        if not invalid:
            return None
        return [n for n in db.all_tiles_with_annotations() if n not in invalid]
    return [n for n in requested if n not in invalid]


@router.post("/export/cvat")
def post_export_cvat(payload: ExportRequest | None = None) -> dict[str, Any]:
    payload = payload or ExportRequest()
    job_id = export.export_cvat(_export_tiles(payload.tiles), include_images=payload.include_images)
    return export.get_job(job_id)


@router.post("/export/masks")
def post_export_masks(payload: ExportRequest | None = None) -> dict[str, Any]:
    payload = payload or ExportRequest()
    job_id = export.export_masks(_export_tiles(payload.tiles))
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


# --------------------------------------------------------------- map ----
@router.get("/parcels/map")
def get_parcels_map() -> dict[str, Any]:
    return parcels.for_map()


class ParcelIn(BaseModel):
    points: list[list[float]]  # map grid units (x = col, y = row)


@router.put("/parcels/{pid}")
def put_parcel(pid: int, payload: ParcelIn) -> dict[str, Any]:
    try:
        return parcels.update_parcel(pid, payload.points)
    except KeyError:
        raise HTTPException(status_code=404, detail="parcel not found")
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.delete("/parcels/{pid}")
def delete_parcel(pid: int) -> dict[str, Any]:
    try:
        parcels.delete_parcel(pid)
    except KeyError:
        raise HTTPException(status_code=404, detail="parcel not found")
    return {"ok": True, "id": pid}


@router.get("/tiles/{name}/parcels")
def get_tile_parcels(name: str) -> dict[str, Any]:
    try:
        return {"tile_name": name, "parcels": parcels.for_tile(name)}
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="tile not found")


@router.get("/map/layout")
def get_map_layout() -> dict[str, Any]:
    return mosaic.layout()


@router.get("/map/mosaic.jpg")
def get_map_mosaic(cell: int = Query(48, ge=8, le=128)) -> FileResponse:
    path = mosaic.build_mosaic(cell)
    return FileResponse(str(path), media_type="image/jpeg", headers={"Cache-Control": "public, max-age=3600"})


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
        "invalid": counts.get("invalid", 0),
        "percent_verified": round(100 * counts["verified"] / total, 2) if total else 0.0,
    }

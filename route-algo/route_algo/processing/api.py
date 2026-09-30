"""Tile processing API (vineyard-front/docs/processing-api.md)."""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, FastAPI, Request
from fastapi.encoders import jsonable_encoder
from fastapi.exception_handlers import http_exception_handler, request_validation_exception_handler
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse, Response
from pydantic import BaseModel, ConfigDict, Field
from starlette.exceptions import HTTPException as StarletteHTTPException

from . import service
from .geotiff import TileError, read_tile_info

MAX_TILE_BYTES = 128 * 1024 * 1024

router = APIRouter(prefix="/api/surveys")


class NewSurvey(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: str = Field(pattern=r"^[a-z0-9-]+$", max_length=100)
    name: str = Field(min_length=1, max_length=200)
    location: str = Field(default="", max_length=200)
    capturedOn: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")
    imageryUrl: str | None = None


def _error(status: int, message: str) -> JSONResponse:
    return JSONResponse({"message": message}, status_code=status)


@router.post("", status_code=201)
def create_survey(survey: NewSurvey) -> dict[str, str]:
    return {"id": service.create(survey.model_dump())}


@router.put("/{survey_id}/tiles/{file_name}", status_code=201)
async def upload_tile(survey_id: str, file_name: str, request: Request) -> Response:
    service.load(survey_id)
    service.tile_path(survey_id, file_name)
    data = bytearray()
    async for chunk in request.stream():
        data.extend(chunk)
        if len(data) > MAX_TILE_BYTES:
            return _error(413, "The tile is larger than 128 MB.")
    if not data:
        return _error(422, "The tile upload is empty.")
    try:
        read_tile_info(bytes(data))
    except TileError as exc:
        return _error(422, f"{file_name}: {exc}")
    service.save_tile(survey_id, file_name, bytes(data))
    return Response(status_code=201)


@router.post("/{survey_id}/process", status_code=202)
def process_survey(survey_id: str) -> Response:
    service.start(survey_id)
    return Response(status_code=202)


@router.get("/{survey_id}")
def survey_status(survey_id: str) -> dict[str, Any]:
    return service.status(survey_id)


@router.get("/{survey_id}/results/{file_name}")
def survey_result(survey_id: str, file_name: str) -> FileResponse:
    media = service.CHALLENGE_FILES.get(file_name, "application/geo+json")
    return FileResponse(service.result_path(survey_id, file_name), media_type=media)


def _is_api(request: Request) -> bool:
    return request.url.path.startswith("/api/")


def install(app: FastAPI) -> None:
    """Mount the router and make /api errors JSON {message} without changing /plan's {detail} errors."""
    app.include_router(router)

    @app.exception_handler(service.SurveyError)
    async def survey_error(_: Request, exc: service.SurveyError) -> JSONResponse:
        return _error(exc.status, exc.message)

    @app.exception_handler(StarletteHTTPException)
    async def http_error(request: Request, exc: StarletteHTTPException) -> Response:
        if _is_api(request):
            message = exc.detail if isinstance(exc.detail, str) else "Request failed."
            if exc.status_code == 404 and message == "Not Found":
                message = "This processing endpoint does not exist."
            return _error(exc.status_code, message)
        return await http_exception_handler(request, exc)

    @app.exception_handler(RequestValidationError)
    async def validation_error(request: Request, exc: RequestValidationError) -> Response:
        if _is_api(request):
            problems = []
            for error in jsonable_encoder(exc.errors()):
                where = ".".join(str(part) for part in error.get("loc", ()) if part != "body")
                problems.append(f"{where}: {error.get('msg')}" if where else str(error.get("msg")))
            return _error(422, "Invalid request: " + "; ".join(problems))
        return await request_validation_exception_handler(request, exc)

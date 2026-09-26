"""FastAPI application entrypoint. Importable as ``app.main:app``.

Minimal auth (mesh-internal, no RBAC): permissive CORS for the team mesh.
"""
from __future__ import annotations

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from . import config, db
from .api import router as api_router

app = FastAPI(title="GeoTech Tile Label Verify", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api_router)


@app.on_event("startup")
def _startup() -> None:
    db.init_db()


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


# Single-origin deploy: if the built frontend exists, serve it from this app so
# the UI and the API share one origin/port (no separate dev server or proxy —
# fixes /api calls falling through to the static server). Registered AFTER the
# API router and /health so those always win; this only catches everything else.
_DIST = config.frontend_dist()
if _DIST.is_dir() and (_DIST / "index.html").is_file():
    _assets = _DIST / "assets"
    if _assets.is_dir():
        app.mount("/assets", StaticFiles(directory=str(_assets)), name="assets")

    @app.get("/{full_path:path}")
    def _spa(full_path: str) -> FileResponse:
        # Never shadow the API surface.
        if full_path.startswith("api/") or full_path == "api":
            raise HTTPException(status_code=404, detail="Not Found")
        candidate = _DIST / full_path
        if full_path and candidate.is_file() and candidate.name != "index.html":
            return FileResponse(str(candidate))
        # index.html must NEVER be cached: it points at the current hashed
        # bundle, and a stale copy kept users on an old (broken) build.
        return FileResponse(
            str(_DIST / "index.html"),
            headers={"Cache-Control": "no-cache, no-store, must-revalidate", "Pragma": "no-cache", "Expires": "0"},
        )


# Ensure schema exists even if startup event is bypassed (e.g. bare import).
db.init_db()

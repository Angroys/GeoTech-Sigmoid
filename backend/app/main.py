"""FastAPI application entrypoint. Importable as ``app.main:app``.

Minimal auth (mesh-internal, no RBAC): permissive CORS for the team mesh.
"""
from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from . import db
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


# Ensure schema exists even if startup event is bypassed (e.g. bare import).
db.init_db()

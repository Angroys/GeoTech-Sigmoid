import json
import os
from pathlib import Path

from fastapi import FastAPI, HTTPException
from shapely.errors import GEOSException

from .geometry import PlanningError
from .models import FeatureCollection, PlanRequest
from .planner import plan_route

app = FastAPI(title="Vineyard Route Planner", version="0.1.0")
ROOT = Path(__file__).resolve().parents[2]
DEFAULT_CONSTRAINTS = ROOT / "assets_for_participants-20260926T100006Z-1-001/assets_for_participants/02_route"


def with_constraints(request: PlanRequest):
    if request.constraint_set != "siret3":
        return request
    directory = Path(os.environ.get("ROUTE_CONSTRAINTS_DIR", DEFAULT_CONSTRAINTS))
    updates = {}
    try:
        for key in ("passages", "forbidden", "study_area"):
            updates[key] = FeatureCollection.model_validate(json.loads((directory / f"{key}.geojson").read_text()))
    except (OSError, ValueError) as exc:
        raise HTTPException(503, "Sireț3 routing constraints are unavailable. Configure ROUTE_CONSTRAINTS_DIR.") from exc
    return request.model_copy(update=updates)


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/plan")
def plan(request: PlanRequest):
    try:
        return plan_route(with_constraints(request))
    except (PlanningError, GEOSException) as exc:
        raise HTTPException(422, str(exc)) from exc

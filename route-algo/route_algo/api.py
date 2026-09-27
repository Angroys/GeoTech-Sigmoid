import json
import math
import os
from pathlib import Path

from fastapi import FastAPI, HTTPException
from shapely.errors import GEOSException
from shapely.geometry import LineString, mapping, shape
from shapely.ops import unary_union

from .geometry import PlanningError
from .models import FeatureCollection, PlanRequest, StoredPlanRequest
from .planner import plan_route
from .processing.api import install as install_processing_api
from .sam3c import load_request

app = FastAPI(title="Vineyard Route Planner", version="0.1.0")
install_processing_api(app)
ROOT = Path(__file__).resolve().parents[2]
DEFAULT_CONSTRAINTS = ROOT / "assets_for_participants-20260926T100006Z-1-001/assets_for_participants/02_route"
# Extracted (model-predicted) field roads. LineStrings are buffered into walkable corridors.
ROAD_HALF_WIDTH_M = 1.5
ROADS_WARNING = (
    "Extracted roads (model-predicted, not organizer-authorised passages) were added as walkable "
    "corridors ({half_width} m half-width) alongside the official passages and inter-rows; inter-rows are "
    "prolonged {extend} m past the row ends to join them. Canopy and forbidden areas stay excluded."
)
_roads_cache: dict = {}
# Inter-rows are extended along their long axis so row ends join the headland roads.
DEFAULT_INTERROW_EXTEND_M = 10.0


def interrow_extend_m() -> float:
    try:
        return max(0.0, float(os.environ.get("ROUTE_INTERROW_EXTEND_M", DEFAULT_INTERROW_EXTEND_M)))
    except ValueError:
        return DEFAULT_INTERROW_EXTEND_M


def extend_interrow(polygon, extend_m: float):
    """A corridor as wide as the inter-row, prolonged by extend_m past both row ends."""
    corners = list(polygon.minimum_rotated_rectangle.exterior.coords)[:4]
    if len(corners) < 4:
        return None
    sides = sorted(((corners[i], corners[(i + 1) % 4]) for i in range(4)), key=lambda s: math.dist(*s))[:2]
    (a, b), (c, d) = sides
    width = math.dist(a, b)
    m0, m1 = ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2), ((c[0] + d[0]) / 2, (c[1] + d[1]) / 2)
    length = math.dist(m0, m1)
    if not width or not length:
        return None
    ux, uy = (m1[0] - m0[0]) / length, (m1[1] - m0[1]) / length
    axis = LineString([(m0[0] - ux * extend_m, m0[1] - uy * extend_m), (m1[0] + ux * extend_m, m1[1] + uy * extend_m)])
    return axis.buffer(width / 2, cap_style="flat")


def roads_file() -> Path:
    if os.environ.get("ROUTE_ROADS_FILE"):
        return Path(os.environ["ROUTE_ROADS_FILE"])
    data_dir = Path(os.environ.get("DATA_DIR", ROOT / "data"))
    return data_dir / "road" / "roads_field.geojson"


def load_roads():
    """Return the buffered road corridors (shapely geometry) or None if unavailable."""
    path = roads_file()
    try:
        key = (str(path), path.stat().st_mtime_ns, ROAD_HALF_WIDTH_M)
    except OSError:
        return None
    if key not in _roads_cache:
        data = FeatureCollection.model_validate(json.loads(path.read_text()))
        crs = (data.crs or {}).get("properties", {}).get("name", "urn:ogc:def:crs:EPSG::32635")
        if crs not in {"EPSG:32635", "urn:ogc:def:crs:EPSG::32635"}:
            raise ValueError(f"{path} must use EPSG:32635")
        parts = []
        for feature in data.features:
            geometry = shape(feature["geometry"])
            if geometry.is_empty:
                continue
            if geometry.geom_type in {"Polygon", "MultiPolygon"}:
                parts.append(geometry.buffer(0))
            else:
                parts.append(geometry.buffer(ROAD_HALF_WIDTH_M))
        _roads_cache.clear()
        _roads_cache[key] = unary_union(parts) if parts else None
    return _roads_cache[key]


def with_roads(request: PlanRequest):
    """Add extracted roads as walkable passages for Sireț3 requests. Returns (request, roads, warning)."""
    if request.constraint_set != "siret3":
        return request, None, None
    try:
        roads = load_roads()
    except (OSError, ValueError) as exc:
        return request, None, f"Extracted roads could not be loaded ({exc}); planning without them."
    if roads is None or roads.is_empty:
        return request, None, f"Extracted roads file not found ({roads_file()}); planning without roads."
    feature = {"type": "Feature", "geometry": mapping(roads),
               "properties": {"source": "extracted_road", "authorised": False, "half_width_m": ROAD_HALF_WIDTH_M}}
    extra = [feature]
    extend_m = interrow_extend_m()
    if extend_m:
        corridors = []
        for item in request.interrows.features:
            geometry = shape(item["geometry"])
            for part in getattr(geometry, "geoms", [geometry]):
                if part.geom_type == "Polygon" and not part.is_empty:
                    corridor = extend_interrow(part, extend_m)
                    if corridor is not None:
                        corridors.append(corridor)
        if corridors:
            extra.append({"type": "Feature", "geometry": mapping(unary_union(corridors)), "properties": {
                "source": "interrow_extension", "authorised": False, "extend_m": extend_m}})
    passages = request.passages.model_copy(update={"features": [*request.passages.features, *extra]})
    return request.model_copy(update={"passages": passages}), roads, None


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
def plan(request: PlanRequest | StoredPlanRequest):
    dataset = request.dataset if isinstance(request, StoredPlanRequest) else None
    if dataset:
        try:
            request = load_request(request)
        except (OSError, ValueError) as exc:
            raise HTTPException(503, "SAM3 mock data is unavailable. Run python -m route_algo.sam3c first.") from exc
    try:
        request, roads, roads_warning = with_roads(with_constraints(request))
        result = plan_route(request)
        report = result["report"]
        if request.constraint_set == "siret3":
            report["roads_used"] = roads is not None
            report["roads_file"] = str(roads_file())
            if roads is not None:
                passages = result["map"]["supplied_passages"]
                road_features = [f for f in passages["features"] if f["properties"].get("source") in {"extracted_road", "interrow_extension"}]
                passages["features"] = [f for f in passages["features"] if f not in road_features]
                result["map"]["extracted_roads"] = {**passages, "features": road_features}
                report["warnings"].append(ROADS_WARNING.format(half_width=ROAD_HALF_WIDTH_M, extend=interrow_extend_m()))
                route_line = shape(result["route"]["features"][0]["geometry"]) if result["route"] else None
                report["on_extracted_roads_length_m"] = (
                    route_line.intersection(roads).length if route_line is not None else 0.0
                )
            else:
                report["warnings"].append(roads_warning)
        if dataset:
            result["report"]["warnings"].append(
                "Full-map SAM3 predictions are mock data. Missing-vine inspection points are not included."
            )
            if result["route"]:
                result["route"]["features"][0]["properties"].update(dataset=dataset, data_kind="model_prediction_mock")
        return result
    except (PlanningError, GEOSException) as exc:
        raise HTTPException(422, str(exc)) from exc

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


class FeatureCollection(BaseModel):
    type: Literal["FeatureCollection"] = "FeatureCollection"
    features: list[dict[str, Any]] = Field(default_factory=list, max_length=50000)
    crs: dict[str, Any] | None = None


class PlanRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)

    crs: Literal["EPSG:32635"]
    purpose: Literal["inspection", "waste_collection"] = "inspection"
    # Only this named dataset may load organizer constraints from the server.
    constraint_set: Literal["siret3"] | None = None
    path_mode: Literal["supplied", "demo_headlands"] = "supplied"
    start: tuple[float, float]
    interrows: FeatureCollection
    blocks: FeatureCollection = Field(default_factory=FeatureCollection)
    rows: FeatureCollection = Field(default_factory=FeatureCollection)
    canopy: FeatureCollection = Field(default_factory=FeatureCollection)
    inspection_points: FeatureCollection = Field(default_factory=FeatureCollection)
    waste: FeatureCollection = Field(default_factory=FeatureCollection)
    passages: FeatureCollection = Field(default_factory=FeatureCollection)
    forbidden: FeatureCollection = Field(default_factory=FeatureCollection)
    barriers: FeatureCollection = Field(default_factory=FeatureCollection)
    study_area: FeatureCollection | None = None
    clearance_m: float = Field(default=0, ge=0, le=2)
    solver_seconds: int = Field(default=2, ge=1, le=10)


class StoredPlanRequest(BaseModel):
    """Small request for the local full-map SAM3 fixture; geometry stays on disk."""
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)

    dataset: Literal["siret3-sam3c"]
    crs: Literal["EPSG:32635"]
    purpose: Literal["inspection", "waste_collection"] = "waste_collection"
    start: tuple[float, float]
    path_mode: Literal["supplied"] = "supplied"

"""Explicitly inferred access areas for generated demo annotations only."""
from shapely.geometry import mapping
from shapely.ops import unary_union

from .geometry import PlanningError, geometries
from .models import FeatureCollection, PlanRequest


def with_demo_headlands(request: PlanRequest) -> PlanRequest:
    blocks = geometries(request.blocks, {"Polygon"}, "blocks")
    rows = geometries(request.rows, {"LineString"}, "rows")
    if not blocks or not rows:
        raise PlanningError("Demo access paths require block polygons and row axes.")
    additions = []
    for block, properties in blocks:
        vineyard_id = properties.get("vineyard_id")
        if not vineyard_id:
            raise PlanningError("Demo blocks need vineyard_id properties.")
        axes = [axis for axis, p in rows if p.get("vineyard_id") == vineyard_id]
        if len(axes) < 2:
            raise PlanningError(f"Demo block {vineyard_id} needs at least two row axes.")
        if any(not block.buffer(1e-7).covers(axis) for axis in axes):
            raise PlanningError(f"Demo row axes extend outside block {vineyard_id}.")
        footprint = unary_union(axes).convex_hull
        if footprint.geom_type != "Polygon":
            raise PlanningError(f"Demo block {vineyard_id} has no two-dimensional row footprint.")
        # The generator trims row ends by 4 m. Ground between their footprint
        # and the block boundary supplies the missing headland. A 25 cm overlap
        # connects aisle endpoints robustly; the normal planner still subtracts
        # all canopies, forbidden areas and barriers from this inferred ground.
        headland = block.difference(footprint.buffer(-0.25))
        additions.append({
            "type": "Feature", "geometry": mapping(headland),
            "properties": {"source": "inferred_demo_headland", "vineyard_id": vineyard_id},
        })
    return request.model_copy(update={
        "passages": FeatureCollection(features=[*request.passages.features, *additions], crs=request.passages.crs)
    })

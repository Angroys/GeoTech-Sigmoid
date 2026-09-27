"""Convert every SAM3 run3c tile into a reproducible, full-map mock survey.

Run from the repository root:
    uv run --project route-algo python -m route_algo.sam3c
"""
import argparse
from collections import defaultdict
import hashlib
import json
from pathlib import Path

from shapely.geometry import MultiPoint, mapping, shape

from .models import FeatureCollection, PlanRequest, StoredPlanRequest

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_LABELS = ROOT / "sam3c/sam3_ft/run3c/labels"
DEFAULT_OUTPUT = ROOT / "vineyard-front/public/data/siret3-sam3c"
DEFAULT_START = ROOT / "assets_for_participants-20260926T100006Z-1-001/assets_for_participants/02_route/start.geojson"
CRS = {"type": "name", "properties": {"name": "urn:ogc:def:crs:EPSG::32635"}}
LAYERS = {"row": "rows", "vineyard": "canopy", "interrow_area": "interrows", "waste": "waste"}


def collection(features=()):
    return {"type": "FeatureCollection", "crs": CRS, "features": list(features)}


def convert(labels: Path, start_file: Path):
    paths = sorted(labels.glob("*__labels.geojson"))
    if not paths:
        raise ValueError(f"No SAM3 label files found in {labels}")
    layers = {name: [] for name in (*LAYERS.values(), "blocks", "inspection_points")}
    block_vertices = defaultdict(list)
    physical_rows = set()
    sources = []
    for path in paths:
        raw = path.read_bytes()
        data = FeatureCollection.model_validate_json(raw)
        if data.crs != CRS:
            raise ValueError(f"{path.name}: expected EPSG:32635 coordinates")
        tile = path.name.removesuffix("__labels.geojson")
        sources.append({"file": path.name, "sha256": hashlib.sha256(raw).hexdigest(), "features": len(data.features)})
        for index, feature in enumerate(data.features):
            properties = dict(feature["properties"])
            label = properties["label"]
            if label not in LAYERS:
                raise ValueError(f"{path.name}: unknown label {label!r}")
            geometry = shape(feature["geometry"])
            expected = "LineString" if label == "row" else "Polygon"
            if geometry.geom_type != expected or geometry.is_empty or not geometry.is_valid:
                raise ValueError(f"{path.name}, feature {index}: invalid {expected}")
            source_id = f"{tile}-{index:05d}"
            properties.update(source_tile=tile, source_feature_index=index, source="sam3_run3c_prediction")
            vineyard_id = properties.get("vineyard_id")
            if label != "waste" and vineyard_id:
                # Convex hulls are display context only, never walking permissions.
                hull = geometry.convex_hull
                block_vertices[vineyard_id].extend(hull.exterior.coords if hull.geom_type == "Polygon" else hull.coords)
            if label == "row":
                physical_rows.add(properties["row_id"])
                properties.update(physical_row_id=properties["row_id"],
                                  row_id=f"{properties['row_id']}-{source_id}", length_m=geometry.length)
            elif label == "vineyard":
                properties.update(row_id=None, area_m2=geometry.area)
            elif label == "interrow_area":
                properties.update(interrow_id=f"I-{source_id}", row_ids=None,
                                  vineyard_id=vineyard_id or None, area_m2=geometry.area)
            else:
                properties.update(waste_id=f"W-{source_id}", vineyard_id=vineyard_id or None, reachable=False)
            layers[LAYERS[label]].append({**feature, "properties": properties})
    for vineyard_id, vertices in sorted(block_vertices.items()):
        hull = MultiPoint(vertices).convex_hull
        if hull.geom_type != "Polygon":
            raise ValueError(f"{vineyard_id}: cannot derive a display outline")
        layers["blocks"].append({"type": "Feature", "geometry": mapping(hull), "properties": {
            "vineyard_id": vineyard_id, "source": "derived_display_hull",
        }})
    start = FeatureCollection.model_validate_json(start_file.read_bytes())
    if start.crs != CRS or len(start.features) != 1 or start.features[0]["geometry"]["type"] != "Point":
        raise ValueError("Expected one official start point in EPSG:32635")
    output = {key: collection(features) for key, features in layers.items()}
    output["start"] = collection([{**start.features[0], "properties": {}}])
    manifest = {
        "dataset": "siret3-sam3c", "kind": "model_prediction_mock", "crs": "EPSG:32635",
        "tile_count": len(paths), "physical_row_count": len(physical_rows),
        "counts": {key: len(features) for key, features in layers.items()},
        "notes": [
            "All source features and their coordinates are retained; rows remain separate tile segments with unique IDs.",
            "Block outlines are derived convex hulls for display, not walking permissions.",
            "Canopy-to-row and interrow-to-row associations are unknown (null).",
            "No missing-vine inspection points have been inferred. Routes currently visit waste predictions only.",
            "Reachability is computed by the planner, not supplied by the model.",
        ],
        "sources": sources,
    }
    return output, manifest


def load_request(request: StoredPlanRequest, directory: Path = DEFAULT_OUTPUT):
    layers = {key: FeatureCollection.model_validate_json((directory / f"{key}.geojson").read_bytes())
              for key in ("blocks", "rows", "canopy", "interrows", "waste", "inspection_points")}
    return PlanRequest(
        crs=request.crs, purpose=request.purpose, start=request.start,
        path_mode="supplied", constraint_set="siret3", **layers,
    )


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--labels", type=Path, default=DEFAULT_LABELS)
    parser.add_argument("--start", type=Path, default=DEFAULT_START)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()
    layers, manifest = convert(args.labels, args.start)
    # Validate the complete layer sizes before publishing any generated files.
    for layer in layers.values():
        FeatureCollection.model_validate(layer)
    args.output.mkdir(parents=True, exist_ok=True)
    for name, layer in layers.items():
        (args.output / f"{name}.geojson").write_text(json.dumps(layer, separators=(",", ":")))
    (args.output / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(json.dumps({"output": str(args.output), "tiles": manifest["tile_count"],
                      "physical_rows": manifest["physical_row_count"], **manifest["counts"]}, indent=2))


if __name__ == "__main__":
    main()

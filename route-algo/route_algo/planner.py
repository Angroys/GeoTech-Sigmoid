import math
from time import perf_counter

import networkx as nx
from ortools.constraint_solver import pywrapcp, routing_enums_pb2
from shapely.geometry import LineString, Point, mapping
from shapely.ops import nearest_points, unary_union

from .geometry import PlanningError, WalkingNetwork, geometries, walkable_geometry
from .models import PlanRequest
from .demo import inferred_headland_features, with_demo_headlands

VISIT_RADIUS_M = 2.0
CRS_MEMBER = {"type": "name", "properties": {"name": "urn:ogc:def:crs:EPSG::32635"}}


def feature_collection(features=()):
    return {"type": "FeatureCollection", "crs": CRS_MEMBER, "features": list(features)}


def input_collection(collection):
    return feature_collection(collection.features if collection is not None else ())


def traversed_length(line, operation):
    """Measure every traversed segment, including repeated route sections."""
    return sum(operation(LineString([a, b])).length for a, b in zip(line.coords, list(line.coords)[1:]))


def evidence_features(line, area, kind):
    """Return route pieces outside an area without collapsing repeated traversals."""
    features = []
    if area is None or area.is_empty:
        return features
    for segment_index, (a, b) in enumerate(zip(line.coords, list(line.coords)[1:])):
        difference = LineString([a, b]).difference(area)
        if difference.is_empty:
            continue
        parts = [difference] if difference.geom_type == "LineString" else [
            part for part in getattr(difference, "geoms", ()) if part.geom_type == "LineString"
        ]
        for part in parts:
            if part.length > 1e-9:
                features.append({
                    "type": "Feature",
                    "geometry": mapping(part),
                    "properties": {"kind": kind, "segment_index": segment_index, "length_m": part.length},
                })
    return features


def targets_of(request):
    targets = []
    collections = [(request.waste, "waste_id", {"Polygon", "MultiPolygon", "Point"})]
    if request.purpose == "inspection":
        collections.insert(0, (request.inspection_points, "point_id", {"Point"}))
    for collection, id_key, types in collections:
        for geometry, properties in geometries(collection, types, id_key):
            target_id = properties.get(id_key)
            if not isinstance(target_id, str) or not target_id:
                raise PlanningError(f"Each target needs a nonempty {id_key}.")
            # Waste boxes represent objects; use their centres consistently.
            targets.append((target_id, geometry.centroid))
    if len(targets) > 200:
        raise PlanningError("This initial planner supports at most 200 targets per request.")
    if len({target_id for target_id, _ in targets}) != len(targets):
        raise PlanningError("Target IDs must be unique across inspection points and waste.")
    return targets


def optimise(matrix, seconds):
    count = len(matrix)
    remaining = set(range(1, count))
    baseline = [0]
    while remaining:
        nxt = min(remaining, key=lambda j: (matrix[baseline[-1]][j], j))
        baseline.append(nxt)
        remaining.remove(nxt)
    baseline.append(0)
    if count < 3:
        return baseline, baseline
    manager = pywrapcp.RoutingIndexManager(count, 1, 0)
    routing = pywrapcp.RoutingModel(manager)
    callback = routing.RegisterTransitCallback(
        lambda i, j: round(matrix[manager.IndexToNode(i)][manager.IndexToNode(j)] * 1000)
    )
    routing.SetArcCostEvaluatorOfAllVehicles(callback)
    params = pywrapcp.DefaultRoutingSearchParameters()
    params.first_solution_strategy = routing_enums_pb2.FirstSolutionStrategy.PATH_CHEAPEST_ARC
    params.local_search_metaheuristic = routing_enums_pb2.LocalSearchMetaheuristic.GUIDED_LOCAL_SEARCH
    params.time_limit.seconds = seconds
    solution = routing.SolveWithParameters(params)
    if solution is None:
        return baseline, baseline
    tour = []
    index = routing.Start(0)
    while not routing.IsEnd(index):
        tour.append(manager.IndexToNode(index))
        index = solution.Value(routing.NextVar(index))
    return tour + [0], baseline


def plan_route(request: PlanRequest):
    started = perf_counter()
    supplied_request = request
    targets = targets_of(request)
    supplied_walkable = walkable_geometry(request)
    inferred_features = []
    if request.path_mode == "demo_headlands":
        inferred_features = inferred_headland_features(request)
        request = with_demo_headlands(request, inferred_features)
        walkable = walkable_geometry(request)
    else:
        walkable = supplied_walkable
    start = Point(request.start)
    if not walkable.covers(start):
        raise PlanningError(
            f"The starting point is outside permitted walking areas "
            f"({start.distance(walkable):.2f} m away). Choose a point inside an inter-row or authorised passage."
        )
    # Disconnected islands cannot contribute a route from this start. Avoid
    # triangulating thousands of inaccessible canopy fragments in demo data.
    polygons = [walkable] if walkable.geom_type == "Polygon" else list(walkable.geoms)
    start_area = unary_union([polygon for polygon in polygons if polygon.geom_type == "Polygon" and polygon.covers(start)])
    network = WalkingNetwork(start_area)
    start_node = network.attach(start)
    reachable = network.reachable_area(start_node)
    terminals = [start_node]
    reachable_targets = []
    reports = []
    for target_id, point in targets:
        approach = nearest_points(point, reachable)[1]
        distance = point.distance(approach)
        accessible = distance <= VISIT_RADIUS_M
        reports.append({
            "target_id": target_id,
            "reachable": accessible,
            "approach_distance_m": distance,
            "approach": list(approach.coords[0]) if accessible else None,
            "reason": None if accessible else "No approach within 2 m in the start's connected walking area.",
        })
        if accessible:
            terminals.append(network.attach(approach))
            reachable_targets.append((target_id, point))

    matrix = []
    for terminal in terminals:
        distances = nx.single_source_dijkstra_path_length(network.graph, terminal, weight="weight")
        matrix.append([distances[other] for other in terminals])
    tour, baseline = optimise(matrix, request.solver_seconds)
    path_cache = {}

    def expand(order):
        coords = [request.start]
        for a, b in zip(order, order[1:]):
            key = (a, b)
            if key not in path_cache:
                path_cache[key] = network.path(terminals[a], terminals[b])
            coords.extend(path_cache[key][1:])
        return LineString(coords if len(coords) > 1 else coords * 2)

    line = expand(tour)
    baseline_line = expand(baseline)
    if baseline_line.length < line.length:
        line = baseline_line
    # Count each traversed segment: a geometric difference of a whole retracing
    # LineString would otherwise discard multiplicity and undercount violations.
    outside_m = traversed_length(line, lambda segment: segment.difference(walkable))
    if outside_m > 1e-6:
        raise PlanningError("Route validation failed: a path segment leaves permitted walking areas.")
    outside_supplied_m = outside_m if request.path_mode == "supplied" else traversed_length(
        line, lambda segment: segment.difference(supplied_walkable)
    )
    block_area = unary_union([geometry for geometry, _ in geometries(supplied_request.blocks, {"Polygon"}, "blocks")])
    outside_blocks_m = None if block_area.is_empty else traversed_length(
        line, lambda segment: segment.difference(block_area)
    )
    outside_study_m = None
    if supplied_request.study_area is not None:
        study_area = unary_union([
            geometry for geometry, _ in geometries(supplied_request.study_area, {"Polygon", "MultiPolygon"}, "study_area")
        ])
        outside_study_m = traversed_length(line, lambda segment: segment.difference(study_area))
    # First entrance into each target's 2 m neighbourhood, including incidental
    # visits en route to another target, determines the displayed stop order.
    stops = []
    for target_id, target in reachable_targets:
        walked = 0.0
        first = None
        for a, b in zip(line.coords, list(line.coords)[1:]):
            ax, ay = a[0] - target.x, a[1] - target.y
            dx, dy = b[0] - a[0], b[1] - a[1]
            length_sq = dx * dx + dy * dy
            if ax * ax + ay * ay <= VISIT_RADIUS_M ** 2 + 1e-9:
                first = walked
                break
            if length_sq:
                dot = ax * dx + ay * dy
                discriminant = dot * dot - length_sq * (ax * ax + ay * ay - VISIT_RADIUS_M ** 2)
                if discriminant >= -1e-9:
                    t = (-dot - math.sqrt(max(0, discriminant))) / length_sq
                    if -1e-9 <= t <= 1 + 1e-9:
                        first = walked + max(0, min(1, t)) * math.sqrt(length_sq)
                        break
            walked += math.sqrt(length_sq)
        if first is None:
            raise PlanningError(f"Route validation failed: target {target_id} was not visited.")
        stops.append((first, target_id))
    stops.sort()
    properties = {
        "purpose": request.purpose,
        "length_m": line.length,
        "baseline_length_m": baseline_line.length,
        "baseline_kind": "nearest_neighbour",
        "walking_speed_kmh": 4.0,
        "stop_ids": [target_id for _, target_id in stops],
        "stop_distances_m": [distance for distance, _ in stops],
        "start": list(request.start),
        "path_mode": request.path_mode,
        "outside_supplied_length_m": outside_supplied_m,
    }
    warnings = []
    if request.path_mode == "demo_headlands":
        warnings.append("Demo route uses inferred access paths at row ends. These paths are not validated challenge data.")
    if not reachable_targets:
        warnings.append(
            "No supplied targets are reachable from this start within 2 m. The walking areas need connected access to the target aisles."
            if targets else "There are no targets to visit for this route purpose."
        )
    elif len(reachable_targets) < len(targets):
        warnings.append("Some targets cannot be reached within 2 m using the selected walking areas.")
    route_evidence = evidence_features(line, walkable, "outside_permitted")
    if request.path_mode == "demo_headlands":
        route_evidence.extend(evidence_features(line, supplied_walkable, "outside_supplied"))
    if not block_area.is_empty:
        route_evidence.extend(evidence_features(line, block_area, "outside_blocks"))
    return {
        "route": {"type": "FeatureCollection", "crs": CRS_MEMBER, "features": [
            {"type": "Feature", "geometry": mapping(line), "properties": properties}
        ]} if stops else None,
        "map": {
            "supplied_passages": input_collection(supplied_request.passages),
            "forbidden_areas": input_collection(supplied_request.forbidden),
            "study_area": input_collection(supplied_request.study_area),
            "inferred_headlands": feature_collection(inferred_features),
            "route_evidence": feature_collection(route_evidence),
        },
        "report": {
            "target_count": len(targets),
            "visited_count": len(stops),
            "coverage_ratio": len(stops) / len(targets) if targets else None,
            "outside_length_m": outside_m,
            "outside_ratio": outside_m / line.length if line.length else 0,
            "path_mode": request.path_mode,
            "outside_supplied_length_m": outside_supplied_m,
            "outside_supplied_ratio": outside_supplied_m / line.length if line.length else 0,
            "outside_blocks_length_m": outside_blocks_m,
            "outside_study_area_length_m": outside_study_m,
            "closed": bool(stops) and line.coords[0] == line.coords[-1],
            "targets": reports,
            "warnings": warnings,
            "duration_seconds": perf_counter() - started,
            "graph_nodes": network.graph.number_of_nodes(),
            "coverage_scope": "supplied_targets_only",
        },
    }

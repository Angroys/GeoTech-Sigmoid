import math

import networkx as nx
from shapely import STRtree, constrained_delaunay_triangles, get_coordinates
from shapely.geometry import LineString, shape
from shapely.ops import unary_union

from .models import FeatureCollection


class PlanningError(ValueError):
    """Invalid inputs or no legal route from the requested start."""


def geometries(collection: FeatureCollection, allowed: set[str], label: str):
    if collection.crs:
        name = collection.crs.get("properties", {}).get("name", "")
        if name not in {"EPSG:32635", "urn:ogc:def:crs:EPSG::32635"}:
            raise PlanningError(f"{label} must use EPSG:32635.")
    result = []
    for feature in collection.features:
        try:
            if feature.get("type") != "Feature":
                raise ValueError("Expected a GeoJSON Feature")
            geometry = feature.get("geometry")
            if not isinstance(geometry, dict) or not isinstance(geometry.get("type"), str):
                raise ValueError("Expected a GeoJSON geometry")
            if feature.get("properties") is not None and not isinstance(feature["properties"], dict):
                raise ValueError("Expected object properties")
            geom = shape(geometry)
            if geom.geom_type not in allowed or geom.is_empty or not geom.is_valid:
                raise ValueError("Empty, invalid, or unsupported geometry")
            if geom.has_z or not all(math.isfinite(v) for xy in get_coordinates(geom) for v in xy):
                raise ValueError("Expected finite 2D coordinates")
            result.append((geom, feature.get("properties") or {}))
        except (KeyError, TypeError, ValueError, AttributeError, IndexError) as exc:
            raise PlanningError(f"{label}: {exc}") from exc
    return result


def polygon_union(collection: FeatureCollection, label: str):
    return unary_union([g for g, _ in geometries(collection, {"Polygon", "MultiPolygon"}, label)])


def walkable_geometry(request):
    walkable = polygon_union(request.interrows, "interrows").union(polygon_union(request.passages, "passages"))
    obstacles = unary_union([
        polygon_union(request.canopy, "canopy"),
        polygon_union(request.forbidden, "forbidden"),
        polygon_union(request.barriers, "barriers"),
    ])
    walkable = walkable.difference(obstacles)
    if request.study_area is not None:
        walkable = walkable.intersection(polygon_union(request.study_area, "study_area"))
    if request.clearance_m:
        walkable = walkable.buffer(-request.clearance_m)
    if walkable.is_empty:
        raise PlanningError("No walkable area remains after applying the route constraints.")
    return walkable


class WalkingNetwork:
    """A triangle/portal graph; every edge stays within a walkable triangle.

    Constrained triangulation preserves holes and narrow corridors. Unlike a
    raster graph it does not depend on choosing a grid smaller than each aisle.
    Paths on this graph are approximations to continuous shortest paths.
    """

    def __init__(self, walkable):
        self.walkable = walkable
        self.triangles = list(constrained_delaunay_triangles(walkable).geoms)
        if not self.triangles or len(self.triangles) > 100000:
            raise PlanningError("Walkable geometry is empty or too complex (limit: 100,000 triangles).")
        self.graph = nx.Graph()
        self.positions = {}
        self.triangle_nodes = {}
        shared_edges = {}
        for i, triangle in enumerate(self.triangles):
            self.add_node(i, tuple(triangle.centroid.coords[0]))
            self.triangle_nodes[i] = [i]
            coords = list(triangle.exterior.coords)
            for a, b in zip(coords, coords[1:]):
                edge = tuple(sorted((a, b)))
                shared_edges.setdefault(edge, []).append(i)
        for (a, b), neighbours in shared_edges.items():
            if len(neighbours) == 2:
                portal = len(self.positions)
                self.add_node(portal, ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2))
                for i in neighbours:
                    self.connect(i, portal)
                    self.triangle_nodes[i].append(portal)
        self.tree = STRtree(self.triangles)

    def add_node(self, node, xy):
        self.positions[node] = xy
        self.graph.add_node(node)

    def connect(self, a, b):
        self.graph.add_edge(a, b, weight=math.dist(self.positions[a], self.positions[b]))

    def attach(self, point):
        containing = [int(i) for i in self.tree.query(point, predicate="intersects")]
        if not containing:
            # GEOS nearest-point projection at UTM magnitudes can land a few
            # floating-point units off a triangle boundary. This tolerance is
            # sub-micrometre; it must never bridge a real gap between aisles.
            containing = [int(i) for i in self.tree.query(point.buffer(1e-7))
                          if self.triangles[int(i)].distance(point) <= 1e-7]
        if not containing:
            raise PlanningError("Could not connect an approach point to the walking network.")
        node = len(self.positions)
        self.add_node(node, tuple(point.coords[0]))
        for i in containing:
            for other in self.triangle_nodes[i]:
                self.connect(node, other)
            self.triangle_nodes[i].append(node)
        return node

    def reachable_area(self, start_node):
        component = nx.node_connected_component(self.graph, start_node)
        return unary_union([t for i, t in enumerate(self.triangles) if i in component])

    def path(self, source, destination):
        nodes = nx.shortest_path(self.graph, source, destination, weight="weight")
        coords = [self.positions[n] for n in nodes]
        # Remove detours only when the complete shortcut lies in permitted land.
        simplified = [coords[0]]
        index = 0
        while index < len(coords) - 1:
            end = min(index + 100, len(coords) - 1)
            while end > index + 1 and not self.walkable.covers(LineString([coords[index], coords[end]])):
                end -= 1
            simplified.append(coords[end])
            index = end
        return simplified

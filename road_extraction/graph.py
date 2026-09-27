"""Road graphs: mask -> skeleton -> networkx graph -> LineStrings -> GeoJSON.

Two entry paths are supported:

1. Mask path: :func:`mask_to_graph` (skeletonize + trace) -> :func:`prune_spurs`
   -> :func:`graph_to_lines`.
2. Native SAM-Road path: :func:`edges_to_lines` takes SAM-Road's node array
   (``(N, 2)`` in ``(row, col)`` order by default, as returned by
   ``inferencer.infer_one_img``) and ``(M, 2)`` edge index pairs.

Graph layout (``nx.MultiGraph``): node attribute ``"o"`` = ``(row, col)`` float
pixel position; edge attribute ``"pts"`` = ``(K, 2)`` float array of
``(row, col)`` from one end node to the other, ``"length"`` = polyline length
in pixels.

GeoJSON output uses the (legacy, GeoJSON-2008) ``crs`` member naming
``urn:ogc:def:crs:EPSG::32635``: coordinates are **WGS 84 / UTM zone 35N
(EPSG:32635) easting/northing in metres**, not lon/lat.
"""

from __future__ import annotations

import json
from collections.abc import Iterable, Mapping, Sequence
from pathlib import Path
from typing import Any, Literal

import networkx as nx
import numpy as np
import numpy.typing as npt
from affine import Affine
from rasterio.coords import BoundingBox
from scipy import ndimage
from shapely.geometry import LineString, MultiLineString, box, mapping
from shapely.geometry.base import BaseGeometry
from skimage.morphology import skeletonize

from road_extraction.geo import pixel_to_crs

DEFAULT_EPSG = 32635
_NBRS = [(-1, -1), (-1, 0), (-1, 1), (0, -1), (0, 1), (1, -1), (1, 0), (1, 1)]


# --------------------------------------------------------------------------- mask -> skeleton


def mask_to_skeleton(
    prob_or_mask: npt.NDArray[np.generic],
    threshold: float = 0.5,
    min_object_px: int = 0,
) -> npt.NDArray[np.bool_]:
    """Threshold (if not bool), drop connected blobs smaller than ``min_object_px``, skeletonize."""
    arr = np.asarray(prob_or_mask)
    binary = arr.astype(bool) if arr.dtype == bool else arr >= threshold
    if min_object_px > 0:
        labels, n = ndimage.label(binary, structure=np.ones((3, 3)))
        if n:
            sizes = ndimage.sum(binary, labels, index=np.arange(1, n + 1))
            keep = np.zeros(n + 1, dtype=bool)
            keep[1:] = sizes >= min_object_px
            binary = keep[labels]
    return np.asarray(skeletonize(binary), dtype=bool)


# --------------------------------------------------------------------------- skeleton -> graph


def _polyline_length(pts: npt.NDArray[np.float64]) -> float:
    return float(np.linalg.norm(np.diff(pts, axis=0), axis=1).sum()) if len(pts) > 1 else 0.0


def skeleton_to_graph(skel: npt.NDArray[np.bool_]) -> nx.MultiGraph:
    """Trace a 1-px skeleton into a :class:`networkx.MultiGraph`.

    Nodes are clusters of skeleton pixels whose 8-neighbour count != 2
    (endpoints, junctions, isolated pixels); edges are the degree-2 pixel chains
    between them. Closed loops without any node get one synthetic node.
    """
    sk = np.pad(np.asarray(skel, dtype=bool), 1)
    deg = ndimage.convolve(sk.astype(np.int32), np.ones((3, 3), dtype=np.int32), mode="constant") - 1
    deg[~sk] = 0
    node_px = sk & (deg != 2)
    labels, n_nodes = ndimage.label(node_px, structure=np.ones((3, 3)))
    g = nx.MultiGraph()
    if n_nodes:
        centroids = ndimage.center_of_mass(node_px, labels, index=np.arange(1, n_nodes + 1))
        for i, (r, c) in enumerate(centroids, start=1):
            g.add_node(i, o=(float(r) - 1.0, float(c) - 1.0))

    visited = np.zeros_like(sk)

    def neighbours(r: int, c: int) -> list[tuple[int, int]]:
        return [(r + dr, c + dc) for dr, dc in _NBRS if sk[r + dr, c + dc]]

    def add_edge(u: int, v: int, chain: list[tuple[int, int]]) -> None:
        ou, ov = np.array(g.nodes[u]["o"]), np.array(g.nodes[v]["o"])
        inner = np.array(chain, dtype=np.float64).reshape(-1, 2) - 1.0
        pts = np.vstack([ou, inner, ov])
        g.add_edge(u, v, pts=pts, length=_polyline_length(pts))

    def walk(start: tuple[int, int], first: tuple[int, int]) -> tuple[list[tuple[int, int]], tuple[int, int] | None]:
        """Follow degree-2 pixels from ``first`` (coming from ``start``); return chain and terminal node pixel."""
        chain = [first]
        visited[first] = True
        prev, cur = start, first
        while True:
            nxt = [p for p in neighbours(*cur) if p != prev]
            node_hits = [p for p in nxt if node_px[p]]
            if node_hits:
                return chain, node_hits[0]
            nxt = [p for p in nxt if not visited[p]]
            if not nxt:
                return chain, None
            prev, cur = cur, nxt[0]
            visited[cur] = True
            chain.append(cur)

    for r, c in zip(*np.nonzero(node_px), strict=True):
        u = int(labels[r, c])
        for q in neighbours(int(r), int(c)):
            if node_px[q]:  # same 8-connected cluster by construction
                continue
            if visited[q]:
                continue
            chain, end = walk((int(r), int(c)), q)
            if end is not None:
                add_edge(u, int(labels[end]), chain)

    # pure loops (every pixel has degree 2 and none reached from a node)
    next_id = n_nodes + 1
    for r, c in zip(*np.nonzero(sk & ~visited & ~node_px), strict=True):
        if visited[r, c]:
            continue
        start = (int(r), int(c))
        visited[start] = True
        g.add_node(next_id, o=(start[0] - 1.0, start[1] - 1.0))
        nb = neighbours(*start)
        loop: list[tuple[int, int]] = []
        if nb and not visited[nb[0]]:
            loop, _ = walk(start, nb[0])
        add_edge(next_id, next_id, loop)
        next_id += 1
    return g


def mask_to_graph(
    prob_or_mask: npt.NDArray[np.generic],
    threshold: float = 0.5,
    min_object_px: int = 0,
    min_spur_px: float = 0.0,
) -> nx.MultiGraph:
    """Convenience: :func:`mask_to_skeleton` -> :func:`skeleton_to_graph` -> :func:`prune_spurs`."""
    g = skeleton_to_graph(mask_to_skeleton(prob_or_mask, threshold, min_object_px))
    return prune_spurs(g, min_spur_px)


# --------------------------------------------------------------------------- cleanup


def _orient(pts: npt.NDArray[np.float64], start: tuple[float, float]) -> npt.NDArray[np.float64]:
    s = np.asarray(start)
    return pts if np.linalg.norm(pts[0] - s) <= np.linalg.norm(pts[-1] - s) else pts[::-1]


def contract_degree2(g: nx.MultiGraph) -> nx.MultiGraph:
    """Merge the two edges at every degree-2 node (non-loop) into one polyline edge, in place."""
    changed = True
    while changed:
        changed = False
        for n in list(g.nodes):
            if n not in g or g.degree(n) != 2:
                continue
            edges = list(g.edges(n, keys=True, data=True))
            if len(edges) != 2 or any(u == v for u, v, _, _ in edges):
                continue
            (_, a, _ka, da), (_, b, _kb, db) = edges
            o = g.nodes[n]["o"]
            pa = _orient(da["pts"], o)[::-1]  # a ... n
            pb = _orient(db["pts"], o)  # n ... b
            pts = np.vstack([pa, pb[1:]])
            g.remove_node(n)
            g.add_edge(a, b, pts=pts, length=_polyline_length(pts))
            changed = True
    return g


def prune_spurs(
    g: nx.MultiGraph,
    min_spur_px: float,
    min_component_px: float = 0.0,
    min_loop_px: float = 4.0,
    max_iter: int = 10,
) -> nx.MultiGraph:
    """Remove short dangling branches, tiny loops and tiny components, then contract degree-2 nodes.

    A spur is an edge with one degree-1 end and one end of degree >= 3 whose
    length is < ``min_spur_px``. Self-loops shorter than ``min_loop_px`` (skeleton
    corner artefacts) are always removed. Operates on a copy.
    """
    g = g.copy()
    for _ in range(max_iter):
        before = g.number_of_edges()
        for u, v, k, d in list(g.edges(keys=True, data=True)):
            if u == v and d["length"] < min_loop_px:
                g.remove_edge(u, v, k)
        for u, v, k, d in list(g.edges(keys=True, data=True)):
            if u == v or d["length"] >= min_spur_px or not g.has_edge(u, v, k):
                continue
            du, dv = g.degree(u), g.degree(v)
            if (du == 1 and dv >= 3) or (dv == 1 and du >= 3):
                g.remove_edge(u, v, k)
        g.remove_nodes_from([n for n in list(g.nodes) if g.degree(n) == 0])
        contract_degree2(g)
        if g.number_of_edges() == before:
            break
    if min_component_px > 0:
        for comp in list(nx.connected_components(g)):
            total = sum(d["length"] for _, _, d in g.subgraph(comp).edges(data=True))
            if total < min_component_px:
                g.remove_nodes_from(comp)
    g.remove_nodes_from([n for n in list(g.nodes) if g.degree(n) == 0])
    return g


# --------------------------------------------------------------------------- graph -> geometry


def pixel_polyline_to_crs(
    pts_rc: npt.NDArray[np.floating[Any]], transform: Affine, offset: Literal["center", "ul"] = "center"
) -> LineString:
    """``(K, 2)`` ``(row, col)`` pixel polyline -> CRS LineString."""
    xs, ys = pixel_to_crs(transform, pts_rc[:, 0], pts_rc[:, 1], offset)
    return LineString(np.column_stack([xs, ys]))


def graph_to_lines(
    g: nx.MultiGraph,
    transform: Affine,
    simplify_px: float = 1.0,
) -> list[LineString]:
    """Edge polylines of ``g`` -> CRS LineStrings, Douglas-Peucker-simplified by ``simplify_px`` pixels."""
    lines: list[LineString] = []
    tol = simplify_px * abs(transform.a)
    for _, _, d in g.edges(data=True):
        pts = np.asarray(d["pts"], dtype=np.float64)
        if len(pts) < 2:
            continue
        line = pixel_polyline_to_crs(pts, transform)
        if tol > 0:
            line = line.simplify(tol, preserve_topology=False)
        if line.length > 0:
            lines.append(line)
    return lines


def edges_to_lines(
    points: npt.ArrayLike,
    edges: npt.ArrayLike,
    transform: Affine,
    order: Literal["rc", "xy"] = "rc",
    offset: Literal["center", "ul"] = "center",
) -> list[LineString]:
    """SAM-Road style graph (``points`` ``(N, 2)``, ``edges`` ``(M, 2)`` node indices) -> CRS LineStrings.

    ``order="rc"`` (SAM-Road's ``pred_nodes``) means ``(row, col)``; ``"xy"`` means
    ``(col, row)`` pixel coords. Degenerate (zero-length) edges are skipped.
    """
    pts = np.asarray(points, dtype=np.float64).reshape(-1, 2)
    e = np.asarray(edges, dtype=np.int64).reshape(-1, 2)
    if order == "xy":
        pts = pts[:, ::-1]
    lines: list[LineString] = []
    for i, j in e:
        seg = pts[[i, j]]
        if np.allclose(seg[0], seg[1]):
            continue
        lines.append(pixel_polyline_to_crs(seg, transform, offset))
    return lines


def _explode(geom: BaseGeometry) -> list[LineString]:
    if isinstance(geom, LineString):
        return [geom] if not geom.is_empty and geom.length > 0 else []
    if isinstance(geom, MultiLineString):
        return [g for g in geom.geoms if g.length > 0]
    if hasattr(geom, "geoms"):
        return [ln for part in geom.geoms for ln in _explode(part)]
    return []


def clip_lines(lines: Iterable[LineString], bounds: BoundingBox | Sequence[float]) -> list[LineString]:
    """Clip lines to ``(left, bottom, right, top)``; returns only non-empty LineString parts."""
    clip_box = box(*bounds)
    out: list[LineString] = []
    for line in lines:
        if line.intersects(clip_box):
            out.extend(_explode(line.intersection(clip_box)))
    return out


# --------------------------------------------------------------------------- GeoJSON


def crs_member(epsg: int = DEFAULT_EPSG) -> dict[str, Any]:
    """GeoJSON-2008 named ``crs`` member, e.g. ``urn:ogc:def:crs:EPSG::32635``."""
    return {"type": "name", "properties": {"name": f"urn:ogc:def:crs:EPSG::{epsg}"}}


def lines_to_feature_collection(
    lines: Sequence[LineString],
    epsg: int = DEFAULT_EPSG,
    properties: Sequence[Mapping[str, Any]] | Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    """Build a GeoJSON FeatureCollection of LineStrings in ``EPSG:{epsg}`` (projected, metres).

    ``properties`` is either one mapping applied to every feature or a
    per-feature sequence. Each feature also gets ``id`` and ``length_m``.
    """
    feats = []
    for i, line in enumerate(lines):
        if isinstance(properties, Mapping) or properties is None:
            props = dict(properties or {})
        else:
            props = dict(properties[i])
        props.setdefault("length_m", round(float(line.length), 3))
        feats.append({"type": "Feature", "id": i, "properties": props, "geometry": mapping(line)})
    return {"type": "FeatureCollection", "crs": crs_member(epsg), "features": feats}


def write_geojson(
    path: str | Path,
    lines: Sequence[LineString],
    epsg: int = DEFAULT_EPSG,
    properties: Sequence[Mapping[str, Any]] | Mapping[str, Any] | None = None,
) -> Path:
    """Write :func:`lines_to_feature_collection` to ``path`` (parents created)."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    fc = lines_to_feature_collection(lines, epsg, properties)
    path.write_text(json.dumps(fc, default=_json_default))
    return path


def _json_default(o: object) -> Any:
    if isinstance(o, np.generic):
        return o.item()
    if isinstance(o, tuple):
        return list(o)
    raise TypeError(f"not JSON serialisable: {type(o)}")

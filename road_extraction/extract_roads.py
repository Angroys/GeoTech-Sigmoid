"""Extract a road network from the Siret3 GeoTIFF tiles with pretrained SAM-Road.

Pipeline: tile index -> downscaled field mosaic (~model-native GSD) ->
SAM-Road masks over overlapping windows (batched on GPU, blended) ->
road graph (SAM-Road TopoNet or skeletonisation of the road mask) ->
CRS LineStrings -> per-tile masks/GeoJSON/previews + field-level outputs.

Run from the repo root (or a worktree)::

    /home/minimax/venv/bin/python -m road_extraction.extract_roads            # all tiles, defaults
    /home/minimax/venv/bin/python -m road_extraction.extract_roads --rows 20:24 --cols 12:17 \\
        --out-dir /tmp/road_trial --gsd 0.5

Defaults for ``--tiles-dir``/``--out-dir`` are resolved against the *main*
repo root (``$GEOTECH_REPO_ROOT`` or ``git rev-parse --git-common-dir``), see
:mod:`road_extraction.paths`.
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
import threading
import time
import warnings
from collections.abc import Sequence
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any

if __package__ in (None, ""):  # allow `python road_extraction/extract_roads.py`
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import networkx as nx
import numpy as np
import numpy.typing as npt
import rasterio
from affine import Affine
from shapely.geometry import LineString

from road_extraction import paths
from road_extraction.geo import crop_raster, resample_mask_to_tile, write_mask_geotiff
from road_extraction.graph import (
    DEFAULT_EPSG,
    clip_lines,
    edges_to_graph,
    graph_to_lines,
    mask_to_graph,
    prune_spurs,
    write_geojson,
)
from road_extraction.mosaic import Mosaic, build_mosaic, read_tile_decimated, tile_out_px, tile_out_px_from_scale
from road_extraction.render import block_reduce_mean, render_overlay, save_png
from road_extraction.tiles import TileInfo, build_grid, scan_tiles

log = logging.getLogger("extract_roads")
_WARP_LOCK = threading.Lock()

DEFAULT_MODEL = "spacenet"  # chosen on real data, see README "Road extraction (SAM-Road)"
DEFAULT_GSD = 0.5
GRAPH_METHODS = ("toponet", "skeleton", "both")


# --------------------------------------------------------------------------- CLI


def build_parser() -> argparse.ArgumentParser:
    root = paths.resolve_repo_root()
    ap = argparse.ArgumentParser(
        prog="extract_roads",
        description="Road-network extraction on the Siret3 tiles with pretrained SAM-Road (no fine-tuning).",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    io = ap.add_argument_group("input / output")
    io.add_argument(
        "--tiles-dir", type=Path, default=paths.default_tiles_dir(root), help="directory of *_rRRR_cCCC.tif tiles"
    )
    io.add_argument("--out-dir", type=Path, default=paths.default_out_dir(root), help="output directory")
    io.add_argument("--tiles", nargs="+", default=None, help="subset: tile selectors (r12_c5, siret3_r012_c005, 12,5)")
    io.add_argument("--rows", type=paths.parse_range, default=None, help="subset: inclusive tile-row range, e.g. 20:24")
    io.add_argument("--cols", type=paths.parse_range, default=None, help="subset: inclusive tile-col range, e.g. 12:17")
    io.add_argument("--limit", type=int, default=None, help="subset: first N tiles (sorted by row, col)")
    io.add_argument("--no-previews", action="store_true", help="skip per-tile and overview PNGs")
    io.add_argument("--no-tile-outputs", action="store_true", help="only write field-level outputs (fast trials)")
    io.add_argument("--workers", type=int, default=8, help="threads for per-tile writing/previews")
    io.add_argument("--preview-px", type=int, default=512, help="per-tile preview side length")

    md = ap.add_argument_group("model / inference")
    md.add_argument("--model", choices=["cityscale", "spacenet"], default=DEFAULT_MODEL)
    sc = md.add_mutually_exclusive_group()
    sc.add_argument("--gsd", type=float, default=None, help=f"target mosaic GSD in m/px (default {DEFAULT_GSD})")
    sc.add_argument(
        "--scale", type=float, default=None, help="downsample factor vs. source tiles (alternative to --gsd)"
    )
    md.add_argument(
        "--window", type=int, default=None, help="window side in mosaic px (default = model patch: 512/256)"
    )
    md.add_argument("--overlap", type=int, default=None, help="window overlap in mosaic px (default = window/2)")
    md.add_argument("--batch-size", type=int, default=16)
    md.add_argument("--blend", choices=["cosine", "linear", "uniform"], default="cosine")
    md.add_argument("--device", default=None, help="torch device (default cuda if available)")
    md.add_argument("--itsc-threshold", type=float, default=None, help="override keypoint threshold")
    md.add_argument("--road-threshold", type=float, default=None, help="override road threshold (also used for masks)")
    md.add_argument("--topo-threshold", type=float, default=None, help="override TopoNet edge threshold")

    gr = ap.add_argument_group("graph")
    gr.add_argument(
        "--graph",
        choices=GRAPH_METHODS,
        default="both",
        help="toponet = SAM-Road native graph; skeleton = skeletonised mask; both = toponet + extra skeleton file",
    )
    gr.add_argument("--min-spur-m", type=float, default=6.0, help="prune dangling branches shorter than this (metres)")
    gr.add_argument(
        "--min-component-m", type=float, default=15.0, help="drop connected components shorter than this (metres)"
    )
    gr.add_argument("--simplify-m", type=float, default=0.5, help="Douglas-Peucker tolerance (metres)")
    gr.add_argument("--mask-resampling", choices=["bilinear", "nearest"], default="bilinear")
    ap.add_argument("-v", "--verbose", action="store_true")
    return ap


# --------------------------------------------------------------------------- steps


def mosaic_px(args: argparse.Namespace, tile: TileInfo) -> int:
    if args.scale is not None:
        return tile_out_px_from_scale(tile.width, args.scale)
    return tile_out_px(tile.width, abs(tile.transform.a), args.gsd if args.gsd is not None else DEFAULT_GSD)


def build_line_graph(
    method: str,
    runner: Any,
    pred: Any,
    road: npt.NDArray[np.float32],
    keypoint: npt.NDArray[np.float32],
    gsd: float,
    args: argparse.Namespace,
) -> tuple[nx.MultiGraph, dict[str, Any]]:
    """Build and prune the road graph (mosaic pixel coords) for one method; returns graph + stats."""
    spur_px, comp_px = args.min_spur_m / gsd, args.min_component_m / gsd
    stats: dict[str, Any] = {"method": method}
    if method == "toponet":
        topo = runner.extract_graph(pred, keypoint=keypoint, road=road, batch_size=args.batch_size)
        stats.update(n_points=len(topo.nodes_rc), n_candidate_pairs=topo.n_candidate_pairs, n_edges_raw=len(topo.edges))
        g = edges_to_graph(topo.nodes_rc, topo.edges, order="rc")
    else:
        g = mask_to_graph(road, threshold=runner.thresholds["road"], min_object_px=int(comp_px))
    g = prune_spurs(g, spur_px, min_component_px=comp_px)
    stats.update(n_nodes=g.number_of_nodes(), n_edges=g.number_of_edges())
    return g, stats


def per_tile_outputs(
    tile: TileInfo,
    mosaic: Mosaic,
    road: npt.NDArray[np.float32],
    lines: Sequence[LineString],
    props: dict[str, Any],
    args: argparse.Namespace,
    threshold: float,
) -> dict[str, Any]:
    """Write mask GeoTIFF, clipped GeoJSON and preview for one tile."""
    rs, cs = mosaic.tile_slice(tile.row, tile.col)
    sub, sub_tf = crop_raster(road, mosaic.transform, rs, cs, margin=2)
    with _WARP_LOCK:  # rasterio in-memory reproject is not reliably thread-safe (spurious warnings)
        mask = resample_mask_to_tile(sub, sub_tf, tile.transform, tile.shape, tile.crs, args.mask_resampling, threshold)
    write_mask_geotiff(paths.mask_path(args.out_dir, tile.row, tile.col), mask, tile.transform, tile.crs)
    tile_lines = clip_lines(lines, tile.bounds)
    tprops = {**props, "tile": paths.tile_stem(tile.row, tile.col)}
    write_geojson(paths.geojson_path(args.out_dir, tile.row, tile.col), tile_lines, DEFAULT_EPSG, tprops)
    if not args.no_previews:
        px = args.preview_px
        rgb = read_tile_decimated(tile, px, bands=[1, 2, 3])
        factor = tile.width // px
        m_small = block_reduce_mean(mask, factor) if tile.width % px == 0 else mask[::factor, ::factor]
        ptf = tile.transform @ Affine.scale(tile.width / px, tile.height / px)
        img = render_overlay(rgb, ptf, road_alpha=m_small * 0.45, lines=tile_lines, line_width=3)
        save_png(img, paths.preview_path(args.out_dir, tile.row, tile.col))
    return {
        "road_px": int(mask.sum()),
        "n_lines": len(tile_lines),
        "length_m": float(sum(ln.length for ln in tile_lines)),
    }


def write_prob_geotiff(
    path: Path, road: npt.NDArray[np.floating], keypoint: npt.NDArray[np.floating], mosaic: Mosaic
) -> None:
    """2-band uint8 GeoTIFF of stitched probabilities x255 (band 1 road, band 2 keypoint)."""
    path.parent.mkdir(parents=True, exist_ok=True)
    data = np.stack([np.clip(road, 0, 1) * 255, np.clip(keypoint, 0, 1) * 255]).round().astype(np.uint8)
    with rasterio.open(
        path,
        "w",
        driver="GTiff",
        height=data.shape[1],
        width=data.shape[2],
        count=2,
        dtype="uint8",
        crs=mosaic.crs,
        transform=mosaic.transform,
        compress="deflate",
    ) as dst:
        dst.write(data)
        dst.set_band_description(1, "road_probability_x255")
        dst.set_band_description(2, "keypoint_probability_x255")


# --------------------------------------------------------------------------- main


def run(args: argparse.Namespace) -> dict[str, Any]:
    import torch

    from road_extraction.sam_road_infer import SamRoadRunner

    timings: dict[str, float] = {}
    t_all = time.perf_counter()

    def lap(key: str, t0: float) -> float:
        timings[key] = round(time.perf_counter() - t0, 3)
        log.info("%-14s %.2fs", key, timings[key])
        return time.perf_counter()

    t = time.perf_counter()
    all_tiles = scan_tiles(args.tiles_dir)
    if not all_tiles:
        raise SystemExit(f"no tiles found in {args.tiles_dir}")
    by_rc = {(ti.row, ti.col): ti for ti in all_tiles}
    keys = paths.select_tiles(by_rc, args.tiles, args.rows, args.cols, args.limit)
    if not keys:
        raise SystemExit("tile selection is empty")
    grid = build_grid([by_rc[k] for k in keys])
    out_px = mosaic_px(args, grid.tiles[keys[0]])
    t = lap("scan", t)

    mosaic = build_mosaic(grid, out_px, bands=[1, 2, 3], black_as_nodata=True)
    gsd = mosaic.gsd
    log.info("mosaic %s px @ %.3f m/px from %d tiles (%d px/tile)", mosaic.shape, gsd, len(keys), out_px)
    t = lap("mosaic", t)

    device = torch.device(args.device or ("cuda" if torch.cuda.is_available() else "cpu"))
    runner = SamRoadRunner(args.model, device, args.itsc_threshold, args.road_threshold, args.topo_threshold)
    t = lap("model_load", t)

    window = args.window or runner.patch
    overlap = args.overlap if args.overlap is not None else window // 2
    pred = runner.predict_masks(
        np.ascontiguousarray(mosaic.image[..., :3]), mosaic.valid, window, overlap, args.batch_size, args.blend
    )
    valid_f = mosaic.valid.astype(np.float32)
    road = pred.road * valid_f
    keypoint = pred.keypoint * valid_f
    if device.type == "cuda":
        torch.cuda.synchronize(device)
    t = lap("inference", t)

    methods = ["toponet", "skeleton"] if args.graph == "both" else [args.graph]
    graph_stats: dict[str, Any] = {}
    field_lines: dict[str, list[LineString]] = {}
    for m in methods:
        g, st = build_line_graph(m, runner, pred, road, keypoint, gsd, args)
        field_lines[m] = graph_to_lines(g, mosaic.transform, simplify_px=args.simplify_m / gsd)
        st["n_lines"] = len(field_lines[m])
        st["length_km"] = round(sum(ln.length for ln in field_lines[m]) / 1000, 3)
        graph_stats[m] = st
        log.info("graph[%s]: %s", m, st)
    main_method = methods[0]
    lines = field_lines[main_method]
    t = lap("graph", t)

    out: Path = args.out_dir
    out.mkdir(parents=True, exist_ok=True)
    props = {"model": args.model, "method": main_method, "gsd_m": round(gsd, 4)}
    write_geojson(out / "roads_field.geojson", lines, DEFAULT_EPSG, props)
    if "skeleton" in field_lines and main_method != "skeleton":
        write_geojson(
            out / "roads_field_skeleton.geojson", field_lines["skeleton"], DEFAULT_EPSG, {**props, "method": "skeleton"}
        )
    write_prob_geotiff(out / "road_prob_field.tif", road, keypoint, mosaic)
    if not args.no_previews:
        ov = render_overlay(
            mosaic.image,
            mosaic.transform,
            road_alpha=np.clip(road, 0, 1) * 0.7,
            lines=lines,
            invalid=~mosaic.valid,
            max_side=2600,
            min_side=1800,
        )
        save_png(ov, out / "previews" / "overview_field.png")
        ov2 = render_overlay(
            mosaic.image, mosaic.transform, lines=lines, invalid=~mosaic.valid, max_side=2600, min_side=1800
        )
        save_png(ov2, out / "previews" / "overview_field_lines.png")
    t = lap("field_outputs", t)

    tile_stats: dict[str, Any] = {}
    if not args.no_tile_outputs:
        thr = runner.thresholds["road"]
        with ThreadPoolExecutor(max_workers=max(1, args.workers)) as ex:
            futs = {k: ex.submit(per_tile_outputs, grid.tiles[k], mosaic, road, lines, props, args, thr) for k in keys}
            for k, f in futs.items():
                tile_stats[paths.tile_stem(*k)] = f.result()
        t = lap("tile_outputs", t)

    timings["total"] = round(time.perf_counter() - t_all, 3)
    meta = {
        "model": args.model,
        "device": str(device),
        "device_name": torch.cuda.get_device_name(device) if device.type == "cuda" else None,
        "tiles_dir": str(args.tiles_dir),
        "out_dir": str(out),
        "n_tiles": len(keys),
        "tile_px": grid.tile_width_px,
        "tile_res_m": grid.res_x,
        "mosaic_px_per_tile": out_px,
        "gsd_m": gsd,
        "mosaic_shape": list(mosaic.shape),
        "mosaic_transform": list(mosaic.transform)[:6],
        "crs": str(mosaic.crs),
        "window": window,
        "overlap": overlap,
        "n_windows": len(pred.windows),
        "batch_size": args.batch_size,
        "blend": args.blend,
        "thresholds": runner.thresholds,
        "graph": args.graph,
        "graph_stats": graph_stats,
        "min_spur_m": args.min_spur_m,
        "min_component_m": args.min_component_m,
        "simplify_m": args.simplify_m,
        "road_frac_valid": float((road >= runner.thresholds["road"]).sum() / max(1, mosaic.valid.sum())),
        "n_field_lines": len(lines),
        "field_length_km": round(sum(ln.length for ln in lines) / 1000, 3),
        "timings_s": timings,
        "tiles": tile_stats,
    }
    (out / "run_meta.json").write_text(json.dumps(meta, indent=2))
    log.info(
        "done: %d tiles, %d lines, %.2f km, %.1fs total -> %s",
        len(keys),
        len(lines),
        meta["field_length_km"],
        timings["total"],
        out,
    )
    return meta


def main(argv: Sequence[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
        datefmt="%H:%M:%S",
    )
    # upstream TopoNet uses nn.TransformerEncoder with a padding mask -> prototype nested-tensor warning
    warnings.filterwarnings("ignore", message="The PyTorch API of nested tensors")
    for noisy in ("rasterio", "PIL", "matplotlib"):
        logging.getLogger(noisy).setLevel(logging.WARNING)
    run(args)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

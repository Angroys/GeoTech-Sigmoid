"""Run the fine-tuned SAM 3 (run3c) on one GeoTIFF tile and write GeoJSON (EPSG:32635).

Usage (needs the optional model deps, a GPU and the weights):
    PYTHONPATH=route-algo python route-algo/scripts/sam3_infer_tile.py TILE.tif [--out out.geojson]
        [--weights best.pth] [--parcels parcels.geojson] [--device cuda]

Bake the effective weights once (needs best.pth + base sam3.pt; afterwards sam3.pt is not needed):
    python route-algo/scripts/sam3_infer_tile.py --bake-out data/tested-on-vm/sam3_ft/run3c/best_effective.pth
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from collections import Counter
from pathlib import Path

from route_algo.processing.sam3_model import Sam3Segmenter, feature_collection


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("tif", type=Path, nargs="?")
    ap.add_argument("--out", type=Path, default=None, help="output GeoJSON (default: stdout summary only)")
    ap.add_argument("--weights", type=Path, default=None)
    ap.add_argument("--parcels", type=Path, default=None)
    ap.add_argument("--device", default=None)
    ap.add_argument("--bake-out", type=Path, default=None, help="write baked effective weights here and exit")
    a = ap.parse_args()

    if a.bake_out:
        import torch

        from route_algo.processing.sam3_model import load_effective_state, weights_path

        state = load_effective_state(a.weights or weights_path())
        torch.save({k: v.bfloat16() if v.is_floating_point() else v for k, v in state.items()}, a.bake_out)
        print(json.dumps({"baked": str(a.bake_out)}))
        return 0
    if a.tif is None:
        ap.error("tif is required unless --bake-out is given")

    seg = Sam3Segmenter(weights=a.weights, device=a.device, parcels=a.parcels)
    if a.weights is None and not Sam3Segmenter.available():
        print("SAM 3 not available (torch/sam3/CUDA/weights missing; see SAM3_FT_WEIGHTS)", file=sys.stderr)
        return 2
    t0 = time.perf_counter()
    seg.model()
    t1 = time.perf_counter()
    feats = seg.segment_tile(a.tif)
    t2 = time.perf_counter()
    summary = {
        "tile": a.tif.name,
        "features": len(feats),
        "classes": dict(Counter(f["properties"]["class"] for f in feats)),
        "load_s": round(t1 - t0, 2),
        "infer_s": round(t2 - t1, 2),
    }
    try:
        import torch

        if torch.cuda.is_available():
            summary["peak_vram_mb"] = round(torch.cuda.max_memory_allocated() / 2**20)
    except ImportError:
        pass
    if a.out:
        a.out.write_text(json.dumps(feature_collection(feats)))
        summary["out"] = str(a.out)
    print(json.dumps(summary))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

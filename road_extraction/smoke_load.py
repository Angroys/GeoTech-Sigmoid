"""GPU smoke test for pretrained SAM-Road (htcr/sam_road) checkpoints.

Run after ``bash road_extraction/setup_sam_road.sh``::

    /home/minimax/venv/bin/python road_extraction/smoke_load.py            # both models
    /home/minimax/venv/bin/python road_extraction/smoke_load.py --model cityscale --image some.tif

Builds ``SAMRoad`` from the upstream YAML config, loads the downloaded
checkpoint, runs one forward pass (masks + TopoNet) on CUDA and prints output
shapes, device and timings.

Integration notes (for the inference CLI built on top of this)
===============================================================

Construction
    * ``sys.path`` must contain ``road_extraction/third_party/sam_road`` (the
      code does ``from sam.segment_anything...`` and ``import graph_utils``)
      AND ``.../sam_road/sam`` (the SAM fork's predictor.py does
      ``from segment_anything.modeling import Sam``). See ``_import_sam_road``.
    * ``config = utils.load_config(yaml)`` -> ``addict.Dict``. Override
      ``config.SAM_CKPT_PATH`` with the absolute path of
      ``weights/sam_vit_b_01ec64.pth`` (the YAML has a cwd-relative path; the
      SAM weights are read in ``SAMRoad.__init__`` and then fully overwritten
      by the SAM-Road checkpoint).
    * ``net = model.SAMRoad(config)``;
      ``net.load_state_dict(torch.load(ckpt, map_location="cpu",
      weights_only=False)["state_dict"], strict=True)``; ``net.eval().cuda()``.

Input expectations
    * Tensor ``[B, H, W, 3]`` float32, **RGB** order (upstream reads with cv2
      and converts BGR->RGB), raw **0..255** values (NOT pre-normalised).
      The model itself permutes to NCHW and normalises with the SAM/ImageNet
      mean (123.675, 116.28, 103.53) / std (58.395, 57.12, 57.375).
    * H = W = ``config.PATCH_SIZE`` exactly (the ViT pos-embeddings are resized
      to that size at build time): CityScale = 512, SpaceNet = 256. ViT patch
      size 16 -> image embedding ``[B, 256, P/16, P/16]``.
    * Native GSD of both training sets is ~1 m/px (CityScale 2048x2048 tiles,
      SpaceNet 400x400 "RGB_1.0_meter"). Resample our 2.5 cm/px imagery
      (factor ~40) before inference.

Outputs
    * ``mask_scores, img_emb = net.infer_masks_and_img_features(rgb)``:
      ``mask_scores`` is ``[B, P, P, 2]`` sigmoid probabilities in 0..1;
      channel 0 = keypoint/intersection ("itsc") map, channel 1 = road map.
      ``img_emb`` is ``[B, 256, P/16, P/16]`` (needed for TopoNet).
    * ``net.infer_toponet(img_emb, points[B,N,2] (x,y px within patch, float),
      pairs[B,N,K,2] (int64 indices into points), valid[B,N,K] bool)`` ->
      ``[B, N, K, 1]`` edge probabilities (NaN for all-invalid rows).

Large-image inference + graph (upstream ``inferencer.py::infer_one_img``)
    1. ``dataset.get_patch_info_one_img(0, img_size, SAMPLE_MARGIN, PATCH_SIZE,
       INFER_PATCHES_PER_EDGE)`` -> overlapping sliding windows (16x16 grid).
       NOTE: assumes a square image.
    2. Per batch ``infer_masks_and_img_features``; masks are averaged over
       overlaps, then scaled to uint8 0..255.
    3. ``graph_extraction.extract_graph_points(kp_mask_u8, road_mask_u8, config)``
       thresholds (ITSC_THRESHOLD / ROAD_THRESHOLD * 255) + NMS
       (``graph_utils.nms_points``, radii ITSC_NMS_RADIUS / ROAD_NMS_RADIUS)
       -> graph vertices ``[N, 2]`` in (x, y).
    4. Per window: rtree + KDTree (k=MAX_NEIGHBOR_QUERIES, r=NEIGHBOR_RADIUS)
       candidate pairs -> ``infer_toponet`` -> edge scores averaged over
       windows, kept if > TOPO_THRESHOLD. Returns ``pred_nodes`` in (r, c) and
       ``pred_edges`` ``[E, 2]`` index pairs.
    ``inferencer.py`` runs ``argparse`` at import time, so do not import it;
    re-implement/copy ``infer_one_img`` (it also uses a module-global
    ``args.device``). An alternative A*-based extractor exists in
    ``graph_extraction.extract_graph_astar`` (uses tcod).

CityScale vs SpaceNet configs
    ============================  ===========  ==========
    key                           CityScale    SpaceNet
    ============================  ===========  ==========
    YAML                          toponet_vitb_512_cityscale.yaml / toponet_vitb_256_spacenet.yaml
    PATCH_SIZE                    512          256
    SAMPLE_MARGIN                 64           0
    TOPO_SAMPLE_NUM (train)       512          128
    ITSC_THRESHOLD                0.248        0.195
    ROAD_THRESHOLD                0.364        0.341
    TOPO_THRESHOLD                0.500        0.705
    ============================  ===========  ==========
    Shared: vit_b, INFER_BATCH_SIZE 64, INFER_PATCHES_PER_EDGE 16,
    ITSC_NMS_RADIUS 8, ROAD_NMS_RADIUS 16, NEIGHBOR_RADIUS 64,
    MAX_NEIGHBOR_QUERIES 16 (all radii in model pixels, i.e. ~metres).
"""

from __future__ import annotations

import argparse
import os
import sys
import time
from pathlib import Path

import numpy as np
import torch

HERE = Path(__file__).resolve().parent
SAM_ROAD_DIR = HERE / "third_party" / "sam_road"
WEIGHTS_DIR = Path(os.environ.get("SAM_ROAD_WEIGHTS_DIR", HERE / "weights"))

MODELS = {
    "cityscale": ("toponet_vitb_512_cityscale.yaml", "cityscale_vitb_512_e10.ckpt"),
    "spacenet": ("toponet_vitb_256_spacenet.yaml", "spacenet_vitb_256_e10.ckpt"),
}


def _import_sam_road():
    if not SAM_ROAD_DIR.is_dir():
        sys.exit(f"{SAM_ROAD_DIR} missing - run road_extraction/setup_sam_road.sh first")
    # sam_road imports ``sam.segment_anything`` (repo root) while the fork's
    # predictor.py imports top-level ``segment_anything`` (sam/ dir): need both.
    for p in (SAM_ROAD_DIR / "sam", SAM_ROAD_DIR):
        if str(p) not in sys.path:
            sys.path.insert(0, str(p))
    import model as sam_road_model  # noqa: E402
    import utils as sam_road_utils  # noqa: E402

    return sam_road_model, sam_road_utils


def build_model(name: str, device: torch.device):
    """Build SAMRoad for ``name`` ('cityscale'|'spacenet') and load its checkpoint."""
    sam_road_model, sam_road_utils = _import_sam_road()
    cfg_file, ckpt_file = MODELS[name]
    config = sam_road_utils.load_config(str(SAM_ROAD_DIR / "config" / cfg_file))
    config.SAM_CKPT_PATH = str(WEIGHTS_DIR / "sam_vit_b_01ec64.pth")

    import contextlib
    import io

    # SAMRoad.__init__ pprints hundreds of matched SAM param names; silence it.
    with contextlib.redirect_stdout(io.StringIO()):
        net = sam_road_model.SAMRoad(config)
    ckpt = torch.load(WEIGHTS_DIR / ckpt_file, map_location="cpu", weights_only=False)
    net.load_state_dict(ckpt["state_dict"], strict=True)
    net.eval().to(device)
    return net, config


def load_image(path: str | None, size: int) -> np.ndarray:
    """Return an HxWx3 uint8 RGB image of ``size`` px (random if no path)."""
    if path is None:
        rng = np.random.default_rng(0)
        return rng.integers(0, 256, (size, size, 3), dtype=np.uint8)
    from PIL import Image

    try:
        import rasterio

        with rasterio.open(path) as src:
            arr = np.moveaxis(src.read([1, 2, 3]), 0, -1)
        img = Image.fromarray(arr.astype(np.uint8))
    except Exception:
        img = Image.open(path).convert("RGB")
    return np.asarray(img.resize((size, size), Image.BILINEAR), dtype=np.uint8)


def smoke(name: str, image: str | None, device: torch.device) -> None:
    t0 = time.perf_counter()
    net, config = build_model(name, device)
    torch.cuda.synchronize(device)
    t_load = time.perf_counter() - t0

    p = config.PATCH_SIZE
    rgb = torch.from_numpy(load_image(image, p)).float().unsqueeze(0).to(device)  # [1,P,P,3] 0..255

    with torch.no_grad():
        net.infer_masks_and_img_features(rgb)  # warm-up
        torch.cuda.synchronize(device)
        t0 = time.perf_counter()
        mask_scores, img_emb = net.infer_masks_and_img_features(rgb)
        torch.cuda.synchronize(device)
        t_fwd = time.perf_counter() - t0

        # TopoNet on a few dummy points: every point queries all others.
        n = 8
        pts = torch.rand(1, n, 2, device=device) * p
        src = torch.arange(n, device=device).view(n, 1).expand(n, n)
        tgt = torch.arange(n, device=device).view(1, n).expand(n, n)
        pairs = torch.stack([src, tgt], -1).unsqueeze(0)
        valid = (src != tgt).unsqueeze(0)
        topo = net.infer_toponet(img_emb, pts, pairs, valid)

    kp, road = mask_scores[..., 0], mask_scores[..., 1]
    print(f"== {name} ({MODELS[name][0]}) on {device} [{torch.cuda.get_device_name(device)}]")
    print(f"   input rgb          {tuple(rgb.shape)} float32 0..255 RGB")
    print(f"   mask_scores        {tuple(mask_scores.shape)}  (ch0 keypoint, ch1 road)")
    print(f"   keypoint mask      {tuple(kp.shape)} range [{kp.min():.3f}, {kp.max():.3f}]")
    print(f"   road mask          {tuple(road.shape)} range [{road.min():.3f}, {road.max():.3f}]"
          f"  >thr({config.ROAD_THRESHOLD}) frac={float((road > config.ROAD_THRESHOLD).float().mean()):.4f}")
    print(f"   image embedding    {tuple(img_emb.shape)}")
    print(f"   toponet scores     {tuple(topo.shape)}")
    print(f"   build+load {t_load:.2f}s | forward {t_fwd * 1000:.1f} ms | "
          f"peak mem {torch.cuda.max_memory_allocated(device) / 2**20:.0f} MiB")
    assert mask_scores.shape == (1, p, p, 2)
    assert img_emb.shape == (1, 256, p // 16, p // 16)
    assert torch.isfinite(mask_scores).all()
    del net
    torch.cuda.empty_cache()


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--model", choices=[*MODELS, "both"], default="both")
    ap.add_argument("--image", default=None, help="optional RGB image/GeoTIFF (resized to patch size)")
    args = ap.parse_args()

    if not torch.cuda.is_available():
        sys.exit("CUDA not available - this smoke test must run on the GPU")
    device = torch.device("cuda")
    print(f"torch {torch.__version__} | CUDA {torch.version.cuda} | {torch.cuda.get_device_name(device)}")
    for name in (MODELS if args.model == "both" else [args.model]):
        smoke(name, args.image, device)
    print("SMOKE OK")


if __name__ == "__main__":
    main()

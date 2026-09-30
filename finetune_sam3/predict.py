"""Sliding-window inference of the fine-tuned SAM 3 on 2048 px tiles.

Windows of 1008 px (the model's native size) at stride 520 cover a 2048 tile in 3x3; overlapping
predictions are blended with a smooth weight so window borders leave no seams. Optional flip
test-time augmentation.

Usage (on the GPU VM):
    python predict.py --weights run1/best.pth --tiles data/images --out run1/prob [--tta]
writes <out>/<tile>.npz with `prob` = uint8 (probability * 255), shape (num_classes, H, W).
"""
from __future__ import annotations

import argparse
import glob
import os

import numpy as np
import torch

from model import CLASSES, IMG_SIZE, MEAN, STD


def _starts(n, w=IMG_SIZE, min_overlap=256):
    if n <= w:
        return [0]
    k = int(np.ceil((n - min_overlap) / (w - min_overlap)))
    return [round(i * (n - w) / (k - 1)) for i in range(k)]


def _weight(w=IMG_SIZE):
    r = np.minimum(np.arange(w) + 1, w - np.arange(w)) / (w / 4)
    r = np.clip(r, 0.05, 1.0)
    return torch.from_numpy(np.outer(r, r).astype(np.float32))


@torch.no_grad()
def predict_tile(model, img, tta=False, batch=4):
    """img: (H, W, 3) uint8 -> (C, H, W) float32 probabilities."""
    h, w = img.shape[:2]
    x = torch.from_numpy(img).cuda().permute(2, 0, 1).float().div_(255).sub_(MEAN).div_(STD)
    pad_h, pad_w = max(0, IMG_SIZE - h), max(0, IMG_SIZE - w)
    if pad_h or pad_w:
        x = torch.nn.functional.pad(x, (0, pad_w, 0, pad_h), mode="reflect")
    H, W = x.shape[1:]
    wt = _weight().cuda()
    acc = torch.zeros(len(CLASSES), H, W, device="cuda")
    norm = torch.zeros(H, W, device="cuda")
    boxes = [(y, xx) for y in _starts(H) for xx in _starts(W)]
    for i in range(0, len(boxes), batch):
        bb = boxes[i:i + batch]
        crops = torch.stack([x[:, y:y + IMG_SIZE, xx:xx + IMG_SIZE] for y, xx in bb])
        p = model(crops).float().sigmoid()
        if tta:
            p = p + model(crops.flip(-1)).float().sigmoid().flip(-1)
            p = p + model(crops.flip(-2)).float().sigmoid().flip(-2)
            p = p / 3
        for (y, xx), pi in zip(bb, p):
            acc[:, y:y + IMG_SIZE, xx:xx + IMG_SIZE] += pi * wt
            norm[y:y + IMG_SIZE, xx:xx + IMG_SIZE] += wt
    return (acc / norm)[:, :h, :w].cpu().numpy()


def main():
    import rasterio
    from model import Sam3Seg
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--weights", required=True)
    ap.add_argument("--ckpt", default=None, help="base SAM 3 checkpoint (architecture only; weights come from --weights)")
    ap.add_argument("--tiles", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--tta", action="store_true")
    ap.add_argument("--only", nargs="*", help="tile names to process (default: all)")
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    model = Sam3Seg(a.ckpt).cuda().eval()
    model.load_trained(torch.load(a.weights, map_location="cpu"))
    paths = sorted(glob.glob(f"{a.tiles}/*.tif"))
    if a.only:
        paths = [p for p in paths if os.path.basename(p)[:-4] in a.only]
    for i, p in enumerate(paths):
        with rasterio.open(p) as s:
            img = np.ascontiguousarray(s.read([1, 2, 3]).transpose(1, 2, 0))
        with torch.autocast("cuda", dtype=torch.bfloat16):
            prob = predict_tile(model, img, tta=a.tta)
        np.savez_compressed(f"{a.out}/{os.path.basename(p)[:-4]}.npz", prob=np.round(prob * 255).astype(np.uint8))
        if i % 25 == 0:
            print(f"{i + 1}/{len(paths)}", flush=True)
    print("PREDICT DONE", flush=True)


if __name__ == "__main__":
    main()

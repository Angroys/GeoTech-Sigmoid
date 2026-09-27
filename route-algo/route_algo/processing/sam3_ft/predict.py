"""Sliding-window inference on 2048 px tiles (1008 px windows, smooth blending, optional flip TTA).

Vendored from gs://marcaj-sam3-ajai-0957394607/code/ft/predict.py; made device-agnostic.
"""

from __future__ import annotations

import numpy as np
import torch

from .model import CLASSES, IMG_SIZE, MEAN, STD


def _starts(n: int, w: int = IMG_SIZE, min_overlap: int = 256) -> list[int]:
    if n <= w:
        return [0]
    k = int(np.ceil((n - min_overlap) / (w - min_overlap)))
    return [round(i * (n - w) / (k - 1)) for i in range(k)]


def _weight(w: int = IMG_SIZE) -> torch.Tensor:
    r = np.minimum(np.arange(w) + 1, w - np.arange(w)) / (w / 4)
    r = np.clip(r, 0.05, 1.0)
    return torch.from_numpy(np.outer(r, r).astype(np.float32))


@torch.no_grad()
def predict_tile(model: torch.nn.Module, img: np.ndarray, device: str, tta: bool = True, batch: int = 4) -> np.ndarray:
    """img: (H, W, 3) uint8 -> (C, H, W) float32 probabilities."""
    h, w = img.shape[:2]
    x = torch.from_numpy(img).to(device).permute(2, 0, 1).float().div_(255).sub_(MEAN).div_(STD)
    pad_h, pad_w = max(0, IMG_SIZE - h), max(0, IMG_SIZE - w)
    if pad_h or pad_w:
        x = torch.nn.functional.pad(x, (0, pad_w, 0, pad_h), mode="reflect")
    H, W = x.shape[1:]
    wt = _weight().to(device)
    acc = torch.zeros(len(CLASSES), H, W, device=device)
    norm = torch.zeros(H, W, device=device)
    boxes = [(y, xx) for y in _starts(H) for xx in _starts(W)]
    dtype = torch.bfloat16 if device.startswith("cuda") else torch.float32
    with torch.autocast(device.split(":")[0], dtype=dtype, enabled=device.startswith("cuda")):
        for i in range(0, len(boxes), batch):
            bb = boxes[i : i + batch]
            crops = torch.stack([x[:, y : y + IMG_SIZE, xx : xx + IMG_SIZE] for y, xx in bb])
            p = model(crops).float().sigmoid()
            if tta:
                p = p + model(crops.flip(-1)).float().sigmoid().flip(-1)
                p = p + model(crops.flip(-2)).float().sigmoid().flip(-2)
                p = p / 3
            for (y, xx), pi in zip(bb, p):
                acc[:, y : y + IMG_SIZE, xx : xx + IMG_SIZE] += pi * wt
                norm[y : y + IMG_SIZE, xx : xx + IMG_SIZE] += wt
    return (acc / norm)[:, :h, :w].cpu().numpy()

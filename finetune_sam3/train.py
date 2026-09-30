"""Full fine-tune of SAM 3 (model.Sam3Seg) on the Sireț3 team labels, finetune-SAM style.

Everything is trainable (ViT trunk, neck, prompt encoder, mask decoder). Training samples are
random 1008 px crops at the native 2.5 cm/px (no downscaling, rows stay visible), with rot90 /
flip / scale / mild colour jitter. Loss = BCE + soft Dice per class (sigmoid, multi-label), as in
finetune-SAM's Dice + CE. Validation every VAL_EVERY epochs runs the sliding-window predictor on
the held-out val tiles; the best mean IoU over the four submitted classes is kept. Early stop
after PATIENCE epochs without improvement (finetune-SAM uses 20).

Resumable: <out>/last.pth holds model + optimizer + epoch, so a Spot preemption restarts where
it left off. <out>/progress.jsonl gets one line per epoch (loss, val IoU, ETA).

Usage (on the GPU VM):
    python train.py --data ~/ft/data --ckpt ~/marcaj/weights/sam3/sam3.pt --out ~/ft/run1
"""
from __future__ import annotations

import argparse
import json
import math
import os
import random
import time

import cv2
import numpy as np
import rasterio
import torch
import torch.nn.functional as F
from torch.utils.data import DataLoader, Dataset

from model import CLASSES, IMG_SIZE, MEAN, STD, Sam3Seg
from predict import predict_tile

SUBMIT = [CLASSES.index(c) for c in ("vineyard", "row", "interrow_area", "waste")]
CLASS_W = torch.tensor([1.0, 1.0, 1.5, 1.0, 2.0, 1.0])
SPIKE_LOSS = 20.0          # BCE + Dice per class is ~2 at the start; far above that means divergence
POS_W = torch.tensor([4.0, 4.0, 4.0, 1.5, 8.0, 8.0])


def load_tiles(data, names):
    imgs, tgts = {}, {}
    for n in names:
        with rasterio.open(f"{data}/images/{n}.tif") as s:
            imgs[n] = np.ascontiguousarray(s.read([1, 2, 3]).transpose(1, 2, 0))
        tgts[n] = cv2.imread(f"{data}/targets/{n}.png", cv2.IMREAD_UNCHANGED)
    return imgs, tgts


class Crops(Dataset):
    def __init__(self, imgs, tgts, names, weights, n):
        self.imgs, self.tgts, self.names, self.n = imgs, tgts, names, n
        self.p = np.array(weights, np.float64) / np.sum(weights)

    def __len__(self):
        return self.n

    def __getitem__(self, i):
        rng = np.random.default_rng()
        n = self.names[rng.choice(len(self.names), p=self.p)]
        img, tgt = self.imgs[n], self.tgts[n]
        s = math.exp(rng.uniform(math.log(0.8), math.log(1.25)))
        c = min(int(round(IMG_SIZE * s)), img.shape[0])
        y, x = rng.integers(0, img.shape[0] - c + 1), rng.integers(0, img.shape[1] - c + 1)
        im, tg = img[y:y + c, x:x + c], tgt[y:y + c, x:x + c]
        if c != IMG_SIZE:
            im = cv2.resize(im, (IMG_SIZE, IMG_SIZE), interpolation=cv2.INTER_AREA if c > IMG_SIZE else cv2.INTER_LINEAR)
            tg = cv2.resize(tg, (IMG_SIZE, IMG_SIZE), interpolation=cv2.INTER_NEAREST)
        k = rng.integers(4)
        im, tg = np.rot90(im, k), np.rot90(tg, k)
        if rng.random() < 0.5:
            im, tg = im[:, ::-1], tg[:, ::-1]
        im = im.astype(np.float32) / 255.0
        im = (im - im.mean()) * rng.uniform(0.8, 1.2) + im.mean() * rng.uniform(0.85, 1.15)   # contrast, brightness
        g = im.mean(-1, keepdims=True)
        im = g + (im - g) * rng.uniform(0.8, 1.2)                                           # saturation
        im = (np.clip(im, 0, 1) - MEAN) / STD
        bits = np.stack([(tg >> b) & 1 for b in range(len(CLASSES))]).astype(np.float32)
        return torch.from_numpy(np.ascontiguousarray(im.transpose(2, 0, 1))), torch.from_numpy(bits)


def loss_fn(logits, y):
    bce = F.binary_cross_entropy_with_logits(logits, y, pos_weight=POS_W.to(y.device).view(1, -1, 1, 1),
                                             reduction="none").mean((0, 2, 3))
    p = logits.sigmoid()
    inter = (p * y).sum((0, 2, 3))
    dice = 1 - (2 * inter + 1) / (p.sum((0, 2, 3)) + y.sum((0, 2, 3)) + 1)
    w = CLASS_W.to(y.device)
    return ((bce + dice) * w).sum() / w.sum(), bce.detach(), dice.detach()


@torch.no_grad()
def evaluate(model, imgs, tgts, names):
    inter = np.zeros(len(CLASSES))
    union = np.zeros(len(CLASSES))
    for n in names:
        prob = predict_tile(model, imgs[n])
        for c in range(len(CLASSES)):
            p, t = prob[c] > 0.5, ((tgts[n] >> c) & 1).astype(bool)
            inter[c] += np.logical_and(p, t).sum()
            union[c] += np.logical_or(p, t).sum()
    iou = np.where(union > 0, inter / np.maximum(union, 1), np.nan)
    return {c: float(v) for c, v in zip(CLASSES, iou)}


def param_groups(model, lr_enc, lr_dec, wd):
    enc, dec = [], []
    for n, p in model.named_parameters():
        (enc if n.startswith("vision.trunk") else dec).append(p)
    return [{"params": enc, "lr": lr_enc, "base": lr_enc, "weight_decay": wd},
            {"params": dec, "lr": lr_dec, "base": lr_dec, "weight_decay": wd}]


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--data", required=True)
    ap.add_argument("--ckpt", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--epochs", type=int, default=50)
    ap.add_argument("--crops-per-epoch", type=int, default=600)
    ap.add_argument("--batch", type=int, default=4, help="crops per forward pass (GPU memory bound)")
    ap.add_argument("--accum", type=int, default=1, help="forward passes per optimizer step; effective batch = batch * accum")
    ap.add_argument("--lr-enc", type=float, default=2e-5)
    ap.add_argument("--lr-dec", type=float, default=3e-4)
    ap.add_argument("--wd", type=float, default=0.05)
    ap.add_argument("--warmup", type=int, default=200)
    ap.add_argument("--val-every", type=int, default=2)
    ap.add_argument("--patience", type=int, default=20)
    ap.add_argument("--empty-weight", type=float, default=0.33, help="sampling weight of an empty tile vs a labelled one")
    ap.add_argument("--waste-w", type=float, default=None, help="loss weight of the waste class (default CLASS_W, 2.0)")
    ap.add_argument("--waste-pos-w", type=float, default=None, help="BCE positive weight of waste pixels (default POS_W, 8.0)")
    ap.add_argument("--drop-classes", nargs="*", default=[], metavar="CLASS",
                    help="rare classes left out of the loss and the val score (e.g. waste dead_vine); "
                         "their output channels stay but are not trained")
    ap.add_argument("--labelled-only", action="store_true",
                    help="train and validate only on tiles that have team labels (no empty / invalid tiles)")
    ap.add_argument("--init", default="", help="start from these fine-tuned weights (e.g. an earlier run's best.pth)")
    ap.add_argument("--gcs", default="", help="copy best.pth / progress here after each validation")
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    wi = CLASSES.index("waste")
    if a.waste_w is not None:
        CLASS_W[wi] = a.waste_w
    if a.waste_pos_w is not None:
        POS_W[wi] = a.waste_pos_w
    for c in a.drop_classes:
        CLASS_W[CLASSES.index(c)] = 0.0
        if CLASSES.index(c) in SUBMIT:
            SUBMIT.remove(CLASSES.index(c))
    torch.backends.cuda.matmul.allow_tf32 = True
    torch.backends.cudnn.allow_tf32 = True
    sp = json.load(open(f"{a.data}/split.json"))
    labelled = set(sp["labelled"])
    if a.labelled_only:
        sp["train"] = [t for t in sp["train"] if t in labelled]
        sp["val"] = [t for t in sp["val"] if t in labelled]
        print(f"labelled only: {len(sp['train'])} train, {len(sp['val'])} val tiles", flush=True)
    imgs, tgts = load_tiles(a.data, sp["train"] + sp["val"] + sp["test"])
    ds = Crops(imgs, tgts, sp["train"], [1.0 if t in labelled else a.empty_weight for t in sp["train"]], a.crops_per_epoch)
    dl = DataLoader(ds, batch_size=a.batch, num_workers=12, drop_last=True, persistent_workers=True,
                    worker_init_fn=lambda i: np.random.seed((torch.initial_seed() + i) % 2**32))

    model = Sam3Seg(a.ckpt).cuda().train()
    if a.init and not os.path.exists(f"{a.out}/last.pth"):
        model.load_trained(torch.load(a.init, map_location="cpu")).train()
        print(f"initialised from {a.init}", flush=True)
    opt = torch.optim.AdamW(param_groups(model, a.lr_enc, a.lr_dec, a.wd), betas=(0.9, 0.999))
    steps_per_epoch = len(dl) // a.accum          # optimizer steps (one step = batch * accum crops)
    total = a.epochs * steps_per_epoch
    start, best, best_ep, step = 0, -1.0, -1, 0
    last = f"{a.out}/last.pth"
    if os.path.exists(last):
        st = torch.load(last, map_location="cpu", weights_only=False)
        model.load_trained(st["model"]).train()
        opt.load_state_dict(st["opt"])
        start, best, best_ep, step = st["epoch"] + 1, st["best"], st["best_ep"], st["step"]
        print(f"resumed at epoch {start}, best {best:.4f} (epoch {best_ep})", flush=True)
    json.dump(vars(a) | {"classes": CLASSES, "steps_per_epoch": steps_per_epoch,
                         "effective_batch": a.batch * a.accum}, open(f"{a.out}/args.json", "w"), indent=1)

    t_start = time.time()
    for ep in range(start, a.epochs):
        model.train()
        t0, tot, parts, skipped, n_micro = time.time(), 0.0, np.zeros((2, len(CLASSES))), 0, 0
        opt.zero_grad(set_to_none=True)
        for i, (x, y) in enumerate(dl):
            x, y = x.cuda(non_blocking=True), y.cuda(non_blocking=True)
            with torch.autocast("cuda", dtype=torch.bfloat16):
                logits = model(x)
            loss, bce, dice = loss_fn(logits.float(), y)
            if not torch.isfinite(loss) or loss.item() > SPIKE_LOSS:   # a diverging batch must not
                skipped += 1                                             # poison the weights
            else:
                (loss / a.accum).backward()
                tot += loss.item()
                parts += np.stack([bce.cpu().numpy(), dice.cpu().numpy()])
                n_micro += 1
            if (i + 1) % a.accum == 0:                                   # gradient accumulation
                f = min(1.0, (step + 1) / a.warmup) * 0.5 * (1 + math.cos(math.pi * min(1.0, step / total)))
                for g in opt.param_groups:
                    g["lr"] = g["base"] * f
                torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
                opt.step()
                opt.zero_grad(set_to_none=True)
                step += 1
        n_ok = max(1, n_micro)
        rec = {"epoch": ep, "loss": tot / n_ok, "skipped": skipped, "sec": round(time.time() - t0, 1),
               "bce": dict(zip(CLASSES, np.round(parts[0] / n_ok, 4).tolist())),
               "dice": dict(zip(CLASSES, np.round(parts[1] / n_ok, 4).tolist()))}
        if ep % a.val_every == 0 or ep == a.epochs - 1:
            model.eval()
            with torch.autocast("cuda", dtype=torch.bfloat16):
                rec["val_iou"] = evaluate(model, imgs, tgts, sp["val"])
                rec["test_iou"] = evaluate(model, imgs, tgts, sp["test"])
            score = float(np.nanmean([rec["val_iou"][CLASSES[c]] for c in SUBMIT]))
            rec["val_score"] = score
            if score > best:
                best, best_ep = score, ep
                torch.save({k: v.to(torch.bfloat16) if v.is_floating_point() else v
                            for k, v in model.state_dict().items()}, f"{a.out}/best.pth")
                rec["new_best"] = True
            torch.save({"model": model.state_dict(), "opt": opt.state_dict(), "epoch": ep, "best": best,
                        "best_ep": best_ep, "step": step}, last + ".tmp")
            os.replace(last + ".tmp", last)
        done = ep + 1 - start
        rec["eta_min"] = round((time.time() - t_start) / done * (a.epochs - ep - 1) / 60, 1)
        rec["best"], rec["best_ep"] = best, best_ep
        with open(f"{a.out}/progress.jsonl", "a") as fh:
            fh.write(json.dumps(rec) + "\n")
        print(json.dumps(rec), flush=True)
        if a.gcs and "val_iou" in rec:
            os.system(f"gcloud storage cp -q {a.out}/progress.jsonl {a.out}/args.json {a.gcs}/ >/dev/null 2>&1")
            if rec.get("new_best"):
                os.system(f"gcloud storage cp -q {a.out}/best.pth {a.gcs}/best.pth >/dev/null 2>&1")
        if ep - best_ep >= a.patience:
            print(f"early stop: no improvement since epoch {best_ep}", flush=True)
            break
    print(f"TRAINING DONE best {best:.4f} at epoch {best_ep}", flush=True)


if __name__ == "__main__":
    main()

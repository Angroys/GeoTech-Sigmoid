"""
COCO polygon-annotation preview renderer for the Riseholme vineyard dataset.

Renders existing COCO-segmentation polygon annotations onto their source images so
the labels can be eyeballed for quality. For each capture-date folder it samples a
deterministic set of annotated images across the train/valid/test splits, draws every
polygon (low-alpha fill + solid outline, coloured per category) and a class-colour
legend, then writes one preview image per source image.

CLI:
    python render_coco_previews.py [--dataset-root DIR] [--out-dir DIR]
                                   [--per-date N] [--seed N]

Defaults reproduce 60 previews (20 per capture date) under data/examples/.
Uses only json / numpy / opencv / pillow (no pycocotools). RLE (dict) and empty
segmentations are skipped without crashing. Re-runnable and idempotent (overwrites).
"""
import argparse
import json
import os
from glob import glob

import cv2
import numpy as np

# Stable BGR colour per category id (OpenCV uses BGR). Distinct, high-contrast hues.
_PALETTE_BGR = [
    (60, 76, 231),    # red        (0)
    (96, 174, 39),    # green      (1)
    (219, 152, 52),   # blue       (2)
    (34, 126, 230),   # orange     (3)
    (182, 89, 155),   # purple     (4)
    (43, 191, 241),   # yellow     (5)
    (185, 128, 41),   # teal       (6)
    (63, 63, 63),     # dark grey  (7)
]

FILL_ALPHA = 0.35
OUTLINE_THICKNESS = 2


def color_for(cat_id):
    """Return a stable BGR colour tuple for a category id."""
    return _PALETTE_BGR[cat_id % len(_PALETTE_BGR)]


def load_coco(json_path):
    """Load a COCO json and return (images_by_id, anns_by_image_id, categories_by_id)."""
    with open(json_path) as fh:
        data = json.load(fh)
    images = {img["id"]: img for img in data.get("images", [])}
    cats = {c["id"]: c for c in data.get("categories", [])}
    anns = {}
    for ann in data.get("annotations", []):
        anns.setdefault(ann["image_id"], []).append(ann)
    return images, anns, cats


def polygons_from_segmentation(seg):
    """Yield int32 (N,2) point arrays from a COCO polygon segmentation.

    Skips RLE (dict) segmentations and malformed/empty polygons robustly.
    """
    if not isinstance(seg, list):  # RLE dict or None -> not a polygon
        return
    for poly in seg:
        if not isinstance(poly, (list, tuple)) or len(poly) < 6:
            continue  # need >=3 (x,y) points
        pts = np.asarray(poly, dtype=np.float64)
        if pts.size % 2 != 0:
            pts = pts[:-1]  # drop dangling coordinate
        pts = pts.reshape(-1, 2)
        if pts.shape[0] < 3:
            continue
        yield np.round(pts).astype(np.int32)


def draw_annotations(img, anns, cats):
    """Draw filled + outlined polygons onto img (in place-ish); return present cat ids."""
    overlay = img.copy()
    present = set()
    outline_jobs = []
    for ann in anns:
        cat_id = ann.get("category_id")
        color = color_for(cat_id)
        for pts in polygons_from_segmentation(ann.get("segmentation")):
            cv2.fillPoly(overlay, [pts], color)
            outline_jobs.append((pts, color))
            present.add(cat_id)
    # Blend fills at low alpha, then draw crisp outlines on top.
    cv2.addWeighted(overlay, FILL_ALPHA, img, 1.0 - FILL_ALPHA, 0, dst=img)
    for pts, color in outline_jobs:
        cv2.polylines(img, [pts], isClosed=True, color=color,
                      thickness=OUTLINE_THICKNESS, lineType=cv2.LINE_AA)
    return present


def draw_legend(img, present_cat_ids, cats, title):
    """Draw a class-colour legend panel in the top-left corner."""
    scale = max(img.shape[1] / 1600.0, 1.0)
    font = cv2.FONT_HERSHEY_SIMPLEX
    fs = 0.6 * scale
    ft = max(int(1 * scale), 1)
    pad = int(12 * scale)
    row_h = int(30 * scale)
    swatch = int(20 * scale)

    entries = [(cid, cats.get(cid, {}).get("name", str(cid)))
               for cid in sorted(present_cat_ids)]
    lines = [title] + [name for _, name in entries]
    text_w = max(cv2.getTextSize(t, font, fs, ft)[0][0] for t in lines)
    panel_w = pad * 3 + swatch + text_w
    panel_h = pad * 2 + row_h * len(lines)

    panel = img[0:panel_h, 0:panel_w].copy()
    box = np.zeros_like(panel)
    cv2.addWeighted(box, 0.55, panel, 0.45, 0, dst=panel)
    img[0:panel_h, 0:panel_w] = panel

    y = pad + row_h - int(8 * scale)
    cv2.putText(img, title, (pad, y), font, fs, (255, 255, 255), ft, cv2.LINE_AA)
    for cid, name in entries:
        y += row_h
        top = y - swatch + int(4 * scale)
        cv2.rectangle(img, (pad, top), (pad + swatch, top + swatch),
                      color_for(cid), thickness=-1)
        cv2.rectangle(img, (pad, top), (pad + swatch, top + swatch),
                      (255, 255, 255), thickness=1)
        cv2.putText(img, name, (pad * 2 + swatch, y), font, fs,
                    (255, 255, 255), ft, cv2.LINE_AA)


def slug_for(capture_dir):
    """Derive an output slug from a capture-date folder name."""
    base = os.path.basename(capture_dir)
    base = base.replace(".coco-segmentation", "")
    if base.startswith("riseholme-"):
        base = base[len("riseholme-"):]
    return "".join(ch if ch.isalnum() else "_" for ch in base).strip("_")


def collect_annotated(capture_dir):
    """Return a list of (split, json_dir, image_meta, anns, cats) with >=1 polygon ann."""
    items = []
    for split in ("train", "valid", "test"):
        json_path = os.path.join(capture_dir, split, "_annotations.coco.json")
        if not os.path.isfile(json_path):
            continue
        images, anns_by_img, cats = load_coco(json_path)
        for img_id, meta in images.items():
            anns = anns_by_img.get(img_id, [])
            has_poly = any(
                any(True for _ in polygons_from_segmentation(a.get("segmentation")))
                for a in anns
            )
            if has_poly:
                items.append((split, os.path.join(capture_dir, split), meta, anns, cats))
    return items


def sample_across_splits(items, count, seed):
    """Deterministically pick `count` items with split variety (round-robin)."""
    rng = np.random.default_rng(seed)
    by_split = {}
    for it in items:
        by_split.setdefault(it[0], []).append(it)
    for split in by_split:
        lst = by_split[split]
        order = rng.permutation(len(lst))
        by_split[split] = [lst[i] for i in order]

    picked = []
    splits = sorted(by_split)  # stable order: test, train, valid
    idx = {s: 0 for s in splits}
    while len(picked) < count and any(idx[s] < len(by_split[s]) for s in splits):
        for s in splits:
            if idx[s] < len(by_split[s]):
                picked.append(by_split[s][idx[s]])
                idx[s] += 1
                if len(picked) >= count:
                    break
    return picked


def render_one(src_dir, meta, anns, cats, out_path, capture_title):
    """Render a single preview image and write it to out_path. Returns True on success."""
    src = os.path.join(src_dir, meta["file_name"])
    img = cv2.imread(src, cv2.IMREAD_COLOR)
    if img is None:
        print(f"  WARN could not read image, skipping: {src}")
        return False
    present = draw_annotations(img, anns, cats)
    draw_legend(img, present, cats, capture_title)
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    return bool(cv2.imwrite(out_path, img))


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--dataset-root",
                    default="data/riseholme_vineyard_2024_2025_19234907/dataset",
                    help="Root holding the *.coco-segmentation capture-date folders.")
    ap.add_argument("--out-dir", default="data/examples",
                    help="Output directory for preview images (default: data/examples).")
    ap.add_argument("--per-date", type=int, default=20,
                    help="Number of preview images per capture date (default: 20).")
    ap.add_argument("--seed", type=int, default=42,
                    help="Random seed for deterministic sampling (default: 42).")
    args = ap.parse_args()

    capture_dirs = sorted(
        d for d in glob(os.path.join(args.dataset_root, "*.coco-segmentation"))
        if os.path.isdir(d) and ".ipynb_checkpoints" not in d
    )
    if not capture_dirs:
        raise SystemExit(f"No *.coco-segmentation folders under {args.dataset_root}")

    total = 0
    for capture_dir in capture_dirs:
        slug = slug_for(capture_dir)
        title = os.path.basename(capture_dir).replace(".coco-segmentation", "")
        out_sub = os.path.join(args.out_dir, f"riseholme_{slug}")
        print(f"== {title}  ->  {out_sub}")

        items = collect_annotated(capture_dir)
        print(f"  {len(items)} annotated images available")
        picked = sample_across_splits(items, args.per_date, args.seed)
        if len(picked) < args.per_date:
            print(f"  WARN only {len(picked)} annotated images (< {args.per_date})")

        written = 0
        for split, src_dir, meta, anns, cats in picked:
            name = os.path.splitext(os.path.basename(meta["file_name"]))[0]
            out_path = os.path.join(out_sub, f"{name}.jpg")
            if render_one(src_dir, meta, anns, cats, out_path, title):
                written += 1
        print(f"  wrote {written} previews")
        total += written

    print(f"\nDONE: {total} preview images written under {args.out_dir}")


if __name__ == "__main__":
    main()

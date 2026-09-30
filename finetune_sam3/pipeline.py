"""End-to-end: GeoTIFF tiles -> fine-tuned SAM 3 -> challenge polygons (CVAT 1.1) -> checked ZIPs.

Stages (each is skipped when its output already exists, so a rerun resumes):

  1. trees      tree crowns with SAM 3 "tree" prompts (trees_sam3.py), or --trees <geojson>, or --no-trees
  2. predict    sliding-window fine-tuned SAM 3 over every tile (predict.py) -> per-tile probability maps
  3. vectorize  probability maps -> per-tile GeoJSON in the team label schema (vectorize.py):
                one polygon per plant, one straight line per row, one inter-row per row gap, waste
                boxes; only inside the vineyard parcels, never inside tree crowns
  4. finalize   site-wide row / block IDs, row lines through gaps but cut under trees, CVAT 1.1
                annotations.xml per part + ZIPs of the untouched tiles (finalize_cvat.py)
  5. verify     the package against the challenge rules (label names/types, one <image> per tile,
                coordinates inside the image, ZIP size)

Classes the model was not trained on (args.json next to the weights, --drop-classes) are switched off
in stage 3, so an untrained channel can never produce objects.

Usage (on a GPU machine with SAM 3 / samgeo installed):
    python finetune_sam3/pipeline.py --tiles dataset/images --weights run5/best.pth \
        --ckpt ~/marcaj/weights/sam3/sam3.pt --parcels parcels_v2_edited.geojson --out out/run5_pipeline
"""
from __future__ import annotations

import argparse
import glob
import json
import os
import subprocess
import sys
import xml.etree.ElementTree as ET
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
REQUIRED_LABELS = {"vineyard": "polygon", "waste": "rectangle", "row": "polyline", "interrow_area": "polygon"}
XML_TAG = {"polygon": "polygon", "rectangle": "box", "polyline": "polyline"}
ZIP_MAX_MB = 90


def run(step, args):
    print(f"=== {step}: {' '.join(args)}", flush=True)
    subprocess.run([sys.executable, os.path.join(HERE, args[0])] + args[1:], check=True)


def stage_tiles(a):
    """With --only, work on a folder of links to just those tiles (finalize packs every tile it sees)."""
    if not a.only:
        return os.path.abspath(a.tiles)
    d = os.path.join(a.out, "tiles")
    os.makedirs(d, exist_ok=True)
    for n in a.only:
        src = os.path.abspath(os.path.join(a.tiles, f"{n}.tif"))
        dst = os.path.join(d, f"{n}.tif")
        if not os.path.exists(dst):
            os.symlink(src, dst)
    return d


def dropped_classes(a):
    if a.drop_classes is not None:
        return a.drop_classes
    f = os.path.join(os.path.dirname(os.path.abspath(a.weights)), "args.json")
    return json.load(open(f)).get("drop_classes", []) if os.path.exists(f) else []


def verify(out, tiles):
    """Check the CVAT package against the challenge rules; returns a list of problems (empty = OK)."""
    problems, seen = [], set()
    names = {os.path.basename(p) for p in glob.glob(f"{tiles}/*.tif")}
    parts = sorted(glob.glob(f"{out}/final/cvat/part*/annotations.xml"))
    if not parts:
        return ["no annotations.xml written"]
    counts = {k: 0 for k in REQUIRED_LABELS}
    for x in parts:
        root = ET.parse(x).getroot()
        labels = {l.findtext("name"): l.findtext("type") for l in root.iter("label")}
        if labels != REQUIRED_LABELS:
            problems.append(f"{x}: label config {labels} != {REQUIRED_LABELS}")
        for img in root.iter("image"):
            n, w, h = img.get("name"), float(img.get("width")), float(img.get("height"))
            if n in seen:
                problems.append(f"{n} appears twice")
            seen.add(n)
            for el in img:
                lab = el.get("label")
                if lab not in REQUIRED_LABELS or el.tag != XML_TAG[REQUIRED_LABELS[lab]]:
                    problems.append(f"{n}: <{el.tag} label={lab}> not allowed")
                    continue
                counts[lab] += 1
                if el.tag == "box":
                    xs = [float(el.get("xtl")), float(el.get("xbr"))]
                    ys = [float(el.get("ytl")), float(el.get("ybr"))]
                else:
                    pts = [tuple(map(float, p.split(","))) for p in el.get("points").split(";")]
                    xs, ys = [p[0] for p in pts], [p[1] for p in pts]
                    if len(pts) < (3 if el.tag == "polygon" else 2):
                        problems.append(f"{n}: {lab} with {len(pts)} points")
                if min(xs) < 0 or min(ys) < 0 or max(xs) > w or max(ys) > h:
                    problems.append(f"{n}: {lab} outside the image")
    missing = names - seen
    if missing:
        problems.append(f"{len(missing)} tiles without an <image>: {sorted(missing)[:5]}")
    for z in sorted(glob.glob(f"{out}/final/cvat/*.zip")):
        mb = os.path.getsize(z) / 2 ** 20
        if mb >= ZIP_MAX_MB:
            problems.append(f"{z}: {mb:.1f} MB >= {ZIP_MAX_MB} MB")
        with zipfile.ZipFile(z) as zf:
            if "annotations.xml" not in zf.namelist():
                problems.append(f"{z}: no annotations.xml")
    print(f"verify: {len(seen)} images in {len(parts)} parts, objects {counts}", flush=True)
    return problems


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--tiles", required=True, help="folder of input GeoTIFF tiles")
    ap.add_argument("--weights", required=True, help="fine-tuned weights (best.pth from train.py)")
    ap.add_argument("--ckpt", default=None, help="base SAM 3 checkpoint (sam3.pt), architecture only")
    ap.add_argument("--parcels", required=True, help="vineyard parcel outlines (GeoJSON, EPSG:32635)")
    ap.add_argument("--out", required=True)
    tr = ap.add_mutually_exclusive_group()
    tr.add_argument("--trees", default="", help="existing tree-crown GeoJSON (skips tree detection)")
    tr.add_argument("--no-trees", action="store_true", help="do not mask tree crowns")
    ap.add_argument("--drop-classes", nargs="*", default=None,
                    help="classes to switch off (default: the drop_classes the weights were trained with)")
    ap.add_argument("--no-tta", action="store_true", help="skip flip test-time augmentation (3x faster)")
    ap.add_argument("--no-zip", action="store_true")
    ap.add_argument("--only", nargs="*", help="process only these tile names (quick test)")
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    tiles = stage_tiles(a)

    trees = a.trees
    if not a.no_trees and not trees:
        trees = os.path.join(a.out, "trees", "trees.geojson")
        if not os.path.exists(trees):
            run("trees", ["trees_sam3.py", "--tiles", tiles, "--out", os.path.dirname(trees)])

    prob = os.path.join(a.out, "prob")
    n_tiles = len(glob.glob(f"{tiles}/*.tif"))
    if len(glob.glob(f"{prob}/*.npz")) < n_tiles:
        cmd = ["predict.py", "--weights", a.weights, "--tiles", tiles, "--out", prob]
        if a.ckpt:
            cmd += ["--ckpt", a.ckpt]
        if not a.no_tta:
            cmd.append("--tta")
        run("predict", cmd)

    raw = os.path.join(a.out, "labels_raw")
    if len(glob.glob(f"{raw}/*.geojson")) < n_tiles:
        off = [f"T.{c}=2" for c in dropped_classes(a)]           # threshold > 1: never fires
        cmd = ["vectorize.py", "--prob", prob, "--tiles", tiles, "--parcels", a.parcels, "--out", raw]
        if trees and not a.no_trees:
            cmd += ["--trees", trees]
        if off:
            cmd += ["--set"] + off
        run("vectorize", cmd)

    final = os.path.join(a.out, "final")
    if not os.path.exists(os.path.join(final, "summary.json")):
        cmd = ["finalize_cvat.py", "--labels", raw, "--tiles", tiles, "--out", final]
        if trees and not a.no_trees:
            cmd += ["--trees", trees]
        if a.no_zip:
            cmd.append("--no-zip")
        run("finalize", cmd)

    problems = verify(a.out, tiles)
    json.dump({"problems": problems, "summary": json.load(open(os.path.join(final, "summary.json")))},
              open(os.path.join(a.out, "pipeline_report.json"), "w"), indent=1)
    if problems:
        print("VERIFY FAILED:\n  " + "\n  ".join(problems[:20]), flush=True)
        sys.exit(1)
    print(f"PIPELINE OK -> {final}/cvat", flush=True)


if __name__ == "__main__":
    main()

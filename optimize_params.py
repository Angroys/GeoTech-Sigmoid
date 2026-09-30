"""Bayesian (Optuna TPE) parameter search for the row-guided SAM 3 labeller (pseudo_labels.py).

The labeller's own parameters were hand-tuned. This script instead searches them against the
organiser's two annotated example tiles (05_examples, CVAT) and then labels all 311 tiles with the
best set. pseudo_labels.py / vines_v2.py are used unmodified: parameters are injected by wrapping
their module-level functions.

Stages
  sam     SAM 3 canopy evidence for the example tiles (+ neighbours), one cache per
          (prompt, confidence) pair — the only GPU part of the search.
  search  N parallel worker processes share one Optuna journal; each trial labels both example
          tiles and scores them against the CVAT ground truth.
  full    Best trial -> SAM 3 over the whole mosaic -> every tile labelled in a process pool.

Objective (weights follow the scoring split: canopies and inter-rows/rows feed separate scores)
  0.5 * canopy  (0.6 * instance F1 @ IoU 0.5 + 0.4 * canopy-union IoU)
  0.3 * row F1  (a match needs >= 80 % of each line within 0.4 m of the other)
  0.2 * inter-row union IoU
Caveat: two tiles are a calibration set, not an independent test set (plan section 2).

Usage (run in a folder containing pseudo_labels.py, vines_v2.py and data/marcaj-data/...):
    python optimize_params.py sam
    python optimize_params.py search --trials 240 --workers 24
    python optimize_params.py full --workers 40 --out final
"""
from __future__ import annotations

import argparse
import functools
import glob
import json
import multiprocessing as mp
import os
import shutil
import sys
import tempfile
import time
import xml.etree.ElementTree as ET

import numpy as np
import rasterio
from shapely.geometry import LineString, Polygon
from shapely.ops import unary_union
from shapely.strtree import STRtree

import pseudo_labels as pl

EX_DIR = "data/marcaj-data/assets_for_participants/05_examples/siret3_examples_cvat"
SAM_PROMPTS = ["small green plant", "vine plant", "green shrub"]
SAM_CONFS = [0.1, 0.2, 0.3]
PX_M = pl.PX
ROW_TOL_PX = 0.4 / PX_M
STUDY = "row_guided_sam3"
JOURNAL = "optuna_journal.log"


# ---------------------------------------------------------------- ground truth
def load_gt(xml_path=f"{EX_DIR}/annotations.xml"):
    """{tile_name: {"vineyard": [Polygon], "row": [LineString], "interrow_area": [Polygon]}} in tile px."""
    gt = {}
    for img in ET.parse(xml_path).getroot().iter("image"):
        name = os.path.splitext(img.get("name"))[0]
        d = {"vineyard": [], "row": [], "interrow_area": []}
        for el in img:
            pts = [tuple(map(float, p.split(","))) for p in el.get("points", "").split(";") if p]
            lab = el.get("label")
            if el.tag == "polygon" and lab in d and len(pts) >= 3:
                d[lab].append(Polygon(pts).buffer(0))
            elif el.tag == "polyline" and lab == "row" and len(pts) >= 2:
                d["row"].append(LineString(pts))
        gt[name] = d
    return gt


def load_pred(geojson, tile_path):
    """Predicted features converted from EPSG:32635 to this tile's pixel grid."""
    import geopandas as gpd
    from shapely.affinity import affine_transform
    d = {"vineyard": [], "row": [], "interrow_area": []}
    if not os.path.exists(geojson):
        return d
    with rasterio.open(tile_path) as src:
        inv = ~src.transform
    m = [inv.a, inv.b, inv.d, inv.e, inv.c, inv.f]
    for lab, geom in zip(*gpd.read_file(geojson)[["label", "geometry"]].values.T):
        if lab in d and geom is not None:
            d[lab].append(affine_transform(geom, m))
    return d


# ---------------------------------------------------------------- metrics
def instance_f1(pred, gt, thr=0.5):
    if not pred or not gt:
        return 0.0
    tree, used, tp = STRtree(gt), set(), 0
    for p in sorted(pred, key=lambda g: -g.area):
        best, bi = 0.0, None
        for i in tree.query(p):
            if i in used:
                continue
            u = p.union(gt[i]).area
            iou = p.intersection(gt[i]).area / u if u else 0.0
            if iou > best:
                best, bi = iou, i
        if best >= thr:
            used.add(bi)
            tp += 1
    return 2 * tp / (len(pred) + len(gt))


def union_iou(pred, gt):
    if not pred and not gt:
        return 1.0
    a, b = unary_union(pred) if pred else Polygon(), unary_union(gt) if gt else Polygon()
    u = a.union(b).area
    return a.intersection(b).area / u if u else 0.0


def row_f1(pred, gt, tol=ROW_TOL_PX, frac=0.8):
    if not pred or not gt:
        return 0.0
    used, tp = set(), 0
    for p in pred:
        for i, g in enumerate(gt):
            if i in used or p.length == 0 or g.length == 0:
                continue
            if (p.intersection(g.buffer(tol)).length >= frac * p.length
                    and g.intersection(p.buffer(tol)).length >= frac * g.length):
                used.add(i)
                tp += 1
                break
    return 2 * tp / (len(pred) + len(gt))


def score_tile(pred, gt, min_plant_px):
    vines = [g for g in pred["vineyard"] if g.area >= min_plant_px]
    f1 = instance_f1(vines, gt["vineyard"])
    ciou = union_iou(vines, gt["vineyard"])
    rf1 = row_f1(pred["row"], gt["row"])
    iiou = union_iou(pred["interrow_area"], gt["interrow_area"])
    total = 0.5 * (0.6 * f1 + 0.4 * ciou) + 0.3 * rf1 + 0.2 * iiou
    return {"total": total, "canopy_f1": f1, "canopy_iou": ciou, "row_f1": rf1, "interrow_iou": iiou,
            "n_vines": len(vines), "n_gt_vines": len(gt["vineyard"])}


# ---------------------------------------------------------------- parameter injection
_ORIG = {n: getattr(pl, n) for n in ("split_plants", "row_axes", "interrow_polygons", "merge_collinear",
                                     "row_field")}


def apply_params(p):
    """Rebind pl's module-level functions so label_tile() uses the trial's parameters."""
    pl.split_plants = functools.partial(
        _ORIG["split_plants"], gap_m=p["gap_m"], min_len=p["min_len"], max_len=p["max_len"],
        plant_len=p["plant_len"], valley=p["valley"], min_area=p["min_area"])
    # disrupted_gap_m is fixed at 5 m by the annotation rules; only the split/check gaps are searched.
    pl.row_axes = functools.partial(_ORIG["row_axes"], split_gap_m=p["split_gap_m"],
                                    disrupted_gap_m=5.0, check_gap_m=p["check_gap_m"])
    pl.interrow_polygons = functools.partial(_ORIG["interrow_polygons"],
                                             spacing=(p["ir_min_spacing"], p["ir_max_spacing"]),
                                             max_angle_deg=p["ir_max_angle"], min_overlap_m=p["ir_min_overlap"])
    pl.merge_collinear = functools.partial(_ORIG["merge_collinear"], max_gap_m=p["merge_gap_m"],
                                           max_off_m=p["merge_off_m"], max_angle_deg=p["merge_angle"])
    gain = p["row_gain"]
    rf = functools.partial(_ORIG["row_field"], min_snr=p["min_snr"])
    pl.row_field = lambda *a, **k: rf(*a, **k) * gain   # label_tile thresholds rf at 0.3 / 0.6


def suggest(trial):
    return {
        "sam_prompt": trial.suggest_categorical("sam_prompt", SAM_PROMPTS),
        "sam_conf": trial.suggest_categorical("sam_conf", SAM_CONFS),
        "gap_m": trial.suggest_float("gap_m", 0.15, 0.45),
        "min_len": trial.suggest_float("min_len", 0.35, 0.9),
        "max_len": trial.suggest_float("max_len", 1.4, 2.4),
        "plant_len": trial.suggest_float("plant_len", 1.0, 1.5),
        "valley": trial.suggest_float("valley", 0.4, 0.85),
        "min_area": trial.suggest_float("min_area", 0.02, 0.2),
        "min_plant_m2": trial.suggest_float("min_plant_m2", 0.0, 0.25),
        "split_gap_m": trial.suggest_float("split_gap_m", 8.0, 40.0, log=True),
        "check_gap_m": trial.suggest_float("check_gap_m", 1.0, 2.5),
        "ir_min_spacing": trial.suggest_float("ir_min_spacing", 1.4, 2.2),
        "ir_max_spacing": trial.suggest_float("ir_max_spacing", 3.0, 4.5),
        "ir_max_angle": trial.suggest_float("ir_max_angle", 3.0, 12.0),
        "ir_min_overlap": trial.suggest_float("ir_min_overlap", 0.5, 3.0),
        "merge_gap_m": trial.suggest_float("merge_gap_m", 5.0, 40.0, log=True),
        "merge_off_m": trial.suggest_float("merge_off_m", 0.1, 0.6),
        "merge_angle": trial.suggest_float("merge_angle", 1.0, 6.0),
        "min_snr": trial.suggest_float("min_snr", 2.0, 7.0),
        "row_gain": trial.suggest_float("row_gain", 0.7, 1.4),
    }


BASELINE = {"sam_prompt": "small green plant", "sam_conf": 0.2, "gap_m": 0.25, "min_len": 0.5,
            "max_len": 1.8, "plant_len": 1.25, "valley": 0.6, "min_area": 0.02, "min_plant_m2": 0.0,
            "split_gap_m": 10.0, "check_gap_m": 1.5, "ir_min_spacing": 1.6, "ir_max_spacing": 3.8,
            "ir_max_angle": 8.0, "ir_min_overlap": 1.0, "merge_gap_m": 10.0, "merge_off_m": 0.3,
            "merge_angle": 3.0, "min_snr": 4.0, "row_gain": 1.0}


# ---------------------------------------------------------------- stages
def tiles():
    return sorted(glob.glob(os.path.join(pl.TILES_DIR, "*.tif")))


def cache_dir(prompt, conf):
    return f"opt/sam_{prompt.replace(' ', '_')}_{conf}"


def stage_sam(_a):
    paths = tiles()
    mosaic = pl.Mosaic(paths)
    ex = [p for p in paths if os.path.splitext(os.path.basename(p))[0] in load_gt()]
    waste_prompts = pl.WASTE_PROMPTS
    pl.WASTE_PROMPTS = []                        # the examples contain no waste; skip those passes
    for prompt in SAM_PROMPTS:
        for conf in SAM_CONFS:
            c = cache_dir(prompt, conf)
            if os.path.exists(f"{c}/waste.json"):
                continue
            pl.CANOPY_PROMPT = prompt
            print(f"SAM cache: prompt={prompt!r} conf={conf}", flush=True)
            pl.sam_phase(mosaic, ex, c, conf)
    pl.WASTE_PROMPTS = waste_prompts


def evaluate(p, gt, paths, mosaic):
    apply_params(p)
    ev_paths = glob.glob(f"{cache_dir(p['sam_prompt'], p['sam_conf'])}/ev_*.tif")
    ev = pl.Mosaic(ev_paths, bands=(1,), origin=(mosaic.x0, mosaic.y0)) if ev_paths else None
    out = tempfile.mkdtemp(prefix="trial_")
    try:
        per = {}
        for path in paths:
            name = os.path.splitext(os.path.basename(path))[0]
            pl.label_tile(path, mosaic, ev, [], out, p["sam_conf"])
            per[name] = score_tile(load_pred(f"{out}/{name}__labels.geojson", path), gt[name],
                                   p["min_plant_m2"] / PX_M ** 2)
        return per
    finally:
        shutil.rmtree(out, ignore_errors=True)


def _search_worker(n_trials, seed):
    import optuna
    from optuna.storages import JournalStorage
    from optuna.storages.journal import JournalFileBackend
    optuna.logging.set_verbosity(optuna.logging.WARNING)
    storage = JournalStorage(JournalFileBackend(JOURNAL))
    study = optuna.load_study(study_name=STUDY, storage=storage,
                              sampler=optuna.samplers.TPESampler(multivariate=True, group=True,
                                                                 n_startup_trials=30, seed=seed))
    gt, all_paths = load_gt(), tiles()
    mosaic = pl.Mosaic(all_paths)
    paths = [p for p in all_paths if os.path.splitext(os.path.basename(p))[0] in gt]

    def objective(trial):
        per = evaluate(suggest(trial), gt, paths, mosaic)
        for name, s in per.items():
            for k, v in s.items():
                trial.set_user_attr(f"{name}.{k}", v)
        return float(np.mean([s["total"] for s in per.values()]))

    study.optimize(objective, n_trials=n_trials)


def stage_search(a):
    import optuna
    from optuna.storages import JournalStorage
    from optuna.storages.journal import JournalFileBackend
    storage = JournalStorage(JournalFileBackend(JOURNAL))
    study = optuna.create_study(study_name=STUDY, storage=storage, direction="maximize",
                                load_if_exists=True)
    if not study.trials:
        study.enqueue_trial(BASELINE)            # trial 0 = the hand-tuned defaults, for reference
    per = max(1, a.trials // a.workers)
    t0 = time.time()
    procs = [mp.get_context("fork").Process(target=_search_worker, args=(per, 1000 + i))
             for i in range(a.workers)]
    for p in procs:
        p.start()
    for p in procs:
        p.join()
    study = optuna.load_study(study_name=STUDY, storage=storage)
    done = [t for t in study.trials if t.value is not None]
    base = next((t for t in done if t.number == 0), None)
    best = study.best_trial
    report = {"trials": len(done), "minutes": round((time.time() - t0) / 60, 1),
              "objective": "0.5*(0.6*F1@0.5+0.4*canopyIoU)+0.3*rowF1+0.2*interrowIoU, mean of 2 example tiles",
              "baseline_value": base.value if base else None, "baseline_attrs": base.user_attrs if base else None,
              "best_value": best.value, "best_trial": best.number, "best_params": best.params,
              "best_attrs": best.user_attrs,
              "top10": [{"n": t.number, "value": t.value, "params": t.params}
                        for t in sorted(done, key=lambda t: -t.value)[:10]]}
    json.dump(report, open("opt/best_params.json", "w"), indent=2)
    print(json.dumps({k: report[k] for k in ("trials", "minutes", "baseline_value", "best_value",
                                             "best_params")}, indent=2))


_FULL = {}


def _label_one(path):
    try:
        return pl.label_tile(path, _FULL["mosaic"], _FULL["ev"], _FULL["waste"], _FULL["out"], _FULL["conf"])
    except Exception as e:  # keep going; report the tile
        return {"tile": os.path.basename(path), "error": repr(e)}


def stage_full(a):
    p = json.load(open("opt/best_params.json"))["best_params"]
    paths = tiles()
    mosaic = pl.Mosaic(paths)
    cache = "opt/sam_full"
    if not os.path.exists(f"{cache}/waste.json"):
        pl.CANOPY_PROMPT = p["sam_prompt"]
        print(f"phase 1: SAM 3 over the whole mosaic, prompt={p['sam_prompt']!r} conf={p['sam_conf']}", flush=True)
        pl.sam_phase(mosaic, paths, cache, p["sam_conf"])
    apply_params(p)
    ev = pl.Mosaic(glob.glob(f"{cache}/ev_*.tif"), bands=(1,), origin=(mosaic.x0, mosaic.y0))
    os.makedirs(a.out, exist_ok=True)
    _FULL.update(mosaic=mosaic, ev=ev, waste=json.load(open(f"{cache}/waste.json")), out=a.out,
                 conf=p["sam_conf"])
    print(f"phase 2: {len(paths)} tiles, {a.workers} processes", flush=True)
    summary = []
    with mp.get_context("fork").Pool(a.workers) as pool:
        for i, r in enumerate(pool.imap_unordered(_label_one, paths), 1):
            summary.append(r)
            print(f"[{i}/{len(paths)}] {r}", flush=True)
    min_px = p["min_plant_m2"]
    json.dump({"classes": {**pl.CLASSES, pl.VOID: "void/ignore"}, "params": p,
               "note": f"vineyard polygons < {min_px:.3f} m2 are dropped by the scorer only",
               "tiles": sorted(summary, key=lambda r: r["tile"])},
              open(f"{a.out}/summary.json", "w"), indent=2)


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("stage", choices=["sam", "search", "full", "baseline"])
    ap.add_argument("--trials", type=int, default=240)
    ap.add_argument("--workers", type=int, default=24)
    ap.add_argument("--out", default="final")
    a = ap.parse_args(argv)
    os.makedirs("opt", exist_ok=True)
    if a.stage == "baseline":                    # quick sanity check: hand-tuned defaults vs GT
        gt, all_paths = load_gt(), tiles()
        mosaic = pl.Mosaic(all_paths)
        paths = [p for p in all_paths if os.path.splitext(os.path.basename(p))[0] in gt]
        print(json.dumps(evaluate(BASELINE, gt, paths, mosaic), indent=2))
        return 0
    {"sam": stage_sam, "search": stage_search, "full": stage_full}[a.stage](a)
    return 0


if __name__ == "__main__":
    sys.exit(main())

"""Optuna search for vine_labeler.py (v3): GT accuracy + vineyard coverage.

optimize_params.py tuned pseudo_labels' own parameters on the two annotated example tiles only.
v3 adds the vine_labeler stages (leaf detector, canopy joining/smoothing, row snapping/insertion,
row extension) and a coverage term, so the search is rewarded for segmenting MORE of the vineyard,
not just for matching the two example tiles:

  objective = GT score (optimize_params.score_tile, mean of the 2 example tiles)
            + COVER_W * mean (inter-row + vine) coverage inside SAM 3 vineyard parcels on sampled tiles

SAM 3 settings are fixed to the previous best (one full-mosaic cache, --sam-cache).

Usage (folder with pseudo_labels.py, vine_labeler.py, optimize_params.py, data/...):
    python optimize_v3.py search --sam-cache opt/sam_full --parcels parcels_10cm.tif \
        --base best_params.json --trials 160 --workers 32
"""
from __future__ import annotations

import argparse
import glob
import json
import multiprocessing as mp
import os
import shutil
import tempfile
import time

import numpy as np
import rasterio
from rasterio.warp import Resampling, reproject

import optimize_params as o
import pseudo_labels as pl
import vine_labeler as vl

STUDY = "vine_labeler_v3"
JOURNAL = "optuna_v3.log"
COVER_W = 0.15
N_COVER_TILES = 8

VL_KNOBS = {  # name: (low, high, log)
    "LEAF_T_SCALE": (0.6, 1.3, False),
    "LEAF_V_MIN": (0.12, 0.35, False),
    "LEAF_EV_THR": (0.2, 0.6, False),
    "LEAF_EV_FRAC": (0.2, 0.9, False),
    "SHADOW_TOUCH_M": (0.2, 1.2, False),
    "CONNECT_M": (0.0, 1.0, False),
    "SMOOTH_M": (0.0, 0.15, False),
    "SNAP_MAX_M": (0.6, 1.8, False),
    "FILL_MIN_EVIDENCE": (0.2, 0.9, False),
    "EXT_MAX_GAP_M": (0.8, 3.0, False),
}


def apply_all(p):
    o.apply_params(p)
    for k in VL_KNOBS:
        if k in p:
            setattr(vl, k, p[k])


def suggest(trial, base):
    p = o.suggest(trial)
    p["sam_prompt"], p["sam_conf"] = base["sam_prompt"], base["sam_conf"]   # fixed: one SAM cache
    for k, (lo, hi, lg) in VL_KNOBS.items():
        p[k] = trial.suggest_float(k, lo, hi, log=lg)
    return p


def parcel_cover(label_tif, parcels):
    with rasterio.open(label_tif) as s:
        sem = s.read(1, out_shape=(512, 512), resampling=Resampling.nearest)
        tr = s.transform * s.transform.scale(4, 4)
        par = np.zeros((512, 512), np.uint8)
        reproject(rasterio.band(parcels, 1), par, dst_transform=tr, dst_crs=s.crs, resampling=Resampling.nearest)
    pm = par > 0
    # vines are drawn over the inter-row, so count both: fuller canopies must not look like a loss
    return float((((sem == pl.INTERROW) | (sem == pl.VINE)) & pm).sum() / max(pm.sum(), 1))


def pick_cover_tiles(paths, parcels_path, n=N_COVER_TILES, seed=0):
    """Tiles mostly inside parcels, excluding the GT tiles; spread over the site."""
    P = rasterio.open(parcels_path)
    cand = []
    for p in paths:
        with rasterio.open(p) as s:
            par = np.zeros((64, 64), np.uint8)
            reproject(rasterio.band(P, 1), par, dst_transform=s.transform * s.transform.scale(32, 32),
                      dst_crs=s.crs, resampling=Resampling.nearest)
        if (par > 0).mean() > 0.5:
            cand.append(p)
    gt = o.load_gt()
    cand = [p for p in cand if os.path.basename(p)[:-4] not in gt]
    idx = np.linspace(0, len(cand) - 1, min(n, len(cand))).round().astype(int)
    return [cand[i] for i in idx]


def _worker(n_trials, seed, a):
    import optuna
    from optuna.storages import JournalStorage
    from optuna.storages.journal import JournalFileBackend
    optuna.logging.set_verbosity(optuna.logging.WARNING)
    study = optuna.load_study(study_name=STUDY, storage=JournalStorage(JournalFileBackend(JOURNAL)),
                              sampler=optuna.samplers.TPESampler(multivariate=True, group=True,
                                                                 n_startup_trials=24, seed=seed))
    base = json.load(open(a.base))["best_params"]
    gt, paths = o.load_gt(), sorted(glob.glob(os.path.join(pl.TILES_DIR, "*.tif")))
    mosaic = pl.Mosaic(paths)
    ev = pl.Mosaic(glob.glob(f"{a.sam_cache}/ev_*.tif"), bands=(1,), origin=(mosaic.x0, mosaic.y0))
    ex = [p for p in paths if os.path.basename(p)[:-4] in gt]
    cover_tiles = json.load(open("opt/v3_cover_tiles.json"))
    parcels = rasterio.open(a.parcels)

    def objective(trial):
        p = suggest(trial, base)
        apply_all(p)
        d = tempfile.mkdtemp(prefix="v3_")
        try:
            gts = []
            for path in ex:
                n = os.path.basename(path)[:-4]
                vl.label_tile(path, mosaic, ev, [], d, p["sam_conf"], 0.0)
                s = o.score_tile(o.load_pred(f"{d}/{n}__labels.geojson", path), gt[n], p["min_plant_m2"] / o.PX_M ** 2)
                gts.append(s["total"])
                for k, v in s.items():
                    trial.set_user_attr(f"{n}.{k}", v)
            covs = []
            for path in cover_tiles:
                vl.label_tile(path, mosaic, ev, [], d, p["sam_conf"], p["min_plant_m2"])
                covs.append(parcel_cover(f"{d}/{os.path.basename(path)[:-4]}__labels.tif", parcels))
            trial.set_user_attr("gt_score", float(np.mean(gts)))
            trial.set_user_attr("parcel_cover", float(np.mean(covs)))
            return float(np.mean(gts) + COVER_W * np.mean(covs))
        finally:
            shutil.rmtree(d, ignore_errors=True)

    study.optimize(objective, n_trials=n_trials)


def main(argv=None):
    import optuna
    from optuna.storages import JournalStorage
    from optuna.storages.journal import JournalFileBackend
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("stage", choices=["search"])
    ap.add_argument("--sam-cache", required=True)
    ap.add_argument("--parcels", required=True)
    ap.add_argument("--base", default="best_params.json")
    ap.add_argument("--trials", type=int, default=160)
    ap.add_argument("--workers", type=int, default=32)
    a = ap.parse_args(argv)
    os.makedirs("opt", exist_ok=True)
    paths = sorted(glob.glob(os.path.join(pl.TILES_DIR, "*.tif")))
    if not os.path.exists("opt/v3_cover_tiles.json"):
        json.dump(pick_cover_tiles(paths, a.parcels), open("opt/v3_cover_tiles.json", "w"))
    print("coverage tiles:", [os.path.basename(p) for p in json.load(open("opt/v3_cover_tiles.json"))], flush=True)
    storage = JournalStorage(JournalFileBackend(JOURNAL))
    study = optuna.create_study(study_name=STUDY, storage=storage, direction="maximize", load_if_exists=True)
    if not study.trials:  # trial 0 = the v3 defaults
        base = json.load(open(a.base))["best_params"]
        study.enqueue_trial({**{k: v for k, v in base.items() if k not in ("sam_prompt", "sam_conf")},
                             **{k: getattr(vl, k) for k in VL_KNOBS}})
    t0 = time.time()
    per = max(1, a.trials // a.workers)
    procs = [mp.get_context("fork").Process(target=_worker, args=(per, 2000 + i, a)) for i in range(a.workers)]
    for p in procs:
        p.start()
    for p in procs:
        p.join()
    study = optuna.load_study(study_name=STUDY, storage=storage)
    done = [t for t in study.trials if t.value is not None]
    b0 = next((t for t in done if t.number == 0), None)
    best = study.best_trial
    rep = {"trials": len(done), "minutes": round((time.time() - t0) / 60, 1),
           "objective": f"GT score + {COVER_W} * (inter-row + vine) coverage inside parcels ({N_COVER_TILES} tiles)",
           "baseline": {"value": b0.value, **{k: b0.user_attrs.get(k) for k in ("gt_score", "parcel_cover")}} if b0 else None,
           "best": {"value": best.value, "trial": best.number,
                    **{k: best.user_attrs.get(k) for k in ("gt_score", "parcel_cover")}},
           "best_params": {**json.load(open(a.base))["best_params"],
                           **{k: v for k, v in best.params.items() if k not in ("sam_prompt", "sam_conf")}},
           "best_attrs": best.user_attrs}
    json.dump(rep, open("opt/best_params_v3.json", "w"), indent=2)
    print(json.dumps({k: rep[k] for k in ("trials", "minutes", "baseline", "best")}, indent=2))


if __name__ == "__main__":
    main()

# GeoTech-Sigmoid — Project Overview

*Hackathon project — UAV / geospatial vineyard analysis. This document summarizes the
project goal, the assembled datasets, the modeling plan (a ~92M-parameter model to
analyze the data), and the state of every git branch.*

---

## 1. Goal

GeoTech-Sigmoid analyzes high-resolution UAV (drone) imagery of vineyards to detect and
segment field features — **grapevines, weeds/small green plants, trees, and litter
(plastic/trash)** — from centimeter-scale orthomosaics and image tiles. The end product
is a trained model that turns raw aerial imagery into georeferenced vector annotations
usable for agronomy (vine counting, canopy/health mapping, weed & debris detection).

The workflow has three layers, each represented by a branch (see §4):

1. **Auto-labeling** — zero-shot segmentation (SAM 3) proposes masks on the tiles.
2. **Human verify/correct/export** — a self-hosted annotation platform where the team
   reviews and fixes labels, then exports them (CVAT + GeoTIFF masks).
3. **Dataset + training** — verified labels are indexed into a FiftyOne dataset and used
   to train the analysis model.

---

## 2. The model — a ~92M-parameter analyzer

The plan is to **train a ~92M-parameter model** to analyze the vineyard imagery. This
parameter budget aligns naturally with the project's SAM-based pipeline: a **ViT-B-scale
image encoder** (SAM's ViT-B image encoder is ≈91M parameters; ViT-Base ≈86M) fine-tuned
for vineyard segmentation/detection. At that scale the model is large enough to learn the
fine texture of vine rows, weeds, and debris at 2.5 cm/px, yet small enough to train and
serve on a single 16 GB GPU (the constraint the SAM 3 POC already targets).

**How the 92M model fits the pipeline:**

| Stage | Produces | Feeds |
|---|---|---|
| SAM 3 zero-shot POC (`sam3_poc.py`) | candidate masks → per-tile GeoJSON | initial labels |
| Annotation platform (`feat/tile-label-verify`) | human-verified polygons | clean training labels |
| FiftyOne dataset (`feat/fiftyone-dataset-setup`) | indexed, previewable samples | training/eval splits |
| **~92M model (training)** | vineyard segmentation/detection | georeferenced outputs |

**Label taxonomy & size priors** (encoded in `sam3_poc.py`, from the Marcaj annotation
rules): grapevine and small green plants ≈ 0.2–2.5 m²; trees 2–4 m crowns; weeds < 0.2 m²;
plastic/trash 0.02–4 m². Ground sampling distance is **2.5 cm/px**, so these priors map to
concrete pixel-area filters.

> Note: the "92M parameters" figure is the team's stated target for the analysis model;
> the specific architecture (SAM/ViT-B encoder + segmentation head vs. a SegFormer-scale
> model) is to be finalized. The number is recorded here as the design target.

---

## 3. Assembled data

All datasets live under `data/` (gitignored, **never committed** — synced out of band).
Each dataset is in its own folder with a `source.txt` holding the original link.

**Total: ~139 GB, 8,890 files across 10 datasets.**

| Dataset (folder) | Size | Files | Source |
|---|---|---|---|
| `canyelles_vineyard_2023-05-26_15130400` | 39 GB | 1,713 | zenodo.org/records/15130400 |
| `canyelles_vineyard_2024-07-03_15147343` | 24 GB | 413 | zenodo.org/records/15147343 |
| `canyelles_vineyard_2024_15166695` (2024-07-31) | 24 GB | 457 | zenodo.org/records/15166695 |
| `agrotwin_2024_12744462` | 16 GB | 2,039 | zenodo.org/records/12744462 |
| `canyelles_vineyard_2023_8220183` (2023-06-09) | 9.9 GB | 1,105 | zenodo.org/records/8220183 |
| `canyelles_vineyard_2023-04-21_14965547` | 9.2 GB | 353 | zenodo.org/records/14965547 |
| `precision_viticulture_2022_10362568` | 8.1 GB | 420 | zenodo.org/records/10362568 |
| `plant_leaves_2024_13944498` | 3.4 GB | 258 | zenodo.org/records/13944498 |
| `riseholme_vineyard_2024_2025_19234907` | 3.2 GB | 882 | zenodo.org/records/19234907 |
| `marcaj-data` (Siret3 field challenge) | 1.1 GB | 341 | Google Drive (challenge assets) |

**Data types across the collection:** RGB drone photos (DJI), multispectral bands
(NIR, Red-edge, Green, Blue), orthomosaics (GeoTIFF, e.g. EPSG:4326 / :32629 / :32635),
DEMs, LiDAR/photogrammetry point clouds (`.las`), COCO-format segmentation subsets
(Riseholme), ROS bags (AgroTwin), and the **Marcaj challenge tiles** — 311 GeoTIFF tiles
at 2048×2048 px, 2.5 cm/px, EPSG:32635, plus route geojsons, a source orthomosaic, and
annotation-rule PDFs.

**Data-integrity notes:**
- `canyelles_vineyard_2023_8220183` — the source `RGB.zip`/`NIR.zip` are truncated on
  Zenodo (capped at 4 GB). Images were **salvaged** by carving them from the truncated
  archives: 557 RGB JPGs + 545 NIR TIFs recovered (only the final file of each was lost);
  the two orthomosaic JPGs are intact.
- The Servadei and (earlier) Vineyard_up datasets were downloaded then **removed** on
  request; they are not part of the current collection.

---

## 4. Branch analysis

Remote: `https://github.com/Angroys/GeoTech-Sigmoid`. Workflow: no direct commits to
`main`; work in `feat/<slug>` branches, Conventional Commits, land via PR.

### `main`
Bootstrap only — `README.md` (workflow rules) + `.gitignore`. The baseline everything
branches from.

### `feat/contribution-scaffolding`
Adds `.github/ISSUE_TEMPLATE/config.yml` — a GitHub issue-template chooser. Repo hygiene /
contribution scaffolding. Small (1 file).

### `feat/tile-label-verify` — the annotation platform *(largest branch, ~6,190 LOC)*
A self-hosted **view → correct → verify → export** platform for the 311 GeoTIFF tiles,
built to run on the team's **Headscale private mesh**, buildable in < 1 day.
- **Backend** (`backend/app/`, FastAPI): tiles, raster PNG rendering, per-tile geo,
  annotations CRUD, tile status (unchecked/in-progress/verified), **CVAT import/export**,
  and **GeoTIFF mask export** (async jobs). SQLite (`db.py`), tests for CVAT round-trip
  and GeoTIFF masking.
- **Frontend** (`frontend/`, React + Vite + Leaflet, Simple/pixel CRS): `TileNavigator`,
  `TileViewer` (polygon/vertex editing, class & attribute panels), `ExportPanel`; a full
  design-token system (`design/design-tokens.json`, `design/ui-spec.md`).
- **Ops**: `scripts/run-backend.sh` / `run-frontend.sh` (auto-create venv / `npm install`,
  bind `0.0.0.0` for mesh peers), `RUN.md` operator guide.

### `feat/fiftyone-dataset-setup` — dataset builder
`scripts/build_fiftyone.py` (+ notebook) indexes every image under `data/<dataset>/` into
a persistent **FiftyOne** dataset, tagging each sample with its source dataset. JPG/PNG are
indexed directly; **multispectral TIFFs get an RGB preview PNG** (via `tif_preview.py`,
cached in `.fiftyone_previews/`) with the original path kept in `source_path`. Supports
`--dry-run` (no FiftyOne needed) for quick counts. This is the bridge from raw `data/` to
a trainable/browsable dataset.

### Uncommitted working-tree work (on `main` checkout)
- `sam3_poc.py` — **zero-shot SAM 3 auto-labeling POC** on Siret3 tiles: text-prompted
  segmentation on 1024 px crops of 2048 px tiles, cross-crop NMS de-dup, per-tile GeoJSON
  (EPSG:32635) + quick-look PNG, plus an ExG+Otsu colour baseline. Targets a 16 GB GPU.
- `scripts/` — `tif_preview.py` (multispectral→RGB preview helper) + notebook, plus infra
  helper scripts.
- `test-tiles/`, `out/` — local scratch for the POC.

---

## 5. End-to-end pipeline (summary)

```
UAV imagery (139 GB, 10 datasets)
      │
      ▼
tiling → 311 GeoTIFF tiles (2048², 2.5 cm/px, EPSG:32635)
      │
      ▼
SAM 3 zero-shot masks  (sam3_poc.py)         ── candidate labels
      │
      ▼
verify / correct / export  (feat/tile-label-verify)  ── human-in-the-loop
      │
      ▼
FiftyOne dataset  (feat/fiftyone-dataset-setup)      ── indexed, split
      │
      ▼
train ~92M-parameter model (ViT-B-scale segmenter)   ── the analyzer
      │
      ▼
georeferenced vineyard analysis (vines / weeds / trees / trash)
```

---

*Generated as a project snapshot. Datasets and branch states reflect the repository at the
time of writing; `data/` contents are local-only and gitignored.*

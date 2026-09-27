# GeoTech-Sigmoid

Hackathon project.

## Workflow

- Work happens in branches — no direct commits to `main`.
- Branch naming: `feat/<slug>`, `fix/<slug>`.
- Commits follow [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `chore:`, `docs:` …).
- Changes land via pull request into `main`.

## Running the app

See [RUN.md](RUN.md) for the full operator guide. In short:

```bash
cd frontend && npm install && VITE_API_BASE= npm run build   # build the UI once
PORT=8010 ./scripts/run-backend.sh                         # API + UI on one port
```

The backend serves both `/api` and the built UI from a single origin (no proxy
needed); it binds `0.0.0.0` so Headscale mesh peers can reach it. Teammates open
`http://<host>:8010` (or the `tailscale serve` URL). `data/` (tiles + DB) is
gitignored and must be present locally; the published dataset lives in
`dataset/` (Git LFS).

## FiftyOne dataset

`scripts/build_fiftyone.py` indexes every image under `data/<dataset_name>/` into a
persistent [FiftyOne](https://docs.voxel51.com/) dataset. Each sample carries a
`dataset` classification label (the top-level folder name). JPG/PNG are indexed
directly; multispectral TIFFs get an RGB preview PNG (via `scripts/tif_preview.py`)
cached under `.fiftyone_previews/`, with the original TIFF kept in `source_path`.

```bash
# install deps
pip install -r requirements.txt

# scan + report counts only (no FiftyOne needed)
python scripts/build_fiftyone.py --dry-run
python scripts/build_fiftyone.py --dry-run --limit 20   # cap per dataset (testing)

# build the persistent dataset (default name: geotech)
python scripts/build_fiftyone.py
python scripts/build_fiftyone.py --name geotech --recreate   # rebuild from scratch

# launch the FiftyOne app
python -c "import fiftyone as fo; s=fo.launch_app(fo.load_dataset('geotech')); s.wait()"
```

The notebook `scripts/build_fiftyone.ipynb` wraps the same steps and launches the app inline.

## Road extraction (SAM-Road)

`road_extraction/` extracts the **road / farm-track network** of the Siret3 challenge field from
the drone tiles using the pretrained [SAM-Road](https://github.com/htcr/sam_road) models
(CityScale / SpaceNet checkpoints, **no fine-tuning**) and writes georeferenced masks and
vector lines to `data/road/`.

- [Context](#context)
- [How it works](#how-it-works)
- [Requirements](#requirements)
- [Setup](#setup)
- [Run](#run)
- [CLI reference](#cli-reference)
- [Outputs](#outputs-dataroad-gitignored)
- [Results on Siret3](#results-on-siret3)
- [Using the outputs](#using-the-outputs)
- [Code layout](#code-layout)
- [Tests](#tests)
- [Troubleshooting](#troubleshooting)
- [Limitations and next steps](#limitations-and-next-steps)
- [Licenses and credits](#licenses-and-credits)

### Context

| | |
|---|---|
| Location | Sireți village, Strășeni district, Republic of Moldova (≈ 47.12 N, 28.71 E) |
| Input | 311 GeoTIFF tiles `siret3_rRRR_cCCC.tif` in `data/marcaj-data/assets_for_participants/01_tiles/` |
| Tile format | 2048 × 2048 px, RGB, 2.5 cm/px (51.2 m per side), EPSG:32635 (UTM 35N) |
| Tile grid | rows 5–39, cols 0–33 (sparse; only the tiles inside the study area exist) |
| Field extent | x 628 992 – 630 733 m, y 5 219 174 – 5 220 966 m (≈ 1.7 × 1.8 km) |
| Roads of interest | village streets on the NE edge, dirt/farm tracks and headlands between vineyard/orchard parcels |

SAM-Road is a road-graph extraction model built on Segment Anything (ViT-B encoder). It predicts
two dense maps — a **road** probability and a **keypoint/intersection** probability — and a small
transformer (**TopoNet**) that decides which pairs of keypoints are connected by a road. The
released checkpoints were trained on satellite imagery at ≈ 1 m/px (US cities), i.e. ~40× coarser
than our drone tiles, so the core problem here is **scale adaptation**, not training.

### How it works

```
 311 tiles (2.5 cm/px)
        │  tiles.py  scan + parse rRRR/cCCC, build the tile grid
        ▼
 field mosaic (0.5 m/px, 3570 × 3468 px)          mosaic.py
        │  each 2048 px tile decimated to 102 px, black pixels = nodata
        ▼
 sliding windows 256 px, overlap 128 (273 windows) windows.py
        │  batched on GPU (16/batch), SAM ViT-B encoder + mask decoder
        ▼
 road prob + keypoint prob, cosine-blended         sam_road_infer.py
        │
        ├─► keypoint NMS → TopoNet edge votes (k-NN pairs per window,     topo.py
        │   averaged per undirected edge, threshold 0.705)
        │                                            ─► TopoNet graph (main)
        └─► road mask ≥ 0.341 → skeletonise → graph  ─► skeleton graph (alt)
                                                     graph.py
        ▼
 degree-2 contraction, spur (< 6 m) and component (< 15 m) pruning,
 Douglas–Peucker simplify (0.5 m), pixel → EPSG:32635
        ▼
 field GeoJSON + prob GeoTIFF + overview PNGs      extract_roads.py / render.py
        │
        ▼  per tile (8 threads): prob upsampled back to 2048 × 2048, thresholded,
           lines clipped to the tile bounds
 masks/*.tif, geojson/*.geojson, previews/*.png
```

Step by step:

1. **Scan** – every `*_rRRR_cCCC.tif` in `--tiles-dir` is opened with rasterio; row/col come from
   the filename, the transform/CRS from the file. Tiles must share one CRS and resolution and sit on
   a regular grid (checked in `tiles.build_grid`).
2. **Mosaic** – instead of running the model tile by tile (a 51 m tile is only 51 px at 1 m/px, far
   smaller than a model patch), all tiles are decimated and pasted into one field-wide raster at the
   target GSD. The per-tile output size is `round(2048 × 0.025 / gsd)` px, so the real GSD is
   snapped slightly (0.5 → 0.502 m/px). Pixels black in all bands (outside the flown area) are
   marked invalid.
3. **Windowed inference** – the mosaic is cut into overlapping windows of the model patch size
   (SpaceNet 256 px, CityScale 512 px). Windows with too little valid coverage are skipped. Inputs
   are raw 0–255 RGB; the model normalises internally. Per-window predictions are blended with a
   cosine weight (edges of a window count less than its centre), which removes seam artefacts
   that the upstream flat average produces.
4. **Graph** – two methods, selected with `--graph`:
   - **toponet** (SAM-Road's native approach): keypoints are sampled from the keypoint and road
     maps with NMS (radii 8 / 16 px), each window queries TopoNet for up to 16 neighbours within
     64 px, and edges whose averaged score exceeds the topo threshold are kept.
   - **skeleton**: the thresholded road mask is thinned to 1 px (scikit-image) and traced into a
     graph. Useful as a cross-check; it follows the mask more literally.
5. **Clean-up** – chains of degree-2 nodes are merged into polylines, dangling spurs shorter than
   `--min-spur-m` and isolated pieces shorter than `--min-component-m` are removed, lines are
   simplified and converted from mosaic pixels to UTM metres with the mosaic affine transform.
6. **Per-tile outputs** – the field probability map is resampled back onto each tile's own
   2048 × 2048 grid (bilinear by default) and thresholded, so every mask has exactly the source
   tile's transform; field lines are clipped to each tile's bounds.

### Requirements

- NVIDIA GPU with a CUDA build of PyTorch. Developed on an **RTX 5080 (16 GB, Blackwell sm_120)**,
  driver CUDA 13.0, using `/home/minimax/venv` (Python 3.11, `torch 2.11.0+cu128`). Blackwell
  needs a cu128+ torch build — do not let pip downgrade it. The default run fits comfortably
  in 16 GB of VRAM; CPU works too (`--device cpu`) but is much slower.
- ~2.5 GB disk for weights, ~200 MB for a full set of outputs.
- Python deps in `road_extraction/requirements-roads.txt` (lightning, torchmetrics, addict,
  rtree, python-igraph, tcod, scikit-learn, opencv, rasterio, pyproj, shapely, scikit-image,
  networkx, scipy, Pillow, pytest). `torch`/`torchvision` are deliberately **not** listed.
- `git` and `curl` for the setup scripts.

### Setup

```bash
bash road_extraction/setup_sam_road.sh     # clone + patch + deps + weights (idempotent)
bash road_extraction/download_weights.sh   # weights only (into road_extraction/weights/)
/home/minimax/venv/bin/python road_extraction/smoke_load.py   # GPU smoke test
```

What `setup_sam_road.sh` does:

1. Clones `htcr/sam_road` into the gitignored `road_extraction/third_party/sam_road` at the pinned
   commit `04b67c50` (SAM-Road is **cloned, not vendored** — re-run the script to recreate it).
2. Initialises only the `sam` submodule (the `htcr/segment-anything-road` fork, pinned `6fdee8f2`)
   over HTTPS (upstream `.gitmodules` uses SSH URLs).
3. Applies `road_extraction/patches/sam_road_compat.patch`. All changes are marked
   `[geotech-compat]` in the source:
   - `wandb` import made optional,
   - SAM checkpoint loaded with `map_location="cpu"`,
   - Lightning checkpoint loaded with `weights_only=False` (required since torch 2.6).
4. `pip install -r road_extraction/requirements-roads.txt` with a constraints file that pins the
   **currently installed** torch/torchvision, so the CUDA build is never replaced.
5. Runs `download_weights.sh`.

Environment variables:

| Variable | Used by | Meaning |
|---|---|---|
| `PYTHON` | `setup_sam_road.sh` | interpreter to install into (default `/home/minimax/venv/bin/python`) |
| `SKIP_PIP=1` | `setup_sam_road.sh` | skip the pip install step |
| `SKIP_WEIGHTS=1` | `setup_sam_road.sh` | skip downloading weights |
| `SAM_ROAD_WEIGHTS_DIR` | download script, `smoke_load.py` | alternative weights directory |
| `GEOTECH_REPO_ROOT` | `extract_roads` | repo root used to resolve the default `data/` paths |

Weights (downloaded to `road_extraction/weights/`, size-checked, resumable, **never committed**):

| File | Size | Source | Notes |
|---|---|---|---|
| `sam_vit_b_01ec64.pth` | 375 MB | Meta (`dl.fbaipublicfiles.com`) | SAM ViT-B encoder, only used to build the model |
| `spacenet_vitb_256_e10.ckpt` | 1.05 GB | HF `congrui/sam_road` | SpaceNet, 256 px patch — **default** |
| `cityscale_vitb_512_e10.ckpt` | 1.05 GB | HF `congrui/sam_road` | City-Scale, 512 px patch |

`smoke_load.py` builds each model, loads its checkpoint, runs one forward pass (masks + TopoNet)
on the GPU and prints shapes and timings — run it after setup or after upgrading torch.

### Run

```bash
# full field, defaults (SpaceNet model @ 0.5 m/px) -> <repo>/data/road/
/home/minimax/venv/bin/python -m road_extraction.extract_roads

# quick trial on a tile subset into a scratch dir
/home/minimax/venv/bin/python -m road_extraction.extract_roads --rows 14:17 --cols 8:12 --out-dir /tmp/road_trial
/home/minimax/venv/bin/python -m road_extraction.extract_roads --tiles r15_c9 r15_c10 --model cityscale --gsd 1.0
```

More recipes:

```bash
PY=/home/minimax/venv/bin/python

# scale sweep: field-level outputs only (~25 s each), compare previews/overview_field.png
for g in 0.35 0.5 0.75 1.0; do
  $PY -m road_extraction.extract_roads --gsd $g --no-tile-outputs --out-dir /tmp/roads_gsd_$g
done

# same as --gsd 0.5 but expressed as a downsample factor of the 2.5 cm tiles
$PY -m road_extraction.extract_roads --scale 20 --out-dir /tmp/roads_s20

# more recall (and more false positives): lower the road/edge thresholds
$PY -m road_extraction.extract_roads --road-threshold 0.25 --topo-threshold 0.5 --out-dir /tmp/roads_loose

# mask-skeleton graph as the main output, crisp masks
$PY -m road_extraction.extract_roads --graph skeleton --mask-resampling nearest --out-dir /tmp/roads_skel

# CityScale with larger windows, verbose logging
$PY -m road_extraction.extract_roads --model cityscale --window 512 --overlap 256 -v --out-dir /tmp/roads_cs
```

Default paths are resolved against the **main** repo root, so the command also works from a
git worktree: `$GEOTECH_REPO_ROOT` if set, else the parent of `git rev-parse --git-common-dir`,
else the directory containing `road_extraction/`.

Re-running into the same `--out-dir` overwrites files in place (stale per-tile files from a larger
earlier selection are not deleted) — use a fresh `--out-dir` for experiments.

### CLI reference

| Option | Default | Meaning |
|---|---|---|
| `--tiles-dir` | `<repo>/data/marcaj-data/assets_for_participants/01_tiles` | source tiles |
| `--out-dir` | `<repo>/data/road` | output directory |
| `--tiles` / `--rows` / `--cols` / `--limit` | all | subset: `r12_c5`/`siret3_r012_c005`/`12,5` selectors, inclusive `20:24` ranges, first N |
| `--model` | `spacenet` | `spacenet` (256 px patch) or `cityscale` (512 px patch) |
| `--gsd` / `--scale` | `0.5` m/px | mosaic GSD, or a downsample factor vs. the 2.5 cm tiles (e.g. `--scale 20`) |
| `--window` / `--overlap` | patch size / window/2 | sliding window in mosaic px (a window != patch is resized to the patch) |
| `--batch-size` | 16 | windows per GPU batch |
| `--blend` | `cosine` | window blending: `cosine`, `linear`, `uniform` (upstream = uniform) |
| `--device` | `cuda` if available | torch device |
| `--itsc-threshold` / `--road-threshold` / `--topo-threshold` | model config (SpaceNet 0.195 / 0.341 / 0.705) | keypoint / road-mask / TopoNet edge thresholds |
| `--graph` | `both` | `toponet` (native), `skeleton` (mask skeleton), `both` = toponet main + `roads_field_skeleton.geojson` |
| `--min-spur-m` / `--min-component-m` / `--simplify-m` | 6 / 15 / 0.5 | graph pruning and line simplification (metres) |
| `--mask-resampling` | `bilinear` | mosaic prob -> 2048x2048 tile grid, then thresholded at the road threshold |
| `--no-previews` / `--no-tile-outputs` | off | skip PNGs / skip all per-tile files (fast field-level trials) |
| `--workers` / `--preview-px` | 8 / 512 | threads for per-tile outputs, preview size (keep `--preview-px` a divisor of 2048) |
| `-v` / `--verbose` | off | debug logging |

### Outputs (`data/road/`, gitignored)

```
masks/siret3_rRRR_cCCC_road.tif         uint8 0/255 road mask, same CRS/transform/shape as the source tile
geojson/siret3_rRRR_cCCC_roads.geojson  LineStrings clipped to the tile, EPSG:32635 (metres, not lon/lat)
roads_field.geojson                     merged field-wide network (TopoNet graph)
roads_field_skeleton.geojson            alternative network from the skeletonised road mask (--graph both)
road_prob_field.tif                     stitched probabilities x255 at mosaic GSD (band 1 road, band 2 keypoint)
previews/siret3_rRRR_cCCC_roads.png     512 px tile preview, road mask (red) + lines (yellow)
previews/overview_field.png             whole field: road probability + lines
previews/overview_field_lines.png       whole field: lines only
run_meta.json                           parameters, model, GSD, thresholds, graph stats, timings, per-tile counts
```

GeoJSON uses the GeoJSON-2008 `crs` member `urn:ogc:def:crs:EPSG::32635` (coordinates are UTM
metres, **not** lon/lat — tools that ignore the `crs` member will misplace them). Feature
properties:

| Property | Example | Where |
|---|---|---|
| `model` | `spacenet` | all |
| `method` | `toponet` / `skeleton` | all |
| `gsd_m` | `0.502` | all — mosaic GSD the line was extracted at |
| `length_m` | `41.695` | all — length of that (clipped) line in metres |
| `tile` | `siret3_r015_c009` | per-tile files only |

`run_meta.json` records everything needed to reproduce and compare runs: model, device name,
tile/mosaic geometry (`mosaic_shape`, `mosaic_transform`, `gsd_m`), windowing, thresholds,
graph stats for each method (points, candidate pairs, raw/final edges, km), pruning params,
`road_frac_valid` (share of in-field pixels labelled road), per-stage `timings_s`, and per-tile
`road_px` / `n_lines` / `length_m`.

### Results on Siret3

Default run (`--model spacenet --gsd 0.5`) on the RTX 5080:

| Metric | Value |
|---|---|
| Tiles processed | 311 |
| Mosaic | 3570 × 3468 px @ 0.502 m/px, 273 windows |
| Field network (TopoNet) | 55 lines, 72 nodes, **4.50 km** |
| Field network (skeleton) | 49 lines, 74 nodes, 4.45 km |
| Tiles containing roads | 119 of 311 (181 clipped features) |
| Road share of the flown area | 1.5 % |
| Longest per-tile road length | ≈ 123 m (`siret3_r025_c015`) |

| Stage | Time |
|---|---|
| scan | 0.2 s |
| mosaic | 14.0 s |
| model load | 4.5 s |
| GPU inference (273 windows) | 1.6 s |
| graph | 2.2 s |
| field outputs | 1.3 s |
| per-tile outputs (311 × mask + GeoJSON + PNG) | 47.7 s |
| **total** | **71.4 s** |

Most of the time is I/O (reading 311 full-res tiles, writing 311 full-res masks); the model
itself is ~2 s.

#### Why 0.5 m/px and SpaceNet

Scale and model were chosen by running the whole field at 0.25, 0.35, 0.5, 1.0, 1.5 and 2.0 m/px
with both checkpoints and inspecting the overview previews:

* **>= 1 m/px** (the models' nominal training GSD) misses almost everything: the farm tracks are
  2-4 m wide, i.e. only 2-4 px, far narrower than the urban roads the models were trained on
  (1.0 m: 1.3 km CityScale / 3.0 km SpaceNet; 2.0 m: < 0.7 km).
* **<= 0.35 m/px** starts to fire on vine/orchard rows and parcel edges (short parallel segments
  inside parcels), the expected failure mode.
* **0.5 m/px** recovers the main dirt/farm road network between parcels with few false positives;
  **SpaceNet** gave cleaner results than CityScale at that scale (CityScale adds short lines
  inside orchard parcels). Default: `--model spacenet --gsd 0.5`.

At 0.5 m/px a 3 m farm track is ~6 px wide, which is roughly the width of a residential street in
the 1 m/px training data — the model "sees" our tracks as small roads.

#### What it finds / misses

- Found: the village street along the NE edge, the long SW diagonal track, the junctions in the NW,
  headland roads around the central parcels.
- Missed: faint, grass-covered two-track paths (mostly the SE of the field). Lowering the
  thresholds does not recover them — the pretrained models simply do not respond.
- False positives: a few short segments in orchard gaps in the centre and around building
  outlines in the SE.
- Per-tile masks are upsampled from 0.5 m/px, so edges are soft and roads appear ~1–2 m wider
  than in the imagery.

There is no road ground truth for Siret3 yet; the assessment above is visual. The official
cadastre (ASP, via geodata.gov.md, layer `cadastru_data:terenuri`) contains road parcels with
land use *"Cale de comunicaţie"* that can serve as a rough reference for a quantitative check.

### Using the outputs

QGIS: drag `data/road/roads_field.geojson` onto a project; if it lands in the wrong place, set the
layer CRS to EPSG:32635 manually. The masks and `road_prob_field.tif` open directly as rasters.

Python:

```python
import json
import rasterio
from pyproj import Transformer
from shapely.geometry import shape
from shapely.ops import transform

fc = json.load(open("data/road/roads_field.geojson"))
roads = [shape(f["geometry"]) for f in fc["features"]]    # UTM 35N metres
print(len(roads), sum(r.length for r in roads) / 1000, "km")

to_wgs84 = Transformer.from_crs(32635, 4326, always_xy=True).transform
roads_lonlat = [transform(to_wgs84, r) for r in roads]    # lon/lat for web maps

with rasterio.open("data/road/masks/siret3_r015_c009_road.tif") as src:
    mask = src.read(1) > 0                                 # bool 2048 x 2048, aligned to the tile

with rasterio.open("data/road/road_prob_field.tif") as src:
    road_prob = src.read(1) / 255.0                        # field-wide probability, 0.5 m/px
```

The per-tile masks are pixel-aligned with the source tiles, so they can be combined directly
with tile-level labels (e.g. to exclude roads from vineyard parcels). `roads_field.geojson` is the
intended input for downstream route planning.

### Code layout

| File | Role |
|---|---|
| `extract_roads.py` | CLI entry point (`python -m road_extraction.extract_roads`), orchestrates the run, writes `run_meta.json` |
| `sam_road_infer.py` | `SamRoadRunner`: loads a checkpoint, windowed mask inference, TopoNet graph (adapted from upstream `inferencer.py`) |
| `smoke_load.py` | model construction (`build_model`, `MODELS`) + standalone GPU smoke test |
| `tiles.py` | tile filename parsing, `TileInfo`, `TileGrid` (grid checks, per-tile bounds) |
| `mosaic.py` | decimated field mosaic, nodata/valid mask, target-GSD maths |
| `windows.py` | sliding windows, blend weights, `Stitcher` |
| `topo.py` | TopoNet query building (k-NN pairs) and undirected edge-vote averaging |
| `graph.py` | skeletonisation, graph building, degree-2 contraction, spur pruning, lines, clipping, GeoJSON I/O |
| `geo.py` | pixel ↔ CRS transforms, resampling to tile grids, mask GeoTIFF writing |
| `render.py` | overlays and preview PNGs |
| `paths.py` | repo-root resolution, default paths, output file naming, tile selectors |
| `setup_sam_road.sh` / `download_weights.sh` | environment + weights |
| `patches/sam_road_compat.patch` | minimal upstream compatibility patch |
| `tests/` | pytest suite (no model, no data needed) |

Only `sam_road_infer.py` and `smoke_load.py` import torch / upstream SAM-Road; everything else is
plain numpy/rasterio/shapely and is unit-tested.

### Tests

```bash
/home/minimax/venv/bin/python -m pytest road_extraction/tests -q -c road_extraction/pytest.ini
```

68 tests (< 1 s) covering tiling/mosaic/stitching, pixel<->CRS, mask->graph->GeoJSON, TopoNet
query building / edge voting, path resolution and CLI wiring on synthetic data; they never load a
model and do not need `data/`.

### Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `ModuleNotFoundError: sam` / `segment_anything` / `graph_utils` | `third_party/sam_road` missing or submodule not initialised — re-run `setup_sam_road.sh` |
| `_pickle.UnpicklingError: Weights only load failed` | compat patch not applied (torch ≥ 2.6) — re-run `setup_sam_road.sh` |
| `FileNotFoundError` for a `.ckpt`/`.pth` | run `download_weights.sh`, or point `SAM_ROAD_WEIGHTS_DIR` at the weights |
| `no kernel image is available for execution on the device` | torch build without sm_120 support — use a cu128+ build; never let pip replace it |
| CUDA out of memory | lower `--batch-size` (e.g. 4) |
| `no tiles found` | wrong `--tiles-dir`, or running from a checkout without `data/` — set `GEOTECH_REPO_ROOT` |
| Lines appear near (0, 0) / in the ocean | the viewer ignored the GeoJSON `crs` member — set EPSG:32635 explicitly |
| Preview step crashes with a shape mismatch | `--preview-px` does not divide 2048 — use 256/512/1024 |
| `git commit` fails with "insufficient permission" | some `.git/objects` dirs in the shared clone are not group-writable: `sudo chmod -R g+w .git/objects` |

### Limitations and next steps

- Zero-shot only: the models were trained on US satellite imagery; rural Moldovan dirt tracks
  are out of distribution. Fine-tuning on a few hand-labelled Siret3 tiles (or on cadastre road
  parcels) is the obvious next step to improve recall on grassy paths.
- Masks are produced at 0.5 m/px and upsampled — fine for routing, too coarse for cm-accurate
  edges. A refinement pass at full resolution (e.g. SAM prompted with the extracted lines)
  would sharpen them.
- Single-scale inference; fusing 0.5 and 0.75 m/px predictions could recover both narrow and
  wide roads.
- No quantitative evaluation yet (no ground truth).

### Licenses and credits

- [SAM-Road](https://github.com/htcr/sam_road) — Congrui Hetang et al., *Segment Anything Model for
  Road Network Graph Extraction* (CVPRW 2024). Code MIT; checkpoints from
  [huggingface.co/congrui/sam_road](https://huggingface.co/congrui/sam_road).
- [Segment Anything](https://github.com/facebookresearch/segment-anything) (and the
  `segment-anything-road` fork) — Meta AI, Apache-2.0, including the ViT-B weights.
- Siret3 imagery — Vineyard AI Field Challenge (Marcaj) assets; see
  `data/marcaj-data/assets_for_participants/README.md`.

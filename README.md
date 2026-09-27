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

`road_extraction/` runs the pretrained [SAM-Road](https://github.com/htcr/sam_road)
checkpoints (CityScale / SpaceNet, **no fine-tuning**) over the Siret3 field tiles
(`siret3_rRRR_cCCC.tif`, 2048x2048, 2.5 cm/px, EPSG:32635) and writes a georeferenced
road network. Pipeline: tile index -> field mosaic downscaled to ~model GSD ->
SAM-Road road/keypoint masks over overlapping windows (batched on the GPU, cosine-blended) ->
SAM-Road's native graph (NMS'd keypoints + TopoNet edge votes; skeletonisation of the road
mask as an alternative) -> spur/component pruning -> LineStrings in EPSG:32635 ->
per-tile masks/GeoJSON/previews + field-wide outputs.

### Setup

```bash
bash road_extraction/setup_sam_road.sh     # clone + patch + deps + weights (idempotent)
bash road_extraction/download_weights.sh   # weights only (into road_extraction/weights/)
/home/minimax/venv/bin/python road_extraction/smoke_load.py   # GPU smoke test
```

* SAM-Road is **cloned, not vendored**, at pinned SHA `04b67c50` into the gitignored
  `road_extraction/third_party/sam_road` and patched with
  `road_extraction/patches/sam_road_compat.patch` (torch >= 2.6 compatibility). The installed
  CUDA torch is pinned via a constraints file and never replaced.
* Licenses: sam_road code is MIT; Segment Anything (SAM fork submodule + ViT-B weights) is
  Apache-2.0. Weights (`sam_vit_b_01ec64.pth`, `cityscale_vitb_512_e10.ckpt`,
  `spacenet_vitb_256_e10.ckpt`) live in gitignored `road_extraction/weights/` and are never committed.

### Run

```bash
# full field, defaults (SpaceNet model @ 0.5 m/px) -> <repo>/data/road/
/home/minimax/venv/bin/python -m road_extraction.extract_roads

# quick trial on a tile subset into a scratch dir
/home/minimax/venv/bin/python -m road_extraction.extract_roads --rows 14:17 --cols 8:12 --out-dir /tmp/road_trial
/home/minimax/venv/bin/python -m road_extraction.extract_roads --tiles r15_c9 r15_c10 --model cityscale --gsd 1.0
```

Default paths are resolved against the **main** repo root, so the command also works from a
git worktree: `$GEOTECH_REPO_ROOT` if set, else the parent of `git rev-parse --git-common-dir`,
else the directory containing `road_extraction/`.

| Option | Default | Meaning |
|---|---|---|
| `--tiles-dir` | `<repo>/data/marcaj-data/assets_for_participants/01_tiles` | source tiles |
| `--out-dir` | `<repo>/data/road` | output directory |
| `--tiles` / `--rows` / `--cols` / `--limit` | all | subset: `r12_c5`/`12,5` selectors, inclusive `20:24` ranges, first N |
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
| `--workers` / `--preview-px` | 8 / 512 | threads for per-tile outputs, preview size |

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

GeoJSON uses the GeoJSON-2008 `crs` member `urn:ogc:def:crs:EPSG::32635`; every feature has `length_m`.

### Chosen defaults and caveats

Scale/model were chosen by running the whole field at 0.25, 0.35, 0.5, 1.0, 1.5 and 2.0 m/px
with both checkpoints and inspecting the overview previews:

* **>= 1 m/px** (the models' nominal training GSD) misses almost everything: the farm tracks are
  2-4 m wide, i.e. only 2-4 px, far narrower than the urban roads the models were trained on
  (1.0 m: 1.3 km CityScale / 3.0 km SpaceNet; 2.0 m: < 0.7 km).
* **<= 0.35 m/px** starts to fire on vine/orchard rows and parcel edges (short parallel segments
  inside parcels), the expected failure mode.
* **0.5 m/px** recovers the main dirt/farm road network between parcels with few false positives;
  **SpaceNet** gave cleaner results than CityScale at that scale (CityScale adds short lines
  inside orchard parcels). Default: `--model spacenet --gsd 0.5`.

Caveats: recall on faint, grass-covered two-track paths (mostly the south-east of the field) is
low, and lowering the thresholds does not recover them (the pretrained models simply do not
respond); a few false positives remain (orchard gaps, building outlines). Per-tile masks are
upsampled from 0.5 m/px so edges are soft and roads appear slightly wider than in the imagery.
Pixels that are black in all bands (outside the flown area) are treated as nodata.

### Tests

```bash
/home/minimax/venv/bin/python -m pytest road_extraction/tests -q -c road_extraction/pytest.ini
```

The tests cover tiling/mosaic/stitching, pixel<->CRS, mask->graph->GeoJSON, TopoNet query
building / edge voting, path resolution and CLI wiring on synthetic data; they never load a model.

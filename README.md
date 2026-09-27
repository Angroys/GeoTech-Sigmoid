# GeoTech-Sigmoid

Hackathon project.

The routing service lives in [`route-algo`](route-algo/README.md) and connects to
the frontend's Route tab. See its README for setup, inputs, validation, and the
current demo's disconnected walking areas.

## Run everything

```bash
scripts/start-all.sh            # Ctrl+C stops both services
```

The script installs `uv` and `bun` if they are missing, syncs `route-algo` with
`uv sync --locked`, and runs `bun install` in `vineyard-front` (on the first
run, or when `bun.lock` changes). It then starts one backend,
`uvicorn route_algo.api:app` on `127.0.0.1:8001`, which serves `POST /plan` and
the `/api/surveys` processing API. Once `/health` responds, it starts `bun dev`
on `localhost:3000`, with `PROCESSING_API_URL` and `ROUTE_API_URL` both pointing
at that backend. Output from the two services is prefixed with `[api]` and
`[web]`. The script prints the frontend, backend and `/docs` URLs, and the
processing mode.

**Processing mode.** If `nvidia-smi -L` finds an NVIDIA GPU, the script runs in
model mode. It syncs the backend with the optional `model` extra
(`uv sync --locked --extra model`: torch cu128 and sam3). The first run
downloads several GB. Uploaded tiles are then segmented live with SAM 3 run3c.
If inference fails, the backend serves the precomputed run3c labels instead.
Without a GPU, or with `--no-model` or `--fallback`, the script installs only
the base dependencies and the backend serves only the precomputed labels. The
backend starts with `uv run --no-sync`, so a plain sync does not remove the
model extra.

Before it starts each service, the script checks that the port is free. If the
port is in use, it exits with an error.

| Flag | Effect |
|---|---|
| `--no-install` | Skip tool and dependency installation |
| `--no-model` | Skip the `model` extra and do not run SAM 3 |
| `--fallback` | Set `PROCESSING_FORCE_FALLBACK=1` to always serve precomputed labels (implies `--no-model`) |
| `--help` | Show usage |

| Variable | Default |
|---|---|
| `BACKEND_PORT` / `FRONTEND_PORT` | `8001` / `3000` |
| `DATA_DIR` | `./data`, else the main checkout's `data/` (for worktrees) |
| `SAM3_FT_WEIGHTS` | `$DATA_DIR/tested-on-vm/sam3_ft/run3c/best_effective.pth`, else `best.pth` (model mode) |
| `SAM3_BASE_WEIGHTS` | `$DATA_DIR/weights/sam3/sam3.pt` (model mode; needed with the raw `best.pth`) |
| `SAM3_PARCELS`, `SAM3_TTA` | Not set by the script. Values you export are passed to the model |
| `SAM3_FALLBACK_LABELS_DIR` | `$DATA_DIR/tested-on-vm/sam3_ft/run3c/labels` |
| `PROCESSING_DATA_DIR` | `route-algo/.processing-data` (ignored by Git) |
| `ROUTE_CONSTRAINTS_DIR` | `assets_for_participants-*/…/02_route`, else `$DATA_DIR/marcaj-data/assets_for_participants/02_route` |

The script exports a default path only if that path exists. Otherwise it prints
a warning. Data and weights are never committed.

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

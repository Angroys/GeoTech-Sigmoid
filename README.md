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

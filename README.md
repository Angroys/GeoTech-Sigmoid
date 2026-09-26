# GeoTech-Sigmoid

Hackathon project.

## Workflow

- Work happens in branches — no direct commits to `main`.
- Branch naming: `feat/<slug>`, `fix/<slug>`.
- Commits follow [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `chore:`, `docs:` …).
- Changes land via pull request into `main`.

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

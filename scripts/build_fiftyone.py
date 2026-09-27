"""
Build a FiftyOne dataset from the GeoTech `data/` tree.

Walks each top-level `data/<dataset_name>/` folder, recursively collects image
files, and adds them as samples to a persistent FiftyOne dataset. Each sample
gets a `dataset` field (a `fiftyone.core.labels.Classification`) whose label is
the top-level folder name. Multispectral TIFFs are not viewable directly, so an
RGB preview PNG is generated (via `tif_preview.render`) and indexed instead,
with the original TIFF path kept in a `source_path` field.

Non-image files (txt, ply, las, json, geojson, shp, pdf, HEIC, NEF, ...) are
ignored.

CLI:
    python build_fiftyone.py --dry-run                 # scan + report, no FiftyOne
    python build_fiftyone.py --dry-run --limit 20      # cap images per dataset
    python build_fiftyone.py                           # build persistent "geotech"
    python build_fiftyone.py --name myds --recreate    # rebuild from scratch
    python build_fiftyone.py --data-dir data --max-preview 2000

Notebook:
    from build_fiftyone import build_dataset, scan
    # dry-run style scan (no FiftyOne import):
    for label, files in scan("data").items():
        print(label, len(files))
    # real build (imports FiftyOne lazily inside the call):
    ds = build_dataset(data_dir="data", name="geotech", recreate=True)
    import fiftyone as fo
    session = fo.launch_app(ds)

Note: `import fiftyone` is intentionally lazy (inside `build_dataset`) so that
`--dry-run` works with only stdlib + the existing preview stack when FiftyOne is
not installed.
"""
import argparse
import os
import sys

# Make the sibling `tif_preview` module importable both as a CLI
# (`python scripts/build_fiftyone.py`) and when imported from elsewhere.
_HERE = os.path.dirname(os.path.abspath(__file__))
if _HERE not in sys.path:
    sys.path.insert(0, _HERE)


def _load_render():
    """Import `tif_preview.render` lazily.

    Kept out of module scope so `--dry-run` never pulls in rasterio/PIL: the
    preview stack is only needed on the real build path.
    """
    from tif_preview import render

    return render


# Standard images that FiftyOne can index directly.
STD_EXTS = {".jpg", ".jpeg", ".png"}
# Multispectral / geo rasters that need an RGB preview first.
TIF_EXTS = {".tif", ".tiff"}
IMAGE_EXTS = STD_EXTS | TIF_EXTS

PREVIEW_DIR = ".fiftyone_previews"


def is_image(path):
    """True if `path` has a recognised image extension (case-insensitive)."""
    return os.path.splitext(path)[1].lower() in IMAGE_EXTS


def is_tif(path):
    """True if `path` is a multispectral / geo TIFF."""
    return os.path.splitext(path)[1].lower() in TIF_EXTS


def find_images(root, limit=None):
    """Recursively collect image files under `root`, sorted for determinism.

    `limit` caps the number of images returned (useful for testing).
    """
    found = []
    for dirpath, _dirnames, filenames in os.walk(root):
        for name in sorted(filenames):
            full = os.path.join(dirpath, name)
            if is_image(full):
                found.append(full)
                if limit is not None and len(found) >= limit:
                    return found
    return found


def scan(data_dir, limit=None):
    """Map each top-level dataset folder name -> list of image file paths.

    Pure filesystem work; imports nothing beyond stdlib so it is safe for
    `--dry-run` without FiftyOne installed.
    """
    result = {}
    if not os.path.isdir(data_dir):
        return result
    for entry in sorted(os.listdir(data_dir)):
        top = os.path.join(data_dir, entry)
        if not os.path.isdir(top):
            continue
        result[entry] = find_images(top, limit=limit)
    return result


def _preview_path(src_path, data_dir, preview_root):
    """Preview PNG path that mirrors the source subpath under `preview_root`.

    Mirroring the source tree avoids name collisions between identically named
    TIFFs in different folders.
    """
    rel = os.path.relpath(os.path.abspath(src_path), os.path.abspath(data_dir))
    dest = os.path.join(preview_root, rel)
    return os.path.splitext(dest)[0] + ".png"


def make_tif_preview(src_path, data_dir, preview_root, max_preview=2000):
    """Return an RGB preview PNG for a TIFF, generating it on first use.

    Reuses an existing preview (skips regeneration) if one is already present.
    """
    dest = _preview_path(src_path, data_dir, preview_root)
    if os.path.exists(dest):
        return dest
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    render = _load_render()
    render(src_path, out=dest, max_dim=max_preview)
    return dest


def build_dataset(
    data_dir="data",
    name="geotech",
    recreate=False,
    max_preview=2000,
    limit=None,
    preview_dir=PREVIEW_DIR,
):
    """Build (or extend) a persistent FiftyOne dataset from `data_dir`.

    `import fiftyone` happens here, lazily, so the module imports cleanly and
    `--dry-run` runs without FiftyOne installed.
    """
    import fiftyone as fo
    import fiftyone.core.labels as fol

    if recreate and fo.dataset_exists(name):
        fo.delete_dataset(name)

    if fo.dataset_exists(name):
        dataset = fo.load_dataset(name)
    else:
        dataset = fo.Dataset(name)
    dataset.persistent = True

    preview_root = os.path.join(data_dir, preview_dir)

    scanned = scan(data_dir, limit=limit)
    samples = []
    for label, files in scanned.items():
        for path in files:
            if is_tif(path):
                filepath = make_tif_preview(
                    path, data_dir, preview_root, max_preview=max_preview
                )
                sample = fo.Sample(filepath=os.path.abspath(filepath))
                sample["source_path"] = os.path.abspath(path)
            else:
                sample = fo.Sample(filepath=os.path.abspath(path))
            sample["dataset"] = fol.Classification(label=label)
            samples.append(sample)

    if samples:
        dataset.add_samples(samples)
    return dataset


def _print_dry_run(data_dir, limit=None):
    """Scan and print, per top-level folder, image count + label. Returns 0."""
    scanned = scan(data_dir, limit=limit)
    if not scanned:
        print(f"No dataset folders found under: {data_dir}")
        return 0
    total = 0
    print(f"Dry-run scan of {os.path.abspath(data_dir)}")
    print(f"{'images':>8}  label")
    print(f"{'-' * 8}  {'-' * 40}")
    for label, files in scanned.items():
        total += len(files)
        print(f"{len(files):>8}  {label}")
    print(f"{'-' * 8}  {'-' * 40}")
    print(f"{total:>8}  (total across {len(scanned)} dataset folders)")
    if limit is not None:
        print(f"(capped at --limit {limit} images per dataset folder)")
    return 0


def main(argv=None):
    parser = argparse.ArgumentParser(
        description="Build a FiftyOne dataset from the GeoTech data/ tree."
    )
    parser.add_argument("--data-dir", default="data", help="Top-level data directory.")
    parser.add_argument("--name", default="geotech", help="FiftyOne dataset name.")
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Scan and report counts only; do not import FiftyOne or make previews.",
    )
    parser.add_argument(
        "--recreate",
        action="store_true",
        help="Delete an existing dataset of this name before building.",
    )
    parser.add_argument(
        "--max-preview",
        type=int,
        default=2000,
        help="Max dimension (px) for generated TIFF RGB previews.",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        help="Cap images per top-level dataset folder (for testing).",
    )
    args = parser.parse_args(argv)

    if args.dry_run:
        return _print_dry_run(args.data_dir, limit=args.limit)

    dataset = build_dataset(
        data_dir=args.data_dir,
        name=args.name,
        recreate=args.recreate,
        max_preview=args.max_preview,
        limit=args.limit,
    )
    print(f"Built FiftyOne dataset '{dataset.name}' with {len(dataset)} samples "
          f"(persistent={dataset.persistent}).")
    print("Launch the app with:  python -c "
          f"\"import fiftyone as fo; fo.launch_app(fo.load_dataset('{dataset.name}')); "
          "input('Press enter to exit...')\"")
    return 0


if __name__ == "__main__":
    sys.exit(main())

#!/bin/bash
# Install a GeoTIFF/TIFF preview stack into the SHARED JupyterHub environment so every
# user's notebooks can open and preview .tif files (multispectral orthomosaics, DEMs, tiles).
# Run as root:  sudo bash install_tif_preview.sh
set -euo pipefail

PYHUB=/opt/jupyterhub/bin/python
echo ">> Using $($PYHUB --version)"

echo ">> Core preview libs (rasterio, numpy, pillow, matplotlib)"
$PYHUB -m pip install --upgrade rasterio numpy pillow matplotlib

echo ">> Interactive in-notebook map viewer (leafmap + localtileserver + ipyleaflet)"
# non-fatal: if the interactive stack fails to build, core preview still works
$PYHUB -m pip install --upgrade leafmap localtileserver ipyleaflet rioxarray || \
  echo "   (interactive extras failed to install - core PNG preview still works)"

echo
echo ">> Verifying"
$PYHUB - <<'PY'
mods = ["rasterio","numpy","PIL","matplotlib"]
for m in mods:
    try:
        __import__(m); print(f"  OK  {m}")
    except Exception as e:
        print(f"  FAIL {m}: {e}")
for m in ["leafmap","localtileserver","ipyleaflet"]:
    try:
        __import__(m); print(f"  OK  {m} (interactive)")
    except Exception as e:
        print(f"  --  {m} not available (interactive optional)")
PY

echo
echo "DONE. Users must RESTART their Jupyter server to pick up the new packages."
echo "Then in a notebook:  from tif_preview import show ; show('data/.../file.tif')"
echo "(point PYTHONPATH at the scripts/ folder, or copy tif_preview.py next to the notebook)"

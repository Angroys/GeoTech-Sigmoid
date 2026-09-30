#!/usr/bin/env bash
# bootstrap_env.sh — RUNS ON THE VM. Sets up the SAM 3 + geo ML environment.
# The deep-learning image (pytorch-2-9-cu129) already ships CUDA 12.9, driver 580
# and PyTorch 2.9, so we only verify torch+CUDA and add SAM 3 + geo libs.
#
# Invoked remotely by run_job.sh / the operator via:
#   gcloud compute ssh <vm> --zone <zone> --project <proj> --command 'bash -s' < bootstrap_env.sh
set -euo pipefail

echo "=== nvidia-smi ==="
nvidia-smi || { echo "GPU/driver not ready yet — the image installs the driver on first boot; re-run shortly."; }

# Prefer the image's preinstalled conda/base python which already has torch+CUDA.
PY="$(command -v python3)"
echo "=== python: $PY ==="
"$PY" -c 'import torch,sys; print("torch",torch.__version__,"cuda_avail",torch.cuda.is_available(),"dev",(torch.cuda.get_device_name(0) if torch.cuda.is_available() else "none"))' \
  || echo "torch not importable in this interpreter (will still install libs)"

echo "=== installing SAM 3 + geo stack ==="
"$PY" -m pip install --upgrade pip
# Geo + imaging stack (the pytorch-2-9-cu129 image already ships torch+CUDA).
"$PY" -m pip install --upgrade \
  rasterio geopandas shapely pyproj scikit-image pillow tqdm
# --- SAM 3 dependency set (order + pins matter) -----------------------------
# The `segment-geospatial[samgeo3]` EXTRA is intentionally AVOIDED: its resolver
# backtracks segment-geospatial to an ancient 0.13.0 (no SamGeo3) and bumps
# numpy to 2.x, which breaks the `sam3` package (needs numpy<2). Instead we pin
# a coherent, verified set and install the SAM3 runtime deps with --no-deps so
# they cannot perturb numpy/opencv:
"$PY" -m pip install "numpy==1.26.4"                      # sam3 requires numpy<2
"$PY" -m pip install --no-deps --force-reinstall "segment-geospatial==1.4.2"  # this version exposes SamGeo3
"$PY" -m pip install "git+https://github.com/facebookresearch/sam3.git"       # sam3 0.1.0 (facebook)
# SAM3's lazy-import chain (discovered empirically) — install each without deps:
"$PY" -m pip install --no-deps einops pycocotools psutil hydra-core omegaconf \
  "antlr4-python3-runtime==4.9.3" decord scikit-learn joblib threadpoolctl

# --- GATED WEIGHTS ----------------------------------------------------------
# facebook/sam3 is a GATED HuggingFace repo. You MUST (1) request access at
# https://huggingface.co/facebook/sam3 and be approved by Meta, then (2) place a
# token that has that access at ~/.cache/huggingface/token (or export HF_TOKEN).
# Without it, SamGeo3(backend="meta", model_id="facebook/sam3") returns HTTP 403.
if [[ -f "$HOME/.cache/huggingface/token" ]]; then
  export HF_TOKEN="$(cat "$HOME/.cache/huggingface/token")"
  echo "HF token present — SAM3 construct will succeed IFF this token is on Meta's authorized list."
else
  echo "WARNING: no HF token at ~/.cache/huggingface/token — SAM3 weights (gated) will 401/403."
fi

echo "=== verify imports ==="
"$PY" - <<'PYEOF'
import importlib
for m in ["torch","rasterio","geopandas","shapely","pyproj","skimage","PIL","numpy","cv2"]:
    try:
        mod = importlib.import_module(m)
        print("OK ", m, getattr(mod, "__version__", ""))
    except Exception as e:
        print("MISS", m, repr(e))
import torch
print("CUDA available:", torch.cuda.is_available())
PYEOF
echo "=== bootstrap complete ==="

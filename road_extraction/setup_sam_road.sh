#!/usr/bin/env bash
# Set up SAM-Road (road network graph extraction) for GeoTech — idempotent.
#
# What it does
#   1. git-clones https://github.com/htcr/sam_road into road_extraction/third_party/sam_road
#      at a PINNED commit (clone approach, NOT vendored: third_party/ is gitignored;
#      re-run this script to recreate it).
#   2. Initialises only the `sam` submodule (htcr/segment-anything-road, a SAM fork)
#      over HTTPS (upstream .gitmodules uses SSH URLs).
#   3. Applies road_extraction/patches/sam_road_compat.patch (minimal torch>=2.6 /
#      optional-wandb compatibility fixes; marked "[geotech-compat]" in the source).
#   4. pip-installs road_extraction/requirements-roads.txt into $PYTHON with a
#      constraints file that pins the CURRENTLY installed torch/torchvision, so the
#      CUDA build of torch is never replaced/downgraded.
#   5. Downloads weights via road_extraction/download_weights.sh (skip with SKIP_WEIGHTS=1).
#
# Licenses
#   - sam_road (htcr/sam_road): MIT License, Copyright (c) 2024 htcr.
#   - Segment Anything / SAM ViT-B weights (facebookresearch/segment-anything, and the
#     htcr/segment-anything-road fork used as the `sam` submodule): Apache License 2.0.
#   - SAM-Road checkpoints: https://huggingface.co/congrui/sam_road (released by the
#     sam_road authors alongside the MIT-licensed code).
#
# Usage
#   bash road_extraction/setup_sam_road.sh
#   PYTHON=/path/to/python SKIP_WEIGHTS=1 SKIP_PIP=1 bash road_extraction/setup_sam_road.sh
set -euo pipefail

SAM_ROAD_REPO="https://github.com/htcr/sam_road.git"
SAM_ROAD_SHA="04b67c503f120ecff2b2dc5a2041ea6d300e306a"   # master @ 2024-08-10
SAM_SUBMODULE_SHA="6fdee8f2727f4506cfbbe553e23b895e27956588" # htcr/segment-anything-road (recorded by sam_road)

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PYTHON="${PYTHON:-/home/minimax/venv/bin/python}"
DEST="$HERE/third_party/sam_road"
PATCH="$HERE/patches/sam_road_compat.patch"

log() { echo "[setup_sam_road] $*"; }

# ---- 1. clone at pinned SHA -------------------------------------------------
if [[ ! -d "$DEST/.git" ]]; then
  log "cloning sam_road into $DEST"
  mkdir -p "$(dirname "$DEST")"
  git clone --quiet "$SAM_ROAD_REPO" "$DEST"
fi
current="$(git -C "$DEST" rev-parse HEAD)"
if [[ "$current" != "$SAM_ROAD_SHA" ]]; then
  log "checking out pinned commit $SAM_ROAD_SHA (was $current)"
  git -C "$DEST" fetch --quiet origin
  git -C "$DEST" reset --quiet --hard
  git -C "$DEST" checkout --quiet "$SAM_ROAD_SHA"
fi

# ---- 2. `sam` submodule over HTTPS ------------------------------------------
if [[ ! -f "$DEST/sam/segment_anything/__init__.py" ]]; then
  log "initialising sam submodule (HTTPS)"
  git -C "$DEST" -c url."https://github.com/".insteadOf="git@github.com:" \
      submodule update --init --quiet sam
fi
sub_sha="$(git -C "$DEST/sam" rev-parse HEAD)"
[[ "$sub_sha" == "$SAM_SUBMODULE_SHA" ]] || { log "ERROR: sam submodule at $sub_sha, expected $SAM_SUBMODULE_SHA"; exit 1; }

# ---- 3. compat patch ---------------------------------------------------------
if git -C "$DEST" apply --reverse --check "$PATCH" >/dev/null 2>&1; then
  log "compat patch already applied"
else
  log "applying $(basename "$PATCH")"
  git -C "$DEST" apply "$PATCH"
fi

# ---- 4. python deps (torch protected) ----------------------------------------
if [[ "${SKIP_PIP:-0}" != "1" ]]; then
  constraints="$(mktemp)"
  trap 'rm -f "$constraints"' EXIT
  "$PYTHON" - >"$constraints" <<'PY'
import torch, torchvision
print(f"torch=={torch.__version__}")
print(f"torchvision=={torchvision.__version__}")
PY
  log "pinning $(tr '\n' ' ' <"$constraints")"
  "$PYTHON" -m pip install --quiet --disable-pip-version-check \
      -r "$HERE/requirements-roads.txt" -c "$constraints"
fi

# ---- 5. weights --------------------------------------------------------------
if [[ "${SKIP_WEIGHTS:-0}" != "1" ]]; then
  bash "$HERE/download_weights.sh"
fi

log "done: sam_road @ ${SAM_ROAD_SHA:0:7} in $DEST"

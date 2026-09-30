#!/usr/bin/env bash
# common.sh — shared config + helpers for the GCP SAM 3 auto-label lifecycle.
# Source this from the other scripts:  source "$(dirname "$0")/common.sh"
#
# Everything here is GCP-native (gcloud). No Azure. Idempotent + absolute-path safe.
set -euo pipefail

# ---------------------------------------------------------------------------
# Projects we may provision into (course-corrected: all projects, in parallel).
# One Spot RTX PRO 6000 VM per project; T4 splits the 311-tile workload across
# whichever VMs come up. AJAI is intentionally INCLUDED (guard removed).
# ---------------------------------------------------------------------------
GCP_PROJECTS=(
  "project-1eef092a-f604-4bbf-b95"   # Personal
  "skilled-acolyte-434515-u9"        # My First Project
  "gen-lang-client-0532041150"       # Default Gemini Project
  "gen-lang-client-0957394607"       # AJAI
  "fir-storage-d1363"                # Firebase storage
)

# Open billing account to (re)link if a project's billing is closed.
BILLING_ACCOUNT="${BILLING_ACCOUNT:-01F25C-F3B980-DCE5F1}"

# ---------------------------------------------------------------------------
# VM / GPU config. G4 (Blackwell) is accelerator-optimized: the GPU is BUNDLED
# with the machine type, so we do NOT pass --accelerator. g4-standard-48 ships
# exactly 1x nvidia-rtx-pro-6000, which matches the default Spot quota (1).
# ---------------------------------------------------------------------------
MACHINE_TYPE="${MACHINE_TYPE:-g4-standard-48}"
GPU_TYPE="nvidia-rtx-pro-6000"
IMAGE_FAMILY="${IMAGE_FAMILY:-pytorch-2-9-cu129-ubuntu-2204-nvidia-580}"  # PyTorch 2.9 + CUDA 12.9 + driver 580 (Blackwell-ready)
IMAGE_PROJECT="${IMAGE_PROJECT:-deeplearning-platform-release}"
BOOT_DISK_SIZE="${BOOT_DISK_SIZE:-250GB}"
BOOT_DISK_TYPE="${BOOT_DISK_TYPE:-hyperdisk-balanced}"  # G4/Blackwell requires Hyperdisk (pd-* is rejected)
INSTANCE_PREFIX="${INSTANCE_PREFIX:-marcaj-sam3}"

# Candidate zones where nvidia-rtx-pro-6000 is offered (discover_zone probes these in order).
CANDIDATE_ZONES=(
  us-central1-b us-central1-c us-central1-f
  us-east1-b us-east1-d us-east4-b us-east4-c
  us-west1-a us-west1-b us-west1-c
  europe-west4-a europe-west4-b europe-west4-c
  europe-west1-b europe-west1-c
  asia-southeast1-a asia-southeast1-b asia-southeast1-c
)

# Cloud Quotas metric for a Spot (preemptible) RTX PRO 6000 GPU.
SPOT_QUOTA_ID="PREEMPTIBLE-NVIDIA-RTX-PRO-6000-GPUS-per-project-region"
SPOT_QUOTA_METRIC="compute.googleapis.com/preemptible_nvidia_rtx_pro_6000_gpus"

# GCS bucket for durable/shareable label outputs (per course correction).
GCS_BUCKET="${GCS_BUCKET:-gs://marcaj-sam3-labels-personal}"
GCS_LOCATION="${GCS_LOCATION:-us-central1}"

# Local data + output paths (MAIN checkout, not the worktree).
REPO_ROOT="/home/minimax/GeoTech-Sigmoid"
TILES_DIR="${REPO_ROOT}/data/marcaj-data/assets_for_participants/01_tiles"
OUT_DIR="${REPO_ROOT}/out_v2"

# SSH user for the deep-learning image.
VM_USER="${VM_USER:-jupyter}"

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
log()  { printf '\033[1;34m[%s]\033[0m %s\n' "$(date +%H:%M:%S)" "$*" >&2; }
warn() { printf '\033[1;33m[warn]\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31m[err]\033[0m %s\n' "$*" >&2; exit 1; }

# instance_name <project> -> deterministic per-project VM name
instance_name() {
  local proj="$1"
  echo "${INSTANCE_PREFIX}-$(echo "$proj" | tr -c 'a-z0-9' '-' | cut -c1-30 | sed 's/-*$//')"
}

# Ensure a project is provisionable: billing linked+open, compute API enabled.
# Idempotent. Returns non-zero if it cannot be made ready.
ensure_project_ready() {
  local proj="$1"
  local billed
  billed="$(gcloud billing projects describe "$proj" --format='value(billingEnabled)' 2>/dev/null || echo False)"
  if [[ "$billed" != "True" ]]; then
    log "[$proj] billing not enabled -> linking to $BILLING_ACCOUNT"
    gcloud billing projects link "$proj" --billing-account="$BILLING_ACCOUNT" >/dev/null 2>&1 \
      || { warn "[$proj] could not link billing"; return 1; }
  fi
  if ! gcloud services list --enabled --project="$proj" \
        --filter="config.name:compute.googleapis.com" --format='value(config.name)' 2>/dev/null \
        | grep -q compute; then
    log "[$proj] enabling compute.googleapis.com"
    gcloud services enable compute.googleapis.com --project="$proj" >/dev/null 2>&1 \
      || { warn "[$proj] could not enable compute API"; return 1; }
  fi
  return 0
}

# spot_quota <project> -> prints the default Spot RTX PRO 6000 per-region limit (integer)
spot_quota() {
  local proj="$1"
  gcloud alpha quotas info describe "$SPOT_QUOTA_ID" \
    --service=compute.googleapis.com --project="$proj" \
    --format='value(dimensionsInfos[0].details.value)' 2>/dev/null | head -1
}

#!/usr/bin/env bash
# discover_zone.sh — find a zone where nvidia-rtx-pro-6000 + the G4 machine type
# are both offered for a given project. Prints the first matching zone on stdout.
# Usage: discover_zone.sh <PROJECT_ID>
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"

PROJECT="${1:?usage: discover_zone.sh <PROJECT_ID>}"

# Zones that actually offer the accelerator, intersected with our candidate order.
mapfile -t OFFERED < <(gcloud compute accelerator-types list --project="$PROJECT" \
  --filter="name=${GPU_TYPE}" --format="value(zone)" 2>/dev/null | sort -u)

is_offered() { local z="$1"; for o in "${OFFERED[@]}"; do [[ "$o" == "$z" ]] && return 0; done; return 1; }

for z in "${CANDIDATE_ZONES[@]}"; do
  is_offered "$z" || continue
  # Confirm the bundled-GPU machine type exists in this zone.
  if gcloud compute machine-types describe "$MACHINE_TYPE" --zone="$z" --project="$PROJECT" \
       --format='value(name)' >/dev/null 2>&1; then
    log "[$PROJECT] selected zone: $z (machine=$MACHINE_TYPE, gpu=$GPU_TYPE)"
    echo "$z"
    exit 0
  fi
done

die "[$PROJECT] no candidate zone offers $MACHINE_TYPE + $GPU_TYPE"

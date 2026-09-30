#!/usr/bin/env bash
# teardown.sh — KEEP-DISK teardown (per course correction):
#   1) ensure the GCS bucket exists,
#   2) mirror label outputs (local out_v2 + optional extra paths) to GCS for durable/shareable access,
#   3) DELETE the VM instance but RETAIN its boot disk (VM was created --no-boot-disk-auto-delete).
# Spot --instance-termination-action=DELETE only deletes the instance, not the
# disk when auto-delete is off — compatible. Idempotent + safe on success or failure.
#
# Usage:
#   teardown.sh <INSTANCE> <ZONE> <PROJECT>   # one VM
#   teardown.sh --all                         # every VM created by this lifecycle
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$HERE/common.sh"

ensure_bucket() {
  if ! gcloud storage ls "$GCS_BUCKET" >/dev/null 2>&1; then
    log "creating GCS bucket $GCS_BUCKET in $GCS_LOCATION"
    gcloud storage buckets create "$GCS_BUCKET" \
      --project="${GCS_PROJECT:-${GCP_PROJECTS[0]}}" \
      --location="$GCS_LOCATION" --uniform-bucket-level-access \
      || warn "bucket create failed (may already exist / name taken)"
  fi
}

mirror_outputs() {
  ensure_bucket
  if [[ -d "$OUT_DIR" ]]; then
    log "mirroring $OUT_DIR -> $GCS_BUCKET/marcaj/"
    gcloud storage rsync -r "$OUT_DIR" "$GCS_BUCKET/marcaj/" || warn "marcaj mirror failed"
  fi
  # Optional extra output roots (e.g. Riseholme SAM3 preds / GT / run report) via EXTRA_OUT_PATHS.
  for p in ${EXTRA_OUT_PATHS:-}; do
    [[ -e "$p" ]] || continue
    log "mirroring $p -> $GCS_BUCKET/extras/$(basename "$p")/"
    gcloud storage rsync -r "$p" "$GCS_BUCKET/extras/$(basename "$p")/" || warn "extra mirror failed: $p"
  done
}

teardown_one() {
  local vm="$1"; local zone="$2"; local proj="$3"
  local st
  st="$(gcloud compute instances describe "$vm" --zone="$zone" --project="$proj" \
        --format='value(status)' 2>/dev/null || true)"
  if [[ -z "$st" ]]; then
    log "[$proj] VM $vm not present in $zone (already deleted) — nothing to do"
    return 0
  fi
  log "[$proj] deleting VM $vm ($zone) — boot disk RETAINED (${vm}-boot)"
  # --keep-disks=all is a belt-and-suspenders on top of --no-boot-disk-auto-delete.
  gcloud compute instances delete "$vm" --zone="$zone" --project="$proj" \
    --keep-disks=all --quiet || warn "[$proj] delete returned non-zero"
  log "[$proj] retained disk: ${vm}-boot (zone $zone). Re-attach later or snapshot from it."
}

mirror_outputs

if [[ "${1:-}" == "--all" ]]; then
  for p in "${GCP_PROJECTS[@]}"; do
    vm="$(instance_name "$p")"
    z="$(gcloud compute instances list --project="$p" --filter="name=$vm" --format='value(zone)' 2>/dev/null | head -1)"
    [[ -n "$z" ]] && teardown_one "$vm" "$z" "$p" || log "[$p] no lifecycle VM found"
  done
  exit 0
fi

teardown_one "${1:?usage: teardown.sh <INSTANCE> <ZONE> <PROJECT> | --all}" "${2:?zone required}" "${3:?project required}"

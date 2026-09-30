#!/usr/bin/env bash
# pull_outputs.sh — pull per-tile GeoJSON+PNG from a VM down to the shared out_v2/
# in the MAIN checkout, and mirror them to the GCS bucket for durable access.
# Usage: pull_outputs.sh <INSTANCE> <ZONE> <PROJECT>
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$HERE/common.sh"

VM="${1:?usage: pull_outputs.sh <INSTANCE> <ZONE> <PROJECT>}"
ZONE="${2:?zone required}"
PROJECT="${3:?project required}"

REMOTE_OUT="/home/${VM_USER}/marcaj/out"
mkdir -p "$OUT_DIR"

log "[$PROJECT/$VM] pulling outputs -> $OUT_DIR"
gcloud compute scp --recurse "${VM}:${REMOTE_OUT}/." "$OUT_DIR/" \
  --zone="$ZONE" --project="$PROJECT" --tunnel-through-iap \
  || warn "[$PROJECT/$VM] scp pull returned non-zero (maybe no outputs yet)"

# Mirror to GCS for durable/shareable access (bucket ensured by teardown/ensure_bucket).
if gcloud storage ls "$GCS_BUCKET" >/dev/null 2>&1; then
  log "mirroring $OUT_DIR -> $GCS_BUCKET/marcaj/"
  gcloud storage rsync -r "$OUT_DIR" "$GCS_BUCKET/marcaj/" || warn "GCS mirror failed"
else
  warn "GCS bucket $GCS_BUCKET does not exist yet; run teardown.sh (it ensures the bucket) or create it."
fi
log "[$PROJECT/$VM] pull_outputs complete"

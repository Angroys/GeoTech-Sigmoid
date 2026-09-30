#!/usr/bin/env bash
# sync_up.sh — push tiles + the python driver up to a VM.
# Usage: sync_up.sh <INSTANCE> <ZONE> <PROJECT> [TILE_SUBSET_GLOB]
#   TILE_SUBSET_GLOB lets T4 send only this VM's shard, e.g. 'siret3_r00[0-4]*'
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$HERE/common.sh"

VM="${1:?usage: sync_up.sh <INSTANCE> <ZONE> <PROJECT> [GLOB]}"
ZONE="${2:?zone required}"
PROJECT="${3:?project required}"
GLOB="${4:-*.tif}"

REMOTE_HOME="/home/${VM_USER}"
REMOTE_TILES="${REMOTE_HOME}/marcaj/tiles"
REMOTE_DRIVER="${REMOTE_HOME}/marcaj"

log "[$PROJECT/$VM] mkdir remote dirs"
gcloud compute ssh "$VM" --zone="$ZONE" --project="$PROJECT" --tunnel-through-iap \
  --command="mkdir -p '$REMOTE_TILES' '$REMOTE_DRIVER'"

# Ship the driver if present (T4 provides the optimized one; ship whatever exists).
if [[ -f "$HERE/sam3_label_driver.py" ]]; then
  log "[$PROJECT/$VM] uploading driver"
  gcloud compute scp "$HERE/sam3_label_driver.py" "${VM}:${REMOTE_DRIVER}/sam3_label_driver.py" \
    --zone="$ZONE" --project="$PROJECT" --tunnel-through-iap
fi

log "[$PROJECT/$VM] rsync tiles matching '$GLOB' from $TILES_DIR"
# gcloud compute scp has no include filter; stage the shard then recurse-copy.
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
shopt -s nullglob
n=0
for f in "$TILES_DIR"/$GLOB; do ln -s "$f" "$STAGE/"; n=$((n+1)); done
log "[$PROJECT/$VM] staged $n tiles"
[[ $n -gt 0 ]] || die "no tiles matched '$GLOB' in $TILES_DIR"

# Use gcloud scp --recurse (dereferences symlinks) for the staged shard.
gcloud compute scp --recurse "$STAGE/." "${VM}:${REMOTE_TILES}/" \
  --zone="$ZONE" --project="$PROJECT" --tunnel-through-iap
log "[$PROJECT/$VM] sync_up complete ($n tiles -> $REMOTE_TILES)"

#!/usr/bin/env bash
# run_job.sh — run the SAM 3 auto-label job on a VM (resume-safe).
# The python driver (provided by T4) MUST write per-tile output as it finishes,
# and skip tiles whose output already exists, so a Spot preemption/restart resumes.
# Usage: run_job.sh <INSTANCE> <ZONE> <PROJECT>
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$HERE/common.sh"

VM="${1:?usage: run_job.sh <INSTANCE> <ZONE> <PROJECT>}"
ZONE="${2:?zone required}"
PROJECT="${3:?project required}"

REMOTE_HOME="/home/${VM_USER}"
REMOTE_DRIVER="${REMOTE_HOME}/marcaj"

log "[$PROJECT/$VM] launching SAM 3 job (nohup, resume-safe)"
gcloud compute ssh "$VM" --zone="$ZONE" --project="$PROJECT" --tunnel-through-iap --command="
  set -e
  cd '$REMOTE_DRIVER'
  mkdir -p out
  if [[ ! -f sam3_label_driver.py ]]; then
    echo 'ERROR: sam3_label_driver.py not present — sync_up it first (T4 owns the driver).'; exit 2
  fi
  # Resume-safe: driver checks out/<tile>.geojson before processing each tile.
  nohup python3 sam3_label_driver.py \
      --tiles ./tiles --out ./out --resume \
      > run.log 2>&1 &
  echo \"started pid \$! ; tail -f $REMOTE_DRIVER/run.log to follow\"
"
log "[$PROJECT/$VM] job launched. Check progress: gcloud compute ssh $VM --zone=$ZONE --project=$PROJECT --command='tail -n40 $REMOTE_DRIVER/run.log'"

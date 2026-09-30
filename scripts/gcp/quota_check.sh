#!/usr/bin/env bash
# quota_check.sh — print RTX PRO 6000 zone(s) + Spot GPU quota status per project.
# Usage:
#   quota_check.sh                 # all projects in GCP_PROJECTS
#   quota_check.sh <PROJECT_ID>    # a single project
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"

check_one() {
  local proj="$1"
  echo "==================================================================="
  echo "PROJECT: $proj"
  echo "-------------------------------------------------------------------"
  local billed api
  billed="$(gcloud billing projects describe "$proj" --format='value(billingEnabled)' 2>/dev/null || echo '?')"
  api="$(gcloud services list --enabled --project="$proj" --filter='config.name:compute.googleapis.com' --format='value(config.name)' 2>/dev/null | head -1)"
  echo "  billing enabled : ${billed:-False}"
  echo "  compute API     : ${api:-DISABLED}"
  if [[ "$billed" != "True" || -z "$api" ]]; then
    echo "  STATUS          : NOT READY (fix billing/API first; ensure_project_ready can do this)"
    return 0
  fi
  local q
  q="$(spot_quota "$proj")"
  echo "  Spot quota id   : $SPOT_QUOTA_ID"
  echo "  Spot metric     : $SPOT_QUOTA_METRIC"
  echo "  Spot GPU limit  : ${q:-unknown} (per project, per region)"
  if [[ "${q:-0}" =~ ^[0-9]+$ ]] && (( q >= 1 )); then
    echo "  STATUS          : PASS (can create ${q}x Spot ${GPU_TYPE})"
  else
    echo "  STATUS          : BLOCKED (Spot quota is ${q:-0}; request a raise for $SPOT_QUOTA_METRIC)"
  fi
}

echo "### RTX PRO 6000 accelerator zones (project-independent) ###"
FIRST="${1:-${GCP_PROJECTS[0]}}"
gcloud compute accelerator-types list --project="$FIRST" \
  --filter="name=${GPU_TYPE}" --format="value(zone)" 2>/dev/null | sort | tr '\n' ' ' || true
echo; echo

if [[ $# -ge 1 ]]; then
  check_one "$1"
else
  for p in "${GCP_PROJECTS[@]}"; do check_one "$p"; done
fi

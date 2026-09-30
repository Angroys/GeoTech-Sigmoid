#!/usr/bin/env bash
# create_vm.sh — create a SPOT RTX PRO 6000 VM in a project.
# G4 is accelerator-optimized: the GPU is bundled with the machine type, so
# NO --accelerator flag is passed. Boot disk is RETAINED on VM deletion
# (--no-boot-disk-auto-delete) per the keep-disk teardown policy.
#
# Usage:
#   create_vm.sh <PROJECT_ID> [ZONE]     # one project (zone auto-discovered if omitted)
#   create_vm.sh --all                   # attempt in every project (parallel), don't let one block others
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$HERE/common.sh"

create_one() {
  local proj="$1"; local zone="${2:-}"
  ensure_project_ready "$proj" || { warn "[$proj] not provisionable"; return 1; }

  local vm; vm="$(instance_name "$proj")"

  # Idempotent: if it already exists, report and stop.
  local existing_zone
  existing_zone="$(gcloud compute instances list --project="$proj" \
      --filter="name=$vm" --format='value(zone)' 2>/dev/null | head -1)"
  if [[ -n "$existing_zone" ]]; then
    log "[$proj] VM $vm already exists in $existing_zone (skipping create)"
    gcloud compute instances describe "$vm" --zone="$existing_zone" --project="$proj" \
      --format='value(status)' 2>/dev/null
    return 0
  fi

  # Zone list to try: caller-given, else all candidate zones offered by this project.
  local zones=()
  if [[ -n "$zone" ]]; then
    zones=("$zone")
  else
    mapfile -t offered < <(gcloud compute accelerator-types list --project="$proj" \
        --filter="name=${GPU_TYPE}" --format="value(zone)" 2>/dev/null | sort -u)
    for z in "${CANDIDATE_ZONES[@]}"; do
      for o in "${offered[@]}"; do [[ "$o" == "$z" ]] && zones+=("$z"); done
    done
  fi
  [[ ${#zones[@]} -gt 0 ]] || { warn "[$proj] no candidate zones offer $GPU_TYPE"; return 1; }

  local z rc
  for z in "${zones[@]}"; do
    log "[$proj] creating Spot $vm in $z ($MACHINE_TYPE, $GPU_TYPE)"
    if gcloud compute instances create "$vm" \
        --project="$proj" \
        --zone="$z" \
        --machine-type="$MACHINE_TYPE" \
        --provisioning-model=SPOT \
        --instance-termination-action=DELETE \
        --no-restart-on-failure \
        --maintenance-policy=TERMINATE \
        --image-family="$IMAGE_FAMILY" \
        --image-project="$IMAGE_PROJECT" \
        --boot-disk-size="$BOOT_DISK_SIZE" \
        --boot-disk-type="$BOOT_DISK_TYPE" \
        --boot-disk-device-name="${vm}-boot" \
        --no-boot-disk-auto-delete \
        --metadata="install-nvidia-driver=True" \
        --scopes=cloud-platform \
        --labels="job=marcaj-sam3,managed-by=gcp-lifecycle" \
        2>&1; then
      log "[$proj] CREATED $vm in $z"
      echo "$proj $vm $z"
      return 0
    fi
    rc=$?
    warn "[$proj] create failed in $z (rc=$rc) — trying next zone if any"
  done
  warn "[$proj] could not create Spot VM in any candidate zone"
  return 1
}

if [[ "${1:-}" == "--all" ]]; then
  pids=();
  for p in "${GCP_PROJECTS[@]}"; do
    ( create_one "$p" ) &  pids+=("$!")
  done
  fail=0
  for pid in "${pids[@]}"; do wait "$pid" || fail=$((fail+1)); done
  log "create --all done ($fail project(s) failed; that's expected for 0-quota/exhausted zones)"
  exit 0
fi

create_one "${1:?usage: create_vm.sh <PROJECT_ID> [ZONE] | --all}" "${2:-}"

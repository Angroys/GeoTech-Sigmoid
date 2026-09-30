#!/usr/bin/env bash
set -e
SUB="44c1a195-4592-48c3-9887-1682ff9a69d2"
LOC="westus3"        # change to swedencentral for EU, canadacentral for H100, etc.
FAMILY="standardNCADSA100v4Family"   # A100 80GB family; H100 = standardNCadsH100v5Family
TARGET=24            # vCPUs. NC24ads_A100_v4 = 24 vCPU (1 GPU). Use 48 for headroom.

SCOPE="/subscriptions/${SUB}/providers/Microsoft.Compute/locations/${LOC}"

echo "=== Install quota extension (idempotent) ==="
az extension add --name quota --only-show-errors 2>/dev/null || az extension update --name quota --only-show-errors

echo "=== Current quota for ${FAMILY} in ${LOC} ==="
az quota show --resource-name "$FAMILY" --scope "$SCOPE" \
  --query "{Name:name, Limit:properties.limit.value}" -o table 2>/dev/null \
  || echo "(could not read current quota — name may differ; run the 'list' command below)"

echo "=== Submitting request to raise limit to ${TARGET} vCPUs ==="
az quota update --resource-name "$FAMILY" --scope "$SCOPE" \
  --limit-object value=$TARGET --resource-type dedicated -o table

echo "=== Done. Track status in portal: Subscriptions > Usage + quotas ==="

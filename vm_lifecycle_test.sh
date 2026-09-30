#!/usr/bin/env bash
set -e
RG="rg-vmtest"
LOC="westus3"
VM="testvm"

echo "=== Create resource group ==="
az group create -n "$RG" -l "$LOC" -o table

echo "=== Create a tiny VM (Standard_B1s, cheap) ==="
az vm create \
  -g "$RG" -n "$VM" \
  --image Ubuntu2204 \
  --size Standard_B1s \
  --admin-username azureuser \
  --generate-ssh-keys \
  -o table

echo "=== Stop (deallocate = stops billing for compute) ==="
az vm deallocate -g "$RG" -n "$VM"
echo "   deallocated."

echo "=== Start again ==="
az vm start -g "$RG" -n "$VM"
echo "   started."

echo "=== Deallocate + DELETE everything (no leftover charges) ==="
az vm deallocate -g "$RG" -n "$VM"
az group delete -n "$RG" --yes --no-wait
echo "=== DONE (resource group deleting in background) ==="

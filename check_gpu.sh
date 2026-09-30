#!/usr/bin/env bash
set -e

echo "=== 1. Register required resource providers ==="
az provider register -n Microsoft.Compute
az provider register -n Microsoft.Network
az provider register -n Microsoft.Storage

echo "=== 2. Wait for Microsoft.Compute to finish registering ==="
until [ "$(az provider show -n Microsoft.Compute --query registrationState -o tsv)" = "Registered" ]; do
  echo "   still registering... (waiting 15s)"
  sleep 15
done
echo "   Microsoft.Compute: Registered"

echo "=== 3. GPU quota (A100 / H100) in eastus ==="
az vm list-usage --location eastus \
  --query "[?contains(localName,'A100')||contains(localName,'H100')].{Name:localName, Current:currentValue, Limit:limit}" \
  -o table

echo "=== 4. Any region where A100/H100 is NOT gated for your subscription ==="
az vm list-skus --all \
  --query "[?(contains(name,'A100')||contains(name,'H100')) && restrictions[0].reasonCode==null].{Name:name, Location:locationInfo[0].location}" \
  -o table

echo "=== 5. Full A100/H100 SKU status in eastus (for reference) ==="
az vm list-skus --location eastus --size Standard_NC --all \
  --query "[?contains(name,'A100')||contains(name,'H100')].{Name:name, Restriction:restrictions[0].reasonCode}" \
  -o table

echo "=== DONE ==="

#!/bin/bash
# Ensure bogdan_perju, anastasia_danu and calin all have working read+write access:
# group membership + a live bind-mounted folder in each home + fstab persistence.
# Idempotent. Run as root:  sudo bash fix_all_access.sh
set -euo pipefail

REPO=/home/minimax/GeoTech-Sigmoid
GROUP=geoshare
USERS=(bogdan_perju anastasia_danu calin)

getent group "$GROUP" >/dev/null || groupadd "$GROUP"

for GUEST in "${USERS[@]}"; do
  echo "==== $GUEST ===="
  if ! id "$GUEST" >/dev/null 2>&1; then echo "  !! no such user, skipping"; continue; fi
  usermod -aG "$GROUP" "$GUEST"

  MP=/home/"$GUEST"/GeoTech-Sigmoid
  [ -L "$MP" ] && rm -f "$MP"        # drop any old symlink
  mkdir -p "$MP"                      # ensure real mountpoint dir exists
  chown "$GUEST":"$GUEST" "$MP"

  if mountpoint -q "$MP"; then
    echo "  already mounted"
  else
    mount --bind "$REPO" "$MP"
    echo "  bind-mounted"
  fi

  FSTAB_LINE="$REPO $MP none bind 0 0"
  grep -qsF "$FSTAB_LINE" /etc/fstab || echo "$FSTAB_LINE" >> /etc/fstab
done

echo
echo "=== verification ==="
getent group "$GROUP"
for GUEST in "${USERS[@]}"; do
  MP=/home/"$GUEST"/GeoTech-Sigmoid
  printf "%-16s " "$GUEST:"
  mountpoint -q "$MP" && echo "MOUNTED ($(ls "$MP" | wc -l) entries)" || echo "NOT MOUNTED"
done
echo
echo "DONE. Each user must RESTART their Jupyter server (Hub Control Panel >"
echo "Stop My Server, then Start My Server) to pick up group membership + see the folder."

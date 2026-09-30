#!/bin/bash
# Grant read+write repo access to anastasia_danu and calin (bind-mounted into each home
# for JupyterLab). Repo is already group-shared via 'geoshare' + setgid.
# Run as root:  sudo bash grant_team_access.sh
set -euo pipefail

REPO=/home/minimax/GeoTech-Sigmoid
GROUP=geoshare
USERS=(anastasia_danu calin)

getent group "$GROUP" >/dev/null || groupadd "$GROUP"

for GUEST in "${USERS[@]}"; do
  echo "==== $GUEST ===="
  if ! id "$GUEST" >/dev/null 2>&1; then echo "  !! user $GUEST does not exist, skipping"; continue; fi
  echo ">> Adding $GUEST to '$GROUP'"
  usermod -aG "$GROUP" "$GUEST"

  MP=/home/"$GUEST"/GeoTech-Sigmoid
  echo ">> Creating real mountpoint + bind mount at $MP"
  [ -L "$MP" ] && rm -f "$MP"
  mkdir -p "$MP"
  chown "$GUEST":"$GUEST" "$MP"
  if mountpoint -q "$MP"; then echo "   already mounted"; else mount --bind "$REPO" "$MP"; fi

  FSTAB_LINE="$REPO $MP none bind 0 0"
  grep -qsF "$FSTAB_LINE" /etc/fstab || echo "$FSTAB_LINE" >> /etc/fstab
  echo "   done."
done

echo
echo "DONE. Both users now have read+write to the repo via '$GROUP' and a folder in their home."
echo "IMPORTANT: each user must RESTART their Jupyter server (File > Hub Control Panel >"
echo "Stop My Server, then Start My Server) to pick up the group + see the folder."

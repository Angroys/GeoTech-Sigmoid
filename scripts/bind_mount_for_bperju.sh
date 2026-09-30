#!/bin/bash
# Replace the symlink in bperju's home with a bind mount so JupyterLab shows it
# as a real folder (JupyterLab won't follow symlinks outside the server root).
# Run as root:  sudo bash bind_mount_for_bperju.sh
set -euo pipefail

REPO=/home/minimax/GeoTech-Sigmoid
GUEST=bperju
MP=/home/"$GUEST"/GeoTech-Sigmoid

echo ">> Removing old symlink if present"
[ -L "$MP" ] && rm -f "$MP"

echo ">> Creating real mountpoint directory"
mkdir -p "$MP"
chown "$GUEST":"$GUEST" "$MP"

echo ">> Bind-mounting repo into bperju's home"
if mountpoint -q "$MP"; then
  echo "   already mounted, skipping"
else
  mount --bind "$REPO" "$MP"
fi

echo ">> Making the bind mount persist across reboots (/etc/fstab)"
FSTAB_LINE="$REPO $MP none bind 0 0"
grep -qsF "$FSTAB_LINE" /etc/fstab || echo "$FSTAB_LINE" >> /etc/fstab

echo
echo "DONE. bperju now has a real folder: $MP"
echo "IMPORTANT: bperju must RESTART his Jupyter server for write access + the new folder:"
echo "  In JupyterHub:  File > Hub Control Panel > Stop My Server, then Start My Server"
echo "  (this refreshes his group membership so 'geoshare' write access applies)."

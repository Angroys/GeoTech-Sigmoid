#!/bin/bash
# Grant read+write repo access to bogdan_perju (bind-mounted into his home for JupyterLab),
# and undo the earlier setup that targeted the wrong account 'bperju'.
# Run as root:  sudo bash grant_bogdan_perju_access.sh
set -euo pipefail

REPO=/home/minimax/GeoTech-Sigmoid
GROUP=geoshare
GUEST=bogdan_perju
MP=/home/"$GUEST"/GeoTech-Sigmoid

echo ">> Adding $GUEST to '$GROUP' (repo is already group-shared + setgid)"
usermod -aG "$GROUP" "$GUEST"

echo ">> Creating real mountpoint in $GUEST's home"
[ -L "$MP" ] && rm -f "$MP"
mkdir -p "$MP"
chown "$GUEST":"$GUEST" "$MP"

echo ">> Bind-mounting repo into $GUEST's home"
if mountpoint -q "$MP"; then echo "   already mounted"; else mount --bind "$REPO" "$MP"; fi

echo ">> Persisting bind mount in /etc/fstab"
FSTAB_LINE="$REPO $MP none bind 0 0"
grep -qsF "$FSTAB_LINE" /etc/fstab || echo "$FSTAB_LINE" >> /etc/fstab

echo
echo ">> Cleaning up the earlier (wrong) 'bperju' setup"
WRONG=/home/bperju/GeoTech-Sigmoid
if mountpoint -q "$WRONG"; then umount "$WRONG" && rmdir "$WRONG" 2>/dev/null || true; fi
[ -L "$WRONG" ] && rm -f "$WRONG"
# remove the wrong fstab line if it was added
sed -i "\#$REPO /home/bperju/GeoTech-Sigmoid none bind 0 0#d" /etc/fstab 2>/dev/null || true
gpasswd -d bperju "$GROUP" 2>/dev/null || true

echo
echo "DONE. $GUEST now has a real folder: $MP (read+write)."
echo "IMPORTANT: $GUEST must RESTART his Jupyter server to pick up the group + see the folder:"
echo "  JupyterHub: File > Hub Control Panel > Stop My Server, then Start My Server."

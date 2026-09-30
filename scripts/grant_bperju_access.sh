#!/bin/bash
# Grant user 'bperju' read+write access to the GeoTech-Sigmoid repo via a shared group,
# and create a shortcut to it in bperju's home. Run as root:  sudo bash grant_bperju_access.sh
set -euo pipefail

GROUP=geoshare
REPO=/home/minimax/GeoTech-Sigmoid
OWNER=minimax
GUEST=bperju

echo ">> Ensuring shared group '$GROUP' exists"
getent group "$GROUP" >/dev/null || groupadd "$GROUP"

echo ">> Adding $OWNER and $GUEST to '$GROUP'"
usermod -aG "$GROUP" "$OWNER"
usermod -aG "$GROUP" "$GUEST"

echo ">> Setting group ownership on repo (this touches all files; metadata only)"
chgrp -R "$GROUP" "$REPO"

echo ">> Granting group read/write; execute only where appropriate (dirs / already-exec files)"
chmod -R g+rwX "$REPO"

echo ">> Setting setgid on directories so NEW files inherit the '$GROUP' group"
find "$REPO" -type d -exec chmod g+s {} +

echo ">> Ensuring $GUEST can traverse into $OWNER's home to reach the repo"
chmod o+x /home/"$OWNER"

echo ">> Creating shortcut /home/$GUEST/GeoTech-Sigmoid -> $REPO"
ln -sfn "$REPO" /home/"$GUEST"/GeoTech-Sigmoid
chown -h "$GUEST":"$GUEST" /home/"$GUEST"/GeoTech-Sigmoid

echo
echo "DONE."
echo "IMPORTANT: group membership only applies to NEW logins."
echo "  - $GUEST must log out and back in (or run 'newgrp $GROUP') before write access works."
echo "  - Same for $OWNER if you want newly created files to land in group '$GROUP'."

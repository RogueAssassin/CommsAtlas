#!/bin/sh
# CommsAtlas uninstaller: removes the server, its data and every copy of it, for a clean slate before a fresh install.
#   sudo sh uninstall-server.sh            asks you to type DELETE first
#   sudo sh uninstall-server.sh --yes      no question
#   (the CommsAtlas-<build>.run file runs this too:  sudo sh CommsAtlas-<build>.run --uninstall)
#   --remove-nginx                         also remove the CommsAtlas nginx site and its certbot certificate (kept by default: it
#                                          holds no CommsAtlas data, and a fresh install can use it as it is)
#   --app DIR / --data DIR                 where it was installed (defaults /opt/commsatlas and /var/lib/commsatlas)
# What goes: the systemd service, the program (and the copy kept for roll-back), the data folder with the database, its daily copies and
# the copies made before each update, the "commsatlas" system user, its nginx logs, and (for the user who runs sudo) the downloaded
# CommsAtlas-*.zip files and commsatlas-stage* folders in their home folder. The .NET runtime and nginx are shared and stay.
# This cannot be undone: nothing is moved aside, it is deleted.
set -u
APP=/opt/commsatlas
DATA=/var/lib/commsatlas
YES=0
NGINX=keep
while [ $# -gt 0 ]; do
  case "$1" in
    --yes) YES=1; shift;;
    --remove-nginx) NGINX=remove; shift;;
    --app) APP=${2:?--app needs a folder}; shift 2;;
    --data) DATA=${2:?--data needs a folder}; shift 2;;
    -h|--help) sed -n '2,12p' "$0"; exit 0;;
    *) echo "Unknown option: $1"; exit 2;;
  esac
done
[ "$(id -u)" -eq 0 ] || { echo "Run this with sudo."; exit 1; }
say() { printf '%s\n' "$*"; }

HOME_DIR=""
if [ -n "${SUDO_USER:-}" ]; then HOME_DIR=$(getent passwd "$SUDO_USER" | cut -d: -f6); fi

say "This will permanently delete CommsAtlas from this machine:"
say "  - the service (commsatlas.service)"
say "  - $APP and $APP.previous"
say "  - $DATA (database, daily copies, copies made before updates)"
say "  - the commsatlas system user, its nginx logs"
[ -n "$HOME_DIR" ] && say "  - $HOME_DIR/CommsAtlas-*.zip, CommsAtlas-*.run and $HOME_DIR/commsatlas-stage*"
[ "$NGINX" = remove ] && say "  - the CommsAtlas nginx site and its certbot certificate" || say "  (the nginx site and its certificate are kept)"
if [ "$YES" -ne 1 ]; then
  printf 'Type DELETE to go ahead: '
  read -r ANSWER
  [ "$ANSWER" = "DELETE" ] || { say "Nothing was changed."; exit 1; }
fi

say "Stopping the service..."
systemctl stop commsatlas 2>/dev/null || true
systemctl disable commsatlas >/dev/null 2>&1 || true
rm -f /etc/systemd/system/commsatlas.service
systemctl daemon-reload
systemctl reset-failed commsatlas 2>/dev/null || true

say "Deleting the program and the data..."
rm -rf "$APP" "$APP.previous" "$DATA"
rm -rf /var/tmp/systemd-private-*-commsatlas.service-* 2>/dev/null || true

say "Removing the commsatlas user..."
id commsatlas >/dev/null 2>&1 && userdel commsatlas 2>/dev/null || true
getent group commsatlas >/dev/null 2>&1 && groupdel commsatlas 2>/dev/null || true

say "Clearing the nginx logs (the log folder stays, nginx needs it)..."
for d in /var/log/nginx/commsatlas*; do [ -d "$d" ] && find "$d" -type f -delete; done 2>/dev/null || true

if [ -n "$HOME_DIR" ]; then
  say "Deleting the downloaded packages and staging folders in $HOME_DIR..."
  rm -f "$HOME_DIR"/CommsAtlas-*.zip "$HOME_DIR"/CommsAtlas-*.run
  rm -rf "$HOME_DIR"/commsatlas-stage*
fi

if [ "$NGINX" = remove ]; then
  say "Removing the CommsAtlas nginx site and certificate..."
  for f in $(grep -rIl -i commsatlas /etc/nginx/sites-enabled /etc/nginx/sites-available /etc/nginx/conf.d 2>/dev/null); do rm -f "$f"; done
  for l in /etc/nginx/sites-enabled/*commsatlas*; do [ -L "$l" ] && rm -f "$l"; done
  if nginx -t >/dev/null 2>&1; then systemctl reload nginx; else nginx -t; say "nginx did not accept the change: check it by hand."; fi
  for c in $(ls /etc/letsencrypt/live 2>/dev/null | grep -i commsatlas); do certbot delete --cert-name "$c" --non-interactive 2>/dev/null || true; done
  rm -rf /etc/letsencrypt/renewal-hooks/deploy/commsatlas-nginx.sh
fi

say ""
say "Left on this machine (check yourself): $(find / -xdev -iname '*commsatlas*' -not -path '/proc/*' -not -path '/var/log/nginx/*' -not -path '/etc/nginx/*' -not -path '/etc/letsencrypt/*' -not -path '/var/www/*' 2>/dev/null | head -5 | tr '\n' ' ')"
say "CommsAtlas has been removed."

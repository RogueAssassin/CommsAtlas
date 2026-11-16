#!/bin/sh
# CommsAtlas @@BUILD@@: one self-extracting file. It carries the server program (the web app is inside it), the installer and
# updater, the uninstaller and the documents. Nothing is left behind in the folder you run it from.
#
#   sudo sh CommsAtlas-@@BUILD@@.run                 install, or update an existing install (see --help for options)
#   sh CommsAtlas-@@BUILD@@.run --check              change nothing; say what an install or update would do
#   sh CommsAtlas-@@BUILD@@.run --extract DIR        only unpack the files into DIR (to read INSTALL.md, or to uninstall)
#   sh CommsAtlas-@@BUILD@@.run --info               build number and the file's SHA-256
#   sudo sh CommsAtlas-@@BUILD@@.run --uninstall     remove CommsAtlas from this machine (asks you to type DELETE)
# Every other option goes to the installer: --domain, --tls, --port, --data, --keep-backups, --no-nginx, --nginx, --help.
set -eu
PAYLOAD_SHA256=@@SHA@@
BUILD=@@BUILD@@

SELF=$0
START=$(awk '/^__PAYLOAD_BELOW__$/ { print NR + 1; exit }' "$SELF")
[ -n "$START" ] || { echo "ERROR: this file is damaged (no payload marker)." >&2; exit 1; }

case "${1:-}" in
  --info) echo "CommsAtlas build $BUILD"; echo "payload sha256 $PAYLOAD_SHA256"; echo "file sha256    $(sha256sum "$SELF" | cut -d' ' -f1)"; exit 0;;
esac

command -v tar >/dev/null 2>&1 || { echo "ERROR: tar is needed to unpack this file." >&2; exit 1; }
if command -v sha256sum >/dev/null 2>&1; then
  GOT=$(tail -n +"$START" "$SELF" | sha256sum | cut -d' ' -f1)
  [ "$GOT" = "$PAYLOAD_SHA256" ] || { echo "ERROR: this file does not match its checksum (damaged or changed in transit). Copy it again." >&2; exit 1; }
fi

if [ "${1:-}" = "--extract" ]; then
  [ $# -ge 2 ] || { echo "ERROR: --extract needs a folder." >&2; exit 1; }
  mkdir -p "$2"
  tail -n +"$START" "$SELF" | tar xzf - -C "$2"
  chmod 755 "$2/CommsAtlas.Server" 2>/dev/null || true
  echo "Unpacked into $2"
  exit 0
fi

export COMMSATLAS_PACKAGE="$SELF"
TMPD=$(mktemp -d)
trap 'rm -rf "$TMPD"' EXIT INT TERM
tail -n +"$START" "$SELF" | tar xzf - -C "$TMPD"
chmod 755 "$TMPD/CommsAtlas.Server"
if [ "${1:-}" = "--uninstall" ]; then shift; sh "$TMPD/uninstall-server.sh" "$@"; exit $?; fi
sh "$TMPD/install-server.sh" "$@"
exit $?
__PAYLOAD_BELOW__

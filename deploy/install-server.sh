#!/bin/sh
# CommsAtlas installer AND updater for Ubuntu / Debian (64-bit Intel/AMD).
#
#   sudo sh CommsAtlas-<build>.run                     new server: install, on port 80 of this machine
#   sudo sh CommsAtlas-<build>.run --domain atlas.example.com --tls
#                                                       new server with its own name and a free Let's Encrypt certificate
#   sudo sh CommsAtlas-<build>.run                     existing server: the same command UPDATES it (accounts, records,
#                                                       settings and your web-server setup are kept)
#   sh CommsAtlas-<build>.run --check                  changes nothing; says what it would do
#
# This script travels inside the CommsAtlas-<build>.run file, which unpacks it and runs it; it can also be run by hand from a folder
# made with  sh CommsAtlas-<build>.run --extract DIR  (it uses the CommsAtlas.Server program file next to it).
set -eu

HERE=$(cd "$(dirname "$0")" && pwd)
SRC="$HERE"                   # CommsAtlas.Server (one file, the web app inside), appsettings.json and build.txt
APP=/opt/commsatlas
DATA=/var/lib/commsatlas
PORT=5080
DOMAIN=""
EMAIL=""
TLS=0
KEEP=2             # how many saved database copies from earlier updates to keep
NGINX=auto          # auto | no | force
CHECK=0
SITE=commsatlas

say()  { printf '%s\n' "$*"; }
die()  { printf 'ERROR: %s\n' "$*" >&2; exit 1; }
usage() {
cat <<'EOF'
CommsAtlas installer / updater (Ubuntu or Debian, 64-bit Intel/AMD)

  sudo sh CommsAtlas-<build>.run [options]

  --domain NAME    the web address people will use (e.g. atlas.example.com). Without it the site answers on this machine's address.
  --tls            get and renew a free Let's Encrypt certificate for --domain and serve https (needs port 80 reachable from the internet)
  --email ADDRESS  contact address for the certificate (optional)
  --port N         the port the CommsAtlas server listens on, on this machine only (default 5080)
  --data DIR       where the database lives (default /var/lib/commsatlas). Back this folder up.
  --keep-backups N how many database copies saved at update time to keep (default 2; older ones are deleted)
  --no-nginx       do not touch any web server (run your own proxy to 127.0.0.1:PORT)
  --nginx          write the CommsAtlas nginx site again even if one is already there
  --check          change nothing; show whether this is a new install or an update, and what would happen
  --help           this text

The same command installs on a new machine and updates an existing install. An update keeps the data folder and appsettings.json,
saves a copy of the database first, keeps the old program in /opt/commsatlas.previous, and puts it back by itself if the new one does not start.
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --domain)   [ $# -ge 2 ] || die "--domain needs a value"; DOMAIN=$2; shift 2;;
    --email)    [ $# -ge 2 ] || die "--email needs a value"; EMAIL=$2; shift 2;;
    --port)     [ $# -ge 2 ] || die "--port needs a value"; PORT=$2; shift 2;;
    --data)     [ $# -ge 2 ] || die "--data needs a value"; DATA=$2; shift 2;;
    --keep-backups) [ $# -ge 2 ] || die "--keep-backups needs a value"; KEEP=$2; shift 2;;
    --tls)      TLS=1; shift;;
    --no-nginx) NGINX=no; shift;;
    --nginx)    NGINX=force; shift;;
    --check)    CHECK=1; shift;;
    -h|--help)  usage; exit 0;;
    *) usage; die "unknown option: $1";;
  esac
done

case "$PORT" in ''|*[!0-9]*) die "--port must be a number";; esac
case "$KEEP" in ''|*[!0-9]*) die "--keep-backups must be a number";; esac
[ "$KEEP" -ge 1 ] || die "--keep-backups must be at least 1"
[ "$PORT" -ge 1 ] && [ "$PORT" -le 65535 ] || die "--port must be 1-65535"
case "$DOMAIN" in *[!A-Za-z0-9.-]*) die "--domain may only contain letters, digits, dots and dashes";; esac
case "$EMAIL" in *[!A-Za-z0-9.@+_-]*) die "--email has characters that are not allowed";; esac
case "$DATA" in /*) ;; *) die "--data must be a full path";; esac
case "$DATA" in *[!A-Za-z0-9/_.-]*) die "--data may only contain letters, digits and / _ . -";; esac
[ "$TLS" -eq 0 ] || [ -n "$DOMAIN" ] || die "--tls needs --domain"

# ---------- checks ----------
[ "$(uname -s)" = Linux ] || die "this installer is for Linux. See INSTALL.md for other systems."
case "$(uname -m)" in x86_64|amd64) ;; *) die "this package is built for 64-bit Intel/AMD (linux-x64); this machine is $(uname -m). Build a matching server with build.ps1 -Runtime linux-arm64 (see INSTALL.md).";; esac
command -v apt-get >/dev/null 2>&1 || die "this installer supports Ubuntu and Debian (apt). See INSTALL.md to install by hand."
command -v systemctl >/dev/null 2>&1 || die "systemd was not found. See INSTALL.md to install by hand."
[ -f "$SRC/CommsAtlas.Server" ] || die "the CommsAtlas.Server program file is not next to this script ($HERE). Run the installer through the CommsAtlas-<build>.run file."

MODE=install
{ [ -f "$APP/CommsAtlas.Server" ] || [ -f "$APP/CommsAtlas.Server.dll" ]; } && MODE=update
OLD_BUILD=""; [ -f "$APP/build.txt" ] && OLD_BUILD=$(cat "$APP/build.txt" 2>/dev/null || true)
NEW_BUILD=$(cat "$SRC/build.txt" 2>/dev/null || echo "?")

# Is there already a web-server site sending people to this port?
NGINX_HAS_SITE=0
if grep -RqsE "proxy_pass[[:space:]]+http://(127\.0\.0\.1|localhost):$PORT" /etc/nginx/sites-enabled /etc/nginx/conf.d 2>/dev/null; then NGINX_HAS_SITE=1; fi
NGINX_PLAN=configure
if [ "$NGINX" = no ]; then NGINX_PLAN="skip (--no-nginx)"
elif [ "$NGINX" = auto ] && [ "$NGINX_HAS_SITE" -eq 1 ]; then NGINX_PLAN="keep the existing nginx site as it is"
elif [ "$NGINX" = auto ] && ! command -v nginx >/dev/null 2>&1 && command -v ss >/dev/null 2>&1 && ss -ltn 2>/dev/null | grep -qE '[:.]80[[:space:]]'; then NGINX_PLAN="skip (port 80 is already used by another web server; point it at 127.0.0.1:$PORT)"; NGINX=no
fi

say "CommsAtlas installer"
say "  Mode:        $MODE$( [ "$MODE" = update ] && printf ' (build %s -> %s)' "${OLD_BUILD:-unknown}" "$NEW_BUILD" || printf ' (build %s)' "$NEW_BUILD")"
say "  Program:     $APP"
say "  Data:        $DATA"
say "  Listens on:  127.0.0.1:$PORT"
say "  Web server:  $NGINX_PLAN$( [ -n "$DOMAIN" ] && printf ', name %s' "$DOMAIN")$( [ "$TLS" -eq 1 ] && printf ', https via Let'"'"'s Encrypt')"
if [ "$CHECK" -eq 1 ]; then say "Check only: nothing was changed."; exit 0; fi
[ "$(id -u)" -eq 0 ] || die "run this as root:  sudo sh ${COMMSATLAS_PACKAGE:-$0} $*"

TMPD=$(mktemp -d)
trap 'rm -rf "$TMPD"' EXIT

# ---------- 1. runtime and tools ----------
say "1/6 Installing what CommsAtlas needs (.NET 10 ASP.NET Core runtime)..."
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq curl ca-certificates >/dev/null
if ! dotnet --list-runtimes 2>/dev/null | grep -q 'Microsoft.AspNetCore.App 10\.'; then
  if ! apt-get install -y -qq aspnetcore-runtime-10.0 >/dev/null 2>&1; then
    say "    apt has no aspnetcore-runtime-10.0; using Microsoft's installer"
    apt-get install -y -qq libicu-dev >/dev/null 2>&1 || true
    curl -fsSL https://dot.net/v1/dotnet-install.sh -o "$TMPD/dotnet-install.sh" || die "could not download Microsoft's .NET installer (is this machine online?)"
    bash "$TMPD/dotnet-install.sh" --channel 10.0 --runtime aspnetcore --install-dir /usr/share/dotnet
    ln -sf /usr/share/dotnet/dotnet /usr/bin/dotnet
  fi
fi
dotnet --list-runtimes | grep -q 'Microsoft.AspNetCore.App 10\.' || die "the ASP.NET Core 10 runtime did not install."
DOTNET=$(command -v dotnet)
DOTNET_ROOT=$(dirname "$(readlink -f "$DOTNET")")      # where the runtime lives: the program file looks here for it

# ---------- 2. the program ----------
say "2/6 Putting the program in place..."
id commsatlas >/dev/null 2>&1 || useradd --system --home "$APP" --shell /usr/sbin/nologin commsatlas
mkdir -p "$DATA"
mkdir "$TMPD/new"
for f in CommsAtlas.Server appsettings.json build.txt; do [ -f "$SRC/$f" ] && cp -p "$SRC/$f" "$TMPD/new/$f"; done
[ -f "$TMPD/new/CommsAtlas.Server" ] || die "this does not look like a CommsAtlas package (no CommsAtlas.Server program file)."
chmod 755 "$TMPD/new/CommsAtlas.Server"

systemctl stop commsatlas 2>/dev/null || true
if [ "$MODE" = update ]; then
  if [ -f "$DATA/commsatlas.db" ]; then
    SAVE="$DATA/backups/pre-update-$(date +%Y%m%d-%H%M%S)"
    mkdir -p "$SAVE"
    cp -p "$DATA"/commsatlas.db* "$SAVE"/ 2>/dev/null || true
    say "    Saved a copy of the database in $SAVE"
  fi
  # Only the newest few copies from earlier updates are kept, so they do not pile up.
  ls -1d "$DATA"/backups/pre-update-* 2>/dev/null | sort -r | tail -n +$((KEEP + 1)) | while read -r old; do rm -rf "$old"; done
  say "    Keeping the newest $KEEP update backup(s) in $DATA/backups."
  rm -rf "$APP.previous"
  mv "$APP" "$APP.previous"
fi
mkdir -p "$APP"
cp -a "$TMPD/new"/. "$APP"/
if [ "$MODE" = update ] && [ -f "$APP.previous/appsettings.json" ]; then
  if ! cmp -s "$APP/appsettings.json" "$APP.previous/appsettings.json"; then
    cp "$APP/appsettings.json" "$APP/appsettings.json.new"       # what the new build ships, for comparison
    say "    Kept your appsettings.json. The new build's own copy is appsettings.json.new if you want to compare."
  fi
  cp -p "$APP.previous/appsettings.json" "$APP/appsettings.json"
fi
chown -R root:root "$APP"; chmod -R go-w "$APP"
mkdir -p "$DATA/.bundle"
chown -R commsatlas:commsatlas "$DATA"; chmod 750 "$DATA"

# ---------- 3. the service ----------
say "3/6 Setting up the service..."
cat >/etc/systemd/system/commsatlas.service <<EOF
[Unit]
Description=CommsAtlas (comms room, rack and patch documentation)
After=network.target

[Service]
WorkingDirectory=$APP
ExecStart=$APP/CommsAtlas.Server --urls http://127.0.0.1:$PORT
User=commsatlas
Group=commsatlas
Restart=always
RestartSec=3
Environment=ASPNETCORE_ENVIRONMENT=Production
Environment=DOTNET_gcServer=0
Environment=DOTNET_ROOT=$DOTNET_ROOT
Environment=DOTNET_BUNDLE_EXTRACT_BASE_DIR=$DATA/.bundle
Environment=CommsAtlas__DataPath=$DATA
# Hardening: the service can only write its own data folder.
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
ReadWritePaths=$DATA

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable commsatlas >/dev/null 2>&1
systemctl restart commsatlas

# ---------- 4. does it start? ----------
say "4/6 Waiting for it to start..."
OK=0; i=0
while [ $i -lt 40 ]; do
  if curl -fsS "http://127.0.0.1:$PORT/api/v1/health" >"$TMPD/health" 2>/dev/null; then OK=1; break; fi
  i=$((i+1)); sleep 1
done
if [ "$OK" -ne 1 ]; then
  say "The new build did not start. Last lines of its log:"
  journalctl -u commsatlas -n 25 --no-pager 2>/dev/null || true
  if [ "$MODE" = update ] && [ -d "$APP.previous" ]; then
    say "Putting the previous version back..."
    systemctl stop commsatlas || true
    rm -rf "$APP"; mv "$APP.previous" "$APP"
    systemctl start commsatlas || true
    die "update failed; the previous version is running again. Your data is unchanged except for any upgrade the new build began (a copy from before is in ${SAVE:-the data folder's backups})."
  fi
  die "it did not start. See the log above (journalctl -u commsatlas)."
fi
say "    Running: $(cat "$TMPD/health")"

# ---------- 5. web server ----------
say "5/6 Web server..."
WROTE_SITE=0
if [ "$NGINX" = no ]; then
  say "    Skipped. Point your own web server or proxy at http://127.0.0.1:$PORT (see INSTALL.md)."
elif [ "$NGINX" = auto ] && [ "$NGINX_HAS_SITE" -eq 1 ]; then
  say "    An nginx site for this server already exists; left as it is (use --nginx to write a fresh one)."
else
  command -v nginx >/dev/null 2>&1 || apt-get install -y -qq nginx >/dev/null
  if [ -d /etc/nginx/sites-available ]; then SITEFILE=/etc/nginx/sites-available/$SITE; else SITEFILE=/etc/nginx/conf.d/$SITE.conf; fi
  WEBROOT=/var/www/commsatlas/public
  mkdir -p "$WEBROOT"
  V6=""; [ -e /proc/net/if_inet6 ] && V6=1
  if [ -n "$DOMAIN" ]; then NAME=$DOMAIN; DEF=""; else NAME=_; DEF=" default_server"; fi

  proxy_block() { cat <<EOF
    client_max_body_size 64m;
    location /.well-known/acme-challenge/ { root $WEBROOT; }
    location / {
        proxy_pass http://127.0.0.1:$PORT;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Forwarded-For \$remote_addr;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 60s;
    }
EOF
  }
  write_http_site() {
    { echo "# CommsAtlas (written by install-server.sh). Safe to edit; --nginx writes it again."
      echo "server {"
      echo "    listen 80$DEF;"
      [ -z "$V6" ] || echo "    listen [::]:80$DEF;"
      echo "    server_name $NAME;"
      proxy_block
      echo "}"; } >"$SITEFILE"
  }
  enable_site() { [ ! -d /etc/nginx/sites-enabled ] || ln -sf "$SITEFILE" /etc/nginx/sites-enabled/$SITE; }

  write_http_site; enable_site
  # With no name given this site should answer for the machine's address, so the stock "Welcome to nginx" page steps aside.
  if [ -z "$DOMAIN" ] && [ -L /etc/nginx/sites-enabled/default ]; then rm -f /etc/nginx/sites-enabled/default; say "    Disabled nginx's stock welcome site (still in sites-available)."; fi
  nginx -t >/dev/null 2>&1 || { nginx -t || true; rm -f "$SITEFILE" /etc/nginx/sites-enabled/$SITE; die "nginx did not accept the new site; it was removed. CommsAtlas itself is running on 127.0.0.1:$PORT."; }
  systemctl enable nginx >/dev/null 2>&1 || true
  systemctl reload nginx 2>/dev/null || systemctl restart nginx
  WROTE_SITE=1

  if [ "$TLS" -eq 1 ]; then
    say "    Getting a certificate for $DOMAIN..."
    apt-get install -y -qq certbot >/dev/null
    CB="certbot certonly --webroot -w $WEBROOT -d $DOMAIN --non-interactive --agree-tos"
    if [ -n "$EMAIL" ]; then CB="$CB --email $EMAIL"; else CB="$CB --register-unsafely-without-email"; fi
    if $CB; then
      { echo "# CommsAtlas (written by install-server.sh). Safe to edit; --nginx writes it again."
        echo "server {"
        echo "    listen 80;"; [ -z "$V6" ] || echo "    listen [::]:80;"
        echo "    server_name $DOMAIN;"
        echo "    location /.well-known/acme-challenge/ { root $WEBROOT; }"
        echo "    location / { return 301 https://\$host\$request_uri; }"
        echo "}"
        echo "server {"
        echo "    listen 443 ssl;"; [ -z "$V6" ] || echo "    listen [::]:443 ssl;"
        echo "    http2 on;"
        echo "    server_name $DOMAIN;"
        echo "    ssl_certificate     /etc/letsencrypt/live/$DOMAIN/fullchain.pem;"
        echo "    ssl_certificate_key /etc/letsencrypt/live/$DOMAIN/privkey.pem;"
        proxy_block
        echo "}"; } >"$SITEFILE"
      mkdir -p /etc/letsencrypt/renewal-hooks/deploy
      printf '#!/bin/sh\nsystemctl reload nginx\n' >/etc/letsencrypt/renewal-hooks/deploy/commsatlas-nginx.sh
      chmod +x /etc/letsencrypt/renewal-hooks/deploy/commsatlas-nginx.sh
      if nginx -t >/dev/null 2>&1; then systemctl reload nginx; say "    https is on for $DOMAIN."
      else nginx -t || true; write_http_site; systemctl reload nginx; say "    WARNING: the https site was not accepted; $DOMAIN is served over http only."; fi
    else
      say "    WARNING: the certificate could not be made (the name must point at this machine and port 80 must be reachable). $DOMAIN is served over http for now; run this installer again with --tls once that is fixed."
    fi
  fi
fi

# ---------- 6. done ----------
say "6/6 Done."
if [ "$MODE" = install ]; then
  if [ "$WROTE_SITE" -eq 1 ] && [ "$TLS" -eq 1 ] && [ -f "/etc/letsencrypt/live/$DOMAIN/fullchain.pem" ]; then URL="https://$DOMAIN/"
  elif [ -n "$DOMAIN" ]; then URL="http://$DOMAIN/"
  elif [ "$WROTE_SITE" -eq 1 ]; then URL="http://$(hostname -I 2>/dev/null | awk '{print $1}')/"
  else URL="http://127.0.0.1:$PORT/"; fi
  say "CommsAtlas $NEW_BUILD is installed. Open $URL and make the first Super Admin on the Set up screen."
  say "Use https for real use: sign-in passwords travel over this connection."
else
  say "CommsAtlas updated from ${OLD_BUILD:-the previous version} to $NEW_BUILD. People stay signed in; accounts and records are unchanged."
  say "The old program is in $APP.previous if you ever need to go back (stop the service, swap the folders, start it)."
fi
say "Data (back this up): $DATA"

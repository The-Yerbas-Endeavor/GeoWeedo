#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="${GEOWEEDO_ROOT:-/home/geo}"
SOURCE="$ROOT/GeoWeedo"
NGINX_SITE="${1:-/etc/nginx/sites-available/geoweedo.yerbas.org}"
UPSTREAM_DST="/etc/nginx/conf.d/geoweedo-upstream.conf"
SERVICE_DST="/etc/systemd/system/geoweedo@.service"
WALLET_SERVICE_DST="/etc/systemd/system/geoweedo-wallet-worker.service"
WALLET_TIMER_DST="/etc/systemd/system/geoweedo-wallet-worker.timer"

[ -f "$SOURCE/deploy/geoweedo@.service" ] || { echo "Missing deploy/geoweedo@.service" >&2; exit 1; }
[ -f "$SOURCE/deploy/geoweedo-wallet-worker.service" ] || { echo "Missing deploy/geoweedo-wallet-worker.service" >&2; exit 1; }
[ -f "$SOURCE/deploy/geoweedo-wallet-worker.timer" ] || { echo "Missing deploy/geoweedo-wallet-worker.timer" >&2; exit 1; }
[ -f "$SOURCE/deploy/nginx-geoweedo-upstream.conf" ] || { echo "Missing nginx upstream config" >&2; exit 1; }
[ -f "$NGINX_SITE" ] || { echo "Nginx site not found: $NGINX_SITE" >&2; exit 1; }

printf '\n[GeoWeedo setup] Installing blue/green systemd template\n'
sudo cp "$SOURCE/deploy/geoweedo@.service" "$SERVICE_DST"

printf '\n[GeoWeedo setup] Installing Yerbas wallet scanner service and timer\n'
sudo cp "$SOURCE/deploy/geoweedo-wallet-worker.service" "$WALLET_SERVICE_DST"
sudo cp "$SOURCE/deploy/geoweedo-wallet-worker.timer" "$WALLET_TIMER_DST"
sudo systemctl daemon-reload
sudo systemctl enable --now geoweedo-wallet-worker.timer

printf '\n[GeoWeedo setup] Installing nginx upstream\n'
sudo cp "$SOURCE/deploy/nginx-geoweedo-upstream.conf" "$UPSTREAM_DST"

backup="${NGINX_SITE}.pre-blue-green.$(date +%Y%m%d%H%M%S)"
sudo cp "$NGINX_SITE" "$backup"

if grep -qE 'proxy_pass[[:space:]]+http://127\.0\.0\.1:3000/?;' "$NGINX_SITE"; then
  sudo sed -Ei 's#proxy_pass[[:space:]]+http://127\.0\.0\.1:3000/?;#proxy_pass http://geoweedo_backend;#g' "$NGINX_SITE"
elif ! grep -q 'proxy_pass http://geoweedo_backend;' "$NGINX_SITE"; then
  echo "Could not find the existing proxy_pass to 127.0.0.1:3000." >&2
  echo "Backup preserved at: $backup" >&2
  echo "Change the GeoWeedo location block to: proxy_pass http://geoweedo_backend;" >&2
  exit 1
fi

if ! grep -q 'proxy_next_upstream.*http_502' "$NGINX_SITE"; then
  sudo python3 - "$NGINX_SITE" <<'PY'
from pathlib import Path
import sys
p = Path(sys.argv[1])
s = p.read_text()
needle = 'location / {'
pos = s.find(needle)
if pos >= 0:
    insert = pos + len(needle)
    extra = '\n        proxy_next_upstream error timeout http_502 http_503 http_504;\n        proxy_next_upstream_tries 2;'
    s = s[:insert] + extra + s[insert:]
    p.write_text(s)
PY
fi

printf '\n[GeoWeedo setup] Validating nginx before reload\n'
if ! sudo nginx -t; then
  echo "Nginx validation failed; restoring original site config." >&2
  sudo cp "$backup" "$NGINX_SITE"
  sudo nginx -t || true
  exit 1
fi
sudo systemctl reload nginx

printf '\n[GeoWeedo setup] Blue/green plumbing and wallet scanner installed.\n'
printf 'Wallet scanner timer: geoweedo-wallet-worker.timer (every 60 seconds)\n'
printf 'Run: bash %s/scripts/deploy-zero-downtime.sh\n' "$SOURCE"
printf 'The current legacy service can remain online; first deploy builds green on port 3001 before retiring it.\n'

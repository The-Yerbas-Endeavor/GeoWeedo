#!/usr/bin/env bash
set -Eeuo pipefail

# GeoWeedo no-downtime deployment.
#
# Production continues serving from /home/geo/GeoWeedo on port 3000 while
# /home/geo/GeoWeedo-next is updated, installed, built and started on port 3001.
# Nginx is switched to the verified staging process before the live checkout is
# touched. After the live checkout has been updated and verified, nginx switches
# back to port 3000 and the staging process is stopped.
#
# Persistent state is NOT copied. The staging checkout links to the live
# checkout's data directory and .env.local so both processes use the same
# SQLite/runtime state and configuration.

LIVE=${LIVE:-/home/geo/GeoWeedo}
STAGE=${STAGE:-/home/geo/GeoWeedo-next}
APP_USER=${APP_USER:-geo}
LIVE_SERVICE=${LIVE_SERVICE:-geoweedo}
STAGE_SERVICE=${STAGE_SERVICE:-geoweedo-staging}
LIVE_PORT=${LIVE_PORT:-3000}
STAGE_PORT=${STAGE_PORT:-3001}
HEALTH_PATH=${HEALTH_PATH:-/}
REPO_URL=${REPO_URL:-$(git -C "$LIVE" remote get-url origin)}

log(){ printf '\n==> %s\n' "$*"; }
die(){ printf '\nERROR: %s\n' "$*" >&2; exit 1; }

health_check(){
  local port=$1 attempts=${2:-45}
  local i
  for ((i=1;i<=attempts;i++)); do
    if curl --fail --silent --show-error --max-time 3 "http://127.0.0.1:${port}${HEALTH_PATH}" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  return 1
}

find_nginx_site(){
  if [[ -n "${NGINX_SITE:-}" ]]; then
    readlink -f "$NGINX_SITE"
    return
  fi
  local match
  match=$(sudo grep -RIlE 'proxy_pass[[:space:]]+http://(127\.0\.0\.1|localhost):(3000|3001)' /etc/nginx/sites-enabled 2>/dev/null | head -n1 || true)
  [[ -n "$match" ]] || die 'Could not locate the enabled GeoWeedo nginx site. Set NGINX_SITE=/etc/nginx/sites-available/<site> and rerun.'
  readlink -f "$match"
}

switch_nginx(){
  local port=$1 site=$2 backup
  backup=$(mktemp)
  sudo cp "$site" "$backup"
  sudo python3 - "$site" "$port" <<'PY'
from pathlib import Path
import re, sys
path=Path(sys.argv[1]); port=sys.argv[2]
text=path.read_text()
new,count=re.subn(r'proxy_pass\s+http://(?:127\.0\.0\.1|localhost):(?:3000|3001)', f'proxy_pass http://127.0.0.1:{port}', text)
if count < 1:
    raise SystemExit('No GeoWeedo proxy_pass for port 3000/3001 was found in nginx site')
path.write_text(new)
PY
  if ! sudo nginx -t; then
    sudo cp "$backup" "$site"
    rm -f "$backup"
    die 'nginx configuration test failed; original site configuration restored.'
  fi
  sudo systemctl reload nginx
  rm -f "$backup"
}

[[ -d "$LIVE/.git" ]] || die "$LIVE is not a Git checkout."
[[ -d "$LIVE/data" ]] || die "$LIVE/data is missing; refusing to deploy without the production data directory."
[[ -f "$LIVE/.env.local" ]] || die "$LIVE/.env.local is missing; refusing to deploy without production configuration."
command -v curl >/dev/null || die 'curl is required.'
command -v npm >/dev/null || die 'npm is required.'

NGINX_SITE_RESOLVED=$(find_nginx_site)
log "Using nginx site: $NGINX_SITE_RESOLVED"

# If a prior deployment failed after nginx had already moved to staging, keep
# staging online and repair/rebuild live instead of destroying the serving app.
if sudo grep -Eq 'proxy_pass[[:space:]]+http://(127\.0\.0\.1|localhost):3001' "$NGINX_SITE_RESOLVED"; then
  log 'Nginx is already serving staging on port 3001; preserving it while rebuilding live.'
  health_check "$STAGE_PORT" 5 || die 'Nginx points at staging but port 3001 is not healthy. Restore a healthy backend before deploying.'
else
  log 'Preparing staging checkout while production stays on port 3000'
  if [[ ! -d "$STAGE/.git" ]]; then
    rm -rf "$STAGE"
    git clone "$REPO_URL" "$STAGE"
  fi
  git -C "$STAGE" fetch origin
  git -C "$STAGE" reset --hard origin/main

  rm -rf "$STAGE/data" "$STAGE/.env.local" "$STAGE/.next"
  ln -s "$LIVE/data" "$STAGE/data"
  ln -s "$LIVE/.env.local" "$STAGE/.env.local"

  log 'Installing and building staging; live production is untouched'
  cd "$STAGE"
  npm ci
  npm run build

  sudo systemctl stop "${STAGE_SERVICE}.service" >/dev/null 2>&1 || true
  sudo systemd-run \
    --unit="$STAGE_SERVICE" \
    --collect \
    --property="User=$APP_USER" \
    --property="WorkingDirectory=$STAGE" \
    --setenv=NODE_ENV=production \
    --setenv="PORT=$STAGE_PORT" \
    /usr/bin/npm start -- -p "$STAGE_PORT" >/dev/null

  log 'Verifying staging on port 3001'
  health_check "$STAGE_PORT" || {
    sudo journalctl -u "${STAGE_SERVICE}.service" -n 80 --no-pager || true
    sudo systemctl stop "${STAGE_SERVICE}.service" >/dev/null 2>&1 || true
    die 'Staging did not become healthy. Production was not touched.'
  }

  log 'Switching nginx to verified staging before touching the live checkout'
  switch_nginx "$STAGE_PORT" "$NGINX_SITE_RESOLVED"
fi

log 'Updating and building live checkout while staging serves production traffic'
cd "$LIVE"
git fetch origin
git reset --hard origin/main
rm -rf .next
npm ci
npm run build

log 'Restarting live service on port 3000'
sudo systemctl restart "$LIVE_SERVICE"
if ! health_check "$LIVE_PORT"; then
  sudo journalctl -u "$LIVE_SERVICE" -n 80 --no-pager || true
  die 'Live service did not become healthy. Nginx remains on the healthy staging instance; no public outage was introduced.'
fi

log 'Switching nginx back to verified live service'
switch_nginx "$LIVE_PORT" "$NGINX_SITE_RESOLVED"

log 'Stopping temporary staging service'
sudo systemctl stop "${STAGE_SERVICE}.service" >/dev/null 2>&1 || true

log 'Deployment complete — production remained behind a healthy backend throughout the deployment.'
printf 'Live commit: '
git -C "$LIVE" rev-parse --short HEAD

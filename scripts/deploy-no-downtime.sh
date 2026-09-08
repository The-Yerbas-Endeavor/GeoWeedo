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
NGINX_HOST=${NGINX_HOST:-geoweedo.com}
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
    [[ -e "$NGINX_SITE" ]] || die "NGINX_SITE does not exist: $NGINX_SITE"
    readlink -f "$NGINX_SITE"
    return
  fi

  local match=''

  # Prefer the enabled virtual host that actually names geoweedo.com. This works
  # whether proxy_pass is direct, uses an upstream, or lives in an included file.
  if [[ -d /etc/nginx/sites-enabled ]]; then
    match=$(sudo grep -RIlE "server_name[^;]*${NGINX_HOST//./\\.}" /etc/nginx/sites-enabled 2>/dev/null | head -n1 || true)
  fi

  # Some installs keep the vhost only in sites-available and include it another way.
  if [[ -z "$match" && -d /etc/nginx/sites-available ]]; then
    match=$(sudo grep -RIlE "server_name[^;]*${NGINX_HOST//./\\.}" /etc/nginx/sites-available 2>/dev/null | head -n1 || true)
  fi

  # Filename fallback for conventional GeoWeedo nginx configs.
  if [[ -z "$match" ]]; then
    match=$(find /etc/nginx/sites-enabled /etc/nginx/sites-available -maxdepth 1 -type f -o -type l 2>/dev/null | grep -i 'geoweedo' | head -n1 || true)
  fi

  # Legacy fallback for the original direct-port layout.
  if [[ -z "$match" && -d /etc/nginx/sites-enabled ]]; then
    match=$(sudo grep -RIlE 'proxy_pass[[:space:]]+http://(127\.0\.0\.1|localhost):(3000|3001)' /etc/nginx/sites-enabled 2>/dev/null | head -n1 || true)
  fi

  [[ -n "$match" ]] || die "Could not locate the GeoWeedo nginx virtual host for $NGINX_HOST. Set NGINX_SITE=/etc/nginx/sites-available/<site> and rerun."
  readlink -f "$match"
}

find_nginx_switch_file(){
  local site=$1
  sudo python3 - "$site" "$LIVE_PORT" "$STAGE_PORT" <<'PY'
from pathlib import Path
import re, sys

site = Path(sys.argv[1]).resolve()
ports = (sys.argv[2], sys.argv[3])
port_re = '|'.join(map(re.escape, ports))

def read(path):
    try:
        return path.read_text(errors='ignore')
    except Exception:
        return ''

def has_direct(text):
    return re.search(rf'proxy_pass\s+http://(?:127\.0\.0\.1|localhost):(?:{port_re})\b', text) is not None

def has_backend(text):
    return re.search(rf'\bserver\s+(?:127\.0\.0\.1|localhost):(?:{port_re})\b', text) is not None

site_text = read(site)
if has_direct(site_text):
    print(site)
    raise SystemExit(0)

# Follow simple include directives from the GeoWeedo vhost first.
for inc in re.findall(r'\binclude\s+([^;]+);', site_text):
    inc = inc.strip()
    patterns = [inc] if inc.startswith('/') else [str(site.parent / inc), str(Path('/etc/nginx') / inc)]
    for pattern in patterns:
        p = Path(pattern)
        candidates = list(p.parent.glob(p.name)) if any(c in p.name for c in '*?[') else [p]
        for candidate in candidates:
            text = read(candidate)
            if has_direct(text) or has_backend(text):
                print(candidate.resolve())
                raise SystemExit(0)

# If GeoWeedo proxy_pass references a named upstream, find the file defining it.
upstreams = re.findall(r'proxy_pass\s+http://([A-Za-z0-9_.-]+)', site_text)
upstreams = [u for u in upstreams if u not in {'localhost'} and not re.match(r'^127(?:\.\d+){3}$', u)]
roots = [Path('/etc/nginx/conf.d'), Path('/etc/nginx/sites-enabled'), Path('/etc/nginx/sites-available')]
for root in roots:
    if not root.exists():
        continue
    for candidate in root.rglob('*'):
        if not candidate.is_file():
            continue
        text = read(candidate)
        for upstream in upstreams:
            if re.search(rf'\bupstream\s+{re.escape(upstream)}\s*\{{', text) and has_backend(text):
                print(candidate.resolve())
                raise SystemExit(0)

# Last safe fallback: only consider nginx files whose path or contents mention
# GeoWeedo and which contain a switchable backend port.
for root in roots:
    if not root.exists():
        continue
    for candidate in root.rglob('*'):
        if not candidate.is_file():
            continue
        text = read(candidate)
        if ('geoweedo' in str(candidate).lower() or 'geoweedo' in text.lower()) and (has_direct(text) or has_backend(text)):
            print(candidate.resolve())
            raise SystemExit(0)

raise SystemExit('Could not find the switchable GeoWeedo nginx proxy/upstream file for ports %s/%s.' % ports)
PY
}

nginx_points_to_port(){
  local file=$1 port=$2
  sudo grep -Eq "proxy_pass[[:space:]]+http://(127\\.0\\.0\\.1|localhost):${port}\\b|server[[:space:]]+(127\\.0\\.0\\.1|localhost):${port}\\b" "$file"
}

switch_nginx(){
  local port=$1 switch_file=$2 backup
  backup=$(mktemp)
  sudo cp "$switch_file" "$backup"
  if ! sudo python3 - "$switch_file" "$port" "$LIVE_PORT" "$STAGE_PORT" <<'PY'
from pathlib import Path
import re, sys
path=Path(sys.argv[1]); port=sys.argv[2]; live=sys.argv[3]; stage=sys.argv[4]
text=path.read_text()
ports=rf'(?:{re.escape(live)}|{re.escape(stage)})'
new,count=re.subn(rf'(proxy_pass\s+http://(?:127\.0\.0\.1|localhost):){ports}\b', rf'\g<1>{port}', text)
if count < 1:
    new,count=re.subn(rf'(\bserver\s+(?:127\.0\.0\.1|localhost):){ports}\b', rf'\g<1>{port}', text)
if count < 1:
    raise SystemExit('No switchable GeoWeedo proxy/upstream backend was found in '+str(path))
path.write_text(new)
PY
  then
    sudo cp "$backup" "$switch_file"
    rm -f "$backup"
    die "Could not switch nginx backend in $switch_file; original configuration restored."
  fi
  if ! sudo nginx -t; then
    sudo cp "$backup" "$switch_file"
    rm -f "$backup"
    die 'nginx configuration test failed; original configuration restored.'
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
NGINX_SWITCH_FILE=$(find_nginx_switch_file "$NGINX_SITE_RESOLVED")
log "Using nginx site: $NGINX_SITE_RESOLVED"
log "Switching backend in: $NGINX_SWITCH_FILE"

# If a prior deployment failed after nginx had already moved to staging, keep
# staging online and repair/rebuild live instead of destroying the serving app.
if nginx_points_to_port "$NGINX_SWITCH_FILE" "$STAGE_PORT"; then
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
  switch_nginx "$STAGE_PORT" "$NGINX_SWITCH_FILE"
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
switch_nginx "$LIVE_PORT" "$NGINX_SWITCH_FILE"

log 'Stopping temporary staging service'
sudo systemctl stop "${STAGE_SERVICE}.service" >/dev/null 2>&1 || true

log 'Deployment complete — production remained behind a healthy backend throughout the deployment.'
printf 'Live commit: '
git -C "$LIVE" rev-parse --short HEAD

#!/usr/bin/env bash
set -Eeuo pipefail

# Install a conservative nginx bot guard for GeoWeedo.
#
# Goals:
# - Hard-block GPTBot before requests ever reach Next.js.
# - Keep OAI-SearchBot, Googlebot and Bingbot unthrottled for discovery.
# - Rate-limit other obvious crawler/scraper user agents instead of blocking them.
# - Leave ordinary browsers untouched.
# - Make every nginx change backup-safe and validate with nginx -t before reload.

NGINX_HOST=${NGINX_HOST:-geoweedo.com}
GLOBAL_CONF=/etc/nginx/conf.d/20-geoweedo-bot-guard.conf
SERVER_SNIPPET=/etc/nginx/snippets/geoweedo-bot-guard-server.conf

log(){ printf '\n==> %s\n' "$*"; }
die(){ printf '\nERROR: %s\n' "$*" >&2; exit 1; }

command -v nginx >/dev/null || die "nginx is not installed."
command -v python3 >/dev/null || die "python3 is required."

find_site(){
  local match=''
  if [[ -d /etc/nginx/sites-enabled ]]; then
    match=$(sudo grep -RIlE "server_name[^;]*${NGINX_HOST//./\\.}" /etc/nginx/sites-enabled 2>/dev/null | head -n1 || true)
  fi
  if [[ -z "$match" && -d /etc/nginx/sites-available ]]; then
    match=$(sudo grep -RIlE "server_name[^;]*${NGINX_HOST//./\\.}" /etc/nginx/sites-available 2>/dev/null | head -n1 || true)
  fi
  [[ -n "$match" ]] || die "Could not locate nginx vhost for $NGINX_HOST."
  readlink -f "$match"
}

SITE=$(find_site)
STAMP=$(date +%Y%m%d-%H%M%S)
TMPDIR=$(mktemp -d)
trap 'rm -rf "$TMPDIR"' EXIT

log "GeoWeedo nginx site: $SITE"
sudo cp "$SITE" "$TMPDIR/site.before"
[[ -f "$GLOBAL_CONF" ]] && sudo cp "$GLOBAL_CONF" "$TMPDIR/global.before" || true
[[ -f "$SERVER_SNIPPET" ]] && sudo cp "$SERVER_SNIPPET" "$TMPDIR/snippet.before" || true

log "Installing global bot classification and rate-limit zone"
cat >"$TMPDIR/global.conf" <<'EOF'
# GeoWeedo bot protection.
#
# Empty rate-limit keys are not tracked by nginx, so normal browsers and
# explicitly permitted search crawlers never enter this limiter.

map $http_user_agent $geoweedo_block_bot {
    default 0;
    ~*GPTBot 1;
}

map $http_user_agent $geoweedo_bot_limit_key {
    default "";

    # Search/discovery crawlers GeoWeedo intentionally permits.
    ~*OAI-SearchBot "";
    ~*Googlebot "";
    ~*bingbot "";

    # Obvious automated clients are throttled rather than universally blocked.
    ~*(bot|crawler|spider|scrapy|python-requests|aiohttp|httpclient|headless|wget|curl) $binary_remote_addr;
}

# One request/second per crawler IP with a small burst is enough for indexing
# without letting a crawler consume a small VPS.
limit_req_zone $geoweedo_bot_limit_key zone=geoweedo_bot_limit:10m rate=1r/s;
EOF
sudo install -m 0644 "$TMPDIR/global.conf" "$GLOBAL_CONF"

log "Installing GeoWeedo server-level enforcement"
cat >"$TMPDIR/server.conf" <<'EOF'
# Block explicitly unwanted crawlers before proxying to Next.js.
if ($geoweedo_block_bot) {
    return 403;
}

# Applies only when $geoweedo_bot_limit_key is non-empty.
limit_req zone=geoweedo_bot_limit burst=5 nodelay;
limit_req_status 429;
EOF
sudo install -m 0644 "$TMPDIR/server.conf" "$SERVER_SNIPPET"

log "Ensuring the GeoWeedo vhost includes the guard"
sudo python3 - "$SITE" "$SERVER_SNIPPET" "$NGINX_HOST" <<'PY'
from pathlib import Path
import re, sys

site = Path(sys.argv[1])
snippet = sys.argv[2]
host = sys.argv[3]
include = f"    include {snippet};"

lines = [line for line in site.read_text().splitlines() if snippet not in line]
out = []
matched = 0
pattern = re.compile(r"^\s*server_name\s+[^;]*\b" + re.escape(host) + r"\b[^;]*;\s*$")

for line in lines:
    out.append(line)
    if pattern.search(line):
        out.append(include)
        matched += 1

if not matched:
    raise SystemExit(f"Could not find server_name line for {host} in {site}")

site.write_text("\n".join(out) + "\n")
PY

log "Validating nginx"
if ! sudo nginx -t; then
  log "nginx validation failed; restoring previous files"
  sudo cp "$TMPDIR/site.before" "$SITE"
  if [[ -f "$TMPDIR/global.before" ]]; then sudo cp "$TMPDIR/global.before" "$GLOBAL_CONF"; else sudo rm -f "$GLOBAL_CONF"; fi
  if [[ -f "$TMPDIR/snippet.before" ]]; then sudo cp "$TMPDIR/snippet.before" "$SERVER_SNIPPET"; else sudo rm -f "$SERVER_SNIPPET"; fi
  sudo nginx -t || true
  die "Bot guard was not installed."
fi

log "Reloading nginx"
sudo systemctl reload nginx

log "Installed GeoWeedo bot guard"
printf '%s\n' \
  "GPTBot: blocked with HTTP 403" \
  "OAI-SearchBot / Googlebot / Bingbot: unthrottled" \
  "Other obvious bots/crawlers: 1 request/sec per IP, burst 5" \
  "Normal browsers: unaffected" \
  "" \
  "Verify with:" \
  "  curl -I -A 'GPTBot/1.4' https://$NGINX_HOST/" \
  "  curl -I -A 'Mozilla/5.0' https://$NGINX_HOST/"

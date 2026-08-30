#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="${GEOWEEDO_ROOT:-/home/geo}"
SOURCE="$ROOT/GeoWeedo"
SHARED="$ROOT/GeoWeedo-shared"
BLUE="$ROOT/GeoWeedo-blue"
GREEN="$ROOT/GeoWeedo-green"
HEALTH_PATH="${GEOWEEDO_HEALTH_PATH:-/}"
NGINX_SITE="${GEOWEEDO_NGINX_SITE:-/etc/nginx/sites-available/geoweedo}"

log() { printf '\n[GeoWeedo deploy] %s\n' "$*"; }
fail() { printf '\n[GeoWeedo deploy] ERROR: %s\n' "$*" >&2; exit 1; }

command -v rsync >/dev/null || fail "rsync is required (sudo apt install rsync)."
command -v curl >/dev/null || fail "curl is required."
[ -d "$SOURCE/.git" ] || fail "Expected Git checkout at $SOURCE"

log "Pulling latest main branch"
git -C "$SOURCE" pull --ff-only

mkdir -p "$SHARED/data/runtime"

# Keep the shared environment synchronized with the source checkout. This lets
# blue/green slots receive intentional .env.local changes on the next deploy.
if [ -f "$SOURCE/.env.local" ]; then
  if [ ! -f "$SHARED/.env.local" ] || ! cmp -s "$SOURCE/.env.local" "$SHARED/.env.local"; then
    cp "$SOURCE/.env.local" "$SHARED/.env.local"
    chmod 600 "$SHARED/.env.local"
  fi
fi

# On the first blue/green deployment preserve the existing SQLite runtime data.
if [ -d "$SOURCE/data/runtime" ] && [ -z "$(find "$SHARED/data/runtime" -mindepth 1 -maxdepth 1 -print -quit 2>/dev/null)" ]; then
  log "Seeding shared runtime data from the current installation"
  rsync -a "$SOURCE/data/runtime/" "$SHARED/data/runtime/"
fi

blue_active=false
green_active=false
legacy_active=false
sudo systemctl is-active --quiet geoweedo@blue.service && blue_active=true || true
sudo systemctl is-active --quiet geoweedo@green.service && green_active=true || true
sudo systemctl is-active --quiet geoweedo.service && legacy_active=true || true

if $blue_active; then
  active="blue"; inactive="green"; target="$GREEN"; port=3001
elif $green_active; then
  active="green"; inactive="blue"; target="$BLUE"; port=3000
elif $legacy_active; then
  # Keep the legacy port-3000 service online while green is built and tested.
  active="legacy"; inactive="green"; target="$GREEN"; port=3001
else
  active="none"; inactive="blue"; target="$BLUE"; port=3000
fi

log "Active slot: $active; building inactive slot: $inactive on port $port"
mkdir -p "$target"
rsync -a --delete \
  --exclude='.git' \
  --exclude='node_modules' \
  --exclude='.next' \
  --exclude='.env.local' \
  --exclude='data/runtime' \
  "$SOURCE/" "$target/"

# Dependency metadata is authoritative only when tracked in Git. An untracked
# package-lock.json can survive git reset --hard and would otherwise make the
# inactive slot run npm ci against stale dependency metadata.
package_lock_tracked=false
shrinkwrap_tracked=false
git -C "$SOURCE" ls-files --error-unmatch package-lock.json >/dev/null 2>&1 && package_lock_tracked=true || true
git -C "$SOURCE" ls-files --error-unmatch npm-shrinkwrap.json >/dev/null 2>&1 && shrinkwrap_tracked=true || true

if ! $package_lock_tracked; then
  rm -f "$target/package-lock.json"
fi
if ! $shrinkwrap_tracked; then
  rm -f "$target/npm-shrinkwrap.json"
fi

mkdir -p "$target/data"
rm -rf "$target/data/runtime"
ln -s "$SHARED/data/runtime" "$target/data/runtime"
rm -f "$target/.env.local"
[ -f "$SHARED/.env.local" ] && ln -s "$SHARED/.env.local" "$target/.env.local"

log "Installing dependencies and building $inactive while production stays online"
cd "$target"
if $package_lock_tracked || $shrinkwrap_tracked; then
  npm ci
else
  log "No committed npm lockfile found; using npm install instead of npm ci"
  npm install --no-audit --no-fund
fi
npm run build

log "Starting $inactive"
sudo systemctl restart "geoweedo@$inactive.service"

healthy=false
for attempt in $(seq 1 30); do
  if curl --fail --silent --show-error --max-time 2 "http://127.0.0.1:$port$HEALTH_PATH" >/dev/null; then
    healthy=true
    break
  fi
  sleep 1
done

if ! $healthy; then
  sudo systemctl stop "geoweedo@$inactive.service" || true
  fail "$inactive failed its health check; the old production instance was left running."
fi

# Atomically move every GeoWeedo proxy_pass from the old slot to the healthy
# new slot. This also updates exact API locations such as the admin-login rate
# limit block, not only the catch-all location.
[ -f "$NGINX_SITE" ] || fail "Nginx site not found at $NGINX_SITE; refusing to retire the active slot."
nginx_backup="$(mktemp)"
sudo cp "$NGINX_SITE" "$nginx_backup"

log "$inactive is healthy; switching nginx to 127.0.0.1:$port"
sudo sed -E -i "s#proxy_pass[[:space:]]+http://127\\.0\\.0\\.1:(3000|3001);#proxy_pass http://127.0.0.1:$port;#g" "$NGINX_SITE"

if ! sudo nginx -t; then
  sudo cp "$nginx_backup" "$NGINX_SITE"
  rm -f "$nginx_backup"
  sudo systemctl stop "geoweedo@$inactive.service" || true
  fail "Nginx rejected the new upstream; configuration was restored and old production remains online."
fi

sudo systemctl reload nginx

# Verify nginx itself can serve through the newly selected upstream before the
# previous app instance is retired. Host preserves virtual-host routing.
nginx_healthy=false
for attempt in $(seq 1 10); do
  if curl --fail --silent --show-error --max-time 3 \
      -H 'Host: geoweedo.com' "http://127.0.0.1$HEALTH_PATH" >/dev/null; then
    nginx_healthy=true
    break
  fi
  sleep 1
done

if ! $nginx_healthy; then
  log "Nginx health check failed after switch; rolling back upstream"
  sudo cp "$nginx_backup" "$NGINX_SITE"
  sudo nginx -t || fail "Nginx rollback configuration is invalid; manual intervention required."
  sudo systemctl reload nginx
  rm -f "$nginx_backup"
  sudo systemctl stop "geoweedo@$inactive.service" || true
  fail "Nginx upstream switch failed; old production was restored."
fi
rm -f "$nginx_backup"

log "Nginx is serving $inactive; retiring $active"
case "$active" in
  blue|green) sudo systemctl stop "geoweedo@$active.service" ;;
  legacy) sudo systemctl stop geoweedo.service ;;
esac

sudo systemctl enable "geoweedo@$inactive.service" >/dev/null

log "Deployment complete without taking the serving instance down during build or cutover."
log "Live slot: $inactive ($port)"

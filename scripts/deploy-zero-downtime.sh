#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="${GEOWEEDO_ROOT:-/home/geo}"
SOURCE="$ROOT/GeoWeedo"
SHARED="$ROOT/GeoWeedo-shared"
BLUE="$ROOT/GeoWeedo-blue"
GREEN="$ROOT/GeoWeedo-green"
HEALTH_PATH="${GEOWEEDO_HEALTH_PATH:-/}"

log() { printf '\n[GeoWeedo deploy] %s\n' "$*"; }
fail() { printf '\n[GeoWeedo deploy] ERROR: %s\n' "$*" >&2; exit 1; }

command -v rsync >/dev/null || fail "rsync is required (sudo apt install rsync)."
command -v curl >/dev/null || fail "curl is required."
[ -d "$SOURCE/.git" ] || fail "Expected Git checkout at $SOURCE"

log "Pulling latest main branch"
git -C "$SOURCE" pull --ff-only

mkdir -p "$SHARED/data/runtime"

if [ -f "$SOURCE/.env.local" ] && [ ! -f "$SHARED/.env.local" ]; then
  cp "$SOURCE/.env.local" "$SHARED/.env.local"
  chmod 600 "$SHARED/.env.local"
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

mkdir -p "$target/data"
rm -rf "$target/data/runtime"
ln -s "$SHARED/data/runtime" "$target/data/runtime"
rm -f "$target/.env.local"
[ -f "$SHARED/.env.local" ] && ln -s "$SHARED/.env.local" "$target/.env.local"

log "Installing dependencies and building $inactive while production stays online"
cd "$target"
npm ci
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

log "$inactive is healthy; retiring $active"
case "$active" in
  blue|green) sudo systemctl stop "geoweedo@$active.service" ;;
  legacy) sudo systemctl stop geoweedo.service ;;
esac

sudo systemctl enable "geoweedo@$inactive.service" >/dev/null

log "Deployment complete without taking the serving instance down during build."
log "Live slot: $inactive ($port)"

#!/usr/bin/env bash
set -Eeuo pipefail

LIVE=${LIVE:-/home/geo/GeoWeedo}
BUILD=${BUILD:-/home/geo/GeoWeedo-build}
BRANCH=${1:-$(git -C "$LIVE" branch --show-current)}
REPO_URL=${REPO_URL:-$(git -C "$LIVE" remote get-url origin)}

log(){ printf '\n==> %s\n' "$*"; }
die(){ printf '\nERROR: %s\n' "$*" >&2; exit 1; }

[[ -d "$LIVE/.git" ]] || die "$LIVE is not a Git checkout."
command -v git >/dev/null || die 'git is required.'
command -v npm >/dev/null || die 'npm is required.'

log "Preparing isolated build workspace for $BRANCH"
if [[ ! -d "$BUILD/.git" ]]; then
  rm -rf "$BUILD"
  git clone "$REPO_URL" "$BUILD"
fi

git -C "$BUILD" fetch origin
if ! git -C "$BUILD" rev-parse --verify "origin/$BRANCH" >/dev/null 2>&1; then
  die "origin/$BRANCH does not exist."
fi
git -C "$BUILD" reset --hard "origin/$BRANCH"
git -C "$BUILD" clean -fdx

# Build with isolated copies of runtime inputs. Never point this workspace at
# production SQLite state, so schema initialization/static generation cannot
# mutate the live database.
if [[ -f "$LIVE/.env.local" ]]; then
  cp "$LIVE/.env.local" "$BUILD/.env.local"
fi
if [[ -d "$LIVE/data" ]]; then
  rm -rf "$BUILD/data"
  cp -a "$LIVE/data" "$BUILD/data"
fi

log 'Installing dependencies in isolated workspace'
cd "$BUILD"
npm ci

log "Building $BRANCH without touching the running production checkout"
npm run build

log 'Safe build completed successfully.'
printf 'Built commit: '
git rev-parse --short HEAD
printf 'Workspace: %s\n' "$BUILD"

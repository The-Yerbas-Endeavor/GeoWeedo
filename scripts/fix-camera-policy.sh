#!/usr/bin/env bash
set -Eeuo pipefail

HOST=${HOST:-geoweedo.com}
NGINX_ROOT=${NGINX_ROOT:-/etc/nginx}
STAMP=$(date +%Y%m%d-%H%M%S)

log(){ printf '\n==> %s\n' "$*"; }
die(){ printf '\nERROR: %s\n' "$*" >&2; exit 1; }

command -v nginx >/dev/null || die 'nginx is required.'
command -v curl >/dev/null || die 'curl is required.'

log "Finding nginx files that explicitly disable camera access"
mapfile -t raw_matches < <(sudo grep -RIl -- 'camera=()' "$NGINX_ROOT" 2>/dev/null || true)

if (( ${#raw_matches[@]} == 0 )); then
  printf 'No nginx file containing camera=() was found under %s.\n' "$NGINX_ROOT"
  printf 'Current public policy:\n'
  curl -sSI "https://${HOST}/weedo-facts" | grep -i '^Permissions-Policy:' || true
  exit 0
fi

# sites-enabled commonly points at sites-available. Resolve paths so the same
# configuration is not counted twice.
declare -A seen=()
matches=()
for candidate in "${raw_matches[@]}"; do
  resolved=$(readlink -f "$candidate")
  if [[ -z "${seen[$resolved]:-}" ]]; then
    seen[$resolved]=1
    matches+=("$resolved")
  fi
done

printf 'Found camera-deny policy in:\n'
printf '  %s\n' "${matches[@]}"

(( ${#matches[@]} == 1 )) || die 'More than one nginx file disables camera access. Refusing an automatic edit; inspect the files above.'

target=${matches[0]}

# Automatic editing is allowed only when this is clearly GeoWeedo-specific.
if [[ "$target" != *geoweedo* ]] && ! sudo grep -qi -- "$HOST" "$target"; then
  die "The camera policy is in a shared-looking nginx file ($target). Refusing to change a shared policy automatically."
fi

backup="${target}.pre-weedo-camera-${STAMP}.bak"
log "Backing up $target to $backup"
sudo cp -a "$target" "$backup"

log 'Changing only camera=() to camera=(self)'
sudo sed -i 's/camera=()/camera=(self)/g' "$target"

if ! sudo nginx -t; then
  sudo cp -a "$backup" "$target"
  die 'nginx configuration validation failed; original file restored.'
fi

sudo systemctl reload nginx

log 'Verifying public Permissions-Policy'
policy=$(curl -sSI "https://${HOST}/weedo-facts" | tr -d '\r' | grep -i '^Permissions-Policy:' || true)
printf '%s\n' "${policy:-No Permissions-Policy header returned.}"

if printf '%s' "$policy" | grep -Fqi 'camera=()'; then
  die 'The public response still denies camera access. The nginx edit was valid, but another layer is overriding the header.'
fi

if printf '%s' "$policy" | grep -Fqi 'camera=(self)'; then
  log 'Camera policy is ready for the same-origin Weedo Facts scanner.'
else
  log 'The explicit camera deny is gone. Test Scan package in the browser and allow camera access when prompted.'
fi

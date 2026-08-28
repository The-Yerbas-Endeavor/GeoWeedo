#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

USERNAME="${GEOWEEDO_ADMIN_USERNAME:-}"
DISPLAY_NAME="${GEOWEEDO_ADMIN_DISPLAY_NAME:-}"
PASSWORD="${GEOWEEDO_ADMIN_PASSWORD:-}"

if [[ -z "$USERNAME" ]]; then
  read -r -p "Admin username: " USERNAME
fi
if [[ -z "$DISPLAY_NAME" ]]; then
  read -r -p "Admin display name [$USERNAME]: " DISPLAY_NAME
  DISPLAY_NAME="${DISPLAY_NAME:-$USERNAME}"
fi
if [[ -z "$PASSWORD" ]]; then
  while true; do
    read -r -s -p "Admin password (12+ characters): " PASSWORD
    echo
    if [[ ${#PASSWORD} -ge 12 ]]; then
      break
    fi
    echo "Password must contain at least 12 characters. Try again."
  done
fi

GEOWEEDO_ADMIN_USERNAME="$USERNAME" \
GEOWEEDO_ADMIN_DISPLAY_NAME="${DISPLAY_NAME:-$USERNAME}" \
GEOWEEDO_ADMIN_PASSWORD="$PASSWORD" \
node --conditions=react-server --experimental-strip-types scripts/create-admin.mjs

unset PASSWORD GEOWEEDO_ADMIN_PASSWORD

sqlite3 data/runtime/geoweedo.sqlite \
  "SELECT id, username, display_name, role, active FROM admin_users WHERE username = '$(printf "%s" "$USERNAME" | sed "s/'/''/g")' COLLATE NOCASE;"

#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

CAP_VERSION="8.5.0"
PLATFORM="${1:-all}"

echo "GeoWeedo mobile bootstrap"
echo "Capacitor: ${CAP_VERSION}"
echo "Platform: ${PLATFORM}"

npm install --save \
  "@capacitor/core@${CAP_VERSION}" \
  "@capacitor/android@${CAP_VERSION}" \
  "@capacitor/ios@${CAP_VERSION}"
npm install --save-dev "@capacitor/cli@${CAP_VERSION}"

add_android() {
  if [[ ! -d android ]]; then
    npx cap add android
  fi
  npx cap sync android
  echo "Android project ready: $ROOT_DIR/android"
}

add_ios() {
  if [[ "$(uname -s)" != "Darwin" ]]; then
    echo "Skipping iOS project generation: Xcode/iOS builds require macOS."
    echo "Run './scripts/mobile-bootstrap.sh ios' on the Mac used for App Store builds."
    return 0
  fi
  if [[ ! -d ios ]]; then
    npx cap add ios
  fi
  npx cap sync ios
  echo "iOS project ready: $ROOT_DIR/ios"
}

case "$PLATFORM" in
  android)
    add_android
    ;;
  ios)
    add_ios
    ;;
  all)
    add_android
    add_ios
    ;;
  *)
    echo "Usage: $0 [android|ios|all]" >&2
    exit 2
    ;;
esac

echo
cat <<'EOF'
Next steps:
  Android: npx cap open android
  iOS:     npx cap open ios

Commit package.json, package-lock.json and the generated native project directories after reviewing them.
EOF

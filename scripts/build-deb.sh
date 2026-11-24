#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"

case "$(uname -m)" in
  x86_64) BUILDER_ARCH="x64"; DEB_ARCH="amd64" ;;
  aarch64|arm64) BUILDER_ARCH="arm64"; DEB_ARCH="arm64" ;;
  *)
    printf 'Architecture non prise en charge pour le paquet DEB : %s\n' "$(uname -m)" >&2
    exit 1
    ;;
esac

command -v dpkg-deb >/dev/null 2>&1 || {
  printf '%s\n' 'dpkg-deb est requis pour vérifier le paquet DEB.' >&2
  exit 1
}

"$ROOT_DIR/scripts/build.sh"
cd "$ROOT_DIR"
./node_modules/.bin/electron-builder --linux deb "--$BUILDER_ARCH"

PACKAGE_VERSION="$(node -p "require('./package.json').version")"
PACKAGE_PATH="$ROOT_DIR/release/Cami-$PACKAGE_VERSION-linux-$DEB_ARCH.deb"
if [[ ! -f "$PACKAGE_PATH" ]]; then
  printf 'Le paquet attendu est absent : %s\n' "$PACKAGE_PATH" >&2
  exit 1
fi

dpkg-deb --info "$PACKAGE_PATH"
printf '\nPaquet créé : %s\n' "$PACKAGE_PATH"

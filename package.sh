#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p dist
STAGE=$(mktemp -d)
trap 'rm -rf "$STAGE"' EXIT
mkdir "$STAGE/claude-codex-battery"
cp README.md LICENSE VERSION install.sh ccb-update.sh claude-codex-usage.2m.js "$STAGE/claude-codex-battery/"
mkdir "$STAGE/claude-codex-battery/assets"
cp assets/icon-claude.png assets/icon-codex.png "$STAGE/claude-codex-battery/assets/"
chmod +x "$STAGE/claude-codex-battery/install.sh" "$STAGE/claude-codex-battery/ccb-update.sh"
OUT="$PWD/dist/claude-codex-battery-macos.zip"
rm -f "$OUT"
(cd "$STAGE" && zip -qr "$OUT" claude-codex-battery)
(cd dist && shasum -a 256 claude-codex-battery-macos.zip > SHA256SUMS.txt)
echo "$OUT"

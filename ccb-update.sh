#!/bin/bash
# Claude & Codex Usage Battery — self-update
# Runs the plugin's own updater: it downloads the latest GitHub release zip, checks it
# against the release's SHA256SUMS.txt, and only then replaces the files (atomic rename).
set -euo pipefail
DEST_DIR="$(cd "$(dirname "$0")" && pwd)"
PLUGIN=""
for f in "$DEST_DIR"/claude-codex-usage.*.js; do
  [ -f "$f" ] && { PLUGIN="$f"; break; }
done
if [ -z "$PLUGIN" ]; then echo "플러그인 파일을 찾을 수 없습니다: $DEST_DIR"; exit 1; fi
BUN="$(command -v bun || true)"
if [ -z "$BUN" ]; then
  for candidate in "$HOME/.bun/bin/bun" /opt/homebrew/bin/bun /usr/local/bin/bun; do
    if [ -x "$candidate" ]; then BUN="$candidate"; break; fi
  done
fi
if [ -z "$BUN" ]; then echo "bun을 찾을 수 없습니다. 설치 후 다시 실행하세요."; exit 1; fi
exec "$BUN" "$PLUGIN" --self-update

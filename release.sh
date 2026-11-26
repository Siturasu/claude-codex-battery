#!/bin/bash
# Publish a release: tag vX.Y.Z on HEAD, then a GitHub release with the zip and SHA256SUMS.txt.
# The plugin's self-update installs only from releases and checks the zip against SHA256SUMS.txt,
# so main should be moved to the tagged commit right after this (release first, then push main).
#   ./release.sh            # uses VERSION
#   NOTES="..." ./release.sh
set -euo pipefail
cd "$(dirname "$0")"
V=$(tr -d '[:space:]' < VERSION)
[[ "$V" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "VERSION is not X.Y.Z: $V"; exit 1; }
grep -q "^const VERSION = \"$V\";" claude-codex-usage.2m.js || { echo "VERSION ($V) differs from claude-codex-usage.2m.js"; exit 1; }
[ -z "$(git status --porcelain)" ] || { echo "working tree not clean"; exit 1; }
if git rev-parse -q --verify "refs/tags/v$V" >/dev/null || git ls-remote --exit-code --tags origin "refs/tags/v$V" >/dev/null; then
  echo "tag v$V already exists"; exit 1
fi
bash ./package.sh >/dev/null
(cd dist && shasum -a 256 -c SHA256SUMS.txt)
git tag -a "v$V" -m "v$V"
git push origin "refs/tags/v$V"
gh release create "v$V" dist/claude-codex-battery-macos.zip dist/SHA256SUMS.txt \
  --verify-tag --title "v$V" --notes "${NOTES:-v$V}"
echo "released v$V at $(git rev-parse HEAD). Next: push this commit to main."

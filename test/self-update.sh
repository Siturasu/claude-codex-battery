#!/usr/bin/env bash
# Self-update tests against a local fake GitHub (test/lib/fake-github.js). No real network,
# no SwiftBar refresh, and a fake HOME with .no-live so the Keychain and real tokens are never read.
#   1. transition: an old v1.6.0 install runs its old updater (which pulls main) and lands on this version
#   2. the new updater refuses a release whose zip does not match SHA256SUMS.txt, keeping files as they were
#   3. it refuses a missing checksum entry, mismatched contents, and downgrades
#   4. it installs a good release (atomic swap, bun shebang, refreshed .ccb-update.sh, .bak)
#   5. --check-update records the latest release, and the menu offers the update via --self-update
set -u
cd "$(dirname "$0")/.."
REPO=$PWD
BUN=/usr/local/bin/bun; [ -x "$BUN" ] || BUN=$(command -v bun)
OLD_REF=${OLD_REF:-fb3c9cf}   # last main commit before release-based updates (v1.6.0)
CUR=$(tr -d '[:space:]' < VERSION)
NEXT=$(awk -F. '{print $1"."$2"."$3+1}' <<<"$CUR")
T=$(mktemp -d); SRV=$T/srv; H=$T/home; P=$H/.swiftbar-plugins
fail=0; SPID=
cleanup() { [ -n "$SPID" ] && kill "$SPID" 2>/dev/null; rm -rf "$T"; }
trap cleanup EXIT
ok() { echo "PASS $1"; }
bad() { echo "FAIL $1"; fail=1; }
mkdir -p "$SRV/raw/assets" "$SRV/download" "$P" "$H/.claude/swiftbar"
touch "$H/.claude/swiftbar/.no-live"
export HOME=$H CCB_LANG=en https_proxy=http://127.0.0.1:9 HTTPS_PROXY=http://127.0.0.1:9 NO_PROXY=127.0.0.1 no_proxy=127.0.0.1

# Build a release (zip + SHA256SUMS.txt) from a copy of the tree with the given version
make_release() { # version
  local v=$1 b=$T/build-$1
  mkdir -p "$b"
  cp -R README.md LICENSE VERSION install.sh ccb-update.sh claude-codex-usage.2m.js package.sh assets "$b/"
  echo "$v" > "$b/VERSION"
  sed -i '' "s/^const VERSION = \"[^\"]*\";/const VERSION = \"$v\";/" "$b/claude-codex-usage.2m.js"
  (cd "$b" && bash ./package.sh >/dev/null)
  mkdir -p "$SRV/download/v$v"
  cp "$b/dist/claude-codex-battery-macos.zip" "$b/dist/SHA256SUMS.txt" "$SRV/download/v$v/"
}
publish_latest() { printf '{"tag_name":"v%s"}' "$1" > "$SRV/latest.json"; }
plugin_ver() { sed -n 's/^const VERSION = "\([^"]*\)";.*/\1/p' "$P/claude-codex-usage.2m.js"; }
selfupdate() { CCB_UPDATE_TEST_BASE=$BASE "$BUN" "$P/claude-codex-usage.2m.js" --self-update 2>&1; }

"$BUN" test/lib/fake-github.js "$SRV" > "$T/port" & SPID=$!; disown
for _ in $(seq 50); do [ -s "$T/port" ] && break; sleep 0.1; done
BASE="http://127.0.0.1:$(cat "$T/port")"

# ── 1. Old install → old updater → main (this tree) ──
cp claude-codex-usage.2m.js VERSION "$SRV/raw/"; cp assets/icon-*.png "$SRV/raw/assets/"
git show "$OLD_REF:claude-codex-usage.2m.js" | sed "1s|.*|#!$BUN|" > "$P/claude-codex-usage.2m.js"
git show "$OLD_REF:ccb-update.sh" \
  | sed -e "s|^RAW=.*|RAW=\"$BASE/raw\"|" -e 's|^open "swiftbar://refreshallplugins".*|true|' > "$P/.ccb-update.sh"
chmod +x "$P/claude-codex-usage.2m.js" "$P/.ccb-update.sh"
OLD_VER=$(plugin_ver)
printf '{"checkedAt":%s,"latest":"%s"}' "$(date +%s)" "$CUR" > "$H/.claude/swiftbar/.update-check.json"
if "$BUN" "$P/claude-codex-usage.2m.js" | grep -Eq "Update to v$CUR \(current v$OLD_VER\)|v$CUR 업데이트 \(현재 v$OLD_VER\)"; then ok "old v$OLD_VER menu offers v$CUR from main VERSION"
else bad "old v$OLD_VER menu does not offer v$CUR"; fi
out=$("$P/.ccb-update.sh" 2>&1)
if [ "$(plugin_ver)" = "$CUR" ] && head -1 "$P/claude-codex-usage.2m.js" | grep -qx "#!$BUN"; then ok "old updater moved v$OLD_VER → v$CUR"
else bad "old updater did not install v$CUR: $out"; fi
grep -q 'RAW/claude-codex-usage' "$P/.ccb-update.sh" && OLD_UPDATER_LEFT=1 || OLD_UPDATER_LEFT=0

# Newer release that the now-current install should see
make_release "$NEXT"; publish_latest "$NEXT"
snap() { shasum -a 256 "$P/claude-codex-usage.2m.js" "$P/.ccb-update.sh" | awk '{print $1}' | tr '\n' ' '; }

# ── 2. Hash mismatch → nothing replaced ──
before=$(snap)
cp "$SRV/download/v$NEXT/SHA256SUMS.txt" "$T/sums.good"
printf '%064d  claude-codex-battery-macos.zip\n' 0 > "$SRV/download/v$NEXT/SHA256SUMS.txt"
out=$(selfupdate); rc=$?
if [ $rc -ne 0 ] && grep -q "SHA256 mismatch" <<<"$out" && [ "$(snap)" = "$before" ] && [ "$(plugin_ver)" = "$CUR" ]; then ok "hash mismatch: refused, files unchanged"
else bad "hash mismatch (rc=$rc): $out"; fi
ls -a "$P" | grep -q '^\.ccb-new-' && bad "temp file left in plugin dir" || ok "no temp files left"

# Tampered zip with the original checksum
cp "$T/sums.good" "$SRV/download/v$NEXT/SHA256SUMS.txt"
cp "$SRV/download/v$NEXT/claude-codex-battery-macos.zip" "$T/zip.good"
printf 'x' >> "$SRV/download/v$NEXT/claude-codex-battery-macos.zip"
out=$(selfupdate); rc=$?
if [ $rc -ne 0 ] && grep -q "SHA256 mismatch" <<<"$out" && [ "$(snap)" = "$before" ]; then ok "tampered zip: refused, files unchanged"
else bad "tampered zip (rc=$rc): $out"; fi
cp "$T/zip.good" "$SRV/download/v$NEXT/claude-codex-battery-macos.zip"

# ── 3. Other refusals ──
: > "$SRV/download/v$NEXT/SHA256SUMS.txt"
out=$(selfupdate); rc=$?
[ $rc -ne 0 ] && grep -q "no entry" <<<"$out" && [ "$(snap)" = "$before" ] && ok "missing checksum entry: refused" || bad "missing checksum entry (rc=$rc): $out"
cp "$T/sums.good" "$SRV/download/v$NEXT/SHA256SUMS.txt"

make_release "$CUR"; mkdir -p "$SRV/download/v9.9.9"
cp "$SRV/download/v$CUR/"* "$SRV/download/v9.9.9/"; publish_latest 9.9.9
out=$(selfupdate); rc=$?
[ $rc -ne 0 ] && grep -q "do not match v9.9.9" <<<"$out" && [ "$(snap)" = "$before" ] && ok "contents/tag mismatch: refused" || bad "contents/tag mismatch (rc=$rc): $out"

publish_latest 1.5.0
out=$(selfupdate); rc=$?
[ $rc -eq 0 ] && grep -q "Already up to date" <<<"$out" && [ "$(snap)" = "$before" ] && ok "older release: no downgrade" || bad "older release (rc=$rc): $out"

printf '{"tag_name":"v1.8.0; rm -rf /"}' > "$SRV/latest.json"
out=$(selfupdate); rc=$?
[ $rc -ne 0 ] && grep -q "unexpected release tag" <<<"$out" && ok "malformed tag: refused" || bad "malformed tag (rc=$rc): $out"

# ── 5a. --check-update + menu ──
publish_latest "$NEXT"; rm -f "$H/.claude/swiftbar/.update-check.json"
CCB_UPDATE_TEST_BASE=$BASE "$BUN" "$P/claude-codex-usage.2m.js" --check-update
grep -q "\"latest\":\"$NEXT\"" "$H/.claude/swiftbar/.update-check.json" 2>/dev/null && ok "--check-update records v$NEXT" || bad "--check-update cache: $(cat "$H/.claude/swiftbar/.update-check.json" 2>&1)"
menu=$(CCB_UPDATE_TEST_BASE=$BASE "$BUN" "$P/claude-codex-usage.2m.js" | grep "Update to v$NEXT")
grep -q "param2=--self-update" <<<"$menu" && ! grep -q "ccb-update.sh" <<<"$menu" && ok "menu runs --self-update" || bad "menu line: $menu"

# ── 4. Good release → installed ──
out=$(selfupdate); rc=$?
if [ $rc -eq 0 ] && [ "$(plugin_ver)" = "$NEXT" ] && head -1 "$P/claude-codex-usage.2m.js" | grep -qx "#!$BUN" \
  && [ -x "$P/claude-codex-usage.2m.js" ] && cmp -s ccb-update.sh "$P/.ccb-update.sh" && [ -f "$P/claude-codex-usage.2m.js.bak" ] \
  && [ ! -f "$H/.claude/swiftbar/.update-check.json" ]; then ok "good release: v$CUR → v$NEXT"
else bad "good release (rc=$rc): $out"; fi
[ "$OLD_UPDATER_LEFT" = 1 ] && ! grep -q 'RAW/claude-codex-usage' "$P/.ccb-update.sh" && ok "old .ccb-update.sh replaced by the release copy" || bad "old .ccb-update.sh still in place"
ls -a "$P" | grep -q '^\.ccb-new-' && bad "temp file left after install" || true

# The refreshed .ccb-update.sh wrapper runs the same verified path
out=$(CCB_UPDATE_TEST_BASE=$BASE "$P/.ccb-update.sh" 2>&1)
grep -q "Already up to date (v$NEXT" <<<"$out" && ok ".ccb-update.sh wrapper → --self-update" || bad "wrapper: $out"
exit $fail

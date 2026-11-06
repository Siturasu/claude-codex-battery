#!/usr/bin/env bash
# Asserts the Claude live-fetch failure reasons shown in the dropdown (1.5.3).
# Uses a fake HOME and a renamed Keychain service, so real credentials are never read.
# Case 2 makes one real call to the usage API with an invalid token (expects 401).
set -u
cd "$(dirname "$0")/.."
BUN=/usr/local/bin/bun; [ -x "$BUN" ] || BUN=$(command -v bun)
WORK=$(mktemp -d); FAKE_HOME=$(mktemp -d)
trap 'rm -rf "$WORK" "$FAKE_HOME"' EXIT
sed 's/Claude Code-credentials/Claude Code-credentials-ccbtest/' claude-codex-usage.2m.js > "$WORK/plugin.js"
mkdir -p "$FAKE_HOME/.claude/swiftbar"
now=$(date +%s)
resets=$(date -u -r $((now + 3 * 86400)) +%Y-%m-%dT%H:%M:%SZ)
fail=0

run_case() { # name expiresAtMs token proxy expected
  local name=$1 exp=$2 token=$3 proxy=$4 want=$5 out
  printf '{"claudeAiOauth":{"accessToken":"%s","expiresAt":%s}}' "$token" "$exp" > "$FAKE_HOME/.claude/.credentials.json"
  printf '{"fetchedAt":%s,"data":{"five_hour":null,"seven_day":{"utilization":21,"resets_at":"%s"}}}' \
    $((now - 600)) "$resets" > "$FAKE_HOME/.claude/swiftbar/.claude-usage.json"
  out=$(env HOME="$FAKE_HOME" CCB_LANG=en NO_PROXY= no_proxy= ${proxy:+https_proxy=$proxy HTTPS_PROXY=$proxy} "$BUN" "$WORK/plugin.js" 2>&1)
  if grep -qF "$want" <<<"$out"; then echo "PASS $name"
  else echo "FAIL $name (want: $want)"; grep -E 'cached|live' <<<"$out" | head -3; fail=1; fi
}

ms=$((now * 1000))
run_case "expired token skips the call" $((ms - 1000)) "sk-ant-oat01-ccbtest-fake" "http://127.0.0.1:9" "token expired"
run_case "API 401 reads as expired" $((ms + 3600000)) "sk-ant-oat01-ccbtest-invalid" "" "token expired"
run_case "unreachable network" $((ms + 3600000)) "sk-ant-oat01-ccbtest-fake" "http://127.0.0.1:9" "network/timeout"
exit $fail

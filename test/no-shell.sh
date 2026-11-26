#!/usr/bin/env bash
# Values from auth.json and binary paths reach child processes as argv, not through a shell.
# Fake HOME whose path has spaces and shell metacharacters; renamed Keychain service so real
# credentials are never read; Codex call goes to a dead proxy so nothing leaves the machine.
set -u
cd "$(dirname "$0")/.."
PLUGIN=${PLUGIN:-claude-codex-usage.2m.js}
BUN=/usr/local/bin/bun; [ -x "$BUN" ] || BUN=$(command -v bun)
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
H="$T/home dir; \$(touch $T/pwn-home)"
mkdir -p "$H/.claude/swiftbar" "$H/.codex" "$H/.local/bin"
sed 's/Claude Code-credentials/Claude Code-credentials-ccbtest/' "$PLUGIN" > "$T/plugin.js"
fail=0
now=$(date +%s)
resets=$(date -u -r $((now + 86400)) +%Y-%m-%dT%H:%M:%SZ)
# Codex: account_id carrying a command substitution
printf '{"tokens":{"access_token":"ccbtest-fake","account_id":"acct$(touch %s/pwn-codex)"}}' "$T" > "$H/.codex/auth.json"
# Gemini: fake agy under the odd HOME path
cat > "$H/.local/bin/agy" <<SH
#!/bin/sh
[ "\$1" = "-p" ] && [ "\$2" = "/usage" ] || exit 3
# 85% on the first call, 40% after that (tells the background refresh apart from the first run)
if [ -e "\$0.called" ]; then pct=40; else pct=85; : > "\$0.called"; fi
printf 'Gemini Models\tWeekly Limit Remaining\t%s%%\t$resets\n' "\$pct"
SH
chmod +x "$H/.local/bin/agy"
run() { env HOME="$H" CCB_LANG=en https_proxy=http://127.0.0.1:9 HTTPS_PROXY=http://127.0.0.1:9 NO_PROXY= no_proxy= "$BUN" "$T/plugin.js" 2>&1; }

out=$(run)
grep -q "Gemini (Antigravity)" <<<"$out" && echo "PASS agy at a path with spaces/metacharacters runs (first sync call)" || { echo "FAIL agy first call"; fail=1; }
# Background refresh path: make the cache stale, run, wait for the detached job
touch -t "$(date -v-1H +%Y%m%d%H%M)" "$H/.claude/swiftbar/.gemini-usage.txt"
run >/dev/null; sleep 2
grep -q "Remaining	40%" "$H/.claude/swiftbar/.gemini-usage.txt" && echo "PASS agy background refresh replaced the cache" || { echo "FAIL agy background refresh"; fail=1; }
ls "$H/.claude/swiftbar/" | grep -q '\.tmp$' && { echo "FAIL tmp file left"; fail=1; }
for m in pwn-home pwn-codex; do
  [ -e "$T/$m" ] && { echo "FAIL command ran via shell: $m"; fail=1; } || echo "PASS no shell expansion ($m)"
done
exit $fail

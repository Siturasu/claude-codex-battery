#!/usr/bin/env bash
# --serve listens on 127.0.0.1 unless --host=ADDR is given. Fake HOME with .no-live (no Keychain, no live calls).
set -u
cd "$(dirname "$0")/.."
PLUGIN=${PLUGIN:-claude-codex-usage.2m.js}
BUN=/usr/local/bin/bun; [ -x "$BUN" ] || BUN=$(command -v bun)
H=$(mktemp -d); mkdir -p "$H/.claude/swiftbar"; touch "$H/.claude/swiftbar/.no-live"
PID=; fail=0
trap '[ -n "$PID" ] && kill $PID 2>/dev/null; rm -rf "$H"' EXIT
listen_addr() { # port → address column of the LISTEN socket
  for _ in $(seq 50); do
    a=$(lsof -nP -a -p "$PID" -iTCP:"$1" -sTCP:LISTEN 2>/dev/null | awk 'NR>1{print $9; exit}')
    [ -n "$a" ] && { echo "$a"; return; }
    sleep 0.1
  done
}
start() { # port extra-args...
  local port=$1; shift
  env HOME="$H" CCB_LANG=en CCB_PORT="$port" "$BUN" "$PLUGIN" --serve "$@" >/dev/null 2>&1 & PID=$!; disown
}
stop() { kill "$PID" 2>/dev/null; PID=; }

P1=$((41500 + RANDOM % 400))
start "$P1"
a=$(listen_addr "$P1")
[ "$a" = "127.0.0.1:$P1" ] && echo "PASS default binds 127.0.0.1 ($a)" || { echo "FAIL default bind: '$a'"; fail=1; }
LAN=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || true)
if [ -n "$LAN" ]; then
  curl -s --max-time 3 -o /dev/null "http://$LAN:$P1/" && { echo "FAIL reachable on $LAN"; fail=1; } || echo "PASS not reachable on LAN address $LAN"
fi
curl -s --max-time 20 "http://127.0.0.1:$P1/" | grep -qi "<html" && echo "PASS serves HTML on loopback" || { echo "FAIL no HTML on loopback"; fail=1; }
stop

P2=$((P1 + 1))
start "$P2" --host=0.0.0.0
a=$(listen_addr "$P2")
[ "$a" = "*:$P2" ] && echo "PASS --host=0.0.0.0 binds all interfaces ($a)" || { echo "FAIL --host bind: '$a'"; fail=1; }
stop
exit $fail

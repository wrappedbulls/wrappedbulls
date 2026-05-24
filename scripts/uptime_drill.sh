#!/usr/bin/env bash
# uptime_drill.sh — EMPIRICAL proof that the site stays up.
#
# This is the answer to "prove the website never goes down." It cannot
# prove a negative about the future, but it CAN prove the deploy +
# failover machinery survives the events that actually take sites down:
# a deploy, a rollback, and a process crash.
#
# HOW TO USE IT (run on any machine that can reach the public URL):
#
#   Terminal A — start the drill (hammers the URL continuously):
#     ./scripts/uptime_drill.sh --url https://<domain>/ --duration 180
#
#   Terminal B — WHILE the drill runs, exercise the scary operations:
#     ./scripts/blue_green_deploy.sh ...            # a full deploy
#     ./scripts/blue_green_deploy.sh ... --skip-build   # a rollback
#     sudo systemctl kill -s KILL <slug>-web-<active>   # a hard crash
#
#   The drill prints a live tally and a final verdict. PASS = zero
#   failed requests across everything you threw at it in Terminal B.
#
# A request "fails" if curl cannot connect OR the HTTP status is not
# 2xx/3xx. `maxConsecutiveFailures` x interval is the worst-case
# user-visible outage; the drill PASSES only if that is 0.
#
# Usage:
#   ./scripts/uptime_drill.sh --url <url> [--duration <s>] [--interval-ms <n>]
#
# Options:
#   --url <url>          target URL (required)
#   --duration <s>       how long to run, seconds (default 120)
#   --interval-ms <n>    delay between requests, ms (default 250)
#   --allow <n>          tolerate up to N total failures (default 0 = strict)
#
# Exit: 0 = PASS (failures within --allow), 1 = FAIL.

set -uo pipefail

red()   { printf '\033[31m%s\033[0m\n' "$*" >&2; }
green() { printf '\033[32m%s\033[0m\n' "$*"; }
yellow(){ printf '\033[33m%s\033[0m\n' "$*"; }

URL=""
DURATION=120
INTERVAL_MS=250
ALLOW=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --url)         URL="$2"; shift 2 ;;
    --duration)    DURATION="$2"; shift 2 ;;
    --interval-ms) INTERVAL_MS="$2"; shift 2 ;;
    --allow)       ALLOW="$2"; shift 2 ;;
    -h|--help)     grep -E '^#' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) red "unknown option: $1"; exit 1 ;;
  esac
done

[[ -n "$URL" ]] || { red "--url is required"; exit 1; }
command -v curl >/dev/null 2>&1 || { red "curl not found"; exit 1; }

# Bash sleep accepts fractional seconds.
INTERVAL_S="$(awk "BEGIN { printf \"%.3f\", $INTERVAL_MS/1000 }")"

echo "=== uptime drill ==="
echo "target:    $URL"
echo "duration:  ${DURATION}s   interval: ${INTERVAL_MS}ms   tolerate: $ALLOW failure(s)"
echo "Run your deploy / rollback / crash test in another terminal NOW."
echo

total=0; ok=0; fail=0
cur_streak=0; max_streak=0
first_fail=""; last_fail=""
start_ts="$(date +%s)"
deadline=$(( start_ts + DURATION ))

while [[ $(date +%s) -lt $deadline ]]; do
  # -s silent, -o discard body, -m hard timeout, -w print status.
  # curl exits non-zero on connect failure -> code stays "000".
  code="$(curl -s -o /dev/null -m 5 -w '%{http_code}' "$URL" 2>/dev/null || echo 000)"
  total=$((total+1))
  if [[ "$code" =~ ^[23][0-9][0-9]$ ]]; then
    ok=$((ok+1))
    cur_streak=0
  else
    fail=$((fail+1))
    cur_streak=$((cur_streak+1))
    [[ $cur_streak -gt $max_streak ]] && max_streak=$cur_streak
    now="$(date -u +%H:%M:%S)"
    [[ -z "$first_fail" ]] && first_fail="$now (HTTP $code)"
    last_fail="$now (HTTP $code)"
  fi
  # Live one-line tally (carriage return, no newline).
  printf '\r  reqs=%-6d ok=%-6d fail=%-4d  worst-streak=%-3d  elapsed=%ds   ' \
    "$total" "$ok" "$fail" "$max_streak" "$(( $(date +%s) - start_ts ))"
  sleep "$INTERVAL_S"
done
echo; echo

# --- verdict ---------------------------------------------------------
avail="n/a"
if [[ $total -gt 0 ]]; then
  avail="$(awk "BEGIN { printf \"%.3f\", ($ok/$total)*100 }")"
fi
worst_outage_ms=$(( max_streak * INTERVAL_MS ))

echo "=== result ==="
echo "  requests:               $total"
echo "  ok (2xx/3xx):           $ok"
echo "  failed:                 $fail"
echo "  availability:           ${avail}%"
echo "  longest failure streak: $max_streak request(s)  (~${worst_outage_ms}ms of outage)"
[[ -n "$first_fail" ]] && echo "  first failure:          $first_fail"
[[ -n "$last_fail"  ]] && echo "  last failure:           $last_fail"
echo

if [[ $fail -le $ALLOW ]]; then
  green "✅ PASS — $fail failure(s), within the allowed $ALLOW."
  green "   The site stayed up across everything exercised during the drill."
  exit 0
else
  red "❌ FAIL — $fail failure(s) exceeds the allowed $ALLOW."
  red "   Worst user-visible outage ~${worst_outage_ms}ms. Investigate before relaunch:"
  red "   - did the deploy swap before the new instance was healthy?"
  red "   - is Caddy active-health-checking both upstreams? (deploy/caddy/upstream.conf)"
  red "   - did BOTH colors go down at once? (shared dependency / OOM / disk)"
  exit 1
fi

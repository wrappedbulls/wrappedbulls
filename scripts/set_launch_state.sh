#!/usr/bin/env bash
# set_launch_state.sh — flip the runtime launch state atomically.
#
# This is the rollback lever. Last launch, rolling back from "live" to
# "pre-launch" required a full rebuild (the state was a build-time
# constant) which 502'd the site. Now it is a single atomic file
# write that the running Next.js process picks up on the next request.
# See docs/LESSONS_LEARNED.md L1.
#
# Usage:
#   ./scripts/set_launch_state.sh pre-launch
#   ./scripts/set_launch_state.sh live --mint <TOKEN_MINT_BASE58>
#   ./scripts/set_launch_state.sh status      # print current state
#
# Target file resolution (must match web/lib/launch-state.ts):
#   1. $LAUNCH_STATE_FILE  (production — set this in the systemd unit)
#   2. web/config/launch-state.json  (dev fallback)
#
# The write is atomic: content goes to a temp file in the same
# directory, then `mv` renames it over the target. A reader never sees
# a half-written file.

set -euo pipefail

red()   { printf '\033[31m%s\033[0m\n' "$*" >&2; }
green() { printf '\033[32m%s\033[0m\n' "$*"; }

# Resolve the state file path.
resolve_path() {
  if [[ -n "${LAUNCH_STATE_FILE:-}" ]]; then
    printf '%s' "$LAUNCH_STATE_FILE"
    return
  fi
  # Dev fallback — relative to repo root (this script lives in scripts/).
  local script_dir
  script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  printf '%s' "$script_dir/../web/config/launch-state.json"
}

STATE_FILE="$(resolve_path)"

usage() {
  cat <<EOF
Usage:
  $0 pre-launch                       Roll back to the pre-launch teaser
  $0 live --mint <TOKEN_MINT_BASE58>  Go live (mint required)
  $0 status                           Print the current state file

Target file: $STATE_FILE
  (override with the LAUNCH_STATE_FILE env var)
EOF
}

[[ $# -lt 1 ]] && { usage; exit 1; }

CMD="$1"; shift || true

case "$CMD" in
  status)
    if [[ -f "$STATE_FILE" ]]; then
      green "Current launch state ($STATE_FILE):"
      cat "$STATE_FILE"
    else
      red "No state file at $STATE_FILE — readers default to pre-launch."
    fi
    exit 0
    ;;

  pre-launch)
    NEW_STATE="pre-launch"
    MINT="null"
    ;;

  live)
    NEW_STATE="live"
    MINT=""
    while [[ $# -gt 0 ]]; do
      case "$1" in
        --mint) MINT="$2"; shift 2 ;;
        *) red "unknown flag: $1"; usage; exit 1 ;;
      esac
    done
    if [[ -z "$MINT" ]]; then
      red "'live' requires --mint <TOKEN_MINT_BASE58>."
      red "Going live without the mint leaves display badges blank."
      exit 1
    fi
    # Base58 sanity check (32-44 chars, no 0/O/I/l).
    if ! [[ "$MINT" =~ ^[1-9A-HJ-NP-Za-km-z]{32,44}$ ]]; then
      red "'$MINT' does not look like a base58 Solana mint address."
      exit 1
    fi
    MINT="\"$MINT\""
    ;;

  -h|--help)
    usage; exit 0 ;;

  *)
    red "unknown command: $CMD"
    usage; exit 1 ;;
esac

TS="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
mkdir -p "$(dirname "$STATE_FILE")"

# Atomic write: temp file in the same dir, then mv over the target.
TMP="$(mktemp "$(dirname "$STATE_FILE")/.launch-state.XXXXXX")"
cat > "$TMP" <<EOF
{
  "state": "$NEW_STATE",
  "tokenMint": $MINT,
  "updatedAt": "$TS"
}
EOF
mv -f "$TMP" "$STATE_FILE"

green "Launch state set to '$NEW_STATE' at $STATE_FILE"
echo "Effective on the next page load — no rebuild, no restart."
[[ "$NEW_STATE" == "live" ]] && echo "Token mint: ${MINT//\"/}"
exit 0

#!/usr/bin/env bash
# blue_green_deploy.sh — zero-downtime web deploy.
#
# THE LESSON (docs/LESSONS_LEARNED.md L13): single-instance + rebuild
# in place = a downtime window on every deploy. During the last launch
# even a 60-second 502 felt catastrophic. This removes the window.
#
# MODEL — two SEPARATE checkouts, blue and green:
#   - Each color has its own directory, its own node_modules, its own
#     .next build. A deploy of one NEVER touches the other's files.
#   - Caddy active-health-checks both and routes to whichever is
#     listed first in upstream.conf (lb_policy first). The other is a
#     hot spare — if the active crashes, Caddy fails over in ~one
#     health interval.
#   - A deploy builds the STANDBY checkout, health-checks it, then
#     atomically rewrites upstream.conf to list the standby first and
#     `caddy reload`s. The old color stays running on its old build:
#     it is both the instant-rollback target and the crash-failover
#     spare.
#
# Steps:
#   1. Acquire the deploy lock (flock) — no concurrent deploys.
#   2. Detect the active color from upstream.conf; target = the other.
#   3. Build the TARGET checkout (npm ci + npm run build) — the live
#      checkout is never touched.
#   4. Restart the target systemd instance.
#   5. Poll the target's /api/launch-state until it answers 200.
#   6. Atomically rewrite upstream.conf (target listed first); reload.
#
# Usage:
#   ./scripts/blue_green_deploy.sh --slug <slug> \
#       --blue-dir <path> --green-dir <path> [options]
#
# Required:
#   --slug <slug>        systemd prefix: <slug>-web-blue / <slug>-web-green
#   --blue-dir <path>    blue checkout root  (contains web/)
#   --green-dir <path>   green checkout root (contains web/)
#
# Options:
#   --upstream <path>      Caddy upstream file (default /etc/caddy/upstream.conf)
#   --caddy-reload <cmd>   reload command (default "systemctl reload caddy")
#   --health-timeout <s>   seconds to wait for the new instance (default 90)
#   --skip-build           swap only, no rebuild (fast rollback / retry)
#
# Rollback: re-run with --skip-build — swaps back to the other color,
# still running the previous build. Sub-second cutover.
#
# Exit: 0 = deployed (or rolled back), non-zero = aborted, NO swap done.

set -uo pipefail

red()   { printf '\033[31m%s\033[0m\n' "$*" >&2; }
green() { printf '\033[32m%s\033[0m\n' "$*"; }
yellow(){ printf '\033[33m%s\033[0m\n' "$*"; }
step()  { printf '\033[1m[deploy] %s\033[0m\n' "$*"; }

SLUG=""; BLUE_DIR=""; GREEN_DIR=""
UPSTREAM="/etc/caddy/upstream.conf"
CADDY_RELOAD="systemctl reload caddy"
HEALTH_TIMEOUT=90
SKIP_BUILD=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --slug)            SLUG="$2"; shift 2 ;;
    --blue-dir)        BLUE_DIR="$2"; shift 2 ;;
    --green-dir)       GREEN_DIR="$2"; shift 2 ;;
    --upstream)        UPSTREAM="$2"; shift 2 ;;
    --caddy-reload)    CADDY_RELOAD="$2"; shift 2 ;;
    --health-timeout)  HEALTH_TIMEOUT="$2"; shift 2 ;;
    --skip-build)      SKIP_BUILD=1; shift ;;
    -h|--help)         grep -E '^#' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) red "unknown option: $1"; exit 1 ;;
  esac
done

for v in SLUG BLUE_DIR GREEN_DIR; do
  if [[ -z "${!v}" ]]; then
    red "missing required flag for $v (see --help)"
    exit 1
  fi
done
for d in "$BLUE_DIR/web" "$GREEN_DIR/web"; do
  [[ -d "$d" ]] || { red "checkout not found: $d"; exit 1; }
done

# Emit the full Caddy reverse_proxy block with $1 as the active
# (first) port and $2 as the spare. Keep this in lockstep with
# deploy/caddy/upstream.conf.example.
emit_upstream() {
  local active="$1" spare="$2"
  cat <<EOF
reverse_proxy 127.0.0.1:${active} 127.0.0.1:${spare} {
	lb_policy first
	health_uri /api/launch-state
	health_interval 3s
	health_timeout 2s
	health_status 200
	fail_duration 10s
	max_fails 1
}
EOF
}

# --- Step 1: deploy lock --------------------------------------------
if ! command -v flock >/dev/null 2>&1; then
  red "flock(1) not found — cannot guarantee single-deploy safety. Aborting."
  exit 1
fi
LOCK_FILE="/tmp/${SLUG}-deploy.lock"
exec 200>"$LOCK_FILE"
if ! flock -n 200; then
  red "another deploy is already running (lock: $LOCK_FILE). Aborting."
  exit 1
fi
step "deploy lock acquired"

# --- Step 2: detect active color ------------------------------------
[[ -f "$UPSTREAM" ]] || { red "upstream file not found: $UPSTREAM (copy it from deploy/caddy/upstream.conf.example)"; exit 1; }
# The FIRST 127.0.0.1:PORT on the reverse_proxy line is the active one.
ACTIVE_PORT="$(grep -oE '127\.0\.0\.1:[0-9]+' "$UPSTREAM" | head -1 | cut -d: -f2)"
case "$ACTIVE_PORT" in
  3001) ACTIVE_COLOR=blue;  TARGET_COLOR=green; TARGET_PORT=3002; TARGET_DIR="$GREEN_DIR" ;;
  3002) ACTIVE_COLOR=green; TARGET_COLOR=blue;  TARGET_PORT=3001; TARGET_DIR="$BLUE_DIR" ;;
  *) red "could not parse the active port from $UPSTREAM (got '$ACTIVE_PORT')"; exit 1 ;;
esac
TARGET_SVC="${SLUG}-web-${TARGET_COLOR}"
step "active=$ACTIVE_COLOR(:$ACTIVE_PORT)  ->  deploying to $TARGET_COLOR(:$TARGET_PORT)  [$TARGET_DIR]"

# --- Step 3: build the TARGET checkout (live one untouched) ---------
if [[ "$SKIP_BUILD" -eq 1 ]]; then
  yellow "[3/6] --skip-build: reusing the existing build in $TARGET_DIR"
else
  step "[3/6] building $TARGET_COLOR checkout ($TARGET_DIR/web)"
  ( cd "$TARGET_DIR/web" && npm ci && npm run build ) || {
    red "build failed in $TARGET_DIR — NO swap, $ACTIVE_COLOR still serving."
    exit 1
  }
fi

# --- Step 4: (re)start the target instance --------------------------
step "[4/6] restarting $TARGET_SVC"
systemctl restart "$TARGET_SVC" || {
  red "failed to start $TARGET_SVC — NO swap, $ACTIVE_COLOR still serving."
  exit 1
}

# --- Step 5: health-poll the target ---------------------------------
# Probe /api/launch-state: served purely by Next.js, no external dep,
# so a 200 means "the new instance is genuinely ready". (/api/health
# would 503 on a degraded RPC and wrongly fail a healthy deploy.)
step "[5/6] waiting up to ${HEALTH_TIMEOUT}s for $TARGET_COLOR to be ready"
deadline=$(( $(date +%s) + HEALTH_TIMEOUT ))
ready=0
while [[ $(date +%s) -lt $deadline ]]; do
  code="$(curl -fsS -o /dev/null -w '%{http_code}' \
            "http://127.0.0.1:${TARGET_PORT}/api/launch-state" 2>/dev/null || echo 000)"
  [[ "$code" == "200" ]] && { ready=1; break; }
  sleep 2
done
if [[ "$ready" -ne 1 ]]; then
  red "$TARGET_COLOR did not become healthy in ${HEALTH_TIMEOUT}s."
  red "NO swap performed — $ACTIVE_COLOR is still serving traffic."
  red "Investigate: journalctl -u $TARGET_SVC -n 50"
  exit 1
fi
step "$TARGET_COLOR is healthy"

# --- Step 6: atomic upstream swap + caddy reload --------------------
step "[6/6] swapping Caddy to $TARGET_COLOR and reloading"
TMP="$(mktemp "$(dirname "$UPSTREAM")/.upstream.XXXXXX")"
emit_upstream "$TARGET_PORT" "$ACTIVE_PORT" > "$TMP"
mv -f "$TMP" "$UPSTREAM"          # atomic rename
if ! $CADDY_RELOAD; then
  red "caddy reload FAILED. Rolling upstream.conf back to $ACTIVE_COLOR."
  emit_upstream "$ACTIVE_PORT" "$TARGET_PORT" > "$UPSTREAM"
  $CADDY_RELOAD || red "rollback reload ALSO failed — check Caddy manually NOW."
  exit 1
fi

green "================================================================"
green " DEPLOYED — $TARGET_COLOR (:$TARGET_PORT) is now active."
green " $ACTIVE_COLOR (:$ACTIVE_PORT) stays RUNNING as the hot spare"
green " (crash failover) and the instant rollback target."
green " Rollback:  ./scripts/blue_green_deploy.sh --slug $SLUG \\"
green "              --blue-dir $BLUE_DIR --green-dir $GREEN_DIR --skip-build"
green "================================================================"
exit 0

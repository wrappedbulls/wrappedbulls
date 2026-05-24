#!/usr/bin/env bash
# with_deploy_lock.sh — run a command while holding an exclusive
# deploy lock. A second concurrent invocation aborts immediately
# instead of racing.
#
# THE BUG (docs/LESSONS_LEARNED.md L14): two concurrent `anchor deploy`
# runs both consume buffer-account SOL and one fails. More generally,
# any two deploy/launch operations overlapping is a recipe for the
# kind of chaos the last launch saw.
#
# Unlike the advisory lock in no_concurrent_agents.sh, this uses
# flock(1): a kernel-enforced lock tied to an open file descriptor.
# It is released AUTOMATICALLY when the holding process exits — even
# on crash or kill — so it can never get stuck "held by a dead pid".
#
# Usage:
#   ./scripts/with_deploy_lock.sh <command> [args...]
#
# Example:
#   ./scripts/with_deploy_lock.sh anchor deploy --provider.cluster mainnet
#   ./scripts/with_deploy_lock.sh ./scripts/launch.sh <MINT>
#
# Lock file: $DEPLOY_LOCK_FILE, default /tmp/<repo-name>-deploy.lock
# (a stable per-repo path so all operators on the box share one lock).
#
# Exit: the wrapped command's exit code, OR 1 if the lock is busy.

set -euo pipefail

red()   { printf '\033[31m%s\033[0m\n' "$*" >&2; }
green() { printf '\033[32m%s\033[0m\n' "$*"; }

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <command> [args...]" >&2
  exit 1
fi

if ! command -v flock >/dev/null 2>&1; then
  red "flock(1) not found. On macOS: 'brew install flock'. On Linux it"
  red "ships with util-linux. Cannot enforce the deploy lock without it."
  exit 1
fi

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_NAME="$(basename "$REPO_DIR")"
LOCK_FILE="${DEPLOY_LOCK_FILE:-/tmp/${REPO_NAME}-deploy.lock}"

# Open fd 200 on the lock file. flock -n takes a NON-BLOCKING exclusive
# lock; if another process holds it, flock returns non-zero and we
# abort rather than queueing.
exec 200>"$LOCK_FILE"
if ! flock -n 200; then
  red "================================================================"
  red " DEPLOY LOCK BUSY"
  red " Another deploy/launch is already running (lock: $LOCK_FILE)."
  red " Refusing to start a second one. Wait for it to finish."
  red "================================================================"
  exit 1
fi

# Record who holds it (informational — flock itself is the real lock).
{
  echo "pid=$$"
  echo "host=$(hostname 2>/dev/null || echo unknown)"
  echo "user=${USER:-unknown}"
  echo "command=$*"
  echo "acquiredAt=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
} >&200

green "deploy lock acquired ($LOCK_FILE) — running: $*"
echo

# Run the wrapped command. The lock (fd 200) stays held for the entire
# duration and is auto-released when this script process exits.
set +e
"$@"
RC=$?
set -e

echo
if [[ $RC -eq 0 ]]; then
  green "command finished OK — deploy lock released."
else
  red "command exited $RC — deploy lock released."
fi
exit $RC

#!/usr/bin/env bash
# no_concurrent_agents.sh — guard against concurrent operators / agents
# touching the repo during a deploy or launch.
#
# THE BUG (docs/POSTMORTEM.md §5): during the last launch's chaos
# window, two parallel agents independently flipped the PRE_LAUNCH
# constant in the same files. The site oscillated; each fix was undone
# by the other. Lesson L12: single operator, single machine, single
# branch during launch.
#
# This script provides:
#   - check    (default) heuristic scan for signs of concurrent work,
#              plus an advisory operator-lock status report.
#   - acquire  take the operator lock. Fails if a live lock is held.
#   - release  drop the operator lock (only if this PID owns it).
#
# Wire `check` (or `acquire`) into the front of any deploy/launch
# script. It is advisory — it cannot truly prevent a second human, but
# it makes concurrency loud instead of silent.
#
# Exit: 0 = clear / lock acquired, 1 = concurrency detected / lock busy.

set -uo pipefail

red()   { printf '\033[31m%s\033[0m\n' "$*" >&2; }
green() { printf '\033[32m%s\033[0m\n' "$*"; }
yellow(){ printf '\033[33m%s\033[0m\n' "$*"; }

cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Lock file lives in the repo so it travels with the working copy.
LOCK="${OPERATOR_LOCK_FILE:-.operator-session.lock}"
CMD="${1:-check}"

# The lock records the CALLER's pid ($PPID), not this script's own
# ($$). This script exits immediately after `acquire`; recording $$
# would make the lock instantly "stale". $PPID is the deploy script
# (or interactive shell) that invoked us — it stays alive for the
# duration of the operation the lock is meant to protect.
OWNER_PID="$PPID"

# Is the PID recorded in the lock file still alive?
lock_is_live() {
  [[ -f "$LOCK" ]] || return 1
  local pid
  pid="$(grep -oE '^pid=[0-9]+' "$LOCK" 2>/dev/null | cut -d= -f2)"
  [[ -n "$pid" ]] || return 1
  kill -0 "$pid" 2>/dev/null
}

lock_owner_pid() {
  grep -oE '^pid=[0-9]+' "$LOCK" 2>/dev/null | cut -d= -f2
}

# Heuristic scan: count processes that suggest another session is
# mid-operation. `ps` is portable enough across Linux/macOS/Git-Bash.
scan_processes() {
  local issues=0

  # Multiple Claude Code CLIs running at once.
  local claude_n
  claude_n="$(ps -e 2>/dev/null | grep -icE '[c]laude' | tr -dc '0-9')"
  [[ -z "$claude_n" ]] && claude_n=0
  if [[ "$claude_n" -gt 1 ]]; then
    yellow "  ! $claude_n 'claude' processes running — possible parallel agents"
    issues=$((issues+1))
  else
    green "  ✓ at most one 'claude' process"
  fi

  # An in-flight deploy from another shell.
  if ps -e 2>/dev/null | grep -qiE '[s]olana program deploy|[a]nchor deploy'; then
    yellow "  ! an 'anchor/solana program deploy' is already running"
    issues=$((issues+1))
  else
    green "  ✓ no deploy process running"
  fi

  # An in-flight build that another session may be depending on.
  if ps -e 2>/dev/null | grep -qiE '[c]argo build|[c]argo-build-sbf|[n]ext build'; then
    yellow "  ! a build (cargo/next) is running — another session may be active"
    issues=$((issues+1))
  else
    green "  ✓ no build process running"
  fi

  return "$issues"
}

case "$CMD" in
  acquire)
    if lock_is_live; then
      red "operator lock is HELD by a live process (pid=$(lock_owner_pid))."
      red "Another operator/agent session is active. Refusing to acquire."
      red "If you are certain it is stale: rm $LOCK"
      exit 1
    fi
    if [[ -f "$LOCK" ]]; then
      yellow "stale lock found (pid=$(lock_owner_pid) is dead) — reclaiming."
    fi
    {
      echo "pid=$OWNER_PID"
      echo "host=$(hostname 2>/dev/null || echo unknown)"
      echo "tty=$(tty 2>/dev/null || echo none)"
      echo "user=${USER:-unknown}"
      echo "acquiredAt=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    } > "$LOCK"
    green "operator lock acquired (pid=$OWNER_PID). Release with: $0 release"
    exit 0
    ;;

  release)
    # Advisory lock: `release` simply removes the file. Calling
    # release is an explicit "I am done" declaration. We do NOT gate
    # on PID ownership — bash's last-command exec optimization makes
    # $PPID unreliable for a short-lived helper, and an advisory lock
    # that you cannot reliably release is worse than no lock.
    if [[ ! -f "$LOCK" ]]; then
      yellow "no lock file present — nothing to release."
      exit 0
    fi
    owner="$(lock_owner_pid)"
    if [[ -n "$owner" ]] && kill -0 "$owner" 2>/dev/null; then
      yellow "note: lock recorded a still-live pid=$owner — removing anyway."
      yellow "      if that is another operator's session, coordinate first."
    fi
    rm -f "$LOCK"
    green "operator lock released."
    exit 0
    ;;

  check)
    echo "=== no_concurrent_agents: check ==="
    echo "[1] process scan"
    scan_processes
    proc_issues=$?
    echo
    echo "[2] operator lock"
    if lock_is_live; then
      red "  ✗ operator lock HELD by a live process:"
      sed 's/^/      /' "$LOCK"
      lock_issue=1
    elif [[ -f "$LOCK" ]]; then
      yellow "  ! stale lock file present (owner pid is dead) — safe to reclaim"
      lock_issue=0
    else
      green "  ✓ no operator lock held"
      lock_issue=0
    fi
    echo
    if [[ "$proc_issues" -eq 0 && "$lock_issue" -eq 0 ]]; then
      green "✅ clear — no concurrent operator/agent detected."
      exit 0
    else
      red "❌ concurrency signals detected — resolve before deploying."
      red "   Launch protocol: one operator, one machine, one branch (L12)."
      exit 1
    fi
    ;;

  -h|--help)
    grep -E '^#' "$0" | sed 's/^# \{0,1\}//'
    exit 0
    ;;

  *)
    red "unknown command: $CMD (use: check | acquire | release)"
    exit 1
    ;;
esac

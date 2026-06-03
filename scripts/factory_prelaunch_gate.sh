#!/usr/bin/env bash
# factory_prelaunch_gate.sh - one command gate that must pass before
# any FACTORY_LAUNCH_RUNBOOK step runs.
#
# Runs every cheap local check in sequence. Each is a hard gate; the
# first failure stops the gate with a non zero exit. If everything
# passes you see a clear PRELAUNCH GATE PASSED and a list of what was
# verified.
#
# Run from the repo root:
#   bash scripts/factory_prelaunch_gate.sh
#
# What this DOES NOT cover (those need network or cluster):
#   - The devnet pause drill (factory_devnet_pause_drill.ts)
#   - The HTTP smoke test (factory_prelaunch_smoke.sh)
#   - The mainnet program deploy itself
# All three of those are runbook steps; this gate is the precondition.

set -uo pipefail

cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

red()    { printf '\033[31m%s\033[0m\n' "$*" >&2; }
green()  { printf '\033[32m%s\033[0m\n' "$*"; }
yellow() { printf '\033[33m%s\033[0m\n' "$*"; }
bold()   { printf '\033[1m%s\033[0m\n' "$*"; }

FAIL=0
GATE_PASSED=()
GATE_FAILED=()

run_check() {
  local name="$1"
  shift
  bold "==> ${name}"
  if "$@"; then
    green "    PASS"
    GATE_PASSED+=("${name}")
  else
    red "    FAIL"
    GATE_FAILED+=("${name}")
    FAIL=1
  fi
  echo
}

# ---- 1. Static safety guards (cheap, fail closed) ----

run_check "unwrap is never pause-guarded (load bearing invariant)" \
  bash scripts/check_unwrap_unguarded.sh

run_check "cluster flag lint (anchor vs solana name confusion)" \
  bash scripts/cluster_flag_lint.sh

# ---- 2. Rust compile + lib tests ----

if command -v cargo >/dev/null 2>&1; then
  run_check "cargo check --workspace" \
    cargo check --workspace --quiet

  run_check "cargo test --lib -p wrappedfactory (12 tier + treasury invariants)" \
    cargo test --lib -p wrappedfactory --quiet
else
  yellow "==> SKIP: cargo not in PATH; install Rust to run cargo gates"
  echo
fi

# ---- 3. Web typecheck + production build ----

if command -v node >/dev/null 2>&1; then
  bold "==> web/ tsc --noEmit"
  if (cd web && npx tsc --noEmit -p . 2>&1); then
    green "    PASS"
    GATE_PASSED+=("web tsc")
  else
    red "    FAIL"
    GATE_FAILED+=("web tsc")
    FAIL=1
  fi
  echo

  bold "==> web/ next build (production smoke)"
  if (cd web && npx next build 2>&1 | tail -5); then
    green "    PASS"
    GATE_PASSED+=("web next build")
  else
    red "    FAIL"
    GATE_FAILED+=("web next build")
    FAIL=1
  fi
  echo
else
  yellow "==> SKIP: node not in PATH; install Node 20 to run web gates"
  echo
fi

# ---- 4. Git state sanity ----

bold "==> git working tree clean on release/v1.0"
current_branch=$(git rev-parse --abbrev-ref HEAD)
if [ "$current_branch" != "release/v1.0" ]; then
  yellow "    WARN: current branch is ${current_branch}, not release/v1.0"
  yellow "    Mainnet deploys must come from release/v1.0 per the runbook."
fi
if [ -n "$(git status --porcelain)" ]; then
  red "    FAIL: uncommitted changes in working tree"
  git status --short | head -10
  GATE_FAILED+=("git clean")
  FAIL=1
else
  green "    PASS"
  GATE_PASSED+=("git clean")
fi
echo

# ---- 5. Verifiable build doc is current ----

bold "==> docs/VERIFIED_BUILD_FACTORY.md hash is NOT stale"
if grep -q "stale; pre release/v1.0" docs/VERIFIED_BUILD_FACTORY.md; then
  red "    FAIL: VERIFIED_BUILD_FACTORY.md still has the pre release/v1.0 stale marker"
  red "    Run anchor build on the VPS and update the canonical hash + source pinning."
  GATE_FAILED+=("verified build hash current")
  FAIL=1
else
  green "    PASS"
  GATE_PASSED+=("verified build hash current")
fi
echo

# ---- Summary ----

bold "=============================================="
bold "PRELAUNCH GATE SUMMARY"
bold "=============================================="
if [ ${#GATE_PASSED[@]} -gt 0 ]; then
  green "PASSED (${#GATE_PASSED[@]}):"
  for c in "${GATE_PASSED[@]}"; do
    green "  ok   ${c}"
  done
fi
if [ ${#GATE_FAILED[@]} -gt 0 ]; then
  echo
  red "FAILED (${#GATE_FAILED[@]}):"
  for c in "${GATE_FAILED[@]}"; do
    red "  fail ${c}"
  done
fi
echo

if [ "$FAIL" -eq 0 ]; then
  green "PRELAUNCH GATE PASSED"
  green "Next runbook step: 4.5 (devnet pause drill) then mainnet deploy."
  exit 0
else
  red "PRELAUNCH GATE FAILED"
  red "Fix the items above before running FACTORY_LAUNCH_RUNBOOK."
  exit 1
fi

#!/usr/bin/env bash
# mainnet_sim_gate.sh — HARD GATE. Simulates a wrap_bull against live
# mainnet state and refuses to pass unless the simulation is clean.
#
# This is the "no excuses" gate from the relaunch plan. It does NOT
# send a transaction — it runs scripts/devnet_simulate_wrap.ts (which
# mirrors the website's exact buildSignSimulateSend path) pointed at
# mainnet, and parses the result.
#
# PASS criteria (BOTH required):
#   1. The sim script prints "RESULT: CLEAN" (simulationErr === null).
#   2. The on-chain logs contain a "Wrapped <unit> tier=N" line
#      followed by a program "success" line.
#
# Run this before flipping the site live (RELAUNCH_PLAYBOOK Step 8).
# If it fails, DO NOT announce.
#
# Usage:
#   ./scripts/mainnet_sim_gate.sh <SIM_PAYER> [options]
#
#   <SIM_PAYER>  base58 pubkey to simulate the wrap AS. Must hold at
#                least tokens_per_nft of the $TOKEN mint on mainnet.
#                (Simulation ignores signatures, so any known holder
#                works — see devnet_simulate_wrap.ts.)
#
# Options:
#   --rpc <url>      mainnet RPC (default https://api.mainnet-beta.solana.com)
#   --wallet <path>  ANCHOR_WALLET keypair; only needs to be parseable,
#                    balance irrelevant (default ~/.config/solana/id.json)
#   --expect-mint <mint>  cross-check: fail if the bank's token mint
#                         does not equal this value
#
# Exit: 0 = clean (safe to go live), 1 = failed or inconclusive.

set -uo pipefail

red()   { printf '\033[31m%s\033[0m\n' "$*" >&2; }
green() { printf '\033[32m%s\033[0m\n' "$*"; }
yellow(){ printf '\033[33m%s\033[0m\n' "$*"; }

SIM_PAYER="${1:-}"
if [[ -z "$SIM_PAYER" || "$SIM_PAYER" == --* ]]; then
  echo "Usage: $0 <SIM_PAYER pubkey> [--rpc url] [--wallet kp] [--expect-mint mint]" >&2
  exit 1
fi
shift

RPC="https://api.mainnet-beta.solana.com"
WALLET="$HOME/.config/solana/id.json"
EXPECT_MINT=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --rpc)         RPC="$2"; shift 2 ;;
    --wallet)      WALLET="$2"; shift 2 ;;
    --expect-mint) EXPECT_MINT="$2"; shift 2 ;;
    *) red "unknown option: $1"; exit 1 ;;
  esac
done

cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

SIM_SCRIPT="scripts/devnet_simulate_wrap.ts"
if [[ ! -f "$SIM_SCRIPT" ]]; then
  red "sim script not found: $SIM_SCRIPT"
  exit 1
fi
if ! [[ "$SIM_PAYER" =~ ^[1-9A-HJ-NP-Za-km-z]{32,44}$ ]]; then
  red "SIM_PAYER '$SIM_PAYER' is not a base58 pubkey"
  exit 1
fi

echo "=== mainnet_sim_gate ==="
echo "rpc:        $RPC"
echo "sim payer:  $SIM_PAYER"
echo "sim script: $SIM_SCRIPT"
echo

# Run the simulation. devnet_simulate_wrap.ts reads ANCHOR_PROVIDER_URL
# + ANCHOR_WALLET via AnchorProvider.env(), and SIM_PAYER via env.
OUT="$(
  ANCHOR_PROVIDER_URL="$RPC" \
  ANCHOR_WALLET="$WALLET" \
  SIM_PAYER="$SIM_PAYER" \
  npx ts-node "$SIM_SCRIPT" 2>&1
)"
SIM_EXIT=$?

echo "--- sim output ---"
echo "$OUT"
echo "--- end sim output ---"
echo

if [[ $SIM_EXIT -ne 0 ]]; then
  red "GATE FAIL — sim script exited non-zero ($SIM_EXIT)."
  exit 1
fi

# Optional mint cross-check. The sim prints `token mint:  <mint>`.
if [[ -n "$EXPECT_MINT" ]]; then
  ACTUAL_MINT="$(printf '%s' "$OUT" | grep -E 'token mint:' | grep -oE '[1-9A-HJ-NP-Za-km-z]{32,44}' | head -1)"
  if [[ "$ACTUAL_MINT" != "$EXPECT_MINT" ]]; then
    red "GATE FAIL — bank token mint '$ACTUAL_MINT' != expected '$EXPECT_MINT'."
    exit 1
  fi
  green "mint cross-check OK ($ACTUAL_MINT)"
fi

# Criterion 1: the sim script's own verdict line.
if printf '%s' "$OUT" | grep -qE 'RESULT:[[:space:]]*CLEAN'; then
  green "criterion 1 OK — RESULT: CLEAN (simulationErr is null)"
else
  red "GATE FAIL — sim did not print 'RESULT: CLEAN'."
  exit 1
fi

# Criterion 2: a Wrapped-bull program log + a success line.
if printf '%s' "$OUT" | grep -qiE 'Program log:[[:space:]]*Wrapped .*tier='; then
  green "criterion 2a OK — found 'Wrapped ... tier=' program log"
else
  red "GATE FAIL — no 'Wrapped ... tier=' log line in the simulation."
  exit 1
fi
if printf '%s' "$OUT" | grep -qE 'Program .* success'; then
  green "criterion 2b OK — program reported success"
else
  red "GATE FAIL — no 'Program ... success' line in the simulation."
  exit 1
fi

echo
green "✅ mainnet_sim_gate PASSED — wrap simulates cleanly against mainnet."
green "   Safe to proceed to the go-live flip (RELAUNCH_PLAYBOOK Step 10)."
exit 0

#!/usr/bin/env bash
# preflight.sh — pre-deploy / pre-launch safety gate. READ-ONLY: runs
# no state-changing commands. Exits 0 only if every hard check passes.
#
# The check that matters most (and that the old launch_preflight.sh
# entirely lacked): MINT VALIDATION. Last launch failed because the
# program was built for classic SPL but $WBULL was Token-2022, and
# nobody verified the mint's program/decimals/extensions before going
# live. See docs/POSTMORTEM.md §1.
#
# Usage:
#   ./scripts/preflight.sh <MINT> [options]
#
# Options:
#   --deployer <keypair>     deployer keypair (default ~/.config/solana/id.json)
#   --program-keypair <path> program keypair (default: autodetect target/deploy/*-keypair.json)
#   --rpc <url>              RPC endpoint (default https://api.mainnet-beta.solana.com)
#   --min-sol <n>            minimum deployer balance, SOL (default 9)
#
# Exit: 0 = safe to proceed, 1 = at least one hard check failed.

set -uo pipefail

PASS=0; FAIL=0; WARN=0
ok()   { printf '  \033[32m✓\033[0m %s\n' "$1"; PASS=$((PASS+1)); }
bad()  { printf '  \033[31m✗\033[0m %s\n' "$1"; FAIL=$((FAIL+1)); }
warn() { printf '  \033[33m!\033[0m %s\n' "$1"; WARN=$((WARN+1)); }

# Known SPL token program IDs.
TOKEN_CLASSIC="TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
TOKEN_2022="TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"

# ---------- args -----------------------------------------------------

MINT="${1:-}"
if [[ -z "$MINT" || "$MINT" == --* ]]; then
  echo "Usage: $0 <MINT> [--deployer kp] [--program-keypair kp] [--rpc url] [--min-sol n]" >&2
  exit 1
fi
shift

DEPLOYER_KP="$HOME/.config/solana/id.json"
PROGRAM_KP=""
RPC="https://api.mainnet-beta.solana.com"
MIN_SOL=9

while [[ $# -gt 0 ]]; do
  case "$1" in
    --deployer)         DEPLOYER_KP="$2"; shift 2 ;;
    --program-keypair)  PROGRAM_KP="$2"; shift 2 ;;
    --rpc)              RPC="$2"; shift 2 ;;
    --min-sol)          MIN_SOL="$2"; shift 2 ;;
    *) echo "unknown option: $1" >&2; exit 1 ;;
  esac
done

cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "=== preflight ==="
echo "time:  $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "mint:  $MINT"
echo "rpc:   $RPC"
echo

# Tiny single-section TOML reader for config/launch.toml.
toml_get() {
  local section="$1" key="$2"
  awk -v s="[$section]" -v k="$key" '
    $0==s {inside=1; next}
    /^\[/ {inside=0}
    inside {
      line=$0
      sub(/[ \t]*#.*$/, "", line)
      n=split(line, kv, "=")
      if (n>=2) {
        gsub(/[ \t]/, "", kv[1])
        if (kv[1]==k) {
          v=line; sub(/^[^=]*=[ \t]*/, "", v)
          gsub(/"/, "", v); gsub(/[ \t]+$/, "", v)
          print v; exit
        }
      }
    }
  ' config/launch.toml 2>/dev/null
}

# ---------- 1. tools -------------------------------------------------

echo "[1] required tools"
for cmd in solana spl-token awk grep curl; do
  if command -v "$cmd" >/dev/null 2>&1; then ok "$cmd"; else bad "$cmd missing"; fi
done
echo

# ---------- 2. argument shape ---------------------------------------

echo "[2] mint address shape"
if [[ "$MINT" =~ ^[1-9A-HJ-NP-Za-km-z]{32,44}$ ]]; then
  ok "mint is valid base58 (${#MINT} chars)"
else
  bad "mint '$MINT' is not a base58 address"
fi
echo

# ---------- 3. cluster flag lint ------------------------------------

echo "[3] anchor cluster-flag lint"
if [[ -x scripts/cluster_flag_lint.sh ]]; then
  if scripts/cluster_flag_lint.sh >/dev/null 2>&1; then
    ok "cluster_flag_lint passed"
  else
    bad "cluster_flag_lint FAILED — run ./scripts/cluster_flag_lint.sh"
  fi
else
  warn "scripts/cluster_flag_lint.sh not found/executable"
fi
echo

# ---------- 4. MINT validation (the critical block) -----------------

echo "[4] MINT validation — token program / decimals / supply / extensions"

MINT_JSON="$(solana account "$MINT" --url "$RPC" --output json 2>/dev/null || true)"
if [[ -z "$MINT_JSON" ]]; then
  bad "could not fetch mint account from RPC — does the mint exist on this cluster?"
else
  OWNER="$(printf '%s' "$MINT_JSON" | grep -oE '"owner": *"[^"]+"' | head -1 | sed 's/.*"\([^"]*\)"$/\1/')"
  case "$OWNER" in
    "$TOKEN_CLASSIC")
      ok "mint is owned by the CLASSIC SPL Token program"
      warn "web/lib/program.ts BULLS_TOKEN_PROGRAM defaults to Token-2022 — if this mint is classic, change it to TOKEN_PROGRAM_ID"
      ;;
    "$TOKEN_2022")
      ok "mint is owned by the Token-2022 program (pump.fun standard)"
      ;;
    "")
      bad "could not determine mint program owner"
      ;;
    *)
      bad "mint owner is '$OWNER' — not a recognized SPL token program"
      ;;
  esac

  # spl-token display gives human-readable decimals/supply/extensions.
  DISPLAY="$(spl-token display "$MINT" --url "$RPC" 2>/dev/null || true)"
  if [[ -z "$DISPLAY" ]]; then
    bad "spl-token display returned nothing — cannot verify decimals/extensions"
  else
    # Decimals must match config/launch.toml [supply] token_decimals.
    CFG_DECIMALS="$(toml_get supply token_decimals)"
    MINT_DECIMALS="$(printf '%s' "$DISPLAY" | grep -iE '^[[:space:]]*Decimals' | grep -oE '[0-9]+' | head -1)"
    if [[ -z "$MINT_DECIMALS" ]]; then
      bad "could not read mint decimals from spl-token display"
    elif [[ -z "$CFG_DECIMALS" ]]; then
      warn "config/launch.toml has no [supply] token_decimals — mint reports $MINT_DECIMALS"
    elif [[ "$MINT_DECIMALS" == "$CFG_DECIMALS" ]]; then
      ok "decimals match: mint=$MINT_DECIMALS, config=$CFG_DECIMALS"
    else
      bad "DECIMALS MISMATCH: mint=$MINT_DECIMALS, config=$CFG_DECIMALS — base-unit math will be wrong"
    fi

    # Supply (informational — a 0 supply pre-launch is normal).
    SUPPLY="$(printf '%s' "$DISPLAY" | grep -iE '^[[:space:]]*Supply' | grep -oE '[0-9]+' | head -1)"
    [[ -n "$SUPPLY" ]] && ok "supply: $SUPPLY (informational)"

    # DANGEROUS extensions — any of these breaks or distorts wrap/unwrap.
    DANGER=0
    check_ext() {
      local label="$1" pat="$2"
      if printf '%s' "$DISPLAY" | grep -iqE "$pat"; then
        bad "DANGEROUS extension present: $label"
        DANGER=1
      fi
    }
    check_ext "Transfer fee config (skims every transfer)"      'transfer.fee'
    check_ext "Transfer hook (arbitrary CPI on every transfer)" 'transfer.hook'
    check_ext "Permanent delegate (third party can move funds)" 'permanent.delegate'
    check_ext "Non-transferable (tokens cannot move at all)"    'non.?transferable'
    check_ext "Interest-bearing (amount drifts over time)"      'interest.bearing'
    check_ext "Mint close authority (mint can be closed)"       'mint.close.authority'
    # Default-account-state == frozen would freeze every vault.
    if printf '%s' "$DISPLAY" | grep -iE 'default.account.state' | grep -iq 'frozen'; then
      bad "DANGEROUS: default account state is Frozen — vaults would be frozen on creation"
      DANGER=1
    fi
    if [[ $DANGER -eq 0 ]]; then
      ok "no dangerous Token-2022 extensions detected"
      # Benign extensions are fine — note them for awareness.
      printf '%s' "$DISPLAY" | grep -iqE 'metadata.pointer' && \
        ok "benign extension: metadata pointer (expected for pump.fun)"
    fi

    # Mint authority should be disabled (null) for a pump.fun token —
    # otherwise supply could be inflated under the locked vaults.
    if printf '%s' "$DISPLAY" | grep -iE 'mint.authority' | grep -iqE '\(not set\)|none|null'; then
      ok "mint authority is disabled (supply is fixed)"
    else
      warn "mint authority appears to still be set — confirm supply cannot be inflated"
    fi
  fi
fi
echo

# ---------- 5. deployer balance -------------------------------------

echo "[5] deployer keypair + balance"
if [[ ! -f "$DEPLOYER_KP" ]]; then
  bad "deployer keypair not found at $DEPLOYER_KP"
else
  DEPLOYER="$(solana address --keypair "$DEPLOYER_KP" 2>/dev/null || true)"
  ok "deployer: $DEPLOYER"
  BAL="$(solana balance --keypair "$DEPLOYER_KP" --url "$RPC" 2>/dev/null | awk '{print $1}')"
  if [[ -z "$BAL" ]]; then
    bad "could not read deployer balance"
  else
    BAL_INT="${BAL%.*}"
    if [[ "${BAL_INT:-0}" -ge "$MIN_SOL" ]]; then
      ok "balance $BAL SOL (>= $MIN_SOL required)"
    else
      bad "balance $BAL SOL is below the $MIN_SOL SOL minimum"
    fi
  fi
fi
echo

# ---------- 6. program keypair state --------------------------------

echo "[6] program keypair"
if [[ -z "$PROGRAM_KP" ]]; then
  PROGRAM_KP="$(ls target/deploy/*-keypair.json 2>/dev/null | head -1 || true)"
fi
if [[ -z "$PROGRAM_KP" || ! -f "$PROGRAM_KP" ]]; then
  warn "no program keypair found under target/deploy/ — generate one before deploy"
else
  PROGRAM_ID="$(solana address -k "$PROGRAM_KP" 2>/dev/null || true)"
  ok "program keypair: $PROGRAM_ID ($PROGRAM_KP)"

  # config/launch.toml [program] id must match.
  CFG_ID="$(toml_get program id)"
  if [[ -n "$CFG_ID" && "$CFG_ID" == "$PROGRAM_ID" ]]; then
    ok "config/launch.toml [program] id matches keypair"
  elif [[ -n "$CFG_ID" ]]; then
    bad "config/launch.toml id=$CFG_ID != keypair $PROGRAM_ID — rebuild after fixing"
  fi

  # On-chain state: must be either absent OR an upgradeable program.
  # A System account holding SOL at the program address blocks deploy
  # ("not an upgradeable program"). See docs/LESSONS_LEARNED.md L8.
  ACCT="$(solana account "$PROGRAM_ID" --url "$RPC" --output json 2>/dev/null || true)"
  if [[ -z "$ACCT" ]]; then
    ok "program address is unused on-chain (clean first deploy)"
  else
    AOWNER="$(printf '%s' "$ACCT" | grep -oE '"owner": *"[^"]+"' | head -1 | sed 's/.*"\([^"]*\)"$/\1/')"
    if [[ "$AOWNER" == "BPFLoaderUpgradeab1e11111111111111111111111" ]]; then
      ok "program already deployed (upgradeable) — deploy will be an upgrade"
    else
      bad "program address holds a non-program account (owner=$AOWNER) — deploy will fail. Drain it first."
    fi
  fi
fi
echo

# ---------- summary --------------------------------------------------

echo "=== preflight summary ==="
echo "  PASS: $PASS   WARN: $WARN   FAIL: $FAIL"
echo
if [[ $FAIL -eq 0 ]]; then
  printf '\033[32m✅ preflight passed — safe to proceed.\033[0m\n'
  [[ $WARN -gt 0 ]] && printf '\033[33m   (%d warning(s) above — review them.)\033[0m\n' "$WARN"
  exit 0
else
  printf '\033[31m❌ %d hard check(s) failed — DO NOT deploy until resolved.\033[0m\n' "$FAIL"
  exit 1
fi

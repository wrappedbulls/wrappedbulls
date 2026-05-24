#!/bin/bash
# ============================================================================
# ⚠️  DEPRECATED — informational only. Superseded 2026-05-15.
# Asserts the WRONG EXPECTED_DEPLOYER (FRZJ…TwQ; real deployer is the
# bulls-box keypair GMrJpP7Sa…). Pre-flight is now the manual checks in
# docs/LAUNCH_RUNBOOK.md / docs/LAUNCH_CHECKLIST.md. Read-only, so it does
# no harm, but its deployer expectation is stale — do not trust its verdict.
echo "DEPRECATED: see docs/LAUNCH_RUNBOOK.md; deployer is GMrJpP7Sa… not FRZJ…TwQ." >&2
# ============================================================================
# Mainnet launch pre-flight check — RUNS NO STATE-CHANGING COMMANDS.
#
# Validates that everything launch.sh needs is in place. Run this on the
# bulls box BEFORE running launch.sh. Exits 0 if launch is safe, 1 if
# anything is missing.
#
# Usage:
#   DEPLOYER_KEYPAIR=/tmp/mainnet-deployer.json \
#     /root/wrappedbulls-sol/scripts/launch_preflight.sh <WBULL_MINT_ADDRESS>
#
# All checks read-only. Safe to run any time.

set -uo pipefail
PASS=0
FAIL=0
WARN=0

ok()    { echo "  ✓ $1"; PASS=$((PASS+1)); }
fail()  { echo "  ✗ $1"; FAIL=$((FAIL+1)); }
warn()  { echo "  ! $1"; WARN=$((WARN+1)); }

if [ -z "${1:-}" ]; then
  echo "Usage: DEPLOYER_KEYPAIR=/path/to/keypair.json $0 <WBULL_MINT_ADDRESS>"
  echo ""
  echo "(WBULL_MINT can be any 32-44 base58 char string for preflight; we don't"
  echo " call any program with it, just validate the format.)"
  exit 1
fi
WBULL_MINT="$1"

KEYPAIR="${DEPLOYER_KEYPAIR:-$HOME/.config/solana/id.json}"
EXPECTED_DEPLOYER="${EXPECTED_DEPLOYER:-FRZJpAtPcWJBRFziY6dZkBHMBSWVi12hXAtAJEHawTwQ}"

. "$HOME/.cargo/env" 2>/dev/null || true
export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"

echo "=== Mainnet launch preflight ==="
echo "Time:      $(date -u +"%Y-%m-%dT%H:%M:%SZ")"
echo "Mint arg:  $WBULL_MINT"
echo "Keypair:   $KEYPAIR"
echo "Expected:  $EXPECTED_DEPLOYER"
echo ""

# ============================================================
# 1. Argument validation
# ============================================================
echo "[1] Argument validation"
if echo "$WBULL_MINT" | grep -qE "^[1-9A-HJ-NP-Za-km-z]{32,44}$"; then
  ok "WBULL_MINT is a valid base58 string ($(echo -n "$WBULL_MINT" | wc -c) chars)"
else
  fail "WBULL_MINT '$WBULL_MINT' is not a valid base58 mint address"
fi
echo ""

# ============================================================
# 2. Required tools
# ============================================================
echo "[2] Required tools on PATH"
for cmd in solana anchor node npx awk sed grep curl systemctl; do
  if command -v "$cmd" >/dev/null 2>&1; then
    ok "$cmd ($(command -v "$cmd"))"
  else
    fail "$cmd missing"
  fi
done
echo ""

# ============================================================
# 3. Repo layout
# ============================================================
echo "[3] Repo layout"
REPO=/root/wrappedbulls-sol
for f in \
  "$REPO/Anchor.toml" \
  "$REPO/target/deploy/wrappedbulls.so" \
  "$REPO/target/deploy/wrappedbulls-keypair.json" \
  "$REPO/target/idl/wrappedbulls.json" \
  "$REPO/scripts/launch.sh" \
  "$REPO/scripts/devnet_initialize.ts" \
  "$REPO/scripts/devnet_initialize_collection.ts" \
  "$REPO/scripts/audit_chain.sh" \
  "$REPO/web/lib/idl.json"
do
  if [ -f "$f" ]; then
    ok "$(basename "$f") present ($(stat -c%s "$f") bytes)"
  else
    fail "$f missing"
  fi
done
echo ""

# ============================================================
# 4. Anchor.toml mainnet alignment
# ============================================================
echo "[4] Anchor.toml + program keypair alignment"
PROGRAM_ID=$(solana address -k "$REPO/target/deploy/wrappedbulls-keypair.json" 2>/dev/null)
ANCHOR_MAINNET_ID=$(awk '/^\[programs.mainnet\]/{f=1; next} /^\[/{f=0} f && /^wrappedbulls/' "$REPO/Anchor.toml" 2>/dev/null | sed 's/.*"\(.*\)".*/\1/')
if [ -z "$PROGRAM_ID" ]; then
  fail "Could not derive program ID from keypair"
elif [ -z "$ANCHOR_MAINNET_ID" ]; then
  fail "Anchor.toml has no [programs.mainnet] wrappedbulls entry"
elif [ "$PROGRAM_ID" = "$ANCHOR_MAINNET_ID" ]; then
  ok "program keypair ID matches Anchor.toml mainnet ID ($PROGRAM_ID)"
else
  fail "MISMATCH: keypair=$PROGRAM_ID, Anchor.toml=$ANCHOR_MAINNET_ID. Run 'anchor keys sync' + rebuild."
fi
echo ""

# ============================================================
# 5. declare_id! in program source matches
# ============================================================
echo "[5] declare_id! in program source"
DECLARED=$(grep -E '^declare_id!' "$REPO/programs/wrappedbulls/src/lib.rs" 2>/dev/null | sed 's/.*"\(.*\)".*/\1/')
if [ -z "$DECLARED" ]; then
  fail "declare_id! not found in lib.rs"
elif [ "$DECLARED" = "$PROGRAM_ID" ]; then
  ok "declare_id! matches keypair ($DECLARED)"
else
  fail "STALE declare_id!: source=$DECLARED, keypair=$PROGRAM_ID. Run 'anchor keys sync' + rebuild."
fi
echo ""

# ============================================================
# 6. Build artifact freshness
# ============================================================
echo "[6] Build artifact freshness"
SO_AGE=$(( $(date +%s) - $(stat -c%Y "$REPO/target/deploy/wrappedbulls.so" 2>/dev/null || echo 0) ))
LIB_AGE=$(( $(date +%s) - $(stat -c%Y "$REPO/programs/wrappedbulls/src/lib.rs" 2>/dev/null || echo 0) ))
if [ "$SO_AGE" -le "$LIB_AGE" ] && [ "$LIB_AGE" -ne "$SO_AGE" ]; then
  warn "lib.rs is newer than target/deploy/wrappedbulls.so — rebuild before deploy"
else
  ok ".so is fresh (modified $((SO_AGE/60)) min ago)"
fi
echo ""

# ============================================================
# 7. Keypair + balance
# ============================================================
echo "[7] Deployer keypair + balance"
if [ ! -f "$KEYPAIR" ]; then
  fail "Keypair not found at $KEYPAIR"
else
  DEPLOYER=$(solana address --keypair "$KEYPAIR" 2>/dev/null)
  if [ "$DEPLOYER" = "$EXPECTED_DEPLOYER" ]; then
    ok "Keypair pubkey matches EXPECTED_DEPLOYER ($DEPLOYER)"
  else
    fail "Keypair pubkey mismatch: $DEPLOYER vs expected $EXPECTED_DEPLOYER"
  fi
  BALANCE=$(solana balance --keypair "$KEYPAIR" --url mainnet-beta 2>/dev/null | awk '{print $1}')
  if [ -z "$BALANCE" ]; then
    fail "Could not read mainnet balance"
  else
    BAL_INT=$(printf "%.0f" "$BALANCE")
    if [ "$BAL_INT" -ge 6 ]; then
      ok "Mainnet balance $BALANCE SOL (>= 6 SOL recommended)"
    elif [ "$BAL_INT" -ge 5 ]; then
      warn "Mainnet balance $BALANCE SOL is just above the 5 SOL minimum — consider topping up"
    else
      fail "Mainnet balance $BALANCE SOL is below the 5 SOL deploy minimum"
    fi
  fi
fi
echo ""

# ============================================================
# 8. Mainnet RPC reachability
# ============================================================
echo "[8] Mainnet RPC reachability"
MAINNET_SLOT=$(curl -s --max-time 8 https://api.mainnet-beta.solana.com -X POST \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"getSlot"}' 2>/dev/null | grep -oE '"result":[0-9]+' | grep -oE '[0-9]+')
if [ -n "$MAINNET_SLOT" ]; then
  ok "mainnet-beta slot: $MAINNET_SLOT"
else
  fail "Could not reach mainnet-beta RPC"
fi
echo ""

# ============================================================
# 9. Web service unit
# ============================================================
echo "[9] Web service systemd unit"
UNIT=/etc/systemd/system/wrappedbulls-web.service
if [ ! -f "$UNIT" ]; then
  fail "$UNIT missing"
elif systemctl is-active wrappedbulls-web >/dev/null 2>&1; then
  ok "wrappedbulls-web is active"
else
  fail "wrappedbulls-web is not active"
fi
if grep -q "NEXT_PUBLIC_SOLANA_CLUSTER=devnet" "$UNIT" 2>/dev/null; then
  ok "Currently on devnet (Step 3 will swap to mainnet)"
elif grep -q "NEXT_PUBLIC_SOLANA_CLUSTER=mainnet" "$UNIT" 2>/dev/null; then
  warn "Already on mainnet — Step 3 will be a no-op"
else
  fail "NEXT_PUBLIC_SOLANA_CLUSTER not set in $UNIT"
fi
echo ""

# ============================================================
# 10. node_modules for ts-node + anchor scripts
# ============================================================
echo "[10] Node deps for launch scripts"
for d in "$REPO/node_modules/ts-node" "$REPO/node_modules/@coral-xyz/anchor" "$REPO/node_modules/@solana/web3.js"; do
  if [ -d "$d" ]; then
    ok "$(basename $(dirname $d))/$(basename $d) installed"
  else
    fail "$d missing — run 'npm install' in $REPO"
  fi
done
echo ""

# ============================================================
# 11. Web client MCC readiness
# ============================================================
# We accept either:
#   (a) Live web/lib is already MCC-aware  ✓
#   (b) Live web/lib is pre-MCC BUT web/lib/*.mcc alternates exist  ✓
#       (web_apply_mcc.sh will swap them at launch)
# We fail only if neither is true.
echo "[11] Web client MCC readiness"
LIVE_IDL_MCC=0
LIVE_PROGRAM_MCC=0
ALT_IDL_OK=0
ALT_PROGRAM_OK=0
ALT_CHAIN_OK=0
ALT_SCRIPT_OK=0

if grep -q "collection_mint\|collectionMint" "$REPO/web/lib/idl.json" 2>/dev/null; then
  LIVE_IDL_MCC=1
fi
if grep -q "collectionAuthorityPda" "$REPO/web/lib/program.ts" 2>/dev/null; then
  LIVE_PROGRAM_MCC=1
fi
[ -f "$REPO/target/idl/wrappedbulls.json" ] && \
  grep -q "initialize_collection" "$REPO/target/idl/wrappedbulls.json" && \
  ALT_IDL_OK=1
[ -f "$REPO/web/lib/program.ts.mcc" ] && \
  grep -q "collectionAuthorityPda" "$REPO/web/lib/program.ts.mcc" && \
  ALT_PROGRAM_OK=1
[ -f "$REPO/web/lib/chain.ts.mcc" ] && \
  grep -q "collectionMint" "$REPO/web/lib/chain.ts.mcc" && \
  ALT_CHAIN_OK=1
[ -x "$REPO/scripts/web_apply_mcc.sh" ] && ALT_SCRIPT_OK=1

if [ $LIVE_IDL_MCC -eq 1 ] && [ $LIVE_PROGRAM_MCC -eq 1 ]; then
  ok "Live web/lib already MCC-aware (no swap needed)"
elif [ $ALT_IDL_OK -eq 1 ] && [ $ALT_PROGRAM_OK -eq 1 ] && [ $ALT_CHAIN_OK -eq 1 ] && [ $ALT_SCRIPT_OK -eq 1 ]; then
  ok "Live web/lib is pre-MCC but .mcc alternates + web_apply_mcc.sh are ready (will swap at launch)"
else
  [ $LIVE_IDL_MCC -eq 0 ] && [ $ALT_IDL_OK -eq 0 ] && fail "target/idl/wrappedbulls.json missing initialize_collection — run 'anchor build'"
  [ $ALT_PROGRAM_OK -eq 0 ] && fail "web/lib/program.ts.mcc missing or doesn't contain collectionAuthorityPda"
  [ $ALT_CHAIN_OK -eq 0 ] && fail "web/lib/chain.ts.mcc missing or doesn't contain collectionMint field"
  [ $ALT_SCRIPT_OK -eq 0 ] && fail "scripts/web_apply_mcc.sh missing or not executable"
fi
echo ""

# ============================================================
# 12. DNS + TLS (just confirm wrappedbulls.com resolves to bulls box)
# ============================================================
echo "[12] DNS + TLS"
A_RECORD=$(dig +short wrappedbulls.com @8.8.8.8 2>/dev/null | head -1)
EXPECTED_IP=165.22.167.96
if [ "$A_RECORD" = "$EXPECTED_IP" ]; then
  ok "wrappedbulls.com A record = $A_RECORD"
else
  fail "wrappedbulls.com A record = '$A_RECORD' (expected $EXPECTED_IP)"
fi
TLS_NOT_AFTER=$(echo | openssl s_client -connect wrappedbulls.com:443 -servername wrappedbulls.com 2>/dev/null | openssl x509 -noout -enddate 2>/dev/null | sed 's/notAfter=//')
if [ -n "$TLS_NOT_AFTER" ]; then
  ok "TLS cert valid until $TLS_NOT_AFTER"
else
  warn "Could not read TLS cert (Caddy may be reissuing)"
fi
echo ""

# ============================================================
# Summary
# ============================================================
echo "=== Preflight summary ==="
echo "  PASS: $PASS"
echo "  WARN: $WARN"
echo "  FAIL: $FAIL"
echo ""
if [ "$FAIL" -eq 0 ]; then
  echo "✅ Preflight passed. Launch is safe to proceed."
  echo ""
  echo "Next:"
  echo "  DEPLOYER_KEYPAIR=$KEYPAIR /root/wrappedbulls-sol/scripts/launch.sh $WBULL_MINT"
  exit 0
else
  echo "❌ $FAIL critical check(s) failed. DO NOT run launch.sh until resolved."
  exit 1
fi

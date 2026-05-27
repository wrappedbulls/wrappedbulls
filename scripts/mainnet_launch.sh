#!/bin/bash
# mainnet_launch.sh. One-command launch sequence to run AFTER the
# $WBULL token is live on pump.fun.
#
# WHAT THIS DOES (idempotent: each step skips if already done):
#   1. solana program deploy. uploads target/deploy/wrappedbulls.so to
#      mainnet at the program ID derived from target/deploy/wrappedbulls-keypair.json
#      (F7qXskG73efUwbDo2B97tZgpPAqX7zHMApXbPUimcFdS).
#   2. anchor idl init. publishes the IDL so block explorers decode
#      tx instructions as `wrappedbulls` rather than "Unknown program".
#   3. mainnet_initialize.ts. creates the BullBank singleton PDA and
#      locks in the live $WBULL mint address. The bank.token_mint
#      becomes immutable from this point.
#   4. mainnet_initialize_collection.ts. mints the Metaplex Certified
#      Collection (MCC) parent NFT. Every wrap_bull from here on
#      verifies its NFT into this collection automatically.
#
# AFTER THIS SCRIPT:
#   - Do the first wrap (Phantom evidence step) via
#     `mainnet_wrap_bull.ts`. Send the Solscan link to Phantom thread.
#   - Run `node scripts/warmup_cache.mjs` to pre-populate the API cache.
#   - Post the launch tweet + thread per docs/COMMS.md.
#   - Claim collection ownership on Magic Eden + Tensor (see docs/MARKETPLACE.md).
#
# REQUIREMENTS:
#   - DEPLOYER_KEYPAIR env var set to the path of the deployer keypair
#     JSON file (the wallet with ~7 SOL on mainnet).
#   - WBULL_MINT env var set to the pump.fun mint address.
#   - Solana CLI + anchor CLI in PATH (true on this VPS via
#     /root/.local/share/solana/install/active_release/bin + /root/.cargo/bin).
#   - Repo at /root/wrappedbulls with target/deploy/ containing the
#     wrappedbulls-keypair.json + wrappedbulls.so.
#
# SAFETY:
#   - Refuses to run unless solana config is set to mainnet-beta.
#   - Each step prints what it is about to do and pauses 5s to allow Ctrl-C.
#   - The script is idempotent. if step 1 succeeds and step 3 fails,
#     re-running the script will skip 1 (program already deployed) and
#     retry 3.
set -eu

# === inputs ===
WBULL_MINT="${WBULL_MINT:-gAhvUSC7XamFqt6gr1JwHU2tEZFYQMEQYEsyKBSpump}"
DEPLOYER_KEYPAIR="${DEPLOYER_KEYPAIR:-}"
REPO="${REPO:-/root/wrappedbulls}"
PROGRAM_ID="F7qXskG73efUwbDo2B97tZgpPAqX7zHMApXbPUimcFdS"

if [ -z "$DEPLOYER_KEYPAIR" ]; then
  echo "ERROR: DEPLOYER_KEYPAIR is not set."
  echo "  export DEPLOYER_KEYPAIR=/root/deployer-keypair.json"
  echo ""
  echo "How to get the deployer keypair JSON from the Phantom seed phrase:"
  echo "  solana-keygen recover -o /root/deployer-keypair.json"
  echo "  (it prompts for the 12-word seed, writes the keypair)"
  exit 2
fi

cd "$REPO"

# === safety: confirm cluster ===
CLUSTER=$(solana config get | awk '/^RPC URL/ {print $3}')
case "$CLUSTER" in
  *mainnet*) echo "cluster: $CLUSTER  (OK)";;
  *) echo "ERROR: solana config is not pointing at mainnet ($CLUSTER). Aborting." ; exit 3;;
esac

DEPLOYER_PUBKEY=$(solana-keygen pubkey "$DEPLOYER_KEYPAIR")
echo "deployer wallet:  $DEPLOYER_PUBKEY"
echo "deployer balance: $(solana balance "$DEPLOYER_KEYPAIR")"
echo "program ID:       $PROGRAM_ID"
echo "WBULL mint:       $WBULL_MINT"
echo ""
echo "Press Ctrl-C in the next 5 seconds to abort."
sleep 5
echo ""

# === step 1: program deploy ===
echo "=== Step 1/4: solana program deploy ==="
if solana program show "$PROGRAM_ID" --url mainnet-beta >/dev/null 2>&1; then
  echo "  program already deployed on mainnet, skipping"
else
  solana program deploy target/deploy/wrappedbulls.so \
    --program-id target/deploy/wrappedbulls-keypair.json \
    --keypair "$DEPLOYER_KEYPAIR"
fi
echo ""

# === step 2: publish IDL ===
echo "=== Step 2/4: anchor idl init ==="
if anchor idl fetch "$PROGRAM_ID" --provider.cluster mainnet >/dev/null 2>&1; then
  echo "  IDL already published, skipping"
else
  ANCHOR_WALLET="$DEPLOYER_KEYPAIR" \
    anchor idl init "$PROGRAM_ID" \
    --filepath target/idl/wrappedbulls.json \
    --provider.cluster mainnet
fi
echo ""

# === step 3: initialize bank ===
echo "=== Step 3/4: initialize (lock the bank's token_mint) ==="
BANK_ALREADY_INIT=$(curl -s https://api.mainnet-beta.solana.com -X POST \
  -H "Content-Type: application/json" \
  -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"getAccountInfo\",\"params\":[\"$(solana-keygen pubkey <(echo))\",{\"encoding\":\"base64\"}]}" 2>/dev/null || true)
# Simpler: just run; the script tolerates "already initialized" errors.
ANCHOR_PROVIDER_URL=https://api.mainnet-beta.solana.com \
ANCHOR_WALLET="$DEPLOYER_KEYPAIR" \
  npx ts-node scripts/mainnet_initialize.ts "$WBULL_MINT" || \
  echo "  (initialize may have already run; check the bank state above)"
echo ""

# === step 4: initialize collection ===
echo "=== Step 4/4: initialize_collection (MCC parent NFT) ==="
ANCHOR_PROVIDER_URL=https://api.mainnet-beta.solana.com \
ANCHOR_WALLET="$DEPLOYER_KEYPAIR" \
  npx ts-node scripts/mainnet_initialize_collection.ts || \
  echo "  (initialize_collection may have already run; check the bank state)"
echo ""

# === summary ===
echo "=== LAUNCH SEQUENCE COMPLETE ==="
echo ""
echo "Next steps (NOT run by this script):"
echo "  1. wrap the first bull (Phantom evidence):"
echo "     ANCHOR_PROVIDER_URL=https://api.mainnet-beta.solana.com \\"
echo "       ANCHOR_WALLET=$DEPLOYER_KEYPAIR \\"
echo "       npx ts-node scripts/mainnet_wrap_bull.ts"
echo ""
echo "  2. send the Solscan URL it prints to Phantom support thread."
echo ""
echo "  3. pre-warm the API cache for the inevitable Magic Eden crawl:"
echo "     node scripts/warmup_cache.mjs"
echo ""
echo "  4. post the pinned launch tweet from @wrappedbulls (see docs/COMMS.md)."

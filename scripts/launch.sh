#!/bin/bash
# ============================================================================
# ⚠️  DEPRECATED — DO NOT RUN. Superseded 2026-05-15.
# Encodes the WRONG deployer (EXPECTED_DEPLOYER=FRZJ…TwQ; the real deployer
# is GMrJpP7Sa…, the bulls-box keypair) and the disproved Phantom-whitelist
# root-cause model. Launch is now the MANUAL sequence in
# docs/LAUNCH_RUNBOOK.md + docs/LAUNCH_CHECKLIST.md. Fails closed below.
# Intentional override (not advised): set I_KNOW_THIS_IS_DEPRECATED=1.
if [ "${I_KNOW_THIS_IS_DEPRECATED:-0}" != "1" ]; then
  echo "DEPRECATED: use docs/LAUNCH_RUNBOOK.md (manual sequence). Aborting." >&2
  exit 1
fi
# ============================================================================
# Mainnet launch sequence for WrappedBulls.
#
# Usage:
#   1. Launch $WBULL on pump.fun manually, get the mint address.
#   2. ssh root@<bulls-box>
#   3. SCP your mainnet deployer keypair onto the box temporarily
#      (e.g. /tmp/mainnet-deployer.json), or use any local path.
#   4. DEPLOYER_KEYPAIR=/tmp/mainnet-deployer.json \
#        /root/wrappedbulls-sol/scripts/launch.sh <WBULL_MINT_ADDRESS>
#   5. After successful launch, shred the keypair file:
#      shred -u /tmp/mainnet-deployer.json
#
# This script:
#   - Verifies prerequisites (deployer pubkey, balance, build artifact, anchor.toml)
#   - Deploys the program to mainnet-beta
#   - Calls initialize with the provided mint
#   - Updates web service env to mainnet
#   - Smoke-tests the live site
#
# Idempotent guards:
#   - Refuses to proceed if deployer pubkey doesn't match expected
#   - Refuses to deploy if the program is already deployed at this ID
#   - Refuses to initialize if the BullBank PDA already exists
#   - Logs every step to /root/launch-mainnet.log
#
# Env vars (override defaults):
#   DEPLOYER_KEYPAIR  - path to the mainnet deployer JSON keypair
#                       (default: /root/.config/solana/id.json — the devnet wallet,
#                        which will FAIL the pubkey-match guard on mainnet)
#   EXPECTED_DEPLOYER - the deployer pubkey we expect (default below)

set -euo pipefail
exec > >(tee -a /root/launch-mainnet.log) 2>&1
echo "=== $(date -u +"%Y-%m-%dT%H:%M:%SZ") LAUNCH START ==="

if [ -z "${1:-}" ]; then
  echo "ERROR: Pass the \$WBULL mint address as the first argument."
  echo "Usage: DEPLOYER_KEYPAIR=/path/to/keypair.json $0 <WBULL_MINT_ADDRESS>"
  exit 1
fi
WBULL_MINT="$1"

# Sanity check: 32-44 char base58
if ! echo "$WBULL_MINT" | grep -qE "^[1-9A-HJ-NP-Za-km-z]{32,44}$"; then
  echo "ERROR: '$WBULL_MINT' doesn't look like a valid mint address."
  exit 1
fi

# Mainnet deployer keypair (must hold ~5.5 SOL on mainnet)
KEYPAIR="${DEPLOYER_KEYPAIR:-$HOME/.config/solana/id.json}"
EXPECTED_DEPLOYER="${EXPECTED_DEPLOYER:-FRZJpAtPcWJBRFziY6dZkBHMBSWVi12hXAtAJEHawTwQ}"

if [ ! -f "$KEYPAIR" ]; then
  echo "ERROR: keypair not found at $KEYPAIR"
  echo "Set DEPLOYER_KEYPAIR=/path/to/your/mainnet-deployer.json and re-run."
  exit 1
fi

. "$HOME/.cargo/env"
export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"

cd /root/wrappedbulls-sol

# ============================================================
# Step 0 — Pre-flight
# ============================================================
echo ""
echo "=== Step 0: pre-flight checks ==="

solana config set --url mainnet-beta --keypair "$KEYPAIR" > /dev/null
DEPLOYER=$(solana address --keypair "$KEYPAIR")
echo "deployer pubkey: $DEPLOYER"
echo "expected:        $EXPECTED_DEPLOYER"

if [ "$DEPLOYER" != "$EXPECTED_DEPLOYER" ]; then
  echo "ERROR: keypair pubkey ($DEPLOYER) does not match EXPECTED_DEPLOYER ($EXPECTED_DEPLOYER)."
  echo "If you intentionally changed deployers, set EXPECTED_DEPLOYER=$DEPLOYER and re-run."
  exit 1
fi

BALANCE=$(solana balance --keypair "$KEYPAIR" | awk '{print $1}')
echo "balance:         $BALANCE SOL"
echo "WBULL mint:      $WBULL_MINT"

# Need >= 5 SOL for deploy
BALANCE_INT=$(printf "%.0f" "$BALANCE")
if [ "$BALANCE_INT" -lt 5 ]; then
  echo "ERROR: deployer needs >= 5 SOL on mainnet. Currently: $BALANCE"
  exit 1
fi

# Build artifact must exist
if [ ! -f target/deploy/wrappedbulls.so ]; then
  echo "ERROR: target/deploy/wrappedbulls.so missing. Run 'anchor build' first."
  exit 1
fi
echo "build artifact:  $(ls -la target/deploy/wrappedbulls.so | awk '{print $5}') bytes"

# Anchor.toml must have a mainnet entry
if ! grep -q "^\[programs.mainnet\]" Anchor.toml; then
  echo "ERROR: Anchor.toml missing [programs.mainnet] section."
  exit 1
fi
PROGRAM_ID=$(solana address -k target/deploy/wrappedbulls-keypair.json)
ANCHOR_MAINNET_ID=$(awk '/^\[programs.mainnet\]/{f=1; next} /^\[/{f=0} f && /^wrappedbulls/' Anchor.toml | sed 's/.*"\(.*\)".*/\1/')
if [ "$PROGRAM_ID" != "$ANCHOR_MAINNET_ID" ]; then
  echo "ERROR: program keypair ID ($PROGRAM_ID) != Anchor.toml mainnet ID ($ANCHOR_MAINNET_ID)"
  echo "Run 'anchor keys sync' and rebuild before running this script."
  exit 1
fi
echo "program ID:      $PROGRAM_ID (matches Anchor.toml)"

# ============================================================
# Step 0.5 — Apply MCC web client + rebuild + redeploy web
# ============================================================
# Without this, the live website (which currently bundles the pre-MCC
# IDL) will reject every wrap/unwrap once mainnet runs the MCC program.
# Idempotent: web_apply_mcc.sh is safe to re-run.
#
# Done BEFORE any chain ops so a rebuild failure leaves the chain
# state untouched.
echo ""
echo "=== Step 0.5: apply MCC web client + rebuild + redeploy ==="

if grep -q "collectionAuthorityPda" web/lib/program.ts; then
  echo "Web client is already MCC-aware. Skipping swap."
else
  if [ ! -x scripts/web_apply_mcc.sh ]; then
    echo "ERROR: scripts/web_apply_mcc.sh missing or not executable."
    exit 1
  fi
  ./scripts/web_apply_mcc.sh
fi

# ============================================================
# Step 1 — Deploy program (skip if already deployed at this ID)
# ============================================================
echo ""
echo "=== Step 1: deploy program ==="

if solana program show "$PROGRAM_ID" --url mainnet-beta 2>/dev/null | grep -q "Authority"; then
  echo "Program $PROGRAM_ID is already deployed on mainnet. Skipping deploy."
else
  echo "Deploying (this takes ~60s and burns ~5 SOL)..."
  # Anchor CLI cluster name is "mainnet" (NOT "mainnet-beta" — that is
  # the Solana CLI value). See docs/LESSONS_LEARNED.md L5.
  anchor deploy --provider.cluster mainnet --provider.wallet "$KEYPAIR"
  echo "Deploy success."
fi

solana program show "$PROGRAM_ID" --url mainnet-beta | head -8

# ============================================================
# Step 2 — Initialize (skip if bank PDA already exists)
# ============================================================
echo ""
echo "=== Step 2: initialize bank with $WBULL mint ==="

# Compute Bank PDA off-chain to check existence
BANK_PDA=$(node -e "
const w3 = require(require.resolve('@solana/web3.js', { paths: ['/root/wrappedbulls-sol'] }));
const { PublicKey } = w3;
const PROG = new PublicKey('$PROGRAM_ID');
const [pda] = PublicKey.findProgramAddressSync([Buffer.from('bank')], PROG);
console.log(pda.toBase58());
")
echo "bank PDA:        $BANK_PDA"

if solana account "$BANK_PDA" --url mainnet-beta 2>/dev/null | grep -q "Balance"; then
  echo "BullBank already initialized. Skipping initialize."
else
  ANCHOR_PROVIDER_URL=https://api.mainnet-beta.solana.com \
  ANCHOR_WALLET="$KEYPAIR" \
    npx ts-node scripts/devnet_initialize.ts "$WBULL_MINT"
fi

# ============================================================
# Step 2.5 — Initialize Metaplex Certified Collection
# ============================================================
# Without this, every bull NFT shows DYOR / "unverified collection"
# warnings on Magic Eden + is non-discoverable on Tensor.
#
# The script is idempotent: if bank.collection_mint is already set,
# it logs and exits 0. Safe to re-run.
echo ""
echo "=== Step 2.5: initialize Metaplex Certified Collection ==="

ANCHOR_PROVIDER_URL=https://api.mainnet-beta.solana.com \
ANCHOR_WALLET="$KEYPAIR" \
  npx ts-node scripts/devnet_initialize_collection.ts

# ============================================================
# Step 3 — Update web service env to mainnet + restart
# ============================================================
echo ""
echo "=== Step 3: switch web service to mainnet ==="

UNIT=/etc/systemd/system/wrappedbulls-web.service
if grep -q "NEXT_PUBLIC_SOLANA_CLUSTER=devnet" "$UNIT"; then
  # Swap devnet → mainnet in URLs while preserving any API keys (Helius etc.)
  CURRENT_PUB=$(grep "^Environment=NEXT_PUBLIC_SOLANA_RPC_URL=" "$UNIT" | sed 's/^Environment=NEXT_PUBLIC_SOLANA_RPC_URL=//')
  CURRENT_SRV=$(grep "^Environment=SOLANA_RPC_URL=" "$UNIT" | sed 's/^Environment=SOLANA_RPC_URL=//')
  NEW_PUB=$(echo "$CURRENT_PUB" | sed -e 's|devnet\.helius-rpc|mainnet.helius-rpc|' -e 's|api\.devnet\.solana\.com|api.mainnet-beta.solana.com|')
  NEW_SRV=$(echo "$CURRENT_SRV" | sed -e 's|devnet\.helius-rpc|mainnet.helius-rpc|' -e 's|api\.devnet\.solana\.com|api.mainnet-beta.solana.com|')

  sed -i "s|^Environment=NEXT_PUBLIC_PROGRAM_ID=.*|Environment=NEXT_PUBLIC_PROGRAM_ID=$PROGRAM_ID|" "$UNIT"
  sed -i "s|^Environment=NEXT_PUBLIC_SOLANA_CLUSTER=.*|Environment=NEXT_PUBLIC_SOLANA_CLUSTER=mainnet-beta|" "$UNIT"
  sed -i "s|^Environment=NEXT_PUBLIC_SOLANA_RPC_URL=.*|Environment=NEXT_PUBLIC_SOLANA_RPC_URL=$NEW_PUB|" "$UNIT"
  sed -i "s|^Environment=SOLANA_RPC_URL=.*|Environment=SOLANA_RPC_URL=$NEW_SRV|" "$UNIT"
  # Flip launch state to "live" + set the $WBULL mint so the public site
  # shows live stats + the contract address pill.
  sed -i "s|^Environment=NEXT_PUBLIC_LAUNCH_STATE=.*|Environment=NEXT_PUBLIC_LAUNCH_STATE=live|" "$UNIT"
  sed -i "s|^Environment=NEXT_PUBLIC_TOKEN_MINT=.*|Environment=NEXT_PUBLIC_TOKEN_MINT=$WBULL_MINT|" "$UNIT"
  # Same envs need to be baked into the Next.js bundle at build time (Next
  # inlines NEXT_PUBLIC_* at build, not request time). Rebuild + sync.
  echo "Rebuilding web with launch envs..."
  cd /root/wrappedbulls-sol/web
  NEXT_PUBLIC_PROGRAM_ID="$PROGRAM_ID" \
  NEXT_PUBLIC_SOLANA_CLUSTER=mainnet-beta \
  NEXT_PUBLIC_SOLANA_RPC_URL="$NEW_PUB" \
  NEXT_PUBLIC_LAUNCH_STATE=live \
  NEXT_PUBLIC_TOKEN_MINT="$WBULL_MINT" \
    npm run build
  rm -rf /opt/wrappedbulls-web/.next/static /opt/wrappedbulls-web/public
  mkdir -p /opt/wrappedbulls-web/.next/static /opt/wrappedbulls-web/public
  cp -r .next/standalone/. /opt/wrappedbulls-web/
  cp -r .next/static/. /opt/wrappedbulls-web/.next/static/
  cp -r public/. /opt/wrappedbulls-web/public/
  cd /root/wrappedbulls-sol
  systemctl daemon-reload
  systemctl restart wrappedbulls-web
  sleep 4
fi
systemctl is-active wrappedbulls-web
curl -s --max-time 10 -o /dev/null -w "  / -> %{http_code}\n" --resolve wrappedbulls.com:443:127.0.0.1 https://wrappedbulls.com/ || true
curl -s --max-time 10 -o /dev/null -w "  /api/health -> %{http_code}\n" --resolve wrappedbulls.com:443:127.0.0.1 https://wrappedbulls.com/api/health || true

# ============================================================
# Done
# ============================================================
echo ""
echo "=== $(date -u +"%Y-%m-%dT%H:%M:%SZ") LAUNCH COMPLETE ==="
echo ""
echo "PROGRAM_ID  = $PROGRAM_ID"
echo "WBULL_MINT  = $WBULL_MINT"
echo "BANK_PDA    = $BANK_PDA"
echo "DEPLOYER    = $DEPLOYER"
echo ""
echo "Verify on Solana Explorer:"
echo "  https://explorer.solana.com/address/$PROGRAM_ID"
echo "  https://explorer.solana.com/address/$WBULL_MINT"
echo "  https://explorer.solana.com/address/$BANK_PDA"
echo ""
echo "Next: tweet the launch + monitor the first wraps."

#!/bin/bash
# Wrappedbulls devnet deploy + initialize + wrap-a-bull E2E
# Runs on the bulls box after the toolchain install completes.
set -e
exec > >(tee -a /root/deploy.log) 2>&1
echo "=== $(date) === devnet deploy start"

. "$HOME/.cargo/env"
export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"

cd /root
rm -rf wrappedbulls-sol
tar -xzf wrappedbulls-sol.tar.gz
cd wrappedbulls-sol

# 1. Configure solana CLI for devnet
echo "--- configuring solana for devnet ---"
solana config set --url devnet
solana config get

# 2. Fund deployer wallet (needs ~5 SOL for program deploy)
echo "--- requesting devnet SOL airdrops ---"
DEPLOYER=$(solana address)
echo "deployer: $DEPLOYER"
solana balance
for i in 1 2 3; do
  solana airdrop 2 || echo "airdrop $i hit rate limit (continuing)"
  sleep 2
done
solana balance

# 3. anchor keys sync — make sure declare_id! matches the keypair Anchor will generate
echo "--- anchor build (initial, generates keypair) ---"
anchor build || true
echo "--- anchor keys sync ---"
anchor keys sync || true
echo "--- anchor build (final, with synced ID) ---"
anchor build

# 4. npm install for client deps
echo "--- npm install ---"
npm install

# 5. Deploy
echo "--- anchor deploy --provider.cluster devnet ---"
anchor deploy --provider.cluster devnet

PROGRAM_ID=$(solana address -k target/deploy/wrappedbulls-keypair.json)
echo "deployed program id: $PROGRAM_ID"
echo "explorer: https://explorer.solana.com/address/$PROGRAM_ID?cluster=devnet"

# 6. Mint a mock $WBULL test token
echo "--- creating mock \$WBULL test token (6 decimals) ---"
TOKEN_OUTPUT=$(spl-token create-token --decimals 6 2>&1)
echo "$TOKEN_OUTPUT"
TOKEN_MINT=$(echo "$TOKEN_OUTPUT" | grep -E "Creating token|Address:" | head -1 | awk '{print $NF}')
echo "mock \$WBULL mint: $TOKEN_MINT"
spl-token create-account "$TOKEN_MINT"
spl-token mint "$TOKEN_MINT" 1000000000  # 1B tokens
spl-token balance "$TOKEN_MINT"

echo
echo "=== $(date) === devnet deploy DONE ==="
echo "PROGRAM_ID=$PROGRAM_ID"
echo "TOKEN_MINT=$TOKEN_MINT"
echo "DEPLOYER=$DEPLOYER"
echo "$PROGRAM_ID" > /root/program_id.txt
echo "$TOKEN_MINT" > /root/token_mint.txt

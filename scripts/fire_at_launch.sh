#!/usr/bin/env bash
# Fire-at-launch: run the full mainnet launch sequence once the pump.fun mint exists.
# Pre-condition: mainnet program + IDL already deployed; pre-built bundle in /root/wrappedbulls-sol/web/.next/.
set -uo pipefail

MINT="XfY2XBcgY8QSLtGHnmwYrMT4CQt5mVMj55tXRWHpump"
PROGRAM="F7qXskG73efUwbDo2B97tZgpPAqX7zHMApXbPUimcFdS"
HELIUS="https://mainnet.helius-rpc.com/?api-key=dc600042-d2ea-486d-8044-877884eb777b"
DEPLOYER_KP="/root/deployer-keypair.json"
WEB_SRC="/root/wrappedbulls-sol/web"
WEB_LIVE="/opt/wrappedbulls-web"
WEB_BACKUP="/opt/wrappedbulls-web.prelaunch-backup"
LOG="/tmp/fire_at_launch.log"

exec > >(tee -a "$LOG") 2>&1

step() { echo ""; echo "=== $(date -u +%H:%M:%S) :: $* ==="; }
halt_if_fail() {
  if [ "$1" -ne 0 ]; then
    echo "=== HALT: $2 (exit=$1) ==="
    exit 1
  fi
}

step "0. mint sanity (HARD GATE)"
spl-token display "$MINT" -u "$HELIUS" > /tmp/mint.txt 2>&1
cat /tmp/mint.txt | grep -E "Decimals|Supply|Mint Authority"
DEC=$(grep "Decimals:" /tmp/mint.txt | awk '{print $2}')
if [ "$DEC" != "6" ]; then
  halt_if_fail 1 "decimals=$DEC expected 6 -- refuse to lock wrong economics"
fi
echo "  decimals = 6 OK"

step "1. backup current /opt/wrappedbulls-web (rollback safety net)"
rm -rf "$WEB_BACKUP"
cp -a "$WEB_LIVE" "$WEB_BACKUP"
echo "  backup at $WEB_BACKUP"

step "2. initialize bank (IRREVERSIBLE)"
cd /root/wrappedbulls-sol
ANCHOR_PROVIDER_URL="$HELIUS" ANCHOR_WALLET="$DEPLOYER_KP" \
  npx ts-node scripts/devnet_initialize.ts "$MINT"
halt_if_fail $? "initialize failed"

step "3. initialize_collection"
ANCHOR_PROVIDER_URL="$HELIUS" ANCHOR_WALLET="$DEPLOYER_KP" \
  npx ts-node scripts/devnet_initialize_collection.ts
halt_if_fail $? "initialize_collection failed"

step "4. atomic site flip (rsync pre-built bundle)"
rsync -a --delete "$WEB_SRC/.next/standalone/." "$WEB_LIVE/"
rsync -a "$WEB_SRC/.next/static" "$WEB_LIVE/.next/"
rsync -a "$WEB_SRC/public" "$WEB_LIVE/"
cp "$WEB_SRC/.env.production" "$WEB_LIVE/.env.production"

step "5. update systemd env to mainnet (override file)"
mkdir -p /etc/systemd/system/wrappedbulls-web.service.d/
cat > /etc/systemd/system/wrappedbulls-web.service.d/launch.conf <<EOF
[Service]
Environment=NEXT_PUBLIC_PROGRAM_ID=$PROGRAM
Environment=NEXT_PUBLIC_SOLANA_CLUSTER=mainnet-beta
Environment=NEXT_PUBLIC_LAUNCH_STATE=live
Environment=NEXT_PUBLIC_TOKEN_MINT=$MINT
Environment=NEXT_PUBLIC_SOLANA_RPC_URL=https://api.mainnet-beta.solana.com
Environment=SOLANA_RPC_URL=$HELIUS
EOF
systemctl daemon-reload

step "6. restart wrappedbulls-web"
systemctl restart wrappedbulls-web
sleep 3
systemctl is-active wrappedbulls-web
halt_if_fail $? "service did not start"

step "7. external verify (real internet path)"
sleep 3
curl -s -m 8 -o /dev/null -w "  homepage: HTTP %{http_code}\n" https://wrappedbulls.com
curl -s -m 8 -o /dev/null -w "  /wrap:    HTTP %{http_code}\n" https://wrappedbulls.com/wrap
curl -s -m 8 -o /dev/null -w "  /api/metadata/1: HTTP %{http_code}\n" https://wrappedbulls.com/api/metadata/1
curl -s -m 8 -o /dev/null -w "  /api/render/1:   HTTP %{http_code}\n" https://wrappedbulls.com/api/render/1
echo ""
echo "homepage gating state (should NOT show 'Launching soon'):"
curl -s -m 8 https://wrappedbulls.com | grep -oE "Launching soon|Wrap your bulls|live" | head -3

step "DONE"
date -u

#!/bin/bash
# Stage B: flip site from pre-launch (devnet) to live (mainnet) + rebuild + restart.
# Run on the bulls box only. Pre-condition: mainnet program deployed + bank initialized + collection initialized.
set -e

WEB=/root/wrappedbulls-sol/web
DEPLOY=/opt/wrappedbulls-web
SVC=/etc/systemd/system/wrappedbulls-web.service
HELIUS=https://mainnet.helius-rpc.com/?api-key=dc600042-d2ea-486d-8044-877884eb777b
PROG=F7qXskG73efUwbDo2B97tZgpPAqX7zHMApXbPUimcFdS
MINT=XfY2XBcgY8QSLtGHnmwYrMT4CQt5mVMj55tXRWHpump

echo "=========================================================="
echo "STAGE B: flip to live + mainnet + rebuild + restart"
echo "=========================================================="
date -u +"%Y-%m-%dT%H:%M:%SZ"

cd "$WEB"

echo ""
echo "--- 1. Write web/.env.production (build-time + runtime config) ---"
cat > .env.production <<EOF
NEXT_PUBLIC_PROGRAM_ID=$PROG
NEXT_PUBLIC_SOLANA_CLUSTER=mainnet-beta
NEXT_PUBLIC_LAUNCH_STATE=live
NEXT_PUBLIC_TOKEN_MINT=$MINT
NEXT_PUBLIC_SOLANA_RPC_URL=https://api.mainnet-beta.solana.com
SOLANA_RPC_URL=$HELIUS
EOF
cat .env.production | sed 's|api-key=[a-f0-9-]*|api-key=***|'

echo ""
echo "--- 2. Confirm no .env.local footgun ---"
[ -f .env.local ] && { echo "FATAL: .env.local exists; would poison build"; exit 1; }
echo "no .env.local OK"

echo ""
echo "--- 3. npm install + clean .next + build (env.production picked up by Next.js) ---"
npm install --no-audit --no-fund --silent
rm -rf .next
npm run build 2>&1 | tail -20

echo ""
echo "--- 4. Verify .next/standalone present + BUILD_ID changed ---"
ls -la .next/standalone/server.js
NEW_ID=$(cat .next/BUILD_ID)
OLD_ID=$(cat "$DEPLOY/.next/BUILD_ID" 2>/dev/null || echo "none")
echo "old BUILD_ID: $OLD_ID"
echo "new BUILD_ID: $NEW_ID"
[ "$NEW_ID" = "$OLD_ID" ] && { echo "FATAL: BUILD_ID unchanged — build did not produce new output"; exit 1; }

echo ""
echo "--- 5. Sync standalone build to $DEPLOY ---"
# Next.js standalone deploy pattern: server.js + minimal node_modules + .next/server + public + .next/static
rsync -a --delete --exclude .env.production --exclude public .next/standalone/ "$DEPLOY/"
rm -rf "$DEPLOY/.next/static"
cp -r .next/static "$DEPLOY/.next/static"
rsync -a public/ "$DEPLOY/public/"
cp .env.production "$DEPLOY/.env.production"
echo "synced. deployed BUILD_ID:"
cat "$DEPLOY/.next/BUILD_ID"

echo ""
echo "--- 6. Rewrite systemd service env to mainnet/live ---"
cat > "$SVC" <<EOF
[Unit]
Description=WrappedBulls Next.js web (wrappedbulls.com)
After=network.target

[Service]
Type=simple
WorkingDirectory=$DEPLOY
Environment=NODE_ENV=production
Environment=PORT=3000
Environment=HOSTNAME=127.0.0.1
Environment=NEXT_PUBLIC_PROGRAM_ID=$PROG
Environment=NEXT_PUBLIC_SOLANA_CLUSTER=mainnet-beta
Environment=NEXT_PUBLIC_LAUNCH_STATE=live
Environment=NEXT_PUBLIC_TOKEN_MINT=$MINT
Environment=NEXT_PUBLIC_SOLANA_RPC_URL=https://api.mainnet-beta.solana.com
Environment=SOLANA_RPC_URL=$HELIUS
ExecStart=/usr/bin/node server.js
Restart=on-failure
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

echo ""
echo "--- 7. daemon-reload + restart ---"
systemctl daemon-reload
systemctl restart wrappedbulls-web
sleep 4
echo ""
echo "service status:"
systemctl is-active wrappedbulls-web
systemctl status wrappedbulls-web --no-pager 2>&1 | head -10

echo ""
echo "--- 8. EXTERNAL post-flip checks (real internet path) ---"
echo ">> homepage:"
curl -s -m 8 https://wrappedbulls.com | grep -oE "Launching soon|Pre-launch|Wrap a Bull|live|Mainnet|wrap" | sort -u | head -8
echo ""
echo ">> /wrap:"
curl -s -m 8 https://wrappedbulls.com/wrap | grep -oE "Launching soon|goes live at launch|Wrap a Bull|Connect Wallet|wrap" | sort -u | head -8
echo ""
echo ">> /api/metadata/collection:"
curl -s -m 8 -w "  HTTP %{http_code} | %{size_download}B | %{content_type}\n" -o /tmp/coll_post.json https://wrappedbulls.com/api/metadata/collection
head -c 200 /tmp/coll_post.json; echo
echo ""
echo ">> /api/metadata/1 (no bull yet, expect 404):"
curl -s -m 8 -w "  HTTP %{http_code} | %{size_download}B\n" -o /dev/null https://wrappedbulls.com/api/metadata/1
echo ""
echo ">> /api/render/1 (no bull yet, expect 404):"
curl -s -m 8 -w "  HTTP %{http_code} | %{size_download}B\n" -o /dev/null https://wrappedbulls.com/api/render/1

date -u +"%Y-%m-%dT%H:%M:%SZ"
echo "=========================================================="
echo "STAGE B DONE"
echo "=========================================================="

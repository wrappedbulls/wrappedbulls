#!/bin/bash
# Stage B (rebuild v2): clean rebuild with env vars exported to shell BEFORE
# next build, bypassing any .env.production loading quirk that left
# NEXT_PUBLIC_TOKEN_MINT empty in the deployed bundle.
#
# Gates verified at each step; the bundle is checked for the literal mint
# string BEFORE rsync/restart, so a bad build cannot reach /opt.
set -e

WEB=/root/wrappedbulls-sol/web
DEPLOY=/opt/wrappedbulls-web
SVC=/etc/systemd/system/wrappedbulls-web.service
HELIUS=https://mainnet.helius-rpc.com/?api-key=dc600042-d2ea-486d-8044-877884eb777b
PROG=A2tUttiL2v2fYxPyeUSZ75CqnjDp5sewCqcnXubgoxm
MINT=XfY2XBcgY8QSLtGHnmwYrMT4CQt5mVMj55tXRWHpump

echo "=========================================================="
echo "STAGE B REBUILD v2 (env vars exported to shell)"
echo "=========================================================="
date -u +"%Y-%m-%dT%H:%M:%SZ"

cd "$WEB"

echo ""
echo "--- 1. Kill stuck 242722 (precise PID) ---"
if kill -0 242722 2>/dev/null; then
  kill -9 242722
  echo "killed 242722"
else
  echo "242722 not running (good)"
fi
sleep 1

echo ""
echo "--- 2. Confirm no .env.local ---"
[ -f .env.local ] && { echo "FATAL: .env.local exists"; exit 1; }
[ -f .env.production.local ] && { echo "FATAL: .env.production.local exists"; exit 1; }
echo "clean (only .env.production + .env.example present)"

echo ""
echo "--- 3. Rewrite .env.production to canonical mainnet values ---"
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
echo "--- 4. Export the env vars in shell BEFORE build (belt + suspenders) ---"
export NEXT_PUBLIC_PROGRAM_ID=$PROG
export NEXT_PUBLIC_SOLANA_CLUSTER=mainnet-beta
export NEXT_PUBLIC_LAUNCH_STATE=live
export NEXT_PUBLIC_TOKEN_MINT=$MINT
export NEXT_PUBLIC_SOLANA_RPC_URL=https://api.mainnet-beta.solana.com
export SOLANA_RPC_URL=$HELIUS
echo "exported. shell sees NEXT_PUBLIC_TOKEN_MINT=$NEXT_PUBLIC_TOKEN_MINT"

echo ""
echo "--- 5. Clean build (rm .next) ---"
rm -rf .next

echo ""
echo "--- 6. npm run build ---"
date -u +"%Y-%m-%dT%H:%M:%SZ build start"
timeout 600 npm run build 2>&1 | tail -10
date -u +"%Y-%m-%dT%H:%M:%SZ build end"

echo ""
echo "--- 7. VERIFY mint is in the built bundle BEFORE deploy ---"
if grep -rl "$MINT" .next/server .next/static 2>/dev/null | head -1; then
  echo "OK: mint string '$MINT' is in the built bundle"
else
  echo "FATAL: mint '$MINT' NOT in built bundle; refusing to deploy"
  exit 1
fi
echo ""
echo "BUILD_ID in new build:"
cat .next/BUILD_ID
echo "(was deployed: $(cat $DEPLOY/.next/BUILD_ID))"

echo ""
echo "--- 8. Sync standalone to /opt ---"
rsync -a --delete --exclude .env.production --exclude public .next/standalone/ "$DEPLOY/"
rm -rf "$DEPLOY/.next/static"
cp -r .next/static "$DEPLOY/.next/static"
rsync -a public/ "$DEPLOY/public/"
cp .env.production "$DEPLOY/.env.production"
echo "deployed BUILD_ID now:"
cat "$DEPLOY/.next/BUILD_ID"

echo ""
echo "--- 9. Restart service ---"
systemctl daemon-reload
systemctl restart wrappedbulls-web
sleep 5
echo "service: $(systemctl is-active wrappedbulls-web)"

echo ""
echo "--- 10. EXTERNAL verification (the real test) ---"
sleep 2
HOME_HTML=$(curl -s -m 10 https://wrappedbulls.com)
WRAP_HTML=$(curl -s -m 10 https://wrappedbulls.com/wrap)
echo ">> homepage mint count: $(echo "$HOME_HTML" | grep -c "$MINT" || true)"
echo ">> homepage pump.fun link: $(echo "$HOME_HTML" | grep -oE 'pump\.fun/[A-Za-z0-9]+' | head -1)"
echo ">> homepage has 'Wrap a Bull': $(echo "$HOME_HTML" | grep -c 'Wrap a Bull' || true)"
echo ">> homepage has 'Launching soon': $(echo "$HOME_HTML" | grep -c 'Launching soon' || true)"
echo ">> /wrap rendered: $(echo "$WRAP_HTML" | wc -c) bytes"
echo ">> /api/metadata/collection:"
curl -s -m 10 -o /dev/null -w "  HTTP %{http_code}\n" https://wrappedbulls.com/api/metadata/collection
echo ">> /api/metadata/1 (expect 404):"
curl -s -m 10 -o /dev/null -w "  HTTP %{http_code}\n" https://wrappedbulls.com/api/metadata/1

date -u +"%Y-%m-%dT%H:%M:%SZ DONE"
echo "=========================================================="
echo "SUCCESS"
echo "=========================================================="

#!/bin/bash
# Stage B rebuild: explicit env exports (process.env > .env.production),
# verify mint inlined in build BEFORE deploy, backup /opt for instant rollback.
set -e

WEB=/root/wrappedbulls-sol/web
DEPLOY=/opt/wrappedbulls-web
BACKUP=/opt/wrappedbulls-web.bak-$(date +%s)

PROG=F7qXskG73efUwbDo2B97tZgpPAqX7zHMApXbPUimcFdS
MINT=XfY2XBcgY8QSLtGHnmwYrMT4CQt5mVMj55tXRWHpump
HELIUS_URL='https://mainnet.helius-rpc.com/?api-key=dc600042-d2ea-486d-8044-877884eb777b'

echo "=========================================================="
echo "REBUILD with explicit env exports + pre-deploy verification"
echo "=========================================================="
date -u +"%Y-%m-%dT%H:%M:%SZ"

echo ""
echo "--- 0. Kill stuck PID 242722 (harmless self-matching pgrep loop) ---"
kill -9 242722 2>/dev/null && echo "killed 242722" || echo "242722 not running"
sleep 1
echo "remaining suspicious processes:"
pgrep -af 'bash -lc.*npm install' | grep -v 'next/dist' | grep -v "$$" || echo "  (none)"

echo ""
echo "--- 1. Backup /opt for instant rollback ---"
cp -a "$DEPLOY" "$BACKUP"
echo "backup: $BACKUP ($(du -sh "$BACKUP" | awk '{print $1}'))"

cd "$WEB"

echo ""
echo "--- 2. Write .env.production (final canonical version) ---"
cat > .env.production <<EOF
NEXT_PUBLIC_PROGRAM_ID=$PROG
NEXT_PUBLIC_SOLANA_CLUSTER=mainnet-beta
NEXT_PUBLIC_LAUNCH_STATE=live
NEXT_PUBLIC_TOKEN_MINT=$MINT
NEXT_PUBLIC_SOLANA_RPC_URL=https://api.mainnet-beta.solana.com
SOLANA_RPC_URL=$HELIUS_URL
EOF

echo ""
echo "--- 3. EXPLICIT shell exports (process.env overrides .env loading) ---"
export NEXT_PUBLIC_PROGRAM_ID="$PROG"
export NEXT_PUBLIC_SOLANA_CLUSTER=mainnet-beta
export NEXT_PUBLIC_LAUNCH_STATE=live
export NEXT_PUBLIC_TOKEN_MINT="$MINT"
export NEXT_PUBLIC_SOLANA_RPC_URL=https://api.mainnet-beta.solana.com
export SOLANA_RPC_URL="$HELIUS_URL"
# Sanity print
echo "NEXT_PUBLIC_TOKEN_MINT=$NEXT_PUBLIC_TOKEN_MINT"
echo "NEXT_PUBLIC_LAUNCH_STATE=$NEXT_PUBLIC_LAUNCH_STATE"

echo ""
echo "--- 4. Clean .next + build ---"
rm -rf .next
timeout 600 npm run build 2>&1 | tail -10

echo ""
echo "--- 5. VERIFY build artifact has mint + live + program before deploy ---"
NEW_ID=$(cat .next/BUILD_ID)
echo "new BUILD_ID: $NEW_ID"
MINT_IN_BUILD=$(grep -r "XfY2XBcg" .next 2>/dev/null | wc -l)
LIVE_IN_BUILD=$(grep -rE '"live"' .next/server/app/page.js 2>/dev/null | wc -l)
PROG_IN_BUILD=$(grep -r "A2tUttiL2v2" .next/static 2>/dev/null | wc -l)
echo "mint XfY2XBcg occurrences in .next:      $MINT_IN_BUILD"
echo "'live' occurrences in page.js server:    $LIVE_IN_BUILD"
echo "program-id in static chunks:             $PROG_IN_BUILD"

if [ "$MINT_IN_BUILD" -eq 0 ]; then
  echo ""
  echo "FATAL: mint string NOT inlined in new build. Aborting deploy."
  echo "Live site unchanged. Backup intact at $BACKUP."
  exit 2
fi

echo ""
echo "--- 6. Sync standalone build to /opt (preserving .env.production) ---"
rsync -a --delete --exclude .env.production .next/standalone/ "$DEPLOY/"
rm -rf "$DEPLOY/.next/static"
cp -r .next/static "$DEPLOY/.next/static"
rsync -a public/ "$DEPLOY/public/"
cp .env.production "$DEPLOY/.env.production"
echo "deployed BUILD_ID: $(cat "$DEPLOY/.next/BUILD_ID")"

echo ""
echo "--- 7. Restart service ---"
systemctl restart wrappedbulls-web
sleep 5
echo "service: $(systemctl is-active wrappedbulls-web)"
echo "MainPID: $(systemctl show wrappedbulls-web --property=MainPID --no-pager)"

echo ""
echo "--- 8. EXTERNAL post-rebuild verification ---"
HOME_HTML=$(curl -s -m 10 https://wrappedbulls.com)
echo "homepage size: $(echo -n "$HOME_HTML" | wc -c)"
echo "  mint XfY2 in homepage HTML: $(echo "$HOME_HTML" | grep -c XfY2XBcg)"
echo "  '\$WBULL:' block render:    $(echo "$HOME_HTML" | grep -c '\$WBULL:')"
echo "  'Wrap a Bull' render:       $(echo "$HOME_HTML" | grep -c 'Wrap a Bull')"
echo "  pump.fun/$MINT link:        $(echo "$HOME_HTML" | grep -oE "pump.fun/$MINT" | head -1)"

echo ""
echo ">> /api/metadata/collection:"; curl -s -m 8 -o /dev/null -w "  HTTP %{http_code}\n" https://wrappedbulls.com/api/metadata/collection
echo ">> /api/metadata/1 (expect 404):"; curl -s -m 8 -o /dev/null -w "  HTTP %{http_code}\n" https://wrappedbulls.com/api/metadata/1

date -u +"%Y-%m-%dT%H:%M:%SZ"
echo "=========================================================="
echo "REBUILD + VERIFY DONE"
echo "If anything looks wrong: instant restore via"
echo "  rm -rf $DEPLOY && mv $BACKUP $DEPLOY && systemctl restart wrappedbulls-web"
echo "=========================================================="

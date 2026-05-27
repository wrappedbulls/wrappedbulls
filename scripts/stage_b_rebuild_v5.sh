#!/bin/bash
# Rebuild v5: launch-state.ts now has hardcoded TOKEN_MINT_FALLBACK literal
# (workaround for Next.js DCE inlining quirk). With the const in the source,
# the build WILL include the mint string in the bundle. Belt+suspenders also
# passes inline env vars in case future code paths need them.
# Bug fixes from v4: proper grep-q tests (no integer comparison error).
set -e
set -o pipefail

WEB=/root/wrappedbulls-sol/web
DEPLOY=/opt/wrappedbulls-web
HELIUS='https://mainnet.helius-rpc.com/?api-key=dc600042-d2ea-486d-8044-877884eb777b'
PROG=F7qXskG73efUwbDo2B97tZgpPAqX7zHMApXbPUimcFdS
MINT=XfY2XBcgY8QSLtGHnmwYrMT4CQt5mVMj55tXRWHpump

echo "============================================================"
echo "REBUILD v5  $(date -u +%H:%M:%SZ)"
echo "============================================================"

cd "$WEB"

echo ""
echo "--- 1. Confirm launch-state.ts has the fallback const ---"
if grep -q 'TOKEN_MINT_FALLBACK' lib/launch-state.ts && grep -q "$MINT" lib/launch-state.ts; then
  echo "  OK: launch-state.ts has TOKEN_MINT_FALLBACK = $MINT"
else
  echo "  FATAL: launch-state.ts missing fallback const"
  exit 1
fi

echo ""
echo "--- 2. Any racing builds? ---"
if pgrep -f "next build" >/dev/null; then echo "FATAL: another next build is running, refusing to race"; exit 1; else echo "  none"; fi

echo ""
echo "--- 3. Clean .next ---"
chmod -R u+w .next 2>/dev/null || true
rm -rf .next .next-build .next.tmp 2>/dev/null || true

echo ""
echo "--- 4. .env.production canonical ---"
cat > .env.production <<EOF
NEXT_PUBLIC_PROGRAM_ID=$PROG
NEXT_PUBLIC_SOLANA_CLUSTER=mainnet-beta
NEXT_PUBLIC_LAUNCH_STATE=live
NEXT_PUBLIC_TOKEN_MINT=$MINT
NEXT_PUBLIC_SOLANA_RPC_URL=https://api.mainnet-beta.solana.com
SOLANA_RPC_URL=$HELIUS
EOF

echo ""
echo "--- 5. BUILD with inline env (belt+suspenders) ---"
date -u +"%Y-%m-%dT%H:%M:%SZ build start"
NEXT_PUBLIC_PROGRAM_ID=$PROG \
NEXT_PUBLIC_SOLANA_CLUSTER=mainnet-beta \
NEXT_PUBLIC_LAUNCH_STATE=live \
NEXT_PUBLIC_TOKEN_MINT=$MINT \
NEXT_PUBLIC_SOLANA_RPC_URL=https://api.mainnet-beta.solana.com \
SOLANA_RPC_URL="$HELIUS" \
timeout 600 npm run build 2>&1 | tail -10
date -u +"%Y-%m-%dT%H:%M:%SZ build end"

echo ""
echo "--- 6. VERIFY mint in /root build (with grep -q, no integer compare) ---"
if grep -rq "$MINT" .next/server .next/static .next/standalone 2>/dev/null; then
  echo "  OK: mint in /root build (files):"
  grep -rl "$MINT" .next/server .next/static .next/standalone 2>/dev/null | head -10
else
  echo "  FATAL: mint NOT in /root build"; exit 1
fi

echo ""
echo "--- 7. VERIFY mint in homepage server bundle specifically ---"
if grep -q "$MINT" .next/standalone/.next/server/app/page.js 2>/dev/null; then
  echo "  OK: mint in standalone page.js"
else
  echo "  FATAL: mint NOT in standalone page.js"; exit 1
fi

echo ""
echo "--- 8. rsync to /opt ---"
rsync -a --delete --exclude .env.production --exclude public .next/standalone/ "$DEPLOY/"
rm -rf "$DEPLOY/.next/static"
cp -r .next/static "$DEPLOY/.next/static"
rsync -a public/ "$DEPLOY/public/"
cp .env.production "$DEPLOY/.env.production"
echo "  deployed BUILD_ID: $(cat $DEPLOY/.next/BUILD_ID)"

echo ""
echo "--- 9. VERIFY mint in /opt deployed page.js ---"
if grep -q "$MINT" "$DEPLOY/.next/server/app/page.js" 2>/dev/null; then
  echo "  OK: mint in /opt page.js"
else
  echo "  FATAL: mint missing from /opt page.js"; exit 1
fi

echo ""
echo "--- 10. restart ---"
systemctl restart wrappedbulls-web
sleep 5
echo "  service: $(systemctl is-active wrappedbulls-web)"
journalctl -u wrappedbulls-web -n 4 --no-pager | tail -4

echo ""
echo "--- 11. EXTERNAL truth test ---"
sleep 2
HOME=$(curl -s -m 10 https://wrappedbulls.com)
if echo "$HOME" | grep -q "$MINT"; then
  echo "  ✓ mint renders on homepage"
  echo "$HOME" | grep -oE "pump\.fun/[A-Za-z0-9]+" | head -1 | sed 's/^/  pump.fun link: /'
else
  echo "  ✗ mint NOT rendered on homepage"; exit 2
fi
echo "  Launching soon: $(echo "$HOME" | grep -c 'Launching soon' || true) (expect 0)"
echo "  Wrap a Bull:    $(echo "$HOME" | grep -c 'Wrap a Bull' || true) (expect >=1)"
echo "  /api/metadata/collection: $(curl -s -m 8 -o /dev/null -w '%{http_code}' https://wrappedbulls.com/api/metadata/collection)"
echo "  /api/metadata/1:          $(curl -s -m 8 -o /dev/null -w '%{http_code}' https://wrappedbulls.com/api/metadata/1)"

date -u +"%Y-%m-%dT%H:%M:%SZ DONE"
echo "============================================================"
echo "SUCCESS"
echo "============================================================"

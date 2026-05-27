#!/bin/bash
# Rebuild v4: inline env vars to npm run build (proven by v3 diagnostic),
# aggressive cleanup (kills the ENOTEMPTY issue), pipefail-gated checks,
# two-stage mint verification (/root build + /opt after rsync). No deploy
# unless mint is provably in the deployed bundle.
set -e
set -o pipefail

WEB=/root/wrappedbulls-sol/web
DEPLOY=/opt/wrappedbulls-web
HELIUS='https://mainnet.helius-rpc.com/?api-key=dc600042-d2ea-486d-8044-877884eb777b'
PROG=F7qXskG73efUwbDo2B97tZgpPAqX7zHMApXbPUimcFdS
MINT=XfY2XBcgY8QSLtGHnmwYrMT4CQt5mVMj55tXRWHpump

echo "============================================================"
echo "REBUILD v4  $(date -u +%H:%M:%SZ)"
echo "============================================================"

cd "$WEB"

echo ""
echo "--- 1. Any racing build processes? (sanity) ---"
ps -ef | grep -E 'next build|npm install|bash /tmp/stage' | grep -v grep | head -3 || echo "  none"

echo ""
echo "--- 2. Aggressive .next cleanup (fixes ENOTEMPTY) ---"
chmod -R u+w .next 2>/dev/null || true
rm -rf .next .next-build .next.tmp 2>/dev/null
ls -la .next 2>&1 | head -3 || echo "  .next is gone"

echo ""
echo "--- 3. Write canonical .env.production ---"
cat > .env.production <<EOF
NEXT_PUBLIC_PROGRAM_ID=$PROG
NEXT_PUBLIC_SOLANA_CLUSTER=mainnet-beta
NEXT_PUBLIC_LAUNCH_STATE=live
NEXT_PUBLIC_TOKEN_MINT=$MINT
NEXT_PUBLIC_SOLANA_RPC_URL=https://api.mainnet-beta.solana.com
SOLANA_RPC_URL=$HELIUS
EOF
sed 's|api-key=[a-f0-9-]*|api-key=***|' .env.production

echo ""
echo "--- 4. BUILD with env vars INLINED at command (proven to propagate) ---"
date -u +"%Y-%m-%dT%H:%M:%SZ build start"
NEXT_PUBLIC_PROGRAM_ID=$PROG \
NEXT_PUBLIC_SOLANA_CLUSTER=mainnet-beta \
NEXT_PUBLIC_LAUNCH_STATE=live \
NEXT_PUBLIC_TOKEN_MINT=$MINT \
NEXT_PUBLIC_SOLANA_RPC_URL=https://api.mainnet-beta.solana.com \
SOLANA_RPC_URL="$HELIUS" \
timeout 600 npm run build 2>&1 | tail -15
date -u +"%Y-%m-%dT%H:%M:%SZ build end"

echo ""
echo "--- 5. HARD VERIFY mint in /root build ---"
ROOT_HITS=$(grep -rl "$MINT" .next/server .next/static .next/standalone 2>/dev/null | wc -l)
echo "  /root mint hits: $ROOT_HITS"
if [ "$ROOT_HITS" -eq 0 ]; then echo "FATAL: mint NOT inlined in /root build"; exit 1; fi
grep -rl "$MINT" .next/server .next/static .next/standalone 2>/dev/null | head -10

echo ""
echo "--- 6. Verify mint specifically in homepage server bundle ---"
PAGE_HITS=$(grep -c "$MINT" .next/standalone/.next/server/app/page.js 2>/dev/null || echo 0)
echo "  page.js in standalone has mint: $PAGE_HITS occurrences"
if [ "$PAGE_HITS" -eq 0 ]; then
  echo "FATAL: mint NOT in standalone page.js (homepage won't render it)"
  exit 1
fi

echo ""
echo "--- 7. rsync to /opt ---"
rsync -a --delete --exclude .env.production --exclude public .next/standalone/ "$DEPLOY/"
rm -rf "$DEPLOY/.next/static"
cp -r .next/static "$DEPLOY/.next/static"
rsync -a public/ "$DEPLOY/public/"
cp .env.production "$DEPLOY/.env.production"
echo "deployed BUILD_ID: $(cat $DEPLOY/.next/BUILD_ID)"

echo ""
echo "--- 8. HARD VERIFY mint in /opt ---"
OPT_HITS=$(grep -rl "$MINT" "$DEPLOY/.next" 2>/dev/null | wc -l)
OPT_PAGE_HITS=$(grep -c "$MINT" "$DEPLOY/.next/server/app/page.js" 2>/dev/null || echo 0)
echo "  /opt mint hits:                      $OPT_HITS"
echo "  /opt/.next/server/app/page.js hits:  $OPT_PAGE_HITS"
if [ "$OPT_PAGE_HITS" -eq 0 ]; then echo "FATAL: mint NOT in /opt page.js after rsync"; exit 1; fi

echo ""
echo "--- 9. restart service ---"
systemctl restart wrappedbulls-web
sleep 5
echo "service: $(systemctl is-active wrappedbulls-web)"
journalctl -u wrappedbulls-web -n 5 --no-pager | tail -5

echo ""
echo "--- 10. EXTERNAL verify (real internet truth) ---"
sleep 2
HOME=$(curl -s -m 10 https://wrappedbulls.com)
MINT_IN_HOME=$(echo "$HOME" | grep -c "$MINT" || true)
LINK=$(echo "$HOME" | grep -oE "pump\.fun/[A-Za-z0-9]+" | head -1 || true)
echo "  mint count in homepage HTML:  $MINT_IN_HOME"
echo "  pump.fun link present:        $LINK"
echo "  'Wrap a Bull':                $(echo "$HOME" | grep -c 'Wrap a Bull' || true)"
echo "  'Launching soon':             $(echo "$HOME" | grep -c 'Launching soon' || true)"
echo "  collection endpoint:          $(curl -s -m 8 -o /dev/null -w '%{http_code}' https://wrappedbulls.com/api/metadata/collection)"
echo "  /api/metadata/1:              $(curl -s -m 8 -o /dev/null -w '%{http_code}' https://wrappedbulls.com/api/metadata/1)"

date -u +"%Y-%m-%dT%H:%M:%SZ DONE"
echo "============================================================"
if [ "$MINT_IN_HOME" -ge 1 ]; then
  echo "✓ SUCCESS — mint renders on homepage"
else
  echo "✗ FAIL — mint in /opt but not rendered (server-side render issue, investigate)"
  exit 2
fi
echo "============================================================"

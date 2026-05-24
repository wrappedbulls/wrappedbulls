#!/bin/bash
# Rebuild v3: inline env vars to build command (most reliable), proper
# exit-code-gated verification, AND a second check on /opt after rsync.
# No deploy happens unless the mint is provably in the built bundle.
set -e
set -o pipefail

WEB=/root/wrappedbulls-sol/web
DEPLOY=/opt/wrappedbulls-web
HELIUS='https://mainnet.helius-rpc.com/?api-key=dc600042-d2ea-486d-8044-877884eb777b'
PROG=A2tUttiL2v2fYxPyeUSZ75CqnjDp5sewCqcnXubgoxm
MINT=XfY2XBcgY8QSLtGHnmwYrMT4CQt5mVMj55tXRWHpump

echo "============================================================"
echo "STAGE B REBUILD v3  $(date -u +%H:%M:%SZ)"
echo "============================================================"

cd "$WEB"

echo ""
echo "--- 1. kill any leftover stuck scripts (precise) ---"
for PID in 242722; do
  if kill -0 $PID 2>/dev/null; then kill -9 $PID; echo "killed $PID"; else echo "$PID not running"; fi
done

echo ""
echo "--- 2. write .env.production canonically ---"
cat > .env.production <<EOF
NEXT_PUBLIC_PROGRAM_ID=$PROG
NEXT_PUBLIC_SOLANA_CLUSTER=mainnet-beta
NEXT_PUBLIC_LAUNCH_STATE=live
NEXT_PUBLIC_TOKEN_MINT=$MINT
NEXT_PUBLIC_SOLANA_RPC_URL=https://api.mainnet-beta.solana.com
SOLANA_RPC_URL=$HELIUS
EOF
echo "wrote .env.production:"
sed 's|api-key=[a-f0-9-]*|api-key=***|' .env.production

echo ""
echo "--- 3. diagnostic: does node see the env var? ---"
node -e "console.log('node sees NEXT_PUBLIC_TOKEN_MINT =', JSON.stringify(process.env.NEXT_PUBLIC_TOKEN_MINT))"
NEXT_PUBLIC_TOKEN_MINT=$MINT node -e "console.log('with inline export, node sees =', JSON.stringify(process.env.NEXT_PUBLIC_TOKEN_MINT))"

echo ""
echo "--- 4. clean .next ---"
rm -rf .next

echo ""
echo "--- 5. BUILD with env vars passed INLINE to the command ---"
date -u +"%Y-%m-%dT%H:%M:%SZ build start"
# Inline env-var prefix forces these into the env of the child process.
NEXT_PUBLIC_PROGRAM_ID=$PROG \
NEXT_PUBLIC_SOLANA_CLUSTER=mainnet-beta \
NEXT_PUBLIC_LAUNCH_STATE=live \
NEXT_PUBLIC_TOKEN_MINT=$MINT \
NEXT_PUBLIC_SOLANA_RPC_URL=https://api.mainnet-beta.solana.com \
SOLANA_RPC_URL="$HELIUS" \
timeout 600 npm run build 2>&1 | tail -10
date -u +"%Y-%m-%dT%H:%M:%SZ build end"

echo ""
echo "--- 6. HARD VERIFY mint in /root build (properly exit-coded) ---"
HITS=$(grep -rl "$MINT" .next/server .next/static .next/standalone 2>/dev/null | wc -l)
echo "files containing mint in /root build: $HITS"
if [ "$HITS" -eq 0 ]; then
  echo "FATAL: mint NOT inlined in /root build. NO DEPLOY."
  exit 1
fi
echo "files with mint:"
grep -rl "$MINT" .next/server .next/static .next/standalone 2>/dev/null | head -10

echo ""
echo "--- 7. specifically check page.js (the homepage server bundle) ---"
PAGE_MINT_HITS=$(grep -c "$MINT" .next/server/app/page.js 2>/dev/null || echo 0)
PAGE_STANDALONE_MINT_HITS=$(grep -c "$MINT" .next/standalone/.next/server/app/page.js 2>/dev/null || echo 0)
echo "  .next/server/app/page.js mint count:            $PAGE_MINT_HITS"
echo "  .next/standalone/.next/server/app/page.js mint: $PAGE_STANDALONE_MINT_HITS"

echo ""
echo "--- 8. rsync to /opt ---"
rsync -a --delete --exclude .env.production --exclude public .next/standalone/ "$DEPLOY/"
rm -rf "$DEPLOY/.next/static"
cp -r .next/static "$DEPLOY/.next/static"
rsync -a public/ "$DEPLOY/public/"
cp .env.production "$DEPLOY/.env.production"

echo ""
echo "--- 9. HARD VERIFY mint in /opt deployed bundle ---"
OPT_HITS=$(grep -rl "$MINT" "$DEPLOY/.next" 2>/dev/null | wc -l)
echo "files containing mint in /opt: $OPT_HITS"
if [ "$OPT_HITS" -eq 0 ]; then
  echo "FATAL: mint NOT in /opt after rsync. Rolling back service restart."
  exit 1
fi

echo ""
echo "--- 10. restart service ---"
systemctl restart wrappedbulls-web
sleep 5
echo "service: $(systemctl is-active wrappedbulls-web)"

echo ""
echo "--- 11. external verify (real internet path) ---"
sleep 2
HOME_HTML=$(curl -s -m 10 https://wrappedbulls.com)
MINT_IN_HOME=$(echo "$HOME_HTML" | grep -c "$MINT" || true)
PUMPFUN_LINK=$(echo "$HOME_HTML" | grep -oE "pump\.fun/[A-Za-z0-9]+" | head -1 || true)
echo "  mint count on homepage:     $MINT_IN_HOME"
echo "  pump.fun link on homepage:  $PUMPFUN_LINK"
echo "  'Wrap a Bull' on homepage:  $(echo "$HOME_HTML" | grep -c 'Wrap a Bull' || true)"
echo "  'Launching soon':           $(echo "$HOME_HTML" | grep -c 'Launching soon' || true)"
echo "  /api/metadata/collection:   $(curl -s -m 10 -o /dev/null -w '%{http_code}' https://wrappedbulls.com/api/metadata/collection)"

date -u +"%Y-%m-%dT%H:%M:%SZ DONE"
echo "============================================================"
if [ "$MINT_IN_HOME" -ge 1 ]; then
  echo "SUCCESS — mint renders on homepage"
else
  echo "WARNING — mint in /opt but not in rendered HTML (server-side render issue)"
fi
echo "============================================================"

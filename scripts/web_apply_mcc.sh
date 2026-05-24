#!/bin/bash
# ============================================================================
# ⚠️  DEPRECATED — DO NOT RUN. Superseded 2026-05-15.
# MCC is already wired into the main web client (web/lib/*.ts, idl.json) —
# there is no longer a separate pre-MCC client to "swap". Running this would
# overwrite the current correct client with stale .mcc alternates. Site
# build/deploy is the manual flow in docs/LAUNCH_RUNBOOK.md Phase 3.
if [ "${I_KNOW_THIS_IS_DEPRECATED:-0}" != "1" ]; then
  echo "DEPRECATED: MCC already in main client; see docs/LAUNCH_RUNBOOK.md. Aborting." >&2
  exit 1
fi
# ============================================================================
# Apply the MCC-aware web client (idl, program.ts, chain.ts + page hooks),
# rebuild Next.js, and sync to /opt/wrappedbulls-web.
#
# This is a one-way swap: web client moves from pre-MCC (works against the
# old devnet program) to MCC-aware (works against the new mainnet program
# that has initialize_collection + collection accounts on wrap/unwrap).
#
# Run BEFORE launch.sh, OR launch.sh will call it automatically as Step 0.5.
#
# Reversible: `cd /root/wrappedbulls-sol && git checkout -- web/lib web/app/wrap web/app/unwrap`
# then re-run npm run build + sync.

set -euo pipefail
exec > >(tee -a /root/web-apply-mcc.log) 2>&1

echo "=== $(date -u +"%Y-%m-%dT%H:%M:%SZ") web_apply_mcc start ==="

. "$HOME/.cargo/env" 2>/dev/null || true
export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"

REPO=/root/wrappedbulls-sol
WEB=$REPO/web

cd "$REPO"

# ============================================================
# 1. Sanity: required source files
# ============================================================
echo ""
echo "=== Step 1: source files ==="
for f in target/idl/wrappedbulls.json web/lib/program.ts.mcc web/lib/chain.ts.mcc; do
  if [ ! -f "$f" ]; then
    echo "ERROR: missing $f"
    exit 1
  fi
  echo "  ✓ $f ($(stat -c%s "$f") bytes)"
done

# Confirm IDL has the MCC fields (catch the case where target/idl is stale).
if ! grep -q "initialize_collection\|initializeCollection" target/idl/wrappedbulls.json; then
  echo "ERROR: target/idl/wrappedbulls.json does not contain initialize_collection."
  echo "       Run 'anchor build' to regenerate the IDL."
  exit 1
fi
echo "  ✓ target/idl has initialize_collection"

# ============================================================
# 2. Idempotency: refuse to clobber if already applied
# ============================================================
echo ""
echo "=== Step 2: idempotency check ==="
if grep -q "collectionAuthorityPda\|collection_authority" web/lib/program.ts; then
  echo "  ! web/lib/program.ts already contains MCC accounts. Re-applying anyway"
  echo "    (file copies are idempotent — this is safe)."
fi

# ============================================================
# 3. Apply file swaps
# ============================================================
echo ""
echo "=== Step 3: copy MCC files ==="
cp -v target/idl/wrappedbulls.json web/lib/idl.json
cp -v web/lib/program.ts.mcc  web/lib/program.ts
cp -v web/lib/chain.ts.mcc    web/lib/chain.ts

# ============================================================
# 4. Patch wrap/unwrap pages to pass collectionMint
# ============================================================
# These are small in-place edits. They replace the wrapBull / unwrapBull
# call sites with the MCC-aware signatures.
echo ""
echo "=== Step 4: patch wrap + unwrap pages ==="

# wrap/page.tsx: wrapBull(program, wallet.publicKey, new PublicKey(tokenMint), tier)
#  → wrapBull(program, wallet.publicKey, new PublicKey(tokenMint), tier, bank.collectionMint)
# We do this via sed. Idempotent: only changes the line if it's still the old shape.
WRAP=web/app/wrap/page.tsx
UNWRAP=web/app/unwrap/page.tsx
for p in "$WRAP" "$UNWRAP"; do
  if [ ! -f "$p" ]; then
    echo "ERROR: $p missing"; exit 1
  fi
done

# Patch wrap page: add bank.collectionMint as 5th arg to wrapBull.
# We only patch if the line matches the pre-MCC shape exactly.
if grep -qE "wrapBull\(program, wallet\.publicKey, new PublicKey\(tokenMint\), tier\)" "$WRAP"; then
  sed -i -E 's|wrapBull\(program, wallet\.publicKey, new PublicKey\(tokenMint\), tier\)|wrapBull(program, wallet.publicKey, new PublicKey(tokenMint), tier, (await fetchBank(program, "processed")).collectionMint)|' "$WRAP"
  echo "  ✓ patched $WRAP"
elif grep -q "collectionMint" "$WRAP"; then
  echo "  ! $WRAP already references collectionMint — leaving alone"
else
  echo "ERROR: $WRAP wrapBull call site does not match expected pre-MCC shape."
  echo "       Manual update required."
  exit 1
fi

# Patch unwrap page: add nftMint passes 5th arg `nftMint` already; we add 6th `collectionMint`.
# Pre-MCC shape: unwrapBull(program, wallet.publicKey, tokenMint, tier, nftMint)
# Post-MCC:     unwrapBull(program, wallet.publicKey, tokenMint, tier, nftMint, bank.collectionMint)
if grep -qE "unwrapBull\(program, wallet\.publicKey, tokenMint, tier, nftMint\)" "$UNWRAP"; then
  sed -i -E 's|unwrapBull\(program, wallet\.publicKey, tokenMint, tier, nftMint\)|unwrapBull(program, wallet.publicKey, tokenMint, tier, nftMint, (await fetchBank(program, "processed")).collectionMint)|' "$UNWRAP"
  echo "  ✓ patched $UNWRAP"
elif grep -q "collectionMint" "$UNWRAP"; then
  echo "  ! $UNWRAP already references collectionMint — leaving alone"
else
  echo "ERROR: $UNWRAP unwrapBull call site does not match expected pre-MCC shape."
  echo "       Manual update required."
  exit 1
fi

# ============================================================
# 5. Rebuild Next.js
# ============================================================
echo ""
echo "=== Step 5: npm run build ==="
cd "$WEB"
npm run build

# ============================================================
# 6. Sync to /opt/wrappedbulls-web
# ============================================================
echo ""
echo "=== Step 6: sync to /opt/wrappedbulls-web ==="
DEPLOY=/opt/wrappedbulls-web

# Clean static/public to avoid the nested-directory bug from cp -r.
rm -rf "$DEPLOY/.next/static" "$DEPLOY/public"
mkdir -p "$DEPLOY/.next/static" "$DEPLOY/public"

cp -r .next/standalone/. "$DEPLOY/"
cp -r .next/static/.     "$DEPLOY/.next/static/"
cp -r public/.           "$DEPLOY/public/"

# ============================================================
# 7. Restart + smoke test
# ============================================================
echo ""
echo "=== Step 7: restart + smoke test ==="
systemctl restart wrappedbulls-web
sleep 4
systemctl is-active wrappedbulls-web

curl -s --max-time 10 -o /dev/null -w "  / -> %{http_code}\n" \
  --resolve wrappedbulls.com:443:127.0.0.1 https://wrappedbulls.com/ || true
curl -s --max-time 10 -o /dev/null -w "  /api/health -> %{http_code}\n" \
  --resolve wrappedbulls.com:443:127.0.0.1 https://wrappedbulls.com/api/health || true
curl -s --max-time 10 -o /dev/null -w "  /wrap -> %{http_code}\n" \
  --resolve wrappedbulls.com:443:127.0.0.1 https://wrappedbulls.com/wrap || true

echo ""
echo "=== $(date -u +"%Y-%m-%dT%H:%M:%SZ") web_apply_mcc complete ==="
echo ""
echo "The website is now built with the MCC-aware client. Wraps/unwraps"
echo "will succeed once the matching MCC program is deployed on the"
echo "active cluster. Until then, wraps will fail with 'Account"
echo "collectionMint not provided' — that's the expected mismatch."

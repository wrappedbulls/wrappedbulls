#!/bin/bash
# On-chain invariant audit for the WrappedBulls program.
#
# Runs against either devnet or mainnet (defaults to env's NEXT_PUBLIC_SOLANA_CLUSTER
# from systemd, or pass --url <rpc>). Prints a report and exits 0 if all
# invariants hold, 1 otherwise. Designed for cron use.
#
# Invariants checked:
#   1.  bank.in_circulation == bank.total_wrapped - bank.total_unwrapped
#   2.  Number of live BullAsset PDAs == bank.in_circulation
#   3.  Sum of vault balances == bank.in_circulation * 1,000,000 $WBULL
#   4.  Each live BullAsset's nft_mint has supply == 1 (NFT held by someone)
#   5.  bank.next_tier - 1 - len(free_tiers) == in_circulation (tier accounting)
#   6.  All free_tiers values are in range [1, MAX_BULLS]
#
# Usage:
#   ./audit_chain.sh                        # uses default RPC
#   ./audit_chain.sh --url https://...      # custom RPC
#   ./audit_chain.sh --program <PROGRAM_ID> # override program ID
#
# Exit codes:
#   0 - all invariants pass
#   1 - one or more invariants violated (PRINT details)
#   2 - script error (couldn't connect, etc.)

set -euo pipefail

PROGRAM_ID="${PROGRAM_ID:-A2tUttiL2v2fYxPyeUSZ75CqnjDp5sewCqcnXubgoxm}"
RPC_URL="${RPC_URL:-https://api.devnet.solana.com}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --url) RPC_URL="$2"; shift 2 ;;
    --program) PROGRAM_ID="$2"; shift 2 ;;
    *) echo "unknown arg: $1"; exit 2 ;;
  esac
done

echo "=== WrappedBulls on-chain audit ==="
echo "Program:  $PROGRAM_ID"
echo "RPC:      $(echo "$RPC_URL" | sed 's|api-key=[a-f0-9-]*|api-key=***|')"
echo "Time:     $(date -u +"%Y-%m-%dT%H:%M:%SZ")"
echo ""

# Resolve the auditor script directory; fall back to wrappedbulls-sol root for node_modules
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Audit logic in node — handles borsh-style decode of bank + bull asset PDAs
node -e "
const path = require('path');
const w3path = require.resolve('@solana/web3.js', { paths: ['$PROJECT_ROOT'] });
const crypto = require('crypto');
const { PublicKey, Connection } = require(w3path);

const PROG = new PublicKey('$PROGRAM_ID');
const conn = new Connection('$RPC_URL', 'confirmed');
const TOKEN_PROGRAM = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const ATA_PROGRAM = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');

const BULL_ASSET_DISC = crypto.createHash('sha256').update('account:BullAsset').digest().subarray(0, 8);

const TOKENS_PER_BULL = 1_000_000_000_000n; // 1M tokens at 6 decimals
const MAX_BULLS = 1000;

let failures = [];
function check(name, ok, detail) {
  console.log('  ' + (ok ? '✓' : '✗') + ' ' + name + (detail ? ' - ' + detail : ''));
  if (!ok) failures.push(name);
}

(async () => {
  // 1. Read bank
  const [bankPda] = PublicKey.findProgramAddressSync([Buffer.from('bank')], PROG);
  const bankInfo = await conn.getAccountInfo(bankPda);
  if (!bankInfo) {
    console.log('Bank PDA not found at ' + bankPda.toBase58() + '. Either not initialized or wrong program ID.');
    process.exit(2);
  }
  let off = 8;
  const tokenMint = new PublicKey(bankInfo.data.slice(off, off + 32)); off += 32;
  const totalWrapped = bankInfo.data.readBigUInt64LE(off); off += 8;
  const totalUnwrapped = bankInfo.data.readBigUInt64LE(off); off += 8;
  const inCirc = bankInfo.data.readUInt16LE(off); off += 2;
  const nextTier = bankInfo.data.readUInt16LE(off); off += 2;
  const freeLen = bankInfo.data.readUInt32LE(off); off += 4;
  const freeTiers = [];
  for (let i = 0; i < freeLen; i++) {
    freeTiers.push(bankInfo.data.readUInt16LE(off));
    off += 2;
  }
  // After free_tiers there's: authority(32) + bump(1) + collection_mint(32)
  // We skip directly to collection_mint via fixed offset from free_tiers end.
  off += 32 + 1; // authority + bump
  const collectionMint = new PublicKey(bankInfo.data.slice(off, off + 32));

  console.log('Bank state:');
  console.log('  token_mint:     ' + tokenMint.toBase58());
  console.log('  collection_mint:' + collectionMint.toBase58());
  console.log('  total_wrapped:  ' + totalWrapped);
  console.log('  total_unwrapped:' + totalUnwrapped);
  console.log('  in_circulation: ' + inCirc);
  console.log('  next_tier:      ' + nextTier);
  console.log('  free_tiers:     [' + freeTiers.join(',') + ']');
  console.log('');
  console.log('Invariants:');

  // INVARIANT 1
  const expectedInCirc = Number(totalWrapped - totalUnwrapped);
  check('1. in_circulation == total_wrapped - total_unwrapped',
        inCirc === expectedInCirc,
        \`actual=\${inCirc}, expected=\${expectedInCirc}\`);

  // INVARIANT 6 (early — relevant to free_tiers)
  const oobFree = freeTiers.filter(t => t < 1 || t > MAX_BULLS);
  check('6. free_tiers all in [1, MAX_BULLS]',
        oobFree.length === 0,
        oobFree.length > 0 ? \`out-of-bounds: \${oobFree}\` : '');

  // Fetch all live BullAssets
  const baAccounts = await conn.getProgramAccounts(PROG, {
    commitment: 'confirmed',
    filters: [
      { memcmp: { offset: 0, bytes: BULL_ASSET_DISC.toString('base64'), encoding: 'base64' } },
    ],
  });
  const liveBulls = baAccounts.map(a => {
    const d = a.account.data;
    let o = 8;
    const nftMint = new PublicKey(d.slice(o, o + 32)); o += 32;
    const tier = d.readUInt16LE(o); o += 2;
    const wrappedAt = Number(d.readBigInt64LE(o)); o += 8;
    return { tier, nftMint, wrappedAt };
  });

  // INVARIANT 2
  check('2. live BullAsset count == in_circulation',
        liveBulls.length === inCirc,
        \`live=\${liveBulls.length}, expected=\${inCirc}\`);

  // INVARIANT 5 (tier accounting)
  // next_tier counts up to (highest tier wrapped) + 1; in_circulation = (next_tier - 1) - len(free_tiers)
  const tierAccountingExpected = Math.max(0, nextTier - 1 - freeLen);
  check('5. (next_tier-1) - len(free_tiers) == in_circulation',
        tierAccountingExpected === inCirc,
        \`(\${nextTier}-1)-\${freeLen}=\${tierAccountingExpected}, expected=\${inCirc}\`);

  // INVARIANT 3 + 4: vault sum + NFT supply
  let vaultSum = 0n;
  let supplyMismatch = 0;
  for (const b of liveBulls) {
    const [vaultAuth] = PublicKey.findProgramAddressSync(
      [Buffer.from('vault'), b.nftMint.toBuffer()], PROG);
    const [vault] = PublicKey.findProgramAddressSync(
      [vaultAuth.toBuffer(), TOKEN_PROGRAM.toBuffer(), tokenMint.toBuffer()], ATA_PROGRAM);
    const vInfo = await conn.getAccountInfo(vault);
    if (vInfo) {
      vaultSum += vInfo.data.readBigUInt64LE(64);
    } else {
      console.log('   ! vault missing for tier ' + b.tier + ' (' + vault.toBase58() + ')');
    }
    const mInfo = await conn.getAccountInfo(b.nftMint);
    if (mInfo) {
      const supply = mInfo.data.readBigUInt64LE(36);
      if (supply !== 1n) supplyMismatch++;
    }
  }
  const expectedSum = TOKENS_PER_BULL * BigInt(inCirc);
  check('3. sum(vault.amount) == in_circulation * 1M tokens',
        vaultSum === expectedSum,
        \`actual=\${vaultSum}, expected=\${expectedSum} (\${liveBulls.length} live bulls)\`);
  check('4. all live NFT mints have supply == 1',
        supplyMismatch === 0,
        \`mismatches=\${supplyMismatch} of \${liveBulls.length}\`);

  // INVARIANT 7: Metaplex Certified Collection is initialized
  // (collection_mint != Pubkey::default = 11111...1).
  const SYSTEM_DEFAULT_KEY = '11111111111111111111111111111111';
  check('7. collection_mint is set (Metaplex Certified Collection initialized)',
        collectionMint.toBase58() !== SYSTEM_DEFAULT_KEY,
        collectionMint.toBase58() === SYSTEM_DEFAULT_KEY
          ? 'run scripts/devnet_initialize_collection.ts'
          : '');

  console.log('');
  if (failures.length === 0) {
    console.log('=== ALL INVARIANTS PASS ===');
    process.exit(0);
  } else {
    console.log('=== ' + failures.length + ' INVARIANT(S) FAILED ===');
    for (const f of failures) console.log('   - ' + f);
    process.exit(1);
  }
})().catch(e => { console.error('audit error:', e.message); process.exit(2); });
"

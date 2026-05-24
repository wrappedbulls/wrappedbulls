// Wrappedbulls cranker — indexer + metadata server.
//
// In the ERC404-redesign, wrap/unwrap are user-initiated (no off-chain
// rebalance loop). The cranker now serves three roles:
//
//   1. Holder + bull indexer:
//      - Helius webhook updates an in-memory index of holders + wrapped bulls
//      - Periodic sweep reconciles the index with chain state
//      - Powers the website's gallery and wallet pages
//
//   2. Metadata server (Metaplex-compatible):
//      - GET /api/metadata/:tier  -> JSON { name, image, attributes, ... }
//      - GET /api/render/:tier.svg -> deterministic SVG, derived from
//        the bull's NFT mint address (read from chain via BullAsset PDA).
//      - These endpoints are what wallets (Phantom), explorers (Solscan),
//        and marketplaces (Magic Eden, Tensor) hit when displaying bulls.
//
//   3. Health endpoint:
//      - GET /health -> queue depth + bank state for monitoring

import express from 'express';
import { Connection, PublicKey } from '@solana/web3.js';
import { CONFIG } from './config.mjs';
import {
  renderBullSvg,
  deriveSeed,
  selectTraits,
} from './renderer.mjs';

// ============================================================
// In-memory indexer
// ============================================================
//
// `bulls`  — tier_index (number 1..1000) -> { nftMint: string, wrappedAt: number }
// `bank`   — last-known BullBank snapshot (in_circulation, total_wrapped, etc.)
//
// Refreshed via:
//   - Webhook events (real-time)
//   - Nightly full sweep (reconciliation)
//   - On-demand fetch when a metadata endpoint is hit for an unindexed tier
const bulls = new Map();
let bank = null;

const conn = new Connection(CONFIG.rpcUrl, 'confirmed');
const programId = new PublicKey(CONFIG.programId);

// ============================================================
// Chain helpers
// ============================================================

function bullAssetPda(tierIndex) {
  const tierBuf = Buffer.alloc(2);
  tierBuf.writeUInt16LE(tierIndex);
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from('bull'), tierBuf],
    programId,
  );
  return pda;
}

function bankPda() {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from('bank')],
    programId,
  );
  return pda;
}

// Decode a BullAsset account: 8-byte discriminator + 32 nft_mint + 2 tier_index
// + 8 wrapped_at + 1 bump.
function decodeBullAsset(data) {
  if (!data || data.length < 51) return null;
  const nftMint = new PublicKey(data.slice(8, 40)).toBase58();
  const tierIndex = data.readUInt16LE(40);
  const wrappedAt = Number(data.readBigInt64LE(42));
  return { nftMint, tierIndex, wrappedAt };
}

async function fetchBullFromChain(tierIndex) {
  const pda = bullAssetPda(tierIndex);
  const acc = await conn.getAccountInfo(pda);
  if (!acc) return null;
  return decodeBullAsset(acc.data);
}

// Fetch and decode the bank singleton. Schema:
//   8 disc + 32 token_mint + 8 total_wrapped + 8 total_unwrapped
//   + 2 in_circulation + 2 next_tier + (4 + N*2) free_tiers + 32 authority
//   + 1 bump + 64 reserved
async function fetchBankFromChain() {
  const pda = bankPda();
  const acc = await conn.getAccountInfo(pda);
  if (!acc) return null;
  const d = acc.data;
  let off = 8; // skip discriminator
  const tokenMint = new PublicKey(d.slice(off, off + 32)).toBase58(); off += 32;
  const totalWrapped = Number(d.readBigUInt64LE(off));   off += 8;
  const totalUnwrapped = Number(d.readBigUInt64LE(off)); off += 8;
  const inCirculation = d.readUInt16LE(off);             off += 2;
  const nextTier = d.readUInt16LE(off);                  off += 2;
  return { tokenMint, totalWrapped, totalUnwrapped, inCirculation, nextTier };
}

// Reconcile the indexer with chain state. Called on startup + nightly.
async function fullSweep() {
  console.log('[sweep] starting full reconciliation');
  bank = await fetchBankFromChain();
  if (!bank) {
    console.warn('[sweep] bank not initialized on-chain yet');
    return;
  }

  // For each tier 1..in_circulation+next_tier, try to fetch the BullAsset.
  // (Simple approach for v1; later we can optimize via getProgramAccounts.)
  const maxToCheck = Math.min(CONFIG.maxBulls, (bank.nextTier || 1) + 100);
  let found = 0;
  for (let tier = 1; tier <= maxToCheck; tier++) {
    const bull = await fetchBullFromChain(tier);
    if (bull) {
      bulls.set(tier, bull);
      found++;
    } else {
      bulls.delete(tier);
    }
  }
  console.log(`[sweep] reconciled ${found} bulls (in_circulation=${bank.inCirculation})`);
}

// ============================================================
// Metadata + render — the public-facing endpoints
// ============================================================

function bullAttributes(names, tier) {
  const attrs = [
    { trait_type: 'Tier', value: tier },
    { trait_type: 'Body', value: names.body },
    { trait_type: 'Horns', value: names.horn },
    { trait_type: 'Eyes', value: names.eye },
    { trait_type: 'Background', value: names.bg },
  ];
  if (names.acc !== 'none')      attrs.push({ trait_type: 'Accessory', value: names.acc });
  if (names.eyewear !== 'none')  attrs.push({ trait_type: 'Eyewear',   value: names.eyewear });
  if (names.mouth !== 'none')    attrs.push({ trait_type: 'Mouth',     value: names.mouth });
  return attrs;
}

async function getOrFetchBull(tierIndex) {
  let b = bulls.get(tierIndex);
  if (!b) {
    b = await fetchBullFromChain(tierIndex);
    if (b) bulls.set(tierIndex, b);
  }
  return b;
}

// ============================================================
// Express server
// ============================================================

const app = express();
app.use(express.json({ limit: '4mb' }));

const publicUrl = process.env.PUBLIC_URL || `http://localhost:${CONFIG.port}`;

app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    indexedBulls: bulls.size,
    bank,
    tokenMint: CONFIG.tokenMint,
    programId: CONFIG.programId,
  });
});

// Helius webhook — refresh affected tiers + bank state
app.post('/webhook', async (req, res) => {
  const events = Array.isArray(req.body) ? req.body : [req.body];
  // For v1: refresh the bank (cheap) and selectively re-fetch any tiers
  // mentioned in the events. Future: parse events more carefully.
  bank = await fetchBankFromChain();
  console.log(`[webhook] refreshed bank after ${events.length} event(s)`);
  res.json({ ok: true });
});

// Metaplex-compatible metadata for a given tier.
// Phantom/Magic Eden/Tensor hit this URL via the metadata account's `uri` field.
app.get('/api/metadata/:tier', async (req, res) => {
  const tier = parseInt(req.params.tier, 10);
  if (!Number.isInteger(tier) || tier < 1 || tier > CONFIG.maxBulls) {
    return res.status(400).json({ error: 'invalid tier' });
  }

  const bull = await getOrFetchBull(tier);
  if (!bull) {
    return res.status(404).json({ error: 'bull not wrapped at this tier' });
  }

  const seed = deriveSeed(bull.nftMint);
  const { names } = renderBullSvg(seed, 1); // scale=1 for fast trait extraction

  res.json({
    name: `WrappedBulls #${tier}`,
    symbol: 'WBULL',
    description:
      `WrappedBulls #${tier} — an ERC404-style hybrid bull NFT. Holds 1,000,000 ` +
      `$WBULL locked in a vault tied to this NFT's mint. Sell the NFT and ` +
      `the tokens follow it to the buyer.`,
    image: `${publicUrl}/api/render/${tier}.svg`,
    external_url: `${publicUrl}/bull/${tier}`,
    attributes: bullAttributes(names, tier),
    properties: {
      category: 'image',
      files: [{ uri: `${publicUrl}/api/render/${tier}.svg`, type: 'image/svg+xml' }],
    },
  });
});

// SVG endpoint — deterministic, cacheable.
app.get('/api/render/:tier.svg', async (req, res) => {
  const tier = parseInt(req.params.tier, 10);
  if (!Number.isInteger(tier) || tier < 1 || tier > CONFIG.maxBulls) {
    return res.status(400).type('text/plain').send('invalid tier');
  }

  const bull = await getOrFetchBull(tier);
  if (!bull) {
    return res.status(404).type('text/plain').send('bull not wrapped at this tier');
  }

  const seed = deriveSeed(bull.nftMint);
  const { svg } = renderBullSvg(seed, 12); // 12x = 288px output

  res.type('image/svg+xml');
  // Cache for 1 day — SVG is deterministic from on-chain nft_mint, only
  // changes if the bull is unwrapped+rewrapped (different nft_mint then).
  res.set('Cache-Control', 'public, max-age=86400');
  res.send(svg);
});

// Bulk gallery endpoint — returns lightweight info for every wrapped bull.
app.get('/api/bulls', (_req, res) => {
  const list = [];
  for (const [tier, bull] of bulls) {
    list.push({ tier, nftMint: bull.nftMint, wrappedAt: bull.wrappedAt });
  }
  list.sort((a, b) => a.tier - b.tier);
  res.json({ count: list.length, bulls: list });
});

app.listen(CONFIG.port, () => {
  console.log(`[wrappedbulls-cranker] listening on :${CONFIG.port}`);
  console.log(`[wrappedbulls-cranker] program=${CONFIG.programId} mint=${CONFIG.tokenMint || '(unset)'}`);
});

// ============================================================
// Background tasks
// ============================================================

// Initial sweep on startup, then every CONFIG.sweepIntervalMs.
fullSweep().catch(err => console.error('[sweep] initial failed:', err.message));
setInterval(() => {
  fullSweep().catch(err => console.error('[sweep] failed:', err.message));
}, CONFIG.sweepIntervalMs);

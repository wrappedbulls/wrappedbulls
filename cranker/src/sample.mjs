// Generate sample bulls and an index.html grid for visual review.
//
// Usage: node src/sample.mjs
// Output: ../samples/bull_*.svg + ../samples/index.html

import { renderBullSvg, deriveSeed } from './renderer.mjs';
import fs from 'node:fs';
import path from 'node:path';

const SAMPLES_DIR = path.resolve(import.meta.dirname, '..', '..', 'samples');
fs.mkdirSync(SAMPLES_DIR, { recursive: true });

// Generate 100 fake Solana-style base58 NFT mint pubkeys for variety.
// In production, each NFT gets a fresh keypair-derived mint address; we
// simulate that here with deterministic strings for reproducibility.
const FAKE_NFT_MINTS = Array.from({ length: 100 }, (_, i) => {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ123456789';
  let s = '';
  let n = i * 1234567 + 7919;
  for (let k = 0; k < 44; k++) {
    n = (n * 16807) % 2147483647;
    s += chars[n % chars.length];
  }
  return s;
});

const cards = [];

for (let i = 0; i < FAKE_NFT_MINTS.length; i++) {
  const nftMint = FAKE_NFT_MINTS[i];
  const tier = i + 1;
  const seed = deriveSeed(nftMint);
  const { svg, names } = renderBullSvg(seed, 12); // 12x scale = 288px

  const fname = `bull_${String(tier).padStart(4, '0')}.svg`;
  fs.writeFileSync(path.join(SAMPLES_DIR, fname), svg);
  cards.push({ tier, nftMint, names, fname });
}

const html = `<!doctype html>
<html><head>
<meta charset="utf-8">
<title>Wrappedbulls sample bulls</title>
<style>
  body { background: #0e0e12; color: #e8e8ec; font-family: system-ui, sans-serif; padding: 24px; margin: 0; }
  h1 { font-weight: 600; letter-spacing: 0.5px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 16px; }
  .card { background: #1a1a22; border-radius: 8px; padding: 12px; }
  .card img { display: block; width: 100%; height: auto; image-rendering: pixelated; border-radius: 4px; background: #000; }
  .meta { margin-top: 10px; font-size: 12px; line-height: 1.5; color: #aab; }
  .tag { display: inline-block; padding: 2px 6px; background: #2a2a35; border-radius: 4px; margin: 2px 4px 2px 0; }
  .tier { float: right; color: #f0c850; font-weight: 700; }
</style>
</head><body>
<h1>Wrappedbulls — sample bulls (24×24, deterministic from NFT mint)</h1>
<p style="color:#888">${cards.length} samples generated. Trait combos are seed-driven; rarities weighted (brown common, holo legendary).</p>
<div class="grid">
${cards.map(c => `
  <div class="card">
    <img src="${c.fname}" alt="bull #${c.tier}">
    <div class="meta">
      <span class="tier">#${String(c.tier).padStart(4,'0')}</span>
      <span class="tag">${c.names.body}</span>
      <span class="tag">${c.names.horn}</span>
      <span class="tag">${c.names.eye}</span>
      <span class="tag">${c.names.bg}</span>
      ${c.names.acc !== 'none' ? `<span class="tag" style="background:#3a2a1a;color:#f0c850">${c.names.acc}</span>` : ''}
      ${c.names.eyewear !== 'none' ? `<span class="tag" style="background:#1a2a3a;color:#80d8ff">${c.names.eyewear}</span>` : ''}
      ${c.names.mouth !== 'none' ? `<span class="tag" style="background:#3a1a1a;color:#ff8888">${c.names.mouth}</span>` : ''}
    </div>
  </div>`).join('\n')}
</div>
</body></html>`;

fs.writeFileSync(path.join(SAMPLES_DIR, 'index.html'), html);

console.log(`Generated ${cards.length} bulls + index.html in ${SAMPLES_DIR}`);

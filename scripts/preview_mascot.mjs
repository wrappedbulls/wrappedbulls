#!/usr/bin/env node
// preview_mascot.mjs — render a contact sheet of sample mascots so the
// new LAYOUT can be eyeballed. Throwaway dev tool (not part of launch).
//
//   node scripts/preview_mascot.mjs
//
// Writes mascot-preview.svg at the repo root — open it in a browser.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderBullSvg, deriveSeed } from "../web/lib/renderer.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// --- 1. Sanity-check the LAYOUT is exactly 24x24 --------------------
const src = fs.readFileSync(path.join(ROOT, "web/lib/renderer.mjs"), "utf8");
const block = src.match(/const LAYOUT = \[([\s\S]*?)\n\];/);
if (!block) { console.error("could not find LAYOUT"); process.exit(1); }
const rows = [...block[1].matchAll(/'([^']*)'/g)].map((m) => m[1]);
let bad = 0;
rows.forEach((r, i) => {
  if (r.length !== 24) { console.error(`LAYOUT row ${i}: length ${r.length} (must be 24)`); bad++; }
});
if (rows.length !== 24) { console.error(`LAYOUT has ${rows.length} rows (must be 24)`); bad++; }
if (bad) { console.error("LAYOUT grid is malformed — fix before rendering."); process.exit(1); }
console.log(`LAYOUT OK — 24 rows x 24 cols.`);

// --- 2. Render a contact sheet of sample mascots -------------------
const COLS = 4, ROWS = 3, CELL = 144, GAP = 8, LABEL = 16;
const seeds = [];
for (let i = 0; i < COLS * ROWS; i++) {
  // varied fake mint pubkeys -> varied seeds -> varied traits
  seeds.push(`MascotPreview${i}1111111111111111111111111`.slice(0, 44));
}

const W = COLS * (CELL + GAP) + GAP;
const H = ROWS * (CELL + GAP + LABEL) + GAP;
const tiles = [];
seeds.forEach((mint, i) => {
  const col = i % COLS, row = (i / COLS) | 0;
  const x = GAP + col * (CELL + GAP);
  const y = GAP + row * (CELL + GAP + LABEL);
  let inner, names;
  try {
    const out = renderBullSvg(deriveSeed(mint), 24);
    inner = out.svg.replace(/^<svg[^>]*>/, "").replace(/<\/svg>$/, "");
    names = out.names;
  } catch (e) {
    console.error(`render ${i} FAILED:`, e.message);
    process.exit(1);
  }
  tiles.push(
    `<svg x="${x}" y="${y}" width="${CELL}" height="${CELL}" viewBox="0 0 24 24">${inner}</svg>` +
    `<text x="${x}" y="${y + CELL + 12}" font-family="monospace" font-size="9" fill="#888">` +
    `${i}: ${names.body}/${names.eye}/${names.acc}</text>`,
  );
  console.log(`  cat ${i}: body=${names.body} ear-tint=${names.horn} eye=${names.eye} acc=${names.acc} eyewear=${names.eyewear} mouth=${names.mouth}`);
});

const sheet =
  `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" ` +
  `viewBox="0 0 ${W} ${H}">` +
  `<rect width="${W}" height="${H}" fill="#1a1a1f"/>` +
  tiles.join("") +
  `</svg>`;

const outPath = path.join(ROOT, "mascot-preview.svg");
fs.writeFileSync(outPath, sheet);
console.log(`\nWrote ${path.relative(ROOT, outPath)} — open it in a browser.`);

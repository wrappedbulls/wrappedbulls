#!/usr/bin/env node
// dedash.mjs — strip em-dashes / en-dashes / punctuation hyphens from
// the wrappedbulls-preview site copy. Hard rule per memory: no em,
// en, or punctuation hyphens in user-visible text.
//
// Leaves alone (intentional, not "dashes" in the punctuation sense):
//   - HTML attribute names (data-tile, etc.)
//   - CSS class names (section-head, mechanic-grid, etc.) — not visible
//   - Inline code in <code> blocks where technical strings need accuracy
//   - File paths, URL paths in href="..."
//   - Box-drawing characters (─, ═, etc.)

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIR  = path.join(ROOT, "wrappedbulls-preview");

// ---------- replacement rules ----------
// Order matters: longer / more-specific FIRST so they don't get
// pre-empted by shorter rules.
const RULES = [
  // ----- awkward colon -> comma / period fixups -----
  // (these target the post-first-pass state where em-dashes became
  // colons, replacing those colons with more natural punctuation)
  [/into a unique Bull NFT: and/g,                 "into a unique Bull NFT, and"],
  [/Bull NFT can unwrap it: you don't need/g,      "Bull NFT can unwrap it. You don't need"],
  [/the art is polished: but the token/g,          "the art is polished, but the token"],
  [/retroactively altered: even by us/g,           "retroactively altered, even by us"],
  [/verified: false<\/code> by design: wrap/g,     "verified: false</code> by design. Wrap"],
  [/NFT mint address: <strong>not<\/strong>/g,     "NFT mint address, <strong>not</strong>"],
  [/every marketplace transfer: sell the NFT/g,    "every marketplace transfer. Sell the NFT"],
  [/tokens: refresh after wallet connect/g,        "tokens. Refresh after wallet connect"],
  [/the locked tokens: and only via/g,             "the locked tokens, and only via"],
  [/no rebuild: so an emergency rollback/g,        "no rebuild. Emergency rollback"],
  [/unaffected: wrap\/unwrap continue/g,           "unaffected. Wrap and unwrap continue"],
  [/inherit that energy: but the trait system/g,   "inherit that energy. The trait system"],
  [/across 7 slots: body, horns, eyes, background, accessory, eyewear, mouth: and/g, "across 7 slots (body, horns, eyes, background, accessory, eyewear, mouth) and"],
  [/returns to the pool: next wrapper/g,           "returns to the pool. Next wrapper"],
  [/PDA\(\["vault", nft_mint\]\)  : follows the NFT/g, "PDA([\"vault\", nft_mint])  follows the NFT"],
  [/vault authority: the key trick/g,              "vault authority (the key trick)"],
  [/upgrade authority constraint: no one but the deployer/g, "upgrade authority constraint. No one but the deployer"],
  [/permanent delegate: the mint's extensions/g,   "permanent delegate. The mint's extensions"],
  [/open source \(~2,400 lines of pure JS\): no offchain dependency/g, "open source (~2,400 lines of pure JS) with no offchain dependency"],

  // ----- compound hyphens missed in first pass -----
  [/re-rolls/gi,            "rerolls"],
  [/re-roll/gi,             "reroll"],
  [/re-wrap/gi,             "rewrap"],
  [/brand-new/gi,           "brand new"],
  [/byte-for-byte/gi,       "byte for byte"],
  [/Off-chain/g,            "Offchain"],
  [/One-shot/g,             "One shot"],
  [/per-bull/gi,            "per bull"],
  [/per-NFT/g,              "per NFT"],
  [/non-existent/gi,        "nonexistent"],
  [/long-form/gi,           "longform"],
  [/cross-chain/gi,         "cross chain"],
  [/one-and-only/gi,        "one and only"],
  [/vault-follows-NFT/g,    "vault follows NFT"],
  [/trade-as-bag/g,         "trade as bag"],
  [/Two-sided/g,            "Two sided"],
  [/two-sided/g,            "two sided"],
  [/net-refunded/g,         "net refunded"],
  [/round-trip/g,           "round trip"],
  [/machine-readable/g,     "machine readable"],
  [/auto-refreshes/g,       "auto refreshes"],
  [/Front-run/g,            "Front run"],
  [/re-init/g,              "reinit"],
  [/one-shot init/g,        "one shot init"],
  [/Same-origin/g,          "Same origin"],
  [/JSON-RPC/g,             "JSON RPC"],
  [/rate-limits/gi,         "rate limits"],
  [/rate-limit/gi,          "rate limit"],
  [/zero-downtime/g,        "zero downtime"],
  [/health-check/gi,        "health check"],
  [/First-launch/g,         "First launch"],
  [/pre-simulate/gi,        "presimulate"],
  [/tier-1\b/g,             "tier 1"],
  [/Blue-green/g,           "Blue green"],

  // ----- page title format -----
  [/WRAPPEDBULLS — /g, "WRAPPEDBULLS // "],

  // ----- footer ($ wrappedbulls — built ...) -----
  [/\$ wrappedbulls —/g, "$ wrappedbulls:"],

  // ----- multi-word compounds (must precede single-word rules) -----
  [/1,000-piece/g,           "1,000 piece"],
  [/secondary-sale/g,        "secondary sale"],
  [/upgrade-authority/g,     "upgrade authority"],
  [/launch-state/g,          "launchstate"],
  [/cross-wallet/g,          "cross wallet"],
  [/single-source/g,         "single source"],
  [/first-ever/g,            "first ever"],
  [/follow-the-NFT/g,        "follow the NFT"],
  [/self-contained/g,        "self contained"],
  [/two-column/g,            "two column"],
  [/single-line/g,           "single line"],
  [/single-shot/g,           "single shot"],
  [/in-place/g,              "in place"],
  [/trait-roll/g,            "trait roll"],
  [/cold-backed/g,           "cold backed"],
  [/server-side/g,           "server side"],
  [/first-time/g,            "first time"],
  [/hard-capped/g,           "hard capped"],
  [/hard-cap/g,              "hard cap"],
  [/sub-second/g,            "subsecond"],
  [/vault-locked/g,          "vault locked"],
  [/top-1000/g,              "top 1000"],
  [/24-hour/g,               "24 hour"],
  [/anti-pattern/g,          "antipattern"],

  // ----- single-word compounds -----
  [/pixel-art/g,             "pixel art"],
  [/pre-launch/g,            "prelaunch"],
  [/first-launch/g,          "first launch"],
  [/real-time/g,             "realtime"],
  [/on-chain/g,              "onchain"],
  [/off-chain/g,             "offchain"],
  [/open-source/g,           "open source"],
  [/blue-green/g,            "blue green"],
  [/Token-2022/g,            "Token2022"],
  [/mainnet-beta/g,          "mainnet"],

  // ----- range notations -----
  [/\b1–1000\b/g,            "1 to 1000"],
  [/\b48–72h\b/g,            "48 to 72h"],

  // ----- em-dashes with surrounding spaces -> colon -----
  // (catches the bulk of explanatory uses)
  [/ — /g, ": "],

  // ----- any stray em-dash (no spaces) -> colon -----
  [/—/g, ":"],

  // ----- en-dash anywhere -> "to" with a space (range usage) -----
  [/–/g, " to "],
];

// ---------- collect files ----------
const files = fs.readdirSync(DIR)
  .filter((f) => f.endsWith(".html") || f.endsWith(".css"))
  .map((f) => path.join(DIR, f));

let totalReplacements = 0;
const perRule = new Map(RULES.map(([re]) => [re.source, 0]));

for (const file of files) {
  let src = fs.readFileSync(file, "utf8");
  const before = src;
  for (const [re, repl] of RULES) {
    let n = 0;
    src = src.replace(re, (m) => { n++; return repl; });
    perRule.set(re.source, perRule.get(re.source) + n);
    totalReplacements += n;
  }
  if (src !== before) {
    fs.writeFileSync(file, src);
    console.log(`  rewrote ${path.basename(file)}`);
  }
}

console.log(`\nTotal replacements: ${totalReplacements}`);
console.log("Top rules by hits:");
[...perRule.entries()]
  .filter(([, n]) => n > 0)
  .sort((a, b) => b[1] - a[1])
  .slice(0, 15)
  .forEach(([rule, n]) => console.log(`  ${String(n).padStart(3)}  ${rule}`));

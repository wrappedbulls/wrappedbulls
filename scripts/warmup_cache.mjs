#!/usr/bin/env node
// warmup_cache.mjs. Pre-populate the wrappedbulls API in-process cache
// for all 1000 tier endpoints before a marketplace crawl arrives.
//
// Why this exists:
//   The /api/metadata/[tier] and /api/render/[tier] handlers each take
//   a fresh chain RPC read on cache miss. A Magic Eden full-collection
//   crawl can request all 1000 tiers in seconds. Without warm cache,
//   that is 1000 RPC reads in a burst window, and our paid key takes a
//   measurable budget hit per crawl. Warmup hits each endpoint once at
//   our pace so the cache is already populated when ME shows up.
//
// Run from anywhere with curl-like network access. The script is
// network-bound, single connection, paced, and idempotent (safe to
// re-run any time).
//
// Usage:
//   node scripts/warmup_cache.mjs            # warm 1..1000
//   node scripts/warmup_cache.mjs 1 200      # warm a subset
//   ORIGIN=https://wrappedbulls.com node scripts/warmup_cache.mjs

import { setTimeout as sleep } from "node:timers/promises";

const ORIGIN = process.env.ORIGIN || "https://wrappedbulls.com";
const FROM = Number(process.argv[2] || 1);
const TO = Number(process.argv[3] || 1000);
const SLEEP_MS = Number(process.env.WARMUP_SLEEP_MS || 80);

async function hit(path) {
  const t0 = Date.now();
  try {
    const r = await fetch(`${ORIGIN}${path}`);
    return { status: r.status, ms: Date.now() - t0 };
  } catch (e) {
    return { status: 0, ms: Date.now() - t0, error: String(e) };
  }
}

const counts = { hit_2xx: 0, hit_404: 0, hit_5xx: 0, network_err: 0 };
const slow = [];

console.log(`Warming up ${ORIGIN}/api/metadata/[${FROM}..${TO}] + /api/render/[${FROM}..${TO}] at ${SLEEP_MS}ms pace`);

for (let tier = FROM; tier <= TO; tier++) {
  const [meta, render] = await Promise.all([
    hit(`/api/metadata/${tier}`),
    hit(`/api/render/${tier}`),
  ]);
  for (const r of [meta, render]) {
    if (r.status >= 200 && r.status < 300) counts.hit_2xx++;
    else if (r.status === 404) counts.hit_404++;
    else if (r.status >= 500) counts.hit_5xx++;
    else if (r.status === 0) counts.network_err++;
    if (r.ms > 1500) slow.push({ tier, ms: r.ms, status: r.status });
  }
  if (tier % 50 === 0) {
    console.log(`  tier ${tier}/${TO} ... cumulative: ${JSON.stringify(counts)}`);
  }
  if (SLEEP_MS > 0) await sleep(SLEEP_MS);
}

console.log("\nDone.");
console.log("final counts:", counts);
if (slow.length) {
  console.log(`slow requests (>1.5s): ${slow.length}`);
  console.log("samples:", slow.slice(0, 10));
} else {
  console.log("no slow requests (every fetch < 1.5s)");
}

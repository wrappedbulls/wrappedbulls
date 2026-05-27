# Launch Audit — readiness for "wrapping mint works 100% + website never goes down"

Generated 2026-05-27, after the Next.js API layer deploy.

## What is verified as working

### Program / contract
- `cargo test --manifest-path programs/wrappedbulls/Cargo.toml --lib` passes 10/10
- `declare_id!` macro value matches the generated program keypair pubkey
- Anchor.toml mainnet block points at the new program ID
- Program ID `F7qXskG73efUwbDo2B97tZgpPAqX7zHMApXbPUimcFdS` (regenerated 2026-05-26)
- Keypair file present at local `target/deploy/wrappedbulls-keypair.json` (gitignored, mode 600)

### Wallets (pubkeys recorded, separate seeds)
- Deployer: `9ZDrkF9a8bMHPeDhe3oiDDUC1616C3vtTGozBgMxhWtn` (upgrade authority)
- Treasury: `8HoMgnUbDRvPZN1M9jPxXPqE63tRbChGzvdEe3ethzTD` (royalty creator)

### Live site (https://wrappedbulls.com)
- ZeroSSL DV cert, auto renewal via Caddy
- 10 static pages all serve 200: /, /wrap, /unwrap, /gallery, /art, /thesis, /tech, /security, /about, /status
- Custom 404 page wired via Caddy handle_errors
- Favicon set (ico + 16 + 32 + 180 apple touch icon)
- robots.txt + sitemap.xml live
- OG / Twitter card meta tags on every page
- Mobile breakpoint at 600px wired
- UptimeRobot green
- HSTS, X-Content-Type-Options, Referrer-Policy, Permissions-Policy headers

### API layer (deployed 2026-05-27)
- `wrappedbulls-web.service` systemd unit on 127.0.0.1:3001, Restart=on-failure
- Caddy reverse_proxies /api/* to it, static still serves everything else
- `/api/health` returns 200 with full mainnet RPC status (slot reachable, ~100ms RTT)
- `/api/metadata/collection` returns valid Metaplex collection JSON with `Access-Control-Allow-Origin: *`
- `/api/metadata/[tier]` returns proper 404 with JSON error pre-launch (will return valid JSON post-wrap)
- `/api/render/[tier]` returns proper 404 pre-launch
- `/api/launch-state` returns `{"state":"pre-launch", "tokenMint":null}`
- mascot.png + banner.png deployed (referenced by collection metadata)

### Launch-day scripts
- `scripts/mainnet_initialize.ts` (with mainnet RPC guard)
- `scripts/mainnet_initialize_collection.ts` (idempotent)
- `scripts/mainnet_wrap_bull.ts` (prints Solscan URL for Phantom thread)

### External services
- Phantom domain review submitted; awaiting first warning evidence
- @wrappedbulls X profile live with bio + banner + pfp
- UptimeRobot keyword monitor on https://wrappedbulls.com
- GitHub repo published, README is the profile bio surface

---

## Critical work to ship before launch

### 1. End to end devnet rehearsal with current program ID + API stack
**Why:** the program ID was regenerated yesterday. The currently deployed API talks to mainnet. We have NOT validated end to end with the new ID against a live program. A devnet rehearsal of `deploy → initialize → initialize_collection → wrap_bull → fetch /api/metadata/1 → fetch /api/render/1` proves the full stack before committing mainnet SOL.

**Action:** deploy program to devnet using the new keypair, point the API at devnet temporarily, run a wrap, confirm both endpoints return correct content with the right image and trait values.

### 2. Upgrade the API server side RPC to Helius or Triton
**Why:** the systemd unit currently points at `https://api.mainnet-beta.solana.com`. When Magic Eden and Tensor crawl all 1000 tier endpoints simultaneously, the public RPC will rate limit (429s) and the API will start returning errors. Result: NFTs with broken metadata on marketplaces.

**Action:** sign up for a Helius (or Triton) mainnet API key. Update the systemd Environment line for `SOLANA_RPC_URL` on the VPS to the paid endpoint. Reload the service.

### 3. RPC failover
**Why:** single point of failure. If the paid RPC has an outage, every metadata + render request returns 500 until the upstream comes back. Marketplaces cache the broken response.

**Action:** add a comma separated fallback in `lib/chain.ts` (try primary, then a public fallback), or run a local caching RPC proxy. Cheapest: comma-list with try/catch.

### 4. Marketplace crawl simulation
**Why:** we have not load tested the API under marketplace style burst traffic.

**Action:** once #1 + #2 are done, run a script that fetches `/api/metadata/{1..1000}` and `/api/render/{1..1000}` in parallel. Confirm zero 5xx, all 200 with correct shape. This catches RPC rate limit issues before marketplaces do.

### 5. Anchor program devnet integration tests with new program ID
**Why:** the cargo unit tests pass with the new ID, but the full Anchor integration suite (`anchor test`) has not been re run since the regeneration. Adversarial tests, vault security tests, MCC verify chain are all in there.

**Action:** local validator or surfpool: `anchor test`. Must be 13/13 green.

### 6. Solana CLI on the deploy machine
**Why:** without solana CLI, the `solana program deploy` command in Phase 2 of LAUNCH_CHECKLIST cannot run.

**Action:** decide between (a) install solana CLI locally on Windows via the bundled installer, or (b) deploy from the VPS where the CLI is already used by devnet validation. If VPS: scp the program keypair to VPS for the deploy.

---

## Critical work for "website never goes down"

### 7. Blue green deploy for wrappedbulls-web
**Why:** currently a single `wrappedbulls-web.service` instance on :3001. If it crashes, systemd takes ~3s to restart. During that window, /api/* returns 502. For a marketplace crawler this looks like a broken collection.

**Action:** add `wrappedbulls-web-green.service` on :3002 from a SEPARATE checkout. Caddy `handle /api/* { reverse_proxy 127.0.0.1:3001 127.0.0.1:3002 { lb_policy first; health_uri /api/health } }`. Deploys swap colors atomically.

### 8. Enable DigitalOcean droplet snapshots
**Why:** if the droplet dies (hardware failure, region outage, accidental delete), recovery from scratch is 1 to 2 hours. With snapshots: 10 to 20 minutes.

**Action:** in the DigitalOcean panel, enable weekly snapshots on the wrappedbulls droplet. Cost: ~$1.20/mo.

### 9. Process watchdog beyond systemd
**Why:** systemd restarts the service on crash, but not on hang. A hung Node process accepting connections but not responding can produce stalled requests indefinitely.

**Action:** add a small systemd timer that runs `curl -fs --max-time 5 https://wrappedbulls.com/api/health || systemctl restart wrappedbulls-web` every 60s. Or use systemd `Watchdog=` with sd_notify.

### 10. Rate limit /api/rpc to prevent budget exhaustion
**Why:** /api/rpc proxies browser RPC calls to the paid Helius endpoint server side. Without rate limiting, a single malicious user can drain the Helius credit budget in hours. Result: API outage when budget hits zero.

**Action:** add Caddy per-IP rate limit on `/api/rpc` (e.g., 60 requests per minute per IP). The existing Next.js handler may already have one; if not, add it client side first.

### 11. CDN in front (optional but valuable)
**Why:** all traffic hits one VPS in one DigitalOcean region. A network event there takes the site offline.

**Action:** put Cloudflare in front of wrappedbulls.com (free tier). Caching static assets at the edge, plus DDoS protection.

---

## Medium priority (post launch is OK)

### 12. Wrap UI for end users
**Currently:** the static prelaunch site has a `/wrap` page that shows an overview, no wallet connect.
**After launch:** users with $WBULL want to wrap. They cannot do it from the site. They would need to use a CLI script or wait.
**Action:** either (a) add `/wrap` and `/unwrap` to the Caddy reverse_proxy block so Next.js handles them, or (b) finish the per-page Next.js restyle and route everything via Next.js.

### 13. Per page Next.js restyle to match terminal aesthetic
**Currently:** foundational palette + JetBrains Mono is done, but the layout structures are pre-restyle.
**Action:** restyle each page to match `wrappedbulls-preview/*.html` patterns: 2px borders, ASCII frames, kvblock terminal style. Multi session.

### 14. Stop cryptobulls-web on port 3000
**Currently:** the cryptobulls-web service still runs on the VPS (DNS detached, no traffic, but consumes memory).
**Action:** `systemctl stop cryptobulls-web && systemctl disable cryptobulls-web` and remove from Caddyfile.

### 15. Backup script for /opt/wrappedbulls-web
**Action:** daily tarball of the deploy dir to an offsite location.

---

## Hard rules (already enforced; document them so they stay enforced)

- The live website never goes down. All fixes deploy to standby color and atomically swap. See [`DEPLOY.md`](DEPLOY.md).
- Treasury and deployer wallets stay separate keypairs.
- Never paste deployer / treasury / program keypair seeds into any tool, website, Discord, or terminal session that gets logged.
- After Phase 3 of LAUNCH_CHECKLIST, never reference any prior project. The narrative is that WrappedBulls invented this technology.

---

## Launch readiness verdict

**Today, with current state:** the program is ready to deploy. The API layer is live. Static site is up. Wallets are generated. Phantom is in queue.

**The minimum sequence to "100% wrapping mint works at launch":**
1. Add Helius (or other paid) RPC URL to systemd Environment for wrappedbulls-web (#2)
2. Run end to end devnet rehearsal (#1 + #5)
3. Marketplace crawl simulation (#4)

**The minimum sequence to "website never goes down":**
1. Enable DO snapshots (#8)
2. Add blue green for wrappedbulls-web (#7)
3. Add the watchdog (#9)

**Decision needed from you:** are #7 + #9 (blue green + watchdog) launch blockers, or acceptable to ship without them and add post launch? They reduce the small but real risk of momentary 502s.

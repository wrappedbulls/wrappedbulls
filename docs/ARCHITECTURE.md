# Architecture. WrappedBulls baseline (relaunch source)

Technical reference for the on-chain program + web stack, as they exist
in the baseline at commit `b9f508d` + uncommitted Token-2022 port +
`/api/rpc` proxy. This is the design the next pump.fun-style project
will fork from.

Internal reference. NOT for public repo.

## 1. On-chain program

### 1.1 Program identity

- Anchor program name: `wrappedbulls` (rename per project)
- Mainnet program ID: regenerated via the clone script.
- Upgrade authority: deployer keypair on mainnet. The deployer MUST be a
  separate wallet from the royalty treasury wallet. Deployer pays gas;
  treasury receives royalties; conflating them is a known footgun.
- Loader: BPFLoaderUpgradeable

### 1.2 PDAs

| Seeds                                 | Purpose                                   | Lifetime           |
|---------------------------------------|-------------------------------------------|--------------------|
| `["bank"]`                            | Singleton global state (BullBank account) | One-shot, forever  |
| `["bull", tier_index.to_le_bytes()]`  | Per-bull metadata (BullAsset account)     | Created on wrap, closed on unwrap |
| `["nft_mint", total_wrapped.to_le_bytes()]` | NFT mint address (deterministic)    | Created on wrap, never reused |
| `["vault", nft_mint.toBuffer()]`      | Vault authority (PDA owns the token vault) | Permanent, tied to NFT |
| `["collection_authority"]`            | MCC update authority for the collection   | One-shot, set on init_collection |

Key insight: **`vault` is PDA-of-NFT, not PDA-of-wrapper**. The vault
follows the NFT through every transfer. Anyone who later holds the NFT
can unwrap it; they don't need to be the original wrapper. This is what
makes the wrap mechanic ERC404-style hybrid rather than per-user.

### 1.3 BullBank state (singleton)

[`programs/wrappedbulls/src/state.rs`](../programs/wrappedbulls/src/state.rs)
fields:

- `token_mint: Pubkey`. $TOKEN mint, immutable after init
- `total_wrapped: u64` / `total_unwrapped: u64`. lifetime counters
- `in_circulation: u16`. derived (`total_wrapped - total_unwrapped`)
- `next_tier: u16`. lowest never-wrapped tier (starts at 1)
- `free_tiers: Vec<u16>`. stack of unwrapped tiers awaiting reuse
- `authority: Pubkey`. admin authority
- `bump: u8`. PDA bump
- `collection_mint: Pubkey`. MCC NFT mint (Pubkey::default() until
  `initialize_collection`)
- `reserved: [u8; 32]`. slot for future migration

Tier allocation order: `pop free_tiers` first (LIFO), fall back to
`next_tier++`. Unit tests in [`state.rs`] cover the full lifecycle
(MAX_BULLS = 1000, exhaustion, reuse-after-unwrap).

### 1.4 Token-2022 / classic SPL split

Both the program and the client side accept either token program for
the **$TOKEN side**, while the NFT side is always classic SPL.

Program: every `wrap_bull` / `unwrap_bull` account struct uses:

```rust
use anchor_spl::token::{Token, Mint, TokenAccount, MintTo};
use anchor_spl::token_interface::{
    self, Mint as MintIf, TokenAccount as TokenAccountIf,
    TokenInterface, TransferChecked,
};

#[account(mut)]
pub payer_token_account: Box<InterfaceAccount<'info, TokenAccountIf>>,

pub token_mint: Box<InterfaceAccount<'info, MintIf>>,

pub bulls_token_program: Interface<'info, TokenInterface>,  // either SPL
pub token_program: Program<'info, Token>,                    // NFT side
```

CPI: `token_interface::transfer_checked(cpi_ctx, TOKENS_PER_BULL,
decimals)`. verifies decimals on-chain (`transfer` is deprecated).

Client side ([`web/lib/program.ts`](../web/lib/program.ts)):

```typescript
import { TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
const BULLS_TOKEN_PROGRAM = TOKEN_2022_PROGRAM_ID;
const vault = getAssociatedTokenAddressSync(
  tokenMint, vaultAuthority, true, BULLS_TOKEN_PROGRAM
);
// In .accounts({ bullsTokenProgram: BULLS_TOKEN_PROGRAM, ... })
```

**For the next project**: if the new token is also Token-2022 (pump.fun
default), nothing changes. If it's classic SPL, swap
`TOKEN_2022_PROGRAM_ID` → `TOKEN_PROGRAM_ID` in one place. The program
accepts both.

### 1.5 Vault-follows-NFT mechanic

```
PDA(["vault", nft_mint]) ─── owns ───▶ vault TokenAccount (1M $TOKEN locked)
                                        ▲
                                        │ unwrap signs as this PDA
                                        │ via this program
                                        │
NFT holder ─── owns ───▶ NFT ATA ─── unwrap requires NFT in caller ATA
```

The vault PDA's authority is derived from `nft_mint`, not the
wrapper's wallet. The program's `unwrap_bull` instruction verifies the
caller holds the NFT (amount == 1 in their ATA), then signs the
`transfer_checked` from vault → caller_token_account as the vault PDA
authority. This is what enables anyone holding the NFT to unwrap it,
not just the original wrapper.

### 1.6 Metaplex MCC pattern

Every wrap CPIs into three Metaplex instructions in this order:

1. `CreateMetadataAccountV3`. creates the NFT metadata at
   `PDA(["metadata", token_metadata_program, nft_mint])`. URI is
   `https://<domain>/api/metadata/<tier>`. Creator =
   `[ROYALTY_TREASURY (unverified)]`, `seller_fee_basis_points = 500`.
2. `CreateMasterEditionV3`. caps supply at 1 (unique NFT) at
   `PDA(["metadata", token_metadata_program, nft_mint, "edition"])`.
3. `VerifySizedCollectionItem`. links this NFT to the
   `collection_mint` set during `initialize_collection`. The
   collection authority signs via PDA(`["collection_authority"]`).

Marketplaces (Magic Eden, Tensor, Phantom Collectibles) read the
verified MCC link and group the NFTs into a collection automatically.
No per-marketplace pre-submission required for the collection to
appear. they auto-index on the chain event.

### 1.7 Royalty

- Hardcoded in [`programs/wrappedbulls/src/instructions/wrap_bull.rs:34`](../programs/wrappedbulls/src/instructions/wrap_bull.rs#L34):
  `ROYALTY_TREASURY = FRZJpAtPcWJBRFziY6dZkBHMBSWVi12hXAtAJEHawTwQ`,
  `ROYALTY_BPS = 500`
- Written into every NFT's metadata `creators[0]` and
  `seller_fee_basis_points`
- `creators[0].verified = false` is intentional: wrap is
  permissionless, so the treasury cannot sign every mint to
  self-verify. Marketplaces still honor the royalty.
- For the next project: parameterize via `config/launch.toml` → build.rs
  codegen (P2.1, P2.2). The on-chain constant becomes
  project-specific without manual edits.

### 1.8 Singleton init guard

[`programs/wrappedbulls/src/instructions/initialize.rs`](../programs/wrappedbulls/src/instructions/initialize.rs)
double-locks `initialize`:

```rust
#[account(constraint = program.programdata_address()? == Some(program_data.key()))]
pub program: Program<'info, crate::program::Wrappedbulls>,
#[account(constraint = program_data.upgrade_authority_address == Some(authority.key()))]
pub program_data: Account<'info, ProgramData>,
```

→ Only the program's upgrade authority can run `initialize`. This is
the defense against an attacker front-running the singleton bank PDA
init with their own params right after deploy.

`init_if_needed` was deliberately removed as a hardening pass. the
bank PDA cannot be re-initialized, period. The cost is that param
errors at init time become permanent (mitigated by `mainnet_sim_gate.sh`,
P4.2).

## 2. Web stack

Next.js 14, App Router, Node runtime, deployed as a standalone build
on a single VPS behind Caddy.

### 2.1 `/api/rpc` proxy. critical infrastructure

[`web/app/api/rpc/route.ts`](../web/app/api/rpc/route.ts)

Browser → `https://<domain>/api/rpc` → server-side `fetch()` →
Helius. Reasons (all painful lessons):

- `api.mainnet-beta.solana.com` 403s many browser IPs/regions
- Same-origin POST bypasses all CORS and IP-block issues
- Paid Helius key stays in `SOLANA_RPC_URL` server env, never in
  `NEXT_PUBLIC_*`, never in client bundle

The Solana wallet adapter is configured with
`endpoint = "/api/rpc"` (relative URL) so it routes through the proxy.

**Hardening planned (P3.4):** rate limit per IP, JSON-RPC method
allowlist, request-count metrics, distinguish RPC-down from
upstream-rate-limited in the response.

### 2.2 `/api/render/[tier]`. NFT image rendering

Server-rendered deterministic SVG → PNG, seeded from `nft_mint`
pubkey. Cached. Used by both marketplace metadata and the in-app
gallery.

### 2.3 `/api/metadata/[tier]`. NFT metadata JSON

Returned at the URI written into Metaplex metadata at wrap time:

```json
{
  "name": "WrappedBulls #N",
  "symbol": "BULL",
  "image": "https://<domain>/api/render/N",
  "attributes": [...],
  "properties": {...},
  "seller_fee_basis_points": 500,
  "creators": [{ "address": "<treasury>", "share": 100 }]
}
```

### 2.4 Launch-state UI gating (current; will change in P3.1)

Current state: `const PRE_LAUNCH = true|false` is hardcoded in
[`web/app/wrap/page.tsx`](../web/app/wrap/page.tsx) and
[`web/app/unwrap/page.tsx`](../web/app/unwrap/page.tsx). Toggle =
rebuild. This is the build time state antipattern we are replacing.

Target: `/api/launch-state` reads `/var/lib/<project>/state.json`. UI
fetches on every page load. State flip = single file write. Zero
rebuild.

### 2.5 Wallet integration

`@solana/wallet-adapter-react` + a custom `WalletProviders.tsx`. The
adapter is initialized with `endpoint = "/api/rpc"` (the proxy) and
the standard set of mobile + browser wallets. Wallet UI is on every
page header.

### 2.6 Build + runtime

- Next.js standalone build (`output: "standalone"`)
- Runs under systemd as `wrappedbulls-web.service`
- Caddy reverse proxy fronts it with TLS
- `NEXT_PUBLIC_SOLANA_RPC_URL` is **not** set (we proxy through
  `/api/rpc`). `SOLANA_RPC_URL` (no `NEXT_PUBLIC` prefix) is set in
  the systemd unit. Server-only.
- `next.config.js` has `typescript.ignoreBuildErrors: true` and
  `eslint.ignoreDuringBuilds: true`. set during the launch crisis
  to allow rapid iteration through React 19 / wallet-adapter type
  mismatches. **For the next project, fix the type errors and remove
  these escape hatches.**

## 3. Anchor tests

[`tests/wrappedbulls.ts`](../tests/wrappedbulls.ts). 13/13 passing on devnet.
Coverage:

- Initialize bank + initialize_collection (with upgrade-authority gate)
- Wrap → state changes (counter bumps, tier allocation)
- Unwrap → state changes (counter, free_tiers push)
- Cross-wallet unwrap (vault follows NFT)
- Tier reuse after unwrap (fresh `nft_mint` each time)
- 3 adversarial cases (wrong NFT, wrong vault, double-unwrap)
- Royalty assertion (treasury + 500 BPS in metadata)
- `UnauthorizedInitializer` front-run guard

**Gap for next project (P5.3):** tests use a vanilla classic SPL mock
mint. The next harness must construct a Token-2022 mint with
`metadataPointer` + `tokenMetadata` extensions, mirroring pump.fun's
exact mint shape. The `initialize_mint2` interface call differs
between SPL variants.

## 4. Off-chain renderer

Deterministic SVG generation seeded by `nft_mint` pubkey. Same input
→ same output → the visual is permanent and discoverable from the
NFT mint alone (no on-chain image storage, no IPFS, no off-chain
mutable state).

Trait/accessory data lives in JS objects today. For the next project,
externalize to `config/art.json` (P2.5) so the art changes
project-by-project without code edits.

## 5. Deployment topology

```
              ┌──── DNS A record ────┐
   browser ───┤  wrappedbulls.com     │
              └──── 443 ──┬──────────┘
                          │
                       ┌──▼──┐
                       │Caddy│ TLS terminator + reverse proxy
                       └──┬──┘
                          │
                  ┌───────▼────────┐
                  │ Next.js (3000) │ systemd: wrappedbulls-web.service
                  │ standalone     │ SOLANA_RPC_URL env (Helius paid key)
                  └───────┬────────┘
                          │
              ┌───────────▼────────────┐
              │ Helius mainnet RPC     │  (server-side only)
              └────────────────────────┘
```

**Single-instance** today. For the next project, run two instances
(blue-green) with Caddy doing an atomic `import` file swap. see
P3.2. Zero-downtime rebuilds forever.

## 6. What transfers vs what gets rebuilt for the next project

| Component                                | Transfer as-is | Reskin / parameterize | Rebuild |
|------------------------------------------|----------------|----------------------|---------|
| Program PDA layout (bank, bull_asset, vault) | ✓              |                      |         |
| Tier accounting (pop/push, free_tiers)   | ✓              |                      |         |
| Token-2022 InterfaceAccount split        | ✓              |                      |         |
| Vault-follows-NFT mechanic               | ✓              |                      |         |
| MCC + verify_sized_collection pattern    | ✓              |                      |         |
| Upgrade-authority init guard             | ✓              |                      |         |
| Royalty treasury constant                |                | ✓ (config/launch.toml) |       |
| Royalty BPS constant                     |                | ✓ (config/launch.toml) |       |
| MAX_BULLS / TOKENS_PER_BULL              |                | ✓ (config/launch.toml) |       |
| Metadata URI base                        |                | ✓ (config/launch.toml) |       |
| Program ID (declare_id! + Anchor.toml)   |                | ✓ (new keypair)       |       |
| `/api/rpc` proxy                         | ✓              |                      |         |
| `/api/render`, `/api/metadata`           | ✓ (logic), ✓ (brand reskin)         |       |
| Wallet adapter wiring                    | ✓              |                      |         |
| Build-time `PRE_LAUNCH` flag             |                |                      | ✓ → runtime `/api/launch-state` |
| Anchor tests w/ classic SPL mock         |                |                      | ✓ → Token-2022 w/ extensions |
| `next.config.js` ignoreBuildErrors       |                |                      | ✓ → fix and remove |
| Single-instance systemd                  |                |                      | ✓ → blue-green |
| Brand strings (WrappedBulls/$WBULL/etc)   |                | ✓ (brand.json)       |         |

See [`LAUNCH_RUNBOOK.md`](LAUNCH_RUNBOOK.md) for the work items behind
each "rebuild" entry.

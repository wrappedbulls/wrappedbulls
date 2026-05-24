# Security Policy

WrappedBulls is a Solana Anchor program that custodies real value: each wrapped
bull NFT is backed by a vault PDA holding 1,000,000 $WBULL. We take the
correctness of the wrap / unwrap flow seriously, and we want to make it easy for
researchers to reach us.

## Reporting a vulnerability

**Preferred channel:** [GitHub Security Advisories](https://github.com/wrappedbulls/wrappedbulls/security/advisories/new).
This gives us a private discussion thread, the ability to coordinate a patch,
and a CVE-style record when the issue is resolved.

**Fallback:** open a `[security]`-prefixed DM to [@wrappedbulls](https://x.com/wrappedbulls) on X
with a minimal description and we will move the conversation to a private
channel.

Please do **not** open a public GitHub issue or post to social media about a
vulnerability before we have had a chance to respond. Responsible disclosure
protects token holders.

## Response timeline

We are a small team, but every report gets eyes on it:

| Stage | Target |
|---|---|
| Acknowledgement | within **48 hours** |
| Initial severity assessment | within **7 days** |
| Patch for critical / high-severity issues | within **14 days** |
| Patch for medium / low-severity issues | within **30 days** |
| Public disclosure | coordinated; typically after deploy + observation window |

If we miss a target, we will write to you with an updated estimate.

## Scope

**In scope** — issues in code we own and deploy:

- `programs/wrappedbulls/` — the on-chain Anchor program (the canonical source of
  truth for everything that holds value)
- `web/` — the Next.js site at [wrappedbulls.com](https://wrappedbulls.com), in
  particular `web/lib/program.ts` (wrap / unwrap transaction construction)
- `cranker/` — the off-chain indexer + metadata + render server. The cranker
  is read-only and cannot move funds, but bugs that mislead holders about
  ownership state are still in scope.

**Out of scope** — components owned by others. If you find a bug in these,
please report it to the upstream maintainer:

- pump.fun (token launches, bonding curve, PumpSwap graduation)
- PumpSwap (AMM)
- Metaplex Token Metadata program (CPI dependency)
- Solana runtime + SPL Token program
- Phantom / Solflare / Backpack / other wallets — including the "Request
  blocked" warning currently shown by Phantom on wrappedbulls.com. That is a
  Phantom domain-reputation issue with their trust & safety team, not a
  vulnerability in our code; see [`docs/LAUNCH_CHECKLIST.md`](docs/LAUNCH_CHECKLIST.md)
  for the current state.

**Out of scope — please do not report:**

- Best-practice deviations that do not have a concrete exploit
- Missing CSP / HTTP headers on the website that are not exploitable
- The fact that the program has not had a formal third-party audit (we
  acknowledge this below — see *Audit status*)
- Theoretical issues without a proof-of-concept

## Critical security invariants

These are the guarantees the program is built to provide. The list is what an
attacker should NOT be able to do. If you find a way to violate any of them, it
is a critical-severity vulnerability:

1. **Only the NFT holder can drain a vault.** A wallet that does not currently
   own the Bull NFT cannot call `unwrap_bull` successfully against that bull's
   vault. Enforced by triple-check in
   [`programs/wrappedbulls/src/instructions/unwrap_bull.rs`](programs/wrappedbulls/src/instructions/unwrap_bull.rs)
   on `payer_nft_account` (`associated_token::mint = nft_mint`,
   `associated_token::authority = payer`, `constraint = amount == 1 @ NotNftHolder`).
   Proven empirically by [`tests/wrappedbulls.ts`](tests/wrappedbulls.ts) test
   `SECURITY: non-holder cannot unwrap (NotNftHolder)`.

2. **The vault and the NFT are bound by cryptography, not by lookup tables.**
   The vault's authority is the PDA derived from `["vault", nft_mint]`. The
   NFT mint itself is a PDA derived from `["nft_mint", bank.total_wrapped]`
   at wrap time. There is no off-chain table mapping NFTs to vaults that
   could be tampered with. The link survives any transfer of the NFT
   through Magic Eden, Tensor, direct transfer, or escrow.
   Proven by `tests/wrappedbulls.ts` test `vault follows NFT: alice transfers NFT
   to bob, bob unwraps and gets the tokens`.

3. **The on-chain record and the actual NFT are inseparable.** Passing a
   `bull_asset` PDA for tier *X* together with a different tier's `nft_mint`
   reverts with `NftMintMismatch`. An attacker cannot decouple the on-chain
   tier record from the live NFT to redirect a vault drain.
   Proven by `tests/wrappedbulls.ts` test `SECURITY: cannot unwrap with mismatched
   nft_mint (NftMintMismatch)`.

4. **A wrap must lock the bank's locked $TOKEN, not a different SPL token.**
   The `payer_token_account.mint == bank.token_mint` constraint at
   [`wrap_bull.rs`](programs/wrappedbulls/src/instructions/wrap_bull.rs) rejects
   any attempt to wrap with a worthless attacker-minted token. Without this
   check, an attacker could mint free Bull NFTs by locking nothing.
   Proven by `tests/wrappedbulls.ts` test `SECURITY: cannot wrap with a different
   SPL mint (WrongMint)`.

5. **A wrap requires the caller actually hold 1,000,000 $WBULL.**
   Enforced by `require!(balance >= TOKENS_PER_BULL, InsufficientBalance)` in
   `wrap_bull.rs`. Proven by `tests/wrappedbulls.ts` test
   `wrap_bull fails when caller has insufficient balance`.

6. **No admin path drains vaults.** The program has four public instructions:
   `initialize` (one-time, locks the $TOKEN mint), `initialize_collection`
   (one-time, sets up the MCC collection), `wrap_bull` (transfers tokens
   INTO a vault), `unwrap_bull` (transfers OUT, holder-gated only). There is
   no `set_authority`, no admin recovery path, no upgrade authority that can
   touch vault tokens. Verified by exhaustive read of
   [`programs/wrappedbulls/src/lib.rs`](programs/wrappedbulls/src/lib.rs).

7. **Vault PDAs are not reusable across wraps.** Each new wrap derives a
   unique `nft_mint` PDA from the pre-increment value of `bank.total_wrapped`.
   Closed vaults cannot be re-opened at the same address — the `init`
   constraint on the vault ATA rejects reinit. Tier reuse mints a fresh NFT
   with a different mint address, which is what makes the visual re-roll
   honest (different mint → different sha256 seed → different art).

8. **The 1,000-bull cap holds.** `bank.in_circulation` is incremented on
   every wrap and bounded by `MAX_BULLS = 1000`. With 1B $WBULL total supply
   and 1M locked per wrap, this cap is also enforced by the token math
   itself: only 1,000 simultaneous wraps are economically possible.

## Audit status

**The Anchor program has not had a formal third-party security audit.**

What we have done:

- **12-test Anchor mocha suite** in [`tests/wrappedbulls.ts`](tests/wrappedbulls.ts),
  covering all eight invariants above plus tier reuse, idempotency, and
  collection verification. All 12 currently pass.
- **Internal static review** of every instruction against the OWASP-style
  Solana attack patterns (account substitution, missing signer checks,
  unsafe `UncheckedAccount` usage, reinit-after-close, integer overflow,
  arithmetic on user-supplied indices).
- **Single-signer transaction model**: `nft_mint` is a PDA derived from
  `["nft_mint", bank.total_wrapped]`, so the only signer required on
  `wrap_bull` / `unwrap_bull` is the wallet (`payer`). This removes a class
  of multi-signer attacks and aligns with
  [Phantom's transaction-warning mitigations](https://docs.phantom.com/developer-powertools/domain-and-transaction-warnings).
- **Open source.** The full program, web client, indexer, and tests are in
  this repository. Anyone can verify the deployed bytecode by building from
  source (`anchor build`) and comparing the on-chain hash.

If you (or your firm) are interested in performing a formal audit, please
get in touch via the channels at the top of this document.

## Bounty

We do not currently have a formal bug bounty program. For valid reports of
critical or high-severity issues, we will:

1. Credit you in the patch commit (with your preferred handle / link).
2. Credit you in the public disclosure / advisory.
3. Add you to a "thanks" section in the README.

If you would like a payment-based bounty as well, mention it in your first
message; we will discuss case-by-case based on the severity, impact, and our
treasury at the time.

## What is intentionally not a vulnerability

Common reports we will close as informational:

- **Phantom "Request blocked" / "transaction reverted during simulation"
  warnings** — these are Phantom-side domain-reputation flags awaiting
  Phantom's review of wrappedbulls.com. The transactions themselves are
  provably correct (single signer, server-side simulation passes, all four
  mitigations from Phantom's docs implemented). See `docs/LAUNCH_CHECKLIST.md`.
- **Visual duplicates of bulls beyond ~wrap #2,000** — by birthday-paradox
  math, the deterministic visual generator will eventually pick the same
  trait combination twice. This is expected and disclosed on
  [wrappedbulls.com/art](https://wrappedbulls.com/art). Each NFT remains
  uniquely identified by its on-chain mint pubkey regardless.
- **The fact that the cranker can be DoSed by spam HTTP requests** — the
  cranker is a read-only convenience server. Take it down and the chain
  state, vaults, and NFT ownership all stay intact. Bulls remain redeemable
  through any Solana RPC + the open-source renderer.
- **MEV / sandwich attacks on PumpSwap trades** — that is upstream of our
  layer. Wrapping is a single-tx interaction with our program, not a swap.

## Updating this policy

This document is the source of truth. If we change scope, response times, or
the disclosure channel, we will update this file and call the change out in
the next release.

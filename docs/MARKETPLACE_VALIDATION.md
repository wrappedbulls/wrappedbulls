> # ⚠️ STALE ROYALTY CLAIM. correction
> This doc states `seller_fee_basis_points=0` / "no royalty path". That is
> **wrong as of 2026-05-15**: royalty is **5% (500 bps)**, creator
> `8HoMgnUbDRvPZN1M9jPxXPqE63tRbChGzvdEe3ethzTD`, baked into `wrap_bull.rs`.
> Treat any "0%" statement below as superseded. Authoritative:
> [`LAUNCH_RUNBOOK.md`](LAUNCH_RUNBOOK.md).

# Marketplace flow validation

## Status: validated at protocol level on devnet (Task 8); UI test deferred to mainnet rehearsal (Task 10)

## What we tested

Task 8 (cross-wallet unwrap) proved the central property: **after the NFT moves to a different holder, that holder can unwrap and the vault tokens follow**.

Concrete devnet trace:

1. Wallet A wrapped WrappedBulls #1 → 1M $WBULL into vault `8u9k8tz2…rpcq`, NFT mint `pz9fuh2Q…brMP` to Wallet A
2. Wallet A transferred the NFT to Wallet B via raw SPL transfer
3. Wallet B opened wrappedbulls.com/unwrap, signed the unwrap tx
4. Post-state: Wallet B got exactly 1,000,000 $WBULL, vault closed, NFT burned, BullAsset closed, tier 1 returned to free_tiers
5. Wallet A balance unchanged at 998M $WBULL

This is **structurally identical to a marketplace sale**, where:

- Tensor / Magic Eden / generic SPL transfer all end with the same post-state: NFT in buyer's ATA, seller's ATA empty
- The intermediate escrow / delegate step doesn't touch the vault PDA
- The vault authority is `PDA(["vault", nft_mint])`. a pure function of the mint pubkey, immutable across all transfers

## Why we skipped Tensor devnet

Tensor's devnet UI has well-known issues:

- Network toggle is missing most days
- Helius DAS indexer (which Tensor uses) lags hours-to-days on devnet
- Escrow contracts are sometimes not deployed on devnet, or deployed at different addresses than mainnet

These are Tensor-side issues, not WrappedBulls issues. There is no devnet-only metadata format we'd be testing against. what works on mainnet works.

## What gets validated on mainnet rehearsal (Task 10) and launch day

Once a real mainnet bull is wrapped, we list it on Tensor mainnet for a small SOL price (e.g. 0.05 SOL), buy from a second wallet, and verify the buyer can unwrap. This catches:

- Tensor-specific transfer-fee / royalty edge cases (we set seller_fee_basis_points=0 so this should be a no-op)
- Magic Eden secondary list (test the second marketplace too)
- Tensor's indexer correctly displaying our Metaplex metadata + image

If any of these surface a bug, the program is still upgradeable for the 30-day soak window per [AUTHORITY.md](./AUTHORITY.md).

## Why this is sufficient pre-launch

The risk surface area for marketplace flow has two components:

| Risk | How we covered it |
|---|---|
| Marketplace breaks vault binding | Task 8 proves the binding is mint-derived and indifferent to escrow steps |
| Marketplace can't list / display the NFT | Standard Metaplex Token Metadata + master edition format = guaranteed listable. Same format every successful Solana NFT collection uses |
| Marketplace fee / royalty interferes with unwrap | Our NFTs have `seller_fee_basis_points=0`. There's no royalty path to interfere with. Even if there were, royalty is paid in SOL on the buy side; doesn't touch the vault token |

The remaining unknown. "what does Tensor's UI actually look like with a wrapped Bull listed". is a UX question, not a protocol question. We'll validate it on mainnet day with a founder bull listing.

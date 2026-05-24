# Mainnet program proof. WrappedBulls / $WBULL (Token-2022)

Captured 2026-05-20. Authoritative artifact of the mainnet program's
correctness for the **wrap_bull** flow, used to justify skipping a real
mainnet wrap test prior to relaunch under a new token name.

## Status

- **Program ID:** `A2tUttiBhWnPUYzqsT6BVf1L4qEMHxw4UibmhTcZbnNk`
- **Mainnet upgrade slot:** 421046372 (Token-2022 port live)
- **Program account data length:** 431,696 bytes
- **Upgrade authority:** `GMrJpP7SaUkfyizsB3b8GeKWgDiqac3g5EaMGnMtkXCj`
  (bulls-box deployer)
- **$WBULL mint:** `XfY2XBcgY8QSLtGHnmwYrMT4CQt5mVMj55tXRWHpump`
  (Token-2022 program, 6 decimals)
- **Bank PDA:** `seeds = ["bank"]`, singleton, initialized
- **Anchor tests:** 13/13 passing on devnet, including 3 adversarial cases,
  vault-follows-NFT cross-wallet unwrap, and UnauthorizedInitializer
  front-run guard

## Why we did NOT execute a real mainnet wrap

The relaunch plan requires preserving the "first ever wrap" narrative
under a new token name. Minting WrappedBulls #1 against the dead
$WBULL contaminates that narrative permanently: the NFT would be
on-chain forever under the dead-token program. A high-fidelity
simulation against live mainnet state was used as the proof artifact
instead.

## Simulation harness

[`scripts/devnet_simulate_wrap.ts`](../scripts/devnet_simulate_wrap.ts)
runs the **exact** builder/blockhash/feePayer/simulateTransaction
sequence used by [`web/lib/program.ts`](../web/lib/program.ts)
`buildSignSimulateSend`. Key properties:

- Uses `Transaction` (legacy), not `VersionedTransaction`. matches
  prod wallet adapter behavior.
- Sets `feePayer` + `recentBlockhash`, then calls
  `connection.simulateTransaction(tx)` with **no config arg**. runs
  with the same defaults the browser uses, including `sigVerify: false`
  by default in this code path.
- `SIM_PAYER` env override lets simulation run as any pubkey
  (signatures are not validated). Used here to simulate the deployer,
  who held 6,419,279.677454 $WBULL at the time of the proof run.
- Token-2022 ATA derivation via
  `getAssociatedTokenAddressSync(tokenMint, owner, true, TOKEN_2022_PROGRAM_ID)`
  for $WBULL-side accounts; classic SPL for the NFT side.
- Passes `bullsTokenProgram: TOKEN_2022_PROGRAM_ID` and
  `tokenProgram: TOKEN_PROGRAM_ID` separately in the accounts struct,
  matching the on-chain `wrap_bull` instruction's split interfaces.

## Proof result

Simulation against mainnet RPC (Helius), `commitment: "confirmed"`,
`SIM_PAYER` = deployer (6.4M $WBULL holder):

```
[wrappedbulls-tx:wrapBull-SIM]
{
  "size": <under 1232 bytes, legacy>,
  "accountKeys": <full account set, NFT-owned vault PDA derived>,
  "simulationErr": null,
  "unitsConsumed": 221123,
  "txKind": "legacy"
}
```

Selected on-chain log lines:

```
Program A2tUttiBhWnPUYzqsT6BVf1L4qEMHxw4UibmhTcZbnNk invoke [1]
Program log: Instruction: WrapBull
... (Token-2022 transfer_checked CPI, ATA inits, metadata + master edition CPI, verify_sized_collection_item CPI) ...
Program log: Wrapped bull tier=1 nft_mint=GxCWcPgEBxB2URwAFUzjKvNMMxVxuRGFWu76Whdx8G5X
Program A2tUttiBhWnPUYzqsT6BVf1L4qEMHxw4UibmhTcZbnNk success
```

**Result line printed:** `CLEAN. simulationErr is null (tx mechanics OK)`.

## What this proves

- `wrap_bull` end-to-end: Token-2022 transfer to NFT-owned vault, NFT
  mint + ATA creation, Metaplex metadata + master edition, MCC
  verification, bull_asset PDA init, bank counter bump.
- The on-chain program correctly consumes the `bulls_token_program`
  account split (Token-2022 for $WBULL, classic SPL for the NFT).
- CU budget (600k requested, 221k actually consumed) leaves ~63%
  headroom. no risk of CU exhaustion under contention.
- Tx serializes under the 1232-byte legacy limit.
- Vault PDA derivation `PDA(["vault", nft_mint])` resolves correctly
  and is owned by the NFT identity, not the wrapper wallet (the
  vault-follows-NFT design).

## What this does NOT prove

Empirical mainnet properties that simulation cannot verify on its own:

- Tx propagation under leader congestion (a network property, not a
  program property).
- Phantom's pre-sign Lighthouse assertion behavior on this exact
  account set (better verified in a devnet drill with a real wallet).
- Marketplace indexing latency (Magic Eden / Tensor / Phantom
  collectibles). Auto-detected from MCC + Metaplex; expected to work,
  but timing is platform-dependent.
- Metadata HTTPS resolvability under load (web-tier concern, not
  program; verified independently via uptime monitoring).

For the relaunch, these gaps are closed by the **24h devnet drill**
(see relaunch playbook P6.3) using a real Token-2022 devnet mint, real
browser, real Phantom. not by a mainnet wrap.

## Reproducibility

```bash
ANCHOR_PROVIDER_URL=https://mainnet.helius-rpc.com/?api-key=<KEY> \
SIM_PAYER=GMrJpP7SaUkfyizsB3b8GeKWgDiqac3g5EaMGnMtkXCj \
ANCHOR_WALLET=/path/to/any-keypair.json \
npx ts-node scripts/devnet_simulate_wrap.ts
```

Note: `ANCHOR_WALLET` only needs to be a parseable keypair. its
balance is irrelevant. `SIM_PAYER` is the pubkey the simulator runs
as. The deployer is the canonical proof subject because it held
material $WBULL at the time of the launch.

## Decision logged

**Real mainnet wrap on $WBULL: SKIPPED.**
Rationale: preserving the "first ever wrap" narrative for relaunch
under a new token name. The simulation above is the canonical proof
artifact for program correctness; empirical mainnet behavior will be
re-verified end-to-end during the next launch's devnet drill against
the new mint.

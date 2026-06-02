# @wrappedbulls/sdk

TypeScript SDK for the WrappedBulls protocol family on Solana. Read on-chain
state and build unsigned transactions for the WrappedFactory + wrappedbulls
programs with three lines of code.

## Install

```bash
npm install @wrappedbulls/sdk @solana/web3.js @coral-xyz/anchor @solana/spl-token
```

`@solana/web3.js`, `@coral-xyz/anchor`, and `@solana/spl-token` are peer
dependencies. Install whichever versions your app already uses; the SDK
declares a permissive range.

## Quick start

```typescript
import { Connection, PublicKey } from "@solana/web3.js";
import { WrappedBulls } from "@wrappedbulls/sdk";

const connection = new Connection("https://api.mainnet-beta.solana.com");
const wb = new WrappedBulls({
  connection,
  factoryProgramId:     new PublicKey("WrapF..."),
  wrappedBullsProgramId: new PublicKey("F7qXskG73efUwbDo2B97tZgpPAqX7zHMApXbPUimcFdS"),
});

// READ on-chain state
const cfg = await wb.factory.getConfig();
console.log(`Factory has ${cfg?.totalDeployments} live deployments`);

const collections = await wb.factory.getAllCollections();
for (const c of collections) {
  console.log(c.name, c.ticker, c.inCirculation, "/", c.maxSupply);
}

// BUILD a deploy_collection transaction
const { tx, collection } = await wb.factory.buildDeployTx({
  deployer: deployerPubkey,
  tokenMint: new PublicKey("YourPumpFunTokenMint..."),
  args: {
    name:           "WrappedDoge",
    ticker:         "WDOGE",
    maxSupply:      500,
    tokensPerWrap:  5_000_000_000_000n,  // 5M with 6 decimals
    artSource:      { kind: "baseUri", uri: "https://wrappeddoge.com/api/m/" },
    collectionUri:  "https://wrappeddoge.com/api/collection",
  },
});

// Sign and send -- exactly how your wallet adapter or signer normally does:
tx.partialSign(deployerKeypair);
const sig = await connection.sendRawTransaction(tx.serialize());
await connection.confirmTransaction(sig, "confirmed");
console.log(`Deployed. Collection PDA: ${collection.toBase58()}`);
```

## API

### Reads

```typescript
await wb.factory.getConfig();                      // FactoryConfig | null
await wb.factory.getTreasuryState();               // BullTreasuryState | null
await wb.factory.getCollection(tokenMint);         // WrappedCollection | null
await wb.factory.getAllCollections();              // WrappedCollection[]
await wb.factory.getBullAsset(tokenMint, tier);    // BullAsset | null

await wb.bulls.getBank();                          // BullBank | null
await wb.bulls.getBullAsset(tier);                 // BullAsset | null
```

### Treasury preview math (client-side)

Both methods mirror the on-chain `sweep_expired` accounting — useful for
showing a live countdown without simulating a tx.

```typescript
const treasury = await wb.factory.getTreasuryState();
const claimableNow = wb.factory.previewClaimableAt(treasury);
const locked      = wb.factory.previewLockedAt(treasury);
```

### Transaction builders (unsigned)

Every builder returns a fully-formed `Transaction` with `feePayer` and
`recentBlockhash` set. Your wallet adapter or signing layer does the rest.

```typescript
await wb.factory.buildDeployTx({ deployer, tokenMint, args });
await wb.factory.buildWrapTx({ wrapper, tokenMint });
await wb.factory.buildUnwrapTx({ holder, tokenMint, tierIndex });
```

## PDA helpers

Every PDA in the protocol is exposed as a pure derivation function:

```typescript
import {
  factoryConfigPda,
  bullTreasuryStatePda,
  collectionPda,
  collectionMintPda,
  collectionAuthorityPda,
  nftMintPdaFactory,
  bullAssetPdaFactory,
  vaultAuthorityPda,
  bullBankPda,
  bullAssetPdaBulls,
  nftMintPdaBulls,
  metadataPda,
  masterEditionPda,
  TOKEN_METADATA_PROGRAM_ID,
} from "@wrappedbulls/sdk";

const [bank] = bullBankPda(wrappedBullsProgramId);
const [collection] = collectionPda(factoryProgramId, tokenMint);
```

## Manual deserialization

If you have raw account `Buffer`s and want to skip the connection wrapper:

```typescript
import {
  deserializeFactoryConfig,
  deserializeBullTreasuryState,
  deserializeWrappedCollection,
  deserializeBullAsset,
  deserializeBullBank,
} from "@wrappedbulls/sdk";
```

## Protocol constants

```typescript
import { PROTOCOL_CONSTANTS } from "@wrappedbulls/sdk";

PROTOCOL_CONSTANTS.MIN_SUPPLY;             // 100
PROTOCOL_CONSTANTS.MAX_SUPPLY;             // 2000
PROTOCOL_CONSTANTS.MAX_NAME_LEN;           // 25
PROTOCOL_CONSTANTS.MAX_TICKER_LEN;         // 10
PROTOCOL_CONSTANTS.MAX_ART_URI_LEN;        // 195
PROTOCOL_CONSTANTS.PENDING_CAP;            // 256
PROTOCOL_CONSTANTS.PENDING_LOCK_SECONDS;   // 604800
PROTOCOL_CONSTANTS.DEPLOY_COST_WBULL_UI;   // 1000000
```

## Versioning

`0.1.x` — pre-mainnet. The Factory program ID is still finalizing; do
not depend on the IDL inside the bundle being stable across patch
versions until 0.2.0.

`0.2.x` — adds `buildWrapBullTx` + `buildUnwrapBullTx` for the original
wrappedbulls program (so the SDK fully covers both protocols).

`1.0.0` — locked alongside mainnet Factory launch.

## Links

- Protocol home: [wrappedbulls.com](https://wrappedbulls.com)
- Factory landing: [wrappedbulls.com/launch](https://wrappedbulls.com/launch)
- Source: [github.com/wrappedbulls/wrappedbulls](https://github.com/wrappedbulls/wrappedbulls)
- Security policy: [SECURITY.md](../SECURITY.md)
- Factory security review: [SECURITY-FACTORY.md](../SECURITY-FACTORY.md)

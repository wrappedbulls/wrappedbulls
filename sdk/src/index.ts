// @wrappedbulls/sdk — public entry.
//
// Single `WrappedBulls` class that wraps every chain-read + tx-build the
// protocol family exposes. Two namespaces under it:
//   .factory  -> WrappedFactory operations (deploy / wrap / unwrap / claim)
//   .bulls    -> original wrappedbulls operations (wrap_bull / unwrap_bull)
//
// Usage:
//   import { WrappedBulls } from "@wrappedbulls/sdk";
//   const wb = new WrappedBulls({
//     connection,
//     factoryProgramId: new PublicKey("WrapF..."),
//     wrappedBullsProgramId: new PublicKey("F7qX..."),
//   });
//   const cfg = await wb.factory.getConfig();
//   const deployTx = await wb.factory.buildDeployTx({ ... });
//   const sig = await wallet.signAndSend(deployTx);

import {
  ComputeBudgetProgram,
  Connection,
  PublicKey,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import { BN, BorshInstructionCoder, Idl } from "@coral-xyz/anchor";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";

import factoryIdl from "./idl-factory.json";
import bullsIdl from "./idl-bulls.json";

import {
  ArtSource,
  BullAsset,
  BullBank,
  BullTreasuryState,
  DepositEntry,
  DeployCollectionArgs,
  FactoryConfig,
  PROTOCOL_CONSTANTS,
  WrappedCollection,
} from "./types";

import {
  bullAssetPdaBulls,
  bullAssetPdaFactory,
  bullBankPda,
  bullTreasuryStatePda,
  collectionAuthorityPda,
  collectionMintPda,
  collectionPda,
  factoryConfigPda,
  masterEditionPda,
  metadataPda,
  nftMintPdaFactory,
  TOKEN_METADATA_PROGRAM_ID,
  vaultAuthorityPda,
} from "./pdas";

import {
  deserializeBullAsset,
  deserializeBullBank,
  deserializeBullTreasuryState,
  deserializeFactoryConfig,
  deserializeWrappedCollection,
} from "./deserialize";

// Re-exports for ergonomic consumer use.
export * from "./types";
export * from "./pdas";
export * from "./deserialize";

// =====================================================================
// Constructor options
// =====================================================================
export interface WrappedBullsConfig {
  /** Connection to a Solana RPC (devnet or mainnet). */
  connection: Connection;
  /** WrappedFactory program ID. e.g. the WrapF... vanity address. */
  factoryProgramId: PublicKey;
  /** Wrappedbulls (original) program ID. */
  wrappedBullsProgramId: PublicKey;
}

// =====================================================================
// Main class
// =====================================================================
export class WrappedBulls {
  public readonly factory: FactoryClient;
  public readonly bulls:   BullsClient;
  public readonly constants = PROTOCOL_CONSTANTS;

  constructor(cfg: WrappedBullsConfig) {
    this.factory = new FactoryClient(cfg.connection, cfg.factoryProgramId);
    this.bulls   = new BullsClient(cfg.connection, cfg.wrappedBullsProgramId);
  }
}

// =====================================================================
// FactoryClient — WrappedFactory operations
// =====================================================================
export interface BuildWrapTxResult {
  /** Unsigned, pre-built Transaction the consumer can sign + send. */
  tx: Transaction;
  /** Tier index the wrap will mint (chosen server-side from collection state). */
  tierIndex: number;
  /** Deterministic NFT mint PDA address that will receive the 1-supply mint. */
  nftMint: PublicKey;
}

export interface BuildDeployTxResult {
  tx: Transaction;
  collection: PublicKey;
  collectionMint: PublicKey;
  collectionAuthority: PublicKey;
  deployerCollectionAta: PublicKey;
}

export class FactoryClient {
  private readonly coder: BorshInstructionCoder;

  constructor(
    public readonly connection: Connection,
    public readonly programId: PublicKey,
  ) {
    this.coder = new BorshInstructionCoder(factoryIdl as unknown as Idl);
  }

  // ---- READS ----

  async getConfig(): Promise<FactoryConfig | null> {
    const [pda] = factoryConfigPda(this.programId);
    const info = await this.connection.getAccountInfo(pda, "confirmed");
    if (!info) return null;
    return deserializeFactoryConfig(info.data);
  }

  async getTreasuryState(): Promise<BullTreasuryState | null> {
    const [pda] = bullTreasuryStatePda(this.programId);
    const info = await this.connection.getAccountInfo(pda, "confirmed");
    if (!info) return null;
    return deserializeBullTreasuryState(info.data);
  }

  async getCollection(tokenMint: PublicKey): Promise<WrappedCollection | null> {
    const [pda] = collectionPda(this.programId, tokenMint);
    const info = await this.connection.getAccountInfo(pda, "confirmed");
    if (!info) return null;
    return deserializeWrappedCollection(info.data);
  }

  async getAllCollections(): Promise<WrappedCollection[]> {
    // Filter by the WrappedCollection account size so we don't pull the
    // singletons. Size mirrors state.rs WrappedCollection::SIZE.
    const size = wrappedCollectionSize();
    const accounts = await this.connection.getProgramAccounts(this.programId, {
      commitment: "confirmed",
      filters: [{ dataSize: size }],
    });
    return accounts.map((acc) => deserializeWrappedCollection(acc.account.data));
  }

  async getBullAsset(tokenMint: PublicKey, tierIndex: number): Promise<BullAsset | null> {
    const [pda] = bullAssetPdaFactory(this.programId, tokenMint, tierIndex);
    const info = await this.connection.getAccountInfo(pda, "confirmed");
    if (!info) return null;
    return deserializeBullAsset(info.data);
  }

  // ---- TREASURY PREVIEW (sweep math, no chain mutation) ----

  /**
   * Returns the amount currently sweepable to claimable by claim_treasury
   * if called at `now` (default: real-time clock). Mirrors the on-chain
   * sweep_expired + drain_claimable accounting.
   */
  previewClaimableAt(treasury: BullTreasuryState, now: number = Math.floor(Date.now() / 1000)): bigint {
    const cutoff = BigInt(now - PROTOCOL_CONSTANTS.PENDING_LOCK_SECONDS);
    let sum = treasury.claimable;
    for (const e of treasury.pending) if (e.depositedAt <= cutoff) sum += e.amount;
    return sum;
  }

  previewLockedAt(treasury: BullTreasuryState, now: number = Math.floor(Date.now() / 1000)): bigint {
    const cutoff = BigInt(now - PROTOCOL_CONSTANTS.PENDING_LOCK_SECONDS);
    let sum = 0n;
    for (const e of treasury.pending) if (e.depositedAt > cutoff) sum += e.amount;
    return sum;
  }

  // ---- TX BUILDERS (unsigned; consumer signs + sends) ----

  /**
   * Builds an unsigned `deploy_collection` transaction. The deployer must
   * already hold >= 1,000,000 $WBULL; if not, the on-chain handler will
   * fail with InsufficientWbullForBurn.
   */
  async buildDeployTx(opts: {
    deployer: PublicKey;
    tokenMint: PublicKey;
    args: DeployCollectionArgs;
    /** Override the default ComputeBudget bump. */
    computeUnits?: number;
  }): Promise<BuildDeployTxResult> {
    const cfg = await this.getConfig();
    if (!cfg) throw new Error("Factory is not initialized on this cluster");

    const wbullMint = cfg.wbullMint;
    const [factoryAddr] = factoryConfigPda(this.programId);
    const [treasuryAddr] = bullTreasuryStatePda(this.programId);
    const treasuryVault = getAssociatedTokenAddressSync(wbullMint, treasuryAddr, true);
    const deployerWbull = getAssociatedTokenAddressSync(wbullMint, opts.deployer);

    const [collection] = collectionPda(this.programId, opts.tokenMint);
    const [collMint]   = collectionMintPda(this.programId, opts.tokenMint);
    const [collAuth]   = collectionAuthorityPda(this.programId, opts.tokenMint);
    const deployerCollAta = getAssociatedTokenAddressSync(collMint, opts.deployer);
    const [collMetadata] = metadataPda(collMint);
    const [collMasterEd] = masterEditionPda(collMint);

    // Encode args. ArtSource is an Anchor enum -- tuple variants are
    // expressed as { variantName: [value] }.
    const ixArgs = {
      args: {
        name:           opts.args.name,
        ticker:         opts.args.ticker,
        maxSupply:      opts.args.maxSupply,
        tokensPerWrap:  new BN(opts.args.tokensPerWrap.toString()),
        artSource:
          opts.args.artSource.kind === "baseUri"
            ? { baseUri: [opts.args.artSource.uri] }
            : { rendererUrl: [opts.args.artSource.uri] },
        collectionUri:  opts.args.collectionUri,
      },
    };
    const data = this.coder.encode("deploy_collection", ixArgs);

    const keys = [
      { pubkey: factoryAddr,                 isSigner: false, isWritable: true  },
      { pubkey: treasuryAddr,                isSigner: false, isWritable: true  },
      { pubkey: treasuryVault,               isSigner: false, isWritable: true  },
      { pubkey: opts.deployer,               isSigner: true,  isWritable: true  },
      { pubkey: opts.tokenMint,              isSigner: false, isWritable: false },
      { pubkey: wbullMint,                   isSigner: false, isWritable: false },
      { pubkey: deployerWbull,               isSigner: false, isWritable: true  },
      { pubkey: collection,                  isSigner: false, isWritable: true  },
      { pubkey: collMint,                    isSigner: false, isWritable: true  },
      { pubkey: collAuth,                    isSigner: false, isWritable: false },
      { pubkey: deployerCollAta,             isSigner: false, isWritable: true  },
      { pubkey: collMetadata,                isSigner: false, isWritable: true  },
      { pubkey: collMasterEd,                isSigner: false, isWritable: true  },
      { pubkey: TOKEN_PROGRAM_ID,            isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID,            isSigner: false, isWritable: false }, // wbull_token_program (Interface)
      { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: TOKEN_METADATA_PROGRAM_ID,   isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId,     isSigner: false, isWritable: false },
      { pubkey: SYSVAR_RENT_PUBKEY,          isSigner: false, isWritable: false },
    ];

    const ix = new TransactionInstruction({ programId: this.programId, keys, data });
    const cuIx = ComputeBudgetProgram.setComputeUnitLimit({ units: opts.computeUnits ?? 600_000 });

    const tx = new Transaction();
    tx.add(cuIx, ix);
    tx.feePayer = opts.deployer;
    const { blockhash } = await this.connection.getLatestBlockhash("confirmed");
    tx.recentBlockhash = blockhash;

    return {
      tx,
      collection,
      collectionMint: collMint,
      collectionAuthority: collAuth,
      deployerCollectionAta: deployerCollAta,
    };
  }

  /**
   * Builds an unsigned `wrap` transaction. Reads the collection's current
   * state to pick the next tier (LIFO from free_tiers, else next_tier).
   */
  async buildWrapTx(opts: {
    wrapper: PublicKey;
    tokenMint: PublicKey;
    computeUnits?: number;
  }): Promise<BuildWrapTxResult> {
    const collection = await this.getCollection(opts.tokenMint);
    if (!collection) throw new Error("no wrap layer deployed for that token");

    let tierIndex: number;
    if (collection.freeTiers.length > 0) {
      tierIndex = collection.freeTiers[collection.freeTiers.length - 1];
    } else if (collection.nextTier <= collection.maxSupply) {
      tierIndex = collection.nextTier;
    } else {
      throw new Error("this wrap layer is fully wrapped (max supply reached)");
    }

    const [collAddr]       = collectionPda(this.programId, opts.tokenMint);
    const [collMintAddr]   = collectionMintPda(this.programId, opts.tokenMint);
    const [collAuth]       = collectionAuthorityPda(this.programId, opts.tokenMint);
    const [nftMint]        = nftMintPdaFactory(this.programId, opts.tokenMint, collection.totalWrapped);
    const [nftAuth]        = vaultAuthorityPda(this.programId, nftMint);
    const [bullAsset]      = bullAssetPdaFactory(this.programId, opts.tokenMint, tierIndex);
    const vault            = getAssociatedTokenAddressSync(opts.tokenMint, nftAuth, true);
    const wrapperToken     = getAssociatedTokenAddressSync(opts.tokenMint, opts.wrapper);
    const wrapperNft       = getAssociatedTokenAddressSync(nftMint, opts.wrapper);
    const [metadata]       = metadataPda(nftMint);
    const [masterEd]       = masterEditionPda(nftMint);
    const [collMeta]       = metadataPda(collMintAddr);
    const [collMasterEd]   = masterEditionPda(collMintAddr);

    const data = this.coder.encode("wrap", { tierIndex });

    const keys = [
      { pubkey: collAddr,                    isSigner: false, isWritable: true  },
      { pubkey: opts.wrapper,                isSigner: true,  isWritable: true  },
      { pubkey: opts.tokenMint,              isSigner: false, isWritable: false },
      { pubkey: wrapperToken,                isSigner: false, isWritable: true  },
      { pubkey: nftMint,                     isSigner: false, isWritable: true  },
      { pubkey: nftAuth,                     isSigner: false, isWritable: false },
      { pubkey: vault,                       isSigner: false, isWritable: true  },
      { pubkey: wrapperNft,                  isSigner: false, isWritable: true  },
      { pubkey: bullAsset,                   isSigner: false, isWritable: true  },
      { pubkey: metadata,                    isSigner: false, isWritable: true  },
      { pubkey: masterEd,                    isSigner: false, isWritable: true  },
      { pubkey: collMintAddr,                isSigner: false, isWritable: false },
      { pubkey: collMeta,                    isSigner: false, isWritable: true  },
      { pubkey: collMasterEd,                isSigner: false, isWritable: false },
      { pubkey: collAuth,                    isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID,            isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID,            isSigner: false, isWritable: false }, // bulls_token_program
      { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: TOKEN_METADATA_PROGRAM_ID,   isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId,     isSigner: false, isWritable: false },
      { pubkey: SYSVAR_RENT_PUBKEY,          isSigner: false, isWritable: false },
    ];

    const ix = new TransactionInstruction({ programId: this.programId, keys, data });
    const cuIx = ComputeBudgetProgram.setComputeUnitLimit({ units: opts.computeUnits ?? 600_000 });

    const tx = new Transaction();
    tx.add(cuIx, ix);
    tx.feePayer = opts.wrapper;
    const { blockhash } = await this.connection.getLatestBlockhash("confirmed");
    tx.recentBlockhash = blockhash;

    return { tx, tierIndex, nftMint };
  }

  /**
   * Builds an unsigned `unwrap` transaction. The on-chain `NotNftHolder`
   * constraint rejects callers who don't actually own the NFT at this tier.
   */
  async buildUnwrapTx(opts: {
    holder: PublicKey;
    tokenMint: PublicKey;
    tierIndex: number;
    computeUnits?: number;
  }): Promise<{ tx: Transaction; nftMint: PublicKey }> {
    const collection = await this.getCollection(opts.tokenMint);
    if (!collection) throw new Error("no wrap layer deployed for that token");

    const bull = await this.getBullAsset(opts.tokenMint, opts.tierIndex);
    if (!bull) throw new Error("no live NFT at that tier (already unwrapped or never wrapped)");

    const nftMint = bull.nftMint;
    const [collAddr]   = collectionPda(this.programId, opts.tokenMint);
    const [nftAuth]    = vaultAuthorityPda(this.programId, nftMint);
    const vault        = getAssociatedTokenAddressSync(opts.tokenMint, nftAuth, true);
    const holderToken  = getAssociatedTokenAddressSync(opts.tokenMint, opts.holder);
    const holderNft    = getAssociatedTokenAddressSync(nftMint, opts.holder);
    const [bullAsset]  = bullAssetPdaFactory(this.programId, opts.tokenMint, opts.tierIndex);
    const [metadata]   = metadataPda(nftMint);
    const [masterEd]   = masterEditionPda(nftMint);
    const [collMeta]   = metadataPda(collection.collectionMint);

    const data = this.coder.encode("unwrap", { tierIndex: opts.tierIndex });

    const keys = [
      { pubkey: collAddr,                    isSigner: false, isWritable: true  },
      { pubkey: opts.holder,                 isSigner: true,  isWritable: true  },
      { pubkey: holderToken,                 isSigner: false, isWritable: true  },
      { pubkey: opts.tokenMint,              isSigner: false, isWritable: false },
      { pubkey: nftMint,                     isSigner: false, isWritable: true  },
      { pubkey: nftAuth,                     isSigner: false, isWritable: false },
      { pubkey: vault,                       isSigner: false, isWritable: true  },
      { pubkey: holderNft,                   isSigner: false, isWritable: true  },
      { pubkey: bullAsset,                   isSigner: false, isWritable: true  },
      { pubkey: metadata,                    isSigner: false, isWritable: true  },
      { pubkey: masterEd,                    isSigner: false, isWritable: true  },
      { pubkey: collection.collectionMint,   isSigner: false, isWritable: false },
      { pubkey: collMeta,                    isSigner: false, isWritable: true  },
      { pubkey: TOKEN_PROGRAM_ID,            isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID,            isSigner: false, isWritable: false }, // bulls_token_program
      { pubkey: TOKEN_METADATA_PROGRAM_ID,   isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId,     isSigner: false, isWritable: false },
    ];

    const ix = new TransactionInstruction({ programId: this.programId, keys, data });
    const cuIx = ComputeBudgetProgram.setComputeUnitLimit({ units: opts.computeUnits ?? 600_000 });

    const tx = new Transaction();
    tx.add(cuIx, ix);
    tx.feePayer = opts.holder;
    const { blockhash } = await this.connection.getLatestBlockhash("confirmed");
    tx.recentBlockhash = blockhash;

    return { tx, nftMint };
  }

  /**
   * Builds an unsigned `set_verified` transaction. Flips the
   * `WrappedCollection.verified` flag on the deployment at `tokenMint`.
   *
   * Gated to the program upgrade authority: only the wallet currently
   * holding upgrade authority of the deployed Factory program can sign
   * this successfully. On mainnet that's the wrappedbulls Squads
   * multisig, so this tx must be proposed + signed via the Squads UI.
   *
   * The flag is a UX signal (badge on /launches + SDK consumers), not
   * a security boundary. Wrap/unwrap remain permissionless on any
   * deployment regardless of verified state.
   */
  async buildSetVerifiedTx(opts: {
    authority: PublicKey;
    tokenMint: PublicKey;
    verified: boolean;
    computeUnits?: number;
  }): Promise<{ tx: Transaction; collection: PublicKey; programData: PublicKey }> {
    const [collection] = collectionPda(this.programId, opts.tokenMint);

    // ProgramData PDA is derived under the BPF Upgradeable Loader from
    // [program_id]. Matches the constraint in set_verified.rs which
    // reads program.programdata_address() and compares to program_data.key().
    const [programData] = PublicKey.findProgramAddressSync(
      [this.programId.toBuffer()],
      new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111"),
    );

    const data = this.coder.encode("set_verified", { verified: opts.verified });

    // Account order matches #[derive(Accounts)] in set_verified.rs:
    //   collection (mut), authority (signer), program, program_data
    const keys = [
      { pubkey: collection,     isSigner: false, isWritable: true  },
      { pubkey: opts.authority, isSigner: true,  isWritable: false },
      { pubkey: this.programId, isSigner: false, isWritable: false },
      { pubkey: programData,    isSigner: false, isWritable: false },
    ];

    const ix = new TransactionInstruction({ programId: this.programId, keys, data });
    // set_verified is a tiny ix (one bool field write) -- 200k CU default
    // is already plenty, but bump matches our pattern for consistency.
    const cuIx = ComputeBudgetProgram.setComputeUnitLimit({ units: opts.computeUnits ?? 200_000 });

    const tx = new Transaction();
    tx.add(cuIx, ix);
    tx.feePayer = opts.authority;
    const { blockhash } = await this.connection.getLatestBlockhash("confirmed");
    tx.recentBlockhash = blockhash;

    return { tx, collection, programData };
  }
}

// =====================================================================
// BullsClient — original wrappedbulls program (read-only for v0.1; tx
// builders ship in 0.2 alongside the SDK's own wrap_bull / unwrap_bull
// instruction coders)
// =====================================================================
export class BullsClient {
  constructor(
    public readonly connection: Connection,
    public readonly programId: PublicKey,
  ) {}

  async getBank(): Promise<BullBank | null> {
    const [pda] = bullBankPda(this.programId);
    const info = await this.connection.getAccountInfo(pda, "confirmed");
    if (!info) return null;
    return deserializeBullBank(info.data);
  }

  async getBullAsset(tier: number): Promise<BullAsset | null> {
    const [pda] = bullAssetPdaBulls(this.programId, tier);
    const info = await this.connection.getAccountInfo(pda, "confirmed");
    if (!info) return null;
    return deserializeBullAsset(info.data);
  }
}

// =====================================================================
// Helpers
// =====================================================================
function wrappedCollectionSize(): number {
  // Mirror of state.rs WrappedCollection::SIZE.
  const MAX_NAME_LEN = PROTOCOL_CONSTANTS.MAX_NAME_LEN;
  const MAX_TICKER_LEN = PROTOCOL_CONSTANTS.MAX_TICKER_LEN;
  const MAX_ART_URI_LEN = PROTOCOL_CONSTANTS.MAX_ART_URI_LEN;
  const MAX_SUPPLY = PROTOCOL_CONSTANTS.MAX_SUPPLY;
  return (
    8                                          // discriminator
    + 32                                        // token_mint
    + 32                                        // deployer
    + 4 + MAX_NAME_LEN                          // name
    + 4 + MAX_TICKER_LEN                        // ticker
    + 1 + 4 + MAX_ART_URI_LEN                   // art_source
    + 2                                          // max_supply
    + 8                                          // tokens_per_wrap
    + 32                                         // collection_mint
    + 8                                          // total_wrapped
    + 8                                          // total_unwrapped
    + 2                                          // in_circulation
    + 2                                          // next_tier
    + 4 + (MAX_SUPPLY * 2)                       // free_tiers (Vec<u16>)
    + 8                                          // created_at
    + 1                                          // bump
    + 64                                         // reserved
  );
}

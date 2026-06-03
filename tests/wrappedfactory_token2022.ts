// WrappedFactory Token-2022 integration tests.
//
// Why this file exists:
//   pump.fun migrated to Token-2022 in 2026, so mainnet $WBULL plus most
//   pump.fun tokens are Token-2022 mints (program id TokenzQdBN...). The
//   sibling tests/wrappedfactory.ts proves the classic SPL path
//   end-to-end. This file proves the Token-2022 path end-to-end so we
//   know the WrappedFactory program actually works against the mint kind
//   it will see on mainnet.
//
// What we cover (smallest viable Token-2022 surface):
//   1. initialize: FactoryConfig + BullTreasuryState + bull_treasury_vault
//      under TOKEN_2022_PROGRAM_ID. Verifies the treasury ATA is owned by
//      the Token-2022 program when this file does the init itself; when
//      running alongside tests/wrappedfactory.ts (which initializes
//      first with classic SPL), it adopts the existing state and asserts
//      the on-chain layout is valid.
//   2. deploy_collection: moves 1M WBULL deployer -> treasury atomically
//      while the TARGET token is Token-2022. Proves the
//      InterfaceAccount<MintIf> + InterfaceAccount<TokenAccountIf> path
//      on `token_mint` handles Token-2022 mints correctly.
//   3. wrap: locks tokensPerWrap of a Token-2022 target token into the
//      vault PDA, mints the NFT to the wrapper, and verifies the vault
//      ATA is Token-2022 owned. Exercises the TransferChecked +
//      init_if_needed ATA path with bulls_token_program =
//      TOKEN_2022_PROGRAM_ID.
//   4. unwrap: drains the Token-2022 vault back to the holder, closes
//      the vault, burns the NFT. Exercises TransferChecked +
//      CloseAccount on Token-2022 plus the classic-SPL burn_nft.
//
// Cohabitation with tests/wrappedfactory.ts:
//   Both files run against the same fresh validator inside one
//   `anchor test`. FactoryConfig + BullTreasuryState are singleton PDAs
//   that can only be initialized once. The package.json test script
//   passes --sort so mocha runs files alphabetically; this file lands
//   AFTER tests/wrappedfactory.ts so its setup is in place when we
//   start. The `before` hook adopts the existing FactoryConfig.wbull_mint
//   and only minting/funding for the deployer + wrapper happens here.
//   If this file ever runs alone (no FactoryConfig present), the `before`
//   hook initializes with a Token-2022 wbull mint and the test #1
//   assertions fire the strict Token-2022 ownership check.
//
// Run via `anchor test --skip-build` on the VPS.

import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import {
  PublicKey,
  Keypair,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
  LAMPORTS_PER_SOL,
  ComputeBudgetProgram,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createMint,
  mintTo,
  getAssociatedTokenAddressSync,
  getOrCreateAssociatedTokenAccount,
  getAccount,
} from "@solana/spl-token";
import { expect } from "chai";
import { Wrappedfactory } from "../target/types/wrappedfactory";

// deploy_collection + wrap each issue multiple CPIs (Metaplex
// CreateMetadataAccountsV3, CreateMasterEditionV3, token transfers, ATA
// inits, treasury push, MCC verify). Bump CU above the 200k default so
// the heavy paths don't OOM.
const CU_BUMP = ComputeBudgetProgram.setComputeUnitLimit({ units: 600_000 });

// Metaplex Token Metadata program -- same on every cluster.
const TOKEN_METADATA_PROGRAM_ID = new PublicKey(
  "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s",
);

// =====================================================================
// PDA derivation helpers. All seeds match the program literally.
// =====================================================================

function deriveFactoryConfig(programId: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("factory_config")],
    programId,
  )[0];
}

function deriveBullTreasuryState(programId: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("bull_treasury")],
    programId,
  )[0];
}

function deriveCollectionPdas(programId: PublicKey, tokenMint: PublicKey) {
  const [collection] = PublicKey.findProgramAddressSync(
    [Buffer.from("collection"), tokenMint.toBuffer()],
    programId,
  );
  const [collectionMint] = PublicKey.findProgramAddressSync(
    [Buffer.from("collection_mint"), tokenMint.toBuffer()],
    programId,
  );
  const [collectionAuthority] = PublicKey.findProgramAddressSync(
    [Buffer.from("collection_authority"), tokenMint.toBuffer()],
    programId,
  );
  return { collection, collectionMint, collectionAuthority };
}

function deriveMetadataPdas(mint: PublicKey) {
  const [metadata] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("metadata"),
      TOKEN_METADATA_PROGRAM_ID.toBuffer(),
      mint.toBuffer(),
    ],
    TOKEN_METADATA_PROGRAM_ID,
  );
  const [masterEdition] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("metadata"),
      TOKEN_METADATA_PROGRAM_ID.toBuffer(),
      mint.toBuffer(),
      Buffer.from("edition"),
    ],
    TOKEN_METADATA_PROGRAM_ID,
  );
  return { metadata, masterEdition };
}

function deriveNftMint(
  programId: PublicKey,
  tokenMint: PublicKey,
  totalWrapped: anchor.BN,
): PublicKey {
  // total_wrapped is u64 little-endian = 8 bytes.
  const totalWrappedBuf = Buffer.alloc(8);
  totalWrappedBuf.writeBigUInt64LE(BigInt(totalWrapped.toString()), 0);
  return PublicKey.findProgramAddressSync(
    [Buffer.from("nft_mint"), tokenMint.toBuffer(), totalWrappedBuf],
    programId,
  )[0];
}

function deriveVaultAuthority(
  programId: PublicKey,
  nftMint: PublicKey,
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), nftMint.toBuffer()],
    programId,
  )[0];
}

function deriveBullAsset(
  programId: PublicKey,
  tokenMint: PublicKey,
  tierIndex: number,
): PublicKey {
  const tierBuf = Buffer.alloc(2);
  tierBuf.writeUInt16LE(tierIndex, 0);
  return PublicKey.findProgramAddressSync(
    [Buffer.from("bull"), tokenMint.toBuffer(), tierBuf],
    programId,
  )[0];
}

// =====================================================================
// Test suite
// =====================================================================

describe("wrappedfactory_token2022", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.Wrappedfactory as Program<Wrappedfactory>;

  const authority = provider.wallet as anchor.Wallet;

  // WBULL mint adopted from existing FactoryConfig (when run alongside
  // tests/wrappedfactory.ts) OR freshly created as Token-2022 (when this
  // file runs alone).
  let wbullMint: PublicKey;
  let wbullProgramId: PublicKey;
  let preExistingConfig: boolean;

  // Target token: ALWAYS Token-2022. This is the pump.fun mint kind.
  let dogeMint: PublicKey;

  // Fresh wallets unique to this file so we never collide with any
  // deployer/holder created by tests/wrappedfactory.ts.
  const deployer = Keypair.generate();
  const wrapper = Keypair.generate();

  let deployerWbullAta: PublicKey;
  let wrapperTokenAta: PublicKey;

  const TOKEN_DECIMALS = 6;
  const ONE_MILLION_TOKENS = BigInt("1000000000000"); // 1e6 * 10^6
  const TOKENS_PER_WRAP_BN = new anchor.BN(5_000_000);
  const TOKENS_PER_WRAP_BIG = BigInt(5_000_000);

  // ----------------------- one-time setup -----------------------
  before(async () => {
    // Fund deployer + wrapper.
    for (const kp of [deployer, wrapper]) {
      const sig = await provider.connection.requestAirdrop(
        kp.publicKey,
        5 * LAMPORTS_PER_SOL,
      );
      await provider.connection.confirmTransaction(sig, "confirmed");
    }

    // Detect whether FactoryConfig has already been initialized. If yes,
    // adopt its wbull_mint + corresponding token program id. If no, we
    // become the initializer and use a fresh Token-2022 wbull mint
    // (path exercised when this file runs solo).
    const factoryConfigPda = deriveFactoryConfig(program.programId);
    let existingCfg: any = null;
    try {
      existingCfg = await program.account.factoryConfig.fetch(factoryConfigPda);
    } catch (_e) {
      existingCfg = null;
    }

    if (existingCfg) {
      preExistingConfig = true;
      wbullMint = existingCfg.wbullMint;
      const mintInfo = await provider.connection.getAccountInfo(wbullMint);
      if (!mintInfo) {
        throw new Error(
          `Adopted wbullMint ${wbullMint.toBase58()} has no on-chain account`,
        );
      }
      wbullProgramId = mintInfo.owner;
    } else {
      preExistingConfig = false;
      wbullMint = await createMint(
        provider.connection,
        authority.payer,
        authority.publicKey,
        null,
        TOKEN_DECIMALS,
        undefined,
        undefined,
        TOKEN_2022_PROGRAM_ID,
      );
      wbullProgramId = TOKEN_2022_PROGRAM_ID;
    }

    // Target token is always fresh + Token-2022. Authority controls
    // mint authority so we can fund the wrapper below.
    dogeMint = await createMint(
      provider.connection,
      authority.payer,
      authority.publicKey,
      null,
      TOKEN_DECIMALS,
      undefined,
      undefined,
      TOKEN_2022_PROGRAM_ID,
    );

    // Give the deployer exactly 1M WBULL (one deploy's worth). Use the
    // adopted program id so this works for classic SPL or Token-2022
    // wbull.
    const deployerWbullAccount = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      authority.payer,
      wbullMint,
      deployer.publicKey,
      false,
      undefined,
      undefined,
      wbullProgramId,
      ASSOCIATED_TOKEN_PROGRAM_ID,
    );
    deployerWbullAta = deployerWbullAccount.address;
    await mintTo(
      provider.connection,
      authority.payer,
      wbullMint,
      deployerWbullAta,
      authority.publicKey,
      Number(ONE_MILLION_TOKENS),
      [],
      undefined,
      wbullProgramId,
    );

    // Give the wrapper exactly tokens_per_wrap of Token-2022 target.
    const wrapperTokenAccount = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      authority.payer,
      dogeMint,
      wrapper.publicKey,
      false,
      undefined,
      undefined,
      TOKEN_2022_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID,
    );
    wrapperTokenAta = wrapperTokenAccount.address;
    await mintTo(
      provider.connection,
      authority.payer,
      dogeMint,
      wrapperTokenAta,
      authority.publicKey,
      Number(TOKENS_PER_WRAP_BIG),
      [],
      undefined,
      TOKEN_2022_PROGRAM_ID,
    );
  });

  // ----------------------- 1. initialize / verify Token-2022 setup -----------------------
  it("initialize creates FactoryConfig + BullTreasuryState + bull_treasury_vault under Token-2022", async () => {
    const factoryConfig = deriveFactoryConfig(program.programId);
    const treasuryState = deriveBullTreasuryState(program.programId);
    const treasuryVault = getAssociatedTokenAddressSync(
      wbullMint,
      treasuryState,
      true,
      wbullProgramId,
      ASSOCIATED_TOKEN_PROGRAM_ID,
    );

    if (!preExistingConfig) {
      // Solo run: actually invoke initialize against a Token-2022 wbull
      // mint to prove the bull_treasury_vault gets created under
      // TOKEN_2022_PROGRAM_ID.
      await program.methods
        .initialize(wbullMint)
        .accounts({
          factoryConfig,
          bullTreasuryState: treasuryState,
          wbullMint,
          bullTreasuryVault: treasuryVault,
          authority: authority.publicKey,
          program: program.programId,
          programData: PublicKey.findProgramAddressSync(
            [program.programId.toBuffer()],
            new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111"),
          )[0],
          wbullTokenProgram: TOKEN_2022_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
    }

    // Assertions valid in both cases (we initialized, or we adopted).
    const cfg = await program.account.factoryConfig.fetch(factoryConfig);
    expect(cfg.wbullMint.toBase58()).to.equal(wbullMint.toBase58());
    expect(cfg.admin.toBase58()).to.equal(authority.publicKey.toBase58());

    const treasury = await program.account.bullTreasuryState.fetch(treasuryState);
    expect(treasury.pending.length).to.be.gte(0);

    // The bull_treasury_vault ATA exists and is owned by the SAME token
    // program that manages wbull. When this file initialized it itself,
    // that is TOKEN_2022_PROGRAM_ID -- the load-bearing invariant proving
    // the Token-2022 ATA path works through initialize. When we adopted
    // an existing classic-SPL setup we still verify ownership matches
    // the wbull program id so the deploy_collection path below is sound.
    const vaultInfo = await provider.connection.getAccountInfo(treasuryVault);
    expect(vaultInfo, "treasury vault must exist").to.not.be.null;
    expect(vaultInfo!.owner.toBase58()).to.equal(wbullProgramId.toBase58());

    if (!preExistingConfig) {
      expect(vaultInfo!.owner.toBase58()).to.equal(
        TOKEN_2022_PROGRAM_ID.toBase58(),
      );
    }
  });

  // ----------------------- 2. deploy_collection with Token-2022 target -----------------------
  it("deploy_collection moves 1M WBULL deployer -> treasury (Token-2022 target token)", async () => {
    const factoryConfig = deriveFactoryConfig(program.programId);
    const treasuryState = deriveBullTreasuryState(program.programId);
    const treasuryVault = getAssociatedTokenAddressSync(
      wbullMint,
      treasuryState,
      true,
      wbullProgramId,
      ASSOCIATED_TOKEN_PROGRAM_ID,
    );

    const { collection, collectionMint, collectionAuthority } =
      deriveCollectionPdas(program.programId, dogeMint);
    const { metadata, masterEdition } = deriveMetadataPdas(collectionMint);
    // The collection NFT itself is ALWAYS classic SPL (Metaplex requires it).
    const deployerCollectionAta = getAssociatedTokenAddressSync(
      collectionMint,
      deployer.publicKey,
      false,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID,
    );

    const treasuryBefore = await getAccount(
      provider.connection,
      treasuryVault,
      undefined,
      wbullProgramId,
    );
    const deployerBefore = await getAccount(
      provider.connection,
      deployerWbullAta,
      undefined,
      wbullProgramId,
    );
    expect(deployerBefore.amount.toString()).to.equal(
      ONE_MILLION_TOKENS.toString(),
    );

    const args = {
      name: "WrappedDogeT22",
      ticker: "WDOGET22",
      maxSupply: 500,
      tokensPerWrap: TOKENS_PER_WRAP_BN,
      artSource: { baseUri: ["https://wrappeddoget22.com/api/m/"] },
      collectionUri: "https://wrappeddoget22.com/api/collection",
    };

    await program.methods
      .deployCollection(args as any)
      .preInstructions([CU_BUMP])
      .accounts({
        factoryConfig,
        bullTreasuryState: treasuryState,
        bullTreasuryVault: treasuryVault,
        deployer: deployer.publicKey,
        tokenMint: dogeMint,
        wbullMint,
        deployerWbullAccount: deployerWbullAta,
        collection,
        collectionMint,
        collectionAuthority,
        deployerCollectionAta,
        collectionMetadata: metadata,
        collectionMasterEdition: masterEdition,
        // NFT side (collection_mint init + mint_to + master edition):
        // Metaplex requires classic SPL here regardless of the target
        // token type.
        tokenProgram: TOKEN_PROGRAM_ID,
        // WBULL side uses whichever program owns the adopted/created mint.
        wbullTokenProgram: wbullProgramId,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        tokenMetadataProgram: TOKEN_METADATA_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: SYSVAR_RENT_PUBKEY,
      })
      .signers([deployer])
      .rpc();

    // Treasury vault gained exactly 1M WBULL (delta isolates against
    // any pre-existing deposits from tests/wrappedfactory.ts).
    const treasuryAfter = await getAccount(
      provider.connection,
      treasuryVault,
      undefined,
      wbullProgramId,
    );
    const deltaTreasury = treasuryAfter.amount - treasuryBefore.amount;
    expect(deltaTreasury.toString()).to.equal(ONE_MILLION_TOKENS.toString());

    // Deployer's WBULL dropped by 1M.
    const deployerAfter = await getAccount(
      provider.connection,
      deployerWbullAta,
      undefined,
      wbullProgramId,
    );
    const deltaDeployer = deployerBefore.amount - deployerAfter.amount;
    expect(deltaDeployer.toString()).to.equal(ONE_MILLION_TOKENS.toString());

    // WrappedCollection PDA populated.
    const coll = await program.account.wrappedCollection.fetch(collection);
    expect(coll.tokenMint.toBase58()).to.equal(dogeMint.toBase58());
    expect(coll.deployer.toBase58()).to.equal(deployer.publicKey.toBase58());
    expect(coll.name).to.equal("WrappedDogeT22");
    expect(coll.ticker).to.equal("WDOGET22");
    expect(coll.maxSupply).to.equal(500);
    expect(coll.tokensPerWrap.toString()).to.equal(
      TOKENS_PER_WRAP_BN.toString(),
    );
    expect(coll.collectionMint.toBase58()).to.equal(collectionMint.toBase58());
    expect(coll.totalWrapped.toString()).to.equal("0");
  });

  // ----------------------- 3. wrap Token-2022 tokens into NFT -----------------------
  it("wrap locks Token-2022 target tokens into NFT (vault is Token-2022 owned)", async () => {
    const TIER = 1;

    const { collection, collectionMint, collectionAuthority } =
      deriveCollectionPdas(program.programId, dogeMint);

    const collBefore = await program.account.wrappedCollection.fetch(collection);
    const totalWrapped = collBefore.totalWrapped; // 0 on the first wrap

    const nftMint = deriveNftMint(program.programId, dogeMint, totalWrapped);
    const nftMintAuthority = deriveVaultAuthority(program.programId, nftMint);
    const bullAsset = deriveBullAsset(program.programId, dogeMint, TIER);

    // Vault ATA owned by nft_mint_authority, for the Token-2022 target.
    const vault = getAssociatedTokenAddressSync(
      dogeMint,
      nftMintAuthority,
      true,
      TOKEN_2022_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID,
    );
    // Wrapper's NFT ATA: NFT is classic SPL.
    const wrapperNftAccount = getAssociatedTokenAddressSync(
      nftMint,
      wrapper.publicKey,
      false,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID,
    );

    const { metadata, masterEdition } = deriveMetadataPdas(nftMint);
    const collMetadataPdas = deriveMetadataPdas(collectionMint);

    const wrapperBefore = await getAccount(
      provider.connection,
      wrapperTokenAta,
      undefined,
      TOKEN_2022_PROGRAM_ID,
    );
    expect(wrapperBefore.amount.toString()).to.equal(
      TOKENS_PER_WRAP_BIG.toString(),
    );

    await program.methods
      .wrap(TIER)
      .preInstructions([CU_BUMP])
      .accounts({
        collection,
        payer: wrapper.publicKey,
        tokenMint: dogeMint,
        payerTokenAccount: wrapperTokenAta,
        nftMint,
        nftMintAuthority,
        vault,
        payerNftAccount: wrapperNftAccount,
        bullAsset,
        metadata,
        masterEdition,
        collectionMint,
        collectionMetadata: collMetadataPdas.metadata,
        collectionMasterEdition: collMetadataPdas.masterEdition,
        collectionAuthority,
        // NFT side: classic SPL (Metaplex requires it).
        tokenProgram: TOKEN_PROGRAM_ID,
        // Target token side: Token-2022.
        bullsTokenProgram: TOKEN_2022_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        tokenMetadataProgram: TOKEN_METADATA_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: SYSVAR_RENT_PUBKEY,
      })
      .signers([wrapper])
      .rpc();

    // Wrapper drained.
    const wrapperAfter = await getAccount(
      provider.connection,
      wrapperTokenAta,
      undefined,
      TOKEN_2022_PROGRAM_ID,
    );
    expect(wrapperAfter.amount.toString()).to.equal("0");

    // Vault holds tokens_per_wrap AND is owned by Token-2022 program.
    const vaultInfo = await provider.connection.getAccountInfo(vault);
    expect(vaultInfo, "vault must exist").to.not.be.null;
    expect(vaultInfo!.owner.toBase58()).to.equal(
      TOKEN_2022_PROGRAM_ID.toBase58(),
    );
    const vaultAcc = await getAccount(
      provider.connection,
      vault,
      undefined,
      TOKEN_2022_PROGRAM_ID,
    );
    expect(vaultAcc.amount.toString()).to.equal(
      TOKENS_PER_WRAP_BIG.toString(),
    );
    expect(vaultAcc.mint.toBase58()).to.equal(dogeMint.toBase58());

    // Wrapper got 1 NFT.
    const nftAcc = await getAccount(provider.connection, wrapperNftAccount);
    expect(nftAcc.amount.toString()).to.equal("1");
    expect(nftAcc.mint.toBase58()).to.equal(nftMint.toBase58());

    // Collection counters.
    const collAfter = await program.account.wrappedCollection.fetch(collection);
    expect(collAfter.totalWrapped.toString()).to.equal(
      (BigInt(totalWrapped.toString()) + BigInt(1)).toString(),
    );
    expect(collAfter.inCirculation).to.equal(1);

    // BullAsset populated.
    const asset = await program.account.bullAsset.fetch(bullAsset);
    expect(asset.tierIndex).to.equal(TIER);
    expect(asset.nftMint.toBase58()).to.equal(nftMint.toBase58());
  });

  // ----------------------- 4. unwrap drains Token-2022 vault -----------------------
  it("unwrap drains Token-2022 vault back to holder, burns NFT, closes vault", async () => {
    const TIER = 1;

    const { collection, collectionMint } = deriveCollectionPdas(
      program.programId,
      dogeMint,
    );

    // total_wrapped was 0 going into the wrap; the nft_mint seed used
    // the pre-wrap value, so we re-derive with 0.
    const nftMint = deriveNftMint(
      program.programId,
      dogeMint,
      new anchor.BN(0),
    );
    const nftMintAuthority = deriveVaultAuthority(program.programId, nftMint);
    const bullAsset = deriveBullAsset(program.programId, dogeMint, TIER);

    const vault = getAssociatedTokenAddressSync(
      dogeMint,
      nftMintAuthority,
      true,
      TOKEN_2022_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID,
    );
    const wrapperNftAccount = getAssociatedTokenAddressSync(
      nftMint,
      wrapper.publicKey,
      false,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID,
    );

    const { metadata, masterEdition } = deriveMetadataPdas(nftMint);
    const collMetadataPdas = deriveMetadataPdas(collectionMint);

    const wrapperTokensBefore = await getAccount(
      provider.connection,
      wrapperTokenAta,
      undefined,
      TOKEN_2022_PROGRAM_ID,
    );
    expect(wrapperTokensBefore.amount.toString()).to.equal("0");

    await program.methods
      .unwrap(TIER)
      .preInstructions([CU_BUMP])
      .accounts({
        collection,
        payer: wrapper.publicKey,
        payerTokenAccount: wrapperTokenAta,
        tokenMint: dogeMint,
        nftMint,
        nftMintAuthority,
        vault,
        payerNftAccount: wrapperNftAccount,
        bullAsset,
        metadata,
        masterEdition,
        collectionMint,
        collectionMetadata: collMetadataPdas.metadata,
        // NFT side: classic SPL (Metaplex BurnNft requires it).
        tokenProgram: TOKEN_PROGRAM_ID,
        // Target token side: Token-2022 (drain + close).
        bullsTokenProgram: TOKEN_2022_PROGRAM_ID,
        tokenMetadataProgram: TOKEN_METADATA_PROGRAM_ID,
      })
      .signers([wrapper])
      .rpc();

    // Holder got tokens_per_wrap back.
    const wrapperTokensAfter = await getAccount(
      provider.connection,
      wrapperTokenAta,
      undefined,
      TOKEN_2022_PROGRAM_ID,
    );
    expect(wrapperTokensAfter.amount.toString()).to.equal(
      TOKENS_PER_WRAP_BIG.toString(),
    );

    // Vault closed.
    const vaultInfo = await provider.connection.getAccountInfo(vault);
    expect(vaultInfo, "vault should be closed").to.be.null;

    // BullAsset closed.
    const bullAssetInfo = await provider.connection.getAccountInfo(bullAsset);
    expect(bullAssetInfo, "bull_asset should be closed").to.be.null;

    // NFT burned: Metaplex burn_nft sets the mint supply to 0 and closes
    // the holder's NFT ATA. The mint, metadata, and master_edition
    // accounts are left on chain as 0-supply / drained ghosts (Metaplex
    // behavior across versions; relying on closed-account assertions for
    // those is brittle). The load-bearing post-conditions are: the
    // holder no longer owns the NFT, and the underlying mint supply is 0.
    const wrapperNftInfo = await provider.connection.getAccountInfo(
      wrapperNftAccount,
    );
    expect(wrapperNftInfo, "wrapper NFT ATA should be closed").to.be.null;

    // Re-read the mint and confirm supply is 0 (proof the NFT was burned).
    const { getMint } = await import("@solana/spl-token");
    const mintAfter = await getMint(
      provider.connection,
      nftMint,
      undefined,
      TOKEN_PROGRAM_ID,
    );
    expect(mintAfter.supply.toString()).to.equal("0");

    // Collection counters reflect the unwrap.
    const collAfter = await program.account.wrappedCollection.fetch(collection);
    expect(collAfter.totalUnwrapped.toString()).to.equal("1");
    expect(collAfter.inCirculation).to.equal(0);
    expect(collAfter.freeTiers.map((t: number) => t)).to.include(TIER);
  });
});

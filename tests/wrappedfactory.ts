// WrappedFactory Anchor program integration tests.
//
// Covers the treasury-model deploy + the new claim_treasury 7-day lock:
//   1. initialize creates FactoryConfig + BullTreasuryState + bull_treasury_vault ATA
//   2. deploy_collection moves 1M $WBULL deployer -> bull_treasury_vault atomically,
//      pushes a DepositEntry onto BullTreasuryState.pending
//   3. deploy_collection refuses when the deployer's $WBULL balance is < 1M
//   4. claim_treasury rejects with NothingClaimable when all deposits are < 7d old
//      (proves the lock enforces from the rejection side without needing time travel)
//   5. PDA isolation: deploying for two different token mints succeeds independently
//
// What this file does NOT cover (deferred to Week 3 stress test):
//   - claim_treasury success path (requires solana-test-validator --warp-slot or
//     bankrun-style time travel; both are out of scope for this Week 1 proof)
//   - wrap / unwrap (use the same Metaplex CPI patterns wrappedbulls is already
//     validated on; will be covered by Week 3 multi-collection lifecycle test)
//
// Run via `anchor test` on the VPS (Linux with solana toolchain).

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
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createMint,
  mintTo,
  getAssociatedTokenAddressSync,
  getOrCreateAssociatedTokenAccount,
  getAccount,
} from "@solana/spl-token";
import { expect } from "chai";
import { Wrappedfactory } from "../target/types/wrappedfactory";

// deploy_collection issues multiple CPIs (Metaplex CreateMetadataAccountsV3
// + CreateMasterEditionV3 + token transfers + ATA inits + treasury push).
// Bump CU above the 200k default; production clients should do the same.
const CU_BUMP = ComputeBudgetProgram.setComputeUnitLimit({ units: 600_000 });

// Metaplex Token Metadata program -- same on every cluster.
const TOKEN_METADATA_PROGRAM_ID = new PublicKey(
  "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s"
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

// =====================================================================
// Test suite
// =====================================================================

describe("wrappedfactory", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.Wrappedfactory as Program<Wrappedfactory>;

  // Authority = the provider's wallet = the program's upgrade authority in
  // `anchor test`. Same wallet signs initialize, claim_treasury, and pays
  // for all rent here. On mainnet this becomes the Squads multisig.
  const authority = provider.wallet as anchor.Wallet;

  // Two fake "pump.fun" tokens used as deploy targets. Created fresh per
  // test run by the before-all hook.
  let wbullMint: PublicKey;   // canonical $WBULL for the Factory
  let dogeMint:  PublicKey;   // first deploy target
  let frogMint:  PublicKey;   // second deploy target (for PDA isolation test)

  // The deployer for collections. Distinct from the program upgrade authority
  // so we exercise the "permissionless" claim that anyone with $WBULL can
  // deploy.
  const deployer = Keypair.generate();
  let deployerWbullAta: PublicKey; // funded with > 1M $WBULL by setup

  const TOKEN_DECIMALS = 6; // pump.fun standard
  // 1,000,000 * 10^6 = 1e12 base units. Constructed via String constructor
  // because tsconfig target=es6 lacks BigInt literal `n` suffix AND
  // BigInt ** BigInt compiles to Math.pow which rejects BigInt.
  const ONE_MILLION_TOKENS = BigInt("1000000000000");

  // ----------------------- one-time setup -----------------------
  before(async () => {
    // Fund the deployer wallet with SOL for tx fees + rent.
    const airdropSig = await provider.connection.requestAirdrop(
      deployer.publicKey,
      5 * LAMPORTS_PER_SOL,
    );
    await provider.connection.confirmTransaction(airdropSig, "confirmed");

    // Create the three test mints, all owned by `authority` for ease of
    // funding. The Factory's wbull_mint constraint matches by pubkey, not
    // by authority, so this is fine.
    wbullMint = await createMint(
      provider.connection,
      authority.payer,
      authority.publicKey, // mint authority
      null,                // freeze authority
      TOKEN_DECIMALS,
    );
    dogeMint = await createMint(
      provider.connection,
      authority.payer,
      authority.publicKey,
      null,
      TOKEN_DECIMALS,
    );
    frogMint = await createMint(
      provider.connection,
      authority.payer,
      authority.publicKey,
      null,
      TOKEN_DECIMALS,
    );

    // Fund the deployer with 3M $WBULL (enough for 2 successful deploys
    // plus one failing-balance test).
    const deployerWbullAccount = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      authority.payer,
      wbullMint,
      deployer.publicKey,
    );
    deployerWbullAta = deployerWbullAccount.address;
    await mintTo(
      provider.connection,
      authority.payer,
      wbullMint,
      deployerWbullAta,
      authority.publicKey,
      Number(BigInt(3) * ONE_MILLION_TOKENS),
    );
  });

  // ----------------------- 1. initialize -----------------------
  it("initialize creates FactoryConfig + BullTreasuryState + bull_treasury_vault", async () => {
    const factoryConfig = deriveFactoryConfig(program.programId);
    const treasuryState = deriveBullTreasuryState(program.programId);
    const treasuryVault = getAssociatedTokenAddressSync(
      wbullMint,
      treasuryState,
      true, // allow owner off curve (PDA)
    );

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
        wbullTokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    // Assert FactoryConfig was written with the right values.
    const cfg = await program.account.factoryConfig.fetch(factoryConfig);
    expect(cfg.wbullMint.toBase58()).to.equal(wbullMint.toBase58());
    expect(cfg.admin.toBase58()).to.equal(authority.publicKey.toBase58());
    expect(cfg.totalDeployments).to.equal(0);
    expect(cfg.totalWbullDeposited.toString()).to.equal("0");

    // Assert BullTreasuryState was written empty.
    const treasury = await program.account.bullTreasuryState.fetch(treasuryState);
    expect(treasury.claimable.toString()).to.equal("0");
    expect(treasury.pending.length).to.equal(0);
    expect(treasury.lifetimeDeposited.toString()).to.equal("0");
    expect(treasury.lifetimeClaimed.toString()).to.equal("0");

    // Assert the ATA exists and is empty.
    const vaultAcc = await getAccount(provider.connection, treasuryVault);
    expect(vaultAcc.mint.toBase58()).to.equal(wbullMint.toBase58());
    expect(vaultAcc.owner.toBase58()).to.equal(treasuryState.toBase58());
    expect(vaultAcc.amount.toString()).to.equal("0");
  });

  // ----------------------- 2. deploy_collection happy path -----------------------
  it("deploy_collection moves 1M $WBULL deployer -> treasury + pushes DepositEntry", async () => {
    const factoryConfig = deriveFactoryConfig(program.programId);
    const treasuryState = deriveBullTreasuryState(program.programId);
    const treasuryVault = getAssociatedTokenAddressSync(
      wbullMint,
      treasuryState,
      true,
    );

    const before = await getAccount(provider.connection, treasuryVault);
    expect(before.amount.toString()).to.equal("0");

    const { collection, collectionMint, collectionAuthority } =
      deriveCollectionPdas(program.programId, dogeMint);
    const { metadata, masterEdition } = deriveMetadataPdas(collectionMint);
    const deployerCollectionAta = getAssociatedTokenAddressSync(
      collectionMint,
      deployer.publicKey,
    );

    const args = {
      name: "WrappedDoge",
      ticker: "WDOGE",
      maxSupply: 500,
      tokensPerWrap: new anchor.BN(5_000_000),
      artSource: { baseUri: ["https://wrappeddoge.com/api/m/"] },
      collectionUri: "https://wrappeddoge.com/api/collection",
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
        tokenProgram: TOKEN_PROGRAM_ID,
        wbullTokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        tokenMetadataProgram: TOKEN_METADATA_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: SYSVAR_RENT_PUBKEY,
      })
      .signers([deployer])
      .rpc();

    // Assert the treasury vault now holds exactly 1M $WBULL.
    const after = await getAccount(provider.connection, treasuryVault);
    expect(after.amount.toString()).to.equal(ONE_MILLION_TOKENS.toString());

    // Assert the deployer's $WBULL balance dropped by 1M.
    const deployerAfter = await getAccount(provider.connection, deployerWbullAta);
    const expectedRemaining = BigInt(3) * ONE_MILLION_TOKENS - ONE_MILLION_TOKENS;
    expect(deployerAfter.amount.toString()).to.equal(expectedRemaining.toString());

    // Assert BullTreasuryState got the pending entry + lifetime bump.
    const treasury = await program.account.bullTreasuryState.fetch(treasuryState);
    expect(treasury.pending.length).to.equal(1);
    expect(treasury.pending[0].amount.toString()).to.equal(ONE_MILLION_TOKENS.toString());
    expect(treasury.claimable.toString()).to.equal("0"); // not yet expired
    expect(treasury.lifetimeDeposited.toString()).to.equal(ONE_MILLION_TOKENS.toString());

    // Assert FactoryConfig counters bumped.
    const cfg = await program.account.factoryConfig.fetch(factoryConfig);
    expect(cfg.totalDeployments).to.equal(1);
    expect(cfg.totalWbullDeposited.toString()).to.equal(ONE_MILLION_TOKENS.toString());

    // Assert WrappedCollection was initialized correctly.
    const coll = await program.account.wrappedCollection.fetch(collection);
    expect(coll.tokenMint.toBase58()).to.equal(dogeMint.toBase58());
    expect(coll.deployer.toBase58()).to.equal(deployer.publicKey.toBase58());
    expect(coll.name).to.equal("WrappedDoge");
    expect(coll.ticker).to.equal("WDOGE");
    expect(coll.maxSupply).to.equal(500);
    expect(coll.tokensPerWrap.toString()).to.equal("5000000");
    expect(coll.collectionMint.toBase58()).to.equal(collectionMint.toBase58());
  });

  // ----------------------- 3. claim_treasury rejects fresh deposits (7d lock) -----------------------
  it("claim_treasury rejects with NothingClaimable when all deposits are <7d old", async () => {
    // The previous test deposited 1M $WBULL into the treasury moments ago.
    // sweep_expired(now) inside claim_treasury cannot promote it to
    // claimable because it's nowhere near 7 days old. So claim should fail
    // with NothingClaimable.

    const factoryConfig = deriveFactoryConfig(program.programId);
    const treasuryState = deriveBullTreasuryState(program.programId);
    const treasuryVault = getAssociatedTokenAddressSync(
      wbullMint,
      treasuryState,
      true,
    );

    // Destination ATA for the multisig's hypothetical sweep.
    const destination = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      authority.payer,
      wbullMint,
      authority.publicKey,
    );

    let errMsg = "";
    try {
      await program.methods
        .claimTreasury()
        .accounts({
          factoryConfig,
          bullTreasuryState: treasuryState,
          wbullMint,
          bullTreasuryVault: treasuryVault,
          destinationWbullAccount: destination.address,
          authority: authority.publicKey,
          program: program.programId,
          programData: PublicKey.findProgramAddressSync(
            [program.programId.toBuffer()],
            new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111"),
          )[0],
          wbullTokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc();
    } catch (e: any) {
      errMsg = e.toString();
    }
    expect(errMsg).to.contain("NothingClaimable");

    // Treasury balance is unchanged.
    const vault = await getAccount(provider.connection, treasuryVault);
    expect(vault.amount.toString()).to.equal(ONE_MILLION_TOKENS.toString());
    // pending still has the single entry; nothing was swept.
    const treasury = await program.account.bullTreasuryState.fetch(treasuryState);
    expect(treasury.pending.length).to.equal(1);
    expect(treasury.claimable.toString()).to.equal("0");
    expect(treasury.lifetimeClaimed.toString()).to.equal("0");
  });

  // ----------------------- 4. PDA isolation across deployments -----------------------
  it("deploying for a second token mint succeeds independently (PDA isolation)", async () => {
    const factoryConfig = deriveFactoryConfig(program.programId);
    const treasuryState = deriveBullTreasuryState(program.programId);
    const treasuryVault = getAssociatedTokenAddressSync(
      wbullMint,
      treasuryState,
      true,
    );

    const { collection, collectionMint, collectionAuthority } =
      deriveCollectionPdas(program.programId, frogMint);
    const { metadata, masterEdition } = deriveMetadataPdas(collectionMint);
    const deployerCollectionAta = getAssociatedTokenAddressSync(
      collectionMint,
      deployer.publicKey,
    );

    const args = {
      name: "WrappedPepe",
      ticker: "WPEPE",
      maxSupply: 420,
      tokensPerWrap: new anchor.BN(10_000_000),
      artSource: { rendererUrl: ["https://wrappedpepe.com/render?tier="] },
      collectionUri: "https://wrappedpepe.com/api/collection",
    };

    await program.methods
      .deployCollection(args as any)
      .preInstructions([CU_BUMP])
      .accounts({
        factoryConfig,
        bullTreasuryState: treasuryState,
        bullTreasuryVault: treasuryVault,
        deployer: deployer.publicKey,
        tokenMint: frogMint,
        wbullMint,
        deployerWbullAccount: deployerWbullAta,
        collection,
        collectionMint,
        collectionAuthority,
        deployerCollectionAta,
        collectionMetadata: metadata,
        collectionMasterEdition: masterEdition,
        tokenProgram: TOKEN_PROGRAM_ID,
        wbullTokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        tokenMetadataProgram: TOKEN_METADATA_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: SYSVAR_RENT_PUBKEY,
      })
      .signers([deployer])
      .rpc();

    // Treasury now has 2M $WBULL total (1M from doge + 1M from pepe).
    const vault = await getAccount(provider.connection, treasuryVault);
    expect(vault.amount.toString()).to.equal((BigInt(2) * ONE_MILLION_TOKENS).toString());

    // BullTreasuryState pending has 2 entries.
    const treasury = await program.account.bullTreasuryState.fetch(treasuryState);
    expect(treasury.pending.length).to.equal(2);

    // FactoryConfig deployments == 2.
    const cfg = await program.account.factoryConfig.fetch(factoryConfig);
    expect(cfg.totalDeployments).to.equal(2);
    expect(cfg.totalWbullDeposited.toString()).to.equal((BigInt(2) * ONE_MILLION_TOKENS).toString());

    // Both collection PDAs exist independently and store their own state.
    const dogeColl = await program.account.wrappedCollection.fetch(
      deriveCollectionPdas(program.programId, dogeMint).collection,
    );
    const pepeColl = await program.account.wrappedCollection.fetch(collection);
    expect(dogeColl.name).to.equal("WrappedDoge");
    expect(pepeColl.name).to.equal("WrappedPepe");
    expect(dogeColl.tokenMint.toBase58()).to.equal(dogeMint.toBase58());
    expect(pepeColl.tokenMint.toBase58()).to.equal(frogMint.toBase58());
  });

  // ----------------------- 5. deploy_collection rejects insufficient $WBULL -----------------------
  it("deploy_collection rejects when deployer's $WBULL balance is < 1M", async () => {
    // The deployer started with 3M and used 2M for the two successful
    // deploys above. Remaining balance is 1M exactly. Drain to below 1M
    // first so the third deploy hits InsufficientWbullForBurn.

    // Sanity: confirm the current balance.
    const before = await getAccount(provider.connection, deployerWbullAta);
    expect(before.amount.toString()).to.equal(ONE_MILLION_TOKENS.toString());

    // Move 1 token out so balance drops below 1M.
    const drainTarget = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      authority.payer,
      wbullMint,
      authority.publicKey,
    );
    const { transfer } = await import("@solana/spl-token");
    await transfer(
      provider.connection,
      authority.payer,
      deployerWbullAta,
      drainTarget.address,
      deployer,
      1,
    );

    // Create a third fake token to deploy against.
    const shibMint = await createMint(
      provider.connection,
      authority.payer,
      authority.publicKey,
      null,
      TOKEN_DECIMALS,
    );

    const factoryConfig = deriveFactoryConfig(program.programId);
    const treasuryState = deriveBullTreasuryState(program.programId);
    const treasuryVault = getAssociatedTokenAddressSync(
      wbullMint,
      treasuryState,
      true,
    );
    const { collection, collectionMint, collectionAuthority } =
      deriveCollectionPdas(program.programId, shibMint);
    const { metadata, masterEdition } = deriveMetadataPdas(collectionMint);
    const deployerCollectionAta = getAssociatedTokenAddressSync(
      collectionMint,
      deployer.publicKey,
    );

    const args = {
      name: "WrappedShib",
      ticker: "WSHIB",
      maxSupply: 300,
      tokensPerWrap: new anchor.BN(5_000_000),
      artSource: { baseUri: ["https://wrappedshib.com/api/m/"] },
      collectionUri: "https://wrappedshib.com/api/collection",
    };

    let errMsg = "";
    try {
      await program.methods
        .deployCollection(args as any)
        .preInstructions([CU_BUMP])
        .accounts({
          factoryConfig,
          bullTreasuryState: treasuryState,
          bullTreasuryVault: treasuryVault,
          deployer: deployer.publicKey,
          tokenMint: shibMint,
          wbullMint,
          deployerWbullAccount: deployerWbullAta,
          collection,
          collectionMint,
          collectionAuthority,
          deployerCollectionAta,
          collectionMetadata: metadata,
          collectionMasterEdition: masterEdition,
          tokenProgram: TOKEN_PROGRAM_ID,
          wbullTokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          tokenMetadataProgram: TOKEN_METADATA_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          rent: SYSVAR_RENT_PUBKEY,
        })
        .signers([deployer])
        .rpc();
    } catch (e: any) {
      errMsg = e.toString();
    }
    expect(errMsg).to.contain("InsufficientWbullForBurn");

    // Treasury balance unchanged from the prior test.
    const vault = await getAccount(provider.connection, treasuryVault);
    expect(vault.amount.toString()).to.equal((BigInt(2) * ONE_MILLION_TOKENS).toString());
  });
});

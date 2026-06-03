// Bankrun-based test for the claim_treasury success path.
//
// The standard anchor test runner uses solana-test-validator, which can't
// warp clock. The PENDING_LOCK_SECONDS window is 7 days, so reaching the
// success path on the standard validator means a 7-day sleep — impractical.
// Bankrun's in-process validator exposes setClock, so we deposit into the
// treasury via the real deploy_collection flow, fast-forward 8 days, then
// call claim_treasury and verify the full sweep + drain + PDA-signed
// transfer_checked CPI lands the 1M $WBULL in the destination ATA.
//
// SPL Token + SPL ATA are preloaded by solana-bankrun; Metaplex Token
// Metadata is loaded from tests/fixtures/mpl_token_metadata.so (dumped
// once from mainnet via `solana program dump`).
//
// IMPORTANT: bankrun's BankrunConnection only implements a subset of the
// web3.js Connection API. spl-token helpers like createMint(), mintTo(),
// getOrCreateAssociatedTokenAccount() call connection.sendTransaction()
// which BankrunConnection doesn't expose. So we build every tx with raw
// instruction helpers and send via provider.sendAndConfirm.

import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import {
  PublicKey,
  Keypair,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
  ComputeBudgetProgram,
  Transaction,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  MINT_SIZE,
  ACCOUNT_SIZE,
  createInitializeMint2Instruction,
  createMintToInstruction,
  createAssociatedTokenAccountInstruction,
  getAssociatedTokenAddressSync,
  AccountLayout,
} from "@solana/spl-token";
import { startAnchor, BankrunProvider } from "anchor-bankrun";
import { Clock } from "solana-bankrun";
import { expect } from "chai";
import { Wrappedfactory } from "../target/types/wrappedfactory";
import * as fs from "fs";
import * as path from "path";

const BPF_LOADER_UPGRADEABLE_ID = new PublicKey(
  "BPFLoaderUpgradeab1e11111111111111111111111",
);

// Make wrappedfactory look BPF-Loader-Upgradeable to Anchor's
// program_data constraint check. bankrun loads SBF programs as
// non-upgradeable by default, so claim_treasury's
// `program.programdata_address()? == Some(program_data.key())` fails
// with AccountNotInitialized. We synthesize both accounts here.
function buildUpgradeableLoaderAccounts(
  context: any,
  programId: PublicKey,
  upgradeAuthority: PublicKey,
  bytecode: Buffer,
) {
  const [programDataAddress] = PublicKey.findProgramAddressSync(
    [programId.toBuffer()],
    BPF_LOADER_UPGRADEABLE_ID,
  );

  // ProgramData layout:
  //   tag(u32 LE = 3) | slot(u64 LE) | option_tag(u8 = 1) | authority(32B) | bytecode
  const header = Buffer.alloc(4 + 8 + 1 + 32);
  header.writeUInt32LE(3, 0);
  header.writeBigUInt64LE(0n, 4);
  header.writeUInt8(1, 12);
  upgradeAuthority.toBuffer().copy(header, 13);
  const programDataBytes = Buffer.concat([header, bytecode]);

  context.setAccount(programDataAddress, {
    lamports: 10_000_000_000,
    data: programDataBytes,
    owner: BPF_LOADER_UPGRADEABLE_ID,
    executable: false,
    rentEpoch: 0,
  });

  // Program layout (tag u32 LE = 2 | programdata_address 32B).
  const programAccount = Buffer.alloc(4 + 32);
  programAccount.writeUInt32LE(2, 0);
  programDataAddress.toBuffer().copy(programAccount, 4);

  context.setAccount(programId, {
    lamports: 1_000_000_000,
    data: programAccount,
    owner: BPF_LOADER_UPGRADEABLE_ID,
    executable: true,
    rentEpoch: 0,
  });

  return programDataAddress;
}

const TOKEN_METADATA_PROGRAM_ID = new PublicKey(
  "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s",
);
const CU_BUMP = ComputeBudgetProgram.setComputeUnitLimit({ units: 600_000 });
const ONE_MILLION_TOKENS = BigInt("1000000000000");
const TOKEN_DECIMALS = 6;
const PENDING_LOCK_SECONDS = 7 * 24 * 60 * 60;
// Pre-computed for the test cluster's default Rent::default(). MINT_SIZE=82
// → ~1.461M lamports; we use a comfortable round number.
const MINT_RENT_LAMPORTS = 1_500_000;

function deriveFactoryConfig(programId: PublicKey) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("factory_config")],
    programId,
  )[0];
}
function deriveBullTreasuryState(programId: PublicKey) {
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

describe("wrappedfactory claim_treasury success path (bankrun)", () => {
  let context: Awaited<ReturnType<typeof startAnchor>>;
  let provider: BankrunProvider;
  let program: Program<Wrappedfactory>;
  let authority: anchor.Wallet;
  const wbullMintKp = Keypair.generate();
  const dogeMintKp = Keypair.generate();
  const deployer = Keypair.generate();

  async function createMintTx(
    mintKp: Keypair,
    mintAuthority: PublicKey,
  ): Promise<void> {
    const tx = new Transaction().add(
      SystemProgram.createAccount({
        fromPubkey: authority.publicKey,
        newAccountPubkey: mintKp.publicKey,
        space: MINT_SIZE,
        lamports: MINT_RENT_LAMPORTS,
        programId: TOKEN_PROGRAM_ID,
      }),
      createInitializeMint2Instruction(
        mintKp.publicKey,
        TOKEN_DECIMALS,
        mintAuthority,
        null,
      ),
    );
    await provider.sendAndConfirm!(tx, [mintKp]);
  }

  async function createAtaAndMintTx(
    mint: PublicKey,
    owner: PublicKey,
    amount: bigint,
  ): Promise<PublicKey> {
    const ata = getAssociatedTokenAddressSync(mint, owner);
    const tx = new Transaction().add(
      createAssociatedTokenAccountInstruction(
        authority.publicKey,
        ata,
        owner,
        mint,
      ),
      createMintToInstruction(
        mint,
        ata,
        authority.publicKey,
        amount,
      ),
    );
    await provider.sendAndConfirm!(tx);
    return ata;
  }

  before(async () => {
    // Metaplex Token Metadata isn't in bankrun's built-in program set; load
    // its .so from the fixtures directory (one-time dump from mainnet).
    context = await startAnchor(
      "",
      [
        {
          name: "mpl_token_metadata",
          programId: TOKEN_METADATA_PROGRAM_ID,
        } as any,
      ],
      [],
    );
    provider = new BankrunProvider(context);
    // anchor-bankrun 0.5.0 calls wallet.signTransaction(tx) without
    // awaiting, so anchor 0.32's async NodeWallet.signTransaction never
    // applies its signature before tx.serialize() runs — fails with
    // "Missing signature for public key [walletPubkey]". Override with a
    // synchronous partialSign so the wallet signature lands in time.
    const walletPayer = (provider.wallet as anchor.Wallet).payer;
    (provider.wallet as any).signTransaction = (tx: any) => {
      tx.partialSign(walletPayer);
      return tx;
    };
    anchor.setProvider(provider);
    // Construct Program directly off the IDL rather than via
    // anchor.workspace — workspace caches the Program with whatever
    // provider was active on first access, and the earlier test files
    // already bound it to the default AnchorProvider.
    const idl = require("../target/idl/wrappedfactory.json");
    program = new Program(idl, provider) as Program<Wrappedfactory>;
    authority = provider.wallet as anchor.Wallet;

    // Make wrappedfactory look BPF-Loader-Upgradeable so claim_treasury's
    // upgrade-authority check passes. Without this, the program is loaded
    // as a non-upgradeable SBF account and the constraint fails.
    const bytecode = fs.readFileSync(
      path.join(__dirname, "..", "target", "deploy", "wrappedfactory.so"),
    );
    buildUpgradeableLoaderAccounts(
      context,
      program.programId,
      authority.publicKey,
      bytecode,
    );

    // Fund deployer.
    await provider.sendAndConfirm!(
      new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: authority.publicKey,
          toPubkey: deployer.publicKey,
          lamports: 5 * LAMPORTS_PER_SOL,
        }),
      ),
    );

    // Create the two mints + fund the deployer with 1M $WBULL.
    await createMintTx(wbullMintKp, authority.publicKey);
    await createMintTx(dogeMintKp, authority.publicKey);
    await createAtaAndMintTx(
      wbullMintKp.publicKey,
      deployer.publicKey,
      ONE_MILLION_TOKENS,
    );
  });

  it("claim_treasury succeeds after PENDING_LOCK_SECONDS elapses", async () => {
    const wbullMint = wbullMintKp.publicKey;
    const dogeMint = dogeMintKp.publicKey;
    const factoryConfig = deriveFactoryConfig(program.programId);
    const treasuryState = deriveBullTreasuryState(program.programId);
    const treasuryVault = getAssociatedTokenAddressSync(
      wbullMint,
      treasuryState,
      true,
    );
    const programDataAddress = PublicKey.findProgramAddressSync(
      [program.programId.toBuffer()],
      new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111"),
    )[0];
    const deployerWbullAta = getAssociatedTokenAddressSync(
      wbullMint,
      deployer.publicKey,
    );

    // --- 1. initialize ---
    await program.methods
      .initialize(wbullMint)
      .accounts({
        factoryConfig,
        bullTreasuryState: treasuryState,
        wbullMint,
        bullTreasuryVault: treasuryVault,
        authority: authority.publicKey,
        program: program.programId,
        programData: programDataAddress,
        wbullTokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    // --- 2. deploy_collection: real flow deposits 1M into treasury ---
    const { collection, collectionMint, collectionAuthority } =
      deriveCollectionPdas(program.programId, dogeMint);
    const { metadata, masterEdition } = deriveMetadataPdas(collectionMint);
    const deployerCollectionAta = getAssociatedTokenAddressSync(
      collectionMint,
      deployer.publicKey,
    );

    await program.methods
      .deployCollection({
        name: "WrappedDoge",
        ticker: "WDOGE",
        maxSupply: 500,
        tokensPerWrap: new anchor.BN(5_000_000),
        artSource: { baseUri: ["https://wrappeddoge.com/api/m/"] },
        collectionUri: "https://wrappeddoge.com/api/collection",
      } as any)
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

    // Verify the deposit landed in the vault.
    const vaultPreClaim = await context.banksClient.getAccount(treasuryVault);
    expect(vaultPreClaim).to.not.equal(null);
    const vaultPreData = AccountLayout.decode(vaultPreClaim!.data);
    expect(vaultPreData.amount.toString()).to.equal(
      ONE_MILLION_TOKENS.toString(),
    );

    // --- 3. Fast-forward clock past the 7-day deposit lock ---
    const currentClock = await context.banksClient.getClock();
    const futureUnixTimestamp =
      currentClock.unixTimestamp + BigInt(PENDING_LOCK_SECONDS + 1);
    context.setClock(
      new Clock(
        currentClock.slot,
        currentClock.epochStartTimestamp,
        currentClock.epoch,
        currentClock.leaderScheduleEpoch,
        futureUnixTimestamp,
      ),
    );

    // --- 4. Set up destination ATA for the multisig sweep ---
    const destinationAta = getAssociatedTokenAddressSync(
      wbullMint,
      authority.publicKey,
    );
    await provider.sendAndConfirm!(
      new Transaction().add(
        createAssociatedTokenAccountInstruction(
          authority.publicKey,
          destinationAta,
          authority.publicKey,
          wbullMint,
        ),
      ),
    );

    // --- 5. claim_treasury ---
    await program.methods
      .claimTreasury()
      .accounts({
        factoryConfig,
        bullTreasuryState: treasuryState,
        wbullMint,
        bullTreasuryVault: treasuryVault,
        destinationWbullAccount: destinationAta,
        authority: authority.publicKey,
        program: program.programId,
        programData: programDataAddress,
        wbullTokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();

    // --- 6. Verify destination received exactly 1M $WBULL ---
    const destinationRaw = await context.banksClient.getAccount(destinationAta);
    expect(destinationRaw).to.not.equal(null);
    const destinationData = AccountLayout.decode(destinationRaw!.data);
    expect(destinationData.amount.toString()).to.equal(
      ONE_MILLION_TOKENS.toString(),
    );

    // --- 7. Treasury vault is drained ---
    const vaultPostRaw = await context.banksClient.getAccount(treasuryVault);
    const vaultPostData = AccountLayout.decode(vaultPostRaw!.data);
    expect(vaultPostData.amount.toString()).to.equal("0");

    // --- 8. On-chain state: pending cleared, claimable zero, lifetime tracked ---
    const treasury = await program.account.bullTreasuryState.fetch(
      treasuryState,
    );
    expect(treasury.pending.length).to.equal(0);
    expect(treasury.claimable.toString()).to.equal("0");
    expect(treasury.lifetimeDeposited.toString()).to.equal(
      ONE_MILLION_TOKENS.toString(),
    );
    expect(treasury.lifetimeClaimed.toString()).to.equal(
      ONE_MILLION_TOKENS.toString(),
    );
  });
});

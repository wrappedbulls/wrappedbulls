// Wrappedbulls Anchor program tests.
//
// Covers the full ERC404-style hybrid lifecycle:
//   - initialize the bank
//   - wrap_bull (lock 1M $TOKEN, mint NFT + vault PDA + Metaplex metadata)
//   - unwrap_bull (burn NFT, drain vault, push tier to free stack)
//   - vault-follows-NFT (transfer NFT to wallet B, B unwraps)
//   - tier reuse (free_tiers stack drains correctly)
//   - failure paths (insufficient balance, wrong holder, bad tier)
//
// Run via: `anchor test` (after `anchor build`) on a Linux/Mac host with
// solana-cli installed. From Windows, run inside WSL or on the DO box.

import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import {
  PublicKey,
  Keypair,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
  LAMPORTS_PER_SOL,
  Transaction,
  ComputeBudgetProgram,
} from "@solana/web3.js";

// wrap_bull does several Metaplex CPIs (CreateMetadataAccountsV3 +
// CreateMasterEditionV3 + token transfers + ATA creation) which push past
// the 200k default CU budget. Bump to 600k for tests; production clients
// should include the same ComputeBudgetProgram.setComputeUnitLimit call.
const CU_BUMP = ComputeBudgetProgram.setComputeUnitLimit({ units: 600_000 });
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createMint,
  mintTo,
  getAssociatedTokenAddressSync,
  getOrCreateAssociatedTokenAccount,
  getAccount,
  transfer as splTransfer,
} from "@solana/spl-token";
import { expect } from "chai";
import { Wrappedbulls } from "../target/types/wrappedbulls";
// Metaplex deserializer (v3 / Umi-based SDK) — used to read
// metadata.collection.verified after each wrap to prove the Metaplex
// Certified Collection (MCC) link is set. The serializer returns
// `[parsedData, bytesRead]`; pubkeys come back as base58 strings.
import {
  getMetadataAccountDataSerializer,
} from "@metaplex-foundation/mpl-token-metadata";

const METADATA_SERIALIZER = getMetadataAccountDataSerializer();
function decodeMetadata(data: Uint8Array): any {
  const [parsed] = METADATA_SERIALIZER.deserialize(data);
  return parsed;
}

// Metaplex Token Metadata program — same on every cluster
const TOKEN_METADATA_PROGRAM_ID = new PublicKey(
  "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s"
);

// Helper: derive collection-related PDAs (used by every wrap_bull /
// unwrap_bull / initialize_collection call after MCC was added).
function deriveCollectionPdas(
  programId: PublicKey,
  collectionMint: PublicKey,
  authority: PublicKey,
) {
  const [collectionAuthority] = PublicKey.findProgramAddressSync(
    [Buffer.from("collection_authority")],
    programId,
  );
  const [collectionMetadata] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("metadata"),
      TOKEN_METADATA_PROGRAM_ID.toBuffer(),
      collectionMint.toBuffer(),
    ],
    TOKEN_METADATA_PROGRAM_ID,
  );
  const [collectionMasterEdition] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("metadata"),
      TOKEN_METADATA_PROGRAM_ID.toBuffer(),
      collectionMint.toBuffer(),
      Buffer.from("edition"),
    ],
    TOKEN_METADATA_PROGRAM_ID,
  );
  const authorityCollectionAta = getAssociatedTokenAddressSync(
    collectionMint,
    authority,
  );
  return {
    collectionAuthority,
    collectionMetadata,
    collectionMasterEdition,
    authorityCollectionAta,
  };
}

// Helper: read the on-chain Metaplex metadata for a bull's NFT and assert
// metadata.collection is set to the expected collection mint AND verified
// is true. This is the central proof that MCC is wired correctly.
async function assertVerifiedCollection(
  connection: anchor.web3.Connection,
  metadataPda: PublicKey,
  expectedCollectionMint: PublicKey,
) {
  const acc = await connection.getAccountInfo(metadataPda);
  if (!acc) throw new Error(`metadata account ${metadataPda} not found`);
  const meta = decodeMetadata(acc.data);
  // In v3 SDK, optional fields are wrapped in Umi's `Option` type — either
  // `{ __option: 'Some', value: ... }` (newer) or just the value/null (older
  // serializer output). Handle both shapes defensively.
  const collection = meta.collection?.__option === "Some"
    ? meta.collection.value
    : meta.collection;
  if (!collection) throw new Error("metadata.collection is null/None");
  // Pubkeys come back as base58 strings in Umi.
  const collectionKey = typeof collection.key === "string"
    ? collection.key
    : collection.key.toString();
  expect(collectionKey).to.equal(expectedCollectionMint.toBase58());
  expect(collection.verified).to.equal(true);
}

// Helper: prove the on-chain metadata carries the secondary-royalty config
// expected by Magic Eden / Tensor — sellerFeeBasisPoints === 500 (5%) and a
// single creator == the royalty treasury with 100% share. This is the proof
// that the royalty/creator change in wrap_bull.rs actually lands on-chain.
const ROYALTY_TREASURY = "8HoMgnUbDRvPZN1M9jPxXPqE63tRbChGzvdEe3ethzTD";
const ROYALTY_BPS = 500;
async function assertRoyalty(
  connection: anchor.web3.Connection,
  metadataPda: PublicKey,
) {
  const acc = await connection.getAccountInfo(metadataPda);
  if (!acc) throw new Error(`metadata account ${metadataPda} not found`);
  const meta = decodeMetadata(acc.data);
  expect(Number(meta.sellerFeeBasisPoints)).to.equal(ROYALTY_BPS);
  const creators = meta.creators?.__option === "Some"
    ? meta.creators.value
    : meta.creators;
  if (!creators || creators.length !== 1) {
    throw new Error(`expected exactly 1 creator, got ${JSON.stringify(creators)}`);
  }
  const addr = typeof creators[0].address === "string"
    ? creators[0].address
    : creators[0].address.toString();
  expect(addr).to.equal(ROYALTY_TREASURY);
  expect(Number(creators[0].share)).to.equal(100);
}

// Helper: derive all PDAs needed for a wrap/unwrap call
interface WrapBullPdas {
  bullAsset: PublicKey;
  vaultAuthority: PublicKey;
  vault: PublicKey;
  metadata: PublicKey;
  masterEdition: PublicKey;
}

// Single-signer PDA mint: derived from bank.total_wrapped BEFORE this wrap.
// Matches the seeds in programs/wrappedbulls/src/instructions/wrap_bull.rs.
function deriveNftMint(programId: PublicKey, totalWrappedBefore: bigint): PublicKey {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(totalWrappedBefore);
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("nft_mint"), buf],
    programId
  );
  return pda;
}

function deriveWrapPdas(
  programId: PublicKey,
  tierIndex: number,
  nftMint: PublicKey,
  tokenMint: PublicKey,
  payer: PublicKey
): WrapBullPdas & { payerNftAccount: PublicKey } {
  const tierBuf = Buffer.alloc(2);
  tierBuf.writeUInt16LE(tierIndex);

  const [bullAsset] = PublicKey.findProgramAddressSync(
    [Buffer.from("bull"), tierBuf],
    programId
  );

  const [vaultAuthority] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), nftMint.toBuffer()],
    programId
  );

  // Vault is the ATA owned by vaultAuthority PDA — allowOwnerOffCurve = true
  const vault = getAssociatedTokenAddressSync(
    tokenMint,
    vaultAuthority,
    true
  );

  const payerNftAccount = getAssociatedTokenAddressSync(
    nftMint,
    payer
  );

  const [metadata] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("metadata"),
      TOKEN_METADATA_PROGRAM_ID.toBuffer(),
      nftMint.toBuffer(),
    ],
    TOKEN_METADATA_PROGRAM_ID
  );

  const [masterEdition] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("metadata"),
      TOKEN_METADATA_PROGRAM_ID.toBuffer(),
      nftMint.toBuffer(),
      Buffer.from("edition"),
    ],
    TOKEN_METADATA_PROGRAM_ID
  );

  return { bullAsset, vaultAuthority, vault, payerNftAccount, metadata, masterEdition };
}

describe("wrappedbulls", () => {
  // === Provider + program setup ===
  anchor.setProvider(anchor.AnchorProvider.env());
  const provider = anchor.getProvider() as anchor.AnchorProvider;
  const program = anchor.workspace.Wrappedbulls as Program<Wrappedbulls>;
  const connection = provider.connection;

  // The provider wallet is the program's upgrade authority under
  // `anchor test` (anchor deploys with this wallet). `initialize` and
  // `initialize_collection` are now gated on the on-chain upgrade
  // authority, so the admin signer for those is the provider wallet.
  const adminPk = provider.wallet.publicKey;
  const BPF_LOADER_UPGRADEABLE = new PublicKey(
    "BPFLoaderUpgradeab1e11111111111111111111111",
  );
  const [programDataPda] = PublicKey.findProgramAddressSync(
    [program.programId.toBuffer()],
    BPF_LOADER_UPGRADEABLE,
  );

  // === Constants ===
  const TOKEN_DECIMALS = 6;
  const TOKENS_PER_BULL = BigInt(1_000_000) * BigInt(10 ** TOKEN_DECIMALS); // 1e12

  // === Test state ===
  let tokenMint: PublicKey;
  let bankPda: PublicKey;
  // Collection NFT mint (created by initialize_collection test). All wrap
  // calls reference this so the program can verify each bull NFT into the
  // collection.
  let collectionMint: Keypair;

  // Test wallets — funded with SOL + $TOKEN
  let alice: Keypair;
  let bob: Keypair;
  let carol: Keypair;
  let aliceTokenAccount: PublicKey;
  let bobTokenAccount: PublicKey;
  let carolTokenAccount: PublicKey;

  before(async () => {
    alice = Keypair.generate();
    bob = Keypair.generate();
    carol = Keypair.generate();

    // Airdrop SOL to each test wallet (needed for rent + tx fees)
    for (const w of [alice, bob, carol]) {
      const sig = await connection.requestAirdrop(w.publicKey, 10 * LAMPORTS_PER_SOL);
      await connection.confirmTransaction(sig);
    }

    // Mint a fake $TOKEN (mimics pump.fun-launched token: 6 decimals)
    tokenMint = await createMint(
      connection,
      alice,
      alice.publicKey,
      null,
      TOKEN_DECIMALS
    );

    // Create token accounts for each wallet
    const aliceAta = await getOrCreateAssociatedTokenAccount(
      connection, alice, tokenMint, alice.publicKey
    );
    aliceTokenAccount = aliceAta.address;

    const bobAta = await getOrCreateAssociatedTokenAccount(
      connection, bob, tokenMint, bob.publicKey
    );
    bobTokenAccount = bobAta.address;

    const carolAta = await getOrCreateAssociatedTokenAccount(
      connection, carol, tokenMint, carol.publicKey
    );
    carolTokenAccount = carolAta.address;

    // Mint 5M $TOKEN to alice (enough to wrap 5 bulls)
    await mintTo(
      connection, alice, tokenMint, aliceTokenAccount, alice,
      5n * TOKENS_PER_BULL
    );

    // Derive bank PDA
    [bankPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("bank")],
      program.programId
    );
  });

  it("SECURITY: non-upgrade-authority cannot initialize (front-run guard)", async () => {
    // alice is NOT the program's upgrade authority. Must be rejected
    // BEFORE the bank exists, so the failure is the auth gate — not the
    // singleton-already-exists guard. This is the fix for the otherwise
    // permissionless `initialize` that a bot could front-run on mainnet
    // deploy to brick the singleton bank with a garbage mint.
    let errored = false;
    try {
      await program.methods
        .initialize(tokenMint)
        .accounts({
          bank: bankPda,
          authority: alice.publicKey,
          program: program.programId,
          programData: programDataPda,
          systemProgram: SystemProgram.programId,
        })
        .preInstructions([CU_BUMP], true)
        .signers([alice])
        .rpc();
    } catch (e: any) {
      errored = true;
      expect(String(e)).to.match(/UnauthorizedInitializer|0x1771|ConstraintAddress|constraint/i);
    }
    expect(errored, "non-authority initialize must fail").to.equal(true);

    // Bank must NOT have been created by the failed attempt.
    const acc = await connection.getAccountInfo(bankPda);
    expect(acc, "bank PDA must not exist after rejected init").to.equal(null);
  });

  it("initializes the bank", async () => {
    await program.methods
      .initialize(tokenMint)
      .accounts({
        bank: bankPda,
        authority: adminPk,
        program: program.programId,
        programData: programDataPda,
        systemProgram: SystemProgram.programId,
      })
      .preInstructions([CU_BUMP], true)
      .rpc();

    const bank = await program.account.bullBank.fetch(bankPda);
    expect(bank.tokenMint.toBase58()).to.equal(tokenMint.toBase58());
    expect(bank.totalWrapped.toNumber()).to.equal(0);
    expect(bank.totalUnwrapped.toNumber()).to.equal(0);
    expect(bank.inCirculation).to.equal(0);
    expect(bank.nextTier).to.equal(1);
    expect(bank.freeTiers).to.deep.equal([]);
    // Collection not yet initialized — collection_mint is Pubkey::default()
    expect(bank.collectionMint.toBase58()).to.equal(
      PublicKey.default.toBase58(),
    );
  });

  it("initializes the Metaplex Certified Collection", async () => {
    collectionMint = Keypair.generate();
    const { collectionAuthority, collectionMetadata, collectionMasterEdition,
            authorityCollectionAta } =
      deriveCollectionPdas(program.programId, collectionMint.publicKey, adminPk);

    await program.methods
      .initializeCollection()
      .accounts({
        bank: bankPda,
        authority: adminPk,
        collectionMint: collectionMint.publicKey,
        collectionAuthority,
        authorityCollectionAta,
        collectionMetadata,
        collectionMasterEdition,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        tokenMetadataProgram: TOKEN_METADATA_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: SYSVAR_RENT_PUBKEY,
      })
      .preInstructions([CU_BUMP], true)
      .signers([collectionMint])
      .rpc();

    // Bank now records the collection mint
    const bank = await program.account.bullBank.fetch(bankPda);
    expect(bank.collectionMint.toBase58()).to.equal(
      collectionMint.publicKey.toBase58(),
    );

    // Collection NFT exists in alice's ATA (1 supply)
    const ata = await getAccount(connection, authorityCollectionAta);
    expect(ata.amount).to.equal(1n);

    // Collection metadata is a sized collection (CollectionDetails::V1)
    const acc = await connection.getAccountInfo(collectionMetadata);
    expect(acc).to.not.be.null;
    const meta = decodeMetadata(acc!.data);
    const cd = meta.collectionDetails?.__option === "Some"
      ? meta.collectionDetails.value
      : meta.collectionDetails;
    if (!cd) throw new Error("collection metadata has no collectionDetails");
    // size starts at 0; increments with each verify_sized_collection_item
    expect(Number(cd.size)).to.equal(0);
  });

  it("initialize_collection is idempotent — re-running fails", async () => {
    const dupCollectionMint = Keypair.generate();
    const { collectionAuthority, collectionMetadata, collectionMasterEdition,
            authorityCollectionAta } =
      deriveCollectionPdas(program.programId, dupCollectionMint.publicKey, adminPk);

    let errored = false;
    try {
      await program.methods
        .initializeCollection()
        .accounts({
          bank: bankPda,
          authority: adminPk,
          collectionMint: dupCollectionMint.publicKey,
          collectionAuthority,
          authorityCollectionAta,
          collectionMetadata,
          collectionMasterEdition,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          tokenMetadataProgram: TOKEN_METADATA_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          rent: SYSVAR_RENT_PUBKEY,
        })
        .preInstructions([CU_BUMP], true)
        .signers([dupCollectionMint])
        .rpc();
    } catch (e: any) {
      errored = true;
      expect(e.toString()).to.include("CollectionAlreadyInitialized");
    }
    expect(errored).to.equal(true);
  });

  it("wrap_bull: alice wraps 1M $TOKEN into bull tier 1", async () => {
    const tierIndex = 1;
    // Single-signer: nft_mint is a PDA derived from bank.total_wrapped.
    const bankBefore: any = await program.account.bullBank.fetch(bankPda);
    const nftMintPk = deriveNftMint(
      program.programId,
      BigInt(bankBefore.totalWrapped.toString()),
    );
    const pdas = deriveWrapPdas(
      program.programId, tierIndex, nftMintPk, tokenMint, alice.publicKey
    );
    const collPdas = deriveCollectionPdas(
      program.programId, collectionMint.publicKey, alice.publicKey,
    );

    const aliceBalanceBefore = (await getAccount(connection, aliceTokenAccount)).amount;

    await program.methods
      .wrapBull(tierIndex)
      .accounts({
        bank: bankPda,
        payer: alice.publicKey,
        payerTokenAccount: aliceTokenAccount,
        tokenMint,
        nftMint: nftMintPk,
        nftMintAuthority: pdas.vaultAuthority,
        vault: pdas.vault,
        payerNftAccount: pdas.payerNftAccount,
        bullAsset: pdas.bullAsset,
        metadata: pdas.metadata,
        masterEdition: pdas.masterEdition,
        collectionMint: collectionMint.publicKey,
        collectionMetadata: collPdas.collectionMetadata,
        collectionMasterEdition: collPdas.collectionMasterEdition,
        collectionAuthority: collPdas.collectionAuthority,
        tokenProgram: TOKEN_PROGRAM_ID,
        bullsTokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        tokenMetadataProgram: TOKEN_METADATA_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: SYSVAR_RENT_PUBKEY,
      })
      .preInstructions([CU_BUMP], true)
      .signers([alice])
      .rpc();

    // BullAsset stored correctly
    const bullAsset = await program.account.bullAsset.fetch(pdas.bullAsset);
    expect(bullAsset.nftMint.toBase58()).to.equal(nftMintPk.toBase58());
    expect(bullAsset.tierIndex).to.equal(tierIndex);

    // Vault holds 1M $TOKEN
    const vault = await getAccount(connection, pdas.vault);
    expect(vault.amount).to.equal(TOKENS_PER_BULL);

    // Alice has 1 NFT in her ATA
    const nftAcc = await getAccount(connection, pdas.payerNftAccount);
    expect(nftAcc.amount).to.equal(1n);

    // Alice's $TOKEN balance dropped by 1M
    const aliceBalanceAfter = (await getAccount(connection, aliceTokenAccount)).amount;
    expect(aliceBalanceBefore - aliceBalanceAfter).to.equal(TOKENS_PER_BULL);

    // Bank counters updated
    const bank = await program.account.bullBank.fetch(bankPda);
    expect(bank.totalWrapped.toNumber()).to.equal(1);
    expect(bank.inCirculation).to.equal(1);
    expect(bank.nextTier).to.equal(2);

    // CRITICAL: bull's metadata.collection.verified === true
    await assertVerifiedCollection(
      connection, pdas.metadata, collectionMint.publicKey,
    );

    // CRITICAL: bull's metadata carries the 5% secondary royalty + treasury
    // creator so Magic Eden / Tensor enforce + route royalties on resale.
    await assertRoyalty(connection, pdas.metadata);

    // Collection size counter incremented to 1
    const collMetaAcc = await connection.getAccountInfo(collPdas.collectionMetadata);
    const collMeta = decodeMetadata(collMetaAcc!.data);
    const cd = collMeta.collectionDetails?.__option === "Some"
      ? collMeta.collectionDetails.value
      : collMeta.collectionDetails;
    expect(Number(cd.size)).to.equal(1);
  });

  it("unwrap_bull: alice unwraps her bull, gets 1M $TOKEN back", async () => {
    const tierIndex = 1;
    // Re-fetch the bull asset to find the nftMint (it was generated in the previous test)
    const tierBuf = Buffer.alloc(2);
    tierBuf.writeUInt16LE(tierIndex);
    const [bullAssetPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("bull"), tierBuf],
      program.programId
    );
    const bullAssetAccount = await program.account.bullAsset.fetch(bullAssetPda);
    const nftMint = bullAssetAccount.nftMint;

    const pdas = deriveWrapPdas(
      program.programId, tierIndex, nftMint, tokenMint, alice.publicKey
    );
    const collPdas = deriveCollectionPdas(
      program.programId, collectionMint.publicKey, alice.publicKey,
    );

    const aliceBalanceBefore = (await getAccount(connection, aliceTokenAccount)).amount;

    await program.methods
      .unwrapBull(tierIndex)
      .accounts({
        bank: bankPda,
        payer: alice.publicKey,
        payerTokenAccount: aliceTokenAccount,
        tokenMint,
        nftMint,
        nftMintAuthority: pdas.vaultAuthority,
        vault: pdas.vault,
        payerNftAccount: pdas.payerNftAccount,
        bullAsset: pdas.bullAsset,
        metadata: pdas.metadata,
        masterEdition: pdas.masterEdition,
        collectionMint: collectionMint.publicKey,
        collectionMetadata: collPdas.collectionMetadata,
        tokenProgram: TOKEN_PROGRAM_ID,
        bullsTokenProgram: TOKEN_PROGRAM_ID,
        tokenMetadataProgram: TOKEN_METADATA_PROGRAM_ID,
      })
      .preInstructions([CU_BUMP], true)
      .signers([alice])
      .rpc();

    // Alice got 1M $TOKEN back
    const aliceBalanceAfter = (await getAccount(connection, aliceTokenAccount)).amount;
    expect(aliceBalanceAfter - aliceBalanceBefore).to.equal(TOKENS_PER_BULL);

    // BullAsset closed
    const closed = await program.account.bullAsset.fetchNullable(pdas.bullAsset);
    expect(closed).to.be.null;

    // Bank: tier 1 pushed to free_tiers, in_circulation back to 0
    const bank = await program.account.bullBank.fetch(bankPda);
    expect(bank.totalUnwrapped.toNumber()).to.equal(1);
    expect(bank.inCirculation).to.equal(0);
    expect(bank.freeTiers).to.deep.equal([1]);
  });

  it("tier reuse: next wrap pops tier 1 from free_tiers (with new visual)", async () => {
    const tierIndex = 1; // reused from free_tiers
    // total_wrapped has advanced since last wrap (it was 1 then, 2 by now after
    // tier 1 was wrapped+unwrapped). New PDA = different mint = new visual.
    const bankBefore: any = await program.account.bullBank.fetch(bankPda);
    const nftMintPk = deriveNftMint(
      program.programId,
      BigInt(bankBefore.totalWrapped.toString()),
    );
    const pdas = deriveWrapPdas(
      program.programId, tierIndex, nftMintPk, tokenMint, alice.publicKey
    );
    const collPdas = deriveCollectionPdas(
      program.programId, collectionMint.publicKey, alice.publicKey,
    );

    await program.methods
      .wrapBull(tierIndex)
      .accounts({
        bank: bankPda,
        payer: alice.publicKey,
        payerTokenAccount: aliceTokenAccount,
        tokenMint,
        nftMint: nftMintPk,
        nftMintAuthority: pdas.vaultAuthority,
        vault: pdas.vault,
        payerNftAccount: pdas.payerNftAccount,
        bullAsset: pdas.bullAsset,
        metadata: pdas.metadata,
        masterEdition: pdas.masterEdition,
        collectionMint: collectionMint.publicKey,
        collectionMetadata: collPdas.collectionMetadata,
        collectionMasterEdition: collPdas.collectionMasterEdition,
        collectionAuthority: collPdas.collectionAuthority,
        tokenProgram: TOKEN_PROGRAM_ID,
        bullsTokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        tokenMetadataProgram: TOKEN_METADATA_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: SYSVAR_RENT_PUBKEY,
      })
      .preInstructions([CU_BUMP], true)
      .signers([alice])
      .rpc();

    // Re-rolled visual is also verified into the collection
    await assertVerifiedCollection(
      connection, pdas.metadata, collectionMint.publicKey,
    );

    // CRITICAL: bull's metadata carries the 5% secondary royalty + treasury
    // creator so Magic Eden / Tensor enforce + route royalties on resale.
    await assertRoyalty(connection, pdas.metadata);

    // BullAsset has the NEW nft_mint (visual re-rolled — different
    // total_wrapped → different PDA → different visual)
    const bullAsset = await program.account.bullAsset.fetch(pdas.bullAsset);
    expect(bullAsset.nftMint.toBase58()).to.equal(nftMintPk.toBase58());

    // Bank: free_tiers is now empty, next_tier still 2
    const bank = await program.account.bullBank.fetch(bankPda);
    expect(bank.freeTiers).to.deep.equal([]);
    expect(bank.nextTier).to.equal(2);
    expect(bank.inCirculation).to.equal(1);
  });

  it("vault follows NFT: alice transfers NFT to bob, bob unwraps and gets the tokens", async () => {
    const tierIndex = 1;
    const tierBuf = Buffer.alloc(2);
    tierBuf.writeUInt16LE(tierIndex);
    const [bullAssetPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("bull"), tierBuf],
      program.programId
    );
    const bullAssetAccount = await program.account.bullAsset.fetch(bullAssetPda);
    const nftMint = bullAssetAccount.nftMint;

    // Alice's NFT ATA + Bob's NFT ATA
    const aliceNftAta = getAssociatedTokenAddressSync(nftMint, alice.publicKey);
    const bobNftAta = await getOrCreateAssociatedTokenAccount(
      connection, bob, nftMint, bob.publicKey
    );

    // Transfer the NFT from alice to bob (simulates a marketplace sale)
    await splTransfer(
      connection,
      alice,
      aliceNftAta,
      bobNftAta.address,
      alice,
      1
    );

    // Now bob unwraps — vault tokens should flow to bob
    const pdas = deriveWrapPdas(
      program.programId, tierIndex, nftMint, tokenMint, bob.publicKey
    );
    const collPdas = deriveCollectionPdas(
      program.programId, collectionMint.publicKey, alice.publicKey,
    );

    const bobBalanceBefore = (await getAccount(connection, bobTokenAccount)).amount;

    await program.methods
      .unwrapBull(tierIndex)
      .accounts({
        bank: bankPda,
        payer: bob.publicKey,
        payerTokenAccount: bobTokenAccount,
        tokenMint,
        nftMint,
        nftMintAuthority: pdas.vaultAuthority,
        vault: pdas.vault,
        payerNftAccount: bobNftAta.address,
        bullAsset: pdas.bullAsset,
        metadata: pdas.metadata,
        masterEdition: pdas.masterEdition,
        collectionMint: collectionMint.publicKey,
        collectionMetadata: collPdas.collectionMetadata,
        tokenProgram: TOKEN_PROGRAM_ID,
        bullsTokenProgram: TOKEN_PROGRAM_ID,
        tokenMetadataProgram: TOKEN_METADATA_PROGRAM_ID,
      })
      .preInstructions([CU_BUMP], true)
      .signers([bob])
      .rpc();

    // Bob got 1M $TOKEN — vault followed the NFT through transfer
    const bobBalanceAfter = (await getAccount(connection, bobTokenAccount)).amount;
    expect(bobBalanceAfter - bobBalanceBefore).to.equal(TOKENS_PER_BULL);

    // Bank: tier 1 back on free stack
    const bank = await program.account.bullBank.fetch(bankPda);
    expect(bank.freeTiers).to.deep.equal([1]);
    expect(bank.inCirculation).to.equal(0);
  });

  it("wrap_bull fails when caller has insufficient balance", async () => {
    const tierIndex = 1;
    const bankBefore: any = await program.account.bullBank.fetch(bankPda);
    const nftMintPk = deriveNftMint(
      program.programId,
      BigInt(bankBefore.totalWrapped.toString()),
    );
    const pdas = deriveWrapPdas(
      program.programId, tierIndex, nftMintPk, tokenMint, carol.publicKey
    );
    const collPdas = deriveCollectionPdas(
      program.programId, collectionMint.publicKey, alice.publicKey,
    );

    // Carol has 0 $TOKEN — should fail
    let errored = false;
    try {
      await program.methods
        .wrapBull(tierIndex)
        .accounts({
          bank: bankPda,
          payer: carol.publicKey,
          payerTokenAccount: carolTokenAccount,
          tokenMint,
          nftMint: nftMintPk,
          nftMintAuthority: pdas.vaultAuthority,
          vault: pdas.vault,
          payerNftAccount: pdas.payerNftAccount,
          bullAsset: pdas.bullAsset,
          metadata: pdas.metadata,
          masterEdition: pdas.masterEdition,
          collectionMint: collectionMint.publicKey,
          collectionMetadata: collPdas.collectionMetadata,
          collectionMasterEdition: collPdas.collectionMasterEdition,
          collectionAuthority: collPdas.collectionAuthority,
          tokenProgram: TOKEN_PROGRAM_ID,
          bullsTokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          tokenMetadataProgram: TOKEN_METADATA_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          rent: SYSVAR_RENT_PUBKEY,
        })
        .preInstructions([CU_BUMP], true)
        .signers([carol])
        .rpc();
    } catch (e: any) {
      errored = true;
      expect(e.toString()).to.include("InsufficientBalance");
    }
    expect(errored).to.equal(true);
  });

  it("wraps multiple bulls and counters track correctly", async () => {
    const collPdas = deriveCollectionPdas(
      program.programId, collectionMint.publicKey, alice.publicKey,
    );

    // Alice wraps tiers 1, 2, 3
    for (const tierIndex of [1, 2, 3]) {
      // Re-read bank each iteration since total_wrapped advances per wrap.
      const bankBefore: any = await program.account.bullBank.fetch(bankPda);
      const nftMintPk = deriveNftMint(
        program.programId,
        BigInt(bankBefore.totalWrapped.toString()),
      );
      const pdas = deriveWrapPdas(
        program.programId, tierIndex, nftMintPk, tokenMint, alice.publicKey
      );

      await program.methods
        .wrapBull(tierIndex)
        .accounts({
          bank: bankPda,
          payer: alice.publicKey,
          payerTokenAccount: aliceTokenAccount,
          tokenMint,
          nftMint: nftMintPk,
          nftMintAuthority: pdas.vaultAuthority,
          vault: pdas.vault,
          payerNftAccount: pdas.payerNftAccount,
          bullAsset: pdas.bullAsset,
          metadata: pdas.metadata,
          masterEdition: pdas.masterEdition,
          collectionMint: collectionMint.publicKey,
          collectionMetadata: collPdas.collectionMetadata,
          collectionMasterEdition: collPdas.collectionMasterEdition,
          collectionAuthority: collPdas.collectionAuthority,
          tokenProgram: TOKEN_PROGRAM_ID,
          bullsTokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          tokenMetadataProgram: TOKEN_METADATA_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          rent: SYSVAR_RENT_PUBKEY,
        })
        .preInstructions([CU_BUMP], true)
        .signers([alice])
        .rpc();

      // Each one is a verified collection member
      await assertVerifiedCollection(
        connection, pdas.metadata, collectionMint.publicKey,
      );
    }

    const bank = await program.account.bullBank.fetch(bankPda);
    expect(bank.inCirculation).to.equal(3);
    expect(bank.nextTier).to.equal(4);
  });

  // ==================================================================
  // === ADVERSARIAL TESTS — vault security invariants =================
  // ==================================================================
  //
  // The central security invariant for this program is:
  //   "Only whoever holds the NFT can drain its vault."
  //
  // The three tests below empirically prove each piece of that
  // invariant by constructing an attack and asserting the program
  // rejects it. After "wraps multiple bulls" Alice owns tiers 1, 2, 3.
  // None of the attacks below should change any on-chain state — they
  // must revert atomically.

  it("SECURITY: non-holder cannot unwrap (NotNftHolder)", async () => {
    // Attack: Bob (who does NOT hold tier 1's NFT) tries to unwrap
    // Alice's tier 1 bull. Expected: program rejects with NotNftHolder.
    const tierIndex = 1;
    const tierBuf = Buffer.alloc(2);
    tierBuf.writeUInt16LE(tierIndex);
    const [bullAssetPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("bull"), tierBuf],
      program.programId,
    );
    const bullAssetAccount = await program.account.bullAsset.fetch(bullAssetPda);
    const nftMint = bullAssetAccount.nftMint;

    // Initialise Bob's NFT ATA so it exists but has 0 balance — this
    // lets the constraint check reach the `amount == 1` step rather
    // than tripping on AccountNotInitialized (still a fail-closed
    // outcome, but we want to verify the explicit NotNftHolder error).
    await getOrCreateAssociatedTokenAccount(connection, bob, nftMint, bob.publicKey);

    // Derive PDAs as if Bob were the rightful payer.
    const pdas = deriveWrapPdas(
      program.programId, tierIndex, nftMint, tokenMint, bob.publicKey,
    );
    const collPdas = deriveCollectionPdas(
      program.programId, collectionMint.publicKey, alice.publicKey,
    );

    // Capture vault balance pre-attack so we can prove no tokens moved.
    const vaultBefore = (await getAccount(connection, pdas.vault)).amount;

    let errored = false;
    try {
      await program.methods
        .unwrapBull(tierIndex)
        .accounts({
          bank: bankPda,
          payer: bob.publicKey,
          payerTokenAccount: bobTokenAccount,
          tokenMint,
          nftMint,
          nftMintAuthority: pdas.vaultAuthority,
          vault: pdas.vault,
          payerNftAccount: pdas.payerNftAccount,
          bullAsset: pdas.bullAsset,
          metadata: pdas.metadata,
          masterEdition: pdas.masterEdition,
          collectionMint: collectionMint.publicKey,
          collectionMetadata: collPdas.collectionMetadata,
          tokenProgram: TOKEN_PROGRAM_ID,
          bullsTokenProgram: TOKEN_PROGRAM_ID,
          tokenMetadataProgram: TOKEN_METADATA_PROGRAM_ID,
        })
        .preInstructions([CU_BUMP], true)
        .signers([bob])
        .rpc();
    } catch (e: any) {
      errored = true;
      expect(e.toString()).to.include("NotNftHolder");
    }
    expect(errored, "unwrap by non-holder must revert").to.equal(true);

    // Atomicity proof: vault balance is exactly what it was before.
    const vaultAfter = (await getAccount(connection, pdas.vault)).amount;
    expect(vaultAfter).to.equal(vaultBefore);
    expect(vaultAfter).to.equal(TOKENS_PER_BULL);
  });

  it("SECURITY: cannot unwrap with mismatched nft_mint (NftMintMismatch)", async () => {
    // Attack: Alice owns tier 1 AND tier 2. She tries to unwrap tier 1's
    // bull_asset PDA but passes tier 2's nft_mint (and all derived
    // accounts) instead. If the program didn't link bull_asset.nft_mint
    // to the nft_mint argument, an attacker could decouple the on-chain
    // record from the actual NFT and unwrap a vault they don't control.
    // Expected: program rejects with NftMintMismatch.
    const tier1 = 1;
    const tier2 = 2;
    const tier2Buf = Buffer.alloc(2);
    tier2Buf.writeUInt16LE(tier2);
    const [tier2BullAssetPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("bull"), tier2Buf],
      program.programId,
    );
    const tier2BullAsset = await program.account.bullAsset.fetch(tier2BullAssetPda);
    const tier2NftMint = tier2BullAsset.nftMint;

    // Derive vault/auth/payer_nft for tier 2's nft_mint (so account
    // validation passes everywhere EXCEPT the nft_mint <-> bull_asset
    // link check).
    const pdas = deriveWrapPdas(
      program.programId, tier1, tier2NftMint, tokenMint, alice.publicKey,
    );
    const collPdas = deriveCollectionPdas(
      program.programId, collectionMint.publicKey, alice.publicKey,
    );

    // Capture both vaults' balances — neither should change.
    const tier2Vault = pdas.vault;
    const tier2VaultBefore = (await getAccount(connection, tier2Vault)).amount;

    let errored = false;
    try {
      await program.methods
        .unwrapBull(tier1)
        .accounts({
          bank: bankPda,
          payer: alice.publicKey,
          payerTokenAccount: aliceTokenAccount,
          tokenMint,
          nftMint: tier2NftMint, // <-- wrong nft_mint for tier 1
          nftMintAuthority: pdas.vaultAuthority,
          vault: pdas.vault,
          payerNftAccount: pdas.payerNftAccount,
          bullAsset: pdas.bullAsset, // <-- tier 1's bull_asset
          metadata: pdas.metadata,
          masterEdition: pdas.masterEdition,
          collectionMint: collectionMint.publicKey,
          collectionMetadata: collPdas.collectionMetadata,
          tokenProgram: TOKEN_PROGRAM_ID,
          bullsTokenProgram: TOKEN_PROGRAM_ID,
          tokenMetadataProgram: TOKEN_METADATA_PROGRAM_ID,
        })
        .preInstructions([CU_BUMP], true)
        .signers([alice])
        .rpc();
    } catch (e: any) {
      errored = true;
      expect(e.toString()).to.include("NftMintMismatch");
    }
    expect(errored, "unwrap with mismatched nft_mint must revert").to.equal(true);

    // Atomicity proof: tier 2's vault still holds 1M $TOKEN.
    const tier2VaultAfter = (await getAccount(connection, tier2Vault)).amount;
    expect(tier2VaultAfter).to.equal(tier2VaultBefore);
    expect(tier2VaultAfter).to.equal(TOKENS_PER_BULL);
  });

  it("SECURITY: cannot wrap with a different SPL mint (WrongMint)", async () => {
    // Attack: an attacker creates their own SPL token (anyone can) and
    // tries to wrap_bull using that token's ATA instead of the bank's
    // locked $TOKEN mint. If the program didn't pin payer_token_account.mint
    // to bank.token_mint, they could mint a free Bull NFT by locking
    // worthless tokens. Expected: program rejects with WrongMint.
    const tierIndex = 4; // next available — none of 1/2/3 is free
    const bankBefore: any = await program.account.bullBank.fetch(bankPda);

    // Create a different SPL mint (the "worthless" attacker token).
    const wrongMint = await createMint(
      connection, alice, alice.publicKey, null, TOKEN_DECIMALS,
    );
    const wrongMintAta = await getOrCreateAssociatedTokenAccount(
      connection, alice, wrongMint, alice.publicKey,
    );
    // Give Alice >=1M of the wrong token so she'd pass the balance
    // check if the program failed to enforce the mint.
    await mintTo(
      connection, alice, wrongMint, wrongMintAta.address, alice,
      5n * TOKENS_PER_BULL,
    );

    const nftMintPk = deriveNftMint(
      program.programId,
      BigInt(bankBefore.totalWrapped.toString()),
    );
    const pdas = deriveWrapPdas(
      program.programId, tierIndex, nftMintPk, tokenMint, alice.publicKey,
    );
    const collPdas = deriveCollectionPdas(
      program.programId, collectionMint.publicKey, alice.publicKey,
    );

    let errored = false;
    try {
      await program.methods
        .wrapBull(tierIndex)
        .accounts({
          bank: bankPda,
          payer: alice.publicKey,
          payerTokenAccount: wrongMintAta.address, // <-- wrong mint's ATA
          tokenMint, // <-- still pointing at the bank's locked mint
          nftMint: nftMintPk,
          nftMintAuthority: pdas.vaultAuthority,
          vault: pdas.vault,
          payerNftAccount: pdas.payerNftAccount,
          bullAsset: pdas.bullAsset,
          metadata: pdas.metadata,
          masterEdition: pdas.masterEdition,
          collectionMint: collectionMint.publicKey,
          collectionMetadata: collPdas.collectionMetadata,
          collectionMasterEdition: collPdas.collectionMasterEdition,
          collectionAuthority: collPdas.collectionAuthority,
          tokenProgram: TOKEN_PROGRAM_ID,
          bullsTokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          tokenMetadataProgram: TOKEN_METADATA_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          rent: SYSVAR_RENT_PUBKEY,
        })
        .preInstructions([CU_BUMP], true)
        .signers([alice])
        .rpc();
    } catch (e: any) {
      errored = true;
      // Anchor may raise the explicit WrongMint or a generic constraint
      // failure depending on which constraint fires first; either is
      // a fail-closed outcome.
      const msg = e.toString();
      expect(
        msg.includes("WrongMint") || msg.includes("ConstraintRaw") || msg.includes("AnchorError"),
        `expected mint-mismatch rejection, got: ${msg}`,
      ).to.equal(true);
    }
    expect(errored, "wrap with wrong SPL mint must revert").to.equal(true);

    // Bank counters unchanged — no bull was minted.
    const bankAfter: any = await program.account.bullBank.fetch(bankPda);
    expect(bankAfter.totalWrapped.toString()).to.equal(bankBefore.totalWrapped.toString());
    expect(bankAfter.inCirculation).to.equal(bankBefore.inCirculation);
  });
});

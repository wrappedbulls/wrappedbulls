// Continuous security monitor — SENDS NOTHING.
//
// Simulates a wrap_bull AND an unwrap_bull against LIVE mainnet state and
// reports CLEAN / FAIL / SKIP for each. Designed to run on a short cron so a
// griefing freeze (e.g. a pre-created vault ATA bricking wraps, or a donated
// vault bricking unwraps) is caught in minutes instead of via user reports.
//
// All inputs come from env (no secrets in this file — safe to open-source):
//   ANCHOR_PROVIDER_URL   mainnet RPC
//   ANCHOR_WALLET         any parseable keypair (signatures are not verified
//                         in simulation; this is only the anchor provider)
//   SIM_WRAP_PAYER        pubkey that holds >= 1,000,000 $WBULL (the wrap sim
//                         runs "as" this wallet). Defaults to the provider
//                         wallet pubkey.
//   MONITOR_WEBHOOK       optional; on a FAIL, POSTs {text} here (e.g. a
//                         Telegram sendMessage URL) for push alerts.
//
// Exit 0 = nothing broken. Exit 1 = a simulation FAILED or the monitor itself
// errored (so cron/`||` wiring can react). A wrap "SKIP" (sim payer simply
// holds < 1M) is NOT a failure — it means we could not exercise wrap this run.

import * as anchor from "@coral-xyz/anchor";
import {
  PublicKey,
  ComputeBudgetProgram,
  SYSVAR_RENT_PUBKEY,
  Transaction,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { Wrappedbulls } from "../target/types/wrappedbulls";

const META = new PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");
// Program error 6001 = InsufficientBalance. Means the wrap sim payer simply
// holds < 1M right now — that is a "can't test", not a protocol break.
const INSUFFICIENT_BALANCE = 6001;

function customErrCode(err: any): number | null {
  const ie = err?.InstructionError;
  if (Array.isArray(ie) && ie[1] && typeof ie[1].Custom === "number") {
    return ie[1].Custom;
  }
  return null;
}

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.Wrappedbulls as anchor.Program<Wrappedbulls>;
  const conn = provider.connection;

  const [bankPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("bank")],
    program.programId,
  );
  const bank = await (program.account as any).bullBank.fetch(bankPda);
  const tokenMint = bank.tokenMint as PublicKey;
  const collectionMint = bank.collectionMint as PublicKey;
  const nextTier = bank.nextTier as number;
  const freeTiers = (bank.freeTiers as number[]).map(Number);
  const freeSet = new Set(freeTiers);

  const CU = ComputeBudgetProgram.setComputeUnitLimit({ units: 600_000 });

  // ---------------- WRAP SIM ----------------
  let wrapStatus = "SKIP";
  let wrapDetail = "";
  try {
    const simPayer = new PublicKey(
      process.env.SIM_WRAP_PAYER || provider.wallet.publicKey.toBase58(),
    );
    const wrapTier = freeTiers.length
      ? freeTiers[freeTiers.length - 1]
      : nextTier;
    const twBuf = Buffer.alloc(8);
    twBuf.writeBigUInt64LE(BigInt(bank.totalWrapped.toString()));
    const [nftMint] = PublicKey.findProgramAddressSync(
      [Buffer.from("nft_mint"), twBuf],
      program.programId,
    );
    const [vaultAuth] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), nftMint.toBuffer()],
      program.programId,
    );
    const vault = getAssociatedTokenAddressSync(tokenMint, vaultAuth, true, TOKEN_2022_PROGRAM_ID);
    const payerToken = getAssociatedTokenAddressSync(tokenMint, simPayer, true, TOKEN_2022_PROGRAM_ID);
    const payerNft = getAssociatedTokenAddressSync(nftMint, simPayer, true);
    const tb = Buffer.alloc(2);
    tb.writeUInt16LE(wrapTier, 0);
    const [bullAsset] = PublicKey.findProgramAddressSync(
      [Buffer.from("bull"), tb],
      program.programId,
    );
    const [metadata] = PublicKey.findProgramAddressSync(
      [Buffer.from("metadata"), META.toBuffer(), nftMint.toBuffer()],
      META,
    );
    const [masterEdition] = PublicKey.findProgramAddressSync(
      [Buffer.from("metadata"), META.toBuffer(), nftMint.toBuffer(), Buffer.from("edition")],
      META,
    );
    const [collectionAuthority] = PublicKey.findProgramAddressSync(
      [Buffer.from("collection_authority")],
      program.programId,
    );
    const [collectionMetadata] = PublicKey.findProgramAddressSync(
      [Buffer.from("metadata"), META.toBuffer(), collectionMint.toBuffer()],
      META,
    );
    const [collectionMasterEdition] = PublicKey.findProgramAddressSync(
      [Buffer.from("metadata"), META.toBuffer(), collectionMint.toBuffer(), Buffer.from("edition")],
      META,
    );
    const tx: Transaction = await program.methods
      .wrapBull(wrapTier)
      .accounts({
        bank: bankPda,
        payer: simPayer,
        payerTokenAccount: payerToken,
        tokenMint,
        nftMint,
        nftMintAuthority: vaultAuth,
        vault,
        payerNftAccount: payerNft,
        bullAsset,
        metadata,
        masterEdition,
        collectionMint,
        collectionMetadata,
        collectionMasterEdition,
        collectionAuthority,
        tokenProgram: TOKEN_PROGRAM_ID,
        bullsTokenProgram: TOKEN_2022_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        tokenMetadataProgram: META,
        systemProgram: anchor.web3.SystemProgram.programId,
        rent: SYSVAR_RENT_PUBKEY,
      } as any)
      .preInstructions([CU])
      .transaction();
    tx.feePayer = simPayer;
    tx.recentBlockhash = (await conn.getLatestBlockhash("confirmed")).blockhash;
    const sim = await conn.simulateTransaction(tx);
    if (sim.value.err === null) {
      wrapStatus = "CLEAN";
      wrapDetail = `tier ${wrapTier}`;
    } else if (customErrCode(sim.value.err) === INSUFFICIENT_BALANCE) {
      wrapStatus = "SKIP";
      wrapDetail = "sim payer holds < 1M (not a break)";
    } else {
      wrapStatus = "FAIL";
      wrapDetail = `tier ${wrapTier} ` + JSON.stringify(sim.value.err);
    }
  } catch (e: any) {
    wrapStatus = "ERROR";
    wrapDetail = e?.message || String(e);
  }

  // ---------------- UNWRAP SIM ----------------
  let unwrapStatus = "SKIP";
  let unwrapDetail = "";
  try {
    let tier = -1;
    for (let t = 1; t < nextTier; t++) {
      if (!freeSet.has(t)) {
        tier = t;
        break;
      }
    }
    if (tier === -1) {
      unwrapDetail = "no in-circulation bulls";
    } else {
      const tb = Buffer.alloc(2);
      tb.writeUInt16LE(tier, 0);
      const [bullAsset] = PublicKey.findProgramAddressSync(
        [Buffer.from("bull"), tb],
        program.programId,
      );
      const ba = await (program.account as any).bullAsset.fetch(bullAsset);
      const nftMint = ba.nftMint as PublicKey;
      const largest = await conn.getTokenLargestAccounts(nftMint);
      const holderAta = largest.value[0].address;
      const accInfo = await conn.getParsedAccountInfo(holderAta);
      const holder = new PublicKey((accInfo.value!.data as any).parsed.info.owner);
      const [vaultAuth] = PublicKey.findProgramAddressSync(
        [Buffer.from("vault"), nftMint.toBuffer()],
        program.programId,
      );
      const vault = getAssociatedTokenAddressSync(tokenMint, vaultAuth, true, TOKEN_2022_PROGRAM_ID);
      const payerToken = getAssociatedTokenAddressSync(tokenMint, holder, true, TOKEN_2022_PROGRAM_ID);
      const payerNft = getAssociatedTokenAddressSync(nftMint, holder, true);
      const [metadata] = PublicKey.findProgramAddressSync(
        [Buffer.from("metadata"), META.toBuffer(), nftMint.toBuffer()],
        META,
      );
      const [masterEdition] = PublicKey.findProgramAddressSync(
        [Buffer.from("metadata"), META.toBuffer(), nftMint.toBuffer(), Buffer.from("edition")],
        META,
      );
      const [collectionMetadata] = PublicKey.findProgramAddressSync(
        [Buffer.from("metadata"), META.toBuffer(), collectionMint.toBuffer()],
        META,
      );
      const tx: Transaction = await program.methods
        .unwrapBull(tier)
        .accounts({
          bank: bankPda,
          payer: holder,
          payerTokenAccount: payerToken,
          tokenMint,
          nftMint,
          nftMintAuthority: vaultAuth,
          vault,
          payerNftAccount: payerNft,
          bullAsset,
          metadata,
          masterEdition,
          collectionMint,
          collectionMetadata,
          tokenProgram: TOKEN_PROGRAM_ID,
          bullsTokenProgram: TOKEN_2022_PROGRAM_ID,
          tokenMetadataProgram: META,
        } as any)
        .preInstructions([CU])
        .transaction();
      tx.feePayer = holder;
      tx.recentBlockhash = (await conn.getLatestBlockhash("confirmed")).blockhash;
      const sim = await conn.simulateTransaction(tx);
      if (sim.value.err === null) {
        unwrapStatus = "CLEAN";
        unwrapDetail = `tier ${tier}`;
      } else {
        unwrapStatus = "FAIL";
        unwrapDetail = `tier ${tier} ` + JSON.stringify(sim.value.err);
      }
    }
  } catch (e: any) {
    unwrapStatus = "ERROR";
    unwrapDetail = e?.message || String(e);
  }

  const ts = new Date().toISOString();
  const failed = wrapStatus === "FAIL" || unwrapStatus === "FAIL";
  const line =
    `${ts} wrap=${wrapStatus} unwrap=${unwrapStatus}` +
    (wrapDetail ? ` | wrap:${wrapDetail}` : "") +
    (unwrapDetail ? ` | unwrap:${unwrapDetail}` : "");

  if (failed) {
    console.error("ALERT " + line);
    const hook = process.env.MONITOR_WEBHOOK;
    if (hook) {
      try {
        await (globalThis as any).fetch(hook, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ text: "WrappedBulls security monitor ALERT\n" + line }),
        });
      } catch {
        // alerting is best-effort; the non-zero exit + log line still fire
      }
    }
    process.exit(1);
  }
  console.log("OK " + line);
  process.exit(0);
}

main().catch((e) => {
  console.error(
    "ALERT " + new Date().toISOString() + " monitor crashed: " + (e?.message || e),
  );
  process.exit(1);
});

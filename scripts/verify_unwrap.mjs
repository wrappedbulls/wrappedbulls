// Verify cross-wallet unwrap state from chain alone.
// No tx signature needed — chain is source of truth.

import { PublicKey, Connection } from "@solana/web3.js";

const PROGRAM = new PublicKey("A2tUttiL2v2fYxPyeUSZ75CqnjDp5sewCqcnXubgoxm");
const NFT_1 = new PublicKey("pz9fuh2Qh8ghCjVK84u7vgPPiN6wASUoHHBaoC3brMP");
const TOKEN_MINT = new PublicKey("7BGVzbJ6kk59T4UTjFHJmkHoMNYHEYpjonSgv2PYC1CM");
const ATA_PROGRAM = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
const TOKEN_PROGRAM = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const WALLET_A = new PublicKey("GMrJpP7SaUkfyizsB3b8GeKWgDiqac3g5EaMGnMtkXCj");
const WALLET_B = new PublicKey("7cqjj77bCisBVZunEn7DoQYphnTWS1mPMDFeHaZdDnVA");

function ata(owner, mint) {
  const [a] = PublicKey.findProgramAddressSync(
    [owner.toBuffer(), TOKEN_PROGRAM.toBuffer(), mint.toBuffer()],
    ATA_PROGRAM
  );
  return a;
}

const conn = new Connection("https://api.devnet.solana.com");

console.log("================================================================");
console.log(" CROSS-WALLET UNWRAP VERIFICATION");
console.log("================================================================\n");

const [bank] = PublicKey.findProgramAddressSync([Buffer.from("bank")], PROGRAM);
const bankInfo = await conn.getAccountInfo(bank);
let off = 8 + 32;
const totalWrapped = bankInfo.data.readBigUInt64LE(off); off += 8;
const totalUnwrapped = bankInfo.data.readBigUInt64LE(off); off += 8;
const inCirc = bankInfo.data.readUInt16LE(off); off += 2;
const nextTier = bankInfo.data.readUInt16LE(off); off += 2;
const freeLen = bankInfo.data.readUInt32LE(off); off += 4;
const freeTiers = [];
for (let i = 0; i < freeLen; i++) {
  freeTiers.push(bankInfo.data.readUInt16LE(off));
  off += 2;
}
console.log("BANK STATE");
console.log("  total_wrapped:    " + totalWrapped + "  (was 2)");
console.log("  total_unwrapped:  " + totalUnwrapped + "  (was 0, expect 1)");
console.log("  in_circulation:   " + inCirc + "  (was 2, expect 1)");
console.log("  next_tier:        " + nextTier + "  (was 3, expect 3 unchanged)");
console.log("  free_tiers:       [" + freeTiers.join(", ") + "]   (was [], expect [1])");

const tierBuf = Buffer.alloc(2);
tierBuf.writeUInt16LE(1, 0);
const [bullAsset1] = PublicKey.findProgramAddressSync(
  [Buffer.from("bull"), tierBuf],
  PROGRAM
);
const ba1 = await conn.getAccountInfo(bullAsset1);
console.log("\nBULL_ASSET tier 1");
console.log("  pda:    " + bullAsset1.toBase58());
console.log("  status: " + (ba1 === null ? "CLOSED ✓" : "STILL EXISTS (FAIL)"));

const nft1Info = await conn.getAccountInfo(NFT_1);
console.log("\nNFT MINT #1");
console.log("  pda:    " + NFT_1.toBase58());
if (nft1Info === null) {
  console.log("  status: CLOSED ✓");
} else {
  const supply = nft1Info.data.readBigUInt64LE(36);
  console.log("  status: still exists, supply=" + supply + " (expect 0)");
}

const [vaultAuth1] = PublicKey.findProgramAddressSync(
  [Buffer.from("vault"), NFT_1.toBuffer()],
  PROGRAM
);
const vault1 = ata(vaultAuth1, TOKEN_MINT);
const vault1Info = await conn.getAccountInfo(vault1);
console.log("\nVAULT for tier 1");
console.log("  pda:    " + vault1.toBase58());
console.log("  status: " + (vault1Info === null ? "CLOSED ✓" : "STILL EXISTS (FAIL)"));

const bAta = ata(WALLET_B, TOKEN_MINT);
const bAtaInfo = await conn.getAccountInfo(bAta);
console.log("\n*** WALLET B $WBULL BALANCE (the key assertion) ***");
if (bAtaInfo) {
  const bAmount = bAtaInfo.data.readBigUInt64LE(64);
  const bWhole = Number(bAmount) / 1_000_000;
  console.log("  raw:    " + bAmount + " base units");
  console.log("  whole:  " + bWhole.toLocaleString() + " $WBULL");
  console.log("  expect: 1,000,000 $WBULL");
  console.log(
    "  RESULT: " +
      (bWhole === 1_000_000
        ? "✓ MATCH — vault tokens followed the NFT to the new holder"
        : "✗ MISMATCH")
  );
} else {
  console.log("  ATA missing (unwrap not completed?)");
}

const aAta = ata(WALLET_A, TOKEN_MINT);
const aAtaInfo = await conn.getAccountInfo(aAta);
const aAmount = aAtaInfo.data.readBigUInt64LE(64);
console.log("\nWALLET A $WBULL BALANCE");
console.log("  whole:  " + (Number(aAmount) / 1_000_000).toLocaleString() + " $WBULL");
console.log("  expect: 998,000,000  (unchanged — A sold the right to unwrap)");

const bNftAta = ata(WALLET_B, NFT_1);
const bNftAtaInfo = await conn.getAccountInfo(bNftAta);
console.log("\nWALLET B NFT #1 ATA");
console.log("  status: " + (bNftAtaInfo === null ? "CLOSED ✓ (burn_nft closed it)" : "still exists"));

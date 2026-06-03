// Public Jupiter v6 API client. No SDK, just fetch().
//
// Used by the /wrap page's BuyBridge: a user holding < 1M $WBULL gets a
// one tap swap (SOL into $WBULL) before the wrap step. Sequence is two
// transactions, not one combined signAllTransactions, because Jupiter's
// swap is VersionedTransaction and wrap_bull builds a legacy Transaction.
// Mixing those in a single sign batch is fragile across wallet adapter
// versions. Two signs is acceptable for v1.

import { VersionedTransaction } from "@solana/web3.js";

const JUP_BASE = "https://quote-api.jup.ag/v6";

export interface QuoteResponse {
  inputMint: string;
  outputMint: string;
  inAmount: string;
  outAmount: string;
  otherAmountThreshold: string;
  priceImpactPct: string;
  routePlan: unknown[];
  contextSlot?: number;
}

export async function getQuote(opts: {
  inputMint: string;
  outputMint: string;
  amountAtoms: bigint;
  slippageBps: number;
}): Promise<QuoteResponse> {
  const u = new URL(`${JUP_BASE}/quote`);
  u.searchParams.set("inputMint", opts.inputMint);
  u.searchParams.set("outputMint", opts.outputMint);
  u.searchParams.set("amount", opts.amountAtoms.toString());
  u.searchParams.set("slippageBps", String(opts.slippageBps));
  // ExactOut nails the destination amount (the user needs exactly 1M
  // $WBULL to wrap) and lets the SOL input float with slippage.
  u.searchParams.set("swapMode", "ExactOut");
  const r = await fetch(u.toString());
  if (!r.ok) {
    throw new Error(`jupiter quote failed: ${r.status} ${await r.text()}`);
  }
  return r.json();
}

export async function buildSwapTx(opts: {
  quote: QuoteResponse;
  userPublicKey: string;
}): Promise<VersionedTransaction> {
  const r = await fetch(`${JUP_BASE}/swap`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      quoteResponse: opts.quote,
      userPublicKey: opts.userPublicKey,
      wrapAndUnwrapSol: true,
      dynamicComputeUnitLimit: true,
      prioritizationFeeLamports: "auto",
    }),
  });
  if (!r.ok) {
    throw new Error(`jupiter swap failed: ${r.status} ${await r.text()}`);
  }
  const { swapTransaction } = (await r.json()) as { swapTransaction: string };
  return VersionedTransaction.deserialize(
    Buffer.from(swapTransaction, "base64"),
  );
}

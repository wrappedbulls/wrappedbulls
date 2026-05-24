// Runtime config for the wrappedbulls cranker. Reads from environment variables.

import 'dotenv/config';

export const CONFIG = {
  // Solana RPC. Helius URL recommended (free tier OK at launch).
  rpcUrl:    process.env.RPC_URL    || 'https://api.devnet.solana.com',
  wsUrl:     process.env.WS_URL     || 'wss://api.devnet.solana.com',

  // The deployed wrappedbulls program ID.
  programId: process.env.PROGRAM_ID || 'BLpgSo1aBu11pegSo1aBu11pegSo1aBu11pegSo1aBu11',

  // The pump.fun-launched $UPEG token mint.
  tokenMint: process.env.TOKEN_MINT || '',

  // Path to the cranker keypair JSON (used to pay tx fees and rent).
  // Generate with: solana-keygen new -o cranker-keypair.json
  keypairPath: process.env.KEYPAIR_PATH || './cranker-keypair.json',

  // Helius webhook listen port (cranker exposes a POST /webhook endpoint).
  port:      Number(process.env.PORT || 7777),

  // Tokens per bull (must match Anchor program constant).
  // 1,000,000 whole tokens * 10^6 decimals = 10^12 base units.
  tokensPerBull: 1_000_000_000_000n,

  // Max bulls in circulation (must match Anchor program constant).
  maxBulls:      1000,

  // Polling interval for the failsafe nightly sweep (ms).
  sweepIntervalMs: 24 * 60 * 60 * 1000,
};

if (!CONFIG.tokenMint) {
  console.warn('[config] TOKEN_MINT not set. Cranker will fail until you set it (post pump.fun launch).');
}

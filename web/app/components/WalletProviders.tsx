"use client";

import { useMemo } from "react";
import {
  ConnectionProvider as ConnectionProviderRaw,
  WalletProvider as WalletProviderRaw,
} from "@solana/wallet-adapter-react";
import { WalletModalProvider as WalletModalProviderRaw } from "@solana/wallet-adapter-react-ui";

// Wallet-adapter components were built for React 18's older ReactNode type.
// Next.js 14.2 + React 18.3 introduce a stricter ReactNode that includes
// Promise<ReactNode> for server components, which the wallet-adapter types
// don't satisfy. Cast through `any` to satisfy the build's type-check worker;
// runtime behavior is identical (they're just React components).
const ConnectionProvider = ConnectionProviderRaw as unknown as React.FC<React.ComponentProps<typeof ConnectionProviderRaw>>;
const WalletProvider = WalletProviderRaw as unknown as React.FC<React.ComponentProps<typeof WalletProviderRaw>>;
const WalletModalProvider = WalletModalProviderRaw as unknown as React.FC<React.ComponentProps<typeof WalletModalProviderRaw>>;
import {
  PhantomWalletAdapter,
  SolflareWalletAdapter,
} from "@solana/wallet-adapter-wallets";
import "@solana/wallet-adapter-react-ui/styles.css";

export default function WalletProviders({ children }: { children: React.ReactNode }) {
  const endpoint =
    process.env.NEXT_PUBLIC_SOLANA_RPC_URL || "https://api.devnet.solana.com";
  const wallets = useMemo(
    () => [
      new PhantomWalletAdapter(),
      new SolflareWalletAdapter(),
    ],
    []
  );

  return (
    <ConnectionProvider endpoint={endpoint}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>{children}</WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}

"use client";

import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";

export default function ConnectButton() {
  return (
    <div className="cb-wallet-btn">
      <WalletMultiButton />
      <style jsx global>{`
        .cb-wallet-btn .wallet-adapter-button {
          background: var(--bull-accent) !important;
          color: #1a1a00 !important;
          font-family: ui-monospace, SFMono-Regular, Menlo, monospace !important;
          font-weight: 600 !important;
          font-size: 12px !important;
          height: 38px !important;
          padding: 0 10px !important;
          border-radius: 8px !important;
          max-width: 160px !important;
          overflow: hidden !important;
          text-overflow: ellipsis !important;
          white-space: nowrap !important;
        }
        /* Larger sizing on tablet/desktop where there's room to breathe. */
        @media (min-width: 640px) {
          .cb-wallet-btn .wallet-adapter-button {
            font-size: 14px !important;
            padding: 0 16px !important;
            max-width: none !important;
          }
        }
        .cb-wallet-btn .wallet-adapter-button:hover {
          background: var(--bull-accent-hi) !important;
        }
        .cb-wallet-btn .wallet-adapter-button:not([disabled]):hover {
          background: var(--bull-accent-hi) !important;
        }
        .cb-wallet-btn .wallet-adapter-button-trigger {
          background: var(--bull-accent) !important;
        }
        /* Wallet selection modal: cap at a reasonable width on desktop, fall
           back to viewport width on mobile. Centered horizontally. */
        .wallet-adapter-modal-wrapper {
          max-width: min(calc(100vw - 24px), 480px) !important;
          margin: 0 auto !important;
        }
        /* Tighten the wallet-list rows so logo + name + status sit close
           together instead of being pushed to opposite edges of a wide row. */
        .wallet-adapter-modal-list {
          margin: 0 !important;
        }
        .wallet-adapter-modal-list .wallet-adapter-button {
          gap: 12px !important;
          padding: 12px 16px !important;
          font-size: 15px !important;
          height: auto !important;
          min-height: 56px !important;
          max-width: none !important;
        }
      `}</style>
    </div>
  );
}

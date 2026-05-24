"use client";

// RpcErrorCard. shown when an on-chain read fails (RPC down, network
// blip, region block). THE LESSON (docs/LESSONS_LEARNED.md L11): the
// last launch rendered "Need 1M $WBULL" identically for "RPC threw"
// and "user actually has zero balance". Users holding $WBULL read
// that as a scam.
//
// This card makes an RPC failure UNAMBIGUOUS: it says the network
// call failed, it is not about the user's balance, and it offers a
// retry. wrap/unwrap render this INSTEAD of the balance UI whenever a
// read throws.

export default function RpcErrorCard({
  message,
  onRetry,
  retrying = false,
}: {
  message?: string | null;
  onRetry: () => void;
  retrying?: boolean;
}) {
  return (
    <div className="card text-center py-12">
      <div className="text-xs uppercase tracking-[0.25em] text-[var(--bull-danger)] mb-3">
        Network error
      </div>
      <div className="text-2xl font-bold mb-3">
        Couldn&apos;t reach Solana
      </div>
      <p className="text-[var(--bull-dim)] mb-2 max-w-md mx-auto leading-relaxed">
        This is a connection problem talking to the blockchain. it is
        not about your wallet or your balance. Your funds are safe.
      </p>
      <p className="text-[var(--bull-dim)] mb-6 max-w-md mx-auto leading-relaxed text-sm">
        Wait a moment and retry. If it keeps failing, the RPC provider
        may be briefly degraded.
      </p>
      {message && (
        <pre className="mx-auto mb-6 max-w-md p-3 rounded-md bg-[#0a0a0e] border border-[#2a2a32] text-[#c0c0c8] text-xs overflow-x-auto whitespace-pre-wrap break-all text-left">
          {message}
        </pre>
      )}
      <button
        className="btn btn-primary"
        onClick={onRetry}
        disabled={retrying}
      >
        {retrying ? "Retrying..." : "Retry"}
      </button>
    </div>
  );
}

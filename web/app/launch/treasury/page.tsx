// /launch/treasury — bull treasury status page. Server-rendered, reads
// BullTreasuryState directly and shows:
//   - lifetime deposited
//   - lifetime claimed
//   - claimable right now (claimable field + any pending entries past 7d)
//   - pending list with per-entry "X days until unlock" countdown
//   - on-chain proof links (PDA address, vault ATA address)

import Link from "next/link";
import { PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import {
  bullTreasuryStatePda,
  factoryConfigPda,
  fetchBullTreasuryState,
  fetchFactoryConfig,
  getConnection,
  PENDING_CAP,
  PENDING_LOCK_SECONDS,
  previewClaimableAt,
  previewLockedAt,
  type BullTreasuryState,
} from "@/lib/factory";

export const metadata = {
  title: "WRAPPEDBULLS // bull treasury",
  description:
    "Live status of the Factory's bull treasury. 7-day per-deposit lock, multisig-controlled, governance adjustable.",
};

export const dynamic = "force-dynamic";

export default async function BullTreasuryPage() {
  const conn = getConnection();
  const [treasuryPda] = bullTreasuryStatePda();
  const [factoryPda] = factoryConfigPda();

  let treasury: BullTreasuryState | null = null;
  let factoryWbullMint = null as string | null;
  let rpcError: string | null = null;
  try {
    treasury = await fetchBullTreasuryState(conn);
    const cfg = await fetchFactoryConfig(conn);
    if (cfg) factoryWbullMint = cfg.wbullMint.toBase58();
  } catch (e) {
    rpcError = (e as Error).message;
  }

  const now = Math.floor(Date.now() / 1000);

  // Compute the treasury vault ATA once if we have the wbull mint, so
  // the JSX below stays sync + readable.
  const treasuryVaultAta =
    factoryWbullMint
      ? getAssociatedTokenAddressSync(new PublicKey(factoryWbullMint), treasuryPda, true).toBase58()
      : "—";

  return (
    <main className="max-w-5xl mx-auto px-4 sm:px-6 py-12">
      <div className="mb-6">
        <div
          style={{
            color: "var(--bull-dim)",
            fontSize: 12,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            marginBottom: 6,
          }}
        >
          factory / treasury
        </div>
        <h1 className="h1">BULL TREASURY</h1>
        <p className="text-[var(--bull-dim)] mt-3 text-sm" style={{ maxWidth: 720 }}>
          every Factory deployment funds this PDA with 1,000,000 $WBULL. each
          deposit locks for 7 days before becoming claimable by the multisig.
          governance can adjust the deploy cost via a program upgrade.
        </p>
      </div>

      {rpcError && (
        <div
          className="card"
          style={{
            padding: 16,
            marginBottom: 24,
            borderColor: "#b35d00",
            background: "#fff4e6",
            fontSize: 12,
            color: "#b35d00",
          }}
        >
          <strong style={{ textTransform: "uppercase", letterSpacing: "0.08em" }}>RPC error:</strong>{" "}
          {rpcError}
        </div>
      )}

      {!treasury && !rpcError && (
        <div className="card text-center" style={{ padding: 48 }}>
          <div className="h2" style={{ marginBottom: 12 }}>TREASURY NOT INITIALIZED</div>
          <p className="text-[var(--bull-dim)]" style={{ maxWidth: 480, marginInline: "auto" }}>
            the Factory has not been initialized on this cluster yet. once the
            upgrade authority runs <code>initialize</code>, this page will populate.
          </p>
        </div>
      )}

      {treasury && (
        <>
          {/* Top-level numbers */}
          <section style={{ paddingTop: 12, paddingBottom: 24 }}>
            <div className="card" style={{ padding: 32, background: "var(--bull-ink)", color: "var(--bull-paper)" }}>
              <div style={{ marginBottom: 24 }}>
                <div style={{ fontSize: 10, letterSpacing: "0.18em", textTransform: "uppercase", color: "#d4a017" }}>
                  lifetime deposited
                </div>
                <div style={{ fontSize: 44, fontWeight: 800, fontVariantNumeric: "tabular-nums", lineHeight: 1.1 }}>
                  {formatBig(treasury.lifetimeDeposited)} $WBULL
                </div>
                <div style={{ fontSize: 12, color: "#aaa", marginTop: 6 }}>
                  monotonic. base units. never decreases even on claim.
                </div>
              </div>
              <div
                className="grid grid-cols-1 sm:grid-cols-3 gap-6"
                style={{ paddingTop: 24, borderTop: "2px dashed #333" }}
              >
                <DarkStat
                  label="CLAIMABLE RIGHT NOW"
                  value={formatBig(previewClaimableAt(treasury, now))}
                  sub={"settled + swept-from-pending"}
                  gold
                />
                <DarkStat
                  label="LOCKED (< 7D OLD)"
                  value={formatBig(previewLockedAt(treasury, now))}
                  sub={`${treasury.pending.filter((p) => Number(p.depositedAt) + PENDING_LOCK_SECONDS > now).length} pending`}
                />
                <DarkStat
                  label="LIFETIME CLAIMED"
                  value={formatBig(treasury.lifetimeClaimed)}
                  sub={"sent to multisig destinations"}
                />
              </div>
            </div>
          </section>

          {/* Pending entries table */}
          <section style={{ paddingTop: 24 }}>
            <SectionHead marker="01" title="PENDING DEPOSITS" />
            {treasury.pending.length === 0 ? (
              <div className="card text-center" style={{ padding: 32 }}>
                <p className="text-[var(--bull-dim)]">no pending deposits. treasury is fully settled.</p>
              </div>
            ) : (
              <div className="card" style={{ padding: 0, overflow: "hidden" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                  <thead>
                    <tr style={{ background: "var(--bull-very-soft)", textAlign: "left" }}>
                      <Th>deposit</Th>
                      <Th>amount</Th>
                      <Th>deposited at</Th>
                      <Th>unlocks</Th>
                      <Th align="right">state</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {treasury.pending
                      .slice() // copy before sort
                      .sort((a, b) => (a.depositedAt < b.depositedAt ? -1 : 1))
                      .map((entry, i) => {
                        const depositedAt = Number(entry.depositedAt);
                        const unlocksAt = depositedAt + PENDING_LOCK_SECONDS;
                        const isUnlocked = unlocksAt <= now;
                        const remaining = unlocksAt - now;
                        return (
                          <tr key={i} style={{ borderTop: "1px dashed var(--bull-soft)" }}>
                            <Td>#{i + 1}</Td>
                            <Td mono>{formatBig(entry.amount)}</Td>
                            <Td>{new Date(depositedAt * 1000).toISOString().slice(0, 19).replace("T", " ")}</Td>
                            <Td>
                              {isUnlocked
                                ? new Date(unlocksAt * 1000).toISOString().slice(0, 10) + " (past)"
                                : `in ${formatRemaining(remaining)}`}
                            </Td>
                            <Td align="right">
                              {isUnlocked ? (
                                <span style={{ color: "#0a6b2c", fontWeight: 800, fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase" }}>claimable</span>
                              ) : (
                                <span style={{ color: "#b35d00", fontWeight: 800, fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase" }}>locked</span>
                              )}
                            </Td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
                <div
                  style={{
                    padding: 12,
                    fontSize: 11,
                    color: "var(--bull-dim)",
                    background: "var(--bull-very-soft)",
                    textAlign: "right",
                  }}
                >
                  {treasury.pending.length} / {PENDING_CAP} pending slots used
                </div>
              </div>
            )}
          </section>

          {/* On-chain proof */}
          <section style={{ paddingTop: 48 }}>
            <SectionHead marker="02" title="ON CHAIN ADDRESSES" />
            <div className="card" style={{ padding: 24 }}>
              <div style={{ display: "grid", gridTemplateColumns: "200px 1fr", rowGap: 10, fontSize: 13 }}>
                <KV label="FactoryConfig PDA" value={factoryPda.toBase58()} mono />
                <KV label="BullTreasuryState PDA" value={treasuryPda.toBase58()} mono />
                <KV label="bull_treasury_vault" value={treasuryVaultAta} mono />
                <KV label="$WBULL mint" value={factoryWbullMint ?? "—"} mono />
              </div>
            </div>
            <p style={{ marginTop: 12, fontSize: 11, color: "var(--bull-dim)" }}>
              all four addresses are deterministic. holders can verify via solscan / explorer
              that the treasury PDA is in fact the one this program writes to.
            </p>
          </section>
        </>
      )}

      <div style={{ marginTop: 48, textAlign: "center" }}>
        <Link href="/launch" className="btn btn-secondary">[ ← FACTORY HOME ]</Link>
      </div>
    </main>
  );
}

// =====================================================================
// Subcomponents
// =====================================================================
function SectionHead({ marker, title }: { marker: string; title: string }) {
  return (
    <div className="flex items-baseline gap-4 mb-4">
      <div style={{ fontWeight: 800 }}>{marker}</div>
      <div className="h2">{title}</div>
      <div style={{ flex: 1, borderTop: "2px solid var(--bull-ink)", height: 0, transform: "translateY(-6px)" }} />
    </div>
  );
}

function DarkStat({ label, value, sub, gold }: { label: string; value: string; sub: string; gold?: boolean }) {
  return (
    <div>
      <div style={{ fontSize: 10, letterSpacing: "0.18em", textTransform: "uppercase", color: "#888", marginBottom: 4 }}>
        {label}
      </div>
      <div style={{ fontSize: 28, fontWeight: 800, fontVariantNumeric: "tabular-nums", color: gold ? "#d4a017" : "var(--bull-paper)" }}>
        {value}
      </div>
      <div style={{ fontSize: 11, color: "#aaa", marginTop: 4 }}>{sub}</div>
    </div>
  );
}

function Th({ children, align }: { children: React.ReactNode; align?: "left" | "right" }) {
  return (
    <th
      style={{
        padding: "10px 16px",
        fontSize: 11,
        textTransform: "uppercase",
        letterSpacing: "0.08em",
        color: "var(--bull-dim)",
        textAlign: align ?? "left",
        fontWeight: 800,
      }}
    >
      {children}
    </th>
  );
}

function Td({ children, mono, align }: { children: React.ReactNode; mono?: boolean; align?: "left" | "right" }) {
  return (
    <td
      style={{
        padding: "10px 16px",
        fontFamily: mono ? "inherit" : undefined,
        fontVariantNumeric: mono ? "tabular-nums" : undefined,
        textAlign: align ?? "left",
      }}
    >
      {children}
    </td>
  );
}

function KV({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <>
      <div style={{ color: "var(--bull-dim)", fontSize: 12, paddingTop: 4 }}>{label}</div>
      <div
        style={{
          fontWeight: 700,
          paddingTop: 4,
          wordBreak: mono ? "break-all" : undefined,
          fontFamily: "inherit",
        }}
      >
        {value || <span style={{ color: "var(--bull-dim)", fontWeight: 400 }}>—</span>}
      </div>
    </>
  );
}

function formatBig(n: bigint): string {
  const s = n.toString();
  if (s === "0") return "0";
  let out = "";
  for (let i = 0; i < s.length; i++) {
    if (i > 0 && (s.length - i) % 3 === 0) out += ",";
    out += s[i];
  }
  return out;
}

function formatRemaining(seconds: number): string {
  if (seconds <= 0) return "now";
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  if (days > 0) return `${days}d ${hours}h`;
  const mins = Math.floor(seconds / 60);
  if (hours > 0) return `${hours}h ${mins % 60}m`;
  return `${mins}m`;
}

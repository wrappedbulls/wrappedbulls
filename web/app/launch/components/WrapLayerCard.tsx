// WrapLayerCard: card used on /launch and /launches for a single wrap layer.
// Renders the layer's mascot art, name, ticker, and live stats.
//
// Art for now is a small inline SVG pixel mascot keyed off the `mascot`
// prop. Week 2 will swap this for the live BaseUri/RendererUrl resolver
// once deployments exist on chain.

import Link from "next/link";

export type Mascot =
  | "bull"
  | "doge"
  | "pepe"
  | "shib"
  | "bonk"
  | "pudgy";

export interface WrapLayerCardProps {
  name: string;
  ticker: string;
  badge: string;             // "LIVE" | "OG" | "PREVIEW"
  mascot: Mascot;
  supply: number;
  wrapped: number;
  lockedDisplay: string;     // e.g. "847M $WBULL"
  floor?: string;            // e.g. "0.42 SOL" — optional, undefined hides the row
  href: string;              // page link, e.g. "/launch/wbull"
  marketplaceHref?: string;  // optional ME / Tensor deep-link
  isOg?: boolean;            // highlights badge in gold
  verified?: boolean;        // protocol-multisig blessed (renders ✓ verified chip next to name)
}

export default function WrapLayerCard(props: WrapLayerCardProps) {
  const {
    name,
    ticker,
    badge,
    mascot,
    supply,
    wrapped,
    lockedDisplay,
    floor,
    href,
    marketplaceHref,
    isOg,
    verified,
  } = props;

  return (
    <div className="card card-hover" style={{ padding: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 12 }}>
        <div>
          <div style={{ fontWeight: 800, fontSize: 16, display: "flex", alignItems: "center", gap: 6 }}>
            {name}
            {verified && (
              <span
                title="Verified by WrappedBulls multisig"
                style={{
                  fontSize: 10,
                  padding: "2px 6px",
                  background: "#0a6b2c",
                  color: "var(--bull-paper)",
                  letterSpacing: "0.08em",
                  fontWeight: 800,
                  textTransform: "uppercase",
                }}
              >
                ✓ verified
              </span>
            )}
          </div>
          <div style={{ fontSize: 11, color: "var(--bull-dim)" }}>{ticker}</div>
        </div>
        <span
          style={{
            fontSize: 9,
            padding: "3px 7px",
            background: isOg ? "#d4a017" : "var(--bull-ink)",
            color: isOg ? "var(--bull-ink)" : "var(--bull-paper)",
            letterSpacing: "0.1em",
            fontWeight: 800,
            textTransform: "uppercase",
          }}
        >
          {badge}
        </span>
      </div>

      <div
        style={{
          aspectRatio: "1",
          background: "#1a1a1a",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          marginBottom: 12,
          overflow: "hidden",
        }}
      >
        <Mascot type={mascot} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px 16px", fontSize: 12 }}>
        <KV label="supply" value={supply.toLocaleString()} />
        <KV label="wrapped" value={wrapped.toLocaleString()} />
        <KV label="locked" value={lockedDisplay} />
        {floor && <KV label="floor" value={floor} />}
      </div>

      <div style={{ marginTop: 14, display: "flex", gap: 8 }}>
        <Link href={href} className="btn" style={{ padding: "7px 12px", fontSize: 11, flex: 1, textAlign: "center" }}>
          [ VIEW ]
        </Link>
        {marketplaceHref && (
          <a href={marketplaceHref} target="_blank" rel="noopener" className="btn btn-secondary" style={{ padding: "7px 12px", fontSize: 11, flex: 1, textAlign: "center" }}>
            [ ME ↗ ]
          </a>
        )}
      </div>
    </div>
  );
}

function KV({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ color: "var(--bull-dim)", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em" }}>
        {label}
      </div>
      <div style={{ fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>{value}</div>
    </div>
  );
}

// =====================================================================
// Inline pixel-art mascots. Each is a 12x12 grid of rects rendered at
// the parent card's aspect ratio. Pure SVG -- no images to ship.
// =====================================================================
function Mascot({ type }: { type: Mascot }) {
  const common = {
    viewBox: "0 0 12 12",
    preserveAspectRatio: "xMidYMid meet" as const,
    xmlns: "http://www.w3.org/2000/svg",
    style: { width: "100%", height: "100%", imageRendering: "pixelated" as const },
  };
  switch (type) {
    case "bull":
      return (
        <svg {...common}>
          <rect x="2" y="1" width="1" height="2" fill="#d4a017" />
          <rect x="9" y="1" width="1" height="2" fill="#d4a017" />
          <rect x="2" y="3" width="1" height="1" fill="#d4a017" />
          <rect x="9" y="3" width="1" height="1" fill="#d4a017" />
          <rect x="3" y="3" width="6" height="6" fill="#8a5a2b" />
          <rect x="2" y="4" width="1" height="4" fill="#8a5a2b" />
          <rect x="9" y="4" width="1" height="4" fill="#8a5a2b" />
          <rect x="4" y="5" width="1" height="1" fill="#f8f7f2" />
          <rect x="7" y="5" width="1" height="1" fill="#f8f7f2" />
          <rect x="4" y="7" width="4" height="2" fill="#c89e6a" />
          <rect x="5" y="8" width="2" height="1" fill="#d4a017" />
          <rect x="4" y="9" width="4" height="1" fill="#5e3e1d" />
        </svg>
      );
    case "doge":
      return (
        <svg {...common}>
          <rect x="2" y="2" width="2" height="2" fill="#c08a3a" />
          <rect x="8" y="2" width="2" height="2" fill="#c08a3a" />
          <rect x="2" y="4" width="8" height="5" fill="#e0b070" />
          <rect x="3" y="3" width="6" height="1" fill="#e0b070" />
          <rect x="4" y="5" width="1" height="1" fill="#0a0a0a" />
          <rect x="7" y="5" width="1" height="1" fill="#0a0a0a" />
          <rect x="4" y="6" width="4" height="2" fill="#f0d090" />
          <rect x="5" y="7" width="2" height="1" fill="#0a0a0a" />
          <rect x="5" y="9" width="2" height="1" fill="#d75070" />
        </svg>
      );
    case "pepe":
      return (
        <svg {...common}>
          <rect x="2" y="1" width="2" height="2" fill="#f8f7f2" />
          <rect x="8" y="1" width="2" height="2" fill="#f8f7f2" />
          <rect x="3" y="2" width="1" height="1" fill="#0a0a0a" />
          <rect x="8" y="2" width="1" height="1" fill="#0a0a0a" />
          <rect x="2" y="3" width="8" height="6" fill="#5da832" />
          <rect x="1" y="5" width="10" height="3" fill="#5da832" />
          <rect x="3" y="7" width="6" height="1" fill="#0a0a0a" />
          <rect x="2" y="8" width="2" height="1" fill="#3d8020" />
          <rect x="8" y="8" width="2" height="1" fill="#3d8020" />
        </svg>
      );
    case "shib":
      return (
        <svg {...common}>
          <rect x="2" y="1" width="2" height="3" fill="#a85a1e" />
          <rect x="8" y="1" width="2" height="3" fill="#a85a1e" />
          <rect x="3" y="2" width="1" height="1" fill="#f8e0a0" />
          <rect x="8" y="2" width="1" height="1" fill="#f8e0a0" />
          <rect x="2" y="4" width="8" height="5" fill="#d88040" />
          <rect x="3" y="3" width="6" height="1" fill="#d88040" />
          <rect x="4" y="5" width="1" height="1" fill="#0a0a0a" />
          <rect x="7" y="5" width="1" height="1" fill="#0a0a0a" />
          <rect x="4" y="6" width="4" height="2" fill="#f8e0a0" />
          <rect x="5" y="7" width="2" height="1" fill="#0a0a0a" />
        </svg>
      );
    case "bonk":
      return (
        <svg {...common}>
          <rect x="1" y="2" width="1" height="3" fill="#e0a040" />
          <rect x="2" y="3" width="1" height="2" fill="#e0a040" />
          <rect x="9" y="3" width="1" height="2" fill="#e0a040" />
          <rect x="10" y="2" width="1" height="3" fill="#e0a040" />
          <rect x="2" y="4" width="8" height="5" fill="#f0b850" />
          <rect x="3" y="5" width="1" height="1" fill="#a85e1c" />
          <rect x="8" y="5" width="1" height="1" fill="#a85e1c" />
          <rect x="4" y="5" width="1" height="2" fill="#0a0a0a" />
          <rect x="7" y="5" width="1" height="2" fill="#0a0a0a" />
          <rect x="5" y="7" width="2" height="1" fill="#d75070" />
          <rect x="5" y="8" width="1" height="1" fill="#0a0a0a" />
          <rect x="6" y="8" width="1" height="1" fill="#0a0a0a" />
        </svg>
      );
    case "pudgy":
      return (
        <svg {...common}>
          <rect x="3" y="2" width="6" height="9" fill="#2a4a72" />
          <rect x="2" y="3" width="1" height="7" fill="#2a4a72" />
          <rect x="9" y="3" width="1" height="7" fill="#2a4a72" />
          <rect x="4" y="5" width="4" height="6" fill="#f8f7f2" />
          <rect x="3" y="6" width="1" height="4" fill="#f8f7f2" />
          <rect x="8" y="6" width="1" height="4" fill="#f8f7f2" />
          <rect x="4" y="3" width="1" height="1" fill="#f8f7f2" />
          <rect x="7" y="3" width="1" height="1" fill="#f8f7f2" />
          <rect x="4" y="4" width="1" height="1" fill="#0a0a0a" />
          <rect x="7" y="4" width="1" height="1" fill="#0a0a0a" />
          <rect x="5" y="5" width="2" height="1" fill="#e8a020" />
        </svg>
      );
  }
}

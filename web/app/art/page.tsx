// /art - explains the generative pixel art: traits, math, and how each
// bull is deterministically rendered from its NFT mint address.

import Link from "next/link";

export const metadata = {
  title: "Art - WrappedBulls",
  description:
    "Every Bull is a 24×24 pixel art portrait rendered deterministically " +
    "from its NFT mint address. 7 trait categories, over 2.8 million possible " +
    "combinations, only 1,000 bulls in existence at a time.",
};

export const dynamic = "force-static";

const EXAMPLES = [
  "bull_01", "bull_04", "bull_07", "bull_10", "bull_13",
  "bull_16", "bull_19", "bull_22", "bull_25", "bull_28",
];

const CATEGORIES: { name: string; count: number; samples: string; rarest: string }[] = [
  { name: "Body",        count: 9,  samples: "brown · black · white · red · golden · cyan · pink · zombie · holo",
    rarest: "holo - legendary, ~1%" },
  { name: "Horns",       count: 5,  samples: "ivory · dark · gold · crimson · silver",
    rarest: "silver - rare, ~5%" },
  { name: "Eyes",        count: 8,  samples: "normal · golden · void · green · closed · angry · crying · ski_mask",
    rarest: "ski_mask - legendary, ~1%" },
  { name: "Background",  count: 7,  samples: "pasture · sand · sunset · chart · void · sky · crimson",
    rarest: "void - epic, ~4%" },
  { name: "Accessory",   count: 23, samples: "halo · crown · top_hat · dubai_hat · strawberry_hat · diamond_aura · fire_aura · halo_stars · Pump · Phantom · scar · tinfoil · …",
    rarest: "halo_stars - legendary, ~1%" },
  { name: "Eyewear",     count: 7,  samples: "none · mog · sunglasses · clout_shades · thug_life · 3d_glasses · lasers",
    rarest: "lasers - epic, ~2%" },
  { name: "Mouth",       count: 7,  samples: "none · cigarette · grill · bubblegum · frown · tongue_out · open_shout",
    rarest: "grill - epic, ~2%" },
];

// Active-combination math (excluding weight-0 variants that never appear).
// 9 × 5 × 8 × 7 × 23 × 7 × 7 = 2,840,040
const TOTAL_COMBINATIONS = 9 * 5 * 8 * 7 * 23 * 7 * 7;

export default function ArtPage() {
  return (
    <main className="max-w-5xl mx-auto px-4 sm:px-6 py-16">
      {/* === Hero === */}
      <div className="mb-16">
        <div className="text-xs uppercase tracking-[0.25em] text-[var(--bull-dim)] mb-4">
          The art
        </div>
        <h1 className="text-3xl md:text-5xl font-bold leading-tight tracking-tight mb-4">
          24×24 pixel bulls,{" "}
          <span style={{ color: "var(--bull-accent)" }}>
            rendered from the chain.
          </span>
        </h1>
        <p className="text-lg text-[var(--bull-dim)] leading-relaxed max-w-3xl">
          Each Bull is a deterministic pixel-art portrait. The seed is
          the NFT mint address - locked at wrap time, follows the NFT through
          every transfer, and re-renders byte-identically from any Solana
          RPC. Open the renderer, point it at a mint, you get the same bull
          every time.
        </p>
      </div>

      {/* === Example grid === */}
      <section className="mb-20">
        <h2 className="h2 mb-2">A sample of the herd</h2>
        <p className="text-[var(--bull-dim)] mb-6">
          Ten bulls picked from a sheet of thirty. Browse the full live
          gallery at{" "}
          <Link href="/gallery" className="text-[var(--bull-accent)] hover:underline">
            /gallery
          </Link>
          .
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
          {EXAMPLES.map((slug) => (
            <div key={slug} className="card p-2">
              <div className="aspect-square rounded-md overflow-hidden bg-[#0a0a0c]">
                <img
                  src={`/art/${slug}.png`}
                  alt={`Sample Bull ${slug}`}
                  className="w-full h-full pixelated"
                  loading="lazy"
                />
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* === Anatomy / trait categories === */}
      <section className="mb-20">
        <h2 className="h2 mb-2">Anatomy of a bull</h2>
        <p className="text-[var(--bull-dim)] mb-6">
          Seven trait categories. Each bull is a random draw from the
          weighted distribution, seeded by the NFT mint address.
        </p>
        <div className="card divide-y divide-[#1a1a22]">
          {CATEGORIES.map((c) => (
            <div key={c.name} className="py-4 first:pt-0 last:pb-0">
              <div className="flex items-baseline justify-between mb-1">
                <div className="text-lg font-bold">{c.name}</div>
                <div className="text-2xl font-extrabold text-[var(--bull-accent)]">
                  ×{c.count}
                </div>
              </div>
              <div className="text-sm text-[var(--bull-dim)] mb-1 leading-relaxed">
                {c.samples}
              </div>
              <div className="text-xs text-[var(--bull-dim)] italic">
                Rarest: {c.rarest}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* === The math === */}
      <section className="mb-20">
        <h2 className="h2 mb-2">The math</h2>
        <p className="text-[var(--bull-dim)] mb-6">
          Multiplying the active variants across every category:
        </p>
        <div className="card">
          <div className="font-mono text-sm text-[var(--bull-dim)] leading-relaxed mb-4 overflow-x-auto">
            9 × 5 × 8 × 7 × 23 × 7 × 7
          </div>
          <div className="text-4xl md:text-5xl font-extrabold text-[var(--bull-accent)] mb-2">
            {TOTAL_COMBINATIONS.toLocaleString()}
          </div>
          <div className="text-sm text-[var(--bull-dim)]">
            possible unique combinations
          </div>
          <div className="border-t border-[#1a1a22] my-6"></div>
          <div className="grid grid-cols-2 gap-6">
            <div>
              <div className="text-xs uppercase text-[var(--bull-dim)] tracking-wider mb-1">
                Max bulls in circulation
              </div>
              <div className="text-3xl font-extrabold">1,000</div>
            </div>
            <div>
              <div className="text-xs uppercase text-[var(--bull-dim)] tracking-wider mb-1">
                Oversupply ratio
              </div>
              <div className="text-3xl font-extrabold">
                {Math.round(TOTAL_COMBINATIONS / 1000).toLocaleString()}×
              </div>
            </div>
          </div>
          <p className="text-sm text-[var(--bull-dim)] leading-relaxed mt-6">
            2.8M is a measure of{" "}
            <span className="text-[var(--bull-ink)] font-bold">visual diversity</span>,
            not supply. The real ceiling is{" "}
            <span className="text-[var(--bull-ink)] font-bold">
              1,000 alive bulls at any moment
            </span>
            , enforced on chain by the token math: 1B $WBULL ÷ 1M per wrap = 1,000
            simultaneously wrappable. When all 1,000 are alive, zero free $WBULL
            remain to wrap an 1,001st - the only way to create a new bull is for
            an existing one to unwrap.
          </p>
          <p className="text-sm text-[var(--bull-dim)] leading-relaxed mt-3">
            Lifetime mint count is unbounded. Every unwrap re-issues that tier
            with a fresh NFT mint and almost always a new pixel-art roll. Visual
            duplicates begin appearing around wrap #2,000 by birthday-paradox
            math - that's fine, because each NFT is uniquely identified by its
            mint pubkey, not its image. Tier #42 today and tier #42 a year from
            now are different bulls - different mints, different art, distinct
            on-chain identities.
          </p>
        </div>
      </section>

      {/* === Rarity tiers === */}
      <section className="mb-20">
        <h2 className="h2 mb-2">Rarity tiers</h2>
        <p className="text-[var(--bull-dim)] mb-6">
          Five rarity bands. Each trait is weighted within its category and
          picked at wrap time. The numbers below are <em>per-item drop
          rates</em>, sampled across all seven categories - exact rates vary
          by category because each category has its own weight sum, but
          every Common item is dominant and every Legendary is ~1%.
        </p>
        <div className="grid sm:grid-cols-2 lg:grid-cols-5 gap-3">
          {[
            { tier: "Common",    pct: "22 to 68%",  color: "#9a9aa6" },
            { tier: "Uncommon",  pct: "5 to 18%",   color: "#7aff7a" },
            { tier: "Rare",      pct: "2.7 to 12%", color: "#7acaff" },
            { tier: "Epic",      pct: "1.8 to 4%",  color: "#c97aff" },
            { tier: "Legendary", pct: "~1%",     color: "#ffaa3a" },
          ].map((r) => (
            <div key={r.tier} className="card text-center py-5">
              <div className="text-xs uppercase tracking-wider mb-2" style={{ color: r.color }}>
                {r.tier}
              </div>
              <div className="text-2xl font-extrabold">{r.pct}</div>
            </div>
          ))}
        </div>
        <p className="text-xs text-[var(--bull-dim)] mt-4">
          Three traits are legendary at ~1% drop rate: <strong>holo body</strong>
          {" "}(1/100), <strong>ski_mask eyes</strong> (1/99), and{" "}
          <strong>halo_stars accessory</strong> (1/110). Across 1,000 bulls
          you'd statistically expect 9-10 of each. Some categories (mouth,
          horn) intentionally have no Legendary or Epic tier. they're
          flatter by design.
        </p>
      </section>

      {/* === How it's made === */}
      <section className="mb-20">
        <h2 className="h2 mb-2">How it's made</h2>
        <p className="text-[var(--bull-dim)] mb-6">
          The seed is on chain. The render is reproducible from any RPC.
          Three steps, fully documented in source.
        </p>
        <div className="space-y-4">
          <Step n={1} title="Seed from the NFT mint">
            When you wrap, the program generates a new NFT mint pubkey.
            That 32-byte address is the seed. The renderer hashes it with
            SHA-256 and consumes the bytes one trait at a time. <span className="text-[var(--bull-ink)] font-bold">No randomness, no off-chain
            input.</span> Same mint always renders the same bull.
          </Step>
          <Step n={2} title="SVG built cell by cell">
            The renderer outputs a <span className="font-mono text-xs">{"<svg viewBox=\"0 0 24 24\">"}</span> document
            with a background gradient and ~250 <span className="font-mono text-xs">{"<rect width=\"1\" height=\"1\"/>"}</span> elements - one per
            occupied pixel. Vector. Crisp at any size. About 8 KB on disk.
          </Step>
          <Step n={3} title="Served as both SVG and PNG">
            <Link href="/api/render/1?format=svg" className="text-[var(--bull-accent)] hover:underline">/api/render/&lt;tier&gt;?format=svg</Link> returns the vector source.{" "}
            <Link href="/api/render/1" className="text-[var(--bull-accent)] hover:underline">/api/render/&lt;tier&gt;</Link> returns a 768×768 PNG (24×24 grid scaled 32×, nearest-neighbor - no smoothing).
            Both are cached for 24 hours with{" "}
            <span className="font-mono text-xs">Cache-Control: immutable</span> because the visual
            never changes for a given mint.
          </Step>
        </div>
      </section>

      {/* === Where the art lives === */}
      <section className="mb-20">
        <h2 className="h2 mb-2">Where the art lives</h2>
        <div className="card">
          <p className="text-[var(--bull-dim)] leading-relaxed mb-4">
            The <span className="text-[var(--bull-ink)] font-bold">seed</span> (the NFT mint pubkey) lives on
            Solana - immutable, transferable with the NFT. The{" "}
            <span className="text-[var(--bull-ink)] font-bold">renderer</span> is open source on
            GitHub. The <span className="text-[var(--bull-ink)] font-bold">delivered image</span> is served
            from wrappedbulls.com, but anyone can run the renderer locally
            and produce a byte-identical SVG.
          </p>
          <p className="text-sm text-[var(--bull-dim)] leading-relaxed">
            This is why the art is reproducible without trusting us. If the
            site goes down tomorrow, every bull can still be re-rendered
            from any RPC + the open-source renderer code. The art is bound
            to the NFT mint by mathematics, not by a server.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <a
              href="https://github.com/wrappedbulls/wrappedbulls/blob/main/cranker/src/renderer.mjs"
              target="_blank" rel="noopener"
              className="btn btn-secondary"
            >
              View renderer source ↗
            </a>
            <Link href="/tech" className="btn btn-secondary">
              How the program works
            </Link>
            <Link href="/gallery" className="btn btn-primary">
              Browse the herd
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <div className="card flex gap-4 md:gap-6">
      <div className="text-[var(--bull-accent)] font-bold text-xl shrink-0 w-10">
        {String(n).padStart(2, "0")}
      </div>
      <div>
        <div className="font-bold text-lg mb-1">{title}</div>
        <p className="text-sm text-[var(--bull-dim)] leading-relaxed">{children}</p>
      </div>
    </div>
  );
}

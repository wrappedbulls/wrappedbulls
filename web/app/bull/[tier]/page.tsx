import Link from "next/link";
import { fetchBullAsset, getConnection, getCluster, getProgramId } from "@/lib/chain";
import { selectTraits, deriveSeed } from "@/lib/renderer.mjs";
import { notFound } from "next/navigation";
import ShareButtons from "@/app/components/ShareButtons";
import { getRarityForTier } from "@/lib/rarity";
import { getProvenance } from "@/lib/provenance";

export const dynamic = "force-dynamic";
export const revalidate = 30;

const TRAIT_LABELS = {
  body: ["brown", "black", "white", "red", "golden", "cyan", "pink", "zombie", "holo"],
  horn: ["ivory", "dark", "gold", "crimson", "silver"],
  eye: ["normal", "golden", "void", "green", "closed", "angry", "crying", "ski_mask"],
  bg: ["pasture", "sand", "sunset", "chart", "void", "sky", "crimson"],
  acc: [
    "none", "nose_ring", "bell", "war_paint", "gold_chain", "cowboy_hat", "dubai_hat",
    "strawberry_hat", "apple", "crown", "halo", "devil_aura", "diamond_aura", "fire_aura",
    "beanie", "tinfoil", "headband", "mohawk", "top_hat", "sheriff_hat", "tiara", "halo_stars",
    "earring", "mole", "rosy_cheeks", "scar",
  ],
  eyewear: ["none", "mog", "sunglasses_classic", "clout_shades", "thug_life", "3d_glasses", "big_shades", "swag", "lasers"],
  mouth: ["none", "cigarette", "cigar", "grill", "smug", "bubblegum", "smile", "frown", "tongue_out", "open_shout", "pacifier"],
};

export async function generateMetadata({ params }: { params: Promise<{ tier: string }> }) {
  const { tier } = await params;
  return {
    title: `WrappedBulls #${tier}`,
    description: `On-chain hybrid bull NFT holding 1,000,000 $WBULL in a vault tied to the NFT mint.`,
    openGraph: { images: [`/api/render/${tier}`] },
  };
}

interface BullPageContext {
  params: Promise<{ tier: string }>;
}

export default async function BullPage({ params }: BullPageContext) {
  const { tier: tierStr } = await params;
  const tier = parseInt(tierStr, 10);
  if (!Number.isInteger(tier) || tier < 1 || tier > 1000) notFound();

  const conn = getConnection();
  const bull = await fetchBullAsset(conn, tier);
  if (!bull) notFound();

  const seed = deriveSeed(bull.nftMint.toBase58());
  const traits = selectTraits(seed) as Record<string, number>;
  const cluster = getCluster();
  const rarity = await getRarityForTier(conn, getProgramId(), tier);
  const prov = await getProvenance(conn, bull.nftMint.toBase58(), bull.wrappedAt);

  const wrappedAt = new Date(bull.wrappedAt * 1000);
  const explorerCluster = cluster === "mainnet-beta" ? "" : `?cluster=${cluster}`;

  return (
    <main className="max-w-5xl mx-auto px-4 sm:px-6 py-16">
      <Link href="/gallery" className="btn btn-ghost text-sm mb-8 -ml-2">← Back to gallery</Link>

      <div className="grid md:grid-cols-2 gap-10">
        <div>
          <div className="card p-3">
            <img
              src={`/api/render/${tier}`}
              alt={`WrappedBulls #${tier}`}
              className="w-full pixelated rounded-lg"
            />
          </div>
        </div>

        <div>
          <div className="text-xs uppercase tracking-wider text-[var(--bull-dim)] mb-2">WrappedBulls</div>
          <h1 className="h1 mb-3">#{tier}</h1>

          {prov.serial !== null && (
            <div className="flex flex-wrap items-center gap-2 mb-4 text-xs">
              <span className="border-2 border-[var(--bull-ink)] px-2 py-1 font-bold uppercase tracking-wider">
                Serial #{prov.serial}
              </span>
              <span className="border-2 border-[var(--bull-ink)] px-2 py-1 font-bold uppercase tracking-wider">
                Era {prov.era}
              </span>
              {prov.isOG && (
                <span className="px-2 py-1 font-bold uppercase tracking-wider bg-[var(--bull-ink)] text-[var(--bull-paper)]">
                  OG · Founding Herd
                </span>
              )}
            </div>
          )}

          <div className="text-[var(--bull-dim)] mb-8 leading-relaxed">
            Holds <span className="text-[var(--bull-accent)] font-bold">1,000,000 $WBULL</span> in a
            vault tied to this NFT's mint. Sell the NFT and the tokens follow it to the buyer.
          </div>

          {rarity && rarity.total >= 1 && (
            <div className="card mb-4">
              <div className="flex items-baseline justify-between mb-2">
                <div className="text-xs uppercase tracking-wider text-[var(--bull-dim)]">Rarity</div>
                <div className="text-xs text-[var(--bull-dim)]">across {rarity.total} bulls</div>
              </div>
              <div className="text-3xl font-extrabold text-[var(--bull-accent)]">
                Rank #{rarity.rank} <span className="text-base font-normal text-[var(--bull-dim)]">/ {rarity.total}</span>
              </div>
            </div>
          )}

          <div className="card mb-4">
            <div className="text-xs uppercase tracking-wider text-[var(--bull-dim)] mb-3">Traits</div>
            <div className="grid grid-cols-2 gap-3">
              <Trait label="Body" value={TRAIT_LABELS.body[traits.body]} pct={rarity?.perTrait.body.pct} />
              <Trait label="Horn" value={TRAIT_LABELS.horn[traits.horn]} pct={rarity?.perTrait.horn.pct} />
              <Trait label="Eye" value={TRAIT_LABELS.eye[traits.eye]} pct={rarity?.perTrait.eye.pct} />
              <Trait label="Background" value={TRAIT_LABELS.bg[traits.bg]} pct={rarity?.perTrait.bg.pct} />
              <Trait label="Accessory" value={TRAIT_LABELS.acc[traits.acc]} pct={rarity?.perTrait.acc.pct} />
              <Trait label="Eyewear" value={TRAIT_LABELS.eyewear[traits.eyewear]} pct={rarity?.perTrait.eyewear.pct} />
              <Trait label="Mouth" value={TRAIT_LABELS.mouth[traits.mouth]} pct={rarity?.perTrait.mouth.pct} />
            </div>
          </div>

          <div className="card mb-4">
            <div className="text-xs uppercase tracking-wider text-[var(--bull-dim)] mb-3">On-chain</div>
            <Field label="NFT mint" mono>{bull.nftMint.toBase58()}</Field>
            <Field label="Wrapped" mono={false}>{wrappedAt.toUTCString()}</Field>
            <Field label="Cluster" mono={false}>{cluster}</Field>
          </div>

          <div className="flex gap-3 flex-wrap">
            <ShareButtons tier={tier} bodyName={TRAIT_LABELS.body[traits.body]} />
            <a
              href={`https://explorer.solana.com/address/${bull.nftMint.toBase58()}${explorerCluster}`}
              target="_blank"
              rel="noopener"
              className="btn btn-secondary text-sm"
            >
              Solana Explorer ↗
            </a>
            {cluster === "mainnet-beta" && (
              <>
                <a
                  href={`https://magiceden.us/item-details/${bull.nftMint.toBase58()}`}
                  target="_blank"
                  rel="noopener"
                  className="btn btn-secondary text-sm"
                >
                  Magic Eden ↗
                </a>
                <a
                  href={`https://www.tensor.trade/item/${bull.nftMint.toBase58()}`}
                  target="_blank"
                  rel="noopener"
                  className="btn btn-secondary text-sm"
                >
                  Tensor ↗
                </a>
              </>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}

function Trait({ label, value, pct }: { label: string; value: string; pct?: number }) {
  return (
    <div className="bg-[#0e0e12] rounded-md p-3">
      <div className="flex items-baseline justify-between gap-2">
        <div className="text-[10px] uppercase tracking-wider text-[var(--bull-dim)]">{label}</div>
        {pct !== undefined && (
          <div className="text-[10px] text-[var(--bull-dim)]" title={`${pct.toFixed(1)}% of bulls have this ${label.toLowerCase()}`}>
            {pct.toFixed(1)}%
          </div>
        )}
      </div>
      <div className="font-bold text-[var(--bull-accent)] truncate">{value}</div>
    </div>
  );
}

function Field({ label, children, mono }: { label: string; children: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex justify-between items-center gap-3 py-2 border-b border-[#1a1a22] last:border-0">
      <span className="text-xs text-[var(--bull-dim)]">{label}</span>
      <span className={`text-xs ${mono ? "font-mono" : ""} truncate text-right`} title={String(children)}>{children}</span>
    </div>
  );
}

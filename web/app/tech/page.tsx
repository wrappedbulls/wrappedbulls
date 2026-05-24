import Link from "next/link";

export const metadata = {
  title: "Tech - How WrappedBulls works",
  description: "The on-chain mechanic, the vault PDA trick, and why it's the first hybrid token-NFT layer for pump.fun-launched tokens.",
};

export default function TechPage() {
  return (
    <main className="max-w-3xl mx-auto px-4 sm:px-6 py-16">
      <h1 className="h1 mb-6">How <span style={{ color: "var(--bull-accent)" }}>it works</span></h1>
      <p className="text-lg text-[var(--bull-dim)] leading-relaxed mb-12">
        A long-form, mechanical explanation of every moving part. Not marketing - the actual code path.
      </p>

      <Section title="1. The mechanic in one paragraph">
        <p>
          A holder with at least 1,000,000 $WBULL can opt-in to <Hl>wrap</Hl> them. Wrapping mints
          a fresh NFT, transfers the 1,000,000 $WBULL into a vault account, and binds the vault to
          the NFT's mint address. From that moment, the vault is controlled by whoever holds the
          NFT - the program enforces it. The NFT is a standard Metaplex Token Metadata NFT, so it
          lists immediately on Magic Eden and Tensor. When someone buys the NFT, the locked tokens
          come with it. The buyer can keep the NFT or <Hl>unwrap</Hl> it: the program checks they
          hold the NFT, drains the vault back to them, burns the NFT, and frees the tier slot.
        </p>
      </Section>

      <Section title="2. The three on-chain accounts">
        <SubBlock title="BullBank (singleton)">
          <p>One per deployment, PDA seeds <code>[&quot;bank&quot;]</code>.</p>
          <ul>
            <li><Hl>token_mint</Hl> - locked at initialize, never changes</li>
            <li><Hl>total_wrapped</Hl> / <Hl>total_unwrapped</Hl> / <Hl>in_circulation</Hl></li>
            <li><Hl>next_tier</Hl> - counter for fresh tiers (1..1000)</li>
            <li><Hl>free_tiers</Hl> - stack of recycled tiers (popped before next_tier)</li>
          </ul>
        </SubBlock>
        <SubBlock title="BullAsset (per active bull)">
          <p>Created on wrap, closed on unwrap. PDA seeds <code>[&quot;bull&quot;, tier_index]</code>.</p>
          <ul>
            <li><Hl>nft_mint</Hl> - pubkey of the Metaplex NFT</li>
            <li><Hl>tier_index</Hl> - public-facing number (WrappedBulls #N)</li>
            <li><Hl>wrapped_at</Hl> - unix timestamp</li>
          </ul>
        </SubBlock>
        <SubBlock title="Vault token account">
          <p>An ATA holding exactly 1,000,000 $WBULL, owner = PDA at <code>[&quot;vault&quot;, nft_mint]</code>.</p>
          <p>
            <Hl>This is the central trick.</Hl> The vault's authority is derived from the NFT mint.
            It can only be signed for by this program, and only when the caller proves ownership of
            the NFT in the <code>unwrap_bull</code> instruction.
          </p>
        </SubBlock>
      </Section>

      <Section title="3. Why the vault PDA trick works">
        <p className="mb-4"><Hl>Concrete trace:</Hl></p>
        <ol className="space-y-2 list-decimal list-inside">
          <li><Hl>Time 0.</Hl> Alice has 4M $WBULL. She runs <code>wrap_bull</code>. Result: 3M loose, 1 NFT (BULL_42), vault at <code>PDA(&quot;vault&quot;, BULL_42)</code> holding 1M.</li>
          <li><Hl>Time 1.</Hl> Alice lists BULL_42 on Tensor for 5 SOL.</li>
          <li><Hl>Time 2.</Hl> Bob buys BULL_42. NFT moves to Bob, Alice gets SOL. The vault doesn't move - its address and authority are unchanged.</li>
          <li><Hl>Time 3.</Hl> Alice tries <code>unwrap_bull(42)</code>. Program checks: does Alice's NFT ATA hold 1 of BULL_42? <Hl color="danger">No.</Hl> Instruction aborts.</li>
          <li><Hl>Time 4.</Hl> Bob calls <code>unwrap_bull(42)</code>. Program checks: does Bob hold 1 of BULL_42? <Hl color="success">Yes.</Hl> Drains vault to Bob, burns NFT, frees tier.</li>
        </ol>
        <p className="mt-4">
          The tokens "follow the NFT" not because they physically move during a sale - they don't -
          but because <Hl>only the NFT holder can drive the program to unlock them</Hl>. Possession
          of the NFT is possession of the right to call <code>unwrap_bull</code>. That right is the
          ownership of the underlying tokens.
        </p>
      </Section>

      <Section title="4. The three instructions">
        <SubBlock title="initialize">
          <p>One-time call by the protocol deployer. Creates the BullBank, locks the $WBULL mint, sets next_tier = 1.</p>
        </SubBlock>
        <SubBlock title="wrap_bull (7 steps, atomic)">
          <ol className="list-decimal list-inside space-y-1 text-sm">
            <li>Validate caller balance ≥ 1,000,000 $WBULL</li>
            <li>Pop tier (free_tiers stack first, fallback to next_tier)</li>
            <li>Initialize fresh NFT mint (decimals=0, freeze authority = vault PDA)</li>
            <li>Initialize vault ATA (owner = vault PDA)</li>
            <li>Transfer 1,000,000 $WBULL → vault</li>
            <li>Mint 1 NFT to caller's ATA</li>
            <li>Create Metaplex metadata + master edition (locks supply at 1)</li>
          </ol>
        </SubBlock>
        <SubBlock title="unwrap_bull (4 steps, atomic)">
          <ol className="list-decimal list-inside space-y-1 text-sm">
            <li>Verify caller's NFT ATA holds 1 of nft_mint</li>
            <li>Drain vault → caller (signed by vault PDA)</li>
            <li>Burn NFT (mint, ATA, metadata, master edition all closed)</li>
            <li>Push tier back to free_tiers, close BullAsset, return rent to caller</li>
          </ol>
        </SubBlock>
      </Section>

      <Section title="5. Off-chain pieces">
        <ul>
          <li><Hl>cranker</Hl> - Node.js indexer + metadata server on a DigitalOcean box. Read-only; not on the wrap/unwrap critical path.</li>
          <li><Hl>renderer</Hl> - Pure function from sha256(nft_mint) → 24×24 pixel SVG. Locked at wrap time, follows the NFT through transfers.</li>
          <li><Hl>website</Hl> - Next.js at wrappedbulls.com. Wrap/unwrap UI, gallery, /api/metadata + /api/render endpoints.</li>
        </ul>
      </Section>

      <Section title="6. Trait & rarity model">
        <p>Every bull's visual is a deterministic projection of <code>sha256(nft_mint_pubkey)</code> into seven trait slots.</p>
        <p className="mt-2 text-sm text-[var(--bull-dim)]">Per-item drop rates below are ranges across all categories — each category has its own weight sum, so the exact rate of a Rare body item differs from a Rare accessory item. The tier labels reflect design intent and visual impact, not a single fixed percentage.</p>
        <table className="w-full mt-4 text-sm">
          <thead className="text-left text-[var(--bull-dim)] border-b border-[#2a2a32]">
            <tr><th className="py-2">Tier</th><th>Per-item rate</th><th>Examples</th></tr>
          </thead>
          <tbody className="divide-y divide-[#1a1a22]">
            <tr><td className="py-2 font-bold">Common</td><td>22–68%</td><td className="text-[var(--bull-dim)]">brown/black body, ivory horns, normal eyes, pasture/sand bg, &quot;none&quot; for accessory / eyewear / mouth</td></tr>
            <tr><td className="py-2 font-bold">Uncommon</td><td>5–18%</td><td className="text-[var(--bull-dim)]">white/red body, dark/gold horns, closed/angry eyes, sky/sunset bg, bell, gold_chain, cowboy_hat, sunglasses, 3d_glasses, frown, cigarette</td></tr>
            <tr><td className="py-2 font-bold">Rare</td><td>2.7–12%</td><td className="text-[var(--bull-dim)]">golden/cyan/pink body, crimson/silver horns, crying eyes, chart/crimson bg, top_hat, mohawk, tiara, Pump, Phantom, mog, thug_life</td></tr>
            <tr><td className="py-2 font-bold">Epic</td><td>1.8–4%</td><td className="text-[var(--bull-dim)]">zombie body, void/gold/green eyes, void bg, fire_aura, diamond_aura, halo, scar, dubai_hat, lasers, grill</td></tr>
            <tr><td className="py-2 font-bold" style={{ color: "var(--bull-accent)" }}>Legendary</td><td>~1% (1/99 to 1/110)</td><td className="text-[var(--bull-dim)]">holo body, ski_mask eyes, halo_stars accessory</td></tr>
          </tbody>
        </table>
        <p className="mt-3 text-xs text-[var(--bull-dim)]">Mouth and horn categories intentionally cap at Rare — they have no Epic or Legendary tier, so the bull's facial expression and horn color stay readable at a glance.</p>
      </Section>

      <Section title="7. Lifecycle of a single bull">
        <ol className="list-decimal list-inside space-y-2">
          <li><Hl>Birth.</Hl> Wrap creates the NFT mint. Visual is computed from the new mint address - locked from this moment forward.</li>
          <li><Hl>Travel.</Hl> The NFT is a regular Metaplex NFT. Transfer it, list it, swap it. The vault stays where it is, accessible only through whoever holds the NFT.</li>
          <li><Hl>Death.</Hl> The current holder calls unwrap_bull. Vault drains, NFT burns, tier returns to the free_tiers stack.</li>
          <li><Hl>Rebirth (optional).</Hl> A later wrapper claims the same tier number, but a fresh NFT mint generates a new visual. Tier 42 v2 looks nothing like tier 42 v1. Every wrap is a fresh roll.</li>
        </ol>
      </Section>

      <div className="mt-16 text-center">
        <Link href="/wrap" className="btn btn-primary">Wrap your first bull →</Link>
      </div>
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-12">
      <h2 className="h2 mb-4">{title}</h2>
      <div className="text-[var(--bull-dim)] leading-relaxed space-y-3">{children}</div>
    </section>
  );
}

function SubBlock({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="card mt-3">
      <div className="font-bold text-[var(--bull-ink)] mb-2">{title}</div>
      <div className="text-sm text-[var(--bull-dim)] space-y-2">{children}</div>
    </div>
  );
}

function Hl({ children, color }: { children: React.ReactNode; color?: "success" | "danger" }) {
  const colorVar =
    color === "success" ? "var(--bull-success)" :
    color === "danger" ? "var(--bull-danger)" :
    "var(--bull-ink)";
  return <span style={{ color: colorVar, fontWeight: 700 }}>{children}</span>;
}

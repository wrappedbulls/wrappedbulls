import Link from "next/link";

export const metadata = {
  title: "About WrappedBulls",
  description: "What WrappedBulls is, why it exists, and how it brings hybrid token-NFT mechanics to pump.fun-launched tokens.",
};

export default function AboutPage() {
  return (
    <main className="max-w-3xl mx-auto px-4 sm:px-6 py-16">
      <h1 className="h1 mb-6">About <span style={{ color: "var(--bull-accent)" }}>WrappedBulls</span></h1>

      <section className="prose-block">
        <p className="text-lg text-[var(--bull-dim)] leading-relaxed mb-8">
          WrappedBulls is an upgrade layer for the pump.fun token standard. Pump.fun ships clean,
          bare SPL tokens - bonding curve, graduation, PumpSwap, creator fees. What it doesn't ship
          is any NFT primitive. WrappedBulls fills that gap.
        </p>

        <h2 className="h2 mb-4 mt-12">The problem</h2>
        <p className="text-[var(--bull-dim)] leading-relaxed mb-4">
          The standard hybrid token-NFT mechanic on Solana, SPL-404 (used by Mutantmon, Mall
          Street, Flyffys), requires Token-2022 - the newer Solana token standard with transfer
          hooks. Pump.fun launches classic SPL tokens (the older, hookless standard). The two are
          not interoperable. To use SPL-404 you have to abandon pump.fun's launchpad culture
          entirely.
        </p>
        <p className="text-[var(--bull-dim)] leading-relaxed mb-4">
          So the obvious question: can you bind a token to an NFT on standard SPL, without
          modifying the token, on the launchpad people actually use?
        </p>

        <h2 className="h2 mb-4 mt-12">Our answer</h2>
        <p className="text-[var(--bull-dim)] leading-relaxed mb-4">
          An NFT-owned vault PDA wrapper. Each Bull NFT has a dedicated vault holding 1,000,000 of
          the underlying token, with the vault's authority derived from the NFT's mint address.
        </p>
        <p className="text-[var(--bull-dim)] leading-relaxed mb-4">
          Result: when an NFT trades on Magic Eden or Tensor, the locked tokens follow it atomically.
          Buy the NFT → you control the vault. Sell the NFT → the buyer controls it. The token
          stays standard SPL the whole time.
        </p>
        <p className="text-[var(--bull-dim)] leading-relaxed mb-4">
          The wrap is voluntary, on-chain, audited by code, and reversible. We extend pump.fun
          rather than replacing it.
        </p>

        <h2 className="h2 mb-4 mt-12">Peer reference</h2>
        <p className="text-[var(--bull-dim)] leading-relaxed mb-4">
          uPeg uses Uniswap v4 hooks to bind a token to a generative NFT on Ethereum.
          WrappedBulls uses Solana PDAs to bind a token to a separately-tradeable NFT on
          pump.fun. Different problems, same instinct: use a chain primitive instead of a
          hybrid token standard.
        </p>

        <h2 className="h2 mb-4 mt-12">What we add on top</h2>
        <ul className="space-y-3 text-[var(--bull-dim)]">
          <li><span className="text-[var(--bull-accent)] font-bold">→ NFT-owned vault PDA pattern.</span> The mechanism that makes tokens follow the NFT through any marketplace transfer without modifying the underlying SPL token.</li>
          <li><span className="text-[var(--bull-accent)] font-bold">→ Wrap / unwrap layer.</span> A small, audited Anchor program with two user-initiated instructions and zero admin gates.</li>
          <li><span className="text-[var(--bull-accent)] font-bold">→ Deterministic visual.</span> A renderer that maps the NFT mint address to a 24×24 SVG. No off-chain images, no IPFS pinning, no centralized art server failure mode. The visual is reproducible from chain state alone.</li>
        </ul>

        <h2 className="h2 mb-4 mt-12">What pump.fun gives us free</h2>
        <ul className="space-y-3 text-[var(--bull-dim)]">
          <li><span className="text-[var(--bull-accent)] font-bold">→ Bonding curve.</span> Token launches at zero, tracks a curve to ~$69K market cap, graduates automatically.</li>
          <li><span className="text-[var(--bull-accent)] font-bold">→ PumpSwap LP.</span> At graduation, an AMM pool is created on PumpSwap and the LP tokens are burned. Liquidity is permanent.</li>
          <li><span className="text-[var(--bull-accent)] font-bold">→ Creator revenue.</span> 0.3% of bonding-curve volume + up to 0.05% of PumpSwap volume - funds ops indefinitely.</li>
          <li><span className="text-[var(--bull-accent)] font-bold">→ Wallet support.</span> Standard SPL means every Solana wallet handles the token without custom integration work.</li>
        </ul>

        <h2 className="h2 mb-4 mt-12">Creator rewards</h2>
        <p className="text-[var(--bull-dim)] leading-relaxed mb-4">
          Pump.fun streams up to 0.05% of PumpSwap volume back to the token
          creator as creator revenue share. For WrappedBulls, that revenue is
          the project's operating budget and the lever we use to keep the
          ecosystem alive after launch day. No new tokens get minted to fund
          ops - the 1B $WBULL supply is fixed. Everything below comes
          exclusively from creator rewards.
        </p>
        <p className="text-[var(--bull-dim)] leading-relaxed mb-4">
          How those rewards get deployed:
        </p>
        <ul className="space-y-3 text-[var(--bull-dim)]">
          <li>
            <span className="text-[var(--bull-accent)] font-bold">→ Build forward.</span>{" "}
            Fund development of the next layer on top of pump.fun - additional
            hybrid mechanics for other Solana memes, marketplace integrations,
            new NFT primitives, and infrastructure that the team finds useful
            to ship. WrappedBulls is the first thing we built; it's not the
            last.
          </li>
          <li>
            <span className="text-[var(--bull-accent)] font-bold">→ Strengthen $WBULL.</span>{" "}
            A portion of creator rewards goes back into the token itself via
            on-market buybacks, time-locked treasury holdings, and periodic
            burns. The exact mix is discretionary - the goal is fewer
            circulating tokens chasing the same bulls, not a fixed schedule.
          </li>
          <li>
            <span className="text-[var(--bull-accent)] font-bold">→ Marketing.</span>{" "}
            Paid promotion, partnerships, content production, and creator
            collaborations. Money spent on getting the project in front of
            audiences who would actually like it.
          </li>
          <li>
            <span className="text-[var(--bull-accent)] font-bold">→ Admin + activations.</span>{" "}
            Marketplace listing fees and review applications, infrastructure
            (RPC, hosting, monitoring), event sponsorships, and on-the-ground
            activations that turn online attention into real interactions.
          </li>
        </ul>
        <p className="text-xs text-[var(--bull-dim)] italic mt-4">
          None of this is a contractual commitment, return promise, or yield
          mechanism. Creator rewards are the founder's operating capital,
          spent at the team's discretion in service of the project's
          long-term health. Holders should hold $WBULL for the mechanic, not
          for a buyback schedule.
        </p>

        <h2 className="h2 mb-4 mt-12">Status</h2>
        <ul className="space-y-2 text-[var(--bull-dim)]">
          <li><span className="text-[var(--bull-accent)]">●</span> Anchor program live on devnet (full test suite passing including vault-follows-NFT proof)</li>
          <li><span className="text-[var(--bull-accent)]">●</span> Metadata + render API live at wrappedbulls.com</li>
          <li><span className="text-[var(--bull-accent)]">●</span> Wrap / unwrap UI online</li>
          <li><span className="text-[var(--bull-dim)]">○</span> Mainnet program deploy</li>
          <li><span className="text-[var(--bull-dim)]">○</span> $WBULL launch on pump.fun</li>
        </ul>

        <div className="mt-12 flex gap-3 flex-wrap">
          <Link href="/tech" className="btn btn-primary">Read the tech →</Link>
          <Link href="/wrap" className="btn btn-secondary">Wrap a bull</Link>
        </div>
      </section>
    </main>
  );
}

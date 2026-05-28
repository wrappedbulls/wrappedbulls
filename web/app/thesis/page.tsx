import Link from "next/link";

export const metadata = {
  title: "Thesis - WrappedBulls",
  description:
    "The first hybrid token-NFT layer for pump.fun-launched memecoins. Built on standard SPL using an NFT-owned vault PDA, where SPL-404 doesn't work.",
};

export default function ThesisPage() {
  return (
    <main className="max-w-2xl mx-auto px-4 sm:px-6 py-20 md:py-28">
      <header className="mb-20">
        <div className="text-xs uppercase tracking-[0.25em] text-[var(--bull-dim)] mb-4">
          The thesis
        </div>
        <h1 className="text-3xl md:text-4xl font-bold leading-tight tracking-tight mb-0">
          A token that is also an NFT. Tradeable on pump.fun and on every
          Solana NFT marketplace at the same time. Built where nobody else
          had built it.
        </h1>
      </header>

      <Section n="01">
        Pump.fun ships clean, bare SPL tokens. Bonding curve, graduation to
        PumpSwap, creator fees. What it doesn't ship is any NFT primitive.
        The hybrid token-NFT mechanic on Solana - SPL-404 - 
        requires Token-2022, which is incompatible with the classic SPL
        tokens pump.fun launches. Every existing hybrid project had to
        leave the launchpad to work. The constraint nobody had solved: how
        do you bind a token to an NFT without modifying the token?
      </Section>

      <Section n="02">
        WrappedBulls solves it with an NFT-owned vault PDA. Each Bull NFT
        has a vault token account whose authority is derived from the
        NFT's mint pubkey itself:{" "}
        <code className="text-[var(--bull-accent)]">PDA(["vault", nft_mint])</code>.
        The vault has no private key anywhere. The only way to sign for it
        is through this program, which gates signing on the caller holding
        1 of <code className="text-[var(--bull-accent)]">nft_mint</code>.
      </Section>

      <Section n="03">
        When the NFT trades on Magic Eden or Tensor, the vault doesn't
        physically move. The address is unchanged. The authority is
        unchanged. What changes is who can drive the program to drain it.
        Possession of the NFT is possession of the right to redeem the
        tokens. The underlying SPL token never had to be modified. The
        launchpad never had to be replaced.
      </Section>

      <Section n="04">
        The result: the first hybrid token-NFT layer that works on
        pump.fun-launched memecoins. 1,000 max supply. 1,000,000 $WBULL
        per bull. 100% on-chain pixel art. Same launchpad you already use,
        same PumpSwap graduation, same wallet UX - with a native NFT
        primitive on top of the standard token.
      </Section>

      <Section n="05">
        uPeg uses Uniswap v4 hooks to bind a token to a generative NFT on
        Ethereum. WrappedBulls uses Solana PDAs to bind a token to a
        separately-tradeable NFT on pump.fun. Different problems, same
        instinct: use a chain primitive instead of a hybrid token
        standard.
      </Section>

      <div className="mt-24 text-center">
        <div className="text-5xl mb-6">🐂</div>
        <div className="text-2xl font-bold mb-3">
          <span style={{ color: "var(--bull-accent)" }}>WrappedBulls</span>
        </div>
        <p className="text-[var(--bull-dim)] italic">
          A token that is also an NFT. Built on the launchpad where nobody
          else could build it.
        </p>
      </div>

      <div className="mt-20 flex justify-center gap-3">
        <Link href="/wrap" className="btn btn-primary">Wrap a Bull →</Link>
        <Link href="/tech" className="btn btn-secondary">Read the tech</Link>
      </div>
    </main>
  );
}

function Section({ n, children }: { n: string; children: React.ReactNode }) {
  return (
    <section className="mb-16 md:mb-20">
      <div className="text-[var(--bull-accent)] font-bold text-2xl mb-4 tracking-wider">
        {n}
      </div>
      <div className="text-lg leading-relaxed text-[var(--bull-ink)]">
        {children}
      </div>
    </section>
  );
}

import Link from "next/link";

export default function Footer() {
  return (
    <footer className="border-t border-[#1a1a22] mt-20">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-10 flex flex-col md:flex-row justify-between gap-6 text-sm text-[var(--bull-dim)]">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <img src="/mascot.png" alt="" width={24} height={24} className="pixelated rounded" />
            <span className="font-bold text-[var(--bull-ink)]">WrappedBulls</span>
          </div>
          <div>The first hybrid token-NFT layer for pump.fun-launched memecoins.</div>
        </div>
        <div className="flex gap-8 flex-wrap">
          <div className="flex flex-col gap-1">
            <div className="text-[var(--bull-ink)] font-bold text-xs uppercase tracking-wider mb-1">Product</div>
            <Link href="/wrap" className="hover:text-[var(--bull-accent)]">Wrap</Link>
            <Link href="/unwrap" className="hover:text-[var(--bull-accent)]">Unwrap</Link>
            <Link href="/gallery" className="hover:text-[var(--bull-accent)]">Gallery</Link>
          </div>
          <div className="flex flex-col gap-1">
            <div className="text-[var(--bull-ink)] font-bold text-xs uppercase tracking-wider mb-1">Learn</div>
            <Link href="/thesis" className="hover:text-[var(--bull-accent)]">Thesis</Link>
            <Link href="/tech" className="hover:text-[var(--bull-accent)]">How it works</Link>
            <Link href="/art" className="hover:text-[var(--bull-accent)]">Art</Link>
            <Link href="/about" className="hover:text-[var(--bull-accent)]">About</Link>
          </div>
          <div className="flex flex-col gap-1">
            <div className="text-[var(--bull-ink)] font-bold text-xs uppercase tracking-wider mb-1">Trade</div>
            <a href="https://magiceden.io" target="_blank" rel="noopener" className="hover:text-[var(--bull-accent)]">Magic Eden ↗</a>
            <a href="https://tensor.trade" target="_blank" rel="noopener" className="hover:text-[var(--bull-accent)]">Tensor ↗</a>
            <a href="https://pump.fun" target="_blank" rel="noopener" className="hover:text-[var(--bull-accent)]">pump.fun ↗</a>
          </div>
          <div className="flex flex-col gap-1">
            <div className="text-[var(--bull-ink)] font-bold text-xs uppercase tracking-wider mb-1">Follow</div>
            <a href="https://x.com/wrappedbulls" target="_blank" rel="noopener" className="hover:text-[var(--bull-accent)]">X / Twitter ↗</a>
            <a href="https://github.com/wrappedbulls/wrappedbulls" target="_blank" rel="noopener" className="hover:text-[var(--bull-accent)]">GitHub ↗</a>
          </div>
        </div>
      </div>
      <div className="border-t border-[#1a1a22] py-4 text-center text-xs text-[var(--bull-dim)]">
        wrappedbulls.com · 1B supply · 1M $WBULL per bull · 1,000 bulls max
      </div>
    </footer>
  );
}

// /faq - frequently asked questions about the WrappedFactory.
//
// Three audiences:
//   1. Holders deciding whether to buy a wrapped NFT
//   2. Deployers thinking about launching a wrap layer
//   3. Curious onlookers who want to know how the tech works
//
// Each Q is plain language, every A is concrete and links to the
// on chain artifact or to /security / /terms where appropriate.

import Link from "next/link";

export const metadata = {
  title: "FAQ • WrappedBulls",
  description:
    "Frequently asked questions about the WrappedFactory: what it does, " +
    "how to wrap, how to unwrap, what happens to your tokens, who controls what.",
};

export const dynamic = "force-static";

export default function FaqPage() {
  return (
    <main className="max-w-3xl mx-auto px-4 sm:px-6 py-16">
      <h1 className="h1 mb-3">FAQ</h1>
      <p className="text-[var(--bull-dim)] text-lg mb-10">
        Quick answers to the questions we get most often. For full risk
        disclosure see{" "}
        <Link href="/terms" className="text-[var(--bull-accent)] hover:underline">/terms</Link>;
        for the technical surface see{" "}
        <Link href="/security" className="text-[var(--bull-accent)] hover:underline">/security</Link>.
      </p>

      <Group title="The basics">
        <QA q="What is the WrappedFactory?">
          A permissionless Solana smart contract that lets any holder of any
          pump.fun token create a wrap layer. A wrap layer locks a fixed
          amount of the underlying token inside an NFT. Whoever holds the NFT
          can unwrap it back into the locked tokens at any time.
        </QA>
        <QA q="Why would I wrap a token?">
          A few reasons. NFTs are easier to display, transfer, and trade on
          NFT marketplaces than fungible tokens. They have collection
          identity (verified collection NFT, MCC). They can carry per tier
          art. They give a token holder a single unit that bundles a fixed
          quantity, which can simplify swaps and gifts. None of these reasons
          is investment advice; you might also have your own reason.
        </QA>
        <QA q="Does wrapping change my token?">
          No. The underlying token is unchanged. Wrapping moves your tokens
          into a vault and gives you an NFT that represents them. Unwrapping
          burns the NFT and returns the same quantity to your wallet.
        </QA>
        <QA q="How do I wrap?">
          Visit the deployment page for the wrap layer you want to use (eg.{" "}
          <code>/launch/&lt;ticker&gt;</code>) and click Wrap. Your wallet
          will prompt for one signature. If you do not currently hold enough
          of the target token, a Buy bridge card will appear above the wrap
          button so you can swap into the token via Jupiter inline.
        </QA>
        <QA q="How do I unwrap?">
          On the same deployment page, click Unwrap. If you hold the NFT,
          you sign once and the locked tokens return to your wallet. The NFT
          is burned in the same transaction.
        </QA>
      </Group>

      <Group title="Trust + safety">
        <QA q="Who controls my locked tokens?">
          Nobody, including WrappedBulls. Each wrap layer's locked tokens
          sit in vault PDAs whose authority is derived from the NFT mint.
          The on chain program will only release a vault to whoever can
          prove they hold the NFT in their wallet. If you hold the NFT, you
          can unwrap; if you do not, no one can.
        </QA>
        <QA q="Can WrappedBulls drain a wrap layer?">
          No. The vault signing authority is a PDA derived from the NFT,
          not from any wallet under our control. The program contains no
          path to move locked tokens to anyone other than the NFT holder.
        </QA>
        <QA q="What about scam deploys?">
          The Factory is permissionless. Anyone who pays the 1,000,000
          $WBULL deploy fee can launch a wrap layer for any pump.fun token,
          which means impersonation deploys exist. The on chain verified
          flag is how we distinguish the canonical wrap layer for a given
          token from copies. Only verified deployments carry the green
          badge on this site. Unverified deployments are not necessarily
          scams, but they are not endorsed by us either; the responsibility
          to evaluate them rests with you.
        </QA>
        <QA q="Has the program been audited?">
          Internally, yes. We have run a full audit pass (see{" "}
          <code>docs/AUDIT_FACTORY.md</code> in the public repo). All
          Critical, High, and Medium findings are closed. The program has
          NOT received an external third party audit. See{" "}
          <Link href="/terms" className="text-[var(--bull-accent)] hover:underline">/terms</Link>{" "}
          for the full risk language.
        </QA>
        <QA q="Is the program upgradeable?">
          During the soak period (30 to 60 days after mainnet launch), yes.
          The upgrade authority is held by the WrappedBulls operator as a
          single hot keypair. After the soak period, if no critical bugs
          surface, the authority is either moved to a hardware wallet or
          revoked entirely so the program becomes permanently immutable.
          See{" "}
          <Link href="/terms" className="text-[var(--bull-accent)] hover:underline">/terms</Link>{" "}
          for the full policy.
        </QA>
        <QA q="What is the circuit breaker?">
          The program has a global pause flag flipped via the
          set_factory_paused instruction. When paused, the program rejects
          new wraps, new deploys, and treasury claims. Unwrap is never
          paused. The flag exists so that during an incident we can stop
          new asset capture while we investigate, without preventing users
          from withdrawing what they have already wrapped.
        </QA>
        <QA q="What if I lose my wallet?">
          If you lose access to the wallet holding your NFT, you lose
          access to the locked tokens. We cannot recover wallets, restore
          keys, or transfer NFTs on your behalf. Back up your seed phrase.
        </QA>
      </Group>

      <Group title="Deploying your own wrap layer">
        <QA q="Who can deploy a wrap layer?">
          Anyone holding 1,000,000 $WBULL plus the SOL needed for rent
          (about 0.05 SOL for account creation). No allowlist outside of
          the launch canary window.
        </QA>
        <QA q="What happens to the 1M $WBULL deploy fee?">
          It transfers atomically into the bull treasury vault. The fee is
          not burned. It is subject to a 7 day per deposit lock: the
          protocol multisig (operator hot key, during the soak period)
          cannot claim the deposit until 7 days after it lands. Treasury
          activity is publicly visible at{" "}
          <Link href="/launch/treasury" className="text-[var(--bull-accent)] hover:underline">/launch/treasury</Link>.
        </QA>
        <QA q="What can I configure when I deploy?">
          Wrap layer name (max 25 chars), ticker (max 10 chars), max NFT
          supply (100 to 2,000), tokens locked per wrap, and art source
          (a static base URI or a renderer URL). All of these are written
          to chain at deploy and cannot be changed afterward (a future
          set_collection_uri ix will gate URI edits behind deployer plus
          factory authority co signature).
        </QA>
        <QA q="Can I unwrap a deployment I created?">
          You unwrap as a holder, not as a deployer. To unwrap an NFT, you
          must hold it in your wallet. The deployer of a wrap layer has no
          special unwrap privileges. The deployer is recorded immutably on
          the WrappedCollection PDA but does not carry economic rights to
          the locked tokens of other holders.
        </QA>
        <QA q="What is the algorithmic art option?">
          Not yet live (marked "coming soon" on the wizard). Will let
          deployers seed an on chain deterministic art generator instead of
          pointing at an external base URI. Planned for V1.1.
        </QA>
        <QA q="What is the bespoke art option?">
          A flow for deployers who want fully custom art commissioned by
          our art team. 1M $WBULL deposit plus a quoted balance based on
          scope. See the wizard for details.
        </QA>
      </Group>

      <Group title="Tech + verifiability">
        <QA q="Where is the source code?">
          <a
            className="text-[var(--bull-accent)] hover:underline"
            href="https://github.com/wrappedbulls/wrappedbulls"
            target="_blank" rel="noopener"
          >
            github.com/wrappedbulls/wrappedbulls
          </a>. Open source. Anyone can read it.
        </QA>
        <QA q="Can I verify the on chain bytecode matches the source?">
          Yes. Run{" "}
          <code>solana-verify get-program-hash &lt;PROGRAM_ID&gt; --url mainnet-beta</code>{" "}
          and compare to the hash in{" "}
          <code>docs/VERIFIED_BUILD_FACTORY.md</code> in the repo. The doc
          also lists the exact toolchain (Rust 1.95.0, Anchor 1.0.2) used
          to produce the canonical hash.
        </QA>
        <QA q="Does the Factory work with Token-2022 mints?">
          Yes for the basic transfer interface. Most pump.fun tokens have
          migrated to Token-2022 since 2026. The program uses the SPL
          TokenInterface abstraction and the client side ATA derivation
          branches on the mint's owner program. See the Token-2022
          integration test suite (<code>tests/wrappedfactory_token2022.ts</code>)
          for the verified scenarios.
        </QA>
        <QA q="Can I integrate the Factory into my own app?">
          Yes. The <code>@wrappedbulls/sdk</code> package exposes builder
          methods for every Factory instruction. Source is in{" "}
          <code>sdk/src/index.ts</code> of the public repo. The embeddable
          activity widget at{" "}
          <Link href="/launch/embed" className="text-[var(--bull-accent)] hover:underline">/launch/embed</Link>{" "}
          is a drop in script tag if you just want a live feed.
        </QA>
        <QA q="Where does the Factory NFT art come from?">
          From the deployer's chosen art source. If they specified a base
          URI, each NFT's URI is <code>baseUri + tierIndex</code>. If they
          specified a renderer URL, the URL is queried with the tier
          index. WrappedBulls does not host metadata for Factory
          deployments; that is the deployer's choice and responsibility.
        </QA>
      </Group>

      <div className="text-center mt-12">
        <Link href="/launch" className="btn btn-primary">[ EXPLORE WRAP LAYERS → ]</Link>
      </div>
    </main>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-12">
      <h2 className="h2 mb-4">{title}</h2>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

function QA({ q, children }: { q: string; children: React.ReactNode }) {
  return (
    <details className="card group" style={{ padding: 0 }}>
      <summary
        className="cursor-pointer list-none flex items-start gap-3"
        style={{ padding: 16, fontWeight: 700 }}
      >
        <span
          className="text-[var(--bull-dim)] mt-[2px] shrink-0 transition-transform group-open:rotate-90"
          style={{ display: "inline-block" }}
        >
          ▶
        </span>
        <span>{q}</span>
      </summary>
      <div
        className="text-[var(--bull-dim)] text-sm"
        style={{ padding: "0 16px 16px 35px", lineHeight: 1.6 }}
      >
        {children}
      </div>
    </details>
  );
}

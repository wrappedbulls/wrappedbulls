// /terms - Terms of use + risk disclosure for the WrappedFactory.
//
// Written in plain language. The protocol is permissionless and runs on
// chain; this page tells anyone landing on wrappedbulls.com what that
// actually means for them, what we control and what we do not, and the
// risks they accept by interacting with the protocol.
//
// Pre launch publication is intentional: a permissionless asset locking
// primitive deserves clear disclosure before the first wrap fires.

import Link from "next/link";

export const metadata = {
  title: "Terms of use • WrappedBulls",
  description:
    "Terms of use and risk disclosure for the WrappedFactory protocol. " +
    "What the protocol does, what we control, and the risks of interacting.",
};

export const dynamic = "force-static";

export default function TermsPage() {
  return (
    <main className="max-w-3xl mx-auto px-4 sm:px-6 py-16">
      <h1 className="h1 mb-3">Terms of use</h1>
      <p className="text-[var(--bull-dim)] text-lg mb-2">
        Plain language disclosure of what the protocol does and the risks of
        interacting with it.
      </p>
      <p className="text-[var(--bull-dim)] text-xs mb-10">
        Last updated 2026-06-03. WrappedBulls invented this tech.
      </p>

      <Section title="What the WrappedFactory is">
        <p className="mb-3">
          WrappedFactory is a permissionless smart contract on Solana that lets
          any holder of any pump.fun token create a wrap layer. A wrap layer
          locks a fixed quantity of a target token inside a per NFT vault and
          mints an NFT representing that locked balance. The vault follows the
          NFT through every trade. Anyone who holds the NFT can unwrap it back
          into the locked tokens.
        </p>
        <p className="mb-3">
          wrappedbulls.com is a user interface for the protocol. The protocol
          itself lives on chain at the program ID listed on{" "}
          <Link href="/security" className="text-[var(--bull-accent)] hover:underline">/security</Link>.
          The protocol is the source of truth. The website is one way to interact
          with it; anyone can interact directly via CLI or a different frontend.
        </p>
      </Section>

      <Section title="What we control and what we do not">
        <p className="mb-3 font-bold">We do not control:</p>
        <ul className="list-disc list-inside space-y-2 text-[var(--bull-dim)] mb-4">
          <li>Locked tokens. Each wrap layer's locked tokens sit in vault PDAs
              whose authority is derived from the corresponding NFT mint. Only
              the wallet holding the NFT can authorize an unwrap. We cannot move,
              freeze, or recover locked tokens under any circumstance.</li>
          <li>NFT transfers. Once minted, an NFT is a standard SPL token; it
              transfers on Magic Eden, Tensor, peer to peer, anywhere.</li>
          <li>Token prices. Wrapped collections do not promise yield, peg, or
              floor price. Token prices can go to zero.</li>
          <li>The deployments themselves. Anyone with 1,000,000 $WBULL can
              deploy a wrap layer for any pump.fun token.</li>
        </ul>
        <p className="mb-3 font-bold">We do control:</p>
        <ul className="list-disc list-inside space-y-2 text-[var(--bull-dim)]">
          <li>The program upgrade authority (during the soak period; see
              policy below). This means we can patch program code.</li>
          <li>The verified badge. Through the on chain set_verified
              instruction, we mark which deployment is the canonical wrap
              layer for a given token. Unverified deployments are not the
              same as verified ones; users should pay attention.</li>
          <li>The circuit breaker. We can globally pause new wraps, new
              deploys, and treasury claims through the set_factory_paused
              instruction. We cannot pause unwrap. Locked tokens are always
              drainable by their NFT holder regardless of pause state.</li>
          <li>The bull treasury claim path. Deploy fees accrue to the
              treasury with a 7 day per deposit lock. We can sweep expired
              entries; we cannot front run the 7 day lock.</li>
        </ul>
      </Section>

      <Section title="Risks you accept by interacting">
        <ul className="list-disc list-inside space-y-3 text-[var(--bull-dim)]">
          <li><span className="text-[var(--bull-ink)] font-bold">Permissionless deploys mean scam wrappers exist.</span>{" "}
              Anyone can pay 1M $WBULL and deploy a wrap layer for any token,
              including impersonations, low effort copies, or outright scams.
              The verified badge is the canonical signal; if you are wrapping
              into an unverified layer, you are choosing to.</li>
          <li><span className="text-[var(--bull-ink)] font-bold">Wrap layer immutability.</span>{" "}
              Once deployed, a wrap layer's max supply, tokens per wrap, and
              art source URI are written to chain and cannot be changed. The
              deployer is locked into their original choices. (Renderer URL
              edits are a planned V1.1 feature, gated to deployer plus factory
              authority co signature.)</li>
          <li><span className="text-[var(--bull-ink)] font-bold">No fund recovery.</span>{" "}
              Lost private keys, sent NFTs to wrong addresses, transactions
              signed in error, mistyped pubkeys: there is no recovery path.
              We do not have the keys to your wallet.</li>
          <li><span className="text-[var(--bull-ink)] font-bold">Smart contract risk.</span>{" "}
              The program has been internally audited (see{" "}
              <Link href="/security" className="text-[var(--bull-accent)] hover:underline">/security</Link>{" "}
              for audit invariants and the audit document). It has NOT
              received an external third party security audit. Use at your own
              risk.</li>
          <li><span className="text-[var(--bull-ink)] font-bold">Token program risk.</span>{" "}
              Some pump.fun tokens use the Token-2022 program with extensions.
              Some extensions (transfer fee, transfer hook, confidential
              transfer) can change behavior in ways the wrap layer does not
              anticipate. The protocol supports the basic transfer interface
              for both classic SPL and Token-2022.</li>
          <li><span className="text-[var(--bull-ink)] font-bold">Marketplace and indexer risk.</span>{" "}
              Marketplaces (Magic Eden, Tensor) and indexers are third party
              services we do not control. Their UIs may misrender, cache, or
              fail to load any deployment's NFTs.</li>
          <li><span className="text-[var(--bull-ink)] font-bold">Pump.fun dependency.</span>{" "}
              The Factory wraps pump.fun tokens. Changes to pump.fun (program
              ID, mint behavior, migration to a new format) may affect
              existing wrap layers in ways we cannot patch retroactively.</li>
          <li><span className="text-[var(--bull-ink)] font-bold">Jurisdictional risk.</span>{" "}
              Some jurisdictions prohibit interacting with permissionless
              protocols, with NFT collections, or with assets whose underlying
              economics rest on a memecoin layer. You are solely responsible
              for your own compliance with the laws applicable to you.</li>
        </ul>
      </Section>

      <Section title="Upgrade authority policy">
        <p className="mb-3">
          The program is currently deployed with a single hot keypair as
          upgrade authority. This keypair is held by the WrappedBulls operator.
          During the soak period (30 to 60 days after mainnet launch) we
          retain upgrade authority so we can patch logic bugs that surface in
          real conditions. At the end of the soak period, if no critical bugs
          surface, we will either transfer authority to a hardware wallet, or
          revoke it entirely so the program becomes permanently immutable.
        </p>
        <p className="mb-3">
          We did not adopt a multisig for the launch authority. The protocol
          is operated by one person; introducing a multisig under that posture
          adds complexity without adding real second signer review. Anyone
          interacting with the protocol during the soak period is trusting the
          operator not to push a malicious upgrade. The on chain bytecode hash
          before and after every upgrade is publicly verifiable; see{" "}
          <Link href="/security" className="text-[var(--bull-accent)] hover:underline">/security</Link>{" "}
          for the verifiable build process.
        </p>
      </Section>

      <Section title="Circuit breaker policy">
        <p className="mb-3">
          The program has a global pause flag, flipped via the
          set_factory_paused instruction. When paused, the program rejects new
          wraps, new deploy_collections, and treasury claims. Unwrap is never
          guarded. Users can always withdraw their locked tokens regardless of
          pause state; pausing unwrap would constitute fund capture, which the
          circuit breaker exists to prevent.
        </p>
        <p className="mb-3">
          We will pause the protocol if we observe evidence of an active
          exploit, a Metaplex CPI regression, an unbounded treasury growth
          attack, or any other failure mode listed in our pre mortem document.
          Pause is a triage tool, not a censorship tool; we do not pause based
          on the content of any individual deployment.
        </p>
      </Section>

      <Section title="Privacy">
        <p>
          We do not collect personal data, run accounts, set cookies, run
          analytics, or require KYC. The website is a stateless interface to a
          public blockchain. Your wallet address is visible to the chain (and
          therefore the website while you have a session open). We do not log
          it, store it, or share it.
        </p>
      </Section>

      <Section title="No investment advice">
        <p>
          Nothing on wrappedbulls.com or in any document we publish is
          investment advice, financial advice, legal advice, or a
          recommendation to interact with any specific deployment. The
          protocol is infrastructure; how you use it is your decision.
        </p>
      </Section>

      <Section title="Changes to these terms">
        <p>
          We may update this document as the protocol evolves. Material
          changes (new ix shipping, soak period ending, etc.) will be
          announced on{" "}
          <a
            className="text-[var(--bull-accent)] hover:underline"
            href="https://x.com/wrappedbulls"
            target="_blank" rel="noopener"
          >@wrappedbulls</a>{" "}
          before they take effect on chain.
        </p>
      </Section>

      <Section title="Contact">
        <p>
          For security disclosures, see{" "}
          <Link href="/security" className="text-[var(--bull-accent)] hover:underline">/security</Link>.
          For everything else,{" "}
          <a
            className="text-[var(--bull-accent)] hover:underline"
            href="https://x.com/wrappedbulls"
            target="_blank" rel="noopener"
          >@wrappedbulls</a>{" "}
          on X.
        </p>
      </Section>
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-10">
      <h2 className="h2 mb-4">{title}</h2>
      <div className="card" style={{ padding: 20 }}>{children}</div>
    </section>
  );
}

// /security - transparency page for wallet review teams + curious users.
// Lists program IDs, source repo, audit invariants, and contact paths.

import Link from "next/link";

export const metadata = {
  title: "Security - WrappedBulls",
  description:
    "Program ID, source code, audit invariants, and contact info for the " +
    "WrappedBulls Solana dApp.",
};

export const dynamic = "force-static";

export default function SecurityPage() {
  return (
    <main className="max-w-3xl mx-auto px-4 sm:px-6 py-16">
      <h1 className="h1 mb-3">Security &amp; transparency</h1>
      <p className="text-[var(--bull-dim)] text-lg mb-10">
        Everything a wallet review team or curious user needs to verify what
        this dApp does.
      </p>

      <Section title="On-chain identity">
        <Field label="Program ID" mono>
          F7qXskG73efUwbDo2B97tZgpPAqX7zHMApXbPUimcFdS
        </Field>
        <Field label="Network">
          Solana mainnet
        </Field>
        <Field label="Token mint">
          Set per-deployment in the BullBank PDA. View on chain via the
          program account.
        </Field>
        <Field label="Source">
          <a
            className="text-[var(--bull-accent)] hover:underline"
            href="https://github.com/wrappedbulls/wrappedbulls"
            target="_blank" rel="noopener"
          >
            github.com/wrappedbulls/wrappedbulls
          </a>
        </Field>
      </Section>

      <Section title="What the program can do">
        <ul className="list-disc list-inside space-y-2 text-[var(--bull-dim)]">
          <li>
            <span className="text-[var(--bull-ink)] font-bold">initialize</span>{" "}
            - one-time bank setup at deploy. Locks the $TOKEN mint address.
          </li>
          <li>
            <span className="text-[var(--bull-ink)] font-bold">initialize_collection</span>{" "}
            - one-time creation of the Metaplex Certified Collection NFT.
          </li>
          <li>
            <span className="text-[var(--bull-ink)] font-bold">wrap_bull</span>{" "}
            - moves 1,000,000 $WBULL from the caller into a vault PDA, mints
            them a fresh NFT, verifies the NFT into the collection. Caller
            is the only signer.
          </li>
          <li>
            <span className="text-[var(--bull-ink)] font-bold">unwrap_bull</span>{" "}
            - burns the caller's bull NFT and returns 1,000,000 $WBULL from
            the vault to the caller. The caller must hold the NFT in their
            ATA. Permissionless - anyone holding a bull can unwrap it.
          </li>
        </ul>
        <p className="mt-4 text-sm text-[var(--bull-dim)]">
          The program holds no custody outside the per-NFT vault PDAs. Each
          vault's authority is derived from its NFT's mint address, so the
          locked tokens follow the NFT through every transfer (Magic Eden,
          Tensor, direct send). Every wrap/unwrap is initiated by the user
          and signed in their own wallet.
        </p>
      </Section>

      <Section title="Hard limits enforced on chain">
        <ul className="list-disc list-inside space-y-2 text-[var(--bull-dim)]">
          <li>1,000,000,000 $WBULL total supply (pump.fun-immutable)</li>
          <li>Exactly 1,000,000 $WBULL locked per wrap</li>
          <li>Maximum 1,000 NFTs in circulation at any time</li>
          <li>NFT mint authority retired by Metaplex master edition (1-of-1)</li>
          <li>Vault authority is a PDA derived from the NFT mint</li>
        </ul>
      </Section>

      <Section title="WrappedFactory program">
        <Field label="Program ID" mono>
          WrapqdUUpAiYXdETYLHBaNr4Tc5RWMXBVRwHcJ4QUVh
        </Field>
        <Field label="Source">
          <a
            className="text-[var(--bull-accent)] hover:underline"
            href="https://github.com/wrappedbulls/wrappedbulls/tree/release/v1.0/programs/wrappedfactory"
            target="_blank" rel="noopener"
          >
            programs/wrappedfactory on release/v1.0
          </a>
        </Field>
        <Field label="Audit document">
          <a
            className="text-[var(--bull-accent)] hover:underline"
            href="https://github.com/wrappedbulls/wrappedbulls/blob/release/v1.0/docs/AUDIT_FACTORY.md"
            target="_blank" rel="noopener"
          >
            docs/AUDIT_FACTORY.md
          </a>{" "}
          (internal, all Critical / High / Medium findings closed; no external third party audit)
        </Field>
        <Field label="Pre mortem">
          <a
            className="text-[var(--bull-accent)] hover:underline"
            href="https://github.com/wrappedbulls/wrappedbulls/blob/release/v1.0/docs/PRE_MORTEM_FACTORY.md"
            target="_blank" rel="noopener"
          >
            docs/PRE_MORTEM_FACTORY.md
          </a>
        </Field>
        <Field label="Verifiable build">
          <a
            className="text-[var(--bull-accent)] hover:underline"
            href="https://github.com/wrappedbulls/wrappedbulls/blob/release/v1.0/docs/VERIFIED_BUILD_FACTORY.md"
            target="_blank" rel="noopener"
          >
            docs/VERIFIED_BUILD_FACTORY.md
          </a>
        </Field>
      </Section>

      <Section title="Factory upgrade authority + circuit breaker">
        <p className="text-[var(--bull-dim)] mb-3">
          The Factory program is currently upgradeable, with authority held
          by the WrappedBulls operator as a single hot keypair (no Squads
          multisig). During the soak period (30 to 60 days after mainnet
          launch), authority remains live so we can patch logic bugs that
          surface in real conditions. After the soak period, if no critical
          bugs surface, authority is either moved to a hardware wallet or
          revoked entirely so the program becomes permanently immutable.
          See{" "}
          <Link href="/terms" className="text-[var(--bull-accent)] hover:underline">
            /terms
          </Link>{" "}
          for the full policy.
        </p>
        <p className="text-[var(--bull-dim)] mb-3">
          The program exposes a global circuit breaker via the{" "}
          <code>set_factory_paused</code> instruction, gated to the program
          upgrade authority. When paused, the program rejects new wraps, new
          <code> deploy_collection</code> calls, and{" "}
          <code>claim_treasury</code> calls.{" "}
          <span className="text-[var(--bull-ink)] font-bold">
            Unwrap is never paused.
          </span>{" "}
          User locked tokens are always drainable by their NFT holder regardless
          of pause state; pausing unwrap would constitute fund capture, which
          the circuit breaker exists to prevent.
        </p>
        <p className="text-[var(--bull-dim)]">
          Pause is a triage tool. We will use it if we observe evidence of an
          active exploit or a critical Metaplex / Token-2022 regression. We
          will NOT use it to censor or de platform individual deployments.
        </p>
      </Section>

      <Section title="On-chain invariants checked by audit script">
        <p className="text-[var(--bull-dim)] mb-3">
          <a
            className="text-[var(--bull-accent)] hover:underline"
            href="https://github.com/wrappedbulls/wrappedbulls/blob/main/scripts/audit_chain.sh"
            target="_blank" rel="noopener"
          >scripts/audit_chain.sh</a>{" "}
          (reproducible from any RPC). Last devnet run: GREEN.
        </p>
        <ol className="list-decimal list-inside space-y-1 text-[var(--bull-dim)] text-sm">
          <li>in_circulation == total_wrapped - total_unwrapped</li>
          <li>live BullAsset count == in_circulation</li>
          <li>Σ vault.amount == in_circulation × 1,000,000 $WBULL</li>
          <li>Each live NFT mint has supply == 1</li>
          <li>(next_tier - 1) - len(free_tiers) == in_circulation</li>
          <li>All free_tier values fall in [1, 1,000]</li>
          <li>collection_mint is set (Metaplex Certified Collection live)</li>
        </ol>
      </Section>

      <Section title="What the website does and doesn't do">
        <ul className="list-disc list-inside space-y-2 text-[var(--bull-dim)]">
          <li>Reads on-chain state via Solana RPC (Helius)</li>
          <li>Builds wrap_bull / unwrap_bull instructions in the browser</li>
          <li>Asks your wallet to sign - every action is your signature</li>
          <li>
            Does <span className="text-[var(--bull-ink)] font-bold">not</span>{" "}
            request any token approval, account delegation, or sign-and-broadcast
            permission. Each wrap and unwrap is its own one-shot transaction.
          </li>
          <li>
            Does <span className="text-[var(--bull-ink)] font-bold">not</span>{" "}
            collect emails, store cookies, or run analytics scripts.
          </li>
        </ul>
      </Section>

      <Section title="Bug bounty">
        <p className="text-[var(--bull-dim)] mb-3">
          Open bug bounty against the WrappedFactory program and its
          supporting infrastructure. Payouts in USDC, severity bands and
          scope documented in the canonical policy:
        </p>
        <Field label="Scope + payouts">
          <a
            className="text-[var(--bull-accent)] hover:underline"
            href="https://github.com/wrappedbulls/wrappedbulls/blob/release/v1.0/docs/BUG_BOUNTY.md"
            target="_blank" rel="noopener"
          >
            docs/BUG_BOUNTY.md
          </a>
        </Field>
        <Field label="Report email">
          <a
            className="text-[var(--bull-accent)] hover:underline"
            href="mailto:wrappedbulls@hotmail.com?subject=%5BBUG%20BOUNTY%5D%20"
          >
            wrappedbulls@hotmail.com (subject prefix [BUG BOUNTY])
          </a>
        </Field>
        <Field label="Safe harbor">
          Good faith research that follows the policy will not result in
          legal action. See the bounty doc for the full safe harbor
          language.
        </Field>
      </Section>

      <Section title="Contact">
        <Field label="X / Twitter">
          <a
            className="text-[var(--bull-accent)] hover:underline"
            href="https://x.com/wrappedbulls"
            target="_blank" rel="noopener"
          >@wrappedbulls</a>
        </Field>
        <Field label="GitHub issues">
          <a
            className="text-[var(--bull-accent)] hover:underline"
            href="https://github.com/wrappedbulls/wrappedbulls/issues"
            target="_blank" rel="noopener"
          >wrappedbulls/wrappedbulls/issues</a>
        </Field>
        <Field label="security.txt">
          <Link href="/.well-known/security.txt" className="text-[var(--bull-accent)] hover:underline">
            /.well-known/security.txt
          </Link>
        </Field>
      </Section>
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-10">
      <h2 className="h2 mb-4">{title}</h2>
      <div className="card">{children}</div>
    </section>
  );
}

function Field({
  label,
  children,
  mono,
}: {
  label: string;
  children: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 py-2 border-b border-[#1a1a22] last:border-b-0">
      <div className="text-xs uppercase text-[var(--bull-dim)] tracking-wider w-32 shrink-0 self-center">
        {label}
      </div>
      <div className={mono ? "font-mono text-sm break-all" : "break-words"}>
        {children}
      </div>
    </div>
  );
}

import { LCard } from "@/components/ledger";
import { Logo } from "@/components/logo";

/**
 * Rendered for an unknown token, a revoked one, a draft estimate, or a
 * malformed URL segment — all four, identically. Mirrors
 * app/invoice/[token]/not-found.tsx's own reasoning verbatim: naming which
 * of the four happened would hand a token-probing attacker exactly the
 * signal this page exists to withhold, and the reader is the pilot's
 * client, not a user of this product, so the copy names the one thing they
 * can actually do.
 */
export default function EstimateNotFound() {
  return (
    <div className="min-h-dvh bg-canvas font-ledger text-body text-ink">
      <div className="mx-auto max-w-md px-4 py-8 sm:px-8 sm:py-12">
        <div className="mb-8">
          <Logo href="/" />
        </div>
        <LCard className="p-6 sm:p-8">
          <div className="mb-2 text-h3 font-bold text-ink">This link isn&rsquo;t valid</div>
          <p className="text-lead text-ink-2">
            It may have been cut short when it was copied, or your pilot may have sent a
            newer one since. Ask them for a fresh link.
          </p>
        </LCard>
      </div>
    </div>
  );
}

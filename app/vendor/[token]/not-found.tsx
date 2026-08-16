import { LCard } from "@/components/ledger";
import { Logo } from "@/components/ui/logo";

/**
 * Rendered for an unknown token, a revoked one, an expired one, a
 * malformed URL segment, and a database error alike — see page.tsx's own
 * comment on why pilot.client_vendor_page_public folding all of those into
 * one outcome is deliberate. The copy below never says "expired", for the
 * same reason app/packet/[token]/not-found.tsx's doesn't: expires_at is a
 * real, checkable column, but it is enforced in the same WHERE clause as
 * revocation and the token match itself, so by the time this page renders
 * there is no way to tell which of the three actually happened.
 *
 * The reader is the pilot's CLIENT — an operator's AP desk or scheduler,
 * opening an emailed link — not a user of this product.
 */
export default function VendorPageNotFound() {
  return (
    <div className="min-h-dvh bg-canvas font-ledger text-body text-ink">
      <div className="mx-auto max-w-md px-4 py-8 sm:px-8 sm:py-12">
        <div className="mb-8">
          <Logo />
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

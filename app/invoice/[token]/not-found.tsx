import { LCard } from "@/components/ledger";
import { Logo } from "@/components/logo";

/**
 * Rendered for an unknown token, a revoked one, a draft/void invoice, or a
 * malformed URL segment — all four, identically. This is deliberate: see
 * page.tsx's own comment. The copy below says nothing about WHICH of
 * those happened, on purpose — that distinction is exactly what an
 * attacker probing for valid tokens would use as a signal, and this page
 * is not the place to hand it to them. It also never says "expired":
 * pilot.invoice_public's null result folds an unknown token, a revoked
 * one and an invoice that reverted out of a shareable status into the
 * same outcome this page renders for, so there is no case this page can
 * actually distinguish as expiry rather than one of the other two.
 *
 * The reader is the pilot's CLIENT, not a user of this product — an
 * operator's scheduler or accounts payable, opening an emailed link.
 * They don't have an account here and never will, so the copy names the
 * one thing they CAN do (ask the pilot who sent it) rather than a
 * generic "contact support".
 *
 * Ledger's softer marketing variant, not the app register: no PageShell,
 * a hand-painted canvas ground, and a taller `max-w-md` column than the
 * app would use for a single-card notice — this is the one page a client
 * with no account of their own ever sees, so it gets the fuller air.
 */
export default function InvoiceNotFound() {
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

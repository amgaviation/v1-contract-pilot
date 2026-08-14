import { DOWNGRADE_NOTE } from "@/lib/entitlements";
import { isCurrencyEngineEnabled } from "@/lib/currency/gate";

/**
 * DOWNGRADE_NOTE, with the counsel-gated currency board named only while
 * it actually exists somewhere in the app.
 *
 * lib/entitlements.ts's DOWNGRADE_NOTE names "currency board" unconditionally
 * — that file is deliberately pure (no env access, no server-only), so it
 * cannot itself know whether CURRENCY_ENGINE_ENABLED is set. With the flag
 * off (the only permitted state today), the feature is unreachable
 * anywhere in the product — /currency refuses to render and the nav omits
 * it — so telling a paying subscriber their downgrade "preserves" a
 * currency board is a promise about software that isn't there. This is
 * the same display-honesty move the public pricing page already makes
 * with PUBLIC_CLAIM_FILTER (app/(marketing)/pricing/pricing-model.ts),
 * applied at the two in-app render sites instead of the entitlements
 * source string — by OMISSION only, never by rewording the parts that
 * stay true.
 */
export function visibleDowngradeNote(): string {
  if (isCurrencyEngineEnabled()) return DOWNGRADE_NOTE;
  return DOWNGRADE_NOTE.replace(
    "Your logbook, currency board, and documents are never gated on any plan.",
    "Your logbook and documents are never gated on any plan."
  );
}

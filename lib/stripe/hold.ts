import "server-only";
import { getStripe } from "@/lib/stripe/server";

/**
 * ===========================================================================
 * THE HOLD, ON STRIPE'S SIDE
 * ===========================================================================
 *
 * THE API FACT THIS MODULE EXISTS AROUND, because reading the Stripe docs
 * quickly gets it backwards. There are two different features with similar
 * names:
 *
 *   PAUSE PAYMENT COLLECTION (`pause_collection`)
 *     The subscription stays `active`, invoices keep generating, only
 *     collection stops, and — Stripe's own words — "your customers keep
 *     access to the service while you pause collection". Designed for a
 *     grace period.
 *
 *   PAUSE THE SUBSCRIPTION (`status = 'paused'`)
 *     Service and billing both stop. This is the one that matches a hold
 *     semantically, and the pinned SDK (22.5.0) CANNOT REQUEST IT. There is
 *     a subscriptions.resume() but no subscriptions.pause(); the paused
 *     status arises from trial settings
 *     (trial_settings.end_behavior.missing_payment_method), not on demand.
 *
 * So a hold is pause_collection at Stripe PLUS a local read-only flag, and
 * the local flag is not a convenience — it is the half that Stripe declines
 * to provide. accountIsReadOnly() in lib/entitlements.ts reads
 * hold_started_at for exactly this reason.
 *
 * `behavior: 'void'` rather than 'keep_as_draft' or 'mark_uncollectible':
 * the pilot is not being served during a hold, so no debt should accrue for
 * the period. void marks the invoices generated in the window void, so
 * nobody is billed later for months in which the account was closed to them.
 * keep_as_draft would quietly accumulate invoices to collect on return,
 * which is not what "pause my subscription" means to the person asking.
 */

/**
 * Whether this subscription has actually been billing for two months or
 * more — the eligibility rule.
 *
 * COUNTED IN PAID INVOICES, not in elapsed time since the subscription was
 * created. "Active and billing for 2 months or more" is a statement about
 * money that changed hands; a subscription created 70 days ago that is one
 * day into its first paid period after a long trial has not been billing for
 * two months, and `created` would say it had. Stripe's invoice list is the
 * only thing that knows the difference.
 *
 * Limit 3 rather than 2 so the count is a real ">= 2" and not a "the page
 * was full"; nothing here needs the whole history.
 */
export async function paidInvoiceCount(subscriptionId: string): Promise<number> {
  const stripe = getStripe();
  const invoices = await stripe.invoices.list({
    subscription: subscriptionId,
    status: "paid",
    limit: 3,
  });
  return invoices.data.length;
}

export const HOLD_MINIMUM_PAID_INVOICES = 2;

/**
 * Stop collecting until `resumesAt`.
 *
 * `resumes_at` is set even though this product ends the hold explicitly,
 * because it is the backstop: if every other part of this feature stopped
 * working tomorrow, Stripe would still start charging again on that date
 * rather than leaving a subscription paused forever. A hold that silently
 * became permanent free service is the failure this argument is about.
 */
export async function pauseCollection(
  subscriptionId: string,
  resumesAt: Date
): Promise<void> {
  const stripe = getStripe();
  await stripe.subscriptions.update(subscriptionId, {
    pause_collection: {
      behavior: "void",
      resumes_at: Math.floor(resumesAt.getTime() / 1000),
    },
  });
}

/**
 * Start collecting again.
 *
 * Unsetting pause_collection is how Stripe spells "resume" for a
 * collection-paused subscription (subscriptions.resume() is for the
 * status='paused' case this product cannot reach). Passing null is the
 * documented unset.
 */
export async function resumeCollection(subscriptionId: string): Promise<void> {
  const stripe = getStripe();
  await stripe.subscriptions.update(subscriptionId, {
    pause_collection: null,
  });
}

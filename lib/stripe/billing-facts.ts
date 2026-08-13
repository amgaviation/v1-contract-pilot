import "server-only";
import { getStripe } from "./server";
import { stripeAmountLabel, subscriptionChargeLabel } from "./prices";
import { tierForPriceId, type BillingInterval, type PlanTier } from "@/lib/entitlements";

/**
 * EVERYTHING THE BILLING SCREEN KNOWS THAT THE DATABASE DOES NOT.
 *
 * `pilot.accounts` carries plan_tier, status, seat_count and trial_ends_at
 * — written by the Stripe webhook, and nothing else. It does NOT carry
 * `cancel_at_period_end`, the current period end, the card on file, or a
 * single invoice, because none of those is an entitlement fact and none of
 * them belongs in a tenant table that would then need re-syncing. So this
 * module reads them from Stripe at render time.
 *
 * THREE RULES, all of them load-bearing:
 *
 *  1. DISPLAY-ONLY AND FAILURE-TOLERANT. Every field is nullable and every
 *     call is wrapped. A Stripe blip degrades the screen to "we can't show
 *     your renewal date right now" — it never breaks the page, and it
 *     never blocks the resubscribe path, which is the one thing a lapsed
 *     account is on that screen to reach. This is the same posture
 *     currentSubscriptionFacts already took for the interval badge; that
 *     helper is now folded in here.
 *
 *  2. THE TIER ON RECORD IS STILL pilot.accounts.plan_tier. Nothing here
 *     is an entitlement input. Stripe's price is read only so the screen
 *     can SAY that a confirmed switch is still in flight — the webhook is
 *     what moves plan_tier, idempotently and out-of-order-safely.
 *
 *  3. NO AMOUNT IS FORMATTED HERE. Every figure goes out through
 *     lib/stripe/prices.ts (stripeAmountLabel / subscriptionChargeLabel),
 *     which is where the currency check and the "never invent a number"
 *     rule live.
 *
 * VERIFIED AGAINST THE INSTALLED SDK (stripe 22.4.0, API version
 * 2026-07-29.dahlia as pinned in lib/stripe/server.ts), not from memory —
 * this matters because one of these fields MOVED:
 *   - `Subscription` has cancel_at, cancel_at_period_end, canceled_at,
 *     trial_end, default_payment_method, items.
 *   - `Subscription` NO LONGER HAS current_period_end in this API version.
 *     It lives on the SUBSCRIPTION ITEM
 *     (node_modules/stripe/esm/resources/SubscriptionItems.d.ts:54). Reading
 *     it off the subscription would be `undefined` at runtime and a type
 *     error at compile time — which is the good outcome, and is why this
 *     comment records where it actually is.
 *   - `Invoice` has number, created, status, amount_paid, amount_due,
 *     currency, hosted_invoice_url, invoice_pdf.
 */

export type CardOnFile = {
  brand: string;
  last4: string;
  expMonth: number;
  expYear: number;
};

export type SubscriptionFacts = {
  /**
   * True when this object is a TRUSTWORTHY answer — either the
   * subscription was read, or there is no subscription to read. False
   * means only one thing: Stripe could not be reached, and the caller must
   * say so rather than presenting empty fields as facts.
   */
  ok: boolean;
  /**
   * False when the account carries no subscription id at all (comped, or
   * mid-provisioning). Distinguishing this from `ok: false` is what stops
   * the screen telling a comped account that Stripe is down.
   */
  hasSubscription: boolean;
  interval: BillingInterval | null;
  /**
   * The tier Stripe's own price maps to, when it DIFFERS from the tier on
   * record — i.e. a confirmed switch whose webhook has not landed yet.
   * Null when they agree, which is the normal state.
   */
  pendingTier: PlanTier | null;
  cancelAtPeriodEnd: boolean;
  /** ISO instant, from the subscription ITEM. Null when unknown. */
  periodEndIso: string | null;
  /** ISO instant Stripe holds for the trial end. Null when not trialing. */
  trialEndIso: string | null;
  /** The quantity Stripe is actually billing — the real seat count. */
  quantity: number | null;
  /** What the next renewal comes to, already formatted. Null when unknown. */
  renewalLabel: string | null;
  card: CardOnFile | null;
};

const UNKNOWN: SubscriptionFacts = {
  ok: false,
  hasSubscription: true,
  interval: null,
  pendingTier: null,
  cancelAtPeriodEnd: false,
  periodEndIso: null,
  trialEndIso: null,
  quantity: null,
  renewalLabel: null,
  card: null,
};

/** Stripe's UNIX seconds → an ISO instant, or null. */
function isoFromUnix(seconds: number | null | undefined): string | null {
  if (typeof seconds !== "number" || !Number.isFinite(seconds)) return null;
  return new Date(seconds * 1000).toISOString();
}

/**
 * The live subscription's facts. `currentTier` is the tier on record, used
 * only to decide whether Stripe's price counts as "pending" — pass
 * account.plan_tier.
 */
export async function subscriptionFacts(
  subscriptionId: string | null,
  currentTier: PlanTier
): Promise<SubscriptionFacts> {
  // Nothing to read is not a failure to read. `ok: true` here means "this
  // answer is trustworthy"; hasSubscription: false is what it says.
  if (!subscriptionId) return { ...UNKNOWN, ok: true, hasSubscription: false };

  try {
    // default_payment_method is expanded in the SAME retrieve rather than
    // fetched separately: one round trip, and one failure mode.
    const subscription = await getStripe().subscriptions.retrieve(subscriptionId, {
      expand: ["default_payment_method"],
    });

    const item = subscription.items.data[0] ?? null;
    const price = item?.price ?? null;
    const match = tierForPriceId(price?.id ?? null);
    const interval = match?.interval ?? null;

    // A payment method that came back as a bare id string (not expanded,
    // or expansion refused) is not an error — it just means no card to
    // show. Only a `card` object yields a card.
    //
    // KNOWN AND DELIBERATE LIMIT: this reads the SUBSCRIPTION's own
    // default_payment_method. A customer who has no card set on the
    // subscription and is charged against
    // customer.invoice_settings.default_payment_method (Stripe's fallback)
    // shows no card here. Chasing that second hop would mean a second
    // expand and a second failure mode for a field the billing portal
    // already owns — and showing nothing is honest, while showing the
    // wrong card would not be. The portal button is right beside it.
    const pm = subscription.default_payment_method;
    const card =
      pm && typeof pm !== "string" && pm.card
        ? {
            brand: pm.card.brand,
            last4: pm.card.last4,
            expMonth: pm.card.exp_month,
            expYear: pm.card.exp_year,
          }
        : null;

    return {
      ok: true,
      hasSubscription: true,
      interval,
      pendingTier: match && match.tier !== currentTier ? match.tier : null,
      cancelAtPeriodEnd: subscription.cancel_at_period_end,
      // See the header: current_period_end is on the ITEM in this API
      // version, not on the subscription.
      periodEndIso: isoFromUnix(item?.current_period_end),
      trialEndIso: isoFromUnix(subscription.trial_end),
      quantity: item?.quantity ?? null,
      renewalLabel: subscriptionChargeLabel(
        price?.unit_amount,
        price?.currency,
        item?.quantity,
        interval
      ),
      card,
    };
  } catch (err) {
    // The raw Stripe message is a configuration disclosure ("No such
    // subscription: 'sub_…'"), logged where it diagnoses, never rendered.
    console.error(
      "[stripe] could not read subscription for the billing screen",
      err instanceof Error ? err.message : String(err)
    );
    return UNKNOWN;
  }
}

export type BillingHistoryRow = {
  id: string;
  /** Stripe's human invoice number, or a short id when it has none yet. */
  number: string;
  /** ISO instant. */
  createdIso: string;
  status: string;
  /** Already formatted, or null when the amount can't be shown honestly. */
  amountLabel: string | null;
  /** Stripe-hosted receipt page. Null on a draft. */
  hostedUrl: string | null;
  pdfUrl: string | null;
};

export type BillingHistory = {
  /** False when the list could not be read. NOT the same as an empty list. */
  ok: boolean;
  rows: BillingHistoryRow[];
};

/**
 * The last few platform invoices, so a pilot can see and download a
 * receipt without leaving for the portal. The portal is still the place to
 * change a card or find older invoices — this is the "what did you charge
 * me last month" answer that should not require a round trip to Stripe's
 * UI.
 *
 * `ok: false` is deliberately distinguishable from `rows: []`. "We
 * couldn't read your invoices" and "you have no invoices yet" are
 * different sentences, and rendering the second for the first is the same
 * class of lie the list screens' empty states already refuse to tell.
 *
 * DRAFTS ARE INCLUDED but carry no hosted URL — Stripe only mints one on
 * finalisation. The row still renders, labelled by its status, because a
 * pilot who sees a pending charge on their card and finds nothing here
 * would reasonably conclude the screen is wrong.
 */
export async function billingHistory(
  customerId: string | null,
  limit = 6
): Promise<BillingHistory> {
  if (!customerId) return { ok: true, rows: [] };

  try {
    const list = await getStripe().invoices.list({ customer: customerId, limit });
    return {
      ok: true,
      rows: list.data.map((invoice, index) => ({
        // `id` is optional on the SDK's Invoice type (a draft built
        // client-side has none). Falling back to "" for two such rows
        // would collide as React keys, so the index carries the fallback.
        id: invoice.id ?? `invoice-${index}`,
        number: invoice.number ?? invoice.id?.slice(-8) ?? "Draft",
        createdIso: isoFromUnix(invoice.created) ?? "",
        status: invoice.status ?? "unknown",
        // amount_paid on a paid invoice, amount_due on anything else —
        // what the customer was actually charged, or is about to be.
        amountLabel: stripeAmountLabel(
          invoice.status === "paid" ? invoice.amount_paid : invoice.amount_due,
          invoice.currency
        ),
        hostedUrl: invoice.hosted_invoice_url ?? null,
        pdfUrl: invoice.invoice_pdf ?? null,
      })),
    };
  } catch (err) {
    console.error(
      "[stripe] could not list invoices for the billing screen",
      err instanceof Error ? err.message : String(err)
    );
    return { ok: false, rows: [] };
  }
}

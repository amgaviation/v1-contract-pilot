import "server-only";
import Stripe from "stripe";
import { BRAND } from "@/lib/brand";

/**
 * The platform-billing Stripe client — "we bill the pilot" (docs/PLAN.md,
 * integration #1). It must never be used for Stripe Connect work, which is
 * integration #2 and is deliberately kept separate: Connect calls act on
 * behalf of a CONNECTED account (the pilot billing their own client, where
 * the pilot is merchant of record and we take no application fee), and
 * entangling the two is exactly what the plan says not to do.
 *
 * Server-only: this holds the secret key. It is never imported into a
 * Client Component — the checkout flow runs through a server action, and
 * the webhook is a route handler.
 */

let cached: Stripe | null = null;

export function getStripe(): Stripe {
  if (cached) return cached;

  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new Error(
      "STRIPE_SECRET_KEY is unset. Billing cannot run. Set it in the Vercel project (and .env.local for development)."
    );
  }

  cached = new Stripe(key, {
    // Pinned rather than floating: an unpinned client silently follows
    // Stripe's default version for the account, so an API upgrade made in
    // the dashboard could change response shapes under running code. This
    // value must match what the installed SDK's types expect — bumping the
    // `stripe` dependency is what moves it, deliberately, not a dashboard
    // setting changing underneath us.
    apiVersion: "2026-07-29.dahlia",
    // Shows up in Stripe's dashboard/logs as the integration's identity.
    // Composed from lib/brand.ts rather than spelled out — no literal
    // brand string may live outside that file.
    appInfo: { name: `${BRAND.name} ${BRAND.descriptor}` },
  });
  return cached;
}

/**
 * True when the configured key is a live-mode key. The webhook uses this
 * to refuse an event whose `livemode` disagrees, which is the plan's
 * "test/live mode separation" requirement made mechanical: a test event
 * replayed at a production deployment (or vice versa) is rejected rather
 * than applied to the wrong dataset.
 */
export function isLiveMode(): boolean {
  const key = process.env.STRIPE_SECRET_KEY ?? "";
  return key.startsWith("sk_live_") || key.startsWith("rk_live_");
}

/**
 * THE INTRO OFFER, which replaced the 7-day free trial (decision #6 as
 * originally written): the FIRST month of a new monthly subscription is
 * charged at $5, and the regular price applies from month two. Implemented
 * as a once-duration Stripe coupon minted per price at checkout time
 * (app/(auth)/welcome/actions.ts) — the subscription itself stays at the
 * regular Price, so entitlement mapping (tierForPriceId) is untouched.
 *
 * Annual plans get no intro month: a "first month" has no meaning on an
 * invoice that bills a year at a time, so annual checkouts charge the
 * plain annual price.
 *
 * This is deliberately the ONE amount that lives in code (docs/PRICING.md
 * §7 keeps plan prices on the live Stripe Price objects): the coupon is
 * CREATED from this constant, so the label surfaces show and the amount
 * Stripe discounts still originate from a single fact.
 *
 * Same first-subscription-only logic as the old trial: resubscribe
 * (settings/billing) never applies it, or lapsing and reopening would be
 * a standing discount.
 */
export const INTRO_FIRST_MONTH_CENTS = 500;
export const INTRO_FIRST_MONTH_LABEL = "$5";

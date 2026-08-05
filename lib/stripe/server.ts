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
      "STRIPE_SECRET_KEY is unset — billing cannot run. Set it in the Vercel project (and .env.local for development)."
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
 * The single price the product sells today (decision #10, solo flat rate;
 * the per-seat business plan is deferred). Read from env rather than
 * hardcoded so test and live price IDs never cross — PLAN: "Price IDs
 * from env config".
 */
export function getSoloPriceId(): string {
  const priceId = process.env.STRIPE_PRICE_SOLO;
  if (!priceId) {
    throw new Error(
      "STRIPE_PRICE_SOLO is unset — no price to check out with. Set it in the Vercel project (and .env.local for development)."
    );
  }
  return priceId;
}

/** Card-required trial length, in days (decision #6). */
export const TRIAL_PERIOD_DAYS = 7;

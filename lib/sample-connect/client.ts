import "server-only";
import Stripe from "stripe";
import { BRAND } from "@/lib/brand";

/**
 * ===========================================================================
 * SAMPLE STRIPE CONNECT INTEGRATION — the Stripe client
 * ===========================================================================
 *
 * READ THIS FIRST: THIS APP ALREADY HAS A DIFFERENT CONNECT INTEGRATION.
 *
 * `lib/stripe/connect.ts` is the PRODUCTION one: Stripe Connect **Standard**
 * via OAuth, where a pilot links a Stripe account they already own, takes
 * direct charges from their own clients, and the platform takes **no
 * application fee** ("never takes a cut" is promised in the product's own UI
 * copy and in docs/SETUP.md).
 *
 * This file is the root of a SEPARATE, SELF-CONTAINED SAMPLE that
 * demonstrates a different model:
 *
 *   | | Production (`lib/stripe/`) | This sample (`lib/sample-connect/`) |
 *   |---|---|---|
 *   | Account model | Standard, linked by OAuth | **V2 accounts**, created by us |
 *   | Onboarding | `connect.stripe.com/oauth/authorize` | **V2 Account Links** |
 *   | Monetization | no application fee | **application fee** on each charge |
 *   | Products | none — invoices are the unit | Stripe Products on the connected account |
 *   | Storefront | none | public per-merchant storefront |
 *
 * The two DO NOT SHARE STATE. This sample writes its account ids to its own
 * table (`pilot.sample_connect_accounts`) and never touches
 * `pilot.accounts.connect_account_id`, which belongs to the production
 * integration. Putting a V2 `acct_…` into that column would corrupt the live
 * payment-link flow, because that flow assumes an OAuth-granted Standard
 * account. Keep them apart.
 *
 * ---------------------------------------------------------------------------
 * THE STRIPE CLIENT
 * ---------------------------------------------------------------------------
 * Every request in this sample goes through this one client. Stripe's own
 * guidance is to build a single `StripeClient` and reuse it, rather than
 * constructing one per call.
 *
 * NOTE ON `apiVersion`: it is deliberately NOT set here. The installed SDK
 * pins the API version it was generated against (2026-07-29.dahlia for
 * stripe-node 22.5.0), so leaving it unset is the supported way to stay in
 * lockstep with the SDK's own types. The production client in
 * `lib/stripe/server.ts` DOES pin it explicitly — that is a deliberate
 * difference, not an inconsistency: pinning protects long-lived production
 * code from a dashboard-side upgrade, while a sample is better off tracking
 * whatever SDK version you install.
 */

let cached: Stripe | null = null;

/**
 * The single Stripe client for the whole sample.
 *
 * ── FILL THIS IN ──────────────────────────────────────────────────────────
 * Set `STRIPE_SECRET_KEY` in `.env.local` (development) and in your hosting
 * provider's environment variables (production):
 *
 *     STRIPE_SECRET_KEY=sk_test_...          # ← your key goes here
 *
 * Find it at https://dashboard.stripe.com/apikeys. Use a **test-mode** key
 * (`sk_test_…`) while you are building; everything in this sample works in
 * test mode.
 * ──────────────────────────────────────────────────────────────────────────
 *
 * Throws a message that names the variable and where to get it, rather than
 * letting an unset key surface later as an opaque Stripe 401. Every entry
 * point in this sample calls `sampleConnectConfigError()` first so the user
 * sees that sentence in the UI instead of a stack trace.
 */
export function getSampleStripe(): Stripe {
  if (cached) return cached;

  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new Error(
      "STRIPE_SECRET_KEY is not set, so the sample Connect integration cannot talk to Stripe. " +
        "Add it to .env.local (development) or your hosting provider's environment variables " +
        "(production) — you can copy it from https://dashboard.stripe.com/apikeys. " +
        "A test-mode key (sk_test_...) is all this sample needs."
    );
  }

  // ONE CLIENT, REUSED. `new Stripe(key)` — the "Stripe Client" pattern.
  cached = new Stripe(key, {
    // Identifies this integration in Stripe's dashboard request logs, which
    // makes the sample's traffic easy to tell apart from the production
    // integration's when both are running against the same account.
    // Composed from lib/brand.ts rather than spelled out: no literal brand
    // string may live outside that file, and scripts/verify-tokens.mjs
    // enforces it.
    appInfo: { name: `${BRAND.name} Sample Connect Integration` },
  });
  return cached;
}

/**
 * A human-readable reason the sample cannot run, or `null` when it can.
 *
 * Pages call this and render the sentence instead of their UI. That is the
 * difference between "the sample is not configured yet, here is the variable
 * to set" and a 500 page with no explanation.
 */
export function sampleConnectConfigError(): string | null {
  if (!process.env.STRIPE_SECRET_KEY) {
    return "STRIPE_SECRET_KEY is not set. Add it to .env.local (or your hosting provider's environment variables) — copy it from https://dashboard.stripe.com/apikeys. A test-mode key (sk_test_...) is all this sample needs.";
  }
  return null;
}

/**
 * The absolute origin used to build `return_url` / `success_url` / etc.
 *
 * Stripe requires ABSOLUTE urls for every redirect it performs, so a relative
 * path fails at the API call rather than at redirect time. Reads
 * NEXT_PUBLIC_APP_URL (already used elsewhere in this app) and falls back to
 * localhost for development only.
 *
 * ── FILL THIS IN (production only) ────────────────────────────────────────
 *     NEXT_PUBLIC_APP_URL=https://your-domain.com
 * ──────────────────────────────────────────────────────────────────────────
 */
export function appOrigin(): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL;
  if (configured) return configured.replace(/\/$/, "");

  // Production without the variable set is a configuration error worth
  // failing on: silently emitting http://localhost:3000 into a Stripe
  // redirect sends real merchants to a machine that is not yours.
  if (process.env.VERCEL_ENV === "production" || process.env.NODE_ENV === "production") {
    throw new Error(
      "NEXT_PUBLIC_APP_URL is not set. Stripe needs an absolute https:// URL to redirect back to " +
        "after onboarding and checkout. Set it to your deployment's public origin, e.g. " +
        "https://your-domain.com"
    );
  }
  return "http://localhost:3000";
}

/**
 * The platform's subscription Price — what a merchant pays YOU to use the
 * platform (this is the "charge a subscription to the connected account"
 * flow, and is unrelated to the merchant's own storefront sales).
 *
 * ── FILL THIS IN ──────────────────────────────────────────────────────────
 *     SAMPLE_CONNECT_PLATFORM_PRICE_ID=price_...
 *
 * Create one in test mode with the Stripe CLI:
 *
 *     stripe products create --name "Sample Platform Plan"
 *     stripe prices create \
 *       --product prod_xxx \
 *       --unit-amount 2000 \
 *       --currency usd \
 *       --recurring.interval month
 *
 * …or in the dashboard at https://dashboard.stripe.com/test/products.
 * Deliberately its own variable rather than reusing this app's real
 * STRIPE_PRICE_ID_* plans, so a sample can never bill anyone on a real plan.
 * ──────────────────────────────────────────────────────────────────────────
 */
export function platformPriceId(): string | null {
  return process.env.SAMPLE_CONNECT_PLATFORM_PRICE_ID ?? null;
}

/**
 * The application fee this platform takes from each storefront sale, in
 * basis points of the purchase price (250 = 2.5%).
 *
 * Hard-coded rather than an env var because a sample should show WHERE the
 * number enters the charge, and reading it from configuration would hide
 * exactly the line a reader came here to find. See `lib/sample-connect/
 * checkout.ts`, which converts this to an absolute amount per charge.
 */
export const APPLICATION_FEE_BASIS_POINTS = 250;

/**
 * The application fee for a given purchase amount, in the smallest currency
 * unit (cents for USD).
 *
 * `Math.round`, and a floor of 0: Stripe rejects a fractional or negative
 * `application_fee_amount`, and a fee larger than the charge itself is
 * refused by the API — worth knowing before you raise the rate.
 */
export function applicationFeeAmount(amountInCents: number): number {
  if (!Number.isFinite(amountInCents) || amountInCents <= 0) return 0;
  return Math.max(0, Math.round((amountInCents * APPLICATION_FEE_BASIS_POINTS) / 10_000));
}

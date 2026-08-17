"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { getSessionContext } from "@/lib/supabase/account";
import { DASHBOARD_PATH } from "@/lib/nav";
import {
  getStripe,
  INTRO_FIRST_MONTH_CENTS,
  INTRO_FIRST_MONTH_LABEL,
} from "@/lib/stripe/server";
import { priceIdFor } from "@/lib/stripe/prices";
import { isBillingInterval, isPlanTier, seatsForTier } from "@/lib/entitlements";

/**
 * `scope: "local"` for the same reason app/(app)/actions.ts states at
 * length: supabase-js defaults signOut() to the GLOBAL scope, so this
 * button was ending sessions on devices the visitor is not holding.
 */
export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut({ scope: "local" });
  redirect("/login");
}

export type CheckoutState = { error: string | null };

/**
 * The $5-first-month coupon for one price, minted idempotently. Stripe
 * coupons take an ABSOLUTE amount off, so "first month costs $5" is
 * (price × seats − 500) off, once — which differs per tier and interval,
 * hence one coupon per price rather than one global. The id is
 * deterministic (price ids are immutable, amounts live on the price), so
 * every checkout for the same price reuses the same coupon and the create
 * call collides harmlessly after the first.
 *
 * Returns null — meaning "no discount, charge the plain price" — for the
 * annual interval (a "first month" has no meaning on a yearly invoice),
 * for a non-USD or amountless price, and for any price at or under $5.
 * A COUPON FAILURE ALSO RETURNS NULL rather than throwing: the wrong
 * outcome of a Stripe blip here is a visitor at maximum intent being
 * turned away; charging one full month instead of $5 is the lesser wrong,
 * and the log says it happened.
 */
async function introCouponId(
  stripe: ReturnType<typeof getStripe>,
  priceId: string,
  tier: Parameters<typeof seatsForTier>[0],
  interval: "monthly" | "annual"
): Promise<string | null> {
  if (interval !== "monthly") return null;
  try {
    const price = await stripe.prices.retrieve(priceId);
    if (typeof price.unit_amount !== "number") return null;
    if ((price.currency ?? "usd").toLowerCase() !== "usd") return null;
    const seats = seatsForTier(tier);
    const amountOff = price.unit_amount * seats - INTRO_FIRST_MONTH_CENTS;
    if (amountOff <= 0) return null;

    const id = `intro5-${priceId}-x${seats}`;
    try {
      await stripe.coupons.create({
        id,
        amount_off: amountOff,
        currency: "usd",
        duration: "once",
        name: `First month ${INTRO_FIRST_MONTH_LABEL}`,
      });
    } catch (err) {
      const code = (err as { code?: string })?.code;
      // resource_already_exists IS the normal case after the first
      // checkout for this price. Anything else falls through to the
      // outer catch: no coupon, full price, logged.
      if (code !== "resource_already_exists") throw err;
    }
    return id;
  } catch (err) {
    console.error(
      `[stripe] intro coupon for ${priceId} unavailable, charging full price:`,
      err instanceof Error ? err.message : String(err)
    );
    return null;
  }
}

/**
 * Starts the $5-first-month subscription for the CHOSEN tier. This
 * creates the Checkout session only — it does NOT create a tenant.
 * Provisioning happens solely in the webhook when Stripe confirms the
 * checkout completed (decision #7), so a user who abandons the payment
 * page, or fakes a return to the success URL, never gets an account.
 *
 * The tier ends up on the account via the PRICE, not via this form: the
 * webhook maps the subscription's price ID back through
 * lib/entitlements.ts (tierForPriceId). A tampered form field can
 * therefore only ever pick a different price to PAY for — it can never
 * claim an entitlement the resulting subscription doesn't carry.
 */
export async function startCheckout(
  _prev: CheckoutState,
  formData: FormData
): Promise<CheckoutState> {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  if (ctx.account) redirect(DASHBOARD_PATH);

  const tier = formData.get("tier");
  const interval = formData.get("interval");
  if (!isPlanTier(tier) || !isBillingInterval(interval)) {
    return { error: "Pick a plan to continue." };
  }

  const priceId = priceIdFor(tier, interval);
  if (!priceId) {
    // Configured-tiers-only is enforced in the UI too (the picker
    // disables unpriced options), so reaching this means either a
    // hand-built POST or a deployment missing an env var — both get the
    // honest answer, neither gets a checkout for a price that doesn't
    // exist.
    return {
      error: "That plan isn't available yet. Pick another, or try again later.",
    };
  }

  const origin = (await headers()).get("origin");
  if (!origin) {
    return { error: "Could not determine the return address. Try again." };
  }

  let url: string | null = null;
  try {
    const stripe = getStripe();
    const coupon = await introCouponId(stripe, priceId, tier, interval);
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      // Business is priced per seat with a two-seat minimum (docs/PRICING.md
      // §3.2), so its checkout starts at the minimum; the flat tiers are one
      // unit of a flat price. The seat floor comes from seatsForTier — the
      // SAME helper settings/billing's changePlan reads, so the checkout
      // quantity and the upgrade quantity can never disagree (Finding 2).
      // The welcome screen shows this exact total via PriceDisplay.chargeLabel
      // (Finding 1), so the figure the pilot reads equals what Stripe bills.
      // If the owner points _BUSINESS at a flat Price instead, Stripe treats
      // quantity 2 as two subscriptions' worth — the env var and this line
      // must agree, which the report to the owner says.
      line_items: [{ price: priceId, quantity: seatsForTier(tier) }],
      // Ties the Stripe session back to the Supabase identity. The webhook
      // reads this to know WHICH auth user to provision an account for —
      // without it there is no link between the payment and the person.
      client_reference_id: ctx.user.id,
      customer_email: ctx.user.email,
      subscription_data: {
        metadata: { supabase_user_id: ctx.user.id },
      },
      // THE $5 FIRST MONTH (INTRO_FIRST_MONTH_CENTS): a once-duration
      // coupon on this checkout's first invoice only. The subscription
      // itself carries the regular Price, so tierForPriceId and every
      // renewal are untouched. Null coupon = no discount (annual, a
      // sub-$5 price, or a Stripe blip — introCouponId logs which).
      ...(coupon ? { discounts: [{ coupon }] } : {}),
      // plan_tier here is diagnostic breadcrumb only (support can see
      // what the picker showed) — the webhook maps the tier from the
      // PRICE, never from this metadata.
      metadata: { supabase_user_id: ctx.user.id, plan_tier: tier },
      // Land back on /welcome: the tenant may not exist for a moment
      // (the webhook is racing the browser redirect), and that page polls
      // rather than showing a broken app shell.
      success_url: `${origin}/welcome?checkout=complete`,
      cancel_url: `${origin}/welcome?checkout=cancelled`,
    });
    url = session.url;
  } catch (err) {
    // The raw Stripe message is a CONFIGURATION disclosure, not a readable
    // error. A wrong or deleted price renders "No such price:
    // 'price_1Qabc...'" and a bad key renders "Invalid API Key provided:
    // sk_test_...****" — Stripe object ids and the key's mode, handed to
    // an unprovisioned visitor who has not paid for anything yet. It also
    // tells them nothing they can act on: every one of these is our
    // misconfiguration, not their mistake.
    //
    // Logged in full server-side, where it is the thing that actually
    // diagnoses the outage. Same posture as friendlyDbError.
    console.error(
      "[stripe] checkout session creation failed",
      err instanceof Error ? err.message : String(err)
    );
    return {
      // No "get in touch" clause: the product has no support address or
      // contact route anywhere (lib/entitlements.ts's priority_support
      // comment), so the old copy pointed a visitor at maximum intent
      // toward a channel that does not exist.
      error: "Couldn't start checkout. Try again in a moment.",
    };
  }

  if (!url) {
    return { error: "Stripe did not return a checkout URL. Try again." };
  }
  redirect(url);
}

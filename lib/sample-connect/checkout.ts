import "server-only";
import { getSampleStripe, appOrigin, applicationFeeAmount, platformPriceId } from "./client";
import { getSampleProduct } from "./products";

/**
 * ===========================================================================
 * SAMPLE CONNECT — taking money
 * ===========================================================================
 *
 * TWO COMPLETELY DIFFERENT PAYMENTS LIVE IN THIS FILE. Confusing them is the
 * classic Connect bug, so they are named for what they are:
 *
 *   A. createStorefrontCheckout — a CUSTOMER pays a MERCHANT.
 *      Direct charge on the connected account, with an application fee that
 *      comes back to the platform. Uses `{ stripeAccount }`.
 *
 *   B. createPlatformSubscriptionCheckout — a MERCHANT pays the PLATFORM.
 *      A normal subscription on OUR account, billed to the connected account
 *      via `customer_account`. Uses NO `stripeAccount` — it is our charge.
 *
 * If you find yourself passing `stripeAccount` to B, or `customer_account` to
 * A, stop: the money is about to flow the wrong way.
 */

/**
 * ---------------------------------------------------------------------------
 * A. STOREFRONT PURCHASE — direct charge with an application fee
 * ---------------------------------------------------------------------------
 * "Direct charge" means the charge is created ON the merchant's account. The
 * merchant is the merchant of record: the customer's statement shows their
 * name, the funds land in their balance, and they own refunds and disputes.
 * The platform's cut is `application_fee_amount`, which Stripe transfers to
 * the platform account automatically.
 *
 * Prices are re-read from Stripe here rather than trusted from the request —
 * see `getSampleProduct`'s note. Never build a charge from an amount that
 * arrived over the wire.
 */
export async function createStorefrontCheckout(params: {
  accountId: string;
  productId: string;
  quantity: number;
}): Promise<{ url: string } | { error: string }> {
  const stripeClient = getSampleStripe();
  const origin = appOrigin();

  const product = await getSampleProduct(params.accountId, params.productId);
  if (!product) return { error: "That product is no longer available." };
  if (product.unitAmount === null) {
    return { error: "That product has no price set, so it can't be bought yet." };
  }

  const quantity = Number.isInteger(params.quantity) && params.quantity > 0 ? params.quantity : 1;
  const total = product.unitAmount * quantity;

  // The platform's cut of THIS purchase. Computed from the server-side price,
  // never from anything the browser sent.
  const feeAmount = applicationFeeAmount(total);

  const session = await stripeClient.checkout.sessions.create(
    {
      line_items: [
        {
          // `price_data` builds the line inline. Using the existing
          // `product.priceId` would work equally well here; inline keeps the
          // amount that was validated above and the amount that is charged
          // provably the same value.
          price_data: {
            currency: product.currency,
            unit_amount: product.unitAmount,
            product_data: {
              name: product.name,
              ...(product.description ? { description: product.description } : {}),
            },
          },
          quantity,
        },
      ],
      payment_intent_data: {
        // ← THE PLATFORM'S REVENUE. Omit this and the sale is free to run.
        application_fee_amount: feeAmount,
      },
      mode: "payment",
      // `{CHECKOUT_SESSION_ID}` is a literal Stripe placeholder — it is
      // substituted by Stripe on redirect, so do NOT interpolate it yourself.
      success_url: `${origin}/store/${params.accountId}/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/store/${params.accountId}`,
    },
    // ← Direct charge: created ON the merchant's account.
    { stripeAccount: params.accountId }
  );

  if (!session.url) {
    return { error: "Stripe did not return a checkout URL. Nothing was charged." };
  }
  return { url: session.url };
}

/**
 * Reads back a completed storefront session for the success page.
 *
 * Scoped to the connected account, because the session lives on THEIR account
 * — retrieving it as the platform returns a 404 that reads like a bug.
 */
export async function getStorefrontSession(accountId: string, sessionId: string) {
  const stripeClient = getSampleStripe();
  try {
    return await stripeClient.checkout.sessions.retrieve(sessionId, undefined, {
      stripeAccount: accountId,
    });
  } catch {
    return null;
  }
}

/**
 * ---------------------------------------------------------------------------
 * B. PLATFORM SUBSCRIPTION — the merchant subscribes to YOUR product
 * ---------------------------------------------------------------------------
 * With V2 accounts, one id is both the connected account and the customer.
 * `customer_account: 'acct_…'` is how you say "bill this account", and it
 * replaces the V1 dance of creating a separate `cus_…` and mapping it.
 *
 * NOTE THE ABSENT HEADER. There is no `{ stripeAccount }` here on purpose:
 * this charge belongs to the PLATFORM. Adding it would ask the merchant's own
 * account to bill itself for your subscription.
 */
export async function createPlatformSubscriptionCheckout(params: {
  accountId: string;
}): Promise<{ url: string } | { error: string }> {
  const stripeClient = getSampleStripe();
  const origin = appOrigin();

  const priceId = platformPriceId();
  if (!priceId) {
    return {
      error:
        "SAMPLE_CONNECT_PLATFORM_PRICE_ID is not set, so there is no plan to subscribe to. " +
        "Create a recurring Price in test mode (dashboard.stripe.com/test/products) and set the " +
        "variable to its price_... id.",
    };
  }

  const session = await stripeClient.checkout.sessions.create({
    // ← Bills the connected account itself. No separate customer object.
    customer_account: params.accountId,
    mode: "subscription",
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${origin}/sample-connect?subscribed=1&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/sample-connect`,
  });

  if (!session.url) {
    return { error: "Stripe did not return a checkout URL. Nothing was charged." };
  }
  return { url: session.url };
}

/**
 * The billing portal — Stripe-hosted subscription management (change plan,
 * update card, cancel). Same `customer_account` idea as above.
 *
 * If this call fails with "no configuration provided", you have not saved a
 * portal configuration yet: do it once at
 * https://dashboard.stripe.com/test/settings/billing/portal
 */
export async function createBillingPortalSession(params: {
  accountId: string;
}): Promise<{ url: string } | { error: string }> {
  const stripeClient = getSampleStripe();
  const origin = appOrigin();

  try {
    const session = await stripeClient.billingPortal.sessions.create({
      customer_account: params.accountId,
      return_url: `${origin}/sample-connect`,
    });
    return { url: session.url };
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "Unknown error";
    return {
      error:
        `Stripe couldn't open the billing portal: ${message} ` +
        "If this mentions a missing configuration, save one at " +
        "https://dashboard.stripe.com/test/settings/billing/portal",
    };
  }
}

/**
 * Is this merchant subscribed to the platform right now?
 *
 * Read live from Stripe for the same reason account status is (see
 * accounts.ts): a cached answer goes stale the moment a payment fails.
 * A production integration would ALSO keep a database copy, updated by the
 * webhooks in app/api/stripe/sample-connect/webhook/route.ts, so that page
 * loads do not depend on Stripe being reachable.
 */
export async function getPlatformSubscriptionStatus(
  accountId: string
): Promise<{ status: string | null; currentPeriodEnd: number | null }> {
  const stripeClient = getSampleStripe();

  try {
    const subscriptions = await stripeClient.subscriptions.list({
      // Same key as checkout: the connected account IS the customer.
      customer_account: accountId,
      status: "all",
      // Enough to see past cancelled ones. `limit: 1` plus `status: 'all'`
      // returns only the NEWEST subscription, which reports "not subscribed"
      // for an account whose latest subscription is cancelled while an
      // earlier one is still running — and then offers them a second
      // checkout for a plan they already pay for.
      limit: 20,
    });

    const priceId = platformPriceId();

    // ONLY THIS SAMPLE'S PLAN COUNTS. An account can carry subscriptions
    // this sample knows nothing about — including, on this very platform,
    // the product's own real plans. Reporting one of those as "subscribed"
    // to the sample plan would be a straightforwardly wrong answer, and
    // reporting it as unsubscribed would hide a live one.
    const isSamplePlan = (subscription: (typeof subscriptions.data)[number]) =>
      priceId ? subscription.items.data.some((item) => item.price?.id === priceId) : true;

    const relevant = subscriptions.data.filter(isSamplePlan);

    // Prefer a subscription that is actually running. Falling back to the
    // most recent one keeps a useful status ("canceled", "past_due") on the
    // dashboard rather than an empty state that implies nothing ever
    // happened.
    const subscription =
      relevant.find((s) => s.status === "active" || s.status === "trialing") ?? relevant[0];

    if (!subscription) return { status: null, currentPeriodEnd: null };

    // `current_period_end` moved onto the subscription item in recent API
    // versions, so read the item first and fall back to the top level.
    const item = subscription.items?.data?.[0] as { current_period_end?: number } | undefined;
    const periodEnd =
      item?.current_period_end ??
      (subscription as unknown as { current_period_end?: number }).current_period_end ??
      null;

    return { status: subscription.status, currentPeriodEnd: periodEnd };
  } catch {
    return { status: null, currentPeriodEnd: null };
  }
}

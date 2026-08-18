"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { requireAccount } from "@/lib/supabase/account";
import { getStripe } from "@/lib/stripe/server";
import { priceIdFor } from "@/lib/stripe/prices";
import {
  isBillingInterval,
  isPlanTier,
  seatsForTier,
  TIER_DISPLAY,
} from "@/lib/entitlements";
import { planChangeIsIncrease } from "@/lib/billing-state";
import { BRAND } from "@/lib/brand";

/**
 * Plan changes for an EXISTING subscriber, per the platform-billing
 * rules the webhook already enforces:
 *
 *   - These actions talk to Stripe and NOTHING else. plan_tier on
 *     pilot.accounts moves only when Stripe's
 *     customer.subscription.updated event lands at the webhook and its
 *     price maps back through lib/entitlements.ts — the upgrade takes
 *     effect on Stripe's say-so, idempotently and out-of-order-safely,
 *     exactly like provisioning. No service-role client here, no direct
 *     plan_tier write anywhere in the app surface. (The database would
 *     refuse one anyway: column-scoped grant + protect trigger.)
 *
 *   - Price IDs come from env by NAME (lib/stripe/prices.ts). No amount
 *     and no price ID literal in code.
 *
 *   - Raw Stripe errors are logged server-side and never rendered — the
 *     same configuration-disclosure posture as startCheckout.
 */

export type BillingActionState = { error: string | null };

export async function changePlan(
  _prev: BillingActionState,
  formData: FormData
): Promise<BillingActionState> {
  // allowReadOnly: this action is part of the RESUBSCRIBE path — a lapsed
  // (canceled/past_due) owner must be able to change plan to get back to a
  // writable account, so it opts out of the read-only write-gate that
  // every other mutation entry point inherits from requireAccount
  // (Finding 3). The Stripe call still governs what is actually possible;
  // a truly canceled subscription just returns the friendly error below.
  const { account, role } = await requireAccount("/settings/billing", {
    allowReadOnly: true,
  });

  // Same boundary the rest of settings draws: members and bookkeepers
  // read, owners change. The database's protect trigger is the real
  // enforcement for plan_tier; this guards the STRIPE side, where the
  // service is acting on our API key rather than the member's session.
  if (role !== "owner") {
    return { error: "Only the account owner can change the plan." };
  }

  const tier = formData.get("tier");
  const interval = formData.get("interval");
  if (!isPlanTier(tier) || !isBillingInterval(interval)) {
    return { error: "Pick a plan to switch to." };
  }

  const priceId = priceIdFor(tier, interval);
  if (!priceId) {
    return { error: `${TIER_DISPLAY[tier].name} isn't available yet.` };
  }

  const subscriptionId = account.stripe_subscription_id;
  if (!subscriptionId) {
    // Comped/internal account (stripe_customer_id IS NULL convention in
    // docs/BILLING.md) or a data problem — either way there is no
    // subscription to move, and pretending otherwise would be worse.
    return {
      error:
        `This account isn't billed through Stripe, so its plan is managed for you. Email ${BRAND.supportEmail} to change it.`,
    };
  }

  try {
    const stripe = getStripe();
    const subscription = await stripe.subscriptions.retrieve(subscriptionId);
    const item = subscription.items.data[0];
    if (!item) {
      throw new Error(`Subscription ${subscriptionId} has no items.`);
    }

    // The seat quantity the target tier must carry. Business is per-seat
    // with a two-seat minimum (seatsForTier — the SAME source the checkout
    // path reads), so a Solo/Pro→Business upgrade must move quantity to at
    // least 2, or the pilot would pay for one $39 seat while the public
    // page and checkout both say $78 (Finding 2). max(2, current) so an
    // account that already holds more than two seats is never REDUCED by a
    // re-selection; a non-Business target is a single flat unit.
    const currentQty = item.quantity ?? 1;
    const quantity =
      tier === "business"
        ? Math.max(seatsForTier(tier), currentQty)
        : seatsForTier(tier);

    if (item.price.id === priceId && currentQty === quantity) {
      // Already on this exact price AND seat count — idempotent no-op
      // rather than a pointless Stripe write. (The seat check matters: an
      // account left on Business-price-quantity-1 by the old bug re-selects
      // Business here and is corrected UP to 2 rather than no-op'd.)
      return { error: null };
    }

    // A tier-rank increase, or a seat increase within Business, must
    // collect the proration NOW, not sit as a pending invoice item until
    // the NEXT invoice. On a monthly plan that is at most a month of
    // float; on an ANNUAL plan the next invoice is the renewal — up to a
    // year away — so a Solo-annual pilot upgrading to Business-annual on
    // day one would otherwise get eleven-plus months of Business before
    // paying the difference, and would pay NOTHING for it at all if they
    // then set cancel_at_period_end before that renewal ever fires
    // (canceling at period end ends the subscription without generating a
    // further invoice, so a pending proration item is simply dropped).
    // `always_invoice` creates the proration AND finalizes/attempts an
    // invoice for it in this same call, so the difference is charged at
    // confirmation — closing both the float and the never-collected case
    // at once. A downgrade or a flat interval switch keeps the existing
    // credit-at-next-invoice behavior, which has no such collection risk.
    const isIncrease = planChangeIsIncrease(account.plan_tier, tier, currentQty, quantity);

    await stripe.subscriptions.update(subscriptionId, {
      items: [{ id: item.id, price: priceId, quantity }],
      proration_behavior: isIncrease ? "always_invoice" : "create_prorations",
    });
  } catch (err) {
    console.error(
      "[stripe] plan change failed",
      err instanceof Error ? err.message : String(err)
    );
    return {
      error: `Couldn't change the plan. Try again, or email ${BRAND.supportEmail} if this keeps happening.`,
    };
  }

  // The change is confirmed at Stripe; the webhook will move plan_tier
  // here within moments. Revalidate so the banner logic on the page can
  // say exactly that instead of showing a stale card with no
  // acknowledgement.
  revalidatePath("/settings/billing");
  redirect("/settings/billing?changed=1");
}

/**
 * RESUBSCRIBE — the path back for an account whose subscription Stripe
 * will no longer let anyone update.
 *
 * changePlan calls stripe.subscriptions.update() on the EXISTING
 * subscription; Stripe hard-rejects that call once the subscription is
 * `canceled` or `incomplete_expired` (there is no "un-cancel" for a fully
 * canceled subscription — cancel_at_period_end only undoes a cancellation
 * that hasn't taken effect YET, which is what setCancelAtPeriodEnd's
 * "resume" is for). Yet every string this screen shows a lapsed account —
 * statusDisplay's canceled/incomplete_expired meanings, the read-only
 * banner — promises exactly this recovery is one click away. This action
 * is that click: a NEW Checkout session for the SAME Stripe customer.
 *
 * `customer: account.stripe_customer_id` (never `customer_email`) is what
 * makes this safe to run twice and safe against provisionAccountFromCheckout
 * minting a second tenant: its lookup keys on stripe_customer_id and
 * short-circuits to the existing account the moment the webhook's
 * checkout.session.completed handler re-fetches the new subscription and
 * calls it — same account row, new stripe_subscription_id, status flips
 * off "canceled" the instant that event lands.
 *
 * No intro discount here on purpose: the $5 first month
 * (INTRO_FIRST_MONTH_CENTS, which replaced the trial decision #6 described)
 * is the FIRST-subscription incentive; granting it again every time a
 * subscription is left to lapse and reopened would be a standing discount,
 * not a reactivation.
 */
export async function resubscribe(
  _prev: BillingActionState,
  formData: FormData
): Promise<BillingActionState> {
  // allowReadOnly: this IS the resubscribe path a lapsed owner must reach.
  const { account, role, user } = await requireAccount("/settings/billing", {
    allowReadOnly: true,
  });
  if (role !== "owner") {
    return { error: "Only the account owner can resubscribe." };
  }

  // Guard the path to the statuses it actually fixes. Every OTHER
  // read-only status (past_due, unpaid, incomplete, paused) still has a
  // live, updatable subscription — changePlan and the billing portal
  // already cover those; routing them through a second Checkout session
  // would create a second subscription for one customer instead of fixing
  // the one that exists.
  if (account.status !== "canceled" && account.status !== "incomplete_expired") {
    return {
      error:
        "This account's subscription can still be updated directly. Use Change plan or the billing portal below instead.",
    };
  }

  const customerId = account.stripe_customer_id;
  if (!customerId) {
    return {
      error: `This account isn't billed through Stripe, so it can't be resubscribed here. Email ${BRAND.supportEmail}.`,
    };
  }

  const tier = formData.get("tier");
  const interval = formData.get("interval");
  if (!isPlanTier(tier) || !isBillingInterval(interval)) {
    return { error: "Pick a plan to resubscribe to." };
  }

  const priceId = priceIdFor(tier, interval);
  if (!priceId) {
    return { error: `${TIER_DISPLAY[tier].name} isn't available yet.` };
  }

  const origin = (await headers()).get("origin");
  if (!origin) {
    return { error: "Could not determine the return address. Try again." };
  }

  let url: string | null = null;
  try {
    const stripe = getStripe();
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      // Ties the session back to the Supabase identity — provisioning's
      // `existing` short-circuit still requires it (it throws without one),
      // even though this checkout resolves to the SAME account.
      client_reference_id: user.id,
      line_items: [{ price: priceId, quantity: seatsForTier(tier) }],
      payment_method_collection: "always",
      metadata: { supabase_user_id: user.id, plan_tier: tier },
      success_url: `${origin}/settings/billing?changed=1`,
      cancel_url: `${origin}/settings/billing`,
    });
    url = session.url;
  } catch (err) {
    console.error(
      "[stripe] resubscribe checkout session failed",
      err instanceof Error ? err.message : String(err)
    );
    return {
      error: `Couldn't start checkout. Try again, or email ${BRAND.supportEmail} if this keeps happening.`,
    };
  }

  if (!url) {
    return { error: "Stripe did not return a checkout URL. Try again." };
  }
  redirect(url);
}

/**
 * CANCEL AT PERIOD END / RESUME — the one billing decision a paying
 * customer is most likely to want and, until now, could only reach by
 * leaving for Stripe's portal.
 *
 * IT IS A FLAG FLIP, NOT A DELETION. `cancel_at_period_end: true` leaves
 * the subscription active and paid-for until the period it has already
 * been billed for runs out; Stripe then cancels it and the webhook moves
 * `status` to `canceled`, at which point this product's read-only rule
 * (ACCOUNT_WRITABLE_STATUSES) takes over — records stay readable and
 * exportable, and nothing is deleted. Setting it back to false before that
 * date undoes the whole thing with no proration and no gap, which is why
 * the same action serves both directions: they are the same field.
 *
 * DELIBERATELY NOT `subscriptions.cancel()`. That ends the subscription
 * IMMEDIATELY and throws away the remainder of a period the pilot has
 * already paid for. No button on this screen should be able to do that by
 * accident, and no copy on this screen promises it.
 *
 * plan_tier and status are still moved ONLY by the webhook. This action,
 * like changePlan above, talks to Stripe and nothing else.
 */
export async function setCancelAtPeriodEnd(
  _prev: BillingActionState,
  formData: FormData
): Promise<BillingActionState> {
  // allowReadOnly for the same reason changePlan has it: RESUMING is part
  // of the path back to a writable account, and a past_due account must be
  // able to reach it.
  const { account, role } = await requireAccount("/settings/billing", {
    allowReadOnly: true,
  });
  if (role !== "owner") {
    return { error: "Only the account owner can cancel or resume the plan." };
  }

  // The intent rides the submit button's own name/value, the same pattern
  // ChangePlanButtons uses — no client state to go stale between render
  // and submit.
  const intent = formData.get("intent");
  if (intent !== "cancel" && intent !== "resume") {
    return { error: "Pick cancel or resume." };
  }

  const subscriptionId = account.stripe_subscription_id;
  if (!subscriptionId) {
    return {
      error:
        `This account isn't billed through Stripe, so its plan is managed for you. Email ${BRAND.supportEmail} to change it.`,
    };
  }

  try {
    await getStripe().subscriptions.update(subscriptionId, {
      cancel_at_period_end: intent === "cancel",
    });
  } catch (err) {
    console.error(
      "[stripe] cancel/resume failed",
      err instanceof Error ? err.message : String(err)
    );
    return {
      error:
        "Couldn't change that just now. Try again, or use the Stripe billing portal below.",
    };
  }

  revalidatePath("/settings/billing");
  redirect(`/settings/billing?changed=${intent === "cancel" ? "cancel" : "resume"}`);
}

/**
 * Stripe's hosted billing portal: the payment method, the full invoice
 * archive, and tax/address details live THERE, on Stripe's
 * infrastructure, rather than being reimplemented here — the same "Stripe
 * is the billing system of record" posture as everything else in this
 * file. Any change made in the portal comes back through the webhook like
 * every other change.
 */
export async function openBillingPortal(
  _prev: BillingActionState,
  _formData: FormData
): Promise<BillingActionState> {
  // allowReadOnly: the billing portal is THE resubscribe/reactivate path
  // (docs/PRICING.md §5) and MUST remain reachable for a canceled account,
  // so it opts out of the read-only write-gate (Finding 3). Without this a
  // lapsed pilot could never get back to a writable account.
  const { account, role } = await requireAccount("/settings/billing", {
    allowReadOnly: true,
  });
  if (role !== "owner") {
    return { error: "Only the account owner can manage billing." };
  }
  const customerId = account.stripe_customer_id;
  if (!customerId) {
    return {
      error: "This account isn't billed through Stripe, so there's no billing portal for it.",
    };
  }

  const origin = (await headers()).get("origin");
  if (!origin) {
    return { error: "Could not determine the return address. Try again." };
  }

  let url: string | null = null;
  try {
    const stripe = getStripe();
    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${origin}/settings/billing`,
    });
    url = session.url;
  } catch (err) {
    console.error(
      "[stripe] billing portal session failed",
      err instanceof Error ? err.message : String(err)
    );
    return {
      error: "Couldn't open the billing portal. Try again in a moment.",
    };
  }

  if (!url) {
    return { error: "Stripe did not return a portal URL. Try again." };
  }
  redirect(url);
}

"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { requireAccount } from "@/lib/supabase/account";
import { getStripe } from "@/lib/stripe/server";
import { priceIdFor } from "@/lib/stripe/prices";
import { isBillingInterval, isPlanTier, TIER_DISPLAY } from "@/lib/entitlements";

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
  const { account, role } = await requireAccount("/settings/billing");

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
        "This account isn't billed through Stripe, so its plan is managed for you. Get in touch to change it.",
    };
  }

  try {
    const stripe = getStripe();
    const subscription = await stripe.subscriptions.retrieve(subscriptionId);
    const item = subscription.items.data[0];
    if (!item) {
      throw new Error(`Subscription ${subscriptionId} has no items.`);
    }
    if (item.price.id === priceId) {
      // Already on this exact price — idempotent no-op rather than a
      // pointless Stripe write.
      return { error: null };
    }
    await stripe.subscriptions.update(subscriptionId, {
      items: [{ id: item.id, price: priceId }],
      // Fair in both directions: an upgrade bills the difference for the
      // remainder of the cycle, a downgrade credits it, on the next
      // invoice. Stripe's default cycle anchoring is kept.
      proration_behavior: "create_prorations",
    });
  } catch (err) {
    console.error(
      "[stripe] plan change failed",
      err instanceof Error ? err.message : String(err)
    );
    return {
      error: "Couldn't change the plan. Try again, or get in touch if this keeps happening.",
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
 * Stripe's hosted billing portal: payment method, invoices, and
 * cancellation live THERE, on Stripe's infrastructure, rather than being
 * reimplemented here — the same "Stripe is the billing system of
 * record" posture as everything else in this file. Any change made in
 * the portal comes back through the webhook like every other change.
 */
export async function openBillingPortal(
  _prev: BillingActionState,
  _formData: FormData
): Promise<BillingActionState> {
  const { account, role } = await requireAccount("/settings/billing");
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

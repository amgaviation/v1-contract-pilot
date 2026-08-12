import "server-only";
import type Stripe from "stripe";
import { createServiceClient } from "@/lib/supabase/service-role";
import { tierForPriceId, type PlanTier } from "@/lib/entitlements";

/**
 * Tenant provisioning and billing-state sync — the ONLY place in the app
 * that creates a pilot.accounts row (docs/PLAN.md decision #7: "the
 * webhook is the only thing that provisions a tenant").
 *
 * Everything here runs on the service-role client, which bypasses RLS.
 * That is exactly the single narrowly-scoped caller service-role.ts
 * documents as its reason to exist: these writes happen for a user who
 * has no session in flight (Stripe is calling us, not the pilot), and
 * they touch a row that does not exist yet, so there is no tenant context
 * for RLS to scope to.
 */

/** Maps a Stripe subscription status onto pilot.accounts.status. */
function mapStatus(stripeStatus: Stripe.Subscription.Status): string {
  // pilot.accounts.status accepts the Stripe vocabulary verbatim (see the
  // Phase 1 migration's CHECK), so this is a pass-through with an explicit
  // allow-list rather than a silent cast — an unrecognised future status
  // is worth failing on rather than writing through.
  const allowed = [
    "trialing",
    "active",
    "past_due",
    "canceled",
    "unpaid",
    "incomplete",
    "incomplete_expired",
    "paused",
  ];
  if (!allowed.includes(stripeStatus)) {
    throw new Error(`Unrecognised Stripe subscription status: ${stripeStatus}`);
  }
  return stripeStatus;
}

function trialEndsAt(sub: Stripe.Subscription): string | null {
  return sub.trial_end ? new Date(sub.trial_end * 1000).toISOString() : null;
}

/**
 * The subscription's price → plan tier, via the env-name mapping in
 * lib/entitlements.ts. The PRICE is the authority: an upgrade or
 * downgrade becomes real when Stripe says the subscription's price
 * changed (customer.subscription.updated), never when our UI claims it —
 * so a checkout the pilot abandoned, or a plan-change action that failed
 * at Stripe, can never move the tier.
 *
 * Returns null — meaning "leave plan_tier alone" — in two distinct
 * cases, both deliberate:
 *   - No price on the event (billing:verify's synthetic events, or a
 *     malformed payload). Nothing to map, nothing to change.
 *   - A price that maps to NO configured env var. That is OUR
 *     misconfiguration (a price rotated in Stripe without the env var
 *     following, or a stale test object), and the wrong response would
 *     be either a throw — a 500 loop that also blocks the STATUS sync
 *     riding the same event — or a silent default that could quietly
 *     downgrade a paying Business customer to solo. Keeping the current
 *     tier and logging loudly is the only option that strands nobody.
 */
function tierFromSubscription(sub: Stripe.Subscription): PlanTier | null {
  const priceId = sub.items?.data?.[0]?.price?.id ?? null;
  if (!priceId) return null;
  const match = tierForPriceId(priceId);
  if (!match) {
    console.error(
      `Subscription ${sub.id} carries price ${priceId}, which maps to no STRIPE_PRICE_ID_* env var — plan_tier left unchanged. Check the six price env vars against the Stripe dashboard.`
    );
    return null;
  }
  return match.tier;
}

/**
 * Provisions a tenant from a completed checkout, or returns the existing
 * one. Safe to call twice for the same checkout: the lookup by
 * stripe_customer_id short-circuits, and the unique indexes added in the
 * Phase 2 migration are the backstop if two deliveries race.
 */
export async function provisionAccountFromCheckout(
  session: Stripe.Checkout.Session,
  subscription: Stripe.Subscription
): Promise<{ accountId: string; created: boolean }> {
  const supabase = createServiceClient();

  const userId = session.client_reference_id;
  if (!userId) {
    throw new Error(
      `Checkout session ${session.id} has no client_reference_id — cannot link it to a Supabase user.`
    );
  }
  const customerId =
    typeof session.customer === "string" ? session.customer : session.customer?.id;
  if (!customerId) {
    throw new Error(`Checkout session ${session.id} has no customer.`);
  }

  // Already provisioned? (a retried delivery, or the subscription handler
  // beat us here)
  const { data: existing } = await supabase
    .from("accounts")
    .select("id")
    .eq("stripe_customer_id", customerId)
    .maybeSingle();

  if (existing) {
    return { accountId: (existing as { id: string }).id, created: false };
  }

  // Name the account from what the pilot actually gave Stripe, falling
  // back to their email local-part. legal_name is NOT NULL and is what
  // renders on their invoices, so it must never be blank — the pilot can
  // correct it in settings later.
  const details = session.customer_details;
  const fallback = (session.customer_email ?? "").split("@")[0];
  const legalName = details?.name?.trim() || fallback || "My aviation business";

  const { data: inserted, error: insertError } = await supabase
    .from("accounts")
    .insert({
      kind: "solo",
      // `plan` is decision #10's BILLING-SHAPE vocabulary (flat rate vs
      // the deferred per-seat plan), not the tier — all three tiers are
      // flat-rate today, so it stays "solo". The tier lives in
      // plan_tier. See 20260812300000_account_plan_tier.sql.
      plan: "solo",
      // Provisioning is the one place a null mapping falls back to
      // "solo" instead of "leave unchanged": a new row has no current
      // value to leave alone, NOT NULL requires an answer, and the
      // floor tier is the only safe wrong answer — a support
      // conversation upgrades it; the reverse (defaulting high) would
      // hand out unpaid entitlements. tierFromSubscription has already
      // logged loudly if this fires on a real checkout.
      plan_tier: tierFromSubscription(subscription) ?? "solo",
      seat_count: 1,
      legal_name: legalName,
      stripe_customer_id: customerId,
      stripe_subscription_id: subscription.id,
      status: mapStatus(subscription.status),
      trial_ends_at: trialEndsAt(subscription),
    } as never)
    .select("id")
    .single();

  if (insertError || !inserted) {
    throw new Error(
      `Failed to create account for customer ${customerId}: ${insertError?.message}`
    );
  }
  const accountId = (inserted as { id: string }).id;

  // The membership is what makes the account reachable through RLS — the
  // account row is invisible to its own owner until this row exists, so a
  // failure here would strand a paying customer outside their own tenant.
  const { error: memberError } = await supabase
    .from("account_members")
    .insert({ account_id: accountId, user_id: userId, role: "owner" } as never);

  if (memberError) {
    throw new Error(
      `Created account ${accountId} but failed to add owner ${userId}: ${memberError.message}`
    );
  }

  return { accountId, created: true };
}

/**
 * Syncs billing state from a subscription lifecycle event. Returns false
 * when no account matches yet — which is normal, not an error: a
 * customer.subscription.created can arrive before the
 * checkout.session.completed that provisions the tenant, and Stripe will
 * redeliver.
 */
export async function syncSubscriptionState(
  subscription: Stripe.Subscription
): Promise<boolean> {
  const supabase = createServiceClient();

  const { data: account } = await supabase
    .from("accounts")
    .select("id")
    .eq("stripe_subscription_id", subscription.id)
    .maybeSingle();

  // Fall back to the customer: the very first subscription event may
  // arrive before stripe_subscription_id has been written.
  const customerId =
    typeof subscription.customer === "string"
      ? subscription.customer
      : subscription.customer?.id;

  let accountId = (account as { id: string } | null)?.id ?? null;
  if (!accountId && customerId) {
    const { data: byCustomer } = await supabase
      .from("accounts")
      .select("id")
      .eq("stripe_customer_id", customerId)
      .maybeSingle();
    accountId = (byCustomer as { id: string } | null)?.id ?? null;
  }

  if (!accountId) return false;

  // plan_tier moves ONLY when the event's price maps to a tier. A null
  // mapping (no price on the payload, or an unmapped price — see
  // tierFromSubscription) leaves the existing tier standing, so a
  // malformed or misconfigured event can degrade the STATUS sync's
  // company but never silently re-tier a paying account. Out-of-order
  // safety needs nothing extra here: the webhook's isSuperseded check
  // runs before this function for every subscription event, so a stale
  // downgrade arriving after a newer upgrade is dropped whole, tier and
  // status together.
  const tier = tierFromSubscription(subscription);
  const update: Record<string, unknown> = {
    stripe_subscription_id: subscription.id,
    status: mapStatus(subscription.status),
    trial_ends_at: trialEndsAt(subscription),
  };
  if (tier) update.plan_tier = tier;

  const { error } = await supabase
    .from("accounts")
    .update(update as never)
    .eq("id", accountId);

  if (error) {
    throw new Error(
      `Failed to sync subscription ${subscription.id}: ${error.message}`
    );
  }
  return true;
}

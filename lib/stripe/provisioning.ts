import "server-only";
import type Stripe from "stripe";
import { createServiceClient } from "@/lib/supabase/service-role";

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
      plan: "solo",
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

  const { error } = await supabase
    .from("accounts")
    .update({
      stripe_subscription_id: subscription.id,
      status: mapStatus(subscription.status),
      trial_ends_at: trialEndsAt(subscription),
    } as never)
    .eq("id", accountId);

  if (error) {
    throw new Error(
      `Failed to sync subscription ${subscription.id}: ${error.message}`
    );
  }
  return true;
}

"use server";

import { createHash, timingSafeEqual } from "node:crypto";
import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/supabase/account";
import { createServiceClient } from "@/lib/supabase/service-role";
import { DASHBOARD_PATH } from "@/lib/nav";
import { isPlanTier } from "@/lib/entitlements";

/**
 * TEST-ONLY ONBOARDING BYPASS — provisions a COMPED account (the
 * stripe_customer_id IS NULL shape docs/BILLING.md documents and
 * app/(app)/settings/billing/demo-actions.ts already manages) without a
 * card and without Stripe, so the owner can walk the onboarding flow end
 * to end while testing.
 *
 * THIS IS A DELIBERATE, GATED EXCEPTION TO DECISION #7 ("only the webhook
 * creates a tenant"), and three gates keep it from becoming a hole in it:
 *
 *   1. DORMANT WITHOUT ITS SECRET. ONBOARDING_TEST_PIN unset (the default
 *      everywhere) means the button never renders AND this action refuses
 *      — there is nothing to find and nothing to brute-force.
 *   2. THE PIN IS CHECKED SERVER-SIDE, timing-safe, against the env value
 *      only. A wrong PIN is logged with the user id, so misuse of a live
 *      deployment is visible in the logs, and answered after a delay so
 *      guessing is slow.
 *   3. WHAT IT MINTS IS A COMPED ACCOUNT, not a subscription: no Stripe
 *      objects, no trial clock, plan managed by the existing demo-billing
 *      panel. It can never touch a paying account — it only ever INSERTS,
 *      and only for a signed-in user who has no account at all.
 *
 * SERVICE-ROLE NOTE: this is a sanctioned entry point of the same class as
 * demo-actions.ts (which lib/supabase/service-role.ts's registry pattern
 * calls a fifth) — a comped-account writer that a session client cannot be,
 * because accounts_protect_billing_columns blocks non-service writes to
 * billing columns and tenant creation has no session-scoped path at all.
 *
 * REMOVE OR KEEP? Keeping it costs nothing while the env var is unset.
 * Before launch, either delete the var from every deployment or delete
 * this file; the var is the switch.
 */

export type BypassState = { error: string | null };

function pinMatches(supplied: string, expected: string): boolean {
  // Hash both sides so timingSafeEqual gets equal-length buffers whatever
  // the visitor typed. The comparison stays constant-time in the digest.
  const a = createHash("sha256").update(supplied).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

export async function startTestBypass(
  _prev: BypassState,
  formData: FormData
): Promise<BypassState> {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  if (ctx.account) redirect(DASHBOARD_PATH);

  const expected = process.env.ONBOARDING_TEST_PIN;
  if (!expected) {
    // The button only renders when the var is set, so reaching here means
    // a hand-built POST against a deployment where the feature is off.
    return { error: "Not enabled." };
  }

  const supplied = String(formData.get("pin") ?? "");
  if (!supplied || !pinMatches(supplied, expected)) {
    console.error(
      `[test-bypass] wrong PIN for user ${ctx.user.id} (${ctx.user.email ?? "no email"}).`
    );
    // A flat delay on every failure keeps guessing slow without needing
    // state a serverless instance wouldn't keep anyway.
    await new Promise((resolve) => setTimeout(resolve, 1500));
    return { error: "Wrong PIN." };
  }

  const tier = formData.get("tier");
  if (!isPlanTier(tier)) {
    return { error: "Pick a plan." };
  }

  const supabase = createServiceClient();

  // Same identity-prefill reads as provisionAccountFromCheckout, so the
  // account this mints looks like any other new account to the wizard.
  let kind: "solo" | "business" = "solo";
  let fullName: string | null = null;
  let homeBase: string | null = null;
  const { data: userLookup } = await supabase.auth.admin.getUserById(ctx.user.id);
  const meta = userLookup?.user?.user_metadata ?? {};
  if (meta.account_kind === "business") kind = "business";
  if (typeof meta.full_name === "string" && meta.full_name.trim()) {
    fullName = meta.full_name.trim();
  }
  if (typeof meta.home_base === "string" && meta.home_base.trim()) {
    homeBase = meta.home_base.trim();
  }
  const legalName =
    fullName || (ctx.user.email ?? "").split("@")[0] || "My aviation business";

  const { data: inserted, error: insertError } = await supabase
    .from("accounts")
    .insert({
      kind,
      home_base: homeBase,
      // false so the (app) layout bounces into the onboarding wizard —
      // walking that wizard is the point of this bypass.
      onboarding_complete: false,
      plan: "solo",
      plan_tier: tier,
      seat_count: 1,
      legal_name: legalName,
      // THE COMP SHAPE. Null customer/subscription is what marks this
      // account internal everywhere (billing-facts, the demo billing
      // panel, MRR rollups all key on it).
      stripe_customer_id: null,
      stripe_subscription_id: null,
      status: "active",
      trial_ends_at: null,
    } as never)
    .select("id")
    .single();

  if (insertError || !inserted) {
    console.error(
      `[test-bypass] account insert failed for user ${ctx.user.id}: ${insertError?.message}`
    );
    return { error: "Couldn't create the test account. Try again." };
  }
  const accountId = (inserted as { id: string }).id;

  const { error: memberError } = await supabase
    .from("account_members")
    .insert({ account_id: accountId, user_id: ctx.user.id, role: "owner" } as never);
  if (memberError && memberError.code !== "23505") {
    // Without the membership the account is invisible to its own owner
    // under RLS. Remove the orphan row rather than stranding it.
    await supabase.from("accounts").delete().eq("id", accountId);
    console.error(
      `[test-bypass] membership insert failed for user ${ctx.user.id}: ${memberError.message}`
    );
    return { error: "Couldn't create the test account. Try again." };
  }

  console.error(
    `[test-bypass] comped test account ${accountId} created for user ${ctx.user.id} (${
      ctx.user.email ?? "no email"
    }), tier ${tier}.`
  );
  redirect(DASHBOARD_PATH);
}

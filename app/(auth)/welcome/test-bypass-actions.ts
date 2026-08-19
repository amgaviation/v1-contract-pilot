"use server";

import { createHash, timingSafeEqual } from "node:crypto";
import { notFound, redirect } from "next/navigation";
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
 * creates a tenant"), and four gates keep it from becoming a hole in it:
 *
 *   1. DEAD OUTSIDE `next dev`. The action's very first statement is
 *      `if (process.env.NODE_ENV !== "development") notFound();` — the
 *      same hard fail every other dev-only surface in this repo carries
 *      (app/(dev)/marketing-shots/[screen]/page.tsx,
 *      app/(dev)/seam-harness/page.tsx, app/(dev)/layout-harness/page.tsx).
 *      `notFound()` is called here, in a Server Function, on purpose — the
 *      Next.js docs for Server Actions confirm it is valid there, not just
 *      in a page render, and this codebase already relies on that:
 *      app/(app)/currency/actions.ts's requireAccount()-driven redirect()/
 *      notFound() calls are allowed to throw straight through the action
 *      for the same reason. Added 2026-08-19 because gate 2 alone was
 *      never enough: ONBOARDING_TEST_PIN reaching a live deployment is a
 *      one-line environment-config mistake, not an attack that needs
 *      defeating, and this gate makes that mistake stop mattering — it
 *      refuses in production AND in preview builds (both report NODE_ENV
 *      "production"; only `next dev` reports "development") whether or
 *      not the var is set.
 *   2. DORMANT WITHOUT A SECRET, AND WITHOUT A STRONG ONE.
 *      ONBOARDING_TEST_PIN unset (the default everywhere) means the button
 *      never renders AND this action refuses — there is nothing to find
 *      and nothing to brute-force. A PIN that IS set but is short or
 *      purely numeric is refused the identical way (pinIsStrongEnough
 *      below, gate 1 having already made this reachable in `next dev`
 *      only): .env.example has always said "use a long random value, not
 *      four digits" as prose; this enforces it instead of trusting it.
 *   3. THE PIN IS CHECKED SERVER-SIDE, timing-safe, against the env value
 *      only. A wrong PIN is logged with the user id, so misuse of a live
 *      deployment is visible in the logs, and answered after a delay so
 *      guessing is slow.
 *   4. WHAT IT MINTS IS A COMPED ACCOUNT, not a subscription: no Stripe
 *      objects, no trial clock, plan managed by the existing demo-billing
 *      panel. It can never touch a paying account — it only ever INSERTS,
 *      and only for a signed-in user who has no account at all.
 *
 * SERVICE-ROLE NOTE: this is entry point 9 in lib/supabase/service-role.ts's
 * registry — a comped-account writer that a session client cannot be,
 * because accounts_protect_billing_columns blocks non-service writes to
 * billing columns and tenant creation has no session-scoped path at all.
 * IT WAS NOT ACTUALLY REGISTERED THERE UNTIL 2026-08-19, despite this file
 * having claimed otherwise (an earlier version of this comment called it
 * "a fifth entry point," copying demo-actions.ts's own equally false claim
 * — see service-role.ts's header for the full account of how both went
 * unregistered). Read that registry before adding a second privileged call
 * anywhere in this file; it is the control, not this comment.
 *
 * REMOVE OR KEEP? Gate 1 above is what actually answers the launch
 * question this note used to raise: this file is now inert on every
 * deployed environment, production or preview, regardless of the var —
 * `next dev` on someone's own machine is the only place it can run at all.
 * ONBOARDING_TEST_PIN reaching a live deployment is no longer a hole to
 * close before launch. What is still undecided is hygiene, not safety:
 * whether to go on shipping a file (and a registered service-role entry
 * point) that can only ever execute locally, or delete it — and the var —
 * once nobody needs the local shortcut. Either is fine; that choice is
 * still the owner's, not this comment's.
 */

export type BypassState = { error: string | null };

function pinMatches(supplied: string, expected: string): boolean {
  // Hash both sides so timingSafeEqual gets equal-length buffers whatever
  // the visitor typed. The comparison stays constant-time in the digest.
  const a = createHash("sha256").update(supplied).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

/**
 * A four-digit PIN times out a human in an afternoon. .env.example has
 * always told the operator to "use a long random value, not four digits"
 * — this is that advice, enforced server-side instead of trusted as prose.
 * Cheap on purpose (length + digit-only check, no entropy estimation): the
 * environment guard above is what actually keeps this out of anywhere
 * reachable, so this only has to catch a PIN weak enough that the flat
 * 1500ms delay (gate 3) wouldn't meaningfully slow a local script down.
 */
const MIN_PIN_LENGTH = 20;

function pinIsStrongEnough(candidate: string): boolean {
  if (candidate.length < MIN_PIN_LENGTH) return false;
  if (/^\d+$/.test(candidate)) return false;
  return true;
}

export async function startTestBypass(
  _prev: BypassState,
  formData: FormData
): Promise<BypassState> {
  // Gate 1 — see the file header. Must run before anything else, including
  // the session lookup below: this is a refusal of the DEPLOYMENT, not of
  // the request, and it must not depend on how far a request gets.
  if (process.env.NODE_ENV !== "development") notFound();

  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  if (ctx.account) redirect(DASHBOARD_PATH);

  const expected = process.env.ONBOARDING_TEST_PIN;
  if (!expected) {
    // The button only renders when the var is set, so reaching here means
    // a hand-built POST against a deployment where the feature is off.
    return { error: "Not enabled." };
  }
  if (!pinIsStrongEnough(expected)) {
    // Refused the same way as "unset" to the caller — a weak PIN is a
    // deployment-config problem, not something to explain to whoever is
    // POSTing here. The specific reason goes to the server log only, for
    // whoever configured it.
    console.error(
      `[test-bypass] refusing: ONBOARDING_TEST_PIN is set but is under ${MIN_PIN_LENGTH} chars or purely numeric. Not enabled until it is stronger.`
    );
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

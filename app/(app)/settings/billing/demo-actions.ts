"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAccount } from "@/lib/supabase/account";
import { createServiceClient } from "@/lib/supabase/service-role";
import { isPlanTier, TIER_DISPLAY } from "@/lib/entitlements";
import type { BillingActionState } from "./actions";

/**
 * DEMO BILLING — for comped accounts only (docs/BILLING.md's "Comp /
 * internal accounts" section; tony@amgaviationgroup.com / AMG Aviation
 * Group LLC is the one that exists today). These two actions are the only
 * way `plan_tier` and `demo_cancel_at_period_end` are ever written outside
 * the Stripe webhook (lib/stripe/provisioning.ts) — see
 * lib/supabase/service-role.ts's header, which names its four sanctioned
 * entry points; this file is a fifth, added for exactly this reason.
 *
 * WHY A SERVICE-ROLE CLIENT AT ALL. `pilot.accounts.plan_tier` and the new
 * `demo_cancel_at_period_end` column are both in
 * accounts_protect_billing_columns' protected list (see
 * 20260817090000_comp_account_demo_billing.sql) — a normal session client
 * cannot write either regardless of RLS, full stop. That protection exists
 * so entitlement state can only ever arrive from Stripe's own webhook; a
 * demo-only exception belongs in a narrowly-scoped, clearly-named file
 * like this one, not in a carve-out inside the trigger itself.
 *
 * THE GUARD THAT MAKES THIS SAFE: every write below re-reads the account
 * through requireAccount (a normal session client, RLS-scoped to the
 * caller's own account) and refuses unless `stripe_customer_id === null`
 * on THAT read — never on client-supplied input, never cached. A real
 * subscriber's row always has a Stripe customer id, so these actions can
 * never touch one, no matter what a form posts. The service-role client is
 * reached only after that check passes, and only to write the two columns
 * this file owns — never a third.
 */

export async function demoChangePlan(
  _prev: BillingActionState,
  formData: FormData
): Promise<BillingActionState> {
  const { account, role } = await requireAccount("/settings/billing");
  if (role !== "owner") {
    return { error: "Only the account owner can change the demo plan." };
  }
  if (account.stripe_customer_id !== null) {
    // Unreachable from the real UI (billing-panel.tsx only renders this
    // action's form when isComped is true) — this is the second,
    // independent check the header above promises, not decoration.
    return { error: "This account is billed through Stripe; there's no demo plan to change." };
  }

  const tier = formData.get("tier");
  if (!isPlanTier(tier)) {
    return { error: "Pick a plan to switch to." };
  }

  if (tier === account.plan_tier) {
    return { error: null };
  }

  const { error } = await createServiceClient()
    .from("accounts")
    // `as never`: same cast lib/stripe/provisioning.ts uses for every
    // accounts UPDATE through this client — supabase-js resolves a partial
    // update against the hand-authored types file oddly (see that file's
    // note on this), not a sign anything here is actually untyped.
    .update({ plan_tier: tier } as never)
    .eq("id", account.id)
    .is("stripe_customer_id", null);

  if (error) {
    console.error("[demo-billing] plan change failed", error.message);
    return {
      error: `Couldn't switch to ${TIER_DISPLAY[tier].name}. Try again.`,
    };
  }

  revalidatePath("/settings/billing");
  revalidatePath("/settings");
  redirect("/settings/billing?changed=1");
}

export async function demoSetCancelAtPeriodEnd(
  _prev: BillingActionState,
  formData: FormData
): Promise<BillingActionState> {
  const { account, role } = await requireAccount("/settings/billing");
  if (role !== "owner") {
    return { error: "Only the account owner can cancel or resume the demo plan." };
  }
  if (account.stripe_customer_id !== null) {
    return { error: "This account is billed through Stripe; there's no demo subscription to cancel." };
  }

  const intent = formData.get("intent");
  if (intent !== "cancel" && intent !== "resume") {
    return { error: "Pick cancel or resume." };
  }

  const { error } = await createServiceClient()
    .from("accounts")
    .update({ demo_cancel_at_period_end: intent === "cancel" } as never)
    .eq("id", account.id)
    .is("stripe_customer_id", null);

  if (error) {
    console.error("[demo-billing] cancel/resume failed", error.message);
    return { error: "Couldn't change that just now. Try again." };
  }

  revalidatePath("/settings/billing");
  revalidatePath("/settings");
  redirect(`/settings/billing?changed=${intent === "cancel" ? "cancel" : "resume"}`);
}

"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireAccount } from "@/lib/supabase/account";
import { reauthMessage, verifyPassword } from "@/lib/supabase/reauth";
import { getStripe } from "@/lib/stripe/server";
import {
  HOLD_MINIMUM_PAID_INVOICES,
  paidInvoiceCount,
  pauseCollection,
  resumeCollection,
} from "@/lib/stripe/hold";

/**
 * ===========================================================================
 * THE FOUR DESTRUCTIVE ACCOUNT ACTIONS
 * ===========================================================================
 *
 * Reset (clear my records, keep my account), deactivate (stop billing, keep
 * everything, come back later) and delete (be gone). Every one of them is
 * irreversible from the pilot's side, so they share one posture:
 *
 *   1. OWNER ONLY. A member or a bookkeeper cannot end the business they
 *      were invited into. The database enforces this too — every function
 *      these call starts with pilot.assert_account_owner — so this check is
 *      here to produce a sentence rather than an exception, not because it
 *      is the thing standing in the way.
 *
 *   2. THE PASSWORD, EVERY TIME. Re-verified through lib/supabase/reauth.ts,
 *      the cookie-less client that checks a password without rotating the
 *      session it is checking. An unlocked laptop in an FBO is the realistic
 *      threat here, and it is exactly the one a live session defeats.
 *
 *   3. THE NAME, TYPED, for the two that destroy records. Not a checkbox and
 *      not an "are you sure": the pilot types their own business name back.
 *      A confirmation you can satisfy by clicking twice in the same place
 *      you were already clicking is not a confirmation.
 *
 *   4. THE SUBSCRIPTION IS ENDED BY STRIPE FIRST, and the local state moves
 *      only after Stripe has agreed. The reverse order can leave a pilot
 *      deactivated locally and still being charged, which is the one failure
 *      here that costs somebody money.
 *
 * WHAT IS NOT HERE: no service-role client. README.md records that the
 * service role is used in exactly one place in this product (the Stripe
 * webhook) and that stays true — these run as the pilot's own session
 * against SECURITY DEFINER functions that re-derive the caller from
 * auth.uid(). See 20260818090000_account_lifecycle.sql's own header.
 */

export type AccountActionState = { error: string | null; notice: string | null };

const OK: AccountActionState = { error: null, notice: null };

function fail(error: string): AccountActionState {
  return { error, notice: null };
}

/**
 * The typed-confirmation test. Case- and whitespace-insensitive, because
 * the point is "prove you know which account this is and that you meant
 * it", not "reproduce our capitalisation".
 */
function nameMatches(typed: string, legalName: string): boolean {
  const normalise = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();
  return normalise(typed) === normalise(legalName) && normalise(typed).length > 0;
}

/**
 * Shared preamble: owner, password, and (when asked for) the typed name.
 * Returns either a failure state to hand straight back to the form, or the
 * account and user the caller needs.
 */
async function authorize(
  formData: FormData,
  opts: { requireTypedName: boolean }
): Promise<
  | { ok: false; state: AccountActionState }
  | { ok: true; account: { id: string; legal_name: string; stripe_subscription_id: string | null }; email: string }
> {
  // allowReadOnly: a canceled or past-due account must still be able to
  // delete itself or clear its data. Locking destructive-but-wanted actions
  // behind an active subscription would mean a lapsed pilot cannot get their
  // records out of the product, which is the opposite of the promise.
  const { account, user, role } = await requireAccount("/settings?tab=account", {
    allowReadOnly: true,
  });

  if (role !== "owner") {
    return {
      ok: false,
      state: fail("Only the account owner can do this."),
    };
  }

  const password = String(formData.get("password") ?? "");
  if (!password) return { ok: false, state: fail("Enter your password to confirm.") };

  if (!user.email) {
    return { ok: false, state: fail("This account has no sign-in email to verify against.") };
  }

  const reauth = await verifyPassword(user.email, password);
  if (reauth !== "ok") return { ok: false, state: fail(reauthMessage(reauth)) };

  if (opts.requireTypedName) {
    const typed = String(formData.get("confirm_name") ?? "");
    if (!nameMatches(typed, account.legal_name)) {
      return {
        ok: false,
        state: fail(
          `Type your business name exactly as it appears (${account.legal_name}) to confirm.`
        ),
      };
    }
  }

  return {
    ok: true,
    account: {
      id: account.id,
      legal_name: account.legal_name,
      stripe_subscription_id: account.stripe_subscription_id,
    },
    email: user.email,
  };
}

/**
 * End the subscription at Stripe, now.
 *
 * DELIBERATELY `cancel()` AND NOT `cancel_at_period_end`. The ordinary
 * cancel path (settings/billing) sets the flag, because a pilot cancelling
 * a plan they are still using should keep what they paid for. Deactivating
 * or deleting is a different sentence: the pilot is asking for the account
 * to stop being a thing, and leaving a live subscription attached to a
 * deleted tenant would keep charging a card with nothing behind it. The UI
 * says plainly that the rest of the period is not refunded.
 *
 * A comped account (no stripe_subscription_id) is a no-op here, not an
 * error — docs/BILLING.md's convention is that a null Stripe column means
 * "not billed through Stripe", and every job must skip rather than treat it
 * as broken.
 */
async function endSubscription(subscriptionId: string | null): Promise<string | null> {
  if (!subscriptionId) return null;

  try {
    const stripe = getStripe();
    await stripe.subscriptions.cancel(subscriptionId);
    return null;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // Already gone at Stripe is the outcome we wanted, not a failure. Any
    // other Stripe error must stop the action: continuing would leave the
    // pilot without an account and with a live subscription.
    if (/no such subscription|resource_missing/i.test(message)) return null;
    console.error(`account lifecycle: failed to cancel ${subscriptionId}: ${message}`);
    return "We could not end your subscription with Stripe, so nothing else was changed. Try again in a moment, or cancel from Settings → Billing first.";
  }
}

/**
 * RESET — clear every record the pilot has entered, keep the account, the
 * subscription, the settings and the invoice numbering.
 *
 * This is the ONE path in the product that deletes a logbook, and it is
 * gated behind the password AND the typed business name for that reason.
 * The panel offers the export immediately above the button.
 */
export async function resetAccountData(
  _prev: AccountActionState,
  formData: FormData
): Promise<AccountActionState> {
  const auth = await authorize(formData, { requireTypedName: true });
  if (!auth.ok) return auth.state;

  const supabase = await createClient();
  // `as never` on the args: database.types.ts is generated from the live
  // project and does not know a function added by an unapplied migration.
  // Same quirk every other .rpc() write call site in this codebase carries.
  const { error } = await supabase.rpc("reset_account_data", {
    target_account: auth.account.id,
  } as never);

  if (error) {
    console.error(`account lifecycle: reset failed for ${auth.account.id}: ${error.message}`);
    return fail("We could not clear your records. Nothing was changed.");
  }

  // Everything downstream of this reads the tables that just emptied.
  revalidatePath("/", "layout");
  return {
    error: null,
    notice:
      "Your records are cleared. Your account, your settings and your invoice numbering are unchanged.",
  };
}

/**
 * DEACTIVATE — end the subscription, keep every record, go read-only.
 *
 * No typed name: this destroys nothing. It is the reversible one, and
 * making it as heavy as deletion would push people toward deletion.
 */
export async function deactivateAccount(
  _prev: AccountActionState,
  formData: FormData
): Promise<AccountActionState> {
  const auth = await authorize(formData, { requireTypedName: false });
  if (!auth.ok) return auth.state;

  const stripeError = await endSubscription(auth.account.stripe_subscription_id);
  if (stripeError) return fail(stripeError);

  const supabase = await createClient();
  const { error } = await supabase.rpc("deactivate_account", {
    target_account: auth.account.id,
  } as never);

  if (error) {
    console.error(
      `account lifecycle: deactivate failed for ${auth.account.id} AFTER Stripe cancel: ${error.message}`
    );
    return fail(
      "Your subscription was ended, but we could not switch the account to read-only. Reload Settings; if it still shows as active, contact support before re-subscribing."
    );
  }

  revalidatePath("/", "layout");
  return {
    error: null,
    notice:
      "Your account is deactivated and your subscription has ended. Every record is kept and still exportable. Re-subscribe from Settings → Billing whenever you want it back.",
  };
}

/**
 * DELETE — end the subscription, remove the tenant and everything that
 * cascades from it, then sign the person out.
 *
 * The redirect at the end is not cosmetic: the session's account is gone,
 * so every authenticated page would now fail its own gate. Signing out is
 * the honest end of the flow.
 */
export async function deleteAccount(
  _prev: AccountActionState,
  formData: FormData
): Promise<AccountActionState> {
  const auth = await authorize(formData, { requireTypedName: true });
  if (!auth.ok) return auth.state;

  const stripeError = await endSubscription(auth.account.stripe_subscription_id);
  if (stripeError) return fail(stripeError);

  const supabase = await createClient();
  const { error } = await supabase.rpc("delete_account", {
    target_account: auth.account.id,
  } as never);

  if (error) {
    console.error(
      `account lifecycle: delete failed for ${auth.account.id} AFTER Stripe cancel: ${error.message}`
    );
    return fail(
      "Your subscription was ended, but the account itself could not be deleted. Nothing was removed. Contact support so this is not left half-done."
    );
  }

  // Local scope: this ends THIS session. There is no account left for the
  // other devices to reach either, and a global sign-out here would be a
  // second Supabase call that can fail after the account is already gone.
  await supabase.auth.signOut({ scope: "local" });
  redirect("/?deleted=1");
}

export { OK as INITIAL_ACCOUNT_ACTION_STATE };

/**
 * ===========================================================================
 * THE MONTHLY HOLD
 * ===========================================================================
 *
 * Two months of paused billing, for a pilot whose flying has stopped for a
 * season. Read-only while it runs; every record kept.
 *
 * ELIGIBILITY IS CHECKED AGAINST STRIPE, not against a local column, and
 * counted in PAID INVOICES rather than elapsed time — see
 * lib/stripe/hold.ts's own note on why `created` gets that wrong. The rule
 * is the owner's: an account must have been actively billing for two months
 * or more before it can be parked.
 *
 * ORDER, as everywhere else in this file: Stripe first, local state second.
 * A hold recorded locally while Stripe kept collecting would charge a pilot
 * for months they were locked out of.
 */

/** The ceiling, in days. Mirrors the CHECK in 20260818090000. */
const HOLD_MAX_DAYS = 62;

export async function placeHold(
  _prev: AccountActionState,
  formData: FormData
): Promise<AccountActionState> {
  const auth = await authorize(formData, { requireTypedName: false });
  if (!auth.ok) return auth.state;

  const months = Number(formData.get("months") ?? "0");
  if (months !== 1 && months !== 2) {
    return fail("Choose a hold of one or two months.");
  }

  const subscriptionId = auth.account.stripe_subscription_id;
  if (!subscriptionId) {
    // A comped account has no subscription to pause, so a hold would buy it
    // nothing and cost it its writes. Refused rather than half-applied.
    return fail(
      "This account isn't billed through Stripe, so there is nothing to put on hold."
    );
  }

  // The eligibility rule, asked of the only system that knows the answer.
  let paid: number;
  try {
    paid = await paidInvoiceCount(subscriptionId);
  } catch (error) {
    console.error(
      `hold: could not read invoice history for ${subscriptionId}: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
    return fail("We could not check your billing history just now. Try again in a moment.");
  }

  if (paid < HOLD_MINIMUM_PAID_INVOICES) {
    return fail(
      `A hold is available once you have been billing for two months. You have ${paid} paid ${
        paid === 1 ? "month" : "months"
      } so far.`
    );
  }

  // 31 days a month rather than calendar months: the database CHECK is a
  // flat 62-day ceiling, so computing calendar months here could produce a
  // date the schema then rejects (a two-month hold starting 31 December ends
  // 28 February — fine — but starting 1 July ends 1 September, 62 days, and
  // any drift past that is refused). Flat days can never exceed it.
  const endsAt = new Date(Date.now() + months * 31 * 24 * 60 * 60 * 1000);
  if (months * 31 > HOLD_MAX_DAYS) return fail("A hold cannot run longer than two months.");

  try {
    await pauseCollection(subscriptionId, endsAt);
  } catch (error) {
    console.error(
      `hold: Stripe refused pause_collection on ${subscriptionId}: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
    return fail("We could not pause your billing with Stripe, so nothing was changed.");
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("place_hold", {
    target_account: auth.account.id,
    ends_at: endsAt.toISOString(),
  } as never);

  if (error) {
    // Stripe is already paused and the local row is not. Unwind, so the
    // pilot is not left un-billed and fully writable — the one outcome here
    // that quietly costs money.
    console.error(`hold: place_hold failed for ${auth.account.id}: ${error.message}`);
    try {
      await resumeCollection(subscriptionId);
    } catch {
      console.error(
        `hold: FAILED TO UNWIND pause_collection on ${subscriptionId} after a failed place_hold — this subscription is paused with no hold recorded`
      );
    }
    return fail("We could not place the hold. Nothing was changed.");
  }

  revalidatePath("/", "layout");
  return {
    error: null,
    notice: `Your account is on hold until ${endsAt.toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    })}. Billing is paused and your records are read-only. Come back any time.`,
  };
}

export async function resumeFromHold(
  _prev: AccountActionState,
  formData: FormData
): Promise<AccountActionState> {
  const auth = await authorize(formData, { requireTypedName: false });
  if (!auth.ok) return auth.state;

  const subscriptionId = auth.account.stripe_subscription_id;
  if (subscriptionId) {
    try {
      await resumeCollection(subscriptionId);
    } catch (error) {
      console.error(
        `hold: Stripe refused to resume ${subscriptionId}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      return fail("We could not restart your billing with Stripe, so nothing was changed.");
    }
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("resume_from_hold", {
    target_account: auth.account.id,
  } as never);

  if (error) {
    console.error(`hold: resume_from_hold failed for ${auth.account.id}: ${error.message}`);
    return fail(
      "Your billing was restarted, but the hold could not be cleared. Reload Settings; contact support if it still shows as on hold."
    );
  }

  revalidatePath("/", "layout");
  return {
    error: null,
    notice: "Your hold is over. Billing has restarted and your account is writable again.",
  };
}

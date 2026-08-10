"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireAccount } from "@/lib/supabase/account";
import { friendlyDbError } from "@/lib/db-errors";
import { buildConnectAuthorizeUrl, deauthorizeConnectAccount } from "@/lib/stripe/connect";

/**
 * Server actions for Stripe Connect (Standard) onboarding/disconnect.
 * Neither of these touches lib/supabase/service-role.ts — see the header
 * comment in supabase/migrations/20260809040000_connect_payments.sql for
 * why that boundary holds here: the OAuth grant/RPC pair is a narrower,
 * purpose-built door, not the service-role client.
 */

const STATE_COOKIE = "stripe_connect_state";

/**
 * Starts Standard OAuth. Redirects to Stripe; the callback route
 * (app/api/stripe/connect/callback/route.ts) does the rest.
 *
 * THE `state` TOKEN DOES TWO JOBS, AND ONLY ONE OF THEM WAS BEING DONE.
 *
 *   1. CSRF: it is echoed back by Stripe and compared against a short-
 *      lived, httpOnly, SameSite=Lax cookie, so a forged callback request
 *      (no cookie, or the wrong one) is rejected before it can attach a
 *      connect_account_id to anybody. This part was always here.
 *
 *   2. ACCOUNT AND FLOW BINDING (added after review): the token is now
 *      minted BY THE DATABASE, in pilot.connect_oauth_states, carrying
 *      the account and user that started the flow. That closes two
 *      separate holes at once:
 *        - the callback used to resolve the target account by taking the
 *          caller's FIRST account_members row by created_at, so a pilot
 *          who belongs to two accounts and started the flow from the
 *          second would have Stripe attached to the first; and
 *        - pilot.connect_account_link took the account id as a plain
 *          argument, so any signed-in owner could call it directly over
 *          PostgREST and set an arbitrary `acct_...` with no OAuth round
 *          trip and no livemode check at all.
 *      A state row is the proof that the round trip started here. It is
 *      single-use, expires in 15 minutes, and lives in a table with RLS
 *      on and no policies — nothing but the two SECURITY DEFINER
 *      functions can read or write it.
 */
export async function startConnectOnboarding() {
  const { account, role } = await requireAccount("/settings");
  if (role !== "owner") {
    throw new Error("Only an account owner can connect Stripe.");
  }
  if (account.connect_account_id) {
    // Already connected — nothing to start. The panel doesn't render this
    // action's button in that state, so reaching here means a stale form
    // resubmission; just send them back rather than starting a second
    // OAuth grant on top of an existing one.
    redirect("/settings?tab=business");
  }

  const supabase = await createClient();
  // `as never`: the .rpc() args quirk this codebase works around at every
  // call site — see disconnectStripeConnect below.
  const { data: mintedState, error: stateError } = await supabase.rpc(
    "connect_oauth_state_begin",
    { p_account_id: account.id } as never
  );
  const state = typeof mintedState === "string" ? mintedState : null;
  if (stateError || !state) {
    console.error(
      `connect_oauth_state_begin failed: ${stateError?.message ?? "no state returned"}`
    );
    throw new Error("Couldn't start Stripe Connect. Try again.");
  }

  const cookieStore = await cookies();
  cookieStore.set(STATE_COOKIE, state, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: 600, // 10 minutes — long enough to complete the Stripe hop, short enough not to linger
    path: "/",
  });

  const requestHeaders = await headers();
  const origin =
    process.env.NEXT_PUBLIC_APP_URL ?? `https://${requestHeaders.get("host")}`;
  const redirectUri = `${origin}/api/stripe/connect/callback`;

  redirect(buildConnectAuthorizeUrl({ state, redirectUri }));
}

export type DisconnectState = {
  error: string | null;
  /**
   * Set when the local disconnect succeeded but the OAuth grant's removal
   * on Stripe's side could not be confirmed. The pilot has to finish that
   * in their own dashboard, and needs to be told so.
   */
  warning?: string;
};

/**
 * Disconnects Stripe Connect: revokes the platform's OAuth grant on
 * Stripe's side, then clears connect_account_id AND every stored
 * payment-link reference on this tenant's invoices via the single
 * owner-gated RPC pilot.connect_account_unlink.
 *
 * WHEN THE REVOKE FAILS (fixed after review): the local clear still runs —
 * the pilot asked to disconnect, and the app must stop offering to act for
 * that account either way — but the pilot is now TOLD. Previously every
 * revoke error was logged and swallowed, so a pilot whose grant was still
 * live on Stripe was shown a clean "Stripe disconnected" and had no reason
 * to go check. Being wrong about whether an OAuth grant on someone's
 * payment account still exists is not the kind of thing to be quietly
 * optimistic about.
 *
 * WHAT HAPPENS TO OUTSTANDING PAYMENT LINKS: any Payment Link already
 * handed to a client keeps living on the pilot's OWN Stripe account (it
 * was created there directly, as a direct charge — this platform never
 * held it). Disconnecting stops the app from being able to vouch for it
 * or generate new ones, and clears the "Pay online" button from every
 * invoice, but it does NOT deactivate the link on Stripe's side. A pilot
 * who wants a specific link fully dead needs to deactivate it themselves
 * from their own Stripe Dashboard — connect-panel.tsx's confirmation copy
 * says this before the disconnect action runs.
 */
export async function disconnectStripeConnect(
  _prevState: DisconnectState,
  _formData: FormData
): Promise<DisconnectState> {
  const { account, role } = await requireAccount("/settings");
  if (role !== "owner") {
    return { error: "Only an account owner can disconnect Stripe." };
  }
  if (!account.connect_account_id) {
    return { error: null };
  }

  let warning: string | undefined;
  try {
    await deauthorizeConnectAccount(account.connect_account_id);
  } catch (err) {
    console.error(
      `Stripe deauthorize failed for ${account.connect_account_id} (clearing locally anyway): ${
        err instanceof Error ? err.message : "unknown error"
      }`
    );
    warning =
      "We cleared Stripe from this account, but couldn't confirm with Stripe that the connection was removed on their side. Check Connected Apps in your Stripe Dashboard and revoke it there if it's still listed.";
  }

  const supabase = await createClient();
  // `as never`: supabase-js's .rpc() resolves its args parameter to
  // `undefined` against this hand-authored types file — same quirk every
  // .rpc()/.insert()/.update() call site in this codebase works around
  // the same way (see trips/actions.ts's updateTrip comment).
  const { error } = await supabase.rpc("connect_account_unlink", {
    p_account_id: account.id,
  } as never);
  if (error) {
    return { error: friendlyDbError(error, "connect_account_unlink") };
  }

  const { revalidatePath } = await import("next/cache");
  revalidatePath("/settings");
  revalidatePath("/invoices");
  return { error: null, warning };
}

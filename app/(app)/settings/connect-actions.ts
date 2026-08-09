"use server";

import { randomBytes } from "node:crypto";
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
 * CSRF protection: `state` is a fresh random token, stored in a short-
 * lived, httpOnly, SameSite=Lax cookie scoped to this browser. The
 * callback checks the `state` Stripe echoes back against this cookie
 * before doing anything — a forged callback request (no cookie, or the
 * wrong one) is rejected before it can attach a connect_account_id to
 * anyone's account.
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

  const state = randomBytes(24).toString("hex");
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

export type DisconnectState = { error: string | null };

/**
 * Disconnects Stripe Connect: revokes the platform's OAuth grant on
 * Stripe's side (best-effort — see deauthorizeConnectAccount), then
 * clears connect_account_id AND every stored payment-link reference on
 * this tenant's invoices via the single owner-gated RPC
 * pilot.connect_account_unlink.
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

  await deauthorizeConnectAccount(account.connect_account_id);

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
  return { error: null };
}

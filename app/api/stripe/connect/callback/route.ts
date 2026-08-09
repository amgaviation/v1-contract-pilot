import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { exchangeConnectCode } from "@/lib/stripe/connect";
import { friendlyDbError } from "@/lib/db-errors";

/**
 * Stripe Connect (Standard) OAuth return. NOT a webhook — there is no
 * `stripe-signature` header here and nothing to verify against a signing
 * secret, because this is a browser redirect Stripe sends the pilot's OWN
 * browser back through, carrying a one-time authorization `code` in the
 * query string. The security properties this route needs are different
 * from the platform webhook's and are met differently:
 *
 *   - CSRF / request-forgery: the `state` query param must match the
 *     httpOnly cookie startConnectOnboarding() set right before the
 *     redirect to Stripe. A request that doesn't carry that cookie (never
 *     started here, or started for a different browser) is rejected.
 *   - Session binding: this route requires a live, authenticated Supabase
 *     session (the pilot is sitting in their own browser, mid-flow) — it
 *     never uses the service-role client. The account the connection
 *     attaches to is resolved from THIS session via requireAccount-style
 *     lookup, never from anything the query string supplies.
 *   - Test/live separation: exchangeConnectCode() refuses to proceed if
 *     the OAuth grant's own `livemode` disagrees with this deployment's
 *     key mode (see lib/stripe/connect.ts).
 *   - The actual write happens through pilot.connect_account_link, a
 *     SECURITY DEFINER RPC that re-derives the caller from auth.uid() and
 *     re-checks ownership itself — this route's own membership check
 *     below is a fast, friendly-error early return, not the real gate.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATE_COOKIE = "stripe_connect_state";

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const oauthError = url.searchParams.get("error_description") ?? url.searchParams.get("error");

  const cookieStore = await cookies();
  const expectedState = cookieStore.get(STATE_COOKIE)?.value;
  // One-time: clear it whether this attempt succeeds or fails, so a
  // captured/replayed callback URL can't be replayed a second time.
  cookieStore.delete(STATE_COOKIE);

  if (oauthError) {
    return redirectToSettings(request, `Stripe Connect: ${oauthError}`);
  }
  if (!code || !state || !expectedState || state !== expectedState) {
    return redirectToSettings(
      request,
      "That Stripe Connect link has expired or was already used. Try connecting again."
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return redirectToSettings(request, "Sign in and try connecting Stripe again.");
  }

  const { data: membershipData } = await supabase
    .from("account_members")
    .select("account_id, role")
    .eq("user_id", user.id)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  const membership = membershipData as { account_id: string; role: string } | null;
  if (!membership || membership.role !== "owner") {
    return redirectToSettings(request, "Only an account owner can connect Stripe.");
  }

  let connectAccountId: string;
  try {
    const result = await exchangeConnectCode(code);
    connectAccountId = result.connectAccountId;
  } catch (err) {
    console.error(
      `Stripe Connect OAuth exchange failed: ${err instanceof Error ? err.message : "unknown"}`
    );
    return redirectToSettings(request, "Couldn't complete Stripe Connect. Try again.");
  }

  // `as never`: see connect-actions.ts's disconnectStripeConnect comment —
  // the same .rpc()-args quirk every write call site in this codebase
  // casts around.
  const { error } = await supabase.rpc("connect_account_link", {
    p_account_id: membership.account_id,
    p_connect_account_id: connectAccountId,
  } as never);
  if (error) {
    console.error(`connect_account_link failed: ${error.message}`);
    return redirectToSettings(request, friendlyDbError(error, "connect_account_link"));
  }

  return redirectToSettings(request, null, true);
}

function redirectToSettings(request: NextRequest, warning: string | null, connected = false) {
  const url = new URL("/settings", request.url);
  url.searchParams.set("tab", "business");
  if (warning) url.searchParams.set("warning", warning);
  if (connected) url.searchParams.set("connected", "1");
  return NextResponse.redirect(url);
}

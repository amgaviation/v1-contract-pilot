import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { deauthorizeConnectAccount, exchangeConnectCode } from "@/lib/stripe/connect";

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
 *     never uses the service-role client.
 *   - Account binding: the account this grant attaches to comes off the
 *     server-minted state row (pilot.connect_oauth_states), NOT from the
 *     query string and no longer from a "first membership by created_at"
 *     lookup — that lookup was a real bug for a pilot who belongs to two
 *     accounts, silently attaching Stripe to whichever account they
 *     happened to join first. See connect-actions.ts's header.
 *   - Test/live separation: exchangeConnectCode() refuses to proceed if
 *     the OAuth grant's own `livemode` disagrees with this deployment's
 *     key mode (see lib/stripe/connect.ts).
 *   - The actual write happens through pilot.connect_account_link, a
 *     SECURITY DEFINER RPC that consumes the state (single-use), re-derives
 *     the caller from auth.uid(), and re-checks ownership itself.
 *
 * IF THE LOCAL WRITE FAILS, THE GRANT IS REVOKED (fixed after review).
 * A successful token exchange means this platform now holds an OAuth grant
 * on the pilot's Stripe account. If storing it then fails, the old code
 * redirected with an error and left that grant in place — a live
 * authorization the pilot can see in their Stripe dashboard, that this app
 * has no record of and no UI to remove. Every failure path after a
 * successful exchange now calls deauthorizeConnectAccount() first, so a
 * failed connect leaves nothing behind on either side.
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
  // casts around. No account id is passed: the RPC reads it off the state
  // row it consumes, which is the whole point of the state row.
  const { error } = await supabase.rpc("connect_account_link", {
    p_connect_account_id: connectAccountId,
    p_state: state,
  } as never);

  if (error) {
    // Hand the grant back before telling the pilot it didn't work.
    console.error(`connect_account_link failed: ${error.message}`);
    const rolledBack = await rollBackGrant(connectAccountId);
    // The RPC's own messages ("expired or was already used", "belongs to a
    // different sign-in", "only an account owner may connect Stripe") are
    // written for a person, but they are still database output — this
    // sends one sentence the pilot can act on and keeps the specifics in
    // the server log, matching lib/db-errors.ts's rule.
    return redirectToSettings(
      request,
      rolledBack
        ? "Couldn't finish connecting Stripe. That connection attempt had expired. Try connecting again."
        : "Couldn't finish connecting Stripe. Check Connected Apps in your Stripe Dashboard and remove this app if it's listed, then try again."
    );
  }

  return redirectToSettings(request, null, true);
}

/**
 * Undoes a token exchange whose local write didn't land. Returns whether
 * the grant is definitely gone — false means the pilot has to remove it
 * themselves, and the copy above says so rather than pretending.
 */
async function rollBackGrant(connectAccountId: string): Promise<boolean> {
  try {
    const result = await deauthorizeConnectAccount(connectAccountId);
    return result.revoked;
  } catch (err) {
    console.error(
      `Stripe Connect rollback deauthorize failed for ${connectAccountId}: ${
        err instanceof Error ? err.message : "unknown"
      }`
    );
    return false;
  }
}

function redirectToSettings(request: NextRequest, warning: string | null, connected = false) {
  const url = new URL("/settings", request.url);
  url.searchParams.set("tab", "business");
  if (warning) url.searchParams.set("warning", warning);
  if (connected) url.searchParams.set("connected", "1");
  return NextResponse.redirect(url);
}

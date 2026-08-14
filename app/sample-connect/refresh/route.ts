import { NextResponse, type NextRequest } from "next/server";
import { getSessionContext } from "@/lib/supabase/account";
import { createSampleAccountLink } from "@/lib/sample-connect/accounts";
import { getSampleAccountId } from "@/lib/sample-connect/store";

/**
 * The Account Link `refresh_url`.
 *
 * Stripe sends the merchant here when the onboarding link they were given is
 * no longer usable — they are single-use and short-lived, so this happens
 * routinely: a bookmarked link, a back button, a session resumed an hour
 * later. It is not an error state.
 *
 * The handler's whole job is to mint a fresh link and put them back into the
 * flow, so the merchant experiences a brief redirect rather than a dead end.
 * Skipping this is the classic Connect onboarding bug: the merchant hits an
 * expired link, lands nowhere, and never finishes.
 *
 * ── WHY THE `accountId` QUERY PARAMETER IS IGNORED ────────────────────────
 * An earlier version of this file minted a link for whatever `acct_…` the
 * query string named. That was a real account-takeover path, and it is worth
 * spelling out because the same mistake is easy to make in any Connect
 * integration:
 *
 *   - Account ids are NOT secret here. They appear in the public storefront
 *     URL (/store/acct_…), so anyone can read another merchant's id.
 *   - An Account Link is a credential. It opens Stripe-hosted onboarding for
 *     that account, where the holder can enter or alter the business's
 *     identity details and payout bank account.
 *   - Being signed in proves you are *a* user, not that you are *this*
 *     merchant. The middleware only enforces the former.
 *
 * So any signed-in user could have handed themselves onboarding for someone
 * else's account. The fix is not to validate the parameter but to stop
 * consuming it: the link is always minted for the CALLER'S OWN account,
 * looked up server-side from their session. The parameter is now only read
 * to log a mismatch, and it could be dropped entirely.
 *
 * The general rule: an identifier that arrives in a URL is a request, never
 * an authorization. Resolve who the caller is from the session and act on
 * that.
 */
export async function GET(request: NextRequest) {
  // AUTHENTICATE. A route handler gets no automatic session check beyond the
  // middleware's "is anyone signed in", so the identity has to be resolved
  // here before anything is minted.
  const session = await getSessionContext();
  if (!session) {
    const next = encodeURIComponent("/sample-connect");
    return NextResponse.redirect(new URL(`/login?next=${next}`, request.url));
  }

  // AUTHORIZE, by construction: this is the only account this caller can
  // ever get a link for, because it is the one their own row names.
  const accountId = await getSampleAccountId(session.user.id).catch(() => null);
  if (!accountId) {
    // No account yet (or the mapping could not be read) — the dashboard is
    // where onboarding legitimately starts.
    return NextResponse.redirect(new URL("/sample-connect", request.url));
  }

  // Read only to notice something odd. Stripe echoes back the value this app
  // put in `refresh_url`, so a mismatch means either a hand-edited URL or a
  // stale link from a previous account; neither should mint anything.
  const requested = request.nextUrl.searchParams.get("accountId");
  if (requested && requested !== accountId) {
    console.warn(
      `[sample-connect] refresh requested ${requested} but the caller owns ${accountId} — ignoring the parameter and refreshing their own account.`
    );
  }

  try {
    const url = await createSampleAccountLink(accountId);
    return NextResponse.redirect(url);
  } catch (cause) {
    console.error(
      `[sample-connect] couldn't refresh the onboarding link for ${accountId}: ` +
        (cause instanceof Error ? cause.message : "unknown error")
    );
    // Fall back to the dashboard rather than showing a stack trace: it
    // renders the account's live status and offers the button again.
    return NextResponse.redirect(new URL("/sample-connect?refreshFailed=1", request.url));
  }
}

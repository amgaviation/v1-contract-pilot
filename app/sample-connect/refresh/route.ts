import { NextResponse, type NextRequest } from "next/server";
import { createSampleAccountLink } from "@/lib/sample-connect/accounts";

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
 */
export async function GET(request: NextRequest) {
  const accountId = request.nextUrl.searchParams.get("accountId");

  if (!accountId || !accountId.startsWith("acct_")) {
    // No usable account id — send them back to the dashboard, which knows how
    // to start the flow properly.
    return NextResponse.redirect(new URL("/sample-connect", request.url));
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

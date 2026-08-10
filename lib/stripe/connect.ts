import "server-only";
import { getStripe, isLiveMode } from "@/lib/stripe/server";

/**
 * Stripe Connect (Standard) — integration #2 (docs/PLAN.md decision #8),
 * deliberately kept apart from lib/stripe/server.ts's platform-billing
 * client for the same reason that file's header states: Connect calls act
 * ON BEHALF OF a connected account, not on the platform's own behalf, and
 * conflating the two is exactly what the plan says not to do.
 *
 * Every function here reuses `getStripe()` (the platform's own secret
 * key) as the CALLER — that is correct and required for Standard OAuth:
 * the platform authenticates the /oauth/token exchange and the
 * /oauth/deauthorize call with its own key, then every payment-related
 * call is scoped to the connected account with the `stripeAccount` option
 * (the `Stripe-Account` header), never a key belonging to the pilot. We
 * never receive, request, or store a key that belongs to the pilot's own
 * Stripe account — only the `connect_account_id` (`acct_...`) that
 * identifies it.
 *
 * VERIFIED AGAINST CURRENT STRIPE DOCS (2026-08-09), via the Stripe MCP
 * `search_stripe_documentation` tool — not written from memory:
 *   - Standard accounts still use the OAuth flow (`stripe.oauth.token`,
 *     `stripe.oauth.deauthorize`, and the `connect.stripe.com/oauth/*`
 *     endpoints) — internal Stripe TSE notes confirm this predates and
 *     coexists with the newer Account Links / Accounts v2 onboarding
 *     Express/Custom flows, which do NOT apply to Standard.
 *   - "Make API calls for connected accounts" (docs.stripe.com/connect/
 *     authentication): server-side calls for a connected account use the
 *     `Stripe-Account` header — stripe-node exposes this as the
 *     `{ stripeAccount }` request option, which is what every call below
 *     passes for anything scoped to the pilot's account.
 *   - "Create payment links with Connect" (docs.stripe.com/connect/
 *     payment-links): a DIRECT CHARGE payment link is created by first
 *     creating a Product and Price WHILE AUTHENTICATED AS THE CONNECTED
 *     ACCOUNT, then creating the Payment Link the same way — no
 *     `application_fee_amount`, no `on_behalf_of`, no `transfer_data`.
 *     That is exactly what createPaymentLinkForInvoice does below. The
 *     Payment Links create API takes `line_items[].price` (an existing
 *     Price id) — inline `price_data` is not offered on this endpoint the
 *     way it is on Checkout Sessions, hence creating a Price first.
 */

function connectClientId(): string {
  const id = process.env.STRIPE_CONNECT_CLIENT_ID;
  if (!id) {
    throw new Error(
      "STRIPE_CONNECT_CLIENT_ID is unset — Stripe Connect onboarding cannot run. Set it in the Vercel project (and .env.local for development) from the platform's Connect settings (dashboard.stripe.com/settings/connect)."
    );
  }
  return id;
}

/**
 * Builds the URL that starts Standard OAuth. `state` is a random,
 * single-use, server-generated token — never the account id itself —
 * checked against a short-lived cookie by the callback route, so a
 * forged or replayed `state` cannot link Stripe's authorization to the
 * wrong tenant. `redirect_uri` must exactly match what the platform's
 * Connect settings allow, both in test and live mode.
 */
export function buildConnectAuthorizeUrl(params: {
  state: string;
  redirectUri: string;
}): string {
  const url = new URL("https://connect.stripe.com/oauth/authorize");
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", connectClientId());
  // read_write, not read_only: Standard onboarding needs to be able to
  // create the account if it doesn't already exist server-side, and
  // read_write is what Stripe's own Standard OAuth guide specifies.
  url.searchParams.set("scope", "read_write");
  url.searchParams.set("redirect_uri", params.redirectUri);
  url.searchParams.set("state", params.state);
  return url.toString();
}

export type ConnectExchangeResult = {
  connectAccountId: string;
  livemode: boolean;
};

/**
 * Exchanges the OAuth `code` Stripe just redirected back with for the
 * connected account id. This is the ONLY place the app ever calls
 * `stripe.oauth.token` — it returns `stripe_user_id` (the `acct_...` id)
 * and nothing about the pilot's own secret keys; Standard's OAuth grant
 * does not hand the platform the connected account's API key at all.
 */
export async function exchangeConnectCode(code: string): Promise<ConnectExchangeResult> {
  const stripe = getStripe();
  const response = await stripe.oauth.token({
    grant_type: "authorization_code",
    code,
  });
  const connectAccountId = response.stripe_user_id;
  if (!connectAccountId) {
    throw new Error("Stripe OAuth exchange returned no connected account id.");
  }
  // The OAuthToken object DOES carry its own `livemode` (stripe-node's
  // OAuth.d.ts: "Depends on the mode of the secret API key used to make
  // the request"), so this is Stripe's own authoritative statement of
  // which mode the grant is in — not merely inferred from our key, though
  // the two must always agree since a test-mode platform key can only
  // ever complete a test-mode OAuth grant. Falling back to isLiveMode()
  // only if the field is ever absent from a future API version.
  const livemode = response.livemode ?? isLiveMode();
  if (livemode !== isLiveMode()) {
    throw new Error(
      `Stripe OAuth grant livemode (${livemode}) does not match this deployment's key mode (${isLiveMode()}) — refusing to link.`
    );
  }
  return { connectAccountId, livemode };
}

export type DeauthorizeResult = {
  /** True when the grant is definitely gone on Stripe's side. */
  revoked: boolean;
  /** True when Stripe says there was no grant to revoke in the first place. */
  alreadyRevoked: boolean;
};

/**
 * Revokes the platform's OAuth grant on the connected account
 * (`stripe.oauth.deauthorize`).
 *
 * WHY THIS RETURNS A RESULT INSTEAD OF SWALLOWING FAILURES (fixed after
 * review): the previous version caught every error, logged it, and
 * returned void — so the caller cleared connect_account_id and told the
 * pilot "Stripe disconnected" whether or not the grant still existed. A
 * pilot who reads that and moves on has been told something we do not
 * know to be true, about the one thing disconnecting is FOR. Clearing
 * locally regardless is still correct — the pilot asked to disconnect and
 * the app must stop offering to act for that account — but the pilot has
 * to be told when the Stripe side is unconfirmed so they can finish the
 * job in their own dashboard.
 *
 * `invalid_grant` is not a failure: Stripe raises it when the grant does
 * not exist, which happens when the pilot already revoked access from
 * their own dashboard. That is the desired end state, so it reports as
 * revoked (with alreadyRevoked set) rather than as an error the pilot
 * needs to act on. Every other error rethrows to the caller, which
 * decides what to tell the pilot.
 */
export async function deauthorizeConnectAccount(
  connectAccountId: string
): Promise<DeauthorizeResult> {
  const stripe = getStripe();
  try {
    await stripe.oauth.deauthorize({
      client_id: connectClientId(),
      stripe_user_id: connectAccountId,
    });
    return { revoked: true, alreadyRevoked: false };
  } catch (err) {
    // `rawType` is the wire value Stripe sent ("invalid_grant"), not a
    // stripe-node class name — the durable thing to match on.
    const rawType = (err as { rawType?: string }).rawType;
    if (rawType === "invalid_grant") {
      return { revoked: true, alreadyRevoked: true };
    }
    throw err;
  }
}

export type CreatePaymentLinkResult = {
  id: string;
  url: string;
  livemode: boolean;
};

/**
 * Creates a Stripe Payment Link for one invoice's outstanding balance, as
 * a DIRECT CHARGE on the pilot's own connected account:
 *   - Product + Price + Payment Link are all created WITH
 *     `{ stripeAccount: connectAccountId }` — every object lives on the
 *     pilot's account, not the platform's.
 *   - No `application_fee_amount` is passed anywhere in this function.
 *     Grep for that string in this file: it must never appear. That is
 *     the whole of decision #8's "no application fee" requirement, made
 *     mechanical rather than a promise in a comment.
 *   - No `on_behalf_of` / `transfer_data` — those shapes make the
 *     PLATFORM the merchant of record or the settlement party, which
 *     decision #8 explicitly rules out ("the pilot is the merchant of
 *     record").
 *
 * SINGLE USE, ENFORCED BY STRIPE (added after review). A Payment Link is
 * reusable by default — it is built for "sell this thing to anyone, over
 * and over", which is the opposite of an invoice. Left as-is, a client
 * who bookmarks the link, or forwards the email to accounts payable a
 * second time, pays the same invoice twice, and the pilot finds out by
 * reconciling their Stripe balance against invoices that only ever needed
 * one payment. `restrictions.completed_sessions.limit = 1` makes Stripe
 * deactivate the link after one completed Checkout Session; a second
 * visitor sees Stripe's own "this link is no longer active" page rather
 * than a payment form. Verified against the current API via the Stripe
 * MCP docs tool (2026-08-10) and against the installed SDK's own types
 * (stripe@22.4.0, PaymentLinkCreateParams.Restrictions.CompletedSessions)
 * — not written from memory.
 *
 * That covers the double-payment case. It does NOT cover the stale-amount
 * case (a link created for a $5,000 balance that a $2,000 cheque has
 * since reduced) — the link is still live and still charges $5,000. That
 * is handled where the balance actually changes: recordPayment and
 * voidInvoice call deactivatePaymentLink below and clear the stored
 * columns, so a link never outlives the balance it was priced against.
 */
export async function createPaymentLinkForInvoice(params: {
  connectAccountId: string;
  invoiceNumber: string;
  amountCents: number;
}): Promise<CreatePaymentLinkResult> {
  const stripe = getStripe();
  const stripeAccount = params.connectAccountId;

  const price = await stripe.prices.create(
    {
      currency: "usd",
      unit_amount: params.amountCents,
      product_data: { name: `Invoice ${params.invoiceNumber}` },
    },
    { stripeAccount }
  );

  const link = await stripe.paymentLinks.create(
    {
      line_items: [{ price: price.id, quantity: 1 }],
      // No application_fee_amount. No on_behalf_of. No transfer_data.
      restrictions: { completed_sessions: { limit: 1 } },
      metadata: { invoice_number: params.invoiceNumber },
    },
    { stripeAccount }
  );

  return { id: link.id, url: link.url, livemode: isLiveMode() };
}

export type DeactivateLinkResult = {
  /** True when the link is definitely not payable any more. */
  deactivated: boolean;
  /** True when Stripe says the link no longer exists at all. */
  alreadyGone: boolean;
};

/**
 * Turns a Payment Link off (`active: false`), on the pilot's own connected
 * account. Stripe then serves its "no longer active" page instead of a
 * payment form.
 *
 * This is the other half of the stale-link problem: the app clears its own
 * three columns whenever an invoice's balance changes or it is voided, but
 * clearing a row here does nothing to a URL a client already has in their
 * inbox. The only thing that stops that URL taking money is this call.
 * Callers therefore deactivate FIRST and clear second, and tell the pilot
 * when the deactivation could not be confirmed — the same honesty rule as
 * deauthorizeConnectAccount above.
 *
 * `resource_missing` counts as success: the link is gone (deleted from the
 * dashboard, or the account disconnected), which is the end state asked
 * for.
 */
export async function deactivatePaymentLink(params: {
  connectAccountId: string;
  paymentLinkId: string;
}): Promise<DeactivateLinkResult> {
  const stripe = getStripe();
  try {
    await stripe.paymentLinks.update(
      params.paymentLinkId,
      { active: false },
      { stripeAccount: params.connectAccountId }
    );
    return { deactivated: true, alreadyGone: false };
  } catch (err) {
    if ((err as { code?: string }).code === "resource_missing") {
      return { deactivated: true, alreadyGone: true };
    }
    throw err;
  }
}

/**
 * The wording every caller uses when a Stripe-side deactivation could not
 * be confirmed. One string, because the pilot needs the same instruction
 * (go finish it in your own dashboard) regardless of which action they
 * were taking, and because a sentence this consequential should not be
 * re-improvised at three call sites.
 */
export const LINK_STILL_LIVE_WARNING =
  "We couldn't confirm with Stripe that the old payment link was switched off. It may still accept a card payment — deactivate it under Payment Links in your Stripe Dashboard.";

// A `currentUserId()` helper used to live here, documented as being "for
// the OAuth `state` cookie/session check". Nothing ever imported it — the
// callback route reads the session directly — and the check it claimed to
// serve is now done in the database by pilot.connect_account_link. Removed
// rather than left as a comment describing a job no code does.

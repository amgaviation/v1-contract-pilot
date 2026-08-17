import "server-only";
import { getStripe, isLiveMode } from "@/lib/stripe/server";
import { CARD_METHOD, type AchCapability } from "@/lib/stripe/payment-methods";

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
      "STRIPE_CONNECT_CLIENT_ID is unset. Stripe Connect onboarding cannot run. Set it in the Vercel project (and .env.local for development) from the platform's Connect settings (dashboard.stripe.com/settings/connect)."
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
      `Stripe OAuth grant livemode (${livemode}) does not match this deployment's key mode (${isLiveMode()}). Refusing to link.`
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

/**
 * Reads whether the PILOT'S OWN connected account may take ACH debits.
 *
 * WHY THIS EXISTS AT ALL, and why it is the first capability read in the
 * product. Stripe's ACH docs are explicit that
 * `us_bank_account_ach_payments` must be `active` on each connected account
 * you want to enable — the platform enabling it for itself is not enough.
 * Nothing in this codebase read a capability before today, so a link asking
 * for `us_bank_account` on an account that has not been granted it would
 * have failed at `paymentLinks.create` and the pilot would have seen
 * "Couldn't create a Stripe payment link. Try again." for a condition no
 * amount of trying fixes. A read is one round trip and turns that into a
 * sentence naming the actual problem.
 *
 * NEVER THROWS, and that is the point of the 'unknown' value. A capability
 * read failing must not stop a pilot generating a payment link — the
 * invoice still needs collecting. lib/stripe/payment-methods.ts treats
 * 'unknown' as "do not offer ACH, and say why", so the failure costs the
 * cheaper payment method and never the payment.
 *
 * `accounts.retrieve` is called with the PLATFORM's key and the connected
 * account id as its argument — this is a platform reading one of its own
 * connected accounts, not a call made AS that account, so there is
 * deliberately no `{ stripeAccount }` option here. That is the one call in
 * this file scoped that way, and it is why it says so.
 */
export async function readAchCapability(connectAccountId: string): Promise<AchCapability> {
  try {
    const account = await getStripe().accounts.retrieve(connectAccountId);
    const status = account.capabilities?.us_bank_account_ach_payments;
    // A capability that has never been requested is ABSENT from the object
    // rather than 'inactive'. Both mean the same thing to a payment link,
    // so both answer 'inactive' — 'unknown' is reserved for "we could not
    // ask", which is a different problem with a different sentence.
    if (status === "active" || status === "pending" || status === "inactive") {
      return status;
    }
    return "inactive";
  } catch (err) {
    console.error(
      `accounts.retrieve(${connectAccountId}) for the ACH capability failed: ${
        err instanceof Error ? err.message : "unknown error"
      }`
    );
    return "unknown";
  }
}

/**
 * True when Stripe REJECTED the request outright — a 400-class
 * invalid_request_error, which means no Payment Link was created and
 * retrying with a narrower `payment_method_types` is safe.
 *
 * THE NARROW TEST IS THE WHOLE VALUE HERE. A network failure or a 500 may
 * have created the link on Stripe's side before the response was lost, and
 * retrying THAT would leave the invoice with two live links at the same
 * price — the exact state createInvoicePaymentLink's "kill the old one
 * first" ordering exists to prevent. So the retry is gated on Stripe having
 * said no, not merely on something having gone wrong.
 *
 * LABELLED ASSUMPTION, because it is one: the precise error a payment link
 * comes back with when `us_bank_account` is asked for on an account whose
 * capability is inactive has NOT been observed against a real test-mode
 * account here — the capability pre-check above is what normally prevents
 * ever sending that request. This is the belt to that check's braces, and
 * it is deliberately shaped to be harmless if the guess is wrong: it only
 * ever converts one refused request into one card-only request.
 */
export function isStripeRequestRejection(err: unknown): boolean {
  // `unknown` is the honest parameter type, so the null case is real: `throw
  // null` and `throw undefined` are legal JS, and a property read on either
  // throws a TypeError from INSIDE the catch block that called this — which
  // would replace the caller's "couldn't create a payment link, try again"
  // with an unhandled server-action error. Stripe's SDK throws Error objects
  // today; this function is the designated place not to depend on that.
  if (typeof err !== "object" || err === null) return false;
  const type = (err as { type?: string }).type;
  const rawType = (err as { rawType?: string }).rawType;
  return type === "StripeInvalidRequestError" || rawType === "invalid_request_error";
}

export type CreatePaymentLinkResult = {
  id: string;
  url: string;
  livemode: boolean;
  /** Exactly what Stripe was told to offer. Echoed back for the caller's copy. */
  paymentMethodTypes: readonly string[];
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
 *
 * METADATA IS WHAT MAKES THE PAYMENT FINDABLE AGAIN (20260813100000).
 * Stripe copies a Payment Link's metadata onto every Checkout Session the
 * link spawns, and that Session is what
 * app/api/stripe/connect-webhook/route.ts receives — so these three keys
 * are the only durable handle from "someone paid" back to "this invoice".
 * The Session also carries `payment_link` (the plink_... id), and the
 * invoice does store one, but that column is CLEARED whenever a link is
 * retired, regenerated or the account is disconnected; metadata travels
 * with the payment and cannot be cleared. `invoice_id` and `account_id`
 * are the row ids, not the invoice NUMBER — numbers are per-tenant and
 * two pilots' invoice 0001 are different documents.
 *
 * These keys are visible to, and editable by, the pilot in their own
 * Stripe dashboard: the link lives on THEIR account. That is exactly why
 * the webhook treats them as untrusted and derives tenancy from
 * event.account instead — see resolveAutoPayment in
 * lib/stripe/connect-payments.ts. Metadata says WHICH invoice; Stripe's
 * signature says WHOSE.
 *
 * METHODS ARE STATED, NOT LEFT TO THE ACCOUNT'S DASHBOARD (2026-08-13).
 * Omitting `payment_method_types` entirely is a legitimate alternative —
 * Stripe then offers whatever the CONNECTED account has switched on in its
 * own dashboard settings — and it was rejected on purpose: it puts the
 * decision somewhere this product cannot read, so neither the Settings
 * panel nor the invoice screen could ever say what a link actually offers,
 * and a per-invoice choice would be impossible. Naming the methods also
 * suppresses Stripe's Link "Instant Bank Payments", which sounds like what
 * is wanted here and is not: its default ceiling is well under the
 * five-figure invoices this feature exists for, so a large invoice would
 * silently get no bank option at all. An explicit `us_bank_account` is real
 * ACH Direct Debit with no such ceiling. (docs.stripe.com/payments/link/
 * instant-bank-payments, checked 2026-08-13.)
 *
 * THE CALLER DECIDES WHICH METHODS, not this function: the choice is a
 * pilot preference crossed with the connected account's ACH capability, and
 * that crossing is a pure decision with its own module and its own tests
 * (lib/stripe/payment-methods.ts). This function does the I/O.
 */
export async function createPaymentLinkForInvoice(params: {
  connectAccountId: string;
  /** The tenant that owns the invoice. Written into the link's metadata. */
  accountId: string;
  /** The invoice ROW's id — the only globally unique handle it has. */
  invoiceId: string;
  invoiceNumber: string;
  amountCents: number;
  /**
   * Stripe `payment_method_types` — from resolveOfferedMethods, never
   * hand-built at a call site. Defaults to card alone so that a caller
   * added later cannot accidentally mint a link offering nothing.
   */
  paymentMethodTypes?: readonly string[];
}): Promise<CreatePaymentLinkResult> {
  const stripe = getStripe();
  const stripeAccount = params.connectAccountId;
  const paymentMethodTypes =
    params.paymentMethodTypes && params.paymentMethodTypes.length > 0
      ? [...params.paymentMethodTypes]
      : [CARD_METHOD];

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
      payment_method_types: paymentMethodTypes,
      // SINGLE USE STILL, AND ACH MAKES THE TIMING WORTH RE-STATING.
      // Stripe deactivates the link when a Checkout Session COMPLETES —
      // which for a bank debit is when the client accepts the mandate,
      // days before the money settles. That is the behaviour wanted (it
      // blocks a second debit for the same invoice during the wait), but
      // it means a link can be spent while the invoice is still unpaid.
      // The pending notice on the invoice screen exists to say so, and a
      // FAILED debit leaves the invoice needing a NEW link — the webhook
      // clears the stored one for exactly that reason.
      restrictions: { completed_sessions: { limit: 1 } },
      metadata: {
        invoice_id: params.invoiceId,
        account_id: params.accountId,
        // Kept, and kept LAST: it is the human-readable one, it is what a
        // pilot recognises in their Stripe dashboard, and links minted
        // before the two ids above carry only this. The webhook degrades
        // to "ignored, record it by hand" for those rather than failing.
        invoice_number: params.invoiceNumber,
      },
    },
    { stripeAccount }
  );

  return {
    id: link.id,
    url: link.url,
    livemode: isLiveMode(),
    paymentMethodTypes,
  };
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

/* ===========================================================================
 * AUTOPAY — a client's saved payment method, charged off-session.
 *
 * Same posture as every payment call above: DIRECT operations on the
 * pilot's own connected account via `{ stripeAccount }`, no application
 * fee, no on_behalf_of, no transfer_data. The platform never holds the
 * money and never holds a key.
 *
 * VERIFIED AGAINST CURRENT STRIPE DOCS (2026-08-17):
 *   - Checkout Sessions in `mode: 'setup'` collect a payment method
 *     without charging, producing a SetupIntent whose default usage is
 *     'off_session' — exactly the mandate an autopay charge needs
 *     (docs.stripe.com/payments/save-and-reuse).
 *   - An off-session charge is `paymentIntents.create` with `customer`,
 *     `payment_method`, `off_session: true`, `confirm: true`. A decline or
 *     an authentication_required challenge surfaces as a thrown
 *     StripeCardError carrying `code`/`decline_code`
 *     (docs.stripe.com/payments/save-during-payment#charge-saved-payment-method).
 * =========================================================================== */

export type AutopaySetupSession = {
  /** Where to send the client's browser. */
  url: string;
  /** The (possibly just-created) Customer the method will attach to. */
  customerId: string;
};

/**
 * Mints the Checkout session (mode `setup`) through which a client saves a
 * card for autopay, on the pilot's connected account.
 *
 * CARD ONLY, deliberately. An off-session ACH debit needs its own mandate
 * language and carries a 60-day dispute window (see connect-payments.ts's
 * header) — a strictly larger consent than "charge my card". Card is what
 * the QuickBooks-shaped feature means, and it is what ships first.
 *
 * Metadata mirrors the payment-link contract: it says WHICH client;
 * Stripe's signed event.account says WHOSE. The webhook re-checks both.
 */
export async function createAutopaySetupSession(params: {
  connectAccountId: string;
  accountId: string;
  clientId: string;
  clientName: string;
  /** Reuse the client's existing Customer when re-consenting (card swap). */
  existingCustomerId: string | null;
  /** Absolute URL of the vendor page to return to, without query. */
  returnUrl: string;
}): Promise<AutopaySetupSession> {
  const stripe = getStripe();
  const stripeAccount = params.connectAccountId;

  let customerId = params.existingCustomerId;
  if (!customerId) {
    const customer = await stripe.customers.create(
      {
        name: params.clientName,
        metadata: { account_id: params.accountId, client_id: params.clientId },
      },
      { stripeAccount }
    );
    customerId = customer.id;
  }

  const session = await stripe.checkout.sessions.create(
    {
      mode: "setup",
      customer: customerId,
      payment_method_types: [CARD_METHOD],
      success_url: `${params.returnUrl}?autopay=saved`,
      cancel_url: params.returnUrl,
      metadata: {
        autopay_setup: "1",
        account_id: params.accountId,
        client_id: params.clientId,
      },
    },
    { stripeAccount }
  );

  if (!session.url) {
    // A setup session with no URL cannot be completed by anyone; treat the
    // absent confirmation as a failure rather than redirecting to nowhere.
    throw new Error("Stripe returned a setup session with no URL.");
  }
  return { url: session.url, customerId };
}

export type SavedAutopayMethod = {
  customerId: string;
  paymentMethodId: string;
  /** "Visa •••• 4242" — derived once, stored, never re-fetched to render. */
  label: string;
};

/**
 * Reads the saved method off a completed setup session's SetupIntent.
 * Called by the Connect webhook only. Returns null when the SetupIntent
 * has not actually succeeded — a canceled or still-processing setup must
 * not enroll anyone.
 */
export async function readAutopaySetupResult(params: {
  connectAccountId: string;
  setupIntentId: string;
}): Promise<SavedAutopayMethod | null> {
  const stripe = getStripe();
  const intent = await stripe.setupIntents.retrieve(
    params.setupIntentId,
    { expand: ["payment_method"] },
    { stripeAccount: params.connectAccountId }
  );
  if (intent.status !== "succeeded") return null;

  const method = intent.payment_method;
  if (!method || typeof method === "string") return null;
  const customerId =
    typeof intent.customer === "string" ? intent.customer : intent.customer?.id;
  if (!customerId) return null;

  const card = method.card;
  const brand = card?.brand
    ? card.brand.charAt(0).toUpperCase() + card.brand.slice(1)
    : "Card";
  const label = card?.last4 ? `${brand} •••• ${card.last4}` : brand;

  return { customerId, paymentMethodId: method.id, label };
}

export type AutopayChargeResult =
  | { ok: true; paymentIntentId: string }
  | {
      ok: false;
      /** A sentence for the pilot. Never Stripe's raw internals. */
      reason: string;
    };

/**
 * Charges a client's saved method for one invoice, off-session, as a
 * direct charge on the pilot's connected account.
 *
 * THE LEDGER IS NOT WRITTEN HERE. The Connect webhook records the payment
 * from `payment_intent.succeeded` — one writer for every Stripe-recorded
 * row, deduped by the payment-intent unique index, exactly as link
 * payments work. This function only moves the money and reports whether
 * Stripe took the charge.
 *
 * Failure is a RETURN, not a throw: a declined card mid-generation must
 * not abort the rest of a due queue, and the caller has to surface the
 * sentence either way.
 */
export async function chargeAutopayInvoice(params: {
  connectAccountId: string;
  accountId: string;
  invoiceId: string;
  invoiceNumber: string;
  amountCents: number;
  customerId: string;
  paymentMethodId: string;
}): Promise<AutopayChargeResult> {
  const stripe = getStripe();
  try {
    const intent = await stripe.paymentIntents.create(
      {
        amount: params.amountCents,
        currency: "usd",
        customer: params.customerId,
        payment_method: params.paymentMethodId,
        off_session: true,
        confirm: true,
        description: `Invoice ${params.invoiceNumber} (autopay)`,
        metadata: {
          // The autopay flag is what the webhook's intent reader gates on:
          // payment-link charges also produce PaymentIntents, and those
          // must keep flowing through the Checkout Session events alone.
          autopay: "1",
          invoice_id: params.invoiceId,
          account_id: params.accountId,
          invoice_number: params.invoiceNumber,
        },
      },
      { stripeAccount: params.connectAccountId }
    );
    if (intent.status === "succeeded" || intent.status === "processing") {
      return { ok: true, paymentIntentId: intent.id };
    }
    return {
      ok: false,
      reason: `Stripe did not complete the charge (status ${intent.status}). Send the invoice with a payment link instead.`,
    };
  } catch (err) {
    const stripeErr = err as {
      code?: string;
      decline_code?: string;
      message?: string;
    };
    if (stripeErr.code === "authentication_required") {
      return {
        ok: false,
        reason:
          "The client's bank requires them to authenticate this charge, which an automatic charge cannot do. Send the invoice with a payment link so they can pay it themselves, and ask them to re-save their card from your vendor page.",
      };
    }
    if (stripeErr.code === "card_declined" || stripeErr.decline_code) {
      return {
        ok: false,
        reason: `The saved card was declined (${stripeErr.decline_code ?? "no reason given"}). Send the invoice with a payment link instead, and ask the client to update their card.`,
      };
    }
    return {
      ok: false,
      reason:
        "The charge couldn't be made. Send the invoice with a payment link instead.",
    };
  }
}

/**
 * Detaches a saved autopay method when autopay is turned off. Best-effort:
 * `resource_missing` means it is already gone (card deleted from the
 * pilot's dashboard, account disconnected), which is the end state asked
 * for — same rule as deactivatePaymentLink.
 */
export async function detachAutopayMethod(params: {
  connectAccountId: string;
  paymentMethodId: string;
}): Promise<void> {
  const stripe = getStripe();
  try {
    await stripe.paymentMethods.detach(params.paymentMethodId, undefined, {
      stripeAccount: params.connectAccountId,
    });
  } catch (err) {
    if ((err as { code?: string }).code === "resource_missing") return;
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
  "We couldn't confirm with Stripe that the old payment link was switched off. It may still accept a card payment. Deactivate it under Payment Links in your Stripe Dashboard.";

// A `currentUserId()` helper used to live here, documented as being "for
// the OAuth `state` cookie/session check". Nothing ever imported it — the
// callback route reads the session directly — and the check it claimed to
// serve is now done in the database by pilot.connect_account_link. Removed
// rather than left as a comment describing a job no code does.

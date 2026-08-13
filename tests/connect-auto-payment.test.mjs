import test from "node:test";
import assert from "node:assert/strict";

const {
  ASYNC_FAILURE_EVENT_TYPE,
  AUTO_PAYMENT_EVENT_TYPES,
  CONNECT_ENDPOINT_EVENT_TYPES,
  MANUAL_MATCH_WINDOW_DAYS,
  daysBetweenIsoDates,
  formatCentsPlain,
  isoDateFromUnixSeconds,
  manualMatchFloorCents,
  nextInvoiceStatus,
  offersBankDebit,
  paymentMethodFromSession,
  readConnectPaymentEvent,
  resolveAutoPayment,
} = await import("../lib/stripe/connect-payments.ts");

/**
 * The event-to-payment mapping for Stripe Connect payment links.
 *
 * WHAT THESE TESTS ARE FOR, and what they cannot be for. Everything here
 * is the DECISION layer: given a signed Stripe delivery and the rows the
 * database currently holds, does a payment get written, and which one. The
 * database's own contract — that `source` and `stripe_payment_intent_id`
 * are ungrantable to a tenant, that the unique index really does refuse a
 * second row for one PaymentIntent, that RLS scopes the events ledger —
 * belongs in scripts/connect-verify.mjs against real Postgres, and a
 * passing file here is not evidence of any of it (tests/README.md).
 *
 * The four cases that would cost a pilot real money, each pinned below:
 *
 *   FORGERY   metadata is typed by whoever owns the connected Stripe
 *             account. If tenancy came from it, any pilot could mint a
 *             link naming another tenant's invoice and mark it paid.
 *   REPLAY    Stripe retries for three days, and this handler deliberately
 *             leaves a half-finished event retryable. Without the
 *             payment-intent check that is a second credit.
 *   ALREADY   the pilot saw it in their Stripe dashboard on Friday and
 *   RECORDED  typed it in. The webhook must not add it again.
 *   STALE     a link that outlived the invoice (void) or the balance
 *   LINK      (already paid) must not put money on the ledger, because the
 *             triggers wave service_role straight through and will not
 *             refuse it.
 */

const ACCOUNT_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_ACCOUNT_ID = "22222222-2222-4222-8222-222222222222";
const INVOICE_ID = "33333333-3333-4333-8333-333333333333";
const CONNECT_ID = "acct_pilot";
// 2026-08-13T12:00:00Z
const EVENT_CREATED = 1786622400;

function event(overrides = {}, sessionOverrides = {}) {
  return {
    eventId: "evt_1",
    eventType: "checkout.session.completed",
    eventAccount: CONNECT_ID,
    eventCreated: EVENT_CREATED,
    livemode: false,
    ...overrides,
    session: {
      id: "cs_1",
      paymentStatus: "paid",
      amountTotal: 450000,
      currency: "usd",
      paymentIntentId: "pi_1",
      paymentLinkId: "plink_1",
      paymentMethodTypes: ["card"],
      metadata: {
        invoice_id: INVOICE_ID,
        account_id: ACCOUNT_ID,
        invoice_number: "2026-0007",
      },
      ...sessionOverrides,
    },
  };
}

function claimFrom(built) {
  const read = readConnectPaymentEvent(built);
  assert.equal(read.kind, "claim", `expected a claim, got ${read.kind}: ${read.detail ?? ""}`);
  return read.claim;
}

const account = { id: ACCOUNT_ID, connect_account_id: CONNECT_ID };
const sentInvoice = {
  id: INVOICE_ID,
  account_id: ACCOUNT_ID,
  status: "sent",
  stripe_payment_link_id: "plink_1",
};

function resolve(overrides = {}) {
  return resolveAutoPayment({
    claim: claimFrom(event()),
    account,
    invoice: sentInvoice,
    ledger: [],
    ...overrides,
  });
}

/** A standing, hand-typed payment row. */
function manual(overrides = {}) {
  return {
    id: "pay_manual",
    amount_cents: 450000,
    paid_on: "2026-08-13",
    source: "manual",
    stripe_payment_intent_id: null,
    reverses_payment_id: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Reading the delivery
// ---------------------------------------------------------------------------

test("a paid card session on a metadata-carrying link becomes a claim", () => {
  const claim = claimFrom(event());
  assert.equal(claim.declaredInvoiceId, INVOICE_ID);
  assert.equal(claim.declaredAccountId, ACCOUNT_ID);
  assert.equal(claim.paymentIntentId, "pi_1");
  assert.equal(claim.amountCents, 450000);
  assert.equal(claim.method, "card");
  // The EVENT's date, not "today": a delivery Stripe retries on Saturday
  // must still date the payment the day the client actually paid.
  assert.equal(claim.paidOn, "2026-08-13");
});

test("both paid-session event types are handled, and nothing else is", () => {
  assert.deepEqual([...AUTO_PAYMENT_EVENT_TYPES], [
    "checkout.session.completed",
    "checkout.session.async_payment_succeeded",
  ]);
  const async_ = readConnectPaymentEvent(
    event({ eventType: "checkout.session.async_payment_succeeded" })
  );
  assert.equal(async_.kind, "claim");
  const expired = readConnectPaymentEvent(event({ eventType: "checkout.session.expired" }));
  assert.equal(expired.kind, "ignored");
});

test("an unpaid session is ignored — ACH completes before the money moves", () => {
  // The whole reason async_payment_succeeded is subscribed to. If this
  // returned a claim, a pilot with ACH enabled on their connected account
  // would see invoices marked paid from bank debits that can still fail.
  const read = readConnectPaymentEvent(event({}, { paymentStatus: "unpaid" }));
  assert.equal(read.kind, "ignored");
  assert.match(read.detail, /not paid yet/);
});

test("a link minted before this feature is ignored, not failed", () => {
  // BACKWARD COMPATIBILITY. Every link created before 20260813100000
  // carries only invoice_number, which is per-tenant and identifies
  // nothing. Those payments still get recorded by hand, exactly as they
  // always were — the endpoint must degrade, not throw.
  const read = readConnectPaymentEvent(
    event({}, { metadata: { invoice_number: "2026-0007" } })
  );
  assert.equal(read.kind, "ignored");
  assert.match(read.detail, /2026-0007/);
  assert.match(read.detail, /by hand/);
});

test("a platform-scope delivery is refused — there is no tenancy fact in it", () => {
  const read = readConnectPaymentEvent(event({ eventAccount: null }));
  assert.equal(read.kind, "refused");
  assert.match(read.detail, /event\.account/);
});

test("metadata that is not a uuid is refused here, not handed to Postgres", () => {
  // Otherwise it becomes a 22P02 the route reports as a handler failure and
  // Stripe retries for three days over a string a connected account typed.
  const read = readConnectPaymentEvent(
    event({}, { metadata: { invoice_id: "'; drop--", account_id: ACCOUNT_ID } })
  );
  assert.equal(read.kind, "refused");
  assert.match(read.detail, /not a uuid/);
});

test("a session with no payment_intent is refused rather than recorded blind", () => {
  // The intent id is the only thing that makes a retry safe. Recording
  // without one trades a visible missing row for an invisible double
  // credit, which is the wrong way round.
  const read = readConnectPaymentEvent(event({}, { paymentIntentId: null }));
  assert.equal(read.kind, "refused");
  assert.match(read.detail, /duplicate/);
});

test("a non-USD session is refused — the ledger has no currency column", () => {
  const read = readConnectPaymentEvent(event({}, { currency: "gbp" }));
  assert.equal(read.kind, "refused");
  assert.match(read.detail, /USD/);
});

test("a stage-one refusal still says which invoice it was about", () => {
  // THE ROW HAS TO BE VISIBLE TO SOMEBODY. These two refusals are real
  // money that this product then did not record — the most consequential
  // rows the ledger holds — and the route uses `declared` to resolve
  // account_id and invoice_id before writing them. Without it the row was
  // written with a null account_id, which this table's SELECT policy makes
  // invisible to every tenant on earth.
  for (const overrides of [{ currency: "gbp" }, { paymentIntentId: null }]) {
    const read = readConnectPaymentEvent(event({}, overrides));
    assert.equal(read.kind, "refused");
    assert.deepEqual(read.declared, {
      declaredAccountId: ACCOUNT_ID,
      declaredInvoiceId: INVOICE_ID,
    });
  }
});

test("a refusal that has no trustworthy invoice id carries no scope", () => {
  // Nothing before the uuid check can be attributed: the string is not an
  // invoice id, and handing it to Postgres is the 22P02 the check exists
  // to prevent.
  const read = readConnectPaymentEvent(
    event({}, { metadata: { invoice_id: "'; drop--", account_id: ACCOUNT_ID } })
  );
  assert.equal(read.kind, "refused");
  assert.equal(read.declared, undefined);
});

test("a checkout with no invoice metadata does not claim to know what it was", () => {
  // This endpoint listens on the connected-accounts scope, so it receives
  // EVERY Checkout Session on the pilot's own Stripe account — including
  // sales from a business of theirs that has nothing to do with this
  // product. Saying "its payment link predates automatic recording" about
  // one of those is a statement the handler cannot support.
  const unrelated = readConnectPaymentEvent(event({}, { metadata: {} }));
  assert.equal(unrelated.kind, "ignored");
  assert.match(unrelated.detail, /nothing to do with this product/);
  // When an invoice NUMBER is there, it was ours and the old sentence is
  // true, so it is kept.
  const ours = readConnectPaymentEvent(event({}, { metadata: { invoice_number: "2026-0007" } }));
  assert.match(ours.detail, /predates automatic recording/);
});

test("method is claimed only when everything offered means the same thing", () => {
  // payment_method_types says what was OFFERED, not what was used. A wire
  // or an ACH debit labelled "Card" is a lie in the column a pilot
  // reconciles against their bank.
  assert.equal(paymentMethodFromSession(["card"]), "card");
  assert.equal(paymentMethodFromSession(["link"]), "card");
  assert.equal(paymentMethodFromSession(["us_bank_account"]), "ach");
  assert.equal(paymentMethodFromSession(["card", "us_bank_account"]), "other");
  assert.equal(paymentMethodFromSession([]), null);
  assert.equal(paymentMethodFromSession(null), null);
  // THE ORDINARY CONNECTED ACCOUNT. Stripe's Link wallet is on by default
  // beside card, so ['card','link'] is the common shape — counting the
  // array instead of mapping it labelled almost every auto-recorded
  // payment "Other", which made the one column a pilot reconciles against
  // their bank useless on exactly the rows this feature adds.
  assert.equal(paymentMethodFromSession(["card", "link"]), "card");
  assert.equal(paymentMethodFromSession(["us_bank_account", "acss_debit"]), "ach");
});

test("money reads the same wherever it is written", () => {
  // One formatter, exported, because the route writes pilot-facing
  // sentences too (the overpaid notice) and two copies is how "$4500.5"
  // ends up on one screen and "$4,500.50" on another.
  assert.equal(formatCentsPlain(450000), "$4,500.00");
  assert.equal(formatCentsPlain(5), "$0.05");
  assert.equal(formatCentsPlain(-120050), "-$1,200.50");
});

// ---------------------------------------------------------------------------
// FORGERY — tenancy comes from Stripe's signature, never from metadata
// ---------------------------------------------------------------------------

test("metadata naming another tenant's account is refused", () => {
  // The attack this exists for: the owner of a connected Stripe account can
  // type any metadata they like on their own payment links. If account_id
  // were trusted, one pilot could mark another pilot's invoice paid.
  const claim = claimFrom(event({}, { metadata: { invoice_id: INVOICE_ID, account_id: OTHER_ACCOUNT_ID } }));
  const decision = resolveAutoPayment({
    claim,
    account,
    invoice: sentInvoice,
    ledger: [],
  });
  assert.equal(decision.kind, "refused");
  assert.match(decision.detail, /different tenant/);
});

test("an invoice belonging to another tenant is refused even when account_id matches", () => {
  // NOT redundant with the test above. Metadata is one blob: an attacker
  // who can type their own account_id can type someone else's invoice_id
  // beside it. Only the invoice ROW's own account_id settles ownership.
  const decision = resolve({
    invoice: { ...sentInvoice, account_id: OTHER_ACCOUNT_ID },
  });
  assert.equal(decision.kind, "refused");
  assert.match(decision.logDetail, /different tenant/);
});

test("an unknown connected account is refused, not guessed at", () => {
  const decision = resolve({ account: null });
  assert.equal(decision.kind, "refused");
  assert.match(decision.detail, /No tenant is linked/);
});

test("an invoice that does not exist is refused", () => {
  const decision = resolve({ invoice: null });
  assert.equal(decision.kind, "refused");
  assert.match(decision.logDetail, /does not exist/);
});

test("the tenant-facing refusal cannot tell a forger whether the invoice EXISTS", () => {
  // An existence oracle, and the reason `detail` and `logDetail` are two
  // fields. A refused row is attributed to the account Stripe named — the
  // forger's own — and their own stripe_connect_events rows are readable
  // to them by policy. If "belongs to a different tenant" and "does not
  // exist" reached that row, a pilot holding another tenant's invoice uuid
  // could pay themselves fifty cents and read back which it was.
  const missing = resolve({ invoice: null });
  const stranger = resolve({ invoice: { ...sentInvoice, account_id: OTHER_ACCOUNT_ID } });
  assert.equal(missing.detail, stranger.detail);
  // ...and the uuid itself is not in the sentence either.
  assert.doesNotMatch(missing.detail, new RegExp(INVOICE_ID));
  assert.doesNotMatch(stranger.detail, new RegExp(INVOICE_ID));
  // The distinction survives, for the platform's log only.
  assert.notEqual(missing.logDetail, stranger.logDetail);
});

// ---------------------------------------------------------------------------
// REPLAY
// ---------------------------------------------------------------------------

test("a redelivered event whose PaymentIntent is already on the ledger records nothing", () => {
  // The events ledger alone cannot cover this: a row with a NULL
  // processed_at is deliberately retryable, so a crash between the payment
  // insert and the mark leaves Stripe free to deliver again. Without this
  // check that is a second credit to the client.
  const decision = resolve({
    ledger: [
      {
        id: "pay_1",
        amount_cents: 450000,
        paid_on: "2026-08-13",
        source: "stripe_link",
        stripe_payment_intent_id: "pi_1",
        reverses_payment_id: null,
      },
    ],
  });
  assert.equal(decision.kind, "duplicate");
});

test("replay is checked before invoice status, so a since-settled invoice is still a no-op", () => {
  const decision = resolve({
    invoice: { ...sentInvoice, status: "paid" },
    ledger: [
      {
        id: "pay_1",
        amount_cents: 450000,
        paid_on: "2026-08-13",
        source: "stripe_link",
        stripe_payment_intent_id: "pi_1",
        reverses_payment_id: null,
      },
    ],
  });
  // 'duplicate', NOT 'needs_review' — an invoice this handler itself
  // settled must not then nag the pilot about the payment that settled it.
  assert.equal(decision.kind, "duplicate");
});

test("a different PaymentIntent on the same invoice is not a replay", () => {
  const decision = resolve({
    ledger: [
      {
        id: "pay_1",
        amount_cents: 120000,
        paid_on: "2026-07-02",
        source: "stripe_link",
        stripe_payment_intent_id: "pi_earlier",
        reverses_payment_id: null,
      },
    ],
  });
  assert.equal(decision.kind, "record");
});

// ---------------------------------------------------------------------------
// ALREADY RECORDED BY HAND
// ---------------------------------------------------------------------------

test("a fully-paid invoice is left alone and the pilot is told", () => {
  // Ordering (b) of the double-record race: the pilot saw it in Stripe and
  // typed it in first. The invoice is settled and the balance is zero, so
  // there is nothing to credit — and recording anyway would leave an
  // invoice reading "Paid" with a negative balance.
  const decision = resolve({
    invoice: { ...sentInvoice, status: "paid" },
    ledger: [manual()],
  });
  assert.equal(decision.kind, "needs_review");
  assert.match(decision.detail, /already fully paid/);
});

test("a matching manual row within the window stops a partial invoice being credited twice", () => {
  // Invoice part-settled by hand for exactly this amount, two days before
  // the event. That is the pilot recording the card payment as a cheque,
  // not a client paying twice.
  const decision = resolve({
    invoice: { ...sentInvoice, status: "partial" },
    ledger: [manual({ paid_on: "2026-08-11" })],
  });
  assert.equal(decision.kind, "needs_review");
  assert.match(decision.detail, /2026-08-11/);
  assert.match(decision.detail, /not recorded twice/);
});

test("a hand-typed row for the payment NET OF STRIPE'S FEE is the same money", () => {
  // The most likely way a pilot records a Stripe payment by hand: they
  // type the figure they can see, which is the payout — gross minus
  // 2.9% + 30¢. Matching on exact equality (the earlier rule) misses every
  // one of those and records the gross on top of it, crediting the client
  // about 1.03x what they paid, silently.
  const decision = resolve({
    ledger: [manual({ amount_cents: 436950, paid_on: "2026-08-12" })],
  });
  assert.equal(decision.kind, "needs_review");
  // The sentence names BOTH figures — a pilot comparing them is the whole
  // point, and "a payment of the same amount" would be false here.
  assert.match(decision.detail, /\$4,500\.00/);
  assert.match(decision.detail, /\$4,369\.50/);
  assert.match(decision.detail, /after Stripe's fee/);
});

test("the fee band stops well short of a genuinely different payment", () => {
  assert.equal(manualMatchFloorCents(450000), 450000 - 22500 - 100);
  // A hand-typed row further off than any published Stripe fee is a
  // different payment, and a client who really paid twice must be credited.
  const decision = resolve({
    ledger: [manual({ amount_cents: 350000, paid_on: "2026-08-12" })],
  });
  assert.equal(decision.kind, "record");
});

test("a manual row LARGER than the Stripe charge is not a match", () => {
  // Nobody hand-records more than was charged, so this is a different
  // payment — typically the earlier partial that made this link's balance.
  const decision = resolve({
    ledger: [manual({ amount_cents: 460000, paid_on: "2026-08-12" })],
  });
  assert.equal(decision.kind, "record");
});

test("the already-recorded scan does NOT depend on the balance having moved", () => {
  // The regression this pins. The scan used to run only when the balance
  // due had already dropped below the link amount — a proxy for "a payment
  // landed". It fails exactly when the balance GREW after the link was
  // priced (a reversed cheque) and the link's Stripe deactivation failed,
  // leaving it payable: the balance is above the link amount, the pilot has
  // hand-recorded the payment they saw in Stripe, and the old gate skipped
  // the check with the matching row sitting right there.
  const decision = resolve({
    invoice: { ...sentInvoice, status: "partial" },
    ledger: [
      // The reversed cheque that pushed the balance back up, and its
      // correction. Neither can match: one is reversed, one is a negative.
      manual({ id: "pay_cheque", amount_cents: 800000, paid_on: "2026-08-01" }),
      manual({
        id: "pay_reversal",
        amount_cents: -800000,
        paid_on: "2026-08-02",
        reverses_payment_id: "pay_cheque",
      }),
      // The pilot's hand-typed record of THIS Stripe payment.
      manual({ id: "pay_typed", paid_on: "2026-08-12" }),
    ],
  });
  assert.equal(decision.kind, "needs_review");
});

test("a manual row outside the window does not suppress the payment", () => {
  const decision = resolve({ ledger: [manual({ paid_on: "2026-06-01" })] });
  assert.equal(decision.kind, "record");
  assert.equal(MANUAL_MATCH_WINDOW_DAYS, 3);
});

test("a manual row that has since been CORRECTED does not suppress the payment", () => {
  // The ledger is append-only: a reversed payment keeps its row. Reading
  // that dead row as "already recorded" would silently drop a real payment
  // on an invoice the pilot has just put back to partial.
  const decision = resolve({
    ledger: [
      manual({ paid_on: "2026-08-12" }),
      manual({
        id: "pay_reversal",
        amount_cents: -450000,
        reverses_payment_id: "pay_manual",
      }),
    ],
  });
  assert.equal(decision.kind, "record");
});

test("an auto-recorded row of the same amount is not read as a hand-typed one", () => {
  // Only 'manual' rows can be the pilot getting there first. A stripe_link
  // row for a different PaymentIntent is a second real payment.
  const decision = resolve({
    ledger: [
      {
        id: "pay_earlier",
        amount_cents: 450000,
        paid_on: "2026-08-12",
        source: "stripe_link",
        stripe_payment_intent_id: "pi_earlier",
        reverses_payment_id: null,
      },
    ],
  });
  assert.equal(decision.kind, "record");
});

// ---------------------------------------------------------------------------
// STALE LINKS — the database will not refuse these, so this must
// ---------------------------------------------------------------------------

test("the void refusal is written to the pilot, and reaches them", () => {
  // The sentence tells the pilot to refund a client. That is only worth
  // writing because app/(app)/invoices/[id]/page.tsx now queries
  // outcome in ('needs_review','refused') for this invoice — it used to
  // query 'needs_review' alone, so this instruction went to a server log
  // no pilot has ever read while the client's money sat unrefunded.
  const decision = resolve({ invoice: { ...sentInvoice, status: "void" } });
  assert.equal(decision.kind, "refused");
  assert.match(decision.detail, /\$4,500\.00/);
  assert.match(decision.detail, /refund/);
  // No logDetail: there is nothing here to keep from this tenant — it is
  // their own invoice and their own client's money.
  assert.equal(decision.logDetail, undefined);
});

test("a voided invoice never takes a payment, however live the link still is", () => {
  // 20260809040000's own header: the platform cannot always revoke a link
  // (a disconnect that failed leaves it live on the pilot's own account),
  // so this case is reachable. invoice_payments_validate early-returns for
  // service_role and will not catch it.
  const decision = resolve({ invoice: { ...sentInvoice, status: "void" } });
  assert.equal(decision.kind, "refused");
  assert.match(decision.detail, /void/);
  assert.match(decision.detail, /refund/);
});

test("a draft invoice never takes a payment", () => {
  const decision = resolve({ invoice: { ...sentInvoice, status: "draft" } });
  assert.equal(decision.kind, "refused");
});

// ---------------------------------------------------------------------------
// The happy path, and what it writes
// ---------------------------------------------------------------------------

test("the recorded row matches what the manual path would have written", () => {
  const decision = resolve();
  assert.equal(decision.kind, "record");
  assert.deepEqual(decision.insert, {
    account_id: ACCOUNT_ID,
    invoice_id: INVOICE_ID,
    paid_on: "2026-08-13",
    // session.amount_total — what Stripe actually charged, never the
    // amount snapshotted on the link when it was generated.
    amount_cents: 450000,
    method: "card",
    source: "stripe_link",
    stripe_payment_intent_id: "pi_1",
  });
  // Same as recordPayment: any payment landing makes a link priced against
  // the old balance wrong, so it goes.
  assert.equal(decision.retireLinkId, "plink_1");
});

test("a link that no longer matches the invoice's stored one is noted, not refused", () => {
  // The stored id is cleared on every retire/regenerate/disconnect, so a
  // mismatch is usually just "that link was replaced". Metadata is the
  // durable key; this is corroboration only.
  const decision = resolve({
    invoice: { ...sentInvoice, stripe_payment_link_id: "plink_newer" },
  });
  assert.equal(decision.kind, "record");
  assert.match(decision.detail, /plink_1/);
});

test("an empty ledger on a sent invoice simply records", () => {
  // No balance is consulted at all any more — the ledger answers the only
  // question the decision has ("is this money already written down?")
  // directly, and the post-insert balance is the route's business.
  const decision = resolve({ ledger: [] });
  assert.equal(decision.kind, "record");
});

// ---------------------------------------------------------------------------
// Status sync — the rule recordPayment applies, extracted so both agree
// ---------------------------------------------------------------------------

test("status advances exactly as the manual path advances it", () => {
  assert.equal(nextInvoiceStatus("sent", 0), "paid");
  assert.equal(nextInvoiceStatus("sent", -500), "paid");
  assert.equal(nextInvoiceStatus("sent", 120000), "partial");
  assert.equal(nextInvoiceStatus("partial", 0), "paid");
  // Nowhere to go from these, and the manual path does not try either.
  assert.equal(nextInvoiceStatus("paid", 0), null);
  assert.equal(nextInvoiceStatus("draft", 0), null);
  assert.equal(nextInvoiceStatus("void", 0), null);
  // A failed totals read must never be read as "balance zero, mark it paid".
  assert.equal(nextInvoiceStatus("sent", null), null);
});

// ---------------------------------------------------------------------------
// ASYNC SETTLEMENT — the whole game once a link offers a bank debit (ACH)
//
// An ACH debit has THREE endings, not two. The client accepts the mandate
// and `checkout.session.completed` arrives with payment_status 'unpaid' —
// no money has moved, and typically will not for about four business days.
// Then exactly one of `async_payment_succeeded` (it settled: this is the
// payment) or `async_payment_failed` (the bank refused it: there is no
// money and there never was).
//
// The failure this whole group exists to prevent is a five-figure invoice
// reading Paid on the strength of a mandate the client's bank later
// declines. The gate is `payment_status === 'paid'` and it is pinned in
// both directions below: a pending debit must NEVER become a claim, and a
// settled one must.
// ---------------------------------------------------------------------------

/** The bank-debit shape of the same fixture: link offered card AND bank. */
function achEvent(overrides = {}, sessionOverrides = {}) {
  return event(overrides, {
    paymentMethodTypes: ["card", "us_bank_account"],
    ...sessionOverrides,
  });
}

test("the endpoint listens to three types; only two can become money", () => {
  // TWO SEPARATE CONSTANTS ON PURPOSE. The wide one is what an operator
  // registers in the Stripe dashboard; the narrow one is what may put a row
  // in invoice_payments. Collapsing them would make a FAILED payment
  // eligible to become a claim, which is the one thing it must never be.
  assert.deepEqual([...CONNECT_ENDPOINT_EVENT_TYPES], [
    "checkout.session.completed",
    "checkout.session.async_payment_succeeded",
    "checkout.session.async_payment_failed",
  ]);
  assert.equal(ASYNC_FAILURE_EVENT_TYPE, "checkout.session.async_payment_failed");
  assert.ok(!AUTO_PAYMENT_EVENT_TYPES.includes(ASYNC_FAILURE_EVENT_TYPE));
});

test("INITIATED: an authorised bank debit is surfaced without being recorded", () => {
  const read = readConnectPaymentEvent(achEvent({}, { paymentStatus: "unpaid" }));
  // Still 'ignored' — the kind answers exactly one question ("does this put
  // a row on the ledger?") and the answer is still no.
  assert.equal(read.kind, "ignored");
  assert.equal(read.async.state, "initiated");
  assert.equal(read.async.sessionId, "cs_1");
  assert.equal(read.async.paymentLinkId, "plink_1");
  assert.equal(read.async.amountCents, 450000);
  // ...but now attributable, which is what lets the route write a row the
  // tenant can actually see (a null account_id is invisible under RLS).
  assert.deepEqual(read.declared, {
    declaredAccountId: ACCOUNT_ID,
    declaredInvoiceId: INVOICE_ID,
  });
  // The sentence has three jobs: money is coming, it has NOT arrived, and
  // there is nothing to do. The third matters most — the natural reaction
  // to "pending" is to chase the client or type it in by hand, and both of
  // those cost somebody money.
  assert.match(read.detail, /not paid yet/);
  assert.match(read.detail, /business days/);
  assert.match(read.detail, /\$4,500\.00/);
  assert.match(read.detail, /nothing to chase/);
});

test("INITIATED: a card-only link is never described as a bank payment", () => {
  // payment_method_types is what was OFFERED. A link that never offered a
  // bank debit cannot be waiting on one, and "your client's bank transfer
  // is on its way" would be an invented fact.
  const read = readConnectPaymentEvent(event({}, { paymentStatus: "unpaid" }));
  assert.equal(read.kind, "ignored");
  assert.equal(read.async.state, "initiated");
  assert.match(read.detail, /not paid yet/);
  assert.doesNotMatch(read.detail, /ACH/);
  assert.equal(offersBankDebit(["card", "link"]), false);
  assert.equal(offersBankDebit(["card", "us_bank_account"]), true);
  assert.equal(offersBankDebit(null), false);
});

test("INITIATED: an unattributable pending debit stays a plain log line", () => {
  // Nowhere to show it: a row with a null account_id is invisible to every
  // tenant, so a notice would be written for a reader who does not exist.
  const read = readConnectPaymentEvent(
    achEvent({}, { paymentStatus: "unpaid", metadata: { invoice_number: "2026-0007" } })
  );
  assert.equal(read.kind, "ignored");
  assert.equal(read.async, undefined);
  assert.equal(read.declared, undefined);
  assert.match(read.detail, /not paid yet/);
});

test("INITIATED → SUCCEEDED: settlement is the event that records the money", () => {
  const claim = claimFrom(
    achEvent({ eventType: "checkout.session.async_payment_succeeded" }, { paymentStatus: "paid" })
  );
  const decision = resolveAutoPayment({ claim, account, invoice: sentInvoice, ledger: [] });
  assert.equal(decision.kind, "record");
  assert.equal(decision.insert.amount_cents, 450000);
  assert.equal(decision.insert.source, "stripe_link");
  // THE DOCUMENTED TRADEOFF, pinned so it is a decision and not a
  // surprise: a link offering BOTH card and bank makes payment_method_types
  // ambiguous, so `method` is 'other' rather than a guess. Reading the real
  // instrument means retrieving the PaymentIntent's charge — a second
  // Stripe round trip inside a webhook, for a label.
  assert.equal(decision.insert.method, "other");
  // A bank-only link has no ambiguity and does get the right label.
  const bankOnly = claimFrom(
    event(
      { eventType: "checkout.session.async_payment_succeeded" },
      { paymentMethodTypes: ["us_bank_account"] }
    )
  );
  assert.equal(bankOnly.method, "ach");
});

test("INITIATED → FAILED: nothing is recorded and the link is called spent", () => {
  const read = readConnectPaymentEvent(
    achEvent({ eventType: ASYNC_FAILURE_EVENT_TYPE }, { paymentStatus: "unpaid" })
  );
  assert.equal(read.kind, "ignored");
  assert.equal(read.async.state, "failed");
  assert.equal(read.async.paymentLinkId, "plink_1");
  assert.deepEqual(read.declared, {
    declaredAccountId: ACCOUNT_ID,
    declaredInvoiceId: INVOICE_ID,
  });
  // Says the money never came, and names the one action there is. Stripe
  // deactivates the link when the SESSION completes — at mandate
  // acceptance, days before this event — so "ask them to try again" without
  // "generate a new link" sends a client back to a dead URL.
  assert.match(read.detail, /FAILED/);
  assert.match(read.detail, /no money arrived/);
  assert.match(read.detail, /balance is unchanged/);
  assert.match(read.detail, /generate a new one/);
  // No reason is invented. The failure reason lives on the PaymentIntent
  // and fetching it is a second round trip inside a webhook for a sentence.
  assert.doesNotMatch(read.detail, /insufficient/i);
});

test("FAILED is not 'refused' — 'refused' means money arrived and we declined it", () => {
  // The distinction is the whole reason 20260813120000 adds outcomes rather
  // than reusing one. A 'refused' row tells a pilot to go check their
  // Stripe balance and possibly refund a client; a failed debit means there
  // is nothing in the balance to check.
  const failed = readConnectPaymentEvent(
    achEvent({ eventType: ASYNC_FAILURE_EVENT_TYPE }, { paymentStatus: "unpaid" })
  );
  assert.notEqual(failed.kind, "refused");
  assert.notEqual(failed.kind, "claim");
});

test("FAILED: metadata that names no usable invoice raises nothing at all", () => {
  for (const metadata of [
    {},
    { invoice_number: "2026-0007" },
    { invoice_id: "'; drop--", account_id: ACCOUNT_ID },
  ]) {
    const read = readConnectPaymentEvent(
      achEvent({ eventType: ASYNC_FAILURE_EVENT_TYPE }, { paymentStatus: "unpaid", metadata })
    );
    // 'ignored' and NOT 'refused': no money moved, so there is nothing to
    // tell anyone about, and a uuid this handler will never send to
    // Postgres is not an error worth a row on somebody's invoice.
    assert.equal(read.kind, "ignored");
    assert.equal(read.async, undefined);
  }
});

test("REPLAY: reading the same async delivery twice gives the same answer", () => {
  // The read layer holds no state, which is what makes Stripe's three days
  // of retries safe here: a redelivered pending or failed event produces an
  // identical row, and the route's insert-first idempotency skips it once
  // the first attempt finished.
  for (const built of [
    achEvent({}, { paymentStatus: "unpaid" }),
    achEvent({ eventType: ASYNC_FAILURE_EVENT_TYPE }, { paymentStatus: "unpaid" }),
  ]) {
    assert.deepEqual(readConnectPaymentEvent(built), readConnectPaymentEvent(built));
  }
});

test("REPLAY: a redelivered settlement never credits the client twice", () => {
  // The events ledger alone cannot cover this — a row with a NULL
  // processed_at is deliberately retryable — so the PaymentIntent check is
  // what stands between an ACH retry and a second credit.
  const claim = claimFrom(
    achEvent({ eventType: "checkout.session.async_payment_succeeded" })
  );
  const decision = resolveAutoPayment({
    claim,
    account,
    invoice: { ...sentInvoice, status: "paid" },
    ledger: [
      {
        id: "pay_ach",
        amount_cents: 450000,
        paid_on: "2026-08-13",
        source: "stripe_link",
        stripe_payment_intent_id: "pi_1",
        reverses_payment_id: null,
      },
    ],
  });
  // 'duplicate', not 'needs_review': an invoice this handler itself settled
  // must not then nag the pilot about the payment that settled it.
  assert.equal(decision.kind, "duplicate");
});

test("a pending debit can never reach the ledger, whatever else is true", () => {
  // The belt-and-braces sweep. No combination of invoice state or ledger
  // contents turns an unpaid session into a claim, because the read never
  // hands one over — resolveAutoPayment is not even reachable.
  for (const status of ["sent", "partial", "paid", "draft", "void"]) {
    const read = readConnectPaymentEvent(achEvent({}, { paymentStatus: "unpaid" }));
    assert.notEqual(read.kind, "claim", `status ${status}`);
    assert.equal(read.claim, undefined);
  }
});

test("a pending debit in another currency states no dollar figure", () => {
  // formatCentsPlain would happily render 450,000 yen as "$4,500.00", and
  // this sentence goes on the pilot's screen. Drop the figure rather than
  // invent one. (The paid path REFUSES a non-USD session outright — the
  // ledger has no currency column — which is a stronger answer available
  // only once the money is real.)
  const read = readConnectPaymentEvent(
    achEvent({}, { paymentStatus: "unpaid", currency: "gbp" })
  );
  assert.equal(read.kind, "ignored");
  assert.equal(read.async.amountCents, null);
  assert.doesNotMatch(read.detail, /\$/);
  assert.match(read.detail, /not paid yet/);
});

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------

test("dates come from the event's own timestamp, in UTC", () => {
  assert.equal(isoDateFromUnixSeconds(EVENT_CREATED), "2026-08-13");
  assert.equal(isoDateFromUnixSeconds(0), "1970-01-01");
});

test("day distance is symmetric, whole-day and safe on nonsense", () => {
  assert.equal(daysBetweenIsoDates("2026-08-13", "2026-08-11"), 2);
  assert.equal(daysBetweenIsoDates("2026-08-11", "2026-08-13"), 2);
  assert.equal(daysBetweenIsoDates("2026-08-13", "2026-08-13"), 0);
  // Across a DST boundary in local time — these are calendar dates parsed
  // as UTC, so the answer is 1, not 0.958333…
  assert.equal(daysBetweenIsoDates("2026-03-09", "2026-03-08"), 1);
  assert.equal(daysBetweenIsoDates("not-a-date", "2026-08-13"), Number.POSITIVE_INFINITY);
});

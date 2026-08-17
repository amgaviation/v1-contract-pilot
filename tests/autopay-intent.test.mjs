import test from "node:test";
import assert from "node:assert/strict";

const {
  AUTOPAY_INTENT_EVENT_TYPE,
  CONNECT_ENDPOINT_EVENT_TYPES,
  readAutopayIntentEvent,
  resolveAutoPayment,
} = await import("../lib/stripe/connect-payments.ts");

/**
 * The AUTOPAY settlement path (20260817160000): payment_intent.succeeded →
 * claim → the SAME resolveAutoPayment the link path uses. These tests pin
 * the two properties that make subscribing to payment_intent.succeeded
 * safe at all:
 *
 *   THE GATE   every charge on the pilot's connected account produces this
 *              event — link checkouts and unrelated sales included. Only a
 *              PaymentIntent carrying metadata.autopay === "1" (written
 *              only by chargeAutopayInvoice) may become a claim; everything
 *              else must land 'ignored' with no row, or link payments
 *              would be recorded twice (once per path).
 *   PROVENANCE a claim from this reader must write source='stripe_autopay',
 *              never 'stripe_link' — the ledger's provenance column is what
 *              a pilot audits against their Stripe dashboard.
 */

const ACCT = "acct_pilot1";
const ACCOUNT_ID = "11111111-1111-4111-8111-111111111111";
const INVOICE_ID = "22222222-2222-4222-8222-222222222222";

function intentEvent(overrides = {}) {
  return {
    eventId: "evt_1",
    eventType: AUTOPAY_INTENT_EVENT_TYPE,
    eventAccount: ACCT,
    eventCreated: 1_766_000_000,
    intent: {
      id: "pi_autopay_1",
      amountReceivedCents: 450_000,
      currency: "usd",
      metadata: {
        autopay: "1",
        account_id: ACCOUNT_ID,
        invoice_id: INVOICE_ID,
        invoice_number: "INV-0042",
      },
      ...(overrides.intent ?? {}),
    },
    ...Object.fromEntries(Object.entries(overrides).filter(([k]) => k !== "intent")),
  };
}

test("payment_intent.succeeded is on the endpoint's subscription list", () => {
  assert.ok(CONNECT_ENDPOINT_EVENT_TYPES.includes("payment_intent.succeeded"));
});

test("a well-formed autopay intent becomes a stripe_autopay claim", () => {
  const read = readAutopayIntentEvent(intentEvent());
  assert.equal(read.kind, "claim");
  assert.equal(read.claim.source, "stripe_autopay");
  assert.equal(read.claim.paymentIntentId, "pi_autopay_1");
  assert.equal(read.claim.amountCents, 450_000);
  assert.equal(read.claim.declaredAccountId, ACCOUNT_ID);
  assert.equal(read.claim.declaredInvoiceId, INVOICE_ID);
  assert.equal(read.claim.method, "card");
  assert.equal(read.claim.paymentLinkId, null);
});

test("THE GATE: an intent without metadata.autopay is ignored — link payments must not be recorded twice", () => {
  const read = readAutopayIntentEvent(
    intentEvent({
      intent: {
        metadata: { account_id: ACCOUNT_ID, invoice_id: INVOICE_ID },
      },
    })
  );
  assert.equal(read.kind, "ignored");
});

test("an unrelated sale on the pilot's own Stripe account (no metadata at all) is ignored", () => {
  const read = readAutopayIntentEvent(intentEvent({ intent: { metadata: null } }));
  assert.equal(read.kind, "ignored");
});

test("a platform-scope delivery (no event.account) is refused", () => {
  const read = readAutopayIntentEvent(intentEvent({ eventAccount: null }));
  assert.equal(read.kind, "refused");
});

test("FORGERY SHAPE: autopay=1 with a malformed invoice id is refused, never a claim", () => {
  const read = readAutopayIntentEvent(
    intentEvent({
      intent: {
        metadata: { autopay: "1", account_id: ACCOUNT_ID, invoice_id: "not-a-uuid" },
      },
    })
  );
  assert.equal(read.kind, "refused");
});

test("a non-USD settlement is refused, not converted", () => {
  const read = readAutopayIntentEvent(intentEvent({ intent: { currency: "eur" } }));
  assert.equal(read.kind, "refused");
});

test("no positive amount_received, no claim", () => {
  const read = readAutopayIntentEvent(intentEvent({ intent: { amountReceivedCents: 0 } }));
  assert.equal(read.kind, "refused");
});

test("PROVENANCE: resolveAutoPayment writes the claim's own source through to the insert", () => {
  const read = readAutopayIntentEvent(intentEvent());
  assert.equal(read.kind, "claim");
  const decision = resolveAutoPayment({
    claim: read.claim,
    account: { id: ACCOUNT_ID, connect_account_id: ACCT },
    invoice: {
      id: INVOICE_ID,
      account_id: ACCOUNT_ID,
      status: "sent",
      stripe_payment_link_id: null,
    },
    ledger: [],
  });
  assert.equal(decision.kind, "record");
  assert.equal(decision.insert.source, "stripe_autopay");
  assert.equal(decision.insert.stripe_payment_intent_id, "pi_autopay_1");
  // No Checkout Session, no link to retire.
  assert.equal(decision.retireLinkId, null);
});

test("REPLAY: a redelivered autopay settlement is a duplicate, not a second row", () => {
  const read = readAutopayIntentEvent(intentEvent());
  const decision = resolveAutoPayment({
    claim: read.claim,
    account: { id: ACCOUNT_ID, connect_account_id: ACCT },
    invoice: {
      id: INVOICE_ID,
      account_id: ACCOUNT_ID,
      status: "partial",
      stripe_payment_link_id: null,
    },
    ledger: [
      {
        id: "33333333-3333-4333-8333-333333333333",
        amount_cents: 450_000,
        paid_on: "2025-12-17",
        source: "stripe_autopay",
        stripe_payment_intent_id: "pi_autopay_1",
        reverses_payment_id: null,
      },
    ],
  });
  assert.equal(decision.kind, "duplicate");
});

test("TENANCY: metadata naming a different tenant than the signed account is refused", () => {
  const read = readAutopayIntentEvent(intentEvent());
  const decision = resolveAutoPayment({
    claim: read.claim,
    account: { id: "99999999-9999-4999-8999-999999999999", connect_account_id: ACCT },
    invoice: null,
    ledger: [],
  });
  assert.equal(decision.kind, "refused");
});

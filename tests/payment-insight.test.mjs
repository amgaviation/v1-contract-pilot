import test from "node:test";
import assert from "node:assert/strict";

const { assemblePaymentInsight, formatMedianDays } = await import(
  "../app/(app)/clients/[id]/payment-insight.ts"
);

/**
 * The client payment-behavior panel. All fixtures synthetic.
 *
 * What carries weight here:
 * 1. DAYS-TO-PAY uses the FIRST-CROSSING date — the sales-tax report's
 *    ledgerEvents, imported, not reimplemented — so a later payment
 *    correction does not rewrite how fast the client originally paid.
 * 2. AGING comes from pilot.invoices_overdue's days_overdue (the one
 *    source for past-due-ness); absence from the view means "not yet
 *    due", and money is bucketed from invoice_totals.balance_due_cents,
 *    never recomputed.
 * 3. The assembly REFUSES on a missing totals row — an unknown balance
 *    is never bucketed as $0 (the statement-lib rule).
 */

function invoice(overrides = {}) {
  return {
    id: "inv-1",
    status: "paid",
    issued_on: "2026-01-05",
    ...overrides,
  };
}

function totals(overrides = {}) {
  return {
    invoice_id: "inv-1",
    total_cents: 450000,
    balance_due_cents: 0,
    ...overrides,
  };
}

function payment(overrides = {}) {
  return {
    id: "pay-1",
    invoice_id: "inv-1",
    paid_on: "2026-01-24",
    amount_cents: 450000,
    ...overrides,
  };
}

function assemble(input) {
  return assemblePaymentInsight({
    invoices: [],
    totals: [],
    overdue: [],
    payments: [],
    ...input,
  });
}

test("median days-to-pay runs issue to the first crossing, not to the last payment", () => {
  // Partial on day 5, crossed on day 19 — the sample is 19 days.
  const result = assemble({
    invoices: [invoice()],
    totals: [totals()],
    payments: [
      payment({ id: "p1", paid_on: "2026-01-10", amount_cents: 100000 }),
      payment({ id: "p2", paid_on: "2026-01-24", amount_cents: 350000 }),
    ],
  });
  assert.equal(result.ok, true);
  assert.equal(result.insight.medianDaysToPay, 19);
  assert.equal(result.insight.settledSampleCount, 1);
});

test("a later correction does not rewrite the original days-to-pay", () => {
  // Settled Jan 24 (19 days), corrected in February, re-paid in March.
  // The first crossing on the current ledger is still Jan 24.
  const result = assemble({
    invoices: [invoice()],
    totals: [totals()],
    payments: [
      payment({ id: "p1", paid_on: "2026-01-24", amount_cents: 450000 }),
      payment({ id: "p2", paid_on: "2026-02-10", amount_cents: -450000 }),
      payment({ id: "p3", paid_on: "2026-03-05", amount_cents: 450000 }),
    ],
  });
  assert.equal(result.ok, true);
  assert.equal(result.insight.medianDaysToPay, 19);
});

test("median of an even sample count is the mean of the two middles", () => {
  const result = assemble({
    invoices: [
      invoice({ id: "a", issued_on: "2026-01-01" }),
      invoice({ id: "b", issued_on: "2026-02-01" }),
    ],
    totals: [
      totals({ invoice_id: "a", total_cents: 100000 }),
      totals({ invoice_id: "b", total_cents: 100000 }),
    ],
    payments: [
      // 10 days and 21 days → median 15.5.
      payment({ id: "p1", invoice_id: "a", paid_on: "2026-01-11", amount_cents: 100000 }),
      payment({ id: "p2", invoice_id: "b", paid_on: "2026-02-22", amount_cents: 100000 }),
    ],
  });
  assert.equal(result.ok, true);
  assert.equal(result.insight.medianDaysToPay, 15.5);
  assert.equal(result.insight.settledSampleCount, 2);
});

test("an invoice that never crossed its total contributes no sample — and no median exists without one", () => {
  const result = assemble({
    invoices: [invoice({ status: "partial" })],
    totals: [totals({ balance_due_cents: 350000 })],
    payments: [payment({ amount_cents: 100000, paid_on: "2026-01-10" })],
  });
  assert.equal(result.ok, true);
  assert.equal(result.insight.medianDaysToPay, null);
  assert.equal(result.insight.settledSampleCount, 0);
});

test("a payment ledger-dated before issue clamps to 0 days rather than going negative or vanishing", () => {
  const result = assemble({
    invoices: [invoice({ issued_on: "2026-01-10" })],
    totals: [totals()],
    payments: [payment({ paid_on: "2026-01-08" })],
  });
  assert.equal(result.ok, true);
  assert.equal(result.insight.medianDaysToPay, 0);
});

test("aging buckets follow days_overdue from the view; absence means not yet due", () => {
  const result = assemble({
    invoices: [
      invoice({ id: "cur", status: "sent" }),
      invoice({ id: "b30", status: "sent" }),
      invoice({ id: "b60", status: "partial" }),
      invoice({ id: "b90", status: "sent" }),
      invoice({ id: "b91", status: "sent" }),
      invoice({ id: "done", status: "paid" }),
    ],
    totals: [
      totals({ invoice_id: "cur", balance_due_cents: 100 }),
      totals({ invoice_id: "b30", balance_due_cents: 200 }),
      totals({ invoice_id: "b60", balance_due_cents: 400 }),
      totals({ invoice_id: "b90", balance_due_cents: 800 }),
      totals({ invoice_id: "b91", balance_due_cents: 1600 }),
      totals({ invoice_id: "done", balance_due_cents: 0 }),
    ],
    overdue: [
      { invoice_id: "b30", days_overdue: 1 },
      { invoice_id: "b60", days_overdue: 60 },
      { invoice_id: "b90", days_overdue: 90 },
      { invoice_id: "b91", days_overdue: 91 },
    ],
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.insight.agingCents, {
    current: 100,
    days1to30: 200,
    days31to60: 400,
    days61to90: 800,
    over90: 1600,
  });
  assert.equal(result.insight.outstandingCents, 3100);
  assert.equal(result.insight.openInvoiceCount, 5);
});

test("paid invoices never appear in aging or outstanding", () => {
  const result = assemble({
    invoices: [invoice()],
    totals: [totals()],
    payments: [payment()],
  });
  assert.equal(result.ok, true);
  assert.equal(result.insight.outstandingCents, 0);
  assert.equal(result.insight.openInvoiceCount, 0);
});

test("refuses on an invoice with no totals row — an unknown balance is not $0", () => {
  const result = assemble({ invoices: [invoice()] });
  assert.equal(result.ok, false);
  assert.match(result.reason, /no totals row/);
});

test("formatMedianDays words singular, whole, and half-day values", () => {
  assert.equal(formatMedianDays(1), "1 day");
  assert.equal(formatMedianDays(19), "19 days");
  assert.equal(formatMedianDays(15.5), "15.5 days");
  assert.equal(formatMedianDays(0), "0 days");
});

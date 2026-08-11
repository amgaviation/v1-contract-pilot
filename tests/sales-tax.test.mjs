import test from "node:test";
import assert from "node:assert/strict";

const {
  resolveSalesTaxPeriod,
  isValidIsoDate,
  formatBps,
  assembleSalesTaxReport,
} = await import("../app/(app)/reports/sales-tax/report-lib.ts");

/**
 * The sales tax report. All fixtures synthetic.
 *
 * The behaviours that carry money-safety weight and get pinned hard:
 *
 * 1. CASH BASIS is enforced in the assembly, not just described in copy:
 *    only status='paid' invoices become rows; sent/partial/void invoices
 *    with payments in the period are excluded from the totals a filing
 *    preparer will work from.
 *
 * 2. The assembly REFUSES — never fabricates a $0.00 — when a figure it
 *    must print is missing (no invoice row for a totals row, no lines for
 *    a taxed invoice) or doesn't reconcile (base x rate != the view's
 *    tax_cents). Same defect class lib/supabase/rows.ts exists to close.
 *
 * 3. The printed totals are sums of the printed rows and nothing else, so
 *    a reader adding the column by hand reconciles to the total.
 */

// ---------------------------------------------------------------------------
// Fixture builders.
// ---------------------------------------------------------------------------

function invoice(overrides = {}) {
  return {
    id: "inv-1",
    invoice_number: "INV-2026-0001",
    client_id: "client-1",
    status: "paid",
    issued_on: "2026-01-05",
    tax_rate_bps: 825,
    ...overrides,
  };
}

function totals(overrides = {}) {
  return {
    invoice_id: "inv-1",
    tax_cents: 37125, // 8.25% of $4,500.00
    last_paid_on: "2026-02-01",
    ...overrides,
  };
}

function line(overrides = {}) {
  return {
    invoice_id: "inv-1",
    amount_cents: 450000,
    taxable: true,
    ...overrides,
  };
}

const CLIENTS = new Map([
  ["client-1", "Acme Air"],
  ["client-2", "Bravo Jets"],
]);

// ---------------------------------------------------------------------------
// Period resolution.
// ---------------------------------------------------------------------------

test("defaults to the calendar year of today", () => {
  const p = resolveSalesTaxPeriod({}, "2026-08-11");
  assert.deepEqual(p, { from: "2026-01-01", to: "2026-12-31", usedDefault: true });
});

test("each bound falls back independently on invalid input", () => {
  const p = resolveSalesTaxPeriod({ from: "not-a-date", to: "2026-03-31" }, "2026-08-11");
  assert.equal(p.from, "2026-01-01");
  assert.equal(p.to, "2026-03-31");
  assert.equal(p.usedDefault, false);
});

test("a reversed pair is swapped, not rejected", () => {
  const p = resolveSalesTaxPeriod({ from: "2026-06-30", to: "2026-04-01" }, "2026-08-11");
  assert.equal(p.from, "2026-04-01");
  assert.equal(p.to, "2026-06-30");
});

test("isValidIsoDate rejects calendar impossibilities the regex passes", () => {
  assert.equal(isValidIsoDate("2026-02-30"), false);
  assert.equal(isValidIsoDate("2026-13-01"), false);
  assert.equal(isValidIsoDate("2024-02-29"), true); // leap year
  assert.equal(isValidIsoDate("2026-02-29"), false); // not one
});

// ---------------------------------------------------------------------------
// Rate formatting — basis points are the schema's unit (tax_rate_bps).
// ---------------------------------------------------------------------------

test("formatBps renders bps as a human rate without trailing zeros", () => {
  assert.equal(formatBps(825), "8.25%");
  assert.equal(formatBps(800), "8%");
  assert.equal(formatBps(810), "8.1%");
  assert.equal(formatBps(0), "0%");
  assert.equal(formatBps(2500), "25%");
});

// ---------------------------------------------------------------------------
// Assembly: the cash basis is enforced, not just described.
// ---------------------------------------------------------------------------

test("only paid invoices become rows; sent/partial/void with payments do not", () => {
  const result = assembleSalesTaxReport({
    totalsInPeriod: [
      totals(),
      // A partial payment landed in the period, but the invoice is not
      // settled — its tax is not collected-in-full and must not count.
      totals({ invoice_id: "inv-2", tax_cents: 10000, last_paid_on: "2026-02-10" }),
      // Paid, then... no: void invoices keep their payment history in the
      // view; profit-loss excludes those payments from income and this
      // report excludes their tax the same way.
      totals({ invoice_id: "inv-3", tax_cents: 5000, last_paid_on: "2026-02-15" }),
    ],
    invoices: [
      invoice(),
      invoice({ id: "inv-2", invoice_number: "INV-2026-0002", status: "partial" }),
      invoice({ id: "inv-3", invoice_number: "INV-2026-0003", status: "void" }),
    ],
    lines: [line()],
    clientNames: CLIENTS,
  });

  assert.equal(result.ok, true);
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].invoiceNumber, "INV-2026-0001");
  assert.equal(result.taxTotalCents, 37125);
});

test("a paid invoice that charged no tax is counted, not listed", () => {
  const result = assembleSalesTaxReport({
    totalsInPeriod: [
      totals(),
      totals({ invoice_id: "inv-2", tax_cents: 0, last_paid_on: "2026-03-01" }),
    ],
    invoices: [
      invoice(),
      invoice({ id: "inv-2", invoice_number: "INV-2026-0002", tax_rate_bps: 0 }),
    ],
    lines: [line()],
    clientNames: CLIENTS,
  });

  assert.equal(result.ok, true);
  assert.equal(result.rows.length, 1);
  assert.equal(result.untaxedPaidCount, 1);
});

test("the taxable subtotal sums taxable lines only", () => {
  // A day-rate line (taxable) plus a reimbursed expense (not taxable):
  // the base shown must be the taxable half, and the view's tax_cents is
  // computed from that same half.
  const result = assembleSalesTaxReport({
    totalsInPeriod: [
      totals({ tax_cents: Math.round((350000 * 825) / 10000) }), // $288.75
    ],
    invoices: [invoice()],
    lines: [
      line({ amount_cents: 350000, taxable: true }),
      line({ amount_cents: 48250, taxable: false }),
    ],
    clientNames: CLIENTS,
  });

  assert.equal(result.ok, true);
  assert.equal(result.rows[0].taxableSubtotalCents, 350000);
  assert.equal(result.rows[0].taxCents, 28875);
});

test("totals are sums of the printed rows and nothing else", () => {
  const result = assembleSalesTaxReport({
    totalsInPeriod: [
      totals(),
      totals({
        invoice_id: "inv-2",
        tax_cents: Math.round((100000 * 700) / 10000), // $70.00 at 7%
        last_paid_on: "2026-01-15",
      }),
    ],
    invoices: [
      invoice(),
      invoice({
        id: "inv-2",
        invoice_number: "INV-2026-0002",
        client_id: "client-2",
        tax_rate_bps: 700,
      }),
    ],
    lines: [line(), line({ invoice_id: "inv-2", amount_cents: 100000 })],
    clientNames: CLIENTS,
  });

  assert.equal(result.ok, true);
  assert.equal(
    result.taxableTotalCents,
    result.rows.reduce((s, r) => s + r.taxableSubtotalCents, 0)
  );
  assert.equal(
    result.taxTotalCents,
    result.rows.reduce((s, r) => s + r.taxCents, 0)
  );
  assert.equal(result.taxTotalCents, 37125 + 7000);
  // Sorted by the date that put each invoice in the period.
  assert.deepEqual(
    result.rows.map((r) => r.paidOn),
    ["2026-01-15", "2026-02-01"]
  );
});

// ---------------------------------------------------------------------------
// Refusals: missing or irreconcilable figures never print as $0.00.
// ---------------------------------------------------------------------------

test("refuses when a totals row has no invoice row behind it", () => {
  const result = assembleSalesTaxReport({
    totalsInPeriod: [totals({ invoice_id: "inv-unknown" })],
    invoices: [],
    lines: [],
    clientNames: CLIENTS,
  });
  assert.equal(result.ok, false);
  assert.match(result.reason, /no invoice row/);
});

test("refuses when a taxed invoice has no line items loaded", () => {
  const result = assembleSalesTaxReport({
    totalsInPeriod: [totals()],
    invoices: [invoice()],
    lines: [], // tax_cents > 0 with no lines: the read came back short
    clientNames: CLIENTS,
  });
  assert.equal(result.ok, false);
  assert.match(result.reason, /no line items/);
});

test("refuses when base x rate does not reproduce the view's tax_cents", () => {
  const result = assembleSalesTaxReport({
    totalsInPeriod: [totals({ tax_cents: 37126 })], // off by one cent
    invoices: [invoice()],
    lines: [line()],
    clientNames: CLIENTS,
  });
  assert.equal(result.ok, false);
  assert.match(result.reason, /does not reproduce/);
});

test("a paid invoice with a null last_paid_on is a refusal, not a guess", () => {
  const result = assembleSalesTaxReport({
    totalsInPeriod: [totals({ last_paid_on: null })],
    invoices: [invoice()],
    lines: [line()],
    clientNames: CLIENTS,
  });
  assert.equal(result.ok, false);
  assert.match(result.reason, /last_paid_on/);
});

test("rounding matches the view: half-cents round away from zero", () => {
  // $6.00 taxable at 8.25% is 49.5 cents; pilot.invoice_totals' round()
  // (half away from zero on numeric) gives 50, and Math.round agrees for
  // the non-negative amounts these always are. 49 must refuse, 50 must
  // pass — pinning that the JS check can't drift a cent from Postgres.
  const fixture = (taxCents) => ({
    totalsInPeriod: [totals({ tax_cents: taxCents })],
    invoices: [invoice()],
    lines: [line({ amount_cents: 600 })],
    clientNames: CLIENTS,
  });
  assert.equal(assembleSalesTaxReport(fixture(50)).ok, true);
  assert.equal(assembleSalesTaxReport(fixture(49)).ok, false);
});

test("a client missing from the lookup renders as Unknown client, and the money still totals", () => {
  const result = assembleSalesTaxReport({
    totalsInPeriod: [totals()],
    invoices: [invoice({ client_id: "client-gone" })],
    lines: [line()],
    clientNames: CLIENTS,
  });
  assert.equal(result.ok, true);
  assert.equal(result.rows[0].clientName, "Unknown client");
  assert.equal(result.taxTotalCents, 37125);
});

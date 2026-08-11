import test from "node:test";
import assert from "node:assert/strict";

const {
  resolveSalesTaxPeriod,
  isValidIsoDate,
  formatBps,
  correctionNote,
  assembleSalesTaxReport,
} = await import("../app/(app)/reports/sales-tax/report-lib.ts");

/**
 * The sales tax report. All fixtures synthetic.
 *
 * The behaviours that carry money-safety weight and get pinned hard:
 *
 * 1. CASH BASIS via the FIRST-CROSSING DATE: an invoice's tax reports in
 *    the period containing the earliest ledger date at whose end the
 *    running payment sum reached the invoice total — computed from the
 *    full ledger, NOT from invoice_totals.last_paid_on gated on
 *    status='paid'. The status gate was the P1 bug: a payment correction
 *    moves last_paid_on to the correction date AND
 *    invoice_payments_resync_status (20260810120000 / 20260810170000)
 *    walks status back to sent/partial, so a settled-then-corrected
 *    invoice's tax vanished from EVERY period.
 *
 * 2. CORRECTIONS NEVER ERASE HISTORY: settle in A → report in A, forever.
 *    A correction that un-settles the invoice shows as a clearly-labelled
 *    NEGATIVE row in the period containing the correction. Totals sum the
 *    rows shown, negatives included.
 *
 * 3. The assembly REFUSES — never fabricates a $0.00 — when a figure it
 *    must print is missing (no invoice row behind a ledger, no totals row,
 *    no lines for a taxed invoice) or doesn't reconcile (base x rate !=
 *    the view's tax_cents). Same defect class lib/supabase/rows.ts closes.
 */

// ---------------------------------------------------------------------------
// Fixture builders. The canonical invoice: $4,500.00 taxable at 8.25% →
// tax $371.25 → total $4,871.25.
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
    total_cents: 487125, // 450000 + 37125
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

let paymentSeq = 0;
function payment(overrides = {}) {
  paymentSeq += 1;
  return {
    id: `p-${String(paymentSeq).padStart(3, "0")}`,
    invoice_id: "inv-1",
    paid_on: "2026-01-15",
    amount_cents: 487125,
    ...overrides,
  };
}

const CLIENTS = new Map([
  ["client-1", "Acme Air"],
  ["client-2", "Bravo Jets"],
]);

const YEAR = { from: "2026-01-01", to: "2026-12-31" };
const JAN = { from: "2026-01-01", to: "2026-01-31" };
const FEB = { from: "2026-02-01", to: "2026-02-28" };
const MAR = { from: "2026-03-01", to: "2026-03-31" };

function assemble(period, payments, overrides = {}) {
  return assembleSalesTaxReport({
    period,
    payments,
    invoices: [invoice()],
    totals: [totals()],
    lines: [line()],
    clientNames: CLIENTS,
    ...overrides,
  });
}

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

test("the correction note names the date the tax was previously counted", () => {
  assert.equal(
    correctionNote("2026-01-15"),
    "Payment corrected — previously counted 2026-01-15"
  );
});

// ---------------------------------------------------------------------------
// The first-crossing date: cash basis, enforced.
// ---------------------------------------------------------------------------

test("an invoice paid across two dates counts once, on the date the ledger crossed its total", () => {
  const ledger = [
    payment({ paid_on: "2026-01-10", amount_cents: 200000 }),
    payment({ paid_on: "2026-02-01", amount_cents: 287125 }),
  ];

  const year = assemble(YEAR, ledger);
  assert.equal(year.ok, true);
  assert.equal(year.rows.length, 1);
  assert.equal(year.rows[0].kind, "collected");
  assert.equal(year.rows[0].countedOn, "2026-02-01");
  assert.equal(year.rows[0].taxCents, 37125);
  assert.equal(year.taxTotalCents, 37125);

  // The partial payment's period shows nothing — the tax was not
  // collected in full in January.
  const jan = assemble(JAN, ledger);
  assert.equal(jan.ok, true);
  assert.equal(jan.rows.length, 0);
  assert.equal(jan.taxTotalCents, 0);
});

test("a ledger that never crossed its total contributes nothing", () => {
  const result = assemble(
    YEAR,
    [payment({ paid_on: "2026-01-10", amount_cents: 200000 })],
    { invoices: [invoice({ status: "partial" })] }
  );
  assert.equal(result.ok, true);
  assert.equal(result.rows.length, 0);
  assert.equal(result.untaxedPaidCount, 0);
  assert.equal(result.taxTotalCents, 0);
});

test("THE P1 CASE: a correction that walked status back to 'sent' does not erase period A's tax", () => {
  // Settled 15 JAN; the payment was corrected 10 FEB. The resync trigger
  // (20260810120000/20260810170000) flipped the invoice back to 'sent',
  // and last_paid_on now reads 2026-02-10 — the old report keyed on both
  // and dropped this invoice from every period. The first-crossing rule
  // keys on neither.
  const ledger = [
    payment({ paid_on: "2026-01-15", amount_cents: 487125 }),
    payment({ paid_on: "2026-02-10", amount_cents: -487125 }),
  ];
  const asSent = { invoices: [invoice({ status: "sent" })] };

  // Period A: the collected row stands, exactly as first reported.
  const jan = assemble(JAN, ledger, asSent);
  assert.equal(jan.ok, true);
  assert.equal(jan.rows.length, 1);
  assert.deepEqual(
    {
      kind: jan.rows[0].kind,
      countedOn: jan.rows[0].countedOn,
      taxCents: jan.rows[0].taxCents,
    },
    { kind: "collected", countedOn: "2026-01-15", taxCents: 37125 }
  );
  assert.equal(jan.taxTotalCents, 37125);

  // Period B: the negative correction row, where the cash event happened,
  // naming the date the tax was previously counted.
  const feb = assemble(FEB, ledger, asSent);
  assert.equal(feb.ok, true);
  assert.equal(feb.rows.length, 1);
  assert.deepEqual(
    {
      kind: feb.rows[0].kind,
      countedOn: feb.rows[0].countedOn,
      previouslyCountedOn: feb.rows[0].previouslyCountedOn,
      taxableSubtotalCents: feb.rows[0].taxableSubtotalCents,
      taxCents: feb.rows[0].taxCents,
    },
    {
      kind: "correction",
      countedOn: "2026-02-10",
      previouslyCountedOn: "2026-01-15",
      taxableSubtotalCents: -450000,
      taxCents: -37125,
    }
  );
  assert.equal(feb.taxTotalCents, -37125);

  // A period spanning both: totals sum the rows shown, negatives
  // included, and net to zero — collected, then corrected.
  const year = assemble(YEAR, ledger, asSent);
  assert.equal(year.ok, true);
  assert.equal(year.rows.length, 2);
  assert.equal(year.taxTotalCents, 0);
  assert.equal(year.taxableTotalCents, 0);
  assert.equal(
    year.taxTotalCents,
    year.rows.reduce((s, r) => s + r.taxCents, 0)
  );
});

test("corrected and re-paid the same day: nothing moves — the original period stands and the correction's period shows nothing", () => {
  // The settled-state is read at the end of each ledger date, so the
  // intra-day dip on 10 FEB is not an event. The earliest crossing on the
  // CURRENT ledger — 15 JAN — is the date that wins: at every end-of-day
  // the invoice reads settled, so period A's already-filed figure was
  // never wrong and period B has no cash-position change to report.
  const ledger = [
    payment({ paid_on: "2026-01-15", amount_cents: 487125 }),
    payment({ paid_on: "2026-02-10", amount_cents: -487125 }),
    payment({ paid_on: "2026-02-10", amount_cents: 487125 }),
  ];

  const jan = assemble(JAN, ledger);
  assert.equal(jan.ok, true);
  assert.equal(jan.rows.length, 1);
  assert.equal(jan.rows[0].countedOn, "2026-01-15");

  const feb = assemble(FEB, ledger);
  assert.equal(feb.ok, true);
  assert.equal(feb.rows.length, 0);

  const year = assemble(YEAR, ledger);
  assert.equal(year.ok, true);
  assert.equal(year.rows.length, 1);
  assert.equal(year.taxTotalCents, 37125);
});

test("re-paid on a later day: A keeps its row, B shows the negative, C shows the tax collected again", () => {
  // The first-crossing is recomputed on the corrected (current) ledger:
  // the earliest crossing is still 15 JAN, so A is untouched; the
  // un-settle and the re-settle each report where they happened, and the
  // whole-year net is the tax, counted once.
  const ledger = [
    payment({ paid_on: "2026-01-15", amount_cents: 487125 }),
    payment({ paid_on: "2026-02-10", amount_cents: -487125 }),
    payment({ paid_on: "2026-03-05", amount_cents: 487125 }),
  ];

  const jan = assemble(JAN, ledger);
  assert.equal(jan.ok, true);
  assert.deepEqual(
    jan.rows.map((r) => [r.kind, r.countedOn, r.taxCents]),
    [["collected", "2026-01-15", 37125]]
  );

  const feb = assemble(FEB, ledger);
  assert.equal(feb.ok, true);
  assert.deepEqual(
    feb.rows.map((r) => [r.kind, r.countedOn, r.taxCents]),
    [["correction", "2026-02-10", -37125]]
  );

  const mar = assemble(MAR, ledger);
  assert.equal(mar.ok, true);
  assert.deepEqual(
    mar.rows.map((r) => [r.kind, r.countedOn, r.taxCents]),
    [["collected", "2026-03-05", 37125]]
  );

  const year = assemble(YEAR, ledger);
  assert.equal(year.ok, true);
  assert.equal(year.rows.length, 3);
  assert.equal(year.taxTotalCents, 37125);
});

test("two payments reversed on different days: the tax corrects ONCE, on the day the ledger dropped below the total", () => {
  // $100.00 taxable at 7% → tax $7.00 → total $107.00, paid as $60.00 +
  // $47.00 the same day. Reversing the $60.00 un-settles it (one negative
  // row); reversing the $47.00 later changes nothing that was still
  // counted — no second correction row.
  const ledger = [
    payment({ paid_on: "2026-01-10", amount_cents: 6000 }),
    payment({ paid_on: "2026-01-10", amount_cents: 4700 }),
    payment({ paid_on: "2026-02-01", amount_cents: -6000 }),
    payment({ paid_on: "2026-03-01", amount_cents: -4700 }),
  ];
  const fixtures = {
    invoices: [invoice({ status: "sent", tax_rate_bps: 700 })],
    totals: [totals({ tax_cents: 700, total_cents: 10700 })],
    lines: [line({ amount_cents: 10000 })],
  };

  const year = assemble(YEAR, ledger, fixtures);
  assert.equal(year.ok, true);
  assert.deepEqual(
    year.rows.map((r) => [r.kind, r.countedOn, r.taxCents]),
    [
      ["collected", "2026-01-10", 700],
      ["correction", "2026-02-01", -700],
    ]
  );
  assert.equal(year.taxTotalCents, 0);

  const mar = assemble(MAR, ledger, fixtures);
  assert.equal(mar.ok, true);
  assert.equal(mar.rows.length, 0);
});

test("void invoices are excluded even when their ledger crossed — matching profit-loss's income rule", () => {
  const result = assemble(YEAR, [payment()], {
    invoices: [invoice({ status: "void" })],
  });
  assert.equal(result.ok, true);
  assert.equal(result.rows.length, 0);
  assert.equal(result.taxTotalCents, 0);
});

test("a settled invoice that charged no tax is counted, not listed", () => {
  const result = assemble(
    YEAR,
    [payment({ amount_cents: 450000 })],
    {
      invoices: [invoice({ tax_rate_bps: 0 })],
      totals: [totals({ tax_cents: 0, total_cents: 450000 })],
      lines: [],
    }
  );
  assert.equal(result.ok, true);
  assert.equal(result.rows.length, 0);
  assert.equal(result.untaxedPaidCount, 1);
});

test("the taxable subtotal sums taxable lines only", () => {
  // A day-rate line (taxable) plus a reimbursed expense (not taxable):
  // the base shown must be the taxable half, and the view's tax_cents is
  // computed from that same half. Total = 350000 + 48250 + 28875 tax.
  const result = assemble(
    YEAR,
    [payment({ amount_cents: 427125 })],
    {
      totals: [totals({ tax_cents: 28875, total_cents: 427125 })],
      lines: [
        line({ amount_cents: 350000, taxable: true }),
        line({ amount_cents: 48250, taxable: false }),
      ],
    }
  );
  assert.equal(result.ok, true);
  assert.equal(result.rows[0].taxableSubtotalCents, 350000);
  assert.equal(result.rows[0].taxCents, 28875);
});

test("rows sort by the date that put them in the period", () => {
  const result = assembleSalesTaxReport({
    period: YEAR,
    payments: [
      payment({ invoice_id: "inv-1", paid_on: "2026-02-01" }),
      payment({ invoice_id: "inv-2", paid_on: "2026-01-15", amount_cents: 107000 }),
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
    totals: [
      totals(),
      totals({ invoice_id: "inv-2", tax_cents: 7000, total_cents: 107000 }),
    ],
    lines: [line(), line({ invoice_id: "inv-2", amount_cents: 100000 })],
    clientNames: CLIENTS,
  });
  assert.equal(result.ok, true);
  assert.deepEqual(
    result.rows.map((r) => r.countedOn),
    ["2026-01-15", "2026-02-01"]
  );
  assert.equal(result.taxTotalCents, 37125 + 7000);
});

// ---------------------------------------------------------------------------
// Refusals: missing or irreconcilable figures never print as $0.00.
// ---------------------------------------------------------------------------

test("refuses when a ledger has no invoice row behind it", () => {
  const result = assemble(YEAR, [payment({ invoice_id: "inv-unknown" })], {
    invoices: [],
    totals: [],
    lines: [],
  });
  assert.equal(result.ok, false);
  assert.match(result.reason, /no invoice row/);
});

test("refuses when a candidate has no totals row — the crossing cannot be computed without a total", () => {
  const result = assemble(YEAR, [payment()], { totals: [] });
  assert.equal(result.ok, false);
  assert.match(result.reason, /no totals row/);
});

test("refuses when a taxed invoice has no line items loaded", () => {
  const result = assemble(YEAR, [payment()], { lines: [] });
  assert.equal(result.ok, false);
  assert.match(result.reason, /no line items/);
});

test("refuses when base x rate does not reproduce the view's tax_cents", () => {
  const result = assemble(YEAR, [payment()], {
    totals: [totals({ tax_cents: 37126 })], // off by one cent
  });
  assert.equal(result.ok, false);
  assert.match(result.reason, /does not reproduce/);
});

test("rounding matches the view: half-cents round away from zero", () => {
  // $6.00 taxable at 8.25% is 49.5 cents; pilot.invoice_totals' round()
  // (half away from zero on numeric) gives 50, and Math.round agrees for
  // the non-negative amounts these always are. 49 must refuse, 50 must
  // pass — pinning that the JS check can't drift a cent from Postgres.
  const fixture = (taxCents) =>
    assemble(YEAR, [payment({ amount_cents: 600 + taxCents })], {
      totals: [totals({ tax_cents: taxCents, total_cents: 600 + taxCents })],
      lines: [line({ amount_cents: 600 })],
    });
  assert.equal(fixture(50).ok, true);
  assert.equal(fixture(49).ok, false);
});

test("a client missing from the lookup renders as Unknown client, and the money still totals", () => {
  const result = assemble(YEAR, [payment()], {
    invoices: [invoice({ client_id: "client-gone" })],
  });
  assert.equal(result.ok, true);
  assert.equal(result.rows[0].clientName, "Unknown client");
  assert.equal(result.taxTotalCents, 37125);
});

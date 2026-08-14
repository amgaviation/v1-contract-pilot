import test from "node:test";
import assert from "node:assert/strict";

const { computeTripSettlement } = await import("../lib/trip-settlement.ts");

/**
 * lib/trip-settlement.ts's pure assembly. All fixtures synthetic.
 *
 * 1. EXPECTED IS lib/trip-value.ts's OWN NUMBER — pinned by feeding it day
 *    rows a human can hand-check, not by re-deriving the arithmetic here.
 * 2. LIVE-ONLY: a void invoice's day-money lines count as nothing invoiced.
 * 3. DRAFT IS A SUBSET, not an addend.
 * 4. PAYMENTS ARE INVOICE-LEVEL: summed only for invoices actually carrying
 *    this trip's day money, never allocated line by line.
 * 5. NOTHING GOES NEGATIVE: an invoice-level overpayment (covering a
 *    per-diem line the panel doesn't count) floors the unpaid balance at
 *    zero rather than printing a fabricated credit.
 * 6. OTHER CHARGES ON THE SAME INVOICE are flagged, never folded into the
 *    day-money total.
 */

const trip = { day_rate_cents: 0, day_count: 0, travel_day_rate_cents: null, travel_day_count: null };
const billable = new Map([["flight", true], ["off", false]]);

function dayRow(overrides) {
  return { day_type_id: "flight", rate_cents: 100000, quantity: 1, units: 1, ...overrides };
}

test("unbilled trip: nothing invoiced yet, full expected value is the remainder", () => {
  const s = computeTripSettlement({
    trip,
    dayRows: [dayRow(), dayRow()],
    billableByDayType: billable,
    lines: [],
    invoices: [],
    payments: [],
  });
  assert.equal(s.expectedCents, 200000);
  assert.equal(s.invoicedCents, 0);
  assert.equal(s.unbilledRemainderCents, 200000);
  assert.equal(s.paidCents, 0);
  assert.equal(s.unpaidBalanceCents, 0);
  assert.deepEqual(s.invoiceIds, []);
  assert.equal(s.invoiceLabel, null);
});

test("fully billed and unpaid: invoiced matches expected, remainder is zero, full balance owed", () => {
  const s = computeTripSettlement({
    trip,
    dayRows: [dayRow(), dayRow()],
    billableByDayType: billable,
    lines: [
      { invoice_id: "inv-1", line_type: "flight_day", amount_cents: 200000 },
    ],
    invoices: [{ id: "inv-1", status: "sent", invoice_number: "INV-0001" }],
    payments: [],
  });
  assert.equal(s.expectedCents, 200000);
  assert.equal(s.invoicedCents, 200000);
  assert.equal(s.unbilledRemainderCents, 0);
  assert.equal(s.paidCents, 0);
  assert.equal(s.unpaidBalanceCents, 200000);
  assert.deepEqual(s.invoiceIds, ["inv-1"]);
  assert.equal(s.invoiceLabel, "INV-0001");
});

test("fully paid: balance is zero once payments reach invoiced", () => {
  const s = computeTripSettlement({
    trip,
    dayRows: [dayRow()],
    billableByDayType: billable,
    lines: [{ invoice_id: "inv-1", line_type: "flight_day", amount_cents: 100000 }],
    invoices: [{ id: "inv-1", status: "sent", invoice_number: "INV-0002" }],
    payments: [{ invoice_id: "inv-1", amount_cents: 100000 }],
  });
  assert.equal(s.paidCents, 100000);
  assert.equal(s.unpaidBalanceCents, 0);
});

test("void invoice never counts as invoiced or paid", () => {
  const s = computeTripSettlement({
    trip,
    dayRows: [dayRow()],
    billableByDayType: billable,
    lines: [{ invoice_id: "inv-void", line_type: "flight_day", amount_cents: 100000 }],
    invoices: [{ id: "inv-void", status: "void", invoice_number: "INV-0003" }],
    payments: [{ invoice_id: "inv-void", amount_cents: 100000 }],
  });
  assert.equal(s.invoicedCents, 0);
  assert.equal(s.unbilledRemainderCents, 100000);
  assert.equal(s.paidCents, 0);
  assert.deepEqual(s.invoiceIds, []);
  assert.equal(s.invoiceLabel, null);
});

test("draft invoice money is a subset of invoiced, not an addend, and labels as a draft", () => {
  const s = computeTripSettlement({
    trip,
    dayRows: [dayRow()],
    billableByDayType: billable,
    lines: [{ invoice_id: "inv-draft", line_type: "travel_day", amount_cents: 50000 }],
    invoices: [{ id: "inv-draft", status: "draft", invoice_number: null }],
    payments: [],
  });
  assert.equal(s.invoicedCents, 50000);
  assert.equal(s.draftInvoicedCents, 50000);
  assert.equal(s.hasDraftMoney, true);
  assert.equal(s.invoiceLabel, "a draft invoice");
});

test("an invoice-level payment that exceeds this trip's day money floors the balance at zero, never negative", () => {
  const s = computeTripSettlement({
    trip,
    dayRows: [dayRow()],
    billableByDayType: billable,
    lines: [
      { invoice_id: "inv-1", line_type: "flight_day", amount_cents: 100000 },
      // a per-diem line on the same invoice — real money, not day money
      { invoice_id: "inv-1", line_type: "per_diem", amount_cents: 30000 },
    ],
    invoices: [{ id: "inv-1", status: "sent", invoice_number: "INV-0004" }],
    // client paid the whole invoice, day money + per diem together
    payments: [{ invoice_id: "inv-1", amount_cents: 130000 }],
  });
  assert.equal(s.invoicedCents, 100000);
  assert.equal(s.paidCents, 130000);
  assert.equal(s.unpaidBalanceCents, 0); // not -30000
  assert.equal(s.invoiceHasOtherCharges, true);
});

test("an invoice carrying only this trip's day money is flagged as exclusive", () => {
  const s = computeTripSettlement({
    trip,
    dayRows: [dayRow()],
    billableByDayType: billable,
    lines: [{ invoice_id: "inv-1", line_type: "flight_day", amount_cents: 100000 }],
    invoices: [{ id: "inv-1", status: "sent", invoice_number: "INV-0005" }],
    payments: [{ invoice_id: "inv-1", amount_cents: 40000 }],
  });
  assert.equal(s.invoiceHasOtherCharges, false);
  assert.equal(s.unpaidBalanceCents, 60000);
});

test("no day rows falls back to the scalar trip-value calculation, exactly as tripValueCents does", () => {
  const scalarTrip = {
    day_rate_cents: 350000,
    day_count: 2,
    travel_day_rate_cents: 100000,
    travel_day_count: 1,
  };
  const s = computeTripSettlement({
    trip: scalarTrip,
    dayRows: [],
    billableByDayType: billable,
    lines: [],
    invoices: [],
    payments: [],
  });
  assert.equal(s.expectedCents, 350000 * 2 + 100000 * 1);
});

test("payments on an unrelated invoice never leak into this trip's paid figure", () => {
  const s = computeTripSettlement({
    trip,
    dayRows: [dayRow()],
    billableByDayType: billable,
    lines: [{ invoice_id: "inv-1", line_type: "flight_day", amount_cents: 100000 }],
    invoices: [
      { id: "inv-1", status: "sent", invoice_number: "INV-0006" },
      { id: "inv-other", status: "sent", invoice_number: "INV-0007" },
    ],
    payments: [{ invoice_id: "inv-other", amount_cents: 999999 }],
  });
  assert.equal(s.paidCents, 0);
  assert.equal(s.unpaidBalanceCents, 100000);
});

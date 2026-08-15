import test from "node:test";
import assert from "node:assert/strict";

const {
  marginCents,
  rebillGapCents,
  effectiveDayQuantity,
  marginPerDayCents,
  assembleTripPL,
  resolveTripPLPeriod,
  isValidIsoDate,
  formatDayQuantity,
  formatMiles,
} = await import("../app/(app)/reports/trip-pl/report-lib.ts");

/**
 * The trip-profitability report. All fixtures synthetic.
 *
 * The behaviours that carry money-safety weight and get pinned hard:
 *
 * 1. MARGIN IS INTEGER CENTS: invoiced day money minus deductible
 *    expenses, and nothing else. Rebilled costs and their reimbursements
 *    (both legs), undecided receipts, mileage and revenue not tied to a
 *    trip are all outside it.
 *
 * 2. NEVER DIVIDE BY ZERO: a trip with no billable days has a NULL
 *    margin-per-day, not 0.00 and not Infinity. A cancellation fee with
 *    no days worked is the paradigm case — real margin, zero days.
 *
 * 3. THE PASS-THROUGH RECONCILES OR IT SHOWS: a rebill never invoiced is
 *    invisible in the margin by construction, so rebillGapCents has to
 *    surface it.
 *
 * 4. THE ASSEMBLY REFUSES — never fabricates — when a figure it must
 *    print is missing (a client name the read didn't return) or the
 *    inputs contradict themselves (draft money exceeding the total it is
 *    a subset of, a fanned-out duplicate trip, a non-numeric column).
 *    A margin is a SUBTRACTION: a short expense read inflates it, and an
 *    inflated margin looks like good news.
 */

// ---------------------------------------------------------------------------
// Fixture builders.
// ---------------------------------------------------------------------------

/** The canonical trip: 3 billable days, $9,000 invoiced, $450 deductible. */
function tripRow(overrides = {}) {
  return {
    trip_id: "trip-1",
    client_id: "client-1",
    trip_kind: "contract_pilot",
    trip_status: "completed",
    billing_state: "invoiced",
    starts_on: "2026-03-02",
    ends_on: "2026-03-04",
    aircraft_ident: "N123AB",
    invoiced_day_money_cents: 900000,
    draft_day_money_cents: 0,
    rebilled_cost_cents: 0,
    rebill_invoiced_cents: 0,
    deductible_cents: 45000,
    unassigned_cents: 0,
    day_quantity: 3,
    has_day_rows: true,
    scalar_day_count: 3,
    mileage_miles: 0,
    mileage_entry_count: 0,
    ...overrides,
  };
}

function unattributedRow(overrides = {}) {
  return {
    client_id: "client-1",
    unattributed_line_cents: 0,
    unattributed_line_count: 0,
    draft_unattributed_line_cents: 0,
    draft_unattributed_line_count: 0,
    ...overrides,
  };
}

const CLIENTS = new Map([
  ["client-1", "Meridian Air"],
  ["client-2", "Sierra Jet Management"],
]);

function assemble({ trips = [], unattributed = [], clientNames = CLIENTS } = {}) {
  return assembleTripPL({ trips, unattributed, clientNames });
}

/** Unwraps a successful assembly, failing loudly with the refusal reason
 *  if it refused — a refusal in a test that expected success is the most
 *  informative failure message available. */
function ok(assembly) {
  assert.equal(assembly.ok, true, `expected success, got refusal: ${assembly.reason}`);
  return assembly;
}

// ===========================================================================
// 1. Margin arithmetic — integer cents.
// ===========================================================================

test("marginCents is invoiced day money minus deductible expenses", () => {
  assert.equal(
    marginCents({ invoicedDayMoneyCents: 900000, deductibleExpenseCents: 45000 }),
    855000
  );
});

test("marginCents is exact integer arithmetic, never float", () => {
  // The classic float trap: 0.1 + 0.2 !== 0.3 in binary floating point.
  // In integer cents the equivalent figures are exact, and this pins that
  // the function never routes through a dollars round-trip.
  assert.equal(
    marginCents({ invoicedDayMoneyCents: 10, deductibleExpenseCents: 20 }),
    -10
  );
  assert.equal(
    marginCents({ invoicedDayMoneyCents: 333333333, deductibleExpenseCents: 111111111 }),
    222222222
  );
  // Every result is a safe integer, not a value carrying a fractional tail.
  const m = marginCents({ invoicedDayMoneyCents: 100001, deductibleExpenseCents: 33334 });
  assert.equal(m, 66667);
  assert.equal(Number.isInteger(m), true);
});

test("marginCents goes negative when a trip cost more than it billed", () => {
  // A real row, not an edge case: an unbilled trip carrying receipts.
  assert.equal(
    marginCents({ invoicedDayMoneyCents: 0, deductibleExpenseCents: 128900 }),
    -128900
  );
});

test("margin excludes both rebill legs, undecided receipts and mileage", () => {
  const { trips } = ok(
    assemble({
      trips: [
        tripRow({
          invoiced_day_money_cents: 900000,
          deductible_cents: 45000,
          // None of the following may move the margin.
          rebilled_cost_cents: 120000,
          rebill_invoiced_cents: 120000,
          unassigned_cents: 60000,
          mileage_miles: 210.4,
          mileage_entry_count: 2,
        }),
      ],
    })
  );
  assert.equal(trips[0].marginCents, 855000);
  // The excluded figures are still carried, visibly, alongside it.
  assert.equal(trips[0].rebilledCostCents, 120000);
  assert.equal(trips[0].rebillInvoicedCents, 120000);
  assert.equal(trips[0].unassignedExpenseCents, 60000);
  assert.equal(trips[0].mileageMiles, 210.4);
});

// ===========================================================================
// 2. Zero-day trips — never divide by zero.
// ===========================================================================

test("marginPerDayCents is null, not zero and not Infinity, at zero days", () => {
  assert.equal(marginPerDayCents(855000, 0), null);
  // Guard the actual hazard: `x / 0` is Infinity in JS and would render.
  assert.notEqual(marginPerDayCents(855000, 0), Infinity);
  assert.equal(marginPerDayCents(0, 0), null);
  assert.equal(marginPerDayCents(-50000, 0), null);
  // Negative or NaN denominators are refused the same way.
  assert.equal(marginPerDayCents(100, -1), null);
  assert.equal(marginPerDayCents(100, Number.NaN), null);
});

test("a zero-day trip with real margin reports the margin and a null per-day", () => {
  // The paradigm case: a cancellation fee billed against a trip that never
  // flew. Real money, no days — "margin per day" is a question that does
  // not apply, and answering 0.00 would be a fabricated figure.
  const { trips, totals } = ok(
    assemble({
      trips: [
        tripRow({
          invoiced_day_money_cents: 150000,
          deductible_cents: 0,
          day_quantity: 0,
          has_day_rows: false,
          scalar_day_count: 0,
        }),
      ],
    })
  );
  assert.equal(trips[0].marginCents, 150000);
  assert.equal(trips[0].dayQuantity, 0);
  assert.equal(trips[0].dayQuantitySource, "none");
  assert.equal(trips[0].marginPerDayCents, null);
  assert.equal(totals.marginPerDayCents, null);
});

test("a trip whose only day rows are non-billable keeps the day-grid source at zero days", () => {
  // has_day_rows true with a zero billable quantity must NOT fall back to
  // the scalar column — falling back would resurrect the number the day
  // grid deliberately replaced (lib/trip-value.ts's precedence rule).
  const { trips } = ok(
    assemble({
      trips: [tripRow({ day_quantity: 0, has_day_rows: true, scalar_day_count: 4 })],
    })
  );
  assert.equal(trips[0].dayQuantity, 0);
  assert.equal(trips[0].dayQuantitySource, "day_rows");
  assert.equal(trips[0].marginPerDayCents, null);
});

test("effectiveDayQuantity precedence: day rows win, scalar is the fallback", () => {
  assert.deepEqual(
    effectiveDayQuantity({ hasDayRows: true, dayQuantity: 2.5, scalarDayCount: 9 }),
    { quantity: 2.5, source: "day_rows" }
  );
  assert.deepEqual(
    effectiveDayQuantity({ hasDayRows: false, dayQuantity: 0, scalarDayCount: 4 }),
    { quantity: 4, source: "scalar" }
  );
  assert.deepEqual(
    effectiveDayQuantity({ hasDayRows: false, dayQuantity: 0, scalarDayCount: 0 }),
    { quantity: 0, source: "none" }
  );
});

test("margin per day divides by fractional day quantities exactly", () => {
  // 2.5 days is a shipped, documented feature (trips.day_count is
  // numeric(5,1)) — a half-day trip must divide, not truncate.
  assert.equal(marginPerDayCents(500000, 2.5), 200000);
  // 1.5 days at $855.00 total → $570.00/day.
  assert.equal(marginPerDayCents(85500, 1.5), 57000);
});

test("margin per day rounds half away from zero, symmetrically for gains and losses", () => {
  // Math.round would give -166 here and +167 for the positive twin,
  // treating a loss more kindly than an equal-sized gain. The report
  // rounds symmetrically instead.
  assert.equal(marginPerDayCents(333, 2), 167);
  assert.equal(marginPerDayCents(-333, 2), -167);
  // Result is always whole cents.
  assert.equal(Number.isInteger(marginPerDayCents(1000, 3)), true);
  assert.equal(marginPerDayCents(1000, 3), 333);
});

// ===========================================================================
// 3. Rebill-only trips — the pass-through.
// ===========================================================================

test("a rebill-only trip has zero margin: both legs are outside it", () => {
  const { trips, totals } = ok(
    assemble({
      trips: [
        tripRow({
          invoiced_day_money_cents: 0,
          deductible_cents: 0,
          rebilled_cost_cents: 82500,
          rebill_invoiced_cents: 82500,
          day_quantity: 0,
          has_day_rows: false,
          scalar_day_count: 0,
        }),
      ],
    })
  );
  assert.equal(trips[0].marginCents, 0);
  assert.equal(trips[0].rebillGapCents, 0);
  assert.equal(trips[0].marginPerDayCents, null);
  assert.equal(totals.marginCents, 0);
  // The legs are reported, not silently dropped.
  assert.equal(totals.rebilledCostCents, 82500);
  assert.equal(totals.rebillInvoicedCents, 82500);
});

test("a rebill never invoiced surfaces as a negative gap, invisible in the margin", () => {
  // This is the whole reason the gap is computed: the margin cannot move,
  // by construction, so without this figure the pilot's unrecovered
  // out-of-pocket money would appear nowhere at all.
  const { trips, totals } = ok(
    assemble({
      trips: [
        tripRow({
          invoiced_day_money_cents: 900000,
          deductible_cents: 0,
          rebilled_cost_cents: 82500,
          rebill_invoiced_cents: 0,
        }),
      ],
    })
  );
  assert.equal(trips[0].marginCents, 900000, "margin must not absorb the rebill");
  assert.equal(trips[0].rebillGapCents, -82500);
  assert.equal(totals.rebillGapCents, -82500);
});

test("a rebill invoiced short surfaces the shortfall, not the whole cost", () => {
  const { trips } = ok(
    assemble({
      trips: [
        tripRow({ rebilled_cost_cents: 82500, rebill_invoiced_cents: 60000 }),
      ],
    })
  );
  assert.equal(trips[0].rebillGapCents, -22500);
});

test("billing back more than the recorded receipts is a positive gap, also surfaced", () => {
  assert.equal(
    rebillGapCents({ rebillInvoicedCents: 90000, rebilledCostCents: 82500 }),
    7500
  );
});

// ===========================================================================
// 4. The assembly refuses rather than fabricating.
// ===========================================================================

test("refuses when a trip's client is missing from the clients read", () => {
  // A short clients read must not silently split one client's trips
  // across two rollup buckets under an "Unknown client" label.
  const assembly = assemble({
    trips: [tripRow({ client_id: "client-missing" })],
  });
  assert.equal(assembly.ok, false);
  assert.match(assembly.reason, /client-missing/);
  // Pinned on what the reason SAYS, not on one word of its phrasing:
  // the refusal must name the thing it will not do, so a reader knows a
  // rollup is missing rather than empty.
  assert.match(assembly.reason, /won't print a partial per-client rollup/i);
});

test("refuses when draft day money exceeds the total it is a subset of", () => {
  // draft_day_money_cents is the same filter plus status='draft'. If it
  // ever exceeds the total, the two filters have drifted and neither
  // figure can be trusted.
  const assembly = assemble({
    trips: [
      tripRow({ invoiced_day_money_cents: 100000, draft_day_money_cents: 200000 }),
    ],
  });
  assert.equal(assembly.ok, false);
  assert.match(assembly.reason, /reconcile/i);
});

test("refuses on a duplicated trip id — the fanned-out-join guard", () => {
  const assembly = assemble({ trips: [tripRow(), tripRow()] });
  assert.equal(assembly.ok, false);
  assert.match(assembly.reason, /twice|fanned/i);
});

test("refuses when a money column did not arrive as a number", () => {
  // Number(undefined) is NaN, which would propagate through every sum and
  // print "$NaN" rather than failing.
  const bad = tripRow();
  delete bad.deductible_cents;
  const assembly = assemble({ trips: [bad] });
  assert.equal(assembly.ok, false);
  assert.match(assembly.reason, /deductible_cents/);
});

test("the NaN guard covers every numeric column, including ones nothing prints yet", () => {
  // mileage_entry_count has no surface today. It is still checked, because
  // the guard's job is to make the FIRST surface that prints a column safe
  // — not to track which columns happen to be rendered this week.
  for (const column of [
    "invoiced_day_money_cents",
    "draft_day_money_cents",
    "rebilled_cost_cents",
    "rebill_invoiced_cents",
    "deductible_cents",
    "unassigned_cents",
    "day_quantity",
    "scalar_day_count",
    "mileage_miles",
    "mileage_entry_count",
  ]) {
    const bad = tripRow();
    delete bad[column];
    const assembly = assemble({ trips: [bad] });
    assert.equal(assembly.ok, false, `${column} was not guarded`);
    assert.match(assembly.reason, new RegExp(column));
  }
});

test("refuses when an unattributed line's client is missing from the clients read", () => {
  const assembly = assemble({
    trips: [],
    unattributed: [
      unattributedRow({ client_id: "client-ghost", unattributed_line_cents: 500000 }),
    ],
  });
  assert.equal(assembly.ok, false);
  assert.match(assembly.reason, /client-ghost/);
});

test("a trip with no client is a real state, not a refusal", () => {
  // pilot.trips.client_id is nullable — a trip with no client gets its own
  // honest bucket rather than being dropped or blamed on a short read.
  const { trips, clients } = ok(
    assemble({ trips: [tripRow({ client_id: null })] })
  );
  assert.equal(trips[0].clientId, null);
  assert.equal(clients.length, 1);
  assert.equal(clients[0].clientId, null);
  assert.equal(clients[0].tripCount, 1);
});

// ===========================================================================
// 5. Rollups reconcile to the rows above them.
// ===========================================================================

test("client rollups are the sum of their trip rows", () => {
  const { trips, clients, totals } = ok(
    assemble({
      trips: [
        tripRow({
          trip_id: "t1",
          client_id: "client-1",
          invoiced_day_money_cents: 900000,
          deductible_cents: 45000,
          day_quantity: 3,
        }),
        tripRow({
          trip_id: "t2",
          client_id: "client-1",
          invoiced_day_money_cents: 300000,
          deductible_cents: 12500,
          day_quantity: 1,
        }),
        tripRow({
          trip_id: "t3",
          client_id: "client-2",
          invoiced_day_money_cents: 600000,
          deductible_cents: 0,
          day_quantity: 2,
        }),
      ],
    })
  );

  const meridian = clients.find((c) => c.clientId === "client-1");
  assert.equal(meridian.tripCount, 2);
  assert.equal(meridian.invoicedDayMoneyCents, 1200000);
  assert.equal(meridian.deductibleExpenseCents, 57500);
  assert.equal(meridian.marginCents, 1142500);
  assert.equal(meridian.dayQuantity, 4);
  assert.equal(meridian.marginPerDayCents, 285625);

  // Every level reconciles to the one below it — a reader adding the
  // printed column by hand always lands on the printed subtotal.
  const tripMarginSum = trips.reduce((s, t) => s + t.marginCents, 0);
  const clientMarginSum = clients.reduce((s, c) => s + c.marginCents, 0);
  assert.equal(tripMarginSum, clientMarginSum);
  assert.equal(totals.marginCents, tripMarginSum);
  assert.equal(totals.tripCount, 3);
  assert.equal(totals.dayQuantity, 6);
});

test("day quantity sums without float noise", () => {
  // 0.1 + 0.2 = 0.30000000000000004 in JS. Three tenth-days must total a
  // clean 0.3, and the per-day division must not inherit the noise.
  const { totals, clients } = ok(
    assemble({
      trips: [
        tripRow({ trip_id: "t1", day_quantity: 0.1, invoiced_day_money_cents: 0, deductible_cents: 0 }),
        tripRow({ trip_id: "t2", day_quantity: 0.2, invoiced_day_money_cents: 0, deductible_cents: 0 }),
      ],
    })
  );
  assert.equal(totals.dayQuantity, 0.3);
  assert.equal(clients[0].dayQuantity, 0.3);
  assert.equal(formatDayQuantity(totals.dayQuantity), "0.3");
});

test("revenue not tied to a trip joins the client rollup without entering the margin", () => {
  // A monthly guarantee: real revenue, no trip, deliberately outside the
  // margin because splitting it across trips would invent an allocation.
  const { clients, totals } = ok(
    assemble({
      trips: [
        tripRow({ invoiced_day_money_cents: 900000, deductible_cents: 45000 }),
      ],
      unattributed: [
        unattributedRow({
          client_id: "client-1",
          unattributed_line_cents: 250000,
          unattributed_line_count: 1,
        }),
      ],
    })
  );
  const meridian = clients.find((c) => c.clientId === "client-1");
  assert.equal(meridian.unattributedLineCents, 250000);
  assert.equal(meridian.marginCents, 855000, "margin must exclude untied revenue");
  assert.equal(totals.unattributedLineCents, 250000);
  assert.equal(totals.marginCents, 855000);
});

test("a client with untied revenue but no trips in the period still gets a row", () => {
  // A monthly guarantee invoiced in a month the pilot flew nothing for
  // that client is exactly the case a guarantee exists to cover — dropping
  // the row would make the client's revenue vanish.
  const { clients } = ok(
    assemble({
      trips: [],
      unattributed: [
        unattributedRow({
          client_id: "client-2",
          unattributed_line_cents: 400000,
          unattributed_line_count: 1,
        }),
      ],
    })
  );
  assert.equal(clients.length, 1);
  assert.equal(clients[0].clientName, "Sierra Jet Management");
  assert.equal(clients[0].tripCount, 0);
  assert.equal(clients[0].unattributedLineCents, 400000);
  assert.equal(clients[0].marginCents, 0);
  assert.equal(clients[0].marginPerDayCents, null);
});

test("draft day money is carried as a subset and flagged, never added twice", () => {
  const { trips, totals } = ok(
    assemble({
      trips: [
        tripRow({ invoiced_day_money_cents: 900000, draft_day_money_cents: 300000 }),
      ],
    })
  );
  assert.equal(trips[0].invoicedDayMoneyCents, 900000);
  assert.equal(trips[0].draftDayMoneyCents, 300000);
  assert.equal(trips[0].hasDraftMoney, true);
  // The subset must not inflate the total it belongs to.
  assert.equal(totals.invoicedDayMoneyCents, 900000);
});

test("draft UNTIED revenue is an addend, not a subset — the opposite convention", () => {
  // The two draft figures on this report use OPPOSITE conventions, on
  // purpose, and confusing them double-counts money on screen:
  //
  //   draft_day_money_cents        — SUBSET of invoiced_day_money_cents
  //   draft_unattributed_line_cents — DISJOINT from unattributed_line_cents
  //
  // The untied pair is disjoint because pilot.client_unattributed_lines
  // splits it by invoice STATUS (`status <> 'draft'` on the dated bucket,
  // `status = 'draft'` on the other), not by whether issued_on is null —
  // a pilot can set a provisional issue date on an invoice that is still
  // a draft (updateInvoiceHeader), so a null-issued_on split would put
  // that line in BOTH buckets. The page and the CSV render these two as
  // "$X + $Y", so any overlap is money counted twice.
  const { clients, totals } = ok(
    assemble({
      trips: [],
      unattributed: [
        unattributedRow({
          client_id: "client-1",
          unattributed_line_cents: 250000,
          unattributed_line_count: 1,
          draft_unattributed_line_cents: 100000,
          draft_unattributed_line_count: 1,
        }),
      ],
    })
  );
  const client = clients.find((c) => c.clientId === "client-1");
  assert.equal(client.unattributedLineCents, 250000);
  assert.equal(client.draftUnattributedLineCents, 100000);
  // Carried side by side, never folded into one another: the sent figure
  // must not swallow the draft one, and neither may enter the margin.
  assert.equal(totals.unattributedLineCents, 250000);
  assert.equal(totals.draftUnattributedLineCents, 100000);
  assert.equal(totals.unattributedLineCount, 1);
  assert.equal(totals.draftUnattributedLineCount, 1);
  assert.equal(totals.marginCents, 0);
});

test("a draft-only client — untied revenue entirely on unsent invoices", () => {
  // The all-draft case: nothing sent in the period, so the dated bucket is
  // zero and the row exists only because of the draft column. It must
  // still get a row (the SQL's HAVING keeps it), and the zero must not be
  // read as "no untied revenue".
  const { clients, totals } = ok(
    assemble({
      trips: [],
      unattributed: [
        unattributedRow({
          client_id: "client-2",
          unattributed_line_cents: 0,
          unattributed_line_count: 0,
          draft_unattributed_line_cents: 175000,
          draft_unattributed_line_count: 2,
        }),
      ],
    })
  );
  assert.equal(clients.length, 1);
  assert.equal(clients[0].unattributedLineCents, 0);
  assert.equal(clients[0].draftUnattributedLineCents, 175000);
  assert.equal(totals.draftUnattributedLineCents, 175000);
  assert.equal(totals.draftUnattributedLineCount, 2);
});

test("an empty period assembles cleanly to zeroes and a null per-day", () => {
  const { trips, clients, totals } = ok(assemble({}));
  assert.deepEqual(trips, []);
  assert.deepEqual(clients, []);
  assert.equal(totals.tripCount, 0);
  assert.equal(totals.marginCents, 0);
  assert.equal(totals.marginPerDayCents, null);
});

// ===========================================================================
// 6. Period resolution.
// ===========================================================================

test("resolveTripPLPeriod defaults to the calendar year of today", () => {
  const p = resolveTripPLPeriod({}, "2026-08-13");
  assert.equal(p.kind, "year");
  assert.equal(p.start, "2026-01-01");
  assert.equal(p.end, "2026-12-31");
});

test("quarter and month bounds land on real month ends, including February", () => {
  assert.deepEqual(
    resolveTripPLPeriod({ kind: "quarter", year: "2026", quarter: "1" }, "2026-08-13"),
    { kind: "quarter", label: "Q1 2026", start: "2026-01-01", end: "2026-03-31" }
  );
  // A leap year — the arithmetic must not be a hardcoded 28.
  assert.equal(
    resolveTripPLPeriod({ kind: "month", year: "2028", month: "2" }, "2026-08-13").end,
    "2028-02-29"
  );
  assert.equal(
    resolveTripPLPeriod({ kind: "month", year: "2026", month: "2" }, "2026-08-13").end,
    "2026-02-28"
  );
});

test("month to date runs from the 1st through today", () => {
  const p = resolveTripPLPeriod({ kind: "mtd" }, "2026-08-13");
  assert.equal(p.start, "2026-08-01");
  assert.equal(p.end, "2026-08-13");
});

test("a reversed custom range is swapped, not rejected", () => {
  const p = resolveTripPLPeriod(
    { kind: "custom", start: "2026-06-30", end: "2026-06-01" },
    "2026-08-13"
  );
  assert.equal(p.start, "2026-06-01");
  assert.equal(p.end, "2026-06-30");
});

test("a shape-valid but impossible date is rejected by isValidIsoDate", () => {
  assert.equal(isValidIsoDate("2026-02-30"), false);
  assert.equal(isValidIsoDate("2026-13-01"), false);
  assert.equal(isValidIsoDate("2026-02-28"), true);
  assert.equal(isValidIsoDate("not-a-date"), false);
});

test("custom range falls back to the year when a bound is not a real date", () => {
  const p = resolveTripPLPeriod(
    { kind: "custom", year: "2026", start: "2026-02-30", end: "2026-06-01" },
    "2026-08-13"
  );
  assert.equal(p.start, "2026-01-01");
  assert.equal(p.end, "2026-06-01");
});

// ===========================================================================
// 7. Display helpers.
// ===========================================================================

test("formatDayQuantity prints clean day counts", () => {
  assert.equal(formatDayQuantity(3), "3");
  assert.equal(formatDayQuantity(2.5), "2.5");
  assert.equal(formatDayQuantity(0.30000000000000004), "0.3");
});

test("formatMiles prints one decimal, the scale the column stores", () => {
  assert.equal(formatMiles(210.44), "210.4");
  assert.equal(formatMiles(0), "0.0");
});

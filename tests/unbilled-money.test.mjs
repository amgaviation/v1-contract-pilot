import test from "node:test";
import assert from "node:assert/strict";

const {
  formatDays,
  pluralizeDays,
  daysSince,
  clientLabel,
  draftHref,
  draftAction,
  sortClientRows,
  clientRowsShortfallCents,
  clientRowsState,
  unbilledLede,
} = await import("../app/(app)/overview/unbilled-lib.ts");

const { tripValueCents } = await import("../lib/trip-value.ts");

/**
 * The Overview unbilled module's pure layer. All fixtures synthetic.
 *
 * WHAT IS AND IS NOT TESTED HERE. The money itself is computed in Postgres
 * (supabase/migrations/20260813010000_unbilled_money_reads.sql), and the
 * guarantee that the per-client rows sum to the headline total is
 * structural — unbilled_summary is defined as an aggregate over
 * unbilled_by_client, which is defined over unbilled_trip_money. No unit
 * test can or should re-derive that; a test that re-implemented the SQL
 * would just be a second definition of the number, which is the exact
 * defect the whole design avoids.
 *
 * What these tests pin is the layer between those rows and the screen,
 * where every failure is a SILENT WRONG NUMBER rather than a crash:
 *
 * 1. HALF DAYS SURVIVE. trip_days.quantity is numeric(3,1) and a half day
 *    is a shipped feature, so "6.5 unbilled trip days" must not render as
 *    "7" — that is a lie about money in the pilot's favour, which is the
 *    direction that gets believed and acted on.
 * 2. STALENESS IS CALENDAR MATH IN UTC, floored. A trip date is a calendar
 *    fact, not an instant (lib/format.ts), and a trip that ended 20 hours
 *    ago has been waiting 0 days.
 * 3. THE THREE CLIENT CASES stay three. "No client" (unassigned work) and
 *    "Unknown client" (a client row this read couldn't see) are different
 *    problems fixed in different places.
 * 4. THE LINK MATCHES ITS LABEL. /invoices/new takes exactly one param,
 *    `client`; the no-client bucket has no honest draft link at all.
 * 5. THE RECONCILIATION CHECK actually catches a truncated row set — it is
 *    the only signal that exists for that, since the Data API caps rows
 *    without erroring — and it tells truncation apart from read skew, which
 *    needs a different sentence and cannot be described as a capped list.
 * 6. THE SENTENCE never calls unassigned work a client, and never speaks
 *    at all when there is nothing unbilled.
 * 7. THE PARITY the migration claims between its `numeric` day money and
 *    lib/trip-value.ts's JavaScript is real. That one IS about the money,
 *    and it is not a second definition of it — see §7's own header.
 */

const money = (cents) => `$${(cents / 100).toFixed(2)}`;

function clientRow(overrides) {
  return {
    client_id: crypto.randomUUID(),
    client_name: "Meridian Air",
    trip_count: 1,
    billable_days: 1,
    day_value_cents: 0,
    rebill_expense_cents: 0,
    total_cents: 0,
    oldest_ends_on: "2026-08-01",
    ...overrides,
  };
}

function summaryRow(overrides) {
  return {
    client_count: 0,
    trip_count: 0,
    billable_days: 0,
    day_value_cents: 0,
    rebill_expense_cents: 0,
    total_cents: 0,
    oldest_ends_on: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 1. Half days survive the trip from numeric(3,1) to the screen.
// ---------------------------------------------------------------------------
test("formatDays keeps the half day and drops the pointless decimal", () => {
  assert.equal(formatDays(6), "6");
  assert.equal(formatDays(6.5), "6.5");
  assert.equal(formatDays(0), "0");
  assert.equal(formatDays(0.5), "0.5");
  // The column's own scale is one decimal; anything finer is float noise
  // from quantity * units and rounds to it rather than printing 6.2999999.
  assert.equal(formatDays(6.2999999), "6.3");
  assert.equal(formatDays(6.04), "6");
});

test("formatDays reads a numeric that arrived as a string", () => {
  // PostgREST may serialize `numeric` as a string. Number()-coercing at the
  // boundary is why this reads "6.5" rather than concatenating garbage.
  assert.equal(formatDays("6.5"), "6.5");
  assert.equal(formatDays("6"), "6");
});

test("formatDays refuses to print NaN as a day count", () => {
  assert.equal(formatDays(Number.NaN), "—");
  assert.equal(formatDays("not a number"), "—");
  assert.equal(formatDays(Number.POSITIVE_INFINITY), "—");
});

test("pluralizeDays pluralizes off the value, not off the formatted string", () => {
  assert.equal(pluralizeDays(1), "1 day");
  assert.equal(pluralizeDays("1"), "1 day");
  assert.equal(pluralizeDays(0), "0 days");
  assert.equal(pluralizeDays(0.5), "0.5 days");
  assert.equal(pluralizeDays(6.5), "6.5 days");
  // 1.0 is one day; 1.5 is not, even though both round-trip through a "1".
  assert.equal(pluralizeDays(1.5), "1.5 days");
});

// ---------------------------------------------------------------------------
// 2. Staleness: UTC, floored, never negative.
// ---------------------------------------------------------------------------
test("daysSince parses the date column as UTC midnight", () => {
  const now = Date.parse("2026-08-13T00:00:00Z");
  assert.equal(daysSince("2026-08-13", now), 0);
  assert.equal(daysSince("2026-08-12", now), 1);
  assert.equal(daysSince("2026-07-14", now), 30);
});

test("daysSince floors — 20 hours waiting is 0 days waiting", () => {
  const now = Date.parse("2026-08-13T20:00:00Z");
  assert.equal(daysSince("2026-08-13", now), 0);
  assert.equal(daysSince("2026-08-12", now), 1);
});

test("daysSince does not go negative for a trip that ends in the future", () => {
  // ends_on is in the future for a trip marked completed early. "Waiting
  // -3 days" is not a thing to print at a pilot.
  const now = Date.parse("2026-08-13T00:00:00Z");
  assert.equal(daysSince("2026-08-16", now), 0);
});

test("daysSince returns null rather than a number it cannot justify", () => {
  const now = Date.parse("2026-08-13T00:00:00Z");
  assert.equal(daysSince(null, now), null);
  assert.equal(daysSince(undefined, now), null);
  assert.equal(daysSince("", now), null);
  assert.equal(daysSince("not-a-date", now), null);
});

test("daysSince accepts a full timestamp and reads only the date part", () => {
  const now = Date.parse("2026-08-13T00:00:00Z");
  assert.equal(daysSince("2026-08-12T18:30:00+00:00", now), 1);
});

// ---------------------------------------------------------------------------
// 3. The three client cases stay three.
// ---------------------------------------------------------------------------
test("clientLabel tells 'no client' apart from 'client we could not read'", () => {
  assert.equal(clientLabel({ client_id: "c1", client_name: "Meridian Air" }), "Meridian Air");
  // The trip points at a client row this read could not see. Calling it
  // "No client" would assert the trip is unassigned — a different problem,
  // fixed on a different screen.
  assert.equal(clientLabel({ client_id: "c1", client_name: null }), "Unknown client");
  // Genuinely unassigned: real money that cannot be drafted until a client
  // is set.
  assert.equal(clientLabel({ client_id: null, client_name: null }), "No client");
});

// ---------------------------------------------------------------------------
// 4. The link matches its label.
// ---------------------------------------------------------------------------
test("draftHref uses the one search param /invoices/new actually reads", () => {
  assert.equal(draftHref("abc-123"), "/invoices/new?client=abc-123");
  assert.equal(draftAction("abc-123"), "Draft invoice");
});

test("the no-client bucket links somewhere it can actually be fixed", () => {
  // NOT /invoices/new: that flow drafts against one client, and these trips
  // have none, so it would open a draft that cannot contain them.
  assert.equal(draftHref(null), "/trips");
  assert.equal(draftAction(null), "Assign a client");
});

// ---------------------------------------------------------------------------
// 5. Ordering, and the reconciliation check.
// ---------------------------------------------------------------------------
test("sortClientRows puts the biggest unbilled balance first", () => {
  const rows = [
    clientRow({ client_name: "Small", total_cents: 100_00 }),
    clientRow({ client_name: "Big", total_cents: 900_00 }),
    clientRow({ client_name: "Middle", total_cents: 450_00 }),
  ];
  assert.deepEqual(
    sortClientRows(rows).map((r) => r.client_name),
    ["Big", "Middle", "Small"]
  );
});

test("sortClientRows breaks a tie on the older work, then on the label", () => {
  const rows = [
    clientRow({ client_name: "Bravo", total_cents: 500_00, oldest_ends_on: "2026-08-01" }),
    clientRow({ client_name: "Alpha", total_cents: 500_00, oldest_ends_on: "2026-08-01" }),
    clientRow({ client_name: "Stale", total_cents: 500_00, oldest_ends_on: "2026-05-01" }),
  ];
  assert.deepEqual(
    sortClientRows(rows).map((r) => r.client_name),
    ["Stale", "Alpha", "Bravo"]
  );
});

test("sortClientRows ranks the no-client bucket by size like any other", () => {
  // Deliberately NOT pinned to the bottom: it is real money, and burying it
  // understates a problem that blocks invoicing entirely.
  const rows = [
    clientRow({ client_name: "Meridian Air", total_cents: 200_00 }),
    clientRow({ client_id: null, client_name: null, total_cents: 800_00 }),
  ];
  assert.deepEqual(sortClientRows(rows).map(clientLabel), ["No client", "Meridian Air"]);
});

test("sortClientRows does not mutate the caller's read result", () => {
  const rows = [
    clientRow({ client_name: "Small", total_cents: 100_00 }),
    clientRow({ client_name: "Big", total_cents: 900_00 }),
  ];
  const before = rows.map((r) => r.client_name);
  sortClientRows(rows);
  assert.deepEqual(
    rows.map((r) => r.client_name),
    before
  );
});

test("clientRowsShortfallCents is zero when the rows arrived intact", () => {
  const rows = [
    clientRow({ total_cents: 300_00 }),
    clientRow({ total_cents: 540_00 }),
  ];
  const summary = summaryRow({ total_cents: 840_00, trip_count: 2 });
  assert.equal(clientRowsShortfallCents(summary, rows), 0);
});

test("clientRowsShortfallCents catches a row set capped in transit", () => {
  // The Data API caps rows without erroring, so the ONLY signal that the
  // breakdown is partial is that it no longer adds up to the total.
  const rows = [clientRow({ total_cents: 300_00 })];
  const summary = summaryRow({ total_cents: 840_00, trip_count: 2 });
  assert.equal(clientRowsShortfallCents(summary, rows), 540_00);
});

test("clientRowsShortfallCents survives numerics arriving as strings", () => {
  const rows = [clientRow({ total_cents: "30000" })];
  const summary = summaryRow({ total_cents: "84000" });
  assert.equal(clientRowsShortfallCents(summary, rows), 540_00);
});

test("clientRowsState calls an intact breakdown complete", () => {
  const rows = [
    clientRow({ total_cents: 300_00, trip_count: 1 }),
    clientRow({ total_cents: 540_00, trip_count: 1 }),
  ];
  const summary = summaryRow({ total_cents: 840_00, trip_count: 2, client_count: 2 });
  assert.equal(clientRowsState(summary, rows), "complete");
});

test("clientRowsState catches a capped row set that still balances on money", () => {
  // THE CASE THE MONEY COMPARISON ALONE MISSES. A client bucket can be worth
  // $0 — a grid of entirely non-billable days, or a trip whose rate was never
  // captured, with no rebillable receipts — so a cap landing exactly there
  // leaves the sums agreeing while the table is short a row and the lede's
  // "across N clients" undercounts. Those buckets are usually a setup gap the
  // pilot needs to see, which is the whole point of the module.
  const rows = [clientRow({ total_cents: 840_00, trip_count: 2 })];
  const summary = summaryRow({ total_cents: 840_00, trip_count: 3, client_count: 2 });
  assert.equal(clientRowsShortfallCents(summary, rows), 0);
  assert.equal(clientRowsState(summary, rows), "partial");
});

test("clientRowsState counts a missing zero-money bucket as partial", () => {
  const rows = [clientRow({ total_cents: 840_00, trip_count: 2 })];
  const summary = summaryRow({ total_cents: 840_00, trip_count: 2, client_count: 2 });
  assert.equal(clientRowsState(summary, rows), "partial");
});

test("clientRowsState refuses to call read skew a truncated list", () => {
  // The summary, the client rows and the trip rows are three PostgREST
  // requests and therefore three transactions. A write landing between them
  // — an invoice sent on a phone while Overview loads on a laptop — can leave
  // the rows claiming MORE than the total. Truncation cannot do that, so the
  // caller must not print "the client list came back incomplete", nor the
  // arithmetic it implies: "$900.00 of the $800.00 total".
  const rows = [
    clientRow({ total_cents: 500_00, trip_count: 1 }),
    clientRow({ total_cents: 400_00, trip_count: 1 }),
  ];
  const summary = summaryRow({ total_cents: 800_00, trip_count: 2, client_count: 2 });
  assert.ok(clientRowsShortfallCents(summary, rows) < 0);
  assert.equal(clientRowsState(summary, rows), "inconsistent");
});

test("clientRowsState treats an empty account as complete, not partial", () => {
  // Nothing unbilled is a real state, and the caller renders the empty state
  // from it. A zero summary against zero rows must not trip the caveat.
  assert.equal(clientRowsState(summaryRow({}), []), "complete");
});

// ---------------------------------------------------------------------------
// 6. The sentence.
// ---------------------------------------------------------------------------
test("unbilledLede is the roadmap's own sentence, computed", () => {
  const summary = summaryRow({
    trip_count: 4,
    billable_days: 6.5,
    rebill_expense_cents: 840_00,
    total_cents: 12_340_00,
  });
  assert.equal(
    unbilledLede(summary, 3, false, money),
    "6.5 unbilled trip days and $840.00 in unbilled reimbursables across 3 clients."
  );
});

test("unbilledLede says nothing at all when nothing is unbilled", () => {
  // The caller renders the empty state instead. Returning null rather than
  // "0 unbilled trip days and $0.00..." is what stops that branch being
  // forgotten.
  assert.equal(unbilledLede(summaryRow({ trip_count: 0 }), 0, false, money), null);
});

test("unbilledLede never counts unassigned work as a client", () => {
  const summary = summaryRow({
    trip_count: 4,
    billable_days: 6,
    rebill_expense_cents: 840_00,
  });
  // client_count from the database counts BUCKETS, one of which may be the
  // no-client bucket. Saying "across 3 clients" when one of the three is
  // nothing of the sort is a small lie a pilot reconciling against their
  // own client list catches immediately.
  assert.equal(
    unbilledLede(summary, 2, true, money),
    "6 unbilled trip days and $840.00 in unbilled reimbursables across 2 clients, plus work with no client assigned."
  );
});

test("unbilledLede handles work that has ONLY an unassigned bucket", () => {
  const summary = summaryRow({
    trip_count: 1,
    billable_days: 2,
    rebill_expense_cents: 0,
  });
  assert.equal(
    unbilledLede(summary, 0, true, money),
    "2 unbilled trip days and $0.00 in unbilled reimbursables on work with no client assigned."
  );
});

test("unbilledLede is singular where singular is correct", () => {
  const summary = summaryRow({
    trip_count: 1,
    billable_days: 1,
    rebill_expense_cents: 45_00,
  });
  assert.equal(
    unbilledLede(summary, 1, false, money),
    "1 unbilled trip day and $45.00 in unbilled reimbursables across 1 client."
  );
});

test("unbilledLede reads numerics that arrived as strings", () => {
  const summary = summaryRow({
    trip_count: "4",
    billable_days: "6.5",
    rebill_expense_cents: "84000",
  });
  assert.equal(
    unbilledLede(summary, 3, false, money),
    "6.5 unbilled trip days and $840.00 in unbilled reimbursables across 3 clients."
  );
});

// ---------------------------------------------------------------------------
// 7. THE JS/SQL ROUNDING PARITY THE MIGRATION CLAIMS.
//
// pilot.unbilled_trip_money prices a trip's days in exact `numeric`, and
// lib/trip-value.ts prices the SAME trip in JavaScript for the trips list and
// the trip detail, and createInvoiceDraft prices it a third time for the
// invoice. The migration's header asserts the three agree cent-for-cent on
// every value the schema can hold. These tests are what makes that assertion
// checkable rather than merely written down.
//
// THIS IS NOT A SECOND DEFINITION OF THE MONEY. The reference below is not a
// transcription of the SQL — it is exact rational arithmetic in BigInt,
// asserting a PROPERTY both implementations must have: round the EXACT
// decimal, half-up. That property is the whole of the parity claim, because
// the schema pins the scales (quantity numeric(3,1), units numeric(3,2), so
// quantity * units is an exact multiple of 0.001) and CHECKs pin the signs
// (all non-negative, so Postgres half-away-from-zero and JS half-up coincide).
//
// The float implementation this replaced fails these: 0.5 * 0.29 is
// 0.14499999999999999 as a double, which rounds to 0.14 while the exact 0.145
// rounds to 0.15 — $12.00 of disagreement at a $1,200 day rate between what
// Overview shows and what the invoice bills.
// ---------------------------------------------------------------------------

/** Cents for one (day type, rate) group, computed exactly. `rows` are
 * [quantity-in-tenths, units-in-hundredths] pairs. */
function exactGroupCents(rows, rateCents) {
  let thousandths = 0n;
  for (const [q10, u100] of rows) thousandths += BigInt(q10) * BigInt(u100);
  // round(sum, 2) — thousandths to hundredths, half up.
  const hundredths = (thousandths + 5n) / 10n;
  // round(qty * rate_cents) — invoice_lines.amount_cents' generated column.
  return Number((hundredths * BigInt(rateCents) + 50n) / 100n);
}

const BILLABLE = new Map([["dt", true]]);
const NO_SCALARS = {
  day_rate_cents: 0,
  day_count: 0,
  travel_day_rate_cents: null,
  travel_day_count: null,
};

const dayRow = (q10, u100, rateCents) => ({
  day_type_id: "dt",
  rate_cents: rateCents,
  quantity: q10 / 10,
  units: u100 / 100,
});

test("tripValueCents rounds the exact decimal at a .xx5 boundary, not the float", () => {
  // The worked example from the review: exact 0.145 days at $1,200/day.
  // Rounding the exact value gives 0.15 days = $180.00. Rounding the double
  // gives 0.14 = $168.00, which is what the invoice would then NOT bill.
  assert.equal(tripValueCents(NO_SCALARS, [dayRow(5, 29, 120_000)], BILLABLE), 18_000);
  // Two more of the ten single-row pairs inside the schema's CHECK bounds
  // where the double falls below the exact value.
  assert.equal(tripValueCents(NO_SCALARS, [dayRow(7, 35, 100_000)], BILLABLE), 25_000);
  assert.equal(tripValueCents(NO_SCALARS, [dayRow(1, 35, 100_000)], BILLABLE), 4_000);
});

test("tripValueCents matches exact decimal arithmetic on every schema-legal day row", () => {
  // quantity numeric(3,1) with CHECK 0 < q <= 1; units numeric(3,2) with
  // CHECK 0 < u <= 1 (20260807070000). Exhaustive over that domain, against
  // rates chosen to include odd cents and half-cent products.
  const rates = [1, 7, 50, 99, 150, 12_500, 120_000, 100_001];
  for (let q10 = 1; q10 <= 10; q10++) {
    for (let u100 = 1; u100 <= 100; u100++) {
      for (const rate of rates) {
        assert.equal(
          tripValueCents(NO_SCALARS, [dayRow(q10, u100, rate)], BILLABLE),
          exactGroupCents([[q10, u100]], rate),
          `q=${q10 / 10} units=${u100 / 100} rate=${rate}`
        );
      }
    }
  }
});

test("tripValueCents groups first and rounds once, exactly, over multi-row grids", () => {
  // A real trip is several rows in one group. Deterministic sweep rather than
  // random fixtures: roughly one in a hundred group sums lands on a boundary,
  // so a handful of hand-picked rows would miss the case entirely.
  const rates = [7, 99, 12_500, 120_000];
  for (let a = 1; a <= 10; a++) {
    for (let b = 1; b <= 100; b += 3) {
      for (let c = 1; c <= 100; c += 7) {
        const rows = [
          [a, b],
          [10 - (a % 10), c],
          [a, 101 - c],
        ];
        const rate = rates[(a + b + c) % rates.length];
        assert.equal(
          tripValueCents(
            NO_SCALARS,
            rows.map(([q10, u100]) => dayRow(q10, u100, rate)),
            BILLABLE
          ),
          exactGroupCents(rows, rate),
          `rows=${JSON.stringify(rows)} rate=${rate}`
        );
      }
    }
  }
});

test("the scalar fallback rounds each half exactly, like round(numeric)", () => {
  // day_count / travel_day_count are numeric(5,1), so rate * count is exact
  // in tenths of a cent and its .5 ties must round by the rule, not by where
  // the nearest double happens to fall.
  for (let rate = 0; rate < 250; rate++) {
    for (let c10 = 0; c10 <= 200; c10++) {
      const want = Number((BigInt(rate) * BigInt(c10) + 5n) / 10n);
      assert.equal(
        tripValueCents(
          { ...NO_SCALARS, day_rate_cents: rate, day_count: c10 / 10 },
          undefined,
          BILLABLE
        ),
        want,
        `rate=${rate} count=${c10 / 10}`
      );
    }
  }
});

test("tripValueCents keeps two rates for one day type as two groups", () => {
  // The same day type captured at two agreed rates is two invoice lines, so
  // it must be two roundings — collapsing them would round once against a
  // combined quantity and disagree with the invoice by cents.
  const rows = [dayRow(5, 29, 120_000), dayRow(5, 29, 100_000)];
  assert.equal(
    tripValueCents(NO_SCALARS, rows, BILLABLE),
    exactGroupCents([[5, 29]], 120_000) + exactGroupCents([[5, 29]], 100_000)
  );
});

test("a grid of only non-billable days is worth zero, never the scalars", () => {
  // lib/trip-value.ts branches on dayRows.length BEFORE filtering by
  // billable, and pilot.unbilled_trip_money branches on the raw existence of
  // any trip_days row for exactly this reason. Branching on the filtered set
  // would fall back to the scalar columns and bill days the pilot marked off.
  const offRows = [{ day_type_id: "off", rate_cents: 120_000, quantity: 1, units: 1 }];
  assert.equal(
    tripValueCents(
      { day_rate_cents: 120_000, day_count: 3, travel_day_rate_cents: null, travel_day_count: null },
      offRows,
      new Map([["off", false]])
    ),
    0
  );
});

test("a day row missing units reads as full rate, not NaN", () => {
  // units is optional on the type as a safety net: Number(undefined) is NaN,
  // which would NaN out an entire trip's value if a caller forgot to select
  // the column. Absent means 1.00 — what every row meant before it existed.
  assert.equal(
    tripValueCents(
      NO_SCALARS,
      [{ day_type_id: "dt", rate_cents: 120_000, quantity: 1 }],
      BILLABLE
    ),
    120_000
  );
});

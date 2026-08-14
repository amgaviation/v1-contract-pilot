import test from "node:test";
import assert from "node:assert/strict";

const { tripDayQuantity } = await import("../lib/trip-value.ts");

/**
 * tripDayQuantity — the P2 fix. Once a trip's day grid has rows, the
 * trip page's headline and the trips list's Days column must COUNT from
 * the grid, the same way they already PRICE from it (tripValueCents). A
 * value read from the grid next to a count still read from the legacy
 * day_count/travel_day_count scalars is the "two sources for one number"
 * defect this codebase already eradicated for money, reintroduced for
 * days — see this function's own header in lib/trip-value.ts.
 *
 * This mirrors pilot.trip_pl's day_quantity column exactly:
 * `round(sum(quantity * units) filter (where dt.billable), 2)` — summed
 * ONCE across every billable row (unlike tripValueCents' money, which
 * groups by (day_type_id, rate_cents) before rounding), then rounded once
 * at the end. THIS IS NOT A SECOND DEFINITION OF THE ARITHMETIC: the
 * reference below is exact BigInt arithmetic asserting the same property
 * dayQuantityThousandths/roundThousandthsToHundredths already carry —
 * round the EXACT decimal, half-up — over the schema's own domain
 * (quantity numeric(3,1), units numeric(3,2)).
 */

const BILLABLE = new Map([["flight", true], ["travel", true], ["off", false]]);

const row = (dayTypeId, q10, u100) => ({
  day_type_id: dayTypeId,
  rate_cents: 0, // irrelevant to a day COUNT
  quantity: q10 / 10,
  units: u100 / 100,
});

/** Exact days for a set of [quantity-in-tenths, units-in-hundredths]
 * pairs, summed once and rounded once to hundredths, half up — same
 * property as pilot.trip_pl's `round(sum(quantity * units), 2)`. */
function exactDayQuantity(pairs) {
  let thousandths = 0n;
  for (const [q10, u100] of pairs) thousandths += BigInt(q10) * BigInt(u100);
  const hundredths = (thousandths + 5n) / 10n; // round half up
  return Number(hundredths) / 100;
}

test("tripDayQuantity is 0 for a trip with no day rows", () => {
  assert.equal(tripDayQuantity(undefined, BILLABLE), 0);
  assert.equal(tripDayQuantity([], BILLABLE), 0);
});

test("tripDayQuantity sums a single billable row exactly", () => {
  // Half a day at half rate is still half a day of billable TIME — units
  // (a money fraction) still counts toward the day count, same as
  // pilot.trip_pl's day_quantity: quantity * units, not bare quantity.
  assert.equal(tripDayQuantity([row("flight", 5, 50)], BILLABLE), 0.25);
  assert.equal(
    tripDayQuantity([row("flight", 5, 50)], BILLABLE),
    exactDayQuantity([[5, 50]])
  );
});

test("tripDayQuantity excludes non-billable rows entirely, never falls back to scalars", () => {
  // A grid of only 'off' days has a real, billable day count of zero — not
  // "no grid, use the scalar day_count" (that branch lives in the caller,
  // on dayRows.length, not here) and not the off day's own quantity.
  const rows = [row("off", 10, 100), row("flight", 5, 100)];
  assert.equal(tripDayQuantity(rows, BILLABLE), 0.5);
});

test("tripDayQuantity rounds the exact decimal at a .xx5 boundary, not the float double", () => {
  // 0.5 * 0.29 is 0.14499999999999999 as a double (rounds to 0.14); the
  // exact decimal 0.145 rounds to 0.15 — the same worked example
  // tripValueCents' own parity tests use, restated for the day count.
  assert.equal(tripDayQuantity([row("flight", 5, 29)], BILLABLE), 0.15);
});

test("tripDayQuantity matches exact decimal arithmetic on every schema-legal (quantity, units) pair", () => {
  // quantity numeric(3,1) with CHECK 0 < q <= 1; units numeric(3,2) with
  // CHECK 0 < u <= 1 (20260807070000) — exhaustive over that domain.
  for (let q10 = 1; q10 <= 10; q10++) {
    for (let u100 = 1; u100 <= 100; u100++) {
      assert.equal(
        tripDayQuantity([row("flight", q10, u100)], BILLABLE),
        exactDayQuantity([[q10, u100]]),
        `q=${q10 / 10} units=${u100 / 100}`
      );
    }
  }
});

test("tripDayQuantity sums across multiple billable rows and rounds ONCE, at the end", () => {
  // Two rows of 0.125 exact days each: trip_pl deliberately rounds once
  // over the WHOLE sum (0.25), unlike the invoice/tripValueCents money
  // path, which would round each (day_type_id, rate_cents) group
  // separately and could total 0.13 + 0.13 = 0.26. This is the day-COUNT
  // rule, not the money rule — see this function's own header.
  const rows = [row("flight", 5, 25), row("travel", 5, 25)];
  assert.equal(tripDayQuantity(rows, BILLABLE), exactDayQuantity([[5, 25], [5, 25]]));
  assert.equal(tripDayQuantity(rows, BILLABLE), 0.25);
});

test("tripDayQuantity treats a missing units as full rate (1.00), not NaN", () => {
  // Same safety net as dayQuantityThousandths itself: units is optional on
  // the row type so an unupdated caller that forgot to select it doesn't
  // NaN out the whole count.
  assert.equal(
    tripDayQuantity([{ day_type_id: "flight", rate_cents: 0, quantity: 1 }], BILLABLE),
    1
  );
});

test("tripDayQuantity ignores a day type this billable map has never heard of (fails toward zero, not a crash)", () => {
  assert.equal(tripDayQuantity([row("unknown", 10, 100)], BILLABLE), 0);
});

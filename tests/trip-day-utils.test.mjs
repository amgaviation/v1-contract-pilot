import test from "node:test";
import assert from "node:assert/strict";

const { computeSeed, quantityToInput, enumerateDates } = await import(
  "../app/(app)/trips/day-utils.ts"
);

/**
 * The day grid's "1 day (custom)" defect. day-grid.tsx's QUANTITY_OPTIONS
 * keys its "Full day" choice on the string "1.0" (matching how a SAVED row
 * round-trips through quantityToInput, which renders with toFixed(1)) — but
 * every SEEDED or freshly-picked row used to default its quantity to the
 * bare string "1". quantityOptionsFor("1") doesn't find "1" among
 * QUANTITY_OPTIONS' values, so it silently appended a spurious
 * `{ value: "1", label: "1 day (custom)" }` entry instead of showing "Full
 * day" — on every seeded row, and on every row where a pilot had just
 * picked a day type, in the product's primary money-capture screen.
 *
 * These tests pin the fix at its SOURCE: every quantity default this file
 * hands to day-grid.tsx must equal "1.0", not "1", so it matches
 * QUANTITY_OPTIONS' own value and quantityOptionsFor() finds it without
 * inventing a custom entry.
 */

const FLIGHT = {
  id: "flight-id",
  key: "flight",
  default_rate_cents: null,
  default_units: null,
  archived_at: null,
  billable: true,
};
const TRAVEL = {
  id: "travel-id",
  key: "travel",
  default_rate_cents: null,
  default_units: null,
  archived_at: null,
  billable: true,
};

test("quantityToInput's blank/invalid fallback is '1.0', matching QUANTITY_OPTIONS' Full-day value", () => {
  assert.equal(quantityToInput(null), "1.0");
  assert.equal(quantityToInput(undefined), "1.0");
  assert.equal(quantityToInput(NaN), "1.0");
});

test("quantityToInput still round-trips a real stored quantity to one decimal place", () => {
  assert.equal(quantityToInput(1), "1.0");
  assert.equal(quantityToInput(0.5), "0.5");
});

test("computeSeed's whole flight-day rows carry quantity '1.0', never bare '1'", () => {
  const dates = enumerateDates("2026-08-04", "2026-08-05");
  const scalars = {
    dayRateCents: 100_000,
    dayCount: 2,
    travelDayRateCents: null,
    travelDayCount: 0,
  };
  const seed = computeSeed(dates, [FLIGHT], scalars);
  for (const date of dates) {
    assert.equal(seed.rows[date].quantity, "1.0", `row for ${date}`);
  }
});

test("computeSeed's whole travel-day rows carry quantity '1.0', never bare '1'", () => {
  const dates = enumerateDates("2026-08-04", "2026-08-06");
  const scalars = {
    dayRateCents: 100_000,
    dayCount: 0,
    travelDayRateCents: 50_000,
    travelDayCount: 2,
  };
  const seed = computeSeed(dates, [TRAVEL], scalars);
  // Travel splits front/back — both ends of the trip are travel days here.
  assert.equal(seed.rows[dates[0]].quantity, "1.0");
  assert.equal(seed.rows[dates[dates.length - 1]].quantity, "1.0");
});

test("computeSeed's unfilled placeholder rows also default to '1.0'", () => {
  // No day types passed in at all: every row falls through to the blank
  // placeholder this file seeds up front, before the travel/flight loops
  // ever run.
  const dates = enumerateDates("2026-08-04", "2026-08-05");
  const seed = computeSeed(dates, [], {
    dayRateCents: 0,
    dayCount: 0,
    travelDayRateCents: null,
    travelDayCount: 0,
  });
  for (const date of dates) {
    assert.equal(seed.rows[date].quantity, "1.0", `row for ${date}`);
  }
});

test("computeSeed's fractional leftover row still uses quantityToInput, unaffected by the fix", () => {
  const dates = enumerateDates("2026-08-04", "2026-08-06");
  const seed = computeSeed(dates, [FLIGHT], {
    dayRateCents: 100_000,
    dayCount: 2.5,
    travelDayRateCents: null,
    travelDayCount: 0,
  });
  const quantities = dates.map((d) => seed.rows[d].quantity).sort();
  // Two whole days ("1.0") and one half day ("0.5").
  assert.deepEqual(quantities, ["0.5", "1.0", "1.0"]);
});

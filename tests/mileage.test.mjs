import test from "node:test";
import assert from "node:assert/strict";

const { computeYearTotals, scheduleCMileageCents } = await import("../lib/mileage.ts");

/**
 * The standard mileage deduction. All fixtures synthetic.
 *
 * Schedule C wants total business miles for the year multiplied by that
 * year's rate — one multiplication, one rounding. Summing N per-row
 * roundings is a different, larger number, and this product showed the
 * correct one on /expenses/mileage and the inflated one on the report that
 * goes to the accountant.
 */

test("rounding once is not the same as summing roundings", () => {
  // 12.5 mi x 65.0 cents is exactly 812.5, which rounds UP every time —
  // so the per-row error compounds in one direction and grows with the
  // number of drives.
  const entries = Array.from({ length: 250 }, () => ({ drove_on: "2026-04-01", miles: 12.5 }));
  const perRow = entries.reduce((sum, e) => sum + Math.round(e.miles * 65), 0);
  const once = scheduleCMileageCents(entries, { 2026: 65 }).amountCents;

  assert.equal(perRow, 203250, "$2,032.50 — what summing stored amounts gave");
  assert.equal(once, 203125, "$2,031.25 — total miles x rate, rounded once");
  assert.equal(perRow - once, 125, "a $1.25 overstatement on 250 drives");
});

test("every surface computing this gets the same number", () => {
  const entries = [
    { drove_on: "2026-01-15", miles: 42.4 },
    { drove_on: "2026-06-02", miles: 17.6 },
  ];
  const rates = { 2026: 67 };
  // The mileage screen reads computeYearTotals; the P&L reads
  // scheduleCMileageCents. They must not be able to disagree.
  assert.equal(
    computeYearTotals(entries, rates)[0].amountCents,
    scheduleCMileageCents(entries, rates).amountCents
  );
});

test("each tax year uses its own rate", () => {
  // The IRS rate changes annually, so blending two years' miles under one
  // rate is wrong the moment a report spans a year boundary.
  const entries = [
    { drove_on: "2025-12-31", miles: 100 },
    { drove_on: "2026-01-01", miles: 100 },
  ];
  const totals = computeYearTotals(entries, { 2025: 67, 2026: 70 });
  assert.deepEqual(
    totals.map((t) => [t.year, t.amountCents]),
    [
      [2026, 7000],
      [2025, 6700],
    ]
  );
});

test("a year with no rate on file contributes nothing, and says how much", () => {
  // Inventing a rate would misstate a tax figure; silently dropping the
  // miles would understate the deduction with no clue why.
  const entries = [
    { drove_on: "2026-04-01", miles: 200 },
    { drove_on: "2025-04-01", miles: 400 },
  ];
  const r = scheduleCMileageCents(entries, { 2026: 65 });
  assert.equal(r.amountCents, 13000);
  assert.equal(r.milesWithoutRate, 400);
});

test("the year comes from the date string, never a Date parse", () => {
  // A Date parse of a bare "YYYY-MM-DD" is UTC midnight, which is the
  // previous year in any negative-offset timezone for Jan 1.
  const totals = computeYearTotals([{ drove_on: "2026-01-01", miles: 10 }], { 2026: 65 });
  assert.equal(totals[0].year, 2026);
  assert.equal(totals[0].amountCents, 650);
});

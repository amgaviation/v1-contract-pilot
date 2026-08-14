import test from "node:test";
import assert from "node:assert/strict";

const {
  flightTimeWindows,
  quarterStartIso,
  previousQuarterStartIso,
  previousDayIso,
  entryFlightHours,
  computeFlightTimeReport,
} = await import("../app/(app)/reports/flight-time/report-lib.ts");

/**
 * The cross-operator flight-time report (14 CFR 135.267 windows — see
 * report-lib.ts's header for the verified reg text). All fixtures
 * synthetic.
 *
 * What carries weight here:
 * 1. WINDOW ARITHMETIC is calendar-exact: quarter starts, the
 *    two-consecutive-quarters window crossing a year boundary in Q1, and
 *    the previous-day computation across month/year/leap boundaries.
 * 2. SIMULATOR TIME never counts — the same greatest(total - sim, 0)
 *    arithmetic as pilot.logbook_totals, so the two surfaces cannot
 *    disagree.
 * 3. HONEST DEGRADATION: an empty logbook produces NO figures (never a
 *    page of 0.0s), and a window opening before the logbook's earliest
 *    entry is flagged with that date rather than presented as verified.
 */

function entry(overrides = {}) {
  return {
    entry_date: "2026-08-01",
    total_time: 2.5,
    simulator_time: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Window arithmetic.
// ---------------------------------------------------------------------------

test("quarter starts land on Jan/Apr/Jul/Oct 1", () => {
  assert.equal(quarterStartIso("2026-01-01"), "2026-01-01");
  assert.equal(quarterStartIso("2026-03-31"), "2026-01-01");
  assert.equal(quarterStartIso("2026-05-15"), "2026-04-01");
  assert.equal(quarterStartIso("2026-08-12"), "2026-07-01");
  assert.equal(quarterStartIso("2026-12-31"), "2026-10-01");
});

test("the previous quarter crosses the year boundary from Q1", () => {
  assert.equal(previousQuarterStartIso("2026-02-15"), "2025-10-01");
  assert.equal(previousQuarterStartIso("2026-08-12"), "2026-04-01");
});

test("previousDayIso handles month, year, and leap boundaries", () => {
  assert.equal(previousDayIso("2026-08-12"), "2026-08-11");
  assert.equal(previousDayIso("2026-01-01"), "2025-12-31");
  assert.equal(previousDayIso("2026-03-01"), "2026-02-28");
  assert.equal(previousDayIso("2028-03-01"), "2028-02-29"); // leap year
});

test("the four windows are exactly 135.267's, ending today", () => {
  const windows = flightTimeWindows("2026-08-12");
  assert.deepEqual(
    windows.map((w) => [w.key, w.from, w.to]),
    [
      ["trailing24h", "2026-08-10", "2026-08-12"],
      ["quarter", "2026-07-01", "2026-08-12"],
      ["twoQuarters", "2026-04-01", "2026-08-12"],
      ["year", "2026-01-01", "2026-08-12"],
    ]
  );
  // Each window names its paragraph — a citation, not a verdict.
  assert.match(windows[0].citation, /135\.267\(b\)/);
  assert.match(windows[1].citation, /135\.267\(a\)\(1\)/);
  assert.match(windows[2].citation, /135\.267\(a\)\(2\)/);
  assert.match(windows[3].citation, /135\.267\(a\)\(3\)/);
});

test("windows refuse a malformed date instead of computing nonsense", () => {
  assert.throws(() => flightTimeWindows("garbage"));
});

test("the trailing window is three calendar days, not two, so it can't miss local-date flying inside the last 24 hours", () => {
  // Regression for the P1: a pilot who logs LOCAL dates (not UTC) can fly
  // within the preceding 24 clock hours on a date one earlier than
  // yesterday-UTC — e.g. now = Aug 14 01:00Z (Aug 13 15:00 HST), a flight
  // flown Aug 12 16:00-18:00 HST is 21 clock-hours ago but dates Aug 12,
  // which a two-day UTC window (Aug 13-14) would have excluded.
  const windows = flightTimeWindows("2026-08-14");
  const trailing = windows.find((w) => w.key === "trailing24h");
  assert.equal(trailing.from, "2026-08-12");
  assert.equal(trailing.to, "2026-08-14");
  assert.equal(trailing.label, "Last three calendar days");
});

// ---------------------------------------------------------------------------
// Entry hours.
// ---------------------------------------------------------------------------

test("simulator time is excluded, and a sim-heavy bad row cannot go negative", () => {
  assert.equal(entryFlightHours(entry({ total_time: 3.0, simulator_time: 1.0 })), 2.0);
  assert.equal(entryFlightHours(entry({ total_time: 2.0, simulator_time: 2.0 })), 0);
  assert.equal(entryFlightHours(entry({ total_time: 1.5, simulator_time: 2.0 })), 0);
  assert.equal(entryFlightHours(entry({ total_time: 2.5, simulator_time: null })), 2.5);
});

// ---------------------------------------------------------------------------
// Report computation.
// ---------------------------------------------------------------------------

const WINDOWS = flightTimeWindows("2026-08-12");

test("an empty logbook yields no figures — never a page of verified-looking 0.0s", () => {
  const result = computeFlightTimeReport([], WINDOWS, null);
  assert.equal(result.ok, false);
  assert.equal(result.reason, "empty-logbook");
});

test("entries bucket into every window containing their date, boundaries inclusive", () => {
  const result = computeFlightTimeReport(
    [
      entry({ entry_date: "2026-08-12", total_time: 1.2 }), // all four
      entry({ entry_date: "2026-07-01", total_time: 2.0 }), // quarter start, inclusive
      entry({ entry_date: "2026-04-10", total_time: 3.0 }), // two-quarters + year
      entry({ entry_date: "2026-01-15", total_time: 4.0 }), // year only
      entry({ entry_date: "2025-12-30", total_time: 9.9 }), // outside every window
    ],
    WINDOWS,
    "2025-01-01"
  );
  assert.equal(result.ok, true);
  const byKey = new Map(result.figures.map((f) => [f.window.key, f]));
  assert.equal(byKey.get("trailing24h").hours, 1.2);
  assert.equal(byKey.get("quarter").hours, 3.2);
  assert.equal(byKey.get("twoQuarters").hours, 6.2);
  assert.equal(byKey.get("year").hours, 10.2);
  assert.equal(byKey.get("year").entryCount, 4);
});

test("summing tenths cannot leak float dust into a printed figure", () => {
  const result = computeFlightTimeReport(
    [
      entry({ entry_date: "2026-08-11", total_time: 1.1 }),
      entry({ entry_date: "2026-08-12", total_time: 2.2 }),
    ],
    WINDOWS,
    "2026-01-01"
  );
  assert.equal(result.ok, true);
  const trailing = result.figures.find((f) => f.window.key === "trailing24h");
  assert.equal(trailing.hours, 3.3); // not 3.3000000000000003
});

test("simulator-only entries contribute neither hours nor an entry count", () => {
  const result = computeFlightTimeReport(
    [
      entry({ entry_date: "2026-08-12", total_time: 2.0, simulator_time: 2.0 }),
      entry({ entry_date: "2026-08-12", total_time: 1.5 }),
    ],
    WINDOWS,
    "2026-01-01"
  );
  assert.equal(result.ok, true);
  const trailing = result.figures.find((f) => f.window.key === "trailing24h");
  assert.equal(trailing.hours, 1.5);
  assert.equal(trailing.entryCount, 1);
});

test("a window opening before the logbook's earliest entry is flagged, not presented as verified", () => {
  const result = computeFlightTimeReport(
    [entry({ entry_date: "2026-08-01" })],
    WINDOWS,
    "2026-03-15" // logbook starts mid-Q1
  );
  assert.equal(result.ok, true);
  const byKey = new Map(result.figures.map((f) => [f.window.key, f]));
  // Year window opened Jan 1 — before coverage — so it carries the gap.
  assert.equal(byKey.get("year").coverageGapFrom, "2026-03-15");
  // The current quarter opened Jul 1, inside coverage — no flag.
  assert.equal(byKey.get("quarter").coverageGapFrom, null);
  assert.equal(byKey.get("trailing24h").coverageGapFrom, null);
});

test("a zero-hour window inside full coverage is a genuine 0.0, flagged complete", () => {
  const result = computeFlightTimeReport(
    [entry({ entry_date: "2026-02-01", total_time: 5.0 })],
    WINDOWS,
    "2025-01-01"
  );
  assert.equal(result.ok, true);
  const trailing = result.figures.find((f) => f.window.key === "trailing24h");
  assert.equal(trailing.hours, 0);
  assert.equal(trailing.entryCount, 0);
  assert.equal(trailing.coverageGapFrom, null);
});

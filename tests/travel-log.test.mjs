import test from "node:test";
import assert from "node:assert/strict";

const { assembleTravelLog } = await import(
  "../app/(app)/reports/year-end/travel-log.ts"
);

/**
 * The year-end travel log. All fixtures synthetic.
 *
 * What carries weight here:
 * 1. PER-DIEM IS AN AND: counts_for_per_diem (day type) AND away (day) —
 *    the same rule the invoice draft applies. Either alone is not a
 *    per-diem day.
 * 2. NO DOLLAR FIGURES EXIST in the assembly at all — day counts only;
 *    the M&IE rate is the preparer's to apply (see travel-log.ts header).
 *    Asserted structurally: no row and no summary field carries cents.
 * 3. CANCELED TRIPS are excluded but COUNTED — never silently dropped
 *    from a document headed for a tax preparer.
 * 4. The assembly REFUSES on a partial join (missing trip / day type)
 *    rather than printing a log that looks complete.
 */

function day(overrides = {}) {
  return {
    id: "day-1",
    trip_id: "trip-1",
    day_on: "2026-03-10",
    day_type_id: "dt-flight",
    away: true,
    ...overrides,
  };
}

function trip(overrides = {}) {
  return {
    id: "trip-1",
    client_id: "client-1",
    status: "completed",
    aircraft_ident: "N123AB",
    ...overrides,
  };
}

const DAY_TYPES = [
  { id: "dt-flight", label: "Flight day", counts_for_per_diem: true },
  { id: "dt-travel", label: "Travel day", counts_for_per_diem: true },
  { id: "dt-office", label: "Office day", counts_for_per_diem: false },
];

const CLIENTS = new Map([["client-1", "Meridian Air Charter"]]);

function assemble(input) {
  return assembleTravelLog({
    tripDays: [],
    trips: [],
    dayTypes: DAY_TYPES,
    legs: [],
    clientNames: CLIENTS,
    ...input,
  });
}

test("builds one row per trip day with the day's route from its legs, in flown order", () => {
  const result = assemble({
    tripDays: [day()],
    trips: [trip()],
    legs: [
      // Return leg first in arrival order — out_at must decide the order.
      {
        id: "leg-2",
        trip_id: "trip-1",
        leg_date: "2026-03-10",
        from_icao: "KPBI",
        to_icao: "KTEB",
        out_at: "2026-03-10T21:00:00Z",
      },
      {
        id: "leg-1",
        trip_id: "trip-1",
        leg_date: "2026-03-10",
        from_icao: "KTEB",
        to_icao: "KPBI",
        out_at: "2026-03-10T13:00:00Z",
      },
    ],
  });
  assert.equal(result.ok, true);
  assert.equal(result.rows.length, 1);
  const row = result.rows[0];
  assert.equal(row.dayOn, "2026-03-10");
  assert.equal(row.clientName, "Meridian Air Charter");
  assert.equal(row.dayTypeLabel, "Flight day");
  assert.equal(row.route, "KTEB–KPBI · KPBI–KTEB");
  assert.equal(row.aircraftIdent, "N123AB");
});

test("a day with no legs has a null route, not an invented one", () => {
  const result = assemble({
    tripDays: [day({ day_type_id: "dt-travel" })],
    trips: [trip()],
  });
  assert.equal(result.ok, true);
  assert.equal(result.rows[0].route, null);
});

test("a leg missing an end prints an em dash for it rather than guessing", () => {
  const result = assemble({
    tripDays: [day()],
    trips: [trip()],
    legs: [
      {
        id: "leg-1",
        trip_id: "trip-1",
        leg_date: "2026-03-10",
        from_icao: "KTEB",
        to_icao: null,
        out_at: null,
      },
    ],
  });
  assert.equal(result.ok, true);
  assert.equal(result.rows[0].route, "KTEB–—");
});

test("per diem requires away AND a per-diem day type — either alone is not enough", () => {
  const result = assemble({
    tripDays: [
      day({ id: "d1", day_on: "2026-03-10", away: true, day_type_id: "dt-flight" }),
      day({ id: "d2", day_on: "2026-03-11", away: false, day_type_id: "dt-flight" }),
      day({ id: "d3", day_on: "2026-03-12", away: true, day_type_id: "dt-office" }),
    ],
    trips: [trip()],
  });
  assert.equal(result.ok, true);
  assert.deepEqual(
    result.rows.map((r) => r.perDiemDay),
    [true, false, false]
  );
  assert.equal(result.awayDayCount, 2); // d1 and d3 are away
  assert.equal(result.perDiemDayCount, 1); // only d1 satisfies the AND
});

test("no dollar figure exists anywhere in the assembly", () => {
  const result = assemble({ tripDays: [day()], trips: [trip()] });
  assert.equal(result.ok, true);
  const keys = [
    ...Object.keys(result),
    ...Object.keys(result.rows[0]),
  ].join(" ");
  assert.ok(
    !/cents|amount|rate|dollar/i.test(keys),
    `travel log must carry day counts only, found a money-shaped field in: ${keys}`
  );
});

test("days on canceled trips are excluded but counted, never silently dropped", () => {
  const result = assemble({
    tripDays: [
      day({ id: "d1", trip_id: "trip-1" }),
      day({ id: "d2", trip_id: "trip-cx", day_on: "2026-05-02" }),
      day({ id: "d3", trip_id: "trip-cx", day_on: "2026-05-03" }),
    ],
    trips: [trip(), trip({ id: "trip-cx", status: "canceled" })],
  });
  assert.equal(result.ok, true);
  assert.equal(result.rows.length, 1);
  assert.equal(result.canceledDayCount, 2);
});

test("refuses on a day whose trip the trips read didn't return", () => {
  const result = assemble({ tripDays: [day()], trips: [] });
  assert.equal(result.ok, false);
  assert.match(result.reason, /partial travel log/);
});

test("refuses on a day whose day type the read didn't return", () => {
  const result = assemble({
    tripDays: [day({ day_type_id: "dt-missing" })],
    trips: [trip()],
  });
  assert.equal(result.ok, false);
  assert.match(result.reason, /day type/);
});

test("clientless trips and unknown clients are labeled, not conflated", () => {
  const result = assemble({
    tripDays: [
      day({ id: "d1", trip_id: "trip-own" }),
      day({ id: "d2", trip_id: "trip-unknown", day_on: "2026-03-11" }),
    ],
    trips: [
      trip({ id: "trip-own", client_id: null }),
      trip({ id: "trip-unknown", client_id: "client-gone" }),
    ],
  });
  assert.equal(result.ok, true);
  const names = result.rows.map((r) => r.clientName);
  assert.deepEqual(names, ["No client", "Unknown client"]);
});

test("rows sort by date first, so the log reads as a calendar", () => {
  const result = assemble({
    tripDays: [
      day({ id: "d2", day_on: "2026-07-04" }),
      day({ id: "d1", day_on: "2026-01-15" }),
      day({ id: "d3", day_on: "2026-03-10" }),
    ],
    trips: [trip()],
  });
  assert.equal(result.ok, true);
  assert.deepEqual(
    result.rows.map((r) => r.dayOn),
    ["2026-01-15", "2026-03-10", "2026-07-04"]
  );
});

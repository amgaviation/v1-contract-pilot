import test from "node:test";
import assert from "node:assert/strict";

const { draftPayloadForLeg } = await import("../app/(app)/logbook/db.ts");

/**
 * Trip leg -> logbook draft. All fixtures synthetic.
 *
 * This exists because the product's PRIMARY path — log the trip, confirm
 * the drafts — used to write a logbook whose day takeoff and landing
 * counts were zero on every trip-derived entry, because pilot.trip_legs
 * had nowhere to record them. The draft was right to refuse to invent
 * them; the leg form was what needed fixing.
 *
 * Reg text verified against govinfo (14 CFR part 61) on 2026-08-10:
 * 61.57(a)(1) counts three takeoffs AND three landings in the preceding
 * 90 days, full stop only for tailwheel airplanes; 61.51(b)(3) names
 * actual and simulated instrument as two separate conditions of flight.
 */

const TRIP = { id: "t", aircraft_ident: "N447SP", aircraft_type: "C560" };
const LEG = {
  id: "l",
  trip_id: "t",
  leg_date: "2026-03-15",
  from_icao: "KTEB",
  to_icao: "KBED",
  block_hours: 2.1,
  night_hours: 0,
  instrument_hours: null,
  instrument_actual_hours: 0.4,
  instrument_simulated_hours: 0.6,
  cross_country_hours: 1.8,
  day_takeoffs: 2,
  day_landings: 2,
  day_landings_full_stop: 1,
  night_takeoffs: 0,
  night_landings_full_stop: 0,
  night_landings_touch_go: 0,
  approaches: 1,
  holds: 0,
};

test("a confirmed trip leg no longer lands in the logbook with structural zeros", async (t) => {
  const d = draftPayloadForLeg(TRIP, LEG, "PIC");

  await t.test("61.57(a)(1)'s takeoff count survives the trip", () => {
    // Was hardcoded 0 — the field day currency is computed from.
    assert.equal(d.day_takeoffs, 2);
  });

  await t.test("the full-stop split is carried, and touch-and-go is the remainder", () => {
    // Touch-and-go is not a second independent count: it is what is left
    // after the full-stop ones, so deriving it cannot manufacture
    // currency the way filling full_stop with the total would have.
    assert.equal(d.day_landings_full_stop, 1);
    assert.equal(d.day_landings_touch_go, 1);
  });

  await t.test("actual and simulated instrument stay separate, per 61.51(b)(3)", () => {
    assert.equal(d.instrument_actual_time, 0.4);
    assert.equal(d.instrument_simulated_time, 0.6);
  });

  await t.test("cross-country carries too", () => {
    assert.equal(d.cross_country_time, 1.8);
  });
});

test("a leg holding only the legacy combined instrument total still refuses to guess", () => {
  // The whole reason the draft left these null in the first place. A row
  // written before the actual/simulated split genuinely does not know it,
  // and asserting "actual" would put a fact the pilot never stated into a
  // record they may have to defend.
  const legacy = {
    ...LEG,
    instrument_actual_hours: null,
    instrument_simulated_hours: null,
    instrument_hours: 1.0,
  };
  const d = draftPayloadForLeg(TRIP, legacy, "PIC");
  assert.equal(d.instrument_actual_time, null);
  assert.equal(d.instrument_simulated_time, null);
});

test("a blank field is still a blank field, not a zero the pilot never stated", () => {
  const sparse = {
    ...LEG,
    cross_country_hours: null,
    instrument_actual_hours: null,
    instrument_simulated_hours: null,
  };
  const d = draftPayloadForLeg(TRIP, sparse, "PIC");
  assert.equal(d.cross_country_time, null);
  assert.equal(d.instrument_actual_time, null);
});

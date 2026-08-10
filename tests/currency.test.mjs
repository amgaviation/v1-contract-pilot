import test from "node:test";
import assert from "node:assert/strict";

const {
  addDays,
  addMonths,
  endOfMonth,
  startOfMonth,
  withinInclusive,
  rollingDayWindow,
  calendarMonthLookback,
  calendarMonthThroughDate,
  rollingMonthWindow,
  isWellFormedIsoDate,
} = await import("../lib/currency/window.ts");
const { typeKey, categoryKey, sameCategoryClassAndType } = await import("../lib/currency/match.ts");
const { actingRoleAllowed } = await import("../lib/currency/passenger-shared.ts");
const { evaluateGeneralExperience } = await import("../lib/currency/general.ts");
const { evaluateNightExperience } = await import("../lib/currency/night.ts");
const { evaluateInstrumentExperience } = await import("../lib/currency/instrument.ts");
const { evaluateFlightReview } = await import("../lib/currency/flight-review.ts");
const { evaluateMedical } = await import("../lib/currency/medical.ts");
const { evaluatePart135Recency } = await import("../lib/currency/part135.ts");
const { evaluateCurrency, InvalidAsOfDateError } = await import("../lib/currency/index.ts");
const { describeResult } = await import("../lib/currency/describe.ts");

/**
 * The currency engine. All fixtures synthetic — no live pilot data
 * anywhere, per docs/PLAN.md's standing gate. Dates and arithmetic are
 * cross-checked against docs/CURRENCY-SPEC.md §3's own worked examples
 * wherever one exists, so a test failure here means the engine drifted
 * from the spec, not that the spec and the test agree with each other by
 * construction.
 */

const AIRMAN = "11111111-1111-1111-1111-111111111111";
const OTHER_AIRMAN = "22222222-2222-2222-2222-222222222222";

function aircraft(overrides = {}) {
  return {
    tailKey: "N447SP",
    typeRating: "CE-500",
    typeDesignator: "C560",
    categoryClass: "AMEL",
    gear: "tricycle",
    ...overrides,
  };
}

/** A fully-populated, currency-neutral logbook entry. Every field a test cares about is overridden explicitly. */
function entry(overrides = {}) {
  return {
    id: "e-" + Math.random().toString(36).slice(2),
    entryDate: "2026-08-01",
    airmanUserId: AIRMAN,
    role: "PIC",
    soleManipulator: true,
    dayTakeoffs: 0,
    nightTakeoffs: 0,
    dayLandingsFullStop: 0,
    dayLandingsTouchGo: 0,
    nightLandingsFullStop: 0,
    nightLandingsTouchGo: 0,
    nightWindowAsserted: null,
    nightTime: null,
    approachesCount: 0,
    approachType: null,
    approachCondition: null,
    holds: 0,
    coursesInterceptedTracked: false,
    simulatorTime: null,
    simulatorDeviceType: null,
    aircraft: aircraft(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// window.ts — the date arithmetic every rule leans on.
// ---------------------------------------------------------------------------

test("addMonths end-of-month clamping", async (t) => {
  await t.test("2026-08-31 minus 6 months clamps to Feb 28 (non-leap)", () => {
    assert.equal(addMonths("2026-08-31", -6), "2026-02-28");
  });

  await t.test("2028-08-31 minus 6 months clamps to Feb 29 (2028 is a leap year)", () => {
    assert.equal(addMonths("2028-08-31", -6), "2028-02-29");
  });

  await t.test("adding forward across a year boundary", () => {
    assert.equal(addMonths("2026-11-15", 3), "2027-02-15");
  });
});

test("addDays and startOfMonth/endOfMonth", () => {
  assert.equal(addDays("2026-08-07", -89), "2026-05-10");
  assert.equal(startOfMonth("2026-08-07"), "2026-08-01");
  assert.equal(endOfMonth("2026-08-07"), "2026-08-31");
  assert.equal(endOfMonth("2028-02-01"), "2028-02-29");
});

test("withinInclusive is lexical and both-ends inclusive", () => {
  const w = { start: "2026-02-01", end: "2026-08-07" };
  assert.equal(withinInclusive("2026-02-01", w), true);
  assert.equal(withinInclusive("2026-08-07", w), true);
  assert.equal(withinInclusive("2026-01-31", w), false);
  assert.equal(withinInclusive("2026-08-08", w), false);
});

test("rollingDayWindow(asOf, 90) — the 90-day boundary is the conservative reading", () => {
  // docs/CURRENCY-SPEC.md §2.1: a 07 AUG 2026 flight reaches back to
  // 10 MAY 2026, not 09 MAY 2026 — the flight date plus the 89 days
  // before it, 90 dates in total.
  const w = rollingDayWindow("2026-08-07", 90);
  assert.equal(w.start, "2026-05-10");
  assert.equal(w.end, "2026-08-07");
  assert.equal(withinInclusive("2026-05-10", w), true);
  assert.equal(withinInclusive("2026-05-09", w), false);
});

test("calendarMonthLookback(asOf, 6) — worked example 1 (docs/CURRENCY-SPEC.md §3)", () => {
  const w = calendarMonthLookback("2026-08-07", 6);
  assert.equal(w.start, "2026-02-01");
  assert.equal(w.end, "2026-08-07");
  // Six approaches flown 01 FEB 2026 qualify by exactly one day of margin.
  assert.equal(withinInclusive("2026-02-01", w), true);
  // Six approaches flown 31 JAN 2026 do not.
  assert.equal(withinInclusive("2026-01-31", w), false);
});

test("calendarMonthThroughDate(completedOn, 24) — worked example 2 (docs/CURRENCY-SPEC.md §3)", () => {
  // A review completed any time in AUG 2024 is good through the last day
  // of AUG 2026 — N+1 months minus a day, not N.
  assert.equal(calendarMonthThroughDate("2024-08-15", 24), "2026-08-31");
  assert.equal(calendarMonthThroughDate("2024-08-01", 24), "2026-08-31");
  assert.equal(calendarMonthThroughDate("2024-08-31", 24), "2026-08-31");
});

test("rollingMonthWindow is the shorter, rolling reading, not calendar months", () => {
  const w = rollingMonthWindow("2026-08-07", 6);
  assert.equal(w.start, "2026-02-07"); // NOT 2026-02-01 (the calendar-month reading)
  assert.equal(w.end, "2026-08-07");
});

test("isWellFormedIsoDate rejects a real-looking date that names no real day", () => {
  assert.equal(isWellFormedIsoDate("2026-08-07"), true);
  assert.equal(isWellFormedIsoDate("2026-02-30"), false); // Date.UTC would silently roll this into March.
  assert.equal(isWellFormedIsoDate("not-a-date"), false);
  assert.equal(isWellFormedIsoDate(""), false);
});

// ---------------------------------------------------------------------------
// match.ts — aircraft matching.
// ---------------------------------------------------------------------------

test("typeKey prefers the FAA type rating over the ICAO designator", () => {
  // One CE-500 rating covers the Cessna 500/501/550/551/S550/552/560,
  // which ICAO splits five ways — grouping on the designator would tell a
  // CE-500 pilot their Citation Bravo landings do not count toward their
  // Citation V.
  assert.equal(typeKey(aircraft({ typeRating: "CE-500", typeDesignator: "C560" })), "CE-500");
  assert.equal(typeKey(aircraft({ typeRating: null, typeDesignator: "C560" })), "C560");
  assert.equal(typeKey(aircraft({ typeRating: null, typeDesignator: null })), null);
  assert.equal(typeKey(aircraft({ typeRating: "  ", typeDesignator: "C560" })), "C560", "blank rating falls through to the designator");
});

test("categoryKey trims, collapses whitespace, and case-folds; blank is null", () => {
  assert.equal(categoryKey(aircraft({ categoryClass: "amel" })), "AMEL");
  assert.equal(categoryKey(aircraft({ categoryClass: "  Multi   Engine  " })), "MULTI ENGINE");
  assert.equal(categoryKey(aircraft({ categoryClass: "" })), null);
  assert.equal(categoryKey(aircraft({ categoryClass: null })), null);
});

test("sameCategoryClassAndType: a null on either side is a MISSING INPUT, never a silent non-match", () => {
  const complete = aircraft();
  const noCategory = aircraft({ categoryClass: null });

  const withGap = sameCategoryClassAndType(noCategory, complete);
  assert.equal(withGap.matches, false);
  assert.deepEqual(withGap.missing, ["aircraft_category_class_unrecorded"]);

  const clean = sameCategoryClassAndType(complete, complete);
  assert.equal(clean.matches, true);
  assert.deepEqual(clean.missing, []);

  const mismatch = sameCategoryClassAndType(aircraft({ typeRating: "B-737" }), complete);
  assert.equal(mismatch.matches, false);
  assert.deepEqual(mismatch.missing, [], "a genuine mismatch is NOT a missing input");
});

test("sameCategoryClassAndType, REGU-3: a blank type rating is NOT evidence one isn't required — same type still matches, a different type is unresolved", () => {
  // A blank intended.typeRating used to be read as "no rating required,"
  // so category/class alone governed the match — which is how a Citation
  // 560's landings (typeRating blank, typeDesignator C560) ended up
  // crediting a Beech Baron's currency (both AMEL, REGU-3's proof). The
  // one thing a blank rating resolves without guessing is an entry logged
  // in the SAME type as intended: that still matches, whether or not a
  // rating turns out to be required for it.
  const c172 = aircraft({ typeRating: null, typeDesignator: "C172", categoryClass: "ASEL" });
  const anotherC172 = aircraft({ typeRating: null, typeDesignator: "C172", categoryClass: "ASEL" });
  const same = sameCategoryClassAndType(c172, anotherC172);
  assert.equal(same.matches, true, "identical logged type still matches with no type rating recorded");
  assert.deepEqual(same.missing, []);

  // A DIFFERENT type, with the intended aircraft's rating blank, is now
  // an unresolved fact, not a pass — REGU-3 superseded the earlier REG-7
  // reading that let two differently-typed, equally-unrated aircraft
  // (e.g. a C172 and a PA-28) match on category/class alone: this schema
  // cannot tell that case apart from the Citation/Baron one, since both
  // are "a blank typeRating and a different type."
  const pa28 = aircraft({ typeRating: null, typeDesignator: "PA28", categoryClass: "ASEL" });
  const differentType = sameCategoryClassAndType(c172, pa28);
  assert.equal(differentType.matches, false, "a different type under an unrecorded rating is unresolved, not a silent pass");
  assert.deepEqual(differentType.missing, ["aircraft_type_unrecorded"]);

  // The same C172 entry does NOT satisfy an intended aircraft that DOES
  // carry a type rating — type comparison is keyed off the intended
  // aircraft, and here it is required and unmet.
  const typeRated = aircraft({ typeRating: "CE-500", typeDesignator: "C560", categoryClass: "AMEL" });
  const requiresType = sameCategoryClassAndType(c172, typeRated);
  assert.equal(requiresType.matches, false);
});

// ---------------------------------------------------------------------------
// general.ts — 61.57(a).
// ---------------------------------------------------------------------------

test("61.57(a): three qualifying takeoffs and landings, sole manipulator, matching aircraft -> estimated_current", () => {
  const entries = [
    entry({ entryDate: "2026-07-01", dayTakeoffs: 1, dayLandingsFullStop: 1 }),
    entry({ entryDate: "2026-07-10", dayTakeoffs: 1, dayLandingsFullStop: 1 }),
    entry({ entryDate: "2026-07-20", dayTakeoffs: 1, dayLandingsFullStop: 1 }),
  ];
  const r = evaluateGeneralExperience({
    asOf: "2026-08-07",
    airmanUserId: AIRMAN,
    intendedAircraft: aircraft(),
    entries,
  });
  assert.equal(r.status, "estimated_current");
  assert.equal(r.ruleBasis, "61.57(a)");
  assert.equal(r.observed.takeoffs, 3);
  assert.equal(r.observed.landings, 3);
  // Newest-first accumulation: 07-20 (1/1), 07-10 (2/2), 07-01 (3/3) —
  // the threshold is only reached once the OLDEST of the three rows is
  // folded in, so that is the limiting (earliest still-needed) date.
  assert.equal(r.limitingDate, "2026-07-01");
});

test("61.57(a) is not day-only: night takeoffs and night landings count toward it (fixture A-1)", () => {
  const entries = [
    entry({ entryDate: "2026-07-01", nightTakeoffs: 1, nightLandingsFullStop: 1 }),
    entry({ entryDate: "2026-07-10", nightTakeoffs: 1, nightLandingsFullStop: 1 }),
    entry({ entryDate: "2026-07-20", nightTakeoffs: 1, nightLandingsFullStop: 1 }),
  ];
  const r = evaluateGeneralExperience({
    asOf: "2026-08-07",
    airmanUserId: AIRMAN,
    intendedAircraft: aircraft(),
    entries,
  });
  assert.equal(r.status, "estimated_current");
});

test("61.57(a), fixture A-9: a SOLO entry counts toward the sole-manipulator total", () => {
  // 61.51(e)(4): a student pilot may log solo flight time as PIC time.
  // 61.51(d): SOLO means sole occupant, which entails sole manipulator.
  const entries = [
    entry({ entryDate: "2026-07-01", role: "SOLO", dayTakeoffs: 1, dayLandingsFullStop: 1 }),
    entry({ entryDate: "2026-07-10", role: "SOLO", dayTakeoffs: 1, dayLandingsFullStop: 1 }),
    entry({ entryDate: "2026-07-20", role: "SOLO", dayTakeoffs: 1, dayLandingsFullStop: 1 }),
  ];
  const r = evaluateGeneralExperience({
    asOf: "2026-08-07",
    airmanUserId: AIRMAN,
    intendedAircraft: aircraft(),
    entries,
  });
  assert.equal(r.status, "estimated_current");
});

test("actingRoleAllowed: an allowlist, and excludes a null role by construction (S5)", () => {
  // Isolates the property SEC-11 found untested end to end: this checks
  // the predicate directly rather than through a fixture where another
  // gate (sole_manipulator_unrecorded) could mask the same result
  // regardless of which implementation actingRoleAllowed used.
  assert.equal(actingRoleAllowed("PIC"), true);
  assert.equal(actingRoleAllowed("SIC"), true);
  assert.equal(actingRoleAllowed("SOLO"), true);
  assert.equal(actingRoleAllowed("DUAL_RECEIVED"), false);
  // The failure mode this pins: `role !== "DUAL_RECEIVED"` (the naive
  // transliteration of SQL's `role <> 'DUAL_RECEIVED'`) returns true for
  // a null role in JavaScript, where SQL's `<>` returns NULL (dropped).
  // An allowlist excludes null by construction and needs no such check.
  assert.equal(actingRoleAllowed(null), false);
});

test("61.57(a): DUAL_RECEIVED never counts, and a null role is excluded by the same allowlist (S5)", () => {
  const entries = [
    entry({ entryDate: "2026-07-01", role: "DUAL_RECEIVED", dayTakeoffs: 3, dayLandingsFullStop: 3 }),
    entry({ entryDate: "2026-07-02", role: null, dayTakeoffs: 3, dayLandingsFullStop: 3, soleManipulator: null }),
  ];
  const r = evaluateGeneralExperience({
    asOf: "2026-08-07",
    airmanUserId: AIRMAN,
    intendedAircraft: aircraft(),
    entries,
  });
  assert.equal(r.status, "insufficient_data");
  assert.ok(r.missing.includes("sole_manipulator_unrecorded"));
  assert.ok(r.missing.includes("role_unrecorded"), "a null role is its own missing input, not only masked by sole_manipulator_unrecorded (REG-9)");

  const cleanEntries = [entry({ entryDate: "2026-07-01", role: "DUAL_RECEIVED", dayTakeoffs: 3, dayLandingsFullStop: 3 })];
  const clean = evaluateGeneralExperience({
    asOf: "2026-08-07",
    airmanUserId: AIRMAN,
    intendedAircraft: aircraft(),
    entries: cleanEntries,
  });
  assert.equal(clean.status, "estimated_not_current");
  assert.equal(clean.observed.takeoffs, 0, "DUAL_RECEIVED time never counts toward 61.57(a)");
});

test("61.57(a), REG-9: a null role is a missing input, not a silent exclusion", () => {
  // Otherwise complete: soleManipulator true, matching aircraft, no
  // simulator time — the ONLY thing that can make this insufficient_data
  // is the role itself being unrecorded.
  const entries = [
    entry({ entryDate: "2026-07-01", role: null, soleManipulator: true, dayTakeoffs: 3, dayLandingsFullStop: 3 }),
  ];
  const r = evaluateGeneralExperience({
    asOf: "2026-08-07",
    airmanUserId: AIRMAN,
    intendedAircraft: aircraft(),
    entries,
  });
  assert.equal(r.status, "insufficient_data");
  assert.deepEqual(r.missing, ["role_unrecorded"]);
});

test("61.57(a), REGU-3: entries in the SAME, equally-unrated type still count with no type rating recorded", () => {
  const pa28 = aircraft({ typeRating: null, typeDesignator: "PA28", categoryClass: "ASEL", gear: "tricycle" });
  const anotherPa28 = aircraft({ typeRating: null, typeDesignator: "PA28", categoryClass: "ASEL", gear: "tricycle" });
  const entries = [entry({ entryDate: "2026-07-01", dayTakeoffs: 3, dayLandingsFullStop: 3, aircraft: anotherPa28 })];
  const r = evaluateGeneralExperience({ asOf: "2026-08-07", airmanUserId: AIRMAN, intendedAircraft: pa28, entries });
  assert.equal(r.status, "estimated_current");
  assert.ok(r.assumptions.some((a) => a.includes("No type rating is recorded")));
});

test("61.57(a), REGU-3: a DIFFERENT, equally-unrated type is now insufficient_data, not a silent pass (supersedes REG-7's reading)", () => {
  // REG-7 originally let a C172 entry count toward a PA-28 card because
  // neither aircraft requires a type rating — but a blank typeRating on
  // the intended aircraft is not evidence a rating ISN'T required (it is
  // equally consistent with an unrecorded rating on a jet, REGU-3), so a
  // genuinely different type under an unrecorded rating is now an
  // unresolved fact rather than a pass.
  const pa28 = aircraft({ typeRating: null, typeDesignator: "PA28", categoryClass: "ASEL", gear: "tricycle" });
  const c172 = aircraft({ typeRating: null, typeDesignator: "C172", categoryClass: "ASEL", gear: "tricycle" });
  const entries = [entry({ entryDate: "2026-07-01", dayTakeoffs: 3, dayLandingsFullStop: 3, aircraft: c172 })];
  const r = evaluateGeneralExperience({ asOf: "2026-08-07", airmanUserId: AIRMAN, intendedAircraft: pa28, entries });
  assert.equal(r.status, "insufficient_data");
  assert.ok(r.missing.includes("aircraft_type_unrecorded"));
});

test("61.57(a): tailwheel requires full-stop landings only; touch-and-go does not count", () => {
  const tw = aircraft({ gear: "tailwheel" });
  const entries = [
    entry({ entryDate: "2026-07-01", dayTakeoffs: 3, dayLandingsTouchGo: 3, aircraft: tw }),
  ];
  const r = evaluateGeneralExperience({ asOf: "2026-08-07", airmanUserId: AIRMAN, intendedAircraft: tw, entries });
  assert.equal(r.status, "estimated_not_current");
  assert.equal(r.observed.landings, 0);
});

test("61.57(a), REGU-1: takeoffs and landings must be MADE IN a tailwheel airplane, not merely enforced by category/type match", () => {
  const tw = aircraft({ gear: "tailwheel" });
  const sameTypeTricycle = aircraft({ gear: "tricycle" }); // same category/type/rating as tw, different gear
  const entries = [
    entry({ entryDate: "2026-07-01", dayTakeoffs: 3, dayLandingsFullStop: 3, aircraft: sameTypeTricycle }),
  ];
  const r = evaluateGeneralExperience({ asOf: "2026-08-07", airmanUserId: AIRMAN, intendedAircraft: tw, entries });
  // PROVEN BUG: 3 day takeoffs and 3 day full-stop landings in a tricycle
  // Skyhawk of the SAME category/type as the intended tailwheel aircraft
  // used to read estimated_current — the comment this fix replaces
  // claimed the type/category match "already enforced" the tailwheel
  // half of 61.57(a)(1)(ii); it did not, because gear is not part of
  // category, class, or type.
  assert.equal(r.status, "estimated_not_current");
  assert.equal(r.observed.takeoffs, 0);
  assert.equal(r.observed.landings, 0);
});

test("61.57(a), REGU-5: an unrecorded gear on the LOGGED (not intended) aircraft is a missing input, not a silent pass", () => {
  const tw = aircraft({ gear: "tailwheel" });
  const nullGear = aircraft({ gear: null });
  const entries = [entry({ entryDate: "2026-07-01", dayTakeoffs: 3, dayLandingsFullStop: 3, aircraft: nullGear })];
  const r = evaluateGeneralExperience({ asOf: "2026-08-07", airmanUserId: AIRMAN, intendedAircraft: tw, entries });
  assert.equal(r.status, "insufficient_data");
  assert.ok(r.missing.includes("aircraft_gear_unrecorded"));
});

test("61.57(a): a tailwheel entry flown in an ACTUAL tailwheel aircraft of the same type still counts (control case for REGU-1)", () => {
  const tw = aircraft({ gear: "tailwheel" });
  const entries = [entry({ entryDate: "2026-07-01", dayTakeoffs: 3, dayLandingsFullStop: 3, aircraft: tw })];
  const r = evaluateGeneralExperience({ asOf: "2026-08-07", airmanUserId: AIRMAN, intendedAircraft: tw, entries });
  assert.equal(r.status, "estimated_current");
  assert.equal(r.observed.takeoffs, 3);
  assert.equal(r.observed.landings, 3);
});

test("61.57(a): a missing intended aircraft is insufficient_data with intended_aircraft_absent, not a guess", () => {
  const r = evaluateGeneralExperience({ asOf: "2026-08-07", airmanUserId: AIRMAN, intendedAircraft: null, entries: [] });
  assert.equal(r.status, "insufficient_data");
  assert.deepEqual(r.missing, ["intended_aircraft_absent"]);
});

test("61.57(a): an unattributed entry that COULD be the difference forces insufficient_data (S2)", () => {
  // Exactly at threshold, alone — attributing it genuinely could flip the
  // answer, so this asks rather than guesses.
  const entries = [entry({ entryDate: "2026-07-01", airmanUserId: null, dayTakeoffs: 3, dayLandingsFullStop: 3 })];
  const r = evaluateGeneralExperience({ asOf: "2026-08-07", airmanUserId: AIRMAN, intendedAircraft: aircraft(), entries });
  assert.equal(r.status, "insufficient_data");
  assert.ok(r.missing.includes("airman_unattributed"));
});

test("61.57(a): an unattributed entry that could NEVER be the difference never gates (Q1-class scoping, generalized past matchGates)", () => {
  // Zero movements: cannot contribute regardless of who it belongs to.
  const zeroMovement = evaluateGeneralExperience({
    asOf: "2026-08-07", airmanUserId: AIRMAN, intendedAircraft: aircraft(),
    entries: [entry({ entryDate: "2026-07-01", airmanUserId: null })],
  });
  assert.equal(zeroMovement.status, "estimated_not_current");
  assert.deepEqual(zeroMovement.missing, []);

  // Real movements, but short even in the best case (1 of 3, alone).
  const shortEvenBestCase = evaluateGeneralExperience({
    asOf: "2026-08-07", airmanUserId: AIRMAN, intendedAircraft: aircraft(),
    entries: [entry({ entryDate: "2026-07-01", airmanUserId: null, dayTakeoffs: 1, dayLandingsFullStop: 1 })],
  });
  assert.equal(shortEvenBestCase.status, "estimated_not_current");
  assert.deepEqual(shortEvenBestCase.missing, []);

  // Three OTHER certain entries already answer the card — a fourth,
  // unattributed entry could never change that, even though it alone
  // would have reached the threshold.
  const alreadyCurrent = evaluateGeneralExperience({
    asOf: "2026-08-07", airmanUserId: AIRMAN, intendedAircraft: aircraft(),
    entries: [
      entry({ entryDate: "2026-07-01", dayTakeoffs: 1, dayLandingsFullStop: 1 }),
      entry({ entryDate: "2026-07-10", dayTakeoffs: 1, dayLandingsFullStop: 1 }),
      entry({ entryDate: "2026-07-20", dayTakeoffs: 1, dayLandingsFullStop: 1 }),
      entry({ entryDate: "2026-07-15", airmanUserId: null, dayTakeoffs: 3, dayLandingsFullStop: 3 }),
    ],
  });
  assert.equal(alreadyCurrent.status, "estimated_current");
  assert.deepEqual(alreadyCurrent.missing, []);
});

test("61.57(a): a second airman's entries in a shared account never count toward this airman's total (S2)", () => {
  const entries = [
    entry({ entryDate: "2026-07-01", airmanUserId: OTHER_AIRMAN, dayTakeoffs: 3, dayLandingsFullStop: 3 }),
  ];
  const r = evaluateGeneralExperience({ asOf: "2026-08-07", airmanUserId: AIRMAN, intendedAircraft: aircraft(), entries });
  assert.equal(r.status, "estimated_not_current");
  assert.equal(r.observed.takeoffs, 0);
});

test("61.57(a): a simulator row that COULD be the difference is unresolvable, never counted and never ignored silently", () => {
  const entries = [
    entry({ entryDate: "2026-07-01", dayTakeoffs: 3, dayLandingsFullStop: 3, simulatorTime: 1.0, simulatorDeviceType: "ffs" }),
  ];
  const r = evaluateGeneralExperience({ asOf: "2026-08-07", airmanUserId: AIRMAN, intendedAircraft: aircraft(), entries });
  assert.equal(r.status, "insufficient_data");
  assert.ok(r.missing.includes("unresolvable_simulator_row"));
});

test("61.57(a): a simulator row that could never be the difference never gates", () => {
  // Zero movements.
  const zeroMovement = evaluateGeneralExperience({
    asOf: "2026-08-07", airmanUserId: AIRMAN, intendedAircraft: aircraft(),
    entries: [entry({ entryDate: "2026-07-01", simulatorTime: 1.0, simulatorDeviceType: "ffs" })],
  });
  assert.equal(zeroMovement.status, "estimated_not_current");
  assert.deepEqual(zeroMovement.missing, []);

  // Already current on three OTHER certain entries.
  const alreadyCurrent = evaluateGeneralExperience({
    asOf: "2026-08-07", airmanUserId: AIRMAN, intendedAircraft: aircraft(),
    entries: [
      entry({ entryDate: "2026-07-01", dayTakeoffs: 1, dayLandingsFullStop: 1 }),
      entry({ entryDate: "2026-07-10", dayTakeoffs: 1, dayLandingsFullStop: 1 }),
      entry({ entryDate: "2026-07-20", dayTakeoffs: 1, dayLandingsFullStop: 1 }),
      entry({ entryDate: "2026-07-15", dayTakeoffs: 3, dayLandingsFullStop: 3, simulatorTime: 1.0, simulatorDeviceType: "ffs" }),
    ],
  });
  assert.equal(alreadyCurrent.status, "estimated_current");
  assert.deepEqual(alreadyCurrent.missing, []);
});

// ---------------------------------------------------------------------------
// P1: matchGates's "could this change the answer" scoping — the highest-
// severity finding of the third review round. A single unrelated entry
// with an unresolvable type must never empty the whole card when the
// pilot's certain entries already answer it, or when they never could.
// ---------------------------------------------------------------------------

test("61.57(a), P1: a blank-typeRating intended aircraft with THREE CERTAIN qualifying entries is estimated_current even with an unrelated, unresolvable-type entry in the window", () => {
  const blank = aircraft({ typeRating: null, typeDesignator: "PA28", categoryClass: "ASEL", gear: "tricycle" });
  const sameType = aircraft({ typeRating: null, typeDesignator: "PA28", categoryClass: "ASEL", gear: "tricycle" });
  const differentType = aircraft({ typeRating: null, typeDesignator: "C172", categoryClass: "ASEL", gear: "tricycle" });
  const entries = [
    entry({ entryDate: "2026-07-01", dayTakeoffs: 1, dayLandingsFullStop: 1, aircraft: sameType }),
    entry({ entryDate: "2026-07-10", dayTakeoffs: 1, dayLandingsFullStop: 1, aircraft: sameType }),
    entry({ entryDate: "2026-07-20", dayTakeoffs: 1, dayLandingsFullStop: 1, aircraft: sameType }),
    // Ambiguous type, but the three entries above already reach 3/3 —
    // this entry could never change the answer and must not gate.
    entry({ entryDate: "2026-07-15", dayTakeoffs: 3, dayLandingsFullStop: 3, aircraft: differentType }),
  ];
  const r = evaluateGeneralExperience({ asOf: "2026-08-07", airmanUserId: AIRMAN, intendedAircraft: blank, entries });
  assert.equal(r.status, "estimated_current");
  assert.equal(r.observed.takeoffs, 3, "the ambiguous entry's takeoffs are not credited either — it is excluded, not resolved");
  assert.deepEqual(r.missing, []);
});

test("61.57(a), P1: the SAME shape, but short by one entry — the ambiguous entry COULD make up the difference, so this is insufficient_data, not estimated_not_current", () => {
  const blank = aircraft({ typeRating: null, typeDesignator: "PA28", categoryClass: "ASEL", gear: "tricycle" });
  const sameType = aircraft({ typeRating: null, typeDesignator: "PA28", categoryClass: "ASEL", gear: "tricycle" });
  const differentType = aircraft({ typeRating: null, typeDesignator: "C172", categoryClass: "ASEL", gear: "tricycle" });
  const entries = [
    entry({ entryDate: "2026-07-01", dayTakeoffs: 1, dayLandingsFullStop: 1, aircraft: sameType }),
    entry({ entryDate: "2026-07-10", dayTakeoffs: 1, dayLandingsFullStop: 1, aircraft: sameType }),
    // Only 2/2 certain — this ambiguous entry could be the difference.
    entry({ entryDate: "2026-07-15", dayTakeoffs: 3, dayLandingsFullStop: 3, aircraft: differentType }),
  ];
  const r = evaluateGeneralExperience({ asOf: "2026-08-07", airmanUserId: AIRMAN, intendedAircraft: blank, entries });
  assert.equal(r.status, "insufficient_data");
  assert.ok(r.missing.includes("aircraft_type_unrecorded"));
  assert.ok(r.notes.some((n) => n.includes("2026-07-15")), "the card must name which entry is unresolved");
});

test("61.57(a), P1: short even in the BEST case — the ambiguous entry could not have changed a not-current answer either, so it must not gate", () => {
  const blank = aircraft({ typeRating: null, typeDesignator: "PA28", categoryClass: "ASEL", gear: "tricycle" });
  const differentType = aircraft({ typeRating: null, typeDesignator: "C172", categoryClass: "ASEL", gear: "tricycle" });
  const entries = [
    // Zero certain entries, and the one ambiguous entry alone is short
    // (2 of 3) even if it resolved in the pilot's favor.
    entry({ entryDate: "2026-07-15", dayTakeoffs: 2, dayLandingsFullStop: 2, aircraft: differentType }),
  ];
  const r = evaluateGeneralExperience({ asOf: "2026-08-07", airmanUserId: AIRMAN, intendedAircraft: blank, entries });
  assert.equal(r.status, "estimated_not_current");
  assert.deepEqual(r.missing, []);
});

test("61.57(a), P1: an entry that could never contribute — zero movements, another airman, DUAL_RECEIVED, or an unrelated CATEGORY — never gates, even when the pilot is short", () => {
  const blank = aircraft({ typeRating: null, typeDesignator: "PA28", categoryClass: "ASEL", gear: "tricycle" });
  const differentType = aircraft({ typeRating: null, typeDesignator: "C172", categoryClass: "ASEL", gear: "tricycle" });
  const helicopter = aircraft({ typeRating: null, typeDesignator: "B407", categoryClass: "HELICOPTER", gear: "skid" });

  const zeroMovement = evaluateGeneralExperience({
    asOf: "2026-08-07", airmanUserId: AIRMAN, intendedAircraft: blank,
    entries: [entry({ entryDate: "2026-07-15", dayTakeoffs: 0, dayLandingsFullStop: 0, aircraft: differentType })],
  });
  assert.equal(zeroMovement.status, "estimated_not_current");
  assert.deepEqual(zeroMovement.missing, []);

  const otherAirman = evaluateGeneralExperience({
    asOf: "2026-08-07", airmanUserId: AIRMAN, intendedAircraft: blank,
    entries: [entry({ entryDate: "2026-07-15", dayTakeoffs: 3, dayLandingsFullStop: 3, aircraft: differentType, airmanUserId: OTHER_AIRMAN })],
  });
  assert.equal(otherAirman.status, "estimated_not_current");
  assert.deepEqual(otherAirman.missing, []);

  const dualReceived = evaluateGeneralExperience({
    asOf: "2026-08-07", airmanUserId: AIRMAN, intendedAircraft: blank,
    entries: [entry({ entryDate: "2026-07-15", dayTakeoffs: 3, dayLandingsFullStop: 3, aircraft: differentType, role: "DUAL_RECEIVED" })],
  });
  assert.equal(dualReceived.status, "estimated_not_current");
  assert.deepEqual(dualReceived.missing, []);

  const unrelatedCategory = evaluateGeneralExperience({
    asOf: "2026-08-07", airmanUserId: AIRMAN, intendedAircraft: blank,
    entries: [entry({ entryDate: "2026-07-15", dayTakeoffs: 3, dayLandingsFullStop: 3, aircraft: helicopter })],
  });
  assert.equal(unrelatedCategory.status, "estimated_not_current");
  assert.deepEqual(unrelatedCategory.missing, [], "a KNOWN different category is a decisive non-match, not an unresolved type");
});

// ---------------------------------------------------------------------------
// night.ts — 61.57(b). Fixture named first in the task brief.
// ---------------------------------------------------------------------------

test("61.57(b): full stop is required for EVERY aircraft, not only tailwheel — touch-and-go never counts", () => {
  const entries = [
    entry({ entryDate: "2026-07-01", nightTakeoffs: 3, nightLandingsTouchGo: 3, nightWindowAsserted: true }),
  ];
  const r = evaluateNightExperience({
    asOf: "2026-08-07",
    airmanUserId: AIRMAN,
    intendedAircraft: aircraft({ gear: "tricycle" }), // NOT tailwheel
    entries,
  });
  assert.equal(r.status, "estimated_not_current");
  assert.equal(r.observed.landings, 0, "touch-and-go landings never count toward 61.57(b), regardless of gear");
});

test("61.57(b): a full-stop night landing counts when the (b)(1) window is asserted", () => {
  const entries = [
    entry({ entryDate: "2026-07-01", nightTakeoffs: 1, nightLandingsFullStop: 1, nightWindowAsserted: true }),
    entry({ entryDate: "2026-07-10", nightTakeoffs: 1, nightLandingsFullStop: 1, nightWindowAsserted: true }),
    entry({ entryDate: "2026-07-20", nightTakeoffs: 1, nightLandingsFullStop: 1, nightWindowAsserted: true }),
  ];
  const r = evaluateNightExperience({ asOf: "2026-08-07", airmanUserId: AIRMAN, intendedAircraft: aircraft(), entries });
  assert.equal(r.status, "estimated_current");
});

test("61.57(b): night_window_asserted === null on a row that COULD be the difference forces insufficient_data — the 1.1-vs-(b)(1) clock", () => {
  // Exactly at threshold, alone — asserting the window genuinely could
  // flip the answer.
  const entries = [
    entry({ entryDate: "2026-07-01", nightTakeoffs: 3, nightLandingsFullStop: 3, nightWindowAsserted: null }),
  ];
  const r = evaluateNightExperience({ asOf: "2026-08-07", airmanUserId: AIRMAN, intendedAircraft: aircraft(), entries });
  assert.equal(r.status, "insufficient_data");
  assert.ok(r.missing.includes("night_window_unasserted"));
});

test("61.57(b): night_window_asserted === FALSE is a STATED negative, not an unknown — excluded, never gated (same discipline as soleManipulator === false)", () => {
  const entries = [
    entry({ entryDate: "2026-07-01", nightTakeoffs: 1, nightLandingsFullStop: 1, nightWindowAsserted: true }),
    entry({ entryDate: "2026-07-10", nightTakeoffs: 1, nightLandingsFullStop: 1, nightWindowAsserted: true }),
    entry({ entryDate: "2026-07-20", nightTakeoffs: 1, nightLandingsFullStop: 1, nightWindowAsserted: true }),
    // Confirmed OUTSIDE the (b)(1) window — even though it alone would
    // reach the threshold, it is a known "no," not a question.
    entry({ entryDate: "2026-07-15", nightTakeoffs: 3, nightLandingsFullStop: 3, nightWindowAsserted: false }),
  ];
  const r = evaluateNightExperience({ asOf: "2026-08-07", airmanUserId: AIRMAN, intendedAircraft: aircraft(), entries });
  assert.equal(r.status, "estimated_current");
  assert.equal(r.observed.takeoffs, 3);
  assert.deepEqual(r.missing, []);
});

test("61.57(b): a night flight with a daytime landing is a NOTE, not a missing-data gate", () => {
  const entries = [entry({ entryDate: "2026-07-01", nightTime: 1.2, nightTakeoffs: 0, nightLandingsFullStop: 0 })];
  const r = evaluateNightExperience({ asOf: "2026-08-07", airmanUserId: AIRMAN, intendedAircraft: aircraft(), entries });
  assert.equal(r.status, "estimated_not_current");
  assert.ok(r.notes.some((n) => n.includes("night time with no night takeoff")));
});

test("61.57(b) has no tailwheel gate of its own: entries flown in a TRICYCLE aircraft still count toward a tailwheel intended aircraft, because (b) never conditions on gear", () => {
  // P6: the old version of this fixture built every entry in the SAME
  // tailwheel aircraft as intended, so a mutation that made night.ts
  // adopt general.ts's gear gate/filter (gearGates + the gearMatches
  // eligible filter) would still pass — gearMatches(tw, tw) is a trivial
  // match either way. This version is the discriminating case: if night.ts
  // ever adopted that gate, these tricycle-flown entries would be
  // EXCLUDED and the status would flip to estimated_not_current with 0
  // landings, exactly as general.ts's own A-15-equivalent fixture behaves.
  const tw = aircraft({ gear: "tailwheel" });
  const tri = aircraft({ gear: "tricycle" });
  const entries = [
    entry({ entryDate: "2026-07-01", nightTakeoffs: 1, nightLandingsFullStop: 1, nightWindowAsserted: true, aircraft: tri }),
    entry({ entryDate: "2026-07-10", nightTakeoffs: 1, nightLandingsFullStop: 1, nightWindowAsserted: true, aircraft: tri }),
    entry({ entryDate: "2026-07-20", nightTakeoffs: 1, nightLandingsFullStop: 1, nightWindowAsserted: true, aircraft: tri }),
  ];
  const r = evaluateNightExperience({ asOf: "2026-08-07", airmanUserId: AIRMAN, intendedAircraft: tw, entries });
  assert.equal(r.status, "estimated_current");
  assert.equal(r.observed.takeoffs, 3);
  assert.equal(r.observed.landings, 3, "a tricycle-flown entry's landings must still count — (b) has no gear predicate to exclude them");
  assert.deepEqual(r.missing, []);
});

// ---------------------------------------------------------------------------
// instrument.ts — 61.57(c).
// ---------------------------------------------------------------------------

test("61.57(c): a visual approach never counts, even tagged with a high approaches_count", () => {
  const entries = [
    entry({ entryDate: "2026-07-01", approachesCount: 6, approachType: "visual", approachCondition: "neither" }),
  ];
  const r = evaluateInstrumentExperience({ asOf: "2026-08-07", airmanUserId: AIRMAN, intendedAircraft: aircraft(), entries });
  assert.equal(r.status, "estimated_not_current");
  assert.equal(r.observed.approaches, 0);
});

test("61.57(c): an untyped approach (approach_type IS NULL) is not counted", () => {
  const entries = [
    entry({ entryDate: "2026-07-01", approachesCount: 6, approachType: null, approachCondition: "actual" }),
  ];
  const r = evaluateInstrumentExperience({ asOf: "2026-08-07", airmanUserId: AIRMAN, intendedAircraft: aircraft(), entries });
  assert.equal(r.observed.approaches, 0);
});

test("61.57(c): all three device classes (FFS/FTD/ATD) are accepted device classes, unlike (a)/(b) — no part 142 condition here — and don't poison an otherwise-sufficient card", () => {
  // P2: a device row can never be CERTAIN (this schema has no field
  // recording what category a device represents, so 61.57(c)(2)'s own
  // "the device represents the category of aircraft" predicate can never
  // be confirmed) — but it also must not gate when it isn't needed. Real
  // aircraft entries alone already clear all three thresholds here, so
  // the paired ffs/ftd/atd row (unlike 'other', tested below) must not
  // change the answer.
  for (const device of ["ffs", "ftd", "atd"]) {
    const entries = [
      entry({ entryDate: "2026-07-01", approachesCount: 6, approachType: "ils", approachCondition: "actual", holds: 1, coursesInterceptedTracked: true }),
      entry({
        entryDate: "2026-07-05",
        approachesCount: 2,
        approachType: "ils",
        approachCondition: "simulated",
        simulatorTime: 1.0,
        simulatorDeviceType: device,
      }),
    ];
    const r = evaluateInstrumentExperience({ asOf: "2026-08-07", airmanUserId: AIRMAN, intendedAircraft: aircraft(), entries });
    assert.equal(r.status, "estimated_current", `an unneeded device row (${device}) must not gate an otherwise-sufficient card`);
    assert.equal(r.observed.approaches, 6, `the unneeded device row's approaches are not credited (${device})`);
    assert.deepEqual(r.missing, []);
  }
});

test("61.57(c): device class 'other' is unresolvable — when it could be the difference, it asks, not answers", () => {
  const entries = [
    entry({
      entryDate: "2026-07-01",
      approachesCount: 6,
      approachType: "ils",
      approachCondition: "simulated",
      simulatorTime: 1.0,
      simulatorDeviceType: "other",
      holds: 1,
      coursesInterceptedTracked: true,
    }),
  ];
  const r = evaluateInstrumentExperience({ asOf: "2026-08-07", airmanUserId: AIRMAN, intendedAircraft: aircraft(), entries });
  assert.equal(r.status, "insufficient_data");
  assert.ok(r.missing.includes("unresolvable_simulator_row"));
});

test("61.57(c): device class 'other' never gates when it could not be the difference", () => {
  // Real aircraft entries alone already clear the card — the unneeded
  // 'other' device row must not gate it.
  const entries = [
    entry({ entryDate: "2026-07-01", approachesCount: 6, approachType: "ils", approachCondition: "actual", holds: 1, coursesInterceptedTracked: true }),
    entry({
      entryDate: "2026-07-05",
      approachesCount: 2,
      approachType: "ils",
      approachCondition: "simulated",
      simulatorTime: 1.0,
      simulatorDeviceType: "other",
    }),
  ];
  const r = evaluateInstrumentExperience({ asOf: "2026-08-07", airmanUserId: AIRMAN, intendedAircraft: aircraft(), entries });
  assert.equal(r.status, "estimated_current");
  assert.deepEqual(r.missing, []);
});

test("61.57(c), P2: a device row has NO tail number by design (REGU-4/CORR-1) but STILL can't singlehandedly prove currency — the device-represents-category predicate is unconfirmable, not unconditional credit", () => {
  // A simulator session has no aircraft in pilot.aircraft — that is the
  // whole point of the simulator-role migration, and routing it through
  // the aircraft registry (categoryMatches) is the REGU-4/CORR-1
  // regression this must NOT reintroduce (no aircraft_unregistered here).
  // But crediting it unconditionally, with no test of 61.57(c)(2)'s own
  // "represents the category of aircraft" predicate, was the OPPOSITE
  // regression (P2) — this schema cannot confirm that predicate for any
  // device row, ever, so a lone device row that is the ONLY source of
  // currency must ask, not answer.
  const entries = [
    entry({
      entryDate: "2026-07-01",
      approachesCount: 6,
      approachType: "ils",
      approachCondition: "simulated",
      simulatorTime: 1.0,
      simulatorDeviceType: "atd",
      holds: 1,
      coursesInterceptedTracked: true,
      aircraft: null,
    }),
  ];
  const r = evaluateInstrumentExperience({ asOf: "2026-08-07", airmanUserId: AIRMAN, intendedAircraft: aircraft(), entries });
  assert.equal(r.status, "insufficient_data");
  assert.deepEqual(r.missing, ["device_category_unconfirmed"]);
});

test("61.57(c), P9: a MIXED row (real approaches in ACTUAL conditions, alongside unrelated simulator time on the same entry) counts its real-aircraft approaches — simulatorTime alone must not route it into the device branch", () => {
  const entries = [
    entry({
      entryDate: "2026-07-01",
      approachesCount: 6,
      approachType: "ils",
      approachCondition: "actual", // actual weather cannot happen in a device — this is a REAL aircraft row
      simulatorTime: 0.5, // e.g. a debrief session logged on the same entry — irrelevant to the ACTUAL approaches
      simulatorDeviceType: "ffs",
      holds: 1,
      coursesInterceptedTracked: true,
    }),
  ];
  const r = evaluateInstrumentExperience({ asOf: "2026-08-07", airmanUserId: AIRMAN, intendedAircraft: aircraft(), entries });
  assert.equal(r.status, "estimated_current", "the real-aircraft approaches must not be silently zeroed out by the unrelated simulatorTime field");
  assert.equal(r.observed.approaches, 6);
  assert.deepEqual(r.missing, []);
});

test("61.57(c), REGU-4/CORR-1: an unrelated device row with no aircraft must not poison an otherwise-current instrument card", () => {
  const entries = [
    entry({
      entryDate: "2026-07-01",
      approachesCount: 6,
      approachType: "ils",
      approachCondition: "actual",
      holds: 1,
      coursesInterceptedTracked: true,
    }),
    entry({
      entryDate: "2026-07-05",
      approachesCount: 2,
      approachType: "ils",
      approachCondition: "simulated",
      simulatorTime: 1.0,
      simulatorDeviceType: "atd",
      aircraft: null,
    }),
  ];
  const r = evaluateInstrumentExperience({ asOf: "2026-08-07", airmanUserId: AIRMAN, intendedAircraft: aircraft(), entries });
  assert.equal(r.status, "estimated_current");
  assert.deepEqual(r.missing, []);
});

test("61.57(c): approach_condition unrecorded on a counted-approach row forces insufficient_data when it could be the difference", () => {
  const entries = [entry({ entryDate: "2026-07-01", approachesCount: 6, approachType: "ils", approachCondition: null, holds: 1, coursesInterceptedTracked: true })];
  const r = evaluateInstrumentExperience({ asOf: "2026-08-07", airmanUserId: AIRMAN, intendedAircraft: aircraft(), entries });
  assert.equal(r.status, "insufficient_data");
  assert.ok(r.missing.includes("approach_condition_unrecorded"));
});

test("61.57(c): approach_condition unrecorded never gates when it could not be the difference (short even in the best case)", () => {
  const entries = [entry({ entryDate: "2026-07-01", approachesCount: 6, approachType: "ils", approachCondition: null })];
  const r = evaluateInstrumentExperience({ asOf: "2026-08-07", airmanUserId: AIRMAN, intendedAircraft: aircraft(), entries });
  assert.equal(r.status, "estimated_not_current", "no holds/intercept even in the best case, so resolving the condition could never make this card current");
  assert.deepEqual(r.missing, []);
});

test("61.57(c): needs six approaches, at least one hold, and the intercept/track task — none need to share a flight", () => {
  const entries = [
    entry({ entryDate: "2026-07-01", approachesCount: 3, approachType: "ils", approachCondition: "actual" }),
    entry({ entryDate: "2026-07-10", approachesCount: 3, approachType: "rnav_lpv", approachCondition: "simulated" }),
    // holds/intercept rows must carry the same actual/simulated condition
    // and the same aircraft category as the approaches do (REG-2/REG-3) —
    // entry()'s default aircraft() already matches the intended aircraft.
    entry({ entryDate: "2026-07-15", holds: 1, approachCondition: "actual" }),
    entry({ entryDate: "2026-07-20", coursesInterceptedTracked: true, approachCondition: "actual" }),
  ];
  const r = evaluateInstrumentExperience({ asOf: "2026-08-07", airmanUserId: AIRMAN, intendedAircraft: aircraft(), entries });
  assert.equal(r.status, "estimated_current");
  assert.equal(r.observed.approaches, 6);
});

test("61.57(c), REG-2: a hold or intercept flown in VMC on a 'neither' row does not satisfy (c)(1)(ii)/(iii)", () => {
  // (c)(1)'s condition clause ("in actual weather conditions, or under
  // simulated conditions using a view-limiting device") governs holds and
  // course intercept/tracking exactly as it governs approaches — verified
  // against the live section text.
  const entries = [
    entry({ entryDate: "2026-07-01", approachesCount: 6, approachType: "ils", approachCondition: "actual" }),
    entry({ entryDate: "2026-07-10", holds: 1, coursesInterceptedTracked: true, approachCondition: "neither" }),
  ];
  const r = evaluateInstrumentExperience({ asOf: "2026-08-07", airmanUserId: AIRMAN, intendedAircraft: aircraft(), entries });
  assert.equal(r.status, "estimated_not_current");
  assert.equal(r.observed.holds, 0);
  assert.equal(r.observed.intercepts, 0);
});

test("61.57(c), REG-2: a hold row with no recorded condition is a missing input, exactly like an approach row, when it could be the difference", () => {
  const entries = [
    // Certain approaches, certain intercept — short only on holds.
    entry({ entryDate: "2026-07-01", approachesCount: 6, approachType: "ils", approachCondition: "actual" }),
    entry({ entryDate: "2026-07-05", coursesInterceptedTracked: true, approachCondition: "actual" }),
    // The only source of a hold, condition unresolved.
    entry({ entryDate: "2026-07-10", holds: 1, approachCondition: null }),
  ];
  const r = evaluateInstrumentExperience({ asOf: "2026-08-07", airmanUserId: AIRMAN, intendedAircraft: aircraft(), entries });
  assert.equal(r.status, "insufficient_data");
  assert.ok(r.missing.includes("approach_condition_unrecorded"));
});

test("61.57(c), REG-2: a hold row with no recorded condition never gates when it could not be the difference (no other source of a hold, short in the best case too)", () => {
  const entries = [entry({ entryDate: "2026-07-01", holds: 1, approachCondition: null })];
  const r = evaluateInstrumentExperience({ asOf: "2026-08-07", airmanUserId: AIRMAN, intendedAircraft: aircraft(), entries });
  assert.equal(r.status, "estimated_not_current", "zero approaches even in the best case, so this can never reach current regardless of the hold's condition");
  assert.deepEqual(r.missing, []);
});

test("61.57(c), REG-3: instrument time logged in a different-category aircraft does not manufacture the intended aircraft's currency", () => {
  const heli = aircraft({ typeRating: null, typeDesignator: "B407", categoryClass: "Helicopter", gear: "skid" });
  const airplane = aircraft({ typeRating: null, typeDesignator: "C208", categoryClass: "ASEL", gear: "tricycle" });
  const entries = [
    entry({ entryDate: "2026-07-01", approachesCount: 6, approachType: "ils", approachCondition: "actual", aircraft: heli }),
    entry({ entryDate: "2026-07-10", holds: 1, coursesInterceptedTracked: true, approachCondition: "actual", aircraft: heli }),
  ];
  const r = evaluateInstrumentExperience({ asOf: "2026-08-07", airmanUserId: AIRMAN, intendedAircraft: airplane, entries });
  assert.equal(r.status, "estimated_not_current", "helicopter instrument time must not manufacture airplane instrument currency");
  assert.equal(r.observed.approaches, 0);
});

test("61.57(c), CORR-2: category_class is matched as one field, so a different CLASS of the same category does not count — disclosed, not silent", () => {
  // 61.57(c) itself conditions only on CATEGORY (airplane vs helicopter,
  // etc). This schema's category_class column is one free-text field
  // with no separate category slot, so comparing it whole also requires
  // the CLASS to match (ASEL vs AMEL) — stricter than the text, in the
  // conservative direction (understates real currency, never manufactures
  // it), and it must say so on the card rather than claim "category only."
  const amel = aircraft({ typeRating: null, typeDesignator: "BE58", categoryClass: "AMEL", gear: "tricycle" });
  const asel = aircraft({ typeRating: null, typeDesignator: "C172", categoryClass: "ASEL", gear: "tricycle" });
  const entries = [
    entry({ entryDate: "2026-07-01", approachesCount: 6, approachType: "ils", approachCondition: "actual", holds: 1, coursesInterceptedTracked: true, aircraft: amel }),
  ];
  const r = evaluateInstrumentExperience({ asOf: "2026-08-07", airmanUserId: AIRMAN, intendedAircraft: asel, entries });
  assert.equal(r.status, "estimated_not_current", "same category (airplane), different class (AMEL vs ASEL) does not count under this schema's category_class field");
  assert.equal(r.observed.approaches, 0);
  assert.ok(r.assumptions.some((a) => a.includes("category/class field")), "the class-vs-category-only deviation must be disclosed on the card");
});

test("61.57(c), REG-3: a hold on an unregistered aircraft is a missing input, not silently dropped, when it could be the difference", () => {
  const entries = [
    // Certain approaches, certain intercept — short only on holds.
    entry({ entryDate: "2026-07-01", approachesCount: 6, approachType: "ils", approachCondition: "actual" }),
    entry({ entryDate: "2026-07-05", coursesInterceptedTracked: true, approachCondition: "actual" }),
    // The only source of a hold, aircraft not in the registry.
    entry({ entryDate: "2026-07-10", holds: 1, approachCondition: "actual", aircraft: null }),
  ];
  const r = evaluateInstrumentExperience({ asOf: "2026-08-07", airmanUserId: AIRMAN, intendedAircraft: aircraft(), entries });
  assert.equal(r.status, "insufficient_data");
  assert.ok(r.missing.includes("aircraft_unregistered"));
});

test("61.57(c), REG-3/Q1: a hold on an unregistered aircraft never gates when it could not be the difference — the exact shape of Q1's critical finding, generalized off the device case", () => {
  const entries = [
    // Already current on certain evidence alone.
    entry({ entryDate: "2026-07-01", approachesCount: 6, approachType: "ils", approachCondition: "actual", holds: 1, coursesInterceptedTracked: true }),
    // An unrelated, unregistered-aircraft hold entry could never change that.
    entry({ entryDate: "2026-07-10", holds: 1, approachCondition: "actual", aircraft: null }),
  ];
  const r = evaluateInstrumentExperience({ asOf: "2026-08-07", airmanUserId: AIRMAN, intendedAircraft: aircraft(), entries });
  assert.equal(r.status, "estimated_current");
  assert.deepEqual(r.missing, []);
});

test("61.57(c): the calendar-month window boundary matches worked example 1 exactly", () => {
  const feb1 = [entry({ entryDate: "2026-02-01", approachesCount: 6, approachType: "ils", approachCondition: "actual", holds: 1, coursesInterceptedTracked: true })];
  const currentAtBoundary = evaluateInstrumentExperience({ asOf: "2026-08-07", airmanUserId: AIRMAN, intendedAircraft: aircraft(), entries: feb1 });
  assert.equal(currentAtBoundary.status, "estimated_current");

  const jan31 = [entry({ entryDate: "2026-01-31", approachesCount: 6, approachType: "ils", approachCondition: "actual", holds: 1, coursesInterceptedTracked: true })];
  const notCurrentJustOutside = evaluateInstrumentExperience({ asOf: "2026-08-07", airmanUserId: AIRMAN, intendedAircraft: aircraft(), entries: jan31 });
  assert.equal(notCurrentJustOutside.status, "estimated_not_current");
});

test("61.57(c): a mixed multi-approach entry discloses its assumption in notes rather than silently over- or under-counting", () => {
  const entries = [
    entry({ entryDate: "2026-07-01", approachesCount: 6, approachType: "ils", approachCondition: "actual", holds: 1, coursesInterceptedTracked: true }),
  ];
  const r = evaluateInstrumentExperience({ asOf: "2026-08-07", airmanUserId: AIRMAN, intendedAircraft: aircraft(), entries });
  assert.equal(r.status, "estimated_current");
  assert.ok(r.notes.some((n) => n.includes("6 approaches counted from one entry")));
});

// ---------------------------------------------------------------------------
// flight-review.ts — 61.56.
// ---------------------------------------------------------------------------

test("61.56: no completion date on record -> insufficient_data, never a guess", () => {
  const r = evaluateFlightReview({ asOf: "2026-08-07", completedOn: null });
  assert.equal(r.status, "insufficient_data");
  assert.deepEqual(r.missing, ["flight_review_completion_absent"]);
});

test("61.56: a completion date in the future is refused, not silently accepted", () => {
  const r = evaluateFlightReview({ asOf: "2026-08-07", completedOn: "2026-09-01" });
  assert.equal(r.status, "insufficient_data");
  assert.deepEqual(r.missing, ["flight_review_completion_in_future"]);
});

test("61.56: worked example 2 — completed 15 AUG 2024 is current through 31 AUG 2026", () => {
  const r = evaluateFlightReview({ asOf: "2026-08-07", completedOn: "2024-08-15" });
  assert.equal(r.status, "estimated_current");
  assert.equal(r.throughDate, "2026-08-31");
});

test("61.56: the calendar-month boundary — 01 AUG 2024 qualifies for a 07 AUG 2026 flight, 31 JUL 2024 does not", () => {
  const qualifies = evaluateFlightReview({ asOf: "2026-08-07", completedOn: "2024-08-01" });
  assert.equal(qualifies.status, "estimated_current");

  const doesNot = evaluateFlightReview({ asOf: "2026-08-07", completedOn: "2024-07-31" });
  assert.equal(doesNot.status, "estimated_not_current");
});

test("61.56: the through-date form and the window-start form agree (docs/CURRENCY-SPEC.md §3's cross-assertion)", () => {
  for (const completedOn of ["2024-08-01", "2024-08-15", "2024-08-31", "2024-07-31", "2020-01-01"]) {
    const asOf = "2026-08-07";
    const r = evaluateFlightReview({ asOf, completedOn });
    const fromWindow = r.window ? completedOn >= r.window.start : null;
    const fromThroughDate = r.throughDate !== null ? r.throughDate >= asOf : null;
    assert.equal(fromWindow, fromThroughDate, `disagreement for completedOn=${completedOn}`);
  }
});

test("61.56: a not-current result always carries the 61.56(d) substitute note, never a bare negative", () => {
  const r = evaluateFlightReview({ asOf: "2026-08-07", completedOn: "2020-01-01" });
  assert.equal(r.status, "estimated_not_current");
  assert.ok(r.notes.some((n) => n.includes("61.56(d)")));
});

// ---------------------------------------------------------------------------
// medical.ts — 61.23. Fixture M-3.
// ---------------------------------------------------------------------------

test("61.23, fixture M-3: unconditionally insufficient_data, even with a full fact pattern handed to it", () => {
  const r = evaluateMedical({ pilotEnteredExpiresOn: "2027-08-31" });
  assert.equal(r.status, "insufficient_data");
  assert.deepEqual(r.missing, ["medical_never_computed"]);
  assert.equal(r.displayDate, "2027-08-31");

  const withNothing = evaluateMedical({ pilotEnteredExpiresOn: null });
  assert.equal(withNothing.status, "insufficient_data");
  assert.equal(withNothing.displayDate, null);
});

// ---------------------------------------------------------------------------
// part135.ts — 135.247(a).
// ---------------------------------------------------------------------------

test("135.247: operating rule unspecified is insufficient_data on both variants, by construction (S4)", () => {
  const { day, night } = evaluatePart135Recency({
    asOf: "2026-08-07",
    airmanUserId: AIRMAN,
    operatingRule: "unspecified",
    exemptionAsserted: true,
    intendedAircraft: aircraft(),
    entries: [],
  });
  assert.equal(day.status, "insufficient_data");
  assert.deepEqual(day.missing, ["operating_rule_unspecified"]);
  assert.equal(night.status, "insufficient_data");
  assert.deepEqual(night.missing, ["operating_rule_unspecified"]);
});

test("135.247(a)(2), fixture P-2: night landings need NOT be to a full stop, unlike 61.57(b)(1)", () => {
  const entries = [
    entry({ entryDate: "2026-07-01", nightTakeoffs: 3, nightLandingsTouchGo: 3, nightWindowAsserted: true }),
  ];
  const { night } = evaluatePart135Recency({
    asOf: "2026-08-07",
    airmanUserId: AIRMAN,
    operatingRule: "part_135",
    exemptionAsserted: false,
    intendedAircraft: aircraft({ gear: "tricycle" }),
    entries,
  });
  assert.equal(night.status, "estimated_current", "touch-and-go night landings satisfy 135.247(a)(2) for a non-tailwheel aircraft");
});

test("135.247(b), fixture P-3: a tailwheel airplane requires full-stop landings even for the night variant", () => {
  const tw = aircraft({ gear: "tailwheel" });
  const entries = [
    entry({ entryDate: "2026-07-01", nightTakeoffs: 3, nightLandingsTouchGo: 3, nightWindowAsserted: true, aircraft: tw }),
  ];
  const { night } = evaluatePart135Recency({
    asOf: "2026-08-07",
    airmanUserId: AIRMAN,
    operatingRule: "part_135",
    exemptionAsserted: false,
    intendedAircraft: tw,
    entries,
  });
  // Built from the spec as written (without 135.247(b)), this would
  // read estimated_current — a tailwheel pilot manufactured night
  // currency out of touch-and-goes. 135.247(b) must stop that.
  assert.equal(night.status, "estimated_not_current");
  assert.equal(night.observed.landings, 0);

  const withFullStop = evaluatePart135Recency({
    asOf: "2026-08-07",
    airmanUserId: AIRMAN,
    operatingRule: "part_135",
    exemptionAsserted: false,
    intendedAircraft: tw,
    entries: [
      entry({ entryDate: "2026-07-01", nightTakeoffs: 3, nightLandingsFullStop: 3, nightWindowAsserted: true, aircraft: tw }),
    ],
  });
  assert.equal(withFullStop.night.status, "estimated_current");
});

test("135.247(b), REGU-2: takeoffs and landings must be MADE IN a tailwheel airplane, not merely counted from full-stop columns", () => {
  const tw = aircraft({ gear: "tailwheel" });
  const sameTypeTricycle = aircraft({ gear: "tricycle" }); // same category/type/rating as tw, different gear
  const entries = [
    entry({ entryDate: "2026-07-01", dayTakeoffs: 3, dayLandingsFullStop: 3, nightTakeoffs: 3, nightLandingsFullStop: 3, nightWindowAsserted: true, aircraft: sameTypeTricycle }),
  ];
  const { day, night } = evaluatePart135Recency({
    asOf: "2026-08-07",
    airmanUserId: AIRMAN,
    operatingRule: "part_135",
    exemptionAsserted: false,
    intendedAircraft: tw,
    entries,
  });
  // PROVEN BUG (REGU-2): full-stop landings in a tricycle Skyhawk of the
  // same type/category used to credit a taildragger's currency — 135.247(b)
  // requires the LOGGED aircraft to be a tailwheel airplane, not merely
  // the landing to be full stop.
  assert.equal(night.status, "estimated_not_current");
  assert.equal(night.observed.landings, 0);
  assert.equal(night.observed.takeoffs, 0);
  assert.equal(day.status, "estimated_not_current");
  assert.equal(day.observed.takeoffs, 0);

  const nullGear = aircraft({ gear: null });
  const gapResult = evaluatePart135Recency({
    asOf: "2026-08-07",
    airmanUserId: AIRMAN,
    operatingRule: "part_135",
    exemptionAsserted: false,
    intendedAircraft: tw,
    entries: [entry({ entryDate: "2026-07-01", nightTakeoffs: 3, nightLandingsFullStop: 3, nightWindowAsserted: true, aircraft: nullGear })],
  });
  // REGU-5: an unrecorded gear on the LOGGED aircraft is a missing input,
  // not a silent pass.
  assert.equal(gapResult.night.status, "insufficient_data");
  assert.ok(gapResult.night.missing.includes("aircraft_gear_unrecorded"));
});

test("135.247(a), fixture P-4: complying with the night variant satisfies the day variant too", () => {
  const entries = [
    entry({ entryDate: "2026-07-01", nightTakeoffs: 3, nightLandingsFullStop: 3, nightWindowAsserted: true }),
  ];
  const { day, night } = evaluatePart135Recency({
    asOf: "2026-08-07",
    airmanUserId: AIRMAN,
    operatingRule: "part_135",
    exemptionAsserted: false,
    intendedAircraft: aircraft(),
    entries,
  });
  assert.equal(night.status, "estimated_current");
  assert.equal(day.status, "estimated_current");
  assert.equal(day.ruleBasis, "135.247(a)(2)", "the day result is relabeled to show it was satisfied by the night variant");
  assert.ok(day.notes.some((n) => n.includes("135.247(a)(2)")));
});

test("135.247(a), REG-1/SEC-1: night satisfying day never leaves day's own missing/empty fields attached to a current verdict", () => {
  // Reproduces the exact fixture the review used: a registered aircraft's
  // night activity satisfies the night variant; a SECOND entry carries
  // only day movements on an unregistered tail, which trips day's OWN
  // aircraftUnregisteredGate but is invisible to night's (night reads
  // only night columns, both 0 on that row).
  const registered = aircraft();
  const entries = [
    entry({ entryDate: "2026-07-01", nightTakeoffs: 3, nightLandingsFullStop: 3, nightWindowAsserted: true, aircraft: registered }),
    entry({ entryDate: "2026-07-15", dayLandingsTouchGo: 1, aircraft: null }),
  ];
  const { day, night } = evaluatePart135Recency({
    asOf: "2026-08-07",
    airmanUserId: AIRMAN,
    operatingRule: "part_135",
    exemptionAsserted: false,
    intendedAircraft: registered,
    entries,
  });
  assert.equal(night.status, "estimated_current");
  assert.equal(day.status, "estimated_current");
  // The CurrencyResult invariant every result must hold: missing is
  // non-empty IFF status === "insufficient_data". A partial `{...day,
  // status: "estimated_current"}` overwrite left day.missing populated
  // and day.observed empty while claiming to be current — this is the
  // exact permissive, self-contradictory verdict the fix removes.
  assert.deepEqual(day.missing, []);
  assert.ok(Object.keys(day.observed).length > 0, "day's observed counts must come from a real evaluation, not an empty object left over from day's own broken one");
  assert.equal(day.observed.takeoffs, night.observed.takeoffs, "day is rebuilt from night's own well-formed result, never a partial overwrite of day's own");
  assert.equal(day.counted.length, night.counted.length);
});

// ---------------------------------------------------------------------------
// index.ts — the orchestrator.
// ---------------------------------------------------------------------------

test("evaluateCurrency always returns exactly five results, in vocabulary order", () => {
  const results = evaluateCurrency({
    asOf: "2026-08-07",
    airmanUserId: AIRMAN,
    intendedAircraft: null,
    operatingRule: "unspecified",
    exemptionAsserted: false,
    flightReviewCompletedOn: null,
    medicalExpiresOn: null,
    entries: [],
  });
  assert.equal(results.length, 5);
  assert.deepEqual(
    results.map((r) => r.currencyType),
    ["passenger_day", "passenger_night", "instrument", "flight_review", "medical"]
  );
});

test("evaluateCurrency throws a named error for a malformed asOf rather than returning a hedge", () => {
  assert.throws(
    () =>
      evaluateCurrency({
        asOf: "not-a-date",
        airmanUserId: AIRMAN,
        intendedAircraft: null,
        operatingRule: "unspecified",
        exemptionAsserted: false,
        flightReviewCompletedOn: null,
        medicalExpiresOn: null,
        entries: [],
      }),
    InvalidAsOfDateError
  );
});

test("evaluateCurrency: part_135 + exemption asserted substitutes 135.247 for passenger_day/night and relabels 61.57, never suppressing it", () => {
  const entries = [
    entry({ entryDate: "2026-07-01", nightTakeoffs: 3, nightLandingsFullStop: 3, nightWindowAsserted: true }),
  ];
  const results = evaluateCurrency({
    asOf: "2026-08-07",
    airmanUserId: AIRMAN,
    intendedAircraft: aircraft(),
    operatingRule: "part_135",
    exemptionAsserted: true,
    flightReviewCompletedOn: null,
    medicalExpiresOn: null,
    entries,
  });
  const night = results.find((r) => r.currencyType === "passenger_night");
  assert.equal(night.ruleBasis, "135.247(a)(2)");
  assert.equal(night.status, "estimated_current");
  assert.ok(night.notes.some((n) => n.includes("61.57(b)")), "the underlying 61.57(b) verdict is still visible, not hidden");
});

test("evaluateCurrency: unspecified operating rule leaves 61.57 unmodified, no (e)(3) note", () => {
  const results = evaluateCurrency({
    asOf: "2026-08-07",
    airmanUserId: AIRMAN,
    intendedAircraft: aircraft(),
    operatingRule: "unspecified",
    exemptionAsserted: false,
    flightReviewCompletedOn: null,
    medicalExpiresOn: null,
    entries: [],
  });
  const day = results.find((r) => r.currencyType === "passenger_day");
  assert.equal(day.ruleBasis, "61.57(a)");
  assert.ok(!day.notes.some((n) => n.includes("61.57(e)(3)")));
});

test("evaluateCurrency, REGU-8: operating rule unspecified gets no (e)(3) note EVEN WHEN the exemption is asserted anyway", () => {
  // index.ts's own branch table says 'unspecified' never gets the (e)(3)
  // note — the certificate-holder relationship it describes cannot be
  // reasoned about when the operating rule itself is unknown. The old
  // `else if (exemptionAsserted)` branch did not exclude 'unspecified'
  // and rendered permissive-leaning (e)(3) copy on the one branch the
  // engine says it knows nothing about that relationship.
  const results = evaluateCurrency({
    asOf: "2026-08-07",
    airmanUserId: AIRMAN,
    intendedAircraft: aircraft(),
    operatingRule: "unspecified",
    exemptionAsserted: true,
    flightReviewCompletedOn: null,
    medicalExpiresOn: null,
    entries: [],
  });
  const day = results.find((r) => r.currencyType === "passenger_day");
  const night = results.find((r) => r.currencyType === "passenger_night");
  assert.equal(day.ruleBasis, "61.57(a)");
  assert.ok(!day.notes.some((n) => n.includes("61.57(e)(3)")));
  assert.ok(!night.notes.some((n) => n.includes("61.57(e)(3)")));
});

test("evaluateCurrency, REGU-6: the (e)(3) exemption does not touch the instrument (61.57(c)) result — documented, not fixed", () => {
  const results = evaluateCurrency({
    asOf: "2026-08-07",
    airmanUserId: AIRMAN,
    intendedAircraft: aircraft(),
    operatingRule: "part_135",
    exemptionAsserted: true,
    flightReviewCompletedOn: null,
    medicalExpiresOn: null,
    entries: [],
  });
  const instrument = results.find((r) => r.currencyType === "instrument");
  assert.equal(instrument.ruleBasis, "61.57(c)", "no 135-based instrument substitute exists to swap in");
});

test("evaluateCurrency, REG-8: the 135.247 substitution note discloses that 135.243 compliance is a separate, unevaluated condition", () => {
  const entries = [
    entry({ entryDate: "2026-07-01", nightTakeoffs: 3, nightLandingsFullStop: 3, nightWindowAsserted: true }),
  ];
  const results = evaluateCurrency({
    asOf: "2026-08-07",
    airmanUserId: AIRMAN,
    intendedAircraft: aircraft(),
    operatingRule: "part_135",
    exemptionAsserted: true,
    flightReviewCompletedOn: null,
    medicalExpiresOn: null,
    entries,
  });
  const night = results.find((r) => r.currencyType === "passenger_night");
  assert.ok(
    night.notes.some((n) => n.includes("135.243")),
    "61.57(e)(3) conditions the exemption on BOTH 135.243 and 135.247 — the note must not silently drop the first"
  );
});

test("evaluateCurrency, SEC-18: entriesTruncated forces every entries-dependent result to insufficient_data with window_truncated, and nothing else", () => {
  const entries = [
    entry({ entryDate: "2026-07-01", dayTakeoffs: 3, dayLandingsFullStop: 3 }),
    entry({ entryDate: "2026-07-01", nightTakeoffs: 3, nightLandingsFullStop: 3, nightWindowAsserted: true }),
    entry({
      entryDate: "2026-07-01",
      approachesCount: 6,
      approachType: "ils",
      approachCondition: "actual",
      holds: 1,
      coursesInterceptedTracked: true,
    }),
  ];
  const results = evaluateCurrency({
    asOf: "2026-08-07",
    airmanUserId: AIRMAN,
    intendedAircraft: aircraft(),
    operatingRule: "unspecified",
    exemptionAsserted: false,
    flightReviewCompletedOn: "2024-08-15",
    medicalExpiresOn: "2027-01-01",
    entries,
    entriesTruncated: true,
  });
  for (const type of ["passenger_day", "passenger_night", "instrument"]) {
    const r = results.find((x) => x.currencyType === type);
    assert.equal(r.status, "insufficient_data", `${type} must not report a count computed from a possibly-incomplete logbook`);
    assert.deepEqual(r.missing, ["window_truncated"]);
    assert.deepEqual(r.observed, {});
  }
  // flight_review and medical read only documents, not entries — untouched.
  const flightReview = results.find((r) => r.currencyType === "flight_review");
  assert.equal(flightReview.status, "estimated_current");
  const medical = results.find((r) => r.currencyType === "medical");
  assert.deepEqual(medical.missing, ["medical_never_computed"]);
});

test("evaluateCurrency: entriesTruncated defaults to false, so an existing caller with no notion of paging is unaffected", () => {
  const entries = [entry({ entryDate: "2026-07-01", dayTakeoffs: 3, dayLandingsFullStop: 3 })];
  const results = evaluateCurrency({
    asOf: "2026-08-07",
    airmanUserId: AIRMAN,
    intendedAircraft: aircraft(),
    operatingRule: "unspecified",
    exemptionAsserted: false,
    flightReviewCompletedOn: null,
    medicalExpiresOn: null,
    entries,
  });
  const day = results.find((r) => r.currencyType === "passenger_day");
  assert.notDeepEqual(day.missing, ["window_truncated"]);
});

// ---------------------------------------------------------------------------
// describe.ts — every state name is exactly the locked vocabulary's prose.
// ---------------------------------------------------------------------------

test("describeResult never says current/legal/compliant, and names a remedy for every missing input", () => {
  const insufficient = evaluateGeneralExperience({ asOf: "2026-08-07", airmanUserId: AIRMAN, intendedAircraft: null, entries: [] });
  const described = describeResult(insufficient);
  assert.equal(described.headline, "Not enough information");
  assert.equal(described.remedies.length, insufficient.missing.length);
  for (const remedy of described.remedies) {
    assert.ok(remedy.label.length > 0);
  }

  const current = evaluateFlightReview({ asOf: "2026-08-07", completedOn: "2024-08-15" });
  const describedCurrent = describeResult(current);
  assert.equal(describedCurrent.headline, "Estimated current");

  const notCurrent = evaluateFlightReview({ asOf: "2026-08-07", completedOn: "2020-01-15" });
  const describedNotCurrent = describeResult(notCurrent);
  assert.equal(describedNotCurrent.headline, "Estimated not current");

  // Checked as the whole locked vocabulary (SEC-14): a single anchored
  // regex against one headline this test happened to compute can never
  // fail. Every headline must be hedged with "Estimated" or be the
  // "Not enough information" fallback, and none may be a bare claim.
  for (const headline of [described.headline, describedCurrent.headline, describedNotCurrent.headline]) {
    assert.ok(
      headline === "Not enough information" || /^Estimated /.test(headline),
      `"${headline}" must be hedged as an estimate, never a bare claim`
    );
    for (const bare of ["current", "legal", "compliant"]) {
      assert.notEqual(headline.toLowerCase(), bare);
    }
  }
});

test("describeResult, SEC-6/SEC-14: every aircraft-related remedy points at the real aircraft registry route", () => {
  // A hardcoded string like the previous test's `startsWith("/")` cannot
  // fail no matter what the href is. This instead pins the exact route —
  // app/(app)/logbook/aircraft, not the nonexistent "/aircraft" every one
  // of these five remedies used to point at.
  const base = evaluateGeneralExperience({ asOf: "2026-08-07", airmanUserId: AIRMAN, intendedAircraft: null, entries: [] });
  const AIRCRAFT_MISSING = [
    "intended_aircraft_absent",
    "aircraft_unregistered",
    "aircraft_gear_unrecorded",
    "aircraft_category_class_unrecorded",
    "aircraft_type_unrecorded",
  ];
  for (const missing of AIRCRAFT_MISSING) {
    const described = describeResult({ ...base, missing: [missing] });
    assert.equal(described.remedies[0].href, "/logbook/aircraft", `${missing} must route to the real aircraft registry`);
  }
});

// =============================================================================
// THE INVARIANT — the test that would have caught all five review rounds.
//
// Every one of those rounds found the identical bug in a new place: a fact
// missing from ONE logbook entry emptied the WHOLE card, even for a pilot
// whose OTHER entries already answered it. lib/currency/ambiguous-facts.ts's
// missingFactCouldChangeAnswer is the fix, and this file's tests above prove
// it works ONE GATE AT A TIME (P1 for type/category, the Q1-generalized
// pairs above for airman/role/sole-manipulator/registration/gear/simulator/
// approach-condition/device). This block asserts the SHAPE of the bug
// directly, across every gate at once, so the next occurrence — in a gate
// nobody has thought to write a paired test for yet — fails here first.
//
// FLYING MORE CANNOT MAKE A PILOT LESS CURRENT. That is true of the
// regulation (61.57/(135.247's thresholds are floors: three takeoffs and
// three landings, six approaches — once met, nothing about a DIFFERENT,
// later-added log entry can un-meet them) and it must be true of the
// engine:
//
//   Adding one more logbook entry to a pilot's history must NEVER turn a
//   card from estimated_current into insufficient_data.
//
// This holds with NO REGULATORY EXCEPTION, for a structural reason, not a
// policy one: every "certain" set this engine computes (classifyForCurrency
// in passenger-shared.ts, classifyInstrumentEntry in instrument.ts) is
// read-only over the window and can only GAIN members as entries are added
// — nothing about a NEW entry can un-qualify an EXISTING one, and
// missingFactCouldChangeAnswer only ever gates when the CERTAIN total
// (which cannot shrink) is short of the threshold. So if certain evidence
// already clears the bar, it goes on clearing it no matter what else is
// logged. Contrast with the property this file does NOT assert — that
// adding an entry can flip estimated_not_current or insufficient_data
// FORWARD to estimated_current or vice versa within the "could this change
// the answer" arithmetic — which is supposed to happen and is covered by
// the P1/P9/Q1-generalized "COULD be the difference" tests elsewhere in
// this file. See the WHERE THE INVARIANT DOES NOT APPLY note at the end of
// this block for why the two are different claims, spelled out rather than
// used to weaken the property below.
// =============================================================================

test("INVARIANT: adding one more ambiguous logbook entry to an already-current pilot's history never produces insufficient_data", async (t) => {
  const TRICYCLE = aircraft({ tailKey: "N-TRI", gear: "tricycle" });
  const TAILWHEEL = aircraft({ tailKey: "N-TW", gear: "tailwheel" });

  function baseDayEntries(ac) {
    return [
      entry({ entryDate: "2026-07-01", dayTakeoffs: 1, dayLandingsFullStop: 1, aircraft: ac }),
      entry({ entryDate: "2026-07-10", dayTakeoffs: 1, dayLandingsFullStop: 1, aircraft: ac }),
      entry({ entryDate: "2026-07-20", dayTakeoffs: 1, dayLandingsFullStop: 1, aircraft: ac }),
    ];
  }
  function baseNightEntries(ac) {
    return [
      entry({ entryDate: "2026-07-01", nightTakeoffs: 1, nightLandingsFullStop: 1, nightWindowAsserted: true, aircraft: ac }),
      entry({ entryDate: "2026-07-10", nightTakeoffs: 1, nightLandingsFullStop: 1, nightWindowAsserted: true, aircraft: ac }),
      entry({ entryDate: "2026-07-20", nightTakeoffs: 1, nightLandingsFullStop: 1, nightWindowAsserted: true, aircraft: ac }),
    ];
  }
  function baseInstrumentEntries(ac) {
    return [
      entry({
        entryDate: "2026-07-01",
        approachesCount: 6,
        approachType: "ils",
        approachCondition: "actual",
        holds: 1,
        coursesInterceptedTracked: true,
        aircraft: ac,
      }),
    ];
  }

  // The table of ambiguous facts for the three 90-day cards — one entry
  // per fact, each carrying enough movement to have reached the threshold
  // ON ITS OWN, so a card that DIDN'T already have three certain entries
  // would have to ask about it (see the P1/Q1-generalized "COULD be the
  // difference" tests elsewhere in this file for that half). `includeGear`
  // is false for night.ts, which has no gear axis of its own (see that
  // module's header) and true everywhere else.
  function ninetyDayAmbiguousVariants(movementFields, ac, includeGear) {
    const variants = {
      "null role": { ...movementFields, role: null, aircraft: ac },
      "null sole_manipulator": { ...movementFields, soleManipulator: null, aircraft: ac },
      "null airman": { ...movementFields, airmanUserId: null, aircraft: ac },
      "unregistered tail": { ...movementFields, aircraft: null },
      "blank category": { ...movementFields, aircraft: { ...ac, categoryClass: null } },
      "blank type rating and designator (unresolved type)": {
        ...movementFields,
        aircraft: { ...ac, typeRating: null, typeDesignator: null },
      },
      "simulator row (device, unconfirmable approval — 61.57(a)(3)/(b)(2)/135.247(a)(3))": {
        ...movementFields,
        simulatorTime: 1.0,
        simulatorDeviceType: "ffs",
        aircraft: null,
      },
      "mixed real-and-device row (real movements plus unrelated simulatorTime on the same entry)": {
        ...movementFields,
        simulatorTime: 0.5,
        simulatorDeviceType: "ffs",
        aircraft: ac,
      },
    };
    if (includeGear) {
      variants["null gear"] = { ...movementFields, aircraft: { ...ac, gear: null } };
    }
    return variants;
  }

  function assertNeverBecomesInsufficient(cardLabel, base, variants, evaluate) {
    for (const [name, overrides] of Object.entries(variants)) {
      const withExtra = evaluate([...base, entry({ entryDate: "2026-07-15", ...overrides })]);
      assert.equal(withExtra.status, "estimated_current", `${cardLabel} + ${name} must stay estimated_current`);
      assert.deepEqual(withExtra.missing, [], `${cardLabel} + ${name} must carry no missing input`);
    }
  }

  await t.test("61.57(a) — exercised against a TAILWHEEL intended aircraft so the gear axis is covered too", () => {
    const base = baseDayEntries(TAILWHEEL);
    const sanity = evaluateGeneralExperience({ asOf: "2026-08-07", airmanUserId: AIRMAN, intendedAircraft: TAILWHEEL, entries: base });
    assert.equal(sanity.status, "estimated_current", "the base history itself must be current for this property to mean anything");

    const variants = ninetyDayAmbiguousVariants({ dayTakeoffs: 3, dayLandingsFullStop: 3 }, TAILWHEEL, true);
    assertNeverBecomesInsufficient("61.57(a)", base, variants, (entries) =>
      evaluateGeneralExperience({ asOf: "2026-08-07", airmanUserId: AIRMAN, intendedAircraft: TAILWHEEL, entries })
    );
  });

  await t.test("61.57(b) — no gear axis of its own; the 61.57(b)(1) window is its extra axis instead", () => {
    const base = baseNightEntries(TRICYCLE);
    const sanity = evaluateNightExperience({ asOf: "2026-08-07", airmanUserId: AIRMAN, intendedAircraft: TRICYCLE, entries: base });
    assert.equal(sanity.status, "estimated_current");

    const variants = ninetyDayAmbiguousVariants(
      { nightTakeoffs: 3, nightLandingsFullStop: 3, nightWindowAsserted: true },
      TRICYCLE,
      false
    );
    variants["night window unasserted (null — not the (b)(1) window, distinct from 14 CFR 1.1 night)"] = {
      nightTakeoffs: 3,
      nightLandingsFullStop: 3,
      nightWindowAsserted: null,
      aircraft: TRICYCLE,
    };
    assertNeverBecomesInsufficient("61.57(b)", base, variants, (entries) =>
      evaluateNightExperience({ asOf: "2026-08-07", airmanUserId: AIRMAN, intendedAircraft: TRICYCLE, entries })
    );
  });

  await t.test("135.247(a)(1) day — TAILWHEEL, both gear and the 90-day axes apply", () => {
    const base = baseDayEntries(TAILWHEEL);
    const sanity = evaluatePart135Recency({
      asOf: "2026-08-07", airmanUserId: AIRMAN, operatingRule: "part_135", exemptionAsserted: false,
      intendedAircraft: TAILWHEEL, entries: base,
    });
    assert.equal(sanity.day.status, "estimated_current");

    const variants = ninetyDayAmbiguousVariants({ dayTakeoffs: 3, dayLandingsFullStop: 3 }, TAILWHEEL, true);
    assertNeverBecomesInsufficient("135.247(a)(1)", base, variants, (entries) =>
      evaluatePart135Recency({
        asOf: "2026-08-07", airmanUserId: AIRMAN, operatingRule: "part_135", exemptionAsserted: false,
        intendedAircraft: TAILWHEEL, entries,
      }).day
    );
  });

  await t.test("135.247(a)(2) night — TAILWHEEL, gear AND the (b)(1)-style window both apply (135.247(b) reaches the night variant)", () => {
    const base = baseNightEntries(TAILWHEEL);
    const sanity = evaluatePart135Recency({
      asOf: "2026-08-07", airmanUserId: AIRMAN, operatingRule: "part_135", exemptionAsserted: false,
      intendedAircraft: TAILWHEEL, entries: base,
    });
    assert.equal(sanity.night.status, "estimated_current");

    const variants = ninetyDayAmbiguousVariants(
      { nightTakeoffs: 3, nightLandingsFullStop: 3, nightWindowAsserted: true },
      TAILWHEEL,
      true
    );
    variants["night window unasserted (null)"] = {
      nightTakeoffs: 3,
      nightLandingsFullStop: 3,
      nightWindowAsserted: null,
      aircraft: TAILWHEEL,
    };
    assertNeverBecomesInsufficient("135.247(a)(2)", base, variants, (entries) =>
      evaluatePart135Recency({
        asOf: "2026-08-07", airmanUserId: AIRMAN, operatingRule: "part_135", exemptionAsserted: false,
        intendedAircraft: TAILWHEEL, entries,
      }).night
    );
  });

  await t.test("61.57(c) — its own axes: airman, approach_condition, aircraft registry/category, and the device predicate (no role/sole-manipulator/gear axis on this card)", () => {
    const base = baseInstrumentEntries(TRICYCLE);
    const sanity = evaluateInstrumentExperience({ asOf: "2026-08-07", airmanUserId: AIRMAN, intendedAircraft: TRICYCLE, entries: base });
    assert.equal(sanity.status, "estimated_current");

    const full = { approachesCount: 6, approachType: "ils", holds: 1, coursesInterceptedTracked: true };
    const variants = {
      "null airman": { ...full, approachCondition: "actual", airmanUserId: null, aircraft: TRICYCLE },
      "unregistered tail": { ...full, approachCondition: "actual", aircraft: null },
      "blank category": { ...full, approachCondition: "actual", aircraft: { ...TRICYCLE, categoryClass: null } },
      "approach_condition null, real aircraft": { ...full, approachCondition: null, aircraft: TRICYCLE },
      "device row, condition 'simulated' (61.57(c)(2)'s own device-represents-category predicate is unconfirmable)": {
        ...full, approachCondition: "simulated", simulatorTime: 1.0, simulatorDeviceType: "atd", aircraft: null,
      },
      "device row, condition null (approach_condition_unrecorded on a device)": {
        ...full, approachCondition: null, simulatorTime: 1.0, simulatorDeviceType: "atd", aircraft: null,
      },
      "device row, condition 'neither' (decisive exclusion, per Q1 — proven here to never gate either)": {
        ...full, approachCondition: "neither", simulatorTime: 1.0, simulatorDeviceType: "atd", aircraft: null,
      },
      "device row, device type 'other' (unresolvable_simulator_row)": {
        ...full, approachCondition: "simulated", simulatorTime: 1.0, simulatorDeviceType: "other", aircraft: null,
      },
      "mixed real-and-device row (condition 'actual' plus unrelated simulatorTime — P9's fixture, generalized)": {
        ...full, approachCondition: "actual", simulatorTime: 0.5, simulatorDeviceType: "ffs", aircraft: TRICYCLE,
      },
    };
    for (const [name, overrides] of Object.entries(variants)) {
      const withExtra = evaluateInstrumentExperience({
        asOf: "2026-08-07", airmanUserId: AIRMAN, intendedAircraft: TRICYCLE,
        entries: [...base, entry({ entryDate: "2026-07-05", ...overrides })],
      });
      assert.equal(withExtra.status, "estimated_current", `61.57(c) + ${name} must stay estimated_current`);
      assert.deepEqual(withExtra.missing, [], `61.57(c) + ${name} must carry no missing input`);
    }
  });

  // -------------------------------------------------------------------------
  // WHERE THIS INVARIANT LEGITIMATELY DOES NOT APPLY — written down, rather
  // than used to weaken the property above (the one unforgivable move).
  //
  // The invariant is ONE DIRECTION ONLY: estimated_current -> insufficient_
  // data by adding an entry. It is silent on, and does not forbid:
  //   - estimated_not_current -> estimated_current: a NEW, fully-CERTAIN
  //     qualifying entry is supposed to do exactly this (every basic A-1-
  //     shaped fixture in this file proves the engine does it).
  //   - insufficient_data staying insufficient_data, or resolving to
  //     estimated_current, as an AMBIGUOUS fact is settled: this is what
  //     the P1 (a17/a18/a19), Q1-generalized, and REGU-4/CORR-1 tests
  //     elsewhere in this file cover — a SHORT pilot whose only chance at
  //     currency is one ambiguous entry legitimately gets asked, not
  //     answered, per 61.57(a)(1)/(b)(1)/135.247(a) and 61.57(c)(2)'s own
  //     text. That is not a counter-example to the invariant above, because
  //     the base in those fixtures is never estimated_current to begin
  //     with — nothing here is "one more entry took away a yes."
  // No fact pattern this engine encodes can turn the SECOND case into the
  // first without changing the base history itself (adding a wholly
  // separate, fully-certain entry) — which is a different logbook, not "one
  // more entry."
  // -------------------------------------------------------------------------
});

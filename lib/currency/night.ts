/**
 * 61.57(b) night takeoff and landing experience -> currency_type "passenger_night".
 *
 * https://www.ecfr.gov/current/title-14/section-61.57, fetched issue date
 * 2026-08-05, retrieved 2026-08-07/2026-08-10. "no person may act as
 * pilot in command of an aircraft carrying persons during the period
 * beginning 1 hour after sunset and ending 1 hour before sunrise, unless
 * within the preceding 90 days that person has made at least three
 * takeoffs and three landings TO A FULL STOP during the period..."
 *
 * THE SINGLE MOST DANGEROUS SILENT ERROR THIS ENGINE CAN MAKE: treating
 * `night_time` (14 CFR 1.1 — civil twilight to civil twilight) and the
 * 61.57(b)(1) window (1 hour after sunset to 1 hour before sunrise) as
 * the same clock. They are not — civil twilight ends roughly 25-35
 * minutes after sunset, so there is a nightly window in which a landing
 * is correctly logged as night_time and is NOT inside 61.57(b)(1)'s
 * period. See classifyForCurrency's `checkNightWindow` option below, and
 * supabase/migrations/20260807120000_logbook_reg_corrections.sql section
 * B, which documents the same distinction on the column itself.
 *
 * THE GEAR CHECK IS NOT COPIED FROM general.ts. 61.57(b) has no tailwheel
 * clause of its own — full stop is required for EVERY aircraft here, not
 * only tailwheel ones, so there is nothing for a gear flag to change.
 * (135.247(b) IS a tailwheel rule that reaches the night variant — see
 * part135.ts. Do not conflate the two.)
 */
import { rollingDayWindow } from "./window";
import {
  CATEGORY_MATCH_ASSUMPTION,
  NINETY_DAYS,
  NINETY_DAY_BOUNDARY_ASSUMPTION,
  ambiguousFactGates,
  classifyForCurrency,
  countedFrom,
  inWindowEntries,
  limitingDateFor,
  mixedSimulatorRowAssumption,
  typeMatchAssumption,
} from "./passenger-shared";
import { categoryKey, typeKey } from "./match";
import { MISSING_INPUT_ORDER } from "./types";
import type { AircraftFacts, CurrencyEntry, CurrencyResult, IsoDate, MissingInput } from "./types";

const TAKEOFF_THRESHOLD = 3;
const LANDING_THRESHOLD = 3;

function takeoffs(e: CurrencyEntry): number {
  return e.nightTakeoffs;
}

/** FULL STOP IS REQUIRED FOR EVERY AIRCRAFT under (b)(1) — night_landings_touch_go NEVER counts here. */
function landings(e: CurrencyEntry): number {
  return e.nightLandingsFullStop;
}

export function evaluateNightExperience(input: {
  asOf: IsoDate;
  airmanUserId: string;
  intendedAircraft: AircraftFacts | null;
  entries: readonly CurrencyEntry[];
}): CurrencyResult {
  const { asOf, airmanUserId, intendedAircraft, entries } = input;
  const window = rollingDayWindow(asOf, NINETY_DAYS);
  const inWindow = inWindowEntries(entries, window);

  const gates = new Set<MissingInput>();
  if (intendedAircraft === null) {
    gates.add("intended_aircraft_absent");
  } else {
    if (categoryKey(intendedAircraft) === null) gates.add("aircraft_category_class_unrecorded");
    if (typeKey(intendedAircraft) === null) gates.add("aircraft_type_unrecorded");
    // No aircraft_gear_unrecorded gate here — see the module header.
  }

  // classifyForCurrency/ambiguousFactGates: only evaluated once the two
  // unconditional intended-aircraft gates above are clear — see
  // general.ts's identical comment for why. No gear check here (see the
  // module header); the 1.1-vs-(b)(1) clock IS checked (checkNightWindow),
  // unlike general.ts/part135.ts's day variant.
  let matchNotes: string[] = [];
  let eligible: CurrencyEntry[] = [];
  if (intendedAircraft && gates.size === 0) {
    const classification = classifyForCurrency(inWindow, airmanUserId, intendedAircraft, takeoffs, landings, {
      checkGear: false,
      checkNightWindow: true,
    });
    eligible = classification.certain;
    const g = ambiguousFactGates(classification, takeoffs, landings, TAKEOFF_THRESHOLD, LANDING_THRESHOLD);
    for (const gg of g.gates) gates.add(gg);
    matchNotes = g.notes;
  }

  const missing = MISSING_INPUT_ORDER.filter((m) => gates.has(m));

  // A NOTE, NOT A GATE: a night flight with a daytime landing is
  // legitimate and common; treating it as missing data would make this
  // result permanently unresolvable for most pilots. See the module list
  // in docs/CURRENCY-SPEC.md §2.2.
  const notes: string[] = [...matchNotes];
  for (const e of inWindow) {
    if ((e.nightTime ?? 0) > 0 && e.nightTakeoffs === 0 && e.nightLandingsFullStop === 0) {
      notes.push(
        `Entry ${e.entryDate} logged night time with no night takeoff or full-stop night landing — a night flight ending in a daytime landing is legitimate and does not affect this result.`
      );
    }
  }

  if (missing.length > 0) {
    return {
      currencyType: "passenger_night",
      ruleBasis: "61.57(b)",
      status: "insufficient_data",
      window,
      required: { takeoffs: TAKEOFF_THRESHOLD, landings: LANDING_THRESHOLD },
      observed: {},
      counted: [],
      limitingDate: null,
      throughDate: null,
      displayDate: null,
      missing,
      notes,
      assumptions: [],
    };
  }

  const aircraft = intendedAircraft as AircraftFacts; // non-null: no gates fired
  // `eligible` was already computed above.
  const totalTakeoffs = eligible.reduce((sum, e) => sum + takeoffs(e), 0);
  const totalLandings = eligible.reduce((sum, e) => sum + landings(e), 0);
  const status =
    totalTakeoffs >= TAKEOFF_THRESHOLD && totalLandings >= LANDING_THRESHOLD
      ? "estimated_current"
      : "estimated_not_current";
  const limitingDate =
    status === "estimated_current"
      ? limitingDateFor(eligible, takeoffs, landings, TAKEOFF_THRESHOLD, LANDING_THRESHOLD)
      : null;

  const assumptions = [
    "Full-stop landings only — 61.57(b)(1) requires a full stop for every aircraft, not only tailwheel; touch-and-go night landings never count here.",
    NINETY_DAY_BOUNDARY_ASSUMPTION,
    CATEGORY_MATCH_ASSUMPTION,
  ];
  const typeAssumption = typeMatchAssumption(aircraft);
  if (typeAssumption) assumptions.push(typeAssumption);
  const mixedAssumption = mixedSimulatorRowAssumption(eligible);
  if (mixedAssumption) assumptions.push(mixedAssumption);

  return {
    currencyType: "passenger_night",
    ruleBasis: "61.57(b)",
    status,
    window,
    required: { takeoffs: TAKEOFF_THRESHOLD, landings: LANDING_THRESHOLD },
    observed: { takeoffs: totalTakeoffs, landings: totalLandings },
    counted: countedFrom(eligible, takeoffs, landings),
    limitingDate,
    throughDate: null,
    displayDate: null,
    missing: [],
    notes,
    assumptions,
  };
}

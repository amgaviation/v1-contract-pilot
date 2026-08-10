/**
 * 61.57(a) general experience -> currency_type "passenger_day".
 *
 * https://www.ecfr.gov/current/title-14/section-61.57, fetched issue date
 * 2026-08-05, retrieved 2026-08-07/2026-08-10. "no person may act as a
 * pilot in command of an aircraft carrying persons or of an aircraft
 * certificated for more than one pilot flight crewmember unless that
 * person has made at least three takeoffs and three landings within the
 * preceding 90 days" — NOT "passenger currency" (the trigger also reaches
 * an empty two-crew repositioning leg) and NOT day-only (no time-of-day
 * limit; 61.57(b) layers an ADDITIONAL night requirement on top).
 *
 * NOT A GATE HERE, DELIBERATELY, contra docs/CURRENCY-SPEC.md §6:
 * whether the aircraft is certificated for more than one pilot flight
 * crewmember. That fact decides whether (a) BINDS on an empty leg — a
 * question about scope — not whether the arithmetic is MET. Leaving it as
 * a computation gate makes (a) unresolvable forever, since nothing in
 * this schema records it as a per-flight fact. Handled in card copy
 * instead (see describe.ts).
 */
import { rollingDayWindow } from "./window";
import {
  NINETY_DAYS,
  aircraftUnregisteredGate,
  baseGates,
  countedFrom,
  eligibleEntries,
  inWindowEntries,
  limitingDateFor,
  matchGates,
  typeMatchAssumption,
} from "./passenger-shared";
import { categoryKey, typeKey } from "./match";
import { MISSING_INPUT_ORDER } from "./types";
import type { AircraftFacts, CurrencyEntry, CurrencyResult, IsoDate, MissingInput } from "./types";

const TAKEOFF_THRESHOLD = 3;
const LANDING_THRESHOLD = 3;

/** (a) is not day-only — night takeoffs count too. */
function takeoffs(e: CurrencyEntry): number {
  return e.dayTakeoffs + e.nightTakeoffs;
}

/**
 * (a)(1)(ii)'s full-stop condition binds ONLY for a tailwheel airplane —
 * everything else, a touch-and-go counts. Full stop for a takeoff has no
 * meaning; the operative half of that clause for takeoffs is "in an
 * airplane with a tailwheel," which the type/category match already
 * enforces (typeKey/categoryKey via sameCategoryClassAndType), so
 * takeoffs() above needs no tailwheel branch of its own.
 */
function landingsFor(intended: AircraftFacts): (e: CurrencyEntry) => number {
  const tailwheel = intended.gear === "tailwheel";
  return (e) =>
    tailwheel
      ? e.dayLandingsFullStop + e.nightLandingsFullStop
      : e.dayLandingsFullStop + e.dayLandingsTouchGo + e.nightLandingsFullStop + e.nightLandingsTouchGo;
}

export function evaluateGeneralExperience(input: {
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
    // Unknown gear means unknown whether touch-and-goes count at all.
    if (intendedAircraft.gear === null) gates.add("aircraft_gear_unrecorded");
  }
  for (const g of baseGates(inWindow)) gates.add(g);

  const landings = intendedAircraft ? landingsFor(intendedAircraft) : () => 0;
  if (aircraftUnregisteredGate(inWindow, takeoffs, landings)) gates.add("aircraft_unregistered");
  if (intendedAircraft) {
    for (const g of matchGates(inWindow, intendedAircraft)) gates.add(g);
  }

  const missing = MISSING_INPUT_ORDER.filter((m) => gates.has(m));

  if (missing.length > 0) {
    return {
      currencyType: "passenger_day",
      ruleBasis: "61.57(a)",
      status: "insufficient_data",
      window,
      required: { takeoffs: TAKEOFF_THRESHOLD, landings: LANDING_THRESHOLD },
      observed: {},
      counted: [],
      limitingDate: null,
      throughDate: null,
      displayDate: null,
      missing,
      notes: [],
      assumptions: [],
    };
  }

  const aircraft = intendedAircraft as AircraftFacts; // non-null: no gates fired
  const eligible = eligibleEntries(inWindow, airmanUserId, aircraft);
  const eligibleLandings = landingsFor(aircraft);
  const totalTakeoffs = eligible.reduce((sum, e) => sum + takeoffs(e), 0);
  const totalLandings = eligible.reduce((sum, e) => sum + eligibleLandings(e), 0);
  const status =
    totalTakeoffs >= TAKEOFF_THRESHOLD && totalLandings >= LANDING_THRESHOLD
      ? "estimated_current"
      : "estimated_not_current";
  const limitingDate =
    status === "estimated_current"
      ? limitingDateFor(eligible, takeoffs, eligibleLandings, TAKEOFF_THRESHOLD, LANDING_THRESHOLD)
      : null;

  const assumptions = [
    "61.57(a) has no time-of-day limit — night takeoffs and night landings count toward this total, not only day ones.",
    "Whether 61.57(a) applies to this flight at all — carrying persons, or an aircraft certificated for more than one pilot flight crewmember — is not evaluated here.",
  ];
  const typeAssumption = typeMatchAssumption(aircraft);
  if (typeAssumption) assumptions.push(typeAssumption);

  return {
    currencyType: "passenger_day",
    ruleBasis: "61.57(a)",
    status,
    window,
    required: { takeoffs: TAKEOFF_THRESHOLD, landings: LANDING_THRESHOLD },
    observed: { takeoffs: totalTakeoffs, landings: totalLandings },
    counted: countedFrom(eligible, takeoffs, eligibleLandings),
    limitingDate,
    throughDate: null,
    displayDate: null,
    missing: [],
    notes: [],
    assumptions,
  };
}

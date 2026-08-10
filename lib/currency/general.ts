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
  NINETY_DAY_BOUNDARY_ASSUMPTION,
  aircraftUnregisteredGate,
  baseGates,
  countedFrom,
  eligibleEntries,
  gearGates,
  inWindowEntries,
  limitingDateFor,
  matchGates,
  typeMatchAssumption,
} from "./passenger-shared";
import { categoryKey, gearMatches, typeKey } from "./match";
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
 * meaning, so takeoffs() above needs no tailwheel branch of its own. The
 * OTHER half of that clause — the takeoffs AND landings must have been
 * made IN AN AIRPLANE WITH A TAILWHEEL, not merely to a full stop in
 * whatever was flown — is NOT a column-selection question and is not
 * enforced here: see gearGates/gearMatches below and in
 * evaluateGeneralExperience, which gate on and filter by the LOGGED
 * entry's own gear (REGU-1 — category/type matching alone does not touch
 * gear at all, and previously let a tricycle Skyhawk's landings credit a
 * taildragger's currency).
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
    for (const g of gearGates(inWindow, intendedAircraft, takeoffs, landings)) gates.add(g);
  }

  // matchGates (P1/ambiguous-facts.ts): only evaluated once every other,
  // unconditional gate above is clear — if the card is already
  // insufficient_data for another reason, whether an entry's type is
  // ambiguous cannot change that, and running the "could this change the
  // answer" arithmetic against a card that already has no answer would
  // only produce notes nobody needs to read. `eligible` is computed here
  // (gear-filtered — REGU-1) rather than after the gate check so
  // matchGates' "certain" total is the SAME total the arithmetic below
  // uses, never a looser one that ignores the gear filter.
  let matchNotes: string[] = [];
  let eligible: CurrencyEntry[] = [];
  if (intendedAircraft && gates.size === 0) {
    const aircraft = intendedAircraft;
    const gearOk = (e: CurrencyEntry) => e.aircraft !== null && gearMatches(e.aircraft, aircraft).matches;
    eligible = eligibleEntries(inWindow, airmanUserId, aircraft).filter(gearOk);
    const certainTakeoffs = eligible.reduce((sum, e) => sum + takeoffs(e), 0);
    const certainLandings = eligible.reduce((sum, e) => sum + landings(e), 0);
    const m = matchGates(
      inWindow, airmanUserId, aircraft, takeoffs, landings, TAKEOFF_THRESHOLD, LANDING_THRESHOLD,
      certainTakeoffs, certainLandings, gearOk
    );
    for (const g of m.gates) gates.add(g);
    matchNotes = m.notes;
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
      notes: matchNotes,
      assumptions: [],
    };
  }

  const aircraft = intendedAircraft as AircraftFacts; // non-null: no gates fired
  // REGU-1: eligibleEntries alone only checks category/class/type — a
  // tailwheel intended aircraft additionally requires the LOGGED
  // aircraft's own gear to be tailwheel (see gearGates above, which would
  // already have gated a null gear here to insufficient_data). `eligible`
  // was already computed, gear-filtered, above.
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
    "61.57(a) has no time-of-day limit — night takeoffs and night landings count toward this total, not only day ones.",
    "Whether 61.57(a) applies to this flight at all — carrying persons, or an aircraft certificated for more than one pilot flight crewmember — is not evaluated here.",
    NINETY_DAY_BOUNDARY_ASSUMPTION,
  ];
  // P5: general.ts previously disclosed the (a)(1)(ii) tailwheel gear
  // predicate nowhere on the card, so a tailwheel pilot whose entries were
  // excluded by it saw a bare "0 of 3 takeoffs, 0 of 3 landings" with no
  // explanation — part135.ts already discloses its own equivalent below.
  if (aircraft.gear === "tailwheel") {
    assumptions.push(
      "61.57(a)(1)(ii): because this is a tailwheel airplane, only full-stop landings count — touch-and-goes are excluded — and both the takeoffs and landings must have been made in a tailwheel airplane, not merely to a full stop in whatever was flown."
    );
  }
  const typeAssumption = typeMatchAssumption(aircraft);
  if (typeAssumption) assumptions.push(typeAssumption);

  return {
    currencyType: "passenger_day",
    ruleBasis: "61.57(a)",
    status,
    window,
    required: { takeoffs: TAKEOFF_THRESHOLD, landings: LANDING_THRESHOLD },
    observed: { takeoffs: totalTakeoffs, landings: totalLandings },
    counted: countedFrom(eligible, takeoffs, landings),
    limitingDate,
    throughDate: null,
    displayDate: null,
    missing: [],
    notes: [],
    assumptions,
  };
}

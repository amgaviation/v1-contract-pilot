/**
 * 135.247(a) -> overwrites passenger_day / passenger_night when a pilot
 * asserts the 61.57(e)(3) exemption while operating under a Part 135
 * arrangement. index.ts's orchestrator does the substitution/relabeling;
 * this module only computes the 135.247 arithmetic itself.
 *
 * https://www.ecfr.gov/current/title-14/section-135.247, fetched issue
 * date 2026-08-05, retrieved 2026-08-07/2026-08-10. "No certificate
 * holder may use any person, nor may any person serve, as pilot in
 * command of an aircraft carrying passengers unless, within the
 * preceding 90 days," that person has (1) made three takeoffs and three
 * landings as sole manipulator in an aircraft of the same category and
 * class and, if a type rating is required, of the same type, OR (2) made
 * three takeoffs and three landings during the 1-hour-after-sunset to
 * 1-hour-before-sunrise period as sole manipulator in the same
 * category/class/type. "A person who complies with paragraph (a)(2) of
 * this section need not comply with paragraph (a)(1) of this section."
 *
 * TWO DIFFERENCES FROM 61.57 THAT MUST NOT BE CONFLATED:
 *   - (a) binds only when CARRYING PASSENGERS (61.57(a) also reaches an
 *     empty multi-crew-certificated leg).
 *   - (a)(2) night landings are NOT required to be to a full stop in this
 *     text, unlike 61.57(b)(1) — UNLESS the aircraft is a tailwheel
 *     airplane, in which case 135.247(b) below reaches back into (a)(2)
 *     and requires one anyway. Fixture P-2 pins the ordinary case; P-3
 *     pins the tailwheel one.
 *
 * *** 135.247(b) — THE TAILWHEEL RULE docs/CURRENCY-SPEC.md's brief did
 * NOT account for. ***  "(b) For the purpose of paragraph (a) of this
 * section, if the aircraft is a tailwheel airplane, each takeoff must be
 * made in a tailwheel airplane and each landing must be made to a full
 * stop in a tailwheel airplane." Scoped to "paragraph (a)" AS A WHOLE, so
 * it reaches the night variant (a)(2) as well as the day variant (a)(1).
 * Built without this, the night variant would manufacture currency for a
 * tailwheel pilot out of touch-and-goes — the highest-severity finding in
 * this phase's regulatory audit. Fixture P-3 pins it.
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
import type { TripOperatingRule } from "@/lib/operating-rule";
import type { AircraftFacts, CurrencyEntry, CurrencyResult, IsoDate, MissingInput } from "./types";

const TAKEOFF_THRESHOLD = 3;
const LANDING_THRESHOLD = 3;

function dayTakeoffs(e: CurrencyEntry): number {
  return e.dayTakeoffs + e.nightTakeoffs;
}
function nightTakeoffs(e: CurrencyEntry): number {
  return e.nightTakeoffs;
}

/**
 * 135.247(b)'s FULL-STOP half: a tailwheel airplane's landings count only
 * to a full stop, in BOTH variants — the day variant already only had
 * full-stop and touch-and-go columns to choose from; the night variant is
 * where this actually changes behaviour from what 61.57(b)(1) alone would
 * produce (which already requires full stop) versus what 135.247(a)(2)
 * alone would produce (which does not, absent (b)).
 *
 * The OTHER half of (b) — each takeoff and landing must be MADE IN a
 * tailwheel airplane, not merely counted from the right columns — is not
 * a column-selection question and is not handled here: see gearGates/
 * gearMatches below and in evaluateVariant, which gate on and filter by
 * the LOGGED entry's own gear (REGU-2 — this column selection alone
 * previously let a tricycle Skyhawk's landings credit a taildragger's
 * currency).
 */
function landingsFor(intended: AircraftFacts, variant: "day" | "night"): (e: CurrencyEntry) => number {
  const tailwheel = intended.gear === "tailwheel";
  if (variant === "day") {
    return (e) =>
      tailwheel
        ? e.dayLandingsFullStop + e.nightLandingsFullStop
        : e.dayLandingsFullStop + e.dayLandingsTouchGo + e.nightLandingsFullStop + e.nightLandingsTouchGo;
  }
  return (e) => (tailwheel ? e.nightLandingsFullStop : e.nightLandingsFullStop + e.nightLandingsTouchGo);
}

function insufficientVariant(
  currencyType: "passenger_day" | "passenger_night",
  ruleBasis: "135.247(a)(1)" | "135.247(a)(2)",
  window: CurrencyResult["window"],
  missing: readonly MissingInput[],
  notes: readonly string[] = []
): CurrencyResult {
  return {
    currencyType,
    ruleBasis,
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

function evaluateVariant(
  variant: "day" | "night",
  input: {
    asOf: IsoDate;
    airmanUserId: string;
    intendedAircraft: AircraftFacts | null;
    entries: readonly CurrencyEntry[];
  }
): CurrencyResult {
  const { asOf, airmanUserId, intendedAircraft, entries } = input;
  const currencyType = variant === "day" ? "passenger_day" : "passenger_night";
  const ruleBasis = variant === "day" ? "135.247(a)(1)" : "135.247(a)(2)";
  const window = rollingDayWindow(asOf, NINETY_DAYS);
  const inWindow = inWindowEntries(entries, window);
  const takeoffs = variant === "day" ? dayTakeoffs : nightTakeoffs;

  const gates = new Set<MissingInput>();
  if (intendedAircraft === null) {
    gates.add("intended_aircraft_absent");
  } else {
    if (categoryKey(intendedAircraft) === null) gates.add("aircraft_category_class_unrecorded");
    if (typeKey(intendedAircraft) === null) gates.add("aircraft_type_unrecorded");
    // Unlike 61.57(b), the 135.247 night variant DOES depend on gear —
    // 135.247(b) turns touch-and-go landings off entirely for a tailwheel
    // airplane. Not knowing gear means not knowing which landings count.
    if (intendedAircraft.gear === null) gates.add("aircraft_gear_unrecorded");
  }
  for (const g of baseGates(inWindow)) gates.add(g);
  const landings = intendedAircraft ? landingsFor(intendedAircraft, variant) : () => 0;
  if (aircraftUnregisteredGate(inWindow, takeoffs, landings)) gates.add("aircraft_unregistered");
  if (intendedAircraft) {
    for (const g of gearGates(inWindow, intendedAircraft, takeoffs, landings)) gates.add(g);
  }
  if (variant === "night") {
    for (const e of inWindow) {
      if ((takeoffs(e) > 0 || landings(e) > 0) && e.nightWindowAsserted !== true) {
        gates.add("night_window_unasserted");
      }
    }
  }

  // matchGates (P1/ambiguous-facts.ts): only evaluated once every other,
  // unconditional gate above is clear — see general.ts's identical
  // comment for why. `eligible` is computed here (gear-filtered — REGU-2)
  // rather than after the gate check so matchGates' "certain" total is
  // the SAME total the arithmetic below uses.
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
    return insufficientVariant(currencyType, ruleBasis, window, missing, matchNotes);
  }

  const aircraft = intendedAircraft as AircraftFacts; // non-null: no gates fired
  // REGU-2: 135.247(b) reaches back into paragraph (a) as a whole, so a
  // tailwheel intended aircraft requires the LOGGED aircraft's own gear
  // to be tailwheel too — see gearGates above, which would already have
  // gated a null gear here to insufficient_data. `eligible` was already
  // computed, gear-filtered, above.
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

  const assumptions: string[] = [NINETY_DAY_BOUNDARY_ASSUMPTION];
  if (aircraft.gear === "tailwheel") {
    assumptions.push(
      "135.247(b): because this is a tailwheel airplane, only full-stop landings count toward both the day and night variants — touch-and-goes are excluded, including for the night variant, where 61.57(b)(1) alone already requires full stop but 135.247(a)(2) alone would not."
    );
  }
  const typeAssumption = typeMatchAssumption(aircraft);
  if (typeAssumption) assumptions.push(typeAssumption);

  return {
    currencyType,
    ruleBasis,
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

export function evaluatePart135Recency(input: {
  asOf: IsoDate;
  airmanUserId: string;
  operatingRule: TripOperatingRule | "unspecified";
  exemptionAsserted: boolean;
  intendedAircraft: AircraftFacts | null;
  entries: readonly CurrencyEntry[];
}): { day: CurrencyResult; night: CurrencyResult } {
  const { asOf, operatingRule } = input;

  if (operatingRule === "unspecified") {
    // Assuming Part 91 hides the 135.247 requirements a charter leg is
    // subject to; assuming Part 135 invents requirements a Part 91
    // owner-flight is not subject to. Both errors are silent and neither
    // is safe — docs/CURRENCY-SPEC.md §5.
    const window = rollingDayWindow(asOf, NINETY_DAYS);
    const notes = ["Set the operating rule on this client or trip to evaluate 135.247 recency."];
    return {
      day: insufficientVariant("passenger_day", "135.247(a)(1)", window, ["operating_rule_unspecified"], notes),
      night: insufficientVariant("passenger_night", "135.247(a)(2)", window, ["operating_rule_unspecified"], notes),
    };
  }

  const night = evaluateVariant("night", input);
  let day = evaluateVariant("day", input);

  // Trailing sentence of (a): "A person who complies with paragraph
  // (a)(2) of this section need not comply with paragraph (a)(1) of this
  // section." Complying with the night variant satisfies the day variant
  // — applied UNCONDITIONALLY whenever night is current, regardless of
  // what day's OWN arithmetic produced: the substitution is what makes
  // day current, not a relabeling of an answer day already reached on its
  // own. REBUILT FROM night WHOLESALE, not `{...day, status: ...}` — day
  // may have returned insufficient_data (a different gate can fire for
  // day than for night: e.g. an unregistered-tail entry with only day
  // movements trips day's aircraftUnregisteredGate but is invisible to
  // night's, which counts only night movements), and overwriting just
  // `status` left its missing[]/empty observed/empty counted attached to
  // an "estimated_current" card — a permissive verdict computed from data
  // the engine itself had just declared unusable, and a CurrencyResult
  // that violates types.ts's own invariant (missing non-empty IFF
  // insufficient_data). Relabeling night's own — already well-formed —
  // result under the day currencyType/ruleBasis is what the trailing
  // sentence actually means: night's arithmetic IS what satisfies day, so
  // night's observed/counted/window are the honest basis for the day
  // card, not day's own (possibly broken) numbers. Fixture P-4.
  if (night.status === "estimated_current") {
    day = {
      ...night,
      currencyType: "passenger_day",
      ruleBasis: "135.247(a)(2)",
      notes: [
        ...night.notes,
        "Satisfied by 135.247(a)(2) night recency — complying with the night variant satisfies the day variant, per the trailing sentence of 135.247(a).",
      ],
    };
  }

  return { day, night };
}

/**
 * 61.57(c) instrument experience -> currency_type "instrument".
 *
 * https://www.ecfr.gov/current/title-14/section-61.57, fetched issue date
 * 2026-08-05, retrieved 2026-08-07/2026-08-10. Within the 6 calendar
 * months preceding the month of the flight: six instrument approaches,
 * holding procedures and tasks, and intercepting/tracking a course
 * through navigational electronic systems — all "in actual weather
 * conditions, or under simulated conditions using a view-limiting
 * device."
 *
 * DELIBERATE DEPARTURE FROM docs/CURRENCY-SPEC.md §6, flagged for Tony:
 * §6 says (c) stays insufficient_data whenever the pilot's rating
 * CATEGORY is unknown, "which, absent an airman record, is always." This
 * module gates instead on the INTENDED AIRCRAFT's category
 * (pilot.aircraft now supplies it) and discloses the assumption on the
 * card. Otherwise (c) can never resolve and the panel is dead on arrival
 * — exactly O-1's stated worry.
 */
import { calendarMonthLookback, withinInclusive } from "./window";
import { categoryKey } from "./match";
import { MISSING_INPUT_ORDER } from "./types";
import type { AircraftFacts, CountedEntry, CurrencyEntry, CurrencyResult, IsoDate, MissingInput } from "./types";

const SIX_CALENDAR_MONTHS = 6;
const APPROACH_THRESHOLD = 6;

/**
 * category-of-aircraft match for 61.57(c)(1) — "in an airplane,
 * powered-lift, helicopter, or airship, as appropriate, for the
 * instrument rating privileges to be maintained." The regulation
 * conditions this on CATEGORY alone, never class or type — but
 * pilot.aircraft.category_class is ONE free-text column a pilot fills in
 * as a single value ('ASEL', 'AMEL', 'HELICOPTER', ...), with no fixed
 * vocabulary to parse a bare category out of (see that column's own
 * comment: a CHECK that is wrong for a pilot's aircraft is worse than a
 * field they fill in themselves). This compares the WHOLE field, exactly
 * as match.ts's sameCategoryClassAndType does for the other rules — which
 * means it ALSO requires the class to match (ASEL vs AMEL), not category
 * alone. That is stricter than the text: an instrument-current AMEL
 * pilot's approaches will not count toward an ASEL card even though both
 * are the "airplane" category the reg actually conditions on. Deliberate
 * and disclosed in `assumptions` below — it can only understate an
 * actually-current pilot's approaches, never manufacture currency they do
 * not have. A null category_class on either side is a MISSING INPUT,
 * never a non-match, same discipline as everywhere else in this engine.
 * Only ever called for a REAL AIRCRAFT row — see the device branch of
 * qualifiesOnConditionDeviceAndCategory below.
 */
function categoryMatches(e: CurrencyEntry, intendedAircraft: AircraftFacts): boolean {
  if (e.aircraft === null) return false;
  const entryCategory = categoryKey(e.aircraft);
  const intendedCategory = categoryKey(intendedAircraft);
  return entryCategory !== null && intendedCategory !== null && entryCategory === intendedCategory;
}

/**
 * The condition/device/category test shared by approaches, holds, AND
 * course intercept/tracking — 61.57(c)(1)'s own text: "...performed and
 * logged at least the following tasks and iterations in an airplane,
 * powered-lift, helicopter, or airship, as appropriate, for the
 * instrument rating privileges to be maintained in actual weather
 * conditions, or under simulated conditions using a view-limiting
 * device..." governs ALL THREE of (c)(1)(i)-(iii), not only the
 * approaches in (i) — verified against the live section text. A hold or
 * an intercept flown in VMC on a row the pilot affirmatively logged as
 * 'neither' actual nor simulated does not satisfy (c)(1)(ii)/(iii) any
 * more than a visual approach satisfies (i).
 *
 * 61.57(c)(2) accepts ALL THREE device classes (FFS, FTD, ATD) and
 * imposes NO part 142 condition — unlike (a)(3) and (b)(2). Do not copy
 * general.ts/night.ts's simulator gate here: an ATD session is real (c)
 * credit. A DEVICE ROW NEVER CALLS categoryMatches(): (c)(2) requires the
 * DEVICE, not a tail-numbered aircraft, to represent the category, and
 * this schema has no field recording what category a device represents.
 * Routing a device row through the aircraft registry is exactly the
 * REGU-4/CORR-1 regression — a simulator session has no tail number by
 * design (20260810020000_logbook_simulator_role_optional.sql), so
 * categoryMatches() always failed it, and the aircraft_unregistered gate
 * below then poisoned the whole card. A qualifying device row (valid
 * device class, condition 'simulated') is credited unconditionally
 * instead. 'other' is the one device value that satisfies nothing, so a
 * simulated-condition row on an 'other' device does not qualify.
 */
function qualifiesOnConditionDeviceAndCategory(e: CurrencyEntry, intendedAircraft: AircraftFacts): boolean {
  if (e.approachCondition !== "actual" && e.approachCondition !== "simulated") return false;
  if ((e.simulatorTime ?? 0) > 0) {
    if (e.simulatorDeviceType === null || e.simulatorDeviceType === "other") return false;
    if (e.approachCondition !== "simulated") return false;
    return true;
  }
  return categoryMatches(e, intendedAircraft);
}

/**
 * approach_type !== 'visual' is a SECOND LATCH, not the mechanism —
 * supabase/migrations/20260807140000_approach_conditions.sql's own CHECK
 * already forbids pairing approach_type = 'visual' with approach_condition
 * 'actual'/'simulated', so the condition filter above already excludes
 * every visual row on its own. Kept as a second, independent test so a
 * future relaxation of that CHECK cannot silently start counting visual
 * approaches here without this module also changing.
 *
 * approachType === null (untyped) is never counted — an untyped approach
 * cannot be shown to qualify.
 */
function isQualifyingApproachRow(e: CurrencyEntry, intendedAircraft: AircraftFacts): boolean {
  if (e.approachesCount <= 0) return false;
  if (e.approachType === null || e.approachType === "visual") return false;
  return qualifiesOnConditionDeviceAndCategory(e, intendedAircraft);
}

export function evaluateInstrumentExperience(input: {
  asOf: IsoDate;
  airmanUserId: string;
  intendedAircraft: AircraftFacts | null;
  entries: readonly CurrencyEntry[];
}): CurrencyResult {
  const { asOf, airmanUserId, intendedAircraft, entries } = input;
  const window = calendarMonthLookback(asOf, SIX_CALENDAR_MONTHS);
  const inWindow = entries.filter((e) => withinInclusive(e.entryDate, window));

  const gates = new Set<MissingInput>();
  if (intendedAircraft === null) {
    gates.add("intended_aircraft_absent");
  } else if (categoryKey(intendedAircraft) === null) {
    gates.add("aircraft_category_class_unrecorded");
  }
  for (const e of inWindow) {
    if (e.airmanUserId === null) gates.add("airman_unattributed");
    const hasInstrumentActivity = e.approachesCount > 0 || e.holds > 0 || e.coursesInterceptedTracked === true;
    // (c)(1)'s condition clause governs approaches, holds, AND course
    // intercept/tracking alike (see qualifiesOnConditionDeviceAndCategory)
    // — a hold or intercept on a row with no recorded condition is
    // exactly as unusable as an approach on one.
    if (hasInstrumentActivity && e.approachCondition === null) gates.add("approach_condition_unrecorded");
    if ((e.simulatorTime ?? 0) > 0 && e.simulatorDeviceType === "other") gates.add("unresolvable_simulator_row");
    // (c)(1)/(c)(2) condition on the CATEGORY of aircraft for the
    // instrument rating being maintained — a hold or intercept flown in
    // an aircraft outside the pilot's registry, or one whose category is
    // unrecorded, is a missing input, never a silent non-match. EXCEPT a
    // device row (simulatorTime > 0): a device has no tail number by
    // design, so it is never checked against the aircraft registry at all
    // — routing it through this gate is REGU-4/CORR-1's regression, where
    // a simulator entry poisoned the whole card with a remedy ("register
    // the aircraft") no pilot can act on for a session with no aircraft.
    if (hasInstrumentActivity && intendedAircraft && (e.simulatorTime ?? 0) <= 0) {
      if (e.aircraft === null) gates.add("aircraft_unregistered");
      else if (categoryKey(e.aircraft) === null) gates.add("aircraft_category_class_unrecorded");
    }
  }

  const missing = MISSING_INPUT_ORDER.filter((m) => gates.has(m));
  const assumptions = intendedAircraft
    ? [
        "Assumes you hold the instrument rating for the intended aircraft's category — this engine has no airman/ratings record and gates on the aircraft instead.",
        "Matched on the intended aircraft's full category/class field (e.g. \"ASEL\" vs \"AMEL\"), not category alone — this schema has no separate category field, so an approach flown in a different class of the same category will not count here even though 61.57(c) itself conditions only on category.",
      ]
    : [];

  if (missing.length > 0) {
    return {
      currencyType: "instrument",
      ruleBasis: "61.57(c)",
      status: "insufficient_data",
      window,
      required: { approaches: APPROACH_THRESHOLD },
      observed: {},
      counted: [],
      limitingDate: null,
      throughDate: null,
      displayDate: null,
      missing,
      notes: [],
      assumptions,
    };
  }

  const aircraft = intendedAircraft as AircraftFacts; // non-null: no gates fired
  const myEntries = inWindow.filter((e) => e.airmanUserId === airmanUserId);
  const qualifyingRows = myEntries.filter((e) => isQualifyingApproachRow(e, aircraft));
  const approaches = qualifyingRows.reduce((sum, e) => sum + e.approachesCount, 0);
  const holding = myEntries.some((e) => e.holds > 0 && qualifiesOnConditionDeviceAndCategory(e, aircraft));
  const intercept = myEntries.some((e) => e.coursesInterceptedTracked === true && qualifiesOnConditionDeviceAndCategory(e, aircraft));
  const status = approaches >= APPROACH_THRESHOLD && holding && intercept ? "estimated_current" : "estimated_not_current";

  const counted: CountedEntry[] = qualifyingRows.map((e) => ({
    entryId: e.id,
    entryDate: e.entryDate,
    takeoffs: 0,
    landings: 0,
    approaches: e.approachesCount,
  }));

  const notes: string[] = [];
  // §11 defect #3: approaches_count/approach_type are one-to-one per
  // entry, so an entry recording three approaches of two different types
  // cannot say which were which. Counting them (rather than refusing the
  // whole entry) is the chosen mitigation — disclosed here rather than
  // hidden, per docs/CURRENCY-SPEC.md's regulatory-findings correction to
  // this defect.
  for (const e of qualifyingRows) {
    if (e.approachesCount > 1) {
      notes.push(
        `${e.approachesCount} approaches counted from one entry on ${e.entryDate} tagged "${e.approachType}" — this schema records one approach type per entry, so if any of those were actually a different type, that can't be told apart here.`
      );
    }
  }
  if (status === "estimated_not_current") {
    notes.push(
      "If this lapse exceeds six calendar months, 61.57(d) may require an instrument proficiency check rather than simply repeating these tasks. This engine does not compute which path applies or when a lapse started."
    );
  }

  let limitingDate: IsoDate | null = null;
  if (status === "estimated_current") {
    const newestFirst = [...qualifyingRows].sort((a, b) => (a.entryDate < b.entryDate ? 1 : a.entryDate > b.entryDate ? -1 : 0));
    let running = 0;
    for (const e of newestFirst) {
      running += e.approachesCount;
      if (running >= APPROACH_THRESHOLD) {
        limitingDate = e.entryDate;
        break;
      }
    }
  }

  return {
    currencyType: "instrument",
    ruleBasis: "61.57(c)",
    status,
    window,
    required: { approaches: APPROACH_THRESHOLD, holds: 1, intercepts: 1 },
    observed: { approaches, holds: holding ? 1 : 0, intercepts: intercept ? 1 : 0 },
    counted,
    limitingDate,
    throughDate: null,
    displayDate: null,
    missing: [],
    notes,
    assumptions,
  };
}

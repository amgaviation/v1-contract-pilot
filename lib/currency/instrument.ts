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
import { missingFactCouldChangeAnswer } from "./ambiguous-facts";
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
 * Only ever called for a REAL AIRCRAFT row — see isDeviceRow below.
 */
function categoryMatches(e: CurrencyEntry, intendedAircraft: AircraftFacts): boolean {
  if (e.aircraft === null) return false;
  const entryCategory = categoryKey(e.aircraft);
  const intendedCategory = categoryKey(intendedAircraft);
  return entryCategory !== null && intendedCategory !== null && entryCategory === intendedCategory;
}

/**
 * A 61.57(c)(2) DEVICE row: condition 'simulated', simulatorTime > 0, and
 * a device class this rule accepts (FFS, FTD, or ATD — 'other' satisfies
 * no row of the device matrix and is caught unconditionally by the
 * unresolvable_simulator_row gate below, since NO device class at all is
 * knowable there).
 *
 * A row that logs simulatorTime but was flown in ACTUAL conditions is NOT
 * a device row — actual weather conditions cannot happen in a device, so
 * its approaches were flown for real and go through categoryMatches like
 * any other real-aircraft row. P9: this used to be routed into the device
 * branch by simulatorTime alone, regardless of condition, which silently
 * zeroed out a mixed entry's real-aircraft approaches (logged in ACTUAL
 * conditions, in the registered aircraft) with no count, no gate, and no
 * note — the device branch's own `approachCondition !== "simulated"` test
 * failed it, and the aircraft-registry gate below was, at the time,
 * exempting every simulatorTime > 0 row from ever being checked at all.
 */
function isDeviceRow(e: CurrencyEntry): boolean {
  return (
    e.approachCondition === "simulated" &&
    (e.simulatorTime ?? 0) > 0 &&
    e.simulatorDeviceType !== null &&
    e.simulatorDeviceType !== "other"
  );
}

/**
 * The condition/category test for a REAL AIRCRAFT row, shared by
 * approaches, holds, AND course intercept/tracking — 61.57(c)(1)'s own
 * text: "...performed and logged at least the following tasks and
 * iterations in an airplane, powered-lift, helicopter, or airship, as
 * appropriate, for the instrument rating privileges to be maintained in
 * actual weather conditions, or under simulated conditions using a
 * view-limiting device..." governs ALL THREE of (c)(1)(i)-(iii), not only
 * the approaches in (i) — verified against the live section text. A hold
 * or an intercept flown in VMC on a row the pilot affirmatively logged as
 * 'neither' actual nor simulated does not satisfy (c)(1)(ii)/(iii) any
 * more than a visual approach satisfies (i).
 *
 * Device rows never reach this function — see evaluateInstrumentExperience,
 * where they are tracked separately as AMBIGUOUS, never as certain. A
 * device row has no tail number by design
 * (20260810020000_logbook_simulator_role_optional.sql), and 61.57(c)(2)'s
 * own predicate — "provided the device represents the category of
 * aircraft for the instrument rating privileges to be maintained" — is a
 * fact about the DEVICE, not a tail-numbered aircraft, that this schema
 * has no field recording. Routing a device row through categoryMatches
 * anyway (checking whatever e.aircraft happens to hold) would be the
 * REGU-4/CORR-1 regression in a new guise; crediting it unconditionally
 * with no predicate at all was the P2 regression this file now avoids —
 * see the device-handling block below for how it is actually gated.
 */
function realAircraftQualifies(e: CurrencyEntry, intendedAircraft: AircraftFacts): boolean {
  if (e.approachCondition !== "actual" && e.approachCondition !== "simulated") return false;
  if (isDeviceRow(e)) return false;
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
 * cannot be shown to qualify. Applies to a device row's approach count
 * exactly as it does to a real-aircraft row's — see how the caller uses
 * this for both.
 */
function hasQualifyingApproachShape(e: CurrencyEntry): boolean {
  return e.approachesCount > 0 && e.approachType !== null && e.approachType !== "visual";
}

function isQualifyingApproachRow(e: CurrencyEntry, intendedAircraft: AircraftFacts): boolean {
  return hasQualifyingApproachShape(e) && realAircraftQualifies(e, intendedAircraft);
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
    // intercept/tracking alike (see realAircraftQualifies) — a hold or
    // intercept on a row with no recorded condition is exactly as
    // unusable as an approach on one.
    if (hasInstrumentActivity && e.approachCondition === null) gates.add("approach_condition_unrecorded");
    if ((e.simulatorTime ?? 0) > 0 && e.simulatorDeviceType === "other") gates.add("unresolvable_simulator_row");
    // (c)(1) conditions on the CATEGORY of aircraft for the instrument
    // rating being maintained — a hold or intercept flown in an aircraft
    // outside the pilot's registry, or one whose category is unrecorded,
    // is a missing input, never a silent non-match. EXCEPT a device row
    // (see isDeviceRow): a device has no tail number by design, so it is
    // never checked against the aircraft registry at all — routing it
    // through this gate is REGU-4/CORR-1's regression, where a simulator
    // entry poisoned the whole card with a remedy ("register the
    // aircraft") no pilot can act on for a session with no aircraft. P9:
    // this used to exempt every simulatorTime > 0 row, not just device
    // rows, which is what let a MIXED row's real-aircraft approaches
    // (actual condition, real aircraft, alongside some unrelated
    // simulator time on the same entry) silently skip this gate too.
    if (hasInstrumentActivity && intendedAircraft && !isDeviceRow(e)) {
      if (e.aircraft === null) gates.add("aircraft_unregistered");
      else if (categoryKey(e.aircraft) === null) gates.add("aircraft_category_class_unrecorded");
    }
  }

  const missing = MISSING_INPUT_ORDER.filter((m) => gates.has(m));
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
      assumptions: [],
    };
  }

  const aircraft = intendedAircraft as AircraftFacts; // non-null: no gates fired
  const myEntries = inWindow.filter((e) => e.airmanUserId === airmanUserId);

  // CERTAIN: real-aircraft rows whose category is confirmed to match the
  // intended aircraft.
  const certainRows = myEntries.filter((e) => isQualifyingApproachRow(e, aircraft));
  const certainApproaches = certainRows.reduce((sum, e) => sum + e.approachesCount, 0);
  const certainHolds = myEntries.some((e) => e.holds > 0 && realAircraftQualifies(e, aircraft));
  const certainIntercepts = myEntries.some((e) => e.coursesInterceptedTracked === true && realAircraftQualifies(e, aircraft));
  const certainlyMeets = certainApproaches >= APPROACH_THRESHOLD && certainHolds && certainIntercepts;

  // AMBIGUOUS: device rows (61.57(c)(2)) — see isDeviceRow's header. The
  // regulation requires the device to "represent the category of aircraft
  // for the instrument rating privileges to be maintained," and this
  // schema has no field recording what a device represents, so a device
  // row can NEVER be certain — only its BEST CASE (assume it represents
  // the right category) can be computed, and lib/currency/ambiguous-facts.ts's
  // rule decides whether that best case is worth asking the pilot about.
  const deviceApproachRows = myEntries.filter((e) => isDeviceRow(e) && hasQualifyingApproachShape(e));
  const deviceHoldRows = myEntries.filter((e) => isDeviceRow(e) && e.holds > 0);
  const deviceInterceptRows = myEntries.filter((e) => isDeviceRow(e) && e.coursesInterceptedTracked === true);
  const deviceApproaches = deviceApproachRows.reduce((sum, e) => sum + e.approachesCount, 0);

  const bestApproaches = certainApproaches + deviceApproaches;
  const bestHolds = certainHolds || deviceHoldRows.length > 0;
  const bestIntercepts = certainIntercepts || deviceInterceptRows.length > 0;
  const bestCaseMeets = bestApproaches >= APPROACH_THRESHOLD && bestHolds && bestIntercepts;

  const contributingDeviceRows = new Map<string, CurrencyEntry>();
  for (const e of [...deviceApproachRows, ...deviceHoldRows, ...deviceInterceptRows]) contributingDeviceRows.set(e.id, e);

  if (contributingDeviceRows.size > 0 && missingFactCouldChangeAnswer(certainlyMeets, bestCaseMeets)) {
    const notes = [...contributingDeviceRows.values()].map(
      (e) =>
        `Entry ${e.entryDate}: this device session's approaches/holds/course intercept could be the difference between current and not, and this schema has no field recording whether the device represents the category of aircraft for the instrument rating being maintained (61.57(c)(2)) — resolve it manually.`
    );
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
      missing: ["device_category_unconfirmed"],
      notes,
      assumptions: [],
    };
  }

  // Either there is no ambiguity, or resolving it could not change the
  // answer either way (already met on certain alone, or still short on
  // best case) — the card answers from CERTAIN alone. An unresolved
  // device row is never credited, only ever asked about.
  const qualifyingRows = certainRows;
  const approaches = certainApproaches;
  const holding = certainHolds;
  const intercept = certainIntercepts;
  const status = certainlyMeets ? "estimated_current" : "estimated_not_current";

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

  const assumptions = [
    "Assumes you hold the instrument rating for the intended aircraft's category — this engine has no airman/ratings record and gates on the aircraft instead.",
    "Matched on the intended aircraft's full category/class field (e.g. \"ASEL\" vs \"AMEL\"), not category alone — this schema has no separate category field, so an approach flown in a different class of the same category will not count here even though 61.57(c) itself conditions only on category.",
  ];

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

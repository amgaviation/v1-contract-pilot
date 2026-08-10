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
 * approach_type !== 'visual' is a SECOND LATCH, not the mechanism —
 * supabase/migrations/20260807140000_approach_conditions.sql's own CHECK
 * already forbids pairing approach_type = 'visual' with approach_condition
 * 'actual'/'simulated', so the condition filter classifyEntry applies
 * already excludes every visual row on its own. Kept as a second,
 * independent test so a future relaxation of that CHECK cannot silently
 * start counting visual approaches here without this module also
 * changing.
 *
 * approachType === null (untyped) is never counted — an untyped approach
 * cannot be shown to qualify. Applies to a device row's approach count
 * exactly as it does to a real-aircraft row's.
 */
function hasQualifyingApproachShape(e: CurrencyEntry): boolean {
  return e.approachesCount > 0 && e.approachType !== null && e.approachType !== "visual";
}

type Classification = { kind: "excluded" } | { kind: "certain" } | { kind: "ambiguous"; missing: MissingInput[] };

/**
 * ONE PASS per entry, replacing what used to be an unconditional per-entry
 * gate loop (airman/approach-condition/registry, all firing regardless of
 * whether the entry could ever have contributed) FOLLOWED by a separate
 * certain/device split scoped only for the device-row case (P2/P9). Every
 * review round on this engine reproduced the same "one irrelevant entry
 * empties the whole card" bug in whichever gate the previous round had not
 * yet scoped — Q1's critical finding was the aircraft-registry gate
 * catching a device session logged 'neither', which this module's own
 * pre-repair guard (`simulatorTime <= 0`) used to exempt correctly. This
 * function is the fix for the CLASS: every fact this module can be unsure
 * about is classified through the SAME test as passenger-shared.ts's
 * classifyForCurrency.
 *
 * THREE OUTCOMES PER ENTRY:
 *
 *   1. EXCLUDED (silently dropped) — no approaches/holds/course-intercept
 *      activity at all (cannot contribute regardless of any other fact);
 *      a KNOWN different airman; a KNOWN, DEFINITE non-qualifying
 *      condition — 'neither' on either a real-aircraft row (fails (c)(1)'s
 *      condition clause) or a device/simulator row (fails (c)(2)'s
 *      "simulated instrument conditions" requirement, Q1); or a KNOWN
 *      different aircraft category. None of these is a missing fact —
 *      resolving it further cannot change a "no" that is already known —
 *      so none of them is ever named in a gate, exactly as a visual
 *      approach already is not.
 *
 *   2. CERTAIN — every fact this function checks is KNOWN and passing.
 *
 *   3. AMBIGUOUS — at least one fact is genuinely unknown: airman
 *      attribution, actual-vs-simulated condition, the aircraft registry/
 *      category (real-aircraft rows only), or — for a device/simulator
 *      row — whichever of its own facts (device class, condition, and
 *      always 61.57(c)(2)'s unrecordable "represents the category of
 *      aircraft" predicate) this schema cannot confirm. Its
 *      approaches/holds/intercept count only toward the BEST-CASE totals.
 *
 * A DEVICE/SIMULATOR ROW (`simulatorTime > 0` on a row whose condition is
 * not 'actual' — actual weather cannot happen in a device, so a row
 * logged 'actual' is a REAL-aircraft row even if it also carries unrelated
 * simulatorTime, P9's mixed-entry fixture) is NEVER checked against the
 * aircraft registry or category below — see the block's own comment for
 * why routing it there is the Q1/REGU-4/CORR-1 failure shape. It is
 * NEVER certain either: this schema has no field recording 61.57(c)(2)'s
 * own "the device represents the category of aircraft for the instrument
 * rating privileges to be maintained" predicate, so a device row's best
 * possible outcome is "ambiguous, ask the pilot," never "counted."
 */
function classifyInstrumentEntry(
  e: CurrencyEntry,
  airmanUserId: string,
  intendedAircraft: AircraftFacts
): Classification {
  const hasActivity = e.approachesCount > 0 || e.holds > 0 || e.coursesInterceptedTracked === true;
  if (!hasActivity) return { kind: "excluded" };
  if (e.airmanUserId !== null && e.airmanUserId !== airmanUserId) return { kind: "excluded" };

  const missing: MissingInput[] = [];
  if (e.airmanUserId === null) missing.push("airman_unattributed");

  const isDeviceSession = (e.simulatorTime ?? 0) > 0 && e.approachCondition !== "actual";
  if (isDeviceSession) {
    if (e.approachCondition !== null && e.approachCondition !== "simulated") {
      // 'neither' — decisively fails (c)(2)'s "simulated instrument
      // conditions" condition. Silent exclusion, never a gate (Q1).
      return { kind: "excluded" };
    }
    if (e.simulatorDeviceType === "other") {
      missing.push("unresolvable_simulator_row");
    } else if (e.approachCondition === null) {
      missing.push("approach_condition_unrecorded");
    } else {
      // condition === 'simulated', a real device class — (c)(2)'s own
      // "represents the category of aircraft" predicate is the one thing
      // left, and this schema has no field for it. Never checked against
      // the aircraft registry (isDeviceRow's old header, generalized): a
      // device session has no tail number by design.
      missing.push("device_category_unconfirmed");
    }
    return { kind: "ambiguous", missing };
  }

  // Real-aircraft row (including a MIXED row whose condition is 'actual'
  // even though it also logs unrelated simulatorTime — P9).
  if (e.approachCondition !== null && e.approachCondition !== "actual" && e.approachCondition !== "simulated") {
    return { kind: "excluded" }; // 'neither' decisively fails (c)(1)
  }
  if (e.approachCondition === null) {
    missing.push("approach_condition_unrecorded");
  }

  if (e.aircraft === null) {
    missing.push("aircraft_unregistered");
  } else {
    const entryCat = categoryKey(e.aircraft);
    const intendedCat = categoryKey(intendedAircraft);
    if (entryCat === null) {
      missing.push("aircraft_category_class_unrecorded");
    } else if (intendedCat !== null && entryCat !== intendedCat) {
      return { kind: "excluded" }; // known different category — CORR-2/REG-3
    }
  }

  return missing.length > 0 ? { kind: "ambiguous", missing } : { kind: "certain" };
}

const AMBIGUOUS_FACT_PHRASE: Partial<Record<MissingInput, string>> = {
  airman_unattributed: "its airman is not recorded",
  approach_condition_unrecorded: "whether it was flown in actual or simulated instrument conditions is not recorded",
  unresolvable_simulator_row: "it is a simulator/device session whose device class this schema cannot confirm",
  aircraft_unregistered: "its aircraft is not in your registry",
  aircraft_category_class_unrecorded: "its aircraft's category/class is not recorded",
  device_category_unconfirmed:
    "this schema has no field recording whether the device represents the category of aircraft for the instrument rating being maintained (61.57(c)(2))",
};

function describeAmbiguousEntry(a: { entry: CurrencyEntry; missing: MissingInput[] }): string {
  const facts = a.missing.map((m) => AMBIGUOUS_FACT_PHRASE[m] ?? m).join("; ");
  return `Entry ${a.entry.entryDate}: ${facts} — and its approaches/holds/course intercept could be the difference between current and not current, so this card asks rather than guesses.`;
}

function approachesFrom(rows: readonly CurrencyEntry[]): number {
  return rows.filter(hasQualifyingApproachShape).reduce((sum, e) => sum + e.approachesCount, 0);
}
function anyHolds(rows: readonly CurrencyEntry[]): boolean {
  return rows.some((e) => e.holds > 0);
}
function anyIntercepts(rows: readonly CurrencyEntry[]): boolean {
  return rows.some((e) => e.coursesInterceptedTracked === true);
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

  // Unconditional, INTENDED-aircraft-level gates: nothing below can even
  // be computed without a resolved intended aircraft (there is no
  // per-entry "could this change the answer" question to ask when the
  // thing every entry is compared against is itself unknown).
  const gates = new Set<MissingInput>();
  if (intendedAircraft === null) {
    gates.add("intended_aircraft_absent");
  } else if (categoryKey(intendedAircraft) === null) {
    gates.add("aircraft_category_class_unrecorded");
  }
  if (gates.size > 0) {
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
      missing: MISSING_INPUT_ORDER.filter((m) => gates.has(m)),
      notes: [],
      assumptions: [],
    };
  }
  const aircraft = intendedAircraft as AircraftFacts;

  const certain: CurrencyEntry[] = [];
  const ambiguous: { entry: CurrencyEntry; missing: MissingInput[] }[] = [];
  for (const e of inWindow) {
    const c = classifyInstrumentEntry(e, airmanUserId, aircraft);
    if (c.kind === "excluded") continue;
    if (c.kind === "certain") certain.push(e);
    else ambiguous.push({ entry: e, missing: c.missing });
  }

  const certainApproaches = approachesFrom(certain);
  const certainHolds = anyHolds(certain);
  const certainIntercepts = anyIntercepts(certain);
  const certainlyMeets = certainApproaches >= APPROACH_THRESHOLD && certainHolds && certainIntercepts;

  const ambiguousEntries = ambiguous.map((a) => a.entry);
  const bestApproaches = certainApproaches + approachesFrom(ambiguousEntries);
  const bestHolds = certainHolds || anyHolds(ambiguousEntries);
  const bestIntercepts = certainIntercepts || anyIntercepts(ambiguousEntries);
  const bestCaseMeets = bestApproaches >= APPROACH_THRESHOLD && bestHolds && bestIntercepts;

  if (ambiguous.length > 0 && missingFactCouldChangeAnswer(certainlyMeets, bestCaseMeets)) {
    const ambiguousGates = new Set<MissingInput>();
    const notes: string[] = [];
    for (const a of ambiguous) {
      for (const m of a.missing) ambiguousGates.add(m);
      notes.push(describeAmbiguousEntry(a));
    }
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
      missing: MISSING_INPUT_ORDER.filter((m) => ambiguousGates.has(m)),
      notes,
      assumptions: [],
    };
  }

  // Either there is no ambiguity, or resolving it could not change the
  // answer either way (already met on certain alone, or still short on
  // best case) — the card answers from CERTAIN alone. An unresolved
  // ambiguous entry is never credited, only ever asked about.
  const qualifyingRows = certain.filter(hasQualifyingApproachShape);
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

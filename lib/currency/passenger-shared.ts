/**
 * Shared machinery for the three 90-day rolling-window rules — 61.57(a)
 * (general.ts), 61.57(b) (night.ts), and 135.247(a) (part135.ts). All
 * three ask the same shape of question ("N takeoffs and N landings, sole
 * manipulator, same category/class/type, inside a 90-day window") and
 * differ only in which columns count as a takeoff or landing and in a
 * couple of extra gates. Factored here so the three modules cannot drift
 * on the shared half against each other.
 *
 * Not itself one of the named modules in the currency-engine plan — an
 * internal helper, not a public entry point. Every export here is pure.
 */
import { withinInclusive } from "./window";
import { gearMatches, sameCategoryClassAndType } from "./match";
import { missingFactCouldChangeAnswer } from "./ambiguous-facts";
import { isWhollySimulatorEntry } from "./simulator";
import type { AircraftFacts, CountedEntry, CurrencyEntry, DateWindow, IsoDate, MissingInput } from "./types";

/**
 * When the intended aircraft carries no recorded type rating, match.ts's
 * sameCategoryClassAndType does NOT read that as "no rating required" —
 * a blank rating is not evidence a rating isn't needed (REGU-3). An entry
 * of the SAME type as intended still counts; a DIFFERENT (or unrecorded)
 * type is excluded from this total UNLESS resolving it could change
 * whether you are current — see classifyForCurrency/ambiguousFactGates
 * below, which only ask you to resolve a specific entry's type when it
 * could actually be the difference, not merely because it exists in the
 * window (P1/P3: an earlier version of this sentence claimed a silent
 * exclusion in every case, which was only ever true when the described
 * case had not occurred — supplying the fact matters, or it doesn't, and
 * only the first case reaches a card at all). Disclosed here as a shared
 * assumption string so general.ts, night.ts and part135.ts render
 * identical wording rather than three hand-copied sentences drifting
 * apart.
 */
export function typeMatchAssumption(intended: AircraftFacts): string | null {
  const required = intended.typeRating !== null && intended.typeRating.trim() !== "";
  if (required) return null;
  return "No type rating is recorded for the intended aircraft, so a different (or unrecorded) type of aircraft is not read as \"no rating required\" — an entry of the SAME type as the intended aircraft still counts; a different type is excluded from this total unless it could be the difference between current and not, in which case this card asks you to resolve it rather than guessing.";
}

/**
 * Q6: category_class is free text with no fixed vocabulary (that column's
 * own migration comment: a CHECK that is wrong for a pilot's aircraft is
 * worse than a field they fill in themselves) — match.ts's categoryKey
 * only trims and case-folds, so an entry logged as "Airplane Single-Engine
 * Land" is a KNOWN, DIFFERENT category from an intended aircraft recorded
 * as "ASEL," and is silently excluded rather than credited. Rendered on
 * every 90-day card that reaches an ANSWER — estimated_current or
 * estimated_not_current — unconditionally at that point (unlike
 * typeMatchAssumption above, which only applies there when the intended
 * type rating is blank), because this exact-string comparison runs
 * regardless of whether a type rating is recorded, and previously had no
 * equivalent to instrument.ts's own CORR-2 disclosure of the identical
 * compare. NOT rendered on the insufficient_data path: general.ts,
 * night.ts and part135.ts all return `assumptions: []` there, since no
 * comparison has produced a number for this sentence to caveat yet.
 */
export const CATEGORY_MATCH_ASSUMPTION =
  "An entry's aircraft category/class is compared to the intended aircraft's as one exact, pilot-typed field (e.g. \"ASEL\") — a different wording of the same category, such as \"Airplane Single-Engine Land,\" reads as a different aircraft, and its takeoffs/landings are excluded, not corrected for you.";

export const NINETY_DAYS = 90;

export function inWindowEntries(entries: readonly CurrencyEntry[], window: DateWindow): CurrencyEntry[] {
  return entries.filter((e) => withinInclusive(e.entryDate, window));
}

/**
 * role = DUAL_RECEIVED is 61.51(h) training received, not acting as PIC,
 * and never counts toward 61.57(a)/(b)/135.247(a). Written as an
 * ALLOWLIST — `role === "PIC" || role === "SIC" || role === "SOLO"` —
 * rather than `role !== "DUAL_RECEIVED"`: role has been nullable since
 * supabase/migrations/20260810020000_logbook_simulator_role_optional.sql
 * (a wholly-simulator entry has no crew role), and SQL's `<>` and
 * TypeScript's `!==` disagree on how a null behaves against it — `role <>
 * 'DUAL_RECEIVED'` is NULL (dropped) in Postgres for a null role, but
 * `role !== "DUAL_RECEIVED"` is `true` (kept) in the natural JS
 * transliteration. An allowlist excludes a null role by construction and
 * needs no such cross-language cross-check.
 *
 * SOLO counts: 61.51(e)(4) provides that a student pilot may log solo
 * flight time as PIC time, and 61.51(d) defines SOLO as sole occupant of
 * the aircraft, which entails sole manipulator — so a SOLO entry satisfies
 * the sole-manipulator limb of 61.57(a)(1)(i)/(b)(1)(i) by construction.
 * A PIC row carrying dual_received_time > 0 on the SAME row still counts —
 * this filter keys on `role`, never on whether dual_received_time is
 * non-null (recurrent training: sole-manipulator PIC per 61.51(e)(1)(i)
 * while receiving instruction per 61.51(h) on the same flight is real and
 * legal — see supabase/migrations/20260809000000_logbook_role_vocabulary.sql).
 */
export function actingRoleAllowed(role: CurrencyEntry["role"]): boolean {
  return role === "PIC" || role === "SIC" || role === "SOLO";
}

/** One entry, classified against the intended aircraft — see classifyForCurrency's header. */
export type AmbiguousEntry = { entry: CurrencyEntry; missing: MissingInput[] };
export type EntryClassification = { certain: CurrencyEntry[]; ambiguous: AmbiguousEntry[] };

/**
 * ONE PASS over the window, replacing what used to be four separate,
 * sequential, UNCONDITIONAL gates (airman/role/sole-manipulator/simulator
 * in baseGates, aircraft registration in aircraftUnregisteredGate, gear in
 * gearGates) followed by a fifth gate (type/category in matchGates) that
 * was the ONLY one of the five scoped by lib/currency/ambiguous-facts.ts's
 * rule. Every review round on this engine reproduced the same bug in
 * whichever gate the previous round had not yet scoped — an entry that
 * could never have changed the answer emptied the whole card anyway. This
 * function is the fix for the CLASS, not the next instance: every fact
 * this module can be unsure about is classified through the SAME test.
 *
 * THREE OUTCOMES PER ENTRY, not two:
 *
 *   1. IRRELEVANT (silently dropped, not even inspected further) — zero
 *      takeoffs and zero landings. Nothing about this entry's other facts
 *      can matter if it contributes no movement either way.
 *
 *   2. DECISIVELY EXCLUDED (silently dropped) — some KNOWN, non-null fact
 *      rules it out on its own: a different airman, a role that never
 *      counts (DUAL_RECEIVED), an affirmed "not sole manipulator," a KNOWN
 *      different aircraft category/class/type (match.ts's own
 *      short-circuit), a KNOWN non-tailwheel gear against a tailwheel
 *      intended aircraft (when `checkGear`), or an affirmed "not inside
 *      the 61.57(b)(1) window" (when `checkNightWindow`). None of these is
 *      a missing fact — resolving it further cannot change a "no" that is
 *      already known — so none of them is ever named in a gate. This is
 *      the same discipline instrument.ts applies to a visual approach or a
 *      device row logged 'neither': a known disqualifying fact is handled
 *      by exclusion, never by asking a question with only one answer.
 *
 *   3. CERTAIN or AMBIGUOUS. CERTAIN means every fact this function checks
 *      is KNOWN and passing; its takeoffs/landings go straight into the
 *      card's certain total. AMBIGUOUS means at least one fact is
 *      genuinely unknown (null, or a WHOLLY-simulator row this schema
 *      cannot confirm — see below) — its takeoffs/landings count only
 *      toward the BEST-CASE total, and it names every unresolved fact so
 *      the caller can ask `missingFactCouldChangeAnswer` whether any of
 *      them is worth surfacing to the pilot.
 *
 * A WHOLLY-SIMULATOR ROW is always outcome 3, never certain:
 * 61.57(a)(3)/(b)(2)/135.247(a)(3) each carry a device-approval and
 * part-142-course condition this schema has no field for, so crediting it
 * asserts an approval the pilot never stated. It is ALSO never checked
 * against the aircraft registry, gear, role, or sole-manipulator below —
 * a device session has no tail number, crew role, or sole-manipulator
 * fact by design (supabase/migrations/20260810020000's own header: "in an
 * FFS there is no aircraft, and 'who was acting as pilot in command of
 * the aircraft' has no answer"), and asking for one anyway is a remedy
 * with only one, unreachable answer (R3) as well as the Q1/REGU-4/CORR-1
 * failure shape (an unrelated simulator row poisoning the whole card with
 * a "register the aircraft" remedy no one can act on), generalized here
 * past the instrument card it was first found on.
 *
 * "WHOLLY-simulator" is `simulatorTime > 0` AND `totalTime <= simulatorTime`
 * — this schema's own definition, reused rather than invented here (see
 * ./simulator's isWhollySimulatorEntry and totalTime's own comment in
 * types.ts). A row with simulatorTime > 0 whose totalTime EXCEEDS
 * simulatorTime is a MIXED row — real aircraft time and unrelated
 * simulator/debrief time on the same entry — and is handled as an
 * ordinary real-aircraft row from here on: its takeoffs and landings are
 * real movements in a real aircraft, exactly what 61.57(a)/(b)/135.247(a)
 * count, and discarding them because the entry also happens to log
 * simulator time (R1) throws away a movement the pilot actually flew.
 * This schema records no split of a mixed row's movements between the
 * aircraft and the device, so all of them are taken as flown in the
 * aircraft — disclosed on the card, not left implicit, by
 * mixedSimulatorRowAssumption below. instrument.ts solved this same
 * WHOLLY-vs-MIXED split first (P9); the two modules now import the
 * identical predicate from ./simulator rather than each keeping their own
 * test of it (Finding A) — see that file's header for why the two had
 * drifted and how they could disagree about the same row.
 */

export function classifyForCurrency(
  inWindow: readonly CurrencyEntry[],
  airmanUserId: string,
  intendedAircraft: AircraftFacts,
  takeoffs: (e: CurrencyEntry) => number,
  landings: (e: CurrencyEntry) => number,
  options: { checkGear: boolean; checkNightWindow: boolean }
): EntryClassification {
  const certain: CurrencyEntry[] = [];
  const ambiguous: AmbiguousEntry[] = [];

  for (const e of inWindow) {
    if (takeoffs(e) <= 0 && landings(e) <= 0) continue; // outcome 1

    if (e.airmanUserId !== null && e.airmanUserId !== airmanUserId) continue; // outcome 2
    if (e.role !== null && !actingRoleAllowed(e.role)) continue; // outcome 2
    if (e.soleManipulator === false) continue; // outcome 2
    if (options.checkNightWindow && e.nightWindowAsserted === false) continue; // outcome 2

    const missing: MissingInput[] = [];
    if (e.airmanUserId === null) missing.push("airman_unattributed");
    if (options.checkNightWindow && e.nightWindowAsserted === null) missing.push("night_window_unasserted");

    if (isWhollySimulatorEntry(e)) {
      // R3: role/sole-manipulator are never asked about here — a wholly
      // device session has neither fact, and asking is a remedy with no
      // reachable answer (see this function's header).
      missing.push("unresolvable_simulator_row");
      ambiguous.push({ entry: e, missing });
      continue;
    }

    // Real-aircraft row, including a MIXED row whose totalTime exceeds
    // simulatorTime (R1) — role and sole-manipulator are real questions
    // here, unlike on a wholly-simulator row above.
    if (e.role === null) missing.push("role_unrecorded");
    if (e.soleManipulator === null) missing.push("sole_manipulator_unrecorded");

    if (e.aircraft === null) {
      missing.push("aircraft_unregistered");
      ambiguous.push({ entry: e, missing });
      continue;
    }

    const cat = sameCategoryClassAndType(e.aircraft, intendedAircraft);
    if (!cat.matches && cat.missing.length === 0) continue; // outcome 2: known different category/type
    missing.push(...cat.missing);

    if (options.checkGear) {
      const gear = gearMatches(e.aircraft, intendedAircraft);
      if (!gear.matches && gear.missing.length === 0) continue; // outcome 2: known non-tailwheel gear
      missing.push(...gear.missing);
    }

    if (missing.length > 0) ambiguous.push({ entry: e, missing });
    else certain.push(e);
  }

  return { certain, ambiguous };
}

const AMBIGUOUS_FACT_PHRASE: Partial<Record<MissingInput, string>> = {
  airman_unattributed: "its airman is not recorded",
  role_unrecorded: "its role is not recorded",
  sole_manipulator_unrecorded: "whether you were sole manipulator is not recorded",
  aircraft_unregistered: "its aircraft is not in your registry",
  aircraft_gear_unrecorded: "its aircraft's gear is not recorded",
  aircraft_category_class_unrecorded: "its aircraft's category/class is not recorded",
  aircraft_type_unrecorded: "its aircraft's type could not be matched against the intended aircraft",
  unresolvable_simulator_row: "it is a simulator/device session whose device approval and course details this schema cannot confirm",
  night_window_unasserted: "whether it fell inside the 61.57(b)(1) window is not recorded",
};

function describeAmbiguousEntry(a: AmbiguousEntry): string {
  const facts = a.missing.map((m) => AMBIGUOUS_FACT_PHRASE[m] ?? m).join("; ");
  return `Entry ${a.entry.entryDate}: ${facts} — and its takeoffs/landings could be the difference between current and not current, so this card asks rather than guesses.`;
}

/**
 * Turns a classification into a gate/no-gate decision — the ONE
 * comparison lib/currency/ambiguous-facts.ts's missingFactCouldChangeAnswer
 * encodes, applied to the union of every ambiguous entry's facts at once
 * rather than one fact at a time, so an entry ambiguous on TWO axes (say,
 * a null role AND a null gear) is named once, not gated twice by two
 * separate passes that could disagree about whether it mattered.
 */
export function ambiguousFactGates(
  classification: EntryClassification,
  takeoffs: (e: CurrencyEntry) => number,
  landings: (e: CurrencyEntry) => number,
  takeoffThreshold: number,
  landingThreshold: number
): { gates: Set<MissingInput>; notes: string[] } {
  const noGate = { gates: new Set<MissingInput>(), notes: [] as string[] };
  const { certain, ambiguous } = classification;
  if (ambiguous.length === 0) return noGate;

  const certainTakeoffs = certain.reduce((sum, e) => sum + takeoffs(e), 0);
  const certainLandings = certain.reduce((sum, e) => sum + landings(e), 0);
  const certainlyMeets = certainTakeoffs >= takeoffThreshold && certainLandings >= landingThreshold;

  const bestTakeoffs = certainTakeoffs + ambiguous.reduce((sum, a) => sum + takeoffs(a.entry), 0);
  const bestLandings = certainLandings + ambiguous.reduce((sum, a) => sum + landings(a.entry), 0);
  const bestCaseMeets = bestTakeoffs >= takeoffThreshold && bestLandings >= landingThreshold;

  if (!missingFactCouldChangeAnswer(certainlyMeets, bestCaseMeets)) return noGate;

  const gates = new Set<MissingInput>();
  const notes: string[] = [];
  for (const a of ambiguous) {
    for (const m of a.missing) gates.add(m);
    notes.push(describeAmbiguousEntry(a));
  }
  return { gates, notes };
}

/**
 * One shared sentence for general.ts, night.ts and part135.ts's
 * `assumptions[]` so the 90-day boundary choice reaches every 90-day
 * card, not just window.ts's own comment — REGU-7: the choice was
 * disclosed in code but never on the card a pilot actually reads.
 */
export const NINETY_DAY_BOUNDARY_ASSUMPTION =
  "The 90-day window runs from this date back through the 89 days before it — a takeoff or landing made exactly 90 days before this date falls one day outside the window and does not count.";

/**
 * FINDING B: an undisclosed attribution, now disclosed. classifyForCurrency
 * (this file's own header, "A WHOLLY-SIMULATOR ROW") already credits a
 * MIXED entry's takeoffs and landings as real-aircraft movements — real
 * aircraft time is left over once simulatorTime is subtracted from
 * totalTime, so the movement columns are real. But this schema records no
 * split of a mixed entry's takeoffs/landings between the aircraft portion
 * and the device portion, so crediting ALL of them to the aircraft is an
 * assumption, not a certainty read off the row — the only assumption
 * available, and a defensible one, but one this engine's own posture
 * (every conservative choice stated on the card, never left implicit)
 * requires saying out loud rather than leaving a pilot to infer it from a
 * number. Only rendered when it actually applied — an eligible (certain,
 * counted) entry with `simulatorTime > 0` is definitionally a mixed row
 * here, since a WHOLLY-simulator entry can never reach `certain` (see
 * isWhollySimulatorEntry above; it is always routed to `ambiguous` with
 * unresolvable_simulator_row) — matching how typeMatchAssumption and the
 * tailwheel sentences in general.ts/part135.ts are also conditional rather
 * than unconditional strings.
 */
export function mixedSimulatorRowAssumption(eligible: readonly CurrencyEntry[]): string | null {
  const countedAMixedRow = eligible.some((e) => (e.simulatorTime ?? 0) > 0);
  if (!countedAMixedRow) return null;
  return "At least one counted entry also logs simulator/device time alongside real aircraft time (a mixed row) — this schema records no split of its takeoffs and landings between the aircraft and the device, so all of them were taken as flown in the aircraft.";
}

export function countedFrom(
  eligible: readonly CurrencyEntry[],
  takeoffs: (e: CurrencyEntry) => number,
  landings: (e: CurrencyEntry) => number
): CountedEntry[] {
  return eligible
    .filter((e) => takeoffs(e) > 0 || landings(e) > 0)
    .map((e) => ({ entryId: e.id, entryDate: e.entryDate, takeoffs: takeoffs(e), landings: landings(e), approaches: 0 }));
}

/**
 * Walks `eligible` newest-first, accumulating both totals; returns the
 * entryDate of the row at which BOTH first reach their threshold — the
 * "limiting" (earliest still-needed) qualifying entry. null if the
 * thresholds are never both reached.
 */
export function limitingDateFor(
  eligible: readonly CurrencyEntry[],
  takeoffs: (e: CurrencyEntry) => number,
  landings: (e: CurrencyEntry) => number,
  takeoffThreshold: number,
  landingThreshold: number
): IsoDate | null {
  const newestFirst = [...eligible].sort((a, b) => (a.entryDate < b.entryDate ? 1 : a.entryDate > b.entryDate ? -1 : 0));
  let t = 0;
  let l = 0;
  for (const e of newestFirst) {
    t += takeoffs(e);
    l += landings(e);
    if (t >= takeoffThreshold && l >= landingThreshold) return e.entryDate;
  }
  return null;
}

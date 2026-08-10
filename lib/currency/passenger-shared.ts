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
import type { AircraftFacts, CountedEntry, CurrencyEntry, DateWindow, IsoDate, MissingInput } from "./types";

/**
 * When the intended aircraft carries no recorded type rating, match.ts's
 * sameCategoryClassAndType does NOT read that as "no rating required" —
 * a blank rating is not evidence a rating isn't needed (REGU-3). An entry
 * of the SAME type as intended still counts; a DIFFERENT (or unrecorded)
 * type is excluded from this total UNLESS resolving it could change
 * whether you are current — see matchGates below, which only asks you to
 * resolve a specific entry's type when it could actually be the
 * difference, not merely because it exists in the window (P1/P3: an
 * earlier version of this sentence claimed a silent exclusion in every
 * case, which was only ever true when the described case had not
 * occurred — supplying the fact matters, or it doesn't, and only the
 * first case reaches a card at all). Disclosed here as a shared
 * assumption string so general.ts, night.ts and part135.ts render
 * identical wording rather than three hand-copied sentences drifting
 * apart.
 */
export function typeMatchAssumption(intended: AircraftFacts): string | null {
  const required = intended.typeRating !== null && intended.typeRating.trim() !== "";
  if (required) return null;
  return "No type rating is recorded for the intended aircraft, so a different (or unrecorded) type of aircraft is not read as \"no rating required\" — an entry of the SAME type as the intended aircraft still counts; a different type is excluded from this total unless it could be the difference between current and not, in which case this card asks you to resolve it rather than guessing. See match.ts for why an absent rating is not read as \"none required.\"";
}

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

/** Gates common to every 90-day rule: airman attribution, role recording, sole-manipulator recording, and any unresolvable simulator row in the window. */
export function baseGates(inWindow: readonly CurrencyEntry[]): Set<MissingInput> {
  const gates = new Set<MissingInput>();
  for (const e of inWindow) {
    if (e.airmanUserId === null) gates.add("airman_unattributed");
    // A null role used to be silently dropped by actingRoleAllowed's
    // allowlist rather than gated — correct in that it never counted a
    // role that wasn't PIC/SIC/SOLO, but wrong in that an unrecorded role
    // is a fact that could change the answer (role SOLO + sole_manipulator
    // true is a real, common case) and the pilot got no remedy line
    // telling them which entry to fix. Gated here instead, same posture
    // as sole_manipulator_unrecorded below.
    if (e.role === null) gates.add("role_unrecorded");
    if (e.soleManipulator === null) gates.add("sole_manipulator_unrecorded");
    // 61.57(a)(3)/(b)(2) each carry a device-approval and part-142-course
    // condition this schema has no field for; counting a simulator row
    // asserts an approval the pilot never stated, ignoring it silently
    // under-credits real recurrent training. Neither is safe, so any
    // simulator row in a 90-day window forces insufficient_data. (c) is
    // the one exception among the currency rules and has its own gate —
    // see instrument.ts.
    if ((e.simulatorTime ?? 0) > 0) gates.add("unresolvable_simulator_row");
  }
  return gates;
}

/** An entry with real takeoffs or landings whose aircraft is not in the pilot's registry — a fact that could change the answer, not a zero. */
export function aircraftUnregisteredGate(
  inWindow: readonly CurrencyEntry[],
  takeoffs: (e: CurrencyEntry) => number,
  landings: (e: CurrencyEntry) => number
): boolean {
  return inWindow.some((e) => e.aircraft === null && (takeoffs(e) > 0 || landings(e) > 0));
}

/**
 * Surfaces sameCategoryClassAndType's own MISSING inputs across the
 * window — see match.ts's header: a null category/type on an entry's
 * registered aircraft is a missing input, never silently treated as "not
 * this type," which would tell a current pilot they are not.
 *
 * SCOPED BY lib/currency/ambiguous-facts.ts's RULE (P1): a missing type or
 * category on one entry gates the card ONLY IF resolving it could change
 * whether the pilot is current. Two things follow, and both are load-
 * bearing — an earlier version of this function got neither right, and
 * turned one unrelated logbook entry into a whole-card gate for every
 * pilot whose intended aircraft carries no recorded type rating:
 *
 *   1. RELEVANCE FIRST. An entry that could never contribute regardless
 *      of how its ambiguous fact resolved — wrong airman, a role that
 *      never counts (DUAL_RECEIVED), sole manipulator not affirmed, no
 *      aircraft on record, zero takeoffs or landings, or (via match.ts's
 *      own short-circuit) a KNOWN different category — is never even
 *      considered here. `eligibleEntries` below already applies every one
 *      of those filters for the CERTAIN count; `ambiguousMatchEntries`
 *      applies the identical filters, minus the one fact actually in
 *      question, for the entries whose ambiguity might matter.
 *   2. ARITHMETIC SECOND. Among the entries that survive #1, the fact
 *      only gates if the pilot is short on the CERTAIN total but would
 *      clear it on the BEST-CASE total (certain + every ambiguous entry
 *      counted as if it matched) — missingFactCouldChangeAnswer's own
 *      comparison. If certain alone already clears the bar, the
 *      ambiguity is moot and the card answers from certain alone. If even
 *      best-case falls short, the ambiguity is ALSO moot — the pilot is
 *      not current regardless — and the card again answers from certain
 *      alone (never from best-case: an unresolved fact is never credited,
 *      only ever asked about).
 */
function ambiguousMatchEntries(
  inWindow: readonly CurrencyEntry[],
  airmanUserId: string,
  intendedAircraft: AircraftFacts,
  takeoffs: (e: CurrencyEntry) => number,
  landings: (e: CurrencyEntry) => number,
  isOtherwiseEligible: (e: CurrencyEntry) => boolean
): { entry: CurrencyEntry; missing: MissingInput[] }[] {
  const out: { entry: CurrencyEntry; missing: MissingInput[] }[] = [];
  for (const e of inWindow) {
    if (e.airmanUserId !== airmanUserId) continue;
    if (!actingRoleAllowed(e.role)) continue;
    if (e.soleManipulator !== true) continue;
    if (e.aircraft === null) continue; // handled by aircraftUnregisteredGate
    if (takeoffs(e) <= 0 && landings(e) <= 0) continue; // cannot contribute either way
    // A caller-supplied fact besides type/category can ALSO conclusively
    // rule an entry out — general.ts/part135.ts pass a gear-compatibility
    // check here so a tricycle entry's ambiguous TYPE never gets asked
    // about when its already-KNOWN gear mismatch means it could never
    // have contributed regardless of how the type resolved.
    if (!isOtherwiseEligible(e)) continue;
    const { matches, missing } = sameCategoryClassAndType(e.aircraft, intendedAircraft);
    if (!matches && missing.length > 0) out.push({ entry: e, missing });
  }
  return out;
}

/**
 * `certainTakeoffs`/`certainLandings` are the CALLER's own already-computed
 * certain total — general.ts/part135.ts's is gear-filtered on top of
 * `eligibleEntries`, night.ts's is `eligibleEntries` alone (see each
 * module's own gear-gate header for why they differ) — passed in rather
 * than recomputed here so this function can never silently use a
 * DIFFERENT "certain" than the one the card's own arithmetic will use.
 * `isOtherwiseEligible` is that same additional filter, applied to the
 * AMBIGUOUS side for the identical reason (see ambiguousMatchEntries
 * above); omit it where there is no such additional fact (night.ts).
 */
export function matchGates(
  inWindow: readonly CurrencyEntry[],
  airmanUserId: string,
  intendedAircraft: AircraftFacts,
  takeoffs: (e: CurrencyEntry) => number,
  landings: (e: CurrencyEntry) => number,
  takeoffThreshold: number,
  landingThreshold: number,
  certainTakeoffs: number,
  certainLandings: number,
  isOtherwiseEligible: (e: CurrencyEntry) => boolean = () => true
): { gates: Set<MissingInput>; notes: string[] } {
  const noGate = { gates: new Set<MissingInput>(), notes: [] as string[] };

  const ambiguous = ambiguousMatchEntries(inWindow, airmanUserId, intendedAircraft, takeoffs, landings, isOtherwiseEligible);
  if (ambiguous.length === 0) return noGate;

  const certainlyMeets = certainTakeoffs >= takeoffThreshold && certainLandings >= landingThreshold;

  const bestTakeoffs = certainTakeoffs + ambiguous.reduce((sum, a) => sum + takeoffs(a.entry), 0);
  const bestLandings = certainLandings + ambiguous.reduce((sum, a) => sum + landings(a.entry), 0);
  const bestCaseMeets = bestTakeoffs >= takeoffThreshold && bestLandings >= landingThreshold;

  if (!missingFactCouldChangeAnswer(certainlyMeets, bestCaseMeets)) return noGate;

  const gates = new Set<MissingInput>();
  const notes: string[] = [];
  for (const a of ambiguous) {
    for (const m of a.missing) gates.add(m);
    notes.push(
      `Entry ${a.entry.entryDate}: its aircraft's type or category could not be matched against the intended aircraft, and its takeoffs/landings could be the difference between current and not current — resolving the aircraft's type rating, type designator, or category/class would settle it.`
    );
  }
  return { gates, notes };
}

/**
 * 61.57(a)(1)(ii) / 135.247(b) ONLY — see match.ts's gearMatches. NOT
 * called by night.ts: 61.57(b) has no tailwheel clause of its own (see
 * that module's header), so calling this there would gate/exclude
 * entries on a fact the rule never conditions on. Scoped to entries that
 * actually contribute a takeoff or landing, same as aircraftUnregisteredGate
 * above — an entry with no movements can't change the answer regardless
 * of its aircraft's gear.
 */
export function gearGates(
  inWindow: readonly CurrencyEntry[],
  intendedAircraft: AircraftFacts,
  takeoffs: (e: CurrencyEntry) => number,
  landings: (e: CurrencyEntry) => number
): Set<MissingInput> {
  const gates = new Set<MissingInput>();
  if (intendedAircraft.gear !== "tailwheel") return gates;
  for (const e of inWindow) {
    if (e.aircraft === null) continue; // handled by aircraftUnregisteredGate
    if (takeoffs(e) <= 0 && landings(e) <= 0) continue;
    const { missing } = gearMatches(e.aircraft, intendedAircraft);
    for (const m of missing) gates.add(m);
  }
  return gates;
}

/**
 * One shared sentence for general.ts, night.ts and part135.ts's
 * `assumptions[]` so the 90-day boundary choice reaches every 90-day
 * card, not just window.ts's own comment — REGU-7: the choice was
 * disclosed in code but never on the card a pilot actually reads.
 */
export const NINETY_DAY_BOUNDARY_ASSUMPTION =
  "The 90-day window runs from this date back through the 89 days before it — a takeoff or landing made exactly 90 days before this date falls one day outside the window and does not count.";

export function eligibleEntries(
  inWindow: readonly CurrencyEntry[],
  airmanUserId: string,
  intendedAircraft: AircraftFacts
): CurrencyEntry[] {
  return inWindow.filter(
    (e) =>
      e.airmanUserId === airmanUserId &&
      actingRoleAllowed(e.role) &&
      e.soleManipulator === true &&
      e.aircraft !== null &&
      sameCategoryClassAndType(e.aircraft, intendedAircraft).matches
  );
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

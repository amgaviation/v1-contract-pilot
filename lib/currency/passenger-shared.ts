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
import { sameCategoryClassAndType } from "./match";
import type { AircraftFacts, CountedEntry, CurrencyEntry, DateWindow, IsoDate, MissingInput } from "./types";

/**
 * match.ts's sameCategoryClassAndType only compares type when the
 * intended aircraft carries a recorded type rating. Disclosed here as a
 * shared assumption string so general.ts, night.ts and part135.ts render
 * identical wording rather than three hand-copied sentences drifting
 * apart — a pilot reading it should understand why an entry from a
 * different-looking aircraft counted.
 */
export function typeMatchAssumption(intended: AircraftFacts): string | null {
  const required = intended.typeRating !== null && intended.typeRating.trim() !== "";
  if (required) return null;
  return "No type rating is recorded for the intended aircraft, so entries are matched on category and class only — see match.ts for why an absent type rating is read as \"not required,\" not \"unrecorded.\"";
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
 */
export function matchGates(
  inWindow: readonly CurrencyEntry[],
  intendedAircraft: AircraftFacts
): Set<MissingInput> {
  const gates = new Set<MissingInput>();
  for (const e of inWindow) {
    if (e.aircraft === null) continue; // handled by aircraftUnregisteredGate
    const { missing } = sameCategoryClassAndType(e.aircraft, intendedAircraft);
    for (const m of missing) gates.add(m);
  }
  return gates;
}

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

/**
 * ONE PREDICATE for "is this logbook entry wholly a simulator/device
 * session, with no real aircraft time in it at all" — imported by both
 * instrument.ts (61.57(c)(2)'s device branch) and passenger-shared.ts
 * (61.57(a)/(b)/135.247(a)'s movement classification, via
 * classifyForCurrency).
 *
 * BEFORE THIS FILE EXISTED, the two modules answered "was this row a real
 * flight or a device session" with two different tests that could
 * disagree about the SAME row. instrument.ts keyed on approachCondition:
 * `simulatorTime > 0 && approachCondition !== 'actual'`, reasoning that
 * actual weather cannot happen in a device, so a row logged 'actual' must
 * be real. That reasoning is correct as far as it goes, but it is a
 * PROXY, not the fact itself, and the proxy is wrong in exactly one
 * shape: a MIXED row (real aircraft time left over after subtracting
 * simulatorTime from totalTime) whose approaches are logged 'simulated'
 * rather than 'actual' — flown under a view-limiting device IN THE
 * AIRCRAFT, per 61.57(c)(1), not in the device session the same entry
 * also happens to log. passenger-shared.ts's direct totalTime/
 * simulatorTime test correctly read that row as real-aircraft (it has
 * real aircraft time); instrument.ts's approachCondition proxy read the
 * identical row as a device session and could never make it certain. One
 * card counted it; the other could only ever ask about it.
 *
 * THEY ARE THE SAME QUESTION, so this is the one place it gets answered:
 * totalTime vs simulatorTime is this schema's OWN definition of "wholly
 * simulator," not invented here — see types.ts's comment on totalTime and
 * supabase/migrations/20260810020000's CHECK
 * (logbook_entries_role_required_unless_simulator), which permits a null
 * crew role only on exactly this condition (`total_time = simulator_time`).
 * Reusing it here, in one function both modules import, is what makes "is
 * this a device row" the same answer everywhere the engine asks it,
 * instead of two tests that happen to agree most of the time.
 *
 * WHAT THIS PREDICATE DOES NOT DECIDE: whether a device row's, or a mixed
 * row's, activity actually COUNTS toward any one card. 61.57(c)(2)
 * credits a wholly-simulator row for INSTRUMENT experience on its own
 * terms (see instrument.ts's device branch, which this predicate only
 * routes entries INTO); 61.57(a)/(b) and 135.247 count movements made IN
 * AN AIRCRAFT, so a wholly-simulator row is never certain there (see
 * passenger-shared.ts's classifyForCurrency). A device row is not
 * "invalid" — it is valid for one card and irrelevant to another; this
 * function only answers the yes/no question both cards need answered the
 * same way before they go decide what a "yes" or a "no" means for them.
 */
import type { CurrencyEntry } from "./types";

export function isWhollySimulatorEntry(e: CurrencyEntry): boolean {
  const sim = e.simulatorTime ?? 0;
  // `<=`, NOT `===`, and that difference is the whole safety direction.
  //
  // lib/logbook-import/resolve-row.ts's isWhollySimulator uses `===` because
  // it mirrors logbook_entries_role_required_unless_simulator exactly, and an
  // importer's job is to agree with the constraint. Right there; wrong here.
  //
  // Nothing forbids a row whose simulator_time EXCEEDS its total_time. That
  // CHECK governs only when a crew role may be ABSENT, so a row carrying a
  // role and sim > total satisfies the database happily. Under `===` such a
  // row is not "wholly simulator", falls through to the real-aircraft path,
  // and has its takeoffs and landings (or, here, its approaches) CREDITED —
  // the engine would manufacture currency out of a pure simulator session.
  //
  // `<=` puts the nonsensical case on the safe side: an entry with no aircraft
  // time left over cannot have produced a movement in an aircraft, or an
  // approach flown in one. Erring this way costs a pilot nothing they are
  // entitled to, because there is no real flight time in the row to lose.
  return sim > 0 && e.totalTime <= sim;
}

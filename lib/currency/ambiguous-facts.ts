/**
 * THE ONE RULE for deciding whether a missing or unresolved fact on a
 * logbook entry is worth turning into insufficient_data, shared by every
 * rule module so it is answered the same way everywhere instead of
 * re-derived per module (passenger-shared.ts's ambiguousFactGates and
 * instrument.ts's evaluateInstrumentExperience both call this, each after
 * classifying every entry in the window as certain, ambiguous, or
 * decisively excluded — see classifyForCurrency's and
 * classifyInstrumentEntry's own headers).
 *
 * A missing fact produces insufficient_data ONLY IF SUPPLYING IT COULD
 * CHANGE THE ANSWER.
 *
 * THE NAIVE VERSION — gate the whole card whenever ANY entry in the
 * window carries the ambiguous fact, regardless of whether that entry
 * could ever have mattered — is wrong, and every repair round on this
 * engine has reintroduced it in a new place (matching entries by type
 * with a blank intended type rating; crediting a simulator/device row
 * with no way to confirm what it represents). It is wrong for two
 * independent reasons:
 *
 *   1. It gates on entries that cannot possibly contribute: zero
 *      takeoffs/landings, a different airman, a role that never counts
 *      (DUAL_RECEIVED), or an aircraft in an unrelated category. "Some
 *      entry somewhere carries the ambiguous fact" is not the same
 *      question as "does that ambiguity matter" — see each call site's
 *      own relevance filter for how entries like these are kept out of
 *      the comparison in the first place, before this function is ever
 *      called.
 *   2. Even for an entry that COULD contribute, it forces
 *      insufficient_data even when the pilot's unambiguous entries
 *      already clear the bar on their own (the fact could not have
 *      changed a "yes"), or when even the most generous reading of the
 *      ambiguous fact still falls short (the fact could not have changed
 *      a "no" either). Only the remaining case — short without it,
 *      sufficient with it — is a fact actually worth asking the pilot to
 *      resolve.
 *
 * `certainlyMeetsRequirement` is computed from ONLY the fully-resolved
 * evidence. `bestCaseMeetsRequirement` is computed from the fully-resolved
 * evidence PLUS every ambiguous entry's contribution, counted as if its
 * missing fact resolved in the pilot's favor — the most generous number
 * the ambiguity could ever produce. This function does none of that
 * counting itself (each call site's arithmetic differs — two thresholds
 * for the 90-day rules, three for instrument, one boolean or a count for
 * others); it only encodes the one comparison that turns those two
 * booleans into a gate/no-gate decision, so that comparison cannot drift
 * between call sites the way the underlying arithmetic legitimately does.
 */
export function missingFactCouldChangeAnswer(
  certainlyMeetsRequirement: boolean,
  bestCaseMeetsRequirement: boolean
): boolean {
  return !certainlyMeetsRequirement && bestCaseMeetsRequirement;
}

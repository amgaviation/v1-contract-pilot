/**
 * Aircraft matching, in one place — every currency rule that requires
 * "same category, class, and type" reads this instead of re-deriving it.
 */
import type { AircraftFacts, MissingInput } from "./types";

/**
 * TYPE RATING WINS over the ICAO designator. One CE-500 rating covers the
 * Cessna 500/501/550/551/S550/552/560, which ICAO splits five ways;
 * grouping on the designator alone would tell a CE-500 pilot their
 * Citation Bravo landings do not count toward their Citation V — and they
 * do (61.57(a)(1)(ii): "same category, class, and type (if a class or
 * type rating is required)"). Same preference
 * pilot.logbook_time_by_type uses (20260810110000_aircraft_registry.sql).
 */
export function typeKey(a: AircraftFacts): string | null {
  const rating = a.typeRating?.trim();
  if (rating) return rating.toUpperCase();
  const designator = a.typeDesignator?.trim();
  if (designator) return designator.toUpperCase();
  return null;
}

/**
 * category_class is free text (pilot.aircraft's own column comment: a
 * CHECK that is wrong for a pilot's aircraft is worse than a field they
 * fill in themselves), so this is an exact compare over pilot-typed
 * values, never a fuzzy one. Trim and collapse internal whitespace so
 * "AMEL" and "AMEL " (or "Multi  Engine") are the same key; blank ("")
 * reads as unknown, not as a value.
 */
export function categoryKey(a: AircraftFacts): string | null {
  const collapsed = a.categoryClass?.trim().replace(/\s+/g, " ");
  return collapsed ? collapsed.toUpperCase() : null;
}

/**
 * Category and class always compare (a null on EITHER side is a MISSING
 * INPUT, never a non-match — the two produce different engine states
 * (insufficient_data vs. a row silently excluded from the eligible count)
 * and collapsing them is how a pilot who is actually current gets told
 * they are not, because one of their qualifying entries has an aircraft
 * record with a blank category field).
 *
 * A KNOWN, DIFFERENT CATEGORY SHORT-CIRCUITS TO A SILENT NON-MATCH,
 * before the type limb is even looked at. Category alone conclusively
 * rules a row out — a helicopter entry can never become the same type as
 * an ASEL intended aircraft no matter how its type rating or designator
 * would have resolved — so returning early here is what keeps an
 * unrelated-category row from ever being read as an "unresolved type"
 * fact. Before this short-circuit existed, a row like that fell through
 * to the type check below and picked up aircraft_type_unrecorded on the
 * blank-rating path purely because the code hadn't yet noticed the
 * category already decided the answer — passenger-shared.ts's
 * classifyForCurrency depends on a decisive non-match never adding to
 * `missing`, or an irrelevant entry (wrong category, wrong airman, no
 * movements — see that module) ends up gating a card it could never have
 * changed.
 *
 * TYPE COMPARES WHEN A TYPE RATING IS REQUIRED — 61.57(a)(1)(ii)
 * ("...and, if a class or type rating is required for that aircraft...")
 * and 135.247(a)(1) ("...and, if a type rating is required, of the same
 * type") both condition the type limb on the aircraft TO BE FLOWN, i.e.
 * `intended`, not on the logged entry. `intended.typeRating` RECORDED is
 * good evidence a rating is required. `intended.typeRating` BLANK is NOT
 * good evidence one ISN'T — it is equally consistent with an operator who
 * simply never typed a rating in for an aircraft (a jet, a large piston
 * twin) that legally needs one, and reading it as "not required" is how a
 * Citation's landings ended up crediting a Baron's currency (REGU-3). The
 * one case a blank typeRating resolves cleanly, without guessing at a
 * fact this schema does not record, is an entry logged in the SAME
 * RECORDED type as intended (by typeKey, rating-or-designator, both
 * non-null): that is a match no matter whether a rating turns out to be
 * required for it. If the intended aircraft's own type is entirely
 * unrecorded (neither typeRating nor typeDesignator), NO entry resolves
 * here this way — not even one logged in the identical aircraft — because
 * there is no known type value on the intended side to compare against;
 * general.ts/night.ts/part135.ts already gate that case upstream, from
 * the intended aircraft's own blank fields, before any entry is ever
 * checked against it. Any other combination — a different recorded type,
 * or either side's type entirely unrecorded — is an UNRESOLVED FACT, not
 * a pass; three full-stop landings in a C172 no longer count toward a
 * PA-28 on category/class alone, because this schema cannot tell that
 * case apart from the Citation/Baron one.
 *
 * A KNOWN, DIFFERENT TYPE (both typeKeys resolved and unequal, with a
 * rating required) is JUST AS DECISIVE as the category short-circuit
 * above, and must return immediately for the same reason (Q4): a Baron
 * entry can never become a Citation's type no matter how ITS category
 * turns out to be recorded, so a still-blank category on that same entry
 * must never be reported as the reason this card cannot answer. Before
 * this short-circuit existed, a decisively-wrong-typed entry with an
 * ALSO-blank category fell through to the final `missing.length > 0`
 * check and was reported as `aircraft_category_class_unrecorded` — true
 * in isolation, but misleading, because recording that category could
 * never have changed this entry's (already known) non-match.
 */
export function sameCategoryClassAndType(
  entry: AircraftFacts,
  intended: AircraftFacts
): { matches: boolean; missing: MissingInput[] } {
  const missing: MissingInput[] = [];

  const entryCategory = categoryKey(entry);
  const intendedCategory = categoryKey(intended);
  if (entryCategory === null || intendedCategory === null) {
    missing.push("aircraft_category_class_unrecorded");
  } else if (entryCategory !== intendedCategory) {
    return { matches: false, missing: [] };
  }

  const entryType = typeKey(entry);
  const intendedType = typeKey(intended);
  const typeRequired = intended.typeRating !== null && intended.typeRating.trim() !== "";
  let typeMatches: boolean;
  if (typeRequired) {
    if (entryType === null || intendedType === null) {
      missing.push("aircraft_type_unrecorded");
      typeMatches = false;
    } else if (entryType !== intendedType) {
      // KNOWN, DIFFERENT type — decisive (Q4): return now, before any
      // category ambiguity accumulated above can be reported as the
      // reason, since resolving that category could never change this
      // entry's already-known non-match.
      return { matches: false, missing: [] };
    } else {
      typeMatches = true;
    }
  } else if (entryType !== null && intendedType !== null && entryType === intendedType) {
    // Same logged type as intended — matches regardless of whether a
    // rating turns out to be required for it.
    typeMatches = true;
  } else {
    // typeRating blank AND the types differ (or either is unrecorded):
    // whether that difference matters is exactly the fact this schema
    // cannot determine. insufficient_data, not a silent pass.
    missing.push("aircraft_type_unrecorded");
    typeMatches = false;
  }

  if (missing.length > 0) return { matches: false, missing };

  // Category is known-equal here (a known mismatch already returned
  // above; an unknown category already added to `missing` above).
  return { matches: typeMatches, missing: [] };
}

/**
 * 61.57(a)(1)(ii) / 135.247(b): when the aircraft TO BE FLOWN is a
 * tailwheel airplane, the LOGGED aircraft's own gear must be tailwheel
 * too — "the takeoffs and landings must have been made ... in an
 * airplane with a tailwheel" / "each takeoff must be made in a tailwheel
 * airplane and each landing must be made to a full stop in a tailwheel
 * airplane." Only binds when `intended.gear === "tailwheel"`; every other
 * gear value returns matches: true unconditionally, because neither
 * clause constrains a non-tailwheel intended aircraft's entries by gear
 * at all. 61.57(b) (night.ts) has NO tailwheel clause of its own and must
 * never call this — see that module's header.
 *
 * A null gear on the LOGGED aircraft is a MISSING INPUT, not a silent
 * pass (that is what let a Skyhawk's landings credit a taildragger's
 * currency, REGU-1/REGU-2) and not a silent exclusion either (an
 * actually-current tailwheel pilot's own entries, logged before gear was
 * tracked, must not be quietly dropped from the count, REGU-5).
 */
export function gearMatches(
  entry: AircraftFacts,
  intended: AircraftFacts
): { matches: boolean; missing: MissingInput[] } {
  if (intended.gear !== "tailwheel") return { matches: true, missing: [] };
  if (entry.gear === null) return { matches: false, missing: ["aircraft_gear_unrecorded"] };
  return { matches: entry.gear === "tailwheel", missing: [] };
}

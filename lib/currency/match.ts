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
 * TYPE COMPARES ONLY WHEN A TYPE RATING IS REQUIRED — 61.57(a)(1)(ii)
 * ("...and, if a class or type rating is required for that aircraft...")
 * and 135.247(a)(1) ("...and, if a type rating is required, of the same
 * type") both condition the type limb on the aircraft TO BE FLOWN, i.e.
 * `intended`, not on the logged entry. This schema's signal for "a type
 * rating is required" is `intended.typeRating` being recorded at all: an
 * FAA type rating is only assigned to large/turbine aircraft, and
 * pilot.aircraft.type_rating's own column comment notes a pilot "who does
 * not know or does not care" leaves it blank for anything else — which
 * for the pilot's OWN registered fleet is a reasonable signal that no
 * rating applies, not that data is missing. When intended carries no type
 * rating, category and class alone govern the match and typeDesignator
 * plays no part in it: three full-stop landings in a C172 count toward
 * PA-28 currency — both ASEL, neither requiring a type rating — where
 * comparing ICAO designators unconditionally (the previous behavior) told
 * a legally current pilot they were not.
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
  }

  const typeRequired = intended.typeRating !== null && intended.typeRating.trim() !== "";
  let typeMatches = true;
  if (typeRequired) {
    const entryType = typeKey(entry);
    const intendedType = typeKey(intended);
    if (entryType === null || intendedType === null) {
      missing.push("aircraft_type_unrecorded");
    } else {
      typeMatches = entryType === intendedType;
    }
  }

  if (missing.length > 0) return { matches: false, missing };

  return {
    matches: entryCategory === intendedCategory && typeMatches,
    missing: [],
  };
}

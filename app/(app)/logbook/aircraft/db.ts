/**
 * The pilot's own fleet — pilot.aircraft and its two read-side views, from
 * supabase/migrations/20260810110000_aircraft_registry.sql. Read that
 * file's header before changing anything here; the reasoning behind the
 * generated key, the read-time join and the deliberate absence of a DELETE
 * path all lives there.
 *
 * Shapes only. The `.from()` escape hatch is the parent directory's
 * logbookFrom(), which these table names were added to — see its comment.
 */

/**
 * 61.57(a)(1) requires the three takeoffs and landings to be made TO A
 * FULL STOP "if the aircraft to be flown is an airplane with a tailwheel"
 * (verified against the current CFR text, govinfo, 14 CFR part 61,
 * retrieved 2026-08-10). That is the entire reason this column exists.
 *
 * null is a THIRD state, not a default. "Nobody said" must never be read
 * as "tricycle": a currency engine that assumed the common case would tell
 * a tailwheel pilot they are current on touch-and-goes that do not count.
 */
export type AircraftGear = "tricycle" | "tailwheel" | "skid" | "float" | "ski";

export const GEAR_LABEL: Record<AircraftGear, string> = {
  tricycle: "Tricycle",
  tailwheel: "Tailwheel",
  skid: "Skids",
  float: "Floats",
  ski: "Skis",
};

/**
 * The category and class vocabulary of 61.5(b). Offered as suggestions,
 * not enforced as a CHECK: the column is free text so a pilot is never
 * blocked by a list that is wrong for their aircraft, but a rollup that
 * has to treat "AMEL", "amel", "Multi" and "Multi-Engine Land" as four
 * different classes is no rollup at all. Suggestions get convergence
 * without the refusal.
 */
export const CATEGORY_CLASS_SUGGESTIONS = [
  "ASEL",
  "AMEL",
  "ASES",
  "AMES",
  "Rotorcraft — Helicopter",
  "Rotorcraft — Gyroplane",
  "Glider",
  "Lighter-than-air — Airship",
  "Lighter-than-air — Balloon",
  "Powered-lift",
  "Powered parachute — Land",
  "Powered parachute — Sea",
  "Weight-shift-control — Land",
  "Weight-shift-control — Sea",
] as const;

/** Mirrors pilot.aircraft exactly — keep in lockstep with the migration. */
export type AircraftRow = {
  id: string;
  account_id: string;
  /** As the pilot wrote it, and rendered back to them that way. */
  tail_number: string;
  /** GENERATED. Case-folded and punctuation-stripped; never writable. */
  tail_key: string;
  type_designator: string | null;
  /** The FAA type rating — see the migration's column comment. */
  type_rating: string | null;
  make_model: string | null;
  gear: AircraftGear | null;
  category_class: string | null;
  notes: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
};

/** The columns the fleet form is allowed to write. */
export type AircraftFields = Pick<
  AircraftRow,
  | "tail_number"
  | "type_designator"
  | "type_rating"
  | "make_model"
  | "gear"
  | "category_class"
  | "notes"
>;

export type AircraftInsert = AircraftFields & { account_id: string };
export type AircraftUpdate = Partial<AircraftFields> & { archived_at?: string | null };

/** A row of pilot.logbook_time_by_type. */
export type TimeByTypeRow = {
  type_label: string;
  entry_count: number;
  /** AIRCRAFT time. Simulator hours are in simulator_time, never added here. */
  total_time: number;
  pic_time: number;
  sic_time: number;
  night_time: number;
  simulator_time: number;
  has_registered_aircraft: boolean;
};

/** A row of pilot.aircraft_time_by_tail. */
export type TimeByTailRow = {
  aircraft_id: string;
  entry_count: number;
  /** AIRCRAFT time. Simulator hours are in simulator_time, never added here. */
  total_time: number;
  pic_time: number;
  sic_time: number;
  night_time: number;
  simulator_time: number;
  /**
   * null for an airframe registered but not yet flown — and unmoved by a
   * simulator session, which is not a day the airframe flew.
   */
  last_flown_on: string | null;
};

/** A row of pilot.aircraft_unregistered_idents. */
export type UnregisteredIdentRow = {
  aircraft_ident: string;
  tail_key: string;
  aircraft_type: string | null;
  entry_count: number;
  total_time: number;
  last_flown_on: string;
};

/**
 * ICAO type designators are 2–4 characters, upper case (C560, BE40, PC12,
 * H25B). The column's CHECK enforces exactly that, so a pilot who types
 * "c560" would otherwise get a raw constraint violation for a shape that
 * is perfectly correct apart from case. Normalise before the write rather
 * than loosening the constraint: the designator is what the hours-by-type
 * rollup groups on, and "c560" and "C560" being two types is the exact
 * fragmentation this registry exists to end.
 */
export function normaliseTypeDesignator(raw: string): string | null {
  const trimmed = raw.trim().toUpperCase();
  return trimmed === "" ? null : trimmed;
}

/**
 * FAA type ratings are written with a hyphen — CE-500, B-737, CE-560XL,
 * LR-JET. Same normalisation, a wider shape.
 */
export function normaliseTypeRating(raw: string): string | null {
  const trimmed = raw.trim().toUpperCase();
  return trimmed === "" ? null : trimmed;
}

/**
 * The same normalisation the database applies to tail_key, so the UI can
 * tell a pilot "you already have that one" before the INSERT does — and
 * name the aircraft they already have, which a 23505 cannot.
 */
export function tailKey(raw: string): string {
  // STRIP FIRST, THEN UPPERCASE — the order the generated column uses, and
  // the two orders are not equivalent. `'\u00df'.toUpperCase()` is "SS", so
  // uppercasing first PROMOTES a character Postgres strips: for the tail
  // number "\u00df\u00df" this function used to answer "SSSS" while the
  // database stored an empty key. That passed the length CHECK and the
  // empty-key guard in actions.ts, silently consumed the account's one
  // `unique (account_id, '')` slot, and produced a row that could never
  // match a logbook entry.
  return raw.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
}

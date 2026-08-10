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
export type AircraftGear = "tricycle" | "tailwheel";

export const GEAR_LABEL: Record<AircraftGear, string> = {
  tricycle: "Tricycle",
  tailwheel: "Tailwheel",
};

/** Mirrors pilot.aircraft exactly — keep in lockstep with the migration. */
export type AircraftRow = {
  id: string;
  account_id: string;
  /** As the pilot wrote it, and rendered back to them that way. */
  tail_number: string;
  /** GENERATED. Case-folded and punctuation-stripped; never writable. */
  tail_key: string;
  type_designator: string | null;
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
  "tail_number" | "type_designator" | "make_model" | "gear" | "category_class" | "notes"
>;

export type AircraftInsert = AircraftFields & { account_id: string };
export type AircraftUpdate = Partial<AircraftFields> & { archived_at?: string | null };

/** A row of pilot.logbook_time_by_type. */
export type TimeByTypeRow = {
  type_label: string;
  entry_count: number;
  total_time: number;
  pic_time: number;
  night_time: number;
  has_registered_aircraft: boolean;
};

/** A row of pilot.aircraft_time_by_tail. */
export type TimeByTailRow = {
  aircraft_id: string;
  entry_count: number;
  total_time: number;
  pic_time: number;
  night_time: number;
  /** null for an airframe registered but not yet flown. */
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
 * The same normalisation the database applies to tail_key, so the UI can
 * tell a pilot "you already have that one" before the INSERT does — and
 * name the aircraft they already have, which a 23505 cannot.
 */
export function tailKey(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

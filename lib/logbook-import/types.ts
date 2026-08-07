/**
 * Shared types for the logbook CSV import pipeline (ForeFlight, LogTen
 * Pro, and the generic column mapper). See fields.ts for the field
 * catalogue and apply-mapping.ts for the parser every format shares.
 */

import type { LogbookEntryFlightFields, LogbookRole } from "@/app/(app)/logbook/db";

export type ImportFormat = "foreflight" | "logten" | "generic_csv";

/**
 * The set of columns a source row can be mapped onto. This is almost
 * exactly LogbookEntryFlightFields's keys, with two additions that are
 * NOT real database columns:
 *
 *   - "landings_total": for a source that records one undifferentiated
 *     landing count. Mapping a column here is how the aviation-correctness
 *     rule ("don't distribute an undifferentiated count across
 *     day/night/full-stop/touch-and-go by guessing") is expressed in the
 *     UI — it is a deliberately separate target from
 *     day_landings_full_stop etc. so a pilot can never accidentally point
 *     an ambiguous column at a column that claims a classification the
 *     source never made.
 *   - "ignore": every mapping slot defaults here; a source column stays
 *     unused until the pilot (or the format's own alias table) points it
 *     somewhere specific.
 */
export type CanonicalKey =
  | keyof LogbookEntryFlightFields
  | "landings_total"
  | "ignore";

export type FieldKind = "date" | "time" | "count" | "icao" | "text" | "enum";

export type FieldDef = {
  key: CanonicalKey;
  label: string;
  kind: FieldKind;
  /** Only meaningful for kind "enum". */
  options?: readonly string[];
  required?: boolean;
};

/** header index -> canonical field, or "ignore"/undefined for unused columns. */
export type ColumnMapping = (CanonicalKey | undefined)[];

export type RoleSource = "explicit" | "inferred" | "needs_selection";

/**
 * A row's parsed flight data with `role` still possibly unresolved.
 * Deliberately NOT LogbookEntryFlightFields (which requires a concrete
 * PIC/SIC role) — that type difference is what makes it a type error,
 * not just a convention, to send an unresolved row's values straight to
 * an insert. See resolve-row.ts for the one place a null role here
 * becomes a real LogbookEntryFlightFields.
 */
export type ParsedRowValues = Omit<LogbookEntryFlightFields, "role"> & {
  role: LogbookRole | null;
};

export type ParsedRow = {
  rowNumber: number;
  raw: string;
  /** The original row as a header-name -> raw-string-value map, stored verbatim into logbook_entries.source_row for the legal record. */
  sourceRow: Record<string, string>;
  values: ParsedRowValues;
  roleSource: RoleSource;
  /** The portion of a mapped landings_total column's value NOT accounted for by this row's four typed landing columns (landings_total − their sum), whenever that's positive — e.g. ForeFlight's AllLandings minus DayLandingsFullStop/NightLandingsFullStop is exactly the touch-and-go count it never itemizes on its own. Null when there's no mapped landings_total, or its value is fully accounted for by the typed columns. */
  unclassifiedLandings: number | null;
  /** True when simulator_time > 0 but no device type could be determined — this row cannot be confirmed until the pilot picks one. */
  needsSimulatorDeviceType: boolean;
};

export type RejectedRow = {
  rowNumber: number;
  raw: string;
  reason: string;
};

export type ParseResult = {
  format: ImportFormat;
  /** The header cells actually used for mapping (post section-detection for ForeFlight). */
  header: string[];
  valid: ParsedRow[];
  rejected: RejectedRow[];
};

/**
 * The insert payload for a `source = 'import'` logbook_entries row.
 * app/(app)/logbook/db.ts's LogbookEntryInsert (the type every OTHER
 * write path in this product uses) deliberately has no import-lineage
 * fields — db.ts is outside this feature's edit scope, and adding them
 * there is not this feature's call to make. This local extension exists
 * instead of widening that shared type, and is only ever constructed in
 * confirmImport (app/(app)/logbook/import/actions.ts) — the one place
 * import lineage columns are set, mirroring how draftPayloadForLeg is
 * the one place trip lineage is set.
 */
export type ImportEntryInsert = LogbookEntryFlightFields & {
  account_id: string;
  airman_user_id: string;
  source: "import";
  import_batch_id: string;
  source_file_id: string;
  source_row_number: number;
  row_fingerprint: string;
  source_row: Record<string, string>;
};

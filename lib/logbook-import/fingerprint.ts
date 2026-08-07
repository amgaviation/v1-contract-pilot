import { createHash } from "crypto";
import type { LogbookEntryFlightFields } from "@/app/(app)/logbook/db";

/**
 * The dedup key for `source = 'import'` rows (pilot.logbook_entries.
 * row_fingerprint, unique per account per the partial index in
 * 20260805220000_phase6_logbook.sql). Computed server-side in
 * confirmImport — never accepted from the client — so a re-import of the
 * exact same file always produces the exact same fingerprints and lands
 * on the same unique-index violation the DB already enforces.
 *
 * DELIBERATE CHOICE OF INPUTS, and why each one is (or isn't) here:
 *
 *   entry_date, aircraft_ident, from_icao, to_icao, total_time, role
 *     — together these are "the same flight" for re-import purposes: the
 *     five-tuple a pilot would use to recognize a flight in their own
 *     logbook at a glance. All five are also fields a source format
 *     reliably re-exports byte-identically across repeated exports of
 *     the same underlying flight.
 *
 *   NOT remarks/night/instrument/landings/approaches/holds — a source app
 *     lets a pilot edit these AFTER the flight (e.g. reclassifying an
 *     approach, fixing a landing count) and a later re-export should
 *     still be recognized as "the same flight, corrected," not create a
 *     new row. Fingerprinting on the full row would defeat re-import
 *     dedup for exactly the pilots who most need it — the ones going back
 *     to fix their records.
 *
 *   NOT source_row_number / file order — a pilot who reorders or edits
 *     their external logbook before re-exporting must not get every row
 *     re-imported as "new" just because it now sits at a different line
 *     number.
 *
 * KNOWN LIMITATION, stated rather than hidden: two GENUINELY DIFFERENT
 * flights that happen to share date + aircraft + route + total time +
 * role (e.g. two identical pattern-work hops flown back to back) hash to
 * the same fingerprint and the second is skipped as a duplicate on
 * import. This is an accepted trade — the dominant failure mode this
 * dedup exists to prevent is "re-importing the same file doubles every
 * flight in the logbook," which is common and silent, versus this
 * collision, which is rare and — because the row still landed once, not
 * zero times — recoverable: the pilot adds the missed second flight by
 * hand (source='manual'), which never touches import dedup at all (see
 * that partial index's WHERE clause).
 *
 * account_id is NOT part of the hash input: the uniqueness constraint is
 * already scoped to (account_id, row_fingerprint), so folding account_id
 * into the hash would be redundant, not additional safety.
 */
export function rowFingerprint(
  values: Pick<LogbookEntryFlightFields, "entry_date" | "aircraft_ident" | "from_icao" | "to_icao" | "total_time" | "role">
): string {
  const parts = [
    values.entry_date,
    (values.aircraft_ident ?? "").trim().toUpperCase(),
    (values.from_icao ?? "").trim().toUpperCase(),
    (values.to_icao ?? "").trim().toUpperCase(),
    Number(values.total_time).toFixed(1),
    values.role,
  ];
  return createHash("sha256").update(parts.join("|")).digest("hex");
}

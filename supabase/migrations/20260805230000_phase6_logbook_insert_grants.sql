-- Phase 6 corrective — column-scope the logbook INSERT grants.
--
-- 20260805220000 scoped UPDATE correctly and then granted INSERT
-- table-wide:
--
--   grant select, insert, delete on ... to authenticated;
--
-- so every column was insertable, including `id`, `created_at`,
-- `updated_at`, and the whole provenance set the UPDATE grant had just
-- gone to the trouble of withholding. That migration's own comment claims
-- provenance "isn't reachable at the DB layer" — true of UPDATE, false of
-- INSERT, which made the comment the most dangerous kind of wrong: the
-- kind a reader trusts.
--
-- It is reachable from a browser, not just a script. The publishable key
-- and project URL ship in the client bundle by design and the session JWT
-- is in cookies, so PostgREST is directly addressable as `authenticated`.
-- A single POST could write a row with source='trip', a real leg
-- reference, hours that were never flown, and a BACKDATED created_at.
--
-- created_at is the sharp edge. The flight fields are the pilot's own
-- assertion either way — a pilot who wants to log hours they didn't fly
-- can simply use source='manual', and that is their own legal exposure,
-- not something this schema can or should prevent. But created_at is OUR
-- record of when the entry reached us, and it is exactly the fact an
-- enforcement action or insurance dispute would test a logbook against.
-- A record whose own audit timestamp is client-supplied cannot corroborate
-- anything.
--
-- Phase 5 already did this same revoke-then-regrant for the Phase 3
-- tables (20260805090000, "the bare INSERT grant"), for the same reason.
-- This brings Phase 6 back in line with that idiom.

revoke insert on pilot.logbook_entries, pilot.logbook_import_batches,
  pilot.logbook_source_files from authenticated;

-- The flight record a pilot may create. account_id is included because
-- RLS's WITH CHECK is what constrains its VALUE to the caller's own
-- tenant — withholding the column entirely would make insert impossible.
-- `id`, `created_at` and `updated_at` are withheld: the defaults and the
-- updated_at trigger own them.
--
-- The import lineage columns (import_batch_id, source_file_id,
-- source_row_number, row_fingerprint, source_row) and foreflight_sync_id
-- are deliberately ABSENT. No app code inserts them — CSV import and the
-- ForeFlight sync are a later pass — and the table's CHECK requires them
-- non-null when source='import'/'foreflight_sync', so omitting them here
-- means `authenticated` simply cannot mint a row that CLAIMS to have come
-- from an import. When that pass lands it decides deliberately whether it
-- runs as service_role (preferred: an import is a server-side batch) or
-- needs these columns granted. Deny-by-default is the right posture for a
-- provenance claim.
grant insert (
  account_id, source, trip_id, trip_leg_id,
  entry_date, aircraft_ident, aircraft_type, from_icao, to_icao, role,
  total_time, pic_time, sic_time, solo_time, cross_country_time, night_time,
  instrument_actual_time, instrument_simulated_time, flight_instructor_time,
  dual_received_time, simulator_time, simulator_device_type,
  day_landings_full_stop, day_landings_touch_go, night_takeoffs,
  night_landings_full_stop, night_landings_touch_go, approaches_count,
  approach_type, holds, remarks
) on pilot.logbook_entries to authenticated;

-- Import lineage tables: same treatment. Nothing in the app writes these
-- yet; the grant exists so a future import surface has a shape to narrow
-- rather than a table-wide grant to discover.
grant insert (
  account_id, source_format, status, total_rows, imported_rows,
  rejected_rows, error_summary
) on pilot.logbook_import_batches to authenticated;

grant insert (
  account_id, import_batch_id, file_name, file_path, row_count
) on pilot.logbook_source_files to authenticated;

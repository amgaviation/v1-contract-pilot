-- Phase 6 continuation — grant the import-lineage columns on
-- logbook_entries so the CSV import pass (app/(app)/logbook/import) can
-- actually insert a source='import' row as `authenticated`.
--
-- THE GAP: 20260805230000's header said, correctly at the time, that
-- import_batch_id/source_file_id/source_row_number/row_fingerprint/
-- source_row were "deliberately ABSENT" from the INSERT grant because "no
-- app code inserts them — CSV import ... [is] a later pass" and left the
-- choice open: "When that pass lands it decides deliberately whether it
-- runs as service_role (preferred: an import is a server-side batch) or
-- needs these columns granted." That pass has now landed.
--
-- WHY GRANTED COLUMNS, NOT service_role: every other write in this
-- product — including the other provenance-sensitive path, trip-draft
-- confirm (confirmLegDraft/confirmTripDrafts) — runs as the signed-in
-- pilot through RLS, not as a server-side bypass identity. Introducing
-- service_role here would be the first write path in the app that
-- skips RLS, which is a bigger, separately-reviewable change than this
-- import feature needs: RLS's `account_id in (select
-- pilot.current_account_ids())` and `airman_user_id = auth.uid()` (the
-- INSERT policy from 20260807050000) already say exactly what an import
-- is allowed to write, and column-scoped GRANTs are how every other
-- table in this schema expresses "this column, but not that one" within
-- that same authenticated identity. Extending the existing idiom keeps
-- import inside the same trust boundary as every other user-initiated
-- write instead of carving out a new one.
--
-- WHAT IS STILL WITHHELD: `id`, `created_at`, `updated_at` remain
-- ungranted (the same three every table withholds), and
-- foreflight_sync_id stays ungranted — the ForeFlight OAuth sync is a
-- different, not-yet-built code path (see 20260805220000's header on why
-- it has its own dedup column), and granting it here would let CSV
-- import (or a crafted POST) assert a row came from that sync when it
-- did not.
--
-- source_row_number's CHECK (>= 1) and row_fingerprint/source_row's
-- required-together-with-import CHECK are unchanged by this migration —
-- they already exist from 20260805220000 and continue to do their job
-- regardless of what authenticated is allowed to insert; this migration
-- only widens WHAT can be sent, never what is accepted.

revoke insert on pilot.logbook_entries from authenticated;

grant insert (
  account_id, source, trip_id, trip_leg_id, airman_user_id,
  import_batch_id, source_file_id, source_row_number, row_fingerprint, source_row,
  entry_date, aircraft_ident, aircraft_type, from_icao, to_icao, role,
  total_time, pic_time, sic_time, solo_time, cross_country_time, night_time,
  instrument_actual_time, instrument_simulated_time, flight_instructor_time,
  dual_received_time, simulator_time, simulator_device_type,
  day_landings_full_stop, day_landings_touch_go, night_takeoffs,
  night_landings_full_stop, night_landings_touch_go, approaches_count,
  approach_type, holds, remarks
) on pilot.logbook_entries to authenticated;

-- RLS is unchanged — the INSERT policy from 20260807050000 already
-- constrains account_id and airman_user_id for every row this grant now
-- lets an import write; no new statement is needed here for
-- scripts/tenancy-verify.mjs's sweep to stay green (same reasoning
-- 20260807050000's footer gives for why it needed none either).

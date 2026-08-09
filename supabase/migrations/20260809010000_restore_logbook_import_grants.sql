-- Restore the five import-provenance INSERT grants that two later
-- migrations silently dropped. THE LOGBOOK CSV IMPORT CANNOT WRITE A
-- SINGLE ROW WITHOUT THIS.
--
-- WHAT HAPPENED. 20260807090000 exists for exactly one purpose: to add
-- import_batch_id, source_file_id, source_row_number, row_fingerprint and
-- source_row to `authenticated`'s INSERT grant on pilot.logbook_entries,
-- so confirmImport can write the lineage columns that make an imported
-- row traceable back to the file it came from.
--
-- Column-scoped grants in Postgres are not additive across statements the
-- way a naive reading suggests: `revoke insert on <table> from <role>`
-- drops EVERY column-level INSERT privilege at once, and the `grant
-- insert (col, col, ...)` that follows re-establishes exactly the columns
-- listed and nothing else. Both 20260807120000 and 20260807140000 use
-- that revoke-then-regrant idiom to add a new column to the list — the
-- correct idiom — but each of them re-listed the flight-data columns and
-- omitted the five provenance ones. The second revoke was applied to a
-- state the first had already narrowed, so the loss compounded silently
-- rather than being visible as a diff against the immediately preceding
-- migration.
--
-- The result, verified against a database with every migration applied in
-- filename order:
--
--   select count(*) from information_schema.column_privileges
--    where table_schema='pilot' and table_name='logbook_entries'
--      and grantee='authenticated' and privilege_type='INSERT'
--      and column_name in ('import_batch_id','source_file_id',
--                          'source_row_number','row_fingerprint','source_row');
--   -- 0
--
-- Zero of five. Every confirmImport call would have failed with SQLSTATE
-- 42501 (insufficient_privilege) on the first chunk, so the entire CSV
-- import feature — ForeFlight, LogTen and the generic mapper alike — was
-- non-functional from 20260807120000 onward.
--
-- WHY NOTHING CAUGHT IT. The migration chain replays clean, because
-- nothing about the sequence is invalid SQL. tenancy:verify's 42
-- assertions never insert into logbook_entries as `authenticated`.
-- foreflight-import:verify is a parser test with no database at all. And
-- the adversarial review that examined 20260807090000 confirmed it
-- granted "exactly those five columns and nothing else" — which was true
-- when it was written, and stopped being true two migrations later. A
-- grant is not a schema object you can look at in isolation; it is the
-- accumulated result of every statement that ever touched it.
--
-- THE FIX is deliberately the full, explicit list rather than five
-- additive `grant insert (col)` statements. An additive grant would work
-- today, but it would leave the same trap armed: the next migration that
-- needs to add a column will copy the revoke-then-regrant idiom from the
-- migration above it, and re-lose whatever that one happened to omit.
-- One authoritative list, in one place, is the only shape where "what can
-- authenticated insert?" has a single readable answer.
--
-- The UPDATE grant is deliberately NOT touched here. The provenance
-- columns are INSERT-only by design (20260805230000's header, restated in
-- 20260807050000): rewriting which file or batch an existing entry came
-- from is not an edit a pilot legitimately makes, and withholding it at
-- the database layer is what makes that true rather than merely
-- discouraged. 20260807140000's UPDATE list is already correct.

revoke insert on pilot.logbook_entries from authenticated;

grant insert (
  -- Tenancy + provenance. account_id is constrained by RLS's WITH CHECK,
  -- not by withholding the column. airman_user_id likewise — the INSERT
  -- policy pins it to auth.uid() (20260807050000).
  account_id, source, trip_id, trip_leg_id, airman_user_id,
  -- Import lineage — the five columns 20260807090000 added and
  -- 20260807120000 / 20260807140000 dropped. This is the whole point of
  -- this migration.
  import_batch_id, source_file_id, source_row_number, row_fingerprint, source_row,
  -- Flight data, matching 20260807140000's list exactly.
  entry_date, aircraft_ident, aircraft_type, from_icao, to_icao, role,
  total_time, pic_time, sic_time, solo_time, cross_country_time, night_time,
  instrument_actual_time, instrument_simulated_time, flight_instructor_time,
  dual_received_time, simulator_time, simulator_device_type,
  day_takeoffs, day_landings_full_stop, day_landings_touch_go, night_takeoffs,
  night_landings_full_stop, night_landings_touch_go, approaches_count,
  approach_type, approach_condition, courses_intercepted_tracked, holds,
  view_limiting_pilot_name, remarks
) on pilot.logbook_entries to authenticated;

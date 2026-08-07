-- Logbook import integrity — three defense-in-depth fixes for defects a
-- live-Postgres adversarial review confirmed against the CSV import
-- feature (app/(app)/logbook/import). Each one mirrors a check the server
-- action (actions.ts) now also enforces before a row ever reaches here —
-- same "friendly rejection in the app, hard boundary in the database"
-- posture as the rest of this schema (see validateRow's own comment).
--
-- ---------------------------------------------------------------------------
-- 1. Cross-field time sanity on logbook_entries.
-- ---------------------------------------------------------------------------
-- Every time column was bounded individually (>= 0, <= 999.9 by the
-- numeric(4,1) width) but never against total_time. The reviewer inserted
-- a source='import' row with total_time = 0.5, night_time = 999.0 and it
-- passed cleanly — a physical impossibility (you cannot log more night
-- time than the flight lasted) and a direct FAR 61.57(b) misstatement.
--
-- What IS encoded, and why each is true without exception:
--   night_time, cross_country_time, instrument_actual_time,
--   instrument_simulated_time, solo_time — each is a PORTION of the same
--   flight total_time measures. A portion cannot exceed the whole. There
--   is no logging rule anywhere in 14 CFR 61.51 that lets a pilot log more
--   of any of these than the flight actually lasted.
--
-- What is DELIBERATELY NOT encoded, and why:
--   pic_time + sic_time <= total_time — checked against the current text
--   of 14 CFR 61.51(e) at ecfr.gov (2026-08-07) before writing this. Under
--   61.51(e)(1)(i) a rated pilot logs PIC time for any period they are
--   "the sole manipulator of the controls of an aircraft for which the
--   pilot is rated," REGARDLESS of who is formally acting as PIC for that
--   flight under the operator's ops specs. A type-rated pilot occupying
--   the SIC seat on a two-pilot-crew aircraft, hand-flying a leg, logs
--   PIC time for that leg under (e)(1)(i) while simultaneously logging SIC
--   time for the same clock period as the crewmember filling the
--   required second-in-command position (61.51(f) covers SIC logging).
--   This is a normal, legitimate, well-known professional-pilot logbook
--   pattern (turbine/multi-pilot ops) — NOT a data-entry error. A row with
--   total_time = 1.0, pic_time = 1.0, sic_time = 1.0 is a real flight, not
--   a violation. Summing pic_time + sic_time and bounding it by
--   total_time would reject that legitimate row, so it is not encoded
--   here or in the server action. (The reviewer's crafted-payload repro —
--   total_time = 1.0, pic_time = 900.0, sic_time = 900.0 — is still
--   caught: pic_time and sic_time are each individually bounded by
--   total_time below, which 900.0 > 1.0 fails on its own.)
--
--   ALSO now bounding pic_time and sic_time individually by total_time
--   (each cannot exceed the whole flight on its own, same "portion of the
--   whole" logic as the other five) — this is what actually closes the
--   reviewer's second repro without touching the sum question above.
--
-- NULL handling: `NULL <= total_time` evaluates to NULL, and a CHECK
-- passes on NULL (Postgres only rejects a CHECK that evaluates to FALSE).
-- That is the correct behavior here, not an oversight: every one of these
-- columns is nullable (a pilot/import row that never mentions night time
-- at all is not asserting "zero night time", it's asserting "not
-- recorded"), so `col is null or col <= total_time` is the deliberate
-- shape — NULL stays unconstrained, a recorded value is bounded.
alter table pilot.logbook_entries
  add constraint logbook_entries_night_le_total
    check (night_time is null or night_time <= total_time);
alter table pilot.logbook_entries
  add constraint logbook_entries_xc_le_total
    check (cross_country_time is null or cross_country_time <= total_time);
alter table pilot.logbook_entries
  add constraint logbook_entries_instrument_actual_le_total
    check (instrument_actual_time is null or instrument_actual_time <= total_time);
alter table pilot.logbook_entries
  add constraint logbook_entries_instrument_simulated_le_total
    check (instrument_simulated_time is null or instrument_simulated_time <= total_time);
alter table pilot.logbook_entries
  add constraint logbook_entries_solo_le_total
    check (solo_time is null or solo_time <= total_time);
alter table pilot.logbook_entries
  add constraint logbook_entries_pic_le_total
    check (pic_time is null or pic_time <= total_time);
alter table pilot.logbook_entries
  add constraint logbook_entries_sic_le_total
    check (sic_time is null or sic_time <= total_time);

-- ---------------------------------------------------------------------------
-- 2. An import row can never carry trip lineage.
-- ---------------------------------------------------------------------------
-- trip_id/trip_leg_id are granted on INSERT to `authenticated` (see
-- 20260807090000's header — the grant exists so the confirmed-draft flow
-- can write them) but the CSV import action never intends to set them and,
-- before this migration, nothing stopped a crafted POST from setting them
-- anyway (the reviewer confirmed a source='import' row with a non-null
-- trip_id inserts cleanly). The composite FKs already block a cross-
-- tenant trip_id/trip_leg_id, so the self-inflicted version of this bug
-- is the sharp one: a crafted import row claiming a real trip_leg_id
-- permanently occupies logbook_entries_trip_leg_uniq (THE anti-double-
-- confirm mechanism from 20260805220000) for that leg, and the entry's
-- provenance columns are withheld from UPDATE (same migration's GRANTS
-- section), so it can never be repaired — only deleted and re-confirmed,
-- which a pilot has no way to know they need to do. actions.ts now also
-- explicitly nulls both fields on every import insert rather than
-- trusting the client payload's shape (see its comment); this constraint
-- is the hard boundary behind that in case the app-layer allowlist is
-- ever bypassed or a future edit reintroduces a spread.
alter table pilot.logbook_entries
  add constraint logbook_entries_import_no_trip_lineage
    check (source <> 'import' or (trip_id is null and trip_leg_id is null));

-- ---------------------------------------------------------------------------
-- 3. logbook_import_batches gets a 'partial' status.
-- ---------------------------------------------------------------------------
-- Chunked inserts in actions.ts are separate round-trips, not one
-- transaction (see that file's comment on why: chunk size is bounded by
-- PostgREST/connection payload limits, and this app has no service-role
-- path to wrap them in a single server-side transaction — see
-- lib/supabase/service-role.ts's one-entry-point rule). Before this
-- migration, any failure after the first chunk landed real rows in
-- logbook_entries while the batch was marked 'failed' and the pilot was
-- told nothing had been imported — a lie on top of committed data, and
-- the actual harm the reviewer flagged. 'partial' lets the batch record
-- what actually happened (some rows in, confirm didn't finish) instead of
-- forcing a choice between two dishonest states ('completed' when it
-- didn't, or 'failed' when it wasn't nothing). A TRUE zero-rows failure
-- still uses 'failed', and actions.ts deletes that batch/source-file pair
-- outright in that case, so nothing dangles either way — see actions.ts's
-- fail() for both branches.
alter table pilot.logbook_import_batches
  drop constraint logbook_import_batches_status_check;
alter table pilot.logbook_import_batches
  add constraint logbook_import_batches_status_check
    check (status in ('pending', 'processing', 'completed', 'partial', 'failed'));

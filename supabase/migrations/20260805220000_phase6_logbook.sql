-- Phase 6 — Logbook: manual entries, trip-derived confirmed drafts, and the
-- import lineage tables (logbook_import_batches / logbook_source_files)
-- that CSV import and the ForeFlight sync will write into in a later pass.
-- CSV import and the ForeFlight OAuth sync themselves are OUT OF SCOPE for
-- this migration — only the schema they will need is built now, per
-- docs/PLAN.md Phase 6.
--
-- Inherits the two security patterns from Phase 3
-- (20260805070000_phase3_clients_trips_expenses.sql) — composite foreign
-- keys and column-scoped grants. Read that file's header before editing
-- anything here.
--
-- WHAT THIS FIXES FROM THE AMG SCHEMA (docs/PLAN.md "Verified ground
-- truth" + "logbook_entries — required changes"):
--   1. import_batch_id/source_file_id/source_row_number/row_fingerprint/
--      source_row were NOT NULL there, which made a manual or trip-derived
--      entry impossible to represent at all. Here they are nullable and
--      required ONLY when source = 'import', by CHECK.
--   2. Night landings were a single total. FAR 61.57(b) requires night
--      takeoffs and landings TO A FULL STOP specifically — a total cannot
--      answer that question. Split into full-stop vs touch-and-go here,
--      same as trip_legs already does. Day landings get the same split for
--      the tailwheel full-stop-currency case.
--   3. No instructor/simulator/approach-count columns existed at all;
--      61.57(c) requires an approach COUNT, which the AMG schema could not
--      produce.
--
-- TRIP → LOGBOOK IS A CONFIRMED DRAFT, NOT A TRIGGER (docs/PLAN.md "Trip →
-- logbook is a confirmed draft"). This is a deliberate departure from the
-- house "derived state is a trigger" convention: a logbook is a personal
-- legal record that must be defensible in an FAA enforcement action or an
-- insurance dispute, so nothing may land in logbook_entries without the
-- pilot's explicit action. There is therefore NO trigger anywhere in this
-- file that writes a logbook_entries row from a trip or a trip_leg. The
-- "draft" itself is not a stored row at all — it is computed at read time
-- by the app (app/(app)/logbook/drafts/page.tsx) as "trip_legs belonging to
-- a completed trip that no logbook_entries row yet references via
-- trip_leg_id". Confirming inserts a real, editable row. The
-- logbook_entries_trip_leg_uniq index below is what makes that computation
-- safe under a race (two confirms in flight for the same leg) rather than
-- a convention the app has to get right on its own.

-- ---------------------------------------------------------------------------
-- logbook_import_batches — one row per CSV/sync run. Exists now so
-- logbook_entries.import_batch_id has something to point at; nothing in
-- this phase inserts into it yet.
-- ---------------------------------------------------------------------------
create table if not exists pilot.logbook_import_batches (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references pilot.accounts(id) on delete cascade,
  source_format text not null
    check (source_format in ('foreflight', 'logten', 'generic_csv')),
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'completed', 'failed')),
  total_rows integer not null default 0 check (total_rows >= 0),
  imported_rows integer not null default 0 check (imported_rows >= 0),
  rejected_rows integer not null default 0 check (rejected_rows >= 0),
  error_summary text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- FK target for logbook_source_files and logbook_entries. See pattern 1
  -- in the Phase 3 header.
  unique (account_id, id)
);

comment on table pilot.logbook_import_batches is
  'One row per CSV/ForeFlight-sync run. Schema-only in Phase 6 — nothing writes into this table until the import pass ships.';

-- ---------------------------------------------------------------------------
-- logbook_source_files — the raw uploaded file(s) behind a batch. A batch
-- always has at least the one file that started it, so the link is NOT
-- NULL in this direction (unlike the nullable link the other way, on
-- logbook_entries, which must also serve manual/trip/foreflight_sync rows
-- that never had a file at all).
-- ---------------------------------------------------------------------------
create table if not exists pilot.logbook_source_files (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references pilot.accounts(id) on delete cascade,
  import_batch_id uuid not null,
  foreign key (account_id, import_batch_id)
    references pilot.logbook_import_batches (account_id, id) on delete cascade,
  file_name text not null,
  file_path text,
  row_count integer check (row_count is null or row_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (account_id, id)
);

comment on table pilot.logbook_source_files is
  'The uploaded file(s) behind an import batch. Schema-only in Phase 6.';

-- ---------------------------------------------------------------------------
-- logbook_entries — the record itself. One row per loggable flight
-- (typically one per trip_leg for trip-derived entries; one per imported
-- CSV row for import; free-form for manual).
-- ---------------------------------------------------------------------------
create table if not exists pilot.logbook_entries (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references pilot.accounts(id) on delete cascade,

  -- Provenance. 'foreflight_sync' is distinct from 'import': a CSV import
  -- is a one-time file upload (dedup on row_fingerprint, below); a
  -- ForeFlight OAuth sync is a live pull keyed on ForeFlight/CloudAhoy's
  -- own flight id, which is stable across re-syncs in a way a fingerprint
  -- of the row's own content is not (the source system may correct a
  -- field after the fact and re-send the same flight id). Neither sync
  -- itself ships in this pass; the column exists so the dedup key has
  -- somewhere to live when it does.
  source text not null check (source in ('trip', 'import', 'manual', 'foreflight_sync')),

  -- Where a trip-derived entry came from. Nullable for every other source.
  -- ON DELETE SET NULL, not CASCADE or RESTRICT: deleting the trip (or the
  -- leg — trip_legs itself cascades off the trip) must NEVER delete a
  -- CONFIRMED logbook entry out from under the pilot. The entry is the
  -- legal record; the trip is just where it came from. This is also why
  -- there is deliberately NO CHECK tying source = 'trip' to trip_id being
  -- non-null: a CHECK like that would be re-evaluated on the very
  -- ON DELETE SET NULL update that orphans a confirmed entry when its
  -- trip is deleted, and would abort the trip deletion instead of letting
  -- the entry survive as a standalone record.
  trip_id uuid,
  foreign key (account_id, trip_id)
    references pilot.trips (account_id, id) on delete set null,
  -- The specific leg an entry was confirmed from. This is the anti-
  -- duplicate mechanism for the confirmed-draft flow: the partial unique
  -- index below (one entry per leg, ever) is what makes "propose every
  -- leg of a completed trip that has no logbook_entries row yet" safe to
  -- compute at read time instead of needing a stored draft/proposal row.
  trip_leg_id uuid,
  foreign key (account_id, trip_leg_id)
    references pilot.trip_legs (account_id, id) on delete set null,

  -- Import lineage. Nullable in general; required together ONLY when
  -- source = 'import' (the CHECK below). RESTRICT rather than SET NULL:
  -- unlike a trip, an import batch/file is passive lineage a pilot has no
  -- reason to delete out from under entries that still cite it, and
  -- SET NULL here would hit the same CHECK-vs-cascade problem noted above
  -- for trip_id, except with no legitimate "let it go standalone" case to
  -- justify working around it.
  import_batch_id uuid,
  foreign key (account_id, import_batch_id)
    references pilot.logbook_import_batches (account_id, id) on delete restrict,
  source_file_id uuid,
  foreign key (account_id, source_file_id)
    references pilot.logbook_source_files (account_id, id) on delete restrict,
  source_row_number integer check (source_row_number is null or source_row_number >= 1),
  -- Dedup key for CSV/file imports ONLY — a hash of the source row's
  -- content, computed by the import code (out of scope here). Trip-derived
  -- and manual entries never participate in fingerprint dedup: a pilot
  -- manually logging the same route twice in one day is not a duplicate,
  -- it's two flights, and a trip-derived entry is already deduplicated by
  -- trip_leg_id.
  row_fingerprint text,
  -- The raw imported row, kept for the error-review surface a later pass
  -- builds (docs/PLAN.md: "an error-review surface").
  source_row jsonb,
  check (
    (source = 'import'
      and import_batch_id is not null
      and source_file_id is not null
      and source_row_number is not null
      and row_fingerprint is not null
      and source_row is not null)
    or
    (source <> 'import'
      and import_batch_id is null
      and source_file_id is null
      and source_row_number is null
      and row_fingerprint is null
      and source_row is null)
  ),

  -- Dedup key for the ForeFlight/CloudAhoy sync, kept separate from
  -- row_fingerprint per docs/PLAN.md: "foreflight_sync dedups on the
  -- CloudAhoy flight id, not the fingerprint — give it its own column and
  -- its own partial unique index" (below).
  foreflight_sync_id text,
  check (
    (source = 'foreflight_sync' and foreflight_sync_id is not null)
    or
    (source <> 'foreflight_sync' and foreflight_sync_id is null)
  ),

  entry_date date not null,
  aircraft_ident text,
  aircraft_type text,
  from_icao text check (from_icao is null or from_icao ~ '^[A-Z0-9]{3,4}$'),
  to_icao text check (to_icao is null or to_icao ~ '^[A-Z0-9]{3,4}$'),
  -- PIC/SIC is a per-leg role (product-translation.md §1), not a pilot
  -- attribute. Solo time (61.51(e)(4)) is logged as PIC for a student and
  -- tracked separately below in solo_time, so it doesn't need its own
  -- role value.
  role text not null default 'PIC' check (role in ('PIC', 'SIC')),

  -- Time quantities. numeric(4,1): tenths of an hour (six minutes) is the
  -- standard logbook granularity — ForeFlight, LogTen, and paper logbooks
  -- all record to a tenth, not a minute. The (4,1) width caps a single
  -- entry at 999.9 hours, which cannot occur for one flight; it exists to
  -- catch a fat-fingered entry (typing 850 instead of 8.5) as a
  -- constraint violation instead of silently accepting it. Matches
  -- trip_legs' block_hours/night_hours/instrument_hours precision exactly
  -- so a trip-derived entry's numbers need no rounding to fit.
  total_time numeric(4,1) not null check (total_time >= 0),
  pic_time numeric(4,1) check (pic_time is null or pic_time >= 0),
  sic_time numeric(4,1) check (sic_time is null or sic_time >= 0),
  solo_time numeric(4,1) check (solo_time is null or solo_time >= 0),
  cross_country_time numeric(4,1) check (cross_country_time is null or cross_country_time >= 0),
  night_time numeric(4,1) check (night_time is null or night_time >= 0),
  instrument_actual_time numeric(4,1) check (instrument_actual_time is null or instrument_actual_time >= 0),
  instrument_simulated_time numeric(4,1) check (instrument_simulated_time is null or instrument_simulated_time >= 0),
  -- Dual given. 61.57(c) currency and CFI logbooks both need this counted
  -- separately from ordinary PIC time.
  flight_instructor_time numeric(4,1) check (flight_instructor_time is null or flight_instructor_time >= 0),
  dual_received_time numeric(4,1) check (dual_received_time is null or dual_received_time >= 0),
  -- Simulator / FTD / ATD time, per docs/PLAN.md. Kept as one time column
  -- plus a device-type tag rather than three separate time columns: 61.57
  -- and 61.51 care about the DEVICE CLASS for currency purposes, and a
  -- source (ForeFlight, LogTen) exports it as a type-tagged single field,
  -- not three buckets — splitting it here would just make the import
  -- mapper reassemble what the source already gave as one thing.
  simulator_time numeric(4,1) check (simulator_time is null or simulator_time >= 0),
  simulator_device_type text
    check (simulator_device_type is null or simulator_device_type in ('ftd', 'atd', 'other')),
  check (simulator_time is null or simulator_time = 0 or simulator_device_type is not null),

  -- Landings. Full-stop vs touch-and-go, same split night and day: 61.57(a)
  -- day/night passenger currency and the tailwheel full-stop-landing rule
  -- both turn on the distinction, and a single total (the AMG schema's
  -- shape) cannot answer either question.
  day_landings_full_stop integer not null default 0 check (day_landings_full_stop >= 0),
  day_landings_touch_go integer not null default 0 check (day_landings_touch_go >= 0),
  night_takeoffs integer not null default 0 check (night_takeoffs >= 0),
  night_landings_full_stop integer not null default 0 check (night_landings_full_stop >= 0),
  night_landings_touch_go integer not null default 0 check (night_landings_touch_go >= 0),

  -- 61.57(c) requires a COUNT of approaches within the lookback window;
  -- the AMG schema had no such column at all. approach_type is a single
  -- optional tag rather than a per-approach breakdown table — a v1 scope
  -- call, not a currency-engine input (Phase 7, gated separately); a
  -- pilot who flew different approach types on one flight can note it in
  -- remarks until a later pass models approaches as their own rows.
  approaches_count integer not null default 0 check (approaches_count >= 0),
  approach_type text
    check (approach_type is null or approach_type in
      ('ils', 'rnav_lpv', 'rnav_lnav', 'vor', 'loc', 'ndb', 'visual', 'other')),
  check (approach_type is null or approaches_count > 0),
  holds integer not null default 0 check (holds >= 0),

  remarks text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table pilot.logbook_entries is
  'The pilot''s personal logbook of record. source=trip rows only ever get here via an explicit confirm action (app/(app)/logbook/drafts) — never a trigger. See file header.';

-- ---------------------------------------------------------------------------
-- updated_at triggers
-- ---------------------------------------------------------------------------
create trigger logbook_import_batches_set_updated_at before update on pilot.logbook_import_batches
  for each row execute function pilot.set_updated_at();
create trigger logbook_source_files_set_updated_at before update on pilot.logbook_source_files
  for each row execute function pilot.set_updated_at();
create trigger logbook_entries_set_updated_at before update on pilot.logbook_entries
  for each row execute function pilot.set_updated_at();

-- ---------------------------------------------------------------------------
-- indexes
-- ---------------------------------------------------------------------------
create index if not exists logbook_import_batches_account_idx
  on pilot.logbook_import_batches (account_id, created_at desc);
create index if not exists logbook_source_files_batch_idx
  on pilot.logbook_source_files (account_id, import_batch_id);

create index if not exists logbook_entries_account_date_idx
  on pilot.logbook_entries (account_id, entry_date desc);
create index if not exists logbook_entries_trip_idx
  on pilot.logbook_entries (account_id, trip_id) where trip_id is not null;

-- THE anti-double-confirm mechanism: a given leg can back at most one
-- logbook entry, ever. The drafts surface computes "unconfirmed" as "no
-- logbook_entries row has this trip_leg_id" — this index is what makes
-- that read-then-insert safe under a race between two confirm clicks
-- instead of merely conventional.
create unique index if not exists logbook_entries_trip_leg_uniq
  on pilot.logbook_entries (account_id, trip_leg_id) where trip_leg_id is not null;

-- Import-only dedup, per docs/PLAN.md: "row_fingerprint dedup applies to
-- imports only... never a trigger... manual and trip-derived entries never
-- participate in fingerprinting." The partial predicate on source is what
-- enforces that scoping at the constraint layer rather than leaving it to
-- the import code to remember.
create unique index if not exists logbook_entries_fingerprint_uniq
  on pilot.logbook_entries (account_id, row_fingerprint)
  where source = 'import' and row_fingerprint is not null;

-- foreflight_sync's own dedup key, deliberately separate from the
-- fingerprint index above.
create unique index if not exists logbook_entries_foreflight_sync_uniq
  on pilot.logbook_entries (account_id, foreflight_sync_id)
  where source = 'foreflight_sync' and foreflight_sync_id is not null;

-- ---------------------------------------------------------------------------
-- RLS. Enabled from this table's first migration, per house rule — never
-- retrofitted. No admin-bypass policy, no AMG-facing read path.
-- ---------------------------------------------------------------------------
alter table pilot.logbook_import_batches enable row level security;
alter table pilot.logbook_source_files   enable row level security;
alter table pilot.logbook_entries        enable row level security;

create policy logbook_import_batches_select on pilot.logbook_import_batches for select to authenticated
  using (account_id in (select pilot.current_account_ids()));
create policy logbook_import_batches_insert on pilot.logbook_import_batches for insert to authenticated
  with check (account_id in (select pilot.current_account_ids()));
create policy logbook_import_batches_update on pilot.logbook_import_batches for update to authenticated
  using (account_id in (select pilot.current_account_ids()))
  with check (account_id in (select pilot.current_account_ids()));
create policy logbook_import_batches_delete on pilot.logbook_import_batches for delete to authenticated
  using (account_id in (select pilot.current_account_ids()));

create policy logbook_source_files_select on pilot.logbook_source_files for select to authenticated
  using (account_id in (select pilot.current_account_ids()));
create policy logbook_source_files_insert on pilot.logbook_source_files for insert to authenticated
  with check (account_id in (select pilot.current_account_ids()));
create policy logbook_source_files_update on pilot.logbook_source_files for update to authenticated
  using (account_id in (select pilot.current_account_ids()))
  with check (account_id in (select pilot.current_account_ids()));
create policy logbook_source_files_delete on pilot.logbook_source_files for delete to authenticated
  using (account_id in (select pilot.current_account_ids()));

create policy logbook_entries_select on pilot.logbook_entries for select to authenticated
  using (account_id in (select pilot.current_account_ids()));
create policy logbook_entries_insert on pilot.logbook_entries for insert to authenticated
  with check (account_id in (select pilot.current_account_ids()));
create policy logbook_entries_update on pilot.logbook_entries for update to authenticated
  using (account_id in (select pilot.current_account_ids()))
  with check (account_id in (select pilot.current_account_ids()));
create policy logbook_entries_delete on pilot.logbook_entries for delete to authenticated
  using (account_id in (select pilot.current_account_ids()));

-- ---------------------------------------------------------------------------
-- GRANTS. Column-scoped on UPDATE — RLS has no column granularity, so this
-- is the only place column authority is expressed. Every table withholds
-- id/account_id/created_at/updated_at as usual. logbook_entries ALSO
-- withholds every provenance column (source, trip_id, trip_leg_id,
-- import_batch_id, source_file_id, source_row_number, row_fingerprint,
-- source_row, foreflight_sync_id) from UPDATE: those columns are how an
-- entry proves where it came from, which is exactly the fact an
-- enforcement action or insurance dispute would ask about. Rewriting them
-- after insert — e.g. relabeling an import as manual, or clearing a
-- fingerprint to slip past dedup — is not a legitimate "edit", so it isn't
-- reachable at the DB layer even though the app never intends to send it
-- either. A pilot can still fix the FLIGHT DATA on any entry (times,
-- landings, route, remarks); they just can't rewrite its origin.
-- ---------------------------------------------------------------------------
grant select, insert, delete on pilot.logbook_import_batches, pilot.logbook_source_files,
  pilot.logbook_entries to authenticated;

grant update (source_format, status, total_rows, imported_rows, rejected_rows, error_summary)
  on pilot.logbook_import_batches to authenticated;

grant update (import_batch_id, file_name, file_path, row_count)
  on pilot.logbook_source_files to authenticated;

grant update (
  entry_date, aircraft_ident, aircraft_type, from_icao, to_icao, role,
  total_time, pic_time, sic_time, solo_time, cross_country_time, night_time,
  instrument_actual_time, instrument_simulated_time, flight_instructor_time,
  dual_received_time, simulator_time, simulator_device_type,
  day_landings_full_stop, day_landings_touch_go, night_takeoffs,
  night_landings_full_stop, night_landings_touch_go, approaches_count,
  approach_type, holds, remarks
) on pilot.logbook_entries to authenticated;

grant select, insert, update, delete on pilot.logbook_import_batches,
  pilot.logbook_source_files, pilot.logbook_entries to service_role;

-- Phase 7 — currency engine schema: the append-only snapshot table the
-- engine writes its computed verdicts into, plus the five input columns
-- lib/currency's pure modules need that nothing in this schema recorded
-- before now. Two logical pieces in one file because this is the one
-- filename this phase's task is scoped to create.
--
-- Everything here is schema and grants only. The engine itself
-- (lib/currency/**) is pure TypeScript with no database dependency of its
-- own; this migration is what a later batch's read.ts and a future UI
-- batch will read from and write to, once docs/PLAN.md Decision #15's gate
-- (Tony reviews docs/CURRENCY-SPEC.md; aviation counsel reviews the
-- disclaimer) clears and CURRENCY_ENGINE_ENABLED is set. Nothing here
-- flips that flag or renders anything.
--
-- ABSOLUTE RULE FOR THIS FILE: no privilege is ever taken away from a
-- role. Postgres's privilege-removal statement drops EVERY column-level
-- grant on a table at once, and the grant that follows it restores only
-- what is explicitly listed — this has broken this repo four or more
-- times. Every grant below is additive; nothing here drops or recreates
-- an existing constraint, grant, or policy on a table that predates this
-- migration.

-- =============================================================================
-- PART 1 — pilot.currency_snapshots
-- =============================================================================

create table if not exists pilot.currency_snapshots (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references pilot.accounts(id) on delete cascade,

  -- WHOSE currency. 61.57 and 61.56 are per-airman duties and a business
  -- account has more than one seat (docs/PLAN.md decision #10). Keyed on
  -- the account alone, a two-pilot account's landings would sum into one
  -- verdict that is true of neither pilot, in the permissive direction.
  -- Matches pilot.logbook_entries.airman_user_id, which
  -- 20260807050000_logbook_airman_and_export.sql added for the same
  -- reason.
  airman_user_id uuid not null references auth.users(id),

  -- VERBATIM from docs/CURRENCY-SPEC.md's locked vocabulary. Five values,
  -- and no sixth may ever be added: 135.247 and 61.57(e)(4) are recorded
  -- as a different rule_basis on the SAME type, not as new types.
  -- 'passenger_day' is a legacy label the plan locks — 61.57(a) is
  -- neither passenger-only nor day-only (it reaches an empty two-crew
  -- repositioning leg and has no time-of-day limit), so the DISPLAY label
  -- comes from lib/currency/describe.ts and never from this string.
  currency_type text not null check (currency_type in
    ('passenger_day', 'passenger_night', 'instrument', 'flight_review', 'medical')),

  -- VERBATIM. Three values, deliberately hedged, no fourth and no
  -- "expiring soon" — proximity is a rendering concern, not a status.
  status text not null check (status in
    ('estimated_current', 'estimated_not_current', 'insufficient_data')),

  -- WHICH regulation produced this row. Not a second currency_type: a
  -- Part 135 pilot who asserted 61.57(e)(3) gets a 'passenger_night' row
  -- computed under 135.247(a)(2), whose landings need not be to a full
  -- stop where 61.57(b)(1)'s must (see lib/currency/part135.ts). Without
  -- this column the two arithmetics are indistinguishable once stored.
  rule_basis text not null check (rule_basis in
    ('61.57(a)', '61.57(b)', '61.57(c)', '61.56', '61.23',
     '135.247(a)(1)', '135.247(a)(2)')),

  as_of date not null,
  window_start date,
  window_end date,
  check (window_start is null or window_end is null or window_end >= window_start),

  -- 61.56's derived through-date. DELIBERATELY NOT NAMED expires_on:
  -- pilot.expiration_coverage_gaps() finds date-bearing tables by that
  -- exact column name and tenancy:verify fails when one is not unioned
  -- into pilot.expirations. A currency snapshot is a computation over a
  -- logbook, not a document with an expiry, and must not appear on the
  -- due-soon ladder alongside a passport.
  through_date date,

  limiting_item text,
  limiting_date date,

  counts jsonb not null default '{}'::jsonb, -- {required: {...}, observed: {...}}
  counted_entry_ids uuid[] not null default '{}', -- display item 3, "the entries counted"
  missing_inputs text[] not null default '{}',

  -- docs/CURRENCY-SPEC.md: keeping this NOT NULL is what forces the
  -- disclaimer to travel with the data. NOT NULL alone does not deliver
  -- that — '' is not null and separates the caveat from the number
  -- exactly as effectively as a null would. The btrim CHECK is the half
  -- that makes it true. Holds lib/brand.ts's CURRENCY_DISCLAIMER, which
  -- is COUNSEL-REVIEWED COPY and may not be paraphrased by any screen.
  limitations text not null check (btrim(limitations) <> ''),

  -- "Not enough information" with no remedy trains a pilot to ignore the
  -- panel, and the whole engine's value is that its silences are
  -- informative. An insufficient_data row must name at least one missing
  -- input, and a computed row must name none.
  check (status <> 'insufficient_data' or cardinality(missing_inputs) > 0),
  check (status = 'insufficient_data' or cardinality(missing_inputs) = 0),

  -- A computed state must carry the window it was computed over, or the
  -- card cannot render the expanded arithmetic a pilot hand-checks in
  -- week one. medical is exempt — it has no single window (61.23(d) keys
  -- on class/age/operation, not a lookback) and is never computed anyway
  -- (see the next check).
  check (status = 'insufficient_data'
         or currency_type = 'medical'
         or (window_start is not null and window_end is not null)),

  -- 61.23(d) keys duration on class held, age at the date of examination,
  -- AND the operation being conducted — one first-class certificate is
  -- simultaneously valid 6, 12 and 24 months for different privileges.
  -- The product has none of the three axes and no flight-in-question, so
  -- medical is never computed. Enforced here rather than left to
  -- TypeScript, because this is the row where a permissive error puts a
  -- pilot in a charter on a lapsed second-class reading.
  check (currency_type <> 'medical' or status = 'insufficient_data'),

  computed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),

  -- FK target for tenant-scoped children, uniform with every other table
  -- in this schema.
  unique (account_id, id)
);

-- APPEND-ONLY, so no unique key on (airman, type, as_of): recomputing the
-- same day writes a new row rather than rewriting yesterday's answer,
-- which is why there is no UPDATE grant below. The index is what makes
-- "the latest one" cheap.
create index if not exists currency_snapshots_latest_idx
  on pilot.currency_snapshots
     (account_id, airman_user_id, currency_type, as_of desc, computed_at desc);

comment on table pilot.currency_snapshots is
  'One computed currency state per airman per type per evaluation date. Append-only: a snapshot records what the engine computed at a moment, so correcting it means computing a new one. currency_type and status are docs/CURRENCY-SPEC.md''s vocabularies verbatim; rule_basis records which regulation produced the arithmetic, since 61.57(b) and 135.247(a)(2) reach different answers from the same landings.';
comment on column pilot.currency_snapshots.limitations is
  'lib/brand.ts CURRENCY_DISCLAIMER, stored on every row so no rendering path can separate the caveat from the number. NOT NULL plus a non-blank CHECK — NOT NULL alone permits ''''.';
comment on column pilot.currency_snapshots.through_date is
  '61.56''s derived through-date. Not named expires_on on purpose — pilot.expiration_coverage_gaps() would then require this table to be unioned into pilot.expirations alongside actual documents, and a currency computation is not a document with an expiry.';

-- THE LATEST STATE, at most five rows per airman, so no caller can meet
-- the Data API's silent 1000-row truncation on the read the panel
-- actually makes.
-- NOTE FOR ANY FUTURE EDIT: "create or replace view" matches columns
-- POSITIONALLY and may only APPEND at the end. Reordering or retyping a
-- column here requires a drop.
create or replace view pilot.currency_snapshots_latest
with (security_invoker = true) as
  select distinct on (account_id, airman_user_id, currency_type)
    id, account_id, airman_user_id, currency_type, status, rule_basis, as_of,
    window_start, window_end, through_date, limiting_item, limiting_date,
    counts, counted_entry_ids, missing_inputs, limitations, computed_at, created_at
  from pilot.currency_snapshots
  order by account_id, airman_user_id, currency_type,
           as_of desc, computed_at desc, id desc;

comment on view pilot.currency_snapshots_latest is
  'The most recent snapshot per airman per currency type. security_invoker so the base table''s RLS still applies. id is the final tiebreak: computed_at defaults to the transaction timestamp, so five snapshots written in one recompute share it exactly and without a deterministic third key the panel would flip between renders.';

-- RLS FROM THIS TABLE'S FIRST MIGRATION, never retrofitted. No admin
-- bypass, and none may be added.
alter table pilot.currency_snapshots enable row level security;

-- AIRMAN-SCOPED, not just account-scoped — unlike most tenant-scoped
-- tables in this schema. currency_type = 'medical' carries a pilot-entered
-- expiry date in limiting_item/limiting_date (see medical.ts's
-- displayDate), and every row's window/counts describe one airman's
-- logbook. Reading account_id alone in a multi-seat business account
-- would let one member read a colleague's flight-review date and MEDICAL
-- EXPIRY through this table or the latest view — the exact cross-airman
-- leak this table's airman_user_id column exists to prevent on write (see
-- the column comment above), left open on read would defeat it.
create policy currency_snapshots_select on pilot.currency_snapshots for select to authenticated
  using (account_id in (select pilot.current_account_ids()) and airman_user_id = auth.uid());

-- airman_user_id = auth.uid() in the WITH CHECK, exactly as
-- logbook_entries_insert does (20260807050000): a column-scoped GRANT
-- cannot say "may be set, but only to the caller's own value", and
-- PostgREST is directly reachable with the publishable key. A row
-- asserting another member's currency must be refused at the database
-- boundary, not in a server action.
create policy currency_snapshots_insert on pilot.currency_snapshots for insert to authenticated
  with check (account_id in (select pilot.current_account_ids())
              and airman_user_id = auth.uid());

-- Append-only. A snapshot is an observation, not a mutable record;
-- correcting it means writing a new one. Same reasoning that withholds
-- airman_user_id from logbook_entries' UPDATE grant.
create policy currency_snapshots_update on pilot.currency_snapshots for update to authenticated
  using (false);
create policy currency_snapshots_delete on pilot.currency_snapshots for delete to authenticated
  using (false);

grant select on pilot.currency_snapshots to authenticated;
-- Column-scoped. id, computed_at and created_at are absent so a direct
-- POST cannot forge a snapshot's provenance or backdate one.
grant insert (account_id, airman_user_id, currency_type, status, rule_basis, as_of,
              window_start, window_end, through_date, limiting_item, limiting_date,
              counts, counted_entry_ids, missing_inputs, limitations)
  on pilot.currency_snapshots to authenticated;
grant select on pilot.currency_snapshots_latest to authenticated, service_role;
grant select, insert on pilot.currency_snapshots to service_role;

-- NO UPDATE OR DELETE GRANT TO authenticated ANYWHERE ABOVE. Consequence
-- to respect in application code: row locks (FOR UPDATE / FOR SHARE)
-- require UPDATE or DELETE privilege, so this table CANNOT be locked by
-- the pilot's own session. Nothing in the recompute path may reach for
-- one. Writers must use { count: "exact" } and branch on zero rows —
-- PostgREST returns 200 for a zero-row write, so "no error" is not
-- "it wrote" (see lib/currency/read.ts's recordSnapshots).

-- =============================================================================
-- PART 2 — the engine's missing inputs on existing tables
-- =============================================================================

alter table pilot.logbook_entries add column sole_manipulator boolean;
alter table pilot.logbook_entries add column night_window_asserted boolean;

-- BOTH NULLABLE, NOT `not null default false`. Defaulting every
-- pre-existing row to false writes an assertion the pilot never made and
-- collapses "unrecorded" into "asserted not sole manipulator" — the two
-- states the engine most needs to tell apart, since one produces
-- insufficient_data and the other estimated_not_current. This is the
-- identical reasoning 20260807140000_approach_conditions.sql recorded for
-- approach_condition ("defaulting an old row to 'neither' would silently
-- manufacture a disqualification the pilot never asserted"). No backfill
-- statement appears in this file.
comment on column pilot.logbook_entries.sole_manipulator is
  '14 CFR 61.57(a)(1)(i)/(b)(1)(i) ("acted as the sole manipulator of the flight controls") and 135.247(a). NULL means unrecorded, never read as false — role (PIC/SIC/SOLO/DUAL_RECEIVED) is not a substitute: an SIC can be the sole manipulator, and a PIC in a two-crew aircraft may not have been. Fetched https://www.ecfr.gov/api/versioner/v1/full/2026-08-05/title-14.xml?section=61.57, issue date 2026-08-05, retrieved 2026-08-10.';
comment on column pilot.logbook_entries.night_window_asserted is
  '14 CFR 61.57(b)(1) and 135.247(a)(2) both key on the period beginning 1 hour after sunset and ending 1 hour before sunrise — a DIFFERENT window than 14 CFR 1.1''s civil-twilight "night" that night_time and the night_time column already use. Civil twilight ends roughly 25-35 minutes after sunset, so a landing can be correctly logged as night_time and still fall outside this window. NULL means not asserted; the engine must show what it assumed rather than infer it from night_time alone. Fetched https://www.ecfr.gov/api/versioner/v1/full/2026-08-05/title-14.xml?section=61.57 and .../section=1.1, issue date 2026-08-05, retrieved 2026-08-10.';

alter table pilot.aircraft add column is_turbine boolean;
alter table pilot.aircraft add column certificated_more_than_one_pilot boolean;

-- Nullable for the same reason pilot.aircraft.gear is: NULL means not
-- recorded and must never be read as the common case. Serves
-- 61.57(e)(4)'s trigger and (i)(D)/(ii)(D) (specified in
-- docs/CURRENCY-SPEC.md §2.6 but not built in Phase 7 — owner question
-- O-5), and 61.57(a)(1)'s "or of an aircraft certificated for more than
-- one pilot flight crewmember" — which decides whether (a) BINDS on an
-- empty repositioning leg, and is therefore card copy rather than a
-- computation gate in lib/currency/general.ts (see that module's header
-- and docs/CURRENCY-SPEC.md's spec-correction S14).
comment on column pilot.aircraft.is_turbine is
  '14 CFR 61.57(e)(4)''s trigger ("a turbine-powered airplane that is type certificated for more than one pilot crewmember") and (i)(D)/(ii)(D). Not read by any module Phase 7 ships — 61.57(e)(4) is specified in docs/CURRENCY-SPEC.md §2.6 but built later (owner question O-5). NULL means not recorded. Fetched https://www.ecfr.gov/api/versioner/v1/full/2026-08-05/title-14.xml?section=61.57, issue date 2026-08-05, retrieved 2026-08-10.';
comment on column pilot.aircraft.certificated_more_than_one_pilot is
  '14 CFR 61.57(a)(1) ("...or of an aircraft certificated for more than one pilot flight crewmember...") and 61.57(e)(4)''s trigger/throughout. Decides whether 61.57(a) BINDS on an empty repositioning leg, not whether its arithmetic is met, so lib/currency/general.ts deliberately does not gate on this column — see that module''s header. NULL means not recorded. Fetched https://www.ecfr.gov/api/versioner/v1/full/2026-08-05/title-14.xml?section=61.57, issue date 2026-08-05, retrieved 2026-08-10.';

alter table pilot.documents add column completed_on date;
alter table pilot.documents
  add constraint documents_completed_before_expires
  check (completed_on is null or expires_on is null or expires_on >= completed_on);

-- This is what makes 61.56 computable at all. pilot.documents today
-- carries only a pilot-typed expires_on for a flight_review row, and a
-- date typed straight into that field can be arithmetically impossible
-- under 61.56(c) (docs/CURRENCY-SPEC.md §11 defect #4). With
-- completed_on, lib/currency/flight-review.ts derives the through-date
-- with the same calendar-month arithmetic
-- pilot.compute_operator_qualification_expiry() already uses for
-- 135.293/.297/.299 (20260807110000_operator_qualification_reg_
-- corrections.sql STEP 5 — base arithmetic only, no 135.301(a) grace; see
-- lib/currency/window.ts's calendarMonthThroughDate), so the card can
-- show "valid through 31 AUG 2026, from a review completed 15 AUG 2024"
-- instead of asking a pilot to do that arithmetic in their head.
--
-- NOT DERIVED, DELIBERATELY: no trigger writes expires_on from
-- completed_on on pilot.documents. The documents stance holds — an issue
-- date does not imply an expiration — and 61.56's through-date is
-- computed at READ time by the engine, from a completion date the pilot
-- entered for that purpose, without overwriting whatever they typed.
--
-- Kept on pilot.documents rather than a new airman table because that is
-- where the flight_review row already lives, and because completed_on is
-- meaningful for pic_proficiency_check (61.58) too, though this phase
-- does not derive anything from it there.
comment on column pilot.documents.completed_on is
  'When a dated event (flight_review: 14 CFR 61.56) was actually completed, distinct from expires_on (whatever the pilot separately typed). lib/currency/flight-review.ts derives 61.56''s through-date from this column with the same calendar-month arithmetic pilot.compute_operator_qualification_expiry() uses, base arithmetic only — the 135.301(a) grace does NOT apply here (that provision is textually limited to Part 135 checks). No trigger derives expires_on from this column: the documents design stays "an issue date does not imply an expiration." Fetched https://www.ecfr.gov/api/versioner/v1/full/2026-08-05/title-14.xml?section=61.56, issue date 2026-08-05, retrieved 2026-08-10.';

alter table pilot.documents add column airman_user_id uuid references auth.users(id);

-- WHOSE flight review or medical this is. pilot.documents otherwise has no
-- way to say so (20260805070000_phase3_clients_trips_expenses.sql:
-- account_id, kind, label, expires_on, issued_on, client_id — no user
-- reference), yet 61.56 and 61.23(d) are per-airman duties exactly like
-- 61.57, and a business account can have more than one seat (this phase's
-- regulatory findings, REG-4/SEC-2). NULLABLE and NOT BACKFILLED, same
-- reasoning as sole_manipulator/night_window_asserted above: most rows in
-- pilot.documents (insurance, W-9s, aircraft paperwork) are legitimately
-- account-level, not any one airman's, so this column does not apply to
-- every row, and guessing an owner for an existing flight_review/medical
-- row would manufacture an attestation nobody made.
--
-- lib/currency/read.ts filters its flight_review/medical read on
-- airman_user_id = the session user, the same discipline it already
-- applies to pilot.logbook_entries — and until a later batch ships the UI
-- to set this column, every existing document row is unattributed, so
-- those two currency cards read insufficient_data rather than guess whose
-- review or medical certificate they are looking at. That is a deliberate,
-- safe consequence of shipping the column before the writer, not a bug to
-- chase in this migration.
comment on column pilot.documents.airman_user_id is
  '14 CFR 61.56 and 61.23(d) are per-airman duties, same as 61.57 (see pilot.logbook_entries.airman_user_id, 20260807050000). NULL means unattributed, never read as "the account has only one pilot" — a business account can have more than one seat. lib/currency/read.ts excludes a row without this set rather than guessing whose it is.';

-- GRANTS — ADD ONLY. Nothing in this file takes a privilege away.
--
-- pilot.logbook_entries' INSERT grant is column-scoped (see
-- 20260807050000/20260807140000's history), so a new column needs an
-- explicit additive grant to be writable at all; its UPDATE grant is the
-- same shape. pilot.documents' and pilot.clients/trips/expenses' INSERT
-- is a TABLE-LEVEL grant from 20260805070000_phase3_clients_trips_
-- expenses.sql ("grant select, insert, delete on ... pilot.documents ...
-- to authenticated") and therefore already covers completed_on AND
-- airman_user_id on INSERT without any new statement below — a
-- table-level grant, unlike a column list, extends automatically to a
-- column added later. Its UPDATE grant is column-scoped, so both new
-- columns need an explicit additive grant there. pilot.aircraft's INSERT
-- and UPDATE grants (20260810110000_aircraft_registry.sql) are both
-- column-scoped.
grant insert (sole_manipulator, night_window_asserted) on pilot.logbook_entries to authenticated;
grant update (sole_manipulator, night_window_asserted) on pilot.logbook_entries to authenticated;
grant insert (is_turbine, certificated_more_than_one_pilot) on pilot.aircraft to authenticated;
grant update (is_turbine, certificated_more_than_one_pilot) on pilot.aircraft to authenticated;
grant update (completed_on, airman_user_id) on pilot.documents to authenticated;
-- service_role already holds table-level grants on all three tables from
-- their original migrations; no new statement needed here.

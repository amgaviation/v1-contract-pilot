-- Operator-qualification tracking — a Part 135 contract pilot must be
-- qualified under THAT OPERATOR'S certificate, not merely typed and
-- current personally. Nothing in this product tracked that until now.
--
-- REGULATIONS RELIED ON (verified against the current eCFR text via the
-- Cornell LII mirror, retrieved 2026-08-07 — eCFR itself blocked this
-- session's fetcher with a bot-detection redirect; re-verify paragraph
-- letters before amending this file, regs change):
--
--   135.293(a) written/oral test — "since the beginning of the 12th
--     calendar month before that service, that pilot has passed a
--     written or oral test."
--   135.293(b) competency check — same 12-calendar-month window, same
--     paragraph structure, a different event (a check, not a test).
--   135.297(a) instrument proficiency check — "since the beginning of
--     the 6th calendar month before that service, that pilot has passed
--     an instrument proficiency check."
--   135.299(a) line check — "since the beginning of the 12th calendar
--     month before that service, that pilot has passed a flight check in
--     ONE OF THE TYPES of aircraft" the pilot is to fly — type-specific,
--     unlike .293 and .297.
--   135.301(a) — "If a crewmember who is required to take a test or a
--     flight check under this part, completes the test or flight check
--     in the calendar month before or after the calendar month in which
--     it is required, that crewmember is considered to have completed
--     the test or check in the calendar month in which it is required."
--     PART 135 ONLY. Permissive (extends validity), never applied here to
--     shrink it. Does NOT reach 61.56 (flight review) or 61.57
--     (recency/IFR currency) — those are personal-certificate currency,
--     a different table (pilot.documents, kind='flight_review') with no
--     month-shift logic of any kind, so there is nothing here for .301 to
--     reach even by accident. See the DERIVATION section below.
--
--   120.105 (drug & alcohol testing program) and 111.105 (PRD) bind the
--   OPERATOR / reviewing entity, not the pilot personally. They are
--   modelled as STATUS the pilot was told and records — never a
--   determination this product computes, verifies, or vouches for. See
--   the requirement CHECK and the column comment below.
--
-- CALENDAR-MONTH ARITHMETIC, never day counts. Verified against the two
-- worked examples in the brief:
--   135.297 IPC completed 15 JAN 2026 → valid through 31 JUL 2026 (end of
--     the 6th calendar month out), NOT 14 JUL (day-count math would give
--     that and is wrong).
--   135.293 completed 3 MAR 2026 → valid through 31 MAR 2027 (end of the
--     12th calendar month out).
-- General formula for an N-calendar-month window, completion in month M:
--   valid through the LAST DAY of month (M + N) — i.e. the check
--   satisfies the requirement all the way through the Nth full calendar
--   month after the one it was done in, not just N months out from the
--   exact day. In SQL, with base_month = date_trunc('month', completed_on):
--     expires_on = (base_month + ((N+1) || ' months')::interval
--                   - interval '1 day')::date
--   (N+1 months forward from the 1st, then back one day, lands on the
--   last day of month M+N — NOT date_trunc(...) + N*interval '30 days',
--   which the brief explicitly forbids and which silently drifts wrong
--   across months of different lengths and leap Februaries.)
--
-- THE NAMING HAZARD THIS MIGRATION IS CAREFUL ABOUT: pilot.
-- expiration_coverage_gaps() (20260805070000) finds date-bearing tables
-- by looking for a column literally named `expires_on`. This table's
-- expiry column is named `expires_on` for that reason, and it is unioned
-- into pilot.expirations in THIS SAME migration — the gap function would
-- otherwise never fire and this table would silently sit outside the
-- reminder ladder, which is the exact FlightDeptPro failure that engine
-- exists to prevent.
--
-- SCHEMA DECISION: no separate `operators` table. A client IS the operator
-- for v1 (docs/PLAN.md forbids the marketplace-primitive direction a
-- standalone operators table would imply) — `client_id` is the operator.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- pilot.operator_qualifications
-- ---------------------------------------------------------------------------
create table if not exists pilot.operator_qualifications (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references pilot.accounts(id) on delete cascade,
  -- The operator this qualification is held under. NOT NULL: an operator
  -- qualification with no operator is a contradiction in terms — unlike
  -- pilot.documents.client_id (nullable; a passport isn't held "for" any
  -- one client), every row here exists BECAUSE of a specific client/
  -- operator relationship.
  client_id uuid not null,
  foreign key (account_id, client_id) references pilot.clients (account_id, id) on delete cascade,
  requirement text not null
    check (requirement in (
      'basic_indoc', 'initial_training', 'recurrent_training',
      'competency_check_135_293', 'ipc_135_297', 'line_check_135_299',
      'drug_alcohol_program_120', 'prd_consent_111', 'insurance_approval',
      'company_manuals', 'other'
    )),
  completed_on date,
  status text not null default 'not_started'
    check (status in ('not_started', 'in_progress', 'current', 'lapsed', 'n_a')),
  -- LOAD-BEARING NAME — see the header. DERIVED (not freely pilot-typed)
  -- for the three Part 135 recurring checks; see the trigger below and
  -- its comment for exactly how and why. For every other requirement kind
  -- (training events with no cited calendar-month reg, and the two
  -- operator-obligation rows) no regulation was cited to derive a window
  -- from, so this column is left as whatever the pilot enters directly —
  -- same as pilot.documents.expires_on already works for every document
  -- kind. Nullable throughout: a requirement can be tracked with no date
  -- at all (e.g. status='not_started').
  expires_on date,
  check (completed_on is null or expires_on is null or expires_on >= completed_on),
  -- Free text, not an enum: aircraft type designators aren't a closed set
  -- this schema should own (contrast pilot.trips.aircraft_type, also free
  -- text). NOT NULL DEFAULT '' rather than nullable — see the comment on
  -- the unique constraint below for why: Postgres treats NULL as distinct
  -- from NULL in a unique constraint, so a nullable type_designator would
  -- let duplicate rows pile up for every non-type-specific requirement,
  -- and duplicate qualification rows for the same operator/requirement is
  -- exactly the kind of "two sources for one number" this schema
  -- otherwise refuses to allow (see the trips/expenses migration's C2).
  type_designator text not null default '',
  -- 135.299(a): the line check is "in one of the types of aircraft" the
  -- pilot is to fly — type-specific, unlike .293/.297. A blank
  -- type_designator on a line-check row would silently claim currency for
  -- every type instead of the one actually checked in.
  check (requirement <> 'line_check_135_299' or type_designator <> ''),
  notes text,
  document_id uuid,
  foreign key (account_id, document_id) references pilot.documents (account_id, id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- FK target for tenant-scoped children (none exist yet, but the pattern
  -- is uniform across this schema — see the Phase 3 migration's header).
  unique (account_id, id),
  -- One row per (operator, requirement, type). type_designator defaults
  -- to '' (never NULL) precisely so this constraint actually enforces
  -- "one row" for the non-type-specific requirements too, not just for
  -- line checks.
  unique (account_id, client_id, requirement, type_designator)
);

comment on table pilot.operator_qualifications is
  'What the pilot has been told/shown by an operator about their standing on THAT operator''s Part 135 certificate — NOT a determination that they are on the certificate, and the app copy must never read as one. drug_alcohol_program_120 and prd_consent_111 rows are status the pilot noted (120.105/111.105 bind the OPERATOR, not the pilot) and are never computed or verified by this product.';

comment on column pilot.operator_qualifications.expires_on is
  'LOAD-BEARING COLUMN NAME: pilot.expiration_coverage_gaps() finds date-bearing tables by this exact name. Derived by pilot.compute_operator_qualification_expiry() for competency_check_135_293 (12 cal. mo., 135.293(a)/(b)), ipc_135_297 (6 cal. mo., 135.297(a)) and line_check_135_299 (12 cal. mo., 135.299(a)), each with the 135.301(a) one-month-early/one-month-late provision applied on UPDATE. For every other requirement kind, this is a plain pilot-entered date (or null) — no calendar-month reg was cited for basic_indoc/initial_training/recurrent_training/insurance_approval/company_manuals/other, and drug_alcohol_program_120/prd_consent_111 are status rows this product does not compute a determination for at all.';

comment on column pilot.operator_qualifications.type_designator is
  'Aircraft type designator (e.g. CE-560XL). Required (non-blank) for line_check_135_299 — 135.299(a) is type-specific. Defaults to '''' (never NULL) so the unique(account_id, client_id, requirement, type_designator) constraint enforces one row per requirement for every OTHER requirement kind as well; a nullable column here would have let duplicate rows exist since Postgres never treats two NULLs as equal for uniqueness.';

-- ---------------------------------------------------------------------------
-- pilot.compute_operator_qualification_expiry() — the 293/297/299 + 301(a)
-- derivation. BEFORE INSERT OR UPDATE so app code never computes this
-- arithmetic (or gets it wrong) itself; there is exactly one place this
-- reg is encoded, matching C2's "one source of truth" discipline.
--
-- 135.301(a) mechanics: this table stores CURRENT state per (operator,
-- requirement, type) — the unique constraint above forbids a history of
-- past cycles — so "the required month" for an early/late comparison can
-- only be reconstructed from the ROW BEING REPLACED, i.e. OLD.expires_on.
-- The month a currency window ENDS is the same month the next check is
-- "required" in (finishing the new one anywhere in that final month keeps
-- the pilot continuously current with zero gap), so required_month :=
-- date_trunc('month', OLD.expires_on). If the new completed_on falls in
-- the calendar month immediately before or after that, treat it as if it
-- landed in required_month before running the same N-month formula.
--
-- This can only apply on UPDATE against a row that already has an
-- expires_on — a first-ever INSERT (basic_indoc's first training, or the
-- very first competency check on a new operator) has no prior cycle to be
-- early or late relative to, so 301 does not apply and the raw completed
-- month is used unadjusted. That is not a gap in the implementation; it
-- is what "required month" means for a brand-new qualification — there
-- isn't one yet.
--
-- Outside the immediate adjacent month either side, NO shift is applied:
-- a check completed further outside the window is used at its own actual
-- month, honestly, even though that may mean a real lapse. 135.301(a) is
-- permissive by exactly one month either way, never wider, and never
-- automatically resets what "on time" means when a pilot has genuinely
-- fallen out of the cycle.
--
-- IDEMPOTENCY (H1 fix, 2026-08-07): the whole recompute — including the
-- 301(a) early/late comparison — is gated on
-- `old.completed_on is distinct from new.completed_on`. An UPDATE that
-- doesn't touch completed_on (editing notes, status, document_id, ...)
-- must leave expires_on exactly as it was. Before this gate the function
-- unconditionally recomputed on every UPDATE, and the 301(a) branch read
-- `date_trunc('month', OLD.expires_on)` — the row's OWN PRIOR OUTPUT — as
-- required_month on every one of those re-fires, not just the ones where
-- completed_on actually changed. Concretely: a late IPC completed
-- 2026-08-20 correctly resolves under 301(a) to expires_on = 2027-01-31
-- (required_month reconstructed as JAN 2027, base_month AUG shifted to
-- JAN). But then editing nothing but `notes` re-runs the same function:
-- base_month is still AUG 2026 (completed_on unchanged), yet
-- required_month is now recomputed from the ALREADY-SHIFTED
-- OLD.expires_on = 2027-01-31, i.e. JAN 2027 again — AUG is one month
-- before JAN? No: AUG is not adjacent to JAN, so on a second unrelated
-- edit the shift stops applying and base_month reverts toward its own
-- actual month, then N-months-ahead is measured from there, silently
-- walking expires_on to 2027-02-28. A trigger that derives a value from
-- a column it itself sets on the same row is not a computation, it is a
-- feedback loop: every re-fire treats its last answer as new evidence,
-- so the answer walks forward (or backward) an extra month per edit,
-- with no bound and no relation to any input the caller actually
-- changed. The fix removes the feedback path entirely: required_month
-- must be reconstructed once, at the moment completed_on changes, from
-- the expires_on that was in place BEFORE this edit's own recompute —
-- never from a value this function wrote on a prior, unrelated UPDATE of
-- the same row when completed_on did not move.
-- ---------------------------------------------------------------------------
create or replace function pilot.compute_operator_qualification_expiry()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  months_ahead int;
  base_month date;
  required_month date;
begin
  if new.requirement not in ('competency_check_135_293', 'ipc_135_297', 'line_check_135_299') then
    -- Not one of the three Part 135 recurring checks this function
    -- derives. expires_on is whatever the caller supplied (may be null) —
    -- see the column comment for why that's correct for these kinds.
    return new;
  end if;

  if new.completed_on is null then
    new.expires_on := null;
    return new;
  end if;

  -- IDEMPOTENCY GATE (H1): only recompute when this UPDATE actually moves
  -- completed_on. Without this, editing notes/status/document_id re-fires
  -- the function with new.completed_on = old.completed_on, and — worse —
  -- the 301(a) branch below would reconstruct required_month from
  -- OLD.expires_on, which on a prior fire was ITSELF this function's
  -- output. Feeding a trigger's own derived output back in as if it were
  -- fresh input is not a computation, it's a feedback loop: each re-fire
  -- re-derives "the required month" from the last answer instead of from
  -- an unchanged input, so an unrelated edit (notes, status) walks
  -- expires_on an extra month with no relation to anything the caller
  -- changed. Gating on tg_op = 'INSERT' or completed_on actually differing
  -- keeps expires_on stable across any edit that doesn't touch the
  -- completion date, exactly as a derived column should behave.
  if tg_op = 'UPDATE' and old.completed_on is not distinct from new.completed_on then
    new.expires_on := old.expires_on;
    return new;
  end if;

  -- 135.297(a): 6th calendar month. 135.293(a)/(b) and 135.299(a): 12th
  -- calendar month. See the migration header for the exact eCFR text.
  months_ahead := case new.requirement
    when 'ipc_135_297' then 6
    else 12
  end;

  base_month := date_trunc('month', new.completed_on)::date;

  if tg_op = 'UPDATE' and old.completed_on is distinct from new.completed_on
     and old.expires_on is not null then
    required_month := date_trunc('month', old.expires_on)::date;
    if base_month = (required_month - interval '1 month')::date
       or base_month = (required_month + interval '1 month')::date then
      base_month := required_month;
    end if;
  end if;

  new.expires_on := (base_month + ((months_ahead + 1) || ' months')::interval - interval '1 day')::date;
  return new;
end;
$$;

comment on function pilot.compute_operator_qualification_expiry() is
  '135.293(a)/(b), 135.297(a), 135.299(a) expiry derivation with the 135.301(a) one-month-early/one-month-late provision, PART 135 CHECKS ONLY. Never touches expires_on for any other requirement kind. See this migration''s header for the eCFR text relied on.';

create trigger operator_qualifications_compute_expiry
  before insert or update on pilot.operator_qualifications
  for each row execute function pilot.compute_operator_qualification_expiry();

create trigger operator_qualifications_set_updated_at
  before update on pilot.operator_qualifications
  for each row execute function pilot.set_updated_at();

-- ---------------------------------------------------------------------------
-- pilot.expirations — union this table in, in the same migration that
-- creates it (the header's naming-hazard note). security_invoker carries
-- through from the existing view definition (MEDIUM-7's own check re-scans
-- every pilot.* view on every tenancy:verify run, so a regression here
-- would be caught, not just avoided by convention).
-- ---------------------------------------------------------------------------
create or replace view pilot.expirations
with (security_invoker = true) as
  select
    'document'::text                as source_table,
    d.id                            as source_id,
    d.account_id,
    d.kind                          as item_kind,
    d.label                         as item_label,
    d.expires_on,
    (d.expires_on - current_date)   as days_remaining,
    case
      when d.expires_on < current_date                       then 'overdue'
      when d.expires_on <= current_date + 1                  then 't_minus_1'
      when d.expires_on <= current_date + 7                  then 't_minus_7'
      when d.expires_on <= current_date + 14                 then 't_minus_14'
      when d.expires_on <= current_date + 30                 then 't_minus_30'
      else 'ok'
    end                             as ladder_stage
  from pilot.documents d
  where d.expires_on is not null

  union all

  select
    'operator_qualification'::text  as source_table,
    oq.id                           as source_id,
    oq.account_id,
    oq.requirement                  as item_kind,
    -- "<operator> — <requirement label>[ (<type>)]", matching the
    -- reg citation vocabulary this migration's header uses, so the
    -- ladder reads the same language a pilot would use talking to their
    -- chief pilot.
    c.name || ' — ' || (case oq.requirement
      when 'basic_indoc'                 then 'Basic indoctrination'
      when 'initial_training'            then 'Initial training'
      when 'recurrent_training'          then 'Recurrent training'
      when 'competency_check_135_293'    then '135.293 competency check'
      when 'ipc_135_297'                 then '135.297 IPC'
      when 'line_check_135_299'          then '135.299 line check'
      when 'drug_alcohol_program_120'    then '120.105 drug & alcohol program'
      when 'prd_consent_111'             then '111.105 PRD'
      when 'insurance_approval'          then 'Insurance approval'
      when 'company_manuals'             then 'Company manuals'
      else 'Other requirement'
    end) || (case when oq.type_designator <> '' then ' (' || oq.type_designator || ')' else '' end)
                                     as item_label,
    oq.expires_on,
    (oq.expires_on - current_date)  as days_remaining,
    case
      when oq.expires_on < current_date                       then 'overdue'
      when oq.expires_on <= current_date + 1                  then 't_minus_1'
      when oq.expires_on <= current_date + 7                  then 't_minus_7'
      when oq.expires_on <= current_date + 14                 then 't_minus_14'
      when oq.expires_on <= current_date + 30                 then 't_minus_30'
      else 'ok'
    end                              as ladder_stage
  from pilot.operator_qualifications oq
  join pilot.clients c on c.account_id = oq.account_id and c.id = oq.client_id
  where oq.expires_on is not null;

comment on view pilot.expirations is
  'A1/C4: the single expiry ladder. Every date-bearing row type in schema pilot MUST be unioned in here — pilot.expiration_coverage_gaps() proves it, and tenancy:verify fails if it is not empty. security_invoker so the underlying tables'' RLS still applies. source_table distinguishes ''document'' (pilot.documents) from ''operator_qualification'' (pilot.operator_qualifications, added 20260807060000) — read this as evidence the pilot recorded, never as a legality or on-the-certificate determination.';

-- ---------------------------------------------------------------------------
-- index — same shape as documents_expiry_idx.
-- ---------------------------------------------------------------------------
create index if not exists operator_qualifications_client_idx
  on pilot.operator_qualifications (account_id, client_id);
create index if not exists operator_qualifications_expiry_idx
  on pilot.operator_qualifications (account_id, expires_on)
  where expires_on is not null;
create index if not exists operator_qualifications_document_idx
  on pilot.operator_qualifications (account_id, document_id)
  where document_id is not null;

-- ---------------------------------------------------------------------------
-- RLS. Enabled in the same migration that creates the table, per house
-- rule — never retrofitted. No admin-bypass policy, no AMG-facing read
-- path, same as every other tenant table in this schema.
-- ---------------------------------------------------------------------------
alter table pilot.operator_qualifications enable row level security;

create policy operator_qualifications_select on pilot.operator_qualifications for select to authenticated
  using (account_id in (select pilot.current_account_ids()));
create policy operator_qualifications_insert on pilot.operator_qualifications for insert to authenticated
  with check (account_id in (select pilot.current_account_ids()));
create policy operator_qualifications_update on pilot.operator_qualifications for update to authenticated
  using (account_id in (select pilot.current_account_ids()))
  with check (account_id in (select pilot.current_account_ids()));
create policy operator_qualifications_delete on pilot.operator_qualifications for delete to authenticated
  using (account_id in (select pilot.current_account_ids()));

-- ---------------------------------------------------------------------------
-- GRANTS — column-scoped, same discipline as every table in this schema.
-- id/created_at/updated_at withheld (defaults + trigger own them).
-- client_id and requirement withheld from UPDATE — together with
-- type_designator they IDENTIFY the row (the unique constraint above);
-- re-pointing any of them is a delete-and-insert, the same discipline
-- pilot.client_rates and pilot.guarantee_periods already use for their
-- own identifying columns. type_designator is therefore ALSO withheld
-- from UPDATE for the same reason. expires_on IS granted on both: the
-- trigger overwrites it outright for the three regulated checks, so a
-- caller-supplied value for those is simply replaced, never trusted —
-- and for every other requirement kind it is the only way to write the
-- pilot-entered date at all.
-- ---------------------------------------------------------------------------
grant select, delete on pilot.operator_qualifications to authenticated;

grant insert (
  account_id, client_id, requirement, completed_on, status, expires_on,
  type_designator, notes, document_id
) on pilot.operator_qualifications to authenticated;

grant update (completed_on, status, expires_on, notes, document_id)
  on pilot.operator_qualifications to authenticated;

grant select on pilot.expirations to authenticated;

grant select, insert, update, delete on pilot.operator_qualifications to service_role;
grant select on pilot.expirations to service_role;

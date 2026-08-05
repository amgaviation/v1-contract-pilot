-- ============================================================================
-- Phase 3 (Clients, Trips, Legs) + Phase 4 (Expenses, Documents)
--   + THE CROSS-CUTTING EXPIRATION ENGINE (requirements A1 and C4)
-- ============================================================================
-- Builds on 20260802190437_pilot_schema_tenancy.sql and
-- 20260802190518_pin_trigger_function_search_path.sql, both ALREADY APPLIED to
-- the live project. Neither is modified. Everything here is additive.
--
-- THIS FILE SUPERSEDES AND REPLACES three uncommitted-to-production drafts that
-- must be DELETED from supabase/migrations/ before this is applied:
--   20260805070000_phase3_clients_trips_expenses.sql
--   20260805120000_pilot_clients_trips_expenses_documents_expirations.sql
--   20260805123000_pilot_phase3_phase4_expiration_engine.sql
-- They create the same table names with incompatible shapes. Migrations apply
-- in filename order, so leaving any of them in place means the OLDEST wins and
-- this file's constraints silently never get created while its grants and
-- policies still apply — a table with the wrong shape and the right-looking
-- permissions. That is why nothing below uses `create table if not exists`:
-- see the idempotency note in section 0.
--
-- ----------------------------------------------------------------------------
-- THE FIVE PHASE 1 PATTERNS THIS FILE INHERITS. Read that migration before
-- editing this one; these are repeated, not re-derived.
-- ----------------------------------------------------------------------------
-- 1. RLS ON EVERY TABLE, IN THE MIGRATION THAT CREATES IT — never retrofitted.
--    Every policy scopes through pilot.current_account_ids(), always written
--    `account_id in (select pilot.current_account_ids())`. The `(select ...)`
--    wrapper is load-bearing, not cosmetic: it lets the planner hoist the
--    helper into a one-time InitPlan instead of re-invoking it per row. Never
--    "simplify" it to a bare function call.
--    THERE IS NO ADMIN-BYPASS POLICY IN THIS FILE AND THERE MUST NEVER BE ONE.
--    No AMG-facing read path exists. That absence is the product
--    (docs/PLAN.md). Support tooling, if ever needed, gets its own explicit,
--    audited, per-request mechanism — never a broadened policy.
--
-- 2. THE TABLE-OWNER RLS EXEMPTION, NOT `SECURITY DEFINER`, is what makes the
--    helpers recursion-safe. SECURITY DEFINER changes which role the body runs
--    as; it does not bypass RLS. These functions work because their owner also
--    owns the tables they read, and Postgres exempts a table's owner from that
--    table's RLS UNLESS FORCE ROW LEVEL SECURITY is set.
--    DO NOT SET FORCE ROW LEVEL SECURITY on pilot.account_members (Phase 1's
--    warning: 42P17 infinite recursion on every authenticated read), and now
--    also not on pilot.expirations — the projection trigger below writes it
--    through the same exemption, so forcing RLS there makes every write to
--    pilot.documents fail with a policy violation raised from inside a trigger,
--    which is a genuinely confusing error to debug.
--
-- 3. `set search_path = ''` on EVERY function; every identifier qualified.
--
-- 4. THE PHASE 1 CRITICAL — COLUMN-SCOPED GRANTS. Postgres RLS has NO column
--    granularity. A policy can say "you may touch rows you own"; it can never
--    say "you may change these columns." A whole-table `grant update` plus an
--    ownership-only policy is exactly what let an account owner rewrite their
--    own billing state. Every write privilege below therefore ENUMERATES
--    COLUMNS, and the enumeration is made authoritative rather than additive by
--    an explicit `revoke all ... from authenticated` immediately before it —
--    Postgres grants are additive, so without the revoke a stray table-wide
--    grant from any other migration would survive this file untouched.
--    The rule extends to INSERT, which is the half most people forget: `id` is
--    excluded from every INSERT grant. If a tenant may choose a row's primary
--    key, `insert ... (id) values ('<guess>')` returns either success or a
--    unique violation naming the constraint — a CROSS-TENANT EXISTENCE ORACLE,
--    structurally identical to the Phase 1 finding on connect_account_id. The
--    same reasoning applies to every UNIQUE constraint on a tenant-writable
--    column: see trip_legs' `unique (account_id, trip_id, leg_seq)`, which is
--    account-scoped for precisely this reason and must stay that way.
--
-- 5. COMPOSITE FOREIGN KEYS between tenant-scoped tables. A plain FK checks
--    existence only, and FK verification runs with RLS bypassed, so an
--    account_id-only policy does not stop
--      update pilot.expenses set trip_id = '<another tenant''s trip id>'
--    Every FK below between two tenant tables carries account_id and references
--    a `unique (id, account_id)` key on the parent. That is why each parent has
--    an apparently-redundant `unique (id, account_id)` — it is not redundant,
--    it is the referenced key, and removing it removes the isolation.
--
-- ----------------------------------------------------------------------------
-- CONVENTIONS FIXED HERE. Changing any of these later is expensive.
-- ----------------------------------------------------------------------------
-- MONEY is integer minor units (US cents) in `bigint` columns named `*_cents`.
-- Never numeric, never float, never a mix.
--   (a) Exact. This whole product is sums over a year; cent-denominated
--       integers cannot accumulate representation error.
--   (b) Stripe speaks minor units natively on both integrations (decision #8),
--       so Phase 5 has no conversion layer, and a conversion layer is where
--       C2's "two sources for one number" is born.
--   (c) bigint not integer: `integer` cents caps a row near $21.4M and SUM()
--       promotes to bigint anyway, so bigint everywhere removes the cast.
-- INVARIANT, asserted by the verify script: no column named `*_cents` anywhere
-- in schema `pilot` has any type but bigint, and NO view exposes a money column
-- as numeric. That second half matters: sum(bigint) returns NUMERIC in
-- Postgres, so every aggregate in pilot.trip_financials is cast back to
-- ::bigint explicitly. Without those casts the product's headline figure ships
-- to the client as a JSON string while its siblings ship as numbers, and the
-- first developer to "fix" that with parseFloat reintroduces the float this
-- rule exists to forbid.
-- THE ONLY non-integer columns in this schema are trips.day_count and
-- trips.per_diem_days — QUANTITIES, not money, because half-days are real in
-- contract-pilot billing. The single place a quantity becomes money is
-- pilot.trip_financials, and it rounds each component BEFORE summing so the
-- displayed day-rate line and per-diem line always add up to the displayed
-- total; rounding the sum instead yields a total that disagrees with its own
-- line items by a cent, which on an invoice is a support ticket.
-- No currency column: USD is a locked assumption for a US contract pilot with
-- W-9/1099 exposure (C10). Multi-currency is not a column, it is a project
-- (minor-unit scale is currency-dependent — JPY has none), and guessing at it
-- now would be the half-copied vocabulary docs/PLAN.md warns about.
--
-- TIME. A10 is a hard rule: store UTC, display airport-local + Zulu derived
-- from the ICAO code. THERE IS NO TIMEZONE COLUMN IN THIS SCHEMA AND THERE MUST
-- NEVER BE ONE — no `timezone`, no `tz_offset`, no `local_date`. Leg clock
-- times are `timestamptz` (absolute instants); the airport code is the zone.
-- Calendar-valued business facts (a trip's range, an expiry, an expense date)
-- are `date`, because they are not instants and attaching a zone to them
-- creates off-by-one-day bugs at every boundary.
--
-- EXPIRY SEMANTICS. `expires_on` is the LAST VALID DAY, INCLUSIVE. A medical
-- with expires_on = 2026-11-30 is valid through 30 Nov and overdue on 1 Dec, so
-- days_remaining is 0 on the last valid day and never -1. Two developers will
-- otherwise disagree about this within a week.
--
-- IDEMPOTENCY, AND WHY THERE IS NO `create table if not exists` HERE.
-- A migration runs once, inside a transaction; re-runnability is the migration
-- runner's job. `create table if not exists` on a security-critical table buys
-- re-runnability at the price of SILENTLY INHERITING a foreign shape — the
-- composite FKs, the CHECKs and the account-scoped unique keys that carry the
-- entire isolation story live inside these CREATE bodies, so a pre-existing
-- table means none of them is created while the grants and policies below apply
-- anyway. Plain `create table` fails loudly instead, which is the correct
-- outcome. Everything that CAN be idempotent without that hazard is:
-- `create index if not exists`, `create or replace function/view/trigger`,
-- `drop policy if exists` before each `create policy`, and DO-blocks guarding
-- `alter table ... add constraint`.
-- ============================================================================


-- ############################################################################
-- SECTION 0 — Shared machinery
-- ############################################################################

-- ----------------------------------------------------------------------------
-- 0a. Role helper. Phase 1 built pilot.is_account_owner() for owner-gated
-- writes and warned that scoping by MERE MEMBERSHIP is not authorization. This
-- generalises it so the role matrix can be expressed per command.
-- ----------------------------------------------------------------------------
create or replace function pilot.has_account_role(
  target_account_id uuid,
  allowed_roles     text[]
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from pilot.account_members m
    where m.account_id = target_account_id
      and m.user_id = auth.uid()
      and m.role = any (allowed_roles)
  );
$$;

comment on function pilot.has_account_role(uuid, text[]) is
  'Role-aware companion to pilot.current_account_ids(). Same table-owner RLS '
  'exemption and the same FORCE ROW LEVEL SECURITY warning as Phase 1''s '
  'helpers. Used by the RESTRICTIVE delete policies below.';

revoke all on function pilot.has_account_role(uuid, text[]) from public;
grant execute on function pilot.has_account_role(uuid, text[]) to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 0b. Tenancy freeze. Second lock behind the column-scoped UPDATE grants, and
-- the same belt-and-braces role pilot.protect_account_billing_columns() plays
-- in Phase 1: if a future migration accidentally re-widens a grant, a
-- re-parenting path must still not open silently.
-- Deliberately mirrors Phase 1's `current_user <> 'service_role'` escape hatch,
-- because account closure, GDPR deletion and data repair all need a
-- service-side path and Phase 1 already established that shape.
-- ----------------------------------------------------------------------------
create or replace function pilot.freeze_tenancy_columns()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user <> 'service_role' and (
       new.id         is distinct from old.id
    or new.account_id is distinct from old.account_id
    or new.created_at is distinct from old.created_at
  ) then
    raise exception
      'pilot.%: id, account_id and created_at are immutable (row %)',
      tg_table_name, old.id
      using hint = 'Delete and re-create the row, or write an explicit data migration.';
  end if;
  return new;
end;
$$;

revoke all on function pilot.freeze_tenancy_columns() from public;

-- ----------------------------------------------------------------------------
-- 0c. pilot.paperwork_gate — B3's vocabulary as a TYPE, not a comment.
--
-- *** LIABILITY BOUNDARY. READ BEFORE ADDING A VALUE. ***
-- These are PAPERWORK gates and they are NEVER an operational go/no-go
-- determination. Airworthiness, crew qualification, duty/rest, weight and
-- balance, FRAT, release — none of them may ever appear here. That boundary is
-- LOCKED (docs/PLAN.md; INSPIRATION §B3 and §D): this product organises
-- paperwork; the operator and the PIC make operational decisions. A gate that
-- reads like a clearance is an existential product defect, not a scope
-- disagreement.
-- The domain is what makes that structural rather than remembered: the gate
-- keys in pilot.trip_paperwork are cast to this type, so a future
-- `create or replace view` adding ('frat', ...) or ('ready_to_fly', ...) fails
-- in Postgres with the boundary in the error message, instead of passing review
-- because someone did not scroll up to a comment.
-- ----------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_catalog.pg_type t
      join pg_catalog.pg_namespace n on n.oid = t.typnamespace
     where n.nspname = 'pilot' and t.typname = 'paperwork_gate'
  ) then
    create domain pilot.paperwork_gate as text
      check (value in (
        'legs_entered',
        'expenses_assigned',
        'w9_on_file',
        'invoice_drafted',
        'invoice_sent',
        'invoice_paid',
        'logbook_confirmed'
      ));
  end if;
end
$$;

comment on domain pilot.paperwork_gate is
  'The complete B3 paperwork-gate vocabulary. NEVER an operational go/no-go — '
  'see the locked liability boundary above this domain in the migration. '
  'Adding an operational value here fails at view-creation time, on purpose.';

-- ----------------------------------------------------------------------------
-- 0d. The A1 escalation ladder, defined exactly ONCE.
-- The rung vocabulary lives in pilot.expiry_stages() and the thresholds in
-- pilot.expiry_stage(). Nothing else — not the CHECK on the dispatch log, not a
-- TypeScript constant — may restate either. A ladder implemented twice is C2's
-- two-sources problem with a compliance consequence attached.
-- ----------------------------------------------------------------------------
create or replace function pilot.expiry_stages()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array['t_minus_30', 't_minus_14', 't_minus_7', 't_minus_1', 'overdue']::text[];
$$;

comment on function pilot.expiry_stages() is
  'The five NOTIFIABLE rungs of the A1 ladder, in escalation order. The CHECK '
  'on pilot.expiration_notices.stage reads this array rather than restating the '
  'list, so adding a rung is one edit in one place.';

create or replace function pilot.expiry_stage(p_expires_on date, p_as_of date)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_expires_on is null         then null
    when p_expires_on <  p_as_of      then 'overdue'
    when p_expires_on <= p_as_of + 1  then 't_minus_1'
    when p_expires_on <= p_as_of + 7  then 't_minus_7'
    when p_expires_on <= p_as_of + 14 then 't_minus_14'
    when p_expires_on <= p_as_of + 30 then 't_minus_30'
    else 'none'
  end;
$$;

comment on function pilot.expiry_stage(date, date) is
  'The A1 ladder. expires_on is the LAST VALID DAY inclusive, so an item is '
  '''t_minus_1'' (0 days remaining) ON its expiry date and ''overdue'' the day '
  'after. IMMUTABLE with an explicit as-of date rather than reading '
  'current_date, so it is testable against fixtures and usable in an index '
  'expression if that is ever needed. Every surface showing a rung reads this; '
  'recomputing it in application code is the C2 defect.';

revoke all on function pilot.expiry_stages() from public;
revoke all on function pilot.expiry_stage(date, date) from public;
grant execute on function pilot.expiry_stages() to authenticated, service_role;
grant execute on function pilot.expiry_stage(date, date) to authenticated, service_role;


-- ############################################################################
-- SECTION 1 — Per-account document numbering
-- ############################################################################
-- Trips need a human reference now (TRP-0114 in the mockup); invoices need a
-- sequential number in Phase 5. Building ONE allocator now instead of two later
-- is the cheapest item in this file.
--
-- SECURITY: this is entitlement-shaped state in the Phase 1 sense. A tenant who
-- could UPDATE next_value could rewind their own invoice numbering and emit two
-- different documents bearing the same number. `authenticated` therefore gets
-- SELECT (so the UI can preview "your next invoice will be INV-0042") and
-- nothing else; allocation happens only inside the SECURITY DEFINER function,
-- which is not granted to `authenticated` at all.

create table pilot.document_sequences (
  account_id  uuid        not null references pilot.accounts (id) on delete cascade,
  kind        text        not null check (kind in ('trip', 'invoice')),
  next_value  integer     not null default 1 check (next_value >= 1),
  updated_at  timestamptz not null default now(),
  primary key (account_id, kind)
);

comment on table pilot.document_sequences is
  'Per-account, per-kind counter for human-facing document numbers. Written '
  'ONLY by pilot.next_document_number(). Tenants read it and may never write it.';

create or replace function pilot.next_document_number(
  p_account_id uuid,
  p_kind       text
)
returns integer
language sql
security definer
set search_path = ''
as $$
  insert into pilot.document_sequences (account_id, kind, next_value)
  values (p_account_id, p_kind, 2)
  on conflict (account_id, kind) do update
    set next_value = pilot.document_sequences.next_value + 1,
        updated_at = now()
  returning next_value - 1;
$$;

comment on function pilot.next_document_number(uuid, text) is
  'Allocates the next number for (account, kind). ON CONFLICT DO UPDATE takes a '
  'row lock, so concurrent allocations serialise rather than collide. GAP '
  'BEHAVIOUR, stated because Phase 5 must decide about it: gapless under '
  'commit, but a rolled-back transaction burns its number. Fine for trips '
  '(cosmetic); if a gapless BILLING sequence is required, Phase 5 allocates the '
  'invoice number at SEND time rather than at draft time — do not "fix" it by '
  'rewriting this into a max()+1 scan, which is both racy and slower.';

revoke all on function pilot.next_document_number(uuid, text) from public;
grant execute on function pilot.next_document_number(uuid, text) to service_role;
-- Deliberately NOT granted to `authenticated`: no tenant-reachable code path
-- may burn numbers directly. The only caller is the BEFORE INSERT trigger on
-- pilot.trips, which runs as this function's owner.


-- ############################################################################
-- SECTION 2 — THE EXPIRATION ENGINE (A1 + C4)
-- ############################################################################
-- WHAT WENT WRONG IN THE SYSTEM THIS LEARNS FROM, precisely: the escalation
-- ladder fired for crew documents and never for two EXPIRED federal compliance
-- programs, because those lived in a different module nobody wired in. The
-- failure was not a bug in the ladder. It was AN OMISSION WITH NO RECORD —
-- nothing in their schema could be queried to discover that a module was
-- missing. Every choice below exists to make an omission either impossible or
-- loudly visible as a row.
--
-- C4: "any table carrying an expiry participates BY CONSTRUCTION — one code
-- path, and a verify script asserting no date-bearing row type is outside it."
--
-- THE MECHANISM, in four parts:
--
--  (1) A COLUMN-LEVEL REGISTRY WHOSE DEFAULT IS DENY. pilot.expiring_sources
--      holds one row per DATE-BEARING COLUMN in the whole schema — not per
--      table. Participation is a row. NON-participation is ALSO a row, carrying
--      a written reason enforced by a CHECK. There is no third state: a date
--      column that is in neither state fails pilot.assert_expiry_coverage().
--
--      THIS IS THE PART MOST DESIGNS GET WRONG, and the reason it is worth the
--      extra rows. The tempting alternative is to DISCOVER expiries — by a
--      marker domain, or by matching column names against a regex like
--      (expir|valid_until|renew). Both are opt-IN, and an opt-in mechanism
--      CANNOT SEE AN ABSENCE. Point either at this database today and it
--      reports clean while pilot.accounts.trial_ends_at — a real expiry, in a
--      plain timestamptz, in a different module — sits outside the engine. That
--      is the audited failure, reproduced on the first run, by the mechanism
--      built to prevent it. A name regex is worse still: it catches exactly the
--      author who was already following the naming rule, and misses
--      `medical_good_through`, `renewal_deadline` and `due_date`, which are the
--      only authors it needed to catch.
--      A registry whose default is RAISE is not "a second place to forget". It
--      is the only construction under which forgetting is impossible, because
--      the thing you must not forget is the thing that fails the build.
--      See section 8: trial_ends_at is declared out loud, with its reasoning,
--      and without that declaration THIS MIGRATION DOES NOT APPLY.
--
--      Exactly TWO column names are auto-exempt: `created_at` and `updated_at`.
--      They are on every table and will be on every future table, they are
--      never expiries, and they are set by trigger. Adding a THIRD name to that
--      list is the erosion this comment exists to refuse — declare the column
--      instead; it costs one sentence.
--
--  (2) pilot.declare_expiring_source() — the ONLY way in. One call validates
--      the source table's SHAPE (id, account_id, a `date` expiry column,
--      NOT NULL kind and label columns) AND its TENANT SAFETY (RLS enabled and
--      at least one policy), writes the registry row, ATTACHES the projection
--      trigger, and backfills existing rows — atomically. You cannot register
--      without wiring and cannot wire without registering.
--      The RLS check is not decoration. Phase 1 set
--      `alter default privileges in schema pilot grant select on tables to
--      authenticated`, so every new table in this schema is readable by every
--      authenticated user the moment it exists, and CREATE TABLE does not
--      enable RLS. A mechanism that auto-enrols a table into a shared
--      expiry surface without checking that the table is isolated does not
--      prevent the audited failure, it upgrades it: a missed reminder becomes a
--      breach. So enrolment and isolation are checked by the same call.
--
--  (3) pilot.project_expiration() — literally one trigger function for every
--      source table, forever (C4's "one code path"). It reads registry metadata
--      keyed on TG_TABLE_NAME and pulls values out of to_jsonb(NEW) BY COLUMN
--      NAME, so there is no dynamic expression evaluation and no injection
--      surface in the hot path, and adding a source table adds ZERO lines of
--      trigger code. It loops over every participating column of the table, so
--      a table with two expiries is fully covered — one-expiry-per-table is a
--      hole, not a simplification.
--
--  (4) THE STRUCTURAL GATE. Every migration in this repo ENDS WITH
--      `select pilot.assert_expiry_coverage();` — including this one. Supabase
--      applies each migration in a transaction, so a migration that adds a
--      date-bearing column without declaring it RAISES AND ROLLS THE WHOLE
--      MIGRATION BACK, with a message naming the column and the fix.
--      HONEST STATEMENT OF THE GUARANTEE, because the SQL must not promise more
--      than it delivers: this is enforcement at the moment of the mistake ONLY
--      IF the migration carries that final line. That convention is enforced by
--      a CI lint (`npm run expirations:verify`, which also greps every file in
--      supabase/migrations/ for the call). Without the lint, forgetting is
--      caught at the NEXT migration that does include it — still bounded, still
--      loud, but later. Ship the lint with this migration; it is five lines and
--      it is the only thing standing between "convention" and "by construction".
--
-- WHY THERE IS NO DDL EVENT TRIGGER, since a future editor will ask.
-- An `on ddl_command_end` event trigger looks like the obvious enforcement
-- point and does not work here. It fires at the end of the CREATE TABLE
-- statement, which is necessarily BEFORE the declare call that wires the new
-- table, so it would reject every legitimate migration. And CREATE EVENT
-- TRIGGER requires superuser, which the `postgres` role on hosted Supabase is
-- not — the statement would fail and take the whole migration with it. The
-- migration-tail assertion gives the same guarantee with no privilege
-- requirement and no ordering problem. Do not "improve" this by adding one.
--
-- WHY A PROJECTION TABLE AND NOT A UNION VIEW.
-- A `union all` view over every date-bearing table is honest by construction
-- (no copy to keep in sync) and fails C4 in exactly the audited way: adding a
-- table means editing the view, and forgetting is silent. It also cannot be
-- indexed, and "everything expiring in the next 30 days for this account" runs
-- on every Overview render. The projection IS a denormalised copy; what keeps
-- it honest is named at pilot.expirations below and asserted by branch (D).

-- ----------------------------------------------------------------------------
-- 2a. pilot.expiring_sources — the registry
-- ----------------------------------------------------------------------------
-- NOT tenant data: this is schema configuration, and it therefore has no
-- account_id. That is a DELIBERATE, narrow exception to "every table carries
-- account_id". The rule behind that rule is "no tenant sees another tenant's
-- rows", and the correct treatment for a non-tenant table is NO TENANT ACCESS
-- AT ALL rather than a fabricated account_id column. RLS is enabled with ZERO
-- policies and `authenticated` is explicitly revoked below. (Note that
-- pilot.accounts is itself a table in `pilot` with no account_id — the
-- tenancy rule has always been about tenant-scoped rows, not about every row.)

create table pilot.expiring_sources (
  -- Table name only (no schema): everything here lives in `pilot`. Text rather
  -- than regclass so a table RENAME is caught by the coverage assertion instead
  -- of being silently followed.
  table_name           text not null,
  column_name          text not null,

  participates         boolean not null default true,
  -- An exemption MUST say why. This constraint is the whole anti-C4 device: it
  -- turns "we forgot" into a sentence someone had to write and someone else can
  -- read in a code review.
  exemption_reason     text,

  -- Column names on the source table that the ONE projection trigger reads.
  -- METADATA, not SQL expressions: the trigger pulls fields out of to_jsonb(NEW)
  -- by name, so there is no dynamic expression evaluation in the hot path.
  kind_column          text,
  label_column         text,
  status_column        text,
  active_status_values text[],
  client_column        text,
  trip_column          text,

  declared_at          timestamptz not null default now(),

  primary key (table_name, column_name),

  constraint expiring_sources_exemption_needs_reason
    check (participates
           or (exemption_reason is not null and length(btrim(exemption_reason)) > 20)),
  constraint expiring_sources_participation_needs_columns
    check (not participates
           or (kind_column is not null and label_column is not null)),
  constraint expiring_sources_status_pair
    check ((status_column is null) = (active_status_values is null))
);

comment on table pilot.expiring_sources is
  'Registry of every DATE-BEARING COLUMN in schema pilot — those that '
  'participate in the A1 ladder, and those that deliberately do not together '
  'with the written reason. C4: the system this design learns from failed '
  'because a module was never wired in and nothing recorded that fact. Here, '
  'absence from this table is not a silent state — '
  'pilot.assert_expiry_coverage() raises on it, and every migration ends by '
  'calling that function.';

-- ----------------------------------------------------------------------------
-- 2b. pilot.expirations — the single projection every ladder query reads
-- ----------------------------------------------------------------------------
-- WHAT KEEPS THIS COPY HONEST, stated plainly because it IS a copy:
--   * ONE trigger function, attached automatically at declare time, fires on
--     INSERT/UPDATE/DELETE of every registered source. There is no second
--     tenant-reachable write path: `authenticated` has no INSERT/UPDATE/DELETE
--     grant and no such policy. (Two non-trigger paths exist and are named
--     rather than hidden: the ON DELETE CASCADE from pilot.accounts, which is
--     account teardown, and a direct service_role write, which branch (D)
--     catches.)
--   * `unique (source_table, source_column, source_id)` makes "exactly one
--     projection row per source COLUMN per source row" a database fact.
--   * source_table/source_column is an FK to the registry, so a projection from
--     a de-registered source cannot linger.
--   * branch (D) of assert_expiry_coverage() does a two-way anti-join between
--     every source and this table, so drift from any cause is a loud failure
--     rather than a wrong number on a compliance screen.

create table pilot.expirations (
  id            uuid primary key default gen_random_uuid(),
  account_id    uuid not null references pilot.accounts (id) on delete cascade,

  source_table  text not null,
  source_column text not null,
  source_id     uuid not null,

  -- Projected from the source's kind/label columns so the ladder query renders
  -- N rows with zero joins off one index range scan. THIS is the
  -- denormalisation that earns its keep; the honesty cost is paid by branch (D).
  kind          text not null,
  label         text not null,

  expires_on    date not null,

  -- Deep-link scope (A1: "each alert deep-links to the owning record").
  -- Composite FKs added in section 7b, once clients and trips exist.
  client_id     uuid,
  trip_id       uuid,

  projected_at  timestamptz not null default now(),

  unique (source_table, source_column, source_id),
  -- Tenancy-carrying target for pilot.expiration_notices' FK. Apparently
  -- redundant with the line above and not: it is what lets the dispatch log
  -- reference a projection row WITH account_id, per pattern 5.
  unique (source_table, source_column, source_id, account_id),

  foreign key (source_table, source_column)
    references pilot.expiring_sources (table_name, column_name)
    on update cascade
);

comment on table pilot.expirations is
  'THE single projection of every date-bearing row in this schema. Read-only to '
  'tenants; written exclusively by pilot.project_expiration() through triggers '
  'that pilot.declare_expiring_source() attaches. Every expiry surface in the '
  'product — the Currency & Expirations board, the Needs Attention queue, the '
  'notification ladder — reads this table and only this table.';

-- The index the whole engine exists to serve. account_id FIRST, because the RLS
-- predicate is always `account_id in (...)`: a non-account-leading index on a
-- tenant table is close to useless once the policy forces an account_id
-- restriction into every plan. Same rule for every index in this file.
create index if not exists expirations_account_expires_idx
  on pilot.expirations (account_id, expires_on);
create index if not exists expirations_account_client_idx
  on pilot.expirations (account_id, client_id) where client_id is not null;
create index if not exists expirations_account_trip_idx
  on pilot.expirations (account_id, trip_id) where trip_id is not null;

-- ----------------------------------------------------------------------------
-- 2c. pilot.expiration_notices — the ladder's dispatch log
-- ----------------------------------------------------------------------------
-- IDEMPOTENCY IS A UNIQUE CONSTRAINT, not application logic, and putting the
-- EXPIRY VALUE in the key buys two properties for free:
--   * a rung fires exactly once however many times the notifier runs (crash,
--     retry, pg_cron overlap, two workers);
--   * RENEWING a document RESETS the ladder automatically, because the new
--     expires_on is a different key. There is no "reset reminders" code path to
--     forget to call.
--
-- period_key EXISTS BECAUSE 'overdue' IS NOT LIKE THE OTHER RUNGS. Without it,
-- the terminal, most serious rung fires ONCE and then goes silent forever: the
-- pilot is told on day 41 that their medical expired and never again. An
-- escalation whose last step is the quietest is an inversion of an escalation.
-- The notifier sets period_key to date_trunc('week', current_date)::date for
-- 'overdue' (one reminder per week, indefinitely) and leaves it at '-infinity'
-- for the T-n rungs (one reminder, ever). Both behaviours are then the SAME
-- mechanism with a different key, rather than two code paths.
--
-- The FK to pilot.expirations is composite and carries account_id (pattern 5),
-- and cascades, so deleting a document removes its projection and its notice
-- history together — no orphan rows, no cleanup job.
--
-- Tenants get SELECT ONLY. A tenant who could INSERT here could pre-write an
-- idempotency key and suppress a send; one who could DELETE could make the
-- ladder fire twice. Note honestly what this does NOT protect against: a tenant
-- can always silence their own reminders by editing expires_on or deleting the
-- document, because it is their record and `expires_on` is in the documents
-- UPDATE grant. The protection here is of the NOTIFIER'S LEDGER — dispatch
-- integrity and auditability — not of the tenant against themselves.

create table pilot.expiration_notices (
  id                uuid primary key default gen_random_uuid(),
  account_id        uuid not null references pilot.accounts (id) on delete cascade,

  source_table      text not null,
  source_column     text not null,
  source_id         uuid not null,
  source_expires_on date not null,

  -- Reads pilot.expiry_stages() rather than restating the list: one vocabulary,
  -- one place. See section 0d.
  stage             text not null check (stage = any (pilot.expiry_stages())),

  -- '-infinity' = "this rung fires once, ever". A real date = "once per that
  -- period", used only for the recurring 'overdue' rung.
  period_key        date not null default '-infinity',

  channel           text not null default 'email' check (channel in ('email', 'in_app')),
  sent_at           timestamptz not null default now(),
  created_at        timestamptz not null default now(),

  unique (account_id, source_table, source_column, source_id,
          source_expires_on, stage, period_key, channel),

  foreign key (source_table, source_column, source_id, account_id)
    references pilot.expirations (source_table, source_column, source_id, account_id)
    on update cascade on delete cascade
);

comment on table pilot.expiration_notices is
  'Dispatch log for the A1 ladder. The unique constraint IS the idempotency '
  'mechanism; because source_expires_on is in the key, renewing a document '
  'resets its ladder with no code involved. period_key makes ''overdue'' '
  'recurring without a second code path. Written by the notifier (service_role) '
  'only; tenants read their own history and nothing else.';

create index if not exists expiration_notices_account_sent_idx
  on pilot.expiration_notices (account_id, sent_at desc);

-- ----------------------------------------------------------------------------
-- 2d. pilot.project_expiration() — THE one code path (C4)
-- ----------------------------------------------------------------------------
-- SECURITY DEFINER because pilot.expirations has RLS enabled and deliberately
-- no INSERT policy. The function's owner also owns pilot.expirations, and
-- Postgres exempts a table's owner from its RLS unless FORCE ROW LEVEL SECURITY
-- is set. Same fragile-but-documented mechanism Phase 1 relies on, and it
-- carries the same warning: DO NOT SET FORCE ROW LEVEL SECURITY ON
-- pilot.expirations.
--
-- account_id is taken from the SOURCE ROW, never from the session. A tenant
-- cannot cause a projection under another account_id without first writing the
-- source row under that account_id, which RLS already prevents.

create or replace function pilot.project_expiration()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  src      pilot.expiring_sources%rowtype;
  rec      jsonb;
  v_id     uuid;
  v_acct   uuid;
  v_exp    date;
  v_active boolean;
  n        integer := 0;
begin
  if tg_op = 'DELETE' then
    rec := to_jsonb(old);
    delete from pilot.expirations
     where source_table = tg_table_name
       and source_id = (rec ->> 'id')::uuid;
    return old;
  end if;

  rec    := to_jsonb(new);
  v_id   := (rec ->> 'id')::uuid;
  v_acct := (rec ->> 'account_id')::uuid;

  -- Loop over EVERY participating column of this table. One-expiry-per-table
  -- would be a silent hole the day a table grows a second date.
  for src in
    select * from pilot.expiring_sources
     where table_name = tg_table_name and participates
     order by column_name
  loop
    n := n + 1;

    -- The declare-time validation forces participating expiry columns to be of
    -- type `date`, so this cast is zone-independent. If that validation is ever
    -- relaxed to allow timestamptz, THIS LINE BECOMES A BUG: to_jsonb() renders
    -- a timestamptz in the SESSION's TimeZone, so ::date would yield the
    -- session's local day, not the UTC day, and the ladder would be off by one
    -- for any writer in a non-UTC session. Keep expiries as dates.
    v_exp    := nullif(rec ->> src.column_name, '')::date;
    v_active := true;
    if src.status_column is not null then
      v_active := (rec ->> src.status_column) = any (src.active_status_values);
    end if;

    -- A row with no expiry, or no longer in an active status (a superseded
    -- medical, a voided document, a W-9 still merely requested), must LEAVE the
    -- ladder. Forgetting this branch is how a replaced document alerts forever.
    if v_exp is null or not v_active then
      delete from pilot.expirations
       where source_table  = tg_table_name
         and source_column = src.column_name
         and source_id     = v_id;
      continue;
    end if;

    insert into pilot.expirations as e (
      account_id, source_table, source_column, source_id,
      kind, label, expires_on, client_id, trip_id, projected_at
    )
    values (
      v_acct, tg_table_name, src.column_name, v_id,
      rec ->> src.kind_column,
      rec ->> src.label_column,
      v_exp,
      case when src.client_column is null then null
           else nullif(rec ->> src.client_column, '')::uuid end,
      case when src.trip_column is null then null
           else nullif(rec ->> src.trip_column, '')::uuid end,
      now()
    )
    on conflict (source_table, source_column, source_id) do update
      set account_id   = excluded.account_id,
          kind         = excluded.kind,
          label        = excluded.label,
          expires_on   = excluded.expires_on,
          client_id    = excluded.client_id,
          trip_id      = excluded.trip_id,
          projected_at = now();
  end loop;

  if n = 0 then
    -- Unreachable via declare_expiring_source(), the only thing that attaches
    -- this trigger. If it happens, someone attached it by hand or de-registered
    -- a live table. Fail loudly (C1: a blocked write says why).
    raise exception
      'pilot.project_expiration fired for table % which has no participating '
      'entry in pilot.expiring_sources. Use pilot.declare_expiring_source().',
      tg_table_name;
  end if;

  return new;
end;
$fn$;

comment on function pilot.project_expiration() is
  'The single projection code path required by C4. Attached to every '
  'participating source by pilot.declare_expiring_source(); driven entirely by '
  'pilot.expiring_sources metadata, so a new date-bearing table adds no trigger '
  'code. SECURITY DEFINER for the table-owner RLS exemption — see the FORCE ROW '
  'LEVEL SECURITY warning above the definition.';

revoke all on function pilot.project_expiration() from public;

-- ----------------------------------------------------------------------------
-- 2e. Backfill / repair
-- ----------------------------------------------------------------------------
-- Called by declare_expiring_source() (so registering a table that already has
-- rows is correct immediately) and available to the verify script as the repair
-- step branch (D) names in its error message.

create or replace function pilot.rebuild_expirations(
  p_table_name  text default null,
  p_column_name text default null
)
returns integer
language plpgsql
set search_path = ''
as $fn$
declare
  src           pilot.expiring_sources%rowtype;
  status_clause text;
  affected      integer := 0;
  n             integer;
begin
  for src in
    select * from pilot.expiring_sources
     where participates
       and (p_table_name  is null or table_name  = p_table_name)
       and (p_column_name is null or column_name = p_column_name)
     order by table_name, column_name
  loop
    status_clause := case
      when src.status_column is null then ''
      else pg_catalog.format(' and s.%I = any (%L::text[])',
                             src.status_column, src.active_status_values)
    end;

    execute pg_catalog.format($f$
      insert into pilot.expirations as e (
        account_id, source_table, source_column, source_id,
        kind, label, expires_on, client_id, trip_id, projected_at
      )
      select s.account_id, %L, %L, s.id, s.%I::text, s.%I::text, s.%I,
             %s, %s, now()
        from pilot.%I s
       where s.%I is not null %s
      on conflict (source_table, source_column, source_id) do update
        set account_id   = excluded.account_id,
            kind         = excluded.kind,
            label        = excluded.label,
            expires_on   = excluded.expires_on,
            client_id    = excluded.client_id,
            trip_id      = excluded.trip_id,
            projected_at = now()
    $f$,
      src.table_name, src.column_name,
      src.kind_column, src.label_column, src.column_name,
      coalesce('s.' || pg_catalog.quote_ident(src.client_column), 'null::uuid'),
      coalesce('s.' || pg_catalog.quote_ident(src.trip_column),   'null::uuid'),
      src.table_name, src.column_name, status_clause);
    get diagnostics n = row_count;
    affected := affected + n;

    -- Drop projections whose source row no longer qualifies (expiry cleared,
    -- status moved to superseded/void, row removed outside the trigger).
    execute pg_catalog.format($f$
      delete from pilot.expirations e
       where e.source_table  = %L
         and e.source_column = %L
         and not exists (
           select 1 from pilot.%I s
            where s.id = e.source_id and s.%I is not null %s
         )
    $f$, src.table_name, src.column_name, src.table_name, src.column_name,
         status_clause);
  end loop;

  return affected;
end;
$fn$;

revoke all on function pilot.rebuild_expirations(text, text) from public;
grant execute on function pilot.rebuild_expirations(text, text) to service_role;

-- ----------------------------------------------------------------------------
-- 2f. pilot.declare_expiring_source() / pilot.declare_not_an_expiry()
-- ----------------------------------------------------------------------------
-- The only two ways into the registry. Between them they make every date column
-- in the schema an explicit, reviewable decision.
--
-- NEITHER IS GRANTED TO service_role, and that is not an oversight.
-- declare_expiring_source() executes `create or replace trigger`, which requires
-- OWNERSHIP of the target table — service_role does not own pilot tables, so a
-- grant would produce a function that fails with "must be owner of relation"
-- the first time anyone called it from a script. These are MIGRATION-ROLE-ONLY
-- operations, which matches their only correct call site: immediately after the
-- CREATE TABLE, in the same migration. Do NOT "fix" that by marking
-- declare_expiring_source() SECURITY DEFINER — that would turn it into a
-- general-purpose primitive for attaching an owner-privileged trigger to an
-- arbitrary pilot table, one convenience grant away from `authenticated`.
-- pilot.rebuild_expirations() is the service_role-facing repair entry point and
-- it is a plain INSERT, so it works.

create or replace function pilot.declare_expiring_source(
  p_table_name           text,
  p_kind_column          text,
  p_label_column         text,
  p_column_name          text   default 'expires_on',
  p_status_column        text   default null,
  p_active_status_values text[] default null,
  p_client_column        text   default null,
  p_trip_column          text   default null
)
returns void
language plpgsql
set search_path = ''
as $fn$
declare
  rel     oid;
  c       text;
  coltype text;
  npol    integer;
  rls     boolean;
begin
  rel := pg_catalog.to_regclass('pilot.' || pg_catalog.quote_ident(p_table_name));
  if rel is null then
    raise exception
      'pilot.declare_expiring_source: table pilot.% does not exist. Declare it '
      'AFTER the create table, in the same migration.', p_table_name;
  end if;

  -- SHAPE. pilot.project_expiration() reads `id` and `account_id` out of the
  -- row, so those assumptions are checked here rather than discovered at 3am
  -- when a trigger throws.
  foreach c in array array[p_column_name, p_kind_column, p_label_column,
                           p_status_column, p_client_column, p_trip_column,
                           'id', 'account_id']
  loop
    if c is not null and not exists (
      select 1 from pg_catalog.pg_attribute a
       where a.attrelid = rel and a.attname = c
         and a.attnum > 0 and not a.attisdropped
    ) then
      raise exception
        'pilot.declare_expiring_source: pilot.% has no column %.', p_table_name, c;
    end if;
  end loop;

  -- TYPE. The expiry column must be a `date`. A timestamptz expiry would be
  -- converted to a calendar day through the session's TimeZone in both the
  -- trigger and the fidelity anti-join, so a writer and an asserter in
  -- different zones would disagree — and A10's own logic says a calendar-valued
  -- business fact is a date, not an instant. Refuse it here, at declare time,
  -- rather than half-handle it at write time.
  select pg_catalog.format_type(a.atttypid, a.atttypmod) into coltype
    from pg_catalog.pg_attribute a
   where a.attrelid = rel and a.attname = p_column_name;
  if coltype <> 'date' then
    raise exception
      'pilot.declare_expiring_source: pilot.%.% is % — an expiry column must be '
      '`date`.', p_table_name, p_column_name, coltype
      using hint = 'A10: calendar-valued business facts are dates, not instants. '
                   'A timestamptz expiry converts to a calendar day through the '
                   'session TimeZone and the ladder goes off by one.';
  end if;

  -- kind and label are projected into NOT NULL columns on pilot.expirations. If
  -- the source columns are nullable, a null lands as a not-null violation
  -- raised from inside a trigger on a table the user has never heard of.
  foreach c in array array[p_kind_column, p_label_column]
  loop
    if not exists (
      select 1 from pg_catalog.pg_attribute a
       where a.attrelid = rel and a.attname = c and a.attnotnull
    ) then
      raise exception
        'pilot.declare_expiring_source: pilot.%.% must be NOT NULL — it is '
        'projected into a NOT NULL column on pilot.expirations.', p_table_name, c;
    end if;
  end loop;

  -- TENANT SAFETY. Enrolment without isolation is worse than no enrolment: it
  -- publishes an unprotected table into a surface every tenant reads. Phase 1's
  -- default privileges make every new table in this schema readable by
  -- `authenticated` on creation, and CREATE TABLE does not enable RLS.
  select c2.relrowsecurity into rls from pg_catalog.pg_class c2 where c2.oid = rel;
  select count(*) into npol from pg_catalog.pg_policy p where p.polrelid = rel;
  if not rls or npol = 0 then
    raise exception
      'pilot.declare_expiring_source: pilot.% cannot join the expiration engine '
      '(RLS enabled: %, policies: %).', p_table_name, rls, npol
      using hint = 'alter table pilot.<t> enable row level security, and add at '
                   'least one policy scoped through pilot.current_account_ids(), '
                   'BEFORE declaring it. Enrolling a table with no RLS into a '
                   'shared expiry surface turns a missed reminder into a breach.';
  end if;

  insert into pilot.expiring_sources (
    table_name, column_name, participates, exemption_reason,
    kind_column, label_column, status_column, active_status_values,
    client_column, trip_column
  )
  values (
    p_table_name, p_column_name, true, null,
    p_kind_column, p_label_column, p_status_column, p_active_status_values,
    p_client_column, p_trip_column
  )
  on conflict (table_name, column_name) do update
    set participates         = true,
        exemption_reason     = null,
        kind_column          = excluded.kind_column,
        label_column         = excluded.label_column,
        status_column        = excluded.status_column,
        active_status_values = excluded.active_status_values,
        client_column        = excluded.client_column,
        trip_column          = excluded.trip_column;

  -- Fixed trigger name so assert_expiry_coverage() branch (B) can look for it.
  -- One trigger per TABLE however many columns participate — the function loops.
  execute pg_catalog.format(
    'create or replace trigger expiration_project '
    'after insert or update or delete on pilot.%I '
    'for each row execute function pilot.project_expiration()',
    p_table_name);

  perform pilot.rebuild_expirations(p_table_name, p_column_name);
end;
$fn$;

comment on function pilot.declare_expiring_source(text,text,text,text,text,text[],text,text) is
  'The ONLY supported way to enrol a date-bearing column in the A1 ladder. '
  'Validates the source table''s shape AND its tenant safety (RLS + policy), '
  'writes the registry row, attaches the one shared projection trigger, and '
  'backfills — atomically. Call it immediately after the CREATE TABLE and the '
  'RLS block, in the same migration, and end that migration with '
  'select pilot.assert_expiry_coverage(). MIGRATION-ROLE ONLY: it issues DDL '
  'that requires table ownership; do not grant it to service_role and do not '
  'make it SECURITY DEFINER.';

create or replace function pilot.declare_not_an_expiry(
  p_table_name  text,
  p_column_name text,
  p_reason      text
)
returns void
language plpgsql
set search_path = ''
as $fn$
declare
  rel oid;
begin
  rel := pg_catalog.to_regclass('pilot.' || pg_catalog.quote_ident(p_table_name));
  if rel is null then
    raise exception 'pilot.declare_not_an_expiry: table pilot.% does not exist.',
      p_table_name;
  end if;
  if not exists (
    select 1 from pg_catalog.pg_attribute a
     where a.attrelid = rel and a.attname = p_column_name
       and a.attnum > 0 and not a.attisdropped
  ) then
    raise exception 'pilot.declare_not_an_expiry: pilot.% has no column %.',
      p_table_name, p_column_name;
  end if;

  insert into pilot.expiring_sources (
    table_name, column_name, participates, exemption_reason
  )
  values (p_table_name, p_column_name, false, p_reason)
  on conflict (table_name, column_name) do update
    set participates         = false,
        exemption_reason     = excluded.exemption_reason,
        kind_column          = null,
        label_column         = null,
        status_column        = null,
        active_status_values = null,
        client_column        = null,
        trip_column          = null;

  execute pg_catalog.format(
    'drop trigger if exists expiration_project on pilot.%I', p_table_name);
  delete from pilot.expirations
   where source_table = p_table_name and source_column = p_column_name;

  -- Re-attach the trigger if OTHER columns on this table still participate.
  if exists (select 1 from pilot.expiring_sources
              where table_name = p_table_name and participates) then
    execute pg_catalog.format(
      'create or replace trigger expiration_project '
      'after insert or update or delete on pilot.%I '
      'for each row execute function pilot.project_expiration()',
      p_table_name);
  end if;
end;
$fn$;

comment on function pilot.declare_not_an_expiry(text, text, text) is
  'Records that a date-bearing column deliberately does NOT participate in the '
  'A1 ladder, with a written reason of at least 20 characters (enforced by a '
  'CHECK). This is the half of C4 that catches omissions: the reason has to be '
  'written by someone and can be read by someone else. MIGRATION-ROLE ONLY.';

revoke all on function pilot.declare_expiring_source(text,text,text,text,text,text[],text,text) from public;
revoke all on function pilot.declare_not_an_expiry(text, text, text) from public;

-- ----------------------------------------------------------------------------
-- 2g. pilot.assert_expiry_coverage() — THE C4 GATE
-- ----------------------------------------------------------------------------
-- Raises on the first problem it finds, with a message naming the column and
-- the fix (C1: a blocked write says why). Called at the end of every migration
-- and by `npm run expirations:verify`.
--
-- It must see every tenant's rows to compare source against projection, so it
-- is NOT granted to `authenticated` — that would be a cross-tenant row-count
-- oracle. Run it as the owner (migrations) or as service_role (verify script).

create or replace function pilot.assert_expiry_coverage()
returns void
language plpgsql
set search_path = ''
as $fn$
declare
  r             record;
  src           pilot.expiring_sources%rowtype;
  status_clause text;
  missing       bigint;
  extra         bigint;
  rls           boolean;
  npol          integer;
begin
  -- (A) COVERAGE — the default-deny scan. EVERY date/timestamp/timestamptz
  -- column in schema pilot must be in the registry, participating or exempted.
  --
  -- relkind covers ordinary ('r'), PARTITIONED ('p'), foreign ('f') and
  -- materialized ('m') relations. Scanning only 'r' is a real hole: a
  -- Phase 7 `currency_snapshots` partitioned by its own `valid_until` — the
  -- obvious physical design for a time-series table, and the exact table A1
  -- names as the next participant — would be relkind 'p' and silently invisible.
  -- relispartition is excluded so a declared parent does not raise once per
  -- partition.
  --
  -- Two column names are auto-exempt, and only two: created_at and updated_at.
  -- Adding a third is the erosion this comment refuses.
  --
  -- The three ENGINE tables are excluded because they ARE the engine:
  -- pilot.expirations holds a projected copy of somebody else's expiry, and
  -- registering it would make the projection project itself; expiring_sources
  -- and expiration_notices are its registry and its dispatch log. That is an
  -- exclusion of three named tables, not a class — a FOURTH name appearing here
  -- is a finding, not a special case.
  for r in
    select c.relname as table_name, a.attname as column_name,
           pg_catalog.format_type(a.atttypid, a.atttypmod) as coltype
      from pg_catalog.pg_class     c
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
      join pg_catalog.pg_attribute a on a.attrelid = c.oid
      join pg_catalog.pg_type      t on t.oid = a.atttypid
     where n.nspname = 'pilot'
       and c.relkind in ('r', 'p', 'f', 'm')
       and not c.relispartition
       and a.attnum > 0
       and not a.attisdropped
       and t.typname in ('date', 'timestamp', 'timestamptz')
       and a.attname not in ('created_at', 'updated_at')
       and c.relname not in ('expirations', 'expiring_sources', 'expiration_notices')
       and not exists (
             select 1 from pilot.expiring_sources s
              where s.table_name = c.relname and s.column_name = a.attname)
     order by 1, 2
  loop
    raise exception
      'EXPIRY COVERAGE FAILURE (C4): pilot.%.% is a % column with no entry in '
      'pilot.expiring_sources. Every date-bearing column in this schema must be '
      'an explicit decision: wire it in with '
      'pilot.declare_expiring_source(''%'', <kind_col>, <label_col>, ''%'') or '
      'record why it is not an expiry with '
      'pilot.declare_not_an_expiry(''%'', ''%'', ''<reason>''). This default-deny '
      'scan is the mechanism that prevents the audited failure — a date-bearing '
      'record type in another module that nobody wired into the ladder.',
      r.table_name, r.column_name, r.coltype,
      r.table_name, r.column_name, r.table_name, r.column_name;
  end loop;

  for src in select * from pilot.expiring_sources where participates
             order by table_name, column_name
  loop
    -- (B) WIRING. A registry row without its trigger is worse than no registry
    -- row, because it LOOKS covered.
    if pg_catalog.to_regclass('pilot.' || pg_catalog.quote_ident(src.table_name)) is null then
      raise exception
        'EXPIRY WIRING FAILURE: pilot.expiring_sources names pilot.%, which does '
        'not exist.', src.table_name;
    end if;
    if not exists (
      select 1 from pg_catalog.pg_trigger g
       where g.tgrelid = pg_catalog.to_regclass('pilot.' || pg_catalog.quote_ident(src.table_name))
         and g.tgname = 'expiration_project'
         and not g.tgisinternal
    ) then
      raise exception
        'EXPIRY WIRING FAILURE: pilot.% is registered but carries no '
        '`expiration_project` trigger. Re-run pilot.declare_expiring_source().',
        src.table_name;
    end if;

    -- (E) TENANT SAFETY, re-asserted. declare_expiring_source() checks this at
    -- enrolment; this catches a later `alter table ... disable row level
    -- security` or a dropped policy, which would otherwise silently publish a
    -- participating table to every authenticated user.
    select c2.relrowsecurity into rls
      from pg_catalog.pg_class c2
     where c2.oid = pg_catalog.to_regclass('pilot.' || pg_catalog.quote_ident(src.table_name));
    select count(*) into npol
      from pg_catalog.pg_policy p
     where p.polrelid = pg_catalog.to_regclass('pilot.' || pg_catalog.quote_ident(src.table_name));
    if not rls or npol = 0 then
      raise exception
        'EXPIRY TENANT-SAFETY FAILURE: pilot.% participates in the expiration '
        'engine but has RLS enabled = %, policies = %.', src.table_name, rls, npol;
    end if;

    status_clause := case
      when src.status_column is null then ''
      else pg_catalog.format(' and s.%I = any (%L::text[])',
                             src.status_column, src.active_status_values)
    end;

    -- (D) FIDELITY. Two-way anti-join: every qualifying source row has a
    -- projection with matching values, and every projection row has a
    -- qualifying source row. This is what turns "the ladder is correct" from a
    -- claim into an assertion (C2).
    execute pg_catalog.format($f$
      select count(*) from pilot.%I s
       where s.%I is not null %s
         and not exists (
           select 1 from pilot.expirations e
            where e.source_table  = %L
              and e.source_column = %L
              and e.source_id     = s.id
              and e.account_id    = s.account_id
              and e.expires_on    = s.%I
              and e.kind          = s.%I::text
              and e.label         = s.%I::text
         )
    $f$, src.table_name, src.column_name, status_clause,
         src.table_name, src.column_name, src.column_name,
         src.kind_column, src.label_column)
    into missing;

    execute pg_catalog.format($f$
      select count(*) from pilot.expirations e
       where e.source_table  = %L
         and e.source_column = %L
         and not exists (
           select 1 from pilot.%I s
            where s.id = e.source_id and s.%I is not null %s
         )
    $f$, src.table_name, src.column_name, src.table_name, src.column_name,
         status_clause)
    into extra;

    if missing > 0 or extra > 0 then
      raise exception
        'EXPIRY DRIFT FAILURE for pilot.%.%: % source row(s) missing from '
        'pilot.expirations, % projection row(s) with no qualifying source. Run '
        'select pilot.rebuild_expirations(''%'', ''%'') and then find out what '
        'wrote around the trigger.',
        src.table_name, src.column_name, missing, extra,
        src.table_name, src.column_name;
    end if;
  end loop;

  -- (C) ORPHANS. A projection row whose source is registered-but-not-
  -- participating, or gone.
  if exists (
    select 1 from pilot.expirations e
     where not exists (
       select 1 from pilot.expiring_sources s
        where s.table_name = e.source_table
          and s.column_name = e.source_column
          and s.participates)
  ) then
    raise exception
      'EXPIRY ORPHAN FAILURE: pilot.expirations holds rows for a source that is '
      'not a participating registry entry.';
  end if;
end;
$fn$;

comment on function pilot.assert_expiry_coverage() is
  'THE C4 GATE. Raises unless every date-bearing column in schema pilot is '
  'either wired into the expiration engine or exempted with a written reason, '
  'every participant carries its projection trigger AND has RLS with at least '
  'one policy, and every projection row matches its source exactly. EVERY '
  'MIGRATION IN THIS REPO MUST END WITH `select pilot.assert_expiry_coverage();` '
  '— that is what makes forgetting to wire a new date column abort the '
  'migration instead of silently disabling alerts.';

create or replace function pilot.expiry_coverage_report()
returns table (table_name text, column_name text, participates boolean,
               projected_rows bigint, note text)
language sql
stable
set search_path = ''
as $$
  select s.table_name,
         s.column_name,
         s.participates,
         (select count(*) from pilot.expirations e
           where e.source_table = s.table_name
             and e.source_column = s.column_name),
         coalesce(s.exemption_reason, 'wired: kind=' || s.kind_column ||
                                      ', label=' || s.label_column)
    from pilot.expiring_sources s
   order by s.participates desc, s.table_name, s.column_name;
$$;

revoke all on function pilot.assert_expiry_coverage() from public;
revoke all on function pilot.expiry_coverage_report() from public;
grant execute on function pilot.assert_expiry_coverage() to service_role;
grant execute on function pilot.expiry_coverage_report() to service_role;


-- ############################################################################
-- SECTION 3 — pilot.clients (Phase 3)
-- ############################################################################
-- docs/PLAN.md: "no existing table represents a customer of a pilot. That is
-- the central gap." This is that table.
--
-- A4 config-once rates: the default_* columns pre-fill NEW trips. They are NOT
-- the rate of any existing trip — pilot.trips SNAPSHOTS its own, so
-- renegotiating never rewrites money on work already flown. Two columns holding
-- a similar-looking number and answering DIFFERENT questions is not a C2
-- violation; do not "normalise" trips to reference these.
--
-- W-9 IS DELIBERATELY NOT A COLUMN HERE, though docs/PLAN.md sketches
-- `clients.w9_status` and a sent date. A W-9 is a dated document with a
-- counterparty — exactly what pilot.documents models — and a status column here
-- as well guarantees the two disagree the first time someone uploads a W-9
-- without touching the client row (C2). "W-9 outstanding" in the queue is a
-- documents row with status = 'requested' carrying requested_at; "W-9 on file"
-- for the paperwork gate is the same row at status = 'on_file'. ONE source, and
-- it is per-client, so a re-issued W-9 cannot read as covering a client who was
-- only ever sent the old one.
-- PLAN.md AMENDMENT: this deviates from PLAN.md's clients row. Recorded here
-- and in the amendments block at the end of this file rather than left as a
-- silent disagreement between a locked doc and the shipped schema.

create table pilot.clients (
  id                        uuid primary key default gen_random_uuid(),
  account_id                uuid not null references pilot.accounts (id) on delete cascade,

  name                      text not null check (length(btrim(name)) > 0),
  legal_name                text,
  contact_name              text,
  contact_email             text check (contact_email is null or contact_email like '%@%'),
  contact_phone             text,

  billing_address_line1     text,
  billing_address_line2     text,
  billing_city              text,
  billing_state             text,
  billing_postal_code       text,
  billing_country           text,

  -- A4. NULL means "no default agreed", which is a different fact from zero and
  -- must stay distinguishable — hence nullable rather than defaulted to 0.
  default_day_rate_cents    bigint check (default_day_rate_cents >= 0),
  default_per_diem_cents    bigint check (default_per_diem_cents >= 0),
  -- Only the two DECIDED values: 'unassigned' is a state a receipt lands in,
  -- not a policy anyone would configure.
  default_expense_treatment text check (default_expense_treatment in ('rebill', 'deduct')),

  payment_terms_days        integer not null default 30
                              check (payment_terms_days between 0 and 365),

  -- C10: tax supported on invoice lines FROM Phase 5, not retrofitted. Basis
  -- points as an integer, so the no-float rule stays absolute. Phase 5
  -- SNAPSHOTS these onto the line, exactly as trips snapshot the day rate — a
  -- rate change must never restate an issued invoice.
  default_tax_rate_bp       integer not null default 0
                              check (default_tax_rate_bp between 0 and 10000),
  tax_label                 text,

  notes                     text,

  -- Soft retirement. Hard delete stays available (A12's type-DELETE flow) but
  -- is blocked by ON DELETE RESTRICT once the client has trips, which is
  -- correct and must surface as a specific, visible failure (C1) rather than be
  -- worked around by cascading a client's entire billing history away.
  archived_at               timestamptz,

  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),

  -- The referenced key for every composite FK pointing at a client. NOT
  -- redundant with the primary key: it is what makes
  -- `foreign key (client_id, account_id)` possible, which is what stops a trip
  -- in tenant A from pointing at a client in tenant B.
  unique (id, account_id)
);

comment on table pilot.clients is
  'The pilot''s own customers. Never surfaced to AMG by any policy or code '
  'path. Carries the config-once rate and terms defaults (A4) that pre-fill '
  'trips; the rate governing a flown trip is snapshotted on pilot.trips.';

create index if not exists clients_account_name_idx
  on pilot.clients (account_id, name);
-- The client picker and the clients list read active rows only.
create index if not exists clients_account_active_name_idx
  on pilot.clients (account_id, name) where archived_at is null;
-- Two ACTIVE clients with the same name in one book is a data-entry error, so
-- it is a constraint. Partial, so archive-then-re-add still works.
create unique index if not exists clients_account_active_name_key
  on pilot.clients (account_id, lower(btrim(name))) where archived_at is null;

create or replace trigger clients_set_updated_at
  before update on pilot.clients
  for each row execute function pilot.set_updated_at();
create or replace trigger clients_freeze_tenancy
  before update on pilot.clients
  for each row execute function pilot.freeze_tenancy_columns();


-- ############################################################################
-- SECTION 4 — pilot.trips (Phase 3) — the financial atom (A2)
-- ############################################################################
-- SNAPSHOT VS CACHE — the distinction that decides half this table.
--   day_rate_cents and per_diem_cents are COPIED from the client record at trip
--   creation (A4). That is a SNAPSHOT, not a cache, and it must never be "kept
--   in sync". The rate on a trip is the rate agreed for that job; raising your
--   default day rate in January must not silently rewrite what last October's
--   trips were worth. A cache has an authoritative source elsewhere and can be
--   recomputed; a snapshot IS the source. Do not add a refresh trigger.
--
--   day_count is likewise NOT derived from legs or from the date range.
--   Contract-pilot days are a NEGOTIATED unit: a two-day trip can be one leg, a
--   repositioning day can be zero legs, a weather day is billable with nothing
--   flown, and two calendar days are sometimes billed as three. The calendar
--   span and the billable day count are DIFFERENT NUMBERS.
--
--   per_diem_days is SEPARATE from day_count for the same reason one level
--   down: per-diem days and billable days routinely differ (three days billed,
--   two nights away). Multiplying per diem by day_count would weld in a billing
--   rule that does not universally exist — the exact error the day_count
--   decision above refuses.
--
-- WHAT IS DELIBERATELY ABSENT:
--   * `billing_state`. docs/PLAN.md sketches it and it is a defect. "Is this
--     trip invoiced" has exactly one true answer and it lives on Phase 5's
--     invoice lines; a denormalised copy here goes stale the first time an
--     invoice is voided, and that is precisely the audited failure (their P&L
--     showed -$50k against a payments ledger of ~+$580k).
--     PLAN.md AMENDMENT — recorded in the block at the end of this file.
--   * Any readiness, release, FRAT, airworthiness or fit-for-duty column. Ever.
--     LOCKED liability boundary (docs/PLAN.md; INSPIRATION §D).
--   * Any stored total, margin or net. See pilot.trip_financials.

create table pilot.trips (
  id             uuid primary key default gen_random_uuid(),
  account_id     uuid not null references pilot.accounts (id) on delete cascade,

  -- Human reference (TRP-0114). Allocated by trigger; NOT client-writable —
  -- a tenant able to set it could produce two trips with the same reference, or
  -- collide with a number an invoice already cites.
  trip_number    integer not null,

  -- NOT NULL on purpose. A trip is a JOB and a job has a customer; the margin
  -- rollup, the client statement and the invoice all assume one. Personal
  -- flying is a Phase 6 logbook entry with no trip, which is its correct home.
  -- The cost: a pilot flying an owner_trip must have a client record for the
  -- owner — which they need anyway in order to invoice.
  client_id      uuid not null,

  title          text,

  -- Ported VERBATIM from docs/PLAN.md "Verified ground truth". Enum drift is a
  -- named risk; do not half-copy this list.
  trip_kind      text not null check (trip_kind in (
                   'owner_trip', 'ferry', 'maintenance_flight', 'repositioning',
                   'contract_pilot', 'delivery_flight', 'other')),

  -- The lifecycle of the WORK. Not the paperwork, not the money — both derived.
  -- A record of what happened, never a clearance.
  status         text not null default 'scheduled'
                   check (status in ('scheduled', 'flown', 'canceled')),

  start_date     date not null,
  end_date       date not null,

  aircraft_ident text check (aircraft_ident is null or
                   (aircraft_ident = upper(aircraft_ident)
                    and aircraft_ident ~ '^[A-Z0-9-]{2,10}$')),
  aircraft_type  text,

  -- NULLABLE WITH NO DEFAULT, matching pilot.clients' reasoning: "not yet
  -- priced" and "worth zero" are different facts. A NOT NULL DEFAULT 0 here
  -- would let a flown trip read as a legitimate $0 job, invisible to every
  -- queue. pilot.trip_financials returns NULL totals for an unpriced trip so
  -- nothing renders a confident wrong number, and pilot.needs_attention carries
  -- an `unpriced_trip` branch so the pilot is chased about it (A8).
  day_count      numeric(6,2) check (day_count >= 0),
  day_rate_cents bigint       check (day_rate_cents >= 0),
  per_diem_days  numeric(6,2) check (per_diem_days >= 0),
  per_diem_cents bigint       check (per_diem_cents >= 0),

  notes          text,

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  constraint trips_end_after_start check (end_date >= start_date),

  unique (account_id, trip_number),
  unique (id, account_id),

  constraint trips_client_fk foreign key (client_id, account_id)
    references pilot.clients (id, account_id)
    on update restrict on delete restrict
);

comment on table pilot.trips is
  'The parent record and the product''s financial atom (A2). Every money figure '
  'is computed in pilot.trip_financials and NOWHERE ELSE; paperwork state is in '
  'pilot.trip_paperwork; operational readiness does not exist in this product '
  'at all (locked liability boundary).';

comment on column pilot.trips.day_rate_cents is
  'SNAPSHOT of the rate agreed for this job at trip creation, NOT a cache of '
  'pilot.clients.default_day_rate_cents. Never refresh it from the client '
  'record: that retroactively rewrites historical trip value.';

comment on column pilot.trips.per_diem_days is
  'Per-diem days, negotiated SEPARATELY from day_count. Do not derive one from '
  'the other — three billed days with two nights away is an ordinary contract.';

create index if not exists trips_account_start_idx
  on pilot.trips (account_id, start_date desc);
-- Ready to Invoice / Unbilled Work. Partial on the only status that can BE
-- unbilled work, so the Overview query is a short range scan rather than a
-- filter over every trip the pilot has ever flown.
create index if not exists trips_account_flown_idx
  on pilot.trips (account_id, end_date desc) where status = 'flown';
create index if not exists trips_account_client_idx
  on pilot.trips (account_id, client_id, start_date desc);

create or replace trigger trips_set_updated_at
  before update on pilot.trips
  for each row execute function pilot.set_updated_at();
create or replace trigger trips_freeze_tenancy
  before update on pilot.trips
  for each row execute function pilot.freeze_tenancy_columns();

-- Trip numbering. SECURITY DEFINER so it can reach pilot.document_sequences,
-- which no tenant may write. account_id comes from the row being inserted and
-- RLS has already constrained that to the caller's own account, so this cannot
-- be used to burn another tenant's numbers.
create or replace function pilot.assign_trip_number()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.trip_number is null then
    new.trip_number := pilot.next_document_number(new.account_id, 'trip');
  end if;
  return new;
end;
$$;

revoke all on function pilot.assign_trip_number() from public;

create or replace trigger trips_assign_number
  before insert on pilot.trips
  for each row execute function pilot.assign_trip_number();

-- ----------------------------------------------------------------------------
-- Billing-input immutability. The snapshot rationale above is only worth
-- anything if the snapshot cannot be silently rewritten afterwards: day_count,
-- day_rate_cents, per_diem_days and per_diem_cents are all in the tenant UPDATE
-- grant, so without this trigger a completed trip's money can be restated at
-- any time and the client statement regenerates with different numbers and no
-- record that anything changed. Once an invoice exists (Phase 5) the same
-- divergence is the audited P&L-vs-ledger failure with a customer holding one
-- of the two documents.
-- Corrections are still possible — they just have to be an EXPLICIT act: move
-- the trip back to 'scheduled', edit, move it to 'flown' again. That leaves a
-- status transition the app can log, instead of a silent field edit.
-- PHASE 5 EXTENDS THIS FUNCTION: also raise when a SENT invoice references the
-- trip, regardless of status.
-- ----------------------------------------------------------------------------
create or replace function pilot.freeze_trip_billing_inputs()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user <> 'service_role'
     and old.status = 'flown'
     and (   new.day_count      is distinct from old.day_count
          or new.day_rate_cents is distinct from old.day_rate_cents
          or new.per_diem_days  is distinct from old.per_diem_days
          or new.per_diem_cents is distinct from old.per_diem_cents) then
    raise exception
      'pilot.trips %: billing inputs are frozen while status = ''flown''',
      old.id
      using hint = 'Set status back to ''scheduled'', correct the figures, then '
                   'set it to ''flown'' again — a restatement of agreed money '
                   'should be an explicit act, not a field edit.';
  end if;
  return new;
end;
$$;

revoke all on function pilot.freeze_trip_billing_inputs() from public;

create or replace trigger trips_freeze_billing_inputs
  before update on pilot.trips
  for each row execute function pilot.freeze_trip_billing_inputs();


-- ############################################################################
-- SECTION 5 — pilot.trip_legs (Phase 3; feeds Phase 6)
-- ############################################################################
-- A10 — NO TIMEZONE COLUMN. out_time_utc / in_time_utc are absolute instants;
-- airport-local and Zulu are both DERIVED at display time from the ICAO code.
-- If you are about to add `timezone`, `tz_offset` or `local_date`, the answer is
-- the airport reference dataset in application code, not a column.
--
-- `flown_on` is NOT that column. It is the pilot-entered business date — the
-- date that goes in a logbook — and it exists because a leg is routinely
-- entered at the airplane before its times are known, and a multi-day trip
-- cannot date such a leg from its parent's range. Once out_time_utc exists the
-- LOCAL date is derived from the instant plus the ident for display; flown_on
-- remains the logbook date and is never a second opinion about the local date.
-- INVARIANT for the verify script (not expressible as a CHECK, since it spans
-- rows): flown_on falls within its trip's [start_date, end_date].
--
-- PHASE 6, CHEAP NOW AND RUINOUS LATER: the landing/takeoff breakdown is the
-- single most expensive thing here to retrofit, because retrofitting means
-- asking a pilot to re-derive months of night full-stop landings from memory.
-- docs/PLAN.md records that AMG's existing logbook schema CANNOT compute FAR
-- 61.57(b) for exactly this reason — night_landings with no full-stop flag and
-- no night takeoff count. Fixed here, at the source, for the cost of six
-- smallints. Time is stored in whole MINUTES; Phase 6 derives decimal hours at
-- read time and must never store them.

create table pilot.trip_legs (
  id           uuid primary key default gen_random_uuid(),
  account_id   uuid not null references pilot.accounts (id) on delete cascade,
  trip_id      uuid not null,

  -- Authoritative ordering. A leg can be entered before its times are known, so
  -- ordering cannot depend on out_time_utc.
  leg_seq      smallint not null check (leg_seq > 0),

  flown_on     date not null,

  -- 3-4 uppercase alphanumerics covers ICAO (KTEB) and the FAA identifiers
  -- pilots actually file to — '^[A-Z]{4}$' would reject 0S9, 1G4, L35. The
  -- CHECK REJECTS lowercase rather than a trigger silently upper-casing it: C1
  -- says every mutation ends in a visible success or a visible, specific
  -- failure, and a trigger that quietly rewrites input is how "I typed kteb and
  -- it saved something else" starts. The client normalises on input.
  from_icao    text not null check (from_icao ~ '^[A-Z0-9]{3,4}$'),
  to_icao      text not null check (to_icao   ~ '^[A-Z0-9]{3,4}$'),

  out_time_utc timestamptz,
  in_time_utc  timestamptz,

  -- Per-leg override; null means "use pilot.trips.aircraft_ident". Resolution
  -- is coalesce(leg, trip) — one value with a documented override, not two
  -- sources.
  aircraft_ident text check (aircraft_ident is null or
                   (aircraft_ident = upper(aircraft_ident)
                    and aircraft_ident ~ '^[A-Z0-9-]{2,10}$')),

  -- The single stored source of duration. Stored rather than generated because
  -- a pilot routinely logs block time from the Hobbs without recording exact
  -- clock times; where both clock times ARE present, the CHECK below forces
  -- agreement, so the entered and derived values cannot diverge (C2). The
  -- database closes it, not a convention.
  block_minutes             integer  check (block_minutes >= 0),

  night_minutes             integer  check (night_minutes >= 0),
  actual_instrument_minutes integer  check (actual_instrument_minutes >= 0),
  simulated_instrument_minutes integer check (simulated_instrument_minutes >= 0),

  -- FAR 61.57(c) requires an approach COUNT.
  approach_count            smallint check (approach_count >= 0),
  holds                     smallint check (holds >= 0),

  -- FAR 61.57(a)/(b): full-stop vs touch-and-go, day and night, plus night
  -- takeoffs. All five are required to compute currency and none is derivable
  -- from the others.
  day_landings_full_stop      smallint check (day_landings_full_stop >= 0),
  day_landings_touch_and_go   smallint check (day_landings_touch_and_go >= 0),
  night_landings_full_stop    smallint check (night_landings_full_stop >= 0),
  night_landings_touch_and_go smallint check (night_landings_touch_and_go >= 0),
  night_takeoffs              smallint check (night_takeoffs >= 0),

  remarks      text,

  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  -- ACCOUNT-SCOPED, and that is load-bearing, not stylistic. `unique (trip_id,
  -- leg_seq)` — the obvious form — is a CROSS-TENANT EXISTENCE ORACLE: both
  -- columns are tenant-writable, Postgres checks unique indexes during heap
  -- insert BEFORE the AFTER-ROW trigger that enforces the composite FK, so
  -- inserting against another tenant's trip id returns "duplicate key" when a
  -- leg exists at that sequence and "foreign key violation" when it does not.
  -- Walking leg_seq then counts another tenant's legs for any trip id that
  -- leaks. Leading with account_id makes the two failures indistinguishable and
  -- is also the better index under RLS.
  -- THE GENERAL RULE, for the verify script: every UNIQUE constraint on a
  -- tenant-writable column set must carry account_id.
  unique (account_id, trip_id, leg_seq),
  unique (id, account_id),

  -- ON DELETE CASCADE because a leg has no meaning without its trip — unlike
  -- expenses and documents, which are independent artifacts and are RESTRICTed.
  constraint trip_legs_trip_fk foreign key (trip_id, account_id)
    references pilot.trips (id, account_id)
    on update restrict on delete cascade,

  constraint trip_legs_times_ordered
    check (out_time_utc is null or in_time_utc is null
           or in_time_utc >= out_time_utc),

  constraint trip_legs_block_matches_times
    check (out_time_utc is null
           or in_time_utc is null
           or (block_minutes is not null
               and block_minutes =
                   (extract(epoch from (in_time_utc - out_time_utc)) / 60)::integer)),

  constraint trip_legs_night_within_block
    check (night_minutes is null or block_minutes is null
           or night_minutes <= block_minutes),
  constraint trip_legs_instrument_within_block
    check (actual_instrument_minutes is null or block_minutes is null
           or actual_instrument_minutes <= block_minutes)
);

comment on table pilot.trip_legs is
  'Legs of a trip. A10: times stored UTC, displayed in the airport-local zone '
  'derived from the ident plus Zulu. THERE IS NO TIMEZONE COLUMN AND THERE MUST '
  'NEVER BE ONE. The landing/takeoff breakdown exists from day one because FAR '
  '61.57(b) is uncomputable without it and cannot be reconstructed after the '
  'fact.';

comment on column pilot.trip_legs.flown_on is
  'The pilot-entered logbook date for this leg. NOT a derived local date and '
  'NOT a timezone: once out_time_utc exists the local date is derived from the '
  'instant plus from_icao for display, and this column stays the logbook date.';

create index if not exists trip_legs_account_trip_idx
  on pilot.trip_legs (account_id, trip_id, leg_seq);
create index if not exists trip_legs_account_flown_idx
  on pilot.trip_legs (account_id, flown_on desc);

create or replace trigger trip_legs_set_updated_at
  before update on pilot.trip_legs
  for each row execute function pilot.set_updated_at();
create or replace trigger trip_legs_freeze_tenancy
  before update on pilot.trip_legs
  for each row execute function pilot.freeze_tenancy_columns();


-- ############################################################################
-- SECTION 6 — pilot.trip_participants — requirement B6, made structural
-- ############################################################################
-- "Trip participants are DATA, not identities; account_members stays the only
-- auth model." A comment saying so is not enforcement — a table with NOWHERE TO
-- PUT A user_id is. THERE IS NO user_id COLUMN HERE AND THERE MUST NEVER BE
-- ONE: a participant who needs to log in gets a pilot.account_members row.
-- Adding `user_id uuid references auth.users` here IS the identity-model drift
-- docs/PLAN.md names as a standing risk (amg1 already carries users vs profiles
-- duplication).
-- INVARIANT for the verify script: no table in schema pilot except
-- pilot.account_members has a foreign key to auth.users.
--
-- The crew_role vocabulary has NO passenger value, deliberately: passenger
-- manifests are rejected scope (§D), and this CHECK is what keeps them out
-- rather than a review comment.

create table pilot.trip_participants (
  id           uuid primary key default gen_random_uuid(),
  account_id   uuid not null references pilot.accounts (id) on delete cascade,
  trip_id      uuid not null,
  display_name text not null check (length(btrim(display_name)) > 0),
  crew_role    text not null
                 check (crew_role in ('pic', 'sic', 'instructor',
                                      'check_airman', 'other_crew')),
  notes        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  unique (id, account_id),
  constraint trip_participants_trip_fk foreign key (trip_id, account_id)
    references pilot.trips (id, account_id)
    on update restrict on delete cascade
);

comment on table pilot.trip_participants is
  'Other crew on a trip, as DATA (B6). NO user_id column, ever — '
  'pilot.account_members is the only identity model in this product. No '
  'passenger role: passenger manifests are rejected scope (§D).';

create index if not exists trip_participants_account_trip_idx
  on pilot.trip_participants (account_id, trip_id);

create or replace trigger trip_participants_set_updated_at
  before update on pilot.trip_participants
  for each row execute function pilot.set_updated_at();
create or replace trigger trip_participants_freeze_tenancy
  before update on pilot.trip_participants
  for each row execute function pilot.freeze_tenancy_columns();


-- ############################################################################
-- SECTION 7 — pilot.expenses (Phase 4)
-- ############################################################################
-- A3 is the whole point of this table: `treatment` is asked ONCE, at capture,
-- and every downstream surface DERIVES from it — the client-facing expense
-- report is treatment='rebill', the internal copy is everything, the deduction
-- file is 'deduct', the queue is 'unassigned', the margin rollup reads the same
-- column, and the year-end packet reads it again. ONE column, five
-- consequences. A sixth behaviour derives from this column or it does not ship.
-- There is deliberately no is_billable, no include_in_margin, no per-report
-- override flag.
--
-- "Never re-asked" is a UI rule, not immutability. The unassigned queue exists
-- precisely so treatment gets SET later, for receipts photographed at the pump —
-- so it IS in the UPDATE grant. What must never happen is a SECOND surface
-- asking the same question and storing the answer somewhere else.
--
-- MODELLING ASSUMPTION, STATED BECAUSE THE MARGIN ARITHMETIC DEPENDS ON IT:
-- every row here is money THE PILOT PAID. A ticket the client bought on their
-- own card is not the pilot's record and is not entered. That is what makes
-- pilot.trip_financials.trip_margin_cents correct — see the view. If client-paid
-- costs ever need representing, the deliberate change is a FOURTH treatment
-- value ('pass_through'), not a second payer column: two axes would re-open
-- exactly the one-tag discipline A3 exists to protect. Recorded as an open
-- question rather than guessed at.
--
-- KNOWN GAP: no rebill markup and no partial rebill. An expense is rebilled at
-- cost. A second amount column would be a second source for one expense (C2);
-- the right fix later is an invoice line, not a column here.

create table pilot.expenses (
  id            uuid primary key default gen_random_uuid(),
  account_id    uuid not null references pilot.accounts (id) on delete cascade,

  -- Nullable by design: a receipt exists before it is assigned to anything, and
  -- a deductible business expense (a headset, insurance, a subscription) may
  -- never belong to a trip at all.
  trip_id       uuid,

  -- THE CASH-BASIS ANCHOR (C3), named for what it is so nobody reaches for
  -- created_at, which is never a money date.
  incurred_on   date not null,

  -- Ported VERBATIM from docs/PLAN.md "Verified ground truth". Do not extend
  -- casually: every added value is a new row in the accountant packet.
  category      text not null check (category in (
                  'airline', 'hotel', 'rental_car', 'rideshare', 'fuel',
                  'meals', 'parking', 'other')),

  merchant      text,
  description   text,

  -- SIGNED on purpose. A refund or partial credit is a NEGATIVE row carrying
  -- the SAME treatment as the original, so every rollup nets automatically and
  -- no surface needs a second "credits" concept that would have to be taught
  -- separately to the margin view, the client report, the deduction file and
  -- the year-end packet. Zero is always a defect and is rejected.
  -- CONSEQUENCE, stated because it is a real footgun: report authors must SUM,
  -- never SUM(abs(...)), and a negative 'deduct' row increases trip margin.
  amount_cents  bigint not null check (amount_cents <> 0),

  -- A3, locked vocabulary. 'unassigned' is what a photographed receipt IS until
  -- the pilot says otherwise, and the unassigned queue is a first-class surface
  -- because those receipts are neither billed nor deducted — that is the point.
  treatment     text not null default 'unassigned'
                  check (treatment in ('rebill', 'deduct', 'unassigned')),

  -- Supabase Storage OBJECT PATH, not a URL. Signed URLs expire; storing one
  -- produces dead links in exports and in the client-facing expense report.
  --
  -- THE CHECK IS THE POINT. Every other cross-object reference in this schema
  -- carries account_id through a composite FK; this pointer leaves the database,
  -- so it carries tenancy through a constraint instead. Without it a tenant can
  -- store ANOTHER TENANT'S object path in their own row — and the standard
  -- Next.js download pattern (server route reads the row, service-role client
  -- signs the path) bypasses storage RLS entirely and would happily sign it.
  -- The '..' clause defeats traversal against a naive prefix policy.
  -- STILL NOT COVERED BY THIS MIGRATION, and a real hole until the Phase 4
  -- storage migration lands: the OBJECT itself. Postgres RLS does not reach
  -- storage.objects. The table being isolated is NOT the same as the file being
  -- isolated; storage needs its own account-prefixed policies and
  -- `tenancy:verify` must assert tenant A cannot fetch tenant B's receipt.
  storage_path        text,
  receipt_uploaded_at timestamptz,

  notes         text,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint expenses_storage_path_tenancy
    check (storage_path is null
           or (storage_path like account_id::text || '/%'
               and storage_path not like '%..%')),

  unique (id, account_id),

  -- ON DELETE RESTRICT: not cascade, not set-null. An expense is an independent
  -- financial artifact with a receipt attached. Deleting a trip must not
  -- silently destroy it and must not silently detach it into the unassigned
  -- queue either. It fails, visibly and specifically (C1), and the pilot
  -- decides. CONSEQUENCE: a cascade from pilot.accounts may abort depending on
  -- processing order, so account closure (deferred in docs/PLAN.md) must delete
  -- children explicitly, in dependency order.
  constraint expenses_trip_fk foreign key (trip_id, account_id)
    references pilot.trips (id, account_id)
    on update restrict on delete restrict,

  -- You cannot re-bill an expense to nobody. This is also what makes
  -- trip_financials.billable_cents complete BY CONSTRUCTION: every rebilled cent
  -- in the account is provably attached to exactly one trip.
  constraint expenses_rebill_needs_trip
    check (treatment <> 'rebill' or trip_id is not null)
);

comment on table pilot.expenses is
  'A3: `treatment` is the single classification, set at capture, that drives '
  'margin inclusion, report variant, the unassigned queue, the client statement '
  'and the deduction file. No downstream surface re-asks and none stores its own '
  'copy. Every row here is money the PILOT paid — see the modelling assumption '
  'above the table in the migration, which the margin arithmetic depends on.';

comment on column pilot.expenses.incurred_on is
  'Cash-basis anchor (C3). created_at is never a money date.';
comment on column pilot.expenses.amount_cents is
  'Signed. Negative rows are credits/refunds carrying the same treatment. '
  'Reports SUM, never SUM(abs()).';
comment on column pilot.expenses.storage_path is
  'Supabase Storage object path, constrained to this row''s own account prefix. '
  'The OBJECT is not protected by this migration — storage.objects needs its own '
  'account-scoped RLS policies.';

create index if not exists expenses_account_date_idx
  on pilot.expenses (account_id, incurred_on desc);
create index if not exists expenses_account_trip_idx
  on pilot.expenses (account_id, trip_id) where trip_id is not null;
-- The unassigned queue. Partial, so it stays a few pages regardless of how many
-- thousands of settled receipts sit behind it — this runs on every Overview
-- render.
create index if not exists expenses_unassigned_idx
  on pilot.expenses (account_id, incurred_on desc) where treatment = 'unassigned';
-- The "Deductible Expenses" KPI and the year-end packet, both a tax-year range
-- over deducted rows only.
create index if not exists expenses_account_deduct_idx
  on pilot.expenses (account_id, incurred_on) where treatment = 'deduct';

create or replace trigger expenses_set_updated_at
  before update on pilot.expenses
  for each row execute function pilot.set_updated_at();
create or replace trigger expenses_freeze_tenancy
  before update on pilot.expenses
  for each row execute function pilot.freeze_tenancy_columns();


-- ############################################################################
-- SECTION 8 — pilot.documents — the first expiration source
-- ############################################################################
-- Every date-bearing credential and every piece of counterparty paperwork:
-- medical, flight review, passport, certificates, W-9.
--
-- SCOPE. A document belongs to the ACCOUNT, and is optionally about one CLIENT
-- (the pilot's W-9 as provided to that client) or one TRIP (a permit for a
-- specific job). At most one — a document about both is really two documents.
--
-- WHY `status` EXISTS AND WHY 'requested' IS ONE OF ITS VALUES. The Needs
-- Attention queue must show "W-9 outstanding · Tarrant Family Office · asked 18
-- Jul". A MISSING ROW CANNOT CARRY A DATE, so the request itself is a row:
-- status='requested', requested_at set, no file, no expiry. When the pilot
-- sends it, it becomes 'on_file'. That is what lets pilot.clients have no
-- w9_status column — one source (C2) — and, because the row is scoped to the
-- client, a newly issued W-9 does not read as covering a client who only ever
-- received the previous one.
-- DIRECTION, stated because it is easy to get backwards: clients 1099 the pilot
-- (C10), so a doc_type='w9' row scoped to a client is THE PILOT'S OWN W-9 as
-- provided to that client — not a form the client owes the pilot.
--
-- 'superseded' exists because renewing a medical EARLY produces two rows with
-- future expiry dates. Without it the board shows the old one as current and
-- the ladder fires on a replaced document. The projection tracks only
-- status='on_file', so superseding removes it from the ladder in the same
-- statement.

create table pilot.documents (
  id               uuid primary key default gen_random_uuid(),
  account_id       uuid not null references pilot.accounts (id) on delete cascade,

  -- New vocabulary, defined DELIBERATELY (docs/PLAN.md names half-copying as a
  -- standing risk). Covers everything PLAN.md lists plus a generic bucket.
  -- NOTE: 'insurance' means the PILOT's own non-owned-aircraft liability policy.
  -- It is not an opening for aircraft-scoped compliance records, which are
  -- rejected scope (§D: "V1 tracks the pilot's flights, not airworthiness").
  doc_type         text not null check (doc_type in (
                     'medical', 'flight_review', 'passport', 'pilot_certificate',
                     'type_rating', 'radio_license', 'w9', 'insurance',
                     'contract', 'other')),

  -- The human label shown on the Currency & Expirations board ("First class
  -- medical"). NOT NULL because it is projected into pilot.expirations.label,
  -- which is NOT NULL. Deliberately free text rather than a medical_class enum:
  -- the class matters only because it determines DURATION, and in Phases 3-4
  -- the pilot enters the resulting expiry date directly. Phase 7 adds a
  -- structured class column when it needs to CALCULATE duration rather than
  -- display it; half-inventing that vocabulary now is the enum-drift risk.
  title            text not null check (length(btrim(title)) > 0),

  -- B6 again: whose document is it, as DATA. A business account may hold the
  -- second pilot's medical without that pilot having a login. Not a FK to
  -- auth.users, and must never become one.
  subject_label    text,

  client_id        uuid,
  trip_id          uuid,

  issuer           text,
  reference_number text,

  issued_on        date,
  -- The expiry the whole engine hangs off. LAST VALID DAY, INCLUSIVE. Nullable:
  -- a certificate that never expires is a real document.
  expires_on       date,

  status           text not null default 'on_file'
                     check (status in ('requested', 'on_file', 'superseded', 'void')),
  requested_at     timestamptz,
  superseded_by_document_id uuid,

  storage_path     text,
  notes            text,

  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  -- Same tenancy-carrying pointer constraint as pilot.expenses.storage_path.
  constraint documents_storage_path_tenancy
    check (storage_path is null
           or (storage_path like account_id::text || '/%'
               and storage_path not like '%..%')),

  unique (id, account_id),

  constraint documents_client_fk foreign key (client_id, account_id)
    references pilot.clients (id, account_id)
    on update restrict on delete restrict,
  constraint documents_trip_fk foreign key (trip_id, account_id)
    references pilot.trips (id, account_id)
    on update restrict on delete restrict,
  -- ON DELETE RESTRICT, and the two obvious alternatives are both wrong:
  --   * ON DELETE SET NULL nulls EVERY column in the referencing key, including
  --     account_id, which is NOT NULL — the delete fails with a confusing
  --     not-null violation raised from inside a cascade.
  --   * Even a column-scoped SET NULL would leave the older row with
  --     status='superseded' and a null pointer, violating
  --     documents_superseded_needs_target below.
  -- So: you cannot delete a document that another names as its replacement
  -- until you fix the pointer. That fails loudly and specifically (C1), which
  -- is correct for a record chain.
  constraint documents_superseded_fk
    foreign key (superseded_by_document_id, account_id)
    references pilot.documents (id, account_id)
    on update restrict on delete restrict,

  constraint documents_single_scope
    check (client_id is null or trip_id is null),
  constraint documents_superseded_needs_target
    check (status <> 'superseded' or superseded_by_document_id is not null),
  -- The converse, plus a self-reference guard. Without them a row can be its
  -- own replacement — every constraint satisfied, the credential silently
  -- leaves the ladder with no successor, and any code walking the supersession
  -- chain loops forever.
  constraint documents_pointer_implies_superseded
    check (superseded_by_document_id is null or status = 'superseded'),
  constraint documents_no_self_supersede
    check (superseded_by_document_id is distinct from id),
  constraint documents_requested_has_date
    check (status <> 'requested' or requested_at is not null),
  constraint documents_dates_ordered
    check (issued_on is null or expires_on is null or expires_on >= issued_on)
);

comment on table pilot.documents is
  'Date-bearing records: credentials (medical, flight review, passport, '
  'certificates) and counterparty paperwork (W-9). The first participant in the '
  'expiration engine, and the SOLE source of W-9 state — pilot.clients '
  'deliberately has no w9_status column.';

create index if not exists documents_account_type_idx
  on pilot.documents (account_id, doc_type, expires_on);
-- "W-9 outstanding" in the Needs Attention queue. Partial and tiny.
create index if not exists documents_w9_outstanding_idx
  on pilot.documents (account_id, requested_at)
  where doc_type = 'w9' and status = 'requested';
-- The paperwork gate: does this client have a current W-9 on file.
create index if not exists documents_account_client_idx
  on pilot.documents (account_id, client_id) where client_id is not null;
-- Both of these back an ON DELETE RESTRICT foreign key. Postgres does NOT
-- auto-index the referencing side, so without them every trip delete and every
-- document delete seq-scans this table while holding a lock.
create index if not exists documents_account_trip_idx
  on pilot.documents (account_id, trip_id) where trip_id is not null;
create index if not exists documents_superseded_by_idx
  on pilot.documents (account_id, superseded_by_document_id)
  where superseded_by_document_id is not null;

create or replace trigger documents_set_updated_at
  before update on pilot.documents
  for each row execute function pilot.set_updated_at();
create or replace trigger documents_freeze_tenancy
  before update on pilot.documents
  for each row execute function pilot.freeze_tenancy_columns();


-- ----------------------------------------------------------------------------
-- 8b. Deferred composite FKs on pilot.expirations
-- ----------------------------------------------------------------------------
-- pilot.expirations is created up in section 2 with the rest of the engine,
-- before clients and trips exist, so its two tenant-scoped FKs are attached
-- here. They matter: the projection COPIES client_id / trip_id for deep-linking,
-- and without the composite FK that copy could be made to name another tenant's
-- row. Pattern 5 applies to projections too, not only to tables a tenant writes
-- directly.
--
-- ON DELETE RESTRICT, not CASCADE. A cascade would be a write path into
-- pilot.expirations that is not pilot.project_expiration(), contradicting the
-- one-write-path claim above the table. It is unreachable today because
-- documents' own FKs are RESTRICT — which is exactly why making it RESTRICT is
-- free, and why leaving it CASCADE would be a trap armed for the first future
-- source table that wires in with a nullable client reference.
--
-- Wrapped in a DO block because Postgres has no
-- `alter table ... add constraint if not exists`.
do $$
begin
  if not exists (select 1 from pg_catalog.pg_constraint
                  where conname = 'expirations_client_fk'
                    and conrelid = 'pilot.expirations'::regclass) then
    alter table pilot.expirations
      add constraint expirations_client_fk
      foreign key (client_id, account_id)
      references pilot.clients (id, account_id)
      on update restrict on delete restrict;
  end if;

  if not exists (select 1 from pg_catalog.pg_constraint
                  where conname = 'expirations_trip_fk'
                    and conrelid = 'pilot.expirations'::regclass) then
    alter table pilot.expirations
      add constraint expirations_trip_fk
      foreign key (trip_id, account_id)
      references pilot.trips (id, account_id)
      on update restrict on delete restrict;
  end if;
end
$$;


-- ############################################################################
-- SECTION 9 — VIEWS: the read paths the product actually performs
-- ############################################################################
-- EVERY VIEW HERE IS security_invoker = true. This is not optional and it is the
-- single most dangerous thing to get wrong in this file. A normal Postgres view
-- runs with the PRIVILEGES AND RLS CONTEXT OF ITS OWNER — which here is the role
-- that owns every pilot table, i.e. the role that is EXEMPT from RLS. An
-- un-invoker'd view over pilot.trips is a complete, silent, cross-tenant data
-- leak that no policy in this schema can stop. Phase 1 warns about exactly this
-- for convenience views in `public`; it is just as true for a view sitting next
-- to its own tables. If you add a view, write the WITH clause first and the
-- query second.

-- ----------------------------------------------------------------------------
-- 9a. pilot.trip_financials — A2, and the ONLY place trip money is computed
-- ----------------------------------------------------------------------------
-- WHY A VIEW AND NOT DENORMALISED COLUMNS ON pilot.trips.
-- The tempting design is rebilled/deducted totals cached on the trip and
-- maintained by a trigger on pilot.expenses. It is not worth it: a trip has on
-- the order of ten expenses and a list page shows fifty trips, so the aggregate
-- is a few hundred index-local rows — microseconds — while the cache would be a
-- second source for a MONEY figure (C2) that has to be re-verified forever.
-- Denormalisation earns its keep in this schema in exactly two places:
-- account_id on every child row (kept honest BY the composite foreign keys, so
-- the copy cannot disagree) and pilot.expirations (kept honest by branch (D)).
-- Not here. If you are about to add trips.total_cents, stop.
--
-- THE TWO MONEY FIGURES, and why both exist without violating C2.
-- A2 states the formula literally: billable (days x rate + rebilled expenses)
-- - deducted expenses = trip net. It also says, one sentence earlier, that
-- pass-through costs are "explicitly excluded (not in your margin)" and that
-- "the pilot's version of margin is earned vs out-of-pocket". Those two
-- sentences describe DIFFERENT NUMBERS, and shipping only the first one under a
-- name the pilot reads as profit overstates every trip by exactly the rebilled
-- amount:
--   billable_cents     — what the CLIENT OWES. days x rate + per diem +
--                        rebilled. This is the invoice figure and Phase 5
--                        reconciles invoice lines against it.
--   trip_net_cents     — A2's literal formula: billable - deducted. Kept
--                        because A2 states it and the client statement uses it.
--   trip_margin_cents  — EARNED VS OUT-OF-POCKET, which is what the trip page
--                        answers "did this job make money" with. A rebilled
--                        expense is money out and the same money back, so it
--                        cancels exactly and does not appear:
--                        day + per diem - deducted.
-- These are three questions, not three answers to one question — each is
-- computed once, here, from the same rows. Nothing stores any of them.
--
-- ROUNDING is the only quantity-to-money conversion in the schema. round() on
-- numeric is half-away-from-zero. Each component is rounded BEFORE summing so
-- the displayed day-rate and per-diem lines always add up to the displayed
-- total; rounding the sum instead yields a total that disagrees with its own
-- line items by a cent, which on an invoice is a support ticket.
--
-- EVERY AGGREGATE IS CAST BACK TO ::bigint. sum(bigint) returns NUMERIC in
-- Postgres; without the cast the product's headline figures ship to the client
-- as JSON strings while their siblings ship as numbers, and the money-is-never-
-- numeric invariant would be false exactly where the money is.

create or replace view pilot.trip_financials
with (security_invoker = true) as
select
  n.*,
  (n.billable_cents - n.deducted_expense_cents)::bigint            as trip_net_cents,
  (n.day_rate_total_cents + n.per_diem_total_cents
     - n.deducted_expense_cents)::bigint                           as trip_margin_cents
from (
  select
    b.*,
    (b.day_rate_total_cents + b.per_diem_total_cents
       + b.rebilled_expense_cents)::bigint                         as billable_cents
  from (
    select
      t.id         as trip_id,
      t.account_id,
      t.client_id,
      t.trip_number,
      t.status,
      t.trip_kind,
      t.start_date,
      t.end_date,
      t.day_count,
      t.day_rate_cents,
      t.per_diem_days,
      t.per_diem_cents,
      -- Only a 'flown' trip is revenue. Exposed so no rollup has to remember,
      -- and pilot.trip_revenue below is the view rollups must actually read.
      (t.status = 'flown')                                          as counts_toward_revenue,
      (t.day_count is not null and t.day_rate_cents is not null)     as priced,
      -- NULL, not 0, for an unpriced trip: propagating null through the totals
      -- makes the trip page render "—" instead of a confident wrong $0.
      round(t.day_count * t.day_rate_cents)::bigint                  as day_rate_total_cents,
      round(coalesce(t.per_diem_days, 0) * coalesce(t.per_diem_cents, 0))::bigint
                                                                     as per_diem_total_cents,
      coalesce(x.rebilled_cents,   0)::bigint                        as rebilled_expense_cents,
      coalesce(x.deducted_cents,   0)::bigint                        as deducted_expense_cents,
      coalesce(x.unassigned_cents, 0)::bigint                        as unassigned_expense_cents,
      coalesce(x.unassigned_count, 0)::bigint                        as unassigned_expense_count,
      coalesce(x.expense_count,    0)::bigint                        as expense_count
    from pilot.trips t
    left join lateral (
      select
        sum(e.amount_cents) filter (where e.treatment = 'rebill')     as rebilled_cents,
        sum(e.amount_cents) filter (where e.treatment = 'deduct')     as deducted_cents,
        sum(e.amount_cents) filter (where e.treatment = 'unassigned') as unassigned_cents,
        count(*)            filter (where e.treatment = 'unassigned') as unassigned_count,
        count(*)                                                      as expense_count
      from pilot.expenses e
      where e.trip_id    = t.id
        and e.account_id = t.account_id
    ) x on true
  ) b
) n;

comment on view pilot.trip_financials is
  'Requirement A2, and the single source for every trip money figure. Three '
  'DIFFERENT questions: billable_cents = what the client owes (the invoice '
  'figure); trip_net_cents = A2''s literal formula; trip_margin_cents = earned '
  'vs out-of-pocket, which is the "did this job make money" number and the one '
  'the trip page shows. unassigned_expense_cents is in NONE of them, on purpose '
  '(A3): an undecided receipt is neither billed nor deducted and the page should '
  'say so rather than quietly bury it. Nothing stores any of these.';

-- Rollup-safe companion. Canceled and unpriced trips are excluded HERE so no
-- KPI tile, statement or export has to remember to filter — the structural
-- version of "the database should not rely on every caller doing the right
-- thing". Every revenue rollup reads this; the trip page reads trip_financials.
create or replace view pilot.trip_revenue
with (security_invoker = true) as
select * from pilot.trip_financials f
 where f.counts_toward_revenue and f.priced;

comment on view pilot.trip_revenue is
  'The ONLY view a revenue rollup, KPI tile, client statement or year-end packet '
  'may read. Filters to flown, priced trips so canceled and unpriced work cannot '
  'leak into a money total by omission.';

-- ----------------------------------------------------------------------------
-- 9b. pilot.trip_paperwork — B3
-- ----------------------------------------------------------------------------
-- *** LIABILITY BOUNDARY — READ BEFORE EDITING ***
-- This is a PAPERWORK completeness state and it is NEVER an operational
-- go/no-go determination. Nothing about airworthiness, crew qualification,
-- duty/rest, weight and balance, FRAT or release ever enters this view or any
-- column it reads. That boundary is LOCKED (docs/PLAN.md; INSPIRATION §B3, §D).
-- A gate here means "a form is unfilled", never "this flight may not depart".
-- If someone asks for a `ready_to_fly` column the answer is no, and the reason
-- is liability, not scope.
-- gate_key is typed pilot.paperwork_gate, so adding an operational value FAILS
-- AT VIEW-CREATION TIME rather than passing review — see section 0c.
--
-- FILTERED TO status = 'flown', and that is part of the same boundary in TIME
-- rather than in content. A "0 of 3" badge on an UPCOMING trip is structurally
-- the 13-point pre-trip readiness audit B3 exists to reject, whatever the three
-- gates happen to contain. Paperwork completeness is about work that has
-- happened. (It also keeps canceled trips out of the A8 queues permanently.)
--
-- One row per gate: enumerable, per B3, and it is what lets the domain constrain
-- the key. `met` is three-valued — true = satisfied, false = not satisfied,
-- null = the module answering this gate does not exist yet. The full seven-gate
-- vocabulary ships from day one so the SHAPE of "Paperwork complete 4 of 6" is
-- fixed and Phase 5/6 wiring is replacing three nulls in ONE view in ONE file.
-- Counting only non-null gates keeps today's number honest (B7).

create or replace view pilot.trip_paperwork
with (security_invoker = true) as
select t.account_id,
       t.id as trip_id,
       t.client_id,
       g.gate_key,
       g.gate_phase,
       g.met
  from pilot.trips t
  cross join lateral (
    values
      ('legs_entered'::pilot.paperwork_gate, 3::integer,
        (exists (select 1 from pilot.trip_legs l
                  where l.trip_id = t.id and l.account_id = t.account_id))::boolean),

      ('expenses_assigned'::pilot.paperwork_gate, 4,
        (not exists (select 1 from pilot.expenses e
                      where e.trip_id = t.id and e.account_id = t.account_id
                        and e.treatment = 'unassigned'))),

      -- C10: clients 1099 the pilot, so the pilot's W-9 must be on file WITH
      -- THIS CLIENT. One source: the per-client documents row.
      ('w9_on_file'::pilot.paperwork_gate, 4,
        (exists (select 1 from pilot.documents d
                  where d.account_id = t.account_id
                    and d.client_id  = t.client_id
                    and d.doc_type   = 'w9'
                    and d.status     = 'on_file'
                    and (d.expires_on is null or d.expires_on >= current_date)))),

      -- Phase 5 replaces these three literals here and NOWHERE ELSE.
      ('invoice_drafted'::pilot.paperwork_gate,   5, null::boolean),
      ('invoice_sent'::pilot.paperwork_gate,      5, null::boolean),
      ('invoice_paid'::pilot.paperwork_gate,      5, null::boolean),

      -- Phase 6. Satisfied by a CONFIRMED logbook entry, never by a draft
      -- (docs/PLAN.md decision #14 is locked).
      ('logbook_confirmed'::pilot.paperwork_gate, 6, null::boolean)
  ) as g(gate_key, gate_phase, met)
 where t.status = 'flown';

comment on view pilot.trip_paperwork is
  'B3: enumerable PAPERWORK completeness per FLOWN trip. NEVER operational '
  'go/no-go — locked liability boundary; see the warning block above this view '
  'and the pilot.paperwork_gate domain, which makes it a Postgres error rather '
  'than a review comment. met = null means that gate''s module ships in a later '
  'phase.';

create or replace view pilot.trip_paperwork_summary
with (security_invoker = true) as
select account_id,
       trip_id,
       client_id,
       count(*) filter (where met is not null) as gates_total,
       count(*) filter (where met)             as gates_met,
       count(*) filter (where met is null)     as gates_awaiting_module,
       bool_and(coalesce(met, true))           as paperwork_complete
  from pilot.trip_paperwork
 group by account_id, trip_id, client_id;

comment on view pilot.trip_paperwork_summary is
  'The "Paperwork complete 3 of 3" figure (B3), becoming "7 of 7" once Phases 5 '
  'and 6 fill in their gates — gates_total is COUNTED, not hardcoded, so no call '
  'site changes. paperwork_complete ignores gates whose module does not exist '
  'yet, which is the honest claim (B7).';

-- ----------------------------------------------------------------------------
-- 9c. pilot.expiration_board — A1 + A7
-- ----------------------------------------------------------------------------
-- days_remaining and ladder_stage are COMPUTED, never stored: they change every
-- midnight, and a stored copy is wrong for up to 24 hours in the one part of the
-- product where being wrong matters. The underlying scan is
-- (account_id, expires_on) — one index range per render.
--
-- PHASE 7 VOCABULARY NOTE, because this board and the currency board are the
-- same board (A1 puts documents AND currency snapshots on one engine). The
-- locked currency vocabulary is `estimated_current / estimated_not_current /
-- insufficient_data` and it is DELIBERATELY HEDGED — that hedge is a
-- counsel-gated liability control (docs/PLAN.md risk "Currency liability"; B7
-- "the disclaimer travels with the data"). This view's columns are therefore
-- named `ladder_stage` and `urgency`, NOT `status`, so that when Phase 7 adds
-- currency snapshots they carry the locked `status` vocabulary VERBATIM in
-- their own column and the board renders both without either overwriting the
-- other. Do not rename these to `status`, and do not map an estimated currency
-- row onto 'overdue'.

create or replace view pilot.expiration_board
with (security_invoker = true) as
select
  e.id,
  e.account_id,
  e.source_table,
  e.source_column,
  e.source_id,
  e.kind,
  e.label,
  e.expires_on,
  e.client_id,
  e.trip_id,
  (e.expires_on - current_date)                  as days_remaining,
  pilot.expiry_stage(e.expires_on, current_date) as ladder_stage,
  case pilot.expiry_stage(e.expires_on, current_date)
    when 'overdue'    then 'urgent'
    when 't_minus_1'  then 'urgent'
    when 't_minus_7'  then 'urgent'
    when 't_minus_14' then 'soon'
    when 't_minus_30' then 'soon'
    else 'ok'
  end                                            as urgency
from pilot.expirations e;

comment on view pilot.expiration_board is
  'A1/A7: the Currency & Expirations board and the ladder, with the '
  'days-remaining countdown computed at read time. Columns are ladder_stage and '
  'urgency, never `status` — Phase 7''s currency snapshots own that word with a '
  'locked, deliberately hedged vocabulary. Deep-link with (source_table, '
  'source_id).';

-- ----------------------------------------------------------------------------
-- 9d. pilot.needs_attention — A7/A8, the typed action queue
-- ----------------------------------------------------------------------------
-- One query, typed tags, everything deep-linkable via (item_type, item_id) plus
-- the scope columns.
--
-- THE COLUMN LIST IS FROZEN, because `create or replace view` cannot change it
-- and three more branches are coming. It therefore includes client_name and
-- trip_number NOW: A7's queue row is "W-9 outstanding · Tarrant Family Office ·
-- asked 18 Jul", which needs the client's NAME, and adding a column later is not
-- a create-or-replace, it is a drop-cascade-recreate of a view other things
-- read. due_on is a genuine future DEADLINE and is NULL where there is none —
-- an unassigned receipt has an `occurred_on`, not a due date, and putting a past
-- date in due_on would render every receipt as overdue and rank it above a
-- medical expiring in three days.
--
-- PHASES 5/6 EXTEND THIS BY ADDING UNION BRANCHES, NOT COLUMNS:
-- past_due_invoice, uninvoiced_trip (A8's "unbilled work surfaced until
-- invoiced") and unconfirmed_logbook. Each is a three-line diff.

create or replace view pilot.needs_attention
with (security_invoker = true) as
  select
    b.account_id,
    'expiration'::text  as item_type,
    b.id                as item_id,
    b.label             as label,
    b.kind              as detail,
    b.urgency           as urgency,
    b.expires_on        as due_on,
    null::date          as occurred_on,
    b.client_id         as client_id,
    c.name              as client_name,
    b.trip_id           as trip_id,
    tr.trip_number      as trip_number
  from pilot.expiration_board b
  left join pilot.clients c on c.id = b.client_id  and c.account_id = b.account_id
  left join pilot.trips   tr on tr.id = b.trip_id  and tr.account_id = b.account_id
  where b.urgency in ('urgent', 'soon')

union all

  select
    e.account_id,
    'unassigned_receipt'::text,
    e.id,
    coalesce(nullif(btrim(e.merchant), ''), 'Receipt')::text,
    e.category::text,
    'soon'::text,
    null::date,
    e.incurred_on,
    null::uuid,
    null::text,
    e.trip_id,
    tr.trip_number
  from pilot.expenses e
  left join pilot.trips tr on tr.id = e.trip_id and tr.account_id = e.account_id
  where e.treatment = 'unassigned'

union all

  select
    d.account_id,
    'w9_outstanding'::text,
    d.id,
    d.title::text,
    'requested'::text,
    'soon'::text,
    null::date,
    d.requested_at::date,
    d.client_id,
    c.name,
    d.trip_id,
    null::integer
  from pilot.documents d
  left join pilot.clients c on c.id = d.client_id and c.account_id = d.account_id
  where d.doc_type = 'w9' and d.status = 'requested'

union all

  -- A flown trip with no agreed rate is unbillable work that will otherwise sit
  -- invisible forever, because trips.day_count/day_rate_cents are nullable
  -- exactly so "not yet priced" stays distinguishable from "worth nothing".
  select
    t.account_id,
    'unpriced_trip'::text,
    t.id,
    coalesce(nullif(btrim(t.title), ''), 'TRP-' || lpad(t.trip_number::text, 4, '0'))::text,
    t.trip_kind::text,
    'soon'::text,
    null::date,
    t.end_date,
    t.client_id,
    c.name,
    t.id,
    t.trip_number
  from pilot.trips t
  join pilot.clients c on c.id = t.client_id and c.account_id = t.account_id
  where t.status = 'flown'
    and (t.day_count is null or t.day_rate_cents is null);

comment on view pilot.needs_attention is
  'A7/A8 typed action queue. Phases 5 and 6 add past_due_invoice, '
  'uninvoiced_trip and unconfirmed_logbook as ADDITIONAL UNION BRANCHES — do '
  'not change the column list or its types, or create-or-replace stops working '
  'and extending it becomes a drop-cascade. due_on is a future deadline only; '
  'occurred_on carries past dates.';


-- ############################################################################
-- SECTION 10 — RLS
-- ############################################################################
-- Enabled on every table in this migration, in this migration — never
-- retrofitted. `drop policy if exists` precedes each `create policy` because
-- Postgres has no `create policy if not exists`.
--
-- THERE IS NO ADMIN-BYPASS POLICY ANYWHERE IN THIS FILE AND THERE MUST NEVER BE
-- ONE. No AMG-facing read path exists. That absence is the product.
--
-- UPDATE policies carry the SAME predicate in USING and WITH CHECK, per Phase
-- 1's reasoning on accounts_update: USING gates which EXISTING rows may be
-- touched, WITH CHECK gates what the RESULTING row may look like. USING alone
-- would let a tenant rewrite account_id and push a row into another tenant.
-- (The column grants and pilot.freeze_tenancy_columns() also block that. Three
-- locks, because this is the one thing that must not fail.)
--
-- Do NOT add `force row level security` to any of these. Phase 1 explains at
-- length why pilot.account_members must never have it; pilot.expirations must
-- not either, because the projection trigger writes it through the table-owner
-- exemption. Forcing RLS on the rest while the helpers rely on that exemption is
-- the kind of half-applied hardening that reads as consistent and behaves as an
-- outage.
--
-- ROLE MATRIX. All three member roles may read and write the operating tables:
-- a bookkeeper who cannot assign an expense treatment cannot do the job their
-- seat was bought for. But DESTRUCTION is gated. Phase 1 built
-- pilot.is_account_owner() precisely because scoping by mere membership is not
-- authorization, and without a role gate the LEAST-privileged seat — a
-- bookkeeper, typically an outside accountant — can delete every client and
-- every trip in the account in two statements, ON DELETE RESTRICT
-- notwithstanding (delete the children first and the parents follow). The
-- RESTRICTIVE policies below close that. RESTRICTIVE rather than folded into
-- the permissive policy on purpose: a restrictive policy ANDs with everything,
-- so a future permissive policy added for some other reason cannot re-open it.
-- OPEN PRODUCT QUESTION, flagged rather than decided silently: whether a
-- 'member' (the second pilot in a two-pilot LLC) should also be barred from
-- deleting clients and trips. The matrix encoded here is owner+member may
-- delete, bookkeeper may not.

alter table pilot.clients            enable row level security;
alter table pilot.trips              enable row level security;
alter table pilot.trip_legs          enable row level security;
alter table pilot.trip_participants  enable row level security;
alter table pilot.expenses           enable row level security;
alter table pilot.documents          enable row level security;

do $$
declare t text;
begin
  foreach t in array array['clients', 'trips', 'trip_legs', 'trip_participants',
                           'expenses', 'documents']
  loop
    execute format('drop policy if exists %I on pilot.%I', t || '_select', t);
    execute format('drop policy if exists %I on pilot.%I', t || '_insert', t);
    execute format('drop policy if exists %I on pilot.%I', t || '_update', t);
    execute format('drop policy if exists %I on pilot.%I', t || '_delete', t);
    execute format('drop policy if exists %I on pilot.%I', t || '_delete_role', t);

    execute format($p$create policy %I on pilot.%I for select to authenticated
      using (account_id in (select pilot.current_account_ids()))$p$, t || '_select', t);
    execute format($p$create policy %I on pilot.%I for insert to authenticated
      with check (account_id in (select pilot.current_account_ids()))$p$, t || '_insert', t);
    execute format($p$create policy %I on pilot.%I for update to authenticated
      using (account_id in (select pilot.current_account_ids()))
      with check (account_id in (select pilot.current_account_ids()))$p$, t || '_update', t);
    execute format($p$create policy %I on pilot.%I for delete to authenticated
      using (account_id in (select pilot.current_account_ids()))$p$, t || '_delete', t);
    execute format($p$create policy %I on pilot.%I as restrictive for delete
      to authenticated
      using (pilot.has_account_role(account_id, array['owner','member']))$p$,
      t || '_delete_role', t);
  end loop;
end
$$;

-- --- expirations (read-only projection) ------------------------------------
alter table pilot.expirations enable row level security;
drop policy if exists expirations_select on pilot.expirations;
create policy expirations_select on pilot.expirations
  for select to authenticated
  using (account_id in (select pilot.current_account_ids()));
-- No INSERT/UPDATE/DELETE policy and no matching grant, deliberately. Written
-- exclusively by pilot.project_expiration(). A tenant able to delete a row here
-- could silently switch off their own expiry alerts, which is precisely the
-- failure C4 exists to prevent.

-- --- expiration_notices (read-only dispatch log) ---------------------------
alter table pilot.expiration_notices enable row level security;
drop policy if exists expiration_notices_select on pilot.expiration_notices;
create policy expiration_notices_select on pilot.expiration_notices
  for select to authenticated
  using (account_id in (select pilot.current_account_ids()));

-- --- document_sequences (read-only counter) --------------------------------
alter table pilot.document_sequences enable row level security;
drop policy if exists document_sequences_select on pilot.document_sequences;
create policy document_sequences_select on pilot.document_sequences
  for select to authenticated
  using (account_id in (select pilot.current_account_ids()));
-- No write policy and no write grant: a tenant able to rewind next_value could
-- issue two invoices bearing the same number. Same class as the Phase 1
-- billing-column CRITICAL.

-- --- expiring_sources (schema configuration, not tenant data) --------------
alter table pilot.expiring_sources enable row level security;
-- ZERO policies, and an explicit revoke below. RLS with no policy denies
-- everything, which is the correct answer for a non-tenant table: this is
-- configuration, and the right treatment is no client access at all rather than
-- a fabricated account_id column. Do not add a convenience read policy.


-- ############################################################################
-- SECTION 11 — GRANTS
-- ############################################################################
-- THE PHASE 1 CRITICAL, APPLIED. Two rules, both learned the hard way:
--
--   RULE 1 — never `grant update on <table>`. ENUMERATE. Excluded everywhere:
--            id, account_id (tenancy), created_at/updated_at (trigger-owned),
--            and trips.trip_number (sequence-owned).
--
--   RULE 2 — the same applies to INSERT, which most people forget. `id` is
--            excluded from every INSERT grant so a client cannot choose its own
--            primary key. If it could, inserting a guessed uuid would return
--            either success or a unique violation naming the constraint — a
--            cross-tenant EXISTENCE ORACLE, structurally identical to the Phase
--            1 finding on accounts.connect_account_id. The column defaults to
--            gen_random_uuid(), so omitting it costs the client nothing.
--            account_id IS insertable (the row needs one, and the RLS WITH
--            CHECK constrains it to the caller's own accounts) and is never
--            updatable.
--
-- EVERY TABLE IS REVOKED FIRST. Postgres grants are ADDITIVE: without the
-- revoke, a table-wide grant issued by any other migration — including one of
-- the three superseded drafts this file replaces — would survive untouched and
-- the careful enumeration below would ADD to it rather than define it. The
-- revoke is what makes this section authoritative.
--
-- Grants and policies move together: a policy without a grant is inert, a grant
-- without a policy is a real hole. If you add either, add both.

revoke all on pilot.clients            from authenticated;
revoke all on pilot.trips              from authenticated;
revoke all on pilot.trip_legs          from authenticated;
revoke all on pilot.trip_participants  from authenticated;
revoke all on pilot.expenses           from authenticated;
revoke all on pilot.documents          from authenticated;
revoke all on pilot.expirations        from authenticated;
revoke all on pilot.expiration_notices from authenticated;
revoke all on pilot.document_sequences from authenticated;

-- pilot.expiring_sources gets an explicit revoke, and it is LOAD-BEARING.
-- Phase 1 set `alter default privileges in schema pilot grant select on tables
-- to authenticated`, so EVERY table created in this schema is automatically
-- readable by `authenticated` the moment it exists. RLS-with-no-policies would
-- still return zero rows, so nothing leaks today — but "returns nothing because
-- it has no policy" and "cannot be reached at all" are different guarantees,
-- and the first silently becomes readable the day someone adds a convenience
-- policy.
-- REMEMBER THIS FOR EVERY FUTURE NON-TENANT TABLE IN THIS SCHEMA: the default-
-- privileges floor means you must opt OUT of tenant readability, not into it.
revoke all on pilot.expiring_sources from authenticated;

-- --- clients ---------------------------------------------------------------
grant select, delete on pilot.clients to authenticated;
grant insert (
  account_id, name, legal_name, contact_name, contact_email, contact_phone,
  billing_address_line1, billing_address_line2, billing_city, billing_state,
  billing_postal_code, billing_country, default_day_rate_cents,
  default_per_diem_cents, default_expense_treatment, payment_terms_days,
  default_tax_rate_bp, tax_label, notes, archived_at
) on pilot.clients to authenticated;
grant update (
  name, legal_name, contact_name, contact_email, contact_phone,
  billing_address_line1, billing_address_line2, billing_city, billing_state,
  billing_postal_code, billing_country, default_day_rate_cents,
  default_per_diem_cents, default_expense_treatment, payment_terms_days,
  default_tax_rate_bp, tax_label, notes, archived_at
) on pilot.clients to authenticated;

-- --- trips -----------------------------------------------------------------
-- trip_number is absent from BOTH write grants: allocated by
-- pilot.assign_trip_number(), and a tenant able to set or change it could
-- produce two trips with the same reference or collide with a number an invoice
-- already cites.
grant select, delete on pilot.trips to authenticated;
grant insert (
  account_id, client_id, title, trip_kind, status, start_date, end_date,
  aircraft_ident, aircraft_type, day_count, day_rate_cents, per_diem_days,
  per_diem_cents, notes
) on pilot.trips to authenticated;
grant update (
  client_id, title, trip_kind, status, start_date, end_date,
  aircraft_ident, aircraft_type, day_count, day_rate_cents, per_diem_days,
  per_diem_cents, notes
) on pilot.trips to authenticated;

-- --- trip_legs -------------------------------------------------------------
grant select, delete on pilot.trip_legs to authenticated;
grant insert (
  account_id, trip_id, leg_seq, flown_on, from_icao, to_icao,
  out_time_utc, in_time_utc, aircraft_ident, block_minutes, night_minutes,
  actual_instrument_minutes, simulated_instrument_minutes, approach_count, holds,
  day_landings_full_stop, day_landings_touch_and_go,
  night_landings_full_stop, night_landings_touch_and_go, night_takeoffs, remarks
) on pilot.trip_legs to authenticated;
grant update (
  trip_id, leg_seq, flown_on, from_icao, to_icao,
  out_time_utc, in_time_utc, aircraft_ident, block_minutes, night_minutes,
  actual_instrument_minutes, simulated_instrument_minutes, approach_count, holds,
  day_landings_full_stop, day_landings_touch_and_go,
  night_landings_full_stop, night_landings_touch_and_go, night_takeoffs, remarks
) on pilot.trip_legs to authenticated;

-- --- trip_participants -----------------------------------------------------
grant select, delete on pilot.trip_participants to authenticated;
grant insert (account_id, trip_id, display_name, crew_role, notes)
  on pilot.trip_participants to authenticated;
grant update (trip_id, display_name, crew_role, notes)
  on pilot.trip_participants to authenticated;

-- --- expenses --------------------------------------------------------------
-- trip_id IS updatable: assigning a receipt to a trip is the core Phase 4
-- workflow. It is safe only because expenses_trip_fk is COMPOSITE — the Phase 1
-- review's worked example was literally
--   update pilot.expenses set trip_id = '<another tenant''s trip id>'
-- and that statement now fails on the FOREIGN KEY, not on a policy.
-- treatment IS updatable for the same kind of reason: the unassigned queue
-- exists in order to set it later.
grant select, delete on pilot.expenses to authenticated;
grant insert (
  account_id, trip_id, incurred_on, category, merchant, description,
  amount_cents, treatment, storage_path, receipt_uploaded_at, notes
) on pilot.expenses to authenticated;
grant update (
  trip_id, incurred_on, category, merchant, description,
  amount_cents, treatment, storage_path, receipt_uploaded_at, notes
) on pilot.expenses to authenticated;

-- --- documents -------------------------------------------------------------
grant select, delete on pilot.documents to authenticated;
grant insert (
  account_id, doc_type, title, subject_label, client_id, trip_id, issuer,
  reference_number, issued_on, expires_on, status, requested_at,
  superseded_by_document_id, storage_path, notes
) on pilot.documents to authenticated;
grant update (
  doc_type, title, subject_label, client_id, trip_id, issuer,
  reference_number, issued_on, expires_on, status, requested_at,
  superseded_by_document_id, storage_path, notes
) on pilot.documents to authenticated;

-- --- engine + counters: read-only to tenants -------------------------------
grant select on pilot.expirations        to authenticated;
grant select on pilot.expiration_notices to authenticated;
grant select on pilot.document_sequences to authenticated;

-- --- views -----------------------------------------------------------------
-- security_invoker views re-apply the caller's policies against the base tables,
-- so a SELECT grant here is not a bypass.
grant select on pilot.trip_financials         to authenticated;
grant select on pilot.trip_revenue            to authenticated;
grant select on pilot.trip_paperwork          to authenticated;
grant select on pilot.trip_paperwork_summary  to authenticated;
grant select on pilot.expiration_board        to authenticated;
grant select on pilot.needs_attention         to authenticated;

-- --- service_role ----------------------------------------------------------
-- Explicit rather than relying on the Phase 1 default-privileges floor, so this
-- file reads as a complete statement of who may do what. Broad on purpose and
-- NOT a hole: service_role bypasses RLS entirely by design in every Supabase
-- project, so narrowing its grants would be security theatre. The control on it
-- is operational — who holds the key — which docs/PLAN.md states plainly and
-- which product copy must not collapse into "we cannot technically see your
-- data".
grant select, insert, update, delete on
  pilot.clients, pilot.trips, pilot.trip_legs, pilot.trip_participants,
  pilot.expenses, pilot.documents, pilot.expirations, pilot.expiration_notices,
  pilot.expiring_sources, pilot.document_sequences
  to service_role;
grant select on
  pilot.trip_financials, pilot.trip_revenue, pilot.trip_paperwork,
  pilot.trip_paperwork_summary, pilot.expiration_board, pilot.needs_attention
  to service_role;

-- Belt-and-braces: `anon` was never granted USAGE on schema pilot in Phase 1 and
-- must never be. This is a no-op if nothing was granted, and a real fix if
-- anything ever is.
revoke all on schema pilot from anon;


-- ############################################################################
-- SECTION 12 — WIRE THE DATE COLUMNS INTO THE ENGINE
-- ############################################################################
-- ONE participant and ELEVEN written exemptions. Every one of them is a row, and
-- none of them is a comment that can be deleted without the assertion noticing.
-- This block runs AFTER the RLS section deliberately: declare_expiring_source()
-- refuses to enrol a table that does not yet have RLS and at least one policy.

select pilot.declare_expiring_source(
  p_table_name           => 'documents',
  p_kind_column          => 'doc_type',
  p_label_column         => 'title',
  p_column_name          => 'expires_on',
  p_status_column        => 'status',
  -- ONLY 'on_file'. A requested W-9 has no expiry to track, and a superseded or
  -- void document must leave the ladder the moment its status changes.
  p_active_status_values => array['on_file'],
  p_client_column        => 'client_id',
  p_trip_column          => 'trip_id'
);

-- ----------------------------------------------------------------------------
-- THE EXEMPTION THAT PROVES THE MECHANISM WORKS.
-- pilot.accounts.trial_ends_at is a real expiry — the date after which a trial
-- stops being valid — sitting in a plain timestamptz, in a DIFFERENT MODULE
-- (Phase 2 platform billing), created by a migration that predates this engine.
-- It is the exact shape of the audited failure. The default-deny scan finds it
-- and pilot.assert_expiry_coverage() WILL RAISE ON IT until the row below
-- exists: without this declaration THIS MIGRATION DOES NOT APPLY.
-- That is the whole design in one example. A discovery-based engine — marker
-- domain, or a column-name regex — reports clean here, because an opt-in
-- mechanism cannot see an absence.
-- ----------------------------------------------------------------------------
select pilot.declare_not_an_expiry('accounts', 'trial_ends_at',
  'PLATFORM BILLING state, owned by Stripe and the Phase 2 webhook, not a pilot '
  'compliance date. Putting "your trial ends in 3 days" in the same Needs '
  'Attention queue as an expiring medical would set a sales prompt beside a '
  'currency item, and the T-30/T-14/T-7/T-1 rungs are wrong for a short trial '
  'anyway. Trial messaging is a billing-surface concern. Considered and '
  'deliberately excluded; revisit only if trial reminders are ever asked to '
  'share the Needs Attention queue.');

select pilot.declare_not_an_expiry('clients', 'archived_at',
  'Soft-retirement marker. Records when the pilot stopped using this client, '
  'which is a past event, not a future deadline — an archived client needs no '
  'reminder because there is nothing to renew.');

select pilot.declare_not_an_expiry('trips', 'start_date',
  'The first calendar day of the job. A trip beginning is not something that '
  'expires; A8 chases unbilled and unlogged trips through pilot.needs_attention, '
  'which is a completeness loop rather than an escalation ladder.');

select pilot.declare_not_an_expiry('trips', 'end_date',
  'The last calendar day of the job. A trip ENDING is not an expiry: nothing '
  'stops being valid, and the follow-up the pilot needs (invoice it, log it) is '
  'a completeness queue in pilot.needs_attention, not a T-30 reminder ladder.');

select pilot.declare_not_an_expiry('trip_legs', 'flown_on',
  'The logbook date of a leg that has already been flown. A past event; the '
  'ladder tracks future validity, and Phase 6 chases unconfirmed legs through '
  'the completeness queue instead.');

select pilot.declare_not_an_expiry('trip_legs', 'out_time_utc',
  'Block-out instant (A10: absolute UTC, displayed airport-local plus Zulu). A '
  'flight-time record, not a validity window, and nothing about it can lapse.');

select pilot.declare_not_an_expiry('trip_legs', 'in_time_utc',
  'Block-in instant (A10: absolute UTC, displayed airport-local plus Zulu). A '
  'flight-time record, not a validity window, and nothing about it can lapse.');

select pilot.declare_not_an_expiry('expenses', 'incurred_on',
  'The date the money moved — the cash-basis anchor for C3 reporting. A receipt '
  'does not expire; the unassigned receipt queue in pilot.needs_attention is the '
  'follow-up loop for it, and that is deliberately not an escalation ladder.');

select pilot.declare_not_an_expiry('expenses', 'receipt_uploaded_at',
  'When the receipt image was attached. Audit metadata about an upload, not a '
  'validity window on anything.');

select pilot.declare_not_an_expiry('documents', 'issued_on',
  'The date a credential was ISSUED. The paired expires_on column is the one '
  'that participates in the ladder; issued_on only bounds it (see '
  'documents_dates_ordered) and Phase 7 will use it to CALCULATE medical '
  'duration under 61.23.');

select pilot.declare_not_an_expiry('documents', 'requested_at',
  'When the pilot was asked for this document (the W-9 request workflow, C10). '
  'It is the START of an outstanding item, surfaced by the w9_outstanding branch '
  'of pilot.needs_attention, and it has no expiry semantics of its own — a '
  'request does not lapse, it gets fulfilled.');


-- ############################################################################
-- SECTION 13 — THE C4 GATE
-- ############################################################################
-- HOUSE RULE, AND THE REASON THE EXPIRATION ENGINE CANNOT BE SILENTLY BYPASSED:
-- EVERY MIGRATION IN supabase/migrations/ MUST END WITH THIS LINE.
--
-- Supabase applies each migration inside a transaction. A future migration that
-- adds a table with any date-bearing column and forgets to declare it raises
-- here and ROLLS THE WHOLE MIGRATION BACK — at the moment the mistake is made,
-- by the person making it, with a message naming the column and both fixes.
-- That is the structural guarantee C4 asks for, and it needs no superuser and
-- no event trigger.
--
-- Stated precisely, because the file must not promise more than it delivers:
-- the guarantee holds for any migration that carries this line. The CI lint in
-- `npm run expirations:verify` is what makes carrying it non-optional — it greps
-- every file in supabase/migrations/ for the call and fails the build on any
-- that lacks it. Ship the lint with this migration.

select pilot.assert_expiry_coverage();


-- ============================================================================
-- PLAN.md AMENDMENTS MADE BY THIS MIGRATION
-- Recorded here because a locked document that silently disagrees with the
-- shipped schema is itself two sources for one decision (C2). Both should be
-- edited into docs/PLAN.md's data-model section.
--   1. `clients` — PLAN.md specifies "W-9 status and sent date" as columns on
--      clients. NOT IMPLEMENTED there. W-9 state is a pilot.documents row scoped
--      to the client (status 'requested' -> 'on_file' with requested_at), which
--      is one source instead of two and cannot go stale when a document is
--      uploaded without touching the client row.
--   2. `trips` — PLAN.md specifies a `billing state` column. NOT IMPLEMENTED.
--      Invoice state lives on Phase 5's invoice lines; a mirror here goes stale
--      the first time an invoice is voided, which is the audited P&L-vs-ledger
--      divergence.
--   3. `trip_legs` — PLAN.md specifies "date". Implemented as `flown_on`, the
--      pilot-entered logbook date, with the explicit rule that the airport-local
--      date is DERIVED from out_time_utc plus the ident and is never stored
--      (A10).
--
-- WHAT THE VERIFY SCRIPTS MUST NOW ASSERT — see the delivered spec. In brief:
--   expirations:verify (NEW) — assert_expiry_coverage(); an undeclared scratch
--     date column raises and declaring it clears; ladder fixtures; renewal
--     re-fires; status transitions remove projections; every migration file
--     ends with the gate call.
--   tenancy:verify (EXTEND) — every table above; the composite-FK cross-tenant
--     attach as an UPDATE, not a SELECT; no table-wide INSERT/UPDATE for
--     authenticated; `id` not INSERTable; every UNIQUE on a tenant table carries
--     account_id; every view security_invoker; no FK to auth.users outside
--     account_members; bookkeeper cannot DELETE.
--   trip:verify (EXTEND) — the A2 arithmetic recomputed independently; the
--     rate-snapshot rule; the frozen billing inputs; rebill-requires-trip; the
--     paperwork gate vocabulary contains nothing operational.
--
-- PHASE 5 NOTE ON TAX, because a wrong formula in a load-bearing comment
-- outlives its author: tax on an invoice line is
--   (line_cents * tax_rate_bp + 5000) / 10000   -- integer, half-up, non-negative
-- NOT round(line_cents * tax_rate_bp / 10000): with bigint operands the division
-- truncates before round() ever sees it, and it is a cent light roughly three
-- times in four, always in the same direction, so it accumulates across an
-- invoice rather than cancelling.
-- ============================================================================

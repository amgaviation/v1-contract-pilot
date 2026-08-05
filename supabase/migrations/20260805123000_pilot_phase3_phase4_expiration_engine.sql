-- ============================================================================
-- Phase 3 (Clients + Trips) + Phase 4 (Expenses) + the cross-cutting
-- EXPIRATION ENGINE.
-- ============================================================================
-- Builds on 20260802190437_pilot_schema_tenancy.sql, which is ALREADY APPLIED
-- to the live project. Do not edit that file; everything here is additive.
--
-- Read the Phase 1 migration before editing this one. Five of its patterns are
-- load-bearing here and are repeated, not re-derived:
--
--   1. Every RLS policy scopes through `pilot.current_account_ids()`, always
--      written as `account_id in (select pilot.current_account_ids())`. The
--      `(select ...)` wrapper is NOT cosmetic — it lets the planner hoist the
--      helper into a one-time InitPlan instead of re-invoking it per row. With
--      a bare function call the policy becomes a per-row function call on every
--      scan of every table, which is the easiest way to make this schema slow.
--      Never "simplify" it to `= pilot.current_account_id()`.
--   2. SECURITY DEFINER functions here avoid RLS recursion because their owner
--      also owns the tables they read (the table-owner RLS exemption), NOT
--      because of the SECURITY DEFINER property itself. The Phase 1 warning
--      applies verbatim: DO NOT set FORCE ROW LEVEL SECURITY on
--      pilot.account_members — and now also not on pilot.expirations,
--      pilot.expiring_sources, or pilot.document_sequences, because the
--      projection and numbering triggers depend on the same exemption.
--   3. `set search_path = ''` on every function, every identifier qualified.
--   4. THE PHASE 1 CRITICAL: Postgres RLS has NO column granularity. A policy
--      can say "you may touch rows you own"; it can never say "you may change
--      these columns." So every write privilege granted to `authenticated`
--      below is COLUMN-ENUMERATED. This extends to INSERT, not just UPDATE —
--      see the grants section for why `id` is excluded from every insert grant.
--   5. COMPOSITE FOREIGN KEYS. A plain FK checks existence only, and FK
--      verification runs with RLS bypassed, so an account_id-only policy does
--      not stop `update pilot.expenses set trip_id = '<another tenant's trip>'`.
--      Every FK below between two tenant-scoped tables carries account_id and
--      references a `unique (id, account_id)` key on the parent. That is why
--      each parent table has an apparently-redundant `unique (id, account_id)`
--      — it is not redundant, it is the referenced key.
--
-- ----------------------------------------------------------------------------
-- CONVENTIONS FIXED HERE. Changing any of these later is expensive.
-- ----------------------------------------------------------------------------
-- MONEY is integer minor units (US cents) in `bigint` columns named `*_cents`.
-- Never numeric, never float, never a mix. Reasons, in order:
--   (a) Exact. Cent-denominated integers cannot accumulate representation error
--       across a year of sums, and this whole product is sums.
--   (b) Stripe's API is already cents. Phase 5 hands invoice totals to Stripe
--       Connect; a numeric/cents boundary is a rounding site, and a rounding
--       site is where C2's "two sources for one number" is born.
--   (c) bigint, not integer: `integer` cents caps a single row near $21.4M,
--       which is fine per row and a bad habit to build in; SUM() promotes to
--       bigint anyway, so bigint everywhere removes the cast.
--   The ONE non-integer is `trips.day_count numeric(5,2)`, because half-days are
--   real. It is a QUANTITY, not money. The single multiplication that turns a
--   quantity into money is rounded in exactly one place — pilot.trip_financials
--   — and nowhere else. If you are about to write `day_count * day_rate_cents`
--   in application code, stop and query the view.
--   Currency is implicitly USD; there is no currency column, deliberately.
--   Multi-currency is not a column, it is a project (rate snapshots on every
--   money row, a basis on every report), and guessing at it now would be the
--   half-copied vocabulary docs/PLAN.md warns about.
--
-- TIME. A10 is a hard rule: store UTC, display airport-local + Zulu derived
-- from the ICAO code. THERE IS NO TIMEZONE COLUMN IN THIS SCHEMA AND THERE MUST
-- NEVER BE ONE. Leg clock times are `timestamptz` (absolute instants); the
-- airport code is the zone. Calendar-valued business facts (a trip's date
-- range, an expiry, an expense date) are `date`, because they are not instants
-- and attaching a zone to them creates off-by-one-day bugs at every boundary.
--
-- WHICH RECORD OWNS THE CALENDAR: the TRIP owns dates (start_date/end_date);
-- LEGS own sequence and instants. A leg deliberately has no `leg_date` column —
-- that would be the local date at the departure airport, derivable from
-- out_time_utc plus the ICAO's zone, and storing it as well is a second source
-- for one number (C2). A leg with no times yet is still placed in the calendar
-- by its trip.
--
-- EXPIRY SEMANTICS. `expires_on` is the LAST VALID DAY, INCLUSIVE. A medical
-- with expires_on = 2026-11-30 is valid through 30 Nov and overdue on 1 Dec.
-- days_remaining is therefore 0 on the last valid day, never -1. Two developers
-- will otherwise disagree about this within a week.
-- ============================================================================


-- ############################################################################
-- SECTION 1 — Per-account document numbering
-- ############################################################################
-- Trips need a human reference now (TRP-0114 in the mockup) and invoices need a
-- sequential number in Phase 5. Building one allocator now instead of two later
-- is the cheapest item in this file.
--
-- SECURITY: this is entitlement-shaped state in the Phase 1 sense. A tenant who
-- could UPDATE next_value could rewind their own invoice numbering and emit two
-- different documents bearing the same number. `authenticated` therefore gets
-- SELECT and nothing else; allocation happens only inside the SECURITY DEFINER
-- function below, which is not granted to `authenticated` at all.

create table if not exists pilot.document_sequences (
  account_id  uuid    not null references pilot.accounts (id) on delete cascade,
  kind        text    not null check (kind in ('trip', 'invoice')),
  next_value  integer not null default 1 check (next_value >= 1),
  updated_at  timestamptz not null default now(),
  primary key (account_id, kind)
);

comment on table pilot.document_sequences is
  'Per-account, per-kind counter for human-facing document numbers. Written '
  'ONLY by pilot.next_document_number(). Tenants may read it (to preview "your '
  'next invoice will be INV-0042") and may never write it.';

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
  'BEHAVIOUR, stated because Phase 5 must make a decision about it: numbers are '
  'gapless under commit, but a rolled-back transaction burns its number. That '
  'is fine for trips (cosmetic) and may not be fine for invoices where a '
  'gapless billing sequence is expected — if so, Phase 5 allocates the invoice '
  'number at SEND time rather than at draft time. Do not "fix" it by changing '
  'this function to a max()+1 scan, which is both racy and slower. SECURITY '
  'DEFINER because it writes a table the caller has no write grant on; '
  'recursion-safe by the table-owner RLS exemption documented in Phase 1.';

revoke all on function pilot.next_document_number(uuid, text) from public;
grant execute on function pilot.next_document_number(uuid, text) to service_role;
-- Deliberately NOT granted to `authenticated`: no tenant-reachable code path
-- may burn numbers directly. The only caller is the BEFORE INSERT trigger on
-- pilot.trips, which runs as this function's owner.


-- ############################################################################
-- SECTION 2 — THE EXPIRATION ENGINE
-- ############################################################################
-- Requirements A1 (one ladder over every date-bearing item, T-30/T-14/T-7/T-1/
-- OVERDUE) and C4 (every table carrying an expiry participates BY
-- CONSTRUCTION, one code path, with a verify script asserting nothing is
-- outside it).
--
-- WHAT WENT WRONG IN THE SYSTEM THIS LEARNS FROM, precisely: the ladder fired
-- for crew documents and never for two expired compliance programs, because
-- those lived in a different module nobody wired in. The failure was not a bug
-- in the ladder. It was an OMISSION WITH NO RECORD — nothing in their schema
-- could be queried to discover that a module was missing. Every choice below
-- exists to make an omission either impossible or loudly visible as a row.
--
-- THE MECHANISM, in four parts:
--
--   (1) pilot.expiring_sources — a REGISTRY. Participation is a row.
--       Non-participation is ALSO a row (participates = false) and requires a
--       written reason enforced by a CHECK. There is no third state, so "nobody
--       thought about that module" stops being invisible.
--
--   (2) pilot.declare_expiring_source() — the ONLY way into the registry. It
--       validates the table's shape, writes the registry row, ATTACHES the
--       projection trigger, and backfills existing rows, in one call, in one
--       transaction. You cannot register without wiring and cannot wire without
--       registering. This is the "one code path" C4 asks for: exactly one
--       trigger function shared by every source table, driven by registry
--       metadata instead of per-table code.
--
--   (3) pilot.assert_expiry_coverage() — scans pg_catalog for any column in
--       schema `pilot` that LOOKS like an expiry (see
--       pilot.looks_like_expiry_column) and raises if its table is absent from
--       the registry, registered but untriggered, exempt without a reason, or
--       drifted out of sync with its projection.
--
--   (4) THE CONVENTION THAT MAKES (3) STRUCTURAL: every migration in this repo
--       ends with `select pilot.assert_expiry_coverage();` — including this
--       one. Supabase applies each migration in a transaction, so a migration
--       that adds a date-bearing table without wiring it FAILS AND ROLLS BACK,
--       at the moment the mistake is made, by the person making it, with a
--       message naming the table and the fix. `npm run expirations:verify`
--       calls the same function against the live database.
--
-- WHY THERE IS NO DDL EVENT TRIGGER HERE, since a future editor will ask.
-- An `on ddl_command_end` event trigger looks like the obvious enforcement
-- point and does not work. It fires at the end of the CREATE TABLE statement,
-- which is necessarily BEFORE the declare call that wires the new table, so it
-- would reject every legitimate migration. And `create event trigger` requires
-- superuser, which the `postgres` role on hosted Supabase does not have — the
-- statement would fail and take the whole migration with it. The migration-tail
-- assertion in (4) gives the same guarantee with no privilege requirement and
-- no ordering problem. Do not "improve" this by adding an event trigger.
--
-- WHY A PROJECTION TABLE AND NOT A UNION VIEW. A `union all` view over every
-- date-bearing table would be honest by construction (no copy to keep in sync)
-- and fails C4 in exactly the way the audit describes: adding a table means
-- editing the view, and forgetting is silent. It also cannot be indexed, and
-- "everything expiring in the next 30 days for this account" runs on every
-- Overview render. The projection is a denormalised copy; what keeps it honest
-- is stated at pilot.expirations below.

-- ----------------------------------------------------------------------------
-- 2a. What counts as an expiry column
-- ----------------------------------------------------------------------------
-- One definition, used by the coverage assertion and mirrorable by any lint.
-- Deliberately broad: a false positive costs one explicit exemption row (cheap,
-- and self-documenting), a false negative costs a silently unmonitored expiry
-- (the exact C4 failure). `ends_at` is in the pattern specifically so that
-- pilot.accounts.trial_ends_at is caught and has to be reasoned about — see the
-- exemption in section 8. `trips.end_date` is deliberately NOT caught: a trip's
-- end is not an expiry.

create or replace function pilot.looks_like_expiry_column(p_column_name text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_column_name ~ '(expir|valid_until|due_on|due_at|ends_at)';
$$;

comment on function pilot.looks_like_expiry_column(text) is
  'The single definition of "this column carries an expiry", used by '
  'pilot.assert_expiry_coverage(). Broad on purpose: a false positive costs one '
  'exemption row; a false negative costs an unmonitored expiry.';

-- ----------------------------------------------------------------------------
-- 2b. The escalation ladder — A1, defined exactly once
-- ----------------------------------------------------------------------------
-- T-30 / T-14 / T-7 / T-1 / OVERDUE. DO NOT re-implement these thresholds in
-- TypeScript. A ladder implemented twice is C2's "two sources for one number"
-- with a compliance consequence attached.

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
  'The A1 escalation ladder. `expires_on` is the LAST VALID DAY inclusive, so '
  'an item is ''t_minus_1'' (0 days remaining) on its expiry date and '
  '''overdue'' the day after. IMMUTABLE with an explicit as-of date rather than '
  'reading current_date, so it is testable against fixtures and usable in an '
  'index expression should that ever be needed.';

revoke all on function pilot.expiry_stage(date, date) from public;
grant execute on function pilot.expiry_stage(date, date) to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 2c. pilot.expiring_sources — the registry
-- ----------------------------------------------------------------------------
-- NOT tenant data: this is schema configuration. It therefore has no
-- account_id, a DELIBERATE and narrow exception to "every table carries
-- account_id". The rule behind that rule is "no tenant sees another tenant's
-- rows", and the correct treatment for a non-tenant table is NO TENANT ACCESS
-- AT ALL rather than a fabricated account_id column. RLS is enabled with ZERO
-- policies and `authenticated` gets no grant, so it is unreadable from any
-- client session. Do not "fix" this by adding a permissive read policy; nothing
-- in the UI needs it.

create table if not exists pilot.expiring_sources (
  -- Table name only (no schema): everything here lives in `pilot`. Text rather
  -- than regclass so the registry survives a table rename being caught by the
  -- coverage assertion instead of silently following it.
  table_name           text primary key,

  participates         boolean not null default true,
  -- An exemption MUST say why. This constraint is the whole anti-C4 device: it
  -- turns "we forgot" into a sentence someone had to write and someone else can
  -- read.
  exemption_reason     text,

  -- Column names on the source table that the ONE projection trigger reads.
  -- Metadata, not SQL expressions: the trigger pulls fields out of
  -- to_jsonb(NEW) by name, so there is no dynamic expression evaluation and no
  -- injection surface anywhere in the hot path.
  expiry_column        text,
  kind_column          text,
  label_column         text,
  status_column        text,
  active_status_values text[],
  client_column        text,
  trip_column          text,

  declared_at          timestamptz not null default now(),

  constraint expiring_sources_exemption_needs_reason
    check (participates
           or (exemption_reason is not null and length(trim(exemption_reason)) > 20)),
  constraint expiring_sources_participation_needs_columns
    check (not participates
           or (expiry_column is not null
               and kind_column is not null
               and label_column is not null)),
  constraint expiring_sources_status_pair
    check ((status_column is null) = (active_status_values is null))
);

comment on table pilot.expiring_sources is
  'Registry of every pilot.* table that carries an expiry, and of every table '
  'that deliberately does not participate together with the written reason. C4: '
  'the system this design learns from failed because a module was never wired '
  'in and nothing recorded that fact. Here, absence from this table is not a '
  'silent state — pilot.assert_expiry_coverage() raises on it, and every '
  'migration ends by calling that function.';

-- ----------------------------------------------------------------------------
-- 2d. pilot.expirations — the single projection every ladder query reads
-- ----------------------------------------------------------------------------
-- WHAT KEEPS THIS COPY HONEST, stated plainly because it IS a copy:
--   * One trigger function, attached automatically at declare time, fires on
--     INSERT/UPDATE/DELETE of every registered source. There is no second write
--     path: `authenticated` has no INSERT/UPDATE/DELETE grant at all.
--   * `unique (source_table, source_id)` makes "exactly one projection row per
--     source row" a database fact rather than an application convention.
--   * source_table is a FK to the registry, so a projection from a de-registered
--     table cannot linger.
--   * assert_expiry_coverage() does a two-way anti-join between every source
--     and this table, so drift from any cause — a direct service-role write, a
--     restored backup, a bug — is a loud failure rather than a wrong number.

create table if not exists pilot.expirations (
  id            uuid primary key default gen_random_uuid(),
  account_id    uuid not null references pilot.accounts (id) on delete cascade,

  source_table  text not null references pilot.expiring_sources (table_name)
                  on update cascade,
  source_id     uuid not null,

  -- Projected from the source's kind/label columns so the ladder query never
  -- joins back to the source just to render a row. THIS is the denormalisation
  -- that earns its keep: the Overview board renders N rows with zero joins off
  -- one index range scan, and the honesty cost is paid by the two-way anti-join
  -- in assert_expiry_coverage().
  kind          text not null,
  label         text not null,

  expires_on    date not null,

  -- Deep-link scope (A1: "each alert deep-links to the owning record").
  -- Composite FKs, so a projection can never point at another tenant's client
  -- or trip. Nullable columns under MATCH SIMPLE simply skip the check, which
  -- is the behaviour wanted here.
  client_id     uuid,
  trip_id       uuid,

  -- Notification bookkeeping for Phase 8's notifier. Cheap now, awkward later:
  -- without it the notifier keeps its own side table and the "which rung have I
  -- already rung" state ends up somewhere that does not get cleared when the
  -- item is renewed.
  notified_stage text check (notified_stage in
                    ('t_minus_30','t_minus_14','t_minus_7','t_minus_1','overdue')),
  notified_at    timestamptz,

  projected_at  timestamptz not null default now(),

  unique (source_table, source_id)
  -- The composite FKs on (client_id, account_id) and (trip_id, account_id) are
  -- added in section 7b, after pilot.clients and pilot.trips exist. They belong
  -- to this table conceptually; they are simply not declarable yet.
);

comment on table pilot.expirations is
  'THE single projection of every date-bearing row in this schema. Read-only to '
  'tenants; written exclusively by pilot.project_expiration() through triggers '
  'that pilot.declare_expiring_source() attaches. Every expiry surface in the '
  'product — the Currency & Expirations board, the Needs Attention queue, the '
  'notification ladder — reads this table and only this table.';

comment on column pilot.expirations.notified_stage is
  'Highest ladder rung already notified. RESET TO NULL BY THE PROJECTION '
  'TRIGGER whenever expires_on changes, so a renewed medical re-enters the '
  'ladder. Omitting that reset is the obvious bug here: renew once, never be '
  'warned again.';

-- The index the whole engine exists to serve. account_id FIRST, because the RLS
-- predicate is always `account_id in (...)` — a non-account-leading index on a
-- tenant table is close to useless under RLS, since the policy forces an
-- account_id restriction into every plan. Same rule for every index in this file.
create index if not exists expirations_account_expires_idx
  on pilot.expirations (account_id, expires_on);

-- Deep-link / scoping lookups: "what is expiring for this client" (the W-9 and
-- statement surfaces) and "for this trip".
create index if not exists expirations_account_client_idx
  on pilot.expirations (account_id, client_id) where client_id is not null;
create index if not exists expirations_account_trip_idx
  on pilot.expirations (account_id, trip_id) where trip_id is not null;

-- ----------------------------------------------------------------------------
-- 2e. pilot.project_expiration() — THE one code path (C4)
-- ----------------------------------------------------------------------------
-- One trigger function for every source table, forever. It reads registry
-- metadata keyed on TG_TABLE_NAME and pulls values out of to_jsonb(NEW) by
-- column name. Adding a source table adds zero lines of trigger code.
--
-- SECURITY DEFINER because pilot.expirations has RLS enabled and deliberately
-- no INSERT policy. The function's owner also owns pilot.expirations, and
-- Postgres exempts a table's owner from its RLS unless FORCE ROW LEVEL SECURITY
-- is set. That is the same fragile-but-documented mechanism Phase 1 relies on
-- for current_account_ids(), and it carries the same warning: DO NOT SET FORCE
-- ROW LEVEL SECURITY ON pilot.expirations. If you do, every write to
-- pilot.documents starts failing with a policy violation raised from inside a
-- trigger, which is a genuinely confusing error to debug.
--
-- account_id is taken from the SOURCE ROW, never from the session. A tenant
-- cannot cause a projection row under another account_id without first writing
-- the source row under that account_id, which RLS already prevents.

create or replace function pilot.project_expiration()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  src       pilot.expiring_sources%rowtype;
  rec       jsonb;
  v_id      uuid;
  v_account uuid;
  v_expires date;
  v_active  boolean := true;
begin
  select * into src
    from pilot.expiring_sources
   where table_name = tg_table_name;

  if not found or not src.participates then
    -- Unreachable via declare_expiring_source(), the only thing that attaches
    -- this trigger. If it happens, someone attached the trigger by hand or
    -- de-registered a live table. Fail loudly (C1: no silent write failures;
    -- a blocked write says why).
    raise exception
      'pilot.project_expiration fired for table % which is not a participating '
      'entry in pilot.expiring_sources. Use pilot.declare_expiring_source().',
      tg_table_name;
  end if;

  if tg_op = 'DELETE' then
    rec := to_jsonb(old);
    delete from pilot.expirations
     where source_table = tg_table_name
       and source_id = (rec ->> 'id')::uuid;
    return old;
  end if;

  rec       := to_jsonb(new);
  v_id      := (rec ->> 'id')::uuid;
  v_account := (rec ->> 'account_id')::uuid;
  -- ::date on a timestamptz's text form truncates to the UTC calendar day,
  -- which is what the ladder wants: it counts days, and A10 forbids carrying a
  -- zone. Source columns already of type `date` pass through unchanged.
  v_expires := nullif(rec ->> src.expiry_column, '')::date;

  if src.status_column is not null then
    v_active := (rec ->> src.status_column) = any (src.active_status_values);
  end if;

  -- A row with no expiry, or no longer in an active status (a superseded
  -- medical, a voided document, a W-9 still merely requested), must LEAVE the
  -- ladder. Forgetting this branch is how a replaced document keeps firing
  -- alerts forever.
  if v_expires is null or not v_active then
    delete from pilot.expirations
     where source_table = tg_table_name
       and source_id = v_id;
    return new;
  end if;

  insert into pilot.expirations as e (
    account_id, source_table, source_id, kind, label, expires_on,
    client_id, trip_id, projected_at
  )
  values (
    v_account,
    tg_table_name,
    v_id,
    rec ->> src.kind_column,
    rec ->> src.label_column,
    v_expires,
    case when src.client_column is null then null
         else nullif(rec ->> src.client_column, '')::uuid end,
    case when src.trip_column is null then null
         else nullif(rec ->> src.trip_column, '')::uuid end,
    now()
  )
  on conflict (source_table, source_id) do update
    set account_id     = excluded.account_id,
        kind           = excluded.kind,
        label          = excluded.label,
        expires_on     = excluded.expires_on,
        client_id      = excluded.client_id,
        trip_id        = excluded.trip_id,
        projected_at   = now(),
        -- Renewal re-enters the ladder; anything else keeps its rung.
        notified_stage = case when e.expires_on is distinct from excluded.expires_on
                              then null else e.notified_stage end,
        notified_at    = case when e.expires_on is distinct from excluded.expires_on
                              then null else e.notified_at end;

  return new;
end;
$$;

comment on function pilot.project_expiration() is
  'The single projection code path required by C4. Attached to every '
  'participating source by pilot.declare_expiring_source(); driven entirely by '
  'pilot.expiring_sources metadata, so a new date-bearing table adds no trigger '
  'code. SECURITY DEFINER for the table-owner RLS exemption — see the FORCE ROW '
  'LEVEL SECURITY warning above the definition.';

revoke all on function pilot.project_expiration() from public;

-- ----------------------------------------------------------------------------
-- 2f. Backfill / repair
-- ----------------------------------------------------------------------------
-- Called by declare_expiring_source() (so registering a table that already has
-- rows is correct immediately) and available to the verify script as a repair
-- step. Preserves notified_stage for rows whose expires_on is unchanged, for the
-- same reason the trigger does.

create or replace function pilot.rebuild_expirations(p_table_name text default null)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  src           pilot.expiring_sources%rowtype;
  status_clause text;
  affected      integer := 0;
  n             integer;
begin
  for src in
    select * from pilot.expiring_sources
     where participates
       and (p_table_name is null or table_name = p_table_name)
     order by table_name
  loop
    status_clause := case
      when src.status_column is null then ''
      else pg_catalog.format(' and s.%I = any (%L::text[])',
                             src.status_column, src.active_status_values)
    end;

    execute pg_catalog.format($f$
      insert into pilot.expirations as e (
        account_id, source_table, source_id, kind, label, expires_on,
        client_id, trip_id, projected_at
      )
      select s.account_id, %L, s.id, s.%I::text, s.%I::text, (s.%I)::date,
             %s, %s, now()
        from pilot.%I s
       where s.%I is not null %s
      on conflict (source_table, source_id) do update
        set account_id     = excluded.account_id,
            kind           = excluded.kind,
            label          = excluded.label,
            expires_on     = excluded.expires_on,
            client_id      = excluded.client_id,
            trip_id        = excluded.trip_id,
            projected_at   = now(),
            notified_stage = case when e.expires_on is distinct from excluded.expires_on
                                  then null else e.notified_stage end,
            notified_at    = case when e.expires_on is distinct from excluded.expires_on
                                  then null else e.notified_at end
    $f$,
      src.table_name, src.kind_column, src.label_column, src.expiry_column,
      coalesce('s.' || pg_catalog.quote_ident(src.client_column), 'null::uuid'),
      coalesce('s.' || pg_catalog.quote_ident(src.trip_column),   'null::uuid'),
      src.table_name, src.expiry_column, status_clause);
    get diagnostics n = row_count;
    affected := affected + n;

    -- Drop projections whose source row no longer qualifies (expiry cleared,
    -- status moved to superseded/void, row removed outside the trigger).
    execute pg_catalog.format($f$
      delete from pilot.expirations e
       where e.source_table = %L
         and not exists (
           select 1 from pilot.%I s
            where s.id = e.source_id and s.%I is not null %s
         )
    $f$, src.table_name, src.table_name, src.expiry_column, status_clause);
  end loop;

  return affected;
end;
$$;

revoke all on function pilot.rebuild_expirations(text) from public;
grant execute on function pilot.rebuild_expirations(text) to service_role;

-- ----------------------------------------------------------------------------
-- 2g. pilot.declare_expiring_source() — the only way in
-- ----------------------------------------------------------------------------
-- Registers, validates, attaches the trigger, and backfills. One call. There is
-- no supported way to do half of it.

create or replace function pilot.declare_expiring_source(
  p_table_name           text,
  p_kind_column          text    default null,
  p_label_column         text    default null,
  p_expiry_column        text    default 'expires_on',
  p_status_column        text    default null,
  p_active_status_values text[]  default null,
  p_client_column        text    default null,
  p_trip_column          text    default null,
  p_participates         boolean default true,
  p_exemption_reason     text    default null
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  c   text;
  rel oid;
begin
  rel := pg_catalog.to_regclass('pilot.' || pg_catalog.quote_ident(p_table_name));
  -- The table must exist and be shaped like a tenant table. Both assumptions
  -- are baked into pilot.project_expiration() (it reads `id` and `account_id`
  -- out of the row), so they are checked here rather than discovered at 3am
  -- when a trigger throws.
  if rel is null then
    raise exception
      'pilot.declare_expiring_source: table pilot.% does not exist. Declare it '
      'AFTER the create table, in the same migration.', p_table_name;
  end if;

  if p_participates then
    foreach c in array array[p_expiry_column, p_kind_column, p_label_column,
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
  end if;

  insert into pilot.expiring_sources (
    table_name, participates, exemption_reason, expiry_column, kind_column,
    label_column, status_column, active_status_values, client_column, trip_column
  )
  values (
    p_table_name, p_participates, p_exemption_reason,
    case when p_participates then p_expiry_column end,
    case when p_participates then p_kind_column end,
    case when p_participates then p_label_column end,
    case when p_participates then p_status_column end,
    case when p_participates then p_active_status_values end,
    case when p_participates then p_client_column end,
    case when p_participates then p_trip_column end
  )
  on conflict (table_name) do update
    set participates         = excluded.participates,
        exemption_reason     = excluded.exemption_reason,
        expiry_column        = excluded.expiry_column,
        kind_column          = excluded.kind_column,
        label_column         = excluded.label_column,
        status_column        = excluded.status_column,
        active_status_values = excluded.active_status_values,
        client_column        = excluded.client_column,
        trip_column          = excluded.trip_column;

  if p_participates then
    -- Fixed trigger name so assert_expiry_coverage() can check for it by name.
    execute pg_catalog.format(
      'create or replace trigger expiration_project '
      'after insert or update or delete on pilot.%I '
      'for each row execute function pilot.project_expiration()',
      p_table_name);
    perform pilot.rebuild_expirations(p_table_name);
  else
    execute pg_catalog.format(
      'drop trigger if exists expiration_project on pilot.%I', p_table_name);
    delete from pilot.expirations where source_table = p_table_name;
  end if;
end;
$$;

comment on function pilot.declare_expiring_source(text,text,text,text,text,text[],text,text,boolean,text) is
  'The ONLY supported way to add (or exempt) a date-bearing table. Validates '
  'the table shape, writes the registry row, attaches the one shared projection '
  'trigger, and backfills — atomically. Call it immediately after the CREATE '
  'TABLE in the same migration, and end that migration with '
  'select pilot.assert_expiry_coverage().';

revoke all on function pilot.declare_expiring_source(text,text,text,text,text,text[],text,text,boolean,text) from public;
grant execute on function pilot.declare_expiring_source(text,text,text,text,text,text[],text,text,boolean,text) to service_role;

-- ----------------------------------------------------------------------------
-- 2h. pilot.assert_expiry_coverage() — the C4 gate
-- ----------------------------------------------------------------------------
-- Raises on the first problem it finds, with a message naming the table and the
-- fix (C1: a blocked write says why). Called at the end of every migration and
-- by `npm run expirations:verify`.
--
-- It must see every tenant's rows to compare source against projection, so it
-- is NOT granted to `authenticated` — that would be a cross-tenant row-count
-- oracle. Run it as the owner (migrations) or as service_role (verify script).

create or replace function pilot.assert_expiry_coverage()
returns void
language plpgsql
set search_path = ''
as $$
declare
  r             record;
  src           pilot.expiring_sources%rowtype;
  status_clause text;
  missing       bigint;
  extra         bigint;
begin
  -- (A) COVERAGE. Any table in `pilot` with an expiry-looking column must
  -- appear in the registry, as a participant or as a written exemption. The
  -- engine's own tables are excluded: pilot.expirations obviously carries
  -- expires_on, and registering it would make the projection project itself.
  for r in
    select c.relname as table_name, a.attname as column_name
      from pg_catalog.pg_class     c
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
      join pg_catalog.pg_attribute a on a.attrelid = c.oid
      join pg_catalog.pg_type      t on t.oid = a.atttypid
     where n.nspname = 'pilot'
       and c.relkind = 'r'
       and a.attnum > 0
       and not a.attisdropped
       and t.typname in ('date', 'timestamptz', 'timestamp')
       and pilot.looks_like_expiry_column(a.attname)
       and c.relname not in ('expirations', 'expiring_sources')
       and not exists (select 1 from pilot.expiring_sources s
                        where s.table_name = c.relname)
     order by 1, 2
  loop
    raise exception
      'EXPIRY COVERAGE FAILURE (C4): pilot.%.% looks like an expiry but pilot.% '
      'is not in pilot.expiring_sources. Either wire it in with '
      'pilot.declare_expiring_source(''%'', ...) or exempt it explicitly with '
      'p_participates => false and a written reason. This is the exact failure '
      'mode the expiration engine exists to prevent.',
      r.table_name, r.column_name, r.table_name, r.table_name;
  end loop;

  -- (B) WIRING. A registry row without its trigger is worse than no registry
  -- row, because it looks covered.
  for src in select * from pilot.expiring_sources where participates loop
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
        '`expiration_project` trigger. Re-run '
        'pilot.declare_expiring_source(''%'', ...).', src.table_name, src.table_name;
    end if;
  end loop;

  -- (C) ORPHANS. A projection row whose source is registered-but-not-
  -- participating, or gone.
  if exists (
    select 1 from pilot.expirations e
     where not exists (select 1 from pilot.expiring_sources s
                        where s.table_name = e.source_table and s.participates)
  ) then
    raise exception
      'EXPIRY ORPHAN FAILURE: pilot.expirations holds rows for a source that is '
      'not a participating registry entry.';
  end if;

  -- (D) FIDELITY. Two-way anti-join per source: every qualifying source row has
  -- a projection row with matching values, and every projection row has a
  -- qualifying source row. This is what turns "the ladder is correct" from a
  -- claim into an assertion (C2).
  for src in select * from pilot.expiring_sources where participates loop
    status_clause := case
      when src.status_column is null then ''
      else pg_catalog.format(' and s.%I = any (%L::text[])',
                             src.status_column, src.active_status_values)
    end;

    execute pg_catalog.format($f$
      select count(*) from pilot.%I s
       where s.%I is not null %s
         and not exists (
           select 1 from pilot.expirations e
            where e.source_table = %L
              and e.source_id    = s.id
              and e.account_id   = s.account_id
              and e.expires_on   = (s.%I)::date
              and e.kind         = s.%I::text
              and e.label        = s.%I::text
         )
    $f$, src.table_name, src.expiry_column, status_clause, src.table_name,
         src.expiry_column, src.kind_column, src.label_column)
    into missing;

    execute pg_catalog.format($f$
      select count(*) from pilot.expirations e
       where e.source_table = %L
         and not exists (
           select 1 from pilot.%I s
            where s.id = e.source_id and s.%I is not null %s
         )
    $f$, src.table_name, src.table_name, src.expiry_column, status_clause)
    into extra;

    if missing > 0 or extra > 0 then
      raise exception
        'EXPIRY DRIFT FAILURE for pilot.%: % source row(s) missing from '
        'pilot.expirations, % projection row(s) with no qualifying source. Run '
        'select pilot.rebuild_expirations(''%'') and then find out what wrote '
        'around the trigger.',
        src.table_name, missing, extra, src.table_name;
    end if;
  end loop;
end;
$$;

comment on function pilot.assert_expiry_coverage() is
  'THE C4 GATE. Raises unless every date-bearing table in schema pilot is '
  'either wired into the expiration engine or exempted with a written reason, '
  'every participant carries its projection trigger, and every projection row '
  'matches its source exactly. EVERY MIGRATION IN THIS REPO MUST END WITH '
  '`select pilot.assert_expiry_coverage();` — that is what makes forgetting to '
  'wire a new table abort the migration instead of silently disabling alerts.';

revoke all on function pilot.assert_expiry_coverage() from public;
grant execute on function pilot.assert_expiry_coverage() to service_role;

-- Human-readable companion, for the verify script's output.
create or replace function pilot.expiry_coverage_report()
returns table (table_name text, participates boolean, projected_rows bigint, note text)
language sql
stable
set search_path = ''
as $$
  select s.table_name,
         s.participates,
         (select count(*) from pilot.expirations e where e.source_table = s.table_name),
         coalesce(s.exemption_reason, 'wired on ' || s.expiry_column)
    from pilot.expiring_sources s
   order by s.participates desc, s.table_name;
$$;

revoke all on function pilot.expiry_coverage_report() from public;
grant execute on function pilot.expiry_coverage_report() to service_role;


-- ############################################################################
-- SECTION 3 — pilot.clients (Phase 3)
-- ############################################################################
-- The pilot's OWN customers. Nothing here is ever visible to AMG: there is no
-- policy and no application read path that crosses the account boundary, and
-- that absence is the product (docs/PLAN.md).
--
-- READ PATHS THIS TABLE SERVES:
--   * Clients list, sorted by name.                  -> clients_account_name_idx
--   * Trip creation pre-fill (A4 config-once rates). -> primary key
--   * Trips list / Ready to Invoice, joined for the
--     client's name.                                 -> primary key
--   * Client statement (Phase 8), client x period.   -> trips indexes, not here
--
-- W-9 IS DELIBERATELY NOT A COLUMN HERE. docs/PLAN.md sketches
-- `clients.w9_status` and a sent date; that would be a second source for
-- something pilot.documents already owns (C2). A W-9 is a dated document with a
-- counterparty — exactly what pilot.documents models — and a status column here
-- as well guarantees the two disagree the first time someone uploads a W-9
-- without touching the client row. "W-9 outstanding" in the queue is therefore
-- a documents row with status = 'requested' and a requested_at date; "W-9 on
-- file" for the paperwork gate is a documents row with status = 'on_file'. See
-- pilot.needs_attention and pilot.trip_paperwork.

create table if not exists pilot.clients (
  id                        uuid primary key default gen_random_uuid(),
  account_id                uuid not null references pilot.accounts (id) on delete cascade,

  name                      text not null check (length(trim(name)) > 0),
  contact_name              text,
  contact_email             text,
  contact_phone             text,

  billing_address_line1     text,
  billing_address_line2     text,
  billing_city              text,
  billing_state             text,
  billing_postal_code       text,
  billing_country           text,

  -- A4 — config-once rates that multiply into trips. NULL means "no default
  -- agreed", which is different from zero and must stay distinguishable, so
  -- these are nullable rather than defaulted to 0.
  default_day_rate_cents    bigint check (default_day_rate_cents >= 0),
  default_per_diem_cents    bigint check (default_per_diem_cents >= 0),
  -- A4 also asks for a default expense treatment per client. Only the two
  -- decided values are allowed: 'unassigned' is a state a receipt lands in, not
  -- a policy anyone would configure.
  default_expense_treatment text check (default_expense_treatment in ('rebill','deduct')),

  payment_terms_days        integer not null default 30
                              check (payment_terms_days between 0 and 365),

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
  'path. Carries the config-once rate defaults (A4) that pre-fill trips.';

create index if not exists clients_account_name_idx
  on pilot.clients (account_id, name);

create or replace trigger clients_set_updated_at
  before update on pilot.clients
  for each row execute function pilot.set_updated_at();


-- ############################################################################
-- SECTION 4 — pilot.trips (Phase 3) — the financial atom (A2)
-- ############################################################################
-- READ PATHS THIS TABLE SERVES:
--   * Trips list, newest first.                    -> trips_account_start_idx
--   * Overview "Ready to Invoice" and the "Unbilled
--     Work" KPI: flown trips not yet invoiced.     -> trips_account_flown_idx
--   * Trip page header + margin rollup.            -> PK, pilot.trip_financials
--   * Client statement (Phase 8), client x period. -> trips_account_client_idx
--   * Year-end packet, income by client.           -> trips_account_client_idx
--
-- SNAPSHOT VS CACHE — the distinction that decides half this table.
--   day_rate_cents and per_diem_cents are COPIED from the client record at trip
--   creation (A4). That is a SNAPSHOT, not a cache, and it must never be "kept
--   in sync". The rate on a trip is the rate agreed for that job; raising your
--   default day rate in January must not silently rewrite what last October's
--   trips were worth. A cache has an authoritative source elsewhere and can be
--   recomputed; a snapshot IS the source. Do not add a trigger that refreshes
--   these from pilot.clients.
--
--   day_count is likewise NOT derived from legs. Contract-pilot days are a
--   negotiated unit: a two-day trip can be one leg, a repositioning day can be
--   zero legs, and a weather day is billable with nothing flown. Deriving it
--   from legs would be wrong in all three cases.
--
-- WHAT IS DELIBERATELY ABSENT: a `billing_state` column. "Is this trip
-- invoiced" has exactly one true answer and it lives in Phase 5's invoice
-- lines. A denormalised billing_state here would be a second source for it (C2)
-- that goes stale the first time an invoice is voided.

create table if not exists pilot.trips (
  id             uuid primary key default gen_random_uuid(),
  account_id     uuid not null references pilot.accounts (id) on delete cascade,

  -- Human reference (TRP-0114). Allocated by trigger; not client-writable.
  trip_number    integer not null,

  -- NOT NULL on purpose. A trip is a JOB and a job has a customer; the margin
  -- rollup, the client statement and the invoice all assume one. Personal
  -- flying is a Phase 6 logbook entry with no trip, which is its correct home.
  -- The cost of this decision is that a pilot flying an owner_trip must have a
  -- client record for the owner — which they need anyway in order to invoice.
  client_id      uuid not null,

  title          text,

  -- Ported VERBATIM from docs/PLAN.md "Verified ground truth". Do not extend
  -- without recording the decision there — enum drift is a named risk.
  trip_kind      text not null check (trip_kind in (
                   'owner_trip', 'ferry', 'maintenance_flight', 'repositioning',
                   'contract_pilot', 'delivery_flight', 'other')),

  -- The trip's own lifecycle, and NOTHING operational. A record of what
  -- happened, never a clearance, never a go/no-go. See the liability boundary
  -- note above pilot.trip_paperwork.
  status         text not null default 'scheduled'
                   check (status in ('scheduled', 'flown', 'canceled')),

  start_date     date not null,
  end_date       date not null,

  aircraft_ident text,
  aircraft_type  text,

  -- B6: trip participants are DATA, not identities. Plain text labels for the
  -- humans on the trip. NOT foreign keys to auth.users and they must never
  -- become them — pilot.account_members is the only auth model in this product,
  -- and a two-pilot LLC where one seat does the books must be able to name the
  -- other pilot without provisioning them a login.
  -- INVARIANT FOR THE VERIFY SCRIPT: no table in schema `pilot` other than
  -- pilot.account_members has a foreign key to auth.users.
  pic_label      text,
  sic_label      text,

  day_count      numeric(5,2) not null default 0 check (day_count >= 0),
  day_rate_cents bigint       not null default 0 check (day_rate_cents >= 0),
  per_diem_cents bigint       not null default 0 check (per_diem_cents >= 0),

  notes          text,

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  check (end_date >= start_date),

  unique (account_id, trip_number),
  unique (id, account_id),

  constraint trips_client_fk foreign key (client_id, account_id)
    references pilot.clients (id, account_id) on delete restrict
);

comment on table pilot.trips is
  'The parent record and the product''s financial atom (A2). billable = '
  'day_count x (day_rate + per_diem) + rebilled expenses; trip_net = billable - '
  'deducted expenses. Those figures are computed in pilot.trip_financials and '
  'NOWHERE ELSE.';

comment on column pilot.trips.day_rate_cents is
  'SNAPSHOT of the rate agreed for this job at trip creation, NOT a cache of '
  'pilot.clients.default_day_rate_cents. Never refresh it from the client '
  'record: that retroactively rewrites historical trip value.';

-- Trips list and date-ranged reports (statement period, tax year).
create index if not exists trips_account_start_idx
  on pilot.trips (account_id, start_date desc);

-- Ready to Invoice / Unbilled Work. Partial on the only status that can BE
-- unbilled work, so the index stays small and the Overview query is a short
-- range scan rather than a filter over every trip the pilot has ever flown.
create index if not exists trips_account_flown_idx
  on pilot.trips (account_id, end_date desc) where status = 'flown';

-- Client statement, income-by-client, and the client detail page.
create index if not exists trips_account_client_idx
  on pilot.trips (account_id, client_id, start_date desc);

create or replace trigger trips_set_updated_at
  before update on pilot.trips
  for each row execute function pilot.set_updated_at();

-- Trip numbering. SECURITY DEFINER so it can reach pilot.document_sequences,
-- which no tenant may write. account_id comes from the row being inserted, and
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


-- ############################################################################
-- SECTION 5 — pilot.trip_legs (Phase 3)
-- ############################################################################
-- READ PATHS: the trip page (all legs of one trip, in order) and the Phase 6
-- logbook-draft builder (the same query). Both are served by the
-- unique (trip_id, leg_seq) index. There is no cross-trip list of legs in the
-- product, so no other index is justified yet — and an unused index is a write
-- tax on the one table that gets bulk-inserted.
--
-- A10 — NO TIMEZONE COLUMN. out_time_utc / in_time_utc are absolute instants.
-- Airport-local and Zulu are both DERIVED at display time from the ICAO code.
-- If you are about to add `timezone`, `tz_offset`, or `local_date` here, the
-- answer is the airport reference table in application code, not a column.
--
-- The columns beyond block time exist now, empty, because docs/PLAN.md
-- identifies them as the specific reason the inherited AMG logbook schema
-- cannot compute FAR 61.57(b) night currency: it records night_landings with no
-- full-stop flag and no night takeoff count. Adding them in Phase 6 or 7 means
-- backfilling from paper logbooks. Adding them now costs six smallint columns.

create table if not exists pilot.trip_legs (
  id           uuid primary key default gen_random_uuid(),
  account_id   uuid not null references pilot.accounts (id) on delete cascade,
  trip_id      uuid not null,

  -- Authoritative ordering. A leg can be entered before its times are known, so
  -- ordering cannot depend on out_time_utc.
  leg_seq      smallint not null check (leg_seq > 0),

  -- 3-4 uppercase alphanumerics covers ICAO (KTEB) and the 3-letter identifiers
  -- pilots actually type. The CHECK REJECTS lowercase rather than a trigger
  -- silently upper-casing it: C1 says every mutation ends in a visible success
  -- or a visible, specific failure, and a trigger that quietly rewrites input is
  -- how "I typed kteb and it saved something else" bugs start. The client
  -- normalises on input.
  from_icao    text not null check (from_icao ~ '^[A-Z0-9]{3,4}$'),
  to_icao      text not null check (to_icao   ~ '^[A-Z0-9]{3,4}$'),

  out_time_utc timestamptz,
  in_time_utc  timestamptz,

  -- Block time: the single stored source for duration. When both clock times
  -- are present the CHECK forces agreement, so "two sources for one number"
  -- (C2) is closed by the database rather than by a convention nobody reads.
  block_minutes             integer  check (block_minutes >= 0),

  night_minutes             integer  check (night_minutes >= 0),
  actual_instrument_minutes integer  check (actual_instrument_minutes >= 0),

  -- FAR 61.57(c): the count is what the rule requires. Approach type is
  -- recorded per-entry in Phase 6 where the import source provides it.
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

  unique (trip_id, leg_seq),
  unique (id, account_id),

  -- ON DELETE CASCADE because a leg has no meaning without its trip — unlike
  -- expenses and documents, which are independent artifacts and are RESTRICTed.
  constraint trip_legs_trip_fk foreign key (trip_id, account_id)
    references pilot.trips (id, account_id) on delete cascade,

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
  'Individual flight legs. The trip owns the calendar; legs own sequence and '
  'absolute instants. There is deliberately no leg_date column — see the A10 '
  'note in this file''s header.';

comment on column pilot.trip_legs.block_minutes is
  'The one stored source of flight duration. Where out/in are both present, '
  'trip_legs_block_matches_times forces them to agree, so the entered and '
  'derived values cannot diverge (C2).';

create or replace trigger trip_legs_set_updated_at
  before update on pilot.trip_legs
  for each row execute function pilot.set_updated_at();


-- ############################################################################
-- SECTION 6 — pilot.expenses (Phase 4)
-- ############################################################################
-- A3 — ONE classification set at capture drives everything downstream and no
-- surface ever re-asks. `treatment` is that classification and it is the ONLY
-- one. There is deliberately no is_billable, no include_in_margin, no
-- per-report override flag: the client-facing expense report is
-- treatment = 'rebill', the internal copy is everything, the deduction file is
-- treatment = 'deduct', the unassigned queue is treatment = 'unassigned', the
-- trip margin rollup reads the same column, and the year-end packet reads it
-- again. One column, five consequences. A sixth behaviour derives from this
-- column or it does not ship.
--
-- "Never re-asked" is a UI rule, not immutability. The whole point of the
-- unassigned queue is that treatment gets SET later, for receipts photographed
-- at the pump — so it IS in the UPDATE grant. What must never happen is a
-- second surface asking the same question again and storing the answer
-- somewhere else.
--
-- KNOWN GAP, stated rather than papered over: the source system also carries a
-- PAYER axis (company card / client's card / personal card). V1's treatment
-- vocabulary is locked at three values in docs/PLAN.md, so an expense the
-- client paid directly has no representation here and is simply not recorded.
-- If that turns out to matter, the deliberate change is a FOURTH treatment
-- value ('pass_through' — in the margin as neither rebill nor deduct), not a
-- second column. Two axes would re-open exactly the "one tag, five consequences"
-- discipline A3 exists to protect.
--
-- READ PATHS:
--   * Expenses list, newest first.              -> expenses_account_date_idx
--   * Unassigned queue (Overview + Expenses).   -> expenses_unassigned_idx
--   * Trip margin rollup and trip page.         -> expenses_account_trip_idx
--   * "Deductible Expenses" KPI, tax year.      -> expenses_account_deduct_idx
--   * Client copy of the per-trip expense report -> expenses_account_trip_idx

create table if not exists pilot.expenses (
  id            uuid primary key default gen_random_uuid(),
  account_id    uuid not null references pilot.accounts (id) on delete cascade,

  -- Nullable: a receipt exists before it is assigned to anything, and a
  -- deductible business expense (a headset, a hotel on a personal positioning
  -- leg) may never belong to a trip at all.
  trip_id       uuid,

  -- The date the money moved. This is the basis for the Deductible Expenses
  -- figure and the year-end packet, and C3 requires a report to state its
  -- basis: expenses are reported on incurred_on, always.
  incurred_on   date not null,

  -- Ported VERBATIM from docs/PLAN.md "Verified ground truth" (the amg1
  -- expenses.category vocabulary). Do not extend without recording the decision
  -- there.
  category      text not null check (category in (
                  'airline', 'hotel', 'rental_car', 'rideshare', 'fuel',
                  'meals', 'parking', 'other')),

  merchant      text,
  description   text,

  -- Signed on purpose. A refund or partial credit is recorded as a NEGATIVE
  -- amount carrying the SAME treatment as the original, so every rollup nets
  -- automatically and no surface needs a second concept ("credits") that would
  -- have to be taught separately to the margin view, the client report, the
  -- deduction file and the year-end packet. Zero is meaningless and rejected.
  amount_cents  bigint not null check (amount_cents <> 0),

  -- A3. Default 'unassigned' because that is what a photographed receipt IS
  -- until the pilot says otherwise, and because the unassigned queue is a
  -- first-class surface: those receipts are neither billed nor deducted, and
  -- that is exactly the point.
  treatment     text not null default 'unassigned'
                  check (treatment in ('rebill', 'deduct', 'unassigned')),

  -- Supabase Storage OBJECT PATH, not a URL. Signed URLs expire; storing one
  -- produces dead links in exports and in the client-facing expense report.
  -- ---------------------------------------------------------------------
  -- WARNING, and a real hole if ignored: nothing in this migration protects the
  -- storage object itself. Postgres RLS does not reach storage.objects. Receipt
  -- images are tenant data and need their own RLS policies on storage.objects
  -- keyed to a per-account path prefix, in the Phase 4 storage migration.
  -- `npm run tenancy:verify` must assert that tenant A cannot fetch tenant B's
  -- receipt object — the table being isolated is NOT the same as the image
  -- being isolated.
  storage_path        text,
  receipt_uploaded_at timestamptz,

  notes         text,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  unique (id, account_id),

  -- ON DELETE RESTRICT: not cascade, not set-null. An expense is an independent
  -- financial artifact with a receipt attached. Deleting a trip must not
  -- silently destroy it, and must not silently detach it into the unassigned
  -- queue either. It fails, visibly and specifically (C1), and the pilot
  -- decides.
  constraint expenses_trip_fk foreign key (trip_id, account_id)
    references pilot.trips (id, account_id) on delete restrict,

  -- You cannot re-bill an expense to nobody. This is the one place the
  -- treatment vocabulary interacts with the trip graph, and it is enforced.
  constraint expenses_rebill_needs_trip
    check (treatment <> 'rebill' or trip_id is not null)
);

comment on table pilot.expenses is
  'A3: `treatment` is the single classification, set at capture, that drives '
  'margin inclusion, report variant, the unassigned queue, the client statement '
  'and the deduction file. No downstream surface re-asks and none stores its '
  'own copy.';

comment on column pilot.expenses.storage_path is
  'Supabase Storage object path. The object itself is NOT protected by this '
  'migration — storage.objects needs its own account-scoped RLS policies.';

create index if not exists expenses_account_date_idx
  on pilot.expenses (account_id, incurred_on desc);

-- The trip margin rollup and the per-trip expense report.
create index if not exists expenses_account_trip_idx
  on pilot.expenses (account_id, trip_id) where trip_id is not null;

-- The unassigned queue. Partial, so it stays a few pages regardless of how many
-- thousands of settled receipts sit behind it — this query runs on every
-- Overview render.
create index if not exists expenses_unassigned_idx
  on pilot.expenses (account_id, incurred_on desc) where treatment = 'unassigned';

-- The "Deductible Expenses" KPI and the year-end packet, both a tax-year range
-- over deducted rows only.
create index if not exists expenses_account_deduct_idx
  on pilot.expenses (account_id, incurred_on) where treatment = 'deduct';

create or replace trigger expenses_set_updated_at
  before update on pilot.expenses
  for each row execute function pilot.set_updated_at();


-- ############################################################################
-- SECTION 7 — pilot.documents — the first expiration source
-- ############################################################################
-- Every date-bearing credential and every piece of counterparty paperwork:
-- medical, flight review, passport, certificates, W-9.
--
-- SCOPE. A document belongs to the ACCOUNT, and is optionally about one CLIENT
-- (a W-9 the client owes the pilot) or one TRIP (a permit for a specific job).
-- At most one — a document about both is really two documents.
--
-- WHY status EXISTS AND WHY 'requested' IS ONE OF ITS VALUES. The Needs
-- Attention queue must show "W-9 outstanding · Tarrant Family Office · sent 18
-- Jul". A missing row cannot carry a sent date, so the request itself is a row:
-- status = 'requested', requested_at set, no file, no expiry. When it comes back
-- it becomes 'on_file'. That is why pilot.clients has no w9_status column — one
-- source (C2).
--
-- 'superseded' exists because renewing a medical EARLY produces two rows with
-- future expiry dates. Without it the board shows the old one as current and the
-- ladder fires on a document that has been replaced. The projection trigger
-- tracks only status = 'on_file', so superseding removes it from the ladder in
-- the same statement.

create table if not exists pilot.documents (
  id               uuid primary key default gen_random_uuid(),
  account_id       uuid not null references pilot.accounts (id) on delete cascade,

  -- New vocabulary, defined deliberately (docs/PLAN.md names half-copying as a
  -- risk). Covers everything PLAN.md lists plus a generic bucket.
  doc_type         text not null check (doc_type in (
                     'medical', 'flight_review', 'passport', 'pilot_certificate',
                     'type_rating', 'radio_license', 'w9', 'insurance',
                     'contract', 'other')),

  -- The human label shown on the Currency & Expirations board ("First class
  -- medical"). Deliberately free text rather than a medical_class enum: the
  -- class matters only because it determines duration, and in Phases 3-4 the
  -- pilot enters the resulting expiry date directly. Phase 7 adds a structured
  -- class column when it needs to CALCULATE duration rather than display it —
  -- inventing half that vocabulary now is the enum-drift risk.
  title            text not null check (length(trim(title)) > 0),

  -- B6 again: whose document is it, as DATA. A business account may hold the
  -- second pilot's medical without that pilot having a login. Not a FK to
  -- auth.users, and must never become one.
  subject_label    text,

  client_id        uuid,
  trip_id          uuid,

  issuer           text,
  reference_number text,

  issued_on        date,
  -- The expiry the whole engine hangs off. LAST VALID DAY, INCLUSIVE.
  expires_on       date,

  status           text not null default 'on_file'
                     check (status in ('requested', 'on_file', 'superseded', 'void')),
  requested_at     timestamptz,
  superseded_by_document_id uuid,

  storage_path     text,
  notes            text,

  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  unique (id, account_id),

  constraint documents_client_fk foreign key (client_id, account_id)
    references pilot.clients (id, account_id) on delete restrict,
  constraint documents_trip_fk foreign key (trip_id, account_id)
    references pilot.trips (id, account_id) on delete restrict,
  -- ON DELETE RESTRICT, and the two obvious alternatives are both wrong:
  --   * ON DELETE SET NULL nulls EVERY column in the referencing key, including
  --     account_id, which is NOT NULL — the delete fails with a confusing
  --     not-null violation raised from inside a cascade. (Postgres 15+ has
  --     `set null (column_list)` to avoid that, but see the next point.)
  --   * Even a column-scoped SET NULL would leave the older row with
  --     status = 'superseded' and a null pointer, which violates
  --     documents_superseded_needs_target below.
  -- So: you cannot delete a document that another document names as its
  -- replacement until you fix the pointer. That fails loudly and specifically
  -- (C1), which is the correct behaviour for a record chain.
  constraint documents_superseded_fk foreign key (superseded_by_document_id, account_id)
    references pilot.documents (id, account_id) on delete restrict,

  constraint documents_single_scope
    check (client_id is null or trip_id is null),
  constraint documents_superseded_needs_target
    check (status <> 'superseded' or superseded_by_document_id is not null),
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

-- The Documents list.
create index if not exists documents_account_type_idx
  on pilot.documents (account_id, doc_type, expires_on);

-- "W-9 outstanding" in the Needs Attention queue. Partial and tiny.
create index if not exists documents_w9_outstanding_idx
  on pilot.documents (account_id, requested_at)
  where doc_type = 'w9' and status = 'requested';

-- The paperwork gate: does this client have a current W-9 on file.
create index if not exists documents_account_client_idx
  on pilot.documents (account_id, client_id) where client_id is not null;

create or replace trigger documents_set_updated_at
  before update on pilot.documents
  for each row execute function pilot.set_updated_at();


-- ----------------------------------------------------------------------------
-- 7b. Deferred composite FKs on pilot.expirations
-- ----------------------------------------------------------------------------
-- pilot.expirations is created up in section 2 with the rest of the engine,
-- before pilot.clients and pilot.trips exist, so its two tenant-scoped FKs are
-- attached here. They matter: the projection copies client_id / trip_id for
-- deep-linking, and without the composite FK that copy could be made to name
-- another tenant's row (the Phase 1 warning applies to projections too, not just
-- to tables a tenant writes directly).
--
-- Wrapped in a DO block because Postgres has no
-- `alter table ... add constraint if not exists` and this file must be
-- re-runnable.
do $$
begin
  if not exists (select 1 from pg_catalog.pg_constraint
                  where conname = 'expirations_client_fk'
                    and conrelid = 'pilot.expirations'::regclass) then
    alter table pilot.expirations
      add constraint expirations_client_fk
      foreign key (client_id, account_id)
      references pilot.clients (id, account_id) on delete cascade;
  end if;

  if not exists (select 1 from pg_catalog.pg_constraint
                  where conname = 'expirations_trip_fk'
                    and conrelid = 'pilot.expirations'::regclass) then
    alter table pilot.expirations
      add constraint expirations_trip_fk
      foreign key (trip_id, account_id)
      references pilot.trips (id, account_id) on delete cascade;
  end if;
end $$;


-- ############################################################################
-- SECTION 8 — WIRE THE SOURCES INTO THE ENGINE
-- ############################################################################
-- Two calls: one participant, one exemption. Both are rows. Neither is a
-- comment that can be deleted without the assertion noticing.

select pilot.declare_expiring_source(
  p_table_name           => 'documents',
  p_kind_column          => 'doc_type',
  p_label_column         => 'title',
  p_expiry_column        => 'expires_on',
  p_status_column        => 'status',
  -- ONLY 'on_file'. A requested W-9 has no expiry to track, and a superseded or
  -- void document must leave the ladder the moment its status changes.
  p_active_status_values => array['on_file'],
  p_client_column        => 'client_id',
  p_trip_column          => 'trip_id'
);

-- THE EXEMPTION THAT PROVES THE MECHANISM WORKS.
-- pilot.accounts.trial_ends_at matches pilot.looks_like_expiry_column(), so
-- pilot.assert_expiry_coverage() WILL raise on pilot.accounts until this row
-- exists. That is not an accident of the regex: `ends_at` is in the pattern
-- specifically so platform-billing dates have to be reasoned about out loud
-- rather than skipped because they belong to "a different module" — which is
-- precisely how the system this design learns from ended up with two expired
-- compliance programs that never triggered an alert.
select pilot.declare_expiring_source(
  p_table_name       => 'accounts',
  p_participates     => false,
  p_exemption_reason =>
    'accounts.trial_ends_at is PLATFORM BILLING state, owned by Stripe and the '
    'Phase 2 webhook, not a pilot compliance date. Putting "your trial ends in '
    '3 days" in the same Needs Attention queue as an expiring medical would set '
    'a sales prompt beside a currency item, and the T-30/T-14/T-7/T-1 rungs are '
    'wrong for a short trial anyway. Trial messaging is a billing-surface '
    'concern. Considered and deliberately excluded; revisit only if trial '
    'reminders are ever asked to share the Needs Attention queue.'
);


-- ############################################################################
-- SECTION 9 — VIEWS: the read paths the product actually performs
-- ############################################################################
-- EVERY VIEW HERE IS security_invoker = true. This is not optional and it is
-- the single most dangerous thing to get wrong in this file. A normal Postgres
-- view runs with the PRIVILEGES AND RLS CONTEXT OF ITS OWNER — which here is
-- the role that owns every pilot table, i.e. the role that is EXEMPT from RLS.
-- An un-invoker'd view over pilot.trips is a complete, silent, cross-tenant
-- data leak that no policy in this schema can stop. Phase 1 warns about exactly
-- this. If you add a view, write the WITH clause first and the query second.

-- ----------------------------------------------------------------------------
-- 9a. pilot.trip_financials — A2, the margin rollup
-- ----------------------------------------------------------------------------
-- WHY THIS IS A VIEW AND NOT DENORMALISED COLUMNS ON pilot.trips.
-- The tempting design is rebilled_expense_cents / deducted_expense_cents cached
-- on the trip and maintained by a trigger on pilot.expenses. It is not worth it:
-- a trip has on the order of ten expenses and a list page shows fifty trips, so
-- the aggregate is a few hundred index-local rows — microseconds — while the
-- cache would be a second source for a MONEY figure (C2) that has to be
-- re-verified forever. Denormalisation earns its keep in this schema in exactly
-- two places: account_id on every child row (kept honest BY THE COMPOSITE
-- FOREIGN KEYS, so the copy cannot disagree) and pilot.expirations (kept honest
-- by assert_expiry_coverage). Not here.
--
-- The nesting is deliberate: billable_cents is DEFINED ONCE and trip_net_cents
-- is defined in terms of it, so the two cannot drift into different arithmetic.
-- Every component is exposed separately because A2 requires each number on the
-- trip page to be traceable to its artifact.
--
-- ROUNDING: this is the only place a quantity becomes money in this schema.
-- round() on numeric is half-away-from-zero. Each component is rounded BEFORE
-- summing, so the displayed day-rate line and per-diem line always add up to the
-- displayed billable total; rounding the sum instead yields a total that
-- disagrees with its own line items by a cent, which on an invoice is a support
-- ticket.

create or replace view pilot.trip_financials
with (security_invoker = true) as
select
  n.*,
  (n.billable_cents - n.deducted_expense_cents) as trip_net_cents
from (
  select
    b.*,
    (b.day_rate_total_cents + b.per_diem_total_cents + b.rebilled_expense_cents)
      as billable_cents
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
      t.per_diem_cents,
      round(t.day_count * t.day_rate_cents)::bigint  as day_rate_total_cents,
      round(t.day_count * t.per_diem_cents)::bigint  as per_diem_total_cents,
      coalesce(x.rebilled_cents,   0)::bigint        as rebilled_expense_cents,
      coalesce(x.deducted_cents,   0)::bigint        as deducted_expense_cents,
      coalesce(x.unassigned_cents, 0)::bigint        as unassigned_expense_cents,
      coalesce(x.expense_count,    0)::bigint        as expense_count
    from pilot.trips t
    left join lateral (
      select
        sum(e.amount_cents) filter (where e.treatment = 'rebill')     as rebilled_cents,
        sum(e.amount_cents) filter (where e.treatment = 'deduct')     as deducted_cents,
        sum(e.amount_cents) filter (where e.treatment = 'unassigned') as unassigned_cents,
        count(*)                                                      as expense_count
      from pilot.expenses e
      where e.trip_id    = t.id
        and e.account_id = t.account_id
    ) x on true
  ) b
) n;

comment on view pilot.trip_financials is
  'A2 margin rollup. THE definition of billable_cents and trip_net_cents for '
  'this product. Application code must never recompute day_count x rate — query '
  'this view. Phase 5 asserts sum(invoice_lines) = billable_cents against it.';

-- ----------------------------------------------------------------------------
-- 9b. pilot.trip_paperwork — B3
-- ----------------------------------------------------------------------------
-- *** LIABILITY BOUNDARY — READ BEFORE EDITING ***
-- This is a PAPERWORK completeness state and it is NEVER an operational
-- go/no-go determination. Nothing about airworthiness, crew qualification,
-- duty/rest, weight and balance, or release ever enters this view or any column
-- it reads. That boundary is locked (docs/PLAN.md; INSPIRATION §D). A gate here
-- means "a form is unfilled", never "this flight may not depart". If someone
-- asks for a `ready_to_fly` column the answer is no, and the reason is
-- liability, not scope.
--
-- Gates are COUNTED, not hardcoded: gates_total counts the non-null gates, so
-- when Phase 5 fills in the invoice gates and Phase 6 the logbook gate,
-- "Paperwork complete 2/3" becomes "4/6" with no call-site change. The Phase 5/6
-- columns are `null::boolean` placeholders TYPED ON PURPOSE — a bare NULL comes
-- out as `unknown` and `create or replace view` could not later swap it for a
-- boolean expression.

create or replace view pilot.trip_paperwork
with (security_invoker = true) as
select
  g.*,
  (select count(*) from unnest(array[
     g.legs_entered, g.expenses_assigned, g.invoice_drafted, g.invoice_sent,
     g.invoice_paid, g.logbook_confirmed, g.w9_on_file]) v
    where v)                                                            as gates_met,
  (select count(*) from unnest(array[
     g.legs_entered, g.expenses_assigned, g.invoice_drafted, g.invoice_sent,
     g.invoice_paid, g.logbook_confirmed, g.w9_on_file]) v
    where v is not null)                                                as gates_total
from (
  select
    t.id as trip_id,
    t.account_id,
    t.client_id,
    exists (select 1 from pilot.trip_legs l
             where l.trip_id = t.id and l.account_id = t.account_id)    as legs_entered,
    not exists (select 1 from pilot.expenses e
                 where e.trip_id = t.id and e.account_id = t.account_id
                   and e.treatment = 'unassigned')                      as expenses_assigned,
    null::boolean as invoice_drafted,    -- Phase 5 replaces this literal
    null::boolean as invoice_sent,       -- Phase 5
    null::boolean as invoice_paid,       -- Phase 5
    null::boolean as logbook_confirmed,  -- Phase 6
    exists (select 1 from pilot.documents d
             where d.account_id = t.account_id
               and d.client_id  = t.client_id
               and d.doc_type   = 'w9'
               and d.status     = 'on_file'
               and (d.expires_on is null or d.expires_on >= current_date)) as w9_on_file
  from pilot.trips t
) g;

comment on view pilot.trip_paperwork is
  'B3 paperwork completeness ONLY — never an operational go/no-go; see the '
  'liability boundary comment above the definition. gates_total is counted, not '
  'hardcoded, so Phases 5 and 6 extend it without touching callers.';

-- ----------------------------------------------------------------------------
-- 9c. pilot.expiration_board — A1 + A7
-- ----------------------------------------------------------------------------
-- days_remaining and stage are COMPUTED, never stored: they change every
-- midnight, and a stored copy is wrong for up to 24 hours in the one part of the
-- product where being wrong matters. The underlying scan is
-- (account_id, expires_on) — one index range per render.

create or replace view pilot.expiration_board
with (security_invoker = true) as
select
  e.id,
  e.account_id,
  e.source_table,
  e.source_id,
  e.kind,
  e.label,
  e.expires_on,
  e.client_id,
  e.trip_id,
  e.notified_stage,
  (e.expires_on - current_date)                  as days_remaining,
  pilot.expiry_stage(e.expires_on, current_date) as stage,
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
  'days-remaining countdown computed at read time. The urgency buckets feed the '
  '"4 urgent, 6 soon" summary.';

-- ----------------------------------------------------------------------------
-- 9d. pilot.needs_attention — A7/A8, the typed action queue
-- ----------------------------------------------------------------------------
-- One query, typed tags, everything deep-linkable via (item_type, item_id) plus
-- the client_id / trip_id scope columns.
--
-- PHASES 5/6 EXTEND THIS BY ADDING UNION BRANCHES, NOT COLUMNS:
-- past_due_invoice, uninvoiced_trip (A8's "unbilled work surfaced until
-- invoiced") and unconfirmed_logbook. Keep the column list and its types EXACTLY
-- as they are so `create or replace view` keeps working; adding a branch is then
-- a three-line diff.

create or replace view pilot.needs_attention
with (security_invoker = true) as
  select
    b.account_id,
    'expiration'::text as item_type,
    b.id               as item_id,
    b.label            as label,
    b.kind             as detail,
    b.urgency          as urgency,
    b.expires_on       as due_on,
    b.client_id        as client_id,
    b.trip_id          as trip_id
  from pilot.expiration_board b
  where b.urgency in ('urgent', 'soon')

union all

  select
    e.account_id,
    'unassigned_receipt'::text,
    e.id,
    coalesce(nullif(trim(e.merchant), ''), 'Receipt')::text,
    e.category::text,
    'soon'::text,
    e.incurred_on,
    null::uuid,
    e.trip_id
  from pilot.expenses e
  where e.treatment = 'unassigned'

union all

  select
    d.account_id,
    'w9_outstanding'::text,
    d.id,
    d.title::text,
    'requested'::text,
    'soon'::text,
    d.requested_at::date,
    d.client_id,
    d.trip_id
  from pilot.documents d
  where d.doc_type = 'w9' and d.status = 'requested';

comment on view pilot.needs_attention is
  'A7/A8 typed action queue. Phases 5 and 6 add past_due_invoice, '
  'uninvoiced_trip and unconfirmed_logbook as ADDITIONAL UNION BRANCHES — do '
  'not change the column list, or create-or-replace stops working.';


-- ############################################################################
-- SECTION 10 — RLS
-- ############################################################################
-- Enabled on every table in this migration, in this migration — never
-- retrofitted. Policies use the `account_id in (select
-- pilot.current_account_ids())` form for the InitPlan reason stated in the
-- header. `drop policy if exists` precedes each `create policy` because Postgres
-- has no `create policy if not exists` and this file must be re-runnable.
--
-- THERE IS NO ADMIN-BYPASS POLICY ANYWHERE IN THIS FILE AND THERE MUST NEVER BE
-- ONE. No AMG-facing read path exists. That absence is the product.

-- --- clients ---------------------------------------------------------------
alter table pilot.clients enable row level security;
drop policy if exists clients_select on pilot.clients;
create policy clients_select on pilot.clients for select to authenticated
  using (account_id in (select pilot.current_account_ids()));
drop policy if exists clients_insert on pilot.clients;
create policy clients_insert on pilot.clients for insert to authenticated
  with check (account_id in (select pilot.current_account_ids()));
drop policy if exists clients_update on pilot.clients;
create policy clients_update on pilot.clients for update to authenticated
  using (account_id in (select pilot.current_account_ids()))
  with check (account_id in (select pilot.current_account_ids()));
drop policy if exists clients_delete on pilot.clients;
create policy clients_delete on pilot.clients for delete to authenticated
  using (account_id in (select pilot.current_account_ids()));

-- --- trips -----------------------------------------------------------------
alter table pilot.trips enable row level security;
drop policy if exists trips_select on pilot.trips;
create policy trips_select on pilot.trips for select to authenticated
  using (account_id in (select pilot.current_account_ids()));
drop policy if exists trips_insert on pilot.trips;
create policy trips_insert on pilot.trips for insert to authenticated
  with check (account_id in (select pilot.current_account_ids()));
drop policy if exists trips_update on pilot.trips;
create policy trips_update on pilot.trips for update to authenticated
  using (account_id in (select pilot.current_account_ids()))
  with check (account_id in (select pilot.current_account_ids()));
drop policy if exists trips_delete on pilot.trips;
create policy trips_delete on pilot.trips for delete to authenticated
  using (account_id in (select pilot.current_account_ids()));

-- --- trip_legs -------------------------------------------------------------
alter table pilot.trip_legs enable row level security;
drop policy if exists trip_legs_select on pilot.trip_legs;
create policy trip_legs_select on pilot.trip_legs for select to authenticated
  using (account_id in (select pilot.current_account_ids()));
drop policy if exists trip_legs_insert on pilot.trip_legs;
create policy trip_legs_insert on pilot.trip_legs for insert to authenticated
  with check (account_id in (select pilot.current_account_ids()));
drop policy if exists trip_legs_update on pilot.trip_legs;
create policy trip_legs_update on pilot.trip_legs for update to authenticated
  using (account_id in (select pilot.current_account_ids()))
  with check (account_id in (select pilot.current_account_ids()));
drop policy if exists trip_legs_delete on pilot.trip_legs;
create policy trip_legs_delete on pilot.trip_legs for delete to authenticated
  using (account_id in (select pilot.current_account_ids()));

-- --- expenses --------------------------------------------------------------
alter table pilot.expenses enable row level security;
drop policy if exists expenses_select on pilot.expenses;
create policy expenses_select on pilot.expenses for select to authenticated
  using (account_id in (select pilot.current_account_ids()));
drop policy if exists expenses_insert on pilot.expenses;
create policy expenses_insert on pilot.expenses for insert to authenticated
  with check (account_id in (select pilot.current_account_ids()));
drop policy if exists expenses_update on pilot.expenses;
create policy expenses_update on pilot.expenses for update to authenticated
  using (account_id in (select pilot.current_account_ids()))
  with check (account_id in (select pilot.current_account_ids()));
drop policy if exists expenses_delete on pilot.expenses;
create policy expenses_delete on pilot.expenses for delete to authenticated
  using (account_id in (select pilot.current_account_ids()));

-- --- documents -------------------------------------------------------------
alter table pilot.documents enable row level security;
drop policy if exists documents_select on pilot.documents;
create policy documents_select on pilot.documents for select to authenticated
  using (account_id in (select pilot.current_account_ids()));
drop policy if exists documents_insert on pilot.documents;
create policy documents_insert on pilot.documents for insert to authenticated
  with check (account_id in (select pilot.current_account_ids()));
drop policy if exists documents_update on pilot.documents;
create policy documents_update on pilot.documents for update to authenticated
  using (account_id in (select pilot.current_account_ids()))
  with check (account_id in (select pilot.current_account_ids()));
drop policy if exists documents_delete on pilot.documents;
create policy documents_delete on pilot.documents for delete to authenticated
  using (account_id in (select pilot.current_account_ids()));

-- --- expirations (read-only projection) ------------------------------------
alter table pilot.expirations enable row level security;
drop policy if exists expirations_select on pilot.expirations;
create policy expirations_select on pilot.expirations for select to authenticated
  using (account_id in (select pilot.current_account_ids()));
-- No INSERT/UPDATE/DELETE policy and no matching grant, deliberately. This table
-- is written exclusively by pilot.project_expiration(). A tenant able to delete
-- a row here could silently switch off their own expiry alerts, which is
-- precisely the failure C4 exists to prevent.

-- --- document_sequences (read-only counter) --------------------------------
alter table pilot.document_sequences enable row level security;
drop policy if exists document_sequences_select on pilot.document_sequences;
create policy document_sequences_select on pilot.document_sequences
  for select to authenticated
  using (account_id in (select pilot.current_account_ids()));
-- No write policy and no write grant: a tenant able to rewind next_value could
-- issue two invoices bearing the same number. Same class of finding as the
-- Phase 1 billing-column CRITICAL.

-- --- expiring_sources (schema configuration, not tenant data) --------------
alter table pilot.expiring_sources enable row level security;
-- ZERO policies, and no grant to `authenticated` below. RLS with no policy
-- denies everything, which is the correct answer for a non-tenant table: this is
-- configuration, and the right treatment is no client access at all rather than
-- a fabricated account_id column. Do not add a permissive read policy.


-- ############################################################################
-- SECTION 11 — GRANTS
-- ############################################################################
-- THE PHASE 1 CRITICAL, APPLIED. RLS has no column granularity, so every write
-- privilege below enumerates columns. Two rules, both learned the hard way:
--
--   RULE 1 — never `grant update on <table>`. Enumerate. Excluded everywhere:
--            id, account_id (tenancy), created_at/updated_at (trigger-owned),
--            and trips.trip_number (sequence-owned).
--
--   RULE 2 — the same applies to INSERT, which most people forget. `id` is
--            excluded from every INSERT grant so a client cannot choose its own
--            primary key. If it could, inserting a guessed uuid would return
--            either success or a unique-violation naming the constraint — a
--            cross-tenant EXISTENCE ORACLE, structurally identical to the
--            Phase 1 finding on accounts.connect_account_id. The column
--            defaults to gen_random_uuid(), so omitting it costs the client
--            nothing.
--
-- Grants and policies move together: a policy without a grant is inert, and a
-- grant without a policy is a real hole. If you add either, add both.
--
-- The schema-level grants (usage to authenticated, all to service_role) and the
-- ALTER DEFAULT PRIVILEGES floor are already in place from Phase 1; everything
-- below is stated explicitly anyway, because a grant you can read is a grant you
-- can review.

-- --- clients ---------------------------------------------------------------
grant select, delete on pilot.clients to authenticated;
grant insert (
  account_id, name, contact_name, contact_email, contact_phone,
  billing_address_line1, billing_address_line2, billing_city, billing_state,
  billing_postal_code, billing_country, default_day_rate_cents,
  default_per_diem_cents, default_expense_treatment, payment_terms_days,
  notes, archived_at
) on pilot.clients to authenticated;
grant update (
  name, contact_name, contact_email, contact_phone,
  billing_address_line1, billing_address_line2, billing_city, billing_state,
  billing_postal_code, billing_country, default_day_rate_cents,
  default_per_diem_cents, default_expense_treatment, payment_terms_days,
  notes, archived_at
) on pilot.clients to authenticated;

-- --- trips -----------------------------------------------------------------
-- trip_number is absent from BOTH write grants: it is allocated by
-- pilot.assign_trip_number(), and a tenant able to set or change it could
-- produce two trips with the same reference, or collide with a number an invoice
-- already cites.
grant select, delete on pilot.trips to authenticated;
grant insert (
  account_id, client_id, title, trip_kind, status, start_date, end_date,
  aircraft_ident, aircraft_type, pic_label, sic_label,
  day_count, day_rate_cents, per_diem_cents, notes
) on pilot.trips to authenticated;
grant update (
  client_id, title, trip_kind, status, start_date, end_date,
  aircraft_ident, aircraft_type, pic_label, sic_label,
  day_count, day_rate_cents, per_diem_cents, notes
) on pilot.trips to authenticated;

-- --- trip_legs -------------------------------------------------------------
grant select, delete on pilot.trip_legs to authenticated;
grant insert (
  account_id, trip_id, leg_seq, from_icao, to_icao, out_time_utc, in_time_utc,
  block_minutes, night_minutes, actual_instrument_minutes, approach_count, holds,
  day_landings_full_stop, day_landings_touch_and_go,
  night_landings_full_stop, night_landings_touch_and_go, night_takeoffs, remarks
) on pilot.trip_legs to authenticated;
grant update (
  trip_id, leg_seq, from_icao, to_icao, out_time_utc, in_time_utc,
  block_minutes, night_minutes, actual_instrument_minutes, approach_count, holds,
  day_landings_full_stop, day_landings_touch_and_go,
  night_landings_full_stop, night_landings_touch_and_go, night_takeoffs, remarks
) on pilot.trip_legs to authenticated;

-- --- expenses --------------------------------------------------------------
-- trip_id IS updatable: assigning a receipt to a trip is the core Phase 4
-- workflow. It is safe only because expenses_trip_fk is COMPOSITE — the Phase 1
-- review's worked example was literally
--   update pilot.expenses set trip_id = '<another tenant's trip id>'
-- and that statement now fails on the foreign key, not on a policy.
-- treatment IS updatable for the same kind of reason: the unassigned queue
-- exists in order to set it later. A3's "never re-asked" is about no OTHER
-- surface asking again.
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
grant select on pilot.document_sequences to authenticated;

-- pilot.expiring_sources gets an EXPLICIT REVOKE, and it is load-bearing.
-- Phase 1 set `alter default privileges in schema pilot grant select on tables
-- to authenticated`, so EVERY table created in this schema is automatically
-- readable by `authenticated` the moment it exists. RLS-with-no-policies would
-- still return zero rows, so nothing leaks — but "returns nothing because it has
-- no policy" and "cannot be reached at all" are different guarantees, and the
-- first one silently becomes readable the day someone adds a convenience policy.
-- Revoke, so the table is denied at the privilege layer as well.
--
-- REMEMBER THIS FOR EVERY FUTURE NON-TENANT TABLE IN THIS SCHEMA: the default
-- privileges floor means you have to opt OUT of tenant readability, not into it.
revoke all on pilot.expiring_sources from authenticated;

-- --- views -----------------------------------------------------------------
-- security_invoker views re-apply the caller's policies against the base tables,
-- so a SELECT grant here is not a bypass.
grant select on pilot.trip_financials  to authenticated;
grant select on pilot.trip_paperwork   to authenticated;
grant select on pilot.expiration_board to authenticated;
grant select on pilot.needs_attention  to authenticated;

-- --- service_role ----------------------------------------------------------
-- Explicit rather than relying on the Phase 1 default-privileges floor, so this
-- file reads as a complete statement of who may do what.
grant select, insert, update, delete on
  pilot.clients, pilot.trips, pilot.trip_legs, pilot.expenses, pilot.documents,
  pilot.expirations, pilot.expiring_sources, pilot.document_sequences
  to service_role;
grant select on
  pilot.trip_financials, pilot.trip_paperwork, pilot.expiration_board,
  pilot.needs_attention
  to service_role;


-- ############################################################################
-- SECTION 12 — THE C4 GATE
-- ############################################################################
-- HOUSE RULE, AND THE REASON THE EXPIRATION ENGINE CANNOT BE SILENTLY BYPASSED:
-- EVERY MIGRATION IN supabase/migrations/ MUST END WITH THIS LINE.
--
-- Supabase applies each migration inside a transaction. A future migration that
-- adds a table with an expiry column and forgets to call
-- pilot.declare_expiring_source() raises here and ROLLS THE WHOLE MIGRATION
-- BACK — at the moment the mistake is made, by the person making it, with a
-- message naming the table and the fix. That is the structural guarantee C4
-- asks for, and it needs no superuser and no event trigger.
--
-- `npm run expirations:verify` calls the same function against the live
-- database, plus pilot.expiry_coverage_report() for a human-readable roster of
-- who is wired in, who is exempt, and why.

select pilot.assert_expiry_coverage();

-- ============================================================================
-- WHAT THE VERIFY SCRIPTS MUST NOW ASSERT (docs/PLAN.md "Verification")
--
-- tenancy:verify (extend)
--   * Tenant A cannot select/insert/update/delete any row of any table above
--     belonging to tenant B.
--   * Composite-FK isolation as an actual UPDATE, not just a SELECT:
--       update pilot.expenses set trip_id = '<tenant B trip>' where id = '<own>'
--     must FAIL on foreign key violation.
--   * No role other than service_role holds a TABLE-WIDE insert or update
--     privilege on any pilot table (compare information_schema.table_privileges
--     against column_privileges). That is the Phase 1 CRITICAL as a standing
--     assertion rather than a one-time fix.
--   * Every table in schema pilot has relrowsecurity = true and at least one
--     policy — except pilot.expiring_sources, which must have RLS on, ZERO
--     policies, and zero grants to authenticated.
--   * Every FK from a tenant-scoped child to a tenant-scoped parent includes
--     account_id (readable from pg_constraint.conkey). There is exactly ONE
--     permitted exception and the assertion should name it rather than allow a
--     class: expirations_source_table_fkey -> pilot.expiring_sources, which is
--     schema configuration and has no account_id by design. A second exception
--     appearing is a finding, not a special case.
--   * B6: no table in schema pilot except pilot.account_members has an FK to
--     auth.users.
--   * Every view in any schema that reads pilot.* has security_invoker=true in
--     its reloptions.
--   * Receipt and document objects in Supabase Storage are account-scoped. The
--     table being isolated is not the same as the file being isolated.
--
-- expirations:verify (new)
--   * select pilot.assert_expiry_coverage();
--   * Create a scratch table carrying an `expires_on` column WITHOUT declaring
--     it, and assert assert_expiry_coverage() raises. Then declare it and assert
--     it passes. This is the test that the C4 mechanism actually bites.
--   * Renewal resets the ladder: set notified_stage, move expires_on, assert
--     notified_stage is back to null.
--   * Status transitions remove rows: on_file -> superseded deletes the
--     projection in the same statement.
--   * Ladder fixtures: -1, 0, 1, 7, 14, 30, 31 days out map to overdue,
--     t_minus_1, t_minus_1, t_minus_7, t_minus_14, t_minus_30, none.
--
-- trip:verify (extend)
--   * pilot.trip_financials.billable_cents equals day_rate_total +
--     per_diem_total + rebilled_expense_cents for every trip, and trip_net_cents
--     equals billable_cents - deducted_expense_cents.
--   * Every expense with treatment='rebill' has a trip_id.
--   * trip_legs.block_minutes agrees with out/in wherever both are present.
--   * pilot.trip_paperwork exposes no column readable as an operational
--     go/no-go.
-- ============================================================================

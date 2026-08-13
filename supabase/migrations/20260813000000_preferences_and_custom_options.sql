-- ===========================================================================
-- Phase 9, Layers 2 and 3 — per-tenant preferences, and the tenant's own
-- filing taxonomy.
--
-- THE GOVERNING SENTENCE, unchanged since Layer 1
-- (20260807000000_phase9_day_types_and_trip_days.sql, line 21):
--
--     Taxonomy is the tenant's. State machines are ours.
--
-- Layer 1 drew that line with a column: pilot.day_types lets a tenant name
-- and price a day of work, but the day must bill as one of OUR fixed
-- invoice_line_type values, because invoices_protect_issued,
-- invoice_lines_validate_trip and invoices_sync_trip_billing_state all
-- branch on it. Phase 12 drew the same line again with system_key on
-- pilot.accounts_chart: rename the ledger account freely, the posting
-- identity is trigger-protected and never client-writable.
--
-- This migration draws it a third time, and the line falls in exactly the
-- same place. Two tables are ADDED. Nothing existing is altered.
--
-- ***************************************************************************
-- WHAT THIS MIGRATION DELIBERATELY DOES NOT TOUCH. Read this before adding
-- anything to it.
--
-- These columns are STATE MACHINES, not taxonomy, and every one of them has
-- a trigger or a generated column branching on its value:
--
--   pilot.expenses.treatment      ('rebill'|'deduct'|'unassigned') — the P&L
--                                 and ledger_sync both branch; 'rebill'
--                                 carries a CHECK requiring a trip.
--   pilot.invoices.status         — invoices_protect_issued gates which
--                                 columns may move at all, per status.
--   pilot.trips.billing_state     — invoices_sync_trip_billing_state writes
--                                 it; nothing else may.
--   pilot.invoice_lines.line_type — the money vocabulary day_types must map
--                                 INTO; ledger_sync keys income accounts off
--                                 'income_' || line_type.
--   every pilot.logbook_entries column — the currency engine and the
--                                 totals columns are computed from them.
--
-- A tenant-defined string inside any of those makes billing, the ledger, or
-- currency unverifiable. None of them appears below.
--
-- Equally: this migration does NOT alter or drop a single existing CHECK
-- constraint, column, policy or grant. In particular the three CHECKs that
-- pin the vocabularies seeded below —
--
--   pilot.expenses.expenses_category_check   (20260810070000)
--   pilot.trips  trip_kind check              (20260805070000)
--   pilot.documents.documents_kind_check      (20260807140000)
--
-- — stay exactly as they are. That has a consequence worth stating plainly
-- rather than discovering later: until a subsequent migration widens them,
-- pilot.custom_options is the RENAME / REORDER layer over the built-in
-- vocabularies, not yet an "add your own key" layer. A tenant may call
-- `rideshare` "Uber & Lyft" and push `dues` to the bottom of the list.
--
-- ARCHIVING IS BUILT BUT UNREACHABLE UNTIL THAT SAME CHANGE, and saying so
-- here is cheaper than rediscovering it: every row this migration seeds is
-- is_builtin, custom_options_protect refuses to archive a built-in (a
-- picker whose last legal value is hidden cannot satisfy a required
-- column), and with no "add your own" path there is no non-built-in row to
-- archive. So `archived_at`, its grant and setCustomOptionArchived are the
-- machinery waiting for the layer that mints the first archivable row —
-- not a capability a tenant has today, and the categories screen does not
-- claim one. A brand-new key inserted into a domain whose
-- column still carries a CHECK would be rejected by that CHECK the moment a
-- row tried to use it. That is the correct failure — a picker offering a
-- value the table refuses is worse than a picker that does not offer it —
-- and widening the CHECKs is a separate, deliberate decision, not a side
-- effect of shipping customisation.
-- ***************************************************************************
--
-- WHY ARCHIVE AND NEVER DELETE. The same reason clients.archived_at,
-- day_types.archived_at and accounts_chart.archived_at all exist: three
-- years of expenses filed under `hotel` must keep rendering as whatever
-- `hotel` was called. Deleting the option would leave historical rows
-- pointing at a label that no longer exists, and the screens that render
-- them would fall back to the raw key — a silent, permanent regression in
-- every past record. Archiving stops an option being OFFERED for new rows
-- and changes nothing about the old ones.
--
-- Renaming an expense category also has no effect on the ledger:
-- pilot.accounts_chart carries its own independently-renameable name and is
-- joined by system_key ('expense_' || expenses.category), so the two naming
-- surfaces move independently and neither can drag the other.
--
-- Inherits, without deviation: composite (account_id, id) unique, RLS
-- enabled in these tables' own first migration, column-scoped grants ADDED
-- and never re-granted after a revoke (README's revoke trap), SECURITY
-- DEFINER with search_path pinned to '' and every reference
-- schema-qualified, seed-function-plus-trigger-plus-backfill exactly as
-- pilot.seed_accounts_chart (20260812100000) established it.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. pilot.account_preferences — Layer 2. Appearance and layout.
--
-- WHY ONE JSONB COLUMN AND NOT A COLUMN PER PREFERENCE. A preference is a
-- value nothing in the database computes on: no trigger reads it, no view
-- joins it, no invoice total moves because of it. Its entire consumer is
-- the React shell, which resolves it through a TOTAL function with
-- defaults (lib/theme-slots.ts's resolveThemeSlots — an unrecognised or
-- absent value falls back to the app/layout.tsx default, so a corrupt row
-- can never produce an unstyled shell). Given that, a column per
-- preference buys type-checking the app does not rely on and costs a
-- migration every time a new switch is added. One jsonb object means
-- adding "hide the mileage section from the nav" is a UI change, full
-- stop.
--
-- The two CHECKs are the only structure worth enforcing here: it must be a
-- JSON OBJECT (not an array, string or bare number — every reader does
-- key lookups), and it must be small. 16 KB is roughly two hundred
-- preferences; past that something is storing documents in the settings
-- table, and one row per tenant is exactly where that goes unnoticed.
--
-- SEEDED LAZILY ON FIRST WRITE — deliberately no seeding trigger and no
-- backfill, unlike custom_options below. There is nothing to seed: an
-- absent row and a row holding '{}' resolve identically, because the
-- resolver owns the defaults. The first time a tenant changes a
-- preference the app INSERTS the row into existence — lookup-then-insert-
-- or-update, never PostgREST's `.upsert()`; see the grant block at the
-- foot of this file for why that distinction is load-bearing here. Until
-- then the table is legitimately empty and the shell renders the app's
-- own defaults. This is also why there is no DELETE policy or grant
-- below: the row is written, never removed.
-- ---------------------------------------------------------------------------
create table if not exists pilot.account_preferences (
  account_id uuid primary key references pilot.accounts(id) on delete cascade,
  prefs jsonb not null default '{}'::jsonb
    check (jsonb_typeof(prefs) = 'object')
    check (length(prefs::text) <= 16384),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table pilot.account_preferences is
  'Per-tenant appearance (accent slot, density, dark mode) and layout (nav order, hidden sections). One jsonb object by design: nothing in the database computes on a preference, so a new switch must never cost a migration. Seeded LAZILY — the app inserts the row on first change (lookup-then-insert-or-update, never PostgREST ''.upsert()'': account_id is not UPDATE-grantable and the compiled ON CONFLICT DO UPDATE names it); an absent row and ''{}'' resolve identically because lib/theme-slots.ts owns the defaults. Written, never deleted: no DELETE policy or grant exists.';

comment on column pilot.account_preferences.prefs is
  'Free-shaped JSON object. The database guarantees only that it IS an object and is under 16 KB — the app''s resolver is total and falls back to the app/layout.tsx default for anything missing or unrecognised, which is what makes a schemaless column safe here.';

create trigger account_preferences_set_updated_at
  before update on pilot.account_preferences
  for each row execute function pilot.set_updated_at();

-- ---------------------------------------------------------------------------
-- 2. pilot.custom_options — Layer 3. The tenant's filing taxonomy.
--
-- One table, three domains, rather than three tables: the columns are
-- identical (key, label, order, archived), the screens are identical (a
-- reorderable list with a rename field), and the protect trigger below
-- would otherwise be written three times. `domain` carries a CHECK because
-- it is OUR vocabulary, not the tenant's — a fourth domain is a code change
-- that ships with the screen that reads it.
-- ---------------------------------------------------------------------------
create table if not exists pilot.custom_options (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references pilot.accounts(id) on delete cascade,
  -- Which picker this option belongs to. Ours, not the tenant's: each value
  -- names a column that already exists elsewhere in the schema
  -- (expenses.category, trips.trip_kind, documents.kind) and a screen that
  -- renders it.
  domain text not null
    check (domain in ('expense_category', 'trip_kind', 'document_kind')),
  -- The stable handle — what is actually STORED on the expense/trip/
  -- document row. Withheld from the UPDATE grant and refused by
  -- custom_options_protect: a pilot renames the LABEL. Moving a key would
  -- orphan every historical row filed under it.
  key text not null
    check (btrim(key) <> '' and length(key) <= 60),
  -- What the pilot sees. Free to change, on every row including built-ins —
  -- a pilot who files "Uber & Lyft" should be able to call it that.
  label text not null
    check (btrim(label) <> '' and length(label) <= 80),
  sort_order integer not null default 0,
  -- The seeder's claim about provenance. Withheld from BOTH grants and
  -- refused by the protect trigger: a tenant may neither assert nor
  -- retract it. It is what makes "you cannot archive this one" truthful,
  -- and what a future "restore defaults" would restore.
  is_builtin boolean not null default false,
  -- Archive, never delete — see this file's header. A built-in cannot be
  -- archived at all (protect trigger): those keys are what the CHECK
  -- constraints on expenses.category / trips.trip_kind / documents.kind
  -- still permit, and hiding the last legal value of a required column
  -- leaves a picker that cannot be satisfied.
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- One option per key per picker per tenant. Also the ON CONFLICT target
  -- that makes seeding idempotent and the backfill safe to re-run.
  unique (account_id, domain, key),
  -- The house composite-FK idiom (Phase 3's "pattern 1"): redundant-looking,
  -- but it is what lets a future tenant-scoped child reference an option
  -- without being able to reach across tenants to do it.
  unique (account_id, id)
);

comment on table pilot.custom_options is
  'Tenant-owned filing taxonomy: the label, order and retirement of the values in the expense-category, trip-kind and document-kind pickers. TAXONOMY ONLY — expenses.treatment, invoices.status, trips.billing_state, invoice_lines.line_type and every logbook column are state machines with triggers branching on them and are deliberately absent. Built-ins are seeded per tenant (seed_custom_options); their key/domain/is_builtin are immutable and they cannot be archived. Archive, never delete: historical rows must keep rendering.';

create index if not exists custom_options_account_domain_idx
  on pilot.custom_options (account_id, domain, sort_order, key)
  where archived_at is null;

create trigger custom_options_set_updated_at
  before update on pilot.custom_options
  for each row execute function pilot.set_updated_at();

-- ---------------------------------------------------------------------------
-- 3. The protect trigger, mirroring pilot.accounts_chart_protect
--    (20260812100000) line for line, for the identical reason: a GRANT can
--    say "these columns", but it cannot say "these columns, but not on
--    seeded rows". The UPDATE grant scopes columns; this trigger scopes
--    rows and transitions.
--
--    Belt and braces on key/domain/is_builtin — they are already absent
--    from the UPDATE grant. The grant is the boundary for the Data API;
--    this trigger is the boundary for anything holding a wider grant
--    later, and for the migration author who adds a column to the grant
--    without re-reading this file.
-- ---------------------------------------------------------------------------
create or replace function pilot.custom_options_protect()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user = 'service_role' or current_setting('role', true) = 'service_role' then
    return new;
  end if;
  if new.key is distinct from old.key then
    raise exception 'an option''s key is how every past expense, trip and document that used it is still filed — rename the label instead';
  end if;
  if new.domain is distinct from old.domain then
    raise exception 'an option cannot move to a different picker — archive it and add a new one';
  end if;
  if new.is_builtin is distinct from old.is_builtin then
    raise exception 'an option''s built-in provenance cannot be changed';
  end if;
  if old.is_builtin
     and new.archived_at is distinct from old.archived_at
     and new.archived_at is not null then
    raise exception 'built-in options cannot be archived — they are the values your expenses, trips and documents are already filed under. Rename it instead.';
  end if;
  return new;
end;
$$;

create trigger custom_options_protect
  before update on pilot.custom_options
  for each row execute function pilot.custom_options_protect();

-- ---------------------------------------------------------------------------
-- 4. The built-in vocabularies, seeded per tenant.
--
--    EXACTLY the values that exist today — copied from the CHECK
--    constraints, and the labels copied from the screens that render them.
--    Nothing invented, nothing dropped. If this list and a CHECK ever
--    disagree, the CHECK is right and this is the bug:
--
--      expense_category  15 values — pilot.expenses.expenses_category_check
--                        (the travel eight from 20260805070000 plus the
--                        self-funded seven from 20260810070000). Labels
--                        from app/(app)/expenses/expense-form.tsx.
--      trip_kind          7 values — pilot.trips' trip_kind CHECK
--                        (20260805070000). Labels and ORDER from
--                        app/(app)/trips/trip-form.tsx, which leads with
--                        contract_pilot because that is the job; the CHECK's
--                        own order is alphabetical-by-accident and is not
--                        what a pilot should see first.
--      document_kind      8 values — pilot.documents.documents_kind_check
--                        (20260807140000, which added pic_proficiency_check).
--                        Labels and order from app/(app)/documents/kinds.ts.
--
--    sort_order is spaced by ten so a tenant can drop an option between two
--    built-ins without renumbering the list.
--
--    Mirrors pilot.seed_accounts_chart (20260812100000) exactly: a SECURITY
--    DEFINER seeder, an AFTER INSERT trigger on pilot.accounts, and a
--    backfill for tenants that predate this migration — so no account can
--    exist without a taxonomy.
-- ---------------------------------------------------------------------------
create or replace function pilot.seed_custom_options(target_account_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into pilot.custom_options (account_id, domain, key, label, sort_order, is_builtin)
  values
    -- Expense categories. The travel eight, in their original order...
    (target_account_id, 'expense_category', 'airline',              'Airline',                      10,  true),
    (target_account_id, 'expense_category', 'hotel',                'Hotel',                        20,  true),
    (target_account_id, 'expense_category', 'rental_car',           'Rental car',                   30,  true),
    (target_account_id, 'expense_category', 'rideshare',            'Rideshare',                    40,  true),
    (target_account_id, 'expense_category', 'fuel',                 'Fuel',                         50,  true),
    (target_account_id, 'expense_category', 'meals',                'Meals',                        60,  true),
    (target_account_id, 'expense_category', 'parking',              'Parking',                      70,  true),
    (target_account_id, 'expense_category', 'other',                'Other',                        80,  true),
    -- ...then the seven a freelance pilot self-funds and deducts.
    (target_account_id, 'expense_category', 'training',             'Training / recurrent',         90,  true),
    (target_account_id, 'expense_category', 'medical',              'Medical exam',                 100, true),
    (target_account_id, 'expense_category', 'insurance',            'Insurance (own)',              110, true),
    (target_account_id, 'expense_category', 'charts',               'Charts / EFB subscription',    120, true),
    (target_account_id, 'expense_category', 'equipment',            'Equipment',                    130, true),
    (target_account_id, 'expense_category', 'uniform',              'Uniform',                      140, true),
    (target_account_id, 'expense_category', 'dues',                 'Dues / publications',          150, true),
    -- Trip kinds. "repositioning" and "ferry" are distinct operations and a
    -- pilot will notice if they are collapsed (trip-form.tsx).
    (target_account_id, 'trip_kind',        'contract_pilot',       'Contract pilot',               10,  true),
    (target_account_id, 'trip_kind',        'owner_trip',           'Owner trip',                   20,  true),
    (target_account_id, 'trip_kind',        'repositioning',        'Repositioning',                30,  true),
    (target_account_id, 'trip_kind',        'ferry',                'Ferry',                        40,  true),
    (target_account_id, 'trip_kind',        'maintenance_flight',   'Maintenance flight',           50,  true),
    (target_account_id, 'trip_kind',        'delivery_flight',      'Delivery flight',              60,  true),
    (target_account_id, 'trip_kind',        'other',                'Other',                        70,  true),
    -- Document kinds. "certificate", not "license" — there is no such thing
    -- as a pilot license in US airman terms (documents/kinds.ts).
    (target_account_id, 'document_kind',    'medical',              'Medical certificate',          10,  true),
    (target_account_id, 'document_kind',    'flight_review',        'Flight review',                20,  true),
    (target_account_id, 'document_kind',    'pic_proficiency_check','PIC proficiency check (61.58)',30,  true),
    (target_account_id, 'document_kind',    'passport',             'Passport',                     40,  true),
    (target_account_id, 'document_kind',    'certificate',          'Certificate',                  50,  true),
    (target_account_id, 'document_kind',    'insurance',            'Insurance',                    60,  true),
    (target_account_id, 'document_kind',    'w9',                   'W-9',                          70,  true),
    (target_account_id, 'document_kind',    'other',                'Other',                        80,  true)
  on conflict (account_id, domain, key) do nothing;
$$;

comment on function pilot.seed_custom_options(uuid) is
  'Seeds the built-in expense-category / trip-kind / document-kind vocabularies for one tenant, idempotently (ON CONFLICT on the (account_id, domain, key) unique). Values are copied from the live CHECK constraints and the labels from the screens — if this and a CHECK disagree, the CHECK is right. SECURITY DEFINER but NOT granted to authenticated: it is reachable only through the accounts_seed_custom_options trigger and this migration''s backfill, so it needs no in-body membership check — there is no caller to check.';

revoke all on function pilot.seed_custom_options(uuid) from public;
-- Not granted to authenticated, which is also why it carries no in-body
-- current_account_ids() check: a SECURITY DEFINER function needs that check
-- precisely when a tenant can call it with an arbitrary uuid, and no tenant
-- can call this one at all. service_role DOES need EXECUTE, because the
-- trigger body's PERFORM is an ordinary function call checked against the
-- INSERTING role — and every account is created by the service_role webhook
-- (Phase 1's "no client INSERT policy" rule). Identical to
-- pilot.seed_accounts_chart (20260812100000).
grant execute on function pilot.seed_custom_options(uuid) to service_role;

create or replace function pilot.accounts_seed_custom_options()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  perform pilot.seed_custom_options(new.id);
  return new;
end;
$$;

create trigger accounts_seed_custom_options
  after insert on pilot.accounts
  for each row execute function pilot.accounts_seed_custom_options();

-- Backfill: tenants that predate this migration. The seeder's ON CONFLICT
-- DO NOTHING makes this safe to re-run.
select pilot.seed_custom_options(id) from pilot.accounts;

-- ---------------------------------------------------------------------------
-- 5. RLS — enabled here, in these tables' own first migration.
-- ---------------------------------------------------------------------------
alter table pilot.account_preferences enable row level security;
alter table pilot.custom_options      enable row level security;

create policy account_preferences_select on pilot.account_preferences for select to authenticated
  using (account_id in (select pilot.current_account_ids()));
create policy account_preferences_insert on pilot.account_preferences for insert to authenticated
  with check (account_id in (select pilot.current_account_ids()));
create policy account_preferences_update on pilot.account_preferences for update to authenticated
  using (account_id in (select pilot.current_account_ids()))
  with check (account_id in (select pilot.current_account_ids()));
-- Deliberately NO delete policy on account_preferences: the row is upserted
-- into existence and then updated forever. "Reset to defaults" is an update
-- that writes '{}', not a delete — which keeps created_at meaningful and
-- means the upsert path never has to handle a row vanishing under it.

create policy custom_options_select on pilot.custom_options for select to authenticated
  using (account_id in (select pilot.current_account_ids()));
create policy custom_options_insert on pilot.custom_options for insert to authenticated
  with check (account_id in (select pilot.current_account_ids()));
create policy custom_options_update on pilot.custom_options for update to authenticated
  using (account_id in (select pilot.current_account_ids()))
  with check (account_id in (select pilot.current_account_ids()));
-- Deliberately NO delete policy on custom_options either — archive is the
-- removal story (see the header). Note that this is a stronger position than
-- pilot.day_types took: day_types grants DELETE and needs
-- day_types_protect_builtin_delete (20260807030000) to stop a built-in going
-- away. Here the door simply does not exist, so there is nothing to guard.

-- ---------------------------------------------------------------------------
-- 6. Grants. ADDED, never re-granted after a revoke (README's revoke trap).
--
--    Both tables are new, so there is no pre-existing table-wide grant to
--    collide with. A bare INSERT grant on a table with a UNIQUE constraint
--    is an existence oracle (20260805090000), so both are column-scoped.
--
--    Withheld everywhere: id, created_at, updated_at (defaults and the
--    set_updated_at triggers own them). account_id IS in the INSERT grants
--    — RLS's WITH CHECK constrains its VALUE, and withholding the column
--    makes insert impossible rather than safe.
--
--    On custom_options specifically: `key`, `domain` and `is_builtin` are
--    absent from UPDATE (the identity of the row and the seeder's claim
--    about it), and `is_builtin` and `archived_at` are absent from INSERT
--    (a tenant may not mint a built-in, and a brand-new option is born
--    live). The protect trigger enforces the same three per-row, plus the
--    built-in archive ban that no grant can express.
--
--    On account_preferences: `prefs` is the only UPDATE-able column, and
--    `account_id` is INSERT-only because it is the tenancy key.
--
--    THAT PAIR IS DELIBERATELY NOT ENOUGH FOR PostgREST'S `.upsert()`, and
--    the app must not use one here. `.upsert()` compiles to
--    `ON CONFLICT (account_id) DO UPDATE SET <every payload column> =
--    excluded.<col>` — the conflict-target column included — and Postgres
--    checks UPDATE privilege on every column in that SET list STATICALLY,
--    before any conflict is evaluated. With `account_id` withheld from
--    UPDATE the statement 42501s on the first save and every later one.
--    lib/preferences.ts therefore does lookup-then-insert-or-update, the
--    same shape invoices/actions.ts, trips/actions.ts,
--    settings/mileage-rates-actions.ts and clients/[id]/
--    rate-overrides-actions.ts already use, and scripts/tenancy-verify.mjs
--    asserts the 42501 for (case C2a). Granting `update (account_id)` to
--    make `.upsert()` legal is the wrong fix: it makes the tenancy key
--    tenant-updatable to save one round trip the app already makes.
-- ---------------------------------------------------------------------------
grant select on pilot.account_preferences, pilot.custom_options to authenticated;

grant insert (account_id, prefs) on pilot.account_preferences to authenticated;
grant update (prefs)             on pilot.account_preferences to authenticated;

grant insert (account_id, domain, key, label, sort_order)
  on pilot.custom_options to authenticated;
grant update (label, sort_order, archived_at)
  on pilot.custom_options to authenticated;

grant select, insert, update, delete
  on pilot.account_preferences, pilot.custom_options
  to service_role;

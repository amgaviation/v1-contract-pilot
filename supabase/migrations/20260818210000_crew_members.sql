-- ============================================================================
-- Crew — a per-account roster of the pilots and crew a tenant flies with.
-- ============================================================================
-- pilot.crew_members answers the ask verbatim (owner's words): "add a crew
-- tab for users to add pilots to keep on record such as pilots theyve
-- worked with before or for business accounts to keep track and record of
-- their employed crew." It is a RECORD, not a roster the product reasons
-- about: nothing here feeds duty/rest, currency, or scheduling, and nothing
-- computes off it. A pilot types in who they flew with, or a business
-- owner types in who they employ, and it stays on file. No entitlement
-- column, no FeatureId — the screen behind this table is gated by plain
-- requireAccount, not requireEntitlement, deliberately: a FeatureId here
-- would ripple into the entitlements test suite and the public marketing
-- matrix, both real claim surfaces, for a feature that is a plain
-- per-account list with no metering story.
--
-- ARCHIVE, NOT DELETE — same discipline as pilot.clients
-- (20260805070000_phase3_clients_trips_expenses.sql), for the same reason:
-- a crew record is history. Nothing FORCES that choice the way ON DELETE
-- RESTRICT forces it for a client who has flown a trip (nothing references
-- crew_members yet — see below), so this is a deliberate default rather
-- than a constraint-driven one. It is still the right one from day one:
-- the day trip linkage lands, a hard-deleted crew member would already
-- have taken whatever history pointed at them with it, with no way to
-- tell "we never recorded who flew this" from "we knew and threw it
-- away." There is accordingly no DELETE policy and no DELETE grant below
-- — archived_at is the only way a row stops appearing.
--
-- unique (account_id, id) EXISTS FOR A FEATURE THAT DOES NOT YET EXIST.
-- Nothing references pilot.crew_members today; this pass is deliberately
-- scoped to keep it that way (no trip linkage, no pickers). The composite
-- unique constraint is the house's standard composite-FK anchor —
-- pattern #1 in the phase3 migration's own header, and the same
-- table-owner/RLS reasoning documented in
-- 20260802190437_pilot_schema_tenancy.sql: a future "who flew this trip"
-- column will need to reference crew rows by (account_id, id), not id
-- alone, so a cross-tenant attach fails in the constraint layer instead of
-- relying on a policy to catch it. Adding the constraint now, before
-- anything uses it, means the follow-up migration is an ADD COLUMN plus a
-- composite FK, not a rewrite of this table's key shape under live data.
-- ============================================================================

create table if not exists pilot.crew_members (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references pilot.accounts (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 200),
  role text check (role is null or char_length(role) <= 100),
  email text check (email is null or char_length(email) <= 320),
  phone text check (phone is null or char_length(phone) <= 50),
  certificates text check (certificates is null or char_length(certificates) <= 500),
  notes text check (notes is null or char_length(notes) <= 2000),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- FK target for a not-yet-built child. See the header above.
  unique (account_id, id)
);

comment on table pilot.crew_members is
  'Per-account record of the pilots and crew a tenant flies with or employs: name, role, contact, certificates, notes. Archived, never deleted — see this file''s header. unique(account_id, id) is a forward-compatible composite-FK anchor; nothing references it yet.';

-- updated_at, maintained by the same trigger function every pilot.* table
-- uses (defined once in 20260802190437_pilot_schema_tenancy.sql).
create trigger crew_members_set_updated_at before update on pilot.crew_members
  for each row execute function pilot.set_updated_at();

-- The list read (app/(app)/crew/page.tsx, active rows first). Same partial
-- shape as clients_account_idx: the archived tail is small and rarely
-- read, so the index only needs to serve the common case.
create index if not exists crew_members_account_idx on pilot.crew_members (account_id)
  where archived_at is null;

-- ----------------------------------------------------------------------------
-- RLS. Enabled here, on this table's first migration — never retrofitted,
-- same as every pilot.* table (see the tenancy migration's own header).
-- ----------------------------------------------------------------------------
alter table pilot.crew_members enable row level security;

create policy crew_members_select on pilot.crew_members for select to authenticated
  using (account_id in (select pilot.current_account_ids()));
create policy crew_members_insert on pilot.crew_members for insert to authenticated
  with check (account_id in (select pilot.current_account_ids()));
-- WITH CHECK repeats the USING predicate deliberately (see the tenancy
-- migration's note on pilot.accounts_update): USING alone only gates which
-- EXISTING rows can be touched, not what the row may look like afterward.
create policy crew_members_update on pilot.crew_members for update to authenticated
  using (account_id in (select pilot.current_account_ids()))
  with check (account_id in (select pilot.current_account_ids()));
-- Deliberately no DELETE policy — archive is the delete. See this file's
-- header.

-- ----------------------------------------------------------------------------
-- GRANTS. `authenticated` already has SELECT on every pilot.* table via the
-- default privilege the tenancy migration set up (`alter default
-- privileges in schema pilot grant select on tables to authenticated`), so
-- it is not repeated here. INSERT and UPDATE are column-scoped per that
-- migration's CRITICAL finding: RLS has no column granularity, so the
-- grant is the only place that can withhold account_id and id from a
-- tenant's own write. Never widen either grant to include them — that
-- would let a tenant re-parent a row to another account or rewrite its
-- identity.
-- ----------------------------------------------------------------------------
grant insert (account_id, name, role, email, phone, certificates, notes)
  on pilot.crew_members to authenticated;
grant update (name, role, email, phone, certificates, notes, archived_at)
  on pilot.crew_members to authenticated;

grant select, insert, update, delete on pilot.crew_members to service_role;

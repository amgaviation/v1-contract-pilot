-- ============================================================================
-- Phase 1 — Tenancy and identity
-- ============================================================================
-- Creates the `pilot` schema and the two tables everything else in this
-- product hangs off: pilot.accounts (the tenant) and pilot.account_members
-- (who belongs to it). RLS is enabled here, on the FIRST migration, per
-- docs/PLAN.md Architecture: "RLS on every table from the first migration
-- — never retrofitted."
--
-- STATUS: authored, NOT YET APPLIED. The new Supabase "master" project
-- (docs/PLAN.md decision #1/#2) does not exist yet — this session's
-- Supabase MCP access requires re-authorization. This file is written and
-- ready to run the moment that project exists. It has NOT been executed
-- against a live database and has NOT been tested. Do not treat it as
-- verified — that is exactly why a dedicated security review pass was run
-- against it before this migration was committed (see PR description).
--
-- THE CORE TRUST GUARANTEE THIS FILE IMPLEMENTS:
-- There is no admin bypass policy and no AMG-facing read path into tenant
-- data anywhere below. A pilot's client list, rates, and invoices are
-- readable only by members of that pilot's own account. That absence is
-- the product's entire trust story (docs/PLAN.md §2) — do not add a
-- support/admin SELECT policy to these tables later without treating it
-- as a decision on par with the ones in docs/PLAN.md's locked table.
-- ============================================================================

create schema if not exists pilot;

-- ----------------------------------------------------------------------------
-- pilot.accounts — the tenant. Either a solo pilot or a business with seats.
-- ----------------------------------------------------------------------------
create table pilot.accounts (
  id                     uuid primary key default gen_random_uuid(),
  kind                   text not null check (kind in ('solo', 'business')),
  legal_name             text not null,
  address_line1          text,
  address_line2          text,
  city                   text,
  state                  text,
  postal_code            text,
  country                text,
  logo_url               text,

  -- Platform billing (we bill the pilot). Populated by the Stripe webhook
  -- handler in Phase 2 — this migration only shapes the columns.
  plan                   text not null default 'trialing'
                           check (plan in ('trialing', 'solo', 'business')),
  seat_count             integer not null default 1 check (seat_count >= 1),
  stripe_customer_id     text unique,
  stripe_subscription_id text unique,
  trial_ends_at          timestamptz,
  status                 text not null default 'trialing'
                           check (status in (
                             'trialing', 'active', 'past_due', 'canceled', 'incomplete'
                           )),

  -- Stripe Connect (Standard) — the pilot bills THEIR client. We store
  -- only the connected account id; we never see or store the pilot's own
  -- Stripe secret keys, and no application fee is ever configured.
  connect_account_id     text unique,

  invoice_prefix         text not null default 'INV',

  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

comment on table pilot.accounts is
  'The tenant. One row per pilot business (solo or with seats). Solo accounts '
  'have exactly one pilot.account_members row; business accounts may have more.';

comment on column pilot.accounts.connect_account_id is
  'Stripe Connect (Standard) account id. The pilot is merchant of record for '
  'their own invoices; funds never route through this platform.';

-- ----------------------------------------------------------------------------
-- pilot.account_members — who belongs to an account, and their role.
-- ----------------------------------------------------------------------------
create table pilot.account_members (
  id          uuid primary key default gen_random_uuid(),
  account_id  uuid not null references pilot.accounts (id) on delete cascade,
  user_id     uuid not null references auth.users (id) on delete cascade,
  role        text not null check (role in ('owner', 'member', 'bookkeeper')),
  created_at  timestamptz not null default now(),

  unique (account_id, user_id)
);

comment on table pilot.account_members is
  'Membership + role for a user within an account. A solo account has '
  'exactly one row here, with role = owner.';

create index account_members_user_id_idx on pilot.account_members (user_id);
create index account_members_account_id_idx on pilot.account_members (account_id);

-- ----------------------------------------------------------------------------
-- pilot.current_account_ids() — the one helper every RLS policy below (and
-- every future pilot.* table) should use. SECURITY DEFINER is required:
-- without it, this function's own SELECT against account_members would be
-- subject to account_members' RLS policy, which itself calls this
-- function — infinite recursion. SECURITY DEFINER breaks that cycle by
-- running the function's body with the privileges of its owner, bypassing
-- RLS for this one, narrowly-scoped internal lookup only.
-- ----------------------------------------------------------------------------
create or replace function pilot.current_account_ids()
returns setof uuid
language sql
stable
security definer
set search_path = pilot, public
as $$
  select account_id
  from pilot.account_members
  where user_id = auth.uid();
$$;

comment on function pilot.current_account_ids() is
  'Account ids the calling user belongs to. SECURITY DEFINER so RLS on '
  'account_members does not recurse into itself. Every RLS policy on every '
  'pilot.* table should scope through this function.';

revoke all on function pilot.current_account_ids() from public;
grant execute on function pilot.current_account_ids() to authenticated;

-- ----------------------------------------------------------------------------
-- pilot.is_account_owner(uuid) — small helper for owner-gated writes
-- (account settings, seat management). Same SECURITY DEFINER reasoning.
-- ----------------------------------------------------------------------------
create or replace function pilot.is_account_owner(target_account_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pilot, public
as $$
  select exists (
    select 1
    from pilot.account_members
    where account_id = target_account_id
      and user_id = auth.uid()
      and role = 'owner'
  );
$$;

revoke all on function pilot.is_account_owner(uuid) from public;
grant execute on function pilot.is_account_owner(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- RLS — pilot.accounts
-- ----------------------------------------------------------------------------
alter table pilot.accounts enable row level security;

create policy accounts_select on pilot.accounts
  for select
  to authenticated
  using (id in (select pilot.current_account_ids()));

create policy accounts_update on pilot.accounts
  for update
  to authenticated
  using (pilot.is_account_owner(id))
  with check (pilot.is_account_owner(id));

-- Deliberately no client-writable INSERT policy. Every account is created
-- by the Stripe webhook handler in Phase 2 via the service-role client
-- (lib/supabase/server.ts createServiceClient), which bypasses RLS
-- entirely — "ready the moment they subscribe" (docs/PLAN.md decision #7)
-- has no other trigger. Do not add a client INSERT policy to let a
-- signed-in user create an account for themselves; that would let someone
-- create an unpaid tenant outside the billing flow.

-- Deliberately no DELETE policy. Account closure is a Phase-later
-- decision (data retention, final invoice access) that hasn't been made
-- yet — better to have no path than a wrong one.

-- ----------------------------------------------------------------------------
-- RLS — pilot.account_members
-- ----------------------------------------------------------------------------
alter table pilot.account_members enable row level security;

create policy account_members_select on pilot.account_members
  for select
  to authenticated
  using (account_id in (select pilot.current_account_ids()));

-- Deliberately no client-writable INSERT/UPDATE/DELETE policy yet. The
-- only membership row created in v1 is the owner row, written by the same
-- service-role webhook that creates the account. "Invite a teammate" for
-- business accounts is real future scope (docs/PLAN.md decision #9/#10)
-- but the UI for it doesn't exist yet — better to ship this table with no
-- client write path than to guess at its shape now and get it wrong.

-- ----------------------------------------------------------------------------
-- Grants. RLS policies alone are not sufficient in Postgres: a role also
-- needs the underlying table/schema privilege before RLS is even
-- consulted. `pilot` is a non-public schema, so `authenticated` needs
-- explicit USAGE on the schema plus per-table privileges — unlike
-- amgaviation/amg1, where everything lives in the auto-exposed `public`
-- schema and only the table grants are needed. Grants are intentionally
-- narrower than the RLS policies allow where no policy exists yet (e.g.
-- no INSERT grant on either table for `authenticated`, matching the "no
-- client-writable INSERT" comments above) — a matching RLS policy without
-- the grant is inert, and a grant without a policy is a real hole, so
-- both must be kept in lockstep whenever either changes.
-- ----------------------------------------------------------------------------
grant usage on schema pilot to authenticated;
grant all on schema pilot to service_role;

grant select, update on pilot.accounts to authenticated;
grant select, insert, update, delete on pilot.accounts to service_role;

grant select on pilot.account_members to authenticated;
grant select, insert, update, delete on pilot.account_members to service_role;

-- Also required: this schema must be added to Supabase's exposed API
-- schemas (supabase/config.toml `[api] schemas`, mirrored in the
-- project's Data API settings once it exists) or PostgREST never serves
-- it regardless of the grants above.

-- ============================================================================
-- Two-tenant isolation is the gate on this phase (docs/PLAN.md Phase 1 /
-- Verification: npm run tenancy:verify). That script does not exist yet —
-- it needs a live database to seed two accounts against and assert
-- cross-tenant reads return nothing. Authoring it is next, once the new
-- Supabase project is available to test against.
-- ============================================================================

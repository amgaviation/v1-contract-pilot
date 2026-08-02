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
-- (docs/PLAN.md decision #1/#2) does not exist yet. This file has NOT been
-- executed against a live database. An adversarial security review was run
-- against the first draft of this file and found a critical hole (a
-- column-blind UPDATE grant letting an account owner rewrite their own
-- billing state) plus several lower-severity issues; every finding below
-- that starts with "SECURITY REVIEW:" documents what that pass caught and
-- what changed as a result. Re-review after the live database exists —
-- this has still never been executed.
--
-- WHAT THIS FILE ACTUALLY GUARANTEES, PRECISELY STATED:
-- No RLS policy and no application code path here lets one account read or
-- write another account's data. That is real and was adversarially tested
-- (see the fixed findings below). It is NOT the same claim as "AMG cannot
-- see your client list" — the service_role key (used only by the Phase 2
-- webhook), the Postgres role that owns these tables, and anyone with
-- Supabase dashboard access can all read every tenant's data, because RLS
-- does not apply to them. That is normal and expected for how Supabase
-- projects work, but it means the trust story is an OPERATIONAL commitment
-- (who gets the service-role key and dashboard access, and how that access
-- is controlled) layered on top of a REAL technical one (no policy, no
-- application code, grants tenant A anything about tenant B). Do not let
-- product copy collapse that distinction — see docs/PLAN.md's note on this.
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

  -- Platform billing (we bill the pilot). Populated ONLY by the Stripe
  -- webhook handler in Phase 2, via the service-role client — see the
  -- column-scoped grant at the bottom of this file. `plan` names what is
  -- being billed and stays null until a subscription exists; lifecycle
  -- ('trialing' vs 'active' vs ...) belongs to `status` alone so the two
  -- columns can't drift out of sync the way "plan='trialing' AND
  -- status='active'" would if 'trialing' were a value in both.
  plan                   text check (plan in ('solo', 'business')),
  seat_count             integer not null default 1 check (seat_count >= 1),
  stripe_customer_id     text unique,
  stripe_subscription_id text unique,
  trial_ends_at          timestamptz,
  -- Full Stripe Subscription.status enum, not a guessed subset — a status
  -- CHECK narrower than Stripe's actual enum means a real webhook event
  -- (e.g. unpaid, incomplete_expired, paused) hard-fails the write and
  -- Stripe retries the same failing event indefinitely.
  status                 text not null default 'trialing'
                           check (status in (
                             'trialing', 'active', 'past_due', 'canceled',
                             'unpaid', 'incomplete', 'incomplete_expired', 'paused'
                           )),

  -- Stripe Connect (Standard) — the pilot bills THEIR client. We store
  -- only the connected account id; we never see or store the pilot's own
  -- Stripe secret keys, and no application fee is ever configured.
  connect_account_id     text unique,

  invoice_prefix         text not null default 'INV',

  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),

  -- A solo account has exactly one seat by definition (docs/PLAN.md
  -- Architecture: "Solo accounts have exactly one"). Without this, the
  -- schema permits a state the product says cannot exist.
  check (kind <> 'solo' or seat_count = 1)
);

comment on table pilot.accounts is
  'The tenant. One row per pilot business (solo or with seats). Solo accounts '
  'have exactly one pilot.account_members row; business accounts may have more.';

comment on column pilot.accounts.connect_account_id is
  'Stripe Connect (Standard) account id. The pilot is merchant of record for '
  'their own invoices; funds never route through this platform. UNIQUE and '
  'therefore capable of leaking cross-tenant existence via constraint-violation '
  'errors if it is ever made client-writable — see the grants section. Must '
  'stay service_role-only.';

-- updated_at is maintained by trigger, not by the application, so it stays
-- meaningful as an audit signal regardless of which code path writes the
-- row (a DEFAULT alone only fires on INSERT and silently never advances).
create or replace function pilot.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger accounts_set_updated_at
  before update on pilot.accounts
  for each row
  execute function pilot.set_updated_at();

-- ----------------------------------------------------------------------------
-- pilot.account_members — who belongs to an account, and their role.
-- ----------------------------------------------------------------------------
create table pilot.account_members (
  id          uuid primary key default gen_random_uuid(),
  account_id  uuid not null references pilot.accounts (id) on delete cascade,
  -- NOT cascade: a user with a live membership should never silently lose
  -- that membership as a side effect of their auth.users row being deleted
  -- (e.g. a GDPR/CCPA deletion request). Deleting the last owner of an
  -- account is effectively account closure, and that path doesn't exist
  -- yet (docs/PLAN.md defers it) — restrict forces it to be handled
  -- explicitly rather than happening for free and leaving a still-billed,
  -- now-permanently-invisible account behind (current_account_ids()
  -- returns nothing for anyone once the last member row is gone, and there
  -- is deliberately no INSERT policy to re-attach one).
  user_id     uuid not null references auth.users (id) on delete restrict,
  role        text not null check (role in ('owner', 'member', 'bookkeeper')),
  created_at  timestamptz not null default now(),

  unique (account_id, user_id)
);

comment on table pilot.account_members is
  'Membership + role for a user within an account. A solo account has '
  'exactly one row here, with role = owner.';

-- Only one index needed beyond the unique constraint: current_account_ids()
-- filters on user_id alone, which (account_id, user_id) cannot serve as a
-- leading-column prefix. A separate index on account_id alone would be
-- redundant with that same composite index and was deliberately dropped.
create index account_members_user_id_idx on pilot.account_members (user_id);

-- SECURITY REVIEW, FUTURE TABLES: if/when account_members gets a
-- client-writable INSERT policy for "invite a teammate" (docs/PLAN.md
-- decision #9/#10), do NOT scope it only by account_id membership. A
-- policy of the form `with check (account_id in (select
-- pilot.current_account_ids()))` lets any member — including a
-- least-privileged `bookkeeper` — insert or update a row setting their own
-- role to 'owner' within their own account, since the check only verifies
-- account membership, not who is allowed to grant which role. Role
-- assignment must be gated on `pilot.is_account_owner(account_id)`
-- specifically, not on mere membership.

-- ----------------------------------------------------------------------------
-- pilot.current_account_ids() — the one helper every RLS policy below (and
-- every future pilot.* table) should use.
--
-- Why this doesn't recurse: pilot.account_members has its own RLS policy
-- (account_members_select, below) whose USING clause calls this very
-- function — a naive read would expect infinite recursion. It doesn't
-- happen, but NOT for the reason a SECURITY DEFINER comment usually gives.
-- SECURITY DEFINER does not bypass RLS; it changes which role the function
-- body runs as (current_user becomes the function's owner). The reason
-- this specific function avoids recursion is that its owner is also the
-- OWNER of pilot.account_members, and Postgres exempts a table's owning
-- role from that table's RLS UNLESS the table has FORCE ROW LEVEL SECURITY
-- set. That is a real and separate mechanism from SECURITY DEFINER, and it
-- is fragile: if pilot.account_members is ever changed to
-- FORCE ROW LEVEL SECURITY (a reasonable-looking hardening step for
-- defense-in-depth against the table-owner bypass), this function's
-- internal SELECT starts evaluating account_members_select again, which
-- calls this function again — ERROR 42P17 infinite recursion, on every
-- authenticated read of every pilot.* table, since every future table is
-- instructed to scope through this function too.
--
-- DO NOT SET FORCE ROW LEVEL SECURITY ON pilot.account_members. If
-- broader defense-in-depth against the table-owner bypass is wanted later,
-- give these two functions a dedicated owner role instead (one that holds
-- BYPASSRLS explicitly), and document that ownership as load-bearing
-- wherever it's set up.
-- ----------------------------------------------------------------------------
create or replace function pilot.current_account_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select account_id
  from pilot.account_members
  where user_id = auth.uid();
$$;

comment on function pilot.current_account_ids() is
  'Account ids the calling user belongs to. Recursion-safe only because this '
  'function''s owner also owns pilot.account_members (table-owner RLS '
  'exemption) — see the full explanation above the function definition. Every '
  'RLS policy on every pilot.* table should scope through this function. '
  'search_path is pinned to '''' and every reference is schema-qualified, '
  'per Supabase''s SECURITY DEFINER hardening guidance.';

revoke all on function pilot.current_account_ids() from public;
grant execute on function pilot.current_account_ids() to authenticated;

-- ----------------------------------------------------------------------------
-- pilot.is_account_owner(uuid) — small helper for owner-gated writes
-- (account settings, seat management, and — once it exists — role
-- assignment on account_members; see the note above that table). Same
-- table-owner-exemption reasoning as current_account_ids() above; same
-- FORCE ROW LEVEL SECURITY warning applies.
-- ----------------------------------------------------------------------------
create or replace function pilot.is_account_owner(target_account_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
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

-- USING and WITH CHECK both call is_account_owner — deliberately the same
-- predicate in both clauses. USING alone would let an owner rewrite the id
-- column to point at (steal) a row they don't own, since USING only gates
-- which EXISTING rows can be touched; WITH CHECK additionally gates what
-- the RESULTING row may look like, closing that path. This does not,
-- however, stop an owner from rewriting *other* columns on their own row —
-- see the column-scoped grant below, which is the actual control for that.
create policy accounts_update on pilot.accounts
  for update
  to authenticated
  using (pilot.is_account_owner(id))
  with check (pilot.is_account_owner(id));

-- Deliberately no client-writable INSERT policy. Every account is created
-- by the Stripe webhook handler in Phase 2 via the service-role client
-- (lib/supabase/service-role.ts), which bypasses RLS entirely — "ready the
-- moment they subscribe" (docs/PLAN.md decision #7) has no other trigger.
-- Do not add a client INSERT policy to let a signed-in user create an
-- account for themselves; that would let someone create an unpaid tenant
-- outside the billing flow.

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
-- client write path than to guess at its shape now and get it wrong. See
-- the role-escalation warning above the table definition before adding one.

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
--
-- SECURITY REVIEW FINDING (critical, fixed here): the first draft of this
-- migration granted `update` on ALL of pilot.accounts to `authenticated`.
-- Postgres RLS has NO column granularity — a WITH CHECK clause can express
-- "you may only touch rows you own," never "you may only change these
-- columns." A whole-row UPDATE grant plus an ownership-only WITH CHECK
-- therefore let any account owner rewrite plan/status/seat_count/
-- trial_ends_at/stripe_customer_id/stripe_subscription_id/
-- connect_account_id from the browser with the anon key — a self-serve
-- permanent free upgrade, and (via the unique constraints on the three
-- Stripe id columns) a cross-tenant existence oracle through
-- constraint-violation error messages. The fix is the column-enumerated
-- grant immediately below. THIS IS THE RULE FOR EVERY FUTURE TABLE THAT
-- CARRIES BILLING OR ENTITLEMENT STATE: never `grant update on <table>`;
-- always enumerate exactly the columns a tenant may change themselves.
-- ----------------------------------------------------------------------------
grant usage on schema pilot to authenticated;
grant all on schema pilot to service_role;

grant select on pilot.accounts to authenticated;
grant update (
  legal_name, address_line1, address_line2, city, state,
  postal_code, country, logo_url, invoice_prefix
) on pilot.accounts to authenticated;
grant select, insert, update, delete on pilot.accounts to service_role;

grant select on pilot.account_members to authenticated;
grant select, insert, update, delete on pilot.account_members to service_role;

-- Belt-and-braces beyond the column grant above: even if a future
-- migration accidentally re-widens the UPDATE grant on pilot.accounts,
-- this trigger refuses any change to a billing/entitlement column unless
-- the writer is service_role.
create or replace function pilot.protect_account_billing_columns()
returns trigger
language plpgsql
as $$
begin
  if current_user <> 'service_role' and (
    new.plan is distinct from old.plan or
    new.status is distinct from old.status or
    new.seat_count is distinct from old.seat_count or
    new.trial_ends_at is distinct from old.trial_ends_at or
    new.stripe_customer_id is distinct from old.stripe_customer_id or
    new.stripe_subscription_id is distinct from old.stripe_subscription_id or
    new.connect_account_id is distinct from old.connect_account_id or
    new.kind is distinct from old.kind
  ) then
    raise exception
      'pilot.accounts billing/entitlement columns can only be changed by service_role';
  end if;
  return new;
end;
$$;

create trigger accounts_protect_billing_columns
  before update on pilot.accounts
  for each row
  execute function pilot.protect_account_billing_columns();

-- Default privileges so every future pilot.* table starts with a safe
-- floor instead of relying on someone remembering the grant block above —
-- the migration comment could say the right thing and a later table could
-- still ship without it. authenticated gets read-only by default; write
-- grants (and any column-scoping they need, per the rule above) are added
-- deliberately per table, same as accounts/account_members here.
alter default privileges in schema pilot
  grant select on tables to authenticated;
alter default privileges in schema pilot
  grant select, insert, update, delete on tables to service_role;

-- Also required: this schema must be added to Supabase's exposed API
-- schemas (supabase/config.toml `[api] schemas`, mirrored in the
-- project's Data API settings once it exists) or PostgREST never serves
-- it regardless of the grants above. Equally important and easy to miss:
-- PostgREST's default schema is the FIRST entry in that list. If `public`
-- stays first, `supabase.from(...)` calls that don't explicitly set
-- `db.schema` will silently target `public` — see lib/supabase/client.ts
-- and server.ts, which now pin `db: { schema: 'pilot' }` explicitly for
-- exactly this reason. Do not "fix" a schema-not-found error by creating a
-- convenience view in `public` that selects from pilot.* — a view is owned
-- by whoever creates it and does NOT inherit the underlying table's RLS
-- unless created WITH (security_invoker = true) (Postgres 15+). An
-- un-invoker'd view is a complete, silent bypass of every policy in this
-- file. If a cross-schema view is ever genuinely needed, it must be
-- security_invoker and that must be verified, not assumed.

-- ----------------------------------------------------------------------------
-- SECURITY REVIEW, FUTURE TABLES: the tenant-isolation pattern above is
-- correct for SELECT and incomplete as a template for tables that
-- reference OTHER tenant-scoped tables (docs/PLAN.md's trips, expenses,
-- invoice_lines, etc. all reference client_id / trip_id / expense_id). A
-- write policy that checks only `account_id in (select
-- current_account_ids())` on the row being written does NOT stop that row
-- from pointing at a foreign key belonging to a DIFFERENT tenant — a plain
-- foreign key checks existence only, and FK verification runs with RLS
-- bypassed. Concretely: `update pilot.expenses set trip_id =
-- '<some other tenant's trip id>' where id = <my own expense>` would pass
-- an account_id-only policy and produce a row that joins into another
-- tenant's trip. When those child tables are created, every FK between two
-- tenant-scoped tables must be a COMPOSITE foreign key carrying account_id
-- — add `unique (id, account_id)` on the parent and reference
-- `(parent_id, account_id)` on the child — so the database enforces that a
-- child cannot point at another tenant's parent, rather than relying on
-- the policy to catch it.
-- ----------------------------------------------------------------------------

-- ============================================================================
-- Two-tenant isolation is the gate on this phase (docs/PLAN.md Phase 1 /
-- Verification: npm run tenancy:verify). That script does not exist yet —
-- it needs a live database to seed two accounts against and assert
-- cross-tenant reads return nothing. It must also assert: an owner cannot
-- change their own plan/status/seat_count/stripe_*/connect_account_id
-- (finding fixed above); a non-owner member cannot update pilot.accounts at
-- all; pilot.current_account_ids() is unreachable by anon; a NULL
-- auth.uid() denies rather than matching everything; and (once
-- account_members gets a write policy) that a bookkeeper cannot self-
-- promote to owner. Authoring it is next, once the new Supabase project is
-- available to test against.
-- ============================================================================

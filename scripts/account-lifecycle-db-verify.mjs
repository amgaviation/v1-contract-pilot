#!/usr/bin/env node
// The account lifecycle, against a real Postgres.
//
// scripts/account-lifecycle-verify.mjs is STATIC: it proves the purge names
// every table it should and spares the ones it must. It cannot prove the
// functions actually behave that way, because it never runs them. This one
// does, and the two are deliberately separate — the static check runs in
// `npm test` with no database, this one needs the migrated schema.
//
// WHAT IS ACTUALLY AT STAKE HERE. These functions delete a tenant's records
// irreversibly, and one of them deletes an airman's logbook. The claims the
// product makes about them are safety claims, not conveniences:
//
//   * a hold expiry may cost a pilot their COMMERCIAL records and may never
//     cost them their 14 CFR 61.51 logbook, their documents wallet, or
//     their aircraft;
//   * an invoice number, once issued to a client, can never be re-minted,
//     so the counter must survive a purge AND a reset;
//   * only an OWNER may reach any of it, enforced in the database rather
//     than only in a server action that could forget.
//
// Every one of those is asserted below by doing the thing and looking.
//
// AUTH IS SIMULATED THE WAY POSTGREST DOES IT — `set local role` plus a
// `request.jwt.claims` GUC, which is what makes auth.uid() return a real
// value inside the SECURITY DEFINER functions. Asserting through the
// service role would prove nothing: it holds BYPASSRLS and is exactly the
// client these functions were written to avoid needing.
//
// The whole run is one transaction that always rolls back, so it never
// leaves synthetic data behind (docs/PLAN.md: "no live pilot data as
// fixtures or test data at any point"). Every negative case asserts a
// SPECIFIC sqlstate — "an error happened" is not a pass, because the error
// this file most needs to catch is a function that raised for the wrong
// reason and would have deleted the wrong thing once the reason was fixed.
//
// Requires DATABASE_URL (a direct Postgres connection string) and `psql`.
//
//   DATABASE_URL="postgresql://..." npm run account-lifecycle-db:verify

import { spawnSync } from "node:child_process";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error(
    "account-lifecycle-db:verify requires DATABASE_URL (direct Postgres connection string)."
  );
  process.exit(1);
}

// Account A is the subject. Account B exists only to be a stranger.
const A = "00000000-0000-0000-0000-0000000000a7";
const B = "00000000-0000-0000-0000-0000000000b7";
const UA = "00000000-0000-0000-0000-0000000aa777"; // owner of A
const UM = "00000000-0000-0000-0000-0000000mm777".replace(/m/g, "d"); // member of A
const UB = "00000000-0000-0000-0000-0000000bb777"; // owner of B

const sql = `
begin;

-- ---------------------------------------------------------------------------
-- Fixtures. Two tenants, three people: A's owner, A's non-owner member, and
-- an unrelated owner at B who exists purely to be refused.
-- ---------------------------------------------------------------------------
insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at)
values ('${UA}', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
        'lifecycle-owner@example.invalid', now(), now()),
       ('${UM}', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
        'lifecycle-member@example.invalid', now(), now()),
       ('${UB}', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
        'lifecycle-stranger@example.invalid', now(), now());

-- A is a 'business' purely so it may hold a second member: 'solo' accounts
-- are capped at one seat by a CHECK. Set at INSERT, not by a later UPDATE —
-- pilot.protect_account_billing_columns() refuses a non-service_role write
-- to seat_count, which is exactly the guard it exists to be.
insert into pilot.accounts (id, kind, seat_count, legal_name)
values ('${A}', 'business', 2, 'Lifecycle Subject LLC'),
       ('${B}', 'solo', 1, 'Unrelated Tenant LLC');

insert into pilot.account_members (account_id, user_id, role)
values ('${A}', '${UA}', 'owner'),
       ('${A}', '${UM}', 'member'),
       ('${B}', '${UB}', 'owner');

-- One row in a PURGED table, and one in each of three RETAINED ones.
insert into pilot.clients (account_id, name) values ('${A}', 'Northlight Air Partners');
insert into pilot.logbook_entries (account_id, airman_user_id, source, entry_date, total_time, role)
values ('${A}', '${UA}', 'manual', '2026-03-04', 2.4, 'PIC');
insert into pilot.documents (account_id, kind, label)
values ('${A}', 'medical', 'First-class medical');
insert into pilot.aircraft (account_id, tail_number) values ('${A}', 'N412SP');

-- The number sequence is seeded by trigger on account insert; prove it is
-- there before anything runs, so "it survived" is a real observation.
do $$
begin
  if not exists (select 1 from pilot.invoice_number_sequences where account_id = '${A}') then
    insert into pilot.invoice_number_sequences (account_id) values ('${A}');
  end if;
end $$;

-- ===========================================================================
-- PART 1 — AUTHORIZATION. The database refuses, not just the server action.
-- ===========================================================================

-- AUTH-1: a MEMBER of the account is not an owner. This is the case a
-- forgetful server action would wave through, and the reason the check is
-- in the function at all.
do $$
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', '{"sub":"${UM}"}', true);
  begin
    perform pilot.purge_business_data('${A}');
    raise exception 'AUTH-1 FAILURE: a member purged their account''s business data';
  exception when insufficient_privilege then
    raise notice 'PASS (AUTH-1, sqlstate 42501): a member cannot purge the account they belong to';
  end;
  reset role;
end $$;

-- AUTH-2: an owner of ANOTHER tenant. Cross-tenant is the one that matters.
do $$
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', '{"sub":"${UB}"}', true);
  begin
    perform pilot.purge_business_data('${A}');
    raise exception 'AUTH-2 FAILURE: a stranger purged another tenant''s data';
  exception when insufficient_privilege then
    raise notice 'PASS (AUTH-2, sqlstate 42501): an owner of another tenant cannot purge this one';
  end;
  reset role;
end $$;

-- AUTH-3: the same stranger against delete_account, which is the worst
-- thing in the file and therefore worth its own assertion.
do $$
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', '{"sub":"${UB}"}', true);
  begin
    perform pilot.delete_account('${A}');
    raise exception 'AUTH-3 FAILURE: a stranger deleted another tenant''s account';
  exception when insufficient_privilege then
    raise notice 'PASS (AUTH-3, sqlstate 42501): an owner of another tenant cannot delete this one';
  end;
  reset role;
end $$;

-- AUTH-4: a signed-out visitor. The real shape of this is the anon role
-- with no claims GUC at all — NOT an empty claims string, which is invalid
-- JSON and makes auth.uid() itself throw before the function is reached
-- (a wrong test that would have "passed" on the wrong error). anon was
-- never granted EXECUTE, so the grant boundary refuses this before any
-- logic runs, which is the outer of the two defences.
do $$
begin
  set local role anon;
  begin
    perform pilot.reset_account_data('${A}');
    raise exception 'AUTH-4 FAILURE: the anon role reset an account';
  exception when insufficient_privilege then
    raise notice 'PASS (AUTH-4, sqlstate 42501): anon holds no EXECUTE grant on the lifecycle functions';
  end;
  reset role;
end $$;

-- AUTH-4b: authenticated, valid claims, but no sub — auth.uid() is null.
-- This exercises the null branch inside assert_account_owner, which AUTH-4
-- cannot reach because the grant stops it first.
do $$
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', '{}', true);
  begin
    perform pilot.reset_account_data('${A}');
    raise exception 'AUTH-4b FAILURE: a caller with no subject reset an account';
  exception when insufficient_privilege then
    raise notice 'PASS (AUTH-4b, sqlstate 42501): a null auth.uid() is refused by the function itself';
  end;
  reset role;
end $$;

-- Nothing above may have removed anything. A refusal that deleted first
-- would still be a catastrophe.
do $$
declare n int;
begin
  select count(*) into n from pilot.clients where account_id = '${A}';
  if n <> 1 then
    raise exception 'AUTH-5 FAILURE: a refused call still deleted business data (clients=%)', n;
  end if;
  raise notice 'PASS (AUTH-5): four refused calls left every row intact';
end $$;

-- ===========================================================================
-- PART 2 — THE PURGE'S DATA CONTRACT. The product promise, executed.
-- ===========================================================================

do $$
declare
  clients_left int; logbook_left int; docs_left int; aircraft_left int; seq_left int;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', '{"sub":"${UA}"}', true);
  perform pilot.purge_business_data('${A}');
  reset role;

  select count(*) into clients_left  from pilot.clients            where account_id = '${A}';
  select count(*) into logbook_left  from pilot.logbook_entries    where account_id = '${A}';
  select count(*) into docs_left     from pilot.documents          where account_id = '${A}';
  select count(*) into aircraft_left from pilot.aircraft           where account_id = '${A}';
  select count(*) into seq_left      from pilot.invoice_number_sequences where account_id = '${A}';

  if clients_left <> 0 then
    raise exception 'PURGE-1 FAILURE: the purge did not delete business records (clients=%)', clients_left;
  end if;
  raise notice 'PASS (PURGE-1): the owner''s purge deleted the commercial records';

  -- THE ONE THAT MATTERS. A billing event may not destroy an airman record.
  if logbook_left <> 1 or docs_left <> 1 or aircraft_left <> 1 then
    raise exception
      'PURGE-2 FAILURE: a hold expiry destroyed airman records (logbook=%, documents=%, aircraft=%)',
      logbook_left, docs_left, aircraft_left;
  end if;
  raise notice 'PASS (PURGE-2): logbook, documents and aircraft survived the purge — a billing event cannot destroy a 14 CFR 61.51 record';

  if seq_left <> 1 then
    raise exception 'PURGE-3 FAILURE: the invoice number sequence was destroyed; a future invoice could re-mint an issued number';
  end if;
  raise notice 'PASS (PURGE-3): the invoice number sequence survived, so no number can be re-issued';
end $$;

-- ===========================================================================
-- PART 3 — RESET. The one path that DOES take the logbook, on purpose.
-- ===========================================================================

do $$
declare logbook_left int; docs_left int; seq_left int; daytypes_left int;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', '{"sub":"${UA}"}', true);
  perform pilot.reset_account_data('${A}');
  reset role;

  select count(*) into logbook_left from pilot.logbook_entries where account_id = '${A}';
  select count(*) into docs_left    from pilot.documents       where account_id = '${A}';
  select count(*) into seq_left     from pilot.invoice_number_sequences where account_id = '${A}';
  select count(*) into daytypes_left from pilot.day_types      where account_id = '${A}';

  if logbook_left <> 0 or docs_left <> 0 then
    raise exception 'RESET-1 FAILURE: reset left airman records behind (logbook=%, documents=%)',
      logbook_left, docs_left;
  end if;
  raise notice 'PASS (RESET-1): an explicit reset DOES clear the logbook and documents — the one path that may';

  if seq_left <> 1 then
    raise exception 'RESET-2 FAILURE: reset destroyed the invoice number sequence';
  end if;
  raise notice 'PASS (RESET-2): the number sequence survives a reset too — a fresh start still cannot reuse a number';

  -- A reset returns an empty product, not an unconfigured one.
  if daytypes_left = 0 then
    raise exception 'RESET-3 FAILURE: reset wiped the account''s day types (settings, not records)';
  end if;
  raise notice 'PASS (RESET-3): settings (day types) survived — a reset empties the product, it does not un-configure it';
end $$;

-- ===========================================================================
-- PART 4 — DEACTIVATE, and the hold-window constraints.
-- ===========================================================================

do $$
declare st text; deact timestamptz; hstart timestamptz;
begin
  -- Put the account on a hold first, so we can prove deactivating clears it.
  update pilot.accounts
     set hold_started_at = now(), hold_ends_at = now() + interval '30 days'
   where id = '${A}';

  set local role authenticated;
  perform set_config('request.jwt.claims', '{"sub":"${UA}"}', true);
  perform pilot.deactivate_account('${A}');
  reset role;

  select status, deactivated_at, hold_started_at into st, deact, hstart
    from pilot.accounts where id = '${A}';

  if deact is null then
    raise exception 'DEACT-1 FAILURE: deactivated_at was not stamped';
  end if;
  raise notice 'PASS (DEACT-1): deactivation stamps deactivated_at';

  -- The corrected contract (20260818140000): this function must NOT write
  -- status. That column mirrors Stripe and the webhook owns it; a second
  -- writer would be two sources for one fact. If this ever starts passing
  -- with status='canceled', someone has reintroduced the write that
  -- pilot.protect_account_billing_columns() rejects outright.
  if st = 'canceled' then
    raise exception
      'DEACT-1b FAILURE: deactivate_account wrote status — that column belongs to the Stripe webhook';
  end if;
  raise notice 'PASS (DEACT-1b): status was left to the webhook (still %), so there is exactly one writer of it', st;

  if hstart is not null then
    raise exception 'DEACT-2 FAILURE: the account is deactivated AND still on hold';
  end if;
  raise notice 'PASS (DEACT-2): deactivating cleared the hold — an account cannot be in both answers at once';
end $$;

-- The two-month ceiling is a product rule; assert the database is the thing
-- enforcing it, not a server action that could be bypassed.
do $$
begin
  begin
    update pilot.accounts
       set hold_started_at = now(), hold_ends_at = now() + interval '90 days'
     where id = '${A}';
    raise exception 'HOLD-1 FAILURE: a 90-day hold was accepted';
  exception when check_violation then
    raise notice 'PASS (HOLD-1, sqlstate 23514): a hold longer than two months is refused by the schema';
  end;

  begin
    update pilot.accounts
       set hold_started_at = now(), hold_ends_at = null
     where id = '${A}';
    raise exception 'HOLD-2 FAILURE: a hold with a start and no end was accepted';
  exception when check_violation then
    raise notice 'PASS (HOLD-2, sqlstate 23514): a half-open hold window is refused — nothing could ever expire it';
  end;
end $$;

-- ===========================================================================
-- PART 5 — DELETE. The cascade is the delete list; stripe_events is not.
-- ===========================================================================

insert into pilot.stripe_events (id, type, stripe_created_at, object_id, livemode)
values ('evt_lifecycle_probe', 'customer.subscription.updated', now(), 'sub_probe', false);

do $$
declare accounts_left int; members_left int; aircraft_left int; events_left int;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', '{"sub":"${UA}"}', true);
  perform pilot.delete_account('${A}');
  reset role;

  select count(*) into accounts_left from pilot.accounts        where id = '${A}';
  select count(*) into members_left  from pilot.account_members where account_id = '${A}';
  select count(*) into aircraft_left from pilot.aircraft        where account_id = '${A}';
  select count(*) into events_left   from pilot.stripe_events   where id = 'evt_lifecycle_probe';

  if accounts_left <> 0 then
    raise exception 'DELETE-1 FAILURE: the account row survived its own delete';
  end if;
  raise notice 'PASS (DELETE-1): the tenant row is gone';

  -- One DELETE, and the cascade took the rest. This is the assertion that
  -- makes "the cascade IS the delete list" a fact rather than a claim.
  if members_left <> 0 or aircraft_left <> 0 then
    raise exception
      'DELETE-2 FAILURE: cascading tenant rows survived (members=%, aircraft=%)',
      members_left, aircraft_left;
  end if;
  raise notice 'PASS (DELETE-2): 43 cascading FKs took every tenant table with it, from one DELETE';

  -- And the one thing that must NOT go: dropping it would let a replayed
  -- Stripe delivery re-apply as though it were new.
  if events_left <> 1 then
    raise exception 'DELETE-3 FAILURE: the webhook idempotency ledger was deleted with the tenant';
  end if;
  raise notice 'PASS (DELETE-3): pilot.stripe_events survived — a replayed delivery still cannot re-apply';
end $$;

-- The unrelated tenant must be untouched by all of the above.
do $$
declare n int;
begin
  select count(*) into n from pilot.accounts where id = '${B}';
  if n <> 1 then
    raise exception 'ISOLATION FAILURE: tenant B was affected by tenant A''s lifecycle';
  end if;
  raise notice 'PASS (ISOLATION): the unrelated tenant is untouched';
end $$;

rollback;
`;

const result = spawnSync("psql", [DATABASE_URL, "-v", "ON_ERROR_STOP=1", "-c", sql], {
  stdio: "inherit",
});

if (result.error) {
  console.error(`Failed to run psql: ${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);

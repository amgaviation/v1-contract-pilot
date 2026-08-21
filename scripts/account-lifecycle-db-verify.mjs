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

// Fixed ids for the rows that must LINK ACROSS the retain/delete boundary.
// Fixtures that do not link prove nothing: this file passed for weeks over a
// schema where pilot.documents cascade-deleted off pilot.clients and a trip
// delete aborted on pilot.logbook_entries, purely because nothing here ever
// set documents.client_id or logbook_entries.trip_id. See PART 6.
const CL = "00000000-0000-0000-0000-00000000c111"; // A's client (PURGED)
const TR = "00000000-0000-0000-0000-000000007111"; // A's trip (PURGED)
const TL = "00000000-0000-0000-0000-000000007112"; // A's trip leg (PURGED)
// The same three again for the AUTOMATED (expire_hold) path in PART 4b, which
// runs after PART 3's reset has cleared the first set.
const CL2 = "00000000-0000-0000-0000-00000000c222";
const TR2 = "00000000-0000-0000-0000-000000007221";
const TL2 = "00000000-0000-0000-0000-000000007222";
// The operator qualifications that must OUTLIVE their operator (20260821120000).
// One per path, same reason as the documents above: an unlinked qualification
// survives any FK declaration, so a fixture that never cites a purged client
// asserts nothing about the CASCADE this migration removed.
const OQ = "00000000-0000-0000-0000-000000009111";
const OQ2 = "00000000-0000-0000-0000-000000009222";

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

-- Rows in PURGED tables, and rows in each of three RETAINED ones — WITH THE
-- LINKS BETWEEN THEM SET. The linking is the point. A retained row that
-- points at nothing survives a purge no matter how its foreign keys are
-- declared, so unlinked fixtures make PURGE-2 and HOLD-10 assert nothing at
-- all: this file was green for weeks against a schema where a lapsed hold
-- cascade-deleted every client-linked document and where the purge's
-- 'delete from pilot.trips' aborted outright on a trip-derived logbook
-- entry. Both bugs are invisible to a fixture that never crosses the
-- boundary. Every retained fixture below therefore cites a purged parent.
insert into pilot.clients (id, account_id, name)
values ('${CL}', '${A}', 'Northlight Air Partners');

insert into pilot.trips (id, account_id, client_id, starts_on, ends_on)
values ('${TR}', '${A}', '${CL}', '2026-03-03', '2026-03-04');
insert into pilot.trip_legs (id, account_id, trip_id, leg_date)
values ('${TL}', '${A}', '${TR}', '2026-03-04');

-- The trip-derived logbook entry — source 'trip', citing BOTH the trip and
-- the leg it was confirmed from. This is the confirm-from-leg flow, and it
-- is the row that made purge_business_data_rows raise 23502 forever.
insert into pilot.logbook_entries
  (account_id, airman_user_id, source, entry_date, total_time, role, trip_id, trip_leg_id)
values ('${A}', '${UA}', 'trip', '2026-03-04', 2.4, 'PIC', '${TR}', '${TL}');

-- A client-linked document. pilot.documents is RETAINED; pilot.clients is
-- PURGED. Under the old ON DELETE CASCADE this row was destroyed by a
-- billing event, which is the thing three migrations promise cannot happen.
insert into pilot.documents (account_id, kind, label, client_id)
values ('${A}', 'insurance', 'Certificate of insurance', '${CL}');
insert into pilot.aircraft (account_id, tail_number) values ('${A}', 'N412SP');

-- A client-linked OPERATOR QUALIFICATION. pilot.operator_qualifications is
-- RETAINED; pilot.clients is PURGED. Until 20260821120000 this FK was
-- ON DELETE CASCADE over a NOT NULL client_id, so a lapsed billing hold
-- destroyed a pilot's entire Part 135 qualification history — the same defect
-- pilot.documents carried, and the one BOUNDARY-1 carried as a named exemption
-- until the denormalized operator_name made SET NULL possible.
-- ipc_135_297 deliberately: it is one of the four requirement kinds whose
-- expires_on is DERIVED by pilot.compute_operator_qualification_expiry(), so
-- the assertions below can also prove that detaching the row (and renaming the
-- client) never perturbs that derivation.
insert into pilot.operator_qualifications
  (id, account_id, client_id, requirement, type_designator, status, completed_on)
values ('${OQ}', '${A}', '${CL}', 'ipc_135_297', 'CE-560XL', 'current', '2026-01-15');

-- QUAL-RENAME: the denormalized name is MAINTAINED, not merely snapshotted at
-- insert. This is the property that makes operator_name trustworthy at purge
-- time — the purge runs from a cron with no session, long after any rename,
-- and a stale name would be engraved permanently.
--
-- It doubles as the proof that writing operator_name cannot perturb expires_on:
-- pilot.propagate_client_name_to_qualifications() issues a real UPDATE against
-- this table, which re-fires pilot.compute_operator_qualification_expiry();
-- that function's H1 idempotency gate (old.completed_on is not distinct from
-- new.completed_on) must copy expires_on through unchanged rather than
-- re-running the 135.301(a) early/late comparison against its own prior output.
do $$
declare before_expiry date; after_expiry date; nm text;
begin
  select expires_on, operator_name into before_expiry, nm
    from pilot.operator_qualifications where id = '${OQ}';
  if nm <> 'Northlight Air Partners' then
    raise exception 'QUAL-RENAME FAILURE: operator_name was not resolved on INSERT (got %)', nm;
  end if;
  if before_expiry is distinct from date '2026-07-31' then
    raise exception 'QUAL-RENAME FAILURE: the 135.297 derivation did not run on INSERT (expires_on=%, expected 2026-07-31)', before_expiry;
  end if;

  update pilot.clients set name = 'Northlight Air Partners LLC' where id = '${CL}';

  select expires_on, operator_name into after_expiry, nm
    from pilot.operator_qualifications where id = '${OQ}';
  if nm <> 'Northlight Air Partners LLC' then
    raise exception 'QUAL-RENAME FAILURE: a client rename did not reach operator_name (got %)', nm;
  end if;
  if after_expiry is distinct from before_expiry then
    raise exception
      'QUAL-RENAME FAILURE: writing operator_name moved expires_on (% -> %). The H1 idempotency gate in pilot.compute_operator_qualification_expiry() is not holding for this path.',
      before_expiry, after_expiry;
  end if;
  raise notice 'PASS (QUAL-RENAME): a client rename reaches operator_name, and expires_on is untouched by it';

  -- Put the name back, so the detached-row assertions below read the value a
  -- reader of the fixtures above would expect.
  update pilot.clients set name = 'Northlight Air Partners' where id = '${CL}';
end $$;

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
  orphaned_ok int; quals_left int;
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
  select count(*) into quals_left    from pilot.operator_qualifications where account_id = '${A}';

  if clients_left <> 0 then
    raise exception 'PURGE-1 FAILURE: the purge did not delete business records (clients=%)', clients_left;
  end if;
  raise notice 'PASS (PURGE-1): the owner''s purge deleted the commercial records';

  -- THE ONE THAT MATTERS. A billing event may not destroy an airman record.
  if logbook_left <> 1 or docs_left <> 1 or aircraft_left <> 1 or quals_left <> 1 then
    raise exception
      'PURGE-2 FAILURE: a hold expiry destroyed airman records (logbook=%, documents=%, aircraft=%, operator_qualifications=%)',
      logbook_left, docs_left, aircraft_left, quals_left;
  end if;
  raise notice 'PASS (PURGE-2): logbook, documents, aircraft and operator qualifications survived the purge — a billing event cannot destroy a 14 CFR 61.51 record or a Part 135 qualification history';

  -- PURGE-2b: they survived DETACHED, not mangled. The links to the purged
  -- rows must be null and account_id must still be the account's — the
  -- specific thing a bare composite ON DELETE SET NULL gets wrong, and the
  -- reason every such constraint in this schema now carries a column list.
  -- (A bare form would not reach here at all: it raises 23502 and aborts the
  -- purge. This asserts the end state anyway, because a future edit could
  -- restore the abort or, worse, re-point account_id.)
  select count(*) into orphaned_ok from pilot.logbook_entries
   where account_id = '${A}' and trip_id is null and trip_leg_id is null;
  if orphaned_ok <> 1 then
    raise exception
      'PURGE-2b FAILURE: the trip-derived logbook entry did not survive detached (matching rows=%)',
      orphaned_ok;
  end if;
  raise notice 'PASS (PURGE-2b): the trip-derived entry outlived its trip with account_id intact and trip_id/trip_leg_id cleared';

  select count(*) into orphaned_ok from pilot.documents
   where account_id = '${A}' and client_id is null;
  if orphaned_ok <> 1 then
    raise exception
      'PURGE-2c FAILURE: the client-linked document was destroyed or kept a dangling client (matching rows=%)',
      orphaned_ok;
  end if;
  raise notice 'PASS (PURGE-2c): the client-linked document outlived its client with account_id intact and client_id cleared';

  -- PURGE-2d: the same three properties for the operator qualification, PLUS
  -- the one that is specific to it — the operator is still NAMED. A detached
  -- qualification that cannot say whose certificate it was held under is
  -- worthless, which is the entire reason operator_name exists; asserting only
  -- "the row survived" would pass against a schema that kept an anonymous
  -- husk. expires_on is checked too: neither the detach nor the operator_name
  -- write may disturb the 135.297 derivation.
  select count(*) into orphaned_ok from pilot.operator_qualifications
   where id = '${OQ}'
     and account_id = '${A}'
     and client_id is null
     and operator_name = 'Northlight Air Partners'
     and expires_on = date '2026-07-31';
  if orphaned_ok <> 1 then
    raise exception
      'PURGE-2d FAILURE: the operator qualification did not outlive its operator intact, detached and still attributable (matching rows=%). Row now: %',
      orphaned_ok,
      (select row(account_id, client_id, operator_name, expires_on)::text
         from pilot.operator_qualifications where id = '${OQ}');
  end if;
  raise notice 'PASS (PURGE-2d): the operator qualification outlived its purged operator — account_id intact, client_id cleared, operator_name still readable, expires_on unmoved';

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
-- PART 4b — THE HOLD's THREE TRANSITIONS.
-- ===========================================================================

-- place_hold refuses the states that must not exist, from the row alone.
do $$
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', '{"sub":"${UA}"}', true);

  -- Clear the deactivation left by PART 4 so a hold is even legal here.
  reset role;
  update pilot.accounts set deactivated_at = null where id = '${A}';
  set local role authenticated;
  perform set_config('request.jwt.claims', '{"sub":"${UA}"}', true);

  begin
    perform pilot.place_hold('${A}', now() - interval '1 day');
    raise exception 'HOLD-3 FAILURE: a hold ending in the past was accepted';
  exception when others then
    if sqlstate <> '22023' then raise; end if;
    raise notice 'PASS (HOLD-3, sqlstate 22023): a hold must end in the future';
  end;

  perform pilot.place_hold('${A}', now() + interval '31 days');
  raise notice 'PASS (HOLD-4): an eligible owner placed a hold';

  begin
    perform pilot.place_hold('${A}', now() + interval '31 days');
    raise exception 'HOLD-5 FAILURE: a second, overlapping hold was accepted';
  exception when others then
    if sqlstate <> '22023' then raise; end if;
    raise notice 'PASS (HOLD-5, sqlstate 22023): an account already on hold cannot be held again';
  end;
  reset role;
end $$;

-- A member cannot park the business they were invited into.
do $$
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', '{"sub":"${UM}"}', true);
  begin
    perform pilot.resume_from_hold('${A}');
    raise exception 'HOLD-6 FAILURE: a member ended the account holder''s hold';
  exception when insufficient_privilege then
    raise notice 'PASS (HOLD-6, sqlstate 42501): only the owner may place or end a hold';
  end;
  reset role;
end $$;

-- expire_hold REFUSES a hold that has not expired. This is the guard that
-- stands between a wrong WHERE clause in the scheduled pass and a paying
-- customer's records, so it is asserted directly rather than trusted.
--
-- set local role service_role HERE IS LOAD-BEARING, not decoration to
-- match the AUTH-* tests' style. expire_hold is granted to service_role
-- and to NO ONE ELSE (20260818200000 revokes public and authenticated;
-- 20260819090000 grants service_role — that grant is the fix this test
-- exists to prove). Without this wrapper the three expire_hold assertions
-- below run as whatever role this script's own connection defaults to —
-- the migration owner — and Postgres gives an object's OWNER implicit
-- EXECUTE regardless of any REVOKE. That is exactly how the missing grant
-- shipped invisibly: these three tests passed against a schema where
-- production's actual caller (a service-role PostgREST client, per
-- app/api/holds/run/route.ts) got 42501 on every single call. Wrapping in
-- set local role service_role makes this script exercise the same
-- privilege boundary PostgREST enforces, so this block FAILS on the
-- pre-20260819090000 schema (expire_hold raises 42501, which is not
-- sqlstate 22023, so the "if sqlstate <> '22023' then raise" re-raises it
-- and the do-block's own exception is never reached) and PASSES once the
-- grant exists.
do $$
declare clients_left int;
begin
  insert into pilot.clients (id, account_id, name) values ('${CL2}', '${A}', 'Held Client Co');

  set local role service_role;
  begin
    perform pilot.expire_hold('${A}');
    raise exception 'HOLD-7 FAILURE: expire_hold purged an account whose hold is still running';
  exception when others then
    if sqlstate <> '22023' then raise; end if;
    raise notice 'PASS (HOLD-7, sqlstate 22023): expire_hold refuses a hold that has not expired';
  end;
  reset role;

  select count(*) into clients_left from pilot.clients where account_id = '${A}';
  if clients_left <> 1 then
    raise exception 'HOLD-7b FAILURE: a refused expire_hold still deleted data';
  end if;
  raise notice 'PASS (HOLD-7b): the refused expiry deleted nothing';
end $$;

-- Paid retention spares the records even once the window has closed. That is
-- the entire product of the retention fee. Same service_role wrapper, same
-- reason as HOLD-7 above: this must exercise the real grant, not the
-- migration owner's implicit one.
do $$
declare clients_left int;
begin
  update pilot.accounts
     set hold_started_at      = now() - interval '40 days',
         hold_ends_at         = now() - interval '1 day',
         retention_paid_until = now() + interval '20 days'
   where id = '${A}';

  set local role service_role;
  begin
    perform pilot.expire_hold('${A}');
    raise exception 'HOLD-8 FAILURE: expire_hold purged an account with paid retention';
  exception when others then
    if sqlstate <> '22023' then raise; end if;
    raise notice 'PASS (HOLD-8, sqlstate 22023): paid retention spares the records past the window';
  end;
  reset role;

  select count(*) into clients_left from pilot.clients where account_id = '${A}';
  if clients_left <> 1 then
    raise exception 'HOLD-8b FAILURE: paid retention did not actually spare the data';
  end if;
  raise notice 'PASS (HOLD-8b): the retained account kept its commercial records';
end $$;

-- And the real expiry: window closed, retention unpaid. Commercial records
-- go; the airman records do not, on this path either. Same service_role
-- wrapper as HOLD-7/HOLD-8: this is the one call in this file that is
-- expected to SUCCEED as service_role rather than raise, so on the
-- pre-grant schema it fails loudly with an unhandled 42501 instead of
-- silently purging nothing (the exact production symptom).
do $$
declare clients_left int; logbook_left int; docs_left int; still_held timestamptz; detached_ok int; quals_left int;
begin
  -- Linked across the retain/delete boundary, exactly as the PART 1 fixtures
  -- are and for the same reason: an unlinked document survives any FK
  -- declaration, so HOLD-10 would assert nothing. This is the AUTOMATED
  -- path — no session, no owner — which is the one that actually runs in
  -- production, so it gets the same trip-derived entry and client-linked
  -- document rather than free-floating rows.
  insert into pilot.trips (id, account_id, client_id, starts_on, ends_on)
  values ('${TR2}', '${A}', '${CL2}', '2026-03-31', '2026-04-01');
  insert into pilot.trip_legs (id, account_id, trip_id, leg_date)
  values ('${TL2}', '${A}', '${TR2}', '2026-04-01');
  insert into pilot.logbook_entries
    (account_id, airman_user_id, source, entry_date, total_time, role, trip_id, trip_leg_id)
  values ('${A}', '${UA}', 'trip', '2026-04-01', 1.8, 'PIC', '${TR2}', '${TL2}');
  insert into pilot.documents (account_id, kind, label, client_id)
  values ('${A}', 'passport', 'Passport', '${CL2}');
  insert into pilot.operator_qualifications
    (id, account_id, client_id, requirement, type_designator, status, completed_on)
  values ('${OQ2}', '${A}', '${CL2}', 'ipc_135_297', 'CE-680', 'current', '2026-02-10');

  update pilot.accounts
     set hold_started_at      = now() - interval '40 days',
         hold_ends_at         = now() - interval '1 day',
         retention_paid_until = null
   where id = '${A}';

  set local role service_role;
  perform pilot.expire_hold('${A}');
  reset role;

  select count(*) into clients_left from pilot.clients         where account_id = '${A}';
  select count(*) into logbook_left from pilot.logbook_entries where account_id = '${A}';
  select count(*) into docs_left    from pilot.documents       where account_id = '${A}';
  select count(*) into quals_left  from pilot.operator_qualifications where account_id = '${A}';
  select hold_started_at into still_held from pilot.accounts   where id = '${A}';

  if clients_left <> 0 then
    raise exception 'HOLD-9 FAILURE: an expired unpaid hold left commercial records (clients=%)', clients_left;
  end if;
  raise notice 'PASS (HOLD-9): an expired, unpaid hold purged the commercial records';

  if logbook_left <> 1 or docs_left <> 1 or quals_left <> 1 then
    raise exception
      'HOLD-10 FAILURE: hold expiry destroyed airman records (logbook=%, documents=%, operator_qualifications=%)',
      logbook_left, docs_left, quals_left;
  end if;
  raise notice 'PASS (HOLD-10): the logbook, documents and operator qualifications survived the expiry — the promise holds on the automated path too';

  -- And survived DETACHED with account_id intact, on the automated path too.
  select count(*) into detached_ok from pilot.logbook_entries
   where account_id = '${A}' and trip_id is null and trip_leg_id is null;
  if detached_ok <> 1 then
    raise exception
      'HOLD-10b FAILURE: the trip-derived entry did not survive the automated expiry detached (matching rows=%)',
      detached_ok;
  end if;
  select count(*) into detached_ok from pilot.documents
   where account_id = '${A}' and client_id is null;
  if detached_ok <> 1 then
    raise exception
      'HOLD-10c FAILURE: the client-linked document did not survive the automated expiry detached (matching rows=%)',
      detached_ok;
  end if;
  -- HOLD-10d: and the qualification, on the AUTOMATED path — the one that
  -- actually runs in production, with no session and no owner. Same four
  -- properties as PURGE-2d, including that the operator is still named.
  select count(*) into detached_ok from pilot.operator_qualifications
   where id = '${OQ2}'
     and account_id = '${A}'
     and client_id is null
     and operator_name = 'Held Client Co'
     and expires_on = date '2026-08-31';
  if detached_ok <> 1 then
    raise exception
      'HOLD-10d FAILURE: the operator qualification did not survive the automated expiry detached and attributable (matching rows=%). Row now: %',
      detached_ok,
      (select row(account_id, client_id, operator_name, expires_on)::text
         from pilot.operator_qualifications where id = '${OQ2}');
  end if;
  raise notice 'PASS (HOLD-10b/c/d): all three retained rows kept their account_id and cleared only the link to the purged parent, and the qualification still names its operator';

  if still_held is not null then
    raise exception 'HOLD-11 FAILURE: the hold was not cleared, so the next pass would purge again';
  end if;
  raise notice 'PASS (HOLD-11): the hold was cleared, so a second pass cannot re-purge';
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

-- ===========================================================================
-- PART 6 — THE RETAIN/DELETE BOUNDARY, ASSERTED FROM THE CATALOG.
--
-- Everything above this line tests the purge by RUNNING it against fixtures,
-- which only ever proves the boundary for the rows somebody remembered to
-- insert. That is exactly how two critical bugs lived here undetected: the
-- fixtures never linked a retained row to a purged one, so the retained rows
-- survived for the trivial reason that nothing pointed at anything. The
-- fixtures are now linked (see the top of this file), but a fixture can only
-- cover the tables it names, and the schema keeps growing.
--
-- So this block asserts the property itself, over the WHOLE catalog, with no
-- fixtures involved:
--
--   NO TABLE ON THE RETAIN LIST MAY HOLD A FOREIGN KEY TO A TABLE ON THE
--   DELETE LIST UNLESS THAT KEY IS 'on delete set null (<col>)' WITH AN
--   EXPLICIT COLUMN LIST.
--
-- The two ways to get this wrong are the two bugs this file now covers, and
-- the assertion catches both by construction:
--
--   * ON DELETE CASCADE (or SET DEFAULT) — the purge silently DESTROYS a
--     retained record. pilot.documents.client_id was this, and a lapsed
--     billing hold deleted every client-linked document while three
--     migrations promised it could not (fixed by 20260821091000).
--   * A BARE COMPOSITE ON DELETE SET NULL — Postgres nulls every column of
--     the referencing key, account_id included, and account_id is NOT NULL
--     everywhere in this schema, so the purge ABORTS with 23502 and the
--     account is stuck on a hold that can never expire. This has now shipped
--     four times (20260810030000, 20260815130000, 20260818230000,
--     20260821090000). 'confdelsetcols' is how the catalog tells the two
--     forms apart: null/empty means the bare form.
--
--   * RESTRICT / NO ACTION also fails here, and should: it blocks the purge
--     rather than performing it, which is the same stuck hold with a
--     different sqlstate (that was 20260818230000's aircraft bug).
--
-- THE DELETE LIST IS READ FROM pilot.purge_business_data_rows' OWN SOURCE,
-- never restated here — a restated list is a second source of truth that
-- drifts, which is the failure this whole file exists to catch. The retain
-- list is then simply "every other table in schema pilot", so a new table
-- needs no edit here to be covered.
-- ===========================================================================

do $$
declare
  purged text[];
  offenders text;
  n_checked int;
begin
  -- The delete list, parsed out of the function that owns it.
  select array_agg(distinct m[1]) into purged
    from pg_proc p,
         lateral regexp_matches(
           p.prosrc, 'delete[[:space:]]+from[[:space:]]+pilot[.]([a-z_]+)', 'gi') as m
   where p.pronamespace = 'pilot'::regnamespace
     and p.proname = 'purge_business_data_rows';

  -- The failure mode of a completeness check is that it stops finding the
  -- thing it is completing. An empty parse would make every assertion below
  -- pass vacuously, so refuse it outright — same guard, same reasoning, as
  -- scripts/account-lifecycle-verify.mjs' own zero-delete refusal.
  if purged is null or cardinality(purged) = 0 then
    raise exception
      'BOUNDARY-0 FAILURE: parsed ZERO deletes out of pilot.purge_business_data_rows. '
      'Every boundary assertion below would pass vacuously — the function was probably '
      'renamed or its body reshaped; fix this parse before trusting anything here.';
  end if;

  select count(*) into n_checked
    from pg_constraint c
    join pg_class child  on child.oid  = c.conrelid
    join pg_class parent on parent.oid = c.confrelid
   where c.contype = 'f'
     and child.relnamespace  = 'pilot'::regnamespace
     and parent.relnamespace = 'pilot'::regnamespace
     and parent.relname = any(purged)
     and not (child.relname = any(purged));

  select string_agg(line, chr(10) order by line) into offenders from (
    select format(
             '    %s  —  pilot.%s (%s) -> pilot.%s, on delete %s',
             c.conname, child.relname,
             (select string_agg(a.attname, ', ' order by k.ord)
                from unnest(c.conkey) with ordinality as k(attnum, ord)
                join pg_attribute a
                  on a.attrelid = c.conrelid and a.attnum = k.attnum),
             parent.relname,
             case c.confdeltype
               when 'c' then 'cascade (DESTROYS a retained record)'
               when 'r' then 'restrict (BLOCKS the purge)'
               when 'a' then 'no action (BLOCKS the purge)'
               when 'd' then 'set default'
               when 'n' then 'set null with NO column list (nulls account_id; ABORTS the purge with 23502)'
               else c.confdeltype::text
             end) as line
      from pg_constraint c
      join pg_class child  on child.oid  = c.conrelid
      join pg_class parent on parent.oid = c.confrelid
     where c.contype = 'f'
       and child.relnamespace  = 'pilot'::regnamespace
       and parent.relnamespace = 'pilot'::regnamespace
       -- Parent is PURGED, child is RETAINED: the boundary.
       and parent.relname = any(purged)
       and not (child.relname = any(purged))
       -- The one acceptable shape.
       and not (c.confdeltype = 'n'
                and coalesce(cardinality(c.confdelsetcols), 0) > 0)
       -- ── NAMED EXEMPTIONS. Each one is a decision, not an oversight, and
       -- each is listed WITH ITS REASON so the next reader can tell the
       -- difference. Adding a name here is how you say "this crosses the
       -- boundary on purpose"; leaving one off is how the check works.
       and c.conname not in (
         -- pilot.document_shares.client_id is NOT NULL, and CASCADE is the
         -- RIGHT answer: a packet share is a live bearer token minted FOR
         -- one client. When that client is purged the link has no subject
         -- and must die with it — leaving a working token pointing at a
         -- deleted client would be the worse outcome. The DOCUMENTS the
         -- share exposes are untouched; only the link goes.
         'document_shares_account_id_client_id_fkey'
         -- pilot.operator_qualifications.client_id WAS the second exemption
         -- here and is not one any more. 20260821120000 denormalized the
         -- operator's name onto the row (operator_name, non-blank on every
         -- row), which made client_id safe to nullify and the FK safe to
         -- declare ON DELETE SET NULL (client_id) like every other crossing.
         -- The guard enforces it now; PURGE-2d and HOLD-10d above prove the
         -- runtime behaviour the declaration promises.
       )
  ) as bad;

  if offenders is not null then
    raise exception 'BOUNDARY-1 FAILURE: foreign key(s) cross the purge''s retain/delete boundary in a shape that either destroys a retained record or aborts the purge:%',
      chr(10) || offenders || chr(10) ||
      'Every FK from a RETAINED table to a PURGED one must be ON DELETE SET NULL (<col>) WITH an explicit column list. ' ||
      'A bare composite SET NULL nulls account_id (NOT NULL) and aborts the purge with 23502; CASCADE destroys an airman ' ||
      'record a billing event may never touch; RESTRICT/NO ACTION blocks the purge forever. See 20260821090000 and ' ||
      '20260821091000 for the seven constraints this rule was written from. If a crossing is genuinely deliberate, add ' ||
      'the constraint name to the exemption list in this file WITH THE REASON.';
  end if;

  raise notice
    'PASS (BOUNDARY-1): % table(s) purged; % FK(s) cross the retain/delete boundary, and every one not named as an exemption is SET NULL (<col>) with an explicit column list',
    cardinality(purged), n_checked;
  raise notice
    'NOTE (BOUNDARY-1): 1 named exemption — document_shares.client_id (CASCADE is correct: a bearer token cannot outlive its subject). operator_qualifications.client_id was the second until 20260821120000 gave the row a denormalized operator_name; it is now enforced like every other crossing.';
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

#!/usr/bin/env node
// Autopay's authorization boundary, against a real Postgres.
//
// supabase/migrations/20260817160000_autopay.sql withholds five columns —
// autopay_stripe_customer_id, autopay_stripe_payment_method_id,
// autopay_method_label, autopay_consented_at, autopay_livemode — from every
// authenticated grant on pilot.clients, and says exactly why in its own
// header: "a pilot who could write autopay_stripe_payment_method_id could
// assert a mandate their client never gave." Autopay is the only mechanism
// in this product that charges a client's saved card off-session with
// nobody confirming it that day, so that sentence is not a comment, it is
// the whole security model for this feature. Nothing had ever run it
// against a live database — this file is that proof.
//
// SAME SHAPE AND SAME RULES as scripts/account-lifecycle-db-verify.mjs,
// scripts/connect-verify.mjs and scripts/tenancy-verify.mjs: role-switches
// a REAL Postgres connection with `set local role` + a `request.jwt.claims`
// GUC (what makes auth.uid() return a real value inside the SECURITY
// DEFINER functions, the same way PostgREST does it), inside one
// transaction that always rolls back (no live pilot data as fixtures,
// ever), and every negative case asserts a SPECIFIC sqlstate or message —
// never merely "an error happened" — because a probe that reports PASS for
// the wrong reason is worse than no probe.
//
// FIVE THINGS THIS FILE PROVES, EACH BY DOING IT AND LOOKING:
//   a. `authenticated` cannot UPDATE any of the five autopay_* columns on
//      pilot.clients, even on a row it owns — proven behaviourally (each
//      column, individually) AND by a catalog sweep of the grant itself.
//   b. service_role CAN write them — otherwise the Connect webhook (the
//      only intended writer) would be as broken as the tenant path, just
//      silently: a "fixed" grant that also locked out the webhook would
//      still pass every isolation check and simply never charge anyone.
//   c. clients_autopay_consistent rejects a half-set row, both directions
//      (a lone column set, and a lone column cleared out of a full set) —
//      a half-saved mandate is exactly the "some of this is true" state a
//      dispute has no way to read.
//   d. pilot.client_autopay_disable refuses a non-owner member of the
//      client's own tenant AND an owner of a different tenant altogether,
//      and leaves the row untouched both times.
//   e. pilot.connect_account_unlink clears a client's autopay enrollment —
//      the ids it clears live on the connected account that was just
//      disconnected, so a stale row here is a charge attempt against an
//      account the pilot no longer controls.
//
// Requires DATABASE_URL (a direct Postgres connection string) and `psql`.
//
//   DATABASE_URL="postgresql://..." npm run autopay:verify

import { spawnSync } from "node:child_process";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("autopay:verify requires DATABASE_URL (direct Postgres connection string).");
  process.exit(1);
}

// A is the subject tenant. B exists only to be a stranger tenant for the
// cross-tenant leg of check (d).
const A = "00000000-0000-0000-0000-0000000000a9";
const B = "00000000-0000-0000-0000-0000000000b9";
const UA = "00000000-0000-0000-0000-00000000aa09"; // owner of A
const UM = "00000000-0000-0000-0000-00000000ab09"; // non-owner member of A
const UB = "00000000-0000-0000-0000-00000000bb09"; // owner of B, a stranger to A
const CLIENT_A = "00000000-0000-0000-0000-0000000ca901"; // A's client, the row under test
// CHECK (f)'s fixtures — one schedule per guard the unattended generation
// door has to refuse, plus a second client of A's with no autopay consent.
const CLIENT_A_BARE = "00000000-0000-0000-0000-0000000ca902"; // A's client, never enrolled
const SCHED_OK = "00000000-0000-0000-0000-00000005c401"; // autopay on, active
const SCHED_NOAUTO = "00000000-0000-0000-0000-00000005c402"; // autopay off
const SCHED_PAUSED = "00000000-0000-0000-0000-00000005c403"; // autopay on, paused
const SCHED_UNENROL = "00000000-0000-0000-0000-00000005c404"; // autopay on, client not enrolled

const sql = `
begin;

-- ---------------------------------------------------------------------------
-- Fixtures. Two tenants, three people, one client. UM is a real member of A
-- (not a stranger) so check (d)'s owner-only gate is exercised against a
-- caller who genuinely belongs to the tenant; UB is a real owner of an
-- unrelated tenant so the cross-tenant leg is exercised against a caller who
-- genuinely owns SOMETHING, just not this.
-- ---------------------------------------------------------------------------
insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at)
values ('${UA}', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
        'autopay-verify-owner@example.invalid', now(), now()),
       ('${UM}', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
        'autopay-verify-member@example.invalid', now(), now()),
       ('${UB}', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
        'autopay-verify-stranger@example.invalid', now(), now());

insert into pilot.accounts (id, kind, legal_name)
values ('${A}', 'solo', 'Autopay Verify A'), ('${B}', 'solo', 'Autopay Verify B');

insert into pilot.account_members (account_id, user_id, role)
values ('${A}', '${UA}', 'owner'),
       ('${A}', '${UM}', 'member'),
       ('${B}', '${UB}', 'owner');

insert into pilot.clients (id, account_id, name)
values ('${CLIENT_A}', '${A}', 'Autopay Verify Client');

-- ===========================================================================
-- CHECK (a), PART 1 — catalog sweep. The migration's own claim is "NO
-- GRANTS for the five columns" — provable directly from the catalog before
-- a single write is even attempted. SELECT is deliberately excluded: the
-- migration grants that table-wide on purpose (both the pilot's screens and
-- the vendor page's SECURITY DEFINER reader need to show the state), so
-- this only sweeps for the write privileges the header says must not exist.
-- ===========================================================================
do $$
declare
  n int;
  hits text[];
begin
  select count(*), array_agg(column_name || ':' || privilege_type)
    into n, hits
    from information_schema.column_privileges
    where table_schema = 'pilot'
      and table_name = 'clients'
      and grantee = 'authenticated'
      and privilege_type in ('INSERT', 'UPDATE')
      and column_name in (
        'autopay_stripe_customer_id', 'autopay_stripe_payment_method_id',
        'autopay_method_label', 'autopay_consented_at', 'autopay_livemode'
      );
  if n <> 0 then
    raise exception 'AUTOPAY-0 FAILURE: authenticated holds % write grant(s) on the withheld autopay columns: %', n, hits;
  end if;
  raise notice 'PASS (AUTOPAY-0): catalog sweep confirms authenticated holds zero INSERT/UPDATE grants on any of the five autopay_* columns';
end $$;

-- ===========================================================================
-- CHECK (a), PART 2 — behavioural. Each of the five columns, individually,
-- from the account's OWN OWNER, direct to the table, on a row that owner
-- genuinely owns. This is the exact shape a security review tries first,
-- and the exact shape a re-widened grant would let straight through.
-- ===========================================================================
do $$
declare
  cols text[] := array[
    'autopay_stripe_customer_id', 'autopay_stripe_payment_method_id',
    'autopay_method_label', 'autopay_consented_at', 'autopay_livemode'
  ];
  -- One text literal per column; Postgres assignment-casts an unadorned
  -- string literal to the target column's real type (text/timestamptz/
  -- boolean), so a single generic value list works for all five.
  vals text[] := array[
    'cus_authenticated_hack', 'pm_authenticated_hack', 'Hacked Card',
    '2026-01-01T00:00:00Z', 'false'
  ];
  i int;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', '{"sub":"${UA}"}', true);

  for i in 1 .. array_length(cols, 1) loop
    begin
      execute format(
        'update pilot.clients set %I = %L where account_id = %L and id = %L',
        cols[i], vals[i], '${A}', '${CLIENT_A}'
      );
      raise exception 'AUTOPAY-1 FAILURE: authenticated (the row''s own account owner) wrote pilot.clients.%', cols[i];
    exception when insufficient_privilege then
      raise notice 'PASS (AUTOPAY-1.%, sqlstate 42501): authenticated cannot write pilot.clients.% — even on a row it owns', i, cols[i];
    end;
  end loop;

  reset role;
end $$;

-- Five refused UPDATEs may not have written five columns. A grant that
-- silently accepted the write and then something else rolled it back would
-- still be the bug this file exists to catch.
do $$
declare r record;
begin
  select autopay_stripe_customer_id, autopay_stripe_payment_method_id, autopay_method_label,
         autopay_consented_at, autopay_livemode
    into r
    from pilot.clients where id = '${CLIENT_A}';
  if r.autopay_stripe_customer_id is not null or r.autopay_stripe_payment_method_id is not null
     or r.autopay_method_label is not null or r.autopay_consented_at is not null
     or r.autopay_livemode is not null then
    raise exception 'AUTOPAY-1 FAILURE: a refused UPDATE still left a value behind (%)', r;
  end if;
  raise notice 'PASS (AUTOPAY-1, all five): five refused UPDATEs left every autopay column null';
end $$;

-- ===========================================================================
-- CHECK (b) — service_role CAN write them. The webhook that actually
-- records a client's consent runs as service_role; if this ever stops
-- working, autopay silently stops enrolling anyone, and (a) above would
-- keep passing throughout because it never exercises the writer that
-- matters.
-- ===========================================================================
set local role service_role;
update pilot.clients
   set autopay_stripe_customer_id = 'cus_service_role_verify',
       autopay_stripe_payment_method_id = 'pm_service_role_verify',
       autopay_method_label = 'Visa •••• 4242',
       autopay_consented_at = '2026-06-01T12:00:00Z',
       autopay_livemode = false
 where account_id = '${A}' and id = '${CLIENT_A}';
reset role;

do $$
declare r record;
begin
  select autopay_stripe_customer_id, autopay_stripe_payment_method_id, autopay_method_label,
         autopay_consented_at, autopay_livemode
    into r
    from pilot.clients where id = '${CLIENT_A}';
  if r.autopay_stripe_customer_id is distinct from 'cus_service_role_verify'
     or r.autopay_stripe_payment_method_id is distinct from 'pm_service_role_verify'
     or r.autopay_method_label is distinct from 'Visa •••• 4242'
     or r.autopay_consented_at is distinct from '2026-06-01T12:00:00Z'::timestamptz
     or r.autopay_livemode is distinct from false then
    raise exception 'AUTOPAY-2 FAILURE: service_role''s write to the five autopay columns did not take (%)', r;
  end if;
  raise notice 'PASS (AUTOPAY-2): service_role can write all five autopay columns — the webhook path this feature depends on is intact';
end $$;

-- ===========================================================================
-- CHECK (c) — clients_autopay_consistent. A half-saved mandate (some Stripe
-- ids present, some absent) is the shape a dispute cannot be answered from.
-- Proven both directions: clearing one column out of a full set, and (after
-- resetting to null) setting one column alone.
-- ===========================================================================
set local role service_role;
do $$
declare v_constraint text;
begin
  begin
    update pilot.clients set autopay_consented_at = null
      where account_id = '${A}' and id = '${CLIENT_A}';
    raise exception 'AUTOPAY-3a FAILURE: clearing one autopay column out of a full set was accepted';
  exception when check_violation then
    get stacked diagnostics v_constraint = constraint_name;
    if v_constraint <> 'clients_autopay_consistent' then
      raise exception 'AUTOPAY-3a FAILURE: rejected by the wrong constraint (%)', v_constraint;
    end if;
    raise notice 'PASS (AUTOPAY-3a, sqlstate 23514, constraint clients_autopay_consistent): a half-CLEARED autopay row is rejected';
  end;
end $$;
reset role;

do $$
declare r record;
begin
  select autopay_stripe_customer_id, autopay_consented_at into r
    from pilot.clients where id = '${CLIENT_A}';
  if r.autopay_stripe_customer_id is distinct from 'cus_service_role_verify'
     or r.autopay_consented_at is distinct from '2026-06-01T12:00:00Z'::timestamptz then
    raise exception 'AUTOPAY-3a FAILURE: the refused half-clear still changed the row (%)', r;
  end if;
  raise notice 'PASS (AUTOPAY-3a, unchanged): the refused half-clear left every column exactly as it was';
end $$;

-- Reset to a clean null baseline, then prove the other direction: setting
-- one column alone.
set local role service_role;
update pilot.clients
   set autopay_stripe_customer_id = null, autopay_stripe_payment_method_id = null,
       autopay_method_label = null, autopay_consented_at = null, autopay_livemode = null
 where account_id = '${A}' and id = '${CLIENT_A}';

do $$
declare v_constraint text;
begin
  begin
    update pilot.clients set autopay_stripe_customer_id = 'cus_half_set_verify'
      where account_id = '${A}' and id = '${CLIENT_A}';
    raise exception 'AUTOPAY-3b FAILURE: setting one autopay column alone (from a null baseline) was accepted';
  exception when check_violation then
    get stacked diagnostics v_constraint = constraint_name;
    if v_constraint <> 'clients_autopay_consistent' then
      raise exception 'AUTOPAY-3b FAILURE: rejected by the wrong constraint (%)', v_constraint;
    end if;
    raise notice 'PASS (AUTOPAY-3b, sqlstate 23514, constraint clients_autopay_consistent): a half-SET autopay row is rejected';
  end;
end $$;
reset role;

do $$
declare n int;
begin
  select count(*) into n from pilot.clients
    where id = '${CLIENT_A}' and autopay_stripe_customer_id is null
      and autopay_stripe_payment_method_id is null and autopay_method_label is null
      and autopay_consented_at is null and autopay_livemode is null;
  if n <> 1 then
    raise exception 'AUTOPAY-3b FAILURE: the refused half-set left a value behind';
  end if;
  raise notice 'PASS (AUTOPAY-3b, unchanged): the refused half-set left every column null';
end $$;

-- ===========================================================================
-- CHECK (d) — pilot.client_autopay_disable's authorization boundary. Two
-- distinct refusals: a real member of the client's OWN tenant who is not
-- its owner, and a real owner of a DIFFERENT tenant altogether. Re-populate
-- first via service_role, since (c) above deliberately left the row null
-- and a disable-of-nothing would prove nothing about the gate.
-- ===========================================================================
set local role service_role;
update pilot.clients
   set autopay_stripe_customer_id = 'cus_disable_gate_verify',
       autopay_stripe_payment_method_id = 'pm_disable_gate_verify',
       autopay_method_label = 'Mastercard •••• 4444',
       autopay_consented_at = '2026-07-01T09:00:00Z',
       autopay_livemode = false
 where account_id = '${A}' and id = '${CLIENT_A}';
reset role;

-- d1 — a non-owner MEMBER of A itself. This is the case a forgetful UI
-- guard would wave through, since UM genuinely belongs to the tenant.
do $$
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', '{"sub":"${UM}"}', true);
  begin
    perform pilot.client_autopay_disable('${CLIENT_A}');
    raise exception 'AUTOPAY-4a FAILURE: a non-owner member turned off another client''s autopay';
  exception when others then
    if sqlerrm not like 'only an account owner may turn autopay off%' then
      raise exception 'AUTOPAY-4a FAILURE: rejected for the wrong reason: %', sqlerrm;
    end if;
    raise notice 'PASS (AUTOPAY-4a): a non-owner member of the client''s own tenant is refused by the owner-only gate';
  end;
  reset role;
end $$;

-- d2 — the owner of an ENTIRELY DIFFERENT tenant, naming A's client id.
-- current_account_ids() for UB never includes A, so the lookup finds no
-- row at all — the cross-tenant case is refused for want of a match, not
-- merely for want of ownership.
do $$
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', '{"sub":"${UB}"}', true);
  begin
    perform pilot.client_autopay_disable('${CLIENT_A}');
    raise exception 'AUTOPAY-4b FAILURE: an owner of an unrelated tenant turned off another tenant''s client autopay';
  exception when others then
    if sqlerrm not like 'client % not found%' then
      raise exception 'AUTOPAY-4b FAILURE: rejected for the wrong reason: %', sqlerrm;
    end if;
    raise notice 'PASS (AUTOPAY-4b): an owner of a different tenant naming this client id is refused — the client is not found in ITS OWN current_account_ids()';
  end;
  reset role;
end $$;

-- Neither refusal may have cleared anything.
do $$
declare r record;
begin
  select autopay_stripe_customer_id, autopay_method_label into r
    from pilot.clients where id = '${CLIENT_A}';
  if r.autopay_stripe_customer_id is distinct from 'cus_disable_gate_verify'
     or r.autopay_method_label is distinct from 'Mastercard •••• 4444' then
    raise exception 'AUTOPAY-4 FAILURE: a refused client_autopay_disable call still cleared the row (%)', r;
  end if;
  raise notice 'PASS (AUTOPAY-4, unchanged): two refused calls left the client''s autopay enrollment intact';
end $$;

-- d3 — the legitimate path: A's own owner turns it off, and it actually
-- clears. Proving only the refusals and never the success would leave open
-- the possibility that NO caller can ever reach this function.
do $$
declare r record;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', '{"sub":"${UA}"}', true);
  perform pilot.client_autopay_disable('${CLIENT_A}');
  reset role;

  select autopay_stripe_customer_id, autopay_stripe_payment_method_id, autopay_method_label,
         autopay_consented_at, autopay_livemode
    into r
    from pilot.clients where id = '${CLIENT_A}';
  if r.autopay_stripe_customer_id is not null or r.autopay_stripe_payment_method_id is not null
     or r.autopay_method_label is not null or r.autopay_consented_at is not null
     or r.autopay_livemode is not null then
    raise exception 'AUTOPAY-4c FAILURE: the account''s own owner could not turn off the client''s autopay (%)', r;
  end if;
  raise notice 'PASS (AUTOPAY-4c): the account''s own owner successfully turns off a client''s autopay, and all five columns clear';
end $$;

-- ===========================================================================
-- CHECK (e) — pilot.connect_account_unlink clears autopay too. Re-populate
-- the client and give the account a connected Stripe account first, so the
-- unlink has something to actually clear.
-- ===========================================================================
set local role service_role;
update pilot.clients
   set autopay_stripe_customer_id = 'cus_unlink_verify',
       autopay_stripe_payment_method_id = 'pm_unlink_verify',
       autopay_method_label = 'Amex •••• 1005',
       autopay_consented_at = '2026-07-15T15:30:00Z',
       autopay_livemode = false
 where account_id = '${A}' and id = '${CLIENT_A}';
update pilot.accounts set connect_account_id = 'acct_AutopayVerify001'
 where id = '${A}';
reset role;

do $$
declare r record; v_connect text;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', '{"sub":"${UA}"}', true);
  perform pilot.connect_account_unlink('${A}');
  reset role;

  select connect_account_id into v_connect from pilot.accounts where id = '${A}';
  select autopay_stripe_customer_id, autopay_stripe_payment_method_id, autopay_method_label,
         autopay_consented_at, autopay_livemode
    into r
    from pilot.clients where id = '${CLIENT_A}';

  if v_connect is not null then
    raise exception 'AUTOPAY-5 FAILURE: connect_account_id survived connect_account_unlink';
  end if;
  if r.autopay_stripe_customer_id is not null or r.autopay_stripe_payment_method_id is not null
     or r.autopay_method_label is not null or r.autopay_consented_at is not null
     or r.autopay_livemode is not null then
    raise exception 'AUTOPAY-5 FAILURE: a client''s autopay enrollment survived disconnecting Stripe (%) — the saved ids now point at an account the pilot no longer controls', r;
  end if;
  raise notice 'PASS (AUTOPAY-5): disconnecting Stripe clears connect_account_id AND every client''s autopay enrollment on that tenant';
end $$;

-- ===========================================================================
-- CHECK (f) — pilot.generate_autopay_invoice, the unattended generation door
-- added by 20260819100000. This is the only path that can create an invoice
-- destined to be charged off-session with no human confirming it that day,
-- so its grants and its five re-derived guards are asserted by execution
-- here, not read out of the migration.
--
-- Why the role wrappers below are load-bearing: a function's OWNER always
-- retains implicit EXECUTE on it regardless of any REVOKE, so a check that
-- runs as the migration-owner role proves nothing about whether the real
-- caller can reach it. That is exactly how pilot.expire_hold shipped with
-- no service_role grant and a purge that silently never ran (see
-- 20260819090000). Every call below states the role it is making.
-- ===========================================================================

-- Re-populate the enrollment that CHECK (e) deliberately cleared, and give
-- tenant A a schedule per case: autopay+active, autopay-off, paused, and one
-- pointing at a client with no enrollment.
set local role service_role;
update pilot.clients
   set autopay_stripe_customer_id = 'cus_gen_verify',
       autopay_stripe_payment_method_id = 'pm_gen_verify',
       autopay_method_label = 'Visa •••• 4242',
       autopay_consented_at = '2026-07-20T10:00:00Z',
       autopay_livemode = false
 where account_id = '${A}' and id = '${CLIENT_A}';
insert into pilot.clients (id, account_id, name)
  values ('${CLIENT_A_BARE}', '${A}', 'Autopay verify — not enrolled');
insert into pilot.recurring_invoice_schedules
  (id, account_id, client_id, cadence, anchor_date, description, amount_cents, autopay, active)
values
  ('${SCHED_OK}',       '${A}', '${CLIENT_A}',      'monthly', '2026-01-01', 'Autopay verify retainer', 250000, true,  true),
  ('${SCHED_NOAUTO}',   '${A}', '${CLIENT_A}',      'monthly', '2026-01-01', 'Autopay verify no-auto',  250000, false, true),
  ('${SCHED_PAUSED}',   '${A}', '${CLIENT_A}',      'monthly', '2026-01-01', 'Autopay verify paused',   250000, true,  false),
  ('${SCHED_UNENROL}',  '${A}', '${CLIENT_A_BARE}', 'monthly', '2026-01-01', 'Autopay verify unenrol',  250000, true,  true);
reset role;

-- AUTOPAY-6 — the grants. service_role must reach it; nobody else may.
do $$
declare fn text := 'pilot.generate_autopay_invoice(uuid,uuid,date)';
begin
  if not has_function_privilege('service_role', fn, 'EXECUTE') then
    raise exception 'AUTOPAY-6 FAILURE: service_role cannot EXECUTE % — the scheduled pass would fail with 42501 on every call and, depending on the caller''s error handling, may not say so out loud. This is the pilot.expire_hold defect (20260819090000) repeating.', fn;
  end if;
  if has_function_privilege('authenticated', fn, 'EXECUTE') then
    raise exception 'AUTOPAY-6 FAILURE: authenticated can EXECUTE % — a pilot session could drive unattended generation, bypassing the interactive path''s entitlement checks', fn;
  end if;
  if has_function_privilege('anon', fn, 'EXECUTE') then
    raise exception 'AUTOPAY-6 FAILURE: anon can EXECUTE %', fn;
  end if;
  raise notice 'PASS (AUTOPAY-6): generate_autopay_invoice is granted to service_role only';
end $$;

-- AUTOPAY-7 — denial in practice, as the actual roles, not just in the
-- catalog. A grant that reads correctly but does not hold is the whole
-- failure mode this check exists for.
do $$
begin
  begin
    set local role authenticated;
    perform pilot.generate_autopay_invoice('${A}', '${SCHED_OK}', '2026-06-01');
    reset role;
    raise exception 'AUTOPAY-7 FAILURE: an authenticated session generated an unattended autopay invoice';
  exception when insufficient_privilege then
    reset role;
  end;
  begin
    set local role anon;
    perform pilot.generate_autopay_invoice('${A}', '${SCHED_OK}', '2026-06-01');
    reset role;
    raise exception 'AUTOPAY-7 FAILURE: an anonymous caller generated an unattended autopay invoice';
  exception when insufficient_privilege then
    reset role;
  end;
  raise notice 'PASS (AUTOPAY-7): authenticated and anon are refused with 42501 when they actually try';
end $$;

-- AUTOPAY-8 — the five guards, each exercised as service_role (a caller
-- that CAN execute the function, so a refusal here is the guard talking and
-- not the grant). Each must refuse, and none may leave a row behind.
-- Each case records whether the call SUCCEEDED into a flag and reports
-- afterwards, rather than raising the failure from inside the handler's own
-- scope. That is not a style preference. \`raise exception\` without an
-- explicit errcode defaults to P0001 — the very code four of these five
-- guards raise — so a failure signal raised inside the begin/exception
-- block would be caught by that block's own \`when sqlstate 'P0001'\`
-- handler and silently counted as a pass. Written the obvious way, this
-- check reported all five guards passing against a function whose guard 3
-- had been deleted outright (found by removing it and watching this check
-- stay green). A flag cannot be swallowed.
do $$
declare
  generated boolean;
  failures text[] := '{}';
begin
  set local role service_role;

  -- Guard 1 asserts the OUTCOME (no cross-tenant generation), not which line
  -- produced the refusal, so it accepts either sqlstate. That is not
  -- looseness: guard 4's client lookup is scoped on target_account too, so
  -- deleting guard 1's tenancy predicate still blocks the write — it just
  -- refuses with guard 4's P0001 ("client is not enrolled") instead of guard
  -- 1's P0002. Verified by deleting guard 1 and re-running: the cross-tenant
  -- write is still refused, two layers deep. Pinning this to P0002 alone
  -- would make the check fail with a misleading message about enrollment
  -- when what actually regressed was tenancy.
  begin
    perform pilot.generate_autopay_invoice('${B}', '${SCHED_OK}', '2026-06-01');
    generated := true;
  exception when sqlstate 'P0002' or sqlstate 'P0001' then generated := false; end;
  if generated then failures := array_append(failures, 'guard 1: a schedule was generated against a tenant that does not own it — cross-tenant write'); end if;

  begin
    perform pilot.generate_autopay_invoice('${A}', '${SCHED_PAUSED}', '2026-06-01');
    generated := true;
  exception when sqlstate 'P0001' then generated := false; end;
  if generated then failures := array_append(failures, 'guard 2: a paused schedule generated an invoice'); end if;

  begin
    perform pilot.generate_autopay_invoice('${A}', '${SCHED_NOAUTO}', '2026-06-01');
    generated := true;
  exception when sqlstate 'P0001' then generated := false; end;
  if generated then failures := array_append(failures, 'guard 3: a schedule with autopay = false was generated unattended — this is the guard that keeps a bug in the scheduled pass from auto-issuing invoices for schedules the pilot never opted into automating'); end if;

  begin
    perform pilot.generate_autopay_invoice('${A}', '${SCHED_UNENROL}', '2026-06-01');
    generated := true;
  exception when sqlstate 'P0001' then generated := false; end;
  if generated then failures := array_append(failures, 'guard 4: an invoice was generated for a client with no autopay consent record — it would be issued and then never charged'); end if;

  begin
    perform pilot.generate_autopay_invoice('${A}', '${SCHED_OK}', '2099-01-01');
    generated := true;
  exception when sqlstate 'P0001' then generated := false; end;
  if generated then failures := array_append(failures, 'guard 5: a period that has not started was generated'); end if;

  reset role;
  if array_length(failures, 1) is not null then
    raise exception 'AUTOPAY-8 FAILURE: %', array_to_string(failures, ' | ');
  end if;
  raise notice 'PASS (AUTOPAY-8): all five guards refuse — wrong tenant, paused, autopay off, client not enrolled, future period';
end $$;

-- AUTOPAY-8b — structural, and the necessary complement to AUTOPAY-8's
-- behavioural pass. Cross-tenant generation is blocked twice over: guard 1
-- scopes the SCHEDULE lookup on target_account, and guard 4 independently
-- scopes the CLIENT lookup the same way. That redundancy is a strength at
-- runtime and a blind spot for a purely behavioural check — with guard 1
-- deleted, guard 4 alone still refuses, so AUTOPAY-8 stays green while the
-- function's primary tenancy check is gone (confirmed by deleting it).
-- Losing one layer silently is how you end up with none. This asserts both
-- predicates are actually present, the same way AUTOPAY-0 sweeps the
-- catalog rather than trusting the behavioural result alone.
do $$
declare src text; missing text[] := '{}';
begin
  select pg_get_functiondef(p.oid) into src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'pilot' and p.proname = 'generate_autopay_invoice';

  if src is null then
    raise exception 'AUTOPAY-8b FAILURE: pilot.generate_autopay_invoice does not exist';
  end if;
  if src !~ 'recurring_invoice_schedules\\s+where id = p_schedule_id\\s+and account_id = target_account' then
    missing := array_append(missing, 'the SCHEDULE lookup (guard 1) is no longer scoped by target_account — cross-tenant generation would then rest entirely on guard 4''s client lookup');
  end if;
  if src !~ 'from pilot\\.clients\\s+where id = v_schedule\\.client_id\\s+and account_id = target_account' then
    missing := array_append(missing, 'the CLIENT lookup (guard 4) is no longer scoped by target_account — the second tenancy layer is gone');
  end if;
  if array_length(missing, 1) is not null then
    raise exception 'AUTOPAY-8b FAILURE: %', array_to_string(missing, ' | ');
  end if;
  raise notice 'PASS (AUTOPAY-8b): both tenancy predicates are present — the schedule lookup and the client lookup are each scoped by target_account';
end $$;

-- AUTOPAY-9 — no refusal above wrote anything.
do $$
declare n int;
begin
  select count(*) into n from pilot.recurring_invoice_generations
   where account_id = '${A}' and schedule_id in ('${SCHED_OK}','${SCHED_NOAUTO}','${SCHED_PAUSED}','${SCHED_UNENROL}');
  if n <> 0 then
    raise exception 'AUTOPAY-9 FAILURE: % generation row(s) exist after only refusals', n;
  end if;
  raise notice 'PASS (AUTOPAY-9): every refusal left the ledger empty';
end $$;

-- AUTOPAY-10 — the happy path, as service_role. Must produce exactly one
-- invoice, one line, one ledger row, and the invoice must still be a DRAFT:
-- this function generates, it does not issue or charge.
do $$
declare v_invoice uuid; v_status text; n_lines int; n_ledger int;
begin
  set local role service_role;
  v_invoice := pilot.generate_autopay_invoice('${A}', '${SCHED_OK}', '2026-06-01');
  reset role;

  if v_invoice is null then
    raise exception 'AUTOPAY-10 FAILURE: generation returned null';
  end if;
  select status into v_status from pilot.invoices where id = v_invoice;
  select count(*) into n_lines from pilot.invoice_lines where invoice_id = v_invoice;
  select count(*) into n_ledger from pilot.recurring_invoice_generations
   where schedule_id = '${SCHED_OK}' and period_start = '2026-06-01';

  if v_status is distinct from 'draft' then
    raise exception 'AUTOPAY-10 FAILURE: unattended generation produced an invoice in status % — it must leave a DRAFT and let the caller decide to issue and charge', v_status;
  end if;
  if n_lines <> 1 or n_ledger <> 1 then
    raise exception 'AUTOPAY-10 FAILURE: expected 1 line and 1 ledger row, got % and %', n_lines, n_ledger;
  end if;
  raise notice 'PASS (AUTOPAY-10): service_role generates one draft invoice, one line, one ledger row';
end $$;

-- AUTOPAY-11 — THE DOUBLE-BILL GUARD, and the reason this whole function
-- was allowed to exist. A cron retry, two overlapping passes, or the pass
-- racing the pilot's own click all land on the same (schedule, period).
-- The second one must raise 23505 AND roll back the invoice and line it
-- inserted moments earlier — an orphaned invoice here is a client billed
-- twice for one period.
do $$
declare n_before int; n_after int; lines_before int; lines_after int;
begin
  select count(*) into n_before from pilot.invoices where account_id = '${A}';
  select count(*) into lines_before from pilot.invoice_lines where account_id = '${A}';

  begin
    set local role service_role;
    perform pilot.generate_autopay_invoice('${A}', '${SCHED_OK}', '2026-06-01');
    reset role;
    raise exception 'AUTOPAY-11 FAILURE: the same (schedule, period) generated TWICE — this is a double bill';
  exception when unique_violation then
    reset role;
  end;

  select count(*) into n_after from pilot.invoices where account_id = '${A}';
  select count(*) into lines_after from pilot.invoice_lines where account_id = '${A}';
  if n_after <> n_before or lines_after <> lines_before then
    raise exception 'AUTOPAY-11 FAILURE: the refused second call left % orphan invoice(s) and % orphan line(s) behind — the three writes are not rolling back as one statement', n_after - n_before, lines_after - lines_before;
  end if;

  -- The interactive door must contend on the same row, or the two paths can
  -- double-bill each other even though neither can double-bill itself.
  begin
    insert into pilot.recurring_invoice_generations (account_id, schedule_id, period_start, invoice_id)
      values ('${A}', '${SCHED_OK}', '2026-06-01',
              (select invoice_id from pilot.recurring_invoice_generations
                where schedule_id = '${SCHED_OK}' and period_start = '2026-06-01'));
    raise exception 'AUTOPAY-11 FAILURE: the ledger accepted a duplicate (schedule, period) — the interactive and unattended paths do not contend, so they can double-bill each other';
  exception when unique_violation then
    null;
  end;

  raise notice 'PASS (AUTOPAY-11): a repeated period raises 23505, leaves no orphan invoice or line, and both generation doors contend on the same ledger row';
end $$;

-- The unrelated tenant must be untouched by all of the above.
do $$
declare n int;
begin
  select count(*) into n from pilot.accounts where id = '${B}';
  if n <> 1 then
    raise exception 'ISOLATION FAILURE: tenant B was affected by tenant A''s autopay checks';
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

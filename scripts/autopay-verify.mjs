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

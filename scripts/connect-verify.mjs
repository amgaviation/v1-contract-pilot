#!/usr/bin/env node
/**
 * Stripe Connect (Standard) verification (docs/PLAN.md: `npm run
 * connect:verify` — "Connect onboarding, and assert no Stripe secret key
 * is ever persisted for a tenant").
 *
 * Same shape and same rules as scripts/tenancy-verify.mjs: drives the
 * REAL database over a REAL Postgres role switch inside one transaction
 * that always rolls back (no live pilot data as fixtures, ever), and
 * every negative case asserts the SPECIFIC SQLSTATE — never merely "an
 * error happened" — because a probe that reports PASS for the wrong
 * reason is worse than no probe (this suite has already been fooled
 * twice this session by exactly that shape of mistake).
 *
 * WHAT THIS SCRIPT DOES NOT DO, AND WHY: it does not call the real Stripe
 * API (OAuth exchange, payment link creation) — those need live/sandbox
 * Stripe credentials this environment doesn't have. Not verified here;
 * would be verified by running the OAuth flow end-to-end against a
 * Stripe test-mode Connect application and a running dev server, the
 * same way scripts/billing-verify.mjs proves the platform webhook
 * against a real HTTP server rather than only asserting database shape.
 * What IS fully verified here is the entire database-side contract every
 * Stripe-facing code path in this feature depends on: the format guard,
 * the owner-only RPC gate, the billing-column trigger's exception, and
 * the "unsent invoice is not payable" rule — all provable without a
 * network call.
 *
 *   DATABASE_URL="postgresql://..." npm run connect:verify
 */

import { spawnSync } from "node:child_process";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("connect:verify requires DATABASE_URL (direct Postgres connection string).");
  process.exit(1);
}

const A = "00000000-0000-0000-0000-0000000000d1"; // owner's tenant
const B = "00000000-0000-0000-0000-0000000000d2"; // a second tenant, isolation control
const UA = "00000000-0000-0000-0000-00000000da01"; // owner of A
const UM = "00000000-0000-0000-0000-00000000da02"; // non-owner member of A
const UB = "00000000-0000-0000-0000-00000000da03"; // owner of B

const sql = `
begin;

insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at)
values
  ('${UA}', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'connect-verify-owner@example.invalid', now(), now()),
  ('${UM}', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'connect-verify-member@example.invalid', now(), now()),
  ('${UB}', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'connect-verify-tenantb@example.invalid', now(), now());

insert into pilot.accounts (id, kind, legal_name)
values ('${A}', 'solo', 'Connect Verify A'), ('${B}', 'solo', 'Connect Verify B');

insert into pilot.account_members (account_id, user_id, role)
values ('${A}', '${UA}', 'owner'), ('${B}', '${UB}', 'owner');
-- A second, NON-owner member of A, for the owner-only gate assertions.
insert into pilot.account_members (account_id, user_id, role)
values ('${A}', '${UM}', 'member');

-- ===========================================================================
-- ASSERTION 1 — no Stripe SECRET key can ever be persisted for a tenant.
-- Proven two ways: (a) the format CHECK constraint rejects anything that
-- isn't acct_..., which mechanically excludes every sk_.../rk_... key
-- shape, for EVERY writer including service_role; (b) a catalog sweep
-- confirms pilot.accounts carries no column that could hold one at all.
--
-- FAIL-PROOF for (a): a value shaped like a real Stripe secret key,
-- attempted as service_role (the most privileged writer that exists,
-- bypassing every grant and RLS policy) is still rejected — proving the
-- guard is a table CHECK, not a grant that a privileged role could route
-- around.
-- ===========================================================================
set local role service_role;
do $$
begin
  begin
    update pilot.accounts set connect_account_id = 'sk_live_51ABCDEFGHIJKLMNOP'
      where id = '${A}';
    raise exception 'CONNECT-1 FAILURE: a Stripe secret-key-shaped value was accepted into connect_account_id';
  exception when check_violation then
    raise notice 'PASS (CONNECT-1a, sqlstate confirmed 23514): a secret-key-shaped value is rejected by accounts_connect_account_id_format, even for service_role';
  end;
end $$;
reset role;

do $$
declare
  n int;
begin
  select count(*) into n
  from information_schema.columns
  where table_schema = 'pilot'
    and (column_name ilike '%stripe%secret%' or column_name ilike '%stripe%key%');
  if n <> 0 then
    raise exception 'CONNECT-1 FAILURE: found % column(s) in schema pilot shaped like a Stripe secret/key store', n;
  end if;
  raise notice 'PASS (CONNECT-1b): catalog sweep of schema pilot finds no column shaped to hold a Stripe secret/restricted key';
end $$;

-- ===========================================================================
-- ASSERTION 2 — connect_account_id is not writable by authenticated via a
-- crafted direct write. Asserts the SPECIFIC privilege-denial SQLSTATE
-- (42501, insufficient_privilege), which is what a bare column-grant
-- withholding actually raises — NOT 23514 (that would mean the grant
-- exists and only a CHECK stopped it) and not a generic caught exception.
--
-- FAIL-PROOF: this is exactly the crafted-write shape a security review
-- would try first (UPDATE ... SET connect_account_id = <valid-looking
-- acct_...> WHERE id = <own account>) — a real Stripe-shaped id, from the
-- account's own OWNER, direct to the table. If the grant were ever
-- accidentally re-widened (the Phase 1 migration's own stated failure
-- mode), this assertion is what would catch it, and it would catch it by
-- FAILING loudly (the UPDATE would succeed, the exception branch would
-- never run, and the outer raise exception fires) rather than by
-- silently reporting PASS.
-- ===========================================================================
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '${UA}', 'role', 'authenticated')::text, true);
do $$
begin
  begin
    update pilot.accounts set connect_account_id = 'acct_1CraftedWrite00'
      where id = '${A}';
    raise exception 'CONNECT-2 FAILURE: authenticated (account owner, direct UPDATE) was able to set connect_account_id';
  exception when insufficient_privilege then
    raise notice 'PASS (CONNECT-2, sqlstate confirmed 42501): connect_account_id is not authenticated-writable, even by the account''s own owner, even with a well-formed value';
  end;
end $$;
reset role;

-- ===========================================================================
-- ASSERTION 3 — pilot.connect_account_link is owner-gated (not merely
-- membership-gated) and format-gated, and actually works for the real
-- caller shape it exists for.
--
-- FAIL-PROOF: a non-owner member of the SAME tenant (UM, real membership
-- row, not a stranger) is rejected with the function's own explicit
-- P0001 message — proving the "role = 'owner'" clause is load-bearing,
-- not merely "any member of this account_id can act". If that clause
-- were ever dropped, this would flip from PASS to a silent UPDATE
-- succeeding, which the raise exception below turns back into a loud
-- failure.
-- ===========================================================================
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '${UM}', 'role', 'authenticated')::text, true);
do $$
begin
  begin
    perform pilot.connect_account_link('${A}', 'acct_1ValidShape000');
    raise exception 'CONNECT-3a FAILURE: a non-owner member connected Stripe for the account';
  exception when others then
    if sqlerrm not like 'only an account owner may connect Stripe%' then
      raise exception 'CONNECT-3a FAILURE: rejected for the wrong reason: %', sqlerrm;
    end if;
    raise notice 'PASS (CONNECT-3a): non-owner member is rejected by pilot.connect_account_link''s own owner check';
  end;
end $$;
reset role;

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '${UB}', 'role', 'authenticated')::text, true);
do $$
begin
  begin
    perform pilot.connect_account_link('${A}', 'acct_1ValidShape000');
    raise exception 'CONNECT-3b FAILURE: tenant B''s owner connected Stripe for tenant A''s account';
  exception when others then
    if sqlerrm not like 'only an account owner may connect Stripe%' then
      raise exception 'CONNECT-3b FAILURE: rejected for the wrong reason: %', sqlerrm;
    end if;
    raise notice 'PASS (CONNECT-3b): a different tenant''s owner cannot connect Stripe onto this account (cross-tenant write rejected)';
  end;
end $$;
reset role;

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '${UA}', 'role', 'authenticated')::text, true);
do $$
begin
  begin
    perform pilot.connect_account_link('${A}', 'not-a-real-account-id');
    raise exception 'CONNECT-3c FAILURE: a malformed connected-account id was accepted';
  exception when others then
    if sqlerrm not like 'invalid Stripe connected account id%' then
      raise exception 'CONNECT-3c FAILURE: rejected for the wrong reason: %', sqlerrm;
    end if;
    raise notice 'PASS (CONNECT-3c): malformed connected-account id is rejected before any write';
  end;
end $$;

select pilot.connect_account_link('${A}', 'acct_1RealOwnerLink0');
do $$
declare v text;
begin
  select connect_account_id into v from pilot.accounts where id = '${A}';
  if v is distinct from 'acct_1RealOwnerLink0' then
    raise exception 'CONNECT-3d FAILURE: the legitimate owner path did not persist connect_account_id';
  end if;
  raise notice 'PASS (CONNECT-3d): the account''s own owner, through pilot.connect_account_link, connects Stripe successfully';
end $$;
reset role;

-- ===========================================================================
-- ASSERTION 4 — disconnect clears connect_account_id AND every stored
-- payment-link reference on that tenant's invoices, and is owner-gated
-- the same way.
-- ===========================================================================
-- Seed a client, a draft invoice, issue it, and stamp a fake payment link
-- on it the way the payment-link action would (service_role stands in for
-- the authenticated UPDATE here purely to seed state fast; the grant that
-- makes the real path work is exercised separately in ASSERTION 5).
set local role service_role;
insert into pilot.clients (id, account_id, name) values ('${A}'::uuid, '${A}', 'ignored')
  on conflict do nothing;
insert into pilot.clients (id, account_id, name)
  values ('00000000-0000-0000-0000-00000000d1c1', '${A}', 'Connect Verify Client');
insert into pilot.invoices (id, account_id, client_id, status)
  values ('00000000-0000-0000-0000-00000000d1e1', '${A}', '00000000-0000-0000-0000-00000000d1c1', 'draft');
insert into pilot.invoice_lines (account_id, invoice_id, line_type, description, unit_amount_cents)
  values ('${A}', '00000000-0000-0000-0000-00000000d1e1', 'flight_day', 'seed line', 100000);
update pilot.invoices set status = 'sent' where id = '00000000-0000-0000-0000-00000000d1e1' and account_id = '${A}';
update pilot.invoices
  set stripe_payment_link_id = 'plink_test_1', stripe_payment_link_url = 'https://buy.stripe.com/test_1', stripe_payment_link_livemode = false
  where id = '00000000-0000-0000-0000-00000000d1e1' and account_id = '${A}';
reset role;

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '${UM}', 'role', 'authenticated')::text, true);
do $$
begin
  begin
    perform pilot.connect_account_unlink('${A}');
    raise exception 'CONNECT-4a FAILURE: a non-owner member disconnected Stripe for the account';
  exception when others then
    if sqlerrm not like 'only an account owner may disconnect Stripe%' then
      raise exception 'CONNECT-4a FAILURE: rejected for the wrong reason: %', sqlerrm;
    end if;
    raise notice 'PASS (CONNECT-4a): non-owner member cannot disconnect Stripe';
  end;
end $$;
reset role;

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '${UA}', 'role', 'authenticated')::text, true);
select pilot.connect_account_unlink('${A}');
do $$
declare
  v_connect text;
  v_link text;
begin
  select connect_account_id into v_connect from pilot.accounts where id = '${A}';
  select stripe_payment_link_id into v_link from pilot.invoices
    where id = '00000000-0000-0000-0000-00000000d1e1' and account_id = '${A}';
  if v_connect is not null then
    raise exception 'CONNECT-4b FAILURE: connect_account_id survived disconnect';
  end if;
  if v_link is not null then
    raise exception 'CONNECT-4b FAILURE: a stored payment link survived disconnect';
  end if;
  raise notice 'PASS (CONNECT-4b): disconnect clears connect_account_id and every stored payment-link reference for the tenant';
end $$;
reset role;

-- ===========================================================================
-- ASSERTION 5 — an unsent invoice cannot be paid, at both layers:
--   (a) pilot.invoice_payments_validate (a real payment record) — the
--       pre-existing Phase 5 guard, re-proven here as this feature's own
--       precondition, not assumed.
--   (b) the new invoices_payment_link_requires_sendable_status CHECK — a
--       payment LINK reference cannot even be stored against a draft or
--       void invoice.
-- Both assert the specific SQLSTATE.
--
-- FAIL-PROOF: draft is the exact state a payment or a link is invalid in
-- BY CONSTRUCTION (nothing has been billed to the client yet) — the most
-- realistic way this guard would ever be missed is a UI bug that offers
-- the button anyway, which is exactly what this database-level check
-- exists to catch regardless of what the UI does.
-- ===========================================================================
set local role service_role;
insert into pilot.invoices (id, account_id, client_id, status)
  values ('00000000-0000-0000-0000-00000000d1e2', '${A}', '00000000-0000-0000-0000-00000000d1c1', 'draft');
reset role;

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '${UA}', 'role', 'authenticated')::text, true);
do $$
begin
  begin
    insert into pilot.invoice_payments (account_id, invoice_id, paid_on, amount_cents)
      values ('${A}', '00000000-0000-0000-0000-00000000d1e2', current_date, 10000);
    raise exception 'CONNECT-5a FAILURE: a payment was recorded against a draft (unsent) invoice';
  exception when others then
    if sqlerrm not like 'invoice % (status=draft) cannot receive a payment%' then
      raise exception 'CONNECT-5a FAILURE: rejected for the wrong reason: %', sqlerrm;
    end if;
    raise notice 'PASS (CONNECT-5a): an unsent (draft) invoice cannot receive a payment';
  end;
end $$;

do $$
begin
  begin
    update pilot.invoices set stripe_payment_link_id = 'plink_should_fail', stripe_payment_link_url = 'https://buy.stripe.com/x'
      where id = '00000000-0000-0000-0000-00000000d1e2' and account_id = '${A}';
    raise exception 'CONNECT-5b FAILURE: a payment link was stored against a draft (unsent) invoice';
  exception when check_violation then
    raise notice 'PASS (CONNECT-5b, sqlstate confirmed 23514): a payment link cannot be stored against a draft (unsent) invoice';
  end;
end $$;
reset role;

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

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
 * the owner-only RPC gate, the single-use OAuth state gate, the
 * billing-column trigger's exception, the "unsent invoice is not payable"
 * rule, and the void-with-a-link path — all provable without a network
 * call.
 *
 * STILL NOT VERIFIED HERE, AND SAID PLAINLY RATHER THAN IMPLIED: the two
 * Stripe-side behaviours this feature now leans on —
 * `restrictions.completed_sessions.limit = 1` actually deactivating a
 * Payment Link after one payment, and `paymentLinks.update(active:false)`
 * actually taking a link out of service on a CONNECTED account. Both are
 * documented Stripe behaviour and both are typed by the installed SDK,
 * but neither is exercised by this script, because neither can be without
 * a Stripe test-mode Connect application. They would be proven by running
 * the OAuth flow against one and paying a link twice.
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
-- ASSERTION 3 — the OAuth state gate. 20260810010000 replaced
-- pilot.connect_account_link's signature: it no longer takes an account
-- id, it consumes a single-use pilot.connect_oauth_states row and reads
-- the account off that. These assertions cover BOTH the gates the old
-- signature had (owner-only, format-checked) and the one it was missing —
-- proof that the OAuth round trip actually started here.
--
-- WHY THIS MATTERS AND WHY THE OLD VERSION WAS NOT ENOUGH: the previous
-- shape was reachable straight over PostgREST by any signed-in owner
-- (grant execute ... to authenticated is exactly that), so a pilot could
-- POST /rest/v1/rpc/connect_account_link with any well-formed acct_ id and
-- skip both the authorization-code exchange and the livemode agreement
-- check. CONNECT-3d below is the assertion that would catch a regression
-- to that shape.
--
-- FAIL-PROOF for the owner gate: a non-owner member of the SAME tenant
-- (UM, real membership row, not a stranger) is rejected with the
-- function's own explicit P0001 message — proving "role = 'owner'" is
-- load-bearing, not merely "any member of this account_id can act".
-- ===========================================================================
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '${UM}', 'role', 'authenticated')::text, true);
do $$
begin
  begin
    perform pilot.connect_oauth_state_begin('${A}');
    raise exception 'CONNECT-3a FAILURE: a non-owner member started a Stripe Connect flow for the account';
  exception when others then
    if sqlerrm not like 'only an account owner may connect Stripe%' then
      raise exception 'CONNECT-3a FAILURE: rejected for the wrong reason: %', sqlerrm;
    end if;
    raise notice 'PASS (CONNECT-3a): non-owner member is rejected by pilot.connect_oauth_state_begin''s owner check';
  end;
end $$;
reset role;

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '${UB}', 'role', 'authenticated')::text, true);
do $$
begin
  begin
    perform pilot.connect_oauth_state_begin('${A}');
    raise exception 'CONNECT-3b FAILURE: tenant B''s owner started a Connect flow for tenant A''s account';
  exception when others then
    if sqlerrm not like 'only an account owner may connect Stripe%' then
      raise exception 'CONNECT-3b FAILURE: rejected for the wrong reason: %', sqlerrm;
    end if;
    raise notice 'PASS (CONNECT-3b): a different tenant''s owner cannot start a Connect flow onto this account (cross-tenant write rejected)';
  end;
end $$;
reset role;

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '${UA}', 'role', 'authenticated')::text, true);

-- 3c — malformed account id, rejected before the state is even consulted.
do $$
begin
  begin
    perform pilot.connect_account_link('not-a-real-account-id', 'irrelevant');
    raise exception 'CONNECT-3c FAILURE: a malformed connected-account id was accepted';
  exception when others then
    if sqlerrm not like 'invalid Stripe connected account id%' then
      raise exception 'CONNECT-3c FAILURE: rejected for the wrong reason: %', sqlerrm;
    end if;
    raise notice 'PASS (CONNECT-3c): malformed connected-account id is rejected before any write';
  end;
end $$;

-- 3d — THE FINDING. A well-formed acct id, from the account's own OWNER,
-- with no OAuth flow ever started: exactly the direct-PostgREST call the
-- old signature accepted. It must be refused for want of a state.
do $$
declare
  v_before text;
  v_after text;
begin
  select connect_account_id into v_before from pilot.accounts where id = '${A}';
  begin
    perform pilot.connect_account_link('acct_1DirectCall0000', 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');
    raise exception 'CONNECT-3d FAILURE: an owner linked a Stripe account with no OAuth state — the RPC is directly callable';
  exception when others then
    if sqlerrm not like 'that Stripe connection attempt has expired or was already used%' then
      raise exception 'CONNECT-3d FAILURE: rejected for the wrong reason: %', sqlerrm;
    end if;
  end;
  select connect_account_id into v_after from pilot.accounts where id = '${A}';
  if v_after is distinct from v_before then
    raise exception 'CONNECT-3d FAILURE: connect_account_id changed despite the rejection (was %, now %)', v_before, v_after;
  end if;
  raise notice 'PASS (CONNECT-3d): a signed-in OWNER cannot link an arbitrary acct_ id without a state minted by a real OAuth start — and nothing was written';
end $$;

-- 3e — the state table is unreadable. If authenticated could select it,
-- a signed-in user could lift another user's in-flight state and the whole
-- proof collapses. RLS with no policies would return zero rows; NO GRANT
-- at all is stronger and is what this asserts (42501).
do $$
begin
  begin
    perform 1 from pilot.connect_oauth_states;
    raise exception 'CONNECT-3e FAILURE: authenticated can read pilot.connect_oauth_states';
  exception when insufficient_privilege then
    raise notice 'PASS (CONNECT-3e, sqlstate confirmed 42501): pilot.connect_oauth_states is unreadable to authenticated — the state exists only in the response to the caller that minted it';
  end;
end $$;

-- 3f — the legitimate path, end to end: mint a state, consume it, and the
-- account id comes back from the function (read off the state row, never
-- passed in).
do $$
declare
  v_state text;
  v_linked uuid;
  v_connect text;
begin
  v_state := pilot.connect_oauth_state_begin('${A}');
  if v_state !~ '^[A-Za-z0-9_-]{43}$' then
    raise exception 'CONNECT-3f FAILURE: minted state has the wrong shape: %', v_state;
  end if;
  v_linked := pilot.connect_account_link('acct_1RealOwnerLink0', v_state);
  if v_linked is distinct from '${A}'::uuid then
    raise exception 'CONNECT-3f FAILURE: the RPC linked the wrong account (%)', v_linked;
  end if;
  select connect_account_id into v_connect from pilot.accounts where id = '${A}';
  if v_connect is distinct from 'acct_1RealOwnerLink0' then
    raise exception 'CONNECT-3f FAILURE: the legitimate owner path did not persist connect_account_id';
  end if;
  raise notice 'PASS (CONNECT-3f): mint-then-consume connects Stripe, and the account written is the one the state was minted for';

  -- 3g — replay. The same state a second time (a captured callback URL
  -- re-opened) must be refused: DELETE ... RETURNING is the single-use
  -- guarantee, and this is what proves it rather than assuming it.
  begin
    perform pilot.connect_account_link('acct_1ReplayAttempt0', v_state);
    raise exception 'CONNECT-3g FAILURE: the same OAuth state was accepted twice';
  exception when others then
    if sqlerrm not like 'that Stripe connection attempt has expired or was already used%' then
      raise exception 'CONNECT-3g FAILURE: rejected for the wrong reason: %', sqlerrm;
    end if;
    raise notice 'PASS (CONNECT-3g): an OAuth state is single-use — a replayed callback is refused';
  end;
end $$;
reset role;

-- 3h — a state minted by one user cannot be consumed by another, even
-- another owner. This is the check that keeps the grant attached to the
-- session that actually completed the Stripe hop.
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '${UA}', 'role', 'authenticated')::text, true);
-- Carried across the role switch in a transaction-local GUC rather than a
-- temp table: the point of the probe is that UB has the string, and the
-- only place the string legitimately exists is UA's own response.
select set_config('connect_verify.state', pilot.connect_oauth_state_begin('${A}'), true);
reset role;

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '${UB}', 'role', 'authenticated')::text, true);
do $$
declare v_state text;
begin
  v_state := current_setting('connect_verify.state', true);
  if v_state is null then
    raise exception 'CONNECT-3h FAILURE: the probe could not carry the minted state across the role switch';
  end if;
  begin
    perform pilot.connect_account_link('acct_1StolenState000', v_state);
    raise exception 'CONNECT-3h FAILURE: a state minted by another user was accepted';
  exception when others then
    if sqlerrm not like 'that Stripe connection attempt belongs to a different sign-in%' then
      raise exception 'CONNECT-3h FAILURE: rejected for the wrong reason: %', sqlerrm;
    end if;
    raise notice 'PASS (CONNECT-3h): a state minted by one signed-in user cannot be consumed by another';
  end;
end $$;
reset role;

-- 3i — the old, proof-free signature is GONE, not merely unused. An
-- overload left in place would still be callable over PostgREST, which
-- would make every assertion above decorative.
do $$
declare n int;
begin
  select count(*) into n
  from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
  where ns.nspname = 'pilot'
    and p.proname = 'connect_account_link'
    and pg_get_function_identity_arguments(p.oid) = 'uuid, text';
  if n <> 0 then
    raise exception 'CONNECT-3i FAILURE: the old pilot.connect_account_link(uuid, text) still exists and is still callable';
  end if;
  raise notice 'PASS (CONNECT-3i): the pre-hardening connect_account_link(uuid, text) signature no longer exists';
end $$;

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
  set stripe_payment_link_id = 'plink_test_1', stripe_payment_link_url = 'https://buy.stripe.com/test_1',
      stripe_payment_link_livemode = false, stripe_payment_link_amount_cents = 100000
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
  v_amount bigint;
begin
  select connect_account_id into v_connect from pilot.accounts where id = '${A}';
  select stripe_payment_link_id, stripe_payment_link_amount_cents into v_link, v_amount
    from pilot.invoices
    where id = '00000000-0000-0000-0000-00000000d1e1' and account_id = '${A}';
  if v_connect is not null then
    raise exception 'CONNECT-4b FAILURE: connect_account_id survived disconnect';
  end if;
  if v_link is not null then
    raise exception 'CONNECT-4b FAILURE: a stored payment link survived disconnect';
  end if;
  -- The amount column was added later (20260810010000); a disconnect that
  -- cleared the id but left the amount behind would leave the screen
  -- claiming a price for a link that no longer exists.
  if v_amount is not null then
    raise exception 'CONNECT-4b FAILURE: a stored payment-link amount survived disconnect';
  end if;
  raise notice 'PASS (CONNECT-4b): disconnect clears connect_account_id and every stored payment-link reference (all four columns) for the tenant';
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

-- ===========================================================================
-- ASSERTION 6 — VOIDING A LINKED INVOICE. This is the bug review found and
-- this script did not: invoices_payment_link_requires_sendable_status
-- refuses to let a stored link survive into status='void', so the old
-- voidInvoice() — which sent { status: 'void' } and nothing else — failed
-- with 23514 on every invoice that had ever had a link generated.
--
-- 6a proves the failure still happens for the naive write (so the
-- constraint is real and still doing its job), and 6b proves the shape the
-- fixed action uses — clear all four link columns in the SAME update that
-- sets the status — actually works. Testing only 6b would leave the
-- regression free to come back the moment someone "simplifies" the action
-- back to a status-only write.
--
-- 6c covers the other new constraint: the id and url move together, so a
-- half-clear (which would leave a link the app can render but cannot
-- deactivate, or vice versa) is refused.
-- ===========================================================================
set local role service_role;
insert into pilot.invoices (id, account_id, client_id, status)
  values ('00000000-0000-0000-0000-00000000d1e3', '${A}', '00000000-0000-0000-0000-00000000d1c1', 'draft');
insert into pilot.invoice_lines (account_id, invoice_id, line_type, description, unit_amount_cents)
  values ('${A}', '00000000-0000-0000-0000-00000000d1e3', 'flight_day', 'seed line', 250000);
update pilot.invoices set status = 'sent' where id = '00000000-0000-0000-0000-00000000d1e3' and account_id = '${A}';
update pilot.invoices
  set stripe_payment_link_id = 'plink_test_3', stripe_payment_link_url = 'https://buy.stripe.com/test_3',
      stripe_payment_link_livemode = false, stripe_payment_link_amount_cents = 250000
  where id = '00000000-0000-0000-0000-00000000d1e3' and account_id = '${A}';
reset role;

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '${UA}', 'role', 'authenticated')::text, true);

do $$
begin
  begin
    update pilot.invoices set status = 'void'
      where id = '00000000-0000-0000-0000-00000000d1e3' and account_id = '${A}';
    raise exception 'CONNECT-6a FAILURE: a status-only void left the payment link in place — the constraint is gone';
  exception when check_violation then
    raise notice 'PASS (CONNECT-6a, sqlstate confirmed 23514): a status-only void of a linked invoice is still refused, which is exactly the failure the fixed voidInvoice() works around by clearing the link columns';
  end;
end $$;

do $$
begin
  begin
    update pilot.invoices set stripe_payment_link_id = null
      where id = '00000000-0000-0000-0000-00000000d1e3' and account_id = '${A}';
    raise exception 'CONNECT-6c FAILURE: the link id was cleared while the url was left behind';
  exception when check_violation then
    raise notice 'PASS (CONNECT-6c, sqlstate confirmed 23514): the payment-link id and url move together — a half-clear is refused';
  end;
end $$;

update pilot.invoices
  set status = 'void',
      stripe_payment_link_id = null,
      stripe_payment_link_url = null,
      stripe_payment_link_livemode = null,
      stripe_payment_link_amount_cents = null
  where id = '00000000-0000-0000-0000-00000000d1e3' and account_id = '${A}';

do $$
declare
  v_status text;
  v_link text;
begin
  select status, stripe_payment_link_id into v_status, v_link from pilot.invoices
    where id = '00000000-0000-0000-0000-00000000d1e3' and account_id = '${A}';
  if v_status is distinct from 'void' then
    raise exception 'CONNECT-6b FAILURE: the invoice did not reach status=void (got %)', v_status;
  end if;
  if v_link is not null then
    raise exception 'CONNECT-6b FAILURE: a payment link survived the void';
  end if;
  raise notice 'PASS (CONNECT-6b): voiding a linked invoice succeeds when the link columns are cleared in the same UPDATE — the shape voidInvoice() now uses';
end $$;
reset role;

-- ===========================================================================
-- ASSERTION 7 — AUTOMATIC PAYMENT RECORDING's database contract
-- (20260813100000_connect_auto_payments.sql).
--
-- Why every part of this needs a probe rather than a reading of the SQL:
-- the webhook writes as service_role, and BOTH triggers on this path
-- (invoice_payments_validate, invoices_protect_issued) early-return for
-- that role. So the only database-side guarantees left on the auto-record
-- path are the ones below — a column grant, a CHECK and a unique index —
-- and if any of them silently stops holding, nothing else notices.
--
--   7a  a tenant cannot claim invoice_payments.source — the provenance
--       label is not theirs to write, or "recorded automatically" means
--       nothing. (No backticks anywhere inside this SQL string: it is a
--       JS template literal, and one backtick ends it. That mistake made
--       this entire script unparseable, which is a special kind of
--       useless for a file whose job is to be the evidence.)
--   7b  a tenant cannot write invoice_payments.stripe_payment_intent_id —
--       if they could, one tenant could squat the dedupe key and block a
--       real payment (which is also why that index is allowed to be
--       global).
--   7c  the same PaymentIntent cannot be recorded twice. THE one that
--       stops a client being credited twice when Stripe redelivers an
--       event the handler crashed halfway through.
--   7d  source and the intent id move together, both ways.
--   7e  the Connect events ledger is readable by its own tenant only, and
--       writable by them in exactly one column.
--   7f  a 'refused' payment on this tenant's own invoice reaches them —
--       the database half of the invoice screen's prompt query.
-- ===========================================================================
set local role service_role;
insert into pilot.invoices (id, account_id, client_id, status)
  values ('00000000-0000-0000-0000-00000000d1e4', '${A}', '00000000-0000-0000-0000-00000000d1c1', 'draft');
insert into pilot.invoice_lines (account_id, invoice_id, line_type, description, unit_amount_cents)
  values ('${A}', '00000000-0000-0000-0000-00000000d1e4', 'flight_day', 'seed line', 450000);
update pilot.invoices set status = 'sent' where id = '00000000-0000-0000-0000-00000000d1e4' and account_id = '${A}';
reset role;

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '${UA}', 'role', 'authenticated')::text, true);

do $$
begin
  begin
    insert into pilot.invoice_payments (account_id, invoice_id, paid_on, amount_cents, source)
      values ('${A}', '00000000-0000-0000-0000-00000000d1e4', current_date, 10000, 'stripe_link');
    raise exception 'CONNECT-7a FAILURE: a tenant wrote invoice_payments.source — provenance is forgeable';
  exception when insufficient_privilege then
    raise notice 'PASS (CONNECT-7a, sqlstate confirmed 42501): a tenant cannot write invoice_payments.source, so every row they record is ''manual''';
  end;
end $$;

do $$
begin
  begin
    insert into pilot.invoice_payments (account_id, invoice_id, paid_on, amount_cents, stripe_payment_intent_id)
      values ('${A}', '00000000-0000-0000-0000-00000000d1e4', current_date, 10000, 'pi_squatted');
    raise exception 'CONNECT-7b FAILURE: a tenant wrote invoice_payments.stripe_payment_intent_id — the dedupe key is squattable';
  exception when insufficient_privilege then
    raise notice 'PASS (CONNECT-7b, sqlstate confirmed 42501): a tenant cannot write invoice_payments.stripe_payment_intent_id';
  end;
end $$;
reset role;

set local role service_role;
insert into pilot.invoice_payments
  (account_id, invoice_id, paid_on, amount_cents, method, source, stripe_payment_intent_id)
  values ('${A}', '00000000-0000-0000-0000-00000000d1e4', current_date, 450000, 'card', 'stripe_link', 'pi_connect_verify');

do $$
begin
  begin
    insert into pilot.invoice_payments
      (account_id, invoice_id, paid_on, amount_cents, method, source, stripe_payment_intent_id)
      values ('${A}', '00000000-0000-0000-0000-00000000d1e4', current_date, 450000, 'card', 'stripe_link', 'pi_connect_verify');
    raise exception 'CONNECT-7c FAILURE: the same Stripe PaymentIntent was recorded twice — a redelivered event double-credits the client';
  exception when unique_violation then
    raise notice 'PASS (CONNECT-7c, sqlstate confirmed 23505): one PaymentIntent can only ever produce one payment row, so a webhook retry cannot credit a client twice';
  end;
end $$;

do $$
begin
  begin
    insert into pilot.invoice_payments (account_id, invoice_id, paid_on, amount_cents, source)
      values ('${A}', '00000000-0000-0000-0000-00000000d1e4', current_date, 10000, 'stripe_link');
    raise exception 'CONNECT-7d FAILURE: a stripe_link payment was recorded with no PaymentIntent — it would be re-recorded on the next retry';
  exception when check_violation then
    raise notice 'PASS (CONNECT-7d, sqlstate confirmed 23514): source=stripe_link requires a payment-intent id';
  end;
end $$;

do $$
begin
  begin
    insert into pilot.invoice_payments (account_id, invoice_id, paid_on, amount_cents, stripe_payment_intent_id)
      values ('${A}', '00000000-0000-0000-0000-00000000d1e4', current_date, 10000, 'pi_orphan');
    raise exception 'CONNECT-7d2 FAILURE: a manual payment carried a PaymentIntent, which would block the real auto-record of it';
  exception when check_violation then
    raise notice 'PASS (CONNECT-7d2, sqlstate confirmed 23514): a manual payment cannot carry a payment-intent id';
  end;
end $$;

insert into pilot.stripe_connect_events
  (id, connected_account_id, type, stripe_created_at, object_id, payment_intent_id,
   livemode, account_id, invoice_id, outcome, detail, processed_at)
  values ('evt_connect_verify', 'acct_connect_verify', 'checkout.session.completed', now(),
          'cs_connect_verify', 'pi_connect_verify', false, '${A}',
          '00000000-0000-0000-0000-00000000d1e4', 'needs_review', 'looks already recorded', now());
reset role;

-- Tenant B must not be able to see it at all.
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '${UB}', 'role', 'authenticated')::text, true);
do $$
declare
  n integer;
begin
  select count(*) into n from pilot.stripe_connect_events;
  if n <> 0 then
    raise exception 'CONNECT-7e FAILURE: tenant B can read % Connect event row(s) belonging to tenant A', n;
  end if;
  raise notice 'PASS (CONNECT-7e): the Connect events ledger is invisible to another tenant';
end $$;
reset role;

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '${UA}', 'role', 'authenticated')::text, true);
do $$
begin
  begin
    update pilot.stripe_connect_events set outcome = 'recorded' where id = 'evt_connect_verify';
    raise exception 'CONNECT-7e FAILURE: a tenant rewrote what Stripe sent';
  exception when insufficient_privilege then
    raise notice 'PASS (CONNECT-7e, sqlstate confirmed 42501): a tenant cannot rewrite a Connect event''s outcome';
  end;
end $$;

do $$
declare
  n integer;
begin
  update pilot.stripe_connect_events set reviewed_at = now()
    where id = 'evt_connect_verify' and connected_account_id = 'acct_connect_verify'
      and account_id = '${A}';
  get diagnostics n = row_count;
  if n <> 1 then
    raise exception 'CONNECT-7e FAILURE: the pilot could not dismiss their own review prompt (% rows)', n;
  end if;
  raise notice 'PASS (CONNECT-7e): a pilot can dismiss their own review prompt, and that is the only column they may write';
end $$;
reset role;

-- 7f  a 'refused' row tied to one of this tenant's invoices is READABLE by
--     them, and dismissible on the same terms as a 'needs_review' one.
--
--     This is the database half of the invoice screen's query, which reads
--     outcome in ('needs_review','refused','payment_pending','payment_failed')
--     as of 20260813120000. The sentence a refusal carries
--     is often the most urgent one this handler ever writes — "the client
--     paid $4,500 through a link that should have been deactivated, refund
--     them" — and it went for a while to the events ledger and a platform
--     log only, with no reader anywhere in the product. If a future policy
--     ever narrows SELECT by outcome, that sentence loses its audience
--     again and this assertion is what says so.
set local role service_role;
insert into pilot.stripe_connect_events
  (id, connected_account_id, type, stripe_created_at, object_id, payment_intent_id,
   livemode, account_id, invoice_id, outcome, detail, processed_at)
  values ('evt_connect_verify_refused', 'acct_connect_verify', 'checkout.session.completed', now(),
          'cs_connect_verify_2', 'pi_connect_verify_2', false, '${A}',
          '00000000-0000-0000-0000-00000000d1e4', 'refused',
          'invoice is void — the client paid a link that should have been deactivated', now());
reset role;

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '${UA}', 'role', 'authenticated')::text, true);
do $$
declare
  n integer;
begin
  -- The invoice screen's query, verbatim. The needs_review row above was
  -- dismissed a moment ago, so this must find exactly the refused one.
  select count(*) into n from pilot.stripe_connect_events
    where invoice_id = '00000000-0000-0000-0000-00000000d1e4'
      and outcome in ('needs_review', 'refused', 'payment_pending', 'payment_failed')
      and reviewed_at is null;
  if n <> 1 then
    raise exception 'CONNECT-7f FAILURE: the invoice screen''s query returns % unresolved prompt(s) — a refused payment is not reaching the pilot', n;
  end if;
  update pilot.stripe_connect_events set reviewed_at = now()
    where id = 'evt_connect_verify_refused' and connected_account_id = 'acct_connect_verify'
      and account_id = '${A}';
  get diagnostics n = row_count;
  if n <> 1 then
    raise exception 'CONNECT-7f FAILURE: the pilot could not dismiss a refused-payment prompt (% rows)', n;
  end if;
  raise notice 'PASS (CONNECT-7f): a refused payment on this tenant''s invoice is readable by them and dismissible, exactly like a needs_review one';
end $$;
reset role;

-- 7g  the two ASYNC outcomes (20260813120000) are accepted by the CHECK,
--     reach the pilot through the same query, and are dismissible.
--
--     WHY THIS IS A REAL-POSTGRES ASSERTION AND NOT A UNIT TEST. The
--     vocabulary lives in a CHECK constraint, and that migration DROPS the
--     original inline check by looking it up in pg_constraint rather than
--     by its generated name. If that lookup ever misses, the ADD still
--     succeeds and the table keeps TWO checks — the older one refusing
--     exactly these two values — and the webhook then 500s on every
--     pending ACH delivery while Stripe retries for three days. Nothing in
--     the TypeScript can see that; this insert can.
set local role service_role;
insert into pilot.stripe_connect_events
  (id, connected_account_id, type, stripe_created_at, object_id, payment_intent_id,
   livemode, account_id, invoice_id, outcome, detail, processed_at)
  values
    ('evt_connect_verify_pending', 'acct_connect_verify', 'checkout.session.completed', now(),
     'cs_connect_verify_3', 'pi_connect_verify_3', false, '${A}',
     '00000000-0000-0000-0000-00000000d1e4', 'payment_pending',
     'bank payment (ACH) initiated — not paid yet', now()),
    ('evt_connect_verify_failed', 'acct_connect_verify', 'checkout.session.async_payment_failed', now(),
     'cs_connect_verify_4', 'pi_connect_verify_4', false, '${A}',
     '00000000-0000-0000-0000-00000000d1e4', 'payment_failed',
     'the bank payment failed — generate a new link', now());

do $$
begin
  begin
    insert into pilot.stripe_connect_events
      (id, connected_account_id, type, stripe_created_at, livemode, outcome)
      values ('evt_connect_verify_bogus', 'acct_connect_verify', 'checkout.session.completed',
              now(), false, 'settled_probably');
    raise exception 'CONNECT-7g FAILURE: the outcome vocabulary accepts anything at all';
  exception when check_violation then
    raise notice 'PASS (CONNECT-7g, sqlstate confirmed 23514): the outcome CHECK still refuses a value outside the list';
  end;
end $$;
reset role;

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '${UA}', 'role', 'authenticated')::text, true);
do $$
declare
  n integer;
begin
  -- Both async rows must reach the invoice screen. A pending five-figure
  -- debit that nobody can see is how a pilot chases a client who has
  -- already paid, or hand-records money the settlement event then records
  -- again.
  select count(*) into n from pilot.stripe_connect_events
    where invoice_id = '00000000-0000-0000-0000-00000000d1e4'
      and outcome in ('needs_review', 'refused', 'payment_pending', 'payment_failed')
      and reviewed_at is null;
  if n <> 2 then
    raise exception 'CONNECT-7g FAILURE: the invoice screen sees % of the 2 async prompts', n;
  end if;
  -- reviewed_at is still the only column they may write, and it is what
  -- the webhook itself stamps to supersede a pending notice once the
  -- payment settles or fails.
  update pilot.stripe_connect_events set reviewed_at = now()
    where id in ('evt_connect_verify_pending', 'evt_connect_verify_failed')
      and connected_account_id = 'acct_connect_verify' and account_id = '${A}';
  get diagnostics n = row_count;
  if n <> 2 then
    raise exception 'CONNECT-7g FAILURE: the pilot could not dismiss the async prompts (% rows)', n;
  end if;
  raise notice 'PASS (CONNECT-7g): a pending and a failed bank payment both reach the pilot and are dismissible';
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

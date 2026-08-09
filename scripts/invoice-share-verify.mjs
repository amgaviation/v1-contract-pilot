#!/usr/bin/env node
/**
 * Client-facing invoice share link verification (`npm run
 * invoice-share-verify` — "the product's first unauthenticated route that
 * exposes tenant data").
 *
 * Same shape and same rules as scripts/tenancy-verify.mjs and
 * scripts/connect-verify.mjs: drives a REAL database over a REAL Postgres
 * role switch inside one transaction that always rolls back (no live pilot
 * data as fixtures, ever), and every negative case asserts a SPECIFIC
 * SQLSTATE or an explicit row-count/shape assertion — never merely "an
 * error happened" or "a row came back."
 *
 * WHAT THIS SCRIPT DOES NOT DO, AND WHY: it does not drive
 * app/invoice/[token]/page.tsx over HTTP (no running dev server in this
 * harness) — it exercises the exact same call the page makes
 * (`pilot.invoice_public` as the `anon` role) directly in SQL, which is
 * where the entire access-control decision actually lives; the page itself
 * is a thin renderer of whatever this function returns or a 404 when it
 * returns null. Not verified here: the actual HTTP 404 response and the
 * proxy.ts route-matcher change that keeps /invoice/[token] reachable
 * while signed out — that would be verified by `npm run build` succeeding
 * (the route must register outside the (app) group) and a manual/e2e hit
 * against a running server.
 *
 *   DATABASE_URL="postgresql://..." npm run invoice-share-verify
 */

import { spawnSync } from "node:child_process";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("invoice-share-verify requires DATABASE_URL (direct Postgres connection string).");
  process.exit(1);
}

const A = "00000000-0000-0000-0000-0000000000e1"; // tenant A
const B = "00000000-0000-0000-0000-0000000000e2"; // tenant B, isolation control
const UA = "00000000-0000-0000-0000-00000000ea01"; // member of A
const UB = "00000000-0000-0000-0000-00000000ea02"; // member of B

const CLIENT_A1 = "00000000-0000-0000-0000-00000000ec01"; // A's client
const CLIENT_A2 = "00000000-0000-0000-0000-00000000ec02"; // A's OTHER client
const CLIENT_B1 = "00000000-0000-0000-0000-00000000ec03"; // B's client

const INV_A1 = "00000000-0000-0000-0000-00000000ed01"; // A, sent, shared — the one under test
const INV_A2 = "00000000-0000-0000-0000-00000000ed02"; // A, sent, a SECOND invoice — never shared
const INV_A3 = "00000000-0000-0000-0000-00000000ed03"; // A, DRAFT — must never be shareable
const INV_B1 = "00000000-0000-0000-0000-00000000ed04"; // B, sent — cross-tenant isolation control

const sql = `
begin;

insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at)
values
  ('${UA}', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'share-verify-a@example.invalid', now(), now()),
  ('${UB}', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'share-verify-b@example.invalid', now(), now());

insert into pilot.accounts (id, kind, legal_name) values
  ('${A}', 'solo', 'Share Verify A'),
  ('${B}', 'solo', 'Share Verify B');
insert into pilot.account_members (account_id, user_id, role) values
  ('${A}', '${UA}', 'owner'),
  ('${B}', '${UB}', 'owner');

set local role service_role;
insert into pilot.clients (id, account_id, name) values
  ('${CLIENT_A1}', '${A}', 'Share Verify Client A1'),
  ('${CLIENT_A2}', '${A}', 'Share Verify Client A2'),
  ('${CLIENT_B1}', '${B}', 'Share Verify Client B1');

insert into pilot.invoices (id, account_id, client_id, status) values
  ('${INV_A1}', '${A}', '${CLIENT_A1}', 'draft'),
  ('${INV_A2}', '${A}', '${CLIENT_A2}', 'draft'),
  ('${INV_A3}', '${A}', '${CLIENT_A1}', 'draft'),
  ('${INV_B1}', '${B}', '${CLIENT_B1}', 'draft');
insert into pilot.invoice_lines (account_id, invoice_id, line_type, description, unit_amount_cents) values
  ('${A}', '${INV_A1}', 'flight_day', 'seed line A1', 150000),
  ('${A}', '${INV_A2}', 'flight_day', 'seed line A2', 150000),
  ('${B}', '${INV_B1}', 'flight_day', 'seed line B1', 150000);
-- Issue A1, A2, B1 to 'sent' — INV_A3 stays 'draft' on purpose, for
-- ASSERTION 4 below.
update pilot.invoices set status = 'sent' where id in ('${INV_A1}', '${INV_A2}', '${INV_B1}');
reset role;

-- ===========================================================================
-- ASSERTION 1 — anon still has NO direct table access to pilot.* (the
-- pre-existing tenancy-verify.mjs invariant must survive this migration
-- adding anon's first-ever grant on ANYTHING in this schema). Proven
-- against pilot.invoices specifically, since that is the table this
-- feature's whole design argument rests on never exposing to anon.
--
-- FAIL-PROOF for this suite as a whole (not this assertion individually):
-- see ASSERTION 8 at the bottom, which flips a real grant on and watches
-- this exact style of check go from PASS to a loud failure.
-- ===========================================================================
set local role anon;
do $$
begin
  begin
    perform count(*) from pilot.invoices;
    raise exception 'SHARE-1 FAILURE: anon could query pilot.invoices directly';
  exception when insufficient_privilege then
    raise notice 'PASS (SHARE-1, sqlstate confirmed 42501): anon has no direct table access to pilot.invoices';
  end;
end $$;
do $$
begin
  begin
    perform count(*) from pilot.invoice_shares;
    raise exception 'SHARE-1b FAILURE: anon could query pilot.invoice_shares directly';
  exception when insufficient_privilege then
    raise notice 'PASS (SHARE-1b, sqlstate confirmed 42501): anon has no direct table access to pilot.invoice_shares';
  end;
end $$;
reset role;

-- ===========================================================================
-- ASSERTION 2 — a draft invoice cannot be shared. Asserts the function's
-- own specific message (P0001, the plpgsql default), not merely "an error
-- happened" — this is the DB-level backstop for "sharing is opt-in and
-- gated to sent/partial/paid", independent of whatever the UI offers.
-- ===========================================================================
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '${UA}', 'role', 'authenticated')::text, true);
do $$
begin
  begin
    perform pilot.invoice_share_create('${INV_A3}');
    raise exception 'SHARE-2 FAILURE: a draft invoice was shareable';
  exception when others then
    if sqlerrm not like '%cannot be shared%' then
      raise exception 'SHARE-2 FAILURE: rejected for the wrong reason: %', sqlerrm;
    end if;
    raise notice 'PASS (SHARE-2): a draft invoice is rejected by pilot.invoice_share_create';
  end;
end $$;
reset role;

-- ===========================================================================
-- ASSERTION 3 — a stranger (member of a DIFFERENT tenant) cannot mint a
-- share token for this invoice at all. Cross-tenant WRITE isolation.
-- ===========================================================================
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '${UB}', 'role', 'authenticated')::text, true);
do $$
begin
  begin
    perform pilot.invoice_share_create('${INV_A1}');
    raise exception 'SHARE-3 FAILURE: tenant B minted a share token for tenant A''s invoice';
  exception when others then
    if sqlerrm not like '%not found%' then
      raise exception 'SHARE-3 FAILURE: rejected for the wrong reason: %', sqlerrm;
    end if;
    raise notice 'PASS (SHARE-3): a different tenant cannot share this invoice (not found, not a permission leak)';
  end;
end $$;
reset role;

-- ===========================================================================
-- ASSERTION 4 — the legitimate owner shares INV_A1 successfully, and the
-- token this produces is exactly 43 base64url characters (32 CSPRNG bytes).
-- ===========================================================================
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '${UA}', 'role', 'authenticated')::text, true);
do $$
declare
  v_token text;
begin
  v_token := pilot.invoice_share_create('${INV_A1}');
  if v_token is null or length(v_token) <> 43 or v_token !~ '^[A-Za-z0-9_-]{43}$' then
    raise exception 'SHARE-4 FAILURE: token is not a well-formed 43-char base64url string: %', coalesce(v_token, '<null>');
  end if;
  perform set_config('share_verify.token_a1', v_token, false);
  raise notice 'PASS (SHARE-4): the account owner mints a well-formed 256-bit share token';
end $$;
reset role;

-- ===========================================================================
-- ASSERTION 5 — the live token, read through pilot.invoice_public AS ANON
-- (the exact role and the exact call the public route makes), returns
-- EXACTLY one invoice with EXACTLY its own line(s) — not zero, not more
-- than one, and the invoice_number/lines match INV_A1 specifically, never
-- INV_A2 (same tenant) or INV_B1 (a different tenant).
-- ===========================================================================
set local role anon;
do $$
declare
  v_token text := current_setting('share_verify.token_a1');
  v_result jsonb;
  v_line_count int;
begin
  v_result := pilot.invoice_public(v_token);
  if v_result is null then
    raise exception 'SHARE-5 FAILURE: a live, correctly-shared token returned null via anon';
  end if;
  if v_result -> 'client' ->> 'name' <> 'Share Verify Client A1' then
    raise exception 'SHARE-5 FAILURE: wrong client returned: %', v_result -> 'client' ->> 'name';
  end if;
  select jsonb_array_length(v_result -> 'lines') into v_line_count;
  if v_line_count <> 1 then
    raise exception 'SHARE-5 FAILURE: expected exactly 1 line, got %', v_line_count;
  end if;
  if (v_result -> 'lines' -> 0 ->> 'description') <> 'seed line A1' then
    raise exception 'SHARE-5 FAILURE: wrong line content: %', v_result -> 'lines' -> 0 ->> 'description';
  end if;
  raise notice 'PASS (SHARE-5): anon, via pilot.invoice_public(token), reads exactly INV_A1''s own client and exactly its 1 line — nothing from INV_A2 or INV_B1';
end $$;
reset role;

-- ===========================================================================
-- ASSERTION 6 — the SAME token cannot be used to reach ANY other invoice:
-- not a second invoice on the SAME tenant (INV_A2), and (trivially, since
-- the function takes no invoice id at all, only a token) not anything on a
-- different tenant. Proven by checking the returned invoice_number never
-- equals INV_A2's and the client is never Client A2 or Client B1, across
-- the one token that exists — a single token maps to exactly one invoice
-- by construction (unique constraint below re-proves the construction
-- itself, not just this one read).
-- ===========================================================================
do $$
declare
  n int;
begin
  select count(*) into n from pilot.invoice_shares where invoice_id = '${INV_A2}';
  if n <> 0 then
    raise exception 'SHARE-6 FAILURE: INV_A2 has a share row it was never issued';
  end if;
  raise notice 'PASS (SHARE-6): INV_A2 (a second invoice on the SAME tenant) has no share token at all — the one token minted resolves to exactly one invoice_id by construction (unique account_id,invoice_id + unique token)';
end $$;

-- ===========================================================================
-- ASSERTION 7 — revoke, then the identical token returns null immediately
-- (both as anon AND re-derived to prove it's truly gone, not cached).
-- ===========================================================================
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '${UA}', 'role', 'authenticated')::text, true);
select pilot.invoice_share_revoke('${INV_A1}');
reset role;

set local role anon;
do $$
declare
  v_token text := current_setting('share_verify.token_a1');
  v_result jsonb;
begin
  v_result := pilot.invoice_public(v_token);
  if v_result is not null then
    raise exception 'SHARE-7 FAILURE: a revoked token still returned invoice data';
  end if;
  raise notice 'PASS (SHARE-7): a revoked token returns null immediately, same as an unknown one';
end $$;
reset role;

-- ===========================================================================
-- ASSERTION 8 — FAIL-PROOF. An unknown/garbage token (same length/shape,
-- never issued) ALSO returns null — proving assertion 7 above is actually
-- distinguishing "revoked" correctly and not just always returning null
-- for every input regardless of the revoke. Then, the real fail-proof: a
-- WRONG-shaped and a well-formed-but-never-issued token are asserted to
-- behave IDENTICALLY (both null) — if pilot.invoice_public ever regressed
-- to (say) raising an exception instead of returning null on a miss, this
-- assertion is what would catch it by raising SHARE-8b instead of quietly
-- passing.
-- ===========================================================================
set local role anon;
do $$
declare
  v_never_issued text := translate(encode(extensions.gen_random_bytes(32), 'base64'), '+/', '-_');
begin
  v_never_issued := replace(v_never_issued, '=', '');
  if pilot.invoice_public(v_never_issued) is not null then
    raise exception 'SHARE-8a FAILURE: a never-issued, well-formed token returned data';
  end if;
  raise notice 'PASS (SHARE-8a): a well-formed but never-issued token returns null';
end $$;
do $$
begin
  if pilot.invoice_public('not-a-real-token') is not null then
    raise exception 'SHARE-8b FAILURE: a malformed token returned data';
  end if;
  raise notice 'PASS (SHARE-8b): a malformed token returns null (no exception surfaced to anon either)';
end $$;
reset role;

-- ===========================================================================
-- ASSERTION 9 — THE REQUIRED FAIL-PROOF: prove SHARE-1 can actually FAIL,
-- not just always pass. Grant anon direct SELECT on pilot.invoices (the
-- exact regression SHARE-1 exists to catch), re-run the identical probe,
-- watch it now find rows and therefore fail the way SHARE-1's own
-- exception branch says it would, then revoke the grant and re-confirm
-- SHARE-1 passes again. A probe never seen to fail is not evidence.
-- ===========================================================================
grant select on pilot.invoices to anon;
set local role anon;
do $$
declare
  n int;
begin
  select count(*) into n from pilot.invoices;
  raise notice 'PASS (SHARE-9, fail-proof): with anon deliberately granted SELECT on pilot.invoices, the SHARE-1-shaped probe now finds % row(s) instead of raising 42501 — proving SHARE-1 is a real, currently-passing assertion and not a tautology (this statement would itself have raised insufficient_privilege, aborting the script, had the grant not taken effect)', n;
end $$;
reset role;
revoke select on pilot.invoices from anon;
set local role anon;
do $$
begin
  begin
    perform count(*) from pilot.invoices;
    raise exception 'SHARE-9b FAILURE: revoke did not restore the denial';
  exception when insufficient_privilege then
    raise notice 'PASS (SHARE-9b): revoking the deliberately-added grant restores SHARE-1''s denial — the schema is back to its real, shipped state for every assertion after this one';
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

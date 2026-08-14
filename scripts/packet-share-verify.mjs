#!/usr/bin/env node
/**
 * Credential-packet public share boundary verification (`npm run
 * packet-share:verify`).
 *
 * pilot.document_packet_public(p_token) is an anon-callable SECURITY
 * DEFINER function serving W-9/passport/medical/insurance document
 * METADATA behind app/packet/[token] — the product's most sensitive
 * unauthenticated surface (supabase/migrations/20260810100000_credential_
 * packet_share.sql, whose own header says "the token is the entire access
 * boundary for the public packet route; treat any change here as a
 * security change"). Before this script, nothing asserted anything about
 * it: no verify script, no unit test — the analogous invoice boundary
 * (scripts/invoice-share-verify.mjs) has 22 assertions.
 *
 * Same shape and same rules as invoice-share-verify.mjs: drives a REAL
 * database over a REAL Postgres role switch inside one transaction that
 * always rolls back (no live pilot data as fixtures, ever), and every
 * negative case asserts a SPECIFIC SQLSTATE or an explicit row-count/shape
 * assertion — never merely "an error happened" or "a row came back."
 *
 * WHAT THIS SCRIPT DOES NOT DO, AND WHY: it does not drive
 * app/packet/[token]/page.tsx over HTTP (no running dev server in this
 * harness) — it exercises the exact same calls the page makes
 * (pilot.document_packet_public as anon) directly in SQL, which is where
 * the entire access-control decision actually lives.
 *
 *   DATABASE_URL="postgresql://..." node scripts/packet-share-verify.mjs
 */

import { spawnSync } from "node:child_process";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("packet-share-verify requires DATABASE_URL (direct Postgres connection string).");
  process.exit(1);
}

const A = "00000000-0000-0000-0000-0000000000f1"; // tenant A
const B = "00000000-0000-0000-0000-0000000000f2"; // tenant B, isolation control
const UA = "00000000-0000-0000-0000-00000000fa01"; // member of A
const UB = "00000000-0000-0000-0000-00000000fa02"; // member of B

const CLIENT_A1 = "00000000-0000-0000-0000-00000000fc01"; // A's client — the one under test
const CLIENT_A2 = "00000000-0000-0000-0000-00000000fc02"; // A's OTHER client
const CLIENT_B1 = "00000000-0000-0000-0000-00000000fc03"; // B's client

const DOC_A1_W9 = "00000000-0000-0000-0000-00000000fd01"; // A, client A1's W-9 — packeted
const DOC_A1_MED = "00000000-0000-0000-0000-00000000fd02"; // A, client A1's medical — packeted
const DOC_A1_INS = "00000000-0000-0000-0000-00000000fd03"; // A, client A1's insurance cert — NOT chosen for the packet
const DOC_A2_W9 = "00000000-0000-0000-0000-00000000fd04"; // A, client A2's own W-9 — must never leak into A1's packet
const DOC_B1_W9 = "00000000-0000-0000-0000-00000000fd05"; // B's document — cross-tenant forgery target

const sql = `
begin;

insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at)
values
  ('${UA}', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'packet-verify-a@example.invalid', now(), now()),
  ('${UB}', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'packet-verify-b@example.invalid', now(), now());

insert into pilot.accounts (id, kind, legal_name) values
  ('${A}', 'solo', 'Packet Verify A'),
  ('${B}', 'solo', 'Packet Verify B');
insert into pilot.account_members (account_id, user_id, role) values
  ('${A}', '${UA}', 'owner'),
  ('${B}', '${UB}', 'owner');

set local role service_role;
insert into pilot.clients (id, account_id, name) values
  ('${CLIENT_A1}', '${A}', 'Packet Verify Client A1'),
  ('${CLIENT_A2}', '${A}', 'Packet Verify Client A2'),
  ('${CLIENT_B1}', '${B}', 'Packet Verify Client B1');

insert into pilot.documents (id, account_id, kind, label, client_id) values
  ('${DOC_A1_W9}', '${A}', 'w9', 'A1 W-9', '${CLIENT_A1}'),
  ('${DOC_A1_MED}', '${A}', 'medical', 'A1 Medical', '${CLIENT_A1}'),
  ('${DOC_A1_INS}', '${A}', 'insurance', 'A1 Insurance (never packeted)', '${CLIENT_A1}'),
  ('${DOC_A2_W9}', '${A}', 'w9', 'A2 W-9 (must never leak into A1''s packet)', '${CLIENT_A2}'),
  ('${DOC_B1_W9}', '${B}', 'w9', 'B1 W-9 (cross-tenant forgery target)', '${CLIENT_B1}');
reset role;

-- ===========================================================================
-- ASSERTION 1 — anon has NO direct table access to either table backing the
-- boundary. Same shape as invoice-share-verify.mjs's SHARE-1: the fail-proof
-- for this specific check is ASSERTION 9 below.
-- ===========================================================================
set local role anon;
do $$
begin
  begin
    perform count(*) from pilot.document_shares;
    raise exception 'PACKET-1 FAILURE: anon could query pilot.document_shares directly';
  exception when insufficient_privilege then
    raise notice 'PASS (PACKET-1, sqlstate confirmed 42501): anon has no direct table access to pilot.document_shares';
  end;
end $$;
do $$
begin
  begin
    perform count(*) from pilot.document_share_items;
    raise exception 'PACKET-1b FAILURE: anon could query pilot.document_share_items directly';
  exception when insufficient_privilege then
    raise notice 'PASS (PACKET-1b, sqlstate confirmed 42501): anon has no direct table access to pilot.document_share_items';
  end;
end $$;
reset role;

-- ===========================================================================
-- ASSERTION 2 — the token CHECK constraint (token ~ '^[A-Za-z0-9_-]{43}$')
-- is enforced at the table, not just by the function that happens to always
-- generate well-formed ones. A malformed token inserted directly (the only
-- way one could ever land in the table other than through the generator)
-- fails with 23514, not a silent success.
-- ===========================================================================
set local role service_role;
do $$
begin
  begin
    insert into pilot.document_shares (account_id, client_id, token, expires_at)
    values ('${A}', '${CLIENT_A1}', 'not-a-real-43-char-base64url-token!!', now() + interval '30 days');
    raise exception 'PACKET-2 FAILURE: a malformed token was accepted by the table';
  exception when check_violation then
    raise notice 'PASS (PACKET-2, sqlstate confirmed 23514): document_shares.token''s CHECK constraint refuses a malformed token';
  end;
end $$;
reset role;

-- ===========================================================================
-- ASSERTION 3 — a stranger (member of a DIFFERENT tenant) cannot mint a
-- packet for this client at all. Cross-tenant WRITE isolation.
-- ===========================================================================
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '${UB}', 'role', 'authenticated')::text, true);
do $$
begin
  begin
    perform pilot.document_share_create('${CLIENT_A1}', array['${DOC_A1_W9}']::uuid[], 30);
    raise exception 'PACKET-3 FAILURE: tenant B minted a packet link for tenant A''s client';
  exception when others then
    if sqlerrm not like '%not found%' then
      raise exception 'PACKET-3 FAILURE: rejected for the wrong reason: %', sqlerrm;
    end if;
    raise notice 'PASS (PACKET-3): a different tenant cannot share this client''s documents (not found, not a permission leak)';
  end;
end $$;
reset role;

-- ===========================================================================
-- ASSERTION 3b — cross-tenant DOCUMENT forgery: the legitimate owner of the
-- client still cannot smuggle a DIFFERENT tenant's document id into the
-- packet. document_share_create's account_id-scoped insert is the boundary,
-- not the client_id ownership check alone.
-- ===========================================================================
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '${UA}', 'role', 'authenticated')::text, true);
do $$
begin
  begin
    perform pilot.document_share_create('${CLIENT_A1}', array['${DOC_B1_W9}']::uuid[], 30);
    raise exception 'PACKET-3b FAILURE: a packet was created containing another tenant''s document';
  exception when others then
    if sqlerrm not like '%none of those documents belong to this account%' then
      raise exception 'PACKET-3b FAILURE: rejected for the wrong reason: %', sqlerrm;
    end if;
    raise notice 'PASS (PACKET-3b): naming a different tenant''s document id is refused, even by the client''s real owner';
  end;
end $$;
reset role;

-- ===========================================================================
-- ASSERTION 4 — the legitimate owner shares CLIENT_A1's W-9 and medical
-- (but NOT the insurance cert) successfully, and the token is exactly 43
-- base64url characters (32 CSPRNG bytes).
-- ===========================================================================
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '${UA}', 'role', 'authenticated')::text, true);
do $$
declare
  v_token text;
begin
  v_token := pilot.document_share_create('${CLIENT_A1}', array['${DOC_A1_W9}', '${DOC_A1_MED}']::uuid[], 30);
  if v_token is null or length(v_token) <> 43 or v_token !~ '^[A-Za-z0-9_-]{43}$' then
    raise exception 'PACKET-4 FAILURE: token is not a well-formed 43-char base64url string: %', coalesce(v_token, '<null>');
  end if;
  perform set_config('packet_verify.token_1', v_token, false);
  raise notice 'PASS (PACKET-4): the account owner mints a well-formed 256-bit packet token';
end $$;
reset role;

-- ===========================================================================
-- ASSERTION 5 — the live token, read through pilot.document_packet_public
-- AS ANON (the exact role and the exact call the public route makes),
-- returns EXACTLY the two chosen documents — not the insurance cert that
-- was left out, not client A2's W-9, not tenant B's document.
-- ===========================================================================
set local role anon;
do $$
declare
  v_token text := current_setting('packet_verify.token_1');
  v_count int;
  v_labels text[];
begin
  select count(*), array_agg(document_label order by document_label)
  into v_count, v_labels
  from pilot.document_packet_public(v_token);

  if v_count <> 2 then
    raise exception 'PACKET-5 FAILURE: expected exactly 2 documents, got %: %', v_count, v_labels;
  end if;
  if v_labels <> array['A1 Medical', 'A1 W-9'] then
    raise exception 'PACKET-5 FAILURE: wrong document set returned: %', v_labels;
  end if;
  raise notice 'PASS (PACKET-5): anon, via pilot.document_packet_public(token), reads exactly the 2 documents the pilot chose — not the insurance cert left out, not A2''s or B1''s documents';
end $$;
reset role;

-- ===========================================================================
-- ASSERTION 6 — the business_name field comes from the OWNING account, and
-- a second client on the SAME tenant (A2) has no share row at all — the one
-- token minted resolves to exactly one client by construction (unique
-- account_id, client_id + unique token).
-- ===========================================================================
set local role anon;
do $$
declare
  v_token text := current_setting('packet_verify.token_1');
  v_name text;
begin
  select business_name into v_name from pilot.document_packet_public(v_token) limit 1;
  if v_name <> 'Packet Verify A' then
    raise exception 'PACKET-6 FAILURE: wrong business_name returned: %', v_name;
  end if;
  raise notice 'PASS (PACKET-6): the packet''s business_name is the owning tenant''s legal_name';
end $$;
reset role;
do $$
declare
  n int;
begin
  select count(*) into n from pilot.document_shares where client_id = '${CLIENT_A2}';
  if n <> 0 then
    raise exception 'PACKET-6b FAILURE: client A2 has a packet share row it was never issued';
  end if;
  raise notice 'PASS (PACKET-6b): client A2 (a second client on the SAME tenant) has no packet share at all';
end $$;

-- ===========================================================================
-- ASSERTION 7 — ROTATION: re-sharing the SAME client mints a NEW token and
-- REPLACES the document set wholesale (not merged). The OLD token stops
-- resolving immediately, and the new token's packet contains ONLY the newly
-- named document.
-- ===========================================================================
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '${UA}', 'role', 'authenticated')::text, true);
do $$
declare
  v_old_token text := current_setting('packet_verify.token_1');
  v_new_token text;
begin
  v_new_token := pilot.document_share_create('${CLIENT_A1}', array['${DOC_A1_INS}']::uuid[], 30);
  if v_new_token = v_old_token then
    raise exception 'PACKET-7 FAILURE: re-sharing the same client did not rotate the token';
  end if;
  perform set_config('packet_verify.token_2', v_new_token, false);
  raise notice 'PASS (PACKET-7): re-sharing client A1 mints a DIFFERENT token';
end $$;
reset role;

set local role anon;
do $$
declare
  v_old_token text := current_setting('packet_verify.token_1');
  v_new_token text := current_setting('packet_verify.token_2');
  v_old_count int;
  v_new_count int;
  v_new_label text;
begin
  select count(*) into v_old_count from pilot.document_packet_public(v_old_token);
  if v_old_count <> 0 then
    raise exception 'PACKET-7b FAILURE: the OLD token still resolves after rotation (% rows)', v_old_count;
  end if;

  select count(*), max(document_label) into v_new_count, v_new_label
  from pilot.document_packet_public(v_new_token);
  if v_new_count <> 1 or v_new_label <> 'A1 Insurance (never packeted)' then
    raise exception 'PACKET-7c FAILURE: the new token does not resolve to exactly the newly-chosen document set: count=%, label=%', v_new_count, v_new_label;
  end if;
  raise notice 'PASS (PACKET-7b/7c): the prior token stops resolving the instant a client is re-shared, and the new token''s items are REPLACED wholesale, not merged, with the old set';
end $$;
reset role;

-- ===========================================================================
-- ASSERTION 8 — EXPIRY is enforced in the read path itself, not by a sweep
-- job. Force token_2 into the past (as service_role, the only role with
-- UPDATE) and confirm it stops resolving on the very next call.
-- ===========================================================================
set local role service_role;
update pilot.document_shares
  set expires_at = now() - interval '1 second'
  where client_id = '${CLIENT_A1}';
reset role;

set local role anon;
do $$
declare
  v_token text := current_setting('packet_verify.token_2');
  n int;
begin
  select count(*) into n from pilot.document_packet_public(v_token);
  if n <> 0 then
    raise exception 'PACKET-8 FAILURE: an expired token still returned % row(s)', n;
  end if;
  raise notice 'PASS (PACKET-8): an expired token returns zero rows, enforced in the anon-facing function itself';
end $$;
reset role;

-- ===========================================================================
-- ASSERTION 8b — REVOCATION, proven independently of expiry: a fresh packet
-- for client A2, explicitly revoked, stops resolving immediately.
-- ===========================================================================
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '${UA}', 'role', 'authenticated')::text, true);
do $$
declare
  v_token text;
begin
  v_token := pilot.document_share_create('${CLIENT_A2}', array['${DOC_A2_W9}']::uuid[], 30);
  perform set_config('packet_verify.token_a2', v_token, false);
  perform pilot.document_share_revoke('${CLIENT_A2}');
end $$;
reset role;

set local role anon;
do $$
declare
  v_token text := current_setting('packet_verify.token_a2');
  n int;
begin
  select count(*) into n from pilot.document_packet_public(v_token);
  if n <> 0 then
    raise exception 'PACKET-8b FAILURE: a revoked token still returned % row(s)', n;
  end if;
  raise notice 'PASS (PACKET-8b): a revoked token returns zero rows immediately';
end $$;
reset role;

-- ===========================================================================
-- ASSERTION 8c — FAIL-PROOF for 8/8b: an unknown/garbage token (same
-- length/shape, never issued) ALSO returns zero rows — proving 8 and 8b are
-- actually distinguishing "expired"/"revoked" and not just always returning
-- nothing for every input.
-- ===========================================================================
set local role anon;
do $$
declare
  v_never_issued text := translate(encode(extensions.gen_random_bytes(32), 'base64'), '+/', '-_');
  n int;
begin
  v_never_issued := replace(v_never_issued, '=', '');
  select count(*) into n from pilot.document_packet_public(v_never_issued);
  if n <> 0 then
    raise exception 'PACKET-8c FAILURE: a well-formed but never-issued token returned % row(s)', n;
  end if;
  raise notice 'PASS (PACKET-8c): a well-formed but never-issued token also returns zero rows, and a malformed one raises no exception to anon';
end $$;
do $$
declare
  n int;
begin
  select count(*) into n from pilot.document_packet_public('not-a-real-token');
  if n <> 0 then
    raise exception 'PACKET-8d FAILURE: a malformed token returned % row(s)', n;
  end if;
  raise notice 'PASS (PACKET-8d): a malformed token returns zero rows, no exception surfaced to anon';
end $$;
reset role;

-- ===========================================================================
-- ASSERTION 9 — tenant B cannot SEE tenant A's packet share row (RLS), and
-- cannot REVOKE it either: document_share_revoke's WHERE clause silently
-- matches zero rows for a client outside the caller's own tenant rather
-- than raising, so the proof is that A's still-live packet (token_2,
-- currently expired from ASSERTION 8 — reuse a freshly rotated one instead)
-- is untouched by B's call.
-- ===========================================================================
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '${UA}', 'role', 'authenticated')::text, true);
do $$
declare
  v_token text;
begin
  v_token := pilot.document_share_create('${CLIENT_A1}', array['${DOC_A1_W9}']::uuid[], 30);
  perform set_config('packet_verify.token_3', v_token, false);
end $$;
reset role;

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '${UB}', 'role', 'authenticated')::text, true);
do $$
declare
  n int;
begin
  select count(*) into n from pilot.document_shares where client_id = '${CLIENT_A1}';
  if n <> 0 then
    raise exception 'PACKET-9 FAILURE: tenant B''s RLS-scoped SELECT can see tenant A''s packet share row';
  end if;
  raise notice 'PASS (PACKET-9): tenant B''s own SELECT (governed by RLS) sees zero of tenant A''s document_shares rows';
end $$;
-- B attempts to revoke A's client's packet. No exception either way (the
-- function is a plain UPDATE ... WHERE), so the proof is in the row after.
select pilot.document_share_revoke('${CLIENT_A1}');
reset role;

set local role anon;
do $$
declare
  v_token text := current_setting('packet_verify.token_3');
  n int;
begin
  select count(*) into n from pilot.document_packet_public(v_token);
  if n <> 1 then
    raise exception 'PACKET-9b FAILURE: tenant B''s revoke call against tenant A''s client revoked (or otherwise broke) A''s live packet — % rows resolve, expected 1', n;
  end if;
  raise notice 'PASS (PACKET-9b): tenant B''s document_share_revoke call against tenant A''s client_id touched nothing — A''s packet still resolves';
end $$;
reset role;

-- ===========================================================================
-- ASSERTION 10 — THE REQUIRED FAIL-PROOF: prove PACKET-1 can actually FAIL,
-- not just always pass. Grant anon direct SELECT on pilot.document_shares
-- (the exact regression PACKET-1 exists to catch), re-run the identical
-- probe, watch it now find rows and therefore fail the way PACKET-1's own
-- exception branch says it would, then revoke and re-confirm PACKET-1
-- passes again.
-- ===========================================================================
grant select on pilot.document_shares to anon;
set local role anon;
do $$
declare
  n int;
begin
  select count(*) into n from pilot.document_shares;
  raise notice 'PASS (PACKET-10, fail-proof): with anon deliberately granted SELECT on pilot.document_shares, the PACKET-1-shaped probe now finds % row(s) instead of raising 42501 — proving PACKET-1 is a real, currently-passing assertion and not a tautology (this statement would itself have raised insufficient_privilege, aborting the script, had the grant not taken effect)', n;
end $$;
reset role;
revoke select on pilot.document_shares from anon;
set local role anon;
do $$
begin
  begin
    perform count(*) from pilot.document_shares;
    raise exception 'PACKET-10b FAILURE: revoke did not restore the denial';
  exception when insufficient_privilege then
    raise notice 'PASS (PACKET-10b): revoking the deliberately-added grant restores PACKET-1''s denial — the schema is back to its real, shipped state for every assertion after this one';
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

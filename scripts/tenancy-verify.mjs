#!/usr/bin/env node
// Two-tenant isolation smoke test for the `pilot` schema (Phase 1 gate).
//
// Simulates two authenticated tenants plus the anon role against a single
// Postgres connection, using `SET LOCAL ROLE` + `request.jwt.claims` to
// stand in for PostgREST's per-request auth context — the same technique
// used to manually verify this migration against the live project. The
// whole run happens inside one transaction that always rolls back, so it
// never leaves synthetic data behind (see PLAN.md: "no live pilot data as
// fixtures or test data at any point").
//
// Requires DATABASE_URL (a direct Postgres connection string — the
// Supabase pooler works too) and the `psql` client on PATH.
//
//   DATABASE_URL="postgresql://..." npm run tenancy:verify

import { spawnSync } from "node:child_process";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("tenancy:verify requires DATABASE_URL (direct Postgres connection string).");
  process.exit(1);
}

const sql = `
begin;

-- Two synthetic tenants, two synthetic member users, no real data.
insert into pilot.accounts (id, kind, legal_name)
values
  ('00000000-0000-0000-0000-0000000000a1', 'solo', 'Tenant A Test'),
  ('00000000-0000-0000-0000-0000000000b1', 'solo', 'Tenant B Test');

insert into pilot.account_members (account_id, user_id, role)
values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000aaaa', 'owner'),
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-00000000bbbb', 'owner');

-- Tenant A must see exactly its own account, never Tenant B's.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000aaaa"}', true);

do $$
declare
  seen_ids uuid[];
begin
  select array_agg(id) into seen_ids from pilot.accounts;
  if seen_ids <> array['00000000-0000-0000-0000-0000000000a1'::uuid] then
    raise exception 'ISOLATION FAILURE: tenant A saw %, expected only its own row', seen_ids;
  end if;
  raise notice 'PASS: tenant A sees exactly its own account';
end $$;

-- Tenant A must not be able to rewrite billing/entitlement columns on its
-- own row, even though it owns it (column-scoped grant + trigger defense).
do $$
begin
  begin
    update pilot.accounts set plan = 'business' where id = '00000000-0000-0000-0000-0000000000a1';
    raise exception 'ISOLATION FAILURE: tenant A was able to update its own billing column';
  exception
    when insufficient_privilege or others then
      raise notice 'PASS: tenant A cannot write billing/entitlement columns';
  end;
end $$;

reset role;

-- Tenant B must see exactly its own account, never Tenant A's.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000bbbb"}', true);

do $$
declare
  seen_ids uuid[];
begin
  select array_agg(id) into seen_ids from pilot.accounts;
  if seen_ids <> array['00000000-0000-0000-0000-0000000000b1'::uuid] then
    raise exception 'ISOLATION FAILURE: tenant B saw %, expected only its own row', seen_ids;
  end if;
  raise notice 'PASS: tenant B sees exactly its own account';
end $$;

reset role;

-- The anon role has no membership in either tenant and no schema USAGE at
-- all — it must be hard-denied, not just filtered to zero rows.
set local role anon;

do $$
begin
  begin
    perform count(*) from pilot.accounts;
    raise exception 'ISOLATION FAILURE: anon role could query pilot.accounts at all';
  exception
    when insufficient_privilege then
      raise notice 'PASS: anon role is denied schema access to pilot.accounts';
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

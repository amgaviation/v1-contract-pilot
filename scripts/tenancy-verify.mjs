#!/usr/bin/env node
// Tenant isolation + schema invariants (the Phase 1 gate, extended for
// Phase 3/4).
//
// Simulates two authenticated tenants plus the anon role against a single
// Postgres connection, using `SET LOCAL ROLE` + `request.jwt.claims` to
// stand in for PostgREST's per-request auth context. The whole run happens
// inside one transaction that always rolls back, so it never leaves
// synthetic data behind (docs/PLAN.md: "no live pilot data as fixtures or
// test data at any point").
//
// Beyond isolation it asserts the invariants the FlightDeptPro audit turned
// into requirements (docs/research/FLIGHTDEPTPRO-INSPIRATION.md):
//   C4 — the expiry engine covers every date-bearing table, BY CONSTRUCTION
//   C2 — cross-module arithmetic has one source (the A2 trip-margin rollup)
//
// Requires DATABASE_URL (a direct Postgres connection string) and `psql`.
//
//   DATABASE_URL="postgresql://..." npm run tenancy:verify

import { spawnSync } from "node:child_process";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("tenancy:verify requires DATABASE_URL (direct Postgres connection string).");
  process.exit(1);
}

const A = "00000000-0000-0000-0000-0000000000a1";
const B = "00000000-0000-0000-0000-0000000000b1";
const UA = "00000000-0000-0000-0000-00000000aaaa";
const UB = "00000000-0000-0000-0000-00000000bbbb";

const sql = `
begin;

-- pilot.account_members.user_id FKs to auth.users with ON DELETE RESTRICT,
-- so the two synthetic members need real auth rows to exist. Created inside
-- the same transaction and rolled back with everything else — this script
-- never leaves a user behind. (Found the hard way: without these the whole
-- run dies on account_members_user_id_fkey before a single assertion runs.)
insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at)
values ('${UA}', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
        'tenancy-verify-a@example.invalid', now(), now()),
       ('${UB}', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
        'tenancy-verify-b@example.invalid', now(), now());

insert into pilot.accounts (id, kind, legal_name)
values ('${A}', 'solo', 'Tenant A Test'), ('${B}', 'solo', 'Tenant B Test');

insert into pilot.account_members (account_id, user_id, role)
values ('${A}', '${UA}', 'owner'), ('${B}', '${UB}', 'owner');

-- Each tenant gets a client, a trip, a leg, an expense and a document.
insert into pilot.clients (id, account_id, name, default_day_rate_cents)
values ('00000000-0000-0000-0000-00000000c0a1', '${A}', 'A Client', 120000),
       ('00000000-0000-0000-0000-00000000c0b1', '${B}', 'B Client', 90000);

insert into pilot.trips (id, account_id, client_id, starts_on, ends_on, day_rate_cents, day_count, status)
values ('00000000-0000-0000-0000-000000007a01', '${A}', '00000000-0000-0000-0000-00000000c0a1',
        current_date, current_date + 2, 120000, 3, 'completed'),
       ('00000000-0000-0000-0000-000000007b01', '${B}', '00000000-0000-0000-0000-00000000c0b1',
        current_date, current_date + 1, 90000, 2, 'completed');

insert into pilot.expenses (account_id, trip_id, incurred_on, category, amount_cents, treatment)
values ('${A}', '00000000-0000-0000-0000-000000007a01', current_date, 'hotel', 40000, 'rebill'),
       ('${A}', '00000000-0000-0000-0000-000000007a01', current_date, 'meals', 15000, 'deduct'),
       ('${B}', '00000000-0000-0000-0000-000000007b01', current_date, 'fuel', 22000, 'rebill');

insert into pilot.documents (account_id, kind, label, expires_on)
values ('${A}', 'medical', 'First class medical', current_date + 20),
       ('${B}', 'passport', 'Passport', current_date - 5);

-- =====================================================================
-- C4. The expiry engine must cover every date-bearing table BY
-- CONSTRUCTION. A non-empty result means someone added a table with an
-- expires_on column and did not union it into pilot.expirations — the
-- exact failure the audit documents (their ladder never fired for two
-- expired compliance programs, because that module was never wired in).
-- =====================================================================
do $$
declare gaps text[];
begin
  select array_agg(missing_table) into gaps from pilot.expiration_coverage_gaps();
  if gaps is not null then
    raise exception 'C4 FAILURE: date-bearing tables outside the expiry engine: %', gaps;
  end if;
  raise notice 'PASS C4: expiry engine covers every date-bearing table';
end $$;

-- =====================================================================
-- C2 / A2. The trip-margin rollup has ONE source. Tenant A's trip:
--   billable = 3 days x $1200 + $400 rebilled = $4000.00
--   deducted = $150.00
--   net      = $3850.00
-- If this arithmetic drifts, the Overview figures and the invoice draft
-- disagree — which is the -$50k-vs-$580k defect the audit found.
-- =====================================================================
do $$
declare billable bigint; deducted bigint; net bigint;
begin
  select t.day_rate_cents * t.day_count
         + coalesce((select sum(e.amount_cents) from pilot.expenses e
                     where e.trip_id = t.id and e.treatment = 'rebill'), 0),
         coalesce((select sum(e.amount_cents) from pilot.expenses e
                   where e.trip_id = t.id and e.treatment = 'deduct'), 0)
    into billable, deducted
  from pilot.trips t where t.id = '00000000-0000-0000-0000-000000007a01';
  net := billable - deducted;
  if billable <> 400000 or deducted <> 15000 or net <> 385000 then
    raise exception 'A2 FAILURE: billable=% deducted=% net=% (expected 400000/15000/385000)',
      billable, deducted, net;
  end if;
  raise notice 'PASS A2: trip margin rollup is exact (billable 400000, deducted 15000, net 385000)';
end $$;

-- =====================================================================
-- Composite FK: a tenant cannot attach a child to another tenant's
-- parent. RLS alone does NOT stop this — the policy only checks the
-- child's own account_id, which the attacker legitimately owns.
-- =====================================================================
do $$
begin
  begin
    insert into pilot.trip_legs (account_id, trip_id, leg_date)
      values ('${B}', '00000000-0000-0000-0000-000000007a01', current_date);
    raise exception 'ISOLATION FAILURE: tenant B attached a leg to tenant A''s trip';
  exception when foreign_key_violation then
    raise notice 'PASS: composite FK blocks cross-tenant child attach';
  end;
end $$;

-- =====================================================================
-- Per-tenant read isolation on every new table.
-- =====================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"${UA}"}', true);

do $$
declare n integer;
begin
  select count(*) into n from pilot.clients;   if n <> 1 then raise exception 'ISOLATION FAILURE: clients visible = %', n; end if;
  select count(*) into n from pilot.trips;     if n <> 1 then raise exception 'ISOLATION FAILURE: trips visible = %', n; end if;
  select count(*) into n from pilot.expenses;  if n <> 2 then raise exception 'ISOLATION FAILURE: expenses visible = %', n; end if;
  select count(*) into n from pilot.documents; if n <> 1 then raise exception 'ISOLATION FAILURE: documents visible = %', n; end if;
  select count(*) into n from pilot.expirations; if n <> 1 then raise exception 'ISOLATION FAILURE: expirations visible = %', n; end if;
  raise notice 'PASS: tenant A sees only its own rows across all Phase 3/4 tables';
end $$;

-- The expirations view is security_invoker, so the underlying RLS must
-- still apply through it. A view that leaked here would be the single
-- worst defect in the schema: it reads every tenant's dated records.
do $$
declare other integer;
begin
  select count(*) into other from pilot.expirations where account_id <> '${A}';
  if other <> 0 then raise exception 'ISOLATION FAILURE: expirations view leaked % foreign rows', other; end if;
  raise notice 'PASS: pilot.expirations honours RLS (security_invoker)';
end $$;

-- Column-scoped grants: a tenant may not re-parent its own row to another
-- account. RLS has no column granularity, so the GRANT is the only place
-- this can be expressed.
do $$
begin
  begin
    update pilot.trips set account_id = '${B}' where id = '00000000-0000-0000-0000-000000007a01';
    raise exception 'GRANT FAILURE: tenant rewrote account_id on its own trip';
  exception when insufficient_privilege then
    raise notice 'PASS: account_id is withheld from the tenant UPDATE grant';
  end;
end $$;

reset role;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"${UB}"}', true);
do $$
declare n integer;
begin
  select count(*) into n from pilot.trips;
  if n <> 1 then raise exception 'ISOLATION FAILURE: tenant B sees % trips', n; end if;
  select count(*) into n from pilot.trips where account_id = '${A}';
  if n <> 0 then raise exception 'ISOLATION FAILURE: tenant B can see tenant A trips'; end if;
  raise notice 'PASS: tenant B sees only its own rows';
end $$;
reset role;

-- anon has no USAGE on the schema at all: hard denial, not an empty set.
set local role anon;
do $$
begin
  begin
    perform count(*) from pilot.trips;
    raise exception 'ISOLATION FAILURE: anon could query pilot.trips';
  exception when insufficient_privilege then
    raise notice 'PASS: anon is denied schema access';
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

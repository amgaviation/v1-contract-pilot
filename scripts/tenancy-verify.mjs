#!/usr/bin/env node
// Tenant isolation + schema invariants (the Phase 1 gate, extended for
// Phase 3/4, then Phase 5).
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
// Phase 5 additions (all live-Postgres-verified findings from the invoice
// migration's adversarial review):
//   - security_invoker presence on every pilot.* view, via catalog query —
//     the MEDIUM-7 finding that `create or replace view` silently drops it
//   - per-account invoice-number uniqueness (not global)
//   - forward-only invoice status transitions, and the MEDIUM-11
//     no-payment-no-paid-status guard
//   - invoice_lines reparenting off/onto an issued invoice is rejected
//     (HIGH-4), and the INSERT path is rejected on a non-draft invoice
//   - A3: an invoice line can only ever reference a 'rebill'-tagged
//     expense, and that expense's treatment becomes immutable once
//     referenced
//   - trip double-billing across two live invoices is rejected, and a
//     cross-client trip attach is rejected
//   - a catalog sweep for any column/comment matching fet/excise anywhere
//     in schema pilot returns nothing — this schema must never grow
//     federal excise tax support (see the migration's file-header note)
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
-- MEDIUM 7. Every pilot.* view must be security_invoker. A view that
-- silently reverts to the default (definer-equivalent, RLS-bypassing) on
-- some future create-or-replace-view edit is a leak with no other symptom —
-- see the migration's comment above pilot.invoice_totals.
-- =====================================================================
do $$
declare non_invoker text[];
begin
  -- SECOND-PASS REVIEW FINDING (LOW): widened from relkind='v' to also
  -- catch a materialized view, which unconditionally fails this check —
  -- a matview cannot be security_invoker at all (its data is materialized
  -- once, under the creator's privileges, and never re-checked against
  -- the querying user's RLS on refresh or read), so one appearing in
  -- schema pilot would be a total leak the old check reported as clean.
  select array_agg(c.relname || case when c.relkind = 'm'
    then ' (materialized view — cannot be security_invoker, cannot respect RLS)' else '' end)
    into non_invoker
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'pilot'
      and c.relkind in ('v', 'm')
      and (
        c.relkind = 'm'
        or not coalesce(
          (select option_value::boolean
           from pg_options_to_table(c.reloptions)
           where option_name = 'security_invoker'),
          false
        )
      );
  if non_invoker is not null then
    raise exception 'MEDIUM-7 FAILURE: pilot views without security_invoker (or a materialized view, which can never have it): %', non_invoker;
  end if;
  raise notice 'PASS: every pilot.* view is security_invoker, and no materialized view exists in schema pilot';
end $$;

-- =====================================================================
-- SECURITY REVIEW FINDING (F1). Every pilot.* TABLE must have RLS enabled.
--
-- This is not belt-and-braces, it is the load-bearing check. The Phase 1
-- migration sets
--     alter default privileges in schema pilot grant select on tables to authenticated
-- so EVERY table created in this schema from now on is readable by any
-- authenticated session the instant it exists. RLS is the only thing
-- standing between a new table and a cross-tenant read, and RLS has to be
-- remembered per table, by hand, in every future migration.
--
-- It has already been forgotten once: pilot.stripe_events picked up that
-- default SELECT and had to be revoked in a later migration
-- (20260805210000_phase4_receipts_storage.sql). That one was caught. The
-- next one is caught by this block or not at all.
--
-- The view sweep above and this table sweep are deliberately separate:
-- a view's leak mode is losing security_invoker, a table's is losing RLS,
-- and neither check sees the other's objects (relkind 'r'/'p' here vs
-- 'v'/'m' above).
--
-- FORCE ROW LEVEL SECURITY is deliberately NOT required — pilot.accounts
-- is owned by a role that would then be locked out of its own recursion
-- through current_account_ids(). That absence is a decision, not a gap.
-- =====================================================================
do $$
declare unprotected text[];
begin
  select array_agg(c.relname order by c.relname)
    into unprotected
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'pilot'
      -- 'r' ordinary table, 'p' partitioned table. A partitioned parent
      -- with RLS off is a hole even when every partition has it on.
      and c.relkind in ('r', 'p')
      and not c.relrowsecurity;
  if unprotected is not null then
    raise exception 'F1 FAILURE: pilot tables with row level security DISABLED (readable cross-tenant via the schema default SELECT grant): %', unprotected;
  end if;
  raise notice 'PASS F1: every table in schema pilot has row level security enabled';
end $$;

-- A table with RLS on and NO policy is closed to "authenticated" (deny by
-- default), which is safe but almost always unintentional — it usually
-- means a policy was meant to exist. pilot.stripe_events is the one place
-- it IS intentional, so it is named here rather than silently tolerated.
do $$
declare policyless text[];
begin
  select array_agg(c.relname order by c.relname)
    into policyless
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'pilot'
      and c.relkind in ('r', 'p')
      and c.relrowsecurity
      and c.relname <> 'stripe_events'
      and not exists (
        select 1 from pg_policies p
        where p.schemaname = 'pilot' and p.tablename = c.relname
      );
  if policyless is not null then
    raise exception 'F1b FAILURE: pilot tables with RLS on but no policy at all (unreachable by any pilot — a missing policy, not a deliberate lockout): %', policyless;
  end if;
  raise notice 'PASS F1b: every RLS-enabled pilot table has at least one policy (stripe_events deliberately excepted)';
end $$;

-- =====================================================================
-- File-header invariant: no federal excise tax support may ever exist in
-- this schema (FET is the OPERATOR's issue on a charter sale, never a
-- contract pilot's personal-services invoice — see the Phase 5 migration's
-- file header). A catalog sweep for the obvious naming is the structural
-- check that a future add can't slip past code review unnoticed.
-- =====================================================================
do $$
declare hits text[];
begin
  -- SECOND-PASS REVIEW FINDING (LOW): widened patterns (was just
  -- '%fet%'/'%excise%', which a column named e.g. federal_tax_cents or
  -- transportation_tax_cents would sail past), and now also checks column
  -- COMMENTS via pg_description, not just names — matching what this
  -- block's own header always claimed to sweep.
  select array_agg(n.nspname || '.' || c.relname || '.' || a.attname) into hits
    from pg_attribute a
    join pg_class c on c.oid = a.attrelid
    join pg_namespace n on n.oid = c.relnamespace
    left join pg_description d on d.objoid = c.oid and d.objsubid = a.attnum
    where n.nspname = 'pilot'
      and a.attnum > 0
      and not a.attisdropped
      and (
        a.attname ilike '%fet%'
        or a.attname ilike '%excise%'
        or a.attname ilike '%federal%tax%'
        or a.attname ilike '%transportation%tax%'
        or a.attname ilike '%4261%'
        or coalesce(d.description, '') ilike '%excise%'
        or coalesce(d.description, '') ilike '%federal%tax%'
        or coalesce(d.description, '') ilike '%4261%'
      );
  if hits is not null then
    raise exception 'FET FAILURE: federal-excise-tax-shaped column(s)/comment(s) found in schema pilot: %', hits;
  end if;
  -- Honest about scope (SECOND-PASS REVIEW FINDING): this is a naming and
  -- comment tripwire, not a semantic proof — it cannot catch a federal
  -- excise tax column given a name and comment that avoid every pattern
  -- above. It is cheap insurance against the likeliest accident (someone
  -- porting "add FET support" verbatim from the FlightDeptPro audit into
  -- a future change here), not a structural guarantee.
  raise notice 'PASS: no federal-excise-tax-shaped column name or comment (by pattern) in schema pilot';
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

-- =====================================================================
-- PHASE 5, still authenticated as tenant A. Invoice numbering,
-- immutability, A3 enforcement, the C3 cash-basis ledger, and the two new
-- cross-record guards (cross-client trip attach, trip double-billing).
-- =====================================================================

-- CRITICAL 1/2 regression: next_invoice_number() must actually work for an
-- authenticated tenant (the original SECURITY INVOKER + bare-RLS design
-- made it always fail) and must advance per call.
do $$
declare n1 text; n2 text;
begin
  n1 := pilot.next_invoice_number('${A}');
  n2 := pilot.next_invoice_number('${A}');
  if n1 = n2 then
    raise exception 'CRITICAL REGRESSION: next_invoice_number returned the same number twice: %', n1;
  end if;
  raise notice 'PASS: next_invoice_number() succeeds for an authenticated tenant and advances (% then %)', n1, n2;
end $$;

-- id is deliberately NOT specified on any invoice insert below: the
-- INSERT grant withholds it (see HIGH-5), same as every other table in
-- this schema — a client never chooses its own primary key. Each
-- generated id is captured via a data-modifying CTE into this session-local
-- temp table and referenced by key everywhere below, instead of a
-- hardcoded literal.
create temporary table _test_ids (key text primary key, id uuid not null);
-- Owned by the connecting (superuser) role; later blocks read it after
-- SET LOCAL ROLE authenticated/service_role, which need an explicit grant
-- regardless of BYPASSRLS (that only bypasses row-level security
-- policies, not table-level privileges).
grant select on _test_ids to authenticated, service_role;

with ins as (
  insert into pilot.invoices (account_id, client_id) values ('${A}', '00000000-0000-0000-0000-00000000c0a1')
  returning id
)
insert into _test_ids (key, id) select 'inv1', id from ins;
update pilot.invoices set tax_rate_bps = 800 where id = (select id from _test_ids where key = 'inv1');

-- HIGH 5: status/invoice_number (and id) are withheld from the
-- column-scoped INSERT grant, so a fabricated non-draft insert is
-- rejected at the privilege layer — invoices_force_draft_on_insert is
-- defense-in-depth beneath this for any path that isn't grant-restricted
-- the same way (e.g. a future looser grant).
do $$
begin
  begin
    insert into pilot.invoices (account_id, client_id, status, invoice_number)
      values ('${A}', '00000000-0000-0000-0000-00000000c0a1', 'paid', 'FAKE-0001');
    raise exception 'HIGH-5 FAILURE: tenant inserted a non-draft invoice with a fabricated number';
  exception when insufficient_privilege then
    raise notice 'PASS: HIGH-5 — status/invoice_number are withheld from the INSERT grant';
  end;
end $$;

-- A3: a line cannot reference an expense that isn't CURRENTLY tagged
-- 'rebill' — the seeded meals expense is 'deduct'.
do $$
begin
  begin
    insert into pilot.invoice_lines (account_id, invoice_id, line_type, description, unit_amount_cents, expense_id, expense_treatment)
      values ('${A}', (select id from _test_ids where key = 'inv1'), 'reimbursable_expense', 'bad rebill', 15000,
        (select id from pilot.expenses where account_id = '${A}' and treatment = 'deduct'), 'rebill');
    raise exception 'A3 FAILURE: a line referenced a non-rebill expense';
  exception when foreign_key_violation then
    raise notice 'PASS: A3 — a line can only reference an expense whose CURRENT treatment is rebill';
  end;
end $$;

-- Two real lines: a taxable flight_day line and a non-taxable rebilled
-- expense (the seeded hotel expense, treatment='rebill').
insert into pilot.invoice_lines (account_id, invoice_id, line_type, description, quantity, unit_amount_cents, taxable, trip_id)
values ('${A}', (select id from _test_ids where key = 'inv1'), 'flight_day', 'Flight days', 3, 120000, true, '00000000-0000-0000-0000-000000007a01');
insert into pilot.invoice_lines (account_id, invoice_id, line_type, description, unit_amount_cents, taxable, expense_id, expense_treatment)
values ('${A}', (select id from _test_ids where key = 'inv1'), 'reimbursable_expense', 'Hotel rebill', 40000, false,
  (select id from pilot.expenses where account_id = '${A}' and treatment = 'rebill'), 'rebill');

-- A3 immutability: once referenced, the expense's own treatment cannot
-- change — Postgres's default NO ACTION on FK UPDATE is the enforcement.
do $$
begin
  begin
    update pilot.expenses set treatment = 'deduct'
      where account_id = '${A}' and treatment = 'rebill';
    raise exception 'A3 FAILURE: a rebilled expense''s treatment was changed after being referenced';
  exception when foreign_key_violation then
    raise notice 'PASS: A3 — a rebilled expense''s treatment is immutable once referenced by a line';
  end;
end $$;

-- Cross-client guard: a second client under the same tenant must not be
-- billable for A Client's trip.
with ins as (
  insert into pilot.clients (account_id, name, default_day_rate_cents) values ('${A}', 'A Second Client', 100000)
  returning id
)
insert into _test_ids (key, id) select 'c0a2', id from ins;
with ins as (
  insert into pilot.invoices (account_id, client_id) values ('${A}', (select id from _test_ids where key = 'c0a2'))
  returning id
)
insert into _test_ids (key, id) select 'inv2', id from ins;
do $$
begin
  begin
    insert into pilot.invoice_lines (account_id, invoice_id, line_type, description, unit_amount_cents, trip_id)
      values ('${A}', (select id from _test_ids where key = 'inv2'), 'flight_day', 'Wrong client', 120000, '00000000-0000-0000-0000-000000007a01');
    raise exception 'CROSS-CLIENT FAILURE: a trip was billed to a client it was not flown for';
  exception
    when others then
      if sqlerrm like 'trip % belongs to a different client%' then
        raise notice 'PASS: a trip cannot be billed to a client other than its own';
      else
        raise;
      end if;
  end;
end $$;

-- Trip double-billing guard: the flight_day line above already put trip A
-- on inv1; a second LIVE invoice cannot also carry that trip.
with ins as (
  insert into pilot.invoices (account_id, client_id) values ('${A}', '00000000-0000-0000-0000-00000000c0a1')
  returning id
)
insert into _test_ids (key, id) select 'inv3', id from ins;
do $$
begin
  begin
    insert into pilot.invoice_lines (account_id, invoice_id, line_type, description, unit_amount_cents, trip_id)
      values ('${A}', (select id from _test_ids where key = 'inv3'), 'flight_day', 'Double bill', 120000, '00000000-0000-0000-0000-000000007a01');
    raise exception 'DOUBLE-BILL FAILURE: the same trip was billed on two live invoices';
  exception
    when others then
      if sqlerrm like 'trip % is already billed on invoice%' then
        raise notice 'PASS: the same trip cannot be billed on two different live invoices';
      else
        raise;
      end if;
  end;
end $$;

-- Issue inv1: draft -> sent. Assigns invoice_number/issued_on/due_on.
update pilot.invoices set status = 'sent' where id = (select id from _test_ids where key = 'inv1');

-- HIGH 4: a line cannot be reparented off an issued invoice onto a draft
-- one (inv2 is still draft). invoice_id IS grant-writable (see the
-- migration's MEDIUM-6 grant comment), so this exercises the trigger
-- itself, not just a privilege denial.
do $$
declare a_line_id uuid;
begin
  select id into a_line_id from pilot.invoice_lines
    where account_id = '${A}' and invoice_id = (select id from _test_ids where key = 'inv1') and line_type = 'flight_day';
  begin
    update pilot.invoice_lines set invoice_id = (select id from _test_ids where key = 'inv2') where id = a_line_id;
    raise exception 'HIGH-4 FAILURE: a line was reparented off an issued invoice';
  exception
    when others then
      if sqlerrm like 'invoice lines cannot change once%' then
        raise notice 'PASS: HIGH-4 — a line cannot be reparented off an issued invoice';
      else
        raise;
      end if;
  end;
end $$;

-- Forward-only state machine: 'sent' cannot move back to 'draft'.
do $$
begin
  begin
    update pilot.invoices set status = 'draft' where id = (select id from _test_ids where key = 'inv1');
    raise exception 'STATE-MACHINE FAILURE: an issued invoice reverted to draft';
  exception
    when others then
      if sqlerrm like 'invoice % cannot move from status%' then
        raise notice 'PASS: an issued invoice cannot revert to draft';
      else
        raise;
      end if;
  end;
end $$;

-- MEDIUM 11: status cannot become 'paid' with zero dollars recorded.
do $$
begin
  begin
    update pilot.invoices set status = 'paid' where id = (select id from _test_ids where key = 'inv1');
    raise exception 'MEDIUM-11 FAILURE: status reached paid with no recorded payment';
  exception
    when others then
      if sqlerrm like 'invoice % cannot become status=%' then
        raise notice 'PASS: MEDIUM-11 — status cannot become paid/partial with no recorded payment';
      else
        raise;
      end if;
  end;
end $$;

-- A payment cannot be recorded against a still-draft invoice.
do $$
begin
  begin
    insert into pilot.invoice_payments (account_id, invoice_id, paid_on, amount_cents)
      values ('${A}', (select id from _test_ids where key = 'inv2'), current_date, 5000);
    raise exception 'PAYMENT-GUARD FAILURE: a payment was recorded against a draft invoice';
  exception
    when others then
      if sqlerrm like 'invoice % (status=%) cannot receive a payment%' then
        raise notice 'PASS: a payment cannot be recorded against a draft invoice';
      else
        raise;
      end if;
  end;
end $$;

-- Real payment path: two payments, crossing 'sent' -> 'partial' -> 'paid'.
insert into pilot.invoice_payments (account_id, invoice_id, paid_on, amount_cents, method)
values ('${A}', (select id from _test_ids where key = 'inv1'), current_date, 200000, 'ach');
update pilot.invoices set status = 'partial' where id = (select id from _test_ids where key = 'inv1');

insert into pilot.invoice_payments (account_id, invoice_id, paid_on, amount_cents, method)
values ('${A}', (select id from _test_ids where key = 'inv1'), current_date, 228800, 'wire');
update pilot.invoices set status = 'paid' where id = (select id from _test_ids where key = 'inv1');

-- C2/C3/C10: pilot.invoice_totals is the ONE source, and its fan-out-safe
-- join must not double-count now that BOTH children (2 lines, 2 payments)
-- are present. subtotal = 360000 (taxable flight_day) + 40000 (non-taxable
-- hotel rebill) = 400000. tax = round(360000 x 800/10000) = 28800.
-- total = 428800 = amount_paid (200000 + 228800), so balance = 0.
do $$
declare t record;
begin
  select * into t from pilot.invoice_totals where invoice_id = (select id from _test_ids where key = 'inv1');
  if t.subtotal_cents <> 400000 or t.tax_cents <> 28800 or t.total_cents <> 428800
     or t.amount_paid_cents <> 428800 or t.balance_due_cents <> 0 then
    raise exception 'TOTALS FAILURE: subtotal=% tax=% total=% paid=% balance=% (expected 400000/28800/428800/428800/0 — a join fan-out bug would double these with 2 lines x 2 payments)',
      t.subtotal_cents, t.tax_cents, t.total_cents, t.amount_paid_cents, t.balance_due_cents;
  end if;
  raise notice 'PASS: invoice_totals is exact with 2 lines and 2 payments present (no join fan-out)';
end $$;

-- =====================================================================
-- SECOND-PASS REGRESSION TESTS. Both independent Opus-high reviews of
-- the first fix pass found the same missing case in every one of these:
-- a protected column changed ALONE was correctly rejected by the
-- existing tests above, but the SAME change piggybacked on an allowed
-- column's edit in the same statement was not — because the underlying
-- bug was an OR-of-allowed-columns standing in for a deny-by-default
-- check. These exercise the combination, not just the single column.
-- =====================================================================

-- HIGH-1 regression: a protected column (tax_rate_bps) piggybacked on an
-- allowed one (notes), in the SAME UPDATE, on an issued invoice.
with ins as (
  insert into pilot.invoices (account_id, client_id) values ('${A}', '00000000-0000-0000-0000-00000000c0a1')
  returning id
)
insert into _test_ids (key, id) select 'inv4', id from ins;
insert into pilot.invoice_lines (account_id, invoice_id, line_type, description, unit_amount_cents, taxable)
values ('${A}', (select id from _test_ids where key = 'inv4'), 'flight_day', 'Flight day', 120000, true);
update pilot.invoices set status = 'sent' where id = (select id from _test_ids where key = 'inv4');

do $$
declare original_total bigint;
begin
  select total_cents into original_total from pilot.invoice_totals
    where invoice_id = (select id from _test_ids where key = 'inv4');

  -- control: tax_rate_bps ALONE is correctly refused.
  begin
    update pilot.invoices set tax_rate_bps = 2500 where id = (select id from _test_ids where key = 'inv4');
    raise exception 'HIGH-1 FAILURE: tax_rate_bps alone was accepted on an issued invoice';
  exception when others then
    if sqlerrm like 'HIGH-1 FAILURE%' then raise;
    elsif sqlerrm not like 'invoice % is issued%' then raise;
    end if;
  end;

  -- the actual regression: same change, piggybacked on notes.
  begin
    update pilot.invoices set notes = 'ping', tax_rate_bps = 2500
      where id = (select id from _test_ids where key = 'inv4');
    raise exception 'HIGH-1 FAILURE: tax_rate_bps was rewritten on an issued invoice by piggybacking on a notes edit';
  exception when others then
    if sqlerrm like 'HIGH-1 FAILURE%' then raise;
    elsif sqlerrm not like 'invoice % is issued%' then raise;
    end if;
  end;

  -- legitimate case still works: notes ALONE.
  update pilot.invoices set notes = 'thanks!' where id = (select id from _test_ids where key = 'inv4');

  if (select total_cents from pilot.invoice_totals where invoice_id = (select id from _test_ids where key = 'inv4')) <> original_total then
    raise exception 'HIGH-1 FAILURE: invoice total drifted even though every tax_rate_bps rewrite attempt was supposed to be refused';
  end if;
  raise notice 'PASS: HIGH-1 — a protected column cannot be rewritten by piggybacking on an allowed one, and legitimate notes-only edits still work';
end $$;

-- HIGH-2 regression: a draft cannot jump directly to 'paid' (skipping
-- 'sent' and the payment guard), the trap that had no way back out.
with ins as (
  insert into pilot.invoices (account_id, client_id) values ('${A}', '00000000-0000-0000-0000-00000000c0a1')
  returning id
)
insert into _test_ids (key, id) select 'inv5', id from ins;
do $$
begin
  begin
    update pilot.invoices set status = 'paid' where id = (select id from _test_ids where key = 'inv5');
    raise exception 'HIGH-2 FAILURE: a draft invoice jumped directly to paid';
  exception when others then
    if sqlerrm like 'HIGH-2 FAILURE%' then raise;
    elsif sqlerrm not like 'invoice % cannot move from status draft to paid%' then raise;
    end if;
  end;
  raise notice 'PASS: HIGH-2 — a draft invoice cannot jump directly to paid; it must be sent first';
end $$;

-- An invoice with no line items cannot be sent.
with ins as (
  insert into pilot.invoices (account_id, client_id) values ('${A}', '00000000-0000-0000-0000-00000000c0a1')
  returning id
)
insert into _test_ids (key, id) select 'inv6', id from ins;
do $$
begin
  begin
    update pilot.invoices set status = 'sent' where id = (select id from _test_ids where key = 'inv6');
    raise exception 'ZERO-LINE FAILURE: an invoice with no line items was sent';
  exception when others then
    if sqlerrm like 'ZERO-LINE FAILURE%' then raise;
    elsif sqlerrm not like 'invoice % cannot be sent with no line items%' then raise;
    end if;
  end;
  raise notice 'PASS: an invoice with no line items cannot be sent';
end $$;

-- MEDIUM regression: a reimbursable_expense line (trip_id is null BY
-- CONSTRUCTION) is cross-client-checked via its EXPENSE's trip, not just
-- its own null trip_id. A fresh rebill expense on a fresh, not-yet-billed
-- Client One trip, billed onto inv2 (Client Two, from the earlier
-- cross-client test block). A dedicated trip (not 7a01) avoids colliding
-- with the double-bill guard, since 7a01 is already billed on inv1.
with ins as (
  insert into pilot.trips (account_id, client_id, starts_on, ends_on, day_rate_cents, day_count, status)
  values ('${A}', '00000000-0000-0000-0000-00000000c0a1', current_date, current_date, 100000, 1, 'completed')
  returning id
)
insert into _test_ids (key, id) select 'tripE', id from ins;
with ins as (
  insert into pilot.expenses (account_id, trip_id, incurred_on, category, amount_cents, treatment)
  values ('${A}', (select id from _test_ids where key = 'tripE'), current_date, 'rental_car', 30000, 'rebill')
  returning id
)
insert into _test_ids (key, id) select 'e0a2', id from ins;
do $$
begin
  begin
    insert into pilot.invoice_lines (account_id, invoice_id, line_type, description, unit_amount_cents, expense_id, expense_treatment)
      values ('${A}', (select id from _test_ids where key = 'inv2'), 'reimbursable_expense', 'Cross-client via expense',
        30000, (select id from _test_ids where key = 'e0a2'), 'rebill');
    raise exception 'CROSS-CLIENT-EXPENSE FAILURE: an expense-derived cross-client bypass succeeded';
  exception when others then
    if sqlerrm like 'CROSS-CLIENT-EXPENSE FAILURE%' then raise;
    elsif sqlerrm not like 'trip % belongs to a different client than invoice%' then raise;
    end if;
  end;
  raise notice 'PASS: a reimbursable_expense line is cross-client-checked via its expense''s trip';
end $$;

-- MEDIUM regression: a trip already billed on a live invoice cannot have
-- its client reassigned out from under that invoice.
do $$
begin
  begin
    update pilot.trips set client_id = (select id from _test_ids where key = 'c0a2')
      where account_id = '${A}' and id = '00000000-0000-0000-0000-000000007a01';
    raise exception 'TRIP-REASSIGN FAILURE: a billed trip''s client was reassigned';
  exception when others then
    if sqlerrm like 'TRIP-REASSIGN FAILURE%' then raise;
    elsif sqlerrm not like 'trip % is billed on invoice % and its client cannot be reassigned%' then raise;
    end if;
  end;
  raise notice 'PASS: a trip''s client cannot be reassigned once it is billed on a live invoice';
end $$;

-- MEDIUM regression: the travel-day columns added by this migration are
-- now UPDATE-writable, not just INSERT/SELECT-writable.
--
-- STALE-TEST FIX. This assertion used to reuse trip 7a01, which by this
-- point in the run has been billed onto a live invoice by the block above.
-- Phase 9's trips_protect_billed_facts then correctly refused the update
-- ("This trip is billed on INV-... before changing its dates, rates or
-- status"), the whole script aborted on it, and the ELEVEN assertions
-- below this line had never once executed — the run reported 26 passes
-- and silently skipped the rest.
--
-- The trigger was right and the test was wrong: a rate on a billed trip
-- SHOULD be frozen. What this block actually means to prove is narrower —
-- that the GRANT on the travel-day columns permits UPDATE at all — so it
-- now proves it on a trip that is deliberately unbilled, leaving the
-- freeze itself to the assertions that exist for it.
-- No literal id: "authenticated" has no INSERT grant on trips.id (ids are
-- generated), so this uses the file's _test_ids idiom like every other
-- trip created after the seed block.
with ins as (
  insert into pilot.trips (account_id, client_id, starts_on, ends_on, day_rate_cents, day_count, status)
  values ('${A}', '00000000-0000-0000-0000-00000000c0a1', current_date, current_date + 1, 100000, 2, 'completed')
  returning id
)
insert into _test_ids (key, id) select 'tripGrant', id from ins;

update pilot.trips set travel_day_rate_cents = 60000
  where account_id = '${A}' and id = (select id from _test_ids where key = 'tripGrant');
update pilot.clients set default_travel_day_rate_cents = 60000
  where account_id = '${A}' and id = '00000000-0000-0000-0000-00000000c0a1';
do $$
declare v bigint;
begin
  select travel_day_rate_cents into v from pilot.trips
    where account_id = '${A}' and id = (select id from _test_ids where key = 'tripGrant');
  if v <> 60000 then
    raise exception 'GRANT FAILURE: travel_day_rate_cents UPDATE did not take effect (got %)', v;
  end if;
  raise notice 'PASS: travel_day_count/travel_day_rate_cents and default_travel_day_rate_cents are UPDATE-writable';
end $$;

-- C2 regression: pilot.trips.billing_state syncs from invoice status —
-- trip A's invoice (inv1/9001, from the block above) reached 'paid'.
do $$
declare v text;
begin
  select billing_state into v from pilot.trips
    where account_id = '${A}' and id = '00000000-0000-0000-0000-000000007a01';
  if v <> 'paid' then
    raise exception 'BILLING-STATE FAILURE: trip billing_state is % (expected paid)', v;
  end if;
  raise notice 'PASS: pilot.trips.billing_state syncs to paid when its invoice does';
end $$;

-- =====================================================================
-- THIRD-PASS REGRESSION TESTS. Both third-pass reviews found round-2's
-- fixes had reintroduced the same shape of bug elsewhere: HIGH-2 and
-- HIGH-3 are the same "reassign the thing a live invoice depends on"
-- attack via two different columns (invoices.client_id, expenses.trip_id)
-- that round 2 only closed one of (trips.client_id).
-- =====================================================================

-- HIGH-2: a draft's client_id cannot be swapped in the SAME statement
-- that sends it, leaving an issued invoice attributed to a client whose
-- trips it never actually bills.
with ins as (
  insert into pilot.trips (account_id, client_id, starts_on, ends_on, day_rate_cents, day_count, status)
  values ('${A}', '00000000-0000-0000-0000-00000000c0a1', current_date, current_date, 100000, 1, 'completed')
  returning id
)
insert into _test_ids (key, id) select 'trip7', id from ins;
with ins as (
  insert into pilot.invoices (account_id, client_id) values ('${A}', '00000000-0000-0000-0000-00000000c0a1')
  returning id
)
insert into _test_ids (key, id) select 'inv7', id from ins;
insert into pilot.invoice_lines (account_id, invoice_id, line_type, description, unit_amount_cents, trip_id)
values ('${A}', (select id from _test_ids where key = 'inv7'), 'flight_day', 'Flight day', 100000, (select id from _test_ids where key = 'trip7'));
do $$
begin
  begin
    update pilot.invoices set client_id = (select id from _test_ids where key = 'c0a2'), status = 'sent'
      where id = (select id from _test_ids where key = 'inv7');
    raise exception 'HIGH-2 (third pass) FAILURE: client_id was swapped in the same statement that sent the invoice';
  exception when others then
    if sqlerrm like 'HIGH-2 (third pass)%' then raise;
    elsif sqlerrm not like 'invoice % cannot be sent: one or more line items'' trips belong to a different client%' then raise;
    end if;
  end;
  raise notice 'PASS: HIGH-2 (third pass) — client_id cannot be swapped in the same statement that sends the invoice';
end $$;
update pilot.invoices set status = 'sent' where id = (select id from _test_ids where key = 'inv7');

-- HIGH-3: once an expense is rebilled onto a live invoice, its trip_id
-- cannot be reassigned — the identical attack surface as trips.client_id,
-- via the expense side of the trip resolution.
with ins as (
  insert into pilot.trips (account_id, client_id, starts_on, ends_on, day_rate_cents, day_count, status)
  values ('${A}', '00000000-0000-0000-0000-00000000c0a1', current_date, current_date, 100000, 1, 'completed')
  returning id
)
insert into _test_ids (key, id) select 'trip10', id from ins;
with ins as (
  insert into pilot.invoices (account_id, client_id) values ('${A}', '00000000-0000-0000-0000-00000000c0a1')
  returning id
)
insert into _test_ids (key, id) select 'inv8', id from ins;
insert into pilot.invoice_lines (account_id, invoice_id, line_type, description, unit_amount_cents, expense_id, expense_treatment)
values ('${A}', (select id from _test_ids where key = 'inv8'), 'reimbursable_expense', 'Rebill to protect', 30000,
  (select id from _test_ids where key = 'e0a2'), 'rebill');
do $$
begin
  begin
    update pilot.expenses set trip_id = (select id from _test_ids where key = 'trip10')
      where account_id = '${A}' and id = (select id from _test_ids where key = 'e0a2');
    raise exception 'HIGH-3 FAILURE: a rebilled expense''s trip was reassigned';
  exception when others then
    if sqlerrm like 'HIGH-3 FAILURE%' then raise;
    elsif sqlerrm not like 'expense % is billed on invoice % and its trip cannot be reassigned%' then raise;
    end if;
  end;
  raise notice 'PASS: HIGH-3 — an already-rebilled expense''s trip cannot be reassigned';
end $$;

-- MEDIUM regression: an overpayment must still be able to reach 'paid'
-- (balance_due_cents <= 0), not just an exact match.
with ins as (
  insert into pilot.invoices (account_id, client_id) values ('${A}', '00000000-0000-0000-0000-00000000c0a1')
  returning id
)
insert into _test_ids (key, id) select 'inv9', id from ins;
insert into pilot.invoice_lines (account_id, invoice_id, line_type, description, unit_amount_cents)
values ('${A}', (select id from _test_ids where key = 'inv9'), 'flight_day', 'Flight day', 100000);
update pilot.invoices set status = 'sent' where id = (select id from _test_ids where key = 'inv9');
insert into pilot.invoice_payments (account_id, invoice_id, paid_on, amount_cents)
values ('${A}', (select id from _test_ids where key = 'inv9'), current_date, 100050);
update pilot.invoices set status = 'paid' where id = (select id from _test_ids where key = 'inv9');
do $$
declare v text;
begin
  select status into v from pilot.invoices where id = (select id from _test_ids where key = 'inv9');
  if v <> 'paid' then
    raise exception 'OVERPAY FAILURE: a $0.50 overpayment permanently blocked status=paid';
  end if;
  raise notice 'PASS: an overpayment can still reach status=paid (balance_due_cents <= 0, not exact-zero)';
end $$;

-- LOW regression (pre-existing Phase 3/4 bug, surfaced by Phase 5 testing
-- that actually exercises trip deletion): deleting a trip that has an
-- expense attached must succeed and null only the expense's trip_id, not
-- its account_id.
with ins as (
  insert into pilot.trips (account_id, client_id, starts_on, ends_on, day_rate_cents, day_count, status)
  values ('${A}', '00000000-0000-0000-0000-00000000c0a1', current_date, current_date, 100000, 1, 'completed')
  returning id
)
insert into _test_ids (key, id) select 'trip9', id from ins;
with ins as (
  insert into pilot.expenses (account_id, trip_id, incurred_on, category, amount_cents, treatment)
  values ('${A}', (select id from _test_ids where key = 'trip9'), current_date, 'parking', 2000, 'deduct')
  returning id
)
insert into _test_ids (key, id) select 'exp9', id from ins;
delete from pilot.trips where account_id = '${A}' and id = (select id from _test_ids where key = 'trip9');
do $$
declare orphan_trip_id uuid; orphan_account_id uuid;
begin
  select trip_id, account_id into orphan_trip_id, orphan_account_id from pilot.expenses
    where id = (select id from _test_ids where key = 'exp9');
  if orphan_account_id is null then
    raise exception 'FK-REPAIR FAILURE: deleting the trip nulled the expense''s account_id, not just trip_id';
  end if;
  if orphan_trip_id is not null then
    raise exception 'FK-REPAIR FAILURE: trip_id was not nulled on trip delete';
  end if;
  raise notice 'PASS: deleting a trip with an attached expense succeeds and nulls only trip_id, not account_id';
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

-- Phase 5 isolation: tenant B must see none of tenant A's invoices, lines,
-- payments, or totals — the totals view leaking would be the single worst
-- defect in this schema (every tenant's revenue readable by every other).
do $$
declare n integer;
begin
  select count(*) into n from pilot.invoices where account_id = '${A}';
  if n <> 0 then raise exception 'ISOLATION FAILURE: tenant B can see tenant A invoices'; end if;
  select count(*) into n from pilot.invoice_lines where account_id = '${A}';
  if n <> 0 then raise exception 'ISOLATION FAILURE: tenant B can see tenant A invoice_lines'; end if;
  select count(*) into n from pilot.invoice_payments where account_id = '${A}';
  if n <> 0 then raise exception 'ISOLATION FAILURE: tenant B can see tenant A invoice_payments'; end if;
  select count(*) into n from pilot.invoice_totals where account_id = '${A}';
  if n <> 0 then raise exception 'ISOLATION FAILURE: pilot.invoice_totals leaked tenant A rows to tenant B'; end if;
  select count(*) into n from pilot.invoices where account_id = '${B}';
  if n <> 0 then raise exception 'ISOLATION FAILURE: tenant B unexpectedly has invoices of its own in this fixture'; end if;
  raise notice 'PASS: tenant B sees zero Phase 5 rows belonging to tenant A, including through invoice_totals';
end $$;

-- next_invoice_number cross-tenant probe: passing tenant A's account_id as
-- tenant B must be rejected, not silently disclose A's prefix/sequence.
do $$
begin
  begin
    perform pilot.next_invoice_number('${A}');
    raise exception 'CROSS-TENANT FAILURE: tenant B obtained an invoice number for tenant A''s account';
  exception
    when others then
      if sqlerrm like 'not a member of account%' then
        raise notice 'PASS: next_invoice_number() rejects a non-member account_id';
      else
        raise;
      end if;
  end;
end $$;

reset role;

-- SECOND-PASS REGRESSION (both reviews' HIGH-2): service_role must
-- actually be able to issue an invoice. The CRITICAL-1 fix moved
-- next_invoice_number to SECURITY DEFINER, which flips current_user to
-- the function OWNER during execution — silently defeating a
-- current_user-based service_role bypass and blocking every service_role
-- caller (the webhook/reconciliation path this file documents
-- throughout). Prove the real path: no end-user JWT at all (matching a
-- genuine service_role/webhook connection), add a line and issue a draft
-- (inv6, left empty by the zero-line test above) as service_role.
set local role service_role;
select set_config('request.jwt.claims', '', true);

insert into pilot.invoice_lines (account_id, invoice_id, line_type, description, unit_amount_cents)
values ('${A}', (select id from _test_ids where key = 'inv6'), 'flight_day', 'service_role issue path', 100000);
update pilot.invoices set status = 'sent'
  where account_id = '${A}' and id = (select id from _test_ids where key = 'inv6');

do $$
declare n text;
begin
  select invoice_number into n from pilot.invoices
    where account_id = '${A}' and id = (select id from _test_ids where key = 'inv6');
  if n is null then
    raise exception 'HIGH-2 (security review) FAILURE: service_role could not issue an invoice';
  end if;
  raise notice 'PASS: service_role can issue an invoice (next_invoice_number correctly recognizes it via current_setting(''role''), not current_user)';
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

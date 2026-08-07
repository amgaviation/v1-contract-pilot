-- Phase 9 Layer 1 — a contract minimum has no basis, and it is over-billing
-- clients today.
--
-- THE BUG. pilot.clients.minimum_days is one field, and createInvoiceDraft
-- (app/(app)/invoices/actions.ts) applies it as a PER-TRIP floor: every
-- trip on the invoice that falls short of minimum_days gets its own
-- top-up line. That is a correct implementation of a per-trip minimum
-- ("2-day minimum, portal to portal"), and it is the ONLY contract shape
-- this schema can express.
--
-- references/contract-pilot-business.md documents a second, equally common
-- shape: a MONTHLY GUARANTEE ("guaranteed 10 days a month at a committed
-- rate"). A pilot on a monthly guarantee has nowhere to say so — the only
-- field is minimum_days — so they type the guaranteed number into it, and
-- an invoice covering four 3-day trips in one month generates FOUR
-- separate 7-day top-up lines: 28 phantom days on a document going to an
-- aircraft owner's AP department, when the honest shortfall for the month
-- is at most (guarantee - days actually worked that month).
--
-- THE FIX has two parts:
--
--   1. minimum_basis, a value on the term itself: 'per_trip' (today's only
--      behavior, and the default) or 'per_month'. Defaulting to 'per_trip'
--      is not a style choice — it is what every existing client's
--      minimum_days has meant since the column shipped, and changing the
--      default would silently reinterpret every contract on file. No
--      existing client's invoices may change value from this migration;
--      every row keeps 'per_trip' until a pilot deliberately switches one.
--
--   2. pilot.guarantee_periods, because a monthly true-up is not safe to
--      compute per-invoice the way a per-trip one is. A monthly guarantee
--      can span trips billed on DIFFERENT invoices (draft one now, draft
--      another for the same client next week that happens to cover a
--      second trip in the same calendar month) — without a durable record
--      of "this month's guarantee was already topped up, on invoice X",
--      the second draft has no way to know not to top it up again. This is
--      the same "make it unrepeatable" problem invoice_number_sequences
--      solves for invoice numbers, applied to monthly settlement instead.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. minimum_basis.
-- ---------------------------------------------------------------------------
alter table pilot.clients
  add column if not exists minimum_basis text not null default 'per_trip'
    check (minimum_basis in ('per_trip', 'per_month'));

comment on column pilot.clients.minimum_basis is
  'What minimum_days is a floor ON. ''per_trip'' (the default, and the only behavior that existed before this column): each trip on an invoice is topped up independently. ''per_month'': the floor applies once per calendar month across every trip billed for this client that month, settled via pilot.guarantee_periods so two invoices can never both top up the same month. Defaults to per_trip because that is what every existing minimum_days value already means — changing the default would silently reinterpret a live contract.';

-- ADD COLUMN does not extend the existing column-scoped grants
-- (20260807000000's own lesson, restated because this migration makes the
-- same mistake possible again). Both INSERT and UPDATE, matching how
-- per_diem_mode/minimum_days/cancellation_policy_note were granted.
grant insert (minimum_basis) on pilot.clients to authenticated;
grant update (minimum_basis) on pilot.clients to authenticated;

-- ---------------------------------------------------------------------------
-- 2. pilot.guarantee_periods — one settled month per client, at most once.
--
-- period_month is always the first of the month: a plain `date` rather than
-- a "YYYY-MM" text pair, so it composes with normal date functions and
-- indexes like every other date column in this schema, and the CHECK below
-- is what stops a stray 2026-08-15 from being stored as if it identified a
-- different month than 2026-08-01 would.
--
-- settled_invoice_id is nullable so a period can exist without yet being
-- topped up (recorded, but this month's worked days already met the
-- guarantee) — but once set, it is the fact createInvoiceDraft checks
-- before ever emitting a second top-up line for that month. The composite
-- FK to pilot.invoices ties it to a specific tenant's specific invoice, the
-- same pattern every child table in this schema uses to reference a parent.
-- ---------------------------------------------------------------------------
create table if not exists pilot.guarantee_periods (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references pilot.accounts(id) on delete cascade,
  client_id uuid not null,
  period_month date not null,
  guaranteed_days numeric(5,1) not null check (guaranteed_days > 0),
  settled_invoice_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- FK target for tenant-scoped children. See the Phase 3 migration's
  -- "pattern 1" comment: composite FKs are what stop tenant A attaching a
  -- row to tenant B's parent, and they need this redundant-looking unique.
  unique (account_id, id),
  -- The whole point of this table: at most one settlement row per client
  -- per month, ever. createInvoiceDraft upserts against this constraint.
  unique (account_id, client_id, period_month),
  foreign key (account_id, client_id)
    references pilot.clients (account_id, id) on delete cascade,
  -- SET NULL, not RESTRICT or CASCADE: voiding or otherwise losing the
  -- settling invoice must not delete the record that a month WAS settled
  -- (the guaranteed_days figure is still true history), and must not block
  -- deleting the invoice either. It does mean a voided invoice leaves a
  -- period looking settled with no live invoice attached — recorded as a
  -- known gap below, not silently pretended away.
  foreign key (account_id, settled_invoice_id)
    references pilot.invoices (account_id, id) on delete set null (settled_invoice_id),
  check (period_month = date_trunc('month', period_month)::date)
);

comment on table pilot.guarantee_periods is
  'One row per (client, calendar month) a monthly-guarantee client has been drafted against. settled_invoice_id, once set, is what stops createInvoiceDraft from emitting a second top-up line for a month already settled on another invoice — the same unrepeatable-write role invoice_number_sequences plays for invoice numbers. KNOWN GAP: voiding the settling invoice (ON DELETE SET NULL only fires on invoice DELETE, and this schema voids rather than deletes) leaves a period''s settled_invoice_id pointing at a void invoice — the month reads as settled with no live document behind it. Not resolved here; a pilot in that situation currently has to fix it by hand (or from a future release that clears settlement on void).';

create trigger guarantee_periods_set_updated_at
  before update on pilot.guarantee_periods
  for each row execute function pilot.set_updated_at();

create index if not exists guarantee_periods_settled_invoice_idx
  on pilot.guarantee_periods (account_id, settled_invoice_id)
  where settled_invoice_id is not null;

-- ---------------------------------------------------------------------------
-- RLS. Enabled in the same migration that creates the table, per house rule
-- — never retrofitted. No admin-bypass policy, no AMG-facing read path.
--
-- Written directly by `authenticated` (no SECURITY DEFINER function, unlike
-- invoice_number_sequences) because createInvoiceDraft already runs as the
-- caller's own session and only ever writes account_id = its own account —
-- the same trust level invoice_lines rows are written at. The uniqueness
-- constraint above is what actually prevents a double top-up; RLS here only
-- keeps one tenant from touching another's settlement rows.
-- ---------------------------------------------------------------------------
alter table pilot.guarantee_periods enable row level security;

create policy guarantee_periods_select on pilot.guarantee_periods for select to authenticated
  using (account_id in (select pilot.current_account_ids()));
create policy guarantee_periods_insert on pilot.guarantee_periods for insert to authenticated
  with check (account_id in (select pilot.current_account_ids()));
create policy guarantee_periods_update on pilot.guarantee_periods for update to authenticated
  using (account_id in (select pilot.current_account_ids()))
  with check (account_id in (select pilot.current_account_ids()));
create policy guarantee_periods_delete on pilot.guarantee_periods for delete to authenticated
  using (account_id in (select pilot.current_account_ids()));

-- ---------------------------------------------------------------------------
-- GRANTS — column-scoped, same discipline as every table in this schema.
-- id / created_at / updated_at withheld: defaults and the trigger own them.
-- account_id IS granted on insert — RLS's WITH CHECK constrains its VALUE,
-- withholding the column would make insert impossible rather than safe.
-- ---------------------------------------------------------------------------
grant select, delete on pilot.guarantee_periods to authenticated;
grant insert (account_id, client_id, period_month, guaranteed_days, settled_invoice_id)
  on pilot.guarantee_periods to authenticated;
-- guaranteed_days can move if a contract's guarantee changes mid-month
-- (recorded going forward, not retroactively recomputed); settled_invoice_id
-- is how createInvoiceDraft records or clears which invoice topped up a
-- month. client_id and period_month are NOT updatable — re-pointing either
-- is a delete and an insert, the same discipline client_rates already uses,
-- because (account_id, client_id, period_month) is what IDENTIFIES a row.
grant update (guaranteed_days, settled_invoice_id) on pilot.guarantee_periods to authenticated;

-- service_role: full surface, as everywhere else in this schema.
grant select, insert, update, delete on pilot.guarantee_periods to service_role;

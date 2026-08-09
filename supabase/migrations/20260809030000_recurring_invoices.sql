-- Recurring invoices — a durable cadence a pilot bills a client on, and a
-- "due to create" queue the pilot works through by hand.
--
-- ===========================================================================
-- WHY: pilot.clients.minimum_basis can already be 'per_month' and
-- pilot.guarantee_periods exists for the monthly-guarantee shape it
-- describes ("guaranteed 10 days a month at a committed rate") — but
-- nothing in this product ever generates that invoice. Today the pilot
-- re-types it from scratch every month. This migration adds the schedule
-- and the idempotency ledger that let the app offer "this is due, create
-- it" instead.
--
-- ===========================================================================
-- WHAT THIS DELIBERATELY DOES NOT DO.
--
-- 1. No background job. There is no scheduler wired to this app (no pg_cron
--    extension provisioned, no external cron hitting a route), and building
--    one here would both invent a new unattended-failure surface (a job
--    silently not firing for a week is invisible until a client complains)
--    and violate the product's own draft-confirm posture: docs/PLAN.md is
--    explicit that an invoice is "auto-drafted from a trip's facts,
--    reviewed and sent by the pilot — never sent silently," and the same
--    rule from the logbook draft-confirm boundary applies here. A schedule
--    row is inert data. Nothing reads it until a pilot loads the recurring-
--    invoices page, at which point the app computes what is due and the
--    pilot creates it — one, or all at once — with an explicit action. If a
--    future engineer is tempted to wire pg_cron to
--    recurring_invoice_schedules and have it call createInvoiceDraft-shaped
--    logic unattended: don't. That is exactly the shape this file avoids.
--
-- 2. No auto-send. Generation produces a DRAFT invoice (status defaults to
--    'draft' the same way every other invoice does — see
--    invoices_force_draft_on_insert in the Phase 5 migration, which this
--    migration's generation path is subject to identically). The pilot
--    still reviews and sends it from the invoice screen.
--
-- 3. No monthly-guarantee billing. Considered and rejected for this pass —
--    see the comment on recurring_invoice_schedules.amount_cents below for
--    the reasoning. A schedule here bills a fixed amount only.
--
-- ===========================================================================
-- IDEMPOTENCY: the hard requirement, same discipline as guarantee_periods.
--
-- guarantee_periods' own header explains why a monthly true-up cannot be
-- trusted to an application-level check: two drafts in flight against the
-- same client can each believe they are first. A recurring schedule has the
-- identical race — the due-queue page could be open in two tabs, or the
-- pilot could double-click "create all" — so "at most one invoice per
-- (schedule, period), ever" is enforced the same way: a unique constraint
-- in the database (recurring_invoice_generations' unique (account_id,
-- schedule_id, period_start) below), not an app-level "check then insert."
-- The app still checks first, to fail with a friendly message instead of a
-- raw 23505 — but the constraint is what actually prevents the double bill
-- if that check ever races or gets bypassed.
--
-- ===========================================================================
-- PERIOD ARITHMETIC IS CALENDAR ARITHMETIC — no day counts, ever, for the
-- same reason this schema never counts fixed day-spans for regulatory
-- currency windows (see e.g. 20260807130000's 135.301(a) grace, which is a
-- CALENDAR-month provision, not a 30-day one).
--
-- A monthly schedule's Nth period is calendar month N after the anchor's
-- month, identified canonically by period_start = the first of that month
-- (the same date-truncated-to-month-start shape guarantee_periods.
-- period_month already uses, and the CHECK below enforces it the same way).
-- The anchor's DAY OF MONTH is when, within that period, the invoice
-- becomes due to create — e.g. an anchor of 2026-01-31 bills "the 31st of
-- each month."
--
-- THE 31ST-IN-A-30-DAY-MONTH CASE, decided deliberately: clamped to the
-- LAST DAY of that calendar month, never rolled into the next month and
-- never skipped. An anchor of the 31st is therefore due on Jan 31, Feb 28
-- (or 29), Mar 31, Apr 30, ... This is the same clamping behavior common
-- recurring-billing systems (e.g. a card issuer's monthly statement date)
-- use for exactly this reason: rolling "the 31st" into the 1st/2nd/3rd of
-- the FOLLOWING month would make every later period's due date creep
-- forward by a few days every time a short month is crossed, and skipping
-- the month entirely would silently under-bill a real guarantee/retainer
-- period. Clamping keeps one period per calendar month, always, which is
-- what a calendar-month cadence means. This resolution lives in app code
-- (app/(app)/invoices/recurring/actions.ts's periodDueDate), NOT in SQL —
-- it is pure date arithmetic with no need to run inside Postgres, and the
-- database's only job is to make a (schedule, period) pair unrepeatable
-- once chosen, which it does regardless of how period_start was computed.
--
-- Quarterly is the same idea at 3-calendar-month spacing (period_start is
-- still the first of a month; only every 3rd month from the anchor's month
-- is a valid period).
--
-- CADENCE SET: 'monthly' and 'quarterly' only — deliberately no 'weekly'.
-- Every documented recurring-billing shape in this product's domain
-- (monthly guarantee via minimum_basis='per_month'/guarantee_periods, and
-- the aviation-expert reference material's standby/on-call retainer, which
-- is commonly settled monthly or quarterly) is calendar-month-based.
-- Nothing in this schema represents a weekly-billed engagement, and adding
-- a cadence with no contract shape behind it is exactly the "a cadence
-- nothing can produce" trap — it would just be an unused option in a
-- dropdown. 'monthly' is required by minimum_days/guarantee_periods
-- already existing; 'quarterly' costs nothing extra (identical clamp-to-
-- month-end arithmetic, 3 months apart instead of 1) and matches a real,
-- named contract shape, so it's included; weekly is not.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- recurring_invoice_schedules — the cadence itself. One row per standing
-- billing arrangement with a client.
-- ---------------------------------------------------------------------------
create table if not exists pilot.recurring_invoice_schedules (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references pilot.accounts(id) on delete cascade,
  client_id uuid not null,
  foreign key (account_id, client_id) references pilot.clients (account_id, id) on delete restrict,

  cadence text not null check (cadence in ('monthly', 'quarterly')),

  -- The calendar date this schedule was set up to bill on, and (via its
  -- day-of-month, clamped per period — see the file header) which day of
  -- each future period it is due. NOT a period start itself; a schedule
  -- created mid-month bills going forward from its own anchor, not
  -- retroactively for the month it was created in.
  anchor_date date not null,
  -- Optional. Once past end_date, no further periods are offered — a
  -- schedule that has run its course (a fixed-term retainer) rather than
  -- one running forever. NULL means indefinite.
  end_date date,
  check (end_date is null or end_date >= anchor_date),

  -- Fixed-amount billing only — see the header's "what this deliberately
  -- does not do" #3. Building a monthly-GUARANTEE-linked schedule (reading
  -- clients.minimum_basis='per_month'/minimum_days and settling through
  -- guarantee_periods) was considered and rejected for this pass: the ONE
  -- thing that currently stops a guarantee being topped up twice is
  -- createInvoiceDraft's own application-level check against
  -- guarantee_periods.settled_invoice_id (see that migration's header —
  -- there is no database constraint doing this work, only app code this
  -- migration is expressly forbidden from forking). A schedule generating
  -- a guarantee top-up would need to run that exact check independently,
  -- and TWO independent call sites checking-then-writing the same
  -- unrepeatable fact is precisely the race guarantee_periods' own header
  -- warns about — an app-level check, not a constraint, is not safe against
  -- two callers (createInvoiceDraft racing this schedule's due-queue
  -- action) both reading "not yet settled" before either writes. Closing
  -- that safely means either teaching createInvoiceDraft's guarantee logic
  -- to also consult this table (out of scope: actions.ts is off-limits
  -- this pass) or moving the settlement check itself into a database
  -- constraint (a bigger schema change than this migration's mandate). So:
  -- a documented gap, not a double-billed client. description/amount_cents
  -- below are a flat, pilot-typed line — e.g. "Monthly retainer" / $5,000 —
  -- snapshotted onto every invoice this schedule generates, same principle
  -- as trip_days.rate_cents/mileage_entries.rate_cents_per_mile: a later
  -- change to THIS schedule's amount must never restate an invoice already
  -- generated from an earlier one.
  description text not null check (length(trim(description)) > 0),
  amount_cents bigint not null check (amount_cents > 0),
  -- Snapshotted onto the generated invoice's own tax_rate_bps at creation,
  -- same bound as pilot.invoices.tax_rate_bps (see that column's comment
  -- for why 25% is the ceiling).
  tax_rate_bps integer not null default 0 check (tax_rate_bps >= 0 and tax_rate_bps <= 2500),

  -- A paused schedule offers no due periods and generates nothing — see
  -- the due-queue computation in actions.ts. Distinct from end_date:
  -- pausing is reversible ("skip this while the contract's on hold"),
  -- an end_date is a decided stopping point.
  active boolean not null default true,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (account_id, id)
);

comment on table pilot.recurring_invoice_schedules is
  'A standing cadence a pilot bills a client on (fixed description + amount, monthly or quarterly). Inert data only — nothing reads this table except the recurring-invoices page computing what is due; there is no background job. Generation is recorded in pilot.recurring_invoice_generations, whose unique constraint is what makes a (schedule, period) pair unrepeatable. Does not (yet) bill a monthly guarantee via guarantee_periods — see this table''s amount_cents comment for why that was judged unsafe to build in this pass.';

create trigger recurring_invoice_schedules_set_updated_at
  before update on pilot.recurring_invoice_schedules
  for each row execute function pilot.set_updated_at();

-- ---------------------------------------------------------------------------
-- recurring_invoice_generations — the idempotency ledger. One row per
-- (schedule, period) that has actually been generated, ever.
--
-- period_start is always the first of a calendar month (the period's own
-- identity), same shape and same reasoning as guarantee_periods.
-- period_month: a plain `date` composes with normal date functions and
-- indexes, and the CHECK below is what stops a stray mid-month date from
-- being stored as if it identified a different period than the 1st would.
-- ---------------------------------------------------------------------------
create table if not exists pilot.recurring_invoice_generations (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references pilot.accounts(id) on delete cascade,
  schedule_id uuid not null,
  foreign key (account_id, schedule_id)
    references pilot.recurring_invoice_schedules (account_id, id) on delete cascade,
  period_start date not null,
  check (period_start = date_trunc('month', period_start)::date),
  invoice_id uuid not null,
  -- CASCADE, not RESTRICT/SET NULL like guarantee_periods.settled_invoice_id
  -- — deliberately different from that table. guarantee_periods keeps the
  -- settlement FACT alive even if its invoice is later voided (a voided
  -- invoice is still a real document that existed); this ledger's only
  -- job is "has THIS invoice row already been generated for this period,"
  -- and there is no authenticated DELETE grant on pilot.invoices at all
  -- (only service_role can delete one), so this FK almost never fires in
  -- practice — CASCADE is chosen so that if a service-role cleanup ever
  -- does remove a generated invoice, the period becomes available to
  -- regenerate rather than permanently "used up" with nothing to show
  -- for it.
  foreign key (account_id, invoice_id)
    references pilot.invoices (account_id, id) on delete cascade,
  created_at timestamptz not null default now(),

  unique (account_id, id),
  -- THE constraint. At most one generation per (schedule, period), ever —
  -- enforced here, not by an application check, which races (see the file
  -- header). createInvoiceDraft-style "check then insert" logic in
  -- actions.ts is a nicer error message layered on top of this, not the
  -- actual guard.
  unique (account_id, schedule_id, period_start)
);

comment on table pilot.recurring_invoice_generations is
  'The idempotency ledger for recurring invoices: proof that a given schedule''s given calendar-month period has already produced an invoice. The unique (account_id, schedule_id, period_start) constraint is what makes double-generation impossible, not merely unlikely — see the migration file header.';

create index if not exists recurring_invoice_generations_schedule_idx
  on pilot.recurring_invoice_generations (account_id, schedule_id, period_start);

-- ---------------------------------------------------------------------------
-- RLS. Enabled in the same migration that creates these tables — never
-- retrofitted (house rule). No admin-bypass policy. Written directly by
-- `authenticated` (same trust level as guarantee_periods/invoice_lines: the
-- app already runs as the caller's own session and only ever writes its own
-- account_id) — the uniqueness constraint above is what actually prevents a
-- double generation; RLS here only keeps one tenant from touching another's
-- schedules/generations.
-- ---------------------------------------------------------------------------
alter table pilot.recurring_invoice_schedules  enable row level security;
alter table pilot.recurring_invoice_generations enable row level security;

create policy recurring_invoice_schedules_select on pilot.recurring_invoice_schedules for select to authenticated
  using (account_id in (select pilot.current_account_ids()));
create policy recurring_invoice_schedules_insert on pilot.recurring_invoice_schedules for insert to authenticated
  with check (account_id in (select pilot.current_account_ids()));
create policy recurring_invoice_schedules_update on pilot.recurring_invoice_schedules for update to authenticated
  using (account_id in (select pilot.current_account_ids()))
  with check (account_id in (select pilot.current_account_ids()));
create policy recurring_invoice_schedules_delete on pilot.recurring_invoice_schedules for delete to authenticated
  using (account_id in (select pilot.current_account_ids()));

create policy recurring_invoice_generations_select on pilot.recurring_invoice_generations for select to authenticated
  using (account_id in (select pilot.current_account_ids()));
create policy recurring_invoice_generations_insert on pilot.recurring_invoice_generations for insert to authenticated
  with check (account_id in (select pilot.current_account_ids()));
-- No UPDATE policy: a generation record, once written, identifies an
-- immutable fact (this period was generated, onto this invoice). Nothing
-- in the app ever needs to change one. No DELETE policy either, for the
-- same reason the ledger exists at all — a pilot deleting a generation row
-- to "free up" a period and regenerate it is exactly the double-bill this
-- table exists to prevent; only the invoice-delete CASCADE (service_role
-- only) clears one.

-- ---------------------------------------------------------------------------
-- GRANTS — column-scoped, same discipline as every table in this schema.
-- Per the house CRITICAL on `revoke insert ... from <role>` dropping every
-- column privilege: every grant below is additive from a clean slate, none
-- of them preceded by a same-table revoke.
-- ---------------------------------------------------------------------------
grant select, delete on pilot.recurring_invoice_schedules to authenticated;
grant insert (account_id, client_id, cadence, anchor_date, end_date,
  description, amount_cents, tax_rate_bps, active)
  on pilot.recurring_invoice_schedules to authenticated;
-- client_id/cadence/anchor_date are NOT updatable — together they decide
-- every period this schedule has ever offered or generated (recorded by
-- period_start alone in the ledger above), and re-pointing any of them
-- after generations already exist would silently reinterpret that
-- history. Re-pointing is a delete-and-recreate, the same discipline
-- guarantee_periods uses for its own identifying columns. end_date/
-- description/amount_cents/tax_rate_bps/active are the fields a pilot
-- legitimately revises going forward (extend or end a term, adjust the
-- billed amount for future periods, pause/resume) without touching
-- anything already generated — future generations pick up the new
-- values; past ones keep what was snapshotted onto their own invoice.
grant update (end_date, description, amount_cents, tax_rate_bps, active)
  on pilot.recurring_invoice_schedules to authenticated;

grant select on pilot.recurring_invoice_generations to authenticated;
-- id/created_at withheld (identity/timestamp, not client-choosable, same
-- as every other table). No UPDATE/DELETE grant at all — see the RLS
-- comment above for why.
grant insert (account_id, schedule_id, period_start, invoice_id)
  on pilot.recurring_invoice_generations to authenticated;

grant select, insert, update, delete
  on pilot.recurring_invoice_schedules, pilot.recurring_invoice_generations
  to service_role;

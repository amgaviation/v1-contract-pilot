-- Phase 5 — invoices and invoice lines.
--
-- Requirements traced to docs/research/FLIGHTDEPTPRO-INSPIRATION.md (A5, A6,
-- C1, C2, C3, C10), docs/PLAN.md, and the aviation-expert skill's domain
-- rules for contract-pilot invoicing.
--
-- ***************************************************************************
-- DOMAIN NOTE — NO FEDERAL EXCISE TAX, EVER, ON THIS TABLE.
--
-- The audited product (FlightDeptPro) bills Part 135 CHARTER SALES, where FET
-- (26 U.S.C. 4261) is a real, missing requirement — the audit correctly
-- flags it as a defect. V1's invoices are a different transaction entirely:
-- a contract PILOT billing an operator/owner for SERVICES (day rate, travel
-- days, per diem, reimbursed expenses). FET attaches to the sale of air
-- transportation, not to a pilot's personal-services invoice — it is the
-- OPERATOR's issue on THEIR charter sale, never the pilot's. Porting "add
-- FET support" from that audit into this schema would be a real domain
-- error, not a missing feature. There is no fet_cents column here and there
-- must never be one. `tax_rate_bps` below is state sales/service tax, where
-- a pilot's state and situation requires it — a different regime, optional,
-- and unrelated to FET.
-- ***************************************************************************
--
-- Inherits the two Phase 1/3 security patterns — read
-- 20260802190437_pilot_schema_tenancy.sql and
-- 20260805070000_phase3_clients_trips_expenses.sql before editing this file:
--   1. Composite FKs (account_id, id) so a cross-tenant attach fails in the
--      constraint layer, not just the RLS layer.
--   2. Column-scoped GRANTs, because RLS has no column granularity.

-- ---------------------------------------------------------------------------
-- Extending Phase 3/4 tables. Two gaps only visible once invoicing exists:
-- ---------------------------------------------------------------------------

-- A3 ENFORCEMENT (REVIEW FINDING, HIGH): Phase 3/4 set expenses.treatment
-- once at capture but nothing stopped invoice_lines from referencing an
-- expense whose treatment was 'deduct' or 'unassigned' as a
-- reimbursable_expense line — the FK only checked that the expense existed
-- in the same account, not that it was ever tagged rebill. Worse, nothing
-- stopped pilot.expenses.treatment being changed to 'deduct' AFTER an
-- expense had already been rebilled on a sent invoice, silently
-- invalidating an issued document's own line items.
--
-- Fixed with a composite FK carrying the treatment value itself as part of
-- the key, not just the id: expenses gets a second unique constraint over
-- (account_id, id, treatment), and invoice_lines references that triple
-- instead of just (account_id, id). Two consequences fall out for free:
--   1. INSERT time: a line can only ever be created against an expense
--      whose CURRENT treatment is 'rebill' — no such row exists to
--      reference otherwise, so the FK itself rejects the insert.
--   2. AFTER insert: Postgres's default FK action is NO ACTION on UPDATE,
--      so `update pilot.expenses set treatment = 'deduct'` on an
--      already-referenced row fails with a foreign_key_violation, because
--      the referencing line's (id, 'rebill') tuple would no longer match
--      any row. The expense's treatment becomes immutable the moment it's
--      rebilled — enforced by the FK layer, not by a trigger someone has
--      to remember to write.
alter table pilot.expenses
  add constraint expenses_account_id_treatment_key unique (account_id, id, treatment);

-- A5 TRAVEL-DAY GAP (REVIEW FINDING, MEDIUM): the aviation-expert domain
-- reference is explicit that travel/positioning days are commonly billed
-- at a distinct rate from flight days (often half-to-full the flight-day
-- rate) — a real, separate line item, not a note on the flight-day one.
-- Phase 3/4 had nowhere to source that rate or count from, so Phase 5's
-- 'travel_day' line_type would have had no field to draft its
-- quantity/unit_amount_cents from. Added here, in Phase 5, because
-- invoicing is what exposes the gap — Phase 3/4 had no reason to know it
-- existed.
alter table pilot.trips
  add column if not exists travel_day_count integer not null default 0
    check (travel_day_count >= 0),
  add column if not exists travel_day_rate_cents bigint
    check (travel_day_rate_cents is null or travel_day_rate_cents >= 0);

alter table pilot.clients
  add column if not exists default_travel_day_rate_cents bigint
    check (default_travel_day_rate_cents is null or default_travel_day_rate_cents >= 0);

-- SECOND-PASS REVIEW FINDING (LOW, pre-existing in Phase 3/4, surfaced by
-- Phase 5 testing that actually exercises trip deletion): Phase 3's
-- `expenses_account_id_trip_id_fkey` was `ON DELETE SET NULL` on a
-- COMPOSITE key (account_id, trip_id) with no column list, which means
-- Postgres nulls BOTH referencing columns on delete — including
-- account_id, which is NOT NULL on pilot.expenses. Column-list SET NULL
-- (Postgres 15+) fixes it to null only the column that should actually go
-- null.
--
-- THIRD-PASS REVIEW FINDING (correcting an overclaim, both reviews,
-- live-proven): this fixes deleting a trip whose attached expenses are
-- 'deduct' or 'unassigned'. It does NOT fix — and cannot, without a
-- separate change to the Phase 3 CHECK below — a trip with a 'rebill'
-- expense still attached: `check (treatment <> 'rebill' or trip_id is not
-- null)` on pilot.expenses forbids trip_id from ever going null while
-- treatment='rebill', so the SET NULL this FK performs still fails that
-- CHECK, for every role, on that one treatment. Arguably correct product
-- behavior (a trip still carrying an un-rebilled or unrebillable expense
-- probably shouldn't vanish silently) rather than a bug to fix here — the
-- pilot retags or removes the expense first — but the original comment
-- claimed this fixed deleting a trip with "so much as one expense
-- attached," unqualified, which is not true for the 'rebill' case.
alter table pilot.expenses
  drop constraint expenses_account_id_trip_id_fkey;
alter table pilot.expenses
  add constraint expenses_account_id_trip_id_fkey
  foreign key (account_id, trip_id) references pilot.trips (account_id, id)
  on delete set null (trip_id);

-- ---------------------------------------------------------------------------
-- Per-account sequential invoice numbering. A tenant's own sequence, not a
-- global one — nothing about invoice cadence should be inferable across
-- tenants, and "how many invoices has this pilot sent" is exactly the kind
-- of business signal that must never leak.
-- ---------------------------------------------------------------------------
create table if not exists pilot.invoice_number_sequences (
  account_id uuid primary key references pilot.accounts(id) on delete cascade,
  next_number integer not null default 1 check (next_number > 0)
);

comment on table pilot.invoice_number_sequences is
  'One row per account, created by accounts_seed_invoice_sequence so numbering can never be skipped for a new tenant. Advanced only by pilot.next_invoice_number(), which increments and returns in one atomic UPDATE.';

-- Every account gets a sequence row at creation — mirrors the expiration
-- engine's "cannot forget to wire a new X" discipline from Phase 3/4. If
-- this trigger did not exist, the first invoice draft for a new account
-- would hit a missing-row error instead of failing loudly at the one place
-- it's cheap to guarantee: account creation.
create or replace function pilot.accounts_seed_invoice_sequence()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  insert into pilot.invoice_number_sequences (account_id) values (new.id);
  return new;
end;
$$;

create trigger accounts_seed_invoice_sequence
  after insert on pilot.accounts
  for each row execute function pilot.accounts_seed_invoice_sequence();

-- Backfill: the two accounts already on the live project (Phase 1) predate
-- this trigger.
insert into pilot.invoice_number_sequences (account_id)
select id from pilot.accounts
on conflict (account_id) do nothing;

-- Atomic increment-and-return, SECURITY DEFINER with an explicit in-body
-- tenancy check — NOT the SECURITY INVOKER + bare RLS-policy design this
-- file shipped with originally.
--
-- REVIEW FINDING (CRITICAL, live-Postgres-verified): SECURITY INVOKER here
-- does not work at all. A GRANT and an RLS policy are independent gates —
-- granting UPDATE (next_number) supplies the privilege, but with RLS
-- enabled and NO permissive UPDATE policy on invoice_number_sequences (by
-- design: nothing but this function should ever write it), the row is
-- filtered out and the UPDATE affects ZERO rows. It does not error — `seq`
-- comes back NULL, and the function raises an exception blaming the seed
-- trigger, which had in fact worked correctly. Every authenticated tenant
-- hit this; NO tenant could issue a single invoice. Only service_role
-- (BYPASSRLS) could reach the table at all.
--
-- The fix is SECURITY DEFINER (runs as the function owner, which owns the
-- table — the same table-owner RLS exemption pilot.current_account_ids()
-- and pilot.is_account_owner() already rely on; see the Phase 1 migration's
-- extensive comment on that mechanism) PLUS an explicit tenancy check in
-- the body, because DEFINER bypasses RLS entirely — the function itself
-- becomes the only thing standing between a caller and every account's
-- sequence row. The review demonstrated exactly this as a live exploit
-- against a DEFINER-without-the-check variant: tenant A passing tenant B's
-- account_id got back "BRAVO-2026-0001" (B's private invoice_prefix,
-- disclosed) and silently burned B's sequence. The `not in (select
-- pilot.current_account_ids())` guard below is what closes that — do not
-- remove it under the assumption that DEFINER alone is the fix; DEFINER
-- without the check is a strictly worse cross-tenant primitive than the
-- broken INVOKER version it would replace.
create or replace function pilot.next_invoice_number(target_account_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  seq integer;
  prefix text;
begin
  -- SECOND-PASS REVIEW (both reviews, live-Postgres-proven): `current_user`
  -- inside a SECURITY DEFINER function reports the function OWNER for the
  -- duration of the call, not the role that actually invoked it — this is
  -- standard Postgres behavior, confirmed here empirically (a debug
  -- SECURITY DEFINER function called after `set local role service_role`
  -- reported the owner, not service_role). The original
  -- `current_user <> 'service_role'` check could therefore NEVER match a
  -- real service_role caller, so the exemption was dead code and every
  -- service_role invocation of this function (the webhook/reconciliation
  -- path this file documents throughout) fell through to the membership
  -- check and was rejected — service_role could not issue a single
  -- invoice. `current_setting('role', true)` is not affected the same
  -- way: it reads the session's `role` GUC, set by SET ROLE (how
  -- PostgREST/Supabase switch role per request), which persists correctly
  -- into a SECURITY DEFINER function's execution — confirmed the same
  -- way. Also switched `not in` to `not exists`: `not in` against a set
  -- that could ever contain NULL fails OPEN (the whole condition
  -- evaluates to NULL, so the guard silently never fires) — not reachable
  -- today since account_members.account_id is NOT NULL, but `not exists`
  -- costs nothing and removes the fragility outright.
  if coalesce(current_setting('role', true), '') <> 'service_role'
     and not exists (
       select 1 from pilot.current_account_ids() a where a = target_account_id
     )
  then
    raise exception 'not a member of account %', target_account_id;
  end if;

  update pilot.invoice_number_sequences
    set next_number = next_number + 1
    where account_id = target_account_id
    returning next_number - 1 into seq;

  if seq is null then
    raise exception 'no invoice sequence row for account %; the accounts_seed_invoice_sequence trigger should have created one', target_account_id;
  end if;

  -- INTO STRICT: a NULL invoice_prefix would otherwise concatenate to a
  -- silent NULL invoice_number (SQL NULL-propagation on ||), and an issued,
  -- immutable invoice with no number is a support incident, not an error
  -- anyone sees at write time. STRICT turns "no row" into a loud exception
  -- instead — target_account_id not existing is already excluded by the
  -- membership check above, so this can only fire on a genuine data bug.
  select invoice_prefix into strict prefix from pilot.accounts where id = target_account_id;

  return prefix || '-' || to_char(now(), 'YYYY') || '-' || lpad(seq::text, 4, '0');
end;
$$;

comment on function pilot.next_invoice_number(uuid) is
  'SECURITY DEFINER with an explicit current_account_ids() membership check in the body — DEFINER bypasses RLS, so the check IS the tenancy boundary here, not decoration. Never remove it; never grant this to anon.';

-- ---------------------------------------------------------------------------
-- invoices — the header. No stored subtotal/tax/total: those are ALWAYS
-- computed from invoice_lines by pilot.invoice_totals below. Storing a
-- second copy is exactly the FlightDeptPro P&L-vs-payments-ledger defect
-- (C2: two sources for one number is a defect) — their P&L read -$50k while
-- their own payments ledger, summing the same underlying transactions
-- differently, read ~$580k collected.
-- ---------------------------------------------------------------------------
create table if not exists pilot.invoices (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references pilot.accounts(id) on delete cascade,
  client_id uuid not null,
  foreign key (account_id, client_id) references pilot.clients (account_id, id) on delete restrict,
  -- Assigned once, on the transition out of draft — see
  -- invoices_assign_number_on_issue below. A draft invoice has no number:
  -- numbering a document that might still be discarded burns sequence
  -- integers for nothing and makes "why did INV-2026-0004 never get sent"
  -- a support question instead of a non-event.
  --
  -- REVIEW FINDING (CRITICAL, live-verified): this was a bare column-level
  -- `unique`, spanning every tenant in the table. Every account defaults to
  -- invoice_prefix='INV' and every per-account sequence starts at 1, so two
  -- tenants deterministically generate the identical string, and whichever
  -- issues their Nth invoice of a year SECOND gets a hard 23505 duplicate-
  -- key error — with the shipped default that's tenant #2's very first
  -- invoice. Worse, a 23505-vs-success split is a cross-tenant existence
  -- oracle: an attacker can walk ACME-2026-0001, -0002, ... and count
  -- collisions to recover a competitor's annual invoice volume, exactly the
  -- signal this file's own header says must never leak. Scoped to
  -- (account_id, invoice_number) below instead — see the table-level
  -- constraint at the bottom of this table definition.
  invoice_number text,
  status text not null default 'draft'
    check (status in ('draft', 'sent', 'partial', 'paid', 'void')),
  -- Deliberately NOT storing an 'overdue' status. Overdue is a function of
  -- (status, due_on, now()) — the pilot.invoices_overdue view derives it.
  -- A stored status you must remember to flip nightly is the second read of
  -- FlightDeptPro's lesson: a fleet card said READY while the alert engine
  -- said overdue, because two code paths tracked one fact.
  issued_on date,
  -- Snapshotted from the client's payment_terms_days AT ISSUE TIME. The
  -- client's terms may change later; an already-issued invoice's due date
  -- must not retroactively move.
  due_on date,
  check (issued_on is null or due_on is null or due_on >= issued_on),
  sent_at timestamptz,
  -- REVIEW FINDING (HIGH, C3 cash-basis defect): this table used to carry
  -- `paid_at timestamptz` and `amount_paid_cents bigint`, overwritten in
  -- place on every payment. That collapses to exactly one payment event
  -- per invoice — a partial payment landing in December followed by the
  -- balance in January has no way to record two dates, so a cash-basis
  -- "Paid This Year" report (which must sum by the date money actually
  -- arrived) cannot be computed correctly across a tax-year boundary from
  -- a single overwritten field. Moved to a genuine dated ledger,
  -- pilot.invoice_payments (one row per payment, defined below).
  -- amount_paid_cents and the latest paid_on are DERIVED in
  -- pilot.invoice_totals, never stored here — one source for "how much has
  -- been paid" (C2), dated correctly by construction.
  -- State sales/service tax where a pilot's state requires it on
  -- professional services. NOT federal excise tax — see the file header.
  -- Basis points (1/100 of a percent) so e.g. 8.25% stores exactly as 825,
  -- with no float rounding anywhere near money.
  --
  -- REVIEW FINDING (LOW 14): bound tightened from 0-10000 (0-100%) to
  -- 0-2500 (0-25%) — no US state sales/service tax on professional
  -- services comes anywhere near 25%, so this catches an order-of-
  -- magnitude fat-finger (e.g. entering 8250 instead of 825 for 8.25%)
  -- that the old ceiling was too generous to reject.
  tax_rate_bps integer not null default 0 check (tax_rate_bps >= 0 and tax_rate_bps <= 2500),
  delivery_method text
    check (delivery_method is null or delivery_method in ('platform_email', 'manual_download')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (account_id, id),
  -- Per-tenant uniqueness, not global — see the invoice_number column
  -- comment above. Multiple NULLs (drafts) are fine: Postgres treats NULL
  -- as distinct from NULL in a unique constraint by default, so any number
  -- of undrafted, unnumbered invoices coexist under one account.
  unique (account_id, invoice_number)
);

comment on table pilot.invoices is
  'A5: auto-drafted from a trip''s facts, reviewed and sent by the pilot — never sent silently (mirrors the logbook draft-confirm rule). Immutable once out of draft; see invoices_protect_issued below.';

-- ---------------------------------------------------------------------------
-- invoice_lines — flight days x rate, travel days x rate, per diem x days,
-- reimbursable expenses, cancellation fees, or a free-text line. amount_cents
-- is GENERATED, never entered: quantity x unit_amount_cents is the only
-- source, so a line's total can never drift from its own inputs (the
-- integrity-first pattern this schema family has used since Phase 3/4).
-- ---------------------------------------------------------------------------
create table if not exists pilot.invoice_lines (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references pilot.accounts(id) on delete cascade,
  invoice_id uuid not null,
  foreign key (account_id, invoice_id) references pilot.invoices (account_id, id) on delete cascade,
  -- Vocabulary from the aviation-expert domain reference (contract-pilot
  -- invoicing norms), not invented: flight/duty days and travel/positioning
  -- days are commonly billed at different rates, per diem is a flat daily
  -- meal rate distinct from itemized reimbursement, and short-notice
  -- cancellation fees are a named, common line item in written day-rate
  -- agreements.
  line_type text not null
    check (line_type in ('flight_day', 'travel_day', 'per_diem',
                         'reimbursable_expense', 'cancellation_fee', 'other')),
  description text not null,
  quantity numeric(6,2) not null default 1 check (quantity > 0),
  unit_amount_cents bigint not null check (unit_amount_cents >= 0),
  amount_cents bigint generated always as (round(quantity * unit_amount_cents)::bigint) stored,
  -- C10 (REVIEW FINDING, MEDIUM): FlightDeptPro's audit flags tax support
  -- bolted on late as a defect class. A day-rate/travel-day line is
  -- typically taxable as a service; a straight expense reimbursement
  -- (per_diem, reimbursable_expense) commonly is not, depending on the
  -- pilot's state — that distinction has to exist per-line, not as one
  -- invoice-wide flag, or the tax figure is wrong the moment an invoice
  -- mixes taxable and non-taxable lines. Defaults true; the app is
  -- responsible for setting it false on per_diem and reimbursable_expense
  -- lines per the pilot's own state rules (state tax treatment varies and
  -- is out of this schema's scope to hardcode). pilot.invoice_totals below
  -- computes tax_cents from taxable lines only.
  taxable boolean not null default true,
  trip_id uuid,
  foreign key (account_id, trip_id) references pilot.trips (account_id, id) on delete restrict,
  expense_id uuid,
  -- A3 ENFORCEMENT (see the ALTER TABLE pilot.expenses near the top of this
  -- file): expense_treatment must equal the expense's OWN treatment value
  -- at reference time, and the composite FK below is what makes that true
  -- both at insert and for the life of the reference — see that comment
  -- for the full mechanism.
  expense_treatment text,
  check (expense_treatment is null or expense_treatment = 'rebill'),
  check ((expense_id is not null) = (expense_treatment is not null)),
  foreign key (account_id, expense_id, expense_treatment)
    references pilot.expenses (account_id, id, treatment) on delete restrict,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  -- A reimbursable_expense line must actually reference the expense it
  -- rebills, and nothing else may. Without this, "reimbursable_expense"
  -- becomes a free-text label disconnected from the ledger it claims to
  -- summarize — the exact ambiguity A3 exists to prevent.
  check ((line_type = 'reimbursable_expense') = (expense_id is not null)),
  unique (account_id, id),
  -- An expense can appear on at most one invoice, full stop. Without this,
  -- the same hotel receipt could be rebilled on two invoices with nothing
  -- in the schema to catch it — a real double-billing bug class, not a
  -- theoretical one.
  unique (account_id, expense_id)
);

comment on table pilot.invoice_lines is
  'A3: the expense treatment tag is set once at capture (pilot.expenses.treatment) and this table only CONSUMES that decision via expense_id — it never re-asks rebill-vs-deduct.';

-- ---------------------------------------------------------------------------
-- invoice_payments — the cash-basis ledger. One row per payment, dated by
-- when the money actually arrived (paid_on, a date — not the timestamptz
-- the old single-field design used). This is what makes C3 possible: a
-- partial payment in December and the balance in January are two rows with
-- two dates, so a cash-basis "Paid This Year" report sums correctly across
-- the tax-year boundary, and pilot.invoice_totals derives both
-- amount_paid_cents and last_paid_on from this table rather than storing
-- either on pilot.invoices (see that table's sent_at comment).
--
-- No update/delete grant to authenticated below: a payment, once recorded,
-- is a ledger entry, not a draft — correcting a mis-entered payment is a
-- support/service_role operation, out of scope for the self-serve app
-- surface in this phase.
-- ---------------------------------------------------------------------------
create table if not exists pilot.invoice_payments (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references pilot.accounts(id) on delete cascade,
  invoice_id uuid not null,
  foreign key (account_id, invoice_id) references pilot.invoices (account_id, id) on delete restrict,
  -- SECOND-PASS REVIEW FINDING (LOW): bounded to the near-past/today — a
  -- payment dated in the future isn't a payment yet, and an unbounded
  -- date let a single fat-fingered entry (e.g. year 2099) permanently
  -- distort the C3 cash-basis ledger with no self-serve correction path
  -- (see the table comment above: no update/delete grant to authenticated).
  --
  -- THIRD-PASS REVIEW FINDING (LOW, both reviews): `current_date`
  -- resolves in the DATABASE session's timezone (UTC on Supabase), not
  -- the pilot's own. A pilot east of UTC recording a genuine same-day
  -- payment could see the server's "today" as still yesterday, and get
  -- rejected — live-proven up to ~14h/day for the UTC+14 extreme.
  -- `current_date + 1` keeps the fat-finger protection (year 2099 is
  -- still rejected) while absorbing the full worldwide timezone spread.
  paid_on date not null check (paid_on <= current_date + 1),
  amount_cents bigint not null check (amount_cents > 0),
  method text check (method is null or method in ('ach', 'check', 'wire', 'card', 'cash', 'other')),
  notes text,
  created_at timestamptz not null default now(),
  unique (account_id, id)
);

comment on table pilot.invoice_payments is
  'C3: one row per payment, dated. pilot.invoice_totals sums this to derive amount_paid_cents and last_paid_on — never stored on pilot.invoices itself.';

-- A payment only ever makes sense against an invoice that has actually
-- been sent and is not yet fully settled. 'draft' has nothing committed to
-- pay yet; 'paid' is terminal (an overpayment/refund correction is a
-- service_role operation, not a self-serve one, matching the no-update/
-- delete grant above); 'void' owes nothing by definition.
create or replace function pilot.invoice_payments_validate()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  invoice_status text;
begin
  if current_user = 'service_role' or current_setting('role', true) = 'service_role' then
    return new;
  end if;
  -- THIRD-PASS REVIEW FINDING (MEDIUM, both reviews, live-proven): this
  -- lookup took no lock while invoice_lines_protect_issued's identically-
  -- shaped lookups were given `for share` — the one left unlocked is the
  -- one guarding real money. A payment INSERT's own FK to pilot.invoices
  -- takes only FOR KEY SHARE, which does not conflict with a concurrent
  -- status UPDATE, so an invoice being voided and a payment being
  -- recorded against it could each read the other's pre-write state and
  -- both commit — a payment landing on a dead invoice, in a table with no
  -- self-serve UPDATE/DELETE grant to fix it afterward.
  select status into invoice_status from pilot.invoices
    where account_id = new.account_id and id = new.invoice_id
    for share;
  if invoice_status is null or invoice_status not in ('sent', 'partial') then
    raise exception 'invoice % (status=%) cannot receive a payment', new.invoice_id, invoice_status;
  end if;
  return new;
end;
$$;

create trigger invoice_payments_validate
  before insert on pilot.invoice_payments
  for each row execute function pilot.invoice_payments_validate();

-- ---------------------------------------------------------------------------
-- Immutability once issued (A5's "nothing is sent silently" cuts both ways:
-- once sent, it also can't be silently CHANGED under the recipient). Draft
-- rows are freely editable. Everything else may only move status forward
-- and record payment facts — not rewrite what was billed.
--
-- This is also the C1 "no silent write failures" quality bar in the other
-- direction: FlightDeptPro's worst defect was a write that silently did
-- nothing and returned 200. The trigger below is the opposite failure mode
-- guarded against — a write that silently DOES something it must not. Both
-- get a loud, specific error; neither gets a quiet no-op.
-- ---------------------------------------------------------------------------
-- REVIEW FINDING (HIGH, live-verified): nothing stopped an INSERT from
-- creating a row already in status='sent'/'partial'/'paid' with a
-- fabricated invoice_number — invoices_protect_issued only fires BEFORE
-- UPDATE, and invoices_assign_number_on_issue's number assignment also
-- only fires on the draft-to-non-draft UPDATE transition; NEITHER trigger
-- runs on INSERT, so nothing stood between a client and the table on a
-- first write. Force every non-service_role INSERT to the one state
-- that's ever actually meaningful at creation: unnumbered draft.
create or replace function pilot.invoices_force_draft_on_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user = 'service_role' or current_setting('role', true) = 'service_role' then
    return new; -- reconciliation/import paths, not used by app code today
  end if;
  -- SECOND-PASS REVIEW FINDING (LOW): previously silently coerced
  -- status/invoice_number/sent_at back to safe defaults instead of
  -- rejecting the attempt outright. The column-scoped INSERT grant below
  -- already makes this unreachable for 'authenticated' (it cannot even
  -- specify these columns) — silent coercion could only ever fire for
  -- some OTHER privileged caller (e.g. a superuser doing manual ops in
  -- the SQL editor), and a write that silently does something other than
  -- what was asked is exactly the C1 failure mode this schema exists to
  -- avoid in the other direction (see the header comment above
  -- invoices_protect_issued). A loud rejection is safe here precisely
  -- because the grant already prevents any legitimate caller from ever
  -- reaching it.
  if new.status is distinct from 'draft'
     or new.invoice_number is not null
     or new.sent_at is not null
  then
    raise exception 'invoice insert for account % cannot set status/invoice_number/sent_at directly', new.account_id;
  end if;
  return new;
end;
$$;

create trigger invoices_force_draft_on_insert
  before insert on pilot.invoices
  for each row execute function pilot.invoices_force_draft_on_insert();

-- SECOND-PASS REVIEW (two independent Opus-high passes, both live-Postgres
-- verified) found this function had TWO further bugs after the first fix
-- pass, both now closed below:
--
-- HIGH — the "deny-by-default" column check was, on inspection, an
-- ALLOW-list masquerading as one: `if <any allowed column changed> then
-- return new` approves the ENTIRE row, not just the columns that changed.
-- A client could rewrite tax_rate_bps, client_id, issued_on, or due_on on
-- an issued invoice by piggybacking the same UPDATE statement on an edit
-- to notes/sent_at/delivery_method/status — proven live by both reviews,
-- independently. This is structurally the exact `delivery_method` hole
-- the comment below claims to have fixed, reintroduced in the opposite
-- direction. Fixed by asserting the FORBIDDEN columns are unchanged,
-- which is what "deny by default" actually requires.
--
-- HIGH — `if old.status = 'draft' then return new` ran before the
-- transition table was ever consulted, so a draft could jump straight to
-- 'paid' or 'partial' — skipping being sent entirely, with zero payment —
-- and then get stuck there permanently: 'paid' has no outbound
-- transition, and invoice_payments_validate refuses payments against a
-- 'paid' invoice, so there was no self-serve recovery. Fixed by making
-- 'draft' a source in the SAME transition table (allowed destinations:
-- 'sent' or 'void' only, matching the invoices.status comment's own
-- description of void as how a draft is abandoned) instead of a bypass
-- that skips transition validation altogether.
create or replace function pilot.invoices_protect_issued()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- THIRD-PASS REVIEW FINDING (LOW, both reviews): `current_setting('role',
  -- true)` only reflects a role reached via SET ROLE (how PostgREST
  -- switches role per request over a pooled connection) — a service_role
  -- session that connects DIRECTLY, with no SET ROLE ever issued, reports
  -- the GUC as unset/'none', not 'service_role'. `current_user` is correct
  -- for exactly that direct-connection case (this function is SECURITY
  -- INVOKER, so current_user is never overridden here the way it is
  -- inside next_invoice_number's SECURITY DEFINER). Checking both covers
  -- both connection shapes; used the same way in every function below
  -- that needs a service_role exemption.
  if current_user = 'service_role' or current_setting('role', true) = 'service_role' then
    return new; -- webhook/service paths (e.g. payment reconciliation) are exempt
  end if;

  -- Forward-only state machine, 'draft' included as a source. 'paid' and
  -- 'void' are terminal: neither appears on the left. A same-status write
  -- (old.status = new.status, e.g. touching notes without flipping
  -- status) skips this block entirely and falls through to the column
  -- check below.
  if new.status is distinct from old.status then
    if not (
      (old.status = 'draft'   and new.status in ('sent', 'void')) or
      (old.status = 'sent'    and new.status in ('partial', 'paid', 'void')) or
      (old.status = 'partial' and new.status in ('paid', 'void'))
    ) then
      raise exception 'invoice % cannot move from status % to %', old.id, old.status, new.status;
    end if;

    if old.status = 'draft' and new.status = 'sent' then
      -- An invoice with no line items has nothing to bill and nothing to
      -- draft a PDF from — catch it at the one moment it matters (leaving
      -- draft) rather than downstream.
      if not exists (
        select 1 from pilot.invoice_lines where account_id = new.account_id and invoice_id = new.id
      ) then
        raise exception 'invoice % cannot be sent with no line items', new.id;
      end if;

      -- THIRD-PASS REVIEW FINDING (HIGH, both reviews, live-proven):
      -- invoice_lines_validate_trip only checks client match at the
      -- moment a LINE is written. client_id itself is freely editable
      -- while draft (by design — see below), so a draft could attach
      -- lines for Client A's trips, then have its OWN client_id switched
      -- to Client B — in the very same UPDATE that also flips status to
      -- 'sent' — with nothing re-checking the lines already on it. This
      -- re-validates every existing line's resolved trip (its own
      -- trip_id, or its expense's) against the FINAL client_id at the one
      -- moment the invoice becomes immutable, closing that gap
      -- regardless of how many separate edits got it there.
      if exists (
        select 1
        from pilot.invoice_lines l
        left join pilot.expenses e on e.account_id = l.account_id and e.id = l.expense_id
        left join pilot.trips t on t.account_id = l.account_id and t.id = coalesce(l.trip_id, e.trip_id)
        where l.account_id = new.account_id and l.invoice_id = new.id
          and coalesce(l.trip_id, e.trip_id) is not null
          and t.client_id is distinct from new.client_id
      ) then
        raise exception 'invoice % cannot be sent: one or more line items'' trips belong to a different client', new.id;
      end if;
    end if;

    -- MEDIUM 11 (REVIEW FINDING, tightened twice): the original check
    -- only asked "does at least one payment row exist" — a single
    -- one-cent payment satisfied it against an invoice of any size, and
    -- once 'paid' there is no way back. pilot.invoice_totals is this
    -- schema's own single source for the balance (C2); use it rather than
    -- re-deriving the arithmetic here. Querying it from a BEFORE trigger
    -- on the same table is safe: the view's join back to pilot.invoices
    -- sees this row's PRE-update state, which is what we want, since
    -- tax_rate_bps cannot itself be changing in this same statement once
    -- issued (enforced by the column check below).
    --
    -- THIRD-PASS REVIEW FINDING (MEDIUM): 'paid' required
    -- balance_due_cents to equal exactly zero, which permanently traps
    -- any overpayment (a wire fee, a rounding-up remittance, a duplicate
    -- payment) — the invoice can never reach 'paid', 'void' is the wrong
    -- correction (it isn't void, it's overpaid, and voiding also flips
    -- pilot.trips.billing_state back toward unbilled), and there is no
    -- self-serve way to edit or delete a pilot.invoice_payments row.
    -- balance_due_cents <= 0 accepts "paid in full or more" while still
    -- refusing "paid" on a genuinely outstanding balance.
    if new.status in ('partial', 'paid') then
      declare
        paid_cents bigint;
        due_cents bigint;
      begin
        select amount_paid_cents, balance_due_cents into paid_cents, due_cents
          from pilot.invoice_totals where invoice_id = new.id;
        if coalesce(paid_cents, 0) <= 0 then
          raise exception 'invoice % cannot become status=% with no recorded payment', new.id, new.status;
        end if;
        if new.status = 'paid' and coalesce(due_cents, 0) > 0 then
          raise exception 'invoice % cannot become paid with a nonzero balance due (%)', new.id, due_cents;
        end if;
      end;
    end if;
  end if;

  if old.status = 'draft' then
    return new; -- draft rows are otherwise freely editable
  end if;

  -- THIRD-PASS REVIEW FINDING (MEDIUM): the prior version enumerated the
  -- forbidden columns explicitly — correct today, but exactly the
  -- "enumerate and forget" failure mode this file has already been bitten
  -- by twice (a denylist, then an allow-list standing in for one). A
  -- FUTURE column added to pilot.invoices (e.g. by a later migration)
  -- would be mutable-on-an-issued-invoice by default unless someone
  -- remembered to add it here. Structural instead: diff the whole row,
  -- minus the columns that stay writable, so a new column is protected
  -- the moment it exists, with zero chance to forget. updated_at is
  -- excluded because invoices_set_updated_at fires AFTER this trigger
  -- (alphabetical BEFORE-trigger order) and is the only thing that ever
  -- writes it, so by the time we get here it still holds its pre-update
  -- value regardless of what the client sent.
  if to_jsonb(new) - array['status', 'sent_at', 'delivery_method', 'notes', 'updated_at']
     is distinct from
     to_jsonb(old) - array['status', 'sent_at', 'delivery_method', 'notes', 'updated_at']
  then
    raise exception 'invoice % is issued (status=%) and cannot be modified except status/sent_at/delivery_method/notes', old.id, old.status;
  end if;

  return new;
end;
$$;

create trigger invoices_protect_issued
  before update on pilot.invoices
  for each row execute function pilot.invoices_protect_issued();

-- REVIEW FINDING (HIGH, live-verified): the original version looked up
-- only `coalesce(new.invoice_id, old.invoice_id)` — on UPDATE that's just
-- new.invoice_id whenever it's non-null, i.e. only the DESTINATION
-- invoice. Reparenting a line FROM an issued invoice ONTO a draft one
-- (`update pilot.invoice_lines set invoice_id = <some draft's id> where id
-- = <line on an issued invoice>`) checked the draft's status, found
-- 'draft', and allowed it — silently detaching a line from an issued,
-- supposedly-immutable invoice, because invoices_protect_issued only
-- guards the invoices table and never fires for a write against
-- invoice_lines. Fixed by checking BOTH the line's origin invoice and its
-- destination invoice on UPDATE, and by qualifying every lookup with
-- account_id (not just id) per the review's LOW-9 note — belt-and-braces
-- given the composite FK already guarantees same-tenant, but this
-- function runs SECURITY INVOKER (no `security definer` above) so RLS
-- applies regardless; the qualifier costs nothing and removes any
-- reliance on that being true.
-- SECOND-PASS REVIEW (MEDIUM, live-proven TOCTOU): the status lookups
-- below took no lock, so two concurrent sessions — one issuing an
-- invoice, one adding/deleting one of its lines — could each act on a
-- stale 'draft' read and both commit, landing a mutation on an
-- already-issued invoice. `for share` on every lookup conflicts with the
-- row lock an invoices status UPDATE takes internally, so the two now
-- serialize instead of racing: whichever commits first determines what
-- the other sees.
--
-- SECOND-PASS REVIEW (MEDIUM, both reviews, live-proven): the DELETE
-- branch used to allow only 'draft'. A voided invoice's stranded
-- reimbursable line could then never be removed — `unique
-- (account_id, expense_id)` on this table permanently blocked
-- re-referencing that expense, contradicting invoice_lines_validate_trip's
-- own documented void-and-reissue correction path below. 'void' is now
-- also a valid DELETE target: a void invoice's lines carry no billing
-- meaning, so removing them (freeing the expense/trip to be rebilled) is
-- cleanup, not a rewrite of history. INSERT and UPDATE still require
-- 'draft' — you don't add or edit lines on a dead invoice, only remove
-- them.
create or replace function pilot.invoice_lines_protect_issued()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  old_invoice_status text;
  new_invoice_status text;
begin
  if current_user = 'service_role' or current_setting('role', true) = 'service_role' then
    return coalesce(new, old);
  end if;

  if tg_op = 'DELETE' then
    select status into old_invoice_status from pilot.invoices
      where account_id = old.account_id and id = old.invoice_id
      for share;
    if coalesce(old_invoice_status, 'draft') in ('draft', 'void') then
      return old;
    end if;
    raise exception 'invoice lines cannot be deleted once the invoice (status=%) has left draft', old_invoice_status;
  end if;

  if tg_op = 'INSERT' then
    select status into new_invoice_status from pilot.invoices
      where account_id = new.account_id and id = new.invoice_id
      for share;
    if coalesce(new_invoice_status, 'draft') = 'draft' then
      return new;
    end if;
    raise exception 'invoice lines cannot be added once the invoice (status=%) has left draft', new_invoice_status;
  end if;

  -- UPDATE: both sides must be draft. A line that isn't being reparented
  -- has old.invoice_id = new.invoice_id, so this checks the same invoice
  -- twice, which is harmless.
  select status into old_invoice_status from pilot.invoices
    where account_id = old.account_id and id = old.invoice_id
    for share;
  select status into new_invoice_status from pilot.invoices
    where account_id = new.account_id and id = new.invoice_id
    for share;

  if coalesce(old_invoice_status, 'draft') <> 'draft' then
    raise exception 'invoice lines cannot change once the invoice (status=%) has left draft', old_invoice_status;
  end if;
  if coalesce(new_invoice_status, 'draft') <> 'draft' then
    raise exception 'invoice lines cannot be reparented onto invoice % (status=%)', new.invoice_id, new_invoice_status;
  end if;

  return new;
end;
$$;

create trigger invoice_lines_protect_issued
  before insert or update or delete on pilot.invoice_lines
  for each row execute function pilot.invoice_lines_protect_issued();

-- MEDIUM (REVIEW FINDING): nothing stopped the same trip being billed on
-- two different live invoices (an operator gets billed twice for one
-- job), and nothing checked that a trip's own client matches the invoice
-- it's being billed on (a trip flown for Client A could be billed to
-- Client B). Both are plain data-integrity bugs, not access-control ones,
-- so this runs for every role including service_role — there is no
-- legitimate reason to bypass it.
--
-- SECOND-PASS REVIEW (MEDIUM, both reviews, live-proven): the original
-- version only ever looked at new.trip_id and returned immediately when it
-- was null. But a reimbursable_expense line's trip_id is null BY
-- CONSTRUCTION — see the CHECK pairing line_type/expense_id on this table
-- — so every rebilled-expense line bypassed BOTH checks below entirely: a
-- hotel receipt from Client A's trip could be rebilled straight onto
-- Client B's invoice, and the same trip's expenses could be split across
-- two live invoices with nothing to catch it. Fixed by resolving the trip
-- to validate against — the line's own trip_id, or (for a reimbursable
-- line) the trip of the EXPENSE it rebills — once, up front.
--
-- SECOND-PASS REVIEW (MEDIUM, live-proven TOCTOU): the double-bill check
-- below is a plain SELECT-then-decide with no lock, so two concurrent
-- INSERTs attaching the same trip to two DIFFERENT draft invoices could
-- each read "no conflict yet" and both commit. Serialized below via an
-- advisory lock keyed on the trip.
--
-- THIRD-PASS REVIEW FINDING (MEDIUM, live-proven deadlock, both reviews):
-- the second-pass fix used `select ... for update` — a REAL row lock on
-- pilot.trips. Combined with invoice_lines_protect_issued's `for share`
-- on pilot.invoices (which fires first, alphabetically, in the same
-- statement) and invoices_sync_trip_billing_state's write to pilot.trips
-- (an AFTER trigger on a completely different statement), two ordinary,
-- unrelated, fully grant-legal operations — issuing an invoice while
-- someone edits the trip it references, or issuing one invoice while a
-- second invoice's line references the same trip — could each hold a
-- lock the other needs, in opposite orders, and deadlock. Reproduced live
-- twice against the second-pass version. A `pg_advisory_xact_lock` lives
-- in its own lock namespace entirely, so it can never participate in a
-- cycle with a real row lock taken by an ordinary UPDATE on pilot.trips
-- (or anywhere else) — it still fully serializes two concurrent callers
-- of THIS function against the same trip (the actual invariant this lock
-- exists to protect), which is all that's required.
create or replace function pilot.invoice_lines_validate_trip()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  check_trip_id uuid;
  trip_client_id uuid;
  invoice_client_id uuid;
  conflicting_invoice_id uuid;
begin
  if new.trip_id is not null then
    check_trip_id := new.trip_id;
  elsif new.expense_id is not null then
    select trip_id into check_trip_id from pilot.expenses
      where account_id = new.account_id and id = new.expense_id;
  end if;

  if check_trip_id is null then
    return new;
  end if;

  -- Transaction-scoped advisory lock, released automatically at commit
  -- or rollback — never held across statements or requests. Keyed on
  -- (account_id, trip_id) via two independent hashes (the two-int4 form
  -- of pg_advisory_xact_lock) rather than one hash of the concatenation,
  -- for a materially lower collision rate across the full account x trip
  -- space.
  perform pg_advisory_xact_lock(hashtext(new.account_id::text), hashtext(check_trip_id::text));

  select client_id into trip_client_id from pilot.trips
    where account_id = new.account_id and id = check_trip_id;
  select client_id into invoice_client_id from pilot.invoices
    where account_id = new.account_id and id = new.invoice_id;

  if trip_client_id is distinct from invoice_client_id then
    raise exception 'trip % belongs to a different client than invoice %', check_trip_id, new.invoice_id;
  end if;

  -- A trip normally generates several lines on the SAME invoice (a
  -- flight_day line, a travel_day line, a per_diem line, a rebilled
  -- expense) — that's not a conflict. The conflict is the same trip's
  -- billing spread across a DIFFERENT invoice that is still live. 'void'
  -- is excluded deliberately: voiding a mis-issued invoice and re-billing
  -- the same trip on a fresh one is the normal correction path, not a
  -- double-bill. Each OTHER line's trip is resolved the same way (its own
  -- trip_id, or its expense's trip_id) via the left join below.
  select l.invoice_id into conflicting_invoice_id
    from pilot.invoice_lines l
    join pilot.invoices i on i.account_id = l.account_id and i.id = l.invoice_id
    left join pilot.expenses e on e.account_id = l.account_id and e.id = l.expense_id
    where l.account_id = new.account_id
      and coalesce(l.trip_id, e.trip_id) = check_trip_id
      and l.invoice_id <> new.invoice_id
      and i.status <> 'void'
    limit 1;

  if conflicting_invoice_id is not null then
    raise exception 'trip % is already billed on invoice % and cannot also appear on invoice %',
      check_trip_id, conflicting_invoice_id, new.invoice_id;
  end if;

  return new;
end;
$$;

create trigger invoice_lines_validate_trip
  before insert or update on pilot.invoice_lines
  for each row execute function pilot.invoice_lines_validate_trip();

-- SECOND-PASS REVIEW FINDING (MEDIUM): pilot.trips.client_id is
-- grant-writable (Phase 3/4), and invoice_lines_validate_trip above only
-- checks the trip/invoice client match at WRITE time — nothing re-checks
-- it if a trip's client is reassigned AFTER a line already references the
-- trip on a live invoice. Reject that reassignment instead of leaving an
-- issued, immutable invoice silently attributed to the wrong client.
create or replace function pilot.trips_protect_billed_client()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  conflicting_invoice_id uuid;
begin
  if new.client_id is not distinct from old.client_id then
    return new;
  end if;
  select l.invoice_id into conflicting_invoice_id
    from pilot.invoice_lines l
    join pilot.invoices i on i.account_id = l.account_id and i.id = l.invoice_id
    left join pilot.expenses e on e.account_id = l.account_id and e.id = l.expense_id
    where l.account_id = old.account_id
      and coalesce(l.trip_id, e.trip_id) = old.id
      and i.status <> 'void'
    limit 1;
  if conflicting_invoice_id is not null then
    raise exception 'trip % is billed on invoice % and its client cannot be reassigned', old.id, conflicting_invoice_id;
  end if;
  return new;
end;
$$;

create trigger trips_protect_billed_client
  before update of client_id on pilot.trips
  for each row execute function pilot.trips_protect_billed_client();

-- THIRD-PASS REVIEW FINDING (HIGH, both reviews, live-proven): the guard
-- above protects trips.client_id, but invoice_lines_validate_trip resolves
-- a reimbursable_expense line's trip via the EXPENSE's own trip_id, not
-- the line's — and pilot.expenses.trip_id is grant-writable (Phase 3/4)
-- with nothing protecting it once the expense is rebilled. Moving an
-- already-rebilled expense onto a DIFFERENT trip is the identical attack
-- surface as reassigning trips.client_id directly: it defeats the
-- cross-client check retroactively on an issued, immutable invoice, can
-- put the SAME trip on two live invoices at once (defeating the
-- double-bill guard the same way), and leaves invoices_sync_trip_billing_
-- state resolving a now-ambiguous trip. Same mechanism, same protection.
create or replace function pilot.expenses_protect_billed_trip()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  conflicting_invoice_id uuid;
begin
  if new.trip_id is not distinct from old.trip_id then
    return new;
  end if;
  select l.invoice_id into conflicting_invoice_id
    from pilot.invoice_lines l
    join pilot.invoices i on i.account_id = l.account_id and i.id = l.invoice_id
    where l.account_id = old.account_id
      and l.expense_id = old.id
      and i.status <> 'void'
    limit 1;
  if conflicting_invoice_id is not null then
    raise exception 'expense % is billed on invoice % and its trip cannot be reassigned', old.id, conflicting_invoice_id;
  end if;
  return new;
end;
$$;

create trigger expenses_protect_billed_trip
  before update of trip_id on pilot.expenses
  for each row execute function pilot.expenses_protect_billed_trip();

-- SECOND-PASS REVIEW FINDING (LOW/C2): pilot.trips.billing_state
-- (unbilled/invoiced/paid/written_off, Phase 3/4) had no path back from
-- invoicing at all — proven live to stay 'unbilled' forever even after an
-- invoice referencing the trip is fully paid, which is exactly the "two
-- sources for one number" defect class this file quotes six times over.
-- Synced here, on every invoice status change, for every trip its lines
-- touch (directly or via a rebilled expense) — recomputed from the
-- CURRENT set of live (non-void) invoice references rather than trusted
-- from the single invoice that triggered the write, since a trip could in
-- principle be referenced from more than one line. A manually
-- 'written_off' trip is never overwritten by this sync.
create or replace function pilot.invoices_sync_trip_billing_state()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  r record;
  live_status text;
begin
  if new.status is distinct from old.status then
    for r in
      select distinct coalesce(l.trip_id, e.trip_id) as trip_id
      from pilot.invoice_lines l
      left join pilot.expenses e on e.account_id = l.account_id and e.id = l.expense_id
      where l.account_id = new.account_id and l.invoice_id = new.id
        and coalesce(l.trip_id, e.trip_id) is not null
    loop
      select i.status into live_status
        from pilot.invoice_lines l2
        join pilot.invoices i on i.account_id = l2.account_id and i.id = l2.invoice_id
        left join pilot.expenses e2 on e2.account_id = l2.account_id and e2.id = l2.expense_id
        where l2.account_id = new.account_id
          and coalesce(l2.trip_id, e2.trip_id) = r.trip_id
          and i.status <> 'void'
        limit 1;

      update pilot.trips set billing_state = case
          when live_status = 'paid' then 'paid'
          when live_status is not null then 'invoiced'
          else 'unbilled'
        end
        where account_id = new.account_id and id = r.trip_id
          and billing_state <> 'written_off';
    end loop;
  end if;
  return new;
end;
$$;

create trigger invoices_sync_trip_billing_state
  after update on pilot.invoices
  for each row execute function pilot.invoices_sync_trip_billing_state();

-- ---------------------------------------------------------------------------
-- Sequence assignment on the draft -> non-draft transition. Kept as a
-- trigger (not application code) so "every issued invoice has exactly one
-- number, assigned exactly once" is a database guarantee, not a convention
-- every call site must remember.
-- ---------------------------------------------------------------------------
create or replace function pilot.invoices_assign_number_on_issue()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- SECOND-PASS REVIEW FINDING (MEDIUM): was `new.status <> 'draft'`,
  -- which also fired on draft -> void — assigning and burning a real
  -- invoice_number for a document that was never sent, directly
  -- contradicting this file's own "a draft invoice has no number" design
  -- note above (numbering something that might be discarded burns
  -- sequence integers for nothing, and produces unexplained gaps in a
  -- sequential series, which reads as a bookkeeping red flag). Now
  -- restricted to specifically the sent transition — the only remaining
  -- destination for a numbered issue, per invoices_protect_issued's
  -- transition table above.
  if old.status = 'draft' and new.status = 'sent' and new.invoice_number is null then
    new.invoice_number := pilot.next_invoice_number(new.account_id);
    if new.issued_on is null then
      new.issued_on := current_date;
    end if;
    if new.due_on is null then
      -- LOW 9 (REVIEW FINDING): scoped by account_id as well as id. The
      -- composite FK on invoices.client_id already guarantees this lookup
      -- can only ever find a same-tenant client, so this is
      -- belt-and-braces rather than a fix for a reachable bug — cheap
      -- enough that there's no reason to rely on the FK alone.
      --
      -- SECOND-PASS REVIEW FINDING (MEDIUM): was `current_date + terms`,
      -- not `new.issued_on + terms` — wrong the moment the two dates
      -- differ (a draft created earlier than it's sent, or a backdated
      -- issued_on). new.issued_on is guaranteed set by the block just
      -- above by the time this runs.
      select new.issued_on + coalesce(c.payment_terms_days, 30) into new.due_on
        from pilot.clients c where c.account_id = new.account_id and c.id = new.client_id;
    end if;
  end if;
  return new;
end;
$$;

-- LOW 15 (REVIEW FINDING): this used to claim it "must run BEFORE
-- invoices_protect_issued... for its NEW.invoice_number assignment to be
-- visible to that trigger's checks." That's no longer true, and may never
-- have needed to be: invoices_protect_issued short-circuits on
-- `old.status = 'draft'` — a value fixed for the whole statement,
-- unaffected by trigger firing order — before it ever inspects
-- invoice_number, issued_on, or due_on. The two triggers' relative order
-- does not change behavior either way. Kept named so this one fires first
-- anyway, because "assign identity, then validate" is the more readable
-- order for a human scanning trigger names — not because Postgres's
-- alphabetical BEFORE-trigger firing order is load-bearing here.
create trigger invoices_assign_number_on_issue
  before update on pilot.invoices
  for each row execute function pilot.invoices_assign_number_on_issue();

create trigger invoices_set_updated_at before update on pilot.invoices
  for each row execute function pilot.set_updated_at();

-- ---------------------------------------------------------------------------
-- The ONE place totals are computed. Overview, the PDF renderer, and the
-- Needs Attention queue all read this view rather than each summing
-- invoice_lines independently — that independence is precisely how
-- FlightDeptPro's dashboard and P&L disagreed.
--
-- MEDIUM 7 (REVIEW FINDING) — READ BEFORE EDITING EITHER VIEW BELOW:
-- `create or replace view` does NOT preserve storage parameters across a
-- replace. If a future edit to either view omits `with (security_invoker =
-- true)`, Postgres does not error or warn — it silently redefines the view
-- back to the default (security_invoker = false, i.e. the view runs with
-- the view OWNER's privileges, which bypasses the querying user's RLS).
-- There is no symptom at deploy time; the symptom is every tenant's
-- financial totals becoming readable to every other tenant, discovered
-- only by an audit or an attacker. scripts/tenancy-verify.mjs asserts
-- `security_invoker` is present on every pilot.* view via a catalog query
-- on every run specifically because this regression is otherwise silent.
-- ---------------------------------------------------------------------------
create or replace view pilot.invoice_totals
with (security_invoker = true) as
  select
    i.id as invoice_id,
    i.account_id,
    coalesce(lines.subtotal_cents, 0)::bigint as subtotal_cents,
    round(coalesce(lines.taxable_subtotal_cents, 0) * i.tax_rate_bps / 10000.0)::bigint as tax_cents,
    (coalesce(lines.subtotal_cents, 0)
      + round(coalesce(lines.taxable_subtotal_cents, 0) * i.tax_rate_bps / 10000.0))::bigint as total_cents,
    coalesce(payments.amount_paid_cents, 0)::bigint as amount_paid_cents,
    payments.last_paid_on,
    (coalesce(lines.subtotal_cents, 0)
      + round(coalesce(lines.taxable_subtotal_cents, 0) * i.tax_rate_bps / 10000.0)
      - coalesce(payments.amount_paid_cents, 0))::bigint as balance_due_cents
  from pilot.invoices i
  -- Lines and payments are aggregated in their OWN subqueries before the
  -- join, not joined directly to pilot.invoices and summed together in one
  -- group by. Joining both one-to-many children straight to invoices would
  -- fan out: N lines x M payments rows per invoice, so sum(l.amount_cents)
  -- would double-count once per payment row, and sum(p.amount_cents) would
  -- double-count once per line row. Aggregate each side to exactly one row
  -- per invoice first, then join those two single-row-per-invoice results
  -- — the classic multi-child-table fan-out bug, avoided by construction
  -- rather than caught later by a mismatched total.
  left join (
    select invoice_id,
      sum(amount_cents) as subtotal_cents,
      sum(amount_cents) filter (where taxable) as taxable_subtotal_cents
    from pilot.invoice_lines
    group by invoice_id
  ) lines on lines.invoice_id = i.id
  left join (
    select invoice_id,
      sum(amount_cents) as amount_paid_cents,
      max(paid_on) as last_paid_on
    from pilot.invoice_payments
    group by invoice_id
  ) payments on payments.invoice_id = i.id;

comment on view pilot.invoice_totals is
  'C3/C2: the single source for subtotal/tax/total/balance/amount_paid/last_paid_on. Nothing else in this schema stores a total or a paid amount — compute it here or not at all.';

-- THIRD-PASS REVIEW FINDING (LOW, documented scope limitation, not a bug
-- to fix here): amount_paid_cents/last_paid_on sum EVERY pilot.invoice_
-- payments row for an invoice regardless of that invoice's current
-- status, including 'void'. If a paid invoice is later voided, its
-- payments still show here as money received — historically accurate
-- (the pilot really was paid that amount, against that document), but it
-- means a naive product-level "receivables" or "collected this year"
-- report must filter by status itself rather than trusting this view's
-- balance_due_cents alone across a void. There is deliberately no refund/
-- reversal mechanism in this schema (see pilot.invoice_payments' no-
-- update/delete-grant comment) — out of scope for this phase, not an
-- oversight.

-- Overdue is derived, never stored — see the invoices.status comment. Same
-- CREATE OR REPLACE / security_invoker caution as invoice_totals above.
create or replace view pilot.invoices_overdue
with (security_invoker = true) as
  select i.id as invoice_id, i.account_id, i.due_on,
         (current_date - i.due_on) as days_overdue
  from pilot.invoices i
  where i.status in ('sent', 'partial')
    and i.due_on is not null
    and i.due_on < current_date;

-- ---------------------------------------------------------------------------
-- RLS. Same shape as every table since Phase 1.
-- ---------------------------------------------------------------------------
alter table pilot.invoice_number_sequences enable row level security;
alter table pilot.invoices               enable row level security;
alter table pilot.invoice_lines          enable row level security;

create policy invoice_number_sequences_select on pilot.invoice_number_sequences for select to authenticated
  using (account_id in (select pilot.current_account_ids()));
-- No insert/update/delete policy for authenticated. SECOND-PASS REVIEW
-- FINDING (LOW): there used to also be no UPDATE GRANT-pairing story here
-- either — this comment previously described next_invoice_number() as
-- SECURITY INVOKER "going through the sequence's own atomic UPDATE, not a
-- general grant," which stopped being true the moment the CRITICAL-1 fix
-- made it SECURITY DEFINER. A SECURITY DEFINER function bypasses RLS and
-- grants on this table entirely — a column grant here would be dead
-- weight at best (no permissive UPDATE policy exists for it to pair with:
-- `update pilot.invoice_number_sequences set next_number = ...` as a
-- tenant is a silent `UPDATE 0`, not an error) and misleading at worst,
-- inviting a reader to believe a direct client UPDATE is a supported
-- path. It never was, and now nothing here suggests otherwise.

create policy invoices_select on pilot.invoices for select to authenticated
  using (account_id in (select pilot.current_account_ids()));
create policy invoices_insert on pilot.invoices for insert to authenticated
  with check (account_id in (select pilot.current_account_ids()));
create policy invoices_update on pilot.invoices for update to authenticated
  using (account_id in (select pilot.current_account_ids()))
  with check (account_id in (select pilot.current_account_ids()));
-- No delete policy: an issued invoice is a financial record. A draft can be
-- abandoned by setting status='void' (add 'draft_discarded' if a real UX
-- need for hard-deleting drafts emerges) rather than by DELETE, so there is
-- never a code path that removes a row a tax authority or a client might
-- reference later.

create policy invoice_lines_select on pilot.invoice_lines for select to authenticated
  using (account_id in (select pilot.current_account_ids()));
create policy invoice_lines_insert on pilot.invoice_lines for insert to authenticated
  with check (account_id in (select pilot.current_account_ids()));
create policy invoice_lines_update on pilot.invoice_lines for update to authenticated
  using (account_id in (select pilot.current_account_ids()))
  with check (account_id in (select pilot.current_account_ids()));
create policy invoice_lines_delete on pilot.invoice_lines for delete to authenticated
  using (account_id in (select pilot.current_account_ids()));

alter table pilot.invoice_payments enable row level security;

create policy invoice_payments_select on pilot.invoice_payments for select to authenticated
  using (account_id in (select pilot.current_account_ids()));
create policy invoice_payments_insert on pilot.invoice_payments for insert to authenticated
  with check (account_id in (select pilot.current_account_ids()));
-- No update/delete policy for authenticated — see the table comment above:
-- a recorded payment is a ledger entry, corrected only by service_role.

-- ---------------------------------------------------------------------------
-- GRANTS. Column-scoped per the Phase 1 pattern.
-- ---------------------------------------------------------------------------

-- THIRD-PASS REVIEW FINDING (LOW, pre-existing in Phase 3/4): the Phase 3
-- grant (`grant select, insert, delete on pilot.clients, pilot.trips,
-- pilot.trip_legs, pilot.expenses, pilot.documents to authenticated`) is
-- bare on INSERT, so a client can specify its own `id` — and every one of
-- these tables has a plain, global (not per-tenant) primary key. Passing
-- a KNOWN foreign id and reading the 23505-vs-success split back is an
-- existence oracle: it confirms a specific client/trip/expense/document
-- id exists somewhere in the system, exactly the CRITICAL-2 shape this
-- file already closed on invoice_number, one migration over. Revoking the
-- bare INSERT and re-granting it column-scoped (id/created_at/updated_at
-- withheld, same as every table added directly by this file) closes it
-- the same way.
revoke insert on pilot.clients, pilot.trips, pilot.trip_legs, pilot.expenses, pilot.documents from authenticated;
grant insert (account_id, name, contact_name, contact_email, contact_phone,
  address_line1, address_line2, city, state, postal_code, country,
  default_day_rate_cents, default_per_diem_cents, default_travel_day_rate_cents,
  payment_terms_days, default_expense_treatment, w9_status, w9_sent_at,
  w9_received_at, notes, archived_at)
  on pilot.clients to authenticated;
grant insert (account_id, client_id, trip_kind, status, starts_on, ends_on,
  aircraft_ident, aircraft_type, day_rate_cents, day_count, travel_day_count,
  travel_day_rate_cents, billing_state, notes)
  on pilot.trips to authenticated;
grant insert (account_id, trip_id, leg_date, from_icao, to_icao, out_at, in_at,
  block_hours, night_hours, instrument_hours, day_landings, night_takeoffs,
  night_landings_full_stop, night_landings_touch_go, approaches, holds)
  on pilot.trip_legs to authenticated;
grant insert (account_id, trip_id, incurred_on, category, vendor, amount_cents,
  treatment, receipt_path, notes)
  on pilot.expenses to authenticated;
grant insert (account_id, kind, label, expires_on, issued_on, client_id, file_path, notes)
  on pilot.documents to authenticated;

-- SECOND-PASS REVIEW FINDING (LOW): `grant update (next_number)` removed —
-- see the comment on invoice_number_sequences_select above. There is no
-- permissive UPDATE policy for it to pair with, so it was dead weight
-- that also contradicted the (now-corrected) comment describing how
-- numbering actually works.
grant select on pilot.invoice_number_sequences to authenticated;

-- SECOND-PASS REVIEW FINDING (MEDIUM): pilot.trips.travel_day_count/
-- travel_day_rate_cents and pilot.clients.default_travel_day_rate_cents
-- (added by the ALTER TABLE statements near the top of this file) had
-- INSERT/SELECT via the Phase 3 grants but no UPDATE — the A5 travel-day
-- feature these columns exist for could be set once at creation and never
-- edited again. ALTER TABLE ADD COLUMN does not extend an existing
-- column-scoped grant; a new column needs its own.
grant update (travel_day_count, travel_day_rate_cents) on pilot.trips to authenticated;
grant update (default_travel_day_rate_cents) on pilot.clients to authenticated;

grant select on pilot.invoices to authenticated;
-- REVIEW FINDING (HIGH 5): INSERT is now column-scoped too, paired with
-- the invoices_force_draft_on_insert trigger above as defense in depth —
-- the trigger alone already forces status/invoice_number/sent_at
-- regardless of what a client sends, but withholding those columns from
-- the INSERT grant means a malformed attempt is rejected at the privilege
-- layer instead of silently overwritten, which is the cheaper failure to
-- diagnose. status and invoice_number are absent: status defaults to
-- 'draft' and invoice_number is assigned only by
-- invoices_assign_number_on_issue.
grant insert (account_id, client_id, issued_on, due_on, tax_rate_bps, delivery_method, notes)
  on pilot.invoices to authenticated;
-- UPDATE is column-scoped: a tenant may move status forward and record
-- delivery facts, and edit notes/client_id/tax_rate_bps/due_on WHILE STILL
-- A DRAFT — the invoices_protect_issued trigger is what stops billing
-- facts changing after issue, not this grant (the grant alone cannot
-- express "these columns are writable only in one state"). invoice_number
-- is deliberately absent: assigned exclusively by
-- invoices_assign_number_on_issue. paid_at/amount_paid_cents are absent
-- because they no longer exist on this table — see pilot.invoice_payments.
grant update (client_id, status, issued_on, due_on, sent_at, tax_rate_bps, delivery_method, notes)
  on pilot.invoices to authenticated;

grant select, delete on pilot.invoice_lines to authenticated;
-- SECOND-PASS REVIEW FINDING (LOW): INSERT is now column-scoped too — the
-- bare table-wide grant let a client choose its own id/created_at on
-- insert, which tenancy-verify.mjs's own stated rule ("a client never
-- chooses its own primary key") already assumes is impossible everywhere
-- else. amount_cents is GENERATED and unwritable regardless; excluded for
-- clarity.
grant insert (account_id, invoice_id, line_type, description, quantity,
  unit_amount_cents, taxable, trip_id, expense_id, expense_treatment, sort_order)
  on pilot.invoice_lines to authenticated;
-- REVIEW FINDING (MEDIUM 6): UPDATE was a bare table-wide grant. Scoped to
-- the columns a line legitimately changes; account_id/id/created_at are
-- withheld (identity/tenancy, never client-writable) and amount_cents is
-- withheld too, though it's GENERATED and Postgres would reject a direct
-- UPDATE to it regardless. invoice_id IS included: moving a line between
-- two of the tenant's OWN draft invoices ("I put this on the wrong
-- draft") is a legitimate action — invoice_lines_protect_issued's HIGH-4
-- fix is what enforces the actual invariant (both the origin and
-- destination invoice must be draft), which is finer-grained than a grant
-- can express. A blanket denial here would block the legitimate move
-- along with the illegitimate one.
grant update (line_type, description, quantity, unit_amount_cents, taxable,
  trip_id, expense_id, expense_treatment, invoice_id, sort_order)
  on pilot.invoice_lines to authenticated;

grant select on pilot.invoice_payments to authenticated;
-- SECOND-PASS REVIEW FINDING (LOW): INSERT is column-scoped, same reason
-- as invoice_lines above — id/created_at were client-choosable under the
-- old bare grant.
grant insert (account_id, invoice_id, paid_on, amount_cents, method, notes)
  on pilot.invoice_payments to authenticated;

grant select on pilot.invoice_totals, pilot.invoices_overdue to authenticated;
-- SECOND-PASS REVIEW FINDING (LOW): Phase 1 revokes PUBLIC on its own
-- SECURITY DEFINER functions (current_account_ids, is_account_owner);
-- this one was missed. Not currently exploitable — anon has no USAGE on
-- schema pilot at all — but a SECURITY DEFINER function bypasses RLS by
-- design, and this function's own comment already says "never grant this
-- to anon." Matching the Phase 1 pattern removes the implicit PUBLIC
-- grant explicitly rather than relying on the schema-level denial alone.
-- THIRD-PASS REVIEW FINDING (HIGH, both reviews, live-proven, self-
-- inflicted): `revoke all ... from public` strips service_role's EXECUTE
-- too, because service_role never had an EXPLICIT grant — its only path
-- was the implicit PUBLIC one this line just removed. Every service_role
-- invocation (the webhook/reconciliation path this file documents
-- throughout) went right back to `permission denied for function
-- next_invoice_number`, the exact CRITICAL-1 symptom, by a completely
-- different mechanism, in the SAME fix that closed it the first time.
-- Caught only because both reviews tested a fresh connection / separate
-- transaction — the shared harness transaction masked it, since plpgsql
-- caches the ACL check on this call site for the life of the transaction
-- once any earlier statement in it has passed. service_role needs its own
-- explicit grant now that PUBLIC no longer supplies one implicitly.
revoke all on function pilot.next_invoice_number(uuid) from public;
grant execute on function pilot.next_invoice_number(uuid) to authenticated, service_role;

grant select, insert, update, delete on pilot.invoice_number_sequences, pilot.invoices, pilot.invoice_lines, pilot.invoice_payments to service_role;
grant select on pilot.invoice_totals, pilot.invoices_overdue to service_role;

-- ---------------------------------------------------------------------------
-- Indexes.
-- ---------------------------------------------------------------------------
create index if not exists invoices_account_status_idx on pilot.invoices (account_id, status, due_on);
create index if not exists invoices_client_idx on pilot.invoices (account_id, client_id);
create index if not exists invoice_lines_invoice_idx on pilot.invoice_lines (account_id, invoice_id, sort_order);
create index if not exists invoice_lines_trip_idx on pilot.invoice_lines (account_id, trip_id) where trip_id is not null;
create index if not exists invoice_payments_invoice_idx on pilot.invoice_payments (account_id, invoice_id, paid_on);

-- ---------------------------------------------------------------------------
-- C4 note: invoices carries `due_on`, a date, but is deliberately NOT unioned
-- into pilot.expirations. That engine is for regulatory/credential currency
-- (medical, flight review, passport, certificates) — an unpaid invoice is a
-- receivable, not an expiring qualification, and the aviation-expert skill's
-- terminology rule is explicit that these are different concepts with
-- different due-date semantics. It has its own ladder: pilot.invoices_overdue
-- above, and the Needs Attention queue reads it directly. Recording this
-- decision so it isn't "discovered" as a gap by a future coverage sweep.
-- ---------------------------------------------------------------------------

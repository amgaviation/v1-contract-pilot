-- ============================================================================
-- ACCOUNT LIFECYCLE — reset, deactivate, delete, and the monthly hold
--
-- Four things a pilot can do to their own account, and the one automatic
-- consequence the hold carries. Everything here is about the TENANT's own
-- data; none of it is a billing path (Stripe stays the authority on the
-- subscription, and the webhook remains the only writer of `status`).
--
-- ── WHY THE DELETE PATH IS ONE STATEMENT ─────────────────────────────────
--
-- Deleting an account is `delete from pilot.accounts where id = $1`, and
-- nothing else. 43 of this schema's 50 tables carry
-- `account_id uuid not null references pilot.accounts(id) on delete cascade`,
-- so the cascade IS the delete list — and, critically, it stays correct for
-- every table added after this migration without anyone remembering to come
-- back here. A hand-kept list of 43 table names is precisely the artifact
-- that goes stale silently, and the failure mode is a privacy one: a table
-- added next month keeps its rows after a pilot asked to be deleted.
--
-- The three tables that do NOT cascade from accounts, and why each is right:
--
--   pilot.accounts               the root itself.
--   pilot.stripe_events          the webhook idempotency ledger, keyed on
--                                Stripe's own event id and NOT tenant-
--                                scoped. It must SURVIVE a tenant delete:
--                                dropping the rows would let a replayed
--                                delivery re-apply as though it were new,
--                                which is the one guarantee that table
--                                exists to provide.
--   pilot.sample_connect_accounts  cascades from auth.users instead — it is
--                                a per-person developer demo, not tenant
--                                data.
--
-- ── THE HOLD, AND WHAT EXPIRY ACTUALLY DESTROYS ──────────────────────────
--
-- A hold pauses billing for up to two months. When it expires unpaid, the
-- account's BUSINESS records are purged and the AIRMAN's records are not.
-- That split is the whole design, and it is deliberate:
--
--   PURGED   clients, trips, invoices, estimates, expenses, mileage, the
--            accounting ledger, and the bank-import tables. These are
--            commercial records. They are the pilot's, and losing them is
--            a real cost — which is what makes a hold a decision rather
--            than a free park — but they are reconstructible from the
--            pilot's own bank and their clients' copies.
--
--   KEPT     the logbook, aircraft, documents, operator qualifications and
--            currency snapshots. FOREVER, on every path in this file
--            except an explicit, typed-confirmation reset the pilot asks
--            for themselves. A logbook is the airman's 14 CFR 61.51
--            record and a document wallet holds their medical and their
--            certificates; software that deletes those because an invoice
--            went unpaid has destroyed something a regulator, an insurer
--            or a chief pilot may ask for years later. No lapse in this
--            product's billing may ever be the cause of that.
--
-- ── THE NUMBER SEQUENCES ARE NOT BUSINESS DATA ───────────────────────────
--
-- pilot.invoice_number_sequences and pilot.estimate_number_sequences are
-- RETAINED through a purge, and this is the least obvious decision here.
-- Purging the invoices while resetting their sequence would let a future
-- invoice re-mint a number that has already been sent to a client, and
-- "a number, once minted, never changes" is a promise this product makes
-- in its own copy and its own invoice code. A reused number is an
-- accounting-integrity fault that surfaces years later, in someone else's
-- books, and it is unfixable once two documents share it. The counter
-- keeps counting across a purge; only what it counted goes away.
--
-- ── COMPLETENESS IS ENFORCED, NOT ASSERTED ───────────────────────────────
--
-- pilot.purge_business_data below names every table it deletes from.
-- scripts/account-lifecycle-verify.mjs fails if any table in the `pilot`
-- schema is in NEITHER that function's delete list NOR its documented
-- retain list, so adding a table forces a decision about what a purge does
-- to it instead of defaulting to "survives, silently". Defaulting to
-- retain is the safe direction, which is exactly why it must not be
-- allowed to happen by omission.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Lifecycle columns. Service-role written (like every other billing-adjacent
-- column on this table — see the column grants in the Phase 1 migration);
-- the tenant reads them to render its own banner and nothing more.
-- ----------------------------------------------------------------------------

alter table pilot.accounts
  add column if not exists deactivated_at        timestamptz,
  add column if not exists hold_started_at       timestamptz,
  add column if not exists hold_ends_at          timestamptz,
  add column if not exists retention_paid_until  timestamptz,
  add column if not exists business_data_purged_at timestamptz;

comment on column pilot.accounts.deactivated_at is
  'Set when the OWNER deactivates the account: the subscription is canceled '
  'and the tenant goes read-only, but every record is kept and reactivation '
  'is a normal checkout. Distinct from a Stripe-driven ''canceled'' status, '
  'which can also arrive from a failed card — this column records that a '
  'human chose it.';

comment on column pilot.accounts.hold_started_at is
  'When the current monthly hold began. Null when not on hold.';

comment on column pilot.accounts.hold_ends_at is
  'When the current hold expires. At this point the account either resumes, '
  'or — absent retention_paid_until — its BUSINESS records are purged by '
  'pilot.purge_business_data. The airman records are never purged here.';

comment on column pilot.accounts.retention_paid_until is
  'Paid data retention. While this is in the future the business records '
  'survive an expired hold. This is a storage fee, never a ransom on the '
  'logbook or the documents: those are kept whether or not it is paid.';

comment on column pilot.accounts.business_data_purged_at is
  'Audit stamp: when pilot.purge_business_data last ran for this account. '
  'Kept so a support question years later has an answer that is not a guess.';

-- A hold has both ends or neither. A row with a start and no end would sit
-- on hold forever with nothing to expire it, which is the one state the
-- scheduled enforcement cannot reason about.
alter table pilot.accounts
  drop constraint if exists accounts_hold_window_complete;
alter table pilot.accounts
  add constraint accounts_hold_window_complete
  check ((hold_started_at is null) = (hold_ends_at is null));

-- A hold may not run longer than two months from the day it started. The
-- product's rule, enforced where it cannot be bypassed by a bug in a
-- server action. 62 days rather than "2 months" so the bound is exact for
-- every pair of calendar months (Jul+Aug is 62 days; the check is a
-- ceiling, not a schedule).
alter table pilot.accounts
  drop constraint if exists accounts_hold_within_two_months;
alter table pilot.accounts
  add constraint accounts_hold_within_two_months
  check (
    hold_started_at is null
    or hold_ends_at <= hold_started_at + interval '62 days'
  );

-- ----------------------------------------------------------------------------
-- pilot.purge_business_data — the selective purge.
--
-- SECURITY DEFINER because it deletes across 29 tables whose RLS policies
-- are written for a signed-in tenant doing ordinary work, not for a
-- lifecycle job; `search_path` is pinned for the reason the Phase 1
-- companion migration pins every other definer function.
--
-- Deletion order is child-before-parent even where a cascade would cover
-- it, so the function does not depend on which FKs happen to cascade today.
-- ----------------------------------------------------------------------------

create or replace function pilot.purge_business_data(target_account uuid)
returns void
language plpgsql
security definer
set search_path = pilot, public
as $$
begin
  -- Accounting ledger (derived from everything below it, so it goes first).
  delete from pilot.journal_lines   where account_id = target_account;
  delete from pilot.journal_entries where account_id = target_account;
  delete from pilot.accounts_chart  where account_id = target_account;

  -- Bank import and reconciliation.
  delete from pilot.bank_statement_matches where account_id = target_account;
  delete from pilot.bank_transactions      where account_id = target_account;
  delete from pilot.bank_import_batches    where account_id = target_account;
  delete from pilot.bank_source_files      where account_id = target_account;
  delete from pilot.bank_accounts          where account_id = target_account;

  -- Invoices and everything hanging off them.
  delete from pilot.invoice_reminder_sends where account_id = target_account;
  delete from pilot.invoice_late_fees      where account_id = target_account;
  delete from pilot.invoice_shares         where account_id = target_account;
  delete from pilot.invoice_payments       where account_id = target_account;
  delete from pilot.invoice_lines          where account_id = target_account;
  delete from pilot.invoices               where account_id = target_account;

  -- Estimates.
  delete from pilot.estimate_shares where account_id = target_account;
  delete from pilot.estimate_lines  where account_id = target_account;
  delete from pilot.estimates       where account_id = target_account;

  -- Recurring schedules.
  delete from pilot.recurring_invoice_generations where account_id = target_account;
  delete from pilot.recurring_invoice_schedules   where account_id = target_account;

  -- Costs.
  delete from pilot.mileage_entries where account_id = target_account;
  delete from pilot.expenses        where account_id = target_account;

  -- Trips.
  delete from pilot.guarantee_periods where account_id = target_account;
  delete from pilot.trip_legs         where account_id = target_account;
  delete from pilot.trip_days         where account_id = target_account;
  delete from pilot.trips             where account_id = target_account;

  -- Clients last: invoices, trips and estimates all point at them.
  delete from pilot.client_vendor_links where account_id = target_account;
  delete from pilot.client_tax_forms    where account_id = target_account;
  delete from pilot.client_rates        where account_id = target_account;
  delete from pilot.clients             where account_id = target_account;

  -- The pilot's own Connect event ledger. Tenant-scoped, unlike
  -- pilot.stripe_events, and meaningless once the invoices it references
  -- are gone.
  delete from pilot.stripe_connect_events where account_id = target_account;

  update pilot.accounts
     set business_data_purged_at = now()
   where id = target_account;
end;
$$;

comment on function pilot.purge_business_data(uuid) is
  'Deletes the account''s COMMERCIAL records (clients, trips, invoices, '
  'estimates, expenses, ledger, bank imports) and deliberately keeps the '
  'airman''s own: logbook, aircraft, documents, operator qualifications and '
  'currency snapshots, plus the invoice/estimate number sequences so a '
  'future document can never re-mint a number already issued. Completeness '
  'is enforced by scripts/account-lifecycle-verify.mjs.';

-- Only the service role runs this. No tenant-facing grant: a lifecycle
-- purge is reached through a server action that has already checked
-- ownership and confirmation, never by a client calling an RPC.
revoke all on function pilot.purge_business_data(uuid) from public;
revoke all on function pilot.purge_business_data(uuid) from authenticated;

-- ----------------------------------------------------------------------------
-- pilot.reset_account_data — everything the pilot has entered, including the
-- airman records, on their own explicit typed confirmation.
--
-- This is the ONE path in this file that removes a logbook, and it exists
-- because a pilot who wants to start over is entitled to; it is never
-- reached by a schedule, a lapse, or an expiry. The server action that
-- calls it requires the account's own name typed back and offers the
-- export first.
-- ----------------------------------------------------------------------------

create or replace function pilot.reset_account_data(target_account uuid)
returns void
language plpgsql
security definer
set search_path = pilot, public
as $$
begin
  perform pilot.purge_business_data(target_account);

  -- The airman records, which purge_business_data deliberately spares.
  delete from pilot.currency_snapshots      where account_id = target_account;
  delete from pilot.operator_qualifications where account_id = target_account;
  delete from pilot.document_share_items    where account_id = target_account;
  delete from pilot.document_shares         where account_id = target_account;
  delete from pilot.documents               where account_id = target_account;
  delete from pilot.logbook_source_files    where account_id = target_account;
  delete from pilot.logbook_import_batches  where account_id = target_account;
  delete from pilot.logbook_entries         where account_id = target_account;
  delete from pilot.aircraft                where account_id = target_account;

  -- Settings, day types, mileage rates and the number sequences are NOT
  -- touched: a reset returns an empty product, not an unconfigured one,
  -- and a re-minted invoice number is never acceptable (see the header).
end;
$$;

comment on function pilot.reset_account_data(uuid) is
  'Everything pilot.purge_business_data removes, plus the airman records '
  '(logbook, aircraft, documents, qualifications, currency). Reached ONLY '
  'from an explicit typed-confirmation reset by the account owner — never '
  'from a hold expiry, a lapse, or any schedule. Account settings and the '
  'number sequences survive.';

revoke all on function pilot.reset_account_data(uuid) from public;
revoke all on function pilot.reset_account_data(uuid) from authenticated;

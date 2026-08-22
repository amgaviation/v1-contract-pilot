-- ===========================================================================
-- Drop eleven indexes an existing UNIQUE constraint already covers
--
-- WHAT THIS IS. Eleven `drop index if exists`, nothing else. No table,
-- column, constraint, policy or grant changes, and no index is dropped
-- unless another index on the SAME TABLE, with the SAME LEADING COLUMNS,
-- already exists and is enforcing a constraint (so it can never itself be
-- dropped by accident later).
--
-- WHY. A UNIQUE table constraint is implemented as a unique B-tree index.
-- `unique (account_id, invoice_id)` therefore already IS an index on
-- (account_id, invoice_id), and a second, non-unique index over exactly the
-- same columns in the same order serves no query the first does not: the
-- planner treats them as interchangeable and picks one. What the duplicate
-- does buy is cost — another B-tree to maintain on every insert, update and
-- delete, another set of pages in cache, and another thing to keep in mind
-- when reading the schema.
--
-- SEVERITY, HONESTLY. Low. This is a pre-launch, per-tenant-small dataset;
-- the write amplification removed is real and small. It is here because it
-- is free and because a schema that says a thing twice invites the next
-- reader to wonder which one matters.
--
-- WHAT THIS IS NOT. It is not the "a composite constraint already serves
-- this" trap where a *differently shaped* index gets dropped because its
-- columns appear somewhere in a wider constraint. Each drop below names the
-- constraint whose index has the dropped index's column list as an exact
-- match or an exact LEADING PREFIX — the only two cases where the drop is
-- provably free. This repo already documents the same reasoning in the
-- opposite direction at 20260802190437:147-149, where a redundant index was
-- deliberately never created.
--
-- Replay-safe from scratch and re-runnable: every statement is
-- `if exists`, and a fresh replay reaches this file with all eleven present.
-- ===========================================================================

-- === Exactly redundant: same table, same columns, same order ==============

-- Covered by pilot.invoice_shares' `unique (account_id, invoice_id)`
-- (20260809060000:103).
drop index if exists pilot.invoice_shares_invoice_idx;

-- Covered by pilot.invoice_late_fees' `unique (account_id, source_invoice_id,
-- period_start)` (20260813130000:649).
drop index if exists pilot.invoice_late_fees_source_idx;

-- Covered by pilot.trip_days' `unique (account_id, trip_id, day_on)`
-- (20260807000000:164).
drop index if exists pilot.trip_days_trip_idx;

-- Covered by pilot.recurring_invoice_generations' `unique (account_id,
-- schedule_id, period_start)` (20260809030000:219).
drop index if exists pilot.recurring_invoice_generations_schedule_idx;

-- Covered by pilot.estimate_shares' `unique (account_id, estimate_id)`
-- (20260814111000:63).
drop index if exists pilot.estimate_shares_estimate_idx;

-- Covered by pilot.bank_statement_matches' `unique (account_id,
-- bank_transaction_id)` (20260812100001:56).
drop index if exists pilot.bank_statement_matches_txn_idx;

-- Covered by pilot.aircraft's `unique (account_id, tail_key)`
-- (20260810110000:114).
drop index if exists pilot.aircraft_account_idx;

-- === Prefix-redundant: the constraint's index leads with these columns =====

-- (account_id, client_id, tax_year) is the exact leading prefix of
-- pilot.client_tax_forms' `unique (account_id, client_id, tax_year,
-- form_type)` (20260807080000:63).
drop index if exists pilot.client_tax_forms_client_year_idx;

-- (account_id, tax_year desc) under pilot.mileage_rates' `unique (account_id,
-- tax_year)` (20260809020000:103). The DESC is not a reason to keep it: every
-- read of this table binds account_id to a constant, and a backward scan of
-- the unique index over the remaining tax_year column yields the same order
-- at the same cost.
drop index if exists pilot.mileage_rates_account_year_idx;

-- === Redundant against a column-level UNIQUE ==============================

-- pilot.accounts.stripe_customer_id and .stripe_subscription_id are declared
-- `text unique` at 20260802190437:61-62, which already creates a unique index
-- on each. The partial indexes added at 20260805160000:82-88 were justified by
-- "the many NULLs on unprovisioned rows don't collide" — but Postgres UNIQUE is
-- NULLS DISTINCT by default, so NULLs never collide in the Phase 1 constraints
-- either. The `where ... is not null` predicate buys nothing the existing
-- uniques do not already deliver, and dropping these does not weaken the
-- one-customer-one-account guarantee by one row.
drop index if exists pilot.accounts_stripe_customer_key;
drop index if exists pilot.accounts_stripe_subscription_key;

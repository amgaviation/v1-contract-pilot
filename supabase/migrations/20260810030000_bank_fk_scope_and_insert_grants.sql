-- Two defects in 20260809070000_bank_transactions.sql, both found by
-- adversarial review and both reproduced against this schema before being
-- changed.
--
-- ***************************************************************************
-- 1. A COMPOSITE `on delete set null` NULLS EVERY COLUMN IN THE KEY
-- ***************************************************************************
-- Both bank FKs were written as
--
--   foreign key (account_id, expense_id) references pilot.expenses (account_id, id)
--     on delete set null
--
-- with no column list. Postgres then sets EVERY column of the referencing
-- key to null — including account_id, which is `not null`. So deleting a
-- bank-derived expense does not clear the link, it fails:
--
--   ERROR:  null value in column "account_id" of relation
--           "bank_transactions" violates not-null constraint
--   CONTEXT: UPDATE ONLY pilot.bank_transactions
--            SET "account_id" = NULL, "expense_id" = NULL ...
--
-- 23502 reaches the pilot through friendlyDbError as "Something required
-- is missing." — nonsense for a delete — and the expense is permanently
-- undeletable from the UI. Which matters more than it sounds: deleting the
-- duplicate is the ONLY remedy a pilot has when the same spend is entered
-- twice (once from a photographed receipt, once from the card statement),
-- and with `treatment = 'rebill'` that duplicate reaches a paying client.
--
-- Reproduced before fixing: a bank transaction with expense_id set, delete
-- the expense, observe 23502 naming account_id. The sibling
-- pilot.expenses_account_id_trip_id_fkey already carries the correct
-- column-scoped form — this is drift from a pattern the schema had right
-- one table over, not a novel mistake.
--
-- ***************************************************************************
-- 2. TABLE-LEVEL INSERT DEFEATS EVERY COLUMN-SCOPED PROTECTION
-- ***************************************************************************
-- `grant select, insert, delete on <four bank tables> to authenticated`
-- grants INSERT on every column, present and future. The migration's own
-- comment three lines above it explains at length which columns are
-- withheld from UPDATE and why — the dedup fingerprint, the import
-- lineage, the amount the bank actually sent — and then the INSERT grant
-- hands all of them back on the way in. fingerprint.ts's "never accepted
-- from the client" is likewise true of the code and not of the grant.
--
-- These were the only four tables in schema `pilot` with a full-table
-- INSERT: every other table is column-scoped (expenses 9 of 12,
-- logbook_entries 36 of 45, trips 15 of 20, invoices 7 of 16).
--
-- WHAT THIS DOES AND DOES NOT CLOSE. RLS still confines a forgery to the
-- actor's own tenant, so this is not a cross-tenant hole. It is a
-- self-tampering one: `account_members` admits owner/member/bookkeeper and
-- all three map to `authenticated`, so on a business account any member
-- could forge or backdate rows in the shared ledger. It also does NOT make
-- the dedup index unbypassable — confirmBankImport computes the
-- fingerprint server-side but inserts it through the pilot's own client,
-- so the column has to stay grantable. Making the key itself unforgeable
-- needs a `generated always as ... stored` column, which is a bigger
-- change and is not attempted here.
--
-- THE REVOKE TRAP, for the fourth time in this repo's history: `revoke
-- insert on <table>` drops EVERY column-level INSERT privilege, and the
-- grant that follows restores ONLY what it lists. A column left off the
-- list below is not "left as it was" — it is revoked, and the feature
-- breaks with 42501 at runtime. The lists are therefore transcribed from
-- the actual insert payloads (app/(app)/expenses/import/actions.ts and
-- lib/bank-import/types.ts's BankTransactionInsert), and the result is
-- re-read from information_schema.column_privileges by
-- scripts/bank-import-verify.mjs rather than trusted from this text.
-- ***************************************************************************

-- ---------------------------------------------------------------------------
-- 1. Column-scope both SET NULL actions.
-- ---------------------------------------------------------------------------
alter table pilot.bank_transactions
  drop constraint if exists bank_transactions_account_id_expense_id_fkey;
alter table pilot.bank_transactions
  add constraint bank_transactions_account_id_expense_id_fkey
  foreign key (account_id, expense_id) references pilot.expenses (account_id, id)
  on delete set null (expense_id);

alter table pilot.bank_transactions
  drop constraint if exists bank_transactions_account_id_trip_id_fkey;
alter table pilot.bank_transactions
  add constraint bank_transactions_account_id_trip_id_fkey
  foreign key (account_id, trip_id) references pilot.trips (account_id, id)
  on delete set null (trip_id);

-- NOTE on the trip case specifically: nulling trip_id on a row that is
-- reviewed AND rebilled still violates the "an expense cannot be rebilled
-- to nobody" CHECK, so deleting such a trip now fails with 23514 naming
-- that rule instead of 23502 naming account_id. That is a true statement
-- about why the delete cannot proceed rather than a misleading one, and it
-- is the correct outcome — a rebillable transaction pointing at a deleted
-- trip has no client to bill. Giving the pilot a friendlier path (unlink
-- first, then delete) is a UI change, deliberately not smuggled in here.

-- ---------------------------------------------------------------------------
-- 2. Column-scope INSERT on all four bank tables.
-- ---------------------------------------------------------------------------
revoke insert on pilot.bank_accounts, pilot.bank_import_batches,
  pilot.bank_source_files, pilot.bank_transactions from authenticated;

-- id/created_at/updated_at withheld everywhere: defaults and the
-- updated_at trigger own them. archived_at is UPDATE-only (archiving is an
-- edit, not something you create a row already in).
grant insert (account_id, label, last4, kind)
  on pilot.bank_accounts to authenticated;

-- imported_rows/rejected_rows/duplicate_rows/error_summary are withheld:
-- a batch is created with counts at zero and only the close-out UPDATE
-- (already granted) may state what happened. A client that could INSERT
-- "imported_rows: 900" would be writing an outcome before doing the work.
grant insert (account_id, bank_account_id, source_format, status, total_rows)
  on pilot.bank_import_batches to authenticated;

grant insert (account_id, import_batch_id, file_name, row_count)
  on pilot.bank_source_files to authenticated;

-- review_state/category/treatment/trip_id/expense_id/notes are ALL
-- withheld from INSERT on purpose: a transaction is born unreviewed, and
-- confirmTransaction's UPDATE is the only path to a reviewed row. Granting
-- them here would let a crafted insert mint a row that is already
-- 'reviewed' and already attached to an expense, skipping the
-- draft-confirm boundary this whole feature is built around.
grant insert (
  account_id, bank_account_id, import_batch_id, source_file_id,
  source_row_number, source_row, posted_on, description, amount_cents, fingerprint
) on pilot.bank_transactions to authenticated;

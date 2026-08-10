-- The follow-up 20260810040000 deliberately deferred: narrowing UPDATE on
-- pilot.bank_transactions now that pilot.bank_transaction_confirm owns the
-- confirm.
--
-- ***************************************************************************
-- WHY THIS IS A SEPARATE MIGRATION
-- ***************************************************************************
-- Attempting it inside 20260810040000 broke four assertions in
-- scripts/bank-import-verify.mjs — BANK-REVIEW-1/2/3 and BANK-FK-1 — every
-- one of which reaches the reviewed state by direct UPDATE, because that
-- was the only path when they were written. Rewriting probes whose entire
-- value is that they fail for the RIGHT reason, in the same change that
-- alters the code under test, is how a suite starts passing for the wrong
-- one. So the grant change waited for a pass where the probes are the
-- work rather than collateral, and that pass is this one.
--
-- ***************************************************************************
-- WHAT IS LEFT WRITABLE, AND WHY EACH
-- ***************************************************************************
-- review_state — ignoreTransaction moves an unreviewed row to 'ignored'
--   without creating anything, and that is a legitimate direct write. It
--   cannot be abused into a confirm: the table's own CHECK requires
--   category AND treatment to be set in the same statement as
--   review_state='reviewed', and neither is grantable any more, so the
--   only reachable direct transition is the dismissal.
-- notes — the pilot's own annotation on a row. Not money, not lineage.
--
-- WITHHELD, and each for a stated reason rather than by omission:
--   category, treatment, trip_id, expense_id
--     These four ARE the confirm. Granting any of them re-opens the
--     three-step sequence 20260810040000 exists to remove, in which a
--     crash between steps stranded a row 'reviewed' with no expense and a
--     lost reply produced two expenses for one bank line.
--   account_id, bank_account_id, import_batch_id, source_file_id,
--   source_row_number, source_row, posted_on, description, amount_cents,
--   fingerprint, id, created_at, updated_at
--     Already withheld before this migration; re-stated here only because
--     the revoke below drops every column-level privilege and the grant
--     that follows is the complete list. A column absent from it is
--     REVOKED, not preserved. This is the trap that has caught this repo
--     four times; scripts/bank-import-verify.mjs re-reads the result from
--     information_schema rather than trusting this text.
-- ***************************************************************************

revoke update on pilot.bank_transactions from authenticated;
grant update (review_state, notes) on pilot.bank_transactions to authenticated;

comment on table pilot.bank_transactions is
  'One row per transaction read from an imported bank/card statement. A row is born unreviewed (20260810030000 withholds review_state/category/treatment from the INSERT grant) and becomes an expense only through pilot.bank_transaction_confirm, which does the claim, the expense insert and the link in ONE transaction. Direct UPDATE is scoped to (review_state, notes): enough for ignoreTransaction to dismiss a row, not enough to reconstruct the confirm. amount_cents is canonical — negative means money left the account, for every account kind.';

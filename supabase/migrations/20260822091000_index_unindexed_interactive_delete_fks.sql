-- ===========================================================================
-- Index the composite FKs the INTERACTIVE delete path actually scans
--
-- WHAT THIS IS. Five `create index if not exists` statements, nothing else.
-- No table, column, constraint, policy or grant changes.
--
-- THE PROBLEM. Postgres indexes the REFERENCED side of a foreign key (it
-- has to — that side is a unique constraint) and indexes the REFERENCING
-- side not at all. So every `delete from pilot.clients where id = ...` and
-- every `delete from pilot.day_types where id = ...` must prove that no
-- child row still points at the row being deleted, and with no index on the
-- child's FK columns that proof is a sequential scan of the child table.
--
-- WHY ONLY THESE FIVE, AND NOT EVERY UNINDEXED FK IN THE SCHEMA. The
-- tempting framing — "these are on the purge path" — is wrong for most of
-- them, and it is worth writing down so the next reader does not re-derive
-- the wrong list. pilot.purge_business_data_rows (20260818200000:110-129)
-- deletes CHILDREN BEFORE PARENTS: mileage_entries and
-- recurring_invoice_schedules are already gone by the time
-- `delete from pilot.clients` runs, so their FK checks find nothing to scan
-- and an index buys the purge exactly nothing.
--
-- What is left, and what this file is actually for, is the INTERACTIVE
-- path: a pilot deleting ONE client, or ONE day type, from a settings
-- screen, where the parent goes first and every child table is scanned to
-- decide whether to CASCADE, SET NULL or RESTRICT. That is a real, if
-- modest, win on one tenant's rows, and it costs five B-tree indexes.
--
-- SHAPE: (account_id, <fk column>), account_id LEADING, matching every
-- other index in this schema and matching the FKs themselves, which are all
-- composite `(account_id, <col>) references <parent> (account_id, id)`. The
-- referential check binds both columns, so both belong in the index.
--
-- recurring_invoice_schedules had a primary key and a `unique (account_id,
-- id)` constraint (both cover reads by id) but nothing on client_id — no
-- index covered a read or a delete-check by the FK column this migration
-- indexes.
--
-- NOT `concurrently`, deliberately: this repo has no CONCURRENTLY anywhere
-- (grep confirms), and verify:all replays each file with `psql -f` in
-- autocommit where the distinction is moot. Following the house pattern.
--
-- Replay-safe from scratch and re-runnable: every statement is
-- `if not exists`.
-- ===========================================================================

-- pilot.documents (account_id, client_id) -> pilot.clients, ON DELETE SET NULL
-- (client_id) since 20260821091000. Existing indexes: documents_expiry_idx
-- (account_id, expires_on) only.
create index if not exists documents_client_idx
  on pilot.documents (account_id, client_id);

-- pilot.mileage_entries (account_id, client_id) -> pilot.clients, ON DELETE
-- SET NULL (20260809020000:149). Existing indexes lead (account_id, drove_on
-- desc) and (account_id, trip_id).
create index if not exists mileage_entries_client_idx
  on pilot.mileage_entries (account_id, client_id);

-- pilot.trip_days (account_id, day_type_id) -> pilot.day_types, ON DELETE
-- RESTRICT (20260807000000:149) — the RESTRICT is the point: the check runs
-- on every day-type delete attempt and must scan every trip day to refuse.
create index if not exists trip_days_day_type_idx
  on pilot.trip_days (account_id, day_type_id);

-- pilot.client_rates (account_id, day_type_id) -> pilot.day_types, ON DELETE
-- CASCADE (20260807000000:190).
create index if not exists client_rates_day_type_idx
  on pilot.client_rates (account_id, day_type_id);

-- pilot.recurring_invoice_schedules (account_id, client_id) -> pilot.clients,
-- ON DELETE RESTRICT (20260809030000:112). This table had no index at all.
create index if not exists recurring_invoice_schedules_client_idx
  on pilot.recurring_invoice_schedules (account_id, client_id);

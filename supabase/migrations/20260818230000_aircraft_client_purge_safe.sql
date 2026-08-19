-- pilot.aircraft.client_id: ON DELETE RESTRICT -> ON DELETE SET NULL.
--
-- 20260818220000 added this column with ON DELETE RESTRICT, "matching
-- pilot.trips.client_id exactly." That match was the mistake, and the
-- account-lifecycle machinery (20260818090000 / 20260818200000) is what
-- exposes it: trips are PURGED on hold expiry, and the purge deletes them
-- BEFORE it deletes clients, so trips' RESTRICT never has a client delete
-- to block. Aircraft are RETAINED — they group kept logbook entries, and
-- time-in-type depends on them — so a retained aircraft still pointing at
-- a client would make purge_business_data_rows' `delete from
-- pilot.clients` fail on the FK, and pilot.expire_hold would abort. A
-- hold expiry that ERRORS is worse than either outcome it was choosing
-- between: nothing is purged, the scheduled pass retries forever, and the
-- account is stuck.
--
-- SET NULL is the honest resolution of "a retained record referencing a
-- purged one": the airman record (the airframe, its type, its hours
-- grouping) survives untouched, and the commercial link, which cannot
-- outlive the client it names, clears. This is the same shape as
-- pilot.expenses.client_id's SET NULL (20260815130000), and now for the
-- stronger reason — there, the surviving row was itself commercial; here
-- it is an airman record the purge must never touch.
--
-- Interactively nothing changes: no code path hard-deletes a client (the
-- UI archives, and trips'/quals' own FKs still stand), so the only
-- observable difference is that a lifecycle purge now completes instead
-- of erroring.
--
-- The column list on SET NULL is load-bearing, exactly as it is on
-- pilot.expenses' twin constraint (20260815130000): a composite FK's bare
-- SET NULL nulls EVERY referencing column, account_id included, and
-- account_id is NOT NULL — the purge would then fail on a not-null
-- violation instead of a RESTRICT one, which is the same stuck hold with
-- a different error code. `set null (client_id)` clears only the link.
--
-- Idempotent drop-then-add so a replay (CI applies every file in order)
-- lands in the same end state whether or not 20260818220000's RESTRICT
-- version was ever present.
alter table pilot.aircraft
  drop constraint if exists aircraft_client_fk;

alter table pilot.aircraft
  add constraint aircraft_client_fk
  foreign key (account_id, client_id) references pilot.clients (account_id, id)
  on delete set null (client_id);

comment on constraint aircraft_client_fk on pilot.aircraft is
  'Same-account clients only (composite key). ON DELETE SET NULL (client_id), not RESTRICT: aircraft are RETAINED by the account-lifecycle purge while clients are deleted, so the link must clear rather than block the purge. The column list keeps account_id out of the SET NULL. See 20260818230000.';

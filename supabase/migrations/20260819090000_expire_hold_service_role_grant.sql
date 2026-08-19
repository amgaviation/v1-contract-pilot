-- ============================================================================
-- pilot.expire_hold — the missing EXECUTE grant, and the index the cron needs.
--
-- ── THE DEFECT ────────────────────────────────────────────────────────────
--
-- 20260818200000 ends pilot.expire_hold with a revoke-then-grant pair, same
-- as every other lifecycle function in this file:
--
--   revoke all on function pilot.expire_hold(uuid) from public;
--   revoke all on function pilot.expire_hold(uuid) from authenticated;
--
-- Every sibling function (place_hold, resume_from_hold, purge_business_data,
-- deactivate_account, delete_account, reset_account_data...) follows that
-- revoke with `grant execute ... to authenticated`, because a pilot's own
-- session is meant to call them. expire_hold is deliberately different —
-- its comment says so explicitly: "no pilot ever calls this... the
-- scheduled pass acting on an account whose owner has, by definition,
-- stopped showing up." That is correct. What was missing is the grant its
-- ACTUAL caller needs: app/api/holds/run/route.ts runs on a service-role
-- client (there is no session to authenticate as — see that route's own
-- header), so PostgREST executes this function as Postgres role
-- service_role, and EXECUTE is checked before the SECURITY DEFINER body
-- ever runs. Nothing in the 87 migrations before this one grants
-- service_role EXECUTE on this function; the `alter default privileges`
-- in 20260802190437 covers TABLES, not FUNCTIONS, so it does not backfill
-- this either.
--
-- THE CONSEQUENCE, verified against the live schema: every invocation of
-- pilot.expire_hold from the cron route failed with 42501
-- (insufficient_privilege). The route's own error handling — reasonably,
-- before this fix — treats any rpc error as expire_hold declining a
-- not-actually-due account, which is the function's real and intended
-- refusal path for a wrong WHERE clause. That made a broken grant
-- indistinguishable from a correct refusal: the route logged an error line
-- per account and returned `{ran: true, purged: 0}` every night, forever,
-- with no hold ever actually expiring. scripts/account-lifecycle-db-verify.mjs
-- did not catch it because its HOLD-7/HOLD-8/HOLD-9 assertions ran after a
-- bare `reset role`, which returns to the migration-owner role — and an
-- object's owner always retains implicit EXECUTE on it regardless of any
-- REVOKE. That gap is closed separately, in the same commit as this file,
-- by wrapping those assertions in `set local role service_role` so they
-- exercise the actual grant this migration adds.
--
-- This is a live-defect fix, not a style change: the hold-expiry product
-- promise (pilot.accounts.hold_ends_at's own comment — "its BUSINESS
-- records are purged") has never once been kept in production.
-- ============================================================================

grant execute on function pilot.expire_hold(uuid) to service_role;

comment on function pilot.expire_hold(uuid) is
  'Purges an expired, unpaid hold''s COMMERCIAL records and clears the hold. '
  'Never touches airman records (see pilot.purge_business_data). Re-derives '
  'due-ness from the row and refuses an account that is not on hold, whose '
  'hold has not expired, or whose retention is paid — so a wrong WHERE '
  'clause in the scheduled pass cannot destroy a live tenant''s data. '
  'Called only by the service-role client in app/api/holds/run/route.ts; '
  'granted to service_role (not authenticated — see 20260818200000) by '
  '20260819090000, which was missing from the original migration.';

-- ── THE INDEX ────────────────────────────────────────────────────────────
--
-- app/api/holds/run/route.ts's selection filters pilot.accounts on
-- `hold_ends_at is not null and hold_ends_at < now()`. hold_ends_at carries
-- no index of its own — pilot.accounts is the tenant root table, read by
-- nearly every request in this product, and every hold-expiry pass (hourly
-- or more often, per the cron schedule) was sequentially scanning all of it
-- to find the handful of rows on a live hold. Partial on
-- `hold_started_at is not null` rather than indexing every row: holds are
-- the exception, not the common state, and a partial index costs nothing to
-- maintain for the accounts that are never on hold.
create index if not exists accounts_hold_ends_at_idx
  on pilot.accounts (hold_ends_at)
  where hold_started_at is not null;

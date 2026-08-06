-- Restore the column-scoped UPDATE grant on pilot.accounts.
--
-- WHAT WENT WRONG. The Phase 1 migration documents a CRITICAL fix: never
-- `grant update on pilot.accounts`, always enumerate the columns a tenant
-- may change. The file says exactly that and enumerates nine columns. The
-- LIVE DATABASE disagreed — `authenticated` held a TABLE-WIDE UPDATE
-- grant covering all twenty columns, `plan`, `status`, `seat_count`,
-- `trial_ends_at`, both Stripe ids, `connect_account_id`, `kind`, `id`,
-- `created_at` and `updated_at` among them.
--
-- The mechanism is worth writing down, because it will happen again
-- otherwise: `grant update (a, b, c) on t to r` ADDS column privileges.
-- It does not remove a pre-existing table-wide grant. An earlier form of
-- the migration granted table-wide; the fix added the column-scoped grant
-- underneath it and the broad one simply stayed. Re-running the corrected
-- file could never have repaired it. **A tightening migration must REVOKE
-- first** — that is the general lesson, not a detail of this table.
--
-- WHAT WAS ACTUALLY AT RISK. Less than the grant suggests, because the
-- design's second layer held:
--   * `accounts_protect_billing_columns` refuses any change to plan,
--     status, seat_count, trial_ends_at, the Stripe ids,
--     connect_account_id and kind unless the writer is service_role. That
--     trigger is the only reason this was not a live billing-state
--     rewrite, and it is precisely the "belt-and-braces" the Phase 1
--     comment said it was adding in case a future migration re-widened
--     the grant. It earned its place.
--   * The `accounts_update` policy is `pilot.is_account_owner(id)`, so a
--     non-owner member could not write these columns at all.
-- What WAS reachable: `id`, `created_at` and `updated_at`, none of which
-- the trigger covers. `created_at` is the interesting one — it is this
-- system's record of when a tenant came into existence, and a tenant-
-- writable audit timestamp corroborates nothing.
--
-- Discovered while building the settings screen: a test asserted the
-- billing columns were unreachable and the failure came back as the
-- TRIGGER's exception rather than the expected privilege error. The
-- assertion passed in spirit and the reason was wrong, which is the only
-- reason anyone looked.

revoke update on pilot.accounts from authenticated;

-- The nine columns a tenant legitimately owns: how their business is
-- named and addressed, their invoice prefix, and their logo. Everything
-- else on this table is either identity (`id`), audit (`created_at`,
-- `updated_at`, trigger-owned) or billing state that arrives only from
-- Stripe through the webhook's service-role client.
grant update (
  legal_name, address_line1, address_line2, city, state,
  postal_code, country, logo_url, invoice_prefix
) on pilot.accounts to authenticated;

-- pilot.account_members carries a table-wide UPDATE grant from the same
-- era. RLS renders it inert today — the table has a SELECT policy and NO
-- update policy, so every UPDATE matches zero rows regardless of
-- privilege — but a grant that only fails because a policy is missing is
-- a trap for whoever adds that policy later. Seat management is a
-- service-role operation (it has to stay in step with the Stripe
-- subscription quantity), so `authenticated` needs no UPDATE here at all.
revoke update on pilot.account_members from authenticated;

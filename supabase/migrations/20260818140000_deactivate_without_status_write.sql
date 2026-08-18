-- ============================================================================
-- CORRECTIVE — pilot.deactivate_account must not write `status`
--
-- WHAT WAS WRONG. 20260818090000_account_lifecycle.sql shipped
-- pilot.deactivate_account writing `status = 'canceled'` alongside
-- deactivated_at, and its own header claimed that was "the one place
-- outside the webhook that writes status". It never could have been:
-- pilot.protect_account_billing_columns() (Phase 2) refuses any change to
-- plan, plan_tier, status, seat_count, trial_ends_at, last_billing_event_at,
-- the two stripe_* ids, kind or demo_cancel_at_period_end unless
-- `current_user = 'service_role'`. A SECURITY DEFINER function runs as its
-- OWNER, which is postgres, not service_role — so every call raised, and
-- deactivation was broken end to end from the day it merged.
--
-- It was not caught before merge because nothing executed the function. The
-- static check (scripts/account-lifecycle-verify.mjs) reads the migration's
-- text; CI's database job applies migrations but ran nothing against them.
-- scripts/account-lifecycle-db-verify.mjs, added with this migration, is the
-- thing that found it, on the first run, in the first second.
--
-- WHY THE FIX IS TO STOP WRITING STATUS RATHER THAN TO PERMIT IT. The
-- tempting repair is `set local role service_role` inside the function, or
-- another exemption in the trigger. Both are wrong, and the trigger is
-- right: `status` mirrors Stripe's subscription state, and the product's
-- rule is that Stripe is the authority and the webhook is the only writer.
-- A second writer means two sources for one fact, and the failure mode is
-- an account locked out locally while Stripe still believes it is active.
--
-- The status change is not lost, it just arrives properly. The server
-- action cancels the subscription at Stripe FIRST and refuses to continue
-- if Stripe disagrees; Stripe then delivers customer.subscription.deleted,
-- and the webhook writes 'canceled' through the service-role path that has
-- always owned that column.
--
-- CLOSING THE WINDOW. Between the local write and the webhook landing, the
-- account would still be writable if the gate only read `status`. So
-- `deactivated_at` becomes a read-only signal in its own right —
-- accountIsReadOnly() in lib/supabase/account.ts now treats a non-null
-- deactivated_at as read-only immediately, without waiting for Stripe. The
-- owner asked for the account to stop; it stops on that instruction, not on
-- a round trip.
--
-- The hold columns are deliberately still written here: they are new in
-- 20260818090000 and are NOT in the protect trigger's list, because they
-- describe a tenant-initiated state rather than a billing fact Stripe owns.
-- ============================================================================

create or replace function pilot.deactivate_account(target_account uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform pilot.assert_account_owner(target_account);

  -- No `status` write. See this migration's header: that column belongs to
  -- the Stripe webhook, and the cancellation that produces it has already
  -- been made at Stripe by the time this runs.
  update pilot.accounts
     set deactivated_at  = now(),
         -- A deactivation clears any hold: the two are different answers to
         -- the same question and an account must not be in both.
         hold_started_at = null,
         hold_ends_at    = null
   where id = target_account;
end;
$$;

comment on function pilot.deactivate_account(uuid) is
  'Owner-initiated deactivation: stamps deactivated_at and clears any hold. '
  'Deliberately does NOT write `status` — that column mirrors Stripe and is '
  'written only by the webhook (and the protect trigger enforces it). The '
  'read-only gate reads deactivated_at directly so the account stops on the '
  'owner''s instruction rather than on a webhook round trip. Destroys nothing.';

revoke all on function pilot.deactivate_account(uuid) from public;
grant execute on function pilot.deactivate_account(uuid) to authenticated;

-- Demo billing controls for comped (stripe_customer_id IS NULL) accounts.
--
-- WHY. docs/BILLING.md's "Comp / internal accounts" section already
-- documents comping as the deliberate, sanctioned way to grant internal or
-- operator access without a real Stripe subscription — tony@amgaviationgroup.com
-- (AMG Aviation Group LLC) is the one existing example, "Operator's own
-- access to the product." Until now `/settings/billing` treated every
-- comped account identically: a flat "this account isn't billed through
-- Stripe" message, no plan cards, no cancel button. That makes it
-- impossible to use a comped account to DEMO the billing surface a real
-- subscriber sees — there is nothing to click.
--
-- This migration adds exactly one column so the app can simulate a
-- cancel/resume toggle for a comped account WITHOUT inventing a fake
-- Stripe subscription and without touching the real `status` column, which
-- drives accountIsReadOnly() app-wide. Flipping `status` to `canceled` for
-- a demo would lock the account out of the entire product, not just
-- billing — exactly the opposite of "let Tony click around."
--
-- `demo_cancel_at_period_end` is UI state only:
--   * never read by the Stripe webhook or by lib/stripe/billing-facts.ts
--   * never influences accountIsReadOnly() / ACCOUNT_WRITABLE_STATUSES
--   * the check constraint below makes it structurally impossible for a
--     real (stripe_customer_id IS NOT NULL) account to ever hold `true`
--   * added to accounts_protect_billing_columns' protected list, the same
--     as plan_tier/status/seat_count — so, like every other billing
--     column, only the service-role client may write it. The demo server
--     actions (app/(app)/settings/billing/demo-actions.ts) re-verify
--     stripe_customer_id IS NULL themselves before writing, the same
--     belt-and-braces posture the trigger already applies to real billing
--     columns: two independent checks, not one.
--
-- plan_tier itself needs no new column or grant — it already exists, is
-- already protected, and demoChangePlan (same file) writes it exactly the
-- way the real webhook does: through the service-role client, after
-- re-confirming the row is comped.

alter table pilot.accounts
  add column demo_cancel_at_period_end boolean not null default false;

alter table pilot.accounts
  add constraint accounts_demo_cancel_requires_comp
  check (demo_cancel_at_period_end = false or stripe_customer_id is null);

comment on column pilot.accounts.demo_cancel_at_period_end is
  'UI-only cancel/resume toggle for comped (stripe_customer_id IS NULL) demo accounts — see 20260817090000_comp_account_demo_billing.sql. Never read by the Stripe webhook, by lib/stripe/billing-facts.ts, or by accountIsReadOnly(); flips a "Cancels"/"Resume" pill in billing-panel.tsx without ever touching the real status column. The check constraint keeps it false for any account with a real stripe_customer_id. Protected by accounts_protect_billing_columns like every other billing column — written only by the service-role demo actions in app/(app)/settings/billing/demo-actions.ts.';

-- Full replacement of protect_account_billing_columns, verbatim from
-- 20260812310000 (the CURRENT version — it carries last_billing_event_at,
-- which 20260812300000 predates) with exactly one line added
-- (demo_cancel_at_period_end). Building off anything older than the
-- current version would silently drop last_billing_event_at's protection;
-- see this directory's README on why a partial/stale rewrite of this
-- trigger is the one mistake to never make here.
create or replace function pilot.protect_account_billing_columns()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  connect_write_allowed boolean :=
    coalesce(current_setting('pilot.allow_connect_write', true), '') = 'on';
begin
  if current_user <> 'service_role' and (
    new.plan is distinct from old.plan or
    new.plan_tier is distinct from old.plan_tier or
    new.status is distinct from old.status or
    new.seat_count is distinct from old.seat_count or
    new.trial_ends_at is distinct from old.trial_ends_at or
    new.last_billing_event_at is distinct from old.last_billing_event_at or
    new.stripe_customer_id is distinct from old.stripe_customer_id or
    new.stripe_subscription_id is distinct from old.stripe_subscription_id or
    new.kind is distinct from old.kind or
    new.demo_cancel_at_period_end is distinct from old.demo_cancel_at_period_end
  ) then
    raise exception
      'pilot.accounts billing/entitlement columns can only be changed by service_role';
  end if;

  if new.connect_account_id is distinct from old.connect_account_id
     and current_user <> 'service_role'
     and not connect_write_allowed then
    raise exception
      'pilot.accounts.connect_account_id can only be changed by service_role or through pilot.connect_account_link/pilot.connect_account_unlink';
  end if;

  return new;
end;
$$;

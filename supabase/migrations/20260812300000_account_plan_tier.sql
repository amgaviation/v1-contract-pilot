-- ============================================================================
-- Three-tier plans: pilot.accounts.plan_tier
-- ============================================================================
-- The owner's brief moved the product from one plan to three (solo / pro /
-- business). This column is the tenant's entitlement tier — what the app
-- gates business-depth features on. lib/entitlements.ts is the single
-- source for what each tier includes; this migration only gives that
-- vocabulary a home on the tenant row.
--
-- HOW IT RELATES TO THE EXISTING `plan` COLUMN, so the two never read as
-- rivals: `plan` is decision #10's BILLING-SHAPE vocabulary ('solo' = flat
-- rate, 'business' = per-seat — the deferred seat-quantity plan) and keeps
-- meaning exactly that. `plan_tier` is the ENTITLEMENT ladder. All three
-- tiers today are flat-rate single-seat subscriptions, so `plan` stays
-- 'solo' while `plan_tier` varies. If per-seat billing ever ships, `plan`
-- is where that shape lands, unchanged by this file.
--
-- WHO MAY WRITE IT: the Stripe webhook's service-role client, and nothing
-- else — the same posture as every other billing/entitlement column here,
-- following the Phase 1 security review's rule ("never `grant update on
-- <table>`; always enumerate") and the 20260806000000 restore incident.
-- Three layers, two of them already in place before this file runs:
--   1. The UPDATE grant on pilot.accounts is column-enumerated
--      (20260806000000 lists the nine tenant-owned columns) and this file
--      deliberately does NOT add plan_tier to it. NOTE the deliberate
--      absence of any grant/revoke statement below: table-level SELECT
--      (Phase 1) already covers a new column, service_role already holds
--      table-wide UPDATE, and per the revoke trap in this directory's
--      README a revoke/grant pair that "looks complete" is how column
--      lists get silently narrowed. Nothing needed = nothing written.
--   2. The accounts_protect_billing_columns trigger (belt-and-braces for
--      the day a migration accidentally re-widens the grant) gains
--      plan_tier in its protected list below.
--   3. RLS still scopes any UPDATE to the caller's own account row.
--
-- NOT NULL DEFAULT 'solo': every existing account was sold the one $29
-- solo plan, so the backfill is definitionally correct, and a NOT NULL
-- column means no code path ever has to invent a meaning for "tier
-- unknown". Additive only — no existing column, constraint, policy, or
-- grant is touched other than the trigger function replacement.
-- ============================================================================

alter table pilot.accounts
  add column plan_tier text not null default 'solo';

-- Named constraint added separately (rather than inline on the column) so
-- a future tier-vocabulary change is a drop-and-re-add of a known name,
-- the same pattern 20260805160000 used for accounts_plan_check.
alter table pilot.accounts
  drop constraint if exists accounts_plan_tier_check;
alter table pilot.accounts
  add constraint accounts_plan_tier_check
  check (plan_tier in ('solo', 'pro', 'business'));

comment on column pilot.accounts.plan_tier is
  'Entitlement tier (solo/pro/business). Written ONLY by the Stripe webhook''s service-role client, mapped from the subscription''s price ID — see lib/entitlements.ts (tierForPriceId) and lib/stripe/provisioning.ts. Withheld from the tenant UPDATE grant and protected by accounts_protect_billing_columns.';

-- ----------------------------------------------------------------------------
-- Layer 2: add plan_tier to the billing-column protection trigger.
--
-- This is a full replacement of the CURRENT function body — the
-- 20260809040000 version, which pinned search_path and carved the one
-- narrow connect_account_id exception — with exactly one line added
-- (plan_tier). Everything else is verbatim from that file; a partial
-- rewrite that "simplified" the connect exception away would silently
-- re-break the OAuth callback path that exception exists for.
-- ----------------------------------------------------------------------------
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
    new.stripe_customer_id is distinct from old.stripe_customer_id or
    new.stripe_subscription_id is distinct from old.stripe_subscription_id or
    new.kind is distinct from old.kind
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

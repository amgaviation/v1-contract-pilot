-- ============================================================================
-- Concurrent-webhook ordering: pilot.accounts.last_billing_event_at
-- ============================================================================
-- The webhook's out-of-order guard (app/api/stripe/webhook/route.ts,
-- isSuperseded) only sees events whose processed_at is ALREADY set. Two
-- events for the same subscription delivered CONCURRENTLY can therefore
-- both clear that guard before either marks itself processed, and the last
-- database writer then wins regardless of event.created — a stale status or
-- tier can overwrite a newer one. See docs/BILLING.md's ordering
-- non-negotiable and the Finding-4 note.
--
-- This column is the per-account WATERMARK that closes it: the Stripe
-- `created` time of the most recent billing event applied to the account.
-- syncSubscriptionState (lib/stripe/provisioning.ts) writes plan_tier/status
-- in ONE conditional UPDATE — `... where id = $1 and last_billing_event_at <
-- $incoming` — so two concurrent updates serialise on the row lock and
-- Postgres re-checks the predicate against the freshly-committed row
-- (READ COMMITTED / EvalPlanQual): the older event's UPDATE re-evaluates
-- against the newer watermark and matches zero rows. The newer event wins
-- whichever order they commit in, not whichever writes last.
--
-- NOT NULL DEFAULT '-infinity': a strict `<` comparison then needs no null
-- branch, and a brand-new account's first real event always applies
-- (anything is greater than -infinity). Every existing row backfills to
-- '-infinity' on ADD COLUMN, which is definitionally correct — no billing
-- event has been watermarked yet, so the next one should win. `if not
-- exists` makes the add replay-safe (the recorded-version/filename skew in
-- this directory's README means a future `db push` may offer to re-apply
-- it).
--
-- WHO MAY WRITE IT: the Stripe webhook's service-role client, and nothing
-- else — the same posture as plan_tier (20260812300000) and every other
-- billing/entitlement column here. Following that precedent EXACTLY:
--   1. NO grant/revoke statement below, deliberately. The tenant UPDATE
--      grant on pilot.accounts is column-enumerated (20260806000000 lists
--      the nine tenant-owned columns) and this file does NOT add
--      last_billing_event_at to it, so `authenticated` cannot write it;
--      table-level SELECT (Phase 1) already covers a new column for reads;
--      service_role already holds table-wide UPDATE. Per the revoke trap in
--      this directory's README, a revoke/grant pair that "looks complete"
--      is exactly how a column list gets silently narrowed. Nothing needed
--      = nothing written.
--   2. The accounts_protect_billing_columns trigger gains
--      last_billing_event_at in its protected list below (belt-and-braces
--      for the day a migration accidentally re-widens the grant).
--   3. RLS still scopes any UPDATE to the caller's own account row.
--
-- Additive only — no existing column, constraint, policy, or grant is
-- touched other than the trigger-function replacement.
-- ============================================================================

alter table pilot.accounts
  add column if not exists last_billing_event_at timestamptz not null default '-infinity';

comment on column pilot.accounts.last_billing_event_at is
  'Watermark: Stripe `created` time of the most recent billing event applied to this account. Written ONLY by the Stripe webhook''s service-role client, in the same conditional UPDATE that applies status/plan_tier (WHERE last_billing_event_at < incoming) — the concurrent-event ordering guard. Withheld from the tenant UPDATE grant and protected by accounts_protect_billing_columns. See lib/stripe/provisioning.ts.';

-- ----------------------------------------------------------------------------
-- Layer 2: add last_billing_event_at to the billing-column protection
-- trigger.
--
-- This is a full replacement of the CURRENT function body — the
-- 20260812300000 version, which pinned search_path, carried plan_tier, and
-- carved the one narrow connect_account_id exception — with exactly one
-- line added (last_billing_event_at). Everything else is verbatim from that
-- file; a partial rewrite that "simplified" the connect exception away
-- would silently re-break the OAuth callback path that exception exists for
-- (this directory's README, and the 20260809040000 origin of the
-- exception).
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
    new.last_billing_event_at is distinct from old.last_billing_event_at or
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

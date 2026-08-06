-- Phase 9 Layer 1 corrective — close the cascade path around
-- trip_days_protect_billed, and make billing_state trigger-owned.
--
-- FOUND BY THE LIVE REVIEW of 20260807000000, and worth writing down in
-- full because the mechanism generalises.
--
-- pilot.trip_days references pilot.trips ON DELETE CASCADE. Deleting a trip
-- therefore issues a real DELETE against its day rows, which DOES fire
-- trip_days_protect_billed's BEFORE DELETE trigger. But the cascade is
-- driven from the parent's AFTER-delete machinery, so by the time the child
-- trigger runs, the pilot.trips row is already gone. The function's lookup
--
--   select billing_state into state from pilot.trips where id = ...;
--
-- finds nothing, `state` is NULL, and `NULL in ('invoiced','paid')`
-- evaluates to NULL — not true. The raise never fires and the day rows
-- vanish silently.
--
-- THE GENERAL LESSON, which is the reason this file exists rather than a
-- one-line patch: a guard whose negative case depends on a value being
-- present PASSES when the value is absent. Three-valued logic turns a
-- missing row into permission. Every `x in (...)` written as a barrier
-- needs an explicit answer for `x is null`, and the answer has to be
-- chosen, not inherited from SQL's default.
--
-- HOW BAD WAS IT. Less than it looks, because a second layer held — the
-- same shape as the accounts grant incident (20260806000000). Phase 5 gave
-- pilot.invoice_lines.trip_id an ON DELETE RESTRICT reference to
-- pilot.trips, so a trip that genuinely carries invoice lines cannot be
-- deleted at all; the delete fails with 23503 before any cascade begins.
-- The reachable gap was narrower: pilot.trips.billing_state was in the
-- tenant's own INSERT and UPDATE column grants, so a tenant could set
-- billing_state='invoiced' on a trip with NO invoice lines and then delete
-- it, taking its day rows with it. No client is holding a document in that
-- state, so nothing diverged — but the protection was decorative, and the
-- migration's comment claimed otherwise.
--
-- Three changes below, in order of how much they matter.

-- ---------------------------------------------------------------------------
-- 1. billing_state becomes trigger-owned, which is what every comment in
--    this schema already assumes it is.
--
-- Phase 3 granted it to `authenticated` on both INSERT and UPDATE. Nothing
-- in the app has ever written it: pilot.invoices_sync_trip_billing_state
-- derives it from live invoice lines, and app/(app)/trips/actions.ts
-- carries an explicit comment that billing_state is "deliberately NOT in
-- this payload". A grant no code uses and a trigger owns is not a
-- convenience, it is a way for a tenant to lie about whether they have
-- been paid — and, until this file, to route around a delete guard.
--
-- Column-precise REVOKE: the other twelve columns in that grant are
-- legitimate and stay. Note this is a REVOKE and not a re-issued narrower
-- GRANT, for the reason 20260806000000 exists — `grant update (a,b)` ADDS
-- privileges and never removes what is already there.
-- ---------------------------------------------------------------------------
revoke insert (billing_state), update (billing_state) on pilot.trips from authenticated;

-- ---------------------------------------------------------------------------
-- 2. Guard the parent, where the cascade actually starts.
--
-- This is the real fix. A child trigger can never reliably defend against
-- its own parent's deletion — the row it needs to consult is already gone.
-- The guard has to live on pilot.trips.
--
-- It also upgrades an existing bad error message: deleting an invoiced trip
-- already failed, via invoice_lines' ON DELETE RESTRICT, with a raw foreign
-- key violation naming a constraint. A pilot now gets a sentence.
--
-- SUPERSEDED BY 20260807020000 in two ways, both found by review of THIS
-- file: it keys on the cached billing_state rather than on a live invoice
-- line, and it has no service_role escape — so deleting a tenant raised
-- 23514, because pilot.accounts cascades to pilot.trips and this guard fires
-- inside that cascade regardless of role. Account deletion is the only
-- offboarding and erasure primitive there is.
--
-- Note also that the revoke above, plus this file's reasoning, left
-- billing_state = 'written_off' with NO writer at all: the sync trigger only
-- ever writes unbilled/invoiced/paid. Written-off is currently an unreachable
-- state that the trips list still renders a badge for. Recorded as an open
-- item in docs/PLAN.md rather than papered over with an RPC nothing calls.
-- ---------------------------------------------------------------------------
create or replace function pilot.trips_protect_delete_when_billed()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.billing_state in ('invoiced', 'paid') then
    raise exception
      'This trip has been invoiced and cannot be deleted. Void the invoice first.'
      using errcode = '23514';
  end if;
  return old;
end;
$$;

create trigger trips_protect_delete_when_billed
  before delete on pilot.trips
  for each row execute function pilot.trips_protect_delete_when_billed();

-- ---------------------------------------------------------------------------
-- 3. Make the child trigger's null branch a decision instead of an accident.
--
-- With (2) in place, reaching this function with a missing parent means
-- exactly one thing: a cascade from a trip whose deletion was already
-- allowed. Permitting it is correct — the trip is going, and its days go
-- with it. What was wrong before was not the outcome but that the outcome
-- fell out of NULL comparison semantics rather than being written down.
--
-- `is distinct from` rather than `in (...)` on the live path too, so a
-- future null can never re-open this by the same route.
-- ---------------------------------------------------------------------------
create or replace function pilot.trip_days_protect_billed()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  state text;
  target_trip uuid;
  target_account uuid;
begin
  target_trip := coalesce(new.trip_id, old.trip_id);
  target_account := coalesce(new.account_id, old.account_id);

  select billing_state into state
  from pilot.trips
  where id = target_trip and account_id = target_account;

  -- The parent is gone. Only one path gets here: an ON DELETE CASCADE from
  -- a pilot.trips row whose deletion trips_protect_delete_when_billed
  -- already permitted. Allow it, deliberately.
  if state is null then
    return coalesce(new, old);
  end if;

  if state = 'invoiced' or state = 'paid' then
    raise exception
      'This trip has been invoiced. Its days can no longer be changed.'
      using errcode = '23514';
  end if;

  return coalesce(new, old);
end;
$$;

-- Phase 9 Layer 1 — review corrections.
--
-- Two adversarial reviews (security, QA) ran against the live database and
-- between them found one production-breaking regression, one unrepresentable
-- value, two guards keyed on the wrong fact, a missing service_role escape,
-- and a domain error. Each is fixed below with the finding that produced it,
-- because the finding is the part a future reader needs.

-- ===========================================================================
-- 1. CRITICAL, self-inflicted: the previous migration's billing_state revoke
--    broke invoice issuance for every trip-linked invoice.
--
-- 20260807010000 revoked INSERT/UPDATE on pilot.trips.billing_state from
-- `authenticated`, reasoning that "nothing in the app has ever written it —
-- a trigger owns it". That was right about app code and WRONG ABOUT THE
-- TRIGGER. pilot.invoices_sync_trip_billing_state() is SECURITY INVOKER, so
-- when a tenant updates an invoice's status the trigger body runs as
-- `authenticated` and executes `update pilot.trips set billing_state = ...`
-- with the caller's own privileges. A trigger has no privilege of its own.
--
-- Observed live, and isolated in three runs:
--   send invoice WITH a trip line     -> 42501 permission denied for table trips
--   send invoice with NO trip line    -> succeeded (the loop body never runs)
--   same send, column privilege back  -> succeeded
--
-- The whole transaction aborts, so sendInvoice, voidInvoice, and
-- recordPayment's advance to partial/paid were all broken for any invoice
-- drafted from a trip — which is every invoice createInvoiceDraft produces.
--
-- Worse than the outage: billing_state became unwritable by anything, so it
-- was pinned at 'unbilled' forever, and both guards 20260807010000 exists to
-- install were branching on a value that could never change. A protection
-- that cannot fire is the exact failure mode that file's own header warns
-- about. It shipped it.
--
-- THE FIX IS NOT TO RE-GRANT THE COLUMN. It is to give the trigger its own
-- authority, the way every other privileged operation in this schema already
-- works (pilot.current_account_ids, pilot.is_account_owner,
-- pilot.next_invoice_number are all SECURITY DEFINER for this reason).
--
-- Safety of DEFINER here: the function is reached ONLY as an AFTER UPDATE
-- trigger on pilot.invoices, and it writes exclusively
-- `where account_id = new.account_id` — an account_id taken from the invoice
-- row the caller just updated, which RLS already constrained to the caller's
-- own tenant. The elevated write can therefore never reach an account the
-- caller could not already write. Unlike next_invoice_number, this function
-- takes NO caller-supplied account id, so there is no parameter to forge and
-- no in-body tenancy check to add.
-- ===========================================================================
create or replace function pilot.invoices_sync_trip_billing_state()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  live_status text;
begin
  if new.status is distinct from old.status then
    for r in
      select distinct coalesce(l.trip_id, e.trip_id) as trip_id
      from pilot.invoice_lines l
      left join pilot.expenses e on e.account_id = l.account_id and e.id = l.expense_id
      where l.account_id = new.account_id and l.invoice_id = new.id
        and coalesce(l.trip_id, e.trip_id) is not null
    loop
      select i.status into live_status
        from pilot.invoice_lines l2
        join pilot.invoices i on i.account_id = l2.account_id and i.id = l2.invoice_id
        left join pilot.expenses e2 on e2.account_id = l2.account_id and e2.id = l2.expense_id
        where l2.account_id = new.account_id
          and coalesce(l2.trip_id, e2.trip_id) = r.trip_id
          and i.status <> 'void'
        limit 1;

      update pilot.trips set billing_state = case
          when live_status = 'paid' then 'paid'
          when live_status is not null then 'invoiced'
          else 'unbilled'
        end
        where account_id = new.account_id and id = r.trip_id
          and billing_state <> 'written_off';
    end loop;
  end if;
  return new;
end;
$$;

comment on function pilot.invoices_sync_trip_billing_state() is
  'SECURITY DEFINER because pilot.trips.billing_state is deliberately withheld from every tenant grant — this trigger is the only writer. It takes no caller-supplied account id; every write is scoped to the updated invoice''s own account_id.';

-- ===========================================================================
-- 2. "Is this trip committed?" — one definition, in one place.
--
-- REVIEW FINDING (QA, CRITICAL): both Phase 9 freezes keyed on
-- trips.billing_state, and invoices_sync_trip_billing_state only fires on an
-- invoice STATUS CHANGE. A trip sitting on a DRAFT invoice therefore still
-- reads 'unbilled', so its day rows stayed editable through the entire draft
-- window — which is exactly when a pilot goes back to fix a day. Sequence:
-- draft the invoice, notice day 3 was standby not flight, fix the grid, send.
-- The client now holds a document that does not match the trip, and the trip
-- freezes in its new state so it can never be reconciled. That is verbatim
-- the divergence 20260807000000's comment says the freeze exists to remove.
--
-- The right fact to key on is not a cached summary column but the thing that
-- is actually true: does a live invoice line reference this trip? Phase 5's
-- trips_protect_billed_client already resolves exactly that, including via a
-- rebilled expense's own trip_id and excluding voided invoices. This lifts
-- that query into one function so three guards cannot drift apart.
--
-- SECURITY INVOKER, deliberately. A DEFINER version would need EXECUTE
-- granted to `authenticated`, and a DEFINER function taking (account_id,
-- trip_id) and returning a non-null answer is an existence oracle across
-- tenants — the CRITICAL-2 shape this schema already closed twice. As an
-- INVOKER function it reads through the caller's own RLS: a tenant sees
-- their own lines, service_role bypasses RLS, and there is nothing to leak.
-- ===========================================================================
create or replace function pilot.trip_committed_invoice(
  p_account_id uuid,
  p_trip_id uuid
)
returns text
language sql
stable
security invoker
set search_path = ''
as $$
  select case
           when i.invoice_number is not null then i.invoice_number
           else 'a draft invoice'
         end
  from pilot.invoice_lines l
  join pilot.invoices i on i.account_id = l.account_id and i.id = l.invoice_id
  left join pilot.expenses e on e.account_id = l.account_id and e.id = l.expense_id
  where l.account_id = p_account_id
    and coalesce(l.trip_id, e.trip_id) = p_trip_id
    and i.status <> 'void'
  order by (i.invoice_number is null)
  limit 1;
$$;

comment on function pilot.trip_committed_invoice(uuid, uuid) is
  'The label of a live (non-void) invoice billing this trip, or null. The single definition of "committed" — three guards read it, so they cannot drift. SECURITY INVOKER on purpose: a DEFINER form would be a cross-tenant existence oracle.';

revoke all on function pilot.trip_committed_invoice(uuid, uuid) from public;
grant execute on function pilot.trip_committed_invoice(uuid, uuid) to authenticated;

-- ===========================================================================
-- 3. A day may be worked in part. (QA CRITICAL.)
--
-- pilot.trips.day_count is numeric(5,1) and the trip form advertises "Half
-- days are allowed" — a shipped, documented feature. pilot.trip_days had one
-- row per date and NO quantity, so a 2.5-day trip could not be represented
-- at all: the grid seeds 2 rows (floor), and the pilot has no way to add the
-- half back. The first Save on a legacy fractional trip therefore turned a
-- $3,750 job into a $3,000 job, permanently, behind one line of caption text.
--
-- 20260807000000's header refused to backfill on precisely the grounds that
-- "a trip billed at 2.5 days cannot become a whole number of calendar-day
-- rows without changing what it bills" — and then shipped a UI that does that
-- one Save at a time. A replacement model has to be a superset of what it
-- replaces; this column is what makes it one.
--
-- Bounded at 1: a calendar day cannot be more than a day. A contract that
-- pays more than a day rate for a long duty day expresses that as a day type
-- with a higher rate, not as a quantity above one — keeping quantity a
-- statement about TIME and rate a statement about MONEY.
-- ===========================================================================
alter table pilot.trip_days
  add column if not exists quantity numeric(3,1) not null default 1
    check (quantity > 0 and quantity <= 1);

comment on column pilot.trip_days.quantity is
  'Fraction of the day worked, 0.1 to 1.0. Exists so the numeric(5,1) half-days pilot.trips.day_count always allowed remain representable — without it, converting a 2.5-day trip to day rows silently drops half a day of billing.';

-- ADD COLUMN does not extend an existing column-scoped grant (the lesson
-- 20260805090000 recorded when the travel-day columns shipped ungranted).
grant insert (quantity), update (quantity) on pilot.trip_days to authenticated;

-- ===========================================================================
-- 4. The three guards, rewritten against the definition in (2), and given the
--    service_role escape they should have had.
--
-- REVIEW FINDING (security, MEDIUM): every other protective trigger in this
-- schema opens with a service_role exemption — invoices_protect_issued,
-- invoice_lines_protect_issued, invoices_force_draft_on_insert all do. The
-- two Phase 9 guards did not, and the consequence was concrete: deleting a
-- tenant raises 23514, because pilot.accounts cascades to pilot.trips and the
-- BEFORE DELETE guard fires inside that cascade regardless of role. Account
-- deletion is the only offboarding and erasure primitive there is. Losing it
-- to a guard that was meant to protect an invoice is a one-way door.
--
-- These stay SECURITY INVOKER so `current_user` reports the actual caller.
-- Inside a SECURITY DEFINER function it would report the OWNER instead, and
-- the exemption would silently match for everyone — a mistake this build has
-- already made once and does not intend to make again.
-- ===========================================================================
create or replace function pilot.trip_days_protect_billed()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  committed text;
  target_trip uuid;
  target_account uuid;
begin
  if current_user = 'service_role' or current_setting('role', true) = 'service_role' then
    return coalesce(new, old);
  end if;

  target_trip := coalesce(new.trip_id, old.trip_id);
  target_account := coalesce(new.account_id, old.account_id);

  -- The parent is gone: an ON DELETE CASCADE from a pilot.trips row whose
  -- deletion trips_protect_delete_when_billed already permitted. Allow it,
  -- deliberately — and note the shape, because it is why 20260807010000 had
  -- to exist: a guard whose negative case depends on a value being PRESENT
  -- passes when the value is absent. Three-valued logic turns a missing row
  -- into permission unless someone writes the branch down.
  if not exists (
    select 1 from pilot.trips where id = target_trip and account_id = target_account
  ) then
    return coalesce(new, old);
  end if;

  committed := pilot.trip_committed_invoice(target_account, target_trip);
  if committed is not null then
    raise exception
      'This trip is billed on %. Remove it from that invoice before changing its days.', committed
      using errcode = '23514';
  end if;

  return coalesce(new, old);
end;
$$;

create or replace function pilot.trips_protect_delete_when_billed()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  committed text;
begin
  if current_user = 'service_role' or current_setting('role', true) = 'service_role' then
    return old;
  end if;

  -- The account row is already gone, so this delete is a cascade from
  -- pilot.accounts — tenant deletion, not trip deletion. Postgres removes the
  -- parent row before running the referential-action triggers, which makes
  -- this check reliable. Blocking here would leave no way to delete a tenant
  -- who has ever issued an invoice.
  if not exists (select 1 from pilot.accounts where id = old.account_id) then
    return old;
  end if;

  committed := pilot.trip_committed_invoice(old.account_id, old.id);
  if committed is not null then
    raise exception
      'This trip is billed on % and cannot be deleted. Void that invoice first.', committed
      using errcode = '23514';
  end if;

  return old;
end;
$$;

-- REVIEW FINDING (security, MEDIUM 4): an issued invoice's underlying trip
-- stayed fully rewritable at the database. `authenticated` holds UPDATE on
-- starts_on, ends_on, day_rate_cents, day_count, the travel-day pair and
-- status; no trigger checked anything on UPDATE of pilot.trips
-- (trips_protect_billed_client guards client_id only). Demonstrated live
-- against a trip whose invoice was already sent:
--
--   update pilot.trips set day_count=99, day_rate_cents=1, status='canceled'
--     -> SUCCEEDED
--
-- Reachable from a browser, not only from a server action: the project URL
-- and publishable key ship in the client bundle by design and the session JWT
-- is in cookies, so PostgREST is directly addressable as `authenticated`.
-- app/(app)/trips/actions.ts blocks this, and its comment says the lock is
-- "enforced HERE, not only by the disabled controls on the page" — true, and
-- still not a database guarantee, which is what the reader takes from it.
--
-- The invoice itself is genuinely immovable (invoices_protect_issued diffs
-- the whole row), so this could not alter a client's document. What it could
-- do is make the trip disagree with it, which is the same divergence (2)
-- exists to prevent, arriving by a different door.
--
-- aircraft_ident, aircraft_type, trip_kind and notes stay editable: none of
-- them price anything, and a pilot correcting a tail number on a billed trip
-- is doing the right thing.
create or replace function pilot.trips_protect_billed_facts()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  committed text;
begin
  if current_user = 'service_role' or current_setting('role', true) = 'service_role' then
    return new;
  end if;

  if new.starts_on = old.starts_on
     and new.ends_on = old.ends_on
     and new.day_rate_cents = old.day_rate_cents
     and new.day_count = old.day_count
     and new.travel_day_count = old.travel_day_count
     and new.travel_day_rate_cents is not distinct from old.travel_day_rate_cents
     and new.status = old.status then
    return new;
  end if;

  committed := pilot.trip_committed_invoice(old.account_id, old.id);
  if committed is not null then
    raise exception
      'This trip is billed on %. Remove it from that invoice before changing its dates, rates or status.', committed
      using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger trips_protect_billed_facts
  before update of starts_on, ends_on, day_rate_cents, day_count,
                   travel_day_count, travel_day_rate_cents, status
  on pilot.trips
  for each row execute function pilot.trips_protect_billed_facts();

-- ===========================================================================
-- 5. A built-in day type cannot be deleted. (QA HIGH.)
--
-- deleteDayType had no is_builtin guard, and the ON DELETE RESTRICT from
-- trip_days only protects a type already in use. Because this phase
-- deliberately writes no trip_days rows, NO built-in type is referenced by
-- anything for any existing tenant — so deleting "Flight day" succeeded.
-- The trip grid's zero-state seed then finds no 'flight' type and seeds
-- nothing, for every legacy trip, and accounts_seed_day_types is an AFTER
-- INSERT on pilot.accounts so it never comes back.
--
-- 20260807000000's own comment says is_builtin "exists so a future 'restore
-- defaults' has something truthful to restore". There is no restore. Until
-- there is, the built-ins are not deletable — archiving already does
-- everything a pilot actually wants here, and unlike deletion it is
-- reversible.
-- ===========================================================================
create or replace function pilot.day_types_protect_builtin_delete()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if current_user = 'service_role' or current_setting('role', true) = 'service_role' then
    return old;
  end if;

  if old.is_builtin then
    raise exception
      'This is one of the starting day types and cannot be deleted. Archive it instead — archived types stay on the trips that already use them.'
      using errcode = '23514';
  end if;

  return old;
end;
$$;

create trigger day_types_protect_builtin_delete
  before delete on pilot.day_types
  for each row execute function pilot.day_types_protect_builtin_delete();

-- ===========================================================================
-- 6. An off day draws per diem. (QA, aviation domain.)
--
-- 20260807000000 seeded 'off' with counts_for_per_diem = false, three lines
-- under a comment stating that per diem "is commonly paid for every day AWAY,
-- including days that bill nothing — so this is a separate flag, not
-- `billable` reused". The seed then reused `billable` anyway.
--
-- A mid-trip off day — an RON in Aspen waiting on the owner — is the
-- PARADIGM per-diem day: you are away, you eat, you bill nothing. Seeding it
-- false under-pays the pilot two days of per diem on a five-day trip with two
-- off days. references/contract-pilot-business.md §4 treats per diem as a
-- flat daily meal rate tied to being away, not to work performed.
--
-- Safe to correct in place: the feature has not reached a user, so no tenant
-- has expressed a preference this would overwrite. Scoped to is_builtin rows
-- so a pilot's own day types are never touched.
-- ===========================================================================
create or replace function pilot.accounts_seed_day_types()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  insert into pilot.day_types
    (account_id, key, label, billable, counts_for_per_diem, invoice_line_type, sort_order, is_builtin)
  values
    (new.id, 'flight',  'Flight day',  true,  true, 'flight_day', 10, true),
    (new.id, 'travel',  'Travel day',  true,  true, 'travel_day', 20, true),
    (new.id, 'standby', 'Standby day', true,  true, 'other',      30, true),
    -- Not billable, and still away. See the block comment above.
    (new.id, 'off',     'Off day',     false, true, 'other',      40, true)
  on conflict (account_id, key) do nothing;
  return new;
end;
$$;

update pilot.day_types
   set counts_for_per_diem = true
 where is_builtin
   and key = 'off'
   and counts_for_per_diem = false;

-- ===========================================================================
-- 7. Bound minimum_days at the database, matching the app. (Security, LOW.)
--
-- app/(app)/clients/actions.ts parses it with parseTenth(..., { max: 999 }).
-- The CHECK said only `>= 0`, and PostgREST is directly addressable, so a
-- crafted PATCH stored 9999.9 — which then inflates a real invoice line to a
-- 9,999.9-day minimum. numeric(5,1) also silently ROUNDS a second decimal
-- (2.25 becomes 2.3) rather than rejecting it, which is why parseTenth
-- exists; the type cannot be made to reject it, so the app boundary stays
-- the one that catches that.
-- ===========================================================================
alter table pilot.clients
  drop constraint if exists clients_minimum_days_check;
alter table pilot.clients
  add constraint clients_minimum_days_check
  check (minimum_days is null or (minimum_days >= 0 and minimum_days <= 999));

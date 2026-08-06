-- Phase 9 Layer 1 — day types, trip days, and per-client rate cards.
--
-- THE GAP THIS CLOSES. pilot.trips carries exactly two scalar pairs:
-- day_rate_cents/day_count and travel_day_rate_cents/travel_day_count. There
-- is no standby day, no per-diem day count, no minimum, no cancellation
-- term — which is why pilot.invoice_lines.line_type already declares
-- 'per_diem' and 'cancellation_fee' values that NOTHING IN THE PRODUCT CAN
-- PRODUCE. Phase 5 wrote the vocabulary correctly and had nowhere to source
-- the quantities from.
--
-- references/contract-pilot-business.md §4 is where the requirement comes
-- from, and it is explicit that this is the variable part of the job:
-- travel days "commonly paid at half to full day rate (varies — contract
-- term to capture, not assume)", standby days "sometimes at reduced rate",
-- per diem "common instead of meal receipts". Every one of those is
-- negotiated per contract. A fixed two-rate schema cannot hold them, and
-- guessing an industry default would be worse than holding nothing.
--
-- THE GOVERNING PRINCIPLE (docs/PLAN.md Phase 9):
--
--     Taxonomy is the tenant's. State machines are ours.
--
-- A pilot may invent, rename, reorder and retire the day types they bill
-- under. They may NOT invent the invoice line types those days become —
-- invoices_protect_issued, invoice_lines_validate_trip and
-- invoices_sync_trip_billing_state all branch on line_type/status/
-- billing_state, and a tenant-defined string inside those makes billing
-- unverifiable. pilot.day_types.invoice_line_type is exactly where that
-- boundary is drawn: the tenant names the thing, and picks which of OUR
-- line types it bills as.
--
-- ---------------------------------------------------------------------------
-- ON THE BACKFILL — A DELIBERATE DEPARTURE FROM THE WRITTEN PLAN.
--
-- The plan says this migration "backfills trip_days from day_count /
-- travel_day_count". It must not, and the reason is arithmetic:
--
--   * day_count is numeric(5,1). A trip billed at 2.5 days cannot become a
--     whole number of calendar-day rows without changing what it bills.
--   * day_count + travel_day_count has no relationship to the number of
--     calendar days between starts_on and ends_on. A 3-day trip may bill 2
--     flight days, or 5 (two crew days on one date is a real thing).
--   * Nothing records WHICH dates were flight days versus travel days. That
--     information was never captured, so any backfill would be inventing it.
--
-- The plan's own gate on this work is "not one issued invoice changed
-- value". A backfill that guesses dates and rounds fractional days would
-- fail that gate on real data, and would fail it SILENTLY — the invoice
-- totals only move the next time a draft is generated.
--
-- So: no trip gets day rows from this migration. A trip with no day rows
-- bills exactly as it does today, through the scalar path that
-- createInvoiceDraft keeps. The trip screen's day grid seeds its initial,
-- UNSAVED state from the scalar counts, the pilot looks at it and corrects
-- it, and saving is what writes trip_days. That is the same draft-confirm
-- boundary the logbook uses for exactly the same reason: a machine may
-- propose a record with legal or financial weight, and a human confirms it.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- pilot.day_types — the tenant's own vocabulary for what a day of work is.
-- ---------------------------------------------------------------------------
create table if not exists pilot.day_types (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references pilot.accounts(id) on delete cascade,
  -- Stable machine identifier. The seeder claims 'flight'/'travel'/
  -- 'standby'/'off'; a pilot's own additions get whatever slug the app
  -- derives. Withheld from the UPDATE grant below — `label` is the name a
  -- pilot renames, `key` is what anything else may rely on.
  key text not null check (key ~ '^[a-z][a-z0-9_]{0,30}$'),
  label text not null check (length(btrim(label)) between 1 and 60),
  -- Does a day of this type produce an invoice line at all? An off day is
  -- part of the trip's shape — it feeds per-diem counts — without being
  -- billable.
  billable boolean not null default true,
  -- Per diem is commonly paid for every day AWAY, including days that bill
  -- nothing — so this is a separate flag, not `billable` reused. An RON
  -- waiting on the owner is the paradigm case: nothing billable happens and
  -- the pilot still has to eat.
  --
  -- What this flag CANNOT express is the away-vs-home distinction, which is
  -- the thing per diem actually turns on: standby at home base draws none,
  -- standby on the road draws it. A tenant can model that today only by
  -- keeping two day types. Recorded as a known limitation rather than
  -- pretended away — see docs/PLAN.md Phase 9.
  counts_for_per_diem boolean not null default true,
  -- The rate this day type bills at absent a client-specific override.
  -- Nullable, and null is meaningful: "I have not agreed a rate for this".
  -- createInvoiceDraft skips a day it cannot price rather than billing zero.
  default_rate_cents bigint
    check (default_rate_cents is null or default_rate_cents >= 0),
  -- THE BOUNDARY. Which of Phase 5's fixed line types a day of this type
  -- bills as. 'per_diem' and 'reimbursable_expense' are deliberately absent:
  -- per-diem lines are computed from counts_for_per_diem against the
  -- client's per-diem rate, and a reimbursable_expense line must reference
  -- an actual pilot.expenses row (invoice_lines has a CHECK that enforces
  -- it), so neither can be produced by a day row.
  invoice_line_type text not null default 'flight_day'
    check (invoice_line_type in ('flight_day', 'travel_day', 'other')),
  sort_order integer not null default 0,
  -- True only for the four rows the seeder writes. Withheld from both the
  -- INSERT and UPDATE grants: a tenant may add and archive freely but may
  -- not claim, or disclaim, seeded provenance. Nothing branches on it today
  -- beyond the settings screen's copy; it exists so a future "restore
  -- defaults" has something truthful to restore.
  is_builtin boolean not null default false,
  -- Archive, never delete. A day type attached to three years of trips must
  -- keep rendering — same reasoning as clients.archived_at. The FK from
  -- trip_days is ON DELETE RESTRICT, so a used type cannot be deleted even
  -- if someone tries.
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (account_id, key),
  -- FK target for tenant-scoped children. See the Phase 3 migration's
  -- "pattern 1" comment: composite FKs are what stop tenant A attaching a
  -- row to tenant B's parent, and they need this redundant-looking unique.
  unique (account_id, id)
);

comment on table pilot.day_types is
  'Tenant-owned taxonomy: what a day of work is called and what it pays. invoice_line_type is the boundary — the tenant names the day type, but it must bill as one of Phase 5''s fixed line types, because triggers branch on those.';

create trigger day_types_set_updated_at
  before update on pilot.day_types
  for each row execute function pilot.set_updated_at();

create index if not exists day_types_account_sort_idx
  on pilot.day_types (account_id, sort_order, key);

-- ---------------------------------------------------------------------------
-- pilot.trip_days — one row per calendar day of a trip.
--
-- references/product-translation.md §2: "Day records under an assignment:
-- each calendar day typed duty / travel / standby / off ... this single
-- structure feeds duty legality, invoice lines, and per diem counts. One
-- capture, many outputs." That is this product's own thesis applied to
-- money, and it is why the day is the row rather than a count on the trip.
-- ---------------------------------------------------------------------------
create table if not exists pilot.trip_days (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references pilot.accounts(id) on delete cascade,
  trip_id uuid not null,
  foreign key (account_id, trip_id) references pilot.trips (account_id, id) on delete cascade,
  day_on date not null,
  day_type_id uuid not null,
  -- RESTRICT, not CASCADE: deleting a day type must never silently delete
  -- billable days. The app archives instead.
  foreign key (account_id, day_type_id) references pilot.day_types (account_id, id) on delete restrict,
  -- SNAPSHOTTED AT CAPTURE, never resolved at render.
  -- references/product-translation.md §2: "Snapshot the terms at
  -- confirmation — rates renegotiate; invoices must reflect the agreed
  -- ones." If this column were a join to day_types.default_rate_cents, then
  -- raising a rate in settings would restate the value of work already
  -- flown, and an invoice drafted afterwards would be a WRONG invoice. The
  -- resolution order (client override -> day type default) runs once, in
  -- the app, at the moment the day is captured, and the answer lands here.
  rate_cents bigint not null default 0 check (rate_cents >= 0),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- One row per calendar day per trip. Two crew days on one date is not a
  -- thing this models; a day is a day.
  unique (account_id, trip_id, day_on),
  unique (account_id, id)
);

comment on table pilot.trip_days is
  'One row per calendar day of a trip. rate_cents is snapshotted at capture — never re-resolved from day_types, or a rate change would restate work already flown.';

create trigger trip_days_set_updated_at
  before update on pilot.trip_days
  for each row execute function pilot.set_updated_at();

create index if not exists trip_days_trip_idx
  on pilot.trip_days (account_id, trip_id, day_on);

-- ---------------------------------------------------------------------------
-- pilot.client_rates — "Meridian pays travel at half" as data, not memory.
-- ---------------------------------------------------------------------------
create table if not exists pilot.client_rates (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references pilot.accounts(id) on delete cascade,
  client_id uuid not null,
  foreign key (account_id, client_id) references pilot.clients (account_id, id) on delete cascade,
  day_type_id uuid not null,
  -- CASCADE here, unlike trip_days: an override is a preference, not a
  -- record of work. Deleting an unused day type should take its overrides
  -- with it rather than blocking on them.
  foreign key (account_id, day_type_id) references pilot.day_types (account_id, id) on delete cascade,
  rate_cents bigint not null check (rate_cents >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (account_id, client_id, day_type_id),
  unique (account_id, id)
);

comment on table pilot.client_rates is
  'Per client x day type rate override. Consulted ONLY at day capture, to fill trip_days.rate_cents — never read at invoice time.';

create trigger client_rates_set_updated_at
  before update on pilot.client_rates
  for each row execute function pilot.set_updated_at();

-- ---------------------------------------------------------------------------
-- pilot.clients — the three contract terms that had nowhere to live.
-- ---------------------------------------------------------------------------
alter table pilot.clients
  -- 'receipts' is the default because it is what the product already did:
  -- meals arrive as pilot.expenses rows with category='meals'. Switching a
  -- client to 'per_diem' is an affirmative choice, so no existing client's
  -- invoices change shape when this migration lands.
  add column if not exists per_diem_mode text not null default 'receipts'
    check (per_diem_mode in ('per_diem', 'receipts')),
  -- Day-rate agreements commonly carry a minimum ("2-day minimum, portal
  -- to portal"). Applied by createInvoiceDraft as a FLOOR on the billable
  -- day quantity, with the minimum named in the line description so the
  -- pilot sees why the quantity exceeds the days worked. Never silent.
  add column if not exists minimum_days numeric(5,1)
    check (minimum_days is null or minimum_days >= 0),
  -- A NOTE, not a computed rule, and deliberately so. The domain reference
  -- calls the "50-100% inside 24-48 h" figures common convention, not law —
  -- they are whatever the pilot's own contract says. Computing an
  -- unenforceable fee is worse than recording the agreement and letting the
  -- pilot add the line. pilot.invoice_lines.line_type already accepts
  -- 'cancellation_fee' as a manual line.
  add column if not exists cancellation_policy_note text;

-- ---------------------------------------------------------------------------
-- SEEDING. Every account gets the four day types at creation.
--
-- Mirrors accounts_seed_invoice_sequence (20260805090000): the alternative
-- is a new tenant opening the trip screen to an empty day-type picker, which
-- is the zero-state failure the settings work exists to avoid. Seeding at
-- account creation is the one place it is cheap to guarantee.
--
-- The four are the domain's own vocabulary, not invented here:
-- references/product-translation.md §2 types each day duty / travel /
-- standby / off. 'flight' is used rather than 'duty' because this product
-- bills flying, and a contract pilot reading their own invoice expects
-- "flight day".
--
-- Rates are NULL, not zero. A seeded rate would be a number the product
-- made up appearing on a real invoice. Null means "you have not told me
-- yet", and createInvoiceDraft skips an unpriced day and says so.
-- ---------------------------------------------------------------------------
create or replace function pilot.accounts_seed_day_types()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  insert into pilot.day_types
    (account_id, key, label, billable, counts_for_per_diem, invoice_line_type, sort_order, is_builtin)
  values
    (new.id, 'flight',  'Flight day',  true,  true,  'flight_day', 10, true),
    (new.id, 'travel',  'Travel day',  true,  true,  'travel_day', 20, true),
    (new.id, 'standby', 'Standby day', true,  true,  'other',      30, true),
    (new.id, 'off',     'Off day',     false, false, 'other',      40, true)
  on conflict (account_id, key) do nothing;
  return new;
end;
$$;

create trigger accounts_seed_day_types
  after insert on pilot.accounts
  for each row execute function pilot.accounts_seed_day_types();

-- Accounts that predate the trigger. `on conflict do nothing` inside the
-- function makes this safe to re-run.
insert into pilot.day_types
  (account_id, key, label, billable, counts_for_per_diem, invoice_line_type, sort_order, is_builtin)
select a.id, v.key, v.label, v.billable, v.per_diem, v.line_type, v.sort_order, true
from pilot.accounts a
cross join (values
  ('flight',  'Flight day',  true,  true,  'flight_day', 10),
  ('travel',  'Travel day',  true,  true,  'travel_day', 20),
  ('standby', 'Standby day', true,  true,  'other',      30),
  ('off',     'Off day',     false, false, 'other',      40)
) as v(key, label, billable, per_diem, line_type, sort_order)
on conflict (account_id, key) do nothing;

-- ---------------------------------------------------------------------------
-- A day row must fall inside its trip's dates.
--
-- Without this, a fat-fingered date bills a day that is not part of the job,
-- and the trip screen (which renders one row per date in the range) would
-- never show it — an invisible billable row is the worst kind.
--
-- The asymmetry is deliberate and load-bearing: this fires on trip_days, and
-- a SECOND trigger below fires on trips. Validating only the child would let
-- a pilot narrow a trip's dates and strand day rows outside the new range,
-- where the grid cannot see them and the invoice draft still bills them.
-- ---------------------------------------------------------------------------
create or replace function pilot.trip_days_validate_within_trip()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  t_start date;
  t_end   date;
begin
  select starts_on, ends_on into t_start, t_end
  from pilot.trips
  where id = new.trip_id and account_id = new.account_id;

  -- No row found means the composite FK is about to reject this anyway;
  -- say nothing here rather than raising a worse-worded error first.
  if t_start is null then
    return new;
  end if;

  if new.day_on < t_start or new.day_on > t_end then
    raise exception
      'Day % is outside the trip dates (% to %)', new.day_on, t_start, t_end
      using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger trip_days_validate_within_trip
  before insert or update of day_on, trip_id on pilot.trip_days
  for each row execute function pilot.trip_days_validate_within_trip();

create or replace function pilot.trips_protect_day_range()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  stranded integer;
begin
  if new.starts_on = old.starts_on and new.ends_on = old.ends_on then
    return new;
  end if;

  select count(*) into stranded
  from pilot.trip_days d
  where d.account_id = new.account_id
    and d.trip_id = new.id
    and (d.day_on < new.starts_on or d.day_on > new.ends_on);

  if stranded > 0 then
    raise exception
      'Changing these dates would leave % day row(s) outside the trip. Remove those days first.', stranded
      using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger trips_protect_day_range
  before update of starts_on, ends_on on pilot.trips
  for each row execute function pilot.trips_protect_day_range();

-- ---------------------------------------------------------------------------
-- Day rows freeze once the trip has been billed.
--
-- Mirrors invoices_protect_issued. An issued invoice already snapshotted its
-- quantities and unit amounts, so editing a day row afterwards cannot change
-- what the client was charged — it can only make the trip screen disagree
-- with the invoice the client is holding. That divergence is the whole
-- failure mode this product exists to remove.
--
-- SUPERSEDED BY 20260807020000, which re-keys this guard onto whether a live
-- invoice line actually references the trip rather than onto the cached
-- billing_state column. Keying on billing_state left the entire DRAFT window
-- open — the exact window in which a pilot goes back to fix a day. Read that
-- migration's section 2 before changing anything here.
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

  if state in ('invoiced', 'paid') then
    raise exception
      'This trip has been invoiced. Its days can no longer be changed.'
      using errcode = '23514';
  end if;

  return coalesce(new, old);
end;
$$;

create trigger trip_days_protect_billed
  before insert or update or delete on pilot.trip_days
  for each row execute function pilot.trip_days_protect_billed();

-- ---------------------------------------------------------------------------
-- RLS. Enabled in the same migration that creates the tables, per house
-- rule — never retrofitted. No admin-bypass policy, no AMG-facing read path.
-- ---------------------------------------------------------------------------
alter table pilot.day_types   enable row level security;
alter table pilot.trip_days   enable row level security;
alter table pilot.client_rates enable row level security;

create policy day_types_select on pilot.day_types for select to authenticated
  using (account_id in (select pilot.current_account_ids()));
create policy day_types_insert on pilot.day_types for insert to authenticated
  with check (account_id in (select pilot.current_account_ids()));
create policy day_types_update on pilot.day_types for update to authenticated
  using (account_id in (select pilot.current_account_ids()))
  with check (account_id in (select pilot.current_account_ids()));
create policy day_types_delete on pilot.day_types for delete to authenticated
  using (account_id in (select pilot.current_account_ids()));

create policy trip_days_select on pilot.trip_days for select to authenticated
  using (account_id in (select pilot.current_account_ids()));
create policy trip_days_insert on pilot.trip_days for insert to authenticated
  with check (account_id in (select pilot.current_account_ids()));
create policy trip_days_update on pilot.trip_days for update to authenticated
  using (account_id in (select pilot.current_account_ids()))
  with check (account_id in (select pilot.current_account_ids()));
create policy trip_days_delete on pilot.trip_days for delete to authenticated
  using (account_id in (select pilot.current_account_ids()));

create policy client_rates_select on pilot.client_rates for select to authenticated
  using (account_id in (select pilot.current_account_ids()));
create policy client_rates_insert on pilot.client_rates for insert to authenticated
  with check (account_id in (select pilot.current_account_ids()));
create policy client_rates_update on pilot.client_rates for update to authenticated
  using (account_id in (select pilot.current_account_ids()))
  with check (account_id in (select pilot.current_account_ids()));
create policy client_rates_delete on pilot.client_rates for delete to authenticated
  using (account_id in (select pilot.current_account_ids()));

-- ---------------------------------------------------------------------------
-- GRANTS — column-scoped on INSERT and UPDATE both.
--
-- RLS has NO column granularity, so this is the only layer where column
-- authority is expressed. Two lessons from earlier in this build are encoded
-- here rather than restated:
--
--   1. `grant update (a, b)` ADDS column privileges; it does not remove a
--      pre-existing table-wide grant (20260806000000). These tables are new
--      so there is nothing to revoke — but the ALTER TABLE additions to
--      pilot.clients below DO need their own grants, because ADD COLUMN does
--      not extend an existing column-scoped grant either (20260805090000).
--   2. A bare INSERT grant on a table with a UNIQUE constraint is an
--      existence oracle (20260805090000, "the bare INSERT grant"). Scope it.
--
-- id / created_at / updated_at are withheld everywhere: defaults and the
-- set_updated_at triggers own them. account_id IS granted on insert, because
-- RLS's WITH CHECK is what constrains its VALUE — withholding the column
-- makes insert impossible rather than safe.
-- ---------------------------------------------------------------------------
grant select on pilot.day_types, pilot.trip_days, pilot.client_rates to authenticated;
grant delete on pilot.day_types, pilot.trip_days, pilot.client_rates to authenticated;

-- `is_builtin` is absent from both grants: it is the seeder's claim about
-- where a row came from, and a tenant may neither assert nor retract it.
-- `key` is absent from UPDATE only — a pilot renames the LABEL; the key is
-- the stable handle, and letting it move would break nothing today and
-- everything the moment anything keys off it.
grant insert (account_id, key, label, billable, counts_for_per_diem,
  default_rate_cents, invoice_line_type, sort_order, archived_at)
  on pilot.day_types to authenticated;
grant update (label, billable, counts_for_per_diem, default_rate_cents,
  invoice_line_type, sort_order, archived_at)
  on pilot.day_types to authenticated;

grant insert (account_id, trip_id, day_on, day_type_id, rate_cents, notes)
  on pilot.trip_days to authenticated;
grant update (day_on, day_type_id, rate_cents, notes)
  on pilot.trip_days to authenticated;

grant insert (account_id, client_id, day_type_id, rate_cents)
  on pilot.client_rates to authenticated;
-- Re-pointing an override at a different client or day type is a delete and
-- an insert, not an update — the unique (account_id, client_id, day_type_id)
-- is what makes an override identifiable, so only the rate moves.
grant update (rate_cents) on pilot.client_rates to authenticated;

-- The three new pilot.clients columns. ADD COLUMN does not extend the
-- existing column-scoped grants from Phase 3/5, so without these a pilot
-- could never set a per-diem mode or a minimum.
grant insert (per_diem_mode, minimum_days, cancellation_policy_note)
  on pilot.clients to authenticated;
grant update (per_diem_mode, minimum_days, cancellation_policy_note)
  on pilot.clients to authenticated;

-- service_role: full surface, as everywhere else in this schema. It has
-- exactly one entry point in app code (the Stripe webhook) and that is
-- enforced by lib/supabase/service-role.ts, not by these grants.
grant select, insert, update, delete
  on pilot.day_types, pilot.trip_days, pilot.client_rates to service_role;

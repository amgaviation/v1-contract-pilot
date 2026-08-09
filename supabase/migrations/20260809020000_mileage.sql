-- Mileage / vehicle deduction tracking.
--
-- WHY THIS EXISTS: a 1099 contract pilot drives to/from FBOs, maintenance
-- facilities and training centres constantly, and the IRS standard mileage
-- deduction is often one of the larger line items on their Schedule C. The
-- product had no way to record it at all.
--
-- ===========================================================================
-- THE ACCURACY RULE THAT GOVERNS THIS FILE — NO HARDCODED RATE.
--
-- The IRS standard mileage rate changes every year (see
-- https://www.irs.gov/tax-professionals/standard-mileage-rates — verified
-- reachable 2026-08-09; no figure from it is used here or anywhere in this
-- migration). Baking a rate into a default, a check constraint bound, a
-- comment, or app code would silently go stale and misstate a real Schedule
-- C deduction. The rate is data the pilot enters, per tax year, in
-- pilot.mileage_rates below — never a literal in code.
--
-- ===========================================================================
-- RECORD, DO NOT DETERMINE — the tax substance this schema models.
--
-- Commuting (home to a regular place of work) is not deductible, but
-- whether a given drive is deductible commuting-vs-business turns on facts
-- this product cannot see (whether the pilot has a regular workplace, a
-- home office, etc.). So pilot.mileage_entries captures WHAT was driven —
-- date, miles, from/to, purpose — and lets the pilot classify by writing an
-- honest purpose. Nothing in this schema computes or labels a "deductible"
-- conclusion; that determination is the pilot's (or their tax
-- professional's), same register as CURRENCY_DISCLAIMER (lib/brand.ts) and
-- the quarterly report's planning-aid callout (app/(app)/reports/quarterly/
-- page.tsx) — this is a record-keeping tool, not a determination engine.
--
-- ===========================================================================
-- STANDARD MILEAGE RATE VS. ACTUAL VEHICLE EXPENSES — ALTERNATIVES, NOT
-- ADDITIVE.
--
-- A taxpayer chooses ONE method per vehicle per year: the standard mileage
-- rate (what this table computes), or actual expenses (gas, maintenance,
-- insurance, depreciation — proportional to business use). They are not
-- summed. pilot.expenses already has category='fuel' (and 'rental_car') for
-- actual out-of-pocket ground-transport costs, and this migration does
-- NOTHING to reconcile the two: a pilot who logs a mileage_entries row for
-- a drive AND an expenses row with category='fuel' for gas bought on that
-- same drive could double-claim if they use the standard rate for that
-- vehicle. This schema cannot know which method a pilot has chosen for
-- which vehicle in a given year — that is a taxpayer election, not a fact
-- recorded anywhere in this product — so it is not enforced here. The UI
-- (mileage/page.tsx) carries a written caution about this instead of a
-- database constraint pretending to adjudicate it.
--
-- ===========================================================================
-- MONEY / QUANTITY TYPES — chosen deliberately, not defaulted to bigint
-- cents the way the rest of this schema's money is.
--
--   * miles: numeric(7,1). Odometer-derived mileage is commonly recorded to
--     one decimal place (same shape as pilot.trips.day_count and
--     pilot.trip_legs.block_hours) — a pilot types "42.3", not a whole
--     number. numeric(p,s) SILENTLY ROUNDS rather than erroring (the same
--     hazard lib/format.ts's parseTenth exists to close for day_count/
--     block_hours), so the app-layer parser for this column must reuse
--     parseTenth rather than trust the column to reject an out-of-shape
--     value.
--
--   * rate_cents_per_mile: numeric(6,3), NOT bigint cents. The standard
--     mileage rate is published in cents-per-mile with a fractional cent
--     component (the published figure is not always a whole number of
--     cents) — collapsing it to integer cents the way every other rate in
--     this schema does (day_rate_cents, trip_days.rate_cents) would force a
--     rounding decision on the RATE itself, before it is ever multiplied by
--     a mileage figure, silently shifting the deduction on every trip that
--     uses it. numeric(6,3) allows a rate up to 999.999 cents/mile — orders
--     of magnitude of headroom above any plausible published rate — with
--     three fractional-cent digits, comfortably more precision than the
--     IRS has ever published a rate to.
--
--   * amount_cents: bigint, GENERATED ALWAYS AS a computed column — never
--     stored as an independent input, so it cannot drift from
--     miles * rate_cents_per_mile. The multiplication of a numeric(7,1) by
--     a numeric(6,3) is exact (both are exact decimal types; there is no
--     floating point anywhere in this path), and round() to the nearest
--     whole cent is the ONE place fractional-cent precision is deliberately
--     collapsed to money's usual integer-cents shape, matching every other
--     amount_cents column in this schema. round() with no scale argument
--     rounds half away from zero in Postgres, which is stated here rather
--     than left implicit, per the house rule that a silently-rounding
--     numeric column must have its rounding behavior documented.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- pilot.mileage_rates — the pilot's own record of the standard mileage rate
-- by tax year. Never seeded, never defaulted to a real number: a blank
-- table is "you have not told me the rate for this year", exactly the same
-- philosophy day_types.default_rate_cents uses for an un-agreed day rate.
-- ---------------------------------------------------------------------------
create table if not exists pilot.mileage_rates (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references pilot.accounts(id) on delete cascade,
  tax_year integer not null check (tax_year between 2000 and 2100),
  rate_cents_per_mile numeric(6,3) not null check (rate_cents_per_mile >= 0),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (account_id, tax_year),
  unique (account_id, id)
);

comment on table pilot.mileage_rates is
  'Per-account, per-tax-year IRS standard mileage rate, entered by the pilot — NEVER hardcoded or seeded with a real figure, because the rate changes annually and a stale baked-in number would silently misstate every mileage_entries row snapshotted from it. See https://www.irs.gov/tax-professionals/standard-mileage-rates.';

create trigger mileage_rates_set_updated_at
  before update on pilot.mileage_rates
  for each row execute function pilot.set_updated_at();

create index if not exists mileage_rates_account_year_idx
  on pilot.mileage_rates (account_id, tax_year desc);

-- ---------------------------------------------------------------------------
-- pilot.mileage_entries — one row per drive.
--
-- rate_cents_per_mile is SNAPSHOTTED AT CAPTURE, never re-resolved from
-- mileage_rates at render — same discipline as pilot.trip_days.rate_cents
-- (20260807000000) and stated the same way in references/product-
-- translation.md: "snapshot the terms at confirmation". A pilot who enters
-- next year's rate into pilot.mileage_rates must never cause a drive
-- recorded last year to silently re-price — that would be a wrong figure
-- on an already-filed return.
-- ---------------------------------------------------------------------------
create table if not exists pilot.mileage_entries (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references pilot.accounts(id) on delete cascade,
  drove_on date not null,
  miles numeric(7,1) not null check (miles > 0),
  -- Free text on purpose: "home" and "KTEB" are not ICAO codes and must
  -- not be validated as if they were (unlike trip_legs.from_icao/to_icao,
  -- which ARE airport idents).
  from_place text not null check (length(btrim(from_place)) between 1 and 200),
  to_place text not null check (length(btrim(to_place)) between 1 and 200),
  -- NOT NULL, deliberately: this is the field that lets the pilot (or
  -- their tax professional) later judge business-vs-commuting. A blank
  -- purpose is exactly the "recorded but unclassifiable" state this
  -- product exists to avoid — see the header comment on "record, do not
  -- determine".
  purpose text not null check (length(btrim(purpose)) between 1 and 500),
  -- Nullable BY DESIGN, matching pilot.expenses.trip_id: a drive to an
  -- FBO for maintenance may have no trip to attach to at all.
  trip_id uuid,
  foreign key (account_id, trip_id) references pilot.trips (account_id, id) on delete set null,
  client_id uuid,
  foreign key (account_id, client_id) references pilot.clients (account_id, id) on delete set null,
  -- Snapshot, not a resolved join — see the migration header.
  rate_cents_per_mile numeric(6,3) not null check (rate_cents_per_mile >= 0),
  -- Computed, never independently writable — see the migration header's
  -- money-type section for why this is exact and why round() is the one
  -- deliberate precision collapse in this table.
  amount_cents bigint generated always as (round(miles * rate_cents_per_mile)) stored,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (account_id, id)
);

comment on table pilot.mileage_entries is
  'One row per drive, for the standard-mileage-rate deduction method. rate_cents_per_mile is snapshotted at capture from pilot.mileage_rates and never re-resolved, so a later rate change cannot restate a drive already recorded. amount_cents is a GENERATED column (round(miles * rate_cents_per_mile)) so it can never drift from its inputs. This table records what the pilot drove and how they describe it (purpose) — it does NOT determine or label anything "deductible"; that judgment (commuting vs. business, and whether the standard-mileage-rate method or actual vehicle expenses is being used for the underlying vehicle this year — the two are alternatives, never additive, and pilot.expenses category=''fuel''/''rental_car'' rows are NOT reconciled against this table) is the pilot''s or their tax professional''s.';

create trigger mileage_entries_set_updated_at
  before update on pilot.mileage_entries
  for each row execute function pilot.set_updated_at();

create index if not exists mileage_entries_account_date_idx
  on pilot.mileage_entries (account_id, drove_on desc);
create index if not exists mileage_entries_trip_idx
  on pilot.mileage_entries (account_id, trip_id);

-- ---------------------------------------------------------------------------
-- RLS. Enabled in this, the migration that creates the tables — never
-- retrofitted. No admin-bypass policy, no AMG-facing read path.
-- ---------------------------------------------------------------------------
alter table pilot.mileage_rates   enable row level security;
alter table pilot.mileage_entries enable row level security;

create policy mileage_rates_select on pilot.mileage_rates for select to authenticated
  using (account_id in (select pilot.current_account_ids()));
create policy mileage_rates_insert on pilot.mileage_rates for insert to authenticated
  with check (account_id in (select pilot.current_account_ids()));
create policy mileage_rates_update on pilot.mileage_rates for update to authenticated
  using (account_id in (select pilot.current_account_ids()))
  with check (account_id in (select pilot.current_account_ids()));
create policy mileage_rates_delete on pilot.mileage_rates for delete to authenticated
  using (account_id in (select pilot.current_account_ids()));

create policy mileage_entries_select on pilot.mileage_entries for select to authenticated
  using (account_id in (select pilot.current_account_ids()));
create policy mileage_entries_insert on pilot.mileage_entries for insert to authenticated
  with check (account_id in (select pilot.current_account_ids()));
create policy mileage_entries_update on pilot.mileage_entries for update to authenticated
  using (account_id in (select pilot.current_account_ids()))
  with check (account_id in (select pilot.current_account_ids()));
create policy mileage_entries_delete on pilot.mileage_entries for delete to authenticated
  using (account_id in (select pilot.current_account_ids()));

-- ---------------------------------------------------------------------------
-- GRANTS — column-scoped, house pattern. `amount_cents` is a GENERATED
-- column and Postgres refuses any INSERT/UPDATE grant naming it (it is not
-- writable at all), so it is simply never listed. `id`/`created_at` are
-- system-owned; `updated_at` is owned by the trigger.
--
-- Per the house CRITICAL on this idiom: no `revoke insert ... from
-- authenticated` appears anywhere below, so there is no risk of the
-- "revoke drops every column privilege, re-grant only restates what's
-- listed" trap — these are brand-new tables with nothing to revoke, and
-- every column-scoped grant below is additive from a clean slate.
-- ---------------------------------------------------------------------------
grant select, insert, delete on pilot.mileage_rates, pilot.mileage_entries to authenticated;

grant insert (account_id, tax_year, rate_cents_per_mile, notes)
  on pilot.mileage_rates to authenticated;
grant update (rate_cents_per_mile, notes)
  on pilot.mileage_rates to authenticated;

grant insert (account_id, drove_on, miles, from_place, to_place, purpose,
  trip_id, client_id, rate_cents_per_mile, notes)
  on pilot.mileage_entries to authenticated;
grant update (drove_on, miles, from_place, to_place, purpose, trip_id,
  client_id, rate_cents_per_mile, notes)
  on pilot.mileage_entries to authenticated;

grant select, insert, update, delete
  on pilot.mileage_rates, pilot.mileage_entries to service_role;

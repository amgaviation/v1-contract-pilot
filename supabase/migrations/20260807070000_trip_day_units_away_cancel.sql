-- Phase 9 Layer 2 — three contract-fidelity gaps a real contract pilot's
-- agreement expresses and this product could not, until now.
--
-- ===========================================================================
-- 1. THERE IS NO PARTIAL RATE.
--
-- pilot.trip_days.quantity (20260807020000) answers "how much of the
-- calendar day did I work" — a half day WORKED bills at half the day's
-- rate_cents, because quantity multiplies straight into the invoice line.
-- That is a TIME fraction. It is not the same question as "what fraction of
-- the day rate does this kind of day pay", which is a MONEY fraction and
-- this schema has never had a column for it.
--
-- references/contract-pilot-business.md §4: travel days are "commonly paid
-- at half to full day rate (varies — contract term to capture, not
-- assume)". Today the only way to express "travel pays half" is a second
-- day type (e.g. 'travel') whose default_rate_cents the pilot has hand-
-- halved from the flight rate — a number computed once, in the pilot's
-- head, and stored with no relationship to the rate it was derived from.
-- Renegotiate the flight rate and the travel rate does not move with it;
-- nothing here even records that it should have. That is a money bug
-- sitting quietly in a contract term every day-rate pilot has.
--
-- THE FIX: `units`, a rate fraction (0 < units <= 1) alongside `quantity`
-- (a time fraction, same bounds). A travel day worked in full (quantity =
-- 1.0) that this contract pays at half rate is `units = 0.5` — captured
-- explicitly as "half of whatever rate_cents says", not baked into a
-- second, drifting number. rate_cents is still the snapshot (unchanged by
-- this migration); units is a second, independent snapshot, taken at
-- capture for exactly the reason 20260807000000's own comment gives for
-- rate_cents: "rates renegotiate; invoices must reflect the agreed ones."
-- A future rate change must not restate a unit fraction any more than it
-- restates a rate — so units is captured once, same as rate_cents, never
-- re-resolved from day_types at render or invoice time.
--
-- default_units on day_types mirrors default_rate_cents: a per-type
-- starting point the app resolves at capture (client override does not
-- exist for units — client_rates only overrides rate_cents, and extending
-- it to units is not asked for here and not added speculatively). NULL
-- means "no default fraction recorded", and the app's capture-time
-- resolution falls back to 1.00 (full rate) exactly the way an absent
-- default_rate_cents falls back to blank, not to a guessed number.
--
-- Bounded the same as quantity — 0 excluded (a day type that pays nothing
-- is `billable = false`, not `units = 0`; keeping money-fraction and
-- billability as two different flags is what 20260807000000 already does
-- for counts_for_per_diem vs billable, and this preserves that shape) and
-- 1 is the ceiling (a day type that pays MORE than the day rate is a
-- higher rate_cents, not a units above one — same "quantity is time, rate
-- is money" split the quantity migration drew).
--
-- DEFAULT 1.00 ON EXISTING ROWS. Every trip_days row written before this
-- migration was billed at its full rate_cents — that is the only thing
-- this schema could express — so 1.00 is not a guess, it is what every
-- existing row already means. No existing invoice draft can change value
-- from this column alone.
--
-- ARITHMETIC INTERACTION WITH THE GROUPING KEY (read this before touching
-- createInvoiceDraft or lib/trip-value.ts):
--
--   Both group billable trip_days rows by (day_type_id, rate_cents) and
--   round ONCE per group, against the group's SUMMED quantity, because
--   invoice_lines.amount_cents is a single generated column computing
--   round(quantity * unit_amount_cents) per LINE, and a line is one group.
--
--   units does NOT join the grouping key. It folds into the per-row
--   contribution to that same summed quantity instead: a row's
--   contribution to its group's quantity total becomes
--   `quantity * units` rather than bare `quantity`, before the group's
--   rows are summed and rounded once. This is deliberate, not incidental:
--
--     * unit_amount_cents on the emitted line is still rate_cents,
--       unchanged — the SNAPSHOTTED full-rate figure, exactly as before.
--       units never touches the rate side.
--     * Two rows in the same (day_type_id, rate_cents) group can carry
--       different units (a travel day at units=0.5 and a second travel
--       day, same rate_cents, captured at units=1.0 because the contract
--       changed mid-trip) and both still belong to ONE invoice line at
--       ONE rate — units only changes how much of that rate each row
--       contributes, not which line it lands on. Splitting the group by
--       units too would multiply flight_day/travel_day lines on an
--       invoice for a distinction (money fraction) the day type's own
--       label already carries; the group's rate_cents is the only fact
--       that has ever partitioned a day type's lines, and this does not
--       add a second one.
--     * Rounding is still exactly once per group: the exact (not
--       per-row-rounded) products are summed across the whole group and
--       rounded a single time, via the SAME roundQuantity used today. No
--       new rounding step is introduced — this changes what is being
--       summed, not how many times summing is followed by rounding.
--
--   Every existing row's units is 1.00, so quantity * units === quantity
--   for every trip_days row written before this migration, byte for byte.
--
--   minimum_days (per-trip and per-month) compares against this SAME
--   summed-and-rounded quantity (createInvoiceDraft sums each emitted
--   line's own `quantity`, which already carries the units multiplication
--   above) — so a contract minimum is now sized in PAID-day-equivalents,
--   not calendar days. That is judged to be correct, not merely
--   convenient: a "2-day minimum" exists to guarantee a floor of PAY, and
--   a pilot who works two calendar days but is only paid for 1.5 of them
--   (one flight day, one travel day at half rate) is exactly the case a
--   minimum should top up — a minimum measured in calendar days instead
--   would let a contract's own minimum be satisfied by days it is
--   simultaneously discounting, which defeats the term's purpose. Flagged
--   here as the one place this migration's brief asked to be checked
--   explicitly rather than assumed, and this is the reasoning, not a
--   silent default.
-- ===========================================================================
alter table pilot.day_types
  add column if not exists default_units numeric(3,2)
    check (default_units is null or (default_units > 0 and default_units <= 1));

comment on column pilot.day_types.default_units is
  'The rate fraction (0 < x <= 1) a day of this type bills at by default — e.g. 0.5 for "travel pays half". Resolved at trip_days capture, same as default_rate_cents, and snapshotted onto trip_days.units there; never re-resolved at invoice time. NULL means no default fraction recorded; the app falls back to 1.00 (full rate), never a guess.';

alter table pilot.trip_days
  add column if not exists units numeric(3,2) not null default 1.00
    check (units > 0 and units <= 1);

comment on column pilot.trip_days.units is
  'Rate fraction (0 < x <= 1) this day bills at, snapshotted at capture same as rate_cents — never re-resolved from day_types.default_units, for the same reason rate_cents is never re-resolved. Distinct from quantity: quantity is TIME worked (a half day worked bills half); units is MONEY (a full day worked can still bill at half the day rate, e.g. a travel day). createInvoiceDraft multiplies units into a row''s contribution to its group''s summed quantity — see this migration''s header for why that does not join the grouping key. Default 1.00 is what every row written before this column existed already meant.';

grant insert (default_units), update (default_units) on pilot.day_types to authenticated;
-- ADD COLUMN does not extend an existing column-scoped grant (the lesson
-- 20260807030000 restates for quantity; restated again here rather than
-- assumed).
grant insert (units), update (units) on pilot.trip_days to authenticated;

-- ===========================================================================
-- 2. PER DIEM CANNOT TELL "AWAY" FROM "AT HOME BASE".
--
-- day_types.counts_for_per_diem is a flag on the TYPE (20260807000000), so
-- a standby day at home base and a standby day in a hotel count identically
-- toward per diem. 20260807000000's own comment already named this gap
-- ("What this flag CANNOT express is the away-vs-home distinction, which is
-- the thing per diem actually turns on") and left it unresolved. Per diem
-- is a meal-and-incidentals allowance for being away from home base — a
-- pilot on standby AT their own base is not incurring the expense per diem
-- exists to cover, however the day type is configured.
--
-- THE FIX: `away`, a per-DAY boolean (not per-type — the same day type can
-- be flown at home base one trip and on the road the next). Per-diem
-- counting becomes `counts_for_per_diem AND away` wherever it is computed;
-- counts_for_per_diem alone no longer decides it.
--
-- DEFAULT FALSE — the conservative direction. This product records no home
-- base anywhere (checked: no such column exists on pilot.accounts or any
-- other table), so there is no fact this migration or the app could use to
-- infer "away" for an existing or newly-generated day row. Defaulting TRUE
-- would assume every day is away and OVER-count per diem the first time a
-- pilot forgets to correct a home-base standby day; defaulting FALSE
-- under-counts instead, which a pilot notices and fixes (a missing
-- per-diem line is visible on the invoice preview) rather than silently
-- over-billing a client's AP department.
--
-- KNOWN, DELIBERATE CONSEQUENCE FOR EXISTING DATA — stated plainly rather
-- than hidden: every trip_days row written before this column existed also
-- gets `away = false`, because there is no way to know, after the fact,
-- which past days were flown away from home base and which were not; a
-- machine guess (e.g. "assume every day of a multi-day trip was away") is
-- exactly the kind of fabricated fact this migration's cancellation-notice
-- section refuses to backfill for the same reason. This means a client on
-- per_diem_mode='per_diem' whose EXISTING trips carry day rows will see
-- their per-diem line(s) drop to nothing the next time an invoice is
-- drafted from those trips, until a pilot opens the day grid and marks the
-- relevant days away — a real, deliberate under-count on legacy data, not
-- a null-effect migration. It is the conservative side of the tradeoff
-- (missing money is visible and correctable on an unsent draft; overbilled
-- money is a client dispute after the fact) but it is a real change in
-- what some existing trips will invoice for, and is called out here and in
-- the verification report rather than assumed away.
-- ===========================================================================
alter table pilot.trip_days
  add column if not exists away boolean not null default false;

comment on column pilot.trip_days.away is
  'Whether this day was away from home base. Per-diem counting is counts_for_per_diem (on the day type) AND away (on the day) — a day type alone cannot say "away", only "the kind of day per diem is meant for". Defaults false: the product records no home base anywhere, so away can never be inferred, only entered, and false is the under-count direction (a missed per-diem line is visible and correctable) rather than the over-bill direction a default of true would risk. Existing rows before this column also read false — there was no away/home-base distinction for them to have expressed.';

-- BACKFILL — the difference between a no-op migration and a silent pay cut.
--
-- Leaving every legacy row at false looked conservative, and for a NEW day it
-- is. For an EXISTING day it is not conservative, it is a change to what a
-- live trip bills. Before this migration per diem counted on
-- counts_for_per_diem alone, so a day of that type WAS already producing a
-- per-diem line. Leave it false and the next invoice for that trip quietly
-- drops the line, and the pilot is simply paid less with nothing on screen
-- explaining why. A silent under-bill is not the safe direction; it is the
-- same defect as a silent over-bill, pointed at the pilot instead of the
-- client.
--
-- So the backfill is not a guess about where the pilot physically was. It is
-- the statement "this migration does not restate history": for rows that
-- were already counting toward per diem, away = true reproduces exactly the
-- billing that existed a moment before this ran. It cannot over-count
-- relative to today, because today counts every one of these rows.
--
-- Rows whose day type never counted for per diem stay false — they produced
-- no per-diem line before and produce none now. Going forward the flag is
-- entered per day, which is the point of adding it.
update pilot.trip_days td
   set away = true
  from pilot.day_types dt
 where dt.id = td.day_type_id
   and dt.account_id = td.account_id
   and dt.counts_for_per_diem
   and td.away = false;

grant insert (away), update (away) on pilot.trip_days to authenticated;

-- ===========================================================================
-- 3. A CANCELLATION HAS NO TIMESTAMP, SO THE FEE IS UNPROVABLE.
--
-- pilot.trips.status='canceled' exists but nothing records WHEN a trip was
-- cancelled or where the notice came from. Cancellation fees key off
-- "inside 24-48 hours" (references/contract-pilot-business.md §4 calls the
-- exact percentages industry convention, not law) — a pilot billing a late
-- cancel today has no record proving the call came six hours out, which is
-- exactly what a client's AP department contests.
--
-- THE FIX: canceled_at (timestamptz) and cancellation_notice_from (who the
-- notice came from — client/pilot/weather/maintenance/other). The FEE
-- stays uncomputed and hand-entered, unchanged from
-- 20260807000000_phase9_day_types_and_trip_days.sql's own reasoning on
-- clients.cancellation_policy_note: the percentages are convention, not
-- law, and computing an unenforceable fee is worse than recording the
-- agreement and letting the pilot key in the actual, negotiated
-- cancellation_fee line by hand. That boundary is not touched here.
--
-- canceled_at IS TRIGGER-OWNED, same pattern as billing_state
-- (20260807010000/20260807020000) and updated_at (every table): withheld
-- from every INSERT/UPDATE grant, set only by
-- pilot.trips_set_canceled_at() below. A pilot-writable cancellation
-- timestamp is worthless as evidence — the whole point is that it is the
-- system's own record of when the status actually changed, not a value
-- typed in after the fact to make a fee look better-supported than it was.
--
-- NO CHECK REQUIRING canceled_at WHEN status='canceled'. Every trip already
-- canceled before this migration has status='canceled' and no way to know
-- when — backfilling a timestamp would be inventing evidence, the exact
-- thing this column exists to stop pilots from needing to do by hand. A
-- CHECK enforcing "canceled implies canceled_at is set" would fail this
-- migration outright on any account with a single pre-existing canceled
-- trip. So: canceled_at is set going forward, by the trigger, on every
-- transition INTO 'canceled' (including a trip inserted already-canceled);
-- it is simply NULL, permanently, for every trip that was canceled before
-- this column existed, and createInvoiceDraft's warning (see that file's
-- own change) says so plainly rather than fabricating a number.
--
-- WHY THE TRIGGER ALSO FIRES ON A RE-CANCELLATION rather than only once
-- ever: if a trip is uncancelled (a correction) and cancelled again later,
-- canceled_at should read the LATEST cancellation, not the first — it is
-- describing "when did this trip most recently become cancelled", the
-- fact the notice-window arithmetic actually needs, not "was this trip
-- ever cancelled". The trigger does NOT clear canceled_at when a trip
-- moves OUT of 'canceled' — a trip reactivated and cancelled a second time
-- overwrites it (see above), but a trip reactivated and left alone keeps
-- its prior cancellation on record rather than erasing history nothing
-- asked it to erase.
-- ===========================================================================
alter table pilot.trips
  add column if not exists canceled_at timestamptz,
  add column if not exists cancellation_notice_from text
    check (cancellation_notice_from is null or cancellation_notice_from in
      ('client', 'pilot', 'weather', 'maintenance', 'other'));

comment on column pilot.trips.canceled_at is
  'When this trip most recently transitioned INTO status=''canceled'', set only by pilot.trips_set_canceled_at() — never by the app (withheld from every grant, same pattern as billing_state/updated_at). NULL for a trip cancelled before this column existed (no way to know when) or one never cancelled. Not required-if-canceled by CHECK on purpose: that would fail this migration on every pre-existing canceled trip.';

comment on column pilot.trips.cancellation_notice_from is
  'Who the cancellation notice came from — client/pilot/weather/maintenance/other. Freely pilot-editable (unlike canceled_at): this is the pilot''s own record of the circumstance, not a system fact, the same trust level cancellation_policy_note on pilot.clients is written at.';

create or replace function pilot.trips_set_canceled_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = 'canceled'
     and (tg_op = 'INSERT' or old.status is distinct from new.status) then
    new.canceled_at := now();
  end if;
  return new;
end;
$$;

comment on function pilot.trips_set_canceled_at() is
  'Sets trips.canceled_at to now() on every transition INTO status=''canceled'' (insert already-canceled, or update into it) — the only writer, since canceled_at is withheld from every tenant grant. Does not clear canceled_at on a transition OUT of canceled; see this migration''s header for why that is deliberate.';

create trigger trips_set_canceled_at
  before insert or update of status on pilot.trips
  for each row execute function pilot.trips_set_canceled_at();

-- cancellation_notice_from is an ordinary pilot-writable note field (same
-- trust level as cancellation_policy_note on clients) — no revoke needed,
-- this is a brand new column with nothing to tighten.
grant insert (cancellation_notice_from), update (cancellation_notice_from)
  on pilot.trips to authenticated;

-- ===========================================================================
-- RLS — no new tables, only ALTER TABLE on three that already have row
-- level security enabled and policies covering every column (day_types,
-- trip_days from 20260807000000; trips from 20260805070000). Nothing here
-- needs a new policy statement for scripts/tenancy-verify.mjs's F1/F1b
-- sweep to stay green — confirmed by re-running tenancy:verify after this
-- migration (see the report).
-- ===========================================================================

-- service_role: full surface already covers every column on these three
-- tables via the table-level grants earlier migrations issued (`grant
-- select, insert, update, delete on pilot.day_types, pilot.trip_days ... to
-- service_role`; the same for pilot.trips) — column-scoped grants are an
-- `authenticated`-only concern, service_role was never restricted to a
-- column list on any of these tables, so there is nothing to extend here.

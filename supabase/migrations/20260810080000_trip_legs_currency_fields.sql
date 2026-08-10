-- ===========================================================================
-- Capture on the leg what the logbook entry actually needs
--
-- THE PROBLEM. pilot.logbook_entries carries day_takeoffs,
-- day_landings_full_stop, day_landings_touch_go, cross_country_time,
-- instrument_actual_time and instrument_simulated_time. pilot.trip_legs
-- carries none of them — it has one flat `day_landings` and one flat
-- `instrument_hours`.
--
-- draftPayloadForLeg (app/(app)/logbook/db.ts) is right to refuse to
-- invent the difference, so a trip-derived entry is written with those
-- fields at 0 or null. Which means a pilot who uses this product exactly
-- as designed — log the trip, confirm the drafts — ends up with a logbook
-- whose day takeoff and landing counts are ZERO on every entry that came
-- from a trip. That is the product's own primary path producing an
-- incomplete legal record.
--
-- WHY THOSE FIELDS AND NOT OTHERS. Verified against the current CFR text
-- (govinfo, 14 CFR part 61, retrieved 2026-08-10) rather than from
-- memory:
--
--   61.57(a)(1) — three takeoffs AND three landings within the preceding
--     90 days, as sole manipulator, in the same category, class and type.
--     The count of TAKEOFFS is a separate fact from the count of
--     landings, and trip_legs had no way to record it at all. Full stop is
--     required by this paragraph only "if the aircraft to be flown is an
--     airplane with a tailwheel" — so the full-stop split matters here,
--     but not universally.
--   61.57(b) — night: three takeoffs and three landings TO A FULL STOP,
--     1 hour after sunset to 1 hour before sunrise. Already modelled.
--   61.51(b)(3) — the conditions of flight that must be logged are day or
--     night, ACTUAL instrument, and SIMULATED instrument. One combined
--     "instrument_hours" cannot satisfy that, because the reg names the
--     two separately and they are different facts.
--
-- CROSS-COUNTRY IS NOT A 61.51(b) REQUIREMENT, and this migration does
-- not claim it is. 61.51(b) lists date, total time, departure/arrival,
-- aircraft type and identification, safety pilot, the type of pilot
-- experience, and the conditions of flight — cross-country is not among
-- them. It is here because it is universal logbook convention, because
-- 61.51(a) requires showing the aeronautical experience used to meet a
-- rating's requirements (and cross-country minimums are written into
-- those), and because insurers and chief pilots ask for it. Recorded as
-- convention, not asserted as law.
--
-- ADDITIVE ONLY. Nothing is renamed, nothing is backfilled, and no
-- existing value is reinterpreted. In particular `instrument_hours` is
-- NOT split retroactively into actual and simulated: a row that recorded
-- only a total genuinely does not know the breakdown, and guessing it
-- would put a fabricated number into a legal record. See the column
-- comment.
-- ===========================================================================

alter table pilot.trip_legs
  -- 61.57(a)(1). A takeoff count is not derivable from a landing count:
  -- a leg can be flown by one pilot and landed by the other.
  add column if not exists day_takeoffs integer not null default 0
    check (day_takeoffs >= 0),
  -- How many of `day_landings` were to a full stop. Stored as a SUBSET
  -- rather than as a second independent count, so the two can never
  -- disagree about how many landings there were — the constraint below is
  -- what makes that true.
  add column if not exists day_landings_full_stop integer not null default 0
    check (day_landings_full_stop >= 0),
  -- Convention, not 61.51(b). See the header.
  add column if not exists cross_country_hours numeric(4,1)
    check (cross_country_hours is null or cross_country_hours >= 0),
  -- 61.51(b)(3)(ii) and (iii) — two named, separate conditions of flight.
  add column if not exists instrument_actual_hours numeric(4,1)
    check (instrument_actual_hours is null or instrument_actual_hours >= 0),
  add column if not exists instrument_simulated_hours numeric(4,1)
    check (instrument_simulated_hours is null or instrument_simulated_hours >= 0);

-- A full-stop landing is a landing. Without this the two columns could
-- claim 2 landings of which 5 were full stop.
alter table pilot.trip_legs
  drop constraint if exists trip_legs_day_full_stop_within_landings;
alter table pilot.trip_legs
  add constraint trip_legs_day_full_stop_within_landings
  check (day_landings_full_stop <= day_landings);

comment on column pilot.trip_legs.day_takeoffs is
  '61.57(a)(1) counts takeoffs and landings separately. Not derived from day_landings — a leg can be flown by one pilot and landed by the other.';
comment on column pilot.trip_legs.day_landings_full_stop is
  'How many of day_landings were to a full stop. 61.57(a)(1) requires full-stop landings only for tailwheel airplanes, so this is a subset rather than a replacement.';
comment on column pilot.trip_legs.cross_country_hours is
  'Industry convention and rating/insurance evidence — NOT required by 61.51(b), which does not name cross-country among the per-flight entries.';
comment on column pilot.trip_legs.instrument_actual_hours is
  '61.51(b)(3)(ii). Deliberately not backfilled from instrument_hours: a row holding only a total does not know the actual/simulated split, and inventing it would put a fabricated number in a legal record.';
comment on column pilot.trip_legs.instrument_simulated_hours is
  '61.51(b)(3)(iii). Same no-backfill rule as instrument_actual_hours.';
comment on column pilot.trip_legs.instrument_hours is
  'LEGACY total, kept for rows written before the actual/simulated split existed. New capture should set instrument_actual_hours / instrument_simulated_hours; this column is not the sum of them and must not be treated as authoritative when either is present.';

-- ---------------------------------------------------------------------------
-- Grants.
--
-- THE REVOKE TRAP, for the fifth time in this repo's history: `revoke
-- <priv> on <table>` drops EVERY column-level privilege on that table and
-- the following grant restores only what is listed. So nothing is revoked
-- here — the five new columns are ADDED to the existing grants, which
-- leaves the sixteen already-granted INSERT columns and fifteen UPDATE
-- columns untouched. The full pre-existing lists were read off
-- information_schema.column_privileges before writing this, not recalled.
-- ---------------------------------------------------------------------------
grant insert (day_takeoffs, day_landings_full_stop, cross_country_hours,
              instrument_actual_hours, instrument_simulated_hours)
  on pilot.trip_legs to authenticated;
grant update (day_takeoffs, day_landings_full_stop, cross_country_hours,
              instrument_actual_hours, instrument_simulated_hours)
  on pilot.trip_legs to authenticated;
grant select (day_takeoffs, day_landings_full_stop, cross_country_hours,
              instrument_actual_hours, instrument_simulated_hours)
  on pilot.trip_legs to authenticated;

-- Logbook regulatory corrections — five gaps an Opus regulatory audit found
-- against the eCFR versioner API (14 CFR title-14.xml, issue date
-- 2026-08-05, sections 61.57, 61.51, 1.1 — retrieved 2026-08-07). Every
-- citation below was fetched, not recalled; see the PR/report for the
-- exact fetch URLs.
--
-- A. simulator_device_type is missing 'ffs' (full flight simulator) — a
--    distinct regulatory device class, not a synonym for FTD/ATD/other.
--    61.57(b)(2) permits the NIGHT takeoffs/landings only in a full flight
--    simulator (with its visual system adjusted for the night period);
--    61.57(a)(3) permits the day currency takeoffs/landings in a full
--    flight simulator OR flight training device — never an ATD. Level
--    D-class devices (FlightSafety/CAE, the devices this product's Part
--    135 jet-pilot users actually fly) were previously unrecordable except
--    as 'other', which makes the three-way FFS/FTD/ATD credit rule
--    uncomputable. Fixed by widening the CHECK; no existing row is
--    affected (widening a CHECK is backward-compatible — every row that
--    passed the old, narrower list still passes the new, wider one).
--
-- B. night_time (14 CFR 1.1) and night_takeoffs/night_landings_full_stop
--    (61.57(b)(1)) use DIFFERENT legal windows and nothing in the schema
--    said so:
--      - 1.1 "Night": end of evening civil twilight to beginning of
--        morning civil twilight (Air Almanac, converted to local time).
--      - 61.57(b)(1): "the period beginning 1 hour after sunset and
--        ending 1 hour before sunrise."
--    Civil twilight ends roughly 25-35 minutes after sunset depending on
--    latitude/season, so a landing made in that gap is 1.1-night (loggable
--    as night_time) but NOT yet inside the 61.57(b) window (does not count
--    toward night-landing currency). A pilot who logs a landing made at
--    end-of-civil-twilight into night_landings_full_stop because the LEG
--    was flown at night over-counts 61.57(b) currency — the audit's
--    "single most dangerous silent error" in this UI. Fixed with column
--    comments naming both windows explicitly (the app-layer copy fix is in
--    logbook-entry-form.tsx / leg-editor.tsx).
--
-- C. 61.57(a) was mislabelled "day/night passenger currency" in this
--    table's own comments (20260805220000, landings block). Two errors:
--      1. "Passenger" is wrong — 61.57(a)(1) binds a PIC "of an aircraft
--         carrying persons OR of an aircraft certificated for more than
--         one pilot flight crewmember." A jet on an empty repositioning
--         leg is squarely inside "certificated for more than one pilot
--         flight crewmember" regardless of whether anyone is aboard.
--      2. 61.57(a) has no time-of-day limit at all — it is not "day"
--         currency; 61.57(b) layers an ADDITIONAL night-specific
--         requirement on top of (a), it does not replace it. And there was
--         no day_takeoffs column — only landings — so (a)(1)'s "three
--         takeoffs AND three landings" could not be evaluated even for the
--         landings-only half. Fixed: added day_takeoffs (same shape as
--         night_takeoffs: not-null integer, default 0, >= 0) and corrected
--         every comment that named 61.57(a) as day/passenger currency.
--
-- D. approaches_count / approach_type: the UI hint says "Counts for
--    61.57(c)" on a count that included 'visual' as a selectable
--    approach_type. 61.57(c)(1) requires the six approaches be performed
--    "in actual weather conditions, or under simulated conditions using a
--    view-limiting device" — a visual approach is flown in neither. DECISION
--    (deliberate, not removing 'visual' from the CHECK): 'visual' stays a
--    selectable approach_type — a pilot legitimately wants to record that
--    they flew one, and removing an enum value pilots' existing rows may
--    already use would need a data migration this audit found no evidence
--    is warranted (no live data to check, and "flew a visual approach" is
--    real information worth keeping). What changes is that the schema and
--    UI STOP implying a visual approach counts toward 61.57(c) currency —
--    see the column comment below and the hint-text fix in
--    logbook-entry-form.tsx. The related gap already tracked in
--    docs/PLAN.md — no field for 61.57(c)(1)(iii), intercepting and
--    tracking a course through navigational electronic systems — is cheap
--    enough to close here: added courses_intercepted_tracked (boolean, not
--    a count, since the reg states it as a task performed, not a number of
--    repetitions).
--
-- E. 61.51(b)(1)(v) requires logging "[t]he name of a safety pilot, if
--    required by Section 91.109" — the one 61.51(b) field this schema
--    didn't have, on a table this product's own copy calls "the pilot's
--    own copy of their legal record (14 CFR 61.51)" (export/route.ts,
--    logbook/page.tsx — not edited by this migration, out of the allowed
--    file set for this pass, but the claim is what this fix narrows the
--    gap under). Added view_limiting_pilot_name (nullable text) — nullable
--    because a safety pilot is only "required by 91.109" on a subset of
--    simulated-instrument flights, not every entry.

-- ---------------------------------------------------------------------------
-- A. 'ffs' — full flight simulator device class.
-- ---------------------------------------------------------------------------
alter table pilot.logbook_entries
  drop constraint logbook_entries_simulator_device_type_check;
alter table pilot.logbook_entries
  add constraint logbook_entries_simulator_device_type_check
    check (simulator_device_type is null or simulator_device_type in ('ffs', 'ftd', 'atd', 'other'));

comment on column pilot.logbook_entries.simulator_device_type is
  'Device class for simulator_time. ''ffs'' = full flight simulator (61.57(a)(3) day currency; the ONLY device class 61.57(b)(2) accepts for NIGHT currency, and only with its visual system adjusted for the night period). ''ftd'' = flight training device (61.57(a)(3) day currency only — never accepted for (b) night currency). ''atd'' = aviation training device (61.57(c) instrument currency only, per 61.57(c)(2) — never accepted for (a) or (b)). Fetched 14 CFR 61.57, ecfr.gov versioner, issue date 2026-08-05, 2026-08-07.';

-- ---------------------------------------------------------------------------
-- B. Night-window column comments — 1.1 vs 61.57(b)(1) are different clocks.
-- ---------------------------------------------------------------------------
comment on column pilot.logbook_entries.night_time is
  'Night per 14 CFR 1.1: "the time between the end of evening civil twilight and the beginning of morning civil twilight, as published in the Air Almanac, converted to local time." NOT the same window as night_takeoffs/night_landings_full_stop below — civil twilight typically ends ~25-35 minutes after sunset, so a landing in that gap is 1.1-night (loggable here) without yet being inside the narrower 61.57(b) currency window. Fetched 14 CFR 1.1, ecfr.gov versioner, issue date 2026-08-05, 2026-08-07.';

comment on column pilot.logbook_entries.night_takeoffs is
  'Counts toward 61.57(b)(1) ONLY for a takeoff made "during the period beginning 1 hour after sunset and ending 1 hour before sunrise" — a narrower window than the 14 CFR 1.1 "night" (civil-twilight) definition night_time above uses. A takeoff made between sunset and 1 hour after sunset is night_time-eligible but does NOT count here. Fetched 14 CFR 61.57(b)(1), ecfr.gov versioner, issue date 2026-08-05, 2026-08-07.';

comment on column pilot.logbook_entries.night_landings_full_stop is
  'Counts toward 61.57(b)(1) ONLY for a full-stop landing made "during the period beginning 1 hour after sunset and ending 1 hour before sunrise" — see night_takeoffs'' comment for why this is not the same window as night_time. Fetched 14 CFR 61.57(b)(1), ecfr.gov versioner, issue date 2026-08-05, 2026-08-07.';

comment on column pilot.logbook_entries.night_landings_touch_go is
  'Same 61.57(b)(1) window as night_landings_full_stop, but a touch-and-go never counts toward 61.57(b) currency — that paragraph requires the landing be made TO A FULL STOP. Kept for completeness of the flight record, not as a currency input.';

-- ---------------------------------------------------------------------------
-- C. day_takeoffs + corrected 61.57(a) comments.
-- ---------------------------------------------------------------------------
alter table pilot.logbook_entries
  add column day_takeoffs integer not null default 0 check (day_takeoffs >= 0);

comment on column pilot.logbook_entries.day_takeoffs is
  'Half of the 61.57(a)(1) "three takeoffs and three landings" pair — previously absent from this schema (docs/PLAN.md flagged it; only landings existed). 61.57(a) applies to any PIC "of an aircraft carrying persons OR of an aircraft certificated for more than one pilot flight crewmember" — i.e. every jet in this product''s market, including an empty repositioning leg, not just flights with passengers aboard. 61.57(a) has NO time-of-day limit on its own; 61.57(b) below layers an ADDITIONAL requirement for the night period, it does not replace (a). Full-stop is required only for a tailwheel airplane per (a)(1)(ii) — day_landings_full_stop/day_landings_touch_go already carry that distinction correctly; day_takeoffs does not need its own full-stop/touch-and-go split because the takeoff itself has no full-stop concept. Fetched 14 CFR 61.57(a), ecfr.gov versioner, issue date 2026-08-05, 2026-08-07.';

comment on column pilot.logbook_entries.day_landings_full_stop is
  'Counts toward 61.57(a)(1) (see day_takeoffs'' comment for what that paragraph actually requires — it is not "passenger" or "day-only" currency) for every aircraft, and is the ONLY landing type that counts toward 61.57(a)(1)(ii)''s tailwheel full-stop-landing requirement when the aircraft flown is a tailwheel airplane.';

comment on column pilot.logbook_entries.day_landings_touch_go is
  'Counts toward the general 61.57(a)(1) three-landings requirement for a NON-tailwheel aircraft; does not satisfy 61.57(a)(1)(ii)''s full-stop requirement when the aircraft is a tailwheel airplane.';

-- ---------------------------------------------------------------------------
-- D. approaches_count / approach_type comment fix + intercept/track task.
-- ---------------------------------------------------------------------------
comment on column pilot.logbook_entries.approaches_count is
  '61.57(c)(1) requires six instrument approaches "in actual weather conditions, or under simulated conditions using a view-limiting device" within the 6 calendar months preceding the month of the flight. A row tagged approach_type = ''visual'' is flown in neither condition and does NOT count toward that six — see approach_type''s comment. This column does not distinguish approach_type = ''visual'' rows from instrument ones in its own total; the UI (logbook-entry-form.tsx) is the enforcement point for showing the pilot which rows actually count. Fetched 14 CFR 61.57(c)(1), ecfr.gov versioner, issue date 2026-08-05, 2026-08-07.';

comment on column pilot.logbook_entries.approach_type is
  '''visual'' is kept as a selectable value (a pilot may legitimately want to record having flown one) but a row tagged ''visual'' does NOT satisfy 61.57(c)(1) — that paragraph requires actual weather conditions or a view-limiting device, neither of which describes a visual approach. This reading rests on the plain regulatory text; FAA Chief Counsel interpretations were not retrieved for this pass, so do not cite an interpretation letter from this comment. Fetched 14 CFR 61.57(c)(1), ecfr.gov versioner, issue date 2026-08-05, 2026-08-07.';

alter table pilot.logbook_entries
  add column courses_intercepted_tracked boolean not null default false;

comment on column pilot.logbook_entries.courses_intercepted_tracked is
  'Whether this flight included 61.57(c)(1)(iii)''s "[i]ntercepting and tracking courses through the use of navigational electronic systems" — a required task for 61.57(c) instrument currency that this schema had no field for at all (docs/PLAN.md, "no record of intercepting and tracking a course"). A boolean per entry, not a count: the reg states it as a task performed on the flight, not a number of repetitions, matching how holding (see `holds`, which IS a count because 61.57(c)(1)(ii) is silent on repetition) is already modeled differently on purpose. Even with this column, 61.57(c) full computability still depends on the approach_type distinction in D above and on a currency ENGINE this migration does not build (Phase 7, gated separately per docs/PLAN.md) — this closes one input gap, not the whole currency question. Fetched 14 CFR 61.57(c)(1)(iii), ecfr.gov versioner, issue date 2026-08-05, 2026-08-07.';

-- ---------------------------------------------------------------------------
-- E. view_limiting_pilot_name — 61.51(b)(1)(v).
-- ---------------------------------------------------------------------------
alter table pilot.logbook_entries
  add column view_limiting_pilot_name text;

comment on column pilot.logbook_entries.view_limiting_pilot_name is
  '14 CFR 61.51(b)(1)(v): "The name of a safety pilot, if required by Section 91.109." Nullable because a safety pilot is required only on a subset of simulated-instrument flights (91.109), not on every entry — the app surfaces this field when instrument_simulated_time > 0 (see logbook-entry-form.tsx) as a prompt, not a hard requirement, since the schema cannot itself evaluate 91.109''s applicability. This was the one 61.51(b) required field this table lacked; until it existed, the product''s "legal record (14 CFR 61.51)" claim (export/route.ts, logbook/page.tsx) overstated coverage by exactly this field. Fetched 14 CFR 61.51(b)(1)(v), ecfr.gov versioner, issue date 2026-08-05, 2026-08-07.';

-- ---------------------------------------------------------------------------
-- GRANTS — extend INSERT (20260807050000's list) and UPDATE (20260805220000's
-- list) with the three new flight-data columns. view_limiting_pilot_name and
-- courses_intercepted_tracked are ordinary editable flight data, same
-- treatment as remarks/holds; day_takeoffs is the same treatment as
-- night_takeoffs. None of the three are provenance columns, so none of them
-- get the airman_user_id-style INSERT-only restriction.
-- ---------------------------------------------------------------------------
revoke insert on pilot.logbook_entries from authenticated;
grant insert (
  account_id, source, trip_id, trip_leg_id, airman_user_id,
  entry_date, aircraft_ident, aircraft_type, from_icao, to_icao, role,
  total_time, pic_time, sic_time, solo_time, cross_country_time, night_time,
  instrument_actual_time, instrument_simulated_time, flight_instructor_time,
  dual_received_time, simulator_time, simulator_device_type,
  day_takeoffs, day_landings_full_stop, day_landings_touch_go, night_takeoffs,
  night_landings_full_stop, night_landings_touch_go, approaches_count,
  approach_type, courses_intercepted_tracked, holds, view_limiting_pilot_name, remarks
) on pilot.logbook_entries to authenticated;

revoke update on pilot.logbook_entries from authenticated;
grant update (
  entry_date, aircraft_ident, aircraft_type, from_icao, to_icao, role,
  total_time, pic_time, sic_time, solo_time, cross_country_time, night_time,
  instrument_actual_time, instrument_simulated_time, flight_instructor_time,
  dual_received_time, simulator_time, simulator_device_type,
  day_takeoffs, day_landings_full_stop, day_landings_touch_go, night_takeoffs,
  night_landings_full_stop, night_landings_touch_go, approaches_count,
  approach_type, courses_intercepted_tracked, holds, view_limiting_pilot_name, remarks
) on pilot.logbook_entries to authenticated;

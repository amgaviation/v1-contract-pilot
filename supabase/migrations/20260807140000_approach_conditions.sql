-- Closes the last two gaps an eCFR audit found against docs/CURRENCY-SPEC.md
-- (retrieved from the eCFR versioner API, 14 CFR title-14.xml, issue date
-- 2026-08-05, on 2026-08-07 unless noted otherwise).
--
-- ---------------------------------------------------------------------------
-- GAP 1 — approach_condition on pilot.logbook_entries. The live blocker on
-- 61.57(c) per docs/CURRENCY-SPEC.md §2.3/§9.
-- ---------------------------------------------------------------------------
--
-- Fetched: https://www.ecfr.gov/api/versioner/v1/full/2026-08-05/title-14.xml?section=61.57
--
-- 61.57(c)(1): "... that person performed and logged at least the following
-- tasks and iterations in an airplane, powered-lift, helicopter, or airship,
-- as appropriate, for the instrument rating privileges to be maintained IN
-- ACTUAL WEATHER CONDITIONS, OR UNDER SIMULATED CONDITIONS USING A
-- VIEW-LIMITING DEVICE that involves having performed the following—
-- (i) Six instrument approaches. ..."
--
-- SHAPE CHOSEN: a per-entry scalar `approach_condition`, NOT a per-approach
-- child table. Rejected the child-row shape deliberately: 61.57(c)(1)(i)
-- requires a COUNT of six qualifying approaches within the 6-calendar-month
-- window, not the identity, sequence, or airport of any one of them — the
-- reg text has no "which approach" concept for the engine to need. A child
-- table would be the "smallest thing that makes the reg computable" only if
-- the reg asked a question a child row answers; it doesn't. (The genuinely
-- unresolved case — one entry recording, say, two ILS approaches and one
-- visual approach, which cannot be told apart once collapsed to one
-- condition value per entry — is docs/CURRENCY-SPEC.md's defect #3 in §11,
-- already logged there as a known, accepted limitation of the one-row-per-
-- entry design that predates this migration; approaches_count/approach_type
-- have the identical limitation today and this migration does not change
-- that shape, only adds the missing axis to it.)
--
-- NULLABLE, DEFAULT NULL — deliberately NOT defaulted to 'neither' or any
-- other value. A row inserted before this column existed recorded no fact
-- about condition at all; NULL means unknown, and the currency engine
-- (docs/CURRENCY-SPEC.md §2.3's computation) must exclude an unknown row
-- from BOTH the qualifying count and any disqualifying inference — exactly
-- the "any missing input that could change the answer produces
-- insufficient_data" rule in §6. Defaulting an old row to 'neither' would
-- silently manufacture a disqualification the pilot never asserted;
-- defaulting it to 'actual'/'simulated' would silently invent currency.
-- Both are the "retroactively invent currency a pilot never had" failure
-- named in the task. A CHECK enforces the three-value vocabulary but never
-- forces a value, so every pre-existing row reads as NULL after this
-- migration runs, with no backfill statement anywhere in this file.
--
-- 'neither' is a real, distinct value from NULL: it is the pilot
-- affirmatively stating the approach was flown in neither actual weather
-- conditions nor under a view-limiting device (the ordinary case for a
-- visual approach in VMC with no hood) — a disqualifying fact, not a
-- missing one. Modeling "doesn't count" and "we don't know" as the same
-- NULL would collapse a stated fact into an absent one and make the
-- engine's insufficient_data logic unable to tell them apart.
alter table pilot.logbook_entries
  add column approach_condition text
    check (approach_condition is null or approach_condition in ('actual', 'simulated', 'neither'));

-- approach_type and approach_condition are two different axes (TYPE of
-- procedure flown vs. CONDITION it was flown under) that this schema must
-- not let collide into one meaning — see the task's own warning that a
-- 'visual' approach_type must not be conflated with condition. A visual
-- approach is by definition flown with the runway environment in sight, so
-- it cannot simultaneously be asserted 'actual' (IMC) or 'simulated' (under
-- a view-limiting device); the only conditions compatible with
-- approach_type = 'visual' are NULL (unknown/not asserted) or 'neither'.
-- This does not need to reject 'actual'/'simulated' on every OTHER
-- approach_type — those are legitimately either, depending on how the
-- approach was actually flown.
alter table pilot.logbook_entries
  add constraint logbook_entries_visual_condition_check
    check (approach_type <> 'visual' or approach_condition is null or approach_condition = 'neither');

comment on column pilot.logbook_entries.approach_condition is
  '61.57(c)(1): the six required instrument approaches must be performed "in actual weather conditions, or under simulated conditions using a view-limiting device." NOT recorded anywhere before this column — an approach tagged approach_type = ''ils'' flown in clear VMC with no hood was indistinguishable in this schema from one flown in IMC, which is the live blocker on computing 61.57(c) (docs/CURRENCY-SPEC.md §2.3). Values: ''actual'' (flown in actual instrument/IMC weather conditions), ''simulated'' (flown under a view-limiting device — hood, foggles, or a qualifying simulator per 61.57(c)(2)), ''neither'' (flown in neither condition — e.g. a visual approach in VMC; a real, pilot-asserted, DISQUALIFYING fact, distinct from NULL). NULL is UNKNOWN, not a value on the reg''s own scale — every row from before this column existed reads as NULL, and the currency engine must treat NULL the same as any other missing input: excluded from the qualifying count, never counted as a "6th approach" and never counted as a reason to say a pilot is NOT current either, per docs/CURRENCY-SPEC.md §6''s "any missing input that could change the answer produces insufficient_data" rule. A per-approach child table was considered and rejected: 61.57(c)(1)(i) requires a COUNT of six qualifying approaches in the 6-calendar-month window, not each approach''s individual identity, so the smallest correct shape is this one column, not a new table. Fetched 14 CFR 61.57(c)(1), ecfr.gov versioner, issue date 2026-08-05, 2026-08-07.';

-- GRANTS — extend INSERT (20260807050000's list, as amended by
-- 20260807120000) and UPDATE with approach_condition. Ordinary editable
-- flight data, same treatment as approach_type/courses_intercepted_tracked
-- — not a provenance column, so no INSERT-only restriction.
revoke insert on pilot.logbook_entries from authenticated;
grant insert (
  account_id, source, trip_id, trip_leg_id, airman_user_id,
  entry_date, aircraft_ident, aircraft_type, from_icao, to_icao, role,
  total_time, pic_time, sic_time, solo_time, cross_country_time, night_time,
  instrument_actual_time, instrument_simulated_time, flight_instructor_time,
  dual_received_time, simulator_time, simulator_device_type,
  day_takeoffs, day_landings_full_stop, day_landings_touch_go, night_takeoffs,
  night_landings_full_stop, night_landings_touch_go, approaches_count,
  approach_type, approach_condition, courses_intercepted_tracked, holds,
  view_limiting_pilot_name, remarks
) on pilot.logbook_entries to authenticated;

revoke update on pilot.logbook_entries from authenticated;
grant update (
  entry_date, aircraft_ident, aircraft_type, from_icao, to_icao, role,
  total_time, pic_time, sic_time, solo_time, cross_country_time, night_time,
  instrument_actual_time, instrument_simulated_time, flight_instructor_time,
  dual_received_time, simulator_time, simulator_device_type,
  day_takeoffs, day_landings_full_stop, day_landings_touch_go, night_takeoffs,
  night_landings_full_stop, night_landings_touch_go, approaches_count,
  approach_type, approach_condition, courses_intercepted_tracked, holds,
  view_limiting_pilot_name, remarks
) on pilot.logbook_entries to authenticated;

-- ---------------------------------------------------------------------------
-- GAP 2 — 61.58 PIC proficiency check. Absent from the product entirely.
-- ---------------------------------------------------------------------------
--
-- Fetched: https://www.ecfr.gov/api/versioner/v1/full/2026-08-05/title-14.xml?section=61.58
-- (retrieved via the eCFR versioner API 2026-08-07; the tool used to fetch
-- this session's copy would not return exact-quote text past a short
-- character budget, so what follows is a careful paraphrase of the fetched
-- text, cross-checked across two independent fetches of the same URL that
-- agreed on every point below — not a recalled or assumed reading. Anyone
-- who needs verbatim text for a legal opinion should re-fetch the URL
-- above directly.)
--
-- 61.58(a): a person who acts as PIC of an aircraft TYPE CERTIFICATED FOR
-- MORE THAN ONE REQUIRED PILOT FLIGHT CREWMEMBER, or of a turbojet airplane,
-- must complete a PIC proficiency check — and the section states TWO
-- distinct periods, not one, matching the task's warning that they are not
-- the same length:
--   (1) within the preceding 12 calendar months, a check in ANY aircraft
--       requiring this proficiency check (i.e. any qualifying multi-crew
--       or turbojet type), and
--   (2) within the preceding 24 calendar months, a check in the SPECIFIC
--       TYPE of aircraft the pilot seeks to act as PIC of.
-- 61.58(b): this section DOES NOT APPLY to a pilot operating under 14 CFR
-- part 91 subpart K, or under parts 121, 125, 133, 135, or 137, or to a
-- pilot maintaining qualification under part 121 subpart Y's Advanced
-- Qualification Program. This matters directly for this product's users:
-- a contract pilot's PART 135 flying is, on this text, OUTSIDE 61.58 —
-- the operator's own 135 training/check program is what governs instead
-- (the same posture 61.57(e)(3)/135.247 already take in
-- docs/CURRENCY-SPEC.md §2.5). 61.58 binds only flying NOT conducted under
-- one of the parts (b) lists — ordinarily this product's Part 91 flying
-- (owner flights, empty repositioning legs not conducted under an
-- operator's 135 certificate) in a multi-crew or turbojet aircraft. This is
-- exactly the operating_rule distinction 20260807130000_operating_rule.sql
-- already added to clients/trips for 61.57(e)(3) — 61.58 is a second reason
-- that field exists, not a new concept.
-- 61.58(d): compliance may be satisfied by an authorized PIC proficiency
-- check, a type-rating practical test, an examiner/check-airman practical
-- test, or (for a military pilot) an equivalent military PIC proficiency
-- check. 61.58(g) contemplates satisfying it in an approved simulator.
-- 61.58(i) is its OWN grace-period provision (structurally similar to, but
-- a DIFFERENT reg than, the 135.301(a)-style grace docs/CURRENCY-SPEC.md §3
-- warns not to borrow across 61.56/61.57): a check completed within the
-- calendar month before or after the month it was due counts as though
-- completed in the month it was due.
--
-- DECISION: build nothing beyond a document KIND. Read
-- app/(app)/documents/kinds.ts's header comment first: DOCUMENT_KINDS is
-- "the kind vocabulary, ported verbatim from the pilot.documents check
-- constraint," used for exactly the kind of record 61.58 needs to become —
-- "a pilot-entered date on the pilot's own paperwork," with "no assumed
-- duration or cycle asserted" and no computed expiry, matching how
-- flight_review is recorded today (a completion/expiry date the pilot
-- types, nothing derived) and per document-form.tsx's own on-screen copy,
-- "Nothing here is calculated from the other." 61.58 is a genuinely
-- different LEGAL requirement from anything already in pilot.documents
-- (it is 61-series, follows the pilot not an operator certificate, and is
-- unrelated to operator_qualifications' Part 135 checks — see below), but
-- it needs NO new column shape: `label`, `issued_on`/`expires_on`, and
-- `notes` on the existing pilot.documents row are exactly the fields a
-- pilot filling out "I did my PIC proficiency check on this date, in this
-- aircraft" needs, the same way they already are for flight_review.
-- Building a bespoke table for one more (kind, date) pair would duplicate
-- pilot.documents' shape for no new capability, and — worse — a document
-- attaches to pilot.expirations' single expiration-ladder view "by
-- construction" (see that view's own header comment in
-- 20260805070000_phase3_clients_trips_expenses.sql); a new bespoke table
-- would need to be wired into that view by hand and would silently miss
-- the tenancy:verify coverage check if it weren't, which is exactly the
-- FlightDeptPro failure that view exists to prevent. pilot.documents
-- already solves that problem; reuse it.
--
-- What this migration does NOT do, matching the task's "record the check
-- and its date, do not compute a determination" instruction and this
-- product's committed "planning aid, not a determination of regulatory
-- compliance" posture (lib/brand.ts):
--   - No 12-month/24-month expiry is derived from expires_on. The pilot
--     types whatever date is on their own record, exactly as flight_review
--     works today; this migration adds no trigger, and none of the files
--     this task may touch (kinds.ts only, for documents) include the
--     computation code even if one were wanted.
--   - No cross-credit from pilot.operator_qualifications. Whether a given
--     Part 135 check also happens to satisfy 61.58 is moot for a pilot
--     actually operating under Part 135 (61.58(b) exempts that flying
--     outright) and, for the Part 91 flying it DOES bind, is exactly the
--     kind of "was this check conducted in a way that also satisfies a
--     different reg" question docs/CURRENCY-SPEC.md §2.4 and §2.7 already
--     decline to answer for the analogous 61.56/61.57(d) cross-credit
--     questions, for the same reason: it depends on how the check was
--     conducted and by whom, not on a date and a requirement key.
--   - No expiry-badge or currency-engine wiring: this document kind
--     participates in pilot.expirations exactly as every other kind does
--     (kind is unioned in already; see that view), which surfaces it on
--     the existing due-soon ladder like any dated document — nothing new
--     to wire, nothing computed beyond what that ladder already computes
--     for every kind (days until expires_on, not a regulatory verdict).
alter table pilot.documents
  drop constraint documents_kind_check;
alter table pilot.documents
  add constraint documents_kind_check
    check (kind in ('medical', 'flight_review', 'passport', 'certificate',
                    'insurance', 'w9', 'pic_proficiency_check', 'other'));

comment on constraint documents_kind_check on pilot.documents is
  'Kind vocabulary — keep in lockstep with app/(app)/documents/kinds.ts''s DOCUMENT_KINDS. pic_proficiency_check added for 14 CFR 61.58 (PIC proficiency check for a pilot operating a multi-crew-required or turbojet aircraft type OUTSIDE parts 91K/121/125/133/135/137 — see this migration''s header for the full reading and the fetch URL). Recorded the same way flight_review already is: a pilot-entered date, no computed expiry, no cross-credit from pilot.operator_qualifications.';

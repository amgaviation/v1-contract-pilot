-- Regulatory gap: nothing in this product recorded whether flying is
-- under 14 CFR Part 91 or Part 135, even though the operator-
-- qualifications machinery (20260807060000, corrected 20260807110000)
-- already shows Part 135-specific rows (135.293/.297/.299) and applies
-- the Part 135-only 135.301(a) grace month to EVERY client, including a
-- pure Part 91 owner-flying one. See lib/operating-rule.ts for the
-- vocabulary and the full reasoning behind the value sets below; this
-- migration is the schema half of the same fix.
--
-- REGULATIONS RELIED ON — verified against the eCFR versioner API
-- (authoritative XML), retrieved 2026-08-07:
--
--   https://www.ecfr.gov/api/versioner/v1/full/2026-08-05/title-14.xml?section=135.301
--     (a) "If a crewmember who is required to take a test or a flight
--     check UNDER THIS PART, completes the test or flight check in the
--     calendar month before or after the calendar month in which it is
--     required, that crewmember is considered to have completed the
--     test or check in the calendar month in which it is required."
--     "under this part" is Part 135 — this provision does not reach a
--     Part 91 relationship at all, and this migration's trigger change
--     makes sure the computation, not just the panel's display, honors
--     that.
--
--   https://www.ecfr.gov/api/versioner/v1/full/2026-08-05/title-14.xml?section=61.57
--     (e)(3) "This section does not apply to a pilot in command who is
--     employed by a part 119 certificate holder authorized to conduct
--     operations under part 135 when the pilot is engaged in a flight
--     operation UNDER PARTS 91 OR 135 for that certificate holder if the
--     pilot in command is in compliance with §§ 135.243 and 135.247."
--     Confirms the exact fact pattern this product's first market lives
--     in — one client/certificate holder, both parts flown for them on
--     different days — which is why ClientOperatingRule needs a 'both'
--     value distinct from either single-part value, not just distinct
--     TRIP-level values. This migration does not implement 61.57(e)(3)
--     itself (that is Phase 7's currency engine) — it only makes the
--     fact the engine will need (which part a trip was flown under, and
--     whether a client is even a Part 135 relationship) representable.
--
-- ===========================================================================
-- (A) pilot.clients.operating_rule
--
-- VALUE SET: 'part_91' | 'part_135' | 'both' | 'unspecified'. See
-- lib/operating-rule.ts for the full reasoning; 'both' exists because
-- 61.57(e)(3) above confirms one client commonly gives both kinds of
-- work, and Part 91 Subpart K / Part 121 are deliberately NOT added —
-- not this product's market today, and a value with no gating logic
-- behind it is worse than no value.
--
-- DEFAULT FOR EXISTING ROWS: 'unspecified', not a guess at either part.
-- JUSTIFICATION (the judgment call the task calls out explicitly):
-- defaulting every existing client to 'part_135' would light up the
-- 135.293/.297/.299 rows and the 135.301(a) grace for a client that may
-- be pure Part 91 owner-flying — exactly the false-positive the audit
-- found. Defaulting to 'part_91' is the mirror-image wrong: it would
-- HIDE currency rows a pilot genuinely needs for a real Part 135
-- relationship, which is worse than a false positive, not better — a
-- pilot who never sees the 135.297 row has no prompt to ever fill it in,
-- while a pilot who sees rows they don't need can at least tell (their
-- own operator relationship) that something doesn't apply and would
-- notice the mismatch. 'unspecified' is the only default that doesn't
-- silently assert a fact this migration has no evidence for. Paired
-- with UI copy that reads as "you haven't told us" and prompts the
-- pilot to set it, not as a fourth kind of operation. includesPart135()
-- (lib/operating-rule.ts) treats 'unspecified' as NOT Part 135 for
-- gating the qualifications panel — the safe direction for a table whose
-- rows describe a specific operator's Part 135 certificate, since
-- showing 135-specific rows for a relationship nobody has confirmed is
-- Part 135 would misrepresent what the operator qualification table
-- itself claims to be (see its own table comment).
-- ===========================================================================
alter table pilot.clients
  add column operating_rule text not null default 'unspecified'
    check (operating_rule in ('part_91', 'part_135', 'both', 'unspecified'));

comment on column pilot.clients.operating_rule is
  'Which 14 CFR part(s) this client''s work is flown under. ''unspecified'' is the default for every client that existed before this column (20260807130000) — see the migration header for why that, not a guessed part, is the safe default. Gates the operator-qualifications panel (pilot.operator_qualifications) — see includesPart135() in lib/operating-rule.ts — and seeds (but does not fix) pilot.trips.operating_rule at trip creation.';

-- ===========================================================================
-- (B) pilot.trips.operating_rule
--
-- VALUE SET: 'part_91' | 'part_135' only — a trip is always flown under
-- exactly one part (lib/operating-rule.ts's TripOperatingRule), unlike
-- the client-level field. NOT NULL with a column DEFAULT, matching the
-- house pattern already used for trip_kind/status on this same table
-- (20260805070000) — the app always has a concrete value to submit
-- (trip-form.tsx seeds it from the selected client, then leaves it
-- independently editable, the same "fills in from the client, pilot can
-- override" pattern day_rate_cents already uses), so there is no state
-- where a trip legitimately has no answer.
--
-- DEFAULT FOR NEW ROWS AND FOR EXISTING ROWS WITHOUT A DETERMINABLE
-- CLIENT PART: 'part_91'. JUSTIFICATION: unlike clients.operating_rule,
-- this column does not itself gate any visible UI today (the
-- qualifications panel reads the CLIENT's field) and nothing yet
-- computes off it (Phase 7's currency engine, not built). The asymmetric
-- risk that ruled out defaulting clients to 'part_135' does not apply
-- the same way here, but the same conservative direction is still
-- correct once Phase 7 exists: an incorrectly-'part_135' trip could feed
-- a Part 135-specific limit (e.g. 135.267 cumulative flight time) into a
-- computation for flying that was actually Part 91, overstating
-- Part 135 exposure the pilot never actually flew — an error in the
-- direction of a false compliance ALARM. An incorrectly-'part_91' trip
-- under-counts Part 135 exposure instead — also wrong, but the direction
-- this migration prefers for a column with no current reader, on the
-- same "don't assert a fact you don't have evidence for" logic as (A),
-- weighted toward least data disruption: 'part_91' is also the
-- pre-existing implicit assumption in this product, since Part 135
-- rules were never modeled at all until 20260807060000, and every trip
-- ever billed by a contract pilot for an OWNER's aircraft (the
-- product's original, still-common flow — see trip_kind='owner_trip')
-- is a Part 91 operation by construction.
-- ===========================================================================
alter table pilot.trips
  add column operating_rule text not null default 'part_91'
    check (operating_rule in ('part_91', 'part_135'));

-- Backfill: where a trip's client has a SINGLE determinable part
-- ('part_91' or 'part_135'), inherit it — better evidence than the
-- column default for that trip specifically. A client of 'both' or
-- 'unspecified' gives no single answer to inherit, so those trips keep
-- the 'part_91' column default, for the same reasons given above.
update pilot.trips t
   set operating_rule = c.operating_rule
  from pilot.clients c
 where t.account_id = c.account_id
   and t.client_id = c.id
   and c.operating_rule in ('part_91', 'part_135');

comment on column pilot.trips.operating_rule is
  'Which 14 CFR part this specific trip was flown under — always exactly one, unlike pilot.clients.operating_rule. Defaults from the client''s operating_rule at trip creation (app-layer, trip-form.tsx — the same "fills in from the client, then independently editable" pattern day_rate_cents uses) and is independently editable per trip, because a contract pilot flies the same airframe under both parts for one client on different days. See 20260807130000''s header for the backfill/default reasoning for rows that predate this column.';

-- ---------------------------------------------------------------------------
-- (C) 135.301(a) GATING REACHES THE COMPUTATION, NOT JUST THE DISPLAY.
--
-- pilot.compute_operator_qualification_expiry() (20260807060000,
-- extended 20260807110000) applies the 135.301(a) one-month-early/
-- one-month-late grace unconditionally to every
-- written_test_135_293a / competency_check_135_293b / ipc_135_297 /
-- line_check_135_299 row, regardless of which client it belongs to.
-- That is wrong now that a client can be genuinely, confirmedly Part 91
-- only: 135.301(a) says "under this part" (Part 135), so a Part 91
-- client's row must never receive the grace, even though the panel
-- already hides those rows for a non-135 client (operator-
-- qualifications-panel.tsx) — a HIDDEN row whose expiry was still
-- computed with the Part 135 grace would still be wrong data sitting in
-- the database, ready to resurface the moment the client's
-- operating_rule is corrected to include Part 135 (or via
-- pilot.expirations, which is not filtered by operating_rule at all).
--
-- FIX: the four Part 135-derived requirement kinds ALWAYS get their
-- 12-or-6-calendar-month arithmetic (that part is not conditional — see
-- below for why), but the 301(a) early/late SHIFT is applied only when
-- the owning client's operating_rule includes Part 135
-- (includesPart135() in lib/operating-rule.ts, mirrored in SQL below as
-- `in ('part_135', 'both')`). For a client that does not, the shifted
-- comparison is skipped and the raw completed_on month is used, exactly
-- as an out-of-window (more than one month early/late) check already
-- behaves today.
--
-- WHY THE BASE N-CALENDAR-MONTH ARITHMETIC ITSELF STAYS UNCONDITIONAL:
-- the panel already hides all four rows entirely for a non-135 client
-- (TYPE_SPECIFIC_REQUIREMENTS / fixedRequirements are still rendered
-- from OPERATOR_QUALIFICATION_REQUIREMENTS regardless today — see the
-- follow-up in operator-qualification-kinds.ts below), so no pilot can
-- reach the form to create one of these four rows for a non-135 client
-- through the UI at all once that follow-up lands; a row of this kind
-- existing for such a client is an edge case (e.g. the client was
-- Part 135 when the row was created, then reclassified), not the normal
-- path, and computing SOME expiry for it (raw month, no unearned grace)
-- is more honest than leaving expires_on null for a row that does have a
-- completed_on.
-- ---------------------------------------------------------------------------
create or replace function pilot.compute_operator_qualification_expiry()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  months_ahead int;
  base_month date;
  required_month date;
  client_rule text;
begin
  if new.requirement not in (
    'written_test_135_293a', 'competency_check_135_293b', 'ipc_135_297', 'line_check_135_299'
  ) then
    -- Not one of the four Part 135 recurring test/check requirements
    -- this function derives. expires_on is whatever the caller supplied
    -- (may be null) — see the column comment for why that's correct for
    -- these kinds.
    return new;
  end if;

  if new.completed_on is null then
    new.expires_on := null;
    return new;
  end if;

  -- IDEMPOTENCY GATE (H1, unchanged): only recompute when this UPDATE
  -- actually moves completed_on. See the 20260807060000 migration's
  -- comment for the full feedback-loop hazard this closes.
  if tg_op = 'UPDATE' and old.completed_on is not distinct from new.completed_on then
    new.expires_on := old.expires_on;
    return new;
  end if;

  -- 135.297(a): 6th calendar month. 135.293(a), 135.293(b) and
  -- 135.299(a): 12th calendar month. See the 20260807110000 migration's
  -- header for the exact eCFR text.
  months_ahead := case new.requirement
    when 'ipc_135_297' then 6
    else 12
  end;

  base_month := date_trunc('month', new.completed_on)::date;

  -- (C) 135.301(a) is Part 135 ONLY ("under this part"). Look up the
  -- owning client's operating_rule to decide whether the early/late
  -- shift below may apply at all. A client row that has since been
  -- deleted (should not happen — the FK is ON DELETE CASCADE, so this
  -- trigger would not be firing for it) reads as null here, which the
  -- `in (...)` test below treats as false — no grace, the conservative
  -- direction.
  select c.operating_rule into client_rule
    from pilot.clients c
   where c.account_id = new.account_id and c.id = new.client_id;

  if tg_op = 'UPDATE' and old.completed_on is distinct from new.completed_on
     and old.expires_on is not null
     and client_rule in ('part_135', 'both') then
    required_month := date_trunc('month', old.expires_on)::date;
    if base_month = (required_month - interval '1 month')::date
       or base_month = (required_month + interval '1 month')::date then
      base_month := required_month;
    end if;
  end if;

  new.expires_on := (base_month + ((months_ahead + 1) || ' months')::interval - interval '1 day')::date;
  return new;
end;
$$;

comment on function pilot.compute_operator_qualification_expiry() is
  '135.293(a), 135.293(b), 135.297(a), 135.299(a) expiry derivation. The N-calendar-month base arithmetic runs for all four kinds regardless of client; the 135.301(a) one-month-early/one-month-late grace (20260807130000) is applied only when the owning client''s operating_rule includes Part 135 (''part_135'' or ''both'') — 135.301(a) is textually limited to "a crewmember who is required to take a test or a flight check under this part" (Part 135) and must never extend a Part 91-only client''s window. See 20260807130000''s header for the eCFR text and the reasoning for keeping the base arithmetic unconditional.';

-- ---------------------------------------------------------------------------
-- (D) FOLLOW-UP FLAGGED, NOT FIXED HERE: operator-qualification-kinds.ts
-- / operator-qualifications-panel.tsx now gate the four Part 135-
-- specific requirement ROWS on the owning client's operating_rule
-- (includesPart135()) — see that panel's own comment. This migration
-- only had to reach the DATABASE side of 135.301(a) (above); the display
-- gate lives entirely in the two .tsx files on this task's allowlist.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- GRANTS — column-scoped, matching the house pattern. Both new columns
-- are ordinary pilot-editable fields (no trigger owns either), so both
-- get INSERT+UPDATE, same treatment as e.g. clients.per_diem_mode /
-- trips.trip_kind on the same tables. Postgres column-privilege GRANTs
-- are ADDITIVE — each statement adds the named column(s) to the
-- grantee's existing set on that table and privilege, so this only needs
-- to name the ONE new column, not restate every column an earlier
-- migration already granted (repeating that list here would risk it
-- silently drifting out of sync with the real one over time).
-- ---------------------------------------------------------------------------
grant insert (operating_rule), update (operating_rule)
  on pilot.clients to authenticated;
grant insert (operating_rule), update (operating_rule)
  on pilot.trips to authenticated;

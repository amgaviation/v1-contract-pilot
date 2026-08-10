-- A simulator session has no crew role, and the logbook now says so.
--
-- ***************************************************************************
-- WHY (decided by the product owner, 2026-08-10, on real data)
-- ***************************************************************************
-- pilot.logbook_entries.role was `not null` with a CHECK limiting it to
-- PIC / SIC / SOLO / DUAL_RECEIVED. That is the right vocabulary for a
-- flight. It is the wrong question for a simulator session.
--
-- Found on a real 221-row ForeFlight export: 18 of the rows were
-- full-flight-simulator sessions carrying no PIC, SIC, solo or
-- dual-received time at all. There was nothing to infer a role from —
-- not because the export was deficient, but because in an FFS there is no
-- aircraft, and "who was acting as pilot in command of the aircraft" has
-- no answer. 14 CFR 61.51(b)(3) asks an entry to record the TYPE of
-- aircraft, FFS, FTD or ATD and the location; it does not ask a sim
-- session to nominate a PIC. 61.51(g) governs instrument time in an
-- FFS/FTD separately, and for a 61.58 PIC proficiency check or a 135.293
-- competency check conducted in a simulator the pilot is being CHECKED,
-- which is not "dual received" either.
--
-- Three ways to make those rows importable were considered: default them
-- to DUAL_RECEIVED (ships today, but writes an assumption into a legal
-- record, and is simply wrong for a check ride), ask the pilot to pick a
-- role during import (accurate, but asks a question with no correct
-- answer), or let the role be absent for an entry that is entirely
-- simulator time. The third is the only one that does not put a fact the
-- pilot did not assert into a record they may one day have to defend.
--
-- ***************************************************************************
-- WHAT IS AND IS NOT LOOSENED
-- ***************************************************************************
-- This is NOT "role is now optional". A FLIGHT still requires a role, and
-- the CHECK below is what keeps that true: role may be null only when the
-- entry's time is entirely simulator time. The pre-existing
-- logbook_entries_check2 already requires simulator_device_type whenever
-- simulator_time > 0, so a role-less entry necessarily records WHAT device
-- it was flown in — which is exactly the substitution 61.51(b)(3)
-- contemplates.
--
-- The existing logbook_entries_role_check needs no change: a CHECK passes
-- when its expression is NULL, and `role = ANY (ARRAY[...])` evaluates to
-- NULL for a null role. Stated here rather than left to be rediscovered,
-- because "the enum check still constrains the non-null case" is the
-- property that makes it safe to leave alone.
--
-- Deliberately NOT done: backfilling anything. No existing row is
-- rewritten, and no row that currently has a role loses it.
-- ***************************************************************************

alter table pilot.logbook_entries alter column role drop not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'pilot.logbook_entries'::regclass
      and conname = 'logbook_entries_role_required_unless_simulator'
  ) then
    alter table pilot.logbook_entries
      add constraint logbook_entries_role_required_unless_simulator
      check (
        role is not null
        or (
          coalesce(simulator_time, 0) > 0
          and coalesce(total_time, 0) = coalesce(simulator_time, 0)
        )
      );
  end if;
end $$;

comment on column pilot.logbook_entries.role is
  'PIC / SIC / SOLO / DUAL_RECEIVED for a flight. NULL only for an entry whose time is entirely simulator time — an FFS/FTD/ATD session has no crew role in the FAA sense, and logbook_entries_role_required_unless_simulator is what stops that exemption reaching an actual flight. See 20260810020000''s header, and 20260809000000 for why DUAL_GIVEN is not in this vocabulary.';

comment on constraint logbook_entries_role_required_unless_simulator on pilot.logbook_entries is
  'A flight must name a crew role; a wholly-simulator entry need not. The second arm requires total_time to equal simulator_time, so an entry mixing real flight time with sim time still has to say who was flying.';

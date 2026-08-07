-- Phase 6 corrective — attribute each logbook_entries row to the airman
-- who flew it.
--
-- THE DEFECT: pilot.logbook_entries carries account_id but no per-user
-- column. account_id is a BILLING entity (docs/PLAN.md decision #10 —
-- "Solo flat rate; business per-seat") and pilot.account_members is
-- (account_id, user_id, role): a business account can and does have more
-- than one seat/member sharing one account_id. 14 CFR 61.51 is a
-- PER-AIRMAN record-keeping duty — "each person must document" their own
-- training and aeronautical experience — so two members of the same
-- business account currently share a single undifferentiated pile of
-- flight time with no column that says whose hours are whose. This
-- product's own docs describe logbook_entries as a legal record meant to
-- be defensible in an FAA enforcement action; a record that cannot say
-- WHO flew a given entry fails that job for exactly the accounts (multi-
-- seat businesses) the product also sells to.
--
-- THE FIX IS DELIBERATELY MINIMAL. This is attribution, not a full airman
-- record (certificates, ratings, currency rollups) — that is a larger
-- piece of work being scoped separately and is explicitly OUT OF SCOPE
-- here.
--
-- RLS VISIBILITY IS UNCHANGED. logbook_entries_select/update/delete stay
-- scoped to `account_id in (select pilot.current_account_ids())`, exactly
-- as 20260805220000 left them, with NO airman_user_id predicate added to
-- any of them: a business account's members can and should still SEE the
-- whole account's logbook (a bookkeeper reconciling trips against logged
-- flights needs every member's entries, not just their own). This change
-- is about WHO AN ENTRY BELONGS TO, not WHO CAN SEE IT.
--
-- ONE DELIBERATE EXCEPTION, on INSERT only: logbook_entries_insert's WITH
-- CHECK gains `and airman_user_id = auth.uid()`, below. This is a
-- narrower change than it may look — it is still pure account-scoping
-- plus one new equality clause, not a visibility change, and it touches
-- INSERT only; SELECT/UPDATE/DELETE are byte-for-byte what 20260805220000
-- left them. It exists because a column-scoped GRANT (unlike RLS) has no
-- way to say "this column may be set, but only to the caller's own
-- value" — a bare `grant insert (..., airman_user_id, ...)` lets
-- `authenticated` assert ANY uuid for it, including another member's, or
-- omit it and get NULL (the column stays nullable — see the backfill
-- note below), from a crafted POST that never goes through
-- app/(app)/logbook/actions.ts at all. Every provenance column already
-- shows this exact pattern for a reason (20260805230000's header: "It is
-- reachable from a browser, not just a script"), and a column whose whole
-- purpose is "who is legally responsible for this flight record" is the
-- last one that should be assignable to an arbitrary value or left
-- unset. The WITH CHECK is what makes it true, at the database boundary,
-- that no authenticated write can create a NEW row with a NULL or
-- someone-else's airman_user_id — a guarantee the application code
-- alone cannot make, since PostgREST is directly reachable with the
-- publishable key.
--
-- BACKFILL POLICY — READ BEFORE CHANGING: for an account with EXACTLY ONE
-- row in pilot.account_members, that member is unambiguously whose
-- logbook every existing entry on the account is, so those rows are
-- backfilled. For an account with MORE than one member, there is no
-- column anywhere on logbook_entries, trips, or trip_legs today that
-- records which member flew a given trip/leg/entry (trip_legs.role is
-- PIC/SIC, a per-leg CREW POSITION, not a crew IDENTITY — see db.ts's
-- draftPayloadForLeg comment, which already refused to guess role for the
-- same reason). Guessing which of N members an ambiguous entry belongs to
-- — e.g. "assign it to the owner" or "assign it to whoever has the most
-- entries" — would silently manufacture a false attestation on a record
-- this product markets as enforcement-defensible. That is the same class
-- of defect this migration exists to fix, just moved one column over.
-- Multi-member accounts' existing rows are therefore left
-- airman_user_id = NULL by this migration. Resolving them is a follow-up
-- product surface (prompting each business account to assign its
-- historical entries), not a database guess.
--
-- NEW ROWS are covered going forward without ambiguity: every write path
-- now sets airman_user_id server-side from the authenticated caller
-- (requireAccount()'s `user.id`), never from client input. See
-- app/(app)/logbook/actions.ts: createLogbookEntry, confirmLegDraft, and
-- confirmTripDrafts. updateLogbookEntry never touches it — see the grant
-- comment below.
--
-- COLUMN-SCOPED GRANTS. `authenticated` gets airman_user_id on INSERT
-- only, never UPDATE, using the exact idiom 20260805230000 established
-- for the rest of this table's provenance columns (source, trip_id,
-- trip_leg_id, the import-lineage set): reassigning whose logbook an
-- entry belongs to after the fact is not an "edit" a pilot legitimately
-- makes, it's rewriting who flew the flight — so it is withheld from the
-- UPDATE grant at the database layer, not merely omitted from the form.

alter table pilot.logbook_entries
  add column airman_user_id uuid references auth.users (id);

comment on column pilot.logbook_entries.airman_user_id is
  'The account_members.user_id who flew this entry (14 CFR 61.51 is a per-airman duty). Set server-side on insert from the session, never client-supplied, and never updatable (see this migration''s header + GRANTS). NULL only for pre-existing rows on a multi-member account where no source records which member flew it — see the backfill note above.';

-- Backfill: single-member accounts only. account_members has no
-- created_at ordering guarantee beyond "created_at asc" (see
-- getSessionContext's comment on why that tiebreak exists at all for
-- multi-row cases) — irrelevant here because this only touches accounts
-- where the count is exactly 1, so there is nothing to break the tie
-- between.
with solo_owner as (
  -- min(uuid)/max(uuid) has no aggregate in Postgres, so the sole member
  -- is pulled out of a one-element array instead — still exact, since the
  -- having clause below guarantees there is exactly one to pull.
  select account_id, (array_agg(user_id))[1] as user_id
  from pilot.account_members
  group by account_id
  having count(*) = 1
)
update pilot.logbook_entries e
set airman_user_id = solo_owner.user_id
from solo_owner
where e.account_id = solo_owner.account_id
  and e.airman_user_id is null;

-- Index: every read of "my entries" (the export in CHANGE 2, and any
-- future per-airman filter) will filter on (account_id, airman_user_id).
create index if not exists logbook_entries_airman_idx
  on pilot.logbook_entries (account_id, airman_user_id)
  where airman_user_id is not null;

-- GRANTS. Extend the INSERT column list from 20260805230000 with
-- airman_user_id; leave the UPDATE column list from 20260805220000
-- untouched (airman_user_id deliberately absent from it — see header).
revoke insert on pilot.logbook_entries from authenticated;

grant insert (
  account_id, source, trip_id, trip_leg_id, airman_user_id,
  entry_date, aircraft_ident, aircraft_type, from_icao, to_icao, role,
  total_time, pic_time, sic_time, solo_time, cross_country_time, night_time,
  instrument_actual_time, instrument_simulated_time, flight_instructor_time,
  dual_received_time, simulator_time, simulator_device_type,
  day_landings_full_stop, day_landings_touch_go, night_takeoffs,
  night_landings_full_stop, night_landings_touch_go, approaches_count,
  approach_type, holds, remarks
) on pilot.logbook_entries to authenticated;

-- RLS: enable-state and SELECT/UPDATE/DELETE policies are untouched —
-- logbook_entries already has row level security enabled from
-- 20260805220000, and this migration alters an existing table rather
-- than creating a new one, so scripts/tenancy-verify.mjs's F1/F1b sweep
-- (every pilot.* table has RLS enabled, and every RLS-enabled table has
-- at least one policy) needs no new statement here to stay green.
-- Confirmed by re-running tenancy:verify after this migration (see
-- PR/report).
--
-- The one INSERT-only WITH CHECK addition described in the header above:
-- recreated rather than ALTER POLICY'd because Postgres has no
-- `alter policy ... add check` — replacing the whole clause is the only
-- way to add a conjunct. account_id's clause is copied byte-for-byte from
-- 20260805220000 so tenant-scoping on INSERT is provably unchanged; only
-- the airman_user_id conjunct is new.
drop policy if exists logbook_entries_insert on pilot.logbook_entries;
create policy logbook_entries_insert on pilot.logbook_entries for insert to authenticated
  with check (
    account_id in (select pilot.current_account_ids())
    and airman_user_id = auth.uid()
  );

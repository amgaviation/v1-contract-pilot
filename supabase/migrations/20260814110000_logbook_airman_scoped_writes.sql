-- Fix sweep — logbook_entries UPDATE/DELETE let any account member edit or
-- delete another airman's flight-time record.
--
-- THE DEFECT: 20260807050000 added airman_user_id and pinned it on INSERT
-- (`with check (... and airman_user_id = auth.uid())`), but its header says
-- plainly "RLS VISIBILITY IS UNCHANGED. logbook_entries_select/update/delete
-- stay scoped to `account_id in (select pilot.current_account_ids())`" —
-- deliberate for SELECT (a bookkeeper reconciling trips needs to read every
-- member's entries), but never argued for UPDATE/DELETE. The result: the
-- flight-time fields themselves (hours, landings, approaches, dates) are
-- editable and deletable by every member of a business account, including a
-- role='bookkeeper' seat. A logbook entry is the airman's own 14 CFR 61.51
-- legal record and feeds the currency engine; another member silently
-- rewriting or deleting it is a per-user integrity hole this account-scoped
-- model never closed. Read 20260805220000 and 20260807050000 before editing
-- this file further.
--
-- THE FIX: scope logbook_entries_update/delete's USING clause to the owning
-- airman, the same predicate 20260811040000 already uses to harden
-- pilot.documents (`documents_insert`/`documents_update`'s WITH CHECK,
-- lines ~340-350 of that file): `airman_user_id is null or airman_user_id =
-- auth.uid()`. NULL stays editable by any account member on purpose — it is
-- the documented state of every pre-existing row on a multi-member account
-- that predates this column (20260807050000's backfill note: "no source
-- records which member flew it"), and treating "unattributed" as
-- "no one but the original writer may touch it" would make those rows
-- permanently stuck for the account that owns them. UPDATE also gets the
-- identical predicate in WITH CHECK: airman_user_id is not in the UPDATE
-- grant (20260805220000), so it cannot change under an UPDATE, and the
-- WITH CHECK is just USING re-applied to the (unchanged) resulting row —
-- not a new restriction on what a caller may set.
--
-- SELECT and INSERT are untouched. This is additive scoping on two policies
-- only: drop+recreate logbook_entries_update and logbook_entries_delete,
-- byte-for-byte the same account_id clause 20260805220000 established, plus
-- the one new airman conjunct. Enable-state, grants, and every other policy
-- on this table are unchanged, so scripts/tenancy-verify.mjs's RLS sweep
-- needs no new statement here to stay green.

drop policy if exists logbook_entries_update on pilot.logbook_entries;
create policy logbook_entries_update on pilot.logbook_entries for update to authenticated
  using (
    account_id in (select pilot.current_account_ids())
    and (airman_user_id is null or airman_user_id = auth.uid())
  )
  with check (
    account_id in (select pilot.current_account_ids())
    and (airman_user_id is null or airman_user_id = auth.uid())
  );

drop policy if exists logbook_entries_delete on pilot.logbook_entries;
create policy logbook_entries_delete on pilot.logbook_entries for delete to authenticated
  using (
    account_id in (select pilot.current_account_ids())
    and (airman_user_id is null or airman_user_id = auth.uid())
  );

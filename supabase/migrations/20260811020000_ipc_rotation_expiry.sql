-- H-ipc-per-type, fixed AT THE SOURCE (REVIEW-ipc problems 1 & 2).
--
-- The 2026-08-10 fix (currentIpcRotationId() in
-- operator-qualification-kinds.ts) taught the client-detail panel that a
-- pilot legitimately rotating IPCs across aircraft types has exactly one
-- "current" row at any moment and every other type's row is rotation
-- history, not a lapse -- but it only touched the panel. pilot.expirations
-- (20260807060000 / 20260807110000), the view app/(app)/overview/page.tsx's
-- Needs-attention query reads directly, kept unioning EVERY ipc_135_297
-- row independently, each with its own ladder_stage computed off its own
-- expires_on. Result: the panel told the pilot "older type rows show as
-- rotation history, not a lapse" while the dashboard, for that SAME row
-- id, kept printing "<Client> — 135.297 IPC (CE-560XL) · Expired 31 JUL
-- 2026" in the AGGREGATE_LIMIT-capped Needs-attention list -- the product
-- contradicting itself on one screen pair, which is worse than the
-- original false-red alarm H-ipc-per-type set out to fix (a pilot who
-- trusts the panel disregards a real dashboard alert; a pilot who trusts
-- the dashboard concludes the panel is lying).
--
-- FIX: pilot.expirations now unions exactly ONE synthetic row per
-- (account_id, client_id) for requirement = 'ipc_135_297', not one row
-- per pilot.operator_qualifications.id -- the same correction
-- currentIpcRotationId() already applies client-side, moved to the one
-- place both surfaces actually read from, so the panel and the dashboard
-- can no longer disagree about which row is current.
--
-- REGULATORY BASIS -- 14 CFR 135.297, eCFR versioner API (this
-- environment's fetcher reaches eCFR directly; there is no bot-detection
-- redirect here, and no Cornell-mirror fallback is needed -- see
-- REVIEW-ipc problem 5):
--   https://www.ecfr.gov/api/versioner/v1/full/2026-08-06/title-14.xml?section=135.297
--   (2026-08-06 is the title's most recent issue date), retrieved live
--   2026-08-10. Paragraph (e), verbatim: "If the pilot in
--   command is assigned to pilot more than one type of aircraft, that
--   pilot must take the instrument proficiency check required by
--   paragraph (a) of this section in each type of aircraft to which that
--   pilot is assigned, in rotation, but not more than one flight check
--   during each period described in paragraph (a) of this section."
--   Paragraph (a)'s 6-calendar-month window is not itself type-indexed
--   ("...as a pilot in command of an aircraft under IFR...", singular/
--   general) -- one check, in whichever type the rotation lands on next,
--   satisfies it. A pilot who legitimately rotates types therefore has,
--   at any moment, exactly one row that is actually "live" for 297(a)'s
--   window; every other type's row having its own lapsed expires_on is
--   the rotation working as designed, not a compliance gap.
--
-- WHY THE WINNING ROW IS PICKED BY expires_on, NOT completed_on
-- (REVIEW-ipc problem 4): 135.301(a)'s one-month-early/one-month-late
-- grace (pilot.compute_operator_qualification_expiry(), 20260807060000 /
-- 20260807110000) can make completed_on and expires_on non-monotonic
-- across two rows of the same client. Concrete failure this migration
-- closes: a CE-560XL row's prior expires_on is 2026-07-31 (required_month
-- = JUL 2026); a new check completed 2026-06-20 lands in the calendar
-- month immediately BEFORE that required month, so 301(a) shifts
-- base_month to JUL and the new expires_on becomes 2027-01-31. A CE-680
-- row checked 2026-06-25 (five days LATER, no adjacent prior cycle to
-- shift from) expires 2026-12-31 -- a LATER completed_on with an EARLIER
-- expires_on. Picking "current" by MAX(completed_on) would pick the 680
-- row and grey out the 560XL row even though the 560XL row is the one
-- still providing live coverage on 2027-01-05 -- reintroducing the exact
-- false-red the original defect (H-ipc-per-type) is about. The ladder is
-- what this view computes, so it has to pick by the field it actually
-- gates -- expires_on -- never by the field that merely produced it.
--
-- SCOPE -- ONLY ipc_135_297. competency_check_135_293b is also
-- class/type-specific (135.293(b)) but has no 297(e)-style rotation
-- clause: each class/type is its OWN independent 12-calendar-month
-- requirement, so every competency-check row belongs in the ladder on its
-- own merits, and collapsing it into one synthetic row the way IPC now
-- works would hide a real, independently-required check. Left unchanged.
--
-- "create or replace view" matches columns POSITIONALLY and can only
-- APPEND safely. This migration adds, removes, reorders, and retypes
-- NOTHING in pilot.expirations' column list (source_table, source_id,
-- account_id, item_kind, item_label, expires_on, days_remaining,
-- ladder_stage, unchanged) -- only which rows the ipc_135_297 branch
-- emits -- so CREATE OR REPLACE is safe here: there is no drop, so the
-- existing `grant select on pilot.expirations to authenticated` and `to
-- service_role` (20260807060000) carry forward untouched and there is no
-- revoke-trap to fall into re-granting them.
create or replace view pilot.expirations
with (security_invoker = true) as
  select
    'document'::text                as source_table,
    d.id                            as source_id,
    d.account_id,
    d.kind                          as item_kind,
    d.label                         as item_label,
    d.expires_on,
    (d.expires_on - current_date)   as days_remaining,
    case
      when d.expires_on < current_date                       then 'overdue'
      when d.expires_on <= current_date + 1                  then 't_minus_1'
      when d.expires_on <= current_date + 7                  then 't_minus_7'
      when d.expires_on <= current_date + 14                 then 't_minus_14'
      when d.expires_on <= current_date + 30                 then 't_minus_30'
      else 'ok'
    end                             as ladder_stage
  from pilot.documents d
  where d.expires_on is not null

  union all

  -- Every operator-qualification requirement EXCEPT ipc_135_297: one row
  -- per pilot.operator_qualifications.id, unchanged since 20260807110000.
  select
    'operator_qualification'::text  as source_table,
    oq.id                           as source_id,
    oq.account_id,
    oq.requirement                  as item_kind,
    c.name || ' — ' || (case oq.requirement
      when 'basic_indoc'                 then 'Basic indoctrination'
      when 'initial_training'            then 'Initial training'
      when 'recurrent_training'          then 'Recurrent training'
      when 'written_test_135_293a'       then '135.293(a) written/oral test'
      when 'competency_check_135_293b'   then '135.293(b) competency check'
      when 'line_check_135_299'          then '135.299 line check'
      when 'drug_alcohol_program_120'    then '120.105/120.215 drug & alcohol program'
      when 'prd_consent_111'             then '111.310 PRD consent'
      when 'insurance_approval'          then 'Insurance approval'
      when 'company_manuals'             then 'Company manuals'
      else 'Other requirement'
    end) || (case when oq.type_designator <> '' then ' (' || oq.type_designator || ')' else '' end)
                                     as item_label,
    oq.expires_on,
    (oq.expires_on - current_date)  as days_remaining,
    case
      when oq.expires_on < current_date                       then 'overdue'
      when oq.expires_on <= current_date + 1                  then 't_minus_1'
      when oq.expires_on <= current_date + 7                  then 't_minus_7'
      when oq.expires_on <= current_date + 14                 then 't_minus_14'
      when oq.expires_on <= current_date + 30                 then 't_minus_30'
      else 'ok'
    end                              as ladder_stage
  from pilot.operator_qualifications oq
  join pilot.clients c on c.account_id = oq.account_id and c.id = oq.client_id
  where oq.expires_on is not null
    and oq.requirement <> 'ipc_135_297'

  union all

  -- ipc_135_297: exactly ONE synthetic row per (account_id, client_id) --
  -- the row with the latest expires_on among that client's ipc_135_297
  -- rows, i.e. the check actually keeping the 135.297(a)/(e) rotation
  -- current right now. DISTINCT ON (account_id, client_id) ordered by
  -- expires_on DESC picks it; a tie on expires_on (an edge case, not
  -- expected in practice -- two types checked in the same calendar month
  -- landing on the identical last-day-of-month expiry) breaks on
  -- type_designator ascending, so the choice is deterministic rather than
  -- dependent on physical row order. This SELECT is parenthesized because
  -- it carries its own ORDER BY, which DISTINCT ON requires -- an
  -- unparenthesized ORDER BY at the end of a UNION ALL would apply to the
  -- whole union's output instead of driving this branch's own row
  -- selection. source_id is the WINNING row's own id -- still a real
  -- pilot.operator_qualifications.id -- so app/(app)/overview/page.tsx's existing
  -- operatorQualClientId lookup (which joins straight back to
  -- operator_qualifications by this id) needs no change.
  (
    select distinct on (oq.account_id, oq.client_id)
      'operator_qualification'::text  as source_table,
      oq.id                           as source_id,
      oq.account_id,
      oq.requirement                  as item_kind,
      c.name || ' — 135.297 IPC' ||
        (case when oq.type_designator <> '' then ' (' || oq.type_designator || ')' else '' end)
                                       as item_label,
      oq.expires_on,
      (oq.expires_on - current_date)  as days_remaining,
      case
        when oq.expires_on < current_date                       then 'overdue'
        when oq.expires_on <= current_date + 1                  then 't_minus_1'
        when oq.expires_on <= current_date + 7                  then 't_minus_7'
        when oq.expires_on <= current_date + 14                 then 't_minus_14'
        when oq.expires_on <= current_date + 30                 then 't_minus_30'
        else 'ok'
      end                              as ladder_stage
    from pilot.operator_qualifications oq
    join pilot.clients c on c.account_id = oq.account_id and c.id = oq.client_id
    where oq.expires_on is not null
      and oq.requirement = 'ipc_135_297'
    order by oq.account_id, oq.client_id, oq.expires_on desc, oq.type_designator asc
  );

comment on view pilot.expirations is
  'A1/C4: the single expiry ladder. Every date-bearing row type in schema pilot MUST be unioned in here -- pilot.expiration_coverage_gaps() proves it, and tenancy:verify fails if it is not empty. security_invoker so the underlying tables'' RLS still applies. source_table distinguishes ''document'' (pilot.documents) from ''operator_qualification'' (pilot.operator_qualifications, added 20260807060000, corrected 20260807110000) -- read this as evidence the pilot recorded, never as a legality or on-the-certificate determination, and (for the derived kinds) as a planning aid rather than a compliance determination. ipc_135_297 is the one exception to "one row per qualification row": 20260811020000 unions exactly one synthetic row per (account_id, client_id) -- the row with the latest expires_on -- because 135.297(a)''s 6-calendar-month window is not type-indexed and a pilot legitimately rotating types per 135.297(e) has exactly one row that is actually current at any moment; see that migration''s header, and operator-qualification-kinds.ts''s currentIpcRotationId() for the client-side mirror of the same rule.';

-- Regulatory-audit corrections to pilot.operator_qualifications
-- (20260807060000). That migration's header carried three cite/model
-- errors that produced FALSE RED "expired" badges for requirements a
-- pilot does not have, while making requirements they DO have
-- unrecordable. This migration fixes the model, migrates existing rows,
-- and corrects every comment that repeated the wrong reasoning so
-- nothing in this file lies to the next person who reads it.
--
-- REGULATIONS RELIED ON — verified against the eCFR versioner API
-- (authoritative XML, not the bot-detection-gated web UI), retrieved
-- 2026-08-07:
--   https://www.ecfr.gov/api/versioner/v1/full/2026-08-05/title-14.xml?section=135.293
--   https://www.ecfr.gov/api/versioner/v1/full/2026-08-05/title-14.xml?section=135.297
--   https://www.ecfr.gov/api/versioner/v1/full/2026-08-05/title-14.xml?section=135.299
--   https://www.ecfr.gov/api/versioner/v1/full/2026-08-05/title-14.xml?section=135.301
--   https://www.ecfr.gov/api/versioner/v1/full/2026-08-05/title-14.xml?section=111.105
--   https://www.ecfr.gov/api/versioner/v1/full/2026-08-05/title-14.xml?section=111.310
--   https://www.ecfr.gov/api/versioner/v1/full/2026-08-05/title-14.xml?section=111.120
--   https://www.ecfr.gov/api/versioner/v1/full/2026-08-05/title-14.xml?section=120.105
--   https://www.ecfr.gov/api/versioner/v1/full/2026-08-05/title-14.xml?section=120.215
--
-- =========================================================================
-- (A) TYPE-SPECIFICITY WAS EXACTLY INVERTED.
--
--   135.299(a): "...that pilot has passed a flight check in ONE OF THE
--   TYPES of aircraft which that pilot is to fly." One line check, in
--   ANY ONE type, covers every type flown for that operator. NOT
--   type-specific. The old schema forced `type_designator <> ''` on this
--   requirement and let a pilot hold many rows (one per type), which
--   told pilots they were missing line checks they did not need and
--   raised false "overdue" items above real overdue invoices.
--
--   135.293(b): "...a competency check...in THAT CLASS of aircraft, if
--   single-engine airplane other than turbojet, or THAT TYPE of
--   aircraft, if helicopter, multiengine airplane, turbojet airplane, or
--   powered-lift..." — genuinely class/type-specific: a pilot flying a
--   CE-560XL and a CE-680 for one operator needs TWO competency checks,
--   each with its own 12-calendar-month window.
--
--   135.297(e): "If the pilot in command is assigned to pilot more than
--   one type of aircraft, that pilot must take the [IPC]...in each type
--   of aircraft to which that pilot is assigned, IN ROTATION, but not
--   more than one flight check during each period described in
--   paragraph (a)..." — also type-indexed, though NOT in the same way as
--   293(b): 297(a) is not itself type-scoped ("PIC of an aircraft under
--   IFR", singular/general), and (e) says explicitly that only ONE
--   flight check is required per 6-calendar-month period even when
--   multiple types are flown — the check simply has to rotate through
--   the types over successive periods rather than repeat in the same
--   type every time.
--
--   The old `unique (account_id, client_id, requirement, type_designator)`
--   with type_designator defaulting to '' meant a pilot could hold
--   exactly ONE competency-check row and ONE IPC row per operator, ever
--   — the CE-560XL/CE-680 pilot above could not record their second
--   competency check at all, and .297(e)'s per-type rotation history had
--   nowhere to go.
--
--   FIX: line_check_135_299 becomes a single fixed row per client
--   (type_designator now OPTIONAL and purely informational — which type
--   it happened to be flown in, not a per-type requirement).
--   competency_check_135_293b (renamed, see (D)) and ipc_135_297 become
--   repeatable-by-type/class: TYPE_SPECIFIC_REQUIREMENTS in
--   operator-qualification-kinds.ts.
--
--   JUDGMENT CALL on 297(e) specifically: this migration records each
--   IPC by the type it was flown in (so the rotation HISTORY is at
--   least visible row-by-row) but does NOT attempt to compute whether a
--   pilot's actual rotation across periods satisfies "in rotation, not
--   more than one flight check during each period" — that requires
--   knowing every period's single check across ALL the pilot's assigned
--   types in sequence, which this table (current-state-per-type, no
--   history of superseded rows) cannot reconstruct, and inventing a
--   rotation-compliance verdict from insufficient data would be exactly
--   the kind of fabricated legality determination this schema's own
--   table comment forbids. The app copy says so plainly instead.
--
-- =========================================================================
-- (B) 111.105 WAS CITED FOR *CONSENT*; IT IS THE REVIEWING ENTITY'S
--     *EVALUATION* DUTY.
--
--   § 111.105 "Evaluation of pilot records": "...no reviewing entity may
--   permit an individual to begin service as a pilot until the
--   reviewing entity has evaluated all relevant information in the
--   PRD." That is the OPERATOR's post-consent evaluation duty, not
--   consent.
--
--   Consent is § 111.310 "Written consent": "...that pilot must apply
--   for access to the PRD...and provide written consent to the FAA for
--   release of that pilot's records to the operator..." — restated from
--   the pilot's-rights angle in § 111.120 "Pilot consent and right of
--   review": "No reviewing entity may retrieve records in the PRD
--   pertaining to any pilot prior to receiving that pilot's written
--   consent..."
--
--   JUDGMENT CALL: the row's existing label ("PRD...consent") and its
--   product purpose (a pilot recording that they gave the operator
--   permission to pull their PRD file) both describe consent, not the
--   operator's evaluation step — so this fix keeps the row meaning
--   CONSENT and repoints the citation to 111.310/111.120 (with 111.105
--   named in the copy as the operator's separate, later duty), rather
--   than reinterpreting the row as "PRD records evaluation" and keeping
--   111.105. The enum value name (prd_consent_111) is left as-is since
--   Part 111 as a whole is still the right part number and the value
--   already reads as consent; only the CITED SECTIONS change.
--
-- =========================================================================
-- (C) 120.105 WAS CITED FOR "DRUG & ALCOHOL PROGRAM"; IT COVERS DRUG
--     TESTING ONLY.
--
--   § 120.105 "Employees who must be tested" sits in Part 120 Subpart E
--   (Drug Testing). Alcohol misuse prevention is Subpart F; its coverage
--   section is § 120.215 "Covered employees" (tests at § 120.217, not
--   independently cited here — 120.215 is the coverage question this
--   row answers, matching how 120.105 was already used for drug
--   testing). Both verified to exist and say what this comment claims,
--   via the versioner API section-structure JSON.
--
--   Both sections share the identical "directly OR BY CONTRACT
--   (INCLUDING BY SUBCONTRACT AT ANY TIER)" clause — the exact hook that
--   pulls an independent 1099 contract pilot into an operator's drug and
--   alcohol program despite not being that operator's employee. The old
--   copy cited only 120.105 and never surfaced that clause at all; the
--   corrected copy cites both sections and quotes the clause, since it
--   is precisely the fact this audience needs stated plainly.
--
-- =========================================================================
-- (D) 135.293(a) WRITTEN/ORAL TEST AND 135.293(b) COMPETENCY CHECK WERE
--     COLLAPSED INTO ONE REQUIREMENT.
--
--   Both run on independent 12-calendar-month windows against
--   independent events — (a) a knowledge test on nine subject areas,
--   (b) a hands-on competency check in the class/type. A pilot can pass
--   the written test in March and the competency check in July; one
--   shared `completed_on` made the earlier of the two invisible and its
--   own expiry silently inherited the later date.
--
--   FIX: split into two requirement values —
--     written_test_135_293a  (12 cal. mo., NOT type-specific — see (A))
--     competency_check_135_293b (12 cal. mo., type/class-specific)
--   DATA MIGRATION: every existing row with
--   requirement = 'competency_check_135_293' is renamed to
--   'competency_check_135_293b' — that old single row's derived
--   12-calendar-month arithmetic already matched (b), and (b) is the
--   check-with-class/type-specificity this schema's own type_designator
--   column was clearly modelling, so this is the reading that loses the
--   least information. There is no historical data to migrate for the
--   NEW written_test_135_293a row — nothing recorded it separately
--   before, so it starts empty for every existing client, same as any
--   other newly split-out tracked item.
--
--   Also surfaced (copy only, not automated): 135.293(d) — "The
--   instrument proficiency check required by § 135.297 may be
--   substituted for the competency check required by this section for
--   the type of aircraft used in the check." Not auto-applied: cross-
--   requirement substitution is compliance-critical logic this product
--   should not silently decide on the pilot's behalf; the row copy
--   states the option and the pilot records whichever check they
--   actually took.
--
-- =========================================================================
-- (E) .297 AND .299 ARE PIC-ONLY (.297 ALSO IFR-ONLY); .293 BINDS ANY
--     PILOT.
--
--   135.293: "...nor may any person SERVE AS A PILOT..." (both (a) and
--   (b)) — binds SIC too.
--   135.297(a): "...nor may any person serve AS A PILOT IN COMMAND OF AN
--   AIRCRAFT UNDER IFR..." — PIC AND IFR only.
--   135.299(a): "...nor may any person serve AS A PILOT IN COMMAND OF A
--   FLIGHT..." — PIC only.
--
--   A contract SIC flying right seat under a 135 certificate needs .293
--   but not .297 or .299. This migration does not add a PIC/SIC column
--   to pilot.clients to auto-hide the two PIC-only rows — that table is
--   outside this fix's file scope, and a schema change there deserves
--   its own review rather than riding along on a reg-citation fix.
--   Addressed at the copy layer instead: each row's regCite in
--   operator-qualification-kinds.ts now states who it binds and under
--   what conditions, and the existing 'n_a' status option remains the
--   explicit escape hatch for an SIC-only pilot on the two PIC-only
--   rows. FLAGGED FOR FOLLOW-UP, not fixed here.
--
-- =========================================================================
-- (F) / (G) — the "planning aid, not a compliance determination" framing
-- and the UTC-vs-local-date badge comparison are both UI-layer fixes in
-- operator-qualification-row.tsx / -panel.tsx, not schema changes; see
-- those files' own comments. Noted here only so a reader of this
-- migration knows they were part of the same audit and were not missed.
-- =========================================================================

-- ---------------------------------------------------------------------------
-- STEP 1 — drop the constraints this migration replaces, before touching
-- any data, so the data migration below is never fighting a CHECK it's
-- about to make obsolete anyway.
-- ---------------------------------------------------------------------------
alter table pilot.operator_qualifications
  drop constraint operator_qualifications_requirement_check,
  drop constraint operator_qualifications_check1,
  drop constraint operator_qualifications_account_id_client_id_requirement_ty_key;

-- ---------------------------------------------------------------------------
-- STEP 2 — DATA MIGRATION. Existing rows must survive.
-- ---------------------------------------------------------------------------

-- (D) rename: every existing competency_check_135_293 row becomes
-- competency_check_135_293b. See the header for why (b), not (a).
update pilot.operator_qualifications
   set requirement = 'competency_check_135_293b'
 where requirement = 'competency_check_135_293';

-- (A) consolidate: the old schema let a pilot hold MULTIPLE
-- line_check_135_299 rows (one per type, because the old CHECK forced
-- type_designator <> ''). 135.299(a) needs only one. Keep the row with
-- the latest completed_on (most current evidence; nulls sort last, i.e.
-- lowest priority, via NULLS LAST here meaning we prefer a row that
-- actually has a completed_on over a never-completed placeholder), fold
-- every other kept row's type/date/notes into the survivor's notes so
-- nothing a pilot typed is silently discarded, then delete the rest.
-- No-op today (this table has no rows in local dev), but written to be
-- correct against a populated table, since production may not be empty.
with ranked as (
  select
    id, account_id, client_id, type_designator, completed_on, notes,
    row_number() over (
      partition by account_id, client_id
      order by completed_on desc nulls last, created_at desc
    ) as rn
  from pilot.operator_qualifications
  where requirement = 'line_check_135_299'
),
survivors as (
  select account_id, client_id, id as survivor_id
  from ranked
  where rn = 1
),
folded as (
  select
    s.survivor_id,
    string_agg(
      format(
        'Consolidated by 20260807110000 (135.299(a) is not type-specific — one line check covers every type): type %s, completed %s.',
        nullif(r.type_designator, ''),
        coalesce(r.completed_on::text, 'not recorded')
      ),
      ' '
      order by r.completed_on desc nulls last
    ) as extra_notes
  from ranked r
  join survivors s on s.account_id = r.account_id and s.client_id = r.client_id
  where r.rn > 1
  group by s.survivor_id
)
update pilot.operator_qualifications oq
   set notes = trim(both ' ' from concat_ws(' ', oq.notes, folded.extra_notes))
  from folded
 where oq.id = folded.survivor_id;

-- Re-derived rather than reused across statements: each DML statement's
-- WITH clause is scoped to itself in Postgres, so "ranked" from the
-- UPDATE above isn't visible here. Recomputing is cheap (this table is
-- small) and keeps both statements self-contained and independently
-- readable.
with ranked as (
  select
    id, account_id, client_id,
    row_number() over (
      partition by account_id, client_id
      order by completed_on desc nulls last, created_at desc
    ) as rn
  from pilot.operator_qualifications
  where requirement = 'line_check_135_299'
)
delete from pilot.operator_qualifications oq
 using ranked
 where oq.id = ranked.id
   and ranked.rn > 1;

-- Line check's type_designator is now informational, not identifying —
-- clear it to '' on the surviving row so a stale "whichever type
-- happened to survive the consolidation" value doesn't masquerade as a
-- considered answer. (A no-op today; written for a populated table.)
update pilot.operator_qualifications
   set type_designator = ''
 where requirement = 'line_check_135_299';

-- ---------------------------------------------------------------------------
-- STEP 3 — new CHECK constraints reflecting the corrected vocabulary and
-- the corrected (inverted) type-specificity rule.
-- ---------------------------------------------------------------------------
alter table pilot.operator_qualifications
  add constraint operator_qualifications_requirement_check
    check (requirement in (
      'basic_indoc', 'initial_training', 'recurrent_training',
      'written_test_135_293a', 'competency_check_135_293b', 'ipc_135_297',
      'line_check_135_299',
      'drug_alcohol_program_120', 'prd_consent_111', 'insurance_approval',
      'company_manuals', 'other'
    ));

-- (A) INVERTED from the original: type_designator is now REQUIRED for
-- the two class/type-specific requirements (135.293(b), 135.297) and
-- left optional for everything else — including line_check_135_299,
-- which the original (wrong) version of this check forced to be
-- non-blank.
alter table pilot.operator_qualifications
  add constraint operator_qualifications_type_required_when_specific
    check (
      requirement not in ('competency_check_135_293b', 'ipc_135_297')
      or type_designator <> ''
    );

-- ---------------------------------------------------------------------------
-- STEP 4 — new uniqueness. Two partial unique indexes replace the single
-- table-wide unique constraint, because "what identifies a row" is no
-- longer the same shape for every requirement (see (A) above):
--   * competency_check_135_293b / ipc_135_297: one row per
--     (client, requirement, type/class) — genuinely repeatable.
--   * every other requirement, including line_check_135_299: one row per
--     (client, requirement), full stop — type_designator does not
--     participate in identity for these, so two rows with different
--     type_designator text must NOT be allowed to coexist.
-- ---------------------------------------------------------------------------
create unique index operator_qualifications_type_specific_uidx
  on pilot.operator_qualifications (account_id, client_id, requirement, type_designator)
  where requirement in ('competency_check_135_293b', 'ipc_135_297');

create unique index operator_qualifications_fixed_uidx
  on pilot.operator_qualifications (account_id, client_id, requirement)
  where requirement not in ('competency_check_135_293b', 'ipc_135_297');

-- ---------------------------------------------------------------------------
-- STEP 5 — pilot.compute_operator_qualification_expiry(): extend to the
-- four derived requirements (was three), keep the 301(a) grace and the
-- H1 idempotency gate exactly as they were — neither needed to change,
-- both are requirement-agnostic once the membership test and the
-- months-ahead lookup below are correct.
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
  -- 135.299(a): 12th calendar month. See this migration's header for
  -- the exact eCFR text.
  months_ahead := case new.requirement
    when 'ipc_135_297' then 6
    else 12
  end;

  base_month := date_trunc('month', new.completed_on)::date;

  if tg_op = 'UPDATE' and old.completed_on is distinct from new.completed_on
     and old.expires_on is not null then
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
  '135.293(a), 135.293(b), 135.297(a), 135.299(a) expiry derivation with the 135.301(a) one-month-early/one-month-late provision, PART 135 CHECKS ONLY. Never touches expires_on for any other requirement kind. Corrected 20260807110000 to cover four requirements (was three, before written_test_135_293a split out of the old collapsed competency_check_135_293 — see that migration''s header). See this migration''s header for the eCFR text relied on.';

-- ---------------------------------------------------------------------------
-- STEP 6 — column/table comments. Rewritten in full rather than patched,
-- so nothing here still asserts the inverted type-specificity rule or
-- the wrong PRD/drug-alcohol cites.
-- ---------------------------------------------------------------------------
comment on table pilot.operator_qualifications is
  'What the pilot has been told/shown by an operator about their standing on THAT operator''s Part 135 certificate — NOT a determination that they are on the certificate, and the app copy must never read as one. The 135.293/135.297/135.299 valid-through dates are a planning aid, not a determination of regulatory compliance (20260807110000). drug_alcohol_program_120 and prd_consent_111 rows are status the pilot noted (120.105/120.215 and 111.310/111.120 bind the OPERATOR or the pilot''s own consent action, never a determination this product computes or verifies) and are never computed or verified by this product.';

comment on column pilot.operator_qualifications.expires_on is
  'LOAD-BEARING COLUMN NAME: pilot.expiration_coverage_gaps() finds date-bearing tables by this exact name. Derived by pilot.compute_operator_qualification_expiry() for written_test_135_293a (12 cal. mo., 135.293(a)), competency_check_135_293b (12 cal. mo., 135.293(b), class/type-specific), ipc_135_297 (6 cal. mo., 135.297(a), type-specific per (e) rotation) and line_check_135_299 (12 cal. mo., 135.299(a), NOT type-specific — one check in any one type covers every type), each with the 135.301(a) one-month-early/one-month-late provision applied on UPDATE. For every other requirement kind, this is a plain pilot-entered date (or null) — no calendar-month reg was cited for basic_indoc/initial_training/recurrent_training/insurance_approval/company_manuals/other, and drug_alcohol_program_120/prd_consent_111 are status rows this product does not compute a determination for at all. Corrected 20260807110000 — see that migration''s header for the audit this fixes.';

comment on column pilot.operator_qualifications.type_designator is
  'Aircraft class/type designator (e.g. CE-560XL). REQUIRED (non-blank) for competency_check_135_293b and ipc_135_297 — 135.293(b) is class/type-specific and 135.297(e) rotates by type when a pilot is assigned more than one; those two requirements are repeatable, one row per class/type. OPTIONAL and purely informational for every other requirement, INCLUDING line_check_135_299 — 135.299(a) is answered by one check in any one type, so its type_designator records which type that was, not a separate requirement per type. Defaults to '''' (never NULL). Corrected 20260807110000: the original version of this column comment and its CHECK constraint had this exactly backwards (forced non-blank on the line check, silent on the two that actually need it) — see that migration''s header.';

-- ---------------------------------------------------------------------------
-- STEP 7 — pilot.expirations view: update the item_label CASE for the
-- renamed/new requirement values and the corrected drug/alcohol and PRD
-- citations, so the ladder a pilot sees uses the same corrected
-- vocabulary as the panel.
-- ---------------------------------------------------------------------------
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

  select
    'operator_qualification'::text  as source_table,
    oq.id                           as source_id,
    oq.account_id,
    oq.requirement                  as item_kind,
    -- "<operator> — <requirement label>[ (<type>)]", matching the reg
    -- citation vocabulary this migration's header uses, so the ladder
    -- reads the same language a pilot would use talking to their chief
    -- pilot.
    c.name || ' — ' || (case oq.requirement
      when 'basic_indoc'                 then 'Basic indoctrination'
      when 'initial_training'            then 'Initial training'
      when 'recurrent_training'          then 'Recurrent training'
      when 'written_test_135_293a'       then '135.293(a) written/oral test'
      when 'competency_check_135_293b'   then '135.293(b) competency check'
      when 'ipc_135_297'                 then '135.297 IPC'
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
  where oq.expires_on is not null;

comment on view pilot.expirations is
  'A1/C4: the single expiry ladder. Every date-bearing row type in schema pilot MUST be unioned in here — pilot.expiration_coverage_gaps() proves it, and tenancy:verify fails if it is not empty. security_invoker so the underlying tables'' RLS still applies. source_table distinguishes ''document'' (pilot.documents) from ''operator_qualification'' (pilot.operator_qualifications, added 20260807060000, corrected 20260807110000) — read this as evidence the pilot recorded, never as a legality or on-the-certificate determination, and (for the three Part 135 derived kinds) as a planning aid rather than a compliance determination.';

-- ---------------------------------------------------------------------------
-- STEP 8 — grants. type_designator is now meaningfully editable on
-- UPDATE for the non-type-specific rows too (the line check's type is
-- corrected in place, not just set once at creation) — see
-- operator-qualifications-actions.ts's identity comment. Granting it on
-- UPDATE is safe for the type-specific rows as well: the app never
-- sends a changed value for those (each row's type is fixed once
-- created; a new type gets a new row instead), so this is a widened
-- grant with no widened write path in practice, not a new risk.
-- ---------------------------------------------------------------------------
grant update (completed_on, status, expires_on, notes, document_id, type_designator)
  on pilot.operator_qualifications to authenticated;

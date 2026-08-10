/**
 * The requirement vocabulary, ported verbatim from the
 * pilot.operator_qualifications check constraint, plus the labels a
 * pilot sees. Order matches how a pilot would walk a new-operator
 * onboarding packet: indoc/training first, the four recurring Part 135
 * items next (135.293(a) test, 135.293(b) check, 135.297 IPC, 135.299
 * line check), then the two operator-obligation status rows, then the
 * free-form paperwork rows.
 *
 * REG-SPECIFICITY, verified against the eCFR versioner API
 * (https://www.ecfr.gov/api/versioner/v1/full/2026-08-05/title-14.xml
 * ?section=135.29x, retrieved 2026-08-07) — corrected 20260807110000
 * after an audit found the product had this EXACTLY BACKWARDS:
 *
 *   - 135.299(a) line check is NOT type-specific: "a flight check in
 *     ONE OF THE TYPES of aircraft which that pilot is to fly" — one
 *     check, in any one type, covers every type flown for that
 *     operator. Renders as a single fixed row; type_designator is an
 *     informational record of which type it was flown in, never a
 *     per-type requirement.
 *   - 135.293(b) competency check IS specific — to CLASS (single-engine
 *     airplane, other than turbojet) or TYPE (helicopter, multiengine
 *     airplane, turbojet airplane, powered-lift), one check per
 *     class/type flown. Renders as a repeatable-by-type sub-list.
 *   - 135.297 IPC: 297(a) itself is not type-indexed (any current IPC
 *     satisfies "PIC of an aircraft under IFR"), but 297(e) requires a
 *     pilot assigned to more than one type to take the check "in each
 *     type... in rotation, but not more than one flight check during
 *     each period." This product records each IPC by the type it was
 *     flown in (also a repeatable-by-type sub-list, so the rotation
 *     history is at least visible). (H-ipc-per-type fix, 2026-08-10; moved
 *     to the source of truth 20260811020000) A pilot rotating types
 *     exactly as 297(e) contemplates will always have every type EXCEPT
 *     the current one sitting past its OWN row's expires_on — that is
 *     what compliant rotation looks like, not a lapse, because 297(a)'s
 *     6-calendar-month window binds the pilot under this operator, not
 *     any one type. currentIpcRotationId() below picks out whichever row
 *     has the latest expires_on across a client's ipc_135_297 rows —
 *     supabase/migrations/20260811020000_ipc_rotation_expiry.sql applies
 *     the identical rule at the source, so pilot.expirations (the ladder
 *     the dashboard's Needs-attention list reads — app/(app)/overview/page.tsx)
 *     unions exactly that one synthetic row per (account_id, client_id)
 *     instead of one row per qualification id. The panel and the
 *     dashboard therefore judge the SAME row; every other type's row
 *     renders as rotation history with no red badge of its own on
 *     EITHER screen. Still NOT a determination that the rotation itself
 *     satisfies 297(e) — only that the most recent check is inside
 *     297(a)'s window — the panel copy says so.
 *
 * TYPE_SPECIFIC_REQUIREMENTS is the exception set — the panel renders
 * those two as repeatable-by-type sub-lists; every other requirement in
 * OPERATOR_QUALIFICATION_REQUIREMENTS (INCLUDING the line check) renders
 * as a single fixed row per client.
 */
export const LINE_CHECK_REQUIREMENT = "line_check_135_299" as const;
export const COMPETENCY_CHECK_REQUIREMENT = "competency_check_135_293b" as const;
export const IPC_REQUIREMENT = "ipc_135_297" as const;
export const WRITTEN_TEST_REQUIREMENT = "written_test_135_293a" as const;

/** The four requirements that only make sense for a client whose
 * operating_rule includes Part 135 (lib/operating-rule.ts's
 * includesPart135()) — 20260807130000, closing the regulatory-audit gap
 * that offered these rows to every client including a pure Part 91
 * owner-flying one. The panel filters these out (with explanatory copy,
 * not a silent disappearance) for a client that does not include
 * Part 135. */
export const PART_135_ONLY_REQUIREMENTS = new Set<string>([
  WRITTEN_TEST_REQUIREMENT,
  COMPETENCY_CHECK_REQUIREMENT,
  IPC_REQUIREMENT,
  LINE_CHECK_REQUIREMENT,
]);

/** The two requirements that are class/type-specific per the reg text
 * above and therefore render as a repeatable-by-type sub-list rather
 * than one fixed row. Line check is deliberately NOT in this set — see
 * the file header. */
export const TYPE_SPECIFIC_REQUIREMENTS = new Set<string>([
  COMPETENCY_CHECK_REQUIREMENT,
  IPC_REQUIREMENT,
]);

export const OPERATOR_QUALIFICATION_REQUIREMENTS = [
  { value: "basic_indoc", label: "Basic indoctrination", regCite: null },
  { value: "initial_training", label: "Initial training", regCite: null },
  { value: "recurrent_training", label: "Recurrent training", regCite: null },
  {
    value: WRITTEN_TEST_REQUIREMENT,
    label: "Written/oral knowledge test",
    regCite:
      "135.293(a) — 12 calendar months. Binds any pilot serving (not just PIC), not type-specific.",
  },
  {
    value: COMPETENCY_CHECK_REQUIREMENT,
    label: "Competency check",
    regCite:
      "135.293(b) — 12 calendar months. Binds any pilot serving. Keyed to CLASS (single-engine " +
      "airplane, other than turbojet) or TYPE (helicopter, multiengine airplane, turbojet " +
      "airplane, powered-lift) — one check per class/type you fly for this operator. " +
      "135.293(d): an IPC done in a given type may substitute for that type's competency check " +
      "— not applied automatically here; record whichever check you actually took.",
  },
  {
    value: IPC_REQUIREMENT,
    label: "Instrument proficiency check (IPC)",
    regCite:
      "135.297(a) — 6 calendar months, PIC-under-IFR only. 135.297(e): if you're assigned more " +
      "than one type for this operator, the check rotates through your types — one flight check " +
      "per 6-month period, not one per type per period. This product records each check by the " +
      "type it was flown in; only the type currently providing your live 6-month coverage is " +
      "weighed against the window below, and older type rows show as rotation history, " +
      "never as a lapse in their own right.",
  },
  {
    value: LINE_CHECK_REQUIREMENT,
    label: "Line check",
    regCite:
      "135.299(a) — 12 calendar months, PIC only. One flight check in any one type you fly for " +
      "this operator satisfies it for every type — the aircraft type below is an informational " +
      "record of which type it was flown in, not a separate requirement per type.",
  },
  {
    value: "drug_alcohol_program_120",
    label: "Drug & alcohol program",
    regCite:
      "120.105 (drug testing, Subpart E) & 120.215 (alcohol testing, Subpart F) — cover you " +
      "directly or by contract, including subcontract at any tier. The operator's program; " +
      "recorded as status only.",
  },
  {
    value: "prd_consent_111",
    label: "PRD (Pilot Records Database) consent",
    regCite:
      "111.310 (written consent) / 111.120 (pilot consent & right of review) — your consent for " +
      "the operator to pull your PRD records before using you as a pilot (111.105 is the " +
      "operator's separate duty to then evaluate what it pulled). Recorded as status only.",
  },
  { value: "insurance_approval", label: "Insurance approval", regCite: null },
  { value: "company_manuals", label: "Company manuals issued/current", regCite: null },
  { value: "other", label: "Other", regCite: null },
] as const;

export const OPERATOR_QUALIFICATION_LABEL: Record<string, string> = Object.fromEntries(
  OPERATOR_QUALIFICATION_REQUIREMENTS.map((r) => [r.value, r.label])
);

export const OPERATOR_QUALIFICATION_REG_CITE: Record<string, string | null> = Object.fromEntries(
  OPERATOR_QUALIFICATION_REQUIREMENTS.map((r) => [r.value, r.regCite])
);

/** The four requirements whose expires_on is DERIVED by the database
 * trigger (pilot.compute_operator_qualification_expiry) rather than
 * pilot-typed. The form disables the expiry field for these and
 * explains why instead of accepting input it would just overwrite. */
export const DERIVED_EXPIRY_REQUIREMENTS = new Set<string>([
  WRITTEN_TEST_REQUIREMENT,
  COMPETENCY_CHECK_REQUIREMENT,
  IPC_REQUIREMENT,
  LINE_CHECK_REQUIREMENT,
]);

/**
 * H-ipc-per-type fix (2026-08-10, corrected to select by expires_on and
 * mirrored at the source 2026-08-11): which of a client's ipc_135_297
 * rows is "the current IPC" for 297(a)/(e) purposes.
 *
 * 14 CFR 135.297(e), verbatim — eCFR title 14, versioner API (this
 * environment's fetcher reaches eCFR directly; there is no bot-detection
 * redirect and no mirror is needed):
 * https://www.ecfr.gov/api/versioner/v1/full/2026-08-10/title-14.xml?section=135.297,
 * retrieved live 2026-08-10: "If the pilot in command is assigned to
 * pilot more than one type of aircraft, that pilot must take the
 * instrument proficiency check required by paragraph (a) of this section
 * in each type of aircraft to which that pilot is assigned, in rotation,
 * but not more than one flight check during each period described in
 * paragraph (a) of this section." Paragraph (a)'s 6-calendar-month window
 * is not type-indexed — one check, in whichever type the rotation lands
 * on next, satisfies it. A pilot who legitimately rotates types therefore
 * has, at any moment, exactly one "live" row and zero or more older rows
 * whose own trigger-derived expires_on has already lapsed by design —
 * that lapse IS the rotation working as intended, not a compliance gap.
 *
 * Returns the id of the row with the latest expires_on (null if none of
 * the rows has one yet — a brand-new operator relationship with no IPC
 * recorded at all, or every row still uncompleted). Only that row may
 * ever render a red "expired" badge; every other row is rotation
 * history. This is a client-side judgment over rows the panel already
 * has loaded — it does not touch the trigger-derived expires_on stored
 * on any row (that arithmetic, and the 135.301(a) provision, stay
 * exactly where pilot.compute_operator_qualification_expiry() already
 * puts them; see that migration). It also does NOT determine that the
 * pilot's rotation across periods satisfies 297(e) — only that the
 * currently-live check is still inside 297(a)'s window — the panel copy
 * says so, and this stays a planning aid, never a compliance verdict.
 *
 * WHY expires_on, NOT completed_on: the value this function's caller
 * gates the red/gray badge on (operator-qualification-row.tsx's
 * isPastLocalDate) is expires_on, and 135.301(a)'s one-month grace makes
 * completed_on and expires_on non-monotonic across two rows — a check
 * completed EARLIER can still expire LATER if it lands in the grace
 * month adjacent to its own row's prior cycle. Concrete failure this
 * closed: row A (CE-560XL) had expires_on 2026-07-31; a new check
 * completed 2026-06-20 lands in the month immediately before that
 * required month, so 301(a) shifts it to expire 2027-01-31. Row B
 * (CE-680) checked 2026-06-25 — five days LATER — expires 2026-12-31
 * (no adjacent prior cycle to shift from). Picking "current" by
 * MAX(completed_on) would have picked row B and greyed out row A even
 * though row A is the one still providing live coverage on 2027-01-05 —
 * exactly the false-red H-ipc-per-type is about, reintroduced. See
 * supabase/migrations/20260811020000_ipc_rotation_expiry.sql, which
 * applies this identical expires_on-keyed rule at the source so
 * pilot.expirations (the dashboard's ladder) and this function never
 * disagree about which row is current.
 */
export function currentIpcRotationId(
  ipcRows: readonly { id: string; expires_on: string | null }[]
): string | null {
  let currentId: string | null = null;
  let latestExpiresOn = "";
  for (const row of ipcRows) {
    // "YYYY-MM-DD" strings compare correctly with plain `>` — same trick
    // isPastLocalDate (operator-qualification-row.tsx) relies on, for the
    // same reason: no Date parsing, no timezone to get wrong.
    if (row.expires_on && row.expires_on > latestExpiresOn) {
      latestExpiresOn = row.expires_on;
      currentId = row.id;
    }
  }
  return currentId;
}

/**
 * H-ipc-per-type, problem 6: copy shown on a TYPE_SPECIFIC_REQUIREMENTS
 * row whose rotationCurrent prop is false — i.e. a row that has its own
 * expires_on but isn't the one judged against the ladder because a
 * sibling row of the SAME requirement is more current right now. Keyed
 * by requirement, rather than hardcoded in operator-qualification-row.tsx,
 * so a row's non-current copy always cites the regulation that actually
 * produced its rotation, instead of inheriting whichever citation
 * happened to be written into the row component. Only ipc_135_297 has an
 * entry today — it's the only requirement with a rotation clause
 * (135.297(e)); competency_check_135_293b has none, so the panel never
 * passes rotationCurrent={false} for it and every one of its rows keeps
 * judging its own expires_on. If a future requirement ever needs this
 * treatment, its citation belongs here, next to the rest of this file's
 * reg vocabulary — not typed into the row component.
 */
export const ROTATION_HISTORY_COPY: Record<string, string> = {
  [IPC_REQUIREMENT]:
    "Rotation history, not a lapse — 135.297(e) allows one flight check per " +
    "6-month period across your assigned types; your most recently completed " +
    "check is the one judged against that window. Planning aid, not a " +
    "determination of regulatory compliance.",
};

export const STATUS_OPTIONS = [
  { value: "not_started", label: "Not started" },
  { value: "in_progress", label: "In progress" },
  { value: "current", label: "Current" },
  { value: "lapsed", label: "Lapsed" },
  { value: "n_a", label: "N/A for this operator" },
] as const;

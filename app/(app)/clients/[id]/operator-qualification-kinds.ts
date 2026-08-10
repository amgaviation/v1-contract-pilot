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
 *     history is at least visible). (H-ipc-per-type fix, 2026-08-10) A
 *     pilot rotating types exactly as 297(e) contemplates will always
 *     have every type EXCEPT the one most recently checked sitting past
 *     its OWN row's expires_on — that is what compliant rotation looks
 *     like, not a lapse, because 297(a)'s 6-calendar-month window binds
 *     the pilot under this operator, not any one type. currentIpcRotationId()
 *     below picks out whichever row has the latest completed_on across a
 *     client's ipc_135_297 rows; only that row is ever judged against the
 *     ladder, and every other row renders as rotation history with no red
 *     badge of its own. Still NOT a determination that the rotation
 *     itself satisfies 297(e) — only that the most recent check is inside
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
      "type it was flown in; only your most recently completed check (in whichever type) is " +
      "weighed against the 6-month window below, and older type rows show as rotation history, " +
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
 * H-ipc-per-type fix (2026-08-10): which of a client's ipc_135_297 rows
 * is "the current IPC" for 297(a)/(e) purposes.
 *
 * 14 CFR 135.297(e), verbatim (eCFR title 14, current text — verified via
 * the Cornell LII mirror 2026-08-10; eCFR's own site still returns a
 * bot-detection redirect to this environment's fetcher, the same block
 * the 20260807060000 migration header notes): "If the pilot in command
 * is assigned to pilot more than one type of aircraft, that pilot must
 * take the instrument proficiency check required by paragraph (a) of
 * this section in each type of aircraft to which that pilot is assigned,
 * in rotation, but not more than one flight check during each period
 * described in paragraph (a) of this section." Paragraph (a)'s
 * 6-calendar-month window is not type-indexed — one check, in whichever
 * type the rotation lands on next, satisfies it. A pilot who legitimately
 * rotates types therefore has, at any moment, exactly one "live" row
 * (the one most recently completed) and zero or more older rows whose
 * own trigger-derived expires_on has already lapsed by design — that
 * lapse IS the rotation working as intended, not a compliance gap.
 *
 * Returns the id of the row with the latest completed_on (null if none
 * of the rows has one yet — a brand-new operator relationship with no
 * IPC recorded at all). Only that row may ever render a red "expired"
 * badge; every other row is rotation history. This is a client-side
 * judgment over rows the panel already has loaded — it does not touch
 * the trigger-derived expires_on stored on any row (that arithmetic, and
 * the 135.301(a) provision, stay exactly where
 * pilot.compute_operator_qualification_expiry() already puts them; see
 * that migration). It also does NOT determine that the pilot's rotation
 * across periods satisfies 297(e) — only that the most recently
 * completed check is still inside 297(a)'s window — the panel copy says
 * so, and this stays a planning aid, never a compliance verdict.
 *
 * NOTE: pilot.expirations (the dashboard's Needs-attention union, joined
 * outside this fix's file allowlist in app/(app)/page.tsx) still unions
 * EVERY ipc_135_297 row's own expires_on independently, so it does not
 * yet get this correction — a rotating pilot can still see a stale
 * per-type row flagged there. Fixing that needs pilot.expirations itself
 * to union one row per (account_id, client_id) driven by
 * MAX(completed_on) across ipc_135_297 rows rather than one row per
 * qualification id; that is a migration, out of scope here.
 */
export function currentIpcRotationId(
  ipcRows: readonly { id: string; completed_on: string | null }[]
): string | null {
  let currentId: string | null = null;
  let latestCompletedOn = "";
  for (const row of ipcRows) {
    // "YYYY-MM-DD" strings compare correctly with plain `>` — same trick
    // isPastLocalDate (operator-qualification-row.tsx) relies on, for the
    // same reason: no Date parsing, no timezone to get wrong.
    if (row.completed_on && row.completed_on > latestCompletedOn) {
      latestCompletedOn = row.completed_on;
      currentId = row.id;
    }
  }
  return currentId;
}

export const STATUS_OPTIONS = [
  { value: "not_started", label: "Not started" },
  { value: "in_progress", label: "In progress" },
  { value: "current", label: "Current" },
  { value: "lapsed", label: "Lapsed" },
  { value: "n_a", label: "N/A for this operator" },
] as const;

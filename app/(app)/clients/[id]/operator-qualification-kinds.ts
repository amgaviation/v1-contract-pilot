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
 *     history is at least visible) but does NOT compute whether a
 *     pilot's rotation across periods satisfies 297(e) — that is a
 *     judgment call the copy states plainly rather than faking.
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
      "type it was flown in but does not compute whether your rotation satisfies 297(e).",
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

export const STATUS_OPTIONS = [
  { value: "not_started", label: "Not started" },
  { value: "in_progress", label: "In progress" },
  { value: "current", label: "Current" },
  { value: "lapsed", label: "Lapsed" },
  { value: "n_a", label: "N/A for this operator" },
] as const;

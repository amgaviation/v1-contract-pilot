/**
 * The requirement vocabulary, ported verbatim from the
 * pilot.operator_qualifications check constraint, plus the labels a
 * pilot sees. Order matches how a pilot would walk a new-operator
 * onboarding packet: indoc/training first, the three recurring Part 135
 * checks next, then the two operator-obligation status rows, then the
 * free-form paperwork rows.
 *
 * LINE_CHECK_REQUIREMENT is singled out because it is the one
 * type-specific requirement (135.299(a)) — the panel renders it as its
 * own repeatable-by-type sub-list rather than one fixed row, everything
 * else in OPERATOR_QUALIFICATION_REQUIREMENTS renders as a single fixed
 * row per client.
 */
export const LINE_CHECK_REQUIREMENT = "line_check_135_299" as const;

export const OPERATOR_QUALIFICATION_REQUIREMENTS = [
  { value: "basic_indoc", label: "Basic indoctrination", regCite: null },
  { value: "initial_training", label: "Initial training", regCite: null },
  { value: "recurrent_training", label: "Recurrent training", regCite: null },
  {
    value: "competency_check_135_293",
    label: "Competency check",
    regCite: "135.293(a)/(b) — 12 calendar months",
  },
  {
    value: "ipc_135_297",
    label: "Instrument proficiency check (IPC)",
    regCite: "135.297(a) — 6 calendar months",
  },
  {
    value: LINE_CHECK_REQUIREMENT,
    label: "Line check",
    regCite: "135.299(a) — 12 calendar months, type-specific",
  },
  {
    value: "drug_alcohol_program_120",
    label: "Drug & alcohol program",
    regCite: "120.105 — the operator's obligation, recorded as status only",
  },
  {
    value: "prd_consent_111",
    label: "PRD (Pilot Records Database) consent",
    regCite: "111.105 — the operator's obligation, recorded as status only",
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

/** The three checks whose expires_on is DERIVED by the database trigger
 * (pilot.compute_operator_qualification_expiry) rather than pilot-typed.
 * The form disables the expiry field for these and explains why instead
 * of accepting input it would just overwrite. */
export const DERIVED_EXPIRY_REQUIREMENTS = new Set<string>([
  "competency_check_135_293",
  "ipc_135_297",
  LINE_CHECK_REQUIREMENT,
]);

export const STATUS_OPTIONS = [
  { value: "not_started", label: "Not started" },
  { value: "in_progress", label: "In progress" },
  { value: "current", label: "Current" },
  { value: "lapsed", label: "Lapsed" },
  { value: "n_a", label: "N/A for this operator" },
] as const;

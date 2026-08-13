/**
 * The single vocabulary for the pilot certificate an airman holds.
 *
 * Extracted (20260812, rate-defaults work) from the two places that had
 * each grown their own copy — the onboarding wizard's action
 * (app/(onboarding)/onboarding/actions.ts, the server-side membership
 * check) and the wizard component's label list — so the Settings panel
 * that now edits the same column doesn't become a third. The database
 * CHECK on pilot.accounts.certificate_type (migration
 * 20260812400000_account_onboarding_profile.sql) lists the same six
 * values; tests/airman-certificates.test.mjs holds this module and that
 * CHECK in step, both directions.
 *
 * certificate_type is constrained to the pilot certificates issued under
 * 14 CFR 61.5(a)(1) — Student, Sport, Recreational, Private, Commercial,
 * Airline Transport Pilot. (Flight-instructor and ground-instructor
 * certificates under 61.5(a)(2)/(3) are separate credentials, not a pilot
 * certificate LEVEL, and belong in the credential wallet as documents, not
 * here.) Verify the current list against eCFR 14 CFR 61.5 before changing
 * it — and a change means a NEW migration altering the CHECK, since the
 * shipped one is immutable history.
 *
 * ORDER IS DELIBERATE: 61.5(a)(1)'s own order, least to most privileged,
 * which is also how the UI presents the list. Derive everything from this
 * tuple rather than sorting it.
 *
 * Kept dependency-free on purpose so `node --test` can import it directly
 * (tests run the real .ts source via the extensionless-TS loader).
 */
export const CERTIFICATE_TYPES = [
  "student",
  "sport",
  "recreational",
  "private",
  "commercial",
  "atp",
] as const;

export type CertificateType = (typeof CERTIFICATE_TYPES)[number];

/** Display names — "atp" would read as a database leak, not a credential. */
export const CERTIFICATE_LABELS: Record<CertificateType, string> = {
  student: "Student",
  sport: "Sport",
  recreational: "Recreational",
  private: "Private",
  commercial: "Commercial",
  atp: "Airline Transport Pilot (ATP)",
};

/**
 * The UI-only "prefer not to say" sentinel. Radix Select forbids an
 * empty-string item value, so forms carry this instead and translate it
 * back to "" (→ NULL) in the hidden input that actually posts — the
 * convention the onboarding wizard established (onboarding-wizard.tsx).
 */
export const NO_CERTIFICATE = "none";

/**
 * The option list a certificate Select renders: the declining-to-answer
 * row first, then the six real values in 61.5(a)(1) order.
 */
export const CERTIFICATE_OPTIONS: readonly { value: string; label: string }[] = [
  { value: NO_CERTIFICATE, label: "Prefer not to say" },
  ...CERTIFICATE_TYPES.map((value) => ({
    value,
    label: CERTIFICATE_LABELS[value],
  })),
];

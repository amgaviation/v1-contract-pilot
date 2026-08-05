/**
 * The kind vocabulary, ported verbatim from the `pilot.documents` check
 * constraint, plus the labels the pilot sees.
 *
 * Deliberately generic terminology: "certificate" not "license" (there is
 * no such thing as a pilot license in US airman terms), and no assumed
 * duration or cycle is asserted here — the pilot enters whatever date is
 * on their own paperwork. See document-form.tsx for why no expiration is
 * ever computed from an issue date.
 */
export const DOCUMENT_KINDS = [
  { value: "medical", label: "Medical certificate" },
  { value: "flight_review", label: "Flight review" },
  { value: "passport", label: "Passport" },
  { value: "certificate", label: "Certificate" },
  { value: "insurance", label: "Insurance" },
  { value: "w9", label: "W-9" },
  { value: "other", label: "Other" },
] as const;

export const DOCUMENT_KIND_LABEL: Record<string, string> = Object.fromEntries(
  DOCUMENT_KINDS.map((k) => [k.value, k.label])
);

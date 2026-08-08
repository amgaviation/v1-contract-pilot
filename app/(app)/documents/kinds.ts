/**
 * The kind vocabulary, ported verbatim from the `pilot.documents` check
 * constraint, plus the labels the pilot sees.
 *
 * Deliberately generic terminology: "certificate" not "license" (there is
 * no such thing as a pilot license in US airman terms), and no assumed
 * duration or cycle is asserted here — the pilot enters whatever date is
 * on their own paperwork. See document-form.tsx for why no expiration is
 * ever computed from an issue date.
 *
 * "certificate" (a certificate/rating itself) and "flight_review" (61.56)
 * are already here without any computed duration, because 61.23(d)'s
 * medical-duration table and 61.56(c)'s flight-review window both depend on
 * facts this product does not have (61.23: which privileges are being
 * exercised and the airman's age at exam — see docs/CURRENCY-SPEC.md §2.8;
 * 61.56: whether a proficiency check or practical test substituted under
 * 61.56(d)/(e) rather than an instructor-given review — see §2.7). Each
 * kind stays a pilot-typed date with no derived expiry, on the same
 * reasoning: a wrong computed date is worse than an honest blank one.
 *
 * pic_proficiency_check (14 CFR 61.58) follows the identical reasoning, not
 * a new one. 61.58(a) requires a PIC of an aircraft type certificated for
 * more than one required pilot flight crewmember, or of a turbojet
 * airplane, to complete a proficiency check within TWO different periods —
 * 12 calendar months in any qualifying aircraft, 24 calendar months in the
 * specific type — and 61.58(b) exempts a pilot operating under parts
 * 91K/121/125/133/135/137 outright (that operator's own training/check
 * program governs instead, mirroring 61.57(e)(3)/135.247's posture in
 * docs/CURRENCY-SPEC.md §2.5). It is genuinely distinct from
 * `pilot.operator_qualifications`: that table holds a Part 135 CERTIFICATE
 * HOLDER's own operator-keyed checks (135.293/.297/.299, keyed to a
 * client); 61.58 is a 61-series requirement that follows the PILOT and,
 * per (b), binds mainly the flying this product's users do OUTSIDE a
 * client's Part 135 certificate. It does NOT belong in that table. It
 * belongs here: same shape as flight_review (a completion/expiry date the
 * pilot typed themselves, nothing derived, no cross-credit asserted from
 * an operator_qualifications row — whether a specific 135 check also
 * satisfies 61.58 depends on how and by whom it was conducted, exactly the
 * question §2.4/§2.7 already decline to answer for the analogous 61.56/
 * 61.57(d) cases). Fetched 14 CFR 61.58, ecfr.gov versioner, issue date
 * 2026-08-05, 2026-08-07 — see supabase/migrations/
 * 20260807140000_approach_conditions.sql for the full reading and a note
 * on this fetch's quoting limits.
 */
export const DOCUMENT_KINDS = [
  { value: "medical", label: "Medical certificate" },
  { value: "flight_review", label: "Flight review" },
  { value: "pic_proficiency_check", label: "PIC proficiency check (61.58)" },
  { value: "passport", label: "Passport" },
  { value: "certificate", label: "Certificate" },
  { value: "insurance", label: "Insurance" },
  { value: "w9", label: "W-9" },
  { value: "other", label: "Other" },
] as const;

export const DOCUMENT_KIND_LABEL: Record<string, string> = Object.fromEntries(
  DOCUMENT_KINDS.map((k) => [k.value, k.label])
);

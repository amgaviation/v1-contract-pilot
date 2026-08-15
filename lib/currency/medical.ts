/**
 * 61.23 medical -> currency_type "medical". Not computed, deliberately.
 *
 * https://www.ecfr.gov/current/title-14/section-61.23, fetched issue date
 * 2026-08-05, retrieved 2026-08-07/2026-08-10. 61.23(d)'s duration table
 * keys on THREE axes at once — class held, age on the date of
 * examination, and which operation is being conducted — and says a
 * certificate "expires, for that operation, at the end of the last day of
 * the...": expiry is a property of the (certificate, operation) pair, not
 * of the certificate alone. A first-class certificate issued to a
 * 45-year-old is simultaneously valid 6 months for ATP PIC privileges, 12
 * for commercial, and 24 for private — all true at once, of one piece of
 * paper.
 *
 * UNCONDITIONALLY returns insufficient_data. There is no branch in this
 * function that can return either other status — the product has no
 * flight-in-question, no certificate record, and no age-at-exam, so a
 * single displayed date would be correct for one reading and silently
 * wrong for the other two, in the permissive direction for a pilot who
 * read the private row and flew a charter. Fixture M-3 must prove this by
 * handing this function class + age + exam date and still getting
 * insufficient_data.
 */
import type { CurrencyResult, IsoDate } from "./types";

export function evaluateMedical(input: { pilotEnteredExpiresOn: IsoDate | null }): CurrencyResult {
  return {
    currencyType: "medical",
    ruleBasis: "61.23",
    status: "insufficient_data",
    window: null,
    required: {},
    observed: {},
    counted: [],
    limitingDate: null,
    throughDate: null,
    displayDate: input.pilotEnteredExpiresOn,
    missing: ["medical_never_computed"],
    notes: [
      "One medical certificate can carry different expiry dates for different privileges under 61.23(d). The date shown is the one you entered, not a computed value.",
    ],
    assumptions: [],
  };
}

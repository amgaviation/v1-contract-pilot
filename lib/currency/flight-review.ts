/**
 * 61.56 flight review -> currency_type "flight_review".
 *
 * https://www.ecfr.gov/current/title-14/section-61.56, fetched issue date
 * 2026-08-05, retrieved 2026-08-07/2026-08-10. "no person may act as
 * pilot in command of an aircraft unless, since the beginning of the 24th
 * calendar month before the month in which that pilot acts as pilot in
 * command," a flight review (or a substitute under (d)/(e)) was
 * accomplished.
 *
 * The one currency type with no interpretive content — the window is
 * stated explicitly and the arithmetic is unambiguous — which is exactly
 * why this is computed from a completion date rather than left as a
 * pilot-typed expires_on the way a document normally is (see
 * pilot.documents.completed_on's column comment in the migration this
 * phase adds). Precedent: pilot.compute_operator_qualification_expiry()
 * already derives 135.293/.297/.299 through-dates from a completed_on
 * column without incident (20260807110000_operator_qualification_reg_
 * corrections.sql) — displaying a 61.56 through-date is the same act on a
 * different reg.
 */
import { calendarMonthLookback, calendarMonthThroughDate } from "./window";
import type { CurrencyResult, IsoDate } from "./types";

const MONTHS_AHEAD = 24; // "since the beginning of the 24th calendar month before..."
const LOOKBACK_MONTHS = 24; // The window-start form of the same arithmetic — see window.ts §3.

export function evaluateFlightReview(input: { asOf: IsoDate; completedOn: IsoDate | null }): CurrencyResult {
  const { asOf, completedOn } = input;

  if (completedOn === null) {
    return {
      currencyType: "flight_review",
      ruleBasis: "61.56",
      status: "insufficient_data",
      window: null,
      required: {},
      observed: {},
      counted: [],
      limitingDate: null,
      throughDate: null,
      displayDate: null,
      missing: ["flight_review_completion_absent"],
      notes: [],
      assumptions: [],
    };
  }

  if (completedOn > asOf) {
    // A review not yet given cannot establish currency — docs/CURRENCY-SPEC.md
    // §11 defect #4 records that a pilot-typed date can be arithmetically
    // impossible; this is the same failure caught before it produces a
    // nonsense through-date.
    return {
      currencyType: "flight_review",
      ruleBasis: "61.56",
      status: "insufficient_data",
      window: null,
      required: {},
      observed: {},
      counted: [],
      limitingDate: null,
      throughDate: null,
      displayDate: completedOn,
      missing: ["flight_review_completion_in_future"],
      notes: [],
      assumptions: [],
    };
  }

  const throughDate = calendarMonthThroughDate(completedOn, MONTHS_AHEAD);
  const window = calendarMonthLookback(asOf, LOOKBACK_MONTHS);
  const status = throughDate >= asOf ? "estimated_current" : "estimated_not_current";

  // INVARIANT ASSERTED BY THE FIXTURES, NOT BY A RUNTIME THROW:
  // (completedOn >= window.start) === (throughDate >= asOf). Both forms
  // are computed on every call precisely so the two can be cross-checked
  // — see tests/currency.test.mjs and window.ts §3's worked example 2.

  const notes: string[] = [];
  if (status === "estimated_not_current") {
    // 61.56(d)/(e) never a bare negative — a proficiency check, practical
    // test, or FAA-sponsored proficiency program phase may substitute,
    // and this engine cannot decide whether one did.
    notes.push(
      "A proficiency check or practical test within the same period may substitute for a flight review under 61.56(d) — record its date here if it did."
    );
  }

  return {
    currencyType: "flight_review",
    ruleBasis: "61.56",
    status,
    window,
    required: {},
    observed: {},
    counted: [],
    limitingDate: completedOn,
    throughDate,
    displayDate: null,
    missing: [],
    notes,
    assumptions: [],
  };
}

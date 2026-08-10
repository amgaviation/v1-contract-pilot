/**
 * Date arithmetic for the currency engine. Every boundary is named and
 * cited; docs/CURRENCY-SPEC.md §3 works the two calendar-month examples
 * this module is ported from.
 *
 * Dates in and out are ISO "YYYY-MM-DD" strings. Internally this module
 * parses to a UTC `Date` (via lib/format.ts's parseCalendarDate — the
 * repo's one parser, not a second one) and formats back to ISO; it never
 * hands a `Date` object back across its own boundary.
 */
import { parseCalendarDate } from "@/lib/format";
import type { DateWindow, IsoDate } from "./types";

function requireDate(iso: IsoDate, label: string): Date {
  const d = parseCalendarDate(iso);
  if (!d) {
    throw new Error(`lib/currency/window.ts: ${label} is not a well-formed ISO date: "${iso}"`);
  }
  return d;
}

function toIso(d: Date): IsoDate {
  const y = String(d.getUTCFullYear()).padStart(4, "0");
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * True only for a string that is both shaped like an ISO calendar date and
 * names a real one — "2026-02-30" is the right shape and not a real date.
 * Round-trips through parseCalendarDate/toIso rather than trusting the
 * regex alone, because `Date.UTC` silently rolls an out-of-range day
 * forward into the next month instead of rejecting it.
 */
export function isWellFormedIsoDate(value: string): value is IsoDate {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = parseCalendarDate(value);
  if (!d) return false;
  return toIso(d) === value;
}

export function addDays(date: IsoDate, days: number): IsoDate {
  const d = requireDate(date, "date");
  d.setUTCDate(d.getUTCDate() + days);
  return toIso(d);
}

export function startOfMonth(date: IsoDate): IsoDate {
  const d = requireDate(date, "date");
  return toIso(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)));
}

/**
 * Adds calendar months, END-OF-MONTH CLAMPED: 2026-08-31 + (-6) months is
 * 2026-02-28, and 2028-08-31 + (-6) is 2028-02-29 (2028 is a leap year).
 * Every calendar-month caller in this file passes a month START into this
 * function (day 1 never needs clamping), so the clamp only ever fires for
 * rollingMonthWindow, which passes `asOf` (a day-of-month that can be the
 * 29th, 30th, or 31st) directly.
 */
export function addMonths(date: IsoDate, months: number): IsoDate {
  const d = requireDate(date, "date");
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth(); // 0-based
  const day = d.getUTCDate();

  const total = m + months;
  const newYear = y + Math.floor(total / 12);
  const newMonth = ((total % 12) + 12) % 12; // 0-based, always in [0, 11]

  // Date.UTC(newYear, newMonth + 1, 0) is day 0 of the month AFTER
  // newMonth, i.e. the last day of newMonth itself — the standard JS
  // idiom for "how many days are in this month."
  const lastDayOfNewMonth = new Date(Date.UTC(newYear, newMonth + 1, 0)).getUTCDate();
  const newDay = Math.min(day, lastDayOfNewMonth);

  return toIso(new Date(Date.UTC(newYear, newMonth, newDay)));
}

export function endOfMonth(date: IsoDate): IsoDate {
  const d = requireDate(date, "date");
  return toIso(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)));
}

/** `date >= w.start && date <= w.end` — lexical, both ends inclusive. Exact for zero-padded ISO; never drifts with a timezone. */
export function withinInclusive(date: IsoDate, w: DateWindow): boolean {
  return date >= w.start && date <= w.end;
}

/**
 * BOUNDARY RULE, 61.57(a), 61.57(b), 135.247(a), 61.57(e)(4)(C):
 *   start = addDays(asOf, -(days - 1)), end = asOf. Both inclusive.
 * "within the preceding 90 days" = the flight date and the 89 dates before
 * it, 90 dates in total. For asOf 2026-08-07 that is 2026-05-10..
 * 2026-08-07 — the conservative of the two available readings
 * (docs/CURRENCY-SPEC.md §2.1: ambiguity resolves against permissiveness).
 * A landing on 2026-05-09 does NOT count. THIS IS A STATED CHOICE, NOT A
 * DERIVATION; the card should say so when a pilot's only qualifying
 * landing sits on the boundary.
 *
 * NEVER date_trunc here. These are day counts, not calendar months —
 * see calendarMonthLookback below for why that distinction is load-bearing.
 */
export function rollingDayWindow(asOf: IsoDate, days: number): DateWindow {
  return { start: addDays(asOf, -(days - 1)), end: asOf };
}

/**
 * BOUNDARY RULE, 61.57(c) with months = 6:
 *   start = addMonths(startOfMonth(asOf), -months), end = asOf. Both inclusive.
 * "within the 6 calendar months preceding the month of the flight" anchors
 * on the MONTH of the flight, not the day. asOf 2026-08-07 ->
 * 2026-02-01..2026-08-07. 2026-02-01 qualifies by one day; 2026-01-31 does
 * not (docs/CURRENCY-SPEC.md §3, worked example 1).
 *
 * A 180-day implementation gives 2026-02-08 and silently deletes 01-07 FEB.
 * A plain `asOf - 6 months` gives 2026-02-07 and deletes six days. Both
 * wrong the same way: the reg anchors on the month, not the day.
 */
export function calendarMonthLookback(asOf: IsoDate, months: number): DateWindow {
  return { start: addMonths(startOfMonth(asOf), -months), end: asOf };
}

/**
 * BOUNDARY RULE, 61.56 with monthsAhead = 24:
 *   addDays(addMonths(startOfMonth(completedOn), monthsAhead + 1), -1)
 * Port of pilot.compute_operator_qualification_expiry()'s base arithmetic
 * (supabase/migrations/20260807110000_operator_qualification_reg_corrections.sql,
 * STEP 5) — N+1 months minus a day, NOT N: it counts forward from the
 * event's month to the END of the Nth month after it. Any day in AUG 2024
 * -> 2026-08-31 (docs/CURRENCY-SPEC.md §3, worked example 2).
 *
 * PORTS THE BASE ARITHMETIC ONLY. The SQL function also applies the
 * 135.301(a) early/late grace, gated on the owning client's operating
 * rule. 135.301(a) is textually limited to Part 135 checks
 * ("a crewmember who is required to take a test or a flight check under
 * this part [135]") and must never reach 61.56 or 61.57 — see
 * docs/CURRENCY-SPEC.md §3's own warning not to borrow it across.
 */
export function calendarMonthThroughDate(completedOn: IsoDate, monthsAhead: number): IsoDate {
  return addDays(addMonths(startOfMonth(completedOn), monthsAhead + 1), -1);
}

/**
 * BOUNDARY RULE, 61.57(e)(4)(i)(D)/(ii)(D) and 135.247(a)(3)(i)(D)/(ii)(D):
 *   start = addMonths(asOf, -months), end = asOf. Both inclusive, clamped
 *   (see addMonths).
 * "within the preceding 6 [12] months prior to the month of the flight" is
 * textually ambiguous between this rolling reading and a calendar-month
 * one; this is the SHORTER reading, chosen because ambiguity resolves
 * against permissiveness (docs/CURRENCY-SPEC.md §2.6, point 4, and the
 * regulatory-findings note that the calendar reading is the better-
 * supported one — the conservative choice is made anyway and disclosed,
 * not asserted as neutral).
 *
 * Not used by any module this phase builds — 61.57(e)(4) and
 * 135.247(a)(3) are specified in docs/CURRENCY-SPEC.md §2.6 but not built
 * in Phase 7 (owner question O-5). Exported now so the one arithmetic
 * function both future branches will share already exists and cannot
 * drift into two.
 */
export function rollingMonthWindow(asOf: IsoDate, months: number): DateWindow {
  return { start: addMonths(asOf, -months), end: asOf };
}

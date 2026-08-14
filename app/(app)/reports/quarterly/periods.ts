/**
 * IRS estimated-tax periods for individuals, per Form 1040-ES.
 *
 * These are NOT calendar quarters. Period 2 is two months (Apr–May) and
 * period 3 is three (Jun–Aug) — that asymmetry is real, not a typo, and is
 * the entire reason this file exists instead of a generic "group by
 * calendar quarter" helper. Getting this wrong is the one way this screen
 * could actively mislead a pilot rather than merely fail to help.
 *
 * SOURCE: IRS Form 1040-ES, "2026 Payment Voucher" / "Payment Period"
 * table (irs.gov/pub/irs-pdf/f1040es.pdf), cross-checked against
 * irs.gov/faqs/estimated-tax/individuals/individuals, both fetched
 * 2026-08-07:
 *
 *   Period 1: Jan. 1 – Mar. 31   → due Apr. 15 (same year)
 *   Period 2: Apr. 1 – May 31    → due Jun. 15 (same year)
 *   Period 3: Jun. 1 – Aug. 31   → due Sep. 15 (same year)
 *   Period 4: Sep. 1 – Dec. 31   → due Jan. 15 (following year)
 *
 * DUE DATES SHOWN ARE STATUTORY, NOT ADJUSTED. When a due date falls on a
 * Saturday, Sunday, or legal holiday, the IRS moves the deadline to the
 * next business day. This file deliberately does NOT attempt that shift —
 * doing so correctly requires a federal legal-holiday calendar (including
 * DC-observed holidays, which differ from bank holidays) that this product
 * does not have and has no reliable source for. Computing a wrong "moved"
 * date would be worse than showing the statutory one plainly labelled, so
 * the UI carries a fixed line of copy instead (see page.tsx) telling the
 * pilot to confirm the current year's exact date with the IRS or their
 * accountant. Do not "fix" this by hand-adding a holiday table.
 *
 * Bounds are plain "YYYY-MM-DD" strings, same discipline as
 * app/(app)/reports/year-end/db.ts's yearBounds — compared directly
 * against Postgres `date` columns, no JS Date, no timezone conversion.
 */

export type EstimatedTaxPeriod = {
  /** 1-4, matches the Form 1040-ES voucher number. */
  number: 1 | 2 | 3 | 4;
  label: string;
  /** Human-readable coverage, e.g. "Jan 1 – Mar 31". */
  covers: string;
  start: string;
  end: string;
  /** Statutory due date, "YYYY-MM-DD" — see file header re: weekend/holiday shift. */
  dueDate: string;
  /** Just for display: "April 15, 2026". */
  dueDateLabel: string;
};

const MONTH_LABEL = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

const FULL_MONTH_LABEL = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function isoDate(year: number, month: number, day: number): string {
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

function dueDateLabel(year: number, month: number, day: number): string {
  return `${FULL_MONTH_LABEL[month - 1]} ${day}, ${year}`;
}

/**
 * The four estimated-tax periods for a given calendar tax year. Period 4's
 * due date falls in `year + 1` — that's correct, not a bug, and is why
 * `dueDate`/`dueDateLabel` compute their own year per period rather than
 * inheriting `year` uniformly.
 */
export function estimatedTaxPeriods(year: number): EstimatedTaxPeriod[] {
  return [
    {
      number: 1,
      label: "Period 1",
      covers: `${MONTH_LABEL[0]} 1 to ${MONTH_LABEL[2]} 31`,
      start: isoDate(year, 1, 1),
      end: isoDate(year, 3, 31),
      dueDate: isoDate(year, 4, 15),
      dueDateLabel: dueDateLabel(year, 4, 15),
    },
    {
      number: 2,
      label: "Period 2",
      covers: `${MONTH_LABEL[3]} 1 to ${MONTH_LABEL[4]} 31`,
      start: isoDate(year, 4, 1),
      end: isoDate(year, 5, 31),
      dueDate: isoDate(year, 6, 15),
      dueDateLabel: dueDateLabel(year, 6, 15),
    },
    {
      number: 3,
      label: "Period 3",
      covers: `${MONTH_LABEL[5]} 1 to ${MONTH_LABEL[7]} 31`,
      start: isoDate(year, 6, 1),
      end: isoDate(year, 8, 31),
      dueDate: isoDate(year, 9, 15),
      dueDateLabel: dueDateLabel(year, 9, 15),
    },
    {
      number: 4,
      label: "Period 4",
      covers: `${MONTH_LABEL[8]} 1 to ${MONTH_LABEL[11]} 31`,
      start: isoDate(year, 9, 1),
      end: isoDate(year, 12, 31),
      // Due January 15 of the FOLLOWING year — deliberate, per the IRS
      // table in this file's header comment.
      dueDate: isoDate(year + 1, 1, 15),
      dueDateLabel: dueDateLabel(year + 1, 1, 15),
    },
  ];
}

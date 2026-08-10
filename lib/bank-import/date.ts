/**
 * The one calendar-date validator both bank-statement parsers use.
 *
 * WHY THIS FILE EXISTS (extracted after review). The CSV path already
 * validated dates arithmetically — "2026-02-30" was rejected by name. The
 * OFX path did not: it string-sliced `DTPOSTED` with
 * `/^(\d{4})(\d{2})(\d{2})/` and handed the pieces on as a date, so
 * `20260231` became the string "2026-02-31" and travelled all the way to
 * the server before the database refused it. Two things made that worse
 * than a plain missing check:
 *
 *   - the preview LAUNDERED it. The renderer builds a Date from the parts,
 *     and Date rolls over, so the pilot saw a confident "Mar 3, 2026" for a
 *     date that does not exist. `2026-13-99` rendered as "Apr 9, 2027".
 *   - the eventual failure named no row. The whole import aborted with
 *     "Couldn't complete that import. Nothing was added" and the row number
 *     went to `console.error`, where no pilot will ever see it.
 *
 * Two parsers with two different opinions about what a date is, one of
 * which was wrong, is exactly the drift a shared module prevents. The rule
 * lives here once; `parseStatementDate` and `parseOfxDate` differ only in
 * which surface syntaxes they accept, never in what a valid calendar date
 * is.
 *
 * A date here is a CALENDAR FACT, not an instant — the same rule lib/
 * format.ts states. Nothing in this file constructs a Date object, because
 * Date is precisely the thing that would silently roll February 31st over
 * into March.
 */

/** Days in each month, leap-aware. The whole of the arithmetic validation. */
function isValidYmd(y: number, m: number, d: number): boolean {
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return false;
  if (m < 1 || m > 12) return false;
  const isLeap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  const daysInMonth = [31, isLeap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const maxDay = daysInMonth[m - 1] ?? 31;
  if (d < 1 || d > maxDay) return false;
  // A bank statement outside this window is a parse error, not a date.
  if (y < 1900 || y > 2100) return false;
  return true;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** Formats an already-validated y/m/d as the ISO calendar string. */
function iso(y: number, m: number, d: number): string {
  return `${y}-${pad(m)}-${pad(d)}`;
}

/**
 * CSV statement dates: "YYYY-MM-DD", "M/D/YYYY", or "MM-DD-YYYY".
 * (Bank CSV exports use all three; the dashed US form is why this is not
 * shared with lib/logbook-import/fields.ts's near-identical parser.)
 */
export function parseStatementDate(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;

  const isoMatch = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(value);
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value);
  const usDash = /^(\d{1,2})-(\d{1,2})-(\d{4})$/.exec(value);

  let y: number, m: number, d: number;
  if (isoMatch) {
    y = Number(isoMatch[1]);
    m = Number(isoMatch[2]);
    d = Number(isoMatch[3]);
  } else if (us) {
    m = Number(us[1]);
    d = Number(us[2]);
    y = Number(us[3]);
  } else if (usDash) {
    m = Number(usDash[1]);
    d = Number(usDash[2]);
    y = Number(usDash[3]);
  } else {
    return null;
  }

  return isValidYmd(y, m, d) ? iso(y, m, d) : null;
}

/**
 * OFX `DTPOSTED`, which is `YYYYMMDD` optionally followed by `HHMMSS` and
 * an optional bracketed timezone — e.g. `20260315`, `20260315120000`, or
 * `20260315120000.000[-5:EST]`. Only the calendar date is kept: a posted
 * date is the day the bank booked the transaction, and this product stores
 * it in a `date` column.
 *
 * Returns null for a syntactically-fine-but-impossible date, which is the
 * whole reason this function exists rather than a bare regex slice.
 */
export function parseOfxDate(raw: string): string | null {
  const value = raw.trim();
  const match = /^(\d{4})(\d{2})(\d{2})/.exec(value);
  if (!match) return null;
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  return isValidYmd(y, m, d) ? iso(y, m, d) : null;
}

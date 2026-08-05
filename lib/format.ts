/**
 * Money and date formatting for tenant-facing screens.
 *
 * Every monetary column in the `pilot` schema is `bigint` cents, never a
 * float — a day rate of $3,500 is 350000. These helpers are the only
 * place that boundary is crossed, so rounding happens once, in a way that
 * can be reasoned about, rather than in each form.
 */

const USD = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatCents(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return "—";
  return USD.format(cents / 100);
}

/**
 * Cents → the plain decimal string a number input should show ("350000"
 * → "3500.00"). Deliberately not currency-formatted: a `$` or thousands
 * separator in an `<input type="number">` value makes it invalid and the
 * field renders empty.
 */
export function centsToInput(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return "";
  return (cents / 100).toFixed(2);
}

/**
 * A dollars string from a form → integer cents, or null for blank.
 *
 * WHY NOT `Math.round(parseFloat(v) * 100)`: binary floating point makes
 * that wrong for values a pilot will actually type. `8.15 * 100` is
 * 814.9999999999999, and while Math.round rescues that case it does not
 * rescue every one — the errors are not uniformly distributed and the
 * failures are silent and off by a cent. Splitting on the decimal point
 * and doing integer arithmetic on the two halves is exact for every input
 * within the bound enforced below.
 *
 * THE BOUND IS LOAD-BEARING, not defensive dressing. `Number(whole) * 100`
 * is only exact while the result stays under Number.MAX_SAFE_INTEGER, so
 * without a length limit "99999999999999999.99" would parse to a value
 * that is both silently wrong and outside bigint range. Twelve digits caps
 * a single amount just under $10 billion, which is not a day rate anyone
 * will type by accident.
 *
 * Returns `undefined` for input that isn't a number at all, which the
 * caller must distinguish from `null` (a legitimately empty optional
 * field) — conflating them would turn a typo into a silent zero.
 */
const MAX_WHOLE_DIGITS = 12;

export function parseDollarsToCents(
  raw: string
): number | null | undefined {
  const value = raw.trim().replace(/[$,]/g, "");
  if (value === "") return null;
  if (!/^-?\d*(\.\d{0,2})?$/.test(value) || value === "." || value === "-") {
    return undefined;
  }
  const wholePart = value.replace("-", "").split(".")[0] ?? "";
  if (wholePart.length > MAX_WHOLE_DIGITS) {
    return undefined;
  }

  const negative = value.startsWith("-");
  const [whole, fraction = ""] = value.replace("-", "").split(".");
  const cents =
    Number(whole || "0") * 100 + Number(fraction.padEnd(2, "0") || "0");
  return negative ? -cents : cents;
}

/**
 * A quantity destined for a `numeric(p,1)` column — day counts and the
 * hour fields on a leg.
 *
 * WHY THE ONE-DECIMAL CHECK IS DONE HERE rather than left to Postgres:
 * `numeric(5,1)` does not reject 2.25, it silently ROUNDS it to 2.3. A
 * pilot who submits 2.25 days at $1,500 gets billed $3,450 instead of the
 * $3,375 they entered, with no error anywhere. The browser's `step` blocks
 * that in a browser, but a server action is a public POST endpoint and
 * cannot rely on it. Out-of-range values are rejected for the same
 * reason — an overflow surfaces as a raw Postgres message otherwise.
 *
 * Returns `undefined` for anything invalid, `null` only when `allowBlank`
 * and the field was empty.
 */
export function parseTenth(
  raw: string,
  { max, allowBlank = false }: { max: number; allowBlank?: boolean }
): number | null | undefined {
  const value = raw.trim();
  if (value === "") return allowBlank ? null : 0;
  if (!/^\d{1,5}(\.\d)?$/.test(value)) return undefined;

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > max) return undefined;
  return parsed;
}

/**
 * A `date` column (always "YYYY-MM-DD" from PostgREST) rendered for
 * display. Parsed as UTC on purpose: `new Date("2026-08-05")` is already
 * UTC midnight, but a viewer west of Greenwich formatting that in local
 * time sees August 4th. A trip date is a calendar fact, not an instant,
 * so it must not shift with the reader's timezone.
 */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return "—";
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(y, m - 1, d)));
}

export function formatDateRange(
  start: string | null | undefined,
  end: string | null | undefined
): string {
  if (!start && !end) return "—";
  if (!end || start === end) return formatDate(start);
  return `${formatDate(start)} – ${formatDate(end)}`;
}

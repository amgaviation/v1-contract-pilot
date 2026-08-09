/**
 * Bank-statement decimal amount parsing. Deliberately NOT `parseFloat` —
 * binary floating point makes cent-accurate money math unsafe (see
 * lib/format.ts's parseDollarsToCents for the same reasoning applied to
 * form input) and, unlike a form field, a bank export also throws real
 * formatting variety at this: thousands separators, parenthesized
 * negatives, and a trailing CR/DR sign marker instead of a leading -/+.
 *
 * FORMATS HANDLED, deliberately and by name:
 *   "1234.56"      plain
 *   "1,234.56"     thousands separator
 *   "-45.00"       leading minus
 *   "+45.00"       leading plus (rare, some banks emit it for credits)
 *   "(45.00)"      parens = negative, the accounting convention
 *   "45.00 CR"     trailing CR = credit = positive (money in)
 *   "45.00 DR"     trailing DR = debit = negative (money out)
 *   "$45.00"       leading currency symbol
 *
 * NOT handled, deliberately, rather than guessed at:
 *   - any currency other than USD (this product has no multi-currency
 *     support anywhere else in the schema either — amount_cents is bigint
 *     cents, unitless, same as pilot.expenses.amount_cents)
 *   - a value with more than 2 decimal places (sub-cent bank data is not
 *     a real thing this product needs to represent; rejected rather than
 *     silently rounded, matching lib/format.ts's parseTenth philosophy of
 *     never silently rounding away precision the source file specified)
 *
 * Returns the parsed amount as **cents, in the sign the raw text itself
 * encodes** (CR/DR and parens already resolved to a sign here) — the
 * CALLER (apply-mapping.ts) is responsible for the canonical
 * expense-vs-deposit flip for credit_card accounts; this function only
 * ever reports what the source text said.
 *
 * Returns `undefined` for anything that isn't recognizably a bank amount.
 */
const MAX_WHOLE_DIGITS = 12;

export function parseBankAmount(raw: string): number | undefined {
  let value = raw.trim();
  if (value === "") return undefined;

  let negative = false;

  const crMatch = /^(.*?)\s*(CR|DR)$/i.exec(value);
  if (crMatch) {
    value = crMatch[1]!.trim();
    if (crMatch[2]!.toUpperCase() === "DR") negative = true;
  }

  if (value.startsWith("(") && value.endsWith(")")) {
    negative = true;
    value = value.slice(1, -1).trim();
  }

  value = value.replace(/^\$/, "").trim();
  value = value.replace(/,/g, "");

  if (value.startsWith("-")) {
    negative = !negative; // a "(...)"+"-" or "DR"+"-" combo is not real bank output, but toggling rather than ignoring keeps this total, not partial
    value = value.slice(1);
  } else if (value.startsWith("+")) {
    value = value.slice(1);
  }

  if (!/^\d+(\.\d{1,2})?$/.test(value)) return undefined;

  const [whole, fraction = ""] = value.split(".");
  if ((whole ?? "").length > MAX_WHOLE_DIGITS) return undefined;

  const cents = Number(whole || "0") * 100 + Number(fraction.padEnd(2, "0") || "0");
  if (!Number.isFinite(cents)) return undefined;
  return negative ? -cents : cents;
}

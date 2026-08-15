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
 * ---------------------------------------------------------------------------
 * THE COMMA (fixed after review — this was a 100x money bug)
 * ---------------------------------------------------------------------------
 * This function used to do `value.replace(/,/g, "")` — strip every comma as
 * a thousands separator, unconditionally. That is right for "1,234.56" and
 * catastrophically wrong for "540,32", which became 5403200 cents:
 * **$54,032.00 for a $540.32 charge**, with no error, no warning, and no
 * downstream guard (the server ceiling sits five orders of magnitude above,
 * and the only database CHECK on the column is `amount_cents <> 0`).
 *
 * A comma means different things in different files, and this function
 * cannot always tell which:
 *   - "1,234.56"  both separators -> the LAST one is the decimal. Unambiguous.
 *   - "1.234,56"  both separators -> likewise: comma is the decimal.
 *   - "1,234"     comma + exactly 3 digits -> thousands. (Read as a decimal
 *                 it would be 3 decimal places, which this function rejects
 *                 anyway, so there is no reading where it means 1.234.)
 *   - "540,32"    comma + 1-2 trailing digits -> GENUINELY AMBIGUOUS in a
 *                 CSV. No US bank writes this; a European one means $540.32.
 *
 * So the ambiguous case is resolved by the CALLER, not guessed at here:
 *
 *   OFX/QFX -> `commaMeaning: "decimal"`. Not a guess: OFX 2.0.2 §3.2.9.2
 *   requires an amount to "include a decimal point or comma to indicate the
 *   start of the fractional amount" and says it "should not include any
 *   punctuation separating thousands". In OFX a comma IS a decimal point,
 *   and the thousands reading is forbidden outright.
 *
 *   CSV -> `commaMeaning: "ambiguous"` (the default). The 1-2 digit case is
 *   REJECTED BY NAME rather than guessed, so the pilot is told the file
 *   wasn't understood instead of being handed a number 100x too large. That
 *   matches this file's own stated philosophy two paragraphs up: sub-cent
 *   precision is rejected rather than silently altered. Silently inflating
 *   a charge is a worse sin than refusing to read it.
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

export type CommaMeaning = "decimal" | "ambiguous";

/**
 * Resolves separators to a single canonical "digits[.digits]" string, or
 * undefined when the grouping is malformed or the comma is ambiguous.
 * Split out from parseBankAmount so the sign handling and the separator
 * handling can each be read on their own.
 */
function normalizeSeparators(value: string, commaMeaning: CommaMeaning): string | undefined {
  const hasComma = value.includes(",");
  const hasDot = value.includes(".");

  if (!hasComma) return value;

  if (hasDot) {
    // Both present: whichever appears LAST is the decimal separator, and
    // the other is grouping. "1,234.56" and "1.234,56" both resolve here.
    const lastComma = value.lastIndexOf(",");
    const lastDot = value.lastIndexOf(".");
    const decimalSep = lastComma > lastDot ? "," : ".";
    const groupSep = decimalSep === "," ? "." : ",";
    // A decimal separator may appear only once; a repeat means this is not
    // a number we understand rather than one to guess at.
    if (value.split(decimalSep).length !== 2) return undefined;
    const [wholePart, fractionPart] = value.split(decimalSep);
    if (!isValidGrouping(wholePart ?? "", groupSep)) return undefined;
    return `${(wholePart ?? "").split(groupSep).join("")}.${fractionPart ?? ""}`;
  }

  // Comma only.
  const parts = value.split(",");
  const last = parts[parts.length - 1] ?? "";

  // Every group after the first being exactly 3 digits is the thousands
  // shape ("1,234", "1,234,567"). Read as a decimal it would be 3 decimal
  // places, which this function rejects regardless — so there is no
  // competing reading to lose here.
  if (parts.length >= 2 && parts.slice(1).every((p) => /^\d{3}$/.test(p)) && /^\d{1,3}$/.test(parts[0] ?? "")) {
    return parts.join("");
  }

  // One comma with 1-2 trailing digits: a decimal separator in every
  // locale that writes it this way.
  if (parts.length === 2 && /^\d{1,2}$/.test(last) && /^\d+$/.test(parts[0] ?? "")) {
    if (commaMeaning === "decimal") return `${parts[0]}.${last}`;
    return undefined; // ambiguous in a CSV — the caller rejects it by name
  }

  return undefined;
}

/** "1", "1234" (no separators) or "1,234,567" — never "12,34,567". */
function isValidGrouping(whole: string, groupSep: string): boolean {
  if (!whole.includes(groupSep)) return /^\d*$/.test(whole);
  const groups = whole.split(groupSep);
  if (!/^\d{1,3}$/.test(groups[0] ?? "")) return false;
  return groups.slice(1).every((g) => /^\d{3}$/.test(g));
}

export function parseBankAmount(
  raw: string,
  commaMeaning: CommaMeaning = "ambiguous"
): number | undefined {
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

  if (value.startsWith("-")) {
    negative = !negative; // a "(...)"+"-" or "DR"+"-" combo is not real bank output, but toggling rather than ignoring keeps this total, not partial
    value = value.slice(1);
  } else if (value.startsWith("+")) {
    value = value.slice(1);
  }

  const normalized = normalizeSeparators(value, commaMeaning);
  if (normalized === undefined) return undefined;

  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) return undefined;

  const [whole, fraction = ""] = normalized.split(".");
  if ((whole ?? "").length > MAX_WHOLE_DIGITS) return undefined;

  const cents = Number(whole || "0") * 100 + Number(fraction.padEnd(2, "0") || "0");
  if (!Number.isFinite(cents)) return undefined;
  return negative ? -cents : cents;
}

/**
 * Why a value with a comma was refused, phrased for the pilot rather than
 * for a log. Callers use this to turn `undefined` into a rejection that
 * names the actual problem — "we couldn't tell whether 540,32 means five
 * hundred or fifty-four thousand" is actionable; "isn't a recognized
 * number" sends them looking for a typo that isn't there.
 */
export function ambiguousCommaReason(raw: string): string | null {
  const stripped = raw.trim().replace(/^\$/, "").replace(/^[-+]/, "").replace(/\s*(CR|DR)$/i, "");
  if (stripped.includes(".") || !stripped.includes(",")) return null;
  const parts = stripped.split(",");
  if (parts.length === 2 && /^\d{1,2}$/.test(parts[1] ?? "") && /^\d+$/.test(parts[0] ?? "")) {
    return `"${raw.trim()}" uses a comma where a decimal point was expected. This export looks like it uses European number formatting, which would be read 100x too large. Re-export it with a decimal point, or enter this transaction by hand.`;
  }
  return null;
}

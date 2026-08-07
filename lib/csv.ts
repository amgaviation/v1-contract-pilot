/**
 * The product's ONE CSV encoder. Both exports — the logbook and the year-end
 * packet — go through it, because two copies of an escaping routine is how
 * one of them gets a security fix and the other doesn't. That is not
 * hypothetical here: these two files shipped as identical copies, and the
 * formula-injection guard below was wrong in both.
 *
 * RFC 4180 quoting: a field is quoted only when it contains a quote, a comma
 * or a line break, so "KTEB" or "1.4" round-trips byte-identical without
 * needless quoting. An embedded quote is doubled.
 *
 * FORMULA INJECTION, and why the obvious guard is not enough.
 *
 * A CSV cell whose text begins with =, +, - or @ is evaluated as a FORMULA
 * when the file is opened in Excel or Google Sheets. `=HYPERLINK(...)` or
 * `=WEBSERVICE(...)` can exfiltrate the contents of neighbouring cells to an
 * attacker's URL. Prefixing the field with an apostrophe neutralises it: the
 * spreadsheet treats the cell as literal text, while a spec-compliant CSV
 * reader parsing the file as data is unaffected.
 *
 * The first version of this tested the RAW string:
 *
 *     if (/^[=+\-@]/.test(s)) s = `'${s}`;
 *
 * which reads correct and is not. A leading TAB, CR or LF is stripped by the
 * spreadsheet before it evaluates the cell, but is not one of those four
 * characters — so "\t=HYPERLINK(...)" sailed past the guard and executed.
 * That is the documented bypass, and a security review confirmed it live
 * against the shipped function.
 *
 * So the test runs against the string with leading whitespace REMOVED, and
 * the apostrophe is prefixed to the ORIGINAL — the payload is neutralised
 * whatever it hides behind, and the value a data consumer reads back is
 * unchanged apart from that apostrophe.
 *
 * WHY THIS MATTERS IN THIS PRODUCT, since the obvious reading is "it's the
 * pilot's own text, in the pilot's own file": not all of it is. A client name
 * is transcribed off an invoice someone else sent. A `notes` field on a tax
 * form is copied from a 1099 the client issued. The year-end packet is then
 * emailed to the pilot's accountant, who opens it in Excel — so the person
 * who executes the formula is neither the author of the text nor the owner of
 * the data.
 */

/** Characters that make a spreadsheet treat a cell as a formula. */
const FORMULA_LEAD = /^[=+\-@]/;

/**
 * Leading whitespace a spreadsheet discards before deciding whether the cell
 * is a formula — which is what makes it usable as a shield. \s covers tab,
 * CR, LF, vertical tab, form feed and the Unicode space separators.
 */
const LEADING_BLANK = /^\s+/;

/**
 * A bare negative number ("-500.00", "-1", "-0.5") is not a formula in any
 * spreadsheet — Excel and Sheets both evaluate a leading "-" as arithmetic
 * negation only when *something follows the number*. Once the guard below
 * strips leading whitespace and sees the "-" trigger, this second check asks
 * whether the whole remaining cell is just that number: digits, an optional
 * single decimal point and more digits, nothing else. "-1+1", "-cmd|...",
 * "- =SUM(A1)" all fail this (extra characters, or the number never
 * actually starts right after the "-"), so they still get quarantined.
 * This carve-out applies only to "-": "=", "+" and "@" have no legitimate
 * bare-number reading and are always neutralised.
 */
const PLAIN_NEGATIVE_NUMBER = /^-\d+(\.\d+)?$/;

export function csvField(value: string | number | null | undefined): string {
  const original = value === null || value === undefined ? "" : String(value);
  let s = original;

  const stripped = original.replace(LEADING_BLANK, "");
  if (FORMULA_LEAD.test(stripped) && !PLAIN_NEGATIVE_NUMBER.test(stripped)) {
    s = `'${original}`;
  }

  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function csvRow(fields: (string | number | null | undefined)[]): string {
  return fields.map(csvField).join(",") + "\r\n";
}

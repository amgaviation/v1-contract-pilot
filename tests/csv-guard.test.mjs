import test from "node:test";
import assert from "node:assert/strict";

const { csvField, csvRow } = await import("../lib/csv.ts");

/**
 * lib/csv.ts's own header documents a vulnerability that shipped and was
 * "confirmed live against the shipped function": a leading TAB, CR or LF
 * is stripped by a spreadsheet before it decides whether a cell is a
 * formula, so `"\t=HYPERLINK(...)"` sailed past a guard that tested only
 * the raw string. By this repo's own convention ("where a test exists
 * because something was once WRONG, say so") that bypass — and the
 * near-miss cases the header's PLAIN_NEGATIVE_NUMBER comment reasons
 * about by name — get pinned here, dedicated to lib/csv.ts rather than
 * riding along on tests/account-export.test.mjs's two incidental cases
 * (plain `=HYPERLINK` and a bare negative number).
 */

test("the documented bypass: whitespace-shielded formulas are still quarantined", async (t) => {
  await t.test("a leading TAB (the exact shipped bypass) gets the apostrophe", () => {
    assert.equal(csvField("\t=HYPERLINK(1)"), "'\t=HYPERLINK(1)");
  });

  await t.test("a leading CRLF gets the apostrophe (and is then CSV-quoted for the embedded CR/LF)", () => {
    // The guard runs on the value BEFORE the RFC 4180 quoting decision, so
    // a payload that is both formula-shaped and contains a raw CR/LF ends
    // up apostrophe-prefixed AND quoted — neither defence substitutes for
    // the other.
    assert.equal(csvField("\r\n=cmd|'/C calc'!A0"), '"\'\r\n=cmd|\'/C calc\'!A0"');
  });

  await t.test("a leading vertical tab and form feed are also stripped by \\s, so both get the apostrophe", () => {
    assert.equal(csvField("\v=cmd"), "'\v=cmd");
    assert.equal(csvField("\f=cmd"), "'\f=cmd");
  });

  await t.test("a leading Unicode space (non-breaking space) gets the apostrophe", () => {
    // \s in a JS regex covers the Unicode space separators, not just ASCII
    // whitespace — a payload shielded by U+00A0 is exactly the class of
    // near-miss the header calls out.
    assert.equal(csvField(" =SUM(A1)"), "' =SUM(A1)");
  });

  await t.test("a plain leading space gets the apostrophe, same as any other =/+/-/@ lead", () => {
    assert.equal(csvField(" =SUM(A1)"), "' =SUM(A1)");
  });
});

test("PLAIN_NEGATIVE_NUMBER carve-out: only a bare negative number is spared", () => {
  // The legitimate case the carve-out exists for.
  assert.equal(csvField("-500.00"), "-500.00");
  assert.equal(csvField("-1"), "-1");
  assert.equal(csvField("-0.5"), "-0.5");

  // The near-misses the header reasons about BY NAME: something follows
  // the number, or the "-" isn't immediately followed by a digit, so
  // these are formulas/commands wearing a minus sign and stay quarantined.
  assert.equal(csvField("-1+1"), "'-1+1");
  assert.equal(csvField("- =SUM(A1)"), "'- =SUM(A1)");
  assert.equal(csvField("-cmd|calc"), "'-cmd|calc");
});

test("the carve-out is '-'-only: '+' and '@' have no bare-number reading", () => {
  // A leading "+" or "@" is always neutralised, even where a naive reading
  // might call "+1" a plain number — the header is explicit that the
  // carve-out applies to "-" alone.
  assert.equal(csvField("+1"), "'+1");
  assert.equal(csvField("@SUM(A1)"), "'@SUM(A1)");
  assert.equal(csvField("=1"), "'=1");
});

test("RFC 4180 round-trips: quote only when the raw text requires it", () => {
  // No special character — byte-identical, unquoted.
  assert.equal(csvField("KTEB"), "KTEB");
  assert.equal(csvField("1.4"), "1.4");
  assert.equal(csvField(""), "");
  assert.equal(csvField(null), "");
  assert.equal(csvField(undefined), "");

  // An embedded quote is doubled and the whole field is wrapped.
  assert.equal(csvField('say "hi"'), '"say ""hi"""');

  // A comma or an embedded CRLF forces quoting even with no formula lead.
  assert.equal(csvField("Miami, FL"), '"Miami, FL"');
  assert.equal(csvField("line one\r\nline two"), '"line one\r\nline two"');
});

test("csvRow joins fields with a comma and terminates with CRLF", () => {
  assert.equal(csvRow(["KTEB", 1.4, null]), "KTEB,1.4,\r\n");
  // A formula-shaped field inside a row is still neutralised.
  assert.equal(csvRow(["=cmd", "safe"]), "'=cmd,safe\r\n");
});

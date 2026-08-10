import test from "node:test";
import assert from "node:assert/strict";

const { parseBankAmount, ambiguousCommaReason } = await import("../lib/bank-import/amount.ts");
const { parseDollarsToCents, formatCents, parseTenth } = await import("../lib/format.ts");

/**
 * Money. Every figure in this product is integer cents, and a path that
 * can render a wrong dollar figure is the most severe class of defect it
 * has. These are the parsers at the edge, where a bank file or a pilot's
 * typing becomes a number the rest of the system trusts.
 */

test("a bank amount is read in the sign the source text encodes", async (t) => {
  await t.test("plain, thousands, and currency symbol", () => {
    assert.equal(parseBankAmount("45.00"), 4500);
    assert.equal(parseBankAmount("1,234.56"), 123456);
    assert.equal(parseBankAmount("$45.00"), 4500);
  });

  await t.test("parentheses and CR/DR are the two negative notations", () => {
    assert.equal(parseBankAmount("(45.00)"), -4500);
    assert.equal(parseBankAmount("45.00 DR"), -4500);
    assert.equal(parseBankAmount("45.00 CR"), 4500);
  });

  await t.test("sub-cent precision is refused, never rounded away", () => {
    // A bank that sends three decimals is sending something this product
    // cannot represent. Rounding it would silently change the pilot's
    // number; refusing it says so.
    assert.equal(parseBankAmount("45.123"), undefined);
    assert.equal(parseBankAmount("N/A"), undefined);
    assert.equal(parseBankAmount(""), undefined);
  });
});

test("a comma is not always a thousands separator (regression: 100x inflation)", async (t) => {
  // This shipped. `value.replace(/,/g, "")` stripped every comma, so a
  // European-formatted "540,32" became 5403200 cents — $54,032.00 for a
  // $540.32 charge, with no error and no downstream guard: the server
  // ceiling sits five orders of magnitude above and the only CHECK on the
  // column is `amount_cents <> 0`.
  await t.test("both separators present: the last one is the decimal", () => {
    assert.equal(parseBankAmount("1,234.56"), 123456);
    assert.equal(parseBankAmount("1.234,56"), 123456);
  });

  await t.test("comma with three digits is grouping", () => {
    assert.equal(parseBankAmount("1,234"), 123400);
    assert.equal(parseBankAmount("1,234,567"), 123456700);
  });

  await t.test("comma with one or two trailing digits is refused in a CSV", () => {
    // Genuinely ambiguous: no US bank writes "540,32", but guessing costs
    // 100x when wrong. Refused by name instead.
    assert.equal(parseBankAmount("540,32"), undefined);
    assert.equal(parseBankAmount("0,99"), undefined);
    assert.match(ambiguousCommaReason("540,32") ?? "", /comma where a decimal point was expected/);
  });

  await t.test("and read as a decimal in OFX, where the spec says so", () => {
    // OFX 2.0.2 §3.2.9.2 requires a decimal point OR comma for the
    // fraction and forbids thousands punctuation, so there is nothing to
    // guess at.
    assert.equal(parseBankAmount("540,32", "decimal"), 54032);
    assert.equal(parseBankAmount("0,99", "decimal"), 99);
    assert.equal(parseBankAmount("1,234.56", "decimal"), 123456);
  });

  await t.test("a malformed grouping is refused rather than salvaged", () => {
    assert.equal(parseBankAmount("12,34,567"), undefined);
    assert.equal(parseBankAmount("1,23456"), undefined);
  });
});

test("a typed dollar amount becomes exact cents", async (t) => {
  await t.test("the ordinary cases", () => {
    assert.equal(parseDollarsToCents("1500"), 150000);
    assert.equal(parseDollarsToCents("1500.00"), 150000);
    assert.equal(parseDollarsToCents("0.01"), 1);
  });

  await t.test("floating point never gets a chance to be wrong", () => {
    // 1.005 * 100 is 100.49999999999999 in binary floating point. The
    // whole reason this function does not use parseFloat.
    assert.equal(parseDollarsToCents("1.10"), 110);
    assert.equal(parseDollarsToCents("2.675"), undefined);
  });
});

test("cents render as money without float drift", () => {
  assert.equal(formatCents(150000), "$1,500.00");
  assert.equal(formatCents(1), "$0.01");
  assert.equal(formatCents(0), "$0.00");
});

test("flight time is tenths, and a second decimal is refused not rounded", () => {
  // numeric(p,s) in Postgres silently ROUNDS. A logbook is a legal record;
  // 1.25 hours is not 1.3, and the pilot should be told rather than
  // quietly corrected.
  assert.equal(parseTenth("1.4", { max: 999 }), 1.4);
  assert.equal(parseTenth("0", { max: 999 }), 0);
  assert.equal(parseTenth("1.25", { max: 999 }), undefined);
  assert.equal(parseTenth("1000", { max: 999 }), undefined, "out of range is rejected, not clamped");
  assert.equal(parseTenth("", { max: 999 }), 0, "blank is zero unless the caller allows null");
  assert.equal(parseTenth("", { max: 999, allowBlank: true }), null);
});

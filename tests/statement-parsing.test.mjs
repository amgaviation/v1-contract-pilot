import test from "node:test";
import assert from "node:assert/strict";

const { parseCsv } = await import("../lib/bank-import/csv.ts");
const { applyCsvMapping, suggestColumnMapping } = await import("../lib/bank-import/apply-mapping.ts");
const { parseOfx } = await import("../lib/bank-import/ofx.ts");
const { parseStatementDate, parseOfxDate } = await import("../lib/bank-import/date.ts");

/**
 * Statement parsing. Every fixture here is synthetic — no live pilot or
 * bank data, ever. Several of these tests exist because the behaviour they
 * pin was once wrong in a way that reached a number a pilot would act on.
 */

const csv = (rows) =>
  "Date,Description,Amount\n" + rows.map(([d, n, a]) => `${d},${n},${a}`).join("\n") + "\n";

const parseCard = (rows, signFlipOverride) => {
  const [header, ...data] = parseCsv(csv(rows));
  return applyCsvMapping({
    headerRow: header.fields,
    dataRecords: data,
    mapping: suggestColumnMapping(header.fields),
    accountKind: "credit_card",
    signFlipOverride,
  });
};

test("a date is a calendar fact, and an impossible one is refused", async (t) => {
  await t.test("the three CSV shapes", () => {
    assert.equal(parseStatementDate("2026-03-15"), "2026-03-15");
    assert.equal(parseStatementDate("3/15/2026"), "2026-03-15");
    assert.equal(parseStatementDate("3-15-2026"), "2026-03-15");
  });

  await t.test("February 30th does not exist and must not roll over", () => {
    // Date.UTC would happily turn 2026-02-31 into March 3rd, and the
    // preview rendered exactly that — a confident wrong date with no
    // visual cue. Nothing in this module constructs a Date.
    assert.equal(parseStatementDate("2026-02-30"), null);
    assert.equal(parseOfxDate("20260231"), null);
    assert.equal(parseOfxDate("20261399"), null);
  });

  await t.test("leap years are real", () => {
    assert.equal(parseStatementDate("2024-02-29"), "2024-02-29");
    assert.equal(parseStatementDate("2026-02-29"), null);
  });

  await t.test("OFX timestamps keep only the calendar date", () => {
    assert.equal(parseOfxDate("20260315"), "2026-03-15");
    assert.equal(parseOfxDate("20260315120000"), "2026-03-15");
    assert.equal(parseOfxDate("20260315120000.000[-5:EST]"), "2026-03-15");
  });
});

test("an OFX record that cannot be closed is reported, not absorbed", async (t) => {
  const unclosedMiddle =
    "<OFX><BANKTRANLIST>\n" +
    "<STMTTRN><DTPOSTED>20260315<TRNAMT>-10.00<NAME>ONE</STMTTRN>\n" +
    "<STMTTRN><DTPOSTED>20260316<TRNAMT>-20.00<NAME>TWO\n" +
    "<STMTTRN><DTPOSTED>20260317<TRNAMT>-30.00<NAME>THREE</STMTTRN>\n" +
    "</BANKTRANLIST></OFX>";

  await t.test("it does not FABRICATE a transaction from two records", () => {
    // The original regex let a body swallow a nested opener, and the
    // leaf-tag scan is last-write-wins — so a missing close tag produced a
    // row carrying one record's payee and another's amount: a charge that
    // appears nowhere in the file, passing every validation, offered to
    // the pilot to bill a client.
    const r = parseOfx(unclosedMiddle, "ofx");
    assert.equal(r.valid.length, 2);
    assert.deepEqual(
      r.valid.map((v) => v.amountCents),
      [-1000, -3000]
    );
    assert.equal(r.valid[1].description, "THREE", "not a merge of TWO and THREE");
  });

  await t.test("the loss is a named rejection, at the row it happened", () => {
    const r = parseOfx(unclosedMiddle, "ofx");
    assert.equal(r.rejected.length, 1);
    assert.equal(r.rejected[0].rowNumber, 2, "the file's numbering, not the parser's");
    assert.equal(r.valid[1].rowNumber, 3, "and the survivor keeps its real position");
  });

  await t.test("a well-formed file is untouched by any of this", () => {
    const clean = unclosedMiddle.replace("<NAME>TWO\n", "<NAME>TWO</STMTTRN>\n");
    const r = parseOfx(clean, "ofx");
    assert.equal(r.valid.length, 3);
    assert.equal(r.rejected.length, 0);
    assert.deepEqual(
      r.valid.map((v) => v.amountCents),
      [-1000, -2000, -3000]
    );
  });
});

test("a multi-account OFX download is refused rather than filed to one ledger", () => {
  // The dedup index is scoped per bank account, so a misattributed row
  // sits in the wrong namespace — importing the correct statement
  // afterwards does NOT collide, and the charges land twice.
  const ofx =
    "<OFX><BANKMSGSRSV1>\n" +
    "<STMTRS><BANKACCTFROM><ACCTID>111111111</BANKACCTFROM><BANKTRANLIST>\n" +
    "<STMTTRN><DTPOSTED>20260315<TRNAMT>-10.00<NAME>CHECKING</STMTTRN>\n" +
    "</BANKTRANLIST></STMTRS>\n" +
    "<STMTRS><BANKACCTFROM><ACCTID>222222222</BANKACCTFROM><BANKTRANLIST>\n" +
    "<STMTTRN><DTPOSTED>20260316<TRNAMT>-40.00<NAME>SAVINGS</STMTTRN>\n" +
    "</BANKTRANLIST></STMTRS>\n" +
    "</BANKMSGSRSV1></OFX>";
  const r = parseOfx(ofx, "ofx");
  assert.equal(r.valid.length, 0);
  assert.match(r.rejected[0].reason, /2 different accounts/);
});

test("OFX entities are decoded once, on the leaf value", () => {
  // Undecoded, "AT&amp;T" reached pilot.expenses.vendor and rendered to
  // the pilot literally (React escapes JSX text), and diverged the
  // fingerprint from the CSV export of the same charge.
  const one = "<STMTTRN><DTPOSTED>20260315<TRNAMT>-10.00<NAME>AT&amp;T MOBILITY</STMTTRN>";
  assert.equal(parseOfx(one, "ofx").valid[0].description, "AT&T MOBILITY");

  // One pass over one alternation: sequential .replace() calls would turn
  // "&amp;lt;" into "<".
  const nested = "<STMTTRN><DTPOSTED>20260315<TRNAMT>-10.00<NAME>A&amp;lt;B</STMTTRN>";
  assert.equal(parseOfx(nested, "ofx").valid[0].description, "A&lt;B");
});

test("a credit card's sign convention is inferred, never assumed", async (t) => {
  await t.test("a majority-positive file is the classic issuer convention", () => {
    const r = parseCard([
      ["2026-03-04", "HOTEL", "214.88"],
      ["2026-03-05", "FUEL", "512.10"],
      ["2026-03-06", "REFUND", "-64.10"],
    ]);
    assert.equal(r.signInterpretation?.flipped, true);
    assert.equal(r.valid[0].amountCents, -21488, "the purchase is money out");
    assert.equal(r.valid[2].amountCents, 6410, "the refund is money in");
  });

  await t.test("a majority-negative file is ALREADY canonical", () => {
    // The regression that mattered: an issuer writing purchases negative
    // had its whole statement inverted, so every real purchase became a
    // "deposit" the confirm screen refused, and the month's one refund was
    // the only filable row.
    const r = parseCard([
      ["2026-03-04", "HOTEL", "-214.88"],
      ["2026-03-05", "FUEL", "-512.10"],
      ["2026-03-06", "REFUND", "64.10"],
    ]);
    assert.equal(r.signInterpretation?.flipped, false);
    assert.equal(r.valid[0].amountCents, -21488);
  });

  await t.test("parentheses are the file's negative, not a direction claim", () => {
    // Exempting them meant a parenthesised refund imported as an expense,
    // while the same refund written "-89.99" was flipped correctly. Same
    // fact, two answers, decided by punctuation.
    const r = parseCard([
      ["2026-03-04", "HOTEL", "214.88"],
      ["2026-03-05", "FUEL", "512.10"],
      ["2026-03-06", "REFUND", "(89.99)"],
    ]);
    assert.equal(r.signInterpretation?.selfDeclaredRows, 0);
    assert.equal(r.valid[2].amountCents, 8999, "money in, like any other negative");
  });

  await t.test("a trailing DR does state a direction and is never overridden", () => {
    const r = parseCard([
      ["2026-03-04", "HOTEL", "214.88 DR"],
      ["2026-03-05", "FUEL", "512.10"],
      ["2026-03-06", "MEALS", "88.00"],
    ]);
    assert.equal(r.signInterpretation?.selfDeclaredRows, 1);
    assert.equal(r.valid[0].amountCents, -21488, '"DR" already said money out');
  });

  await t.test("counts too close to settle it are marked, not guessed", () => {
    // One charge and two payments: a majority rule points the wrong way
    // and inverts the file. The preview asks instead.
    const r = parseCard([
      ["2026-03-04", "CHARGE", "214.88"],
      ["2026-03-05", "PAYMENT", "-500.00"],
      ["2026-03-06", "PAYMENT", "-300.00"],
    ]);
    assert.equal(r.signInterpretation?.decisive, false);

    const forced = parseCard(
      [
        ["2026-03-04", "CHARGE", "214.88"],
        ["2026-03-05", "PAYMENT", "-500.00"],
        ["2026-03-06", "PAYMENT", "-300.00"],
      ],
      true
    );
    assert.equal(forced.signInterpretation?.overridden, true);
    assert.equal(forced.valid[0].amountCents, -21488, "the pilot's answer decides the file");
  });

  await t.test("a checking account is never sign-transformed", () => {
    const [header, ...data] = parseCsv(csv([["2026-03-04", "COFFEE", "-4.75"]]));
    const r = applyCsvMapping({
      headerRow: header.fields,
      dataRecords: data,
      mapping: suggestColumnMapping(header.fields),
      accountKind: "checking",
    });
    assert.equal(r.signInterpretation, undefined);
    assert.equal(r.valid[0].amountCents, -475);
  });
});

test("a CSV row with the wrong number of fields is not quietly accepted", async (t) => {
  await t.test("more fields than the header is rejected by name", () => {
    // "2026-03-15,COFFEE,4,75" is four fields against a three-column
    // header. It used to store the amount as "4" — the pilot saw $4.00 for
    // a 4,75 charge, with rejected: 0.
    const [header, ...data] = parseCsv("Date,Description,Amount\n2026-03-15,COFFEE,4,75\n");
    const r = applyCsvMapping({
      headerRow: header.fields,
      dataRecords: data,
      mapping: suggestColumnMapping(header.fields),
      accountKind: "checking",
    });
    assert.equal(r.valid.length, 0);
    assert.equal(r.rejected.length, 1);
    assert.match(r.rejected[0].reason, /4 values but the header has 3 columns/);
  });

  await t.test("fewer fields is padded, so the row still parses", () => {
    const [header, ...data] = parseCsv("Date,Description,Amount\n2026-03-15,COFFEE\n");
    const r = applyCsvMapping({
      headerRow: header.fields,
      dataRecords: data,
      mapping: suggestColumnMapping(header.fields),
      accountKind: "checking",
    });
    // Padded to three, then rejected for the real reason — a missing
    // amount — rather than for a shape problem.
    assert.equal(r.valid.length, 0);
    assert.match(r.rejected[0].reason, /Missing amount/);
  });
});

test("a quoted comma survives the CSV tokeniser", () => {
  const [header, ...data] = parseCsv(
    '﻿Date,Description,Amount\r\n2026-01-05,"STARBUCKS #1234, 5TH AVE",-4.75\r\n'
  );
  assert.deepEqual(header.fields, ["Date", "Description", "Amount"]);
  const r = applyCsvMapping({
    headerRow: header.fields,
    dataRecords: data,
    mapping: suggestColumnMapping(header.fields),
    accountKind: "checking",
  });
  assert.equal(r.valid[0].description, "STARBUCKS #1234, 5TH AVE");
});

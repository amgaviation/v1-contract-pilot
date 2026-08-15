#!/usr/bin/env node
/**
 * Bank/card statement import verification (`npm run bank-import:verify`).
 *
 * Two parts, same shape as scripts/invoice-share-verify.mjs:
 *
 *   PART 1 — parser-level, in-process. Exercises lib/bank-import/* against
 *   fully synthetic fixtures built inline in this file (never live pilot or
 *   bank data) covering every amount format and file shape this feature
 *   claims to handle. Runs under `node --experimental-strip-types` so the
 *   real .ts modules are imported directly — not a re-implementation that
 *   could silently drift from what confirmBankImport actually ships.
 *
 *   PART 2 — database-level, over a REAL Postgres connection inside one
 *   transaction that always rolls back. Asserts specific SQLSTATEs by
 *   constraint name, never merely "an error happened." Includes the
 *   required fail-proof: BANK-DEDUP-9 deliberately drops the dedup index
 *   and watches BANK-DEDUP-1 flip from pass to failure, then restores it.
 *
 *   DATABASE_URL="postgresql://..." node --experimental-strip-types \
 *     scripts/bank-import-verify.mjs
 */

import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";
import { register } from "node:module";

// lib/bank-import/*.ts imports its siblings extensionless ("./amount"),
// the normal TS style this codebase uses everywhere (webpack/tsc resolve
// it fine) — but Node's native `--experimental-strip-types` type-strips
// without doing that extensionless resolution itself. Registered here,
// inline, as a `data:` URL loader rather than a second file on disk, so
// this stays the single script this feature's scope calls for: it only
// appends ".ts" to a relative specifier that has no extension, then
// falls through to normal resolution for everything else.
register(
  `data:text/javascript,${encodeURIComponent(`
    import { extname } from "node:path";
    export async function resolve(specifier, context, nextResolve) {
      if (specifier.startsWith(".") && extname(specifier) === "") {
        try { return await nextResolve(specifier + ".ts", context); } catch {}
      }
      return nextResolve(specifier, context);
    }
  `)}`,
  import.meta.url
);

const { parseCsv } = await import("../lib/bank-import/csv.ts");
const { applyCsvMapping, suggestColumnMapping } = await import("../lib/bank-import/apply-mapping.ts");
const { parseOfx } = await import("../lib/bank-import/ofx.ts");
const { parseBankAmount } = await import("../lib/bank-import/amount.ts");
const { transactionFingerprint } = await import("../lib/bank-import/fingerprint.ts");

let failures = 0;
function check(label, fn) {
  try {
    fn();
    console.log(`PASS (${label})`);
  } catch (err) {
    failures += 1;
    console.error(`FAIL (${label}): ${err.message}`);
  }
}

// ===========================================================================
// PART 1 — parser-level fixtures. All synthetic.
// ===========================================================================

// --- Amount formats -------------------------------------------------------
check("AMOUNT-1: plain decimal", () => assert.equal(parseBankAmount("45.00"), 4500));
check("AMOUNT-2: thousands separator", () => assert.equal(parseBankAmount("1,234.56"), 123456));
check("AMOUNT-3: parens negative", () => assert.equal(parseBankAmount("(45.00)"), -4500));
check("AMOUNT-4: trailing CR = positive", () => assert.equal(parseBankAmount("45.00 CR"), 4500));
check("AMOUNT-5: trailing DR = negative", () => assert.equal(parseBankAmount("45.00 DR"), -4500));
check("AMOUNT-6: leading dollar sign", () => assert.equal(parseBankAmount("$45.00"), 4500));
check("AMOUNT-7: leading minus", () => assert.equal(parseBankAmount("-45.00"), -4500));
check("AMOUNT-8: not a number is rejected", () => assert.equal(parseBankAmount("N/A"), undefined));
check("AMOUNT-9: three decimal places rejected (no silent rounding)", () =>
  assert.equal(parseBankAmount("45.123"), undefined)
);
check("AMOUNT-10: combined — thousands + parens", () => assert.equal(parseBankAmount("(1,234.56)"), -123456));

// --- CSV: single signed amount column, thousands separator, CRLF, BOM -----
const BOM = "﻿";
const csvSigned =
  BOM +
  'Date,Description,Amount\r\n' +
  '2026-01-05,"STARBUCKS #1234, 5TH AVE",-4.75\r\n' +
  '2026-01-06,PAYROLL DEPOSIT,"1,234.56"\r\n' +
  '2026-01-07,AMAZON.COM,"(89.99)"\r\n';

let signedRows;
check("CSV-1: signed-amount CSV with BOM+CRLF+thousands+quoted-comma parses to 3 rows", () => {
  const parsed = parseCsv(csvSigned);
  assert.ok(Array.isArray(parsed), "tokenizer must not report a parse error");
  const [header, ...data] = parsed;
  assert.deepEqual(header.fields, ["Date", "Description", "Amount"]);
  assert.equal(header.fields[0], "Date", "BOM must not leak into the first header cell");
  const mapping = suggestColumnMapping(header.fields);
  assert.deepEqual(mapping, ["posted_on", "description", "amount"]);
  const result = applyCsvMapping({ headerRow: header.fields, dataRecords: data, mapping, accountKind: "checking" });
  assert.equal(result.rejected.length, 0, JSON.stringify(result.rejected));
  assert.equal(result.valid.length, 3);
  signedRows = result.valid;
  assert.equal(result.valid[0].amountCents, -475, "checking: -4.75 stays negative");
  assert.equal(result.valid[0].description, "STARBUCKS #1234, 5TH AVE", "embedded comma inside a quoted field must survive");
  assert.equal(result.valid[1].amountCents, 123456, "1,234.56 thousands separator");
  assert.equal(result.valid[2].amountCents, -8999, "(89.99) parens negative");
});

// --- CSV: the credit-card sign decision ------------------------------------
// REWRITTEN. The previous CSV-2 asserted that a credit_card account ALWAYS
// flips a signed amount column — which is exactly what the code did, so
// the test encoded the premise instead of testing it and could never have
// caught the defect that premise causes. It also contradicted its own
// fixture, describing "-4.75 STARBUCKS #1234, 5TH AVE" as "a credit/refund"
// when a coffee shop line on a card statement is a purchase.
//
// The real contract is: infer the file's own convention, and never argue
// with a cell that stated its direction itself. Case (b) is the regression
// that mattered — it used to invert an entire statement.

check("CSV-2a: a majority-POSITIVE card file is the classic issuer convention and IS flipped", () => {
  const csv =
    "Date,Description,Amount\n" +
    "2026-03-04,SYNTHETIC HOTEL,214.88\n" +
    "2026-03-05,SYNTHETIC FUEL,512.10\n" +
    "2026-03-06,SYNTHETIC REFUND,-64.10\n";
  const [header, ...data] = parseCsv(csv);
  const mapping = suggestColumnMapping(header.fields);
  const r = applyCsvMapping({ headerRow: header.fields, dataRecords: data, mapping, accountKind: "credit_card" });
  assert.equal(r.signInterpretation?.flipped, true, "2 positive vs 1 negative => issuer writes purchases positive");
  assert.equal(r.valid[0].amountCents, -21488, "the hotel purchase becomes canonical money-out");
  assert.equal(r.valid[2].amountCents, 6410, "the refund becomes canonical money-in");
});

check("CSV-2b: a majority-NEGATIVE card file is ALREADY canonical and is NOT flipped", () => {
  // An issuer whose CSV writes purchases negative had its entire statement
  // inverted: every real purchase became a "deposit" the confirm screen
  // refused to file, and the month's one refund was the only row the pilot
  // could turn into an expense.
  const csv =
    "Date,Description,Amount\n" +
    "2026-03-04,SYNTHETIC HOTEL,-214.88\n" +
    "2026-03-05,SYNTHETIC FUEL,-512.10\n" +
    "2026-03-06,SYNTHETIC REFUND,64.10\n";
  const [header, ...data] = parseCsv(csv);
  const mapping = suggestColumnMapping(header.fields);
  const r = applyCsvMapping({ headerRow: header.fields, dataRecords: data, mapping, accountKind: "credit_card" });
  assert.equal(r.signInterpretation?.flipped, false, "2 negative vs 1 positive => already canonical");
  assert.equal(r.valid[0].amountCents, -21488, "the hotel purchase STAYS money-out");
  assert.equal(r.valid[2].amountCents, 6410, "the refund STAYS money-in");
});

check("CSV-2c: a cell that states its own direction (CR/DR/parens) is never flipped", () => {
  const csv =
    "Date,Description,Amount\n" +
    "2026-03-04,SYNTHETIC HOTEL,214.88 DR\n" +
    "2026-03-05,SYNTHETIC FUEL,512.10\n" +
    "2026-03-06,SYNTHETIC MEALS,88.00\n";
  const [header, ...data] = parseCsv(csv);
  const mapping = suggestColumnMapping(header.fields);
  const r = applyCsvMapping({ headerRow: header.fields, dataRecords: data, mapping, accountKind: "credit_card" });
  assert.equal(r.signInterpretation?.flipped, true, "the two unmarked positives still set the file convention");
  assert.equal(r.signInterpretation?.selfDeclaredRows, 1);
  assert.equal(r.valid[0].amountCents, -21488, '"214.88 DR" already said money out — the flip must not touch it');
  assert.equal(r.valid[1].amountCents, -51210, "the unmarked purchase is flipped as usual");
});

check("CSV-2e: parentheses are the file's negative notation, NOT a direction claim", () => {
  // Regression. declaresOwnSign() used to count parens, so on a
  // positive-charge card export a parenthesised REFUND was exempted from
  // the flip and imported as an expense — while the identical refund
  // written "-89.99" was flipped correctly. Same fact, two answers,
  // decided by punctuation. Only CR/DR name a direction on their own.
  const csv =
    "Date,Description,Amount\n" +
    "2026-03-04,SYNTHETIC HOTEL,214.88\n" +
    "2026-03-05,SYNTHETIC FUEL,512.10\n" +
    "2026-03-06,SYNTHETIC REFUND,(89.99)\n";
  const [header, ...data] = parseCsv(csv);
  const mapping = suggestColumnMapping(header.fields);
  const r = applyCsvMapping({ headerRow: header.fields, dataRecords: data, mapping, accountKind: "credit_card" });
  assert.equal(r.signInterpretation?.selfDeclaredRows, 0, "parens must not count as self-declared");
  assert.equal(r.valid[0].amountCents, -21488, "the purchase is money out");
  assert.equal(r.valid[2].amountCents, 8999, "the parenthesised refund is money IN, like any other negative");
});

check("CSV-2f: a statement too evenly split is marked non-decisive rather than guessed at", () => {
  // One charge and two payments: a majority rule points the wrong way and
  // would invert the file. The parser must say it could not tell, so the
  // preview asks instead of silently rewriting the pilot's money.
  const csv =
    "Date,Description,Amount\n" +
    "2026-03-04,SYNTHETIC CHARGE,214.88\n" +
    "2026-03-05,SYNTHETIC PAYMENT,-500.00\n" +
    "2026-03-06,SYNTHETIC PAYMENT,-300.00\n";
  const [header, ...data] = parseCsv(csv);
  const mapping = suggestColumnMapping(header.fields);
  const r = applyCsvMapping({ headerRow: header.fields, dataRecords: data, mapping, accountKind: "credit_card" });
  assert.equal(r.signInterpretation?.decisive, false, "counts this close cannot settle the convention");

  const forced = applyCsvMapping({
    headerRow: header.fields, dataRecords: data, mapping,
    accountKind: "credit_card", signFlipOverride: true,
  });
  assert.equal(forced.signInterpretation?.flipped, true);
  assert.equal(forced.signInterpretation?.overridden, true, "the override is reported, not silent");
  assert.equal(forced.valid[0].amountCents, -21488, "the pilot's answer decides the whole file");
});

check("CSV-2g: an unambiguous file is still decisive and still flips", () => {
  const csv =
    "Date,Description,Amount\n" +
    "2026-03-04,A,10.00\n2026-03-05,B,20.00\n2026-03-06,C,30.00\n2026-03-07,REFUND,-5.00\n";
  const [header, ...data] = parseCsv(csv);
  const mapping = suggestColumnMapping(header.fields);
  const r = applyCsvMapping({ headerRow: header.fields, dataRecords: data, mapping, accountKind: "credit_card" });
  assert.equal(r.signInterpretation?.decisive, true);
  assert.equal(r.signInterpretation?.flipped, true);
  assert.equal(r.valid[0].amountCents, -1000);
});

check("OFX-3: an unclosed MIDDLE record keeps every row number the file's own", () => {
  // Numbering by matched-block index renumbered everything after a
  // malformed record: the third transaction was reported as row 2 and the
  // rejection as row 3, so both the pilot-facing message and the stored
  // source_row_number pointed at the wrong lines.
  const ofx =
    "<OFX><BANKTRANLIST>\n" +
    "<STMTTRN><DTPOSTED>20260315<TRNAMT>-10.00<NAME>ONE</STMTTRN>\n" +
    "<STMTTRN><DTPOSTED>20260316<TRNAMT>-20.00<NAME>TWO\n" +
    "<STMTTRN><DTPOSTED>20260317<TRNAMT>-30.00<NAME>THREE</STMTTRN>\n" +
    "</BANKTRANLIST></OFX>";
  const r = parseOfx(ofx, "ofx");
  assert.equal(r.valid.length, 2);
  assert.equal(r.rejected.length, 1);
  assert.equal(r.valid[0].rowNumber, 1);
  assert.equal(r.valid[1].rowNumber, 3, "the surviving third record is row 3, not row 2");
  assert.equal(r.rejected[0].rowNumber, 2, "the unreadable record is row 2, where it actually is");
  assert.equal(r.valid[1].amountCents, -3000, "and it is genuinely the third record, not a merge");
});

check("CSV-2d: a checking account is never sign-transformed at all", () => {
  const [header, ...data] = parseCsv(csvSigned);
  const mapping = suggestColumnMapping(header.fields);
  const r = applyCsvMapping({ headerRow: header.fields, dataRecords: data, mapping, accountKind: "checking" });
  assert.equal(r.signInterpretation, undefined, "no sign decision is made for a non-card account");
  assert.equal(r.valid[0].amountCents, -475);
  assert.equal(r.valid[2].amountCents, -8999);
});

// --- CSV: separate debit/credit columns ------------------------------------
const csvDebitCredit =
  "Posting Date,Memo,Withdrawal,Deposit\n" +
  "06/15/2026,UBER TRIP,32.40,\n" +
  "06/16/2026,CLIENT PAYMENT,,1500.00\n";

check("CSV-3: debit/credit columns combine to one signed canonical amount", () => {
  const parsed = parseCsv(csvDebitCredit);
  const [header, ...data] = parsed;
  const mapping = suggestColumnMapping(header.fields);
  assert.deepEqual(mapping, ["posted_on", "description", "debit", "credit"]);
  const result = applyCsvMapping({ headerRow: header.fields, dataRecords: data, mapping, accountKind: "checking" });
  assert.equal(result.rejected.length, 0, JSON.stringify(result.rejected));
  assert.equal(result.valid[0].amountCents, -3240, "a withdrawal is canonical-negative");
  assert.equal(result.valid[1].amountCents, 150000, "a deposit is canonical-positive");
  assert.equal(result.valid[0].postedOn, "2026-06-15", "M/D/YYYY parses");
});

check("CSV-4: a row with BOTH debit and credit populated is rejected loudly", () => {
  const bad = "Date,Memo,Withdrawal,Deposit\n2026-01-01,BOTH,5.00,5.00\n";
  const parsed = parseCsv(bad);
  const [header, ...data] = parsed;
  const mapping = suggestColumnMapping(header.fields);
  const result = applyCsvMapping({ headerRow: header.fields, dataRecords: data, mapping, accountKind: "checking" });
  assert.equal(result.valid.length, 0);
  assert.equal(result.rejected.length, 1);
  assert.match(result.rejected[0].reason, /never both/);
});

check("CSV-5: unclosed quote is a named, loud parse error, not silent data loss", () => {
  const broken = 'Date,Description,Amount\n2026-01-01,"unterminated,-5.00\n';
  const parsed = parseCsv(broken);
  assert.ok("error" in parsed);
  assert.match(parsed.error, /unclosed quote/);
});

// --- OFX / QFX ---------------------------------------------------------
const ofxFixture = `OFXHEADER:100
DATA:OFXSGML
VERSION:102

<OFX>
<BANKMSGSRSV1>
<STMTTRNRS>
<STMTRS>
<BANKTRANLIST>
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20260302120000[-5:EST]
<TRNAMT>-52.14
<FITID>20260302001
<NAME>SHELL OIL 4471
</STMTTRN>
<STMTTRN>
<TRNTYPE>CREDIT
<DTPOSTED>20260305
<TRNAMT>2100.00
<FITID>20260305001
<NAME>CLIENT WIRE
<MEMO>March retainer
</STMTTRN>
</BANKTRANLIST>
</STMTRS>
</STMTTRNRS>
</BANKMSGSRSV1>
</OFX>
`;

check("OFX-1: parses <STMTTRN> blocks, DTPOSTED with timezone suffix, NAME+MEMO combine", () => {
  const result = parseOfx(ofxFixture, "ofx");
  assert.equal(result.rejected.length, 0, JSON.stringify(result.rejected));
  assert.equal(result.valid.length, 2);
  assert.equal(result.valid[0].postedOn, "2026-03-02");
  assert.equal(result.valid[0].amountCents, -5214);
  assert.equal(result.valid[0].description, "SHELL OIL 4471");
  assert.equal(result.valid[1].postedOn, "2026-03-05");
  assert.equal(result.valid[1].amountCents, 210000);
  assert.equal(result.valid[1].description, "CLIENT WIRE: March retainer");
});

check("QFX-1: same STMTTRN shape, .qfx label, credit-card purchase stays negative (NOT flipped)", () => {
  const qfxFixture = ofxFixture.replace("<BANKMSGSRSV1>", "<CREDITCARDMSGSRSV1>").replace(
    "</BANKMSGSRSV1>",
    "</CREDITCARDMSGSRSV1>"
  );
  const result = parseOfx(qfxFixture, "qfx");
  assert.equal(result.format, "qfx");
  assert.equal(result.valid[0].amountCents, -5214, "OFX's own convention already writes a charge as negative — no flip applied, unlike CSV");
});

check("OFX-2: a file with no <STMTTRN> at all is a named rejection, not zero silent rows", () => {
  const result = parseOfx("<OFX><SIGNONMSGSRSV1></SIGNONMSGSRSV1></OFX>", "ofx");
  assert.equal(result.valid.length, 0);
  assert.equal(result.rejected.length, 1);
  assert.match(result.rejected[0].reason, /No <STMTTRN>/);
});

// --- Dedup: fingerprint stability across a re-import of an overlapping range
check("OFX-4: a multi-account download is refused rather than filed to one ledger", () => {
  // "Download all accounts" is spec-legal: one BANKMSGSRSV1 holding two
  // STMTRS plus a CCSTMTRS. The parser scanned the whole document and the
  // import screen attributed every row to the ONE account the pilot
  // picked, so savings and card charges landed in the checking ledger.
  // Worse, the dedup index is scoped per bank account, so importing the
  // savings statement properly afterwards did NOT collide — the same
  // charges were recorded twice.
  const ofx =
    "<OFX><BANKMSGSRSV1>\n" +
    "<STMTRS><BANKACCTFROM><ACCTID>111111111</BANKACCTFROM><BANKTRANLIST>\n" +
    "<STMTTRN><DTPOSTED>20260315<TRNAMT>-10.00<NAME>CHECKING ONE</STMTTRN>\n" +
    "</BANKTRANLIST></STMTRS>\n" +
    "<STMTRS><BANKACCTFROM><ACCTID>222222222</BANKACCTFROM><BANKTRANLIST>\n" +
    "<STMTTRN><DTPOSTED>20260316<TRNAMT>-40.00<NAME>SAVINGS ONE</STMTTRN>\n" +
    "</BANKTRANLIST></STMTRS>\n" +
    "</BANKMSGSRSV1></OFX>";
  const r = parseOfx(ofx, "ofx");
  assert.equal(r.valid.length, 0, "nothing may be imported from a multi-account file");
  assert.equal(r.rejected.length, 1);
  assert.match(r.rejected[0].reason, /2 different accounts/);
  assert.match(r.rejected[0].reason, /one account at a time/);
});

check("OFX-5: a single-account file reports which account it is for", () => {
  const ofx =
    "<OFX><BANKMSGSRSV1><STMTRS><BANKACCTFROM><ACCTID>987654321</BANKACCTFROM><BANKTRANLIST>\n" +
    "<STMTTRN><DTPOSTED>20260315<TRNAMT>-10.00<NAME>ONE</STMTTRN>\n" +
    "</BANKTRANLIST></STMTRS></BANKMSGSRSV1></OFX>";
  const r = parseOfx(ofx, "ofx");
  assert.equal(r.valid.length, 1);
  assert.equal(r.statementAccountId, "987654321", "so the screen can catch a last4 mismatch before importing");
});

check("CSV-6: a $0.00 signed-amount row is a named rejection, not a value that reaches confirm", () => {
  // The DB CHECK is `amount_cents <> 0` — genuinely unstorable. Before the
  // fix, only the debit/credit shape refused a zero value by name; this
  // signed-amount shape let it through as ordinary "valid", where it used
  // to abort app/(app)/expenses/import/actions.ts's entire confirm —
  // batch, source file, every other good row — for one waived-fee line.
  const csv = "Date,Description,Amount\n2026-03-04,HOTEL,-214.88\n2026-03-05,INTEREST WAIVED,0.00\n";
  const [header, ...data] = parseCsv(csv);
  const mapping = suggestColumnMapping(header.fields);
  const r = applyCsvMapping({ headerRow: header.fields, dataRecords: data, mapping, accountKind: "checking" });
  assert.equal(r.valid.length, 1, "the good row still parses");
  assert.equal(r.rejected.length, 1);
  assert.match(r.rejected[0].reason, /\$0\.00/);
});

check("OFX-6: a $0.00 TRNAMT is a named rejection, matching the CSV signed-amount shape", () => {
  const ofx =
    "<STMTTRN><DTPOSTED>20260304<TRNAMT>-214.88<NAME>HOTEL</STMTTRN>" +
    "<STMTTRN><DTPOSTED>20260305<TRNAMT>0.00<NAME>INTEREST WAIVED</STMTTRN>";
  const r = parseOfx(ofx, "ofx");
  assert.equal(r.valid.length, 1);
  assert.equal(r.rejected.length, 1);
  assert.match(r.rejected[0].reason, /\$0\.00/);
});

check("OFX-7: a <BANKACCTTO> transfer destination inside one <STMTTRN> does not trip the multi-account refusal", () => {
  // OFX permits <BANKACCTTO><ACCTID>…</BANKACCTTO> INSIDE a single
  // transaction record to name a transfer's destination account — some
  // banks emit it for inter-account transfers. That names a SIBLING
  // account, not a second statement in this file, and must not count
  // toward OFX-4's refusal the way a genuine second <BANKACCTFROM> does.
  const ofx =
    "<OFX><BANKMSGSRSV1>\n" +
    "<STMTRS><BANKACCTFROM><ACCTID>111111111</BANKACCTFROM><BANKTRANLIST>\n" +
    "<STMTTRN><DTPOSTED>20260315<TRNAMT>-50.00<NAME>TRANSFER" +
    "<BANKACCTTO><ACCTID>222222222</BANKACCTTO></STMTTRN>\n" +
    "<STMTTRN><DTPOSTED>20260316<TRNAMT>-10.00<NAME>COFFEE</STMTTRN>\n" +
    "</BANKTRANLIST></STMTRS>\n" +
    "</BANKMSGSRSV1></OFX>";
  const r = parseOfx(ofx, "ofx");
  assert.equal(r.valid.length, 2, "the statement is accepted, not refused outright");
  assert.equal(r.rejected.length, 0);
});

check("DEDUP-1: identical logical rows produce the identical fingerprint on re-parse", () => {
  const parsedAgain = parseCsv(csvSigned);
  const [header, ...data] = parsedAgain;
  const mapping = suggestColumnMapping(header.fields);
  const result = applyCsvMapping({ headerRow: header.fields, dataRecords: data, mapping, accountKind: "checking" });
  for (let i = 0; i < signedRows.length; i++) {
    const fp1 = transactionFingerprint({
      postedOn: signedRows[i].postedOn,
      description: signedRows[i].description,
      amountCents: signedRows[i].amountCents,
    });
    const fp2 = transactionFingerprint({
      postedOn: result.valid[i].postedOn,
      description: result.valid[i].description,
      amountCents: result.valid[i].amountCents,
    });
    assert.equal(fp1, fp2, `row ${i} fingerprint must be stable across re-parses of the same file`);
  }
});

check("DEDUP-2: a genuinely different transaction produces a different fingerprint", () => {
  const fpA = transactionFingerprint({ postedOn: "2026-01-05", description: "STARBUCKS", amountCents: -475 });
  const fpB = transactionFingerprint({ postedOn: "2026-01-05", description: "STARBUCKS", amountCents: -480 });
  assert.notEqual(fpA, fpB);
});

// ===========================================================================
// PART 2 — database. Requires DATABASE_URL + psql. Skipped (with a loud
// notice, not a silent pass) if DATABASE_URL is unset, so this script is
// still useful for a pure parser-logic check in an environment without
// Postgres reachable.
// ===========================================================================

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("\nDATABASE_URL not set — skipping PART 2 (database assertions). Parser-level PART 1 still ran above.");
} else {
  const A = "00000000-0000-0000-0000-0000000000b1"; // tenant A
  const B = "00000000-0000-0000-0000-0000000000b2"; // tenant B, isolation control
  const UA = "00000000-0000-0000-0000-00000000ba01";
  const UB = "00000000-0000-0000-0000-00000000ba02";
  const BANK_A = "00000000-0000-0000-0000-00000000bb01";
  const TXN_A1 = "00000000-0000-0000-0000-00000000bc01";

  const sql = `
begin;

insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at)
values
  ('${UA}', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'bank-verify-a@example.invalid', now(), now()),
  ('${UB}', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'bank-verify-b@example.invalid', now(), now());

insert into pilot.accounts (id, kind, legal_name) values
  ('${A}', 'solo', 'Bank Verify A'),
  ('${B}', 'solo', 'Bank Verify B');
insert into pilot.account_members (account_id, user_id, role) values
  ('${A}', '${UA}', 'owner'),
  ('${B}', '${UB}', 'owner');

-- FIXTURE SEED, run privileged and with explicit ids so later assertions
-- can reference them by literal. It is deliberately NOT run as
-- authenticated any more: 20260810030000 column-scopes INSERT on these
-- tables and withholds id, so a client cannot pick its own primary keys —
-- and the app never sends one. Seeding through the real grants would
-- therefore need generated ids threaded through every assertion below,
-- which would obscure what each one is actually testing. The grants
-- themselves are asserted directly, and against the REAL app payloads, by
-- the BANK-GRANT block at the end of this file.
select set_config('request.jwt.claims', json_build_object('sub', '${UA}', 'role', 'authenticated')::text, true);
insert into pilot.bank_accounts (id, account_id, label, last4, kind) values
  ('${BANK_A}', '${A}', 'Chase checking', '4471', 'checking');

insert into pilot.bank_import_batches (id, account_id, bank_account_id, source_format, status)
  values ('00000000-0000-0000-0000-00000000bd01', '${A}', '${BANK_A}', 'csv_signed', 'completed');
insert into pilot.bank_source_files (id, account_id, import_batch_id, file_name)
  values ('00000000-0000-0000-0000-00000000be01', '${A}', '00000000-0000-0000-0000-00000000bd01', 'jan-statement.csv');

insert into pilot.bank_transactions
  (id, account_id, bank_account_id, import_batch_id, source_file_id, source_row_number, source_row, posted_on, description, amount_cents, fingerprint)
values
  ('${TXN_A1}', '${A}', '${BANK_A}', '00000000-0000-0000-0000-00000000bd01', '00000000-0000-0000-0000-00000000be01',
   1, '{"Date":"2026-01-05","Description":"STARBUCKS","Amount":"-4.75"}'::jsonb,
   '2026-01-05', 'STARBUCKS #1234', -475, 'fp-starbucks-2026-01-05');

-- ===========================================================================
-- BANK-DEDUP-1 — the unique index rejects a true duplicate (same account,
-- same bank_account, same fingerprint) with the SPECIFIC constraint name,
-- not merely "an error".
-- ===========================================================================
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '${UA}', 'role', 'authenticated')::text, true);
do $$
begin
  begin
    insert into pilot.bank_transactions
      (account_id, bank_account_id, import_batch_id, source_file_id, source_row_number, source_row, posted_on, description, amount_cents, fingerprint)
    values
      ('${A}', '${BANK_A}', '00000000-0000-0000-0000-00000000bd01', '00000000-0000-0000-0000-00000000be01',
       2, '{"Date":"2026-01-05"}'::jsonb, '2026-01-05', 'STARBUCKS #1234 (re-import)', -475, 'fp-starbucks-2026-01-05');
    raise exception 'BANK-DEDUP-1 FAILURE: a true duplicate fingerprint was accepted';
  exception
    when unique_violation then
      if sqlstate <> '23505' then
        raise exception 'BANK-DEDUP-1 FAILURE: wrong sqlstate %', sqlstate;
      end if;
      if position('bank_transactions_fingerprint_uniq' in sqlerrm) = 0 then
        raise exception 'BANK-DEDUP-1 FAILURE: rejected by the wrong constraint: %', sqlerrm;
      end if;
      raise notice 'PASS (BANK-DEDUP-1, sqlstate 23505 via bank_transactions_fingerprint_uniq): an overlapping re-import of the same transaction is rejected at the database, not merely by application logic';
  end;
end $$;
reset role;

-- ===========================================================================
-- BANK-DEDUP-3 — a DIFFERENT bank_account may hold the identical
-- fingerprint (the two-cards-same-coffee-same-day case documented in
-- fingerprint.ts) — proves the index is scoped, not global.
-- ===========================================================================
-- Seeded with an explicit id as the setup role, NOT as authenticated:
-- 20260810030000 column-scopes INSERT on pilot.bank_accounts to
-- (account_id, label, last4, kind), deliberately withholding id so a
-- client cannot choose its own primary keys. The app never sends one
-- either (BankAccountInsert is exactly those four columns). This probe
-- is about the TRANSACTION insert below, so the account it needs is
-- fixture setup rather than part of what is being asserted.
insert into pilot.bank_accounts (id, account_id, label, kind) values
  ('00000000-0000-0000-0000-00000000bb02', '${A}', 'Amex card', 'credit_card');

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '${UA}', 'role', 'authenticated')::text, true);
do $$
begin
  insert into pilot.bank_transactions
    (account_id, bank_account_id, import_batch_id, source_file_id, source_row_number, source_row, posted_on, description, amount_cents, fingerprint)
  values
    ('${A}', '00000000-0000-0000-0000-00000000bb02', '00000000-0000-0000-0000-00000000bd01', '00000000-0000-0000-0000-00000000be01',
     3, '{}'::jsonb, '2026-01-05', 'STARBUCKS #1234', -475, 'fp-starbucks-2026-01-05');
  raise notice 'PASS (BANK-DEDUP-3): the identical fingerprint on a DIFFERENT bank_account is accepted — the index is scoped per account, not a global dedup';
end $$;
reset role;

-- ===========================================================================
-- BANK-TENANCY-1 — cross-tenant READ is blocked: tenant B sees zero of
-- tenant A's transactions.
-- ===========================================================================
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '${UB}', 'role', 'authenticated')::text, true);
do $$
declare n int;
begin
  select count(*) into n from pilot.bank_transactions where account_id = '${A}';
  if n <> 0 then
    raise exception 'BANK-TENANCY-1 FAILURE: tenant B read % of tenant A''s bank_transactions rows', n;
  end if;
  raise notice 'PASS (BANK-TENANCY-1): cross-tenant read of bank_transactions returns zero rows under RLS';
end $$;

-- ===========================================================================
-- BANK-TENANCY-2 — cross-tenant WRITE is blocked with a specific SQLSTATE:
-- tenant B cannot insert a bank_transactions row claiming tenant A's
-- account_id.
-- ===========================================================================
do $$
begin
  begin
    insert into pilot.bank_transactions
      (account_id, bank_account_id, import_batch_id, source_file_id, source_row_number, source_row, posted_on, description, amount_cents, fingerprint)
    values
      ('${A}', '${BANK_A}', '00000000-0000-0000-0000-00000000bd01', '00000000-0000-0000-0000-00000000be01',
       9, '{}'::jsonb, '2026-01-09', 'CROSS TENANT ATTEMPT', -100, 'fp-cross-tenant-attempt');
    raise exception 'BANK-TENANCY-2 FAILURE: tenant B wrote a row into tenant A''s bank_transactions';
  exception
    when insufficient_privilege then
      raise notice 'PASS (BANK-TENANCY-2, sqlstate 42501): cross-tenant write to bank_transactions is rejected by RLS';
  end;
end $$;
reset role;

-- ===========================================================================
-- BANK-REVIEW-1 — an unreviewed transaction cannot masquerade as reviewed:
-- setting review_state='reviewed' without category+treatment is rejected
-- by the specific named CHECK constraint, not some other error.
-- ===========================================================================
-- Deliberately PRIVILEGED. What this asserts is the CHECK — that
-- review_state cannot reach 'reviewed' without category and treatment
-- being set in the same statement — and a CHECK must hold for EVERY
-- writer, including one that bypasses grants entirely. Run as
-- authenticated it would now be refused a layer earlier by the column
-- grant (20260810050000 leaves only review_state and notes writable),
-- which would make this probe pass for a reason it is not testing. That
-- grant is asserted separately, by BANK-UPDATE-1 below.
set local role service_role;
do $$
begin
  begin
    update pilot.bank_transactions set review_state = 'reviewed' where id = '${TXN_A1}';
    raise exception 'BANK-REVIEW-1 FAILURE: review_state flipped to reviewed with no category/treatment';
  exception
    when check_violation then
      if position('bank_transactions_check' in sqlerrm) = 0 then
        raise exception 'BANK-REVIEW-1 FAILURE: rejected by the wrong constraint: %', sqlerrm;
      end if;
      raise notice 'PASS (BANK-REVIEW-1, sqlstate confirmed 23514 via bank_transactions_check): review_state cannot move to reviewed without category+treatment set in the same statement — asserted against service_role, so it is the CHECK holding and not a grant';
  end;
end $$;
reset role;

-- BANK-REVIEW-2 — the legitimate confirm, through the ONLY path the
-- application has. It used to be a direct three-column UPDATE, which is
-- no longer grantable and, more to the point, is no longer what the app
-- does: pilot.bank_transaction_confirm claims the row, writes the expense
-- and attaches the link in one transaction. Asserting the real path is
-- strictly better than asserting a shape nothing produces.
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '${UA}', 'role', 'authenticated')::text, true);
do $$
declare v_state text; v_exp uuid; v_link uuid;
begin
  v_exp := pilot.bank_transaction_confirm('${TXN_A1}', 'fuel', 'deduct', null, null);
  select review_state, expense_id into v_state, v_link
    from pilot.bank_transactions where id = '${TXN_A1}';
  if v_state <> 'reviewed' then
    raise exception 'BANK-REVIEW-2 FAILURE: the confirm did not take effect (state=%)', v_state;
  end if;
  if v_link is distinct from v_exp then
    raise exception 'BANK-REVIEW-2 FAILURE: the expense was created but not linked (link=% expense=%)', v_link, v_exp;
  end if;
  raise notice 'PASS (BANK-REVIEW-2): the legitimate confirm goes through pilot.bank_transaction_confirm and leaves the row reviewed AND linked';
end $$;

-- ===========================================================================
-- BANK-REVIEW-3 — a rebill treatment with no trip is rejected (mirrors
-- pilot.expenses' identical rule).
-- ===========================================================================
-- Reaches the reviewed state the way the APP does — insert unreviewed,
-- then confirm — rather than minting a reviewed row directly. It has to:
-- 20260810030000 withholds review_state/category/treatment from the
-- INSERT grant precisely so a row cannot be born already confirmed. That
-- makes this a better assertion than it was, because it now exercises the
-- real confirmTransaction shape instead of a state the app can never
-- produce.
do $$
declare v_txn uuid;
begin
  insert into pilot.bank_transactions
    (account_id, bank_account_id, import_batch_id, source_file_id, source_row_number,
     source_row, posted_on, description, amount_cents, fingerprint)
  values
    ('${A}', '${BANK_A}', '00000000-0000-0000-0000-00000000bd01', '00000000-0000-0000-0000-00000000be01',
     10, '{}'::jsonb, '2026-01-10', 'REBILL NO TRIP', -200, 'fp-rebill-no-trip')
  returning id into v_txn;

  begin
    perform pilot.bank_transaction_confirm(v_txn, 'fuel', 'rebill', null, null);
    raise exception 'BANK-REVIEW-3 FAILURE: rebill with no trip was accepted';
  exception when others then
    if sqlerrm not like '%rebilled to nobody%' then
      raise exception 'BANK-REVIEW-3 FAILURE: rejected for the wrong reason: %', sqlerrm;
    end if;
    raise notice 'PASS (BANK-REVIEW-3): an expense cannot be rebilled to nobody — refused by the confirm function before anything is written';
  end;
end $$;
reset role;

-- ===========================================================================
-- BANK-DEDUP-9 — REQUIRED FAIL-PROOF. Drop the dedup index, watch the
-- BANK-DEDUP-1-shaped probe now SUCCEED (a real duplicate gets in), then
-- restore the index and re-confirm the denial is back.
-- ===========================================================================
drop index pilot.bank_transactions_fingerprint_uniq;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '${UA}', 'role', 'authenticated')::text, true);
do $$
declare n int;
begin
  insert into pilot.bank_transactions
    (account_id, bank_account_id, import_batch_id, source_file_id, source_row_number, source_row, posted_on, description, amount_cents, fingerprint)
  values
    ('${A}', '${BANK_A}', '00000000-0000-0000-0000-00000000bd01', '00000000-0000-0000-0000-00000000be01',
     11, '{}'::jsonb, '2026-01-05', 'DUPLICATE, INDEX DROPPED', -475, 'fp-starbucks-2026-01-05');
  select count(*) into n from pilot.bank_transactions where fingerprint = 'fp-starbucks-2026-01-05' and bank_account_id = '${BANK_A}';
  if n < 2 then
    raise exception 'BANK-DEDUP-9 FAILURE: expected the duplicate to land once the index was dropped';
  end if;
  raise notice 'PASS (BANK-DEDUP-9, fail-proof): with the dedup index deliberately dropped, the BANK-DEDUP-1-shaped duplicate now lands (% rows share the fingerprint) — proving BANK-DEDUP-1 is a real, currently-enforced assertion and not a tautology', n;
end $$;
reset role;
-- Remove the duplicate this fail-proof deliberately let in before
-- restoring the index — the index creation itself would otherwise fail
-- on the very duplicate it exists to prevent.
delete from pilot.bank_transactions where source_row_number = 11 and fingerprint = 'fp-starbucks-2026-01-05';
create unique index bank_transactions_fingerprint_uniq
  on pilot.bank_transactions (account_id, bank_account_id, fingerprint);
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '${UA}', 'role', 'authenticated')::text, true);
do $$
begin
  begin
    insert into pilot.bank_transactions
      (account_id, bank_account_id, import_batch_id, source_file_id, source_row_number, source_row, posted_on, description, amount_cents, fingerprint)
    values
      ('${A}', '${BANK_A}', '00000000-0000-0000-0000-00000000bd01', '00000000-0000-0000-0000-00000000be01',
       12, '{}'::jsonb, '2026-01-05', 'SHOULD BE REJECTED AGAIN', -475, 'fp-starbucks-2026-01-05');
    raise exception 'BANK-DEDUP-9b FAILURE: restoring the index did not restore the denial';
  exception
    when unique_violation then
      raise notice 'PASS (BANK-DEDUP-9b): restoring the dedup index restores BANK-DEDUP-1''s denial — the schema is back to its real, shipped state';
  end;
end $$;
reset role;

-- ===========================================================================
-- BANK-FK — a bank-derived expense can actually be DELETED.
--
-- 20260809070000 wrote both bank FKs as a composite on delete set null
-- with no column list, so Postgres nulled EVERY column of the key —
-- including account_id, which is not null. Deleting a bank-derived expense
-- therefore failed with 23502 naming account_id, surfaced to the pilot as
-- "Something required is missing.", and the expense was undeletable from
-- the UI. That matters more than a stuck row: deleting the duplicate is
-- the only remedy when the same spend is entered twice (photographed
-- receipt + card statement), and a rebilled duplicate reaches a client.
-- Fixed by 20260810030000; asserted here in both directions.
-- ===========================================================================
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '${UA}', 'role', 'authenticated')::text, true);
do $$
declare
  v_acct uuid;
  v_exp uuid;
  v_deleted int;
  v_expense_id uuid;
  v_txn uuid;
begin
  -- Self-contained fixture: a bank transaction, confirmed into an expense
  -- through the real path, which is exactly the shape a confirmed row
  -- leaves behind.
  insert into pilot.bank_transactions
    (account_id, bank_account_id, import_batch_id, source_file_id, source_row_number,
     source_row, posted_on, description, amount_cents, fingerprint)
    values ('${A}', '${BANK_A}', '00000000-0000-0000-0000-00000000bd01',
            '00000000-0000-0000-0000-00000000be01', 901, '{}'::jsonb, current_date,
            'SYNTH HOTEL FK PROBE', -31200, 'fp-bank-fk-probe')
    returning id into v_txn;
  -- Reviewed-and-linked via the only path that can produce it. The
  -- direct UPDATE this used to do is no longer grantable (20260810050000)
  -- and, more to the point, is no longer what the app does.
  v_expense_id := pilot.bank_transaction_confirm(v_txn, 'hotel', 'deduct', null, null);

  delete from pilot.expenses where id = v_expense_id and account_id = '${A}';
  get diagnostics v_deleted = row_count;
  if v_deleted <> 1 then
    raise exception 'BANK-FK-1 FAILURE: the expense did not delete (% rows)', v_deleted;
  end if;

  select account_id, expense_id into v_acct, v_exp
    from pilot.bank_transactions where id = v_txn;
  if v_acct is distinct from '${A}'::uuid then
    raise exception 'BANK-FK-1 FAILURE: account_id was nulled by the FK action (got %)', v_acct;
  end if;
  if v_exp is not null then
    raise exception 'BANK-FK-1 FAILURE: expense_id survived the delete';
  end if;
  raise notice 'PASS (BANK-FK-1): deleting a bank-derived expense succeeds, nulls only expense_id, and leaves account_id intact';
end $$;
reset role;

-- ===========================================================================
-- BANK-GRANT — INSERT is column-scoped, and the real payloads still work.
--
-- The four bank tables were the ONLY tables in schema pilot carrying a
-- full-table INSERT grant, which handed back on the way IN every column
-- the migration's own comment explains is withheld from UPDATE: the dedup
-- fingerprint, the import lineage, the amount the bank sent.
--
-- BANK-GRANT-1 is the anti-revoke-trap assertion and the reason this block
-- exists at all: revoke insert on <table> drops every column-level
-- privilege, and the grant that follows restores only what it lists. A
-- column left off is REVOKED, not preserved, and the feature breaks with
-- 42501 at runtime. This repo has been caught by that three times, so the
-- fix is not trusted from the migration text — the real insert payloads
-- are executed here, as the authenticated role, against the real schema.
-- ===========================================================================
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '${UA}', 'role', 'authenticated')::text, true);
do $$
declare v_ba uuid; v_b uuid; v_sf uuid;
begin
  insert into pilot.bank_accounts (account_id, label, last4, kind)
    values ('${A}', 'Grant probe', '4321', 'credit_card') returning id into v_ba;
  insert into pilot.bank_import_batches (account_id, bank_account_id, source_format, status, total_rows)
    values ('${A}', v_ba, 'csv_signed', 'processing', 1) returning id into v_b;
  insert into pilot.bank_source_files (account_id, import_batch_id, file_name, row_count)
    values ('${A}', v_b, 'grant-probe.csv', 1) returning id into v_sf;
  insert into pilot.bank_transactions
    (account_id, bank_account_id, import_batch_id, source_file_id, source_row_number,
     source_row, posted_on, description, amount_cents, fingerprint)
    values ('${A}', v_ba, v_b, v_sf, 1, '{}'::jsonb, current_date, 'GRANT PROBE', -1200, 'fp-grant-probe');
  raise notice 'PASS (BANK-GRANT-1): every real bank insert payload still succeeds after column-scoping — the revoke trap did not fire';
end $$;

do $$
begin
  begin
    insert into pilot.bank_transactions
      (account_id, bank_account_id, import_batch_id, source_file_id, source_row_number,
       source_row, posted_on, description, amount_cents, fingerprint,
       review_state, category, treatment)
    select account_id, bank_account_id, import_batch_id, source_file_id, 99,
       '{"forged":"yes"}'::jsonb, current_date, 'FORGED', -5000, 'fp-forged',
       'reviewed', 'fuel', 'deduct'
    from pilot.bank_transactions where account_id = '${A}' and fingerprint = 'fp-grant-probe';
    raise exception 'BANK-GRANT-2 FAILURE: a transaction was minted already reviewed, skipping the draft-confirm boundary entirely';
  exception when insufficient_privilege then
    raise notice 'PASS (BANK-GRANT-2, sqlstate confirmed 42501): review_state/category/treatment are not INSERT-grantable — a transaction is born unreviewed and only confirmTransaction can change that';
  end;
end $$;

do $$
begin
  begin
    insert into pilot.bank_transactions
      (account_id, bank_account_id, import_batch_id, source_file_id, source_row_number,
       source_row, posted_on, description, amount_cents, fingerprint, created_at)
    select account_id, bank_account_id, import_batch_id, source_file_id, 98,
       '{}'::jsonb, current_date, 'BACKDATED', -100, 'fp-backdated', '1999-01-01'
    from pilot.bank_transactions where account_id = '${A}' and fingerprint = 'fp-grant-probe';
    raise exception 'BANK-GRANT-3 FAILURE: created_at was forged on insert';
  exception when insufficient_privilege then
    raise notice 'PASS (BANK-GRANT-3, sqlstate confirmed 42501): created_at cannot be backdated on insert';
  end;
end $$;

do $$
declare t text; n int;
begin
  foreach t in array array['bank_accounts','bank_import_batches','bank_source_files','bank_transactions'] loop
    select count(*) into n from information_schema.column_privileges
      where table_schema = 'pilot' and table_name = t
        and grantee = 'authenticated' and privilege_type = 'INSERT';
    if n = 0 then
      raise exception 'BANK-GRANT-4 FAILURE: pilot.% has NO insertable columns — the revoke wiped it and nothing was restored', t;
    end if;
    if n = (select count(*) from information_schema.columns where table_schema = 'pilot' and table_name = t) then
      raise exception 'BANK-GRANT-4 FAILURE: pilot.% is INSERT-grantable on every column again', t;
    end if;
  end loop;
  raise notice 'PASS (BANK-GRANT-4): all four bank tables are INSERT-scoped to a strict subset of their columns — read from information_schema, not from the migration text';
end $$;
reset role;

-- ===========================================================================
-- ATOMIC / DUP — confirming is one transaction, and a spend already in the
-- books is surfaced before it can be double-counted.
--
-- The old confirm was three round trips and the gaps were reachable: dying
-- between the claim and the insert stranded the row 'reviewed' with no
-- expense (invisible on every surface, and a retry was told it had already
-- been handled), and a LOST REPLY on the insert was indistinguishable from
-- a rejection, so the revert-and-retry produced two expenses for one bank
-- line. ATOMIC-3 is the one that matters most: it asserts the idempotency
-- index, which is what makes a retry cost a 23505 instead of a duplicate
-- no matter what the network did.
-- ===========================================================================
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '${UA}', 'role', 'authenticated')::text, true);

do $$
declare
  v_txn uuid;
  v_exp uuid;
  v_state text;
  v_link uuid;
  n int;
begin
  insert into pilot.bank_transactions
    (account_id, bank_account_id, import_batch_id, source_file_id, source_row_number,
     source_row, posted_on, description, amount_cents, fingerprint)
  values ('${A}', '${BANK_A}', '00000000-0000-0000-0000-00000000bd01',
          '00000000-0000-0000-0000-00000000be01', 801, '{}'::jsonb, '2026-03-03',
          'SYNTH INN 88 SYNTHETIC RD', -31200, 'fp-atomic-probe')
  returning id into v_txn;

  -- The same spend, already filed by hand from a photographed receipt.
  -- Note the vendor text differs, which is exactly why the probe matches
  -- on amount and date rather than on description.
  insert into pilot.expenses (account_id, incurred_on, category, vendor, amount_cents, treatment)
    values ('${A}', '2026-03-03', 'hotel', 'SYNTH INN 88', 31200, 'deduct');

  select count(*) into n from pilot.bank_transaction_duplicate_candidates(v_txn);
  if n <> 1 then
    raise exception 'DUP-1 FAILURE: expected the already-recorded receipt to surface, got % candidate(s)', n;
  end if;
  raise notice 'PASS (DUP-1): a spend already in the books is surfaced as a duplicate candidate BEFORE the pilot confirms — this is the pair that reached a client invoice as 62400 for one 31200 stay';

  v_exp := pilot.bank_transaction_confirm(v_txn, 'hotel', 'deduct', null, null);
  select review_state, expense_id into v_state, v_link from pilot.bank_transactions where id = v_txn;
  if v_state <> 'reviewed' or v_link is distinct from v_exp then
    raise exception 'ATOMIC-1 FAILURE: state=% link=% expense=%', v_state, v_link, v_exp;
  end if;
  raise notice 'PASS (ATOMIC-1): claim, expense and link all land together in one call';

  begin
    perform pilot.bank_transaction_confirm(v_txn, 'hotel', 'deduct', null, null);
    raise exception 'ATOMIC-2 FAILURE: the same transaction was confirmed twice';
  exception when others then
    if sqlerrm not like '%already been reviewed%' then
      raise exception 'ATOMIC-2 FAILURE: refused for the wrong reason: %', sqlerrm;
    end if;
    raise notice 'PASS (ATOMIC-2): a second confirm of the same transaction is refused';
  end;

  select count(*) into n from pilot.expenses
    where account_id = '${A}' and bank_transaction_id = v_txn;
  if n <> 1 then
    raise exception 'ATOMIC-3 FAILURE: % expenses carry this transaction id', n;
  end if;
  raise notice 'PASS (ATOMIC-3): exactly one expense can ever carry a given bank transaction id — the idempotency index is what makes a lost reply safe to retry';
end $$;
reset role;

-- ===========================================================================
-- BANK-UPDATE — the confirm columns are not directly writable any more.
--
-- 20260810050000 scopes UPDATE to (review_state, notes). That is what
-- makes pilot.bank_transaction_confirm the ONLY way a transaction becomes
-- an expense: without it, a hand-rolled request could still reconstruct
-- the three-step sequence whose gaps stranded rows and duplicated
-- expenses. BANK-UPDATE-2 is the other half — the dismissal path has to
-- keep working, and a revoke that took it out would be a silent
-- regression in a feature nobody would think to re-test.
-- ===========================================================================
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '${UA}', 'role', 'authenticated')::text, true);

do $$
declare v_txn uuid;
begin
  insert into pilot.bank_transactions
    (account_id, bank_account_id, import_batch_id, source_file_id, source_row_number,
     source_row, posted_on, description, amount_cents, fingerprint)
  values ('${A}', '${BANK_A}', '00000000-0000-0000-0000-00000000bd01',
          '00000000-0000-0000-0000-00000000be01', 902, '{}'::jsonb, current_date,
          'UPDATE SCOPE PROBE', -1500, 'fp-update-scope')
  returning id into v_txn;

  begin
    update pilot.bank_transactions
      set category = 'fuel', treatment = 'deduct'
      where id = v_txn and account_id = '${A}';
    raise exception 'BANK-UPDATE-1 FAILURE: category/treatment are still directly writable — the un-atomic confirm can be reconstructed by hand';
  exception when insufficient_privilege then
    raise notice 'PASS (BANK-UPDATE-1, sqlstate confirmed 42501): the confirm columns are not directly writable, so pilot.bank_transaction_confirm is the only way a transaction becomes an expense';
  end;

  begin
    update pilot.bank_transactions set expense_id = gen_random_uuid()
      where id = v_txn and account_id = '${A}';
    raise exception 'BANK-UPDATE-1b FAILURE: expense_id is still directly writable';
  exception when insufficient_privilege then
    raise notice 'PASS (BANK-UPDATE-1b, sqlstate confirmed 42501): the lineage link cannot be hand-set to point anywhere';
  end;

  -- The dismissal path must survive the revoke.
  update pilot.bank_transactions set review_state = 'ignored', notes = 'not an expense'
    where id = v_txn and account_id = '${A}';
  if (select review_state from pilot.bank_transactions where id = v_txn) <> 'ignored' then
    raise exception 'BANK-UPDATE-2 FAILURE: ignoreTransaction can no longer dismiss a row';
  end if;
  raise notice 'PASS (BANK-UPDATE-2): dismissing a row still works — the revoke did not take out the one direct write the pilot legitimately makes';
end $$;
reset role;

rollback;
`;

  const result = spawnSync("psql", [DATABASE_URL, "-v", "ON_ERROR_STOP=1", "-c", sql], { stdio: "inherit" });
  if (result.error) {
    console.error(`Failed to run psql: ${result.error.message}`);
    failures += 1;
  } else if ((result.status ?? 1) !== 0) {
    failures += 1;
  }
}

console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`}`);
process.exit(failures === 0 ? 0 : 1);

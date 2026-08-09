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

check("CSV-2: the SAME credit_card account flips a signed purchase to negative", () => {
  const parsed = parseCsv(csvSigned);
  const [header, ...data] = parsed;
  const mapping = suggestColumnMapping(header.fields);
  const result = applyCsvMapping({ headerRow: header.fields, dataRecords: data, mapping, accountKind: "credit_card" });
  // A credit card issuer writes a purchase as POSITIVE; our canonical sign
  // is negative-for-expense, so row 1 (-4.75 in the raw file, i.e. what
  // the issuer would call a NEGATIVE = a credit/refund on their own
  // statement) flips to +4.75 canonical, and row 3's parenthesized
  // (89.99) — the issuer's refund/credit notation — flips to +89.99
  // canonical. This is intentionally the mirror image of CSV-1's checking
  // result for the identical input file, proving the flip is real and
  // account-kind-driven, not a no-op.
  assert.equal(result.valid[0].amountCents, 475);
  assert.equal(result.valid[2].amountCents, 8999);
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
  assert.equal(result.valid[1].description, "CLIENT WIRE — March retainer");
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

set local role authenticated;
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
reset role;

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
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '${UA}', 'role', 'authenticated')::text, true);
insert into pilot.bank_accounts (id, account_id, label, kind) values
  ('00000000-0000-0000-0000-00000000bb02', '${A}', 'Amex card', 'credit_card');
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
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '${UA}', 'role', 'authenticated')::text, true);
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
      raise notice 'PASS (BANK-REVIEW-1, sqlstate 23514 via bank_transactions_check): review_state cannot move to reviewed without category+treatment set in the same statement';
  end;
end $$;
-- The legitimate confirm — all three together — succeeds.
update pilot.bank_transactions
  set review_state = 'reviewed', category = 'fuel', treatment = 'deduct'
  where id = '${TXN_A1}';
do $$
declare v_state text;
begin
  select review_state into v_state from pilot.bank_transactions where id = '${TXN_A1}';
  if v_state <> 'reviewed' then
    raise exception 'BANK-REVIEW-2 FAILURE: legitimate confirm (state+category+treatment together) did not take effect';
  end if;
  raise notice 'PASS (BANK-REVIEW-2): the legitimate confirm — review_state, category and treatment set together — succeeds';
end $$;

-- ===========================================================================
-- BANK-REVIEW-3 — a rebill treatment with no trip is rejected (mirrors
-- pilot.expenses' identical rule).
-- ===========================================================================
do $$
begin
  begin
    insert into pilot.bank_transactions
      (account_id, bank_account_id, import_batch_id, source_file_id, source_row_number, source_row, posted_on, description, amount_cents, fingerprint, review_state, category, treatment, trip_id)
    values
      ('${A}', '${BANK_A}', '00000000-0000-0000-0000-00000000bd01', '00000000-0000-0000-0000-00000000be01',
       10, '{}'::jsonb, '2026-01-10', 'REBILL NO TRIP', -200, 'fp-rebill-no-trip', 'reviewed', 'fuel', 'rebill', null);
    raise exception 'BANK-REVIEW-3 FAILURE: rebill with no trip was accepted';
  exception
    when check_violation then
      if position('bank_transactions_check1' in sqlerrm) = 0 then
        raise exception 'BANK-REVIEW-3 FAILURE: rejected by the wrong constraint: %', sqlerrm;
      end if;
      raise notice 'PASS (BANK-REVIEW-3, sqlstate 23514 via bank_transactions_check1): an expense cannot be rebilled to nobody';
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

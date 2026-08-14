import test from "node:test";
import assert from "node:assert/strict";

const {
  presentedBalanceCents,
  assembleBalanceSheet,
  assembleCashFlow,
  parseJournalLines,
  parsePositiveDollarsToCents,
  shiftIsoDate,
  reconciliationTotals,
} = await import("../app/(app)/accounting/ledger-lib.ts");

const {
  GENERAL_LEDGER_HEADER,
  generalLedgerRowValues,
  assembleGeneralLedger,
  sourceReference,
  centsToDollarsString,
} = await import("../lib/accounting-export.ts");

/**
 * The accounting assembly layer. All fixtures synthetic. The database
 * guarantees (RLS, debits=credits, idempotent posting) live in
 * scripts/accounting-verify.mjs against real Postgres; these tests pin the
 * PURE arithmetic between the database's rows and the screens:
 *
 * 1. SIGN PRESENTATION: the ledger hands back raw signed sums (debits
 *    positive); liabilities/equity/income present negated. Getting this
 *    flip wrong shows a pilot "-$37,125 of sales tax collected".
 * 2. THE BALANCE-SHEET IDENTITY is computed from raw sums, not the
 *    filtered display lines, so hiding a zero-balance archived account
 *    can never fake (or break) the identity.
 * 3. MONEY PARSING is integer-exact ("8.15" -> 815, never 814.999...).
 * 4. FORM PARSING refuses the unbalanced entry BEFORE the database does,
 *    with a message naming both sums.
 */

function balanceRow(overrides) {
  return {
    chart_account_id: crypto.randomUUID(),
    name: "Account",
    kind: "asset",
    system_key: null,
    archived: false,
    balance_cents: 0,
    line_count: 0,
    ...overrides,
  };
}

test("presentedBalanceCents flips only the credit-natural kinds", () => {
  assert.equal(presentedBalanceCents("asset", 500), 500);
  assert.equal(presentedBalanceCents("expense", 500), 500);
  assert.equal(presentedBalanceCents("liability", -500), 500);
  assert.equal(presentedBalanceCents("equity", -500), 500);
  assert.equal(presentedBalanceCents("income", -500), 500);
});

test("assembleBalanceSheet: assets = liabilities + equity + net income", () => {
  // Cash 1688.00 DR, AR 3096.25 DR; tax -371.25 CR; income -4500 CR,
  // expense 312 DR, owner contributions -225 CR: the smoke-test ledger.
  const rows = [
    balanceRow({ name: "Cash & bank", kind: "asset", system_key: "bank", balance_cents: 168800 }),
    balanceRow({ name: "Accounts receivable", kind: "asset", balance_cents: 309625 }),
    balanceRow({ name: "Sales tax collected", kind: "liability", balance_cents: -37125 }),
    balanceRow({ name: "Day rate", kind: "income", balance_cents: -450000 }),
    balanceRow({ name: "Per diem", kind: "income", balance_cents: -22500 }),
    balanceRow({ name: "Hotels", kind: "expense", balance_cents: 31200 }),
    balanceRow({ name: "Vehicle mileage", kind: "expense", balance_cents: 7000 }),
    balanceRow({ name: "Owner contributions", kind: "equity", balance_cents: -7000 }),
  ];
  const sheet = assembleBalanceSheet(rows);
  assert.equal(sheet.totalAssetsCents, 478425);
  assert.equal(sheet.netIncomeToDateCents, 434300);
  assert.equal(sheet.totalLiabilitiesAndEquityCents, 37125 + 7000 + 434300);
  assert.equal(sheet.balances, true);
});

test("assembleBalanceSheet: a corrupt ledger reads as NOT balancing", () => {
  const sheet = assembleBalanceSheet([
    balanceRow({ kind: "asset", balance_cents: 1000 }),
    balanceRow({ kind: "liability", balance_cents: -999 }),
  ]);
  assert.equal(sheet.balances, false);
});

test("assembleBalanceSheet: zero-balance archived accounts hide from display but never from the identity", () => {
  const rows = [
    balanceRow({ name: "Cash", kind: "asset", balance_cents: 100 }),
    balanceRow({ name: "Old thing", kind: "asset", archived: true, balance_cents: 0 }),
    balanceRow({ name: "Old with history", kind: "asset", archived: true, balance_cents: 50 }),
    balanceRow({ name: "Income", kind: "income", balance_cents: -150 }),
  ];
  const sheet = assembleBalanceSheet(rows);
  assert.equal(sheet.assets.lines.length, 2); // zero-balance archived hidden
  assert.equal(sheet.totalAssetsCents, 150);
  assert.equal(sheet.balances, true);
});

test("assembleCashFlow ties opening + net to closing, and splits directions", () => {
  const rows = [
    {
      chart_account_id: "a",
      name: "Accounts receivable",
      kind: "asset",
      system_key: "accounts_receivable",
      cash_cents: 200000,
      entry_count: 2,
    },
    {
      chart_account_id: "b",
      name: "Hotels",
      kind: "expense",
      system_key: "expense_hotel",
      cash_cents: -31200,
      entry_count: 1,
    },
  ];
  const flow = assembleCashFlow(rows, 1000, 1000 + 200000 - 31200);
  assert.equal(flow.inflowTotalCents, 200000);
  assert.equal(flow.outflowTotalCents, -31200);
  assert.equal(flow.netCents, 168800);
  assert.equal(flow.ties, true);
  const wrong = assembleCashFlow(rows, 1000, 999);
  assert.equal(wrong.ties, false);
});

test("parsePositiveDollarsToCents is integer-exact and refuses junk", () => {
  assert.equal(parsePositiveDollarsToCents("8.15"), 815);
  assert.equal(parsePositiveDollarsToCents("3500"), 350000);
  assert.equal(parsePositiveDollarsToCents("1,250.50"), 125050);
  assert.equal(parsePositiveDollarsToCents("$12.00"), 1200);
  assert.equal(parsePositiveDollarsToCents("0"), null); // zero is not a line
  assert.equal(parsePositiveDollarsToCents("-5"), null); // direction is the side, never a sign
  assert.equal(parsePositiveDollarsToCents("12.345"), null); // sub-cent
  assert.equal(parsePositiveDollarsToCents(""), null);
  assert.equal(parsePositiveDollarsToCents("abc"), null);
});

const ACC1 = "11111111-1111-4111-8111-111111111111";
const ACC2 = "22222222-2222-4222-8222-222222222222";

test("parseJournalLines accepts a balanced two-line entry and skips blank spare rows", () => {
  const parsed = parseJournalLines(
    [ACC1, ACC2, ""],
    ["debit", "credit", "debit"],
    ["2500.00", "2500.00", ""]
  );
  assert.equal(parsed.ok, true);
  assert.equal(parsed.lines.length, 2);
  assert.equal(parsed.debitCents, 250000);
  assert.equal(parsed.creditCents, 250000);
});

test("parseJournalLines refuses an unbalanced entry, naming both sums", () => {
  const parsed = parseJournalLines([ACC1, ACC2], ["debit", "credit"], ["10.00", "9.00"]);
  assert.equal(parsed.ok, false);
  assert.match(parsed.error, /10\.00/);
  assert.match(parsed.error, /9\.00/);
});

test("parseJournalLines enforces the two-line minimum and per-line validity", () => {
  assert.equal(parseJournalLines([ACC1], ["debit"], ["10.00"]).ok, false);
  assert.equal(parseJournalLines([], [], []).ok, false);
  const badSide = parseJournalLines([ACC1, ACC2], ["debit", "sideways"], ["10.00", "10.00"]);
  assert.equal(badSide.ok, false);
  assert.match(badSide.error, /Line 2/);
  const badAccount = parseJournalLines(["nope", ACC2], ["debit", "credit"], ["10.00", "10.00"]);
  assert.equal(badAccount.ok, false);
  assert.match(badAccount.error, /Line 1/);
});

test("shiftIsoDate crosses months, years, and the leap day correctly", () => {
  assert.equal(shiftIsoDate("2026-03-01", -1), "2026-02-28");
  assert.equal(shiftIsoDate("2028-03-01", -1), "2028-02-29"); // leap year
  assert.equal(shiftIsoDate("2026-01-01", -1), "2025-12-31");
  assert.equal(shiftIsoDate("2026-12-31", 1), "2027-01-01");
});

test("reconciliationTotals: difference is statement minus ledger, unmoved by matching", () => {
  // Statement: -31200, +200000, -9999. Ledger: -31200, +200000, -250000.
  const statement = [-31200, 200000, -9999];
  const ledger = [-31200, 200000, -250000];
  const none = reconciliationTotals(statement, ledger, 0, 0);
  const some = reconciliationTotals(statement, ledger, 2, 2);
  assert.equal(none.differenceCents, 158801 - -81200); // 240001
  assert.equal(none.differenceCents, some.differenceCents); // matching never moves it
  assert.equal(some.unmatchedStatementCount, 1);
  assert.equal(some.unmatchedLedgerCount, 1);
  assert.equal(some.reconciled, false); // a non-zero difference is never reconciled
});

test("reconciliationTotals: a zero net difference with dangling lines is NOT reconciled", () => {
  // +100 and -50 on the statement, +70 and -20 in the ledger: both sides
  // net to +50, so the DIFFERENCE is zero — yet nothing is matched and four
  // lines are unexplained. Declaring that "reconciled" is the exact lie this
  // guard exists to stop.
  const netZero = reconciliationTotals([10000, -5000], [7000, -2000], 0, 0);
  assert.equal(netZero.differenceCents, 0);
  assert.equal(netZero.unmatchedStatementCount, 2);
  assert.equal(netZero.unmatchedLedgerCount, 2);
  assert.equal(netZero.reconciled, false);

  // Reconciled ONLY when the difference is zero AND every line is matched.
  const cleared = reconciliationTotals([10000, -5000], [10000, -5000], 2, 2);
  assert.equal(cleared.differenceCents, 0);
  assert.equal(cleared.unmatchedStatementCount, 0);
  assert.equal(cleared.unmatchedLedgerCount, 0);
  assert.equal(cleared.reconciled, true);

  // Difference zero but one side still dangling is likewise not reconciled.
  const halfCleared = reconciliationTotals([10000, -5000], [10000, -5000], 2, 1);
  assert.equal(halfCleared.differenceCents, 0);
  assert.equal(halfCleared.reconciled, false);
});

// ---------------------------------------------------------------------------
// General ledger CSV export (lib/accounting-export.ts).
// ---------------------------------------------------------------------------

function entry(overrides) {
  return {
    id: "e1",
    entry_date: "2026-01-15",
    memo: "Test entry",
    source_type: "manual",
    source_id: null,
    created_at: "2026-01-15T00:00:00Z",
    ...overrides,
  };
}

function line(overrides) {
  return {
    id: "l1",
    entry_id: "e1",
    chart_account_id: "c1",
    side: "debit",
    amount_cents: 1000,
    line_no: 0,
    ...overrides,
  };
}

test("generalLedgerRowValues emits one column per header, in order", () => {
  const row = generalLedgerRowValues({
    entryId: "e1",
    entryDate: "2026-01-15",
    memo: "Owner draw",
    accountCode: "owner_draws",
    accountName: "Owner draws",
    side: "debit",
    amountCents: 50000,
    sourceReference: "Manual entry",
  });
  assert.equal(row.length, GENERAL_LEDGER_HEADER.length);
  assert.deepEqual(row, [
    "2026-01-15",
    "owner_draws",
    "Owner draws",
    "Owner draw",
    "500.00",
    "",
    "Manual entry",
    "e1",
  ]);
});

test("generalLedgerRowValues puts the amount on ONLY the line's own side", () => {
  // A CPA-shaped GL never writes "0.00" on the unused side — that would
  // read as a real (zero) posting rather than "this side isn't used".
  const debitRow = generalLedgerRowValues({
    entryId: "e1",
    entryDate: "2026-01-15",
    memo: "m",
    accountCode: null,
    accountName: "Cash & bank",
    side: "debit",
    amountCents: 100,
    sourceReference: "Manual entry",
  });
  assert.equal(debitRow[4], "1.00"); // Debit
  assert.equal(debitRow[5], ""); // Credit

  const creditRow = generalLedgerRowValues({
    entryId: "e1",
    entryDate: "2026-01-15",
    memo: "m",
    accountCode: null,
    accountName: "Cash & bank",
    side: "credit",
    amountCents: 100,
    sourceReference: "Manual entry",
  });
  assert.equal(creditRow[4], ""); // Debit
  assert.equal(creditRow[5], "1.00"); // Credit
});

test("sourceReference: manual has no id, derived entries carry the source row's id", () => {
  assert.equal(sourceReference("manual", null), "Manual entry");
  assert.equal(
    sourceReference("invoice_issued", "inv-123"),
    "Invoice issued: inv-123"
  );
  // An unrecognized source type still produces something rather than
  // throwing — same "fall back to the raw value" posture as the other
  // export label maps in this product.
  assert.equal(sourceReference("something_new", "x"), "something_new: x");
});

test("centsToDollarsString: integer cents, never float drift", () => {
  assert.equal(centsToDollarsString(0), "0.00");
  assert.equal(centsToDollarsString(815), "8.15");
  assert.equal(centsToDollarsString(100000), "1000.00");
});

test("assembleGeneralLedger: balanced pairs land adjacent, in book order", () => {
  const chartById = new Map([
    ["bank", { id: "bank", name: "Cash & bank", system_key: "bank" }],
    ["ar", { id: "ar", name: "Accounts receivable", system_key: "accounts_receivable" }],
    ["draws", { id: "draws", name: "Owner draws", system_key: "owner_draws" }],
  ]);
  const entries = [
    entry({ id: "e2", entry_date: "2026-01-20", created_at: "2026-01-20T00:00:00Z" }),
    entry({ id: "e1", entry_date: "2026-01-10", created_at: "2026-01-10T00:00:00Z" }),
  ];
  const lines = [
    // e2's lines inserted out of line_no order, and before e1's in the
    // input array, so a naive pass-through would misorder both facts.
    line({ id: "l3", entry_id: "e2", chart_account_id: "draws", side: "debit", line_no: 1 }),
    line({ id: "l4", entry_id: "e2", chart_account_id: "bank", side: "credit", line_no: 0 }),
    line({ id: "l1", entry_id: "e1", chart_account_id: "bank", side: "debit", line_no: 0 }),
    line({ id: "l2", entry_id: "e1", chart_account_id: "ar", side: "credit", line_no: 1 }),
  ];

  const rows = assembleGeneralLedger(entries, lines, chartById);

  assert.deepEqual(
    rows.map((r) => r.entryId + "/" + r.side),
    ["e1/debit", "e1/credit", "e2/credit", "e2/debit"]
  );
  // Within e2, line_no order (0 then 1) wins even though the raw `lines`
  // array had them reversed.
  assert.deepEqual(
    rows.filter((r) => r.entryId === "e2").map((r) => r.accountName),
    ["Cash & bank", "Owner draws"]
  );
});

test("assembleGeneralLedger: an unresolved chart account reads 'Unknown account', never blank", () => {
  const rows = assembleGeneralLedger(
    [entry({})],
    [line({ chart_account_id: "missing" })],
    new Map()
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].accountName, "Unknown account");
  assert.equal(rows[0].accountCode, null);
});

test("assembleGeneralLedger: a line whose entry can't be found is dropped, not guessed at", () => {
  const rows = assembleGeneralLedger([], [line({ entry_id: "ghost" })], new Map());
  assert.equal(rows.length, 0);
});

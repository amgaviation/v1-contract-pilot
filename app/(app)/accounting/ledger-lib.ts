/**
 * Pure assembly for the accounting surfaces — no I/O, no Supabase, no Next
 * imports, so tests/accounting-lib.test.mjs can exercise it directly (the
 * same split as reports/sales-tax/report-lib.ts). Everything here consumes
 * the rows pilot.ledger_balances / pilot.ledger_cash_flow return; nothing
 * here recomputes a figure the database already computed.
 *
 * SIGN CONVENTION, once: the database hands back RAW SIGNED sums, debits
 * positive. Assets and expenses are natural-debit (a positive raw sum is a
 * normal balance); liabilities, equity and income are natural-credit (a
 * NEGATIVE raw sum is a normal balance, so their presented balance is the
 * negation). `presentedBalanceCents` is the only place that flip happens.
 */

export type ChartKind = "asset" | "liability" | "equity" | "income" | "expense";

export const KIND_LABEL: Record<ChartKind, string> = {
  asset: "Assets",
  liability: "Liabilities",
  equity: "Equity",
  income: "Income",
  expense: "Expenses",
};

export const KIND_ORDER: readonly ChartKind[] = [
  "asset",
  "liability",
  "equity",
  "income",
  "expense",
];

export type LedgerBalanceRow = {
  chart_account_id: string;
  name: string;
  kind: ChartKind;
  system_key: string | null;
  archived: boolean;
  balance_cents: number;
  line_count: number;
};

/** Raw signed sum (debits positive) → the balance a reader expects to see
 *  for that account kind. */
export function presentedBalanceCents(kind: ChartKind, rawCents: number): number {
  return kind === "asset" || kind === "expense" ? rawCents : -rawCents;
}

// ---------------------------------------------------------------------------
// Balance sheet.
// ---------------------------------------------------------------------------

export type BalanceSheetLine = {
  chartAccountId: string;
  name: string;
  archived: boolean;
  balanceCents: number;
};

export type BalanceSheetSection = {
  kind: ChartKind;
  label: string;
  lines: BalanceSheetLine[];
  totalCents: number;
};

export type BalanceSheet = {
  assets: BalanceSheetSection;
  liabilities: BalanceSheetSection;
  equity: BalanceSheetSection;
  /**
   * Income minus expenses over the ledger's whole life through the as-of
   * date. There are no closing entries in this product, so this is the
   * "Retained earnings" line a conventional balance sheet would carry —
   * presented inside Equity as its own labelled row.
   */
  netIncomeToDateCents: number;
  totalAssetsCents: number;
  /** Liabilities + equity accounts + net income to date. */
  totalLiabilitiesAndEquityCents: number;
  /**
   * THE accounting identity. False means the ledger itself is corrupt
   * (which the deferred debits-equal-credits trigger exists to make
   * unreachable) — the page must REFUSE to render figures rather than
   * show a sheet that silently doesn't balance.
   */
  balances: boolean;
};

function section(
  kind: ChartKind,
  rows: LedgerBalanceRow[]
): BalanceSheetSection {
  const lines = rows
    .filter((r) => r.kind === kind)
    // Zero-balance archived accounts are noise; zero-balance ACTIVE
    // accounts stay visible so a new tenant sees their chart exists.
    .filter((r) => !r.archived || r.balance_cents !== 0)
    .map((r) => ({
      chartAccountId: r.chart_account_id,
      name: r.name,
      archived: r.archived,
      balanceCents: presentedBalanceCents(kind, r.balance_cents),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return {
    kind,
    label: KIND_LABEL[kind],
    lines,
    totalCents: lines.reduce((sum, l) => sum + l.balanceCents, 0),
  };
}

export function assembleBalanceSheet(rows: LedgerBalanceRow[]): BalanceSheet {
  const assets = section("asset", rows);
  const liabilities = section("liability", rows);
  const equity = section("equity", rows);

  // Net income from the RAW sums so archived-account filtering above can
  // never distort it: income raw sums are credit-negative, expenses
  // debit-positive, so income − expenses = −(sum of both raw).
  const netIncomeToDateCents = -rows
    .filter((r) => r.kind === "income" || r.kind === "expense")
    .reduce((sum, r) => sum + r.balance_cents, 0);

  const totalAssetsCents = assets.totalCents;
  const totalLiabilitiesAndEquityCents =
    liabilities.totalCents + equity.totalCents + netIncomeToDateCents;

  return {
    assets,
    liabilities,
    equity,
    netIncomeToDateCents,
    totalAssetsCents,
    totalLiabilitiesAndEquityCents,
    balances: totalAssetsCents === totalLiabilitiesAndEquityCents,
  };
}

// ---------------------------------------------------------------------------
// Cash flow.
// ---------------------------------------------------------------------------

/** "YYYY-MM-DD" shifted by whole days in the UTC date domain — the same
 *  no-timezone-round-trip rule as lib/format.ts's parseCalendarDate. */
export function shiftIsoDate(iso: string, deltaDays: number): string {
  const parts = iso.split("-");
  const dt = new Date(
    Date.UTC(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]) + deltaDays)
  );
  const m = dt.getUTCMonth() + 1;
  const d = dt.getUTCDate();
  return `${dt.getUTCFullYear()}-${m < 10 ? `0${m}` : m}-${d < 10 ? `0${d}` : d}`;
}

export type CashFlowRow = {
  chart_account_id: string;
  name: string;
  kind: ChartKind;
  system_key: string | null;
  cash_cents: number;
  entry_count: number;
};

export type CashFlowLine = {
  chartAccountId: string;
  name: string;
  kind: ChartKind;
  cashCents: number;
  entryCount: number;
};

export type CashFlow = {
  inflows: CashFlowLine[];
  outflows: CashFlowLine[];
  inflowTotalCents: number;
  /** Negative (money out). */
  outflowTotalCents: number;
  netCents: number;
  openingCents: number;
  closingCents: number;
  /**
   * opening + net === closing, both read from the same ledger. False
   * means the two queries disagree (e.g. one failed part-way) — refuse to
   * render, never show a statement that doesn't tie.
   */
  ties: boolean;
};

/**
 * `rows` are the counterpart attributions pilot.ledger_cash_flow returns
 * (positive = cash in); `openingCents`/`closingCents` are the Cash & bank
 * account's presented balance from pilot.ledger_balances at the day before
 * the period and at the period end.
 */
export function assembleCashFlow(
  rows: CashFlowRow[],
  openingCents: number,
  closingCents: number
): CashFlow {
  const toLine = (r: CashFlowRow): CashFlowLine => ({
    chartAccountId: r.chart_account_id,
    name: r.name,
    kind: r.kind,
    cashCents: r.cash_cents,
    entryCount: r.entry_count,
  });
  const inflows = rows
    .filter((r) => r.cash_cents > 0)
    .map(toLine)
    .sort((a, b) => b.cashCents - a.cashCents);
  const outflows = rows
    .filter((r) => r.cash_cents < 0)
    .map(toLine)
    .sort((a, b) => a.cashCents - b.cashCents);
  const inflowTotalCents = inflows.reduce((s, l) => s + l.cashCents, 0);
  const outflowTotalCents = outflows.reduce((s, l) => s + l.cashCents, 0);
  const netCents = inflowTotalCents + outflowTotalCents;
  return {
    inflows,
    outflows,
    inflowTotalCents,
    outflowTotalCents,
    netCents,
    openingCents,
    closingCents,
    ties: openingCents + netCents === closingCents,
  };
}

// ---------------------------------------------------------------------------
// Manual journal entry form parsing. The form posts parallel arrays
// (line_account[], line_side[], line_amount[]); this turns them into the
// jsonb payload pilot.journal_entry_create takes, or a message the pilot
// can act on. Money parsing defers to the same split-on-the-decimal-point
// discipline as lib/format.ts's parseDollarsToCents — no float arithmetic
// near money — but is re-implemented minimally here because journal lines
// forbid the negative amounts that helper allows (direction is the side,
// never a sign).
// ---------------------------------------------------------------------------

export type JournalLineInput = {
  chart_account_id: string;
  side: "debit" | "credit";
  amount_cents: number;
};

export type ParsedJournalLines =
  | { ok: true; lines: JournalLineInput[]; debitCents: number; creditCents: number }
  | { ok: false; error: string };

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** "1234.50" → 123450, integers only, positive only, or null. */
export function parsePositiveDollarsToCents(raw: string): number | null {
  const value = raw.trim().replace(/[$,]/g, "");
  if (!/^\d{1,12}(\.\d{0,2})?$/.test(value) || value === "") return null;
  const [whole, fraction = ""] = value.split(".");
  const cents = Number(whole || "0") * 100 + Number(fraction.padEnd(2, "0") || "0");
  return cents > 0 ? cents : null;
}

export function parseJournalLines(
  accounts: string[],
  sides: string[],
  amounts: string[]
): ParsedJournalLines {
  const count = Math.max(accounts.length, sides.length, amounts.length);
  const lines: JournalLineInput[] = [];
  let debitCents = 0;
  let creditCents = 0;

  for (let i = 0; i < count; i++) {
    const account = (accounts[i] ?? "").trim();
    const side = (sides[i] ?? "").trim();
    const amountRaw = (amounts[i] ?? "").trim();
    // A fully blank row (spare row on the form) is skipped, not an error.
    if (account === "" && amountRaw === "") continue;

    if (!UUID_RE.test(account)) {
      return { ok: false, error: `Line ${i + 1}: pick an account.` };
    }
    if (side !== "debit" && side !== "credit") {
      return { ok: false, error: `Line ${i + 1}: pick debit or credit.` };
    }
    const cents = parsePositiveDollarsToCents(amountRaw);
    if (cents === null) {
      return {
        ok: false,
        error: `Line ${i + 1}: enter a positive amount like 1250 or 1250.00.`,
      };
    }
    lines.push({ chart_account_id: account, side, amount_cents: cents });
    if (side === "debit") debitCents += cents;
    else creditCents += cents;
  }

  if (lines.length < 2) {
    return { ok: false, error: "A journal entry needs at least two lines." };
  }
  if (lines.length > 30) {
    return { ok: false, error: "A journal entry can carry at most 30 lines." };
  }
  if (debitCents !== creditCents) {
    return {
      ok: false,
      error: `Debits and credits must balance: debits total ${(debitCents / 100).toFixed(2)}, credits total ${(creditCents / 100).toFixed(2)}.`,
    };
  }
  return { ok: true, lines, debitCents, creditCents };
}

// ---------------------------------------------------------------------------
// Reconciliation arithmetic. Both sides use the SAME sign convention:
// positive = money in (bank_transactions is canonically signed that way,
// and pilot.ledger_bank_lines returns signed_cents with debits positive).
// ---------------------------------------------------------------------------

export type ReconciliationTotals = {
  statementTotalCents: number;
  ledgerTotalCents: number;
  /** statement − ledger. Zero when the books fully reflect the statement. */
  differenceCents: number;
  unmatchedStatementCount: number;
  unmatchedLedgerCount: number;
  /**
   * The period is reconciled ONLY when the books fully explain the
   * statements AND nothing dangles on either side. A zero net difference
   * with unmatched lines that merely cancel (+100/−50 on the statement vs
   * +70/−20 in the ledger — both net +50) is NOT reconciled: it is four
   * unexplained lines that happen to sum the same, not a cleared period.
   * A true completed state therefore requires zero difference and zero
   * unmatched on both sides.
   */
  reconciled: boolean;
};

export function reconciliationTotals(
  statementCents: number[],
  ledgerCents: number[],
  matchedStatementCount: number,
  matchedLedgerCount: number
): ReconciliationTotals {
  const statementTotalCents = statementCents.reduce((s, v) => s + v, 0);
  const ledgerTotalCents = ledgerCents.reduce((s, v) => s + v, 0);
  const differenceCents = statementTotalCents - ledgerTotalCents;
  const unmatchedStatementCount = statementCents.length - matchedStatementCount;
  const unmatchedLedgerCount = ledgerCents.length - matchedLedgerCount;
  return {
    statementTotalCents,
    ledgerTotalCents,
    differenceCents,
    unmatchedStatementCount,
    unmatchedLedgerCount,
    reconciled:
      differenceCents === 0 &&
      unmatchedStatementCount === 0 &&
      unmatchedLedgerCount === 0,
  };
}

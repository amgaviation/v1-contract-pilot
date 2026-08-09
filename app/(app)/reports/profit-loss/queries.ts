import "server-only";
import type { createClient } from "@/lib/supabase/server";
import { yearBounds, currentTaxYear } from "../year-end/db";

type Supa = Awaited<ReturnType<typeof createClient>>;

// Same house rule as app/(app)/reports/year-end/queries.ts and
// app/(app)/reports/quarterly/queries.ts: every list query carries an
// explicit .limit(), because Supabase's Data API caps and silently
// truncates an unbounded select, and a partial P&L total presented as
// complete is exactly the "how did I do this year" number a pilot is
// asking this screen for. Two periods (current + prior) are loaded per
// request, so these are the same per-query caps as the other reports —
// not doubled — because each query is scoped to its own [start, end].
const PAYMENTS_LIMIT = 2000;
const EXPENSES_LIMIT = 2000;

// ---------------------------------------------------------------------------
// Period resolution.
//
// A P&L is only useful with a comparison, so every period this screen
// supports has a well-defined "prior period" of the SAME CALENDAR KIND —
// prior year for a year, prior calendar quarter for a quarter, prior
// calendar month for a month — computed with explicit month/year
// arithmetic, never by subtracting a day-count from a date. Day-count
// subtraction looks equivalent until a leap year: 2028 is 366 days, so
// "start of 2028 minus 365 days" lands on 2026-12-31, not 2027-01-01,
// which would silently misdate the entire prior-year comparison by a
// day. Only "custom" (an arbitrary pilot-chosen range) falls back to a
// day-count-shifted window, because there is no calendar unit to align
// it to — that limitation is called out in the UI copy for that mode.
//
// All bounds are plain "YYYY-MM-DD" strings compared directly against
// Postgres `date` columns, same discipline as yearBounds in
// app/(app)/reports/year-end/db.ts — no JS Date round-trip, no
// timezone conversion.
// ---------------------------------------------------------------------------

export type PLPeriodKind = "year" | "quarter" | "month" | "mtd" | "custom";

export type PLPeriod = {
  kind: PLPeriodKind;
  label: string;
  start: string;
  end: string;
  priorLabel: string;
  priorStart: string;
  priorEnd: string;
  /** True only for "custom" — the prior window is day-shifted, not a calendar unit. */
  priorIsApproximate: boolean;
};

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** Splits a "YYYY-MM-DD" string into three plain numbers, never `undefined`. */
function parseIsoParts(iso: string): { y: number; m: number; d: number } {
  const parts = iso.split("-");
  return { y: Number(parts[0]), m: Number(parts[1]), d: Number(parts[2]) };
}

function daysInMonth(year: number, month1to12: number): number {
  // Day 0 of the next month is the last day of this one.
  return new Date(Date.UTC(year, month1to12, 0)).getUTCDate();
}

function monthBounds(year: number, month1to12: number): { start: string; end: string } {
  const end = daysInMonth(year, month1to12);
  return {
    start: `${year}-${pad2(month1to12)}-01`,
    end: `${year}-${pad2(month1to12)}-${pad2(end)}`,
  };
}

function quarterBounds(year: number, quarter1to4: number): { start: string; end: string } {
  const firstMonth = (quarter1to4 - 1) * 3 + 1;
  const start = monthBounds(year, firstMonth).start;
  const end = monthBounds(year, firstMonth + 2).end;
  return { start, end };
}

const QUARTER_LABEL = ["Q1", "Q2", "Q3", "Q4"];
const MONTH_LABEL = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** Days between two "YYYY-MM-DD" strings, computed in the UTC date domain. */
function daysBetween(startIso: string, endIso: string): number {
  const s = parseIsoParts(startIso);
  const e = parseIsoParts(endIso);
  const start = Date.UTC(s.y, s.m - 1, s.d);
  const end = Date.UTC(e.y, e.m - 1, e.d);
  return Math.round((end - start) / 86_400_000);
}

function shiftIsoDate(iso: string, deltaDays: number): string {
  const p = parseIsoParts(iso);
  const dt = new Date(Date.UTC(p.y, p.m - 1, p.d + deltaDays));
  return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
}

/** Today, "YYYY-MM-DD", read in UTC — same rule as currentTaxYear() in ../year-end/db.ts. */
function todayIso(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${pad2(now.getUTCMonth() + 1)}-${pad2(now.getUTCDate())}`;
}

export type PLPeriodParams = {
  kind?: string;
  year?: string;
  quarter?: string;
  month?: string;
  start?: string;
  end?: string;
};

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Resolves the ?kind=/?year=/?quarter=/?month=/?start=/?end= search params
 * into a concrete period + its prior-period comparison window. Defaults to
 * the current calendar year, mirroring how year-end and quarterly default
 * their own ?year= param.
 */
export function resolvePLPeriod(params: PLPeriodParams): PLPeriod {
  const current = currentTaxYear();
  const yearNum = Number(params.year);
  const year =
    params.year && Number.isInteger(yearNum) && yearNum >= 2000 && yearNum <= 2100
      ? yearNum
      : current;

  const kind: PLPeriodKind =
    params.kind === "quarter" || params.kind === "month" ||
    params.kind === "mtd" || params.kind === "custom"
      ? params.kind
      : "year";

  if (kind === "quarter") {
    const qNum = Number(params.quarter);
    const quarter = Number.isInteger(qNum) && qNum >= 1 && qNum <= 4 ? qNum : 1;
    const { start, end } = quarterBounds(year, quarter);
    const priorQuarter = quarter === 1 ? 4 : quarter - 1;
    const priorYear = quarter === 1 ? year - 1 : year;
    const prior = quarterBounds(priorYear, priorQuarter);
    return {
      kind,
      label: `${QUARTER_LABEL[quarter - 1]} ${year}`,
      start,
      end,
      priorLabel: `${QUARTER_LABEL[priorQuarter - 1]} ${priorYear}`,
      priorStart: prior.start,
      priorEnd: prior.end,
      priorIsApproximate: false,
    };
  }

  if (kind === "month") {
    const mNum = Number(params.month);
    const month = Number.isInteger(mNum) && mNum >= 1 && mNum <= 12 ? mNum : 1;
    const { start, end } = monthBounds(year, month);
    const priorMonth = month === 1 ? 12 : month - 1;
    const priorYear = month === 1 ? year - 1 : year;
    const prior = monthBounds(priorYear, priorMonth);
    return {
      kind,
      label: `${MONTH_LABEL[month - 1]} ${year}`,
      start,
      end,
      priorLabel: `${MONTH_LABEL[priorMonth - 1]} ${priorYear}`,
      priorStart: prior.start,
      priorEnd: prior.end,
      priorIsApproximate: false,
    };
  }

  if (kind === "mtd") {
    // Month-to-date: the 1st of the current UTC month through today.
    // Compared against the SAME day-of-month cutoff one calendar month
    // earlier, clamped to that month's own length (so "MTD through the
    // 31st" compared against February reads as "through the 28th/29th",
    // not an out-of-range date).
    const today = todayIso();
    const { y: ty, m: tm, d: td } = parseIsoParts(today);
    const start = monthBounds(ty, tm).start;
    const priorMonth = tm === 1 ? 12 : tm - 1;
    const priorYear = tm === 1 ? ty - 1 : ty;
    const priorDay = Math.min(td, daysInMonth(priorYear, priorMonth));
    return {
      kind,
      label: `${MONTH_LABEL[tm - 1]} 1–${td}, ${ty} (month to date)`,
      start,
      end: today,
      priorLabel: `${MONTH_LABEL[priorMonth - 1]} 1–${priorDay}, ${priorYear}`,
      priorStart: monthBounds(priorYear, priorMonth).start,
      priorEnd: `${priorYear}-${pad2(priorMonth)}-${pad2(priorDay)}`,
      priorIsApproximate: false,
    };
  }

  if (kind === "custom") {
    const start = params.start && ISO_DATE_RE.test(params.start) ? params.start : yearBounds(year).start;
    const end = params.end && ISO_DATE_RE.test(params.end) ? params.end : yearBounds(year).end;
    const [safeStart, safeEnd] = start <= end ? [start, end] : [end, start];
    // No calendar unit to align a custom range to, so the prior window is
    // simply the same number of days immediately before it — an
    // approximation, flagged via priorIsApproximate for the UI to caveat.
    const lengthDays = daysBetween(safeStart, safeEnd) + 1;
    const priorEnd = shiftIsoDate(safeStart, -1);
    const priorStart = shiftIsoDate(priorEnd, -(lengthDays - 1));
    return {
      kind,
      label: `${safeStart} – ${safeEnd}`,
      start: safeStart,
      end: safeEnd,
      priorLabel: `${priorStart} – ${priorEnd}`,
      priorStart,
      priorEnd,
      priorIsApproximate: true,
    };
  }

  // Default / "year".
  const bounds = yearBounds(year);
  const priorBounds = yearBounds(year - 1);
  return {
    kind: "year",
    label: `${year}`,
    start: bounds.start,
    end: bounds.end,
    priorLabel: `${year - 1}`,
    priorStart: priorBounds.start,
    priorEnd: priorBounds.end,
    priorIsApproximate: false,
  };
}

// ---------------------------------------------------------------------------
// Report shape.
// ---------------------------------------------------------------------------

export type IncomeByClient = {
  clientId: string;
  clientName: string;
  totalCents: number;
  paymentCount: number;
};

export type ExpenseByCategory = {
  category: string;
  totalCents: number;
  count: number;
};

/** current vs. prior for one figure. `hasPriorData` false means the prior
 *  period had zero underlying rows — show "no prior data", not a
 *  misleading "+100%" or "−100%" change against a true zero. */
export type Comparison = {
  currentCents: number;
  priorCents: number;
  hasPriorData: boolean;
  deltaCents: number;
  /** Percent change, or null when hasPriorData is false (nothing to divide by,
   *  and even priorCents === 0 with hasPriorData true — a real, recorded zero
   *  period — makes a percent change undefined; deltaCents still carries the
   *  full answer in that case). */
  deltaPercent: number | null;
};

function compare(currentCents: number, priorCents: number, priorRowCount: number): Comparison {
  const hasPriorData = priorRowCount > 0;
  const deltaCents = currentCents - priorCents;
  const deltaPercent = hasPriorData && priorCents !== 0 ? (deltaCents / Math.abs(priorCents)) * 100 : null;
  return { currentCents, priorCents, hasPriorData, deltaCents, deltaPercent };
}

type PeriodFigures = {
  incomeByClient: IncomeByClient[];
  incomeTotalCents: number;
  incomeRowCount: number;
  paymentsTruncated: boolean;

  expensesByCategory: ExpenseByCategory[];
  expensesTotalCents: number;
  expensesRowCount: number;
  deductibleTruncated: boolean;

  rebilledCostCents: number;
  rebilledCount: number;
  rebilledTruncated: boolean;

  unassignedTotalCents: number;
  unassignedCount: number;
  unassignedTruncated: boolean;

  error: string | null;
};

async function loadPeriodFigures(
  supabase: Supa,
  accountId: string,
  start: string,
  end: string,
  clientName: Map<string, string>
): Promise<PeriodFigures> {
  const [
    { data: paymentData, error: paymentsError },
    { data: deductData, error: deductError },
    { data: rebillData, error: rebillError },
    { data: unassignedData, error: unassignedError },
  ] = await Promise.all([
    // CASH-BASIS income: pilot.invoice_payments by paid_on, exactly as
    // app/(app)/reports/year-end/queries.ts section A and
    // app/(app)/reports/quarterly/queries.ts do — NOT invoices issued in
    // the period, which is accrual-basis and would make this report
    // disagree with the other two about "what did I make", which is the
    // one thing this product's "one source for one number" rule exists
    // to prevent.
    supabase
      .from("invoice_payments")
      .select("id, invoice_id, paid_on, amount_cents")
      .eq("account_id", accountId)
      .gte("paid_on", start)
      .lte("paid_on", end)
      .order("paid_on", { ascending: true })
      .limit(PAYMENTS_LIMIT),
    // Deductible expenses only (treatment = 'deduct'). This is also where
    // any recorded platform/software cost lands — the `pilot` schema has
    // no separate subscriptions/platform-fee table, so a pilot's own SaaS
    // or processing fees only show up here if they entered them as an
    // expense row (typically category 'other'). There is no other source
    // in the schema to pull a platform cost from without inventing one.
    supabase
      .from("expenses")
      .select("id, incurred_on, category, amount_cents")
      .eq("account_id", accountId)
      .eq("treatment", "deduct")
      .gte("incurred_on", start)
      .lte("incurred_on", end)
      .limit(EXPENSES_LIMIT),
    // Rebilled expenses — counted here ONLY for the informational
    // "reimbursed costs" line below, never as a P&L expense. See the
    // treatment note above loadProfitLossReport for the full reasoning:
    // the reimbursement already arrives as ordinary cash-basis income
    // through invoice_payments once the client pays, so folding the
    // original outlay into Expenses too would double-count it and
    // understate profit — the exact trap the task brief calls out.
    supabase
      .from("expenses")
      .select("id, amount_cents")
      .eq("account_id", accountId)
      .eq("treatment", "rebill")
      .gte("incurred_on", start)
      .lte("incurred_on", end)
      .limit(EXPENSES_LIMIT),
    // Unassigned receipts — neither billed nor deducted. Excluded from
    // both Income and Expenses below and surfaced as its own flagged
    // figure, same framing as year-end/quarterly: "money you're
    // currently losing in both directions."
    supabase
      .from("expenses")
      .select("id, amount_cents")
      .eq("account_id", accountId)
      .eq("treatment", "unassigned")
      .gte("incurred_on", start)
      .lte("incurred_on", end)
      .limit(EXPENSES_LIMIT),
  ]);

  const error =
    paymentsError?.message ?? deductError?.message ?? rebillError?.message ?? unassignedError?.message ?? null;

  const payments = (paymentData ?? []) as {
    id: string; invoice_id: string; paid_on: string; amount_cents: number;
  }[];
  const paymentsTruncated = payments.length === PAYMENTS_LIMIT;

  const invoiceIds = [...new Set(payments.map((p) => p.invoice_id))];
  const { data: invoiceData, error: invoiceError } = invoiceIds.length
    ? await supabase
        .from("invoices")
        .select("id, client_id")
        .eq("account_id", accountId)
        .in("id", invoiceIds)
    : { data: [] as never[], error: null };
  const invoiceClientById = new Map(
    ((invoiceData ?? []) as { id: string; client_id: string }[]).map((i) => [i.id, i.client_id])
  );

  const incomeMap = new Map<string, IncomeByClient>();
  for (const p of payments) {
    const clientId = invoiceClientById.get(p.invoice_id) ?? null;
    const name = (clientId && clientName.get(clientId)) || "Unknown client";
    const key = clientId ?? `unknown:${p.invoice_id}`;
    const existing = incomeMap.get(key);
    if (existing) {
      existing.totalCents += p.amount_cents;
      existing.paymentCount += 1;
    } else {
      incomeMap.set(key, { clientId: clientId ?? "", clientName: name, totalCents: p.amount_cents, paymentCount: 1 });
    }
  }
  const incomeByClient = [...incomeMap.values()].sort((a, b) => b.totalCents - a.totalCents);
  const incomeTotalCents = payments.reduce((sum, p) => sum + p.amount_cents, 0);

  const deductRaw = (deductData ?? []) as { id: string; category: string; amount_cents: number }[];
  const deductibleTruncated = deductRaw.length === EXPENSES_LIMIT;
  const catMap = new Map<string, ExpenseByCategory>();
  for (const e of deductRaw) {
    const existing = catMap.get(e.category);
    if (existing) {
      existing.totalCents += e.amount_cents;
      existing.count += 1;
    } else {
      catMap.set(e.category, { category: e.category, totalCents: e.amount_cents, count: 1 });
    }
  }
  const expensesByCategory = [...catMap.values()].sort((a, b) => b.totalCents - a.totalCents);
  const expensesTotalCents = deductRaw.reduce((sum, e) => sum + e.amount_cents, 0);

  const rebillRaw = (rebillData ?? []) as { id: string; amount_cents: number }[];
  const rebilledTruncated = rebillRaw.length === EXPENSES_LIMIT;
  const rebilledCostCents = rebillRaw.reduce((sum, e) => sum + e.amount_cents, 0);

  const unassignedRaw = (unassignedData ?? []) as { id: string; amount_cents: number }[];
  const unassignedTruncated = unassignedRaw.length === EXPENSES_LIMIT;
  const unassignedTotalCents = unassignedRaw.reduce((sum, e) => sum + e.amount_cents, 0);

  return {
    incomeByClient,
    incomeTotalCents,
    incomeRowCount: payments.length,
    paymentsTruncated,

    expensesByCategory,
    expensesTotalCents,
    expensesRowCount: deductRaw.length,
    deductibleTruncated,

    rebilledCostCents,
    rebilledCount: rebillRaw.length,
    rebilledTruncated,

    unassignedTotalCents,
    unassignedCount: unassignedRaw.length,
    unassignedTruncated,

    error: error ?? invoiceError?.message ?? null,
  };
}

export type ProfitLossReport = {
  period: PLPeriod;
  error: string | null;

  incomeByClient: IncomeByClient[];
  incomeComparison: Comparison;
  incomeTruncated: boolean;

  expensesByCategory: ExpenseByCategory[];
  expensesComparison: Comparison;
  expensesTruncated: boolean;

  netProfitComparison: Comparison;

  rebilledCostCents: number;
  rebilledCount: number;
  rebilledTruncated: boolean;

  unassignedTotalCents: number;
  unassignedCount: number;
  unassignedTruncated: boolean;
};

/**
 * Everything /reports/profit-loss needs, assembled from one pair of
 * queries per source table (current period + prior period), shared by the
 * screen and the CSV export — the same "one source for one number"
 * discipline as loadYearEndReport / loadQuarterlyReport, which this
 * mirrors closely.
 *
 * account-scoped throughout: every query filters on account_id even
 * though RLS is the real boundary — defence in depth, matching the note
 * in app/(app)/expenses/actions.ts.
 *
 * ---- THE REBILL DECISION -------------------------------------------------
 * `treatment = 'rebill'` expenses are excluded from Expenses here, on
 * purpose, for the same reason app/(app)/reports/year-end/queries.ts's own
 * section B (deductibleByCategory) and quarterly's deductibleCents only
 * ever read `treatment = 'deduct'`: a rebilled expense is a pass-through
 * cost the pilot fronted and gets made whole for. The reimbursement
 * arrives as an ordinary invoice_lines charge on the client's invoice and,
 * once paid, is already inside `incomeTotalCents` via invoice_payments —
 * there is no separate "reimbursement" bucket in this schema, it is
 * literally the same cash-basis income everything else in Income comes
 * from. Counting the original outlay as an Expense on top of that would
 * subtract a cost from profit whose matching inflow is already sitting in
 * Income, understating profit by roughly double the rebilled amount — the
 * exact defect the task brief warns about. Nor is it correct to drop the
 * rebilled expense from the books silently: a pilot comparing this
 * screen's Income total against their bank deposits needs to see that the
 * reimbursement they received is accounted for, which is why the
 * `rebilledCostCents` figure is still surfaced, just as an informational
 * note ("already included in income above"), not as a P&L line item, and
 * not netted against anything. This treats a fully-reimbursed rebill
 * (the ordinary case) as cash-basis-neutral, matching how year-end's own
 * section C describes the relationship. A rebilled expense that was NEVER
 * actually invoiced, or invoiced for less than it cost, is not specially
 * reconciled here — that gap is what year-end's own rebilled/reconciled
 * table is for; this screen is a summary, not a substitute for it.
 * ---------------------------------------------------------------------------
 */
export async function loadProfitLossReport(
  supabase: Supa,
  accountId: string,
  period: PLPeriod
): Promise<ProfitLossReport> {
  const { data: clientData, error: clientError } = await supabase.from("clients").select("id, name");
  const clientName = new Map(((clientData ?? []) as { id: string; name: string }[]).map((c) => [c.id, c.name]));

  const [current, prior] = await Promise.all([
    loadPeriodFigures(supabase, accountId, period.start, period.end, clientName),
    loadPeriodFigures(supabase, accountId, period.priorStart, period.priorEnd, clientName),
  ]);

  const error = clientError?.message ?? current.error ?? prior.error ?? null;

  const incomeComparison = compare(current.incomeTotalCents, prior.incomeTotalCents, prior.incomeRowCount);
  const expensesComparison = compare(current.expensesTotalCents, prior.expensesTotalCents, prior.expensesRowCount);
  const netProfitComparison = compare(
    current.incomeTotalCents - current.expensesTotalCents,
    prior.incomeTotalCents - prior.expensesTotalCents,
    // Net profit "has prior data" whenever EITHER side of the prior period
    // had rows — a period with income but no expenses (or vice versa) is
    // still a real prior period, not an absent one.
    prior.incomeRowCount + prior.expensesRowCount
  );

  return {
    period,
    error,

    incomeByClient: current.incomeByClient,
    incomeComparison,
    incomeTruncated: current.paymentsTruncated || prior.paymentsTruncated,

    expensesByCategory: current.expensesByCategory,
    expensesComparison,
    expensesTruncated: current.deductibleTruncated || prior.deductibleTruncated,

    netProfitComparison,

    rebilledCostCents: current.rebilledCostCents,
    rebilledCount: current.rebilledCount,
    rebilledTruncated: current.rebilledTruncated,

    unassignedTotalCents: current.unassignedTotalCents,
    unassignedCount: current.unassignedCount,
    unassignedTruncated: current.unassignedTruncated,
  };
}

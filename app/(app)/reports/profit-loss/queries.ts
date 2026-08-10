import { scheduleCMileageCents, type RatesByYear } from "@/lib/mileage";
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
// Same cap discipline for the two lookups defect 9 exposed: an unbounded
// `.in("id", invoiceIds)` / unbounded `clients` select silently truncates
// past the Data API cap just like the list queries above do, and a
// truncated lookup doesn't zero out the total — it quietly reassigns rows
// to "Unknown client" while incomeTotalCents stays right, which is worse
// than a wrong total because nothing on screen says the by-client table is
// short. invoiceIds is a de-duplicated set of at most PAYMENTS_LIMIT ids
// (one per payment, capped already), so INVOICE_LOOKUP_LIMIT reuses that
// bound; clients get their own cap because a pilot's client list is
// unrelated in size to their payment count.
const INVOICE_LOOKUP_LIMIT = PAYMENTS_LIMIT;
const CLIENTS_LIMIT = 2000;
// Mileage — defect 4: pilot.mileage_entries carries a real cash-equivalent
// Schedule C deduction (the standard mileage rate) that this report
// previously surfaced nowhere. It is intentionally NOT summed into
// Expenses — see the "MILEAGE" note above loadProfitLossReport for why.
const MILEAGE_LIMIT = 2000;

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

  mileageTotalCents: number;
  mileageCount: number;
  mileageTruncated: boolean;
  /**
   * Miles in range whose tax year has no rate on file, so they are NOT in
   * mileageTotalCents. Surfaced rather than silently dropped: a deduction
   * quietly missing a year's driving is worse than one that says the rate
   * is missing.
   */
  mileageMilesWithoutRate: number;

  invoiceLookupTruncated: boolean;

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
    { data: mileageData, error: mileageError },
    { data: mileageRateData, error: mileageRateError },
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
    // Rebilled expenses — a REAL cash outflow in the period incurred, and
    // counted as an Expenses sub-line below (see "THE REBILL DECISION"
    // above loadProfitLossReport — corrected; the previous version of this
    // comment argued the opposite and was wrong).
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
    // Mileage — defect 4. Deliberately EXCLUDED from the Expenses total
    // (see the "MILEAGE" note above loadProfitLossReport) and surfaced as
    // its own flagged, informational figure instead, the same shape as
    // Unassigned receipts above.
    supabase
      // drove_on and miles, NOT the per-row amount_cents. Schedule C is
      // total miles for the year x that year's rate, rounded once — see
      // lib/mileage.ts. Summing the stored per-row amounts is what made
      // this report disagree with /expenses/mileage for the same drives.
      .from("mileage_entries")
      .select("id, drove_on, miles")
      .eq("account_id", accountId)
      .gte("drove_on", start)
      .lte("drove_on", end)
      .limit(MILEAGE_LIMIT),
    // The pilot's own per-year IRS rates. Never hardcoded — the rate
    // changes annually and a baked-in figure would silently misstate every
    // year it is stale for (see the mileage_rates table comment).
    supabase
      .from("mileage_rates")
      .select("tax_year, rate_cents_per_mile")
      .eq("account_id", accountId),
  ]);

  const mileageRatesByYear: RatesByYear = Object.fromEntries(
    ((mileageRateData ?? []) as { tax_year: number; rate_cents_per_mile: number }[]).map(
      (r) => [r.tax_year, r.rate_cents_per_mile]
    )
  );

  const error =
    paymentsError?.message ??
    deductError?.message ??
    rebillError?.message ??
    // A failed rate read is not "no rate on file" — it would silently zero
    // the whole mileage deduction on a report headed for a tax filing.
    mileageRateError?.message ??
    unassignedError?.message ??
    mileageError?.message ??
    null;

  const payments = (paymentData ?? []) as {
    id: string; invoice_id: string; paid_on: string; amount_cents: number;
  }[];
  const paymentsTruncated = payments.length === PAYMENTS_LIMIT;

  const invoiceIds = [...new Set(payments.map((p) => p.invoice_id))];
  const { data: invoiceData, error: invoiceError } = invoiceIds.length
    ? await supabase
        .from("invoices")
        .select("id, client_id, status")
        .eq("account_id", accountId)
        .in("id", invoiceIds)
        .limit(INVOICE_LOOKUP_LIMIT)
    : { data: [] as never[], error: null };
  const invoiceRows = (invoiceData ?? []) as { id: string; client_id: string; status: string }[];
  // Defect 9: an unbounded `.in()` silently truncates past the Data API
  // cap just like every list query in this file — cap it explicitly and
  // fold the truncation into the same on-screen callout paymentsTruncated
  // already drives, rather than letting a capped lookup quietly reassign
  // rows to "Unknown client" while incomeTotalCents stays (deceptively)
  // right.
  const invoiceLookupTruncated = invoiceIds.length > 0 && invoiceRows.length === INVOICE_LOOKUP_LIMIT;
  const invoiceClientById = new Map(invoiceRows.map((i) => [i.id, i.client_id]));
  // Defect 1: an invoice_payments row is never deleted when its parent
  // invoice transitions to 'void' (sent/partial -> void is a legal
  // transition — see app/(app)/page.tsx's "Paid this year" KPI, which
  // already does this same filter for the dashboard). A payment against a
  // now-void invoice is not income; skip it here too so this screen and
  // the dashboard's cash-basis figure for the same period can never
  // disagree, and so app/(app)/reports/year-end/queries.ts's identical fix
  // stays in lockstep with this one.
  const voidInvoiceIds = new Set(invoiceRows.filter((i) => i.status === "void").map((i) => i.id));

  const incomeMap = new Map<string, IncomeByClient>();
  for (const p of payments) {
    if (voidInvoiceIds.has(p.invoice_id)) continue;
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
  const incomeTotalCents = payments
    .filter((p) => !voidInvoiceIds.has(p.invoice_id))
    .reduce((sum, p) => sum + p.amount_cents, 0);

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
  const deductibleTotalCents = deductRaw.reduce((sum, e) => sum + e.amount_cents, 0);

  const rebillRaw = (rebillData ?? []) as { id: string; amount_cents: number }[];
  const rebilledTruncated = rebillRaw.length === EXPENSES_LIMIT;
  const rebilledCostCents = rebillRaw.reduce((sum, e) => sum + e.amount_cents, 0);

  // Defect 2 fix: Expenses = deductible expenses + rebilled costs. The
  // rebilled outlay is a real cash outflow in the period it was incurred;
  // see "THE REBILL DECISION" above loadProfitLossReport for the corrected
  // reasoning (the previous version subtracted nothing here, which
  // overstated profit by exactly rebilledCostCents).
  const expensesTotalCents = deductibleTotalCents + rebilledCostCents;

  const unassignedRaw = (unassignedData ?? []) as { id: string; amount_cents: number }[];
  const unassignedTruncated = unassignedRaw.length === EXPENSES_LIMIT;
  const unassignedTotalCents = unassignedRaw.reduce((sum, e) => sum + e.amount_cents, 0);

  const mileageRaw = (mileageData ?? []) as {
    id: string;
    drove_on: string;
    miles: number;
  }[];
  const mileageTruncated = mileageRaw.length === MILEAGE_LIMIT;
  // The SAME function /expenses/mileage uses. Two surfaces computing one
  // deduction two ways is the defect this replaces.
  const { amountCents: mileageTotalCents, milesWithoutRate: mileageMilesWithoutRate } =
    scheduleCMileageCents(mileageRaw, mileageRatesByYear);

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

    mileageTotalCents,
    mileageMilesWithoutRate,
    mileageCount: mileageRaw.length,
    mileageTruncated,

    invoiceLookupTruncated,

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

  mileageTotalCents: number;
  mileageCount: number;
  mileageTruncated: boolean;
  /**
   * Miles in range whose tax year has no rate on file, so they are NOT in
   * mileageTotalCents. Surfaced rather than silently dropped: a deduction
   * quietly missing a year's driving is worse than one that says the rate
   * is missing.
   */
  mileageMilesWithoutRate: number;
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
 * ---- THE REBILL DECISION (CORRECTED — the earlier version of this note
 * argued the opposite and was wrong; read this if you're tempted to
 * re-derive the old conclusion) -------------------------------------------
 * `treatment = 'rebill'` expenses ARE counted in Expenses here (folded
 * into expensesTotalCents alongside deductible expenses, and still broken
 * out as its own `rebilledCostCents` figure so a pilot can see the two
 * pieces separately). They used to be excluded, on the theory that the
 * reimbursement "is already included in Income above once the client
 * pays" and counting the receipt too would double-count it. That theory
 * does not survive tracing the actual cash:
 *
 *   1. Pilot pays $500 for fuel  -> -$500 cash, period A.
 *   2. Client pays an invoice containing a $500 reimbursable_expense line
 *      -> +$500 cash, period B (or the same period; doesn't matter here).
 *   3. True net across both events: $0.
 *
 * Income on this screen is `sum(invoice_payments.amount_cents)` — the
 * WHOLE payment, with no line-level decomposition by kind. So step 2's
 * +$500 is already inside incomeTotalCents; there is no separate
 * "reimbursement" bucket that would need excluding to avoid double
 * counting. Excluding step 1's outflow, as the old version of this file
 * did, means the two legs never cancel: net profit came out overstated by
 * exactly rebilledCostCents, not understated — the double-count the old
 * comment warned about would only be real if Income were computed from
 * non-reimbursable invoice_lines only, and it isn't. The sub-cases make
 * the same point harder to miss: a rebilled expense that was NEVER
 * actually invoiced overstates profit by the full cost (there is no
 * offsetting inflow at all — the old on-screen claim that it "is already
 * included in Income above" was simply false for that row); a partially
 * paid invoice reimburses pro-rata while the old code excluded the whole
 * cost; a cost incurred in December and reimbursed in February splits
 * across tax years and never nets out within either one.
 *
 * This does NOT change what happens when a rebill is never invoiced, or
 * invoiced short — that gap is what year-end's own rebilled/reconciled
 * table (section C) is for; this screen is a period summary, not a
 * substitute for that reconciliation.
 * ---------------------------------------------------------------------------
 *
 * ---- MILEAGE (defect 4) ---------------------------------------------------
 * pilot.mileage_entries carries a real, dollar-valued Schedule C
 * deduction (the standard mileage rate — see that migration's own header,
 * which calls it "often one of the larger line items"), and until now it
 * appeared in NO report. Silently absent is the one option that is wrong
 * for a figure this size, so it is surfaced here as its own flagged,
 * informational total (`mileageTotalCents`) — the same treatment as
 * Unassigned receipts, shape (b) from the task brief rather than (a).
 * It is deliberately NOT folded into Expenses/expensesTotalCents: the same
 * migration's header explains that the standard mileage rate and actual
 * vehicle expenses (which is what a `category = 'fuel'`/`'rental_car'`
 * deduct-treatment expense records) are ALTERNATIVE methods for the same
 * vehicle, never additive, and this schema cannot tell which method a
 * pilot has elected for a given vehicle/year. Auto-adding mileage to
 * Expenses would silently double-claim for any pilot who also expenses
 * actual fuel/rental-car costs for the same vehicle — a real dollar error
 * this report has no way to detect or prevent. Surfacing it as an
 * explicit excluded figure (with its own truncation flag) lets the pilot
 * see the number and decide, without the report guessing on their behalf.
 */
export async function loadProfitLossReport(
  supabase: Supa,
  accountId: string,
  period: PLPeriod
): Promise<ProfitLossReport> {
  // Defect 9: capped, matching every other list query in this file — an
  // unbounded clients select silently truncates past the Data API cap,
  // and a pilot's client roster is not guaranteed small forever.
  const { data: clientData, error: clientError } = await supabase
    .from("clients")
    .select("id, name")
    .limit(CLIENTS_LIMIT);
  const clientRows = (clientData ?? []) as { id: string; name: string }[];
  const clientsTruncated = clientRows.length === CLIENTS_LIMIT;
  const clientName = new Map(clientRows.map((c) => [c.id, c.name]));

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
    // Defect 9: the client roster cap and the per-period invoice-id lookup
    // cap both degrade the SAME symptom (rows silently reassigned to
    // "Unknown client") as a truncated payments page, so they fold into
    // this one flag rather than needing their own separate callout.
    incomeTruncated:
      current.paymentsTruncated ||
      prior.paymentsTruncated ||
      current.invoiceLookupTruncated ||
      prior.invoiceLookupTruncated ||
      clientsTruncated,

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

    mileageTotalCents: current.mileageTotalCents,
    mileageCount: current.mileageCount,
    mileageTruncated: current.mileageTruncated,
    mileageMilesWithoutRate: current.mileageMilesWithoutRate,
  };
}

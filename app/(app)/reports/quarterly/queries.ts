import "server-only";
import type { createClient } from "@/lib/supabase/server";
import { estimatedTaxPeriods, type EstimatedTaxPeriod } from "./periods";

type Supa = Awaited<ReturnType<typeof createClient>>;

// Same house rule as app/(app)/reports/year-end/queries.ts: every list
// query carries an explicit .limit(), because Supabase's Data API caps and
// silently truncates an unbounded select, and a partial period total
// presented as complete would misstate what a pilot sets aside for a
// payment the IRS actually expects on time.
const PAYMENTS_LIMIT = 2000;
const EXPENSES_LIMIT = 2000;

export type UnassignedRow = {
  id: string;
  incurredOn: string;
  category: string;
  vendor: string | null;
  amountCents: number;
};

export type PeriodFigures = {
  period: EstimatedTaxPeriod;
  incomeCents: number;
  paymentCount: number;
  deductibleCents: number;
  expenseCount: number;
  /** incomeCents - deductibleCents. Can be negative. */
  netProfitCents: number;
  unassigned: UnassignedRow[];
  unassignedTotalCents: number;
  unassignedTruncated: boolean;
};

export type QuarterlyReport = {
  year: number;
  error: string | null;
  periods: PeriodFigures[];
  /** True if ANY period's income or expense query hit its row cap. */
  paymentsTruncated: boolean;
  deductibleTruncated: boolean;
};

/**
 * Everything the quarterly estimated-tax screen needs, assembled from one
 * set of queries shared by the screen
 * (app/(app)/reports/quarterly/page.tsx) and the CSV route
 * (app/(app)/reports/quarterly/export/route.ts) — same "one source for one
 * number" discipline as loadYearEndReport in
 * app/(app)/reports/year-end/queries.ts, which this file mirrors closely.
 *
 * account-scoped throughout: every query filters on account_id even
 * though RLS is the real boundary — defence in depth, matching the note in
 * app/(app)/expenses/actions.ts.
 *
 * No PostgREST embeds (they resolve to `never` against this app's
 * hand-authored types) — nothing here needs one anyway, since income and
 * expenses are read directly with no cross-table join required for this
 * view (unlike year-end, this screen never needs client names or invoice
 * numbers).
 *
 * Two full-year queries, split into periods IN MEMORY, rather than four
 * (or eight) separate per-period queries — one round trip for income, one
 * for deductible expenses, one for unassigned receipts, covering the
 * WHOLE year, then bucketed by period.start/end. This keeps the query
 * count constant regardless of how many periods exist and matches how
 * yearBounds-based queries already work in the year-end report.
 */
export async function loadQuarterlyReport(
  supabase: Supa,
  accountId: string,
  year: number
): Promise<QuarterlyReport> {
  const periods = estimatedTaxPeriods(year);
  // The year, from the pilot's point of view, spans Jan 1 of `year`
  // through Dec 31 of `year` — even though period 4's DUE DATE falls in
  // January of `year + 1`, the underlying income/expenses it covers
  // (Sep 1 – Dec 31) are still dated in `year`. So the fetch bound is the
  // same [Jan 1, Dec 31] a calendar-year report would use; only the due
  // date, not the fetch window, crosses the year boundary.
  const yearStart = `${year}-01-01`;
  const yearEnd = `${year}-12-31`;

  const [
    { data: paymentData, error: paymentsError },
    { data: deductData, error: deductError },
    { data: unassignedData, error: unassignedError },
  ] = await Promise.all([
    // CASH-BASIS income: one row per pilot.invoice_payments payment whose
    // paid_on falls in the tax year — NOT invoices issued/sent in the
    // year, which would be accrual-basis and is not what the IRS wants
    // reported on a given estimated-tax voucher. Same distinction, same
    // reasoning, as app/(app)/reports/year-end/queries.ts section A.
    supabase
      .from("invoice_payments")
      .select("id, paid_on, amount_cents")
      .eq("account_id", accountId)
      .gte("paid_on", yearStart)
      .lte("paid_on", yearEnd)
      .order("paid_on", { ascending: true })
      .limit(PAYMENTS_LIMIT),
    // Deductible expenses, by when they were incurred. Rebilled and
    // unassigned expenses are NOT deductions — treatment = 'deduct' only,
    // same as year-end section B.
    supabase
      .from("expenses")
      .select("id, incurred_on, amount_cents")
      .eq("account_id", accountId)
      .eq("treatment", "deduct")
      .gte("incurred_on", yearStart)
      .lte("incurred_on", yearEnd)
      .order("incurred_on", { ascending: true })
      .limit(EXPENSES_LIMIT),
    // Unassigned receipts — the actionable surface per the task brief: an
    // unassigned receipt inside a period that has already closed is a
    // deduction the pilot is about to lose. Same framing as year-end
    // section D ("money you're currently losing in both directions").
    supabase
      .from("expenses")
      .select("id, incurred_on, category, vendor, amount_cents")
      .eq("account_id", accountId)
      .eq("treatment", "unassigned")
      .gte("incurred_on", yearStart)
      .lte("incurred_on", yearEnd)
      .order("incurred_on", { ascending: true })
      .limit(EXPENSES_LIMIT),
  ]);

  const firstError =
    paymentsError?.message ??
    deductError?.message ??
    unassignedError?.message ??
    null;

  const payments = (paymentData ?? []) as {
    id: string;
    paid_on: string;
    amount_cents: number;
  }[];
  const paymentsTruncated = payments.length === PAYMENTS_LIMIT;

  const deductible = (deductData ?? []) as {
    id: string;
    incurred_on: string;
    amount_cents: number;
  }[];
  const deductibleTruncated = deductible.length === EXPENSES_LIMIT;

  const unassignedAll = (unassignedData ?? []) as {
    id: string;
    incurred_on: string;
    category: string;
    vendor: string | null;
    amount_cents: number;
  }[];
  // Truncation is checked against the WHOLE-YEAR fetch, same as the other
  // two lists above — a cap hit anywhere in the year means every period's
  // unassigned bucket downstream of it is suspect, not just the one that
  // happens to contain row #EXPENSES_LIMIT.
  const unassignedTruncatedWholeYear = unassignedAll.length === EXPENSES_LIMIT;

  const inPeriod = (dateIso: string, period: EstimatedTaxPeriod): boolean =>
    dateIso >= period.start && dateIso <= period.end;

  const periodFigures: PeriodFigures[] = periods.map((period) => {
    const periodPayments = payments.filter((p) => inPeriod(p.paid_on, period));
    const periodDeductible = deductible.filter((e) =>
      inPeriod(e.incurred_on, period)
    );
    const periodUnassignedRaw = unassignedAll.filter((e) =>
      inPeriod(e.incurred_on, period)
    );

    const incomeCents = periodPayments.reduce(
      (sum, p) => sum + p.amount_cents,
      0
    );
    const deductibleCents = periodDeductible.reduce(
      (sum, e) => sum + e.amount_cents,
      0
    );
    const unassignedTotalCents = periodUnassignedRaw.reduce(
      (sum, e) => sum + e.amount_cents,
      0
    );

    return {
      period,
      incomeCents,
      paymentCount: periodPayments.length,
      deductibleCents,
      expenseCount: periodDeductible.length,
      netProfitCents: incomeCents - deductibleCents,
      unassigned: periodUnassignedRaw.map((e) => ({
        id: e.id,
        incurredOn: e.incurred_on,
        category: e.category,
        vendor: e.vendor,
        amountCents: e.amount_cents,
      })),
      unassignedTotalCents,
      // Whole-year cap applies to every period's bucket, per the note
      // above — not recomputed per period.
      unassignedTruncated: unassignedTruncatedWholeYear,
    };
  });

  return {
    year,
    error: firstError,
    periods: periodFigures,
    paymentsTruncated,
    deductibleTruncated,
  };
}

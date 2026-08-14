import "server-only";
import type { createClient } from "@/lib/supabase/server";
import { computeYearTotals, type RatesByYear } from "@/lib/mileage";
import { estimatedTaxPeriods, type EstimatedTaxPeriod } from "./periods";

type Supa = Awaited<ReturnType<typeof createClient>>;

// Same house rule as app/(app)/reports/year-end/queries.ts: every list
// query carries an explicit .limit(), because Supabase's Data API caps and
// silently truncates an unbounded select, and a partial period total
// presented as complete would misstate what a pilot sets aside for a
// payment the IRS actually expects on time.
// 1000, not 2000. Every other call site in this codebase uses 1000 with a
// comment saying that is the Data API's cap — and truncation here is
// detected by exact equality (`payments.length === PAYMENTS_LIMIT`).
// PostgREST clamps a client limit to db-max-rows, so with the cap at 1000
// the array is 1000 long and `1000 === 2000` is false FOREVER: the guard
// could never fire, and the export routes that key their "refuse rather
// than ship a partial total" behaviour off these flags were dead code.
const PAYMENTS_LIMIT = 1000;
const EXPENSES_LIMIT = 1000;
// The void-invoice lookup below is scoped to exactly the invoices these
// payments reference (a de-duplicated set of at most PAYMENTS_LIMIT ids,
// one per payment, already capped), so this bound reuses PAYMENTS_LIMIT —
// same reasoning as app/(app)/reports/profit-loss/queries.ts's identical
// INVOICE_LOOKUP_LIMIT.
const INVOICE_LOOKUP_LIMIT = PAYMENTS_LIMIT;
// Mileage — this report used to have no query against mileage_entries at
// all, so the pilot's standard-mileage deduction appeared nowhere on this
// screen. Now queried and shown as an informational line per period (see
// PeriodFigures below) — but it is still deliberately NOT folded into
// netProfitCents, so it still does not feed the "what to set aside"
// figure; only "appeared nowhere on this screen" got fixed. Same cap
// discipline as every other list query in this file.
const MILEAGE_LIMIT = 1000;

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
  /**
   * Expenses the client reimbursed. Not a Schedule C deduction, but a real
   * cost whose matching income is already inside incomeCents — so it is
   * subtracted from net profit. Same treatment as /reports/profit-loss.
   */
  rebilledCostCents: number;
  /** incomeCents - deductibleCents - rebilledCostCents. Can be negative. */
  netProfitCents: number;
  unassigned: UnassignedRow[];
  unassignedTotalCents: number;
  unassignedTruncated: boolean;

  /**
   * Standard-mileage-rate drives incurred in this period — informational
   * only, NOT folded into netProfitCents. Same non-additive reasoning as
   * app/(app)/reports/year-end/queries.ts's identical section: the
   * standard mileage rate and actual vehicle expenses are alternative
   * deduction methods for the same vehicle, and this report can't tell
   * which one a pilot elected. Computed via lib/mileage.ts's
   * computeYearTotals on just this period's drives against the year's own
   * rate — one multiplication, one rounding, same discipline as every
   * other mileage figure in this product.
   */
  mileageCount: number;
  mileageMiles: number;
  mileageRateCentsPerMile: number | null;
  mileageAmountCents: number | null;
};

export type QuarterlyReport = {
  year: number;
  error: string | null;
  periods: PeriodFigures[];
  /** True if ANY period's income or expense query hit its row cap. */
  paymentsTruncated: boolean;
  deductibleTruncated: boolean;
  /** True if the whole-year mileage_entries fetch hit its row cap. */
  mileageTruncated: boolean;
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
    { data: rebillData, error: rebillError },
    { data: unassignedData, error: unassignedError },
    { data: mileageData, error: mileageError },
    { data: mileageRateData, error: mileageRateError },
  ] = await Promise.all([
    // CASH-BASIS income: one row per pilot.invoice_payments payment whose
    // paid_on falls in the tax year — NOT invoices issued/sent in the
    // year, which would be accrual-basis and is not what the IRS wants
    // reported on a given estimated-tax voucher. Same distinction, same
    // reasoning, as app/(app)/reports/year-end/queries.ts section A.
    supabase
      .from("invoice_payments")
      .select("id, invoice_id, paid_on, amount_cents")
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
    // REBILLED expenses. These are not deductions in the Schedule C sense
    // — the client reimbursed them — but the reimbursement is already
    // inside incomeCents above, because a payment pays the whole invoice
    // including its rebilled lines. Counting the income and not the cost
    // overstates profit by exactly this figure. /reports/profit-loss
    // reached the same conclusion under a long comment and fixed it there;
    // this report was the earlier version and never got the correction.
    supabase
      .from("expenses")
      .select("id, incurred_on, amount_cents")
      .eq("account_id", accountId)
      .eq("treatment", "rebill")
      .gte("incurred_on", yearStart)
      .lte("incurred_on", yearEnd)
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
    // Mileage — drove_on and miles ONLY, never the per-row snapshotted
    // amount_cents, per lib/mileage.ts's header. Whole-year fetch, bucketed
    // into periods below, same shape as the unassigned-receipts query above.
    // Ordered like every other list query in this file so a truncated read
    // drops a deterministic tail instead of a server-arbitrary subset that
    // would change the on-screen total on every reload.
    supabase
      .from("mileage_entries")
      .select("id, drove_on, miles")
      .eq("account_id", accountId)
      .gte("drove_on", yearStart)
      .lte("drove_on", yearEnd)
      .order("drove_on", { ascending: true })
      .limit(MILEAGE_LIMIT),
    // The pilot's own per-year IRS rate. Never hardcoded — see the
    // mileage_rates table comment for why a baked-in figure would silently
    // misstate every year it is stale for.
    supabase
      .from("mileage_rates")
      .select("tax_year, rate_cents_per_mile")
      .eq("account_id", accountId),
  ]);

  const payments = (paymentData ?? []) as {
    id: string;
    paid_on: string;
    amount_cents: number;
    invoice_id: string;
  }[];
  const paymentsRowCapped = payments.length === PAYMENTS_LIMIT;

  // Invoices, so a payment against a VOIDED one can be excluded below —
  // scoped to exactly the invoices these (already-capped) payments
  // reference, matching year-end/profit-loss's identical fix, rather than
  // the whole-account, unordered, uncapped-relative-to-anything read this
  // used to be. That old read had no ORDER BY, no status filter, and a
  // .limit() tied to nothing — once an account passed 1000 lifetime
  // invoices the returned subset was server-arbitrary, a voided invoice
  // could fall outside it, and its payments then counted as income with
  // no on-screen warning. A voided $10,825 invoice once told a pilot to
  // set aside $3,247.50 for a quarter in which they collected nothing.
  const invoiceIds = [...new Set(payments.map((p) => p.invoice_id))];
  const { data: invoiceData, error: invoiceError } = invoiceIds.length
    ? await supabase
        .from("invoices")
        .select("id, status")
        .eq("account_id", accountId)
        .in("id", invoiceIds)
        .limit(INVOICE_LOOKUP_LIMIT)
    : { data: [] as { id: string; status: string }[], error: null };
  const invoiceRows = (invoiceData ?? []) as { id: string; status: string }[];
  // Same truncation discipline as every list query in this file — folded
  // into paymentsTruncated below (not a separate flag) so both the page
  // banner and the export refusal that key off paymentsTruncated already
  // cover this lookup too.
  const invoiceLookupTruncated =
    invoiceIds.length > 0 && invoiceRows.length === INVOICE_LOOKUP_LIMIT;
  const paymentsTruncated = paymentsRowCapped || invoiceLookupTruncated;

  const firstError =
    paymentsError?.message ??
    deductError?.message ??
    // A failed invoice or rebill read is not "nothing to exclude" and not
    // "no reimbursed costs" — both would silently overstate the figure a
    // pilot sets aside for the IRS. Surfaced with the others.
    invoiceError?.message ??
    rebillError?.message ??
    unassignedError?.message ??
    mileageError?.message ??
    // A failed rate read is not "no rate on file" — it would silently zero
    // the whole mileage deduction on the screen a pilot uses to plan an
    // IRS payment. Same reasoning as year-end/profit-loss's identical check.
    mileageRateError?.message ??
    null;

  // A payment against a VOIDED invoice is not income. sent -> partial ->
  // void is a legal transition and invoice_payments rows are never
  // deleted, so such a payment sits in that table forever. The dashboard
  // KPI, /reports/profit-loss and /reports/year-end all already filter it
  // — this report did not, and it is the one wired to the "set aside this
  // much for the IRS" figure.
  const voidInvoiceIds = new Set(
    invoiceRows.filter((i) => i.status === "void").map((i) => i.id)
  );
  const livePayments = payments.filter((p) => !voidInvoiceIds.has(p.invoice_id));

  const rebilled = (rebillData ?? []) as {
    id: string;
    incurred_on: string;
    amount_cents: number;
  }[];
  const rebilledTruncated = rebilled.length === EXPENSES_LIMIT;

  const deductible = (deductData ?? []) as {
    id: string;
    incurred_on: string;
    amount_cents: number;
  }[];
  // Folded together: both feed the same "your costs are incomplete"
  // warning, and a partial rebill read understates costs exactly as a
  // partial deduct read does.
  const deductibleTruncated =
    deductible.length === EXPENSES_LIMIT || rebilledTruncated;

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

  const mileageAll = (mileageData ?? []) as {
    id: string;
    drove_on: string;
    miles: number;
  }[];
  const mileageTruncated = mileageAll.length === MILEAGE_LIMIT;
  const mileageRatesByYear: RatesByYear = Object.fromEntries(
    ((mileageRateData ?? []) as { tax_year: number; rate_cents_per_mile: number }[]).map(
      (r) => [r.tax_year, r.rate_cents_per_mile]
    )
  );

  const inPeriod = (dateIso: string, period: EstimatedTaxPeriod): boolean =>
    dateIso >= period.start && dateIso <= period.end;

  const periodFigures: PeriodFigures[] = periods.map((period) => {
    const periodPayments = livePayments.filter((p) => inPeriod(p.paid_on, period));
    const periodRebilled = rebilled.filter((e) => inPeriod(e.incurred_on, period));
    const periodDeductible = deductible.filter((e) =>
      inPeriod(e.incurred_on, period)
    );
    const periodUnassignedRaw = unassignedAll.filter((e) =>
      inPeriod(e.incurred_on, period)
    );
    const periodMileage = mileageAll.filter((e) => inPeriod(e.drove_on, period));
    // All four periods fall within the same `year`, so this is the same
    // "at most one group" reasoning as year-end/queries.ts's identical call
    // — computeYearTotals groups by the tax year read out of drove_on, and
    // every drove_on here is already bounded to `year`.
    const [periodMileageTotal] = computeYearTotals(periodMileage, mileageRatesByYear);

    const incomeCents = periodPayments.reduce(
      (sum, p) => sum + p.amount_cents,
      0
    );
    const deductibleCents = periodDeductible.reduce(
      (sum, e) => sum + e.amount_cents,
      0
    );
    // The cost side of a reimbursement. Its matching income is already in
    // incomeCents, so leaving this out overstates profit by exactly this.
    const rebilledCostCents = periodRebilled.reduce(
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
      rebilledCostCents,
      netProfitCents: incomeCents - deductibleCents - rebilledCostCents,
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

      mileageCount: periodMileage.length,
      mileageMiles: periodMileageTotal?.miles ?? 0,
      mileageRateCentsPerMile: periodMileageTotal?.rateCentsPerMile ?? null,
      mileageAmountCents: periodMileageTotal?.amountCents ?? null,
    };
  });

  return {
    year,
    error: firstError,
    periods: periodFigures,
    paymentsTruncated,
    deductibleTruncated,
    mileageTruncated,
  };
}

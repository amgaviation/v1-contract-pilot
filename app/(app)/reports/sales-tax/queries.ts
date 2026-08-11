import "server-only";
import type { createClient } from "@/lib/supabase/server";
import { rowsOf } from "@/lib/supabase/rows";
import {
  assembleSalesTaxReport,
  type SalesTaxInvoice,
  type SalesTaxLineRow,
  type SalesTaxPaymentRow,
  type SalesTaxPeriod,
  type SalesTaxRow,
  type SalesTaxTotalsRow,
} from "./report-lib";

type Supa = Awaited<ReturnType<typeof createClient>>;

/**
 * Same cap discipline as every list read in this app (see the long note in
 * app/(app)/reports/profit-loss/queries.ts): the Data API clamps every
 * response to 1000 rows and TRUNCATES SILENTLY, every guard below detects
 * the cap by exact equality (`rows.length === LIMIT`), so a limit above
 * the server's own clamp would make the guard dead code. 1000, not more.
 */
export const SALES_TAX_LIMIT = 1000;

/**
 * The full-ledger read pages past the cap with .range() (its ordering is
 * total: paid_on then unique id) instead of warning on it, because a short
 * ledger is a different defect class from a short list: a short list
 * under-counts and the truncated flag says so, but a running sum over half
 * a ledger MISPLACES an invoice's tax in the wrong period — so the ledger
 * is either complete or the whole report refuses. The page ceiling bounds
 * the loop; at ~10,000 payment rows for one period's invoices the refusal
 * message asks for a narrower range.
 */
const MAX_LEDGER_PAGES = 10;

export type SalesTaxReport = {
  period: SalesTaxPeriod;
  /** Non-null → a read failed or the join didn't reconcile. The page
   *  renders a visible failure and the export refuses — never $0.00. */
  error: string | null;
  /** True when any read hit SALES_TAX_LIMIT — the figures may be partial.
   *  The page shows a loud callout; the export refuses outright. */
  truncated: boolean;

  rows: SalesTaxRow[];
  taxableTotalCents: number;
  taxTotalCents: number;
  untaxedPaidCount: number;

  /** Tax charged on invoices ISSUED in the period still awaiting full
   *  payment (status sent/partial) — deliberately NOT in the totals
   *  above; each invoice's tax counts on the day it is paid in full. */
  awaitingCount: number;
  awaitingTaxCents: number;
};

/**
 * Everything /reports/sales-tax needs, assembled once and shared by the
 * screen and the CSV export — the same "one source for one number"
 * discipline as loadProfitLossReport.
 *
 * WHERE EACH NUMBER COMES FROM, stated once:
 *   - which invoices are candidates: every invoice with ANY
 *     pilot.invoice_payments row — positive payment or negative
 *     correction — dated inside [from, to]. The report's rows are the
 *     settled-state transitions of each candidate's FULL ledger, and a
 *     transition can only happen on a date carrying a payment row, so
 *     this set is exactly the invoices that can have a row this period.
 *     NOT invoice_totals.last_paid_on gated on status='paid': a
 *     correction moves last_paid_on to the correction date and walks the
 *     status back to sent/partial (invoice_payments_resync_status), which
 *     made settled-then-corrected invoices vanish from every period. See
 *     report-lib.ts's header for the full decision record.
 *   - the crossing arithmetic: each candidate's full payment ledger,
 *     paged to completeness (see MAX_LEDGER_PAGES above).
 *   - tax money:  pilot.invoice_totals.tax_cents — the schema's single
 *     source for tax, never recomputed from lines here — and total_cents
 *     from the same view as the settlement threshold.
 *   - taxable base: pilot.invoice_lines (taxable rows summed), shown so
 *     the pilot can see what the rate was applied to; the assembly
 *     cross-checks base x rate against the view's tax_cents and refuses
 *     on any mismatch.
 *   - awaiting figure: pilot.invoices issued in [from, to] with status
 *     sent/partial, their tax_cents from the same view.
 *
 * account-scoped throughout: every query filters on account_id even
 * though RLS is the real boundary — defence in depth, matching the house
 * note in app/(app)/expenses/actions.ts.
 */
export async function loadSalesTaxReport(
  supabase: Supa,
  accountId: string,
  period: SalesTaxPeriod
): Promise<SalesTaxReport> {
  const failed = (message: string): SalesTaxReport => ({
    period,
    error: message,
    truncated: false,
    rows: [],
    taxableTotalCents: 0,
    taxTotalCents: 0,
    untaxedPaidCount: 0,
    awaitingCount: 0,
    awaitingTaxCents: 0,
  });

  const [periodPaymentsResult, awaitingInvoicesResult] = await Promise.all([
    // Every invoice with a payment row — positive or negative — dated in
    // the period. Only invoice_id is needed here; the full ledgers are
    // fetched below, complete, for exactly these invoices.
    rowsOf<{ invoice_id: string }>(
      await supabase
        .from("invoice_payments")
        .select("invoice_id")
        .eq("account_id", accountId)
        .gte("paid_on", period.from)
        .lte("paid_on", period.to)
        .limit(SALES_TAX_LIMIT)
    ),
    // The "charged, not yet collected" side: issued in the period, still
    // awaiting full payment. Drafts were never sent; voids are not owed;
    // paid invoices belong to the cash-basis totals (whenever their final
    // payment lands), so none of those appear here.
    rowsOf<{ id: string }>(
      await supabase
        .from("invoices")
        .select("id")
        .eq("account_id", accountId)
        .in("status", ["sent", "partial"])
        .gte("issued_on", period.from)
        .lte("issued_on", period.to)
        .limit(SALES_TAX_LIMIT)
    ),
  ]);

  if (!periodPaymentsResult.ok) {
    return failed(periodPaymentsResult.error.message ?? "invoice_payments read failed");
  }
  if (!awaitingInvoicesResult.ok) {
    return failed(awaitingInvoicesResult.error.message ?? "invoices read failed");
  }

  const candidateIds = [
    ...new Set(periodPaymentsResult.rows.map((r) => r.invoice_id)),
  ];
  const awaitingIds = awaitingInvoicesResult.rows.map((r) => r.id);

  // The FULL ledger of every candidate — every payment and correction on
  // any date, not just the period's — because the first-crossing date is
  // a fact about the whole ledger. Paged to completeness; see
  // MAX_LEDGER_PAGES for why a cap hit here refuses instead of warning.
  const ledger: SalesTaxPaymentRow[] = [];
  if (candidateIds.length) {
    let offset = 0;
    for (;;) {
      if (offset >= SALES_TAX_LIMIT * MAX_LEDGER_PAGES) {
        return failed(
          "this period's invoices carry more payment rows than the report can read completely — narrow the date range; a running sum over half a ledger would misplace tax across periods"
        );
      }
      const page = rowsOf<SalesTaxPaymentRow>(
        await supabase
          .from("invoice_payments")
          .select("id, invoice_id, paid_on, amount_cents")
          .eq("account_id", accountId)
          .in("invoice_id", candidateIds)
          .order("paid_on", { ascending: true })
          .order("id", { ascending: true })
          .range(offset, offset + SALES_TAX_LIMIT - 1)
      );
      if (!page.ok) {
        return failed(page.error.message ?? "invoice_payments ledger read failed");
      }
      ledger.push(...page.rows);
      offset += page.rows.length;
      if (page.rows.length < SALES_TAX_LIMIT) break;
    }
  }

  // The invoices behind every candidate. `.in()` on a de-duplicated set
  // of at most SALES_TAX_LIMIT ids, so the same cap bounds it (the
  // defect-9 lesson from profit-loss: an unbounded .in() truncates
  // silently just like a list query).
  const invoicesResult = candidateIds.length
    ? rowsOf<SalesTaxInvoice>(
        await supabase
          .from("invoices")
          .select("id, invoice_number, client_id, status, issued_on, tax_rate_bps")
          .eq("account_id", accountId)
          .in("id", candidateIds)
          .limit(SALES_TAX_LIMIT)
      )
    : { ok: true as const, rows: [] as SalesTaxInvoice[] };
  if (!invoicesResult.ok) {
    return failed(invoicesResult.error.message ?? "invoices lookup failed");
  }
  const invoiceById = new Map(invoicesResult.rows.map((i) => [i.id, i]));

  // total_cents (the settlement threshold) and tax_cents for every
  // candidate, from the one view that owns them.
  const totalsResult = candidateIds.length
    ? rowsOf<SalesTaxTotalsRow>(
        await supabase
          .from("invoice_totals")
          .select("invoice_id, tax_cents, total_cents")
          .eq("account_id", accountId)
          .in("invoice_id", candidateIds)
          .limit(SALES_TAX_LIMIT)
      )
    : { ok: true as const, rows: [] as SalesTaxTotalsRow[] };
  if (!totalsResult.ok) {
    return failed(totalsResult.error.message ?? "invoice_totals read failed");
  }
  const totalsById = new Map(totalsResult.rows.map((t) => [t.invoice_id, t]));

  // Line items only for the invoices that can actually become rows:
  // taxed, and not void/draft. Their lines are immutable once issued, so
  // this read cannot race the view's figures.
  const rowCandidateIds = candidateIds.filter((id) => {
    const invoice = invoiceById.get(id);
    return (
      (totalsById.get(id)?.tax_cents ?? 0) > 0 &&
      invoice !== undefined &&
      invoice.status !== "void" &&
      invoice.status !== "draft"
    );
  });
  const linesResult = rowCandidateIds.length
    ? rowsOf<SalesTaxLineRow>(
        await supabase
          .from("invoice_lines")
          .select("invoice_id, amount_cents, taxable")
          .eq("account_id", accountId)
          .in("invoice_id", rowCandidateIds)
          .limit(SALES_TAX_LIMIT)
      )
    : { ok: true as const, rows: [] as SalesTaxLineRow[] };
  if (!linesResult.ok) {
    return failed(linesResult.error.message ?? "invoice_lines read failed");
  }

  const clientIds = [
    ...new Set(
      rowCandidateIds
        .map((id) => invoiceById.get(id)?.client_id)
        .filter((id): id is string => Boolean(id))
    ),
  ];
  const clientsResult = clientIds.length
    ? rowsOf<{ id: string; name: string }>(
        await supabase
          .from("clients")
          .select("id, name")
          .eq("account_id", accountId)
          .in("id", clientIds)
          .limit(SALES_TAX_LIMIT)
      )
    : { ok: true as const, rows: [] as { id: string; name: string }[] };
  if (!clientsResult.ok) {
    return failed(clientsResult.error.message ?? "clients read failed");
  }

  const awaitingTotalsResult = awaitingIds.length
    ? rowsOf<{ invoice_id: string; tax_cents: number }>(
        await supabase
          .from("invoice_totals")
          .select("invoice_id, tax_cents")
          .eq("account_id", accountId)
          .in("invoice_id", awaitingIds)
          .limit(SALES_TAX_LIMIT)
      )
    : { ok: true as const, rows: [] as { invoice_id: string; tax_cents: number }[] };
  if (!awaitingTotalsResult.ok) {
    return failed(awaitingTotalsResult.error.message ?? "invoice_totals read failed");
  }
  const awaitingTaxed = awaitingTotalsResult.rows.filter((t) => t.tax_cents > 0);

  const assembly = assembleSalesTaxReport({
    period: { from: period.from, to: period.to },
    payments: ledger,
    invoices: invoicesResult.rows,
    totals: totalsResult.rows,
    lines: linesResult.rows,
    clientNames: new Map(clientsResult.rows.map((c) => [c.id, c.name])),
  });
  if (!assembly.ok) {
    return failed(assembly.reason);
  }

  const truncated =
    periodPaymentsResult.rows.length === SALES_TAX_LIMIT ||
    invoicesResult.rows.length === SALES_TAX_LIMIT ||
    totalsResult.rows.length === SALES_TAX_LIMIT ||
    linesResult.rows.length === SALES_TAX_LIMIT ||
    clientsResult.rows.length === SALES_TAX_LIMIT ||
    awaitingInvoicesResult.rows.length === SALES_TAX_LIMIT ||
    awaitingTotalsResult.rows.length === SALES_TAX_LIMIT;

  return {
    period,
    error: null,
    truncated,
    rows: assembly.rows,
    taxableTotalCents: assembly.taxableTotalCents,
    taxTotalCents: assembly.taxTotalCents,
    untaxedPaidCount: assembly.untaxedPaidCount,
    awaitingCount: awaitingTaxed.length,
    awaitingTaxCents: awaitingTaxed.reduce((s, t) => s + t.tax_cents, 0),
  };
}

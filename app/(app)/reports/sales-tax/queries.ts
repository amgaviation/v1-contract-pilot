import "server-only";
import type { createClient } from "@/lib/supabase/server";
import { rowsOf } from "@/lib/supabase/rows";
import {
  assembleSalesTaxReport,
  type SalesTaxInvoice,
  type SalesTaxLineRow,
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
 *   - which invoices count: pilot.invoice_totals rows whose last_paid_on
 *     falls in [from, to], narrowed to invoices whose status is 'paid' —
 *     cash basis, see report-lib.ts's header for the full reasoning. The
 *     view's own comment requires exactly this status filter ("a naive
 *     product-level 'collected this year' report must filter by status
 *     itself").
 *   - tax money:  pilot.invoice_totals.tax_cents — the schema's single
 *     source for tax, never recomputed from lines here.
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

  const [paidTotalsResult, awaitingInvoicesResult] = await Promise.all([
    // Every invoice whose LAST payment landed in the period. `gte` on a
    // nullable date column excludes nulls (never-paid invoices) by
    // construction. Status is narrowed to 'paid' after the invoice lookup
    // below — the view carries no status column.
    rowsOf<SalesTaxTotalsRow>(
      await supabase
        .from("invoice_totals")
        .select("invoice_id, tax_cents, last_paid_on")
        .eq("account_id", accountId)
        .gte("last_paid_on", period.from)
        .lte("last_paid_on", period.to)
        .order("last_paid_on", { ascending: true })
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

  if (!paidTotalsResult.ok) {
    return failed(paidTotalsResult.error.message ?? "invoice_totals read failed");
  }
  if (!awaitingInvoicesResult.ok) {
    return failed(awaitingInvoicesResult.error.message ?? "invoices read failed");
  }

  const paidTotals = paidTotalsResult.rows;
  const awaitingIds = awaitingInvoicesResult.rows.map((r) => r.id);

  // The invoices behind every totals row in range. `.in()` on a
  // de-duplicated set of at most SALES_TAX_LIMIT ids, so the same cap
  // bounds it (the defect-9 lesson from profit-loss: an unbounded .in()
  // truncates silently just like a list query).
  const paidIds = paidTotals.map((t) => t.invoice_id);
  const invoicesResult = paidIds.length
    ? rowsOf<SalesTaxInvoice>(
        await supabase
          .from("invoices")
          .select("id, invoice_number, client_id, status, issued_on, tax_rate_bps")
          .eq("account_id", accountId)
          .in("id", paidIds)
          .limit(SALES_TAX_LIMIT)
      )
    : { ok: true as const, rows: [] as SalesTaxInvoice[] };
  if (!invoicesResult.ok) {
    return failed(invoicesResult.error.message ?? "invoices lookup failed");
  }
  const invoiceById = new Map(invoicesResult.rows.map((i) => [i.id, i]));

  // Line items only for the invoices that will actually become rows:
  // paid, with tax charged. Their lines are immutable once issued, so
  // this read cannot race the view's figures.
  const taxedPaidIds = paidTotals
    .filter((t) => t.tax_cents > 0 && invoiceById.get(t.invoice_id)?.status === "paid")
    .map((t) => t.invoice_id);
  const linesResult = taxedPaidIds.length
    ? rowsOf<SalesTaxLineRow>(
        await supabase
          .from("invoice_lines")
          .select("invoice_id, amount_cents, taxable")
          .eq("account_id", accountId)
          .in("invoice_id", taxedPaidIds)
          .limit(SALES_TAX_LIMIT)
      )
    : { ok: true as const, rows: [] as SalesTaxLineRow[] };
  if (!linesResult.ok) {
    return failed(linesResult.error.message ?? "invoice_lines read failed");
  }

  const clientIds = [
    ...new Set(
      taxedPaidIds
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
    totalsInPeriod: paidTotals,
    invoices: invoicesResult.rows,
    lines: linesResult.rows,
    clientNames: new Map(clientsResult.rows.map((c) => [c.id, c.name])),
  });
  if (!assembly.ok) {
    return failed(assembly.reason);
  }

  const truncated =
    paidTotals.length === SALES_TAX_LIMIT ||
    invoicesResult.rows.length === SALES_TAX_LIMIT ||
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

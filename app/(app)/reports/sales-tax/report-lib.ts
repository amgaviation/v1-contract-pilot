/**
 * Pure assembly for the sales tax report — no I/O, no Supabase, no Next
 * imports, so tests/sales-tax.test.mjs can exercise it directly (the same
 * split as app/(app)/clients/[id]/statement/statement-lib.ts, whose period
 * helpers this file deliberately mirrors).
 *
 * ---- THE BASIS DECISION, stated once -------------------------------------
 * This report is CASH-basis: an invoice's tax counts on the day the
 * invoice was PAID IN FULL (pilot.invoice_totals.last_paid_on of a
 * status='paid' invoice), not the day it was issued. Chosen to match the
 * house reports — year-end, quarterly, and profit & loss all count income
 * as payments received (invoice_payments.paid_on), never invoices issued,
 * and a tax report on the accrual basis sitting next to three cash-basis
 * income reports would be exactly the "two reports disagree about one
 * period" defect this product's "one source for one number" rule exists
 * to prevent. The page and the CSV both say this in plain words.
 *
 * Two deliberate consequences, both surfaced rather than silently mixed in:
 *   - An invoice paid across two periods (partial in December, balance in
 *     January) counts its tax ONCE, in the period containing the final
 *     payment. The payment ledger records amounts, not a tax/subtotal
 *     split per payment, so pro-rating tax across partial payments would
 *     invent an allocation the ledger never recorded.
 *   - Tax charged on invoices issued in the period but not yet paid in
 *     full is reported as its own clearly-excluded figure ("charged, not
 *     yet collected"), never folded into the totals.
 *
 * Void invoices are excluded even when payments were recorded against
 * them before the void — the same rule profit-loss applies to income ("a
 * payment against a now-void invoice is not income").
 * ---------------------------------------------------------------------------
 */

// ---------------------------------------------------------------------------
// Period resolution — ?from=/?to=, defaulting to the current calendar year.
// ---------------------------------------------------------------------------

export type SalesTaxPeriod = {
  from: string;
  to: string;
  /** True when neither bound came from the query string. */
  usedDefault: boolean;
};

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** "2026-02-30" passes a regex but is not a date — round-trip through the
 *  UTC date constructor to reject it, same shape as statement-lib's. */
export function isValidIsoDate(value: string): boolean {
  if (!ISO_DATE_RE.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  if (!y || !m || !d) return false;
  const date = new Date(Date.UTC(y, m - 1, d));
  return (
    date.getUTCFullYear() === y &&
    date.getUTCMonth() === m - 1 &&
    date.getUTCDate() === d
  );
}

/** Today as "YYYY-MM-DD" in UTC — calendar facts are UTC facts in this
 *  codebase (see parseCalendarDate's note in lib/format.ts). */
export function todayIso(): string {
  const now = new Date();
  const m = now.getUTCMonth() + 1;
  const d = now.getUTCDate();
  return `${now.getUTCFullYear()}-${m < 10 ? `0${m}` : m}-${d < 10 ? `0${d}` : d}`;
}

/**
 * ?from=/?to= → a concrete inclusive period, validated server-side.
 * Defaults to the calendar year of `today` (passed in so tests can pin
 * it). Each bound falls back independently; a reversed pair is swapped
 * rather than rejected — the pilot's intent ("between these two dates")
 * is unambiguous. Same treatment as resolveStatementPeriod and
 * resolvePLPeriod's custom ranges.
 */
export function resolveSalesTaxPeriod(
  params: { from?: string; to?: string },
  today: string
): SalesTaxPeriod {
  const year = Number(today.slice(0, 4));
  const defaultFrom = `${year}-01-01`;
  const defaultTo = `${year}-12-31`;

  const fromValid = Boolean(params.from && isValidIsoDate(params.from));
  const toValid = Boolean(params.to && isValidIsoDate(params.to));
  const from = fromValid ? (params.from as string) : defaultFrom;
  const to = toValid ? (params.to as string) : defaultTo;

  // ISO dates sort lexically, so string comparison is date comparison.
  const [lo, hi] = from <= to ? [from, to] : [to, from];
  return { from: lo, to: hi, usedDefault: !fromValid && !toValid };
}

/** 825 → "8.25%", 800 → "8%", 810 → "8.1%". Basis points are the schema's
 *  own unit (invoices.tax_rate_bps) — divide by 100 exactly once, here. */
export function formatBps(bps: number): string {
  const s = (bps / 100).toFixed(2).replace(/\.?0+$/, "");
  return `${s === "" ? "0" : s}%`;
}

// ---------------------------------------------------------------------------
// Row assembly.
// ---------------------------------------------------------------------------

/** The columns read from pilot.invoices for each candidate invoice. */
export type SalesTaxInvoice = {
  id: string;
  invoice_number: string | null;
  client_id: string;
  status: "draft" | "sent" | "partial" | "paid" | "void";
  issued_on: string | null;
  tax_rate_bps: number;
};

/** The columns read from pilot.invoice_totals — the ONE source for
 *  tax_cents in this product; never recomputed from lines here. */
export type SalesTaxTotalsRow = {
  invoice_id: string;
  tax_cents: number;
  last_paid_on: string | null;
};

/** The columns read from pilot.invoice_lines, used ONLY to show the
 *  taxable base the view's tax_cents was computed from (the view exposes
 *  tax_cents but not the taxable subtotal behind it). Lines of an issued
 *  invoice are immutable (invoice_lines_protect_issued), so this cannot
 *  drift from the view's figure — and the assembly cross-checks anyway. */
export type SalesTaxLineRow = {
  invoice_id: string;
  amount_cents: number;
  taxable: boolean;
};

export type SalesTaxRow = {
  invoiceId: string;
  invoiceNumber: string;
  clientName: string;
  issuedOn: string | null;
  /** The date that puts the invoice in this period: the day it was paid
   *  in full (invoice_totals.last_paid_on). */
  paidOn: string;
  taxableSubtotalCents: number;
  taxRateBps: number;
  taxCents: number;
};

export type SalesTaxAssembly =
  | { ok: false; reason: string }
  | {
      ok: true;
      rows: SalesTaxRow[];
      taxableTotalCents: number;
      taxTotalCents: number;
      /** Invoices paid in full this period that charged no tax — counted
       *  so "why isn't invoice X here" has a visible answer, not listed. */
      untaxedPaidCount: number;
    };

/**
 * Joins the three reads into per-invoice rows + totals, refusing — never
 * fabricating a $0.00 — whenever a figure it must print is missing or
 * inconsistent (the lib/supabase/rows.ts house rule, applied to the join
 * rather than the read).
 */
export function assembleSalesTaxReport(input: {
  /** invoice_totals rows whose last_paid_on falls inside the period. */
  totalsInPeriod: SalesTaxTotalsRow[];
  /** pilot.invoices rows for every invoice_id in totalsInPeriod. */
  invoices: SalesTaxInvoice[];
  /** pilot.invoice_lines rows for every taxed, paid invoice. */
  lines: SalesTaxLineRow[];
  /** id → name for every client a row references. */
  clientNames: Map<string, string>;
}): SalesTaxAssembly {
  const invoiceById = new Map(input.invoices.map((i) => [i.id, i]));

  const taxableByInvoice = new Map<string, number>();
  const linesSeen = new Set<string>();
  for (const line of input.lines) {
    linesSeen.add(line.invoice_id);
    if (!line.taxable) continue;
    taxableByInvoice.set(
      line.invoice_id,
      (taxableByInvoice.get(line.invoice_id) ?? 0) + line.amount_cents
    );
  }

  const rows: SalesTaxRow[] = [];
  let untaxedPaidCount = 0;

  for (const t of input.totalsInPeriod) {
    const invoice = invoiceById.get(t.invoice_id);
    if (!invoice) {
      // A totals row always derives from an invoices row (the view joins
      // FROM pilot.invoices), so a missing match means the lookup itself
      // came back short — refuse rather than silently dropping a paid
      // invoice's tax from a report headed for a filing preparer.
      return {
        ok: false,
        reason: `invoice ${t.invoice_id} has a totals row but no invoice row — refusing to total a partial join`,
      };
    }
    // Cash basis: only invoices settled in full count, dated by the final
    // payment. sent/partial rows can appear here (they have payments in
    // the period) — their tax is not collected-in-full yet and shows in
    // the "charged, not yet collected" figure instead. void rows are
    // excluded outright, matching profit-loss's income rule.
    if (invoice.status !== "paid") continue;
    if (t.last_paid_on === null) {
      return {
        ok: false,
        reason: `paid invoice ${t.invoice_id} has no last_paid_on — refusing to guess its period`,
      };
    }

    if (t.tax_cents === 0) {
      untaxedPaidCount += 1;
      continue;
    }

    const taxableSubtotalCents = taxableByInvoice.get(t.invoice_id);
    if (taxableSubtotalCents === undefined && !linesSeen.has(t.invoice_id)) {
      // tax_cents > 0 requires taxable lines to exist; no lines at all
      // means the lines read came back short for this invoice.
      return {
        ok: false,
        reason: `invoice ${t.invoice_id} charged tax but no line items were loaded for it`,
      };
    }
    const taxable = taxableSubtotalCents ?? 0;

    // Drift guard: the printed base × the printed rate must reproduce the
    // printed tax exactly (Math.round matches Postgres round() for the
    // non-negative values these always are). Issued invoices are immutable
    // so this can only fire on a genuine bug — and a report whose own
    // columns don't reconcile must refuse, not print.
    if (Math.round((taxable * invoice.tax_rate_bps) / 10000) !== t.tax_cents) {
      return {
        ok: false,
        reason: `invoice ${t.invoice_id}: taxable subtotal x rate does not reproduce tax_cents — refusing to print figures that don't reconcile`,
      };
    }

    rows.push({
      invoiceId: invoice.id,
      invoiceNumber: invoice.invoice_number ?? "—",
      clientName: input.clientNames.get(invoice.client_id) ?? "Unknown client",
      issuedOn: invoice.issued_on,
      paidOn: t.last_paid_on,
      taxableSubtotalCents: taxable,
      taxRateBps: invoice.tax_rate_bps,
      taxCents: t.tax_cents,
    });
  }

  rows.sort(
    (a, b) =>
      a.paidOn.localeCompare(b.paidOn) ||
      a.invoiceNumber.localeCompare(b.invoiceNumber)
  );

  // The totals are sums of the rows shown and of nothing else, so a reader
  // adding the printed column by hand always reconciles to the printed
  // total (same rule as the client statement).
  const taxableTotalCents = rows.reduce((s, r) => s + r.taxableSubtotalCents, 0);
  const taxTotalCents = rows.reduce((s, r) => s + r.taxCents, 0);

  return { ok: true, rows, taxableTotalCents, taxTotalCents, untaxedPaidCount };
}

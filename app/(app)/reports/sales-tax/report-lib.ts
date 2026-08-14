/**
 * Pure assembly for the sales tax report — no I/O, no Supabase, no Next
 * imports, so tests/sales-tax.test.mjs can exercise it directly (the same
 * split as app/(app)/clients/[id]/statement/statement-lib.ts, whose period
 * helpers this file deliberately mirrors).
 *
 * ---- THE BASIS DECISION, stated once -------------------------------------
 * This report is CASH-basis: an invoice's tax counts on the day the
 * invoice was PAID IN FULL, not the day it was issued. Chosen to match
 * the house reports — year-end, quarterly, and profit & loss all count
 * income as payments received (invoice_payments.paid_on), never invoices
 * issued, and a tax report on the accrual basis sitting next to three
 * cash-basis income reports would be exactly the "two reports disagree
 * about one period" defect this product's "one source for one number"
 * rule exists to prevent. The page and the CSV both say this in plain
 * words.
 *
 * ---- WHICH DAY "PAID IN FULL" IS: the first-crossing date ----------------
 * The day an invoice was paid in full is computed from its FULL payment
 * ledger (every pilot.invoice_payments row, positive and negative): the
 * EARLIEST ledger date at whose end the running sum of payments had
 * reached the invoice's total. It is deliberately NOT
 * invoice_totals.last_paid_on gated on status='paid', which is what this
 * report shipped with and what made corrections erase history: a
 * correction row is dated the day it was made, so last_paid_on jumped to
 * the correction date, AND pilot.invoice_payments_resync_status
 * (20260810120000, widened by 20260810170000) walks status back to
 * sent/partial — so a settled invoice whose payment was later corrected
 * vanished from EVERY period's report, including the one whose filing
 * already counted it.
 *
 * The first-crossing date is stable under later corrections, which is the
 * point: tax collected in period A stays reported in A. What a correction
 * changes is reported WHERE THE CASH EVENT HAPPENED:
 *
 *   - The ledger's settled-state is read at the END of each ledger date
 *     (paid_on is a date; intra-day row order is entry order, not cash
 *     order, so a same-day dip is not a fact any filing period can see).
 *   - Each transition INTO settled puts a positive row in the period
 *     containing that date. The first such transition is the
 *     first-crossing; a later one is the invoice being re-settled after a
 *     correction, and it counts on ITS day for the same cash-basis reason.
 *   - Each transition OUT of settled (a net reversal took the running sum
 *     back below the total) puts a clearly-labelled NEGATIVE correction
 *     row in the period containing the reversal, naming the date the tax
 *     was previously counted. History is corrected forward, never erased.
 *   - Totals sum the rows shown, negatives included.
 *
 * WHICH DATE WINS when a corrected invoice is re-paid: the earliest
 * crossing on the CURRENT ledger. Corrected and re-paid on the same day →
 * the end-of-day sum never dropped, so nothing moves and the original
 * period stands. Re-paid on a later day → the original period keeps its
 * positive row, the correction's period shows the negative, and the
 * re-payment's period shows the tax collected again — each period reports
 * exactly the cash events that happened in it, and a period already filed
 * is never retroactively edited by a later entry.
 *
 * Two deliberate consequences, both surfaced rather than silently mixed in:
 *   - An invoice paid across two periods (partial in December, balance in
 *     January) counts its tax ONCE, in the period containing the payment
 *     that crossed the total. The payment ledger records amounts, not a
 *     tax/subtotal split per payment, so pro-rating tax across partial
 *     payments would invent an allocation the ledger never recorded.
 *   - Tax charged on invoices issued in the period but not yet paid in
 *     full is reported as its own clearly-excluded figure ("charged, not
 *     yet collected"), never folded into the totals. An invoice whose
 *     ledger never crossed its total contributes nothing here.
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
 *  tax_cents and total_cents in this product; never recomputed here. */
export type SalesTaxTotalsRow = {
  invoice_id: string;
  tax_cents: number;
  total_cents: number;
};

/** One pilot.invoice_payments row of a candidate invoice's FULL ledger —
 *  positive payments and negative corrections alike. `id` is only a
 *  deterministic intra-day tiebreak; the running sum is read at the end
 *  of each date, so intra-day order never changes a result. */
export type SalesTaxPaymentRow = {
  id: string;
  invoice_id: string;
  paid_on: string;
  amount_cents: number;
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
  /** "collected": the invoice's tax became collected on countedOn (its
   *  ledger crossed the total that day). "correction": a net reversal on
   *  countedOn took the ledger back below the total — the amounts are
   *  NEGATIVE and previouslyCountedOn names the date the tax was
   *  originally counted. */
  kind: "collected" | "correction";
  invoiceId: string;
  invoiceNumber: string;
  clientName: string;
  issuedOn: string | null;
  /** The date that puts this row in this period: the day the ledger
   *  crossed the invoice total (collected) or the day the reversal
   *  un-settled it (correction). */
  countedOn: string;
  /** Correction rows only: the crossing date this correction undoes. */
  previouslyCountedOn: string | null;
  /** Negative on a correction row. */
  taxableSubtotalCents: number;
  taxRateBps: number;
  /** Negative on a correction row. */
  taxCents: number;
};

/**
 * The one sentence both surfaces print beside a correction row. The date
 * arrives pre-formatted so the page can pass formatDate() and the CSV the
 * ISO string — same words, each surface's own date form.
 */
export function correctionNote(previouslyCountedOn: string): string {
  return `Payment corrected, previously counted ${previouslyCountedOn}`;
}

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

/** A candidate invoice's settled-state transitions, read from its full
 *  ledger at end-of-date granularity (see the file header).
 *
 *  EXPORTED for exactly one other caller: the client payment-behavior
 *  panel (app/(app)/clients/[id]/payment-insight.ts) reads an invoice's
 *  first-crossing date from the first "settled" event this returns. Two
 *  implementations of "which day was this invoice paid in full" would be
 *  two answers to one question — the defect this file's header exists to
 *  prevent — so that panel imports this one rather than re-deriving it. */
export function ledgerEvents(
  ledger: SalesTaxPaymentRow[],
  totalCents: number
): { kind: "settled" | "unsettled"; on: string; crossedOn: string }[] {
  // Sorted defensively even though the query orders the same way — the
  // running sum must never depend on arrival order.
  const sorted = [...ledger].sort(
    (a, b) => a.paid_on.localeCompare(b.paid_on) || a.id.localeCompare(b.id)
  );
  const events: { kind: "settled" | "unsettled"; on: string; crossedOn: string }[] = [];
  let running = 0;
  let crossedOn: string | null = null;

  // Reads the settled-state once per DATE, after that date's last row —
  // see the file header for why intra-day dips are not events.
  const closeDate = (date: string) => {
    if (crossedOn === null && running >= totalCents) {
      crossedOn = date;
      events.push({ kind: "settled", on: date, crossedOn: date });
    } else if (crossedOn !== null && running < totalCents) {
      events.push({ kind: "unsettled", on: date, crossedOn });
      crossedOn = null;
    }
  };

  let openDate: string | null = null;
  for (const row of sorted) {
    if (openDate !== null && row.paid_on !== openDate) closeDate(openDate);
    openDate = row.paid_on;
    running += row.amount_cents;
  }
  if (openDate !== null) closeDate(openDate);

  return events;
}

/**
 * Joins the reads into per-event rows + totals, refusing — never
 * fabricating a $0.00 — whenever a figure it must print is missing or
 * inconsistent (the lib/supabase/rows.ts house rule, applied to the join
 * rather than the read).
 */
export function assembleSalesTaxReport(input: {
  /** The report period — only events dated inside it become rows. */
  period: { from: string; to: string };
  /** The FULL payment ledger (all dates) of every invoice that had any
   *  payment row — positive or negative — dated inside the period. */
  payments: SalesTaxPaymentRow[];
  /** pilot.invoices rows for every invoice_id in payments. */
  invoices: SalesTaxInvoice[];
  /** pilot.invoice_totals rows for every invoice_id in payments. */
  totals: SalesTaxTotalsRow[];
  /** pilot.invoice_lines rows for every taxed, non-void candidate. */
  lines: SalesTaxLineRow[];
  /** id → name for every client a row references. */
  clientNames: Map<string, string>;
}): SalesTaxAssembly {
  const invoiceById = new Map(input.invoices.map((i) => [i.id, i]));
  const totalsById = new Map(input.totals.map((t) => [t.invoice_id, t]));

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

  const ledgerByInvoice = new Map<string, SalesTaxPaymentRow[]>();
  for (const p of input.payments) {
    const existing = ledgerByInvoice.get(p.invoice_id);
    if (existing) existing.push(p);
    else ledgerByInvoice.set(p.invoice_id, [p]);
  }

  const rows: SalesTaxRow[] = [];
  let untaxedPaidCount = 0;

  for (const [invoiceId, ledger] of ledgerByInvoice) {
    const invoice = invoiceById.get(invoiceId);
    if (!invoice) {
      // A payment row always hangs off an invoices row (FK), so a missing
      // match means the lookup itself came back short — refuse rather
      // than silently dropping an invoice's tax from a report headed for
      // a filing preparer.
      return {
        ok: false,
        reason: `invoice ${invoiceId} has payments but no invoice row, refusing to total a partial join`,
      };
    }
    // Void invoices are excluded outright, matching profit-loss's income
    // rule — a payment against a now-void invoice is not income, and its
    // tax is not collected tax. (Draft invoices cannot carry payments.)
    if (invoice.status === "void" || invoice.status === "draft") continue;

    const totals = totalsById.get(invoiceId);
    if (!totals) {
      // The view derives one row per invoice, so a missing row means the
      // totals read came back short. Without total_cents the crossing
      // cannot be computed — refuse, never guess.
      return {
        ok: false,
        reason: `invoice ${invoiceId} has payments but no totals row, refusing to place its tax without a total`,
      };
    }

    const events = ledgerEvents(ledger, totals.total_cents);
    const eventsInPeriod = events.filter(
      // ISO dates sort lexically, so string comparison is date comparison.
      (e) => e.on >= input.period.from && e.on <= input.period.to
    );
    // A ledger that never crossed its total, or whose transitions all fall
    // outside this period, contributes nothing — the invoice's tax counts
    // in the periods containing its own cash events, not this one.
    if (eventsInPeriod.length === 0) continue;

    if (totals.tax_cents === 0) {
      // Settled this period but charged no tax: counted, not listed. An
      // un-settle of a zero-tax invoice has nothing to correct.
      if (eventsInPeriod.some((e) => e.kind === "settled")) untaxedPaidCount += 1;
      continue;
    }

    const taxableSubtotalCents = taxableByInvoice.get(invoiceId);
    if (taxableSubtotalCents === undefined && !linesSeen.has(invoiceId)) {
      // tax_cents > 0 requires taxable lines to exist; no lines at all
      // means the lines read came back short for this invoice.
      return {
        ok: false,
        reason: `invoice ${invoiceId} charged tax but no line items were loaded for it`,
      };
    }
    const taxable = taxableSubtotalCents ?? 0;

    // Drift guard: the printed base × the printed rate must reproduce the
    // printed tax exactly (Math.round matches Postgres round() for the
    // non-negative values these always are). Issued invoices are immutable
    // so this can only fire on a genuine bug — and a report whose own
    // columns don't reconcile must refuse, not print.
    if (Math.round((taxable * invoice.tax_rate_bps) / 10000) !== totals.tax_cents) {
      return {
        ok: false,
        reason: `invoice ${invoiceId}: taxable subtotal x rate does not reproduce tax_cents, refusing to print figures that don't reconcile`,
      };
    }

    const invoiceNumber = invoice.invoice_number ?? "—";
    const clientName = input.clientNames.get(invoice.client_id) ?? "Unknown client";
    for (const event of eventsInPeriod) {
      const sign = event.kind === "settled" ? 1 : -1;
      rows.push({
        kind: event.kind === "settled" ? "collected" : "correction",
        invoiceId: invoice.id,
        invoiceNumber,
        clientName,
        issuedOn: invoice.issued_on,
        countedOn: event.on,
        previouslyCountedOn: event.kind === "unsettled" ? event.crossedOn : null,
        taxableSubtotalCents: sign * taxable,
        taxRateBps: invoice.tax_rate_bps,
        taxCents: sign * totals.tax_cents,
      });
    }
  }

  rows.sort(
    (a, b) =>
      a.countedOn.localeCompare(b.countedOn) ||
      a.invoiceNumber.localeCompare(b.invoiceNumber) ||
      // A same-day pair for one invoice cannot happen (one transition per
      // date), but the order must still be total for a stable render.
      a.kind.localeCompare(b.kind)
  );

  // The totals are sums of the rows shown and of nothing else — negative
  // correction rows included — so a reader adding the printed column by
  // hand always reconciles to the printed total (same rule as the client
  // statement).
  const taxableTotalCents = rows.reduce((s, r) => s + r.taxableSubtotalCents, 0);
  const taxTotalCents = rows.reduce((s, r) => s + r.taxCents, 0);

  return { ok: true, rows, taxableTotalCents, taxTotalCents, untaxedPaidCount };
}

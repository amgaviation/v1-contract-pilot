/**
 * Pure computation for the client statement: period resolution and row
 * assembly. Deliberately NOT "server-only" — tests/customer-statement.test.mjs
 * runs this file directly under `node --experimental-strip-types`, the same
 * arrangement as lib/mileage.ts and app/(app)/logbook/db.ts.
 *
 * WHAT A STATEMENT IS, so the shape below doesn't get re-litigated: for one
 * client (an aircraft owner, operator, or management company whose AP
 * department pays in batches), every invoice ISSUED in a date range, what has
 * been paid against each, and what is still outstanding. It COVERS issued
 * invoices only — sent/partial/paid. Drafts have not been sent, so the client
 * has never seen them; voided invoices are not owed. Both are excluded by the
 * query, and the statement says so in words rather than leaving the reader to
 * guess what "every invoice" means.
 *
 * EVERY NUMBER HERE IS PASSED IN from pilot.invoice_totals /
 * pilot.invoices_overdue rows — this module adds sums and joins, it never
 * recomputes a per-invoice total, paid amount, balance, or days-overdue from
 * scratch. One source of truth per number is the house rule (see
 * lib/supabase/rows.ts and lib/invoice-document.tsx), and the statement is the
 * artifact a client's AP department reconciles against the same invoices the
 * invoice screens display — the two must be incapable of disagreeing.
 */

export type StatementPeriod = {
  /** Inclusive "YYYY-MM-DD" bounds, compared directly against invoices.issued_on. */
  from: string;
  to: string;
  /**
   * True when neither ?from= nor ?to= survived validation and the default
   * (the current calendar year, UTC) was applied in full. The page uses this
   * to light the "This year" preset; a half-defaulted period lights nothing,
   * because the resolved dates on screen are the honest answer there.
   */
  usedDefault: boolean;
};

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Shape AND calendar validity. resolvePLPeriod (reports) checks the regex
 * only and lets Postgres reject "2026-02-31" as a query error; here an
 * invalid date falls back to the default bound instead, because a statement
 * URL is something a pilot pastes and edits by hand, and "you typed an
 * impossible date" should degrade to a working default, not a failed screen.
 * The round-trip through Date.UTC is what catches month-31sts and Feb-30ths:
 * JS normalizes them to the next month, so the parts stop matching.
 */
export function isValidIsoDate(value: string): boolean {
  if (!ISO_DATE_RE.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  // The regex above guarantees three numeric parts; this guard is for the
  // type system (noUncheckedIndexedAccess), same shape as parseCalendarDate
  // in lib/format.ts. A literal zero in any part is an invalid date anyway.
  if (!y || !m || !d) return false;
  const date = new Date(Date.UTC(y, m - 1, d));
  return (
    date.getUTCFullYear() === y &&
    date.getUTCMonth() === m - 1 &&
    date.getUTCDate() === d
  );
}

/** Today as "YYYY-MM-DD", read in UTC — same rule as the reports' own date
 *  helpers (see parseCalendarDate's note in lib/format.ts: calendar facts
 *  are UTC facts in this codebase). */
export function todayIso(): string {
  const now = new Date();
  const m = now.getUTCMonth() + 1;
  const d = now.getUTCDate();
  return `${now.getUTCFullYear()}-${m < 10 ? `0${m}` : m}-${d < 10 ? `0${d}` : d}`;
}

/**
 * ?from=/?to= → a concrete inclusive period, validated server-side.
 * Defaults to the current calendar year (of `today`, passed in so tests can
 * pin it). Each bound falls back independently; a reversed pair is swapped
 * rather than rejected, matching resolvePLPeriod's treatment of custom
 * ranges — the pilot's intent ("between these two dates") is unambiguous
 * either way they typed it.
 */
export function resolveStatementPeriod(
  params: { from?: string; to?: string },
  today: string
): StatementPeriod {
  const year = Number(today.slice(0, 4));
  const defaultFrom = `${year}-01-01`;
  const defaultTo = `${year}-12-31`;

  const fromValid = Boolean(params.from && isValidIsoDate(params.from));
  const toValid = Boolean(params.to && isValidIsoDate(params.to));
  const from = fromValid ? (params.from as string) : defaultFrom;
  const to = toValid ? (params.to as string) : defaultTo;

  // ISO dates sort lexically, so plain string comparison is date comparison.
  const [lo, hi] = from <= to ? [from, to] : [to, from];
  return { from: lo, to: hi, usedDefault: !fromValid && !toValid };
}

// ---------------------------------------------------------------------------
// Row assembly.
// ---------------------------------------------------------------------------

/** The columns the statement reads from pilot.invoices. Status is already
 *  narrowed by the query's `in ('sent','partial','paid')` filter. */
export type StatementInvoice = {
  id: string;
  invoice_number: string | null;
  status: "sent" | "partial" | "paid";
  issued_on: string | null;
  due_on: string | null;
};

/** The columns the statement reads from pilot.invoice_totals — the ONE
 *  source for invoice money in this product. */
export type StatementInvoiceTotals = {
  invoice_id: string;
  total_cents: number;
  amount_paid_cents: number;
  balance_due_cents: number;
};

/** A pilot.invoices_overdue row — the ONE source for past-due-ness, exactly
 *  as app/(app)/invoices/page.tsx reads it. Absence from the view means
 *  "not past due"; lateness is never recomputed from due_on here. */
export type StatementOverdue = {
  invoice_id: string;
  days_overdue: number;
};

export type StatementRow = {
  id: string;
  invoiceNumber: string | null;
  status: "sent" | "partial" | "paid";
  issuedOn: string | null;
  dueOn: string | null;
  totalCents: number;
  paidCents: number;
  balanceCents: number;
  /** From invoices_overdue; null = not past due (including paid invoices,
   *  which the view excludes by construction). */
  daysOverdue: number | null;
};

export type StatementTotals = {
  invoicedCents: number;
  paidCents: number;
  outstandingCents: number;
};

/**
 * Joins the three reads into display rows and period totals, or refuses.
 *
 * THE REFUSAL BRANCH IS THE POINT. invoice_totals is one-row-per-invoice by
 * construction, so an invoice in the list with no totals row means the
 * totals read was short (truncation, inconsistency, a failed row) — "we
 * could not find out", not "this invoice is $0.00". Filling the gap with
 * zeros would understate what the client owes on the exact document the
 * pilot sends to get paid, so the assembly fails loudly instead and the
 * callers render their failure state (red callout on screen, 500 on the
 * print route) — the same reasoning lib/invoice-document.tsx applies to a
 * failed totals read on the invoice PDF.
 */
export function assembleStatement(
  invoices: StatementInvoice[],
  totals: StatementInvoiceTotals[],
  overdue: StatementOverdue[]
):
  | { ok: true; rows: StatementRow[]; totals: StatementTotals }
  | { ok: false; missingTotalsFor: string[] } {
  const totalsByInvoice = new Map(totals.map((t) => [t.invoice_id, t]));
  const daysOverdueById = new Map(
    overdue.map((o) => [o.invoice_id, o.days_overdue])
  );

  const missingTotalsFor = invoices
    .filter((invoice) => !totalsByInvoice.has(invoice.id))
    .map((invoice) => invoice.id);
  if (missingTotalsFor.length > 0) {
    return { ok: false, missingTotalsFor };
  }

  const rows: StatementRow[] = invoices.map((invoice) => {
    const t = totalsByInvoice.get(invoice.id)!;
    return {
      id: invoice.id,
      invoiceNumber: invoice.invoice_number,
      status: invoice.status,
      issuedOn: invoice.issued_on,
      dueOn: invoice.due_on,
      totalCents: t.total_cents,
      paidCents: t.amount_paid_cents,
      balanceCents: t.balance_due_cents,
      daysOverdue: daysOverdueById.get(invoice.id) ?? null,
    };
  });

  // Sums of the per-invoice figures above and nothing else, so the period
  // totals and the rows they sit under CANNOT disagree — a reader adding
  // the column by hand gets the printed total to the cent.
  const periodTotals: StatementTotals = {
    invoicedCents: rows.reduce((sum, r) => sum + r.totalCents, 0),
    paidCents: rows.reduce((sum, r) => sum + r.paidCents, 0),
    outstandingCents: rows.reduce((sum, r) => sum + r.balanceCents, 0),
  };

  return { ok: true, rows, totals: periodTotals };
}

/** Same status wording as the invoice screens, minus draft/void (a
 *  statement never contains either). */
export const STATEMENT_STATUS_LABEL: Record<StatementRow["status"], string> = {
  sent: "Sent",
  partial: "Partially paid",
  paid: "Paid",
};

/**
 * Address block lines — same composition as the invoice PDF's own
 * addressLines (lib/invoice-pdf.tsx keeps its copy module-private, and that
 * file is the tokens:verify-exempt PDF surface, so it is not importable
 * from here without widening its export surface, which is not this
 * feature's file to change).
 */
export function addressLines(a: {
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  country: string | null;
}): string[] {
  const cityLine = [a.city, a.state, a.postal_code].filter(Boolean).join(", ");
  return [a.address_line1, a.address_line2, cityLine || null, a.country].filter(
    (line): line is string => Boolean(line && line.trim())
  );
}

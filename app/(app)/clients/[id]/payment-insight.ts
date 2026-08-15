/**
 * Pure computation for the client payment-behavior panel — no I/O, no
 * Supabase, no Next imports, so tests/payment-insight.test.mjs can
 * exercise it directly (the same split as statement/statement-lib.ts).
 *
 * WHAT THIS IS: the pilot's OWN receivables history with ONE client,
 * turned into the three facts that inform whether to accept that client's
 * next pop-up trip — how fast they historically pay, how their current
 * balance ages, and what they owe right now. Contract pilots trade this
 * intelligence by phone today; this panel computes it from the pilot's own
 * ledger. NO cross-tenant data of any kind: every input row is this
 * account's, for this client, and nothing here aggregates, compares, or
 * even names any other pilot's experience with the same operator.
 *
 * DAYS-TO-PAY uses the FIRST-CROSSING date the sales-tax report
 * established (app/(app)/reports/sales-tax/report-lib.ts, whose
 * ledgerEvents this file imports rather than reimplements): an invoice
 * was paid in full on the EARLIEST ledger date at whose end the running
 * payment sum reached the invoice total — stable under later corrections,
 * so a payment correction made in March does not rewrite how fast the
 * client paid in January.
 *
 * EVERY MONEY FIGURE IS PASSED IN from pilot.invoice_totals — this module
 * adds sums and joins, never recomputes a balance (the statement-lib
 * rule). Past-due-ness comes from pilot.invoices_overdue, the ONE source
 * for it — lateness is never recomputed from due_on here.
 */

import {
  ledgerEvents,
  type SalesTaxPaymentRow,
} from "../../reports/sales-tax/report-lib";
import { parseCalendarDate } from "@/lib/format";

// ---------------------------------------------------------------------------
// Input row shapes — the columns the panel reads, nothing more.
// ---------------------------------------------------------------------------

/** One issued pilot.invoices row of this client (draft/void excluded by
 *  the query: a draft was never sent, a void is not owed and not history). */
export type InsightInvoice = {
  id: string;
  status: "sent" | "partial" | "paid";
  issued_on: string | null;
};

/** The pilot.invoice_totals row behind each invoice — the ONE source for
 *  invoice money in this product. */
export type InsightTotals = {
  invoice_id: string;
  total_cents: number;
  balance_due_cents: number;
};

/** A pilot.invoices_overdue row. Absence from the view means "not past
 *  due" — including paid invoices, which the view excludes by construction. */
export type InsightOverdue = {
  invoice_id: string;
  days_overdue: number;
};

/** Re-exported so the panel's loader and tests name the ledger row type
 *  from one place. Same shape the sales-tax report reads. */
export type InsightPaymentRow = SalesTaxPaymentRow;

export const AGING_BUCKETS = [
  "current",
  "days1to30",
  "days31to60",
  "days61to90",
  "over90",
] as const;
export type AgingBucket = (typeof AGING_BUCKETS)[number];

export const AGING_BUCKET_LABEL: Record<AgingBucket, string> = {
  current: "Not yet due",
  days1to30: "1-30 days late",
  days31to60: "31-60 days late",
  days61to90: "61-90 days late",
  over90: "Over 90 days late",
};

export type PaymentInsight = {
  /** Median calendar days from issued_on to the first-crossing paid-in-full
   *  date, over every settled invoice that has both dates. Null when no
   *  invoice has settled yet — "no history", never a fabricated 0. */
  medianDaysToPay: number | null;
  /** How many settled invoices the median is computed over — printed next
   *  to it so "paid in 19 days" is never read as more history than it is. */
  settledSampleCount: number;
  /** balance_due_cents of the still-open invoices, bucketed by
   *  days_overdue from pilot.invoices_overdue. */
  agingCents: Record<AgingBucket, number>;
  /** Sum of the open invoices' balance_due_cents — matches the aging
   *  buckets by construction (each open invoice lands in exactly one). */
  outstandingCents: number;
  /** Open (sent/partial) invoices behind the aging figures. */
  openInvoiceCount: number;
};

export type PaymentInsightAssembly =
  | { ok: false; reason: string }
  | { ok: true; insight: PaymentInsight };

/** Whole calendar days between two "YYYY-MM-DD" dates (UTC — calendar
 *  facts are UTC facts in this codebase; see lib/format.ts). */
function daysBetween(fromIso: string, toIso: string): number | null {
  const from = parseCalendarDate(fromIso);
  const to = parseCalendarDate(toIso);
  if (!from || !to) return null;
  return Math.round((to.getTime() - from.getTime()) / 86_400_000);
}

/** Standard median: middle value, or the mean of the two middles for an
 *  even count (a .5 is kept — rounding it would claim precision the
 *  display then formats away). */
function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid]!;
  return (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/**
 * Joins the reads into the panel's figures, refusing — never rendering a
 * reassuring $0.00 or "pays instantly" — whenever a figure it must print
 * is missing (the lib/supabase/rows.ts house rule, applied to the join).
 */
export function assemblePaymentInsight(input: {
  invoices: InsightInvoice[];
  totals: InsightTotals[];
  overdue: InsightOverdue[];
  /** The FULL payment ledger (all dates, positives and corrections) of
   *  every invoice above — the crossing is a fact about the whole ledger. */
  payments: InsightPaymentRow[];
}): PaymentInsightAssembly {
  const totalsById = new Map(input.totals.map((t) => [t.invoice_id, t]));
  const daysOverdueById = new Map(
    input.overdue.map((o) => [o.invoice_id, o.days_overdue])
  );

  const ledgerByInvoice = new Map<string, InsightPaymentRow[]>();
  for (const p of input.payments) {
    const existing = ledgerByInvoice.get(p.invoice_id);
    if (existing) existing.push(p);
    else ledgerByInvoice.set(p.invoice_id, [p]);
  }

  const daysToPaySamples: number[] = [];
  const agingCents: Record<AgingBucket, number> = {
    current: 0,
    days1to30: 0,
    days31to60: 0,
    days61to90: 0,
    over90: 0,
  };
  let outstandingCents = 0;
  let openInvoiceCount = 0;

  for (const invoice of input.invoices) {
    const totals = totalsById.get(invoice.id);
    if (!totals) {
      // invoice_totals is one-row-per-invoice by construction, so a
      // missing row means the totals read came back short — refuse rather
      // than bucketing an unknown balance as $0 (the statement-lib rule).
      return {
        ok: false,
        reason: `invoice ${invoice.id} has no totals row. Refusing to print figures over a partial join.`,
      };
    }

    // ---- days-to-pay: the first crossing on the CURRENT ledger --------
    const ledger = ledgerByInvoice.get(invoice.id) ?? [];
    const firstCrossing = ledgerEvents(ledger, totals.total_cents).find(
      (e) => e.kind === "settled"
    );
    if (firstCrossing && invoice.issued_on) {
      const days = daysBetween(invoice.issued_on, firstCrossing.on);
      // A negative span (payment ledger-dated before issue) is a data-entry
      // artifact a median should still see as "paid immediately", not
      // discard — clamp to 0 rather than letting it pull the median
      // negative or vanish.
      if (days !== null) daysToPaySamples.push(Math.max(0, days));
    }

    // ---- aging: still-open invoices only ------------------------------
    if (invoice.status === "sent" || invoice.status === "partial") {
      openInvoiceCount += 1;
      outstandingCents += totals.balance_due_cents;
      const daysOverdue = daysOverdueById.get(invoice.id);
      const bucket: AgingBucket =
        daysOverdue === undefined || daysOverdue <= 0
          ? "current"
          : daysOverdue <= 30
            ? "days1to30"
            : daysOverdue <= 60
              ? "days31to60"
              : daysOverdue <= 90
                ? "days61to90"
                : "over90";
      agingCents[bucket] += totals.balance_due_cents;
    }
  }

  return {
    ok: true,
    insight: {
      medianDaysToPay: median(daysToPaySamples),
      settledSampleCount: daysToPaySamples.length,
      agingCents,
      outstandingCents,
      openInvoiceCount,
    },
  };
}

/** "19 days", "19.5 days", "1 day" — one place, so the panel and any
 *  future list column can't disagree on the wording. */
export function formatMedianDays(days: number): string {
  const value = Number.isInteger(days) ? String(days) : days.toFixed(1);
  return `${value} ${days === 1 ? "day" : "days"}`;
}

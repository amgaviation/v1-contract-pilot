import { LAlert, LCard, LTable, LTd, LTh } from "@/components/ledger";

import { createClient } from "@/lib/supabase/server";
import { rowsOf } from "@/lib/supabase/rows";
import { formatCents } from "@/lib/format";
import {
  AGING_BUCKETS,
  AGING_BUCKET_LABEL,
  assemblePaymentInsight,
  formatMedianDays,
  type InsightInvoice,
  type InsightOverdue,
  type InsightPaymentRow,
  type InsightTotals,
} from "./payment-insight";

/**
 * Payment behavior, from this client's own invoices and payments — see
 * payment-insight.ts's header for what is computed and the explicit
 * no-cross-tenant rule. A server component with its own reads (the
 * PacketPanel arrangement), so the client page's own query block stays
 * untouched for the agents editing it concurrently.
 */

// Same cap discipline as every list read in this app (see
// app/(app)/reports/sales-tax/queries.ts): 1000, detected by exact
// equality, never a larger number the server's own clamp would make
// unreachable.
const INSIGHT_LIMIT = 1000;

// The full-ledger read pages past the cap with .range() — a running sum
// over half a ledger MISPLACES an invoice's crossing date, so the ledger
// is either complete or the panel refuses (the sales-tax report's rule,
// same reasoning, smaller scope: one client).
const MAX_LEDGER_PAGES = 5;

function FailedState() {
  return (
    <LAlert tone="crit" className="flex items-start gap-2">
      <WarningIcon className="mt-0.5 shrink-0 text-crit" />
      <span>
        Couldn&rsquo;t load this client&rsquo;s payment history. The figures
        are unavailable rather than zero. Try reloading the page.
      </span>
    </LAlert>
  );
}

export default async function PaymentInsightPanel({
  accountId,
  clientId,
}: {
  accountId: string;
  clientId: string;
}) {
  const supabase = await createClient();

  const shell = (body: React.ReactNode) => (
    <LCard>
      <div className="mb-1 text-h3 font-semibold">Payment behavior</div>
      <p className="mb-3 text-body-s text-ink-3">
        How fast this client has paid, and how the current balance ages,
        from your own ledger. Computed from your records only; nothing
        here comes from, or is shared with, anyone else.
      </p>
      {body}
    </LCard>
  );

  // Issued invoices only: a draft was never sent, so it has no
  // payment-behavior story; a void is not owed and not history.
  //
  // Clientless invoices (20260815100000) are excluded by the same
  // `.eq("client_id", clientId)` that scopes this panel, and correctly so:
  // this measures how promptly THIS client pays, and an invoice billed to
  // typed details is not evidence about them.
  const invoicesResult = rowsOf<InsightInvoice>(
    await supabase
      .from("invoices")
      .select("id, status, issued_on")
      .eq("account_id", accountId)
      .eq("client_id", clientId)
      .in("status", ["sent", "partial", "paid"])
      .order("issued_on", { ascending: true })
      .order("id", { ascending: true })
      .limit(INSIGHT_LIMIT)
  );
  if (!invoicesResult.ok) return shell(<FailedState />);

  if (invoicesResult.rows.length === 0) {
    return shell(
      <p className="text-body-s text-ink-3">
        No issued invoices yet. Payment history appears once this client
        has been billed.
      </p>
    );
  }
  if (invoicesResult.rows.length === INSIGHT_LIMIT) {
    // More invoices than one read returns: a median over an arbitrary
    // subset would be presented as this client's history while silently
    // ignoring part of it. Refuse, say so.
    return shell(
      <LAlert tone="warn" className="flex items-start gap-2">
        <WarningIcon className="mt-0.5 shrink-0 text-warn" />
        <span>
          This client has more invoices than this panel can read in one
          pass, so the figures aren&rsquo;t shown. A partial history would
          be presented as the whole one.
        </span>
      </LAlert>
    );
  }

  const invoiceIds = invoicesResult.rows.map((i) => i.id);

  const [totalsResult, overdueResult] = await Promise.all([
    rowsOf<InsightTotals>(
      await supabase
        .from("invoice_totals")
        .select("invoice_id, total_cents, balance_due_cents")
        .eq("account_id", accountId)
        .in("invoice_id", invoiceIds)
        .limit(INSIGHT_LIMIT)
    ),
    rowsOf<InsightOverdue>(
      await supabase
        .from("invoices_overdue")
        .select("invoice_id, days_overdue")
        .eq("account_id", accountId)
        .in("invoice_id", invoiceIds)
        .limit(INSIGHT_LIMIT)
    ),
  ]);
  if (!totalsResult.ok || !overdueResult.ok) return shell(<FailedState />);

  // The FULL ledger of every invoice — every payment and correction on
  // any date — because the first-crossing date is a fact about the whole
  // ledger. Paged to completeness; a cap hit refuses.
  const ledger: InsightPaymentRow[] = [];
  {
    let offset = 0;
    for (;;) {
      if (offset >= INSIGHT_LIMIT * MAX_LEDGER_PAGES) {
        return shell(<FailedState />);
      }
      const page = rowsOf<InsightPaymentRow>(
        await supabase
          .from("invoice_payments")
          .select("id, invoice_id, paid_on, amount_cents")
          .eq("account_id", accountId)
          .in("invoice_id", invoiceIds)
          .order("paid_on", { ascending: true })
          .order("id", { ascending: true })
          .range(offset, offset + INSIGHT_LIMIT - 1)
      );
      if (!page.ok) return shell(<FailedState />);
      ledger.push(...page.rows);
      offset += page.rows.length;
      if (page.rows.length < INSIGHT_LIMIT) break;
    }
  }

  const assembly = assemblePaymentInsight({
    invoices: invoicesResult.rows,
    totals: totalsResult.rows,
    overdue: overdueResult.rows,
    payments: ledger,
  });
  if (!assembly.ok) return shell(<FailedState />);
  const insight = assembly.insight;

  return shell(
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-5">
        <div className="flex flex-col gap-1">
          <span className="text-caption text-ink-3">Median days to pay</span>
          {insight.medianDaysToPay === null ? (
            <span className="text-body-s text-ink-3">No invoice paid in full yet</span>
          ) : (
            <>
              <span className="tnum-l text-h2 font-bold tracking-tight">
                {formatMedianDays(insight.medianDaysToPay)}
              </span>
              <span className="text-caption text-ink-3">
                issue to paid in full, over {insight.settledSampleCount}{" "}
                {insight.settledSampleCount === 1 ? "invoice" : "invoices"}
              </span>
            </>
          )}
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-caption text-ink-3">Outstanding now</span>
          <span className="tnum-l text-h2 font-bold tracking-tight">
            {formatCents(insight.outstandingCents)}
          </span>
          <span className="text-caption text-ink-3">
            across {insight.openInvoiceCount} open{" "}
            {insight.openInvoiceCount === 1 ? "invoice" : "invoices"}
          </span>
        </div>
      </div>

      {insight.openInvoiceCount === 0 ? (
        <p className="text-body-s text-ink-3">Nothing outstanding right now.</p>
      ) : (
        <LTable>
          <caption>
            <span className="sr-only">Aging</span>
          </caption>
          <thead>
            <tr>
              <LTh>Aging</LTh>
              <LTh numeric>Balance</LTh>
            </tr>
          </thead>
          <tbody>
            {AGING_BUCKETS.filter((b) => insight.agingCents[b] !== 0).map((bucket) => (
              <tr key={bucket}>
                <th
                  scope="row"
                  className="border-b border-hair px-3 py-2.5 text-left align-baseline font-medium text-ink first:pl-0 last:pr-0"
                >
                  {AGING_BUCKET_LABEL[bucket]}
                </th>
                <LTd numeric>{formatCents(insight.agingCents[bucket])}</LTd>
              </tr>
            ))}
          </tbody>
        </LTable>
      )}
    </div>
  );
}

/* ── Inline icon ───────────────────────────────────────────────────────
 * Ledger screens carry no icon dependency — see components/ledger's own
 * header rule. */
function WarningIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <path d="M8 2 14.25 13H1.75Z" />
      <path d="M8 6.25v3" />
      <circle cx="8" cy="11.25" r="0.4" fill="currentColor" stroke="none" />
    </svg>
  );
}

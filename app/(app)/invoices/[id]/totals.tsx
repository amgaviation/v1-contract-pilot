import { cn } from "@/lib/ledger/cn";
import { formatCents } from "@/lib/format";

/**
 * THE INVOICE'S MONEY BLOCK — subtotal, tax, total, paid, balance due.
 *
 * Extracted from ./page.tsx, which still owns the read (pilot.invoice_totals
 * is the single source for every one of these figures) and still owns the
 * gate: a failed totals read renders the error instead of this, because a
 * sent, unpaid invoice must never show a healthy $0.00 balance.
 *
 * It moved so app/(dev)/marketing-shots can render the REAL block with
 * fabricated figures — see that harness's header. Nothing here reads a
 * session, a tenant or the database.
 */
export type InvoiceTotalsView = {
  subtotal_cents: number;
  tax_cents: number;
  total_cents: number;
  amount_paid_cents: number;
  balance_due_cents: number;
};

export function InvoiceTotals({ totals }: { totals: InvoiceTotalsView | null }) {
  return (
    <div className="flex flex-col items-end gap-1">
      <TotalsLine label="Subtotal" value={totals?.subtotal_cents ?? 0} />
      <TotalsLine label="Tax" value={totals?.tax_cents ?? 0} />
      <TotalsLine label="Total" value={totals?.total_cents ?? 0} emphasize />
      <TotalsLine label="Paid" value={totals?.amount_paid_cents ?? 0} />
      <TotalsLine label="Balance due" value={totals?.balance_due_cents ?? 0} emphasize />
    </div>
  );
}

function TotalsLine({
  label,
  value,
  emphasize = false,
}: {
  label: string;
  value: number;
  emphasize?: boolean;
}) {
  return (
    <div className="flex min-w-56 justify-between gap-4">
      <span className={cn("text-ink-3", emphasize && "font-bold text-ink")}>{label}</span>
      <span className={cn("tnum-l", emphasize && "font-bold")}>{formatCents(value)}</span>
    </div>
  );
}

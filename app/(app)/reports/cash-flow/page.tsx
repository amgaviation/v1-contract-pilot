import { LAlert, LButton, LCard, LRow, LRows, LStat, lButtonClass } from "@/components/ledger";
import { LInput } from "@/components/ledger/forms";
import { LPageShell } from "@/components/ledger/page-shell";
import { createClient } from "@/lib/supabase/server";
import { requireEntitlement } from "@/lib/supabase/entitlements";
import { formatCents, formatDateRange } from "@/lib/format";
import {
  assembleCashFlow,
  presentedBalanceCents,
  shiftIsoDate,
  type CashFlowLine,
  type CashFlowRow,
  type LedgerBalanceRow,
} from "../../accounting/ledger-lib";
import { resolveSalesTaxPeriod, todayIso } from "../sales-tax/report-lib";

export const metadata = { title: "Cash flow" };

function bankBalanceCents(rows: LedgerBalanceRow[]): number | null {
  const bank = rows.find((r) => r.system_key === "bank");
  return bank ? presentedBalanceCents("asset", bank.balance_cents) : null;
}

function FlowTable({
  title,
  lines,
  totalCents,
}: {
  title: string;
  lines: CashFlowLine[];
  totalCents: number;
}) {
  return (
    <LCard>
      <p className="mb-2 text-h3 font-semibold">{title}</p>
      {lines.length === 0 ? (
        <p className="text-body-s text-ink-3">None in this period.</p>
      ) : (
        <LRows>
          {lines.map((line) => (
            <LRow key={line.chartAccountId}>
              <span className="flex flex-wrap items-baseline gap-2">
                <span className="text-ink-2">{line.name}</span>
                <span className="text-caption text-ink-3">
                  {line.entryCount} {line.entryCount === 1 ? "entry" : "entries"}
                </span>
              </span>
              <span className="tnum-l text-ink">{formatCents(line.cashCents)}</span>
            </LRow>
          ))}
          <LRow>
            <span className="font-semibold text-ink">Total</span>
            <span className="tnum-l font-semibold text-ink">{formatCents(totalCents)}</span>
          </LRow>
        </LRows>
      )}
    </LCard>
  );
}

/**
 * Cash flow for a period, derived from the ledger's Cash & bank account:
 * every entry that moved cash, attributed to its counterpart accounts.
 * CASH BASIS BY CONSTRUCTION — only actual cash movements appear (client
 * payments in, expenses out, owner draws/contributions), and the page says
 * so. Opening + net must equal closing, both read from the same ledger;
 * a mismatch refuses the render.
 */
export default async function CashFlowPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const { account } = await requireEntitlement("accounting", "/reports/cash-flow");
  const sp = await searchParams;
  const period = resolveSalesTaxPeriod(sp, todayIso());

  const supabase = await createClient();
  const { error: syncError } = await supabase.rpc("ledger_sync", {
    target_account_id: account.id,
  } as never);

  const [flowRes, openingRes, closingRes] = await Promise.all([
    supabase.rpc("ledger_cash_flow", {
      target_account_id: account.id,
      period_start: period.from,
      period_end: period.to,
    } as never),
    supabase.rpc("ledger_balances", {
      target_account_id: account.id,
      through_date: shiftIsoDate(period.from, -1),
    } as never),
    supabase.rpc("ledger_balances", {
      target_account_id: account.id,
      through_date: period.to,
    } as never),
  ]);

  const error =
    syncError?.message ??
    flowRes.error?.message ??
    openingRes.error?.message ??
    closingRes.error?.message ??
    null;

  const opening = error ? null : bankBalanceCents((openingRes.data ?? []) as LedgerBalanceRow[]);
  const closing = error ? null : bankBalanceCents((closingRes.data ?? []) as LedgerBalanceRow[]);
  const flow =
    error || opening === null || closing === null
      ? null
      : assembleCashFlow((flowRes.data ?? []) as CashFlowRow[], opening, closing);

  return (
    <LPageShell
      title="Cash flow"
      subtitle={`${formatDateRange(period.from, period.to)} · cash basis, from your ledger's Cash & bank account`}
      action={
        <a
          href={`/reports/cash-flow/export?from=${period.from}&to=${period.to}`}
          download
          className={lButtonClass({ variant: "outline" })}
        >
          Download CSV
        </a>
      }
    >
      <LCard>
        <form
          method="get"
          action="/reports/cash-flow"
          className="flex flex-wrap items-end gap-3"
        >
          <div className="flex flex-col gap-1.5">
            <label htmlFor="cf-from" className="text-body-s font-medium text-ink">
              From
            </label>
            <LInput id="cf-from" type="date" name="from" defaultValue={period.from} className="w-40" />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="cf-to" className="text-body-s font-medium text-ink">
              To
            </label>
            <LInput id="cf-to" type="date" name="to" defaultValue={period.to} className="w-40" />
          </div>
          <LButton type="submit" variant="outline" size="sm">
            View period
          </LButton>
        </form>
      </LCard>

      {!flow ? (
        <LAlert tone="crit" className="flex items-start gap-2">
          <WarningIcon className="mt-0.5 shrink-0 text-crit" />
          <span>
            Couldn&rsquo;t load your cash flow. Nothing is shown rather than figures that
            aren&rsquo;t true.
          </span>
        </LAlert>
      ) : !flow.ties ? (
        <LAlert tone="crit" className="flex items-start gap-2">
          <WarningIcon className="mt-0.5 shrink-0 text-crit" />
          <span>
            Opening balance plus net movement doesn&rsquo;t equal the closing balance, which
            should be impossible. This report refuses to show the statement as if it tied.
            Reload the page, and contact support if it persists.
          </span>
        </LAlert>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
            <LCard>
              <LStat label="Opening cash" figure={formatCents(flow.openingCents)} />
            </LCard>
            <LCard>
              <LStat label="Cash in" figure={formatCents(flow.inflowTotalCents)} tone="good" />
            </LCard>
            <LCard>
              <LStat label="Cash out" figure={formatCents(flow.outflowTotalCents)} tone="crit" />
            </LCard>
            <LCard>
              <LStat
                label="Closing cash"
                figure={formatCents(flow.closingCents)}
                sub={`net ${formatCents(flow.netCents)}`}
              />
            </LCard>
          </div>

          <FlowTable title="Cash in" lines={flow.inflows} totalCents={flow.inflowTotalCents} />
          <FlowTable title="Cash out" lines={flow.outflows} totalCents={flow.outflowTotalCents} />

          <LAlert tone="accent" className="flex items-start gap-2">
            <InfoIcon className="mt-0.5 shrink-0 text-accent" />
            <span>
              Cash basis: only money that actually moved. Client payments appear against
              Accounts receivable. The invoice&rsquo;s income was already recognized at issue,
              on the balance sheet side. Mileage never appears here, because the standard-rate
              deduction is not a cash outflow.
            </span>
          </LAlert>
        </>
      )}
    </LPageShell>
  );
}

/* ── Inline icons ──────────────────────────────────────────────────────
 * Ledger screens carry no icon dependency — see components/ledger's own
 * header rule. Same shapes as invoices/page.tsx and
 * invoices/recurring/schedule-form.tsx's own copies. */
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

function InfoIcon({ className }: { className?: string }) {
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
      <circle cx="8" cy="8" r="6.25" />
      <path d="M8 7.25v4" />
      <circle cx="8" cy="4.9" r="0.4" fill="currentColor" stroke="none" />
    </svg>
  );
}

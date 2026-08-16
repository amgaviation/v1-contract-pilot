import NextLink from "next/link";
import { LAlert, lButtonClass } from "@/components/ledger";
import { LPageShell } from "@/components/ledger/page-shell";

import { createClient } from "@/lib/supabase/server";
import { requireEntitlement } from "@/lib/supabase/entitlements";
import ChartManager from "./chart-manager";
import type { LedgerBalanceRow } from "./ledger-lib";
import { todayIso } from "../reports/sales-tax/report-lib";

export const metadata = { title: "Accounting" };

/**
 * The chart of accounts, with live balances. Loading this page first runs
 * pilot.ledger_sync — the on-demand derivation pass that turns invoices,
 * payments, expenses and mileage into ledger entries. It is idempotent by
 * unique index (see the 20260812100000 migration header), so running it
 * on every load is safe by construction; it is what keeps every balance
 * on this screen current with the facts recorded elsewhere in the app.
 */
export default async function AccountingPage() {
  const { account } = await requireEntitlement("accounting", "/accounting");
  const supabase = await createClient();

  // `as never` on rpc args: the same hand-authored-types boundary cast the
  // rest of the app uses (see estimates/actions.ts convertEstimateToInvoice).
  const { error: syncError } = await supabase.rpc("ledger_sync", {
    target_account_id: account.id,
  } as never);

  const { data: balanceData, error: balanceError } = await supabase.rpc(
    "ledger_balances",
    { target_account_id: account.id, through_date: todayIso() } as never
  );

  const error = syncError?.message ?? balanceError?.message ?? null;
  const rows = (balanceData ?? []) as LedgerBalanceRow[];

  return (
    <LPageShell
      title="Accounting"
      subtitle="Your chart of accounts, with balances derived from everything already recorded."
      action={
        <>
          <NextLink href="/accounting/journal" className={lButtonClass({ variant: "outline" })}>
            Journal
          </NextLink>
          <NextLink href="/accounting/reconcile" className={lButtonClass({ variant: "outline" })}>
            Reconcile
          </NextLink>
        </>
      }
    >
      {error ? (
        // A failed read renders as a failure, never as $0 balances —
        // lib/supabase/rows.ts discipline.
        <LAlert tone="crit" className="flex items-start gap-2">
          <WarningIcon className="mt-0.5 shrink-0 text-crit" />
          <span>
            Couldn&rsquo;t load your ledger. The balances below are
            unavailable. Nothing is shown rather than showing zeros that
            aren&rsquo;t true.
          </span>
        </LAlert>
      ) : (
        <>
          <p className="text-body-s text-ink-2">
            Income, payments, expenses, and mileage post here automatically.
            See the{" "}
            <NextLink
              href="/accounting/journal"
              className="font-medium text-accent underline-offset-2 hover:underline"
            >
              journal
            </NextLink>{" "}
            for every entry. Owner pay is tracked as draws (an equity
            account), the way a sole proprietor&rsquo;s books actually work,
            not payroll.
          </p>
          <ChartManager rows={rows} />
        </>
      )}
    </LPageShell>
  );
}

/* ── Inline icon ───────────────────────────────────────────────────────
 * Ledger screens carry no icon dependency — see components/ledger's own
 * header rule. Same shape as invoices/page.tsx's own WarningIcon. */
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

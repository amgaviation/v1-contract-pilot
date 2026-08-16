import { LAlert, LButton, LCard, LRow, LRows, lButtonClass } from "@/components/ledger";
import { LInput } from "@/components/ledger/forms";
import { LPageShell } from "@/components/ledger/page-shell";
import { createClient } from "@/lib/supabase/server";
import { requireEntitlement } from "@/lib/supabase/entitlements";
import { formatCents, formatDate } from "@/lib/format";
import {
  assembleBalanceSheet,
  type BalanceSheetSection,
  type LedgerBalanceRow,
} from "../../accounting/ledger-lib";
import { isValidIsoDate, todayIso } from "../sales-tax/report-lib";

export const metadata = { title: "Balance sheet" };

function SectionTable({ section }: { section: BalanceSheetSection }) {
  return (
    <LCard>
      <p className="mb-2 text-h3 font-semibold">{section.label}</p>
      <LRows>
        {section.lines.map((line) => (
          <LRow key={line.chartAccountId}>
            <span className="text-ink-2">
              {line.name}
              {line.archived ? " (archived)" : ""}
            </span>
            <span className="tnum-l text-ink">{formatCents(line.balanceCents)}</span>
          </LRow>
        ))}
        <LRow>
          <span className="font-semibold text-ink">Total {section.label.toLowerCase()}</span>
          <span className="tnum-l font-semibold text-ink">{formatCents(section.totalCents)}</span>
        </LRow>
      </LRows>
    </LCard>
  );
}

/**
 * Balance sheet as of a date, from pilot.ledger_balances — an aggregate
 * read (one row per chart account), so the Data API's 1000-row cap cannot
 * shortchange a balance. The accounting identity assets = liabilities +
 * equity is ASSERTED in-page: if it doesn't hold, the page refuses to
 * present figures rather than render a sheet that quietly doesn't balance.
 */
export default async function BalanceSheetPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  const { account } = await requireEntitlement("accounting", "/reports/balance-sheet");
  const sp = await searchParams;
  const asOf = sp.date && isValidIsoDate(sp.date) ? sp.date : todayIso();

  const supabase = await createClient();
  const { error: syncError } = await supabase.rpc("ledger_sync", {
    target_account_id: account.id,
  } as never);
  const { data, error: balanceError } = await supabase.rpc("ledger_balances", {
    target_account_id: account.id,
    through_date: asOf,
  } as never);

  const error = syncError?.message ?? balanceError?.message ?? null;
  const sheet = error ? null : assembleBalanceSheet((data ?? []) as LedgerBalanceRow[]);

  return (
    <LPageShell
      title="Balance sheet"
      subtitle={`As of ${formatDate(asOf)} · derived from your ledger (accrual: receivables count when invoiced)`}
      action={
        <a
          href={`/reports/balance-sheet/export?date=${asOf}`}
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
          action="/reports/balance-sheet"
          className="flex flex-wrap items-end gap-3"
        >
          <div className="flex flex-col gap-1.5">
            <label htmlFor="bs-date" className="text-body-s font-medium text-ink">
              As of
            </label>
            <LInput id="bs-date" type="date" name="date" defaultValue={asOf} className="w-40" />
          </div>
          <LButton type="submit" variant="outline" size="sm">
            View
          </LButton>
        </form>
      </LCard>

      {error || !sheet ? (
        <LAlert tone="crit" className="flex items-start gap-2">
          <WarningIcon className="mt-0.5 shrink-0 text-crit" />
          <span>
            Couldn&rsquo;t load your balance sheet. Nothing is shown rather than figures that
            aren&rsquo;t true.
          </span>
        </LAlert>
      ) : !sheet.balances ? (
        <LAlert tone="crit" className="flex items-start gap-2">
          <WarningIcon className="mt-0.5 shrink-0 text-crit" />
          <span>
            This sheet does not balance (assets {formatCents(sheet.totalAssetsCents)} vs
            liabilities + equity {formatCents(sheet.totalLiabilitiesAndEquityCents)}), which
            should be impossible. The ledger enforces debits = credits. This report refuses to
            present it as if it did. Contact support.
          </span>
        </LAlert>
      ) : (
        <>
          <SectionTable section={sheet.assets} />
          <SectionTable section={sheet.liabilities} />
          <LCard>
            <p className="mb-2 text-h3 font-semibold">Equity</p>
            <LRows>
              {sheet.equity.lines.map((line) => (
                <LRow key={line.chartAccountId}>
                  <span className="text-ink-2">
                    {line.name}
                    {line.archived ? " (archived)" : ""}
                  </span>
                  <span className="tnum-l text-ink">{formatCents(line.balanceCents)}</span>
                </LRow>
              ))}
              <LRow>
                <span className="text-ink-2">Net income to date</span>
                <span className="tnum-l text-ink">{formatCents(sheet.netIncomeToDateCents)}</span>
              </LRow>
              <LRow>
                <span className="font-semibold text-ink">Total equity</span>
                <span className="tnum-l font-semibold text-ink">
                  {formatCents(sheet.equity.totalCents + sheet.netIncomeToDateCents)}
                </span>
              </LRow>
            </LRows>
          </LCard>

          <LCard className="flex flex-wrap items-center justify-between gap-3">
            <p className="tnum-l text-body font-semibold text-ink">
              Assets {formatCents(sheet.totalAssetsCents)} = Liabilities + equity{" "}
              {formatCents(sheet.totalLiabilitiesAndEquityCents)}
            </p>
            <span className="text-body-s font-medium text-good">Balances ✓</span>
          </LCard>

          <LAlert tone="accent" className="flex items-start gap-2">
            <InfoIcon className="mt-0.5 shrink-0 text-accent" />
            <span>
              Accounts receivable counts invoices from the day they were issued (accrual). The
              P&amp;L and tax reports count income when payments arrive (cash). Both derive from
              the same records, on different bases, and each screen says which it uses.
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

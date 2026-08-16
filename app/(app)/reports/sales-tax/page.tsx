import NextLink from "next/link";
import { LAlert, LButton, LCard, LPill, LTable, LTd, LTh, lButtonClass } from "@/components/ledger";
import { LPageShell } from "@/components/ledger/page-shell";

import { createClient } from "@/lib/supabase/server";
import { requireEntitlement } from "@/lib/supabase/entitlements";
import { formatCents, formatDate } from "@/lib/format";
import { friendlyDbError } from "@/lib/db-errors";
import { loadSalesTaxReport, SALES_TAX_LIMIT } from "./queries";
import {
  correctionNote,
  formatBps,
  resolveSalesTaxPeriod,
  todayIso,
} from "./report-lib";

export const metadata = { title: "Sales tax" };

// components/ledger/forms.tsx (LInput) hasn't landed on this branch yet —
// it ships from the same money-surface migration that also does
// Invoices/Estimates, elsewhere in this Phase 4/5 fan-out. These are the
// two fields this screen needs, styled inline to LInput's own control
// recipe (see that file's header once it lands) rather than reaching for
// components/ui.
const FIELD_INPUT =
  "h-9 w-40 rounded-control border border-hair-strong bg-card px-3 text-body text-ink " +
  "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent";

/**
 * The sales tax report: what the pilot's invoices charged as state
 * sales/service tax, and what has actually been collected in a period —
 * the worksheet a filing preparer works from. Wave-parity feature.
 *
 * WHAT THIS PAGE MUST NEVER DO (domain rule): give tax advice. It reports
 * what was charged and collected, full stop — it never says what the
 * pilot owes, whether they must register or file anywhere, or anything
 * about any jurisdiction's rules. And there is no FET here by design:
 * pilot-services invoices carry no federal excise tax (see the Phase 5
 * migration's header), so this page has nothing to say about it.
 *
 * Basis: CASH — an invoice's tax counts on the day it was paid in full
 * (the first-crossing date of its payment ledger), matching the
 * payments-received basis of year-end/quarterly/profit-loss. A later
 * payment correction never erases an already-reported period: it shows as
 * a negative row in the period the correction was made. See
 * report-lib.ts's header for the full decision record.
 */
export default async function SalesTaxReportPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const { account } = await requireEntitlement("sales_tax_report", "/reports/sales-tax");
  const sp = await searchParams;

  const today = todayIso();
  const period = resolveSalesTaxPeriod(sp, today);
  const currentYear = Number(today.slice(0, 4));
  const lastYear = { from: `${currentYear - 1}-01-01`, to: `${currentYear - 1}-12-31` };
  const isThisYear = period.usedDefault;
  const isLastYear = period.from === lastYear.from && period.to === lastYear.to;

  const supabase = await createClient();
  const report = await loadSalesTaxReport(supabase, account.id, period);

  const csvHref = `/reports/sales-tax/export?from=${period.from}&to=${period.to}`;

  return (
    <LPageShell
      title="Sales tax"
      subtitle={`${formatDate(period.from)} to ${formatDate(period.to)} · tax charged on invoices, cash-basis`}
      action={
        report.error === null && !report.truncated ? (
          <a href={csvHref} download className={lButtonClass({ variant: "outline" })}>
            Download CSV
          </a>
        ) : undefined
      }
    >
      {/* Period controls: two presets plus an explicit range. Links and a
          GET form, no client component — the server re-resolves
          ?from=/?to= on every request, so the URL is shareable and the
          back button works (same pattern as the invoice list's filter
          chips: the active preset's filled state is a state indicator,
          not a second call to action). */}
      <div className="flex flex-wrap items-center gap-2">
        <NextLink
          href="/reports/sales-tax"
          className={lButtonClass({ variant: isThisYear ? "primary" : "outline", size: "sm" })}
        >
          This year
        </NextLink>
        <NextLink
          href={`/reports/sales-tax?from=${lastYear.from}&to=${lastYear.to}`}
          className={lButtonClass({ variant: isLastYear ? "primary" : "outline", size: "sm" })}
        >
          Last year
        </NextLink>
        <form method="get" className="flex flex-wrap items-center gap-2">
          <input
            type="date"
            name="from"
            defaultValue={period.from}
            aria-label="Report period start"
            className={FIELD_INPUT}
          />
          <span className="text-body-s text-ink-3">to</span>
          <input
            type="date"
            name="to"
            defaultValue={period.to}
            aria-label="Report period end"
            className={FIELD_INPUT}
          />
          <LButton type="submit" variant="outline" size="sm">
            Apply
          </LButton>
        </form>
      </div>

      {/* LOAD-BEARING, deliberately first — same placement and register as
          the other reports' disclaimers. States the basis in plain words
          and what this page is NOT: it reports figures for whoever
          prepares the pilot's filings; it does not know or say what is
          owed, or where. */}
      <LAlert tone="accent" className="flex items-start gap-2">
        <InfoIcon className="mt-0.5 shrink-0 text-accent" />
        <div className="flex flex-col gap-1">
          <p className="font-medium text-ink">
            What your invoices charged as sales tax, and what&rsquo;s been collected. These are
            the figures for whoever prepares your filings.
          </p>
          <p className="text-body-s">
            Cash-basis, matching this product&rsquo;s other reports: an invoice&rsquo;s tax
            counts on the day it was paid in full, not the day it was issued. If a payment is
            corrected later, the period it was originally counted in stands unchanged, and the
            correction appears as a negative row in the period the correction was made. Tax
            charged on invoices still awaiting payment is shown separately below and is not in
            the totals. This page doesn&rsquo;t know your filing requirements and doesn&rsquo;t
            calculate what to remit.
          </p>
        </div>
      </LAlert>

      {report.error !== null ? (
        // A failed read renders a FAILURE, never an empty report — a tax
        // page showing $0.00 is a claim that no tax was collected, and
        // this screen has no basis for that claim right now. See
        // lib/supabase/rows.ts for the house reasoning.
        <LCard>
          <LAlert tone="crit" className="flex items-start gap-2">
            <WarningIcon className="mt-0.5 shrink-0 text-crit" />
            <span>
              {friendlyDbError({ message: report.error }, "sales-tax.load")} Nothing is shown
              rather than a partial figure. A short total here would misstate what was
              collected.
            </span>
          </LAlert>
        </LCard>
      ) : (
        <div className="flex flex-col gap-5">
          {report.truncated ? (
            <LAlert tone="warn" className="flex items-start gap-2">
              <WarningIcon className="mt-0.5 shrink-0 text-warn" />
              <span>
                This period has more than {SALES_TAX_LIMIT} rows behind one of its figures, so
                the totals below may be partial. Narrow the date range. The CSV export refuses
                a partial file outright.
              </span>
            </LAlert>
          ) : null}

          {/* ---------------- Collected ---------------- */}
          <LCard>
            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
              <div>
                <p className="text-h3 font-semibold">Tax collected</p>
                <p className="text-body-s text-ink-2">
                  Invoices paid in full {formatDate(period.from)} through{" "}
                  {formatDate(period.to)} that charged tax, and corrections made this period to
                  previously counted payments.
                </p>
              </div>
              <p className="tnum-l text-figure font-bold tracking-tight">
                {formatCents(report.taxTotalCents)}
              </p>
            </div>

            {report.rows.length === 0 ? (
              <p className="text-body-s text-ink-3">
                No tax was collected on invoices paid in full this period.
              </p>
            ) : (
              <LTable>
                <caption>
                  <span className="sr-only">Tax collected</span>
                </caption>
                <thead>
                  <tr>
                    <LTh>Invoice</LTh>
                    <LTh>Client</LTh>
                    <LTh>Issued</LTh>
                    {/* "Counted on", not "Paid in full": for a collected
                        row it IS the day the invoice was paid in full; for
                        a correction row it's the day the correction was
                        made — the header must be true of both. */}
                    <LTh>Counted on</LTh>
                    <LTh numeric>Taxable subtotal</LTh>
                    <LTh numeric>Rate</LTh>
                    <LTh numeric>Tax</LTh>
                  </tr>
                </thead>
                <tbody>
                  {report.rows.map((row) => (
                    // One invoice can legitimately appear more than once —
                    // settled, corrected, settled again — so the key is
                    // the (invoice, event kind, date) triple, which the
                    // assembly guarantees unique.
                    <tr key={`${row.invoiceId}-${row.kind}-${row.countedOn}`}>
                      <th
                        scope="row"
                        className="border-b border-hair px-3 py-2.5 text-left align-baseline font-medium text-ink first:pl-0 last:pr-0"
                      >
                        {row.invoiceNumber}
                        {row.kind === "correction" && row.previouslyCountedOn ? (
                          <span className="block text-caption font-normal text-ink-3">
                            {correctionNote(formatDate(row.previouslyCountedOn))}
                          </span>
                        ) : null}
                      </th>
                      <LTd>
                        <span className="text-ink-2">{row.clientName}</span>
                      </LTd>
                      <LTd>
                        <span className="text-ink-2">{formatDate(row.issuedOn)}</span>
                      </LTd>
                      <LTd>
                        <span className="text-ink-2">{formatDate(row.countedOn)}</span>
                      </LTd>
                      <LTd numeric>{formatCents(row.taxableSubtotalCents)}</LTd>
                      <LTd numeric>{formatBps(row.taxRateBps)}</LTd>
                      <LTd numeric>
                        <span className="font-medium">{formatCents(row.taxCents)}</span>
                      </LTd>
                    </tr>
                  ))}
                  <tr>
                    <th
                      scope="row"
                      className="border-b border-hair px-3 py-2.5 text-left align-baseline font-semibold text-ink first:pl-0 last:pr-0"
                    >
                      Total
                    </th>
                    <LTd />
                    <LTd />
                    <LTd />
                    <LTd numeric>
                      <span className="font-semibold">{formatCents(report.taxableTotalCents)}</span>
                    </LTd>
                    <LTd />
                    <LTd numeric>
                      <span className="font-semibold">{formatCents(report.taxTotalCents)}</span>
                    </LTd>
                  </tr>
                </tbody>
              </LTable>
            )}

            {report.untaxedPaidCount > 0 ? (
              <p className="mt-3 text-body-s text-ink-2">
                {report.untaxedPaidCount} other invoice
                {report.untaxedPaidCount === 1 ? "" : "s"} paid in full this period charged no
                tax and {report.untaxedPaidCount === 1 ? "isn't" : "aren't"} listed.
              </p>
            ) : null}
          </LCard>

          {/* ---------------- Charged, not yet collected ---------------- */}
          <LCard>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="text-h3 font-semibold">Charged, not yet collected</p>
                <p className="text-body-s text-ink-2">
                  Tax on invoices issued {formatDate(period.from)} through{" "}
                  {formatDate(period.to)} that are still awaiting full payment. It is not
                  included in the totals above. Each will count on the day it&rsquo;s paid in
                  full.
                </p>
              </div>
              {report.awaitingCount > 0 ? (
                <LPill tone="warn" className="tnum-l">
                  {report.awaitingCount} · {formatCents(report.awaitingTaxCents)}
                </LPill>
              ) : null}
            </div>
            {report.awaitingCount === 0 ? (
              <p className="mt-3 text-body-s text-ink-3">
                No tax outstanding on invoices issued this period.
              </p>
            ) : null}
          </LCard>
        </div>
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

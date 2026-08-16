import NextLink from "next/link";
import { LAlert, LCard, LPill, LTable, LTd, LTh, lButtonClass } from "@/components/ledger";
import { LPageShell } from "@/components/ledger/page-shell";

import { createClient } from "@/lib/supabase/server";
import { requireAccount } from "@/lib/supabase/account";
import { formatCents } from "@/lib/format";
import { friendlyDbError } from "@/lib/db-errors";
import { currentTaxYear } from "../year-end/db";
import { loadOptionLabels } from "@/lib/custom-options-read";
import { loadProfitLossReport, resolvePLPeriod, type Comparison } from "./queries";
import {
  PeriodComparisonBarChart,
  type PeriodComparisonDatum,
} from "@/components/charts/period-comparison-bar-chart";

export const metadata = { title: "Profit & loss" };

const YEAR_RANGE = 6;

function yearOptions(selected: number): number[] {
  const current = currentTaxYear();
  const base = Math.max(selected, current);
  const years: number[] = [];
  for (let y = base + 1; y >= base - YEAR_RANGE; y--) years.push(y);
  return years;
}

function periodHref(
  year: number,
  kind: "year" | "quarter" | "month" | "mtd",
  extra?: Record<string, string | number>
): string {
  const params = new URLSearchParams({ year: String(year), kind });
  if (extra) {
    for (const [k, v] of Object.entries(extra)) params.set(k, String(v));
  }
  return `/reports/profit-loss?${params.toString()}`;
}

function csvHref(period: ReturnType<typeof resolvePLPeriod>): string {
  const params = new URLSearchParams({
    kind: period.kind,
    start: period.start,
    end: period.end,
    priorStart: period.priorStart,
    priorEnd: period.priorEnd,
  });
  return `/reports/profit-loss/export?${params.toString()}`;
}

function DeltaBadge({ comparison, invert = false }: { comparison: Comparison; invert?: boolean }) {
  if (!comparison.hasPriorData) {
    return <span className="text-body-s text-ink-2">No prior data</span>;
  }
  const positive = comparison.deltaCents > 0;
  const negative = comparison.deltaCents < 0;
  // For expenses, a rise is unfavourable — invert which tone reads as
  // "good" without changing the arithmetic or the sign shown.
  const good = invert ? negative : positive;
  const bad = invert ? positive : negative;
  const tone = good ? "good" : bad ? "warn" : "neutral";
  const sign = comparison.deltaCents > 0 ? "+" : "";
  return (
    <LPill tone={tone} className="tnum-l">
      {sign}
      {formatCents(comparison.deltaCents)}
      {comparison.deltaPercent !== null
        ? ` (${sign}${comparison.deltaPercent.toFixed(1)}%)`
        : ""}
    </LPill>
  );
}

export default async function ProfitLossReportPage({
  searchParams,
}: {
  searchParams: Promise<{
    kind?: string;
    year?: string;
    quarter?: string;
    month?: string;
    start?: string;
    end?: string;
  }>;
}) {
  const { account } = await requireAccount("/reports/profit-loss");
  const sp = await searchParams;

  const current = currentTaxYear();
  const parsedYear = Number(sp.year);
  const year =
    sp.year && Number.isInteger(parsedYear) && parsedYear >= 2000 && parsedYear <= 2100
      ? parsedYear
      : current;

  const period = resolvePLPeriod(sp);

  const supabase = await createClient();
  const report = await loadProfitLossReport(supabase, account.id, period);
  // The tenant's own category names, so a rename reaches the reports as
  // well as the expenses list. Retired categories are included: a report
  // is history, and a category a pilot has since retired still has spend
  // filed under it.
  const categoryLabels = await loadOptionLabels("expense_category");

  const netProfitCents = report.incomeComparison.currentCents - report.expensesComparison.currentCents;

  // Fed from the SAME comparisons the Income/Expenses cards below already
  // render — no second read, no figure that could disagree with the
  // tables it sits above. Two categories, always: this never needs the
  // "at least 2 data points" gate the trip-margin chart does, but the
  // chart component is written generically, so the check stays explicit
  // rather than assumed.
  const comparisonData: PeriodComparisonDatum[] = [
    {
      category: "Income",
      currentCents: report.incomeComparison.currentCents,
      priorCents: report.incomeComparison.priorCents,
    },
    {
      category: "Expenses",
      currentCents: report.expensesComparison.currentCents,
      priorCents: report.expensesComparison.priorCents,
    },
  ];
  const comparisonAriaLabel =
    `Income and expenses, ${period.label} versus ${period.priorLabel}. ` +
    `Income: ${formatCents(report.incomeComparison.currentCents)} this period, ` +
    `${formatCents(report.incomeComparison.priorCents)} prior period. ` +
    `Expenses: ${formatCents(report.expensesComparison.currentCents)} this period, ` +
    `${formatCents(report.expensesComparison.priorCents)} prior period.`;

  return (
    <LPageShell
      title="Profit & loss"
      subtitle={`${period.label} · income and expenses, cash-basis`}
      action={
        <div className="flex flex-wrap gap-2">
          <div className="flex flex-wrap gap-1">
            <NextLink
              href={periodHref(year, "year")}
              className={lButtonClass({ variant: period.kind === "year" ? "primary" : "outline", size: "sm" })}
            >
              Year
            </NextLink>
            <NextLink
              href={periodHref(year, "quarter", { quarter: 1 })}
              className={lButtonClass({ variant: period.kind === "quarter" ? "primary" : "outline", size: "sm" })}
            >
              Quarter
            </NextLink>
            <NextLink
              href={periodHref(year, "month", { month: 1 })}
              className={lButtonClass({ variant: period.kind === "month" ? "primary" : "outline", size: "sm" })}
            >
              Month
            </NextLink>
            <NextLink
              href={periodHref(year, "mtd")}
              className={lButtonClass({ variant: period.kind === "mtd" ? "primary" : "outline", size: "sm" })}
            >
              Month to date
            </NextLink>
          </div>
          <a href={csvHref(period)} download className={lButtonClass({ variant: "outline", size: "sm" })}>
            Download CSV
          </a>
        </div>
      }
    >
      {period.kind === "year" ? (
        <div className="flex flex-wrap gap-2">
          {yearOptions(year).map((y) => (
            <NextLink
              key={y}
              href={periodHref(y, "year")}
              className={lButtonClass({ variant: y === year ? "primary" : "outline", size: "sm" })}
            >
              {y}
            </NextLink>
          ))}
        </div>
      ) : null}

      {period.kind === "quarter" ? (
        <div className="flex flex-wrap gap-2">
          {[1, 2, 3, 4].map((q) => (
            <NextLink
              key={q}
              href={periodHref(year, "quarter", { quarter: q })}
              className={lButtonClass({
                variant: sp.quarter === String(q) || (!sp.quarter && q === 1) ? "primary" : "outline",
                size: "sm",
              })}
            >
              {`Q${q}`}
            </NextLink>
          ))}
        </div>
      ) : null}

      {period.kind === "month" ? (
        <div className="flex flex-wrap gap-2">
          {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
            <NextLink
              key={m}
              href={periodHref(year, "month", { month: m })}
              className={lButtonClass({
                variant: sp.month === String(m) || (!sp.month && m === 1) ? "primary" : "outline",
                size: "sm",
              })}
            >
              {m}
            </NextLink>
          ))}
        </div>
      ) : null}

      {/* LOAD-BEARING, deliberately first — same placement and register as
          app/(app)/reports/year-end/page.tsx and
          app/(app)/reports/quarterly/page.tsx's own disclaimers. This is
          arithmetic on the pilot's own ledger, not a filed return and not
          tax advice — but unlike quarterly's "net profit" line, this
          screen doesn't touch tax rates or set-asides at all, so it
          doesn't need to caveat as heavily. */}
      <LAlert tone="accent" className="flex items-start gap-2">
        <InfoIcon className="mt-0.5 shrink-0 text-accent" />
        <div>
          <div className="font-medium text-ink">
            This is your own ledger, summarized. Not a filed statement.
          </div>
          <div className="mt-1">
            Income is cash-basis: payments actually received in this
            period, not invoices issued. Expenses are the receipts you
            tagged as deductions. It doesn&rsquo;t know your tax situation.
            For that, see the{" "}
            <NextLink href="/reports/year-end" className="text-accent hover:underline">
              year-end report
            </NextLink>{" "}
            or{" "}
            <NextLink href="/reports/quarterly" className="text-accent hover:underline">
              quarterly estimated tax
            </NextLink>
            .
          </div>
        </div>
      </LAlert>

      {report.error ? (
        <LCard>
          <LAlert tone="crit" className="flex items-start gap-2">
            <WarningIcon className="mt-0.5 shrink-0 text-crit" />
            <span>{friendlyDbError({ message: report.error }, "profit-loss.load")}</span>
          </LAlert>
        </LCard>
      ) : (
        <>
          {period.priorIsApproximate ? (
            <LAlert tone="neutral" className="flex items-start gap-2">
              <InfoIcon className="mt-0.5 shrink-0 text-ink-3" />
              <span>
                A custom range has no calendar unit to compare against, so
                &ldquo;{period.priorLabel}&rdquo; is the same number of
                days immediately before your range. That is an
                approximation, not the same calendar period last cycle.
              </span>
            </LAlert>
          ) : null}

          {report.incomeTruncated || report.expensesTruncated ? (
            <LAlert tone="warn" className="flex items-start gap-2">
              <WarningIcon className="mt-0.5 shrink-0 text-warn" />
              <span>
                There are more {report.incomeTruncated ? "payments (or clients)" : ""}
                {report.incomeTruncated && report.expensesTruncated ? " and " : ""}
                {report.expensesTruncated ? "deductible expenses" : ""} in
                this period (or its comparison period) than this page
                totals. The figures below and the downloaded CSV may both
                be partial. Contact support if your totals look short.
              </span>
            </LAlert>
          ) : null}

          {/* ---------------- Income vs. expenses, at a glance ----------------
              Above the figures it summarizes, never displacing them — the
              Income/Expenses/Net profit cards below still carry every
              exact number and the delta pills; this is a compact visual
              read of the same two comparisons for the two data points
              (income, expenses) where a chart earns its place over a
              third number grid. */}
          {comparisonData.length >= 2 ? (
            <LCard>
              <h2 className="mb-1 text-h3 font-semibold">Income vs. expenses</h2>
              <p className="mb-3 text-body-s text-ink-2">
                {period.label} compared against {period.priorLabel}.
              </p>
              <PeriodComparisonBarChart
                data={comparisonData}
                currentLabel={period.label}
                priorLabel={period.priorLabel}
                ariaLabel={comparisonAriaLabel}
              />
            </LCard>
          ) : null}

          {/* ---------------- Income ---------------- */}
          <LCard>
            <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
              <div>
                <h2 className="text-h3 font-semibold">Income, by client</h2>
                <p className="text-body-s text-ink-2">
                  Cash-basis: payments received {period.start} through{" "}
                  {period.end}.
                </p>
              </div>
              <div className="flex flex-col items-end gap-1">
                <span className="tnum-l font-bold">
                  {formatCents(report.incomeComparison.currentCents)}
                </span>
                <DeltaBadge comparison={report.incomeComparison} />
              </div>
            </div>

            {report.incomeByClient.length === 0 ? (
              <p className="text-body-s text-ink-2">
                No payments recorded as received this period.
              </p>
            ) : (
              <LTable>
                <thead>
                  <tr>
                    <LTh>Client</LTh>
                    <LTh numeric>Payments</LTh>
                    <LTh numeric>Received</LTh>
                  </tr>
                </thead>
                <tbody>
                  {report.incomeByClient.map((c) => (
                    <tr key={c.clientId || c.clientName}>
                      <th
                        scope="row"
                        className="border-b border-hair px-3 py-2.5 text-left align-baseline font-medium text-ink first:pl-0 last:pr-0"
                      >
                        {c.clientName}
                      </th>
                      <LTd numeric>{c.paymentCount}</LTd>
                      <LTd numeric>
                        <span className="font-medium">{formatCents(c.totalCents)}</span>
                      </LTd>
                    </tr>
                  ))}
                </tbody>
              </LTable>
            )}
          </LCard>

          {/* ---------------- Expenses ---------------- */}
          <LCard>
            <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
              <div>
                <h2 className="text-h3 font-semibold">Expenses</h2>
                <p className="text-body-s text-ink-2">
                  Deductible receipts plus rebilled costs, incurred{" "}
                  {period.start} through {period.end}. Unassigned receipts
                  are shown separately below.
                </p>
              </div>
              <div className="flex flex-col items-end gap-1">
                <span className="tnum-l font-bold">
                  {formatCents(report.expensesComparison.currentCents)}
                </span>
                <DeltaBadge comparison={report.expensesComparison} invert />
              </div>
            </div>

            {report.expensesByCategory.length === 0 && report.rebilledCount === 0 ? (
              <p className="text-body-s text-ink-2">No expenses this period.</p>
            ) : (
              <LTable>
                <thead>
                  <tr>
                    <LTh>Category</LTh>
                    <LTh numeric>Receipts</LTh>
                    <LTh numeric>Amount</LTh>
                  </tr>
                </thead>
                <tbody>
                  {report.expensesByCategory.map((c) => (
                    <tr key={c.category}>
                      <th
                        scope="row"
                        className="border-b border-hair px-3 py-2.5 text-left align-baseline font-medium text-ink first:pl-0 last:pr-0"
                      >
                        {categoryLabels[c.category] ?? c.category}
                      </th>
                      <LTd numeric>{c.count}</LTd>
                      <LTd numeric>
                        <span className="font-medium">{formatCents(c.totalCents)}</span>
                      </LTd>
                    </tr>
                  ))}
                  {report.rebilledCount > 0 ? (
                    <tr>
                      <th
                        scope="row"
                        className="border-b border-hair px-3 py-2.5 text-left align-baseline font-medium text-ink first:pl-0 last:pr-0"
                      >
                        Rebilled costs (paired with the reimbursement in Income above)
                      </th>
                      <LTd numeric>{report.rebilledCount}</LTd>
                      <LTd numeric>
                        <span className="font-medium">{formatCents(report.rebilledCostCents)}</span>
                      </LTd>
                    </tr>
                  ) : null}
                </tbody>
              </LTable>
            )}

            {report.rebilledCount > 0 ? (
              <LAlert tone="neutral" className="mt-4 flex items-start gap-2">
                <InfoIcon className="mt-0.5 shrink-0 text-ink-3" />
                <span>
                  {report.rebilledCount} rebilled receipt
                  {report.rebilledCount === 1 ? "" : "s"} totaling{" "}
                  <span className="tnum-l">{formatCents(report.rebilledCostCents)}</span>{" "}
                  this period ARE counted above, as their own line inside
                  Expenses. This is money you actually paid out of pocket,
                  so it is not excluded. The matching reimbursement is a
                  client payment already counted in Income above.
                  Subtracting the outflow here is what lets the two sides
                  of that pass-through net out to the true economic
                  result. See the{" "}
                  <NextLink href="/reports/year-end" className="text-accent hover:underline">
                    year-end report
                  </NextLink>{" "}
                  for the full rebilled/invoiced reconciliation.
                  {report.rebilledTruncated
                    ? " (There are more rebilled receipts than counted here, too.)"
                    : ""}
                </span>
              </LAlert>
            ) : null}
          </LCard>

          {/* ---------------- Mileage, flagged ---------------- */}
          <LCard>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h2 className="text-h3 font-semibold">Mileage</h2>
                <p className="text-body-s text-ink-2">
                  Standard-mileage-rate drives logged {period.start} through{" "}
                  {period.end}. These are excluded from Expenses above. The
                  standard mileage rate and actual vehicle expenses (fuel,
                  rental car) are alternative deduction methods for the
                  same vehicle, never additive. This report can&rsquo;t
                  tell which one applies to a given vehicle and year, so
                  folding this in automatically risks a double-claimed
                  deduction. Review it in{" "}
                  <NextLink href="/expenses/mileage" className="text-accent hover:underline">
                    Mileage
                  </NextLink>{" "}
                  before filing.
                </p>
              </div>
              {report.mileageCount > 0 ? (
                <LPill tone="neutral" className="tnum-l">
                  {report.mileageCount} · {formatCents(report.mileageTotalCents)}
                </LPill>
              ) : null}
            </div>
            {report.mileageMilesWithoutRate > 0 ? (
              <LAlert tone="warn" className="mt-3 flex items-start gap-2">
                <WarningIcon className="mt-0.5 shrink-0 text-warn" />
                <span>
                  {`${report.mileageMilesWithoutRate} miles are not in the figure above. There's no IRS standard rate on file for their tax year. Add it in Settings and this recomputes.`}
                </span>
              </LAlert>
            ) : null}
            {report.mileageTruncated ? (
              <LAlert tone="warn" className="mt-3 flex items-start gap-2">
                <WarningIcon className="mt-0.5 shrink-0 text-warn" />
                <span>There are more logged drives this period than this page totals.</span>
              </LAlert>
            ) : null}
            {report.mileageCount === 0 ? (
              <p className="text-body-s text-ink-2">No mileage logged this period.</p>
            ) : null}
          </LCard>

          {/* ---------------- Net profit ---------------- */}
          <LCard>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-h3 font-semibold">Net profit</h2>
              <div className="flex flex-col items-end gap-1">
                <span className="tnum-l text-figure font-bold tracking-tight">
                  {formatCents(netProfitCents)}
                </span>
                <DeltaBadge comparison={report.netProfitComparison} />
              </div>
            </div>
            <p className="mt-2 text-body-s text-ink-2">
              Income minus deductible expenses for {period.label}, compared
              against {period.priorLabel}.
            </p>
          </LCard>

          {/* ---------------- Unassigned receipts, flagged ---------------- */}
          <LCard>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h2 className="text-h3 font-semibold">Unassigned receipts</h2>
                <p className="text-body-s text-ink-2">
                  These receipts are neither billed to a client nor
                  claimed as a deduction, so they are excluded from both
                  Income and Expenses above. Resolve them on{" "}
                  <NextLink href="/expenses" className="text-accent hover:underline">
                    Expenses
                  </NextLink>
                  .
                </p>
              </div>
              {report.unassignedCount > 0 ? (
                <LPill tone="warn" className="tnum-l">
                  {report.unassignedCount} · {formatCents(report.unassignedTotalCents)}
                </LPill>
              ) : null}
            </div>
            {report.unassignedTruncated ? (
              <LAlert tone="warn" className="mt-3 flex items-start gap-2">
                <WarningIcon className="mt-0.5 shrink-0 text-warn" />
                <span>There are more unassigned receipts this period than this page totals.</span>
              </LAlert>
            ) : null}
            {report.unassignedCount === 0 ? (
              <p className="text-body-s text-ink-2">Nothing unassigned this period.</p>
            ) : null}
          </LCard>
        </>
      )}
    </LPageShell>
  );
}

/* ── Inline icons ─────────────────────────────────────────────────────
 * Ledger screens carry no icon dependency — see components/ledger's own
 * header rule. */
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

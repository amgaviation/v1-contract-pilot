import NextLink from "next/link";
import { LAlert, LButton, LCard, LTd, LTh, LTable, lButtonClass } from "@/components/ledger";
import { LPageShell } from "@/components/ledger/page-shell";
import { cn } from "@/lib/ledger/cn";

import { createClient } from "@/lib/supabase/server";
import { requireAccount } from "@/lib/supabase/account";
import { formatCents, formatDate } from "@/lib/format";
import { friendlyDbError } from "@/lib/db-errors";
import { currentTaxYear } from "../year-end/db";
import { loadOptionLabels } from "@/lib/custom-options-read";
import { loadQuarterlyReport } from "./queries";

export const metadata = { title: "Quarterly estimated tax" };

const YEAR_RANGE = 6;

function yearOptions(selected: number): number[] {
  const current = currentTaxYear();
  const base = Math.max(selected, current);
  const years: number[] = [];
  for (let y = base + 1; y >= base - YEAR_RANGE; y--) years.push(y);
  return years;
}

function csvHref(year: number): string {
  return `/reports/quarterly/export?year=${year}`;
}

const ROW_HEADER =
  "border-b border-hair px-3 py-2.5 text-left align-baseline font-medium text-ink first:pl-0 last:pr-0";

// components/ledger/forms.tsx (LInput) hasn't landed on this branch yet —
// it ships from the same money-surface migration that also does
// Invoices/Estimates, elsewhere in this Phase 4/5 fan-out. This is the one
// field this screen needs, styled inline to LInput's own control recipe
// (see that file's header once it lands) rather than reaching for
// components/ui.
const FIELD_INPUT =
  "h-9 w-24 rounded-control border border-hair-strong bg-card px-3 text-body text-ink " +
  "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent";

/**
 * Parses the ?setAside= query param into a percentage (0-100), or null
 * if absent/invalid. This is deliberately NOT React
 * client state and NOT persisted anywhere: the set-aside rate is a
 * scratch "what if" figure, not a record, so it lives in the URL — the
 * same mechanism this page's own year selector uses (below), and the one
 * this route group already establishes for ephemeral view state. That
 * also means the percentage a pilot types is shareable/bookmarkable but
 * never written to the database, matching the task's "deliberately not
 * persisted" requirement without introducing a client component.
 */
function parseSetAsidePercent(raw: string | undefined): number | null {
  if (!raw) return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0 || n > 100) return null;
  return n;
}

export default async function QuarterlyReportPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string; setAside?: string }>;
}) {
  const { account } = await requireAccount("/reports/quarterly");
  const { year: yearParam, setAside: setAsideParam } = await searchParams;

  const current = currentTaxYear();
  const parsedYear = Number(yearParam);
  const year =
    yearParam && Number.isInteger(parsedYear) && parsedYear >= 2000 && parsedYear <= 2100
      ? parsedYear
      : current;

  const setAsidePercent = parseSetAsidePercent(setAsideParam);

  const supabase = await createClient();
  const report = await loadQuarterlyReport(supabase, account.id, year);
  // The tenant's own category names, so a rename reaches the reports as
  // well as the expenses list. Retired categories are included: a report
  // is history, and a category a pilot has since retired still has spend
  // filed under it.
  const categoryLabels = await loadOptionLabels("expense_category");

  return (
    <LPageShell
      title="Quarterly estimated tax"
      subtitle={`Tax year ${year} · cash received and expenses incurred, by IRS estimated-tax period`}
      action={
        <div className="flex flex-wrap items-center gap-2">
          {yearOptions(year).map((y) => (
            <NextLink
              key={y}
              href={`/reports/quarterly?year=${y}${
                setAsidePercent !== null ? `&setAside=${setAsidePercent}` : ""
              }`}
              className={lButtonClass({ variant: y === year ? "primary" : "outline", size: "sm" })}
            >
              {y}
            </NextLink>
          ))}
          <a href={csvHref(year)} download className={lButtonClass({ variant: "outline" })}>
            Download CSV
          </a>
        </div>
      }
    >
      {/* LOAD-BEARING, deliberately first — same placement and register as
          app/(app)/reports/year-end/page.tsx's own disclaimer. This screen
          shows net profit, which is an honest number straight from the
          pilot's own ledger, but it never computes what they owe: actual
          liability depends on self-employment tax, the QBI deduction,
          filing status, a spouse's withholding, and other income this
          product cannot see. */}
      <LAlert tone="accent" className="flex items-start gap-2">
        <InfoIcon className="mt-0.5 shrink-0 text-accent" />
        <div className="flex flex-col gap-1">
          <p className="font-medium text-ink">
            This is a planning aid computed from the records you entered. It is not a tax
            calculation, and it is not tax advice.
          </p>
          <p className="text-body-s">
            Net profit below is income minus deductible expenses and rebilled costs. It does
            NOT include the standard-mileage deduction, which is informational only. The
            standard rate and actual vehicle expenses are alternative deduction methods, never
            both, and this report can&rsquo;t tell which one you elected. It also does not
            account for self-employment tax, the QBI deduction, your filing status, a
            spouse&rsquo;s withholding, or other income. The &ldquo;Set aside&rdquo; column is
            simple arithmetic on a percentage you choose, applied to that same net profit, and
            it also does not include mileage. This is not a number this product is asserting as
            correct. Confirm amounts and due dates with a tax professional or the IRS before you
            pay.
          </p>
        </div>
      </LAlert>

      {report.error ? (
        <LCard>
          <LAlert tone="crit" className="flex items-start gap-2">
            <WarningIcon className="mt-0.5 shrink-0 text-crit" />
            <span>{friendlyDbError({ message: report.error }, "quarterly.load")}</span>
          </LAlert>
        </LCard>
      ) : (
        <div className="flex flex-col gap-5">
          {report.paymentsTruncated || report.deductibleTruncated ? (
            <LAlert tone="warn" className="flex items-start gap-2">
              <WarningIcon className="mt-0.5 shrink-0 text-warn" />
              <span>
                There are more {report.paymentsTruncated ? "payments" : ""}
                {report.paymentsTruncated && report.deductibleTruncated ? " and " : ""}
                {report.deductibleTruncated ? "deductible expenses" : ""} in {year} than this
                page totals. The figures below and the downloaded CSV may both be partial.
                Contact support if your totals look short.
              </span>
            </LAlert>
          ) : null}

          {report.mileageTruncated ? (
            <LAlert tone="warn" className="flex items-start gap-2">
              <WarningIcon className="mt-0.5 shrink-0 text-warn" />
              <span>
                There are more drives logged in {year} than this page totals. The mileage
                figures below and the downloaded CSV may both be partial.
              </span>
            </LAlert>
          ) : null}

          {/* Set-aside rate: a plain GET form, not client state — see
              parseSetAsidePercent's comment above for why. Submitting
              re-requests this same page with ?setAside= added, so the
              server recomputes every period's "Set aside" column; nothing
              about the rate is ever written to the database. */}
          <LCard>
            <p className="mb-2 text-h3 font-semibold">Set-aside percentage</p>
            <p className="mb-3 text-body-s text-ink-2">
              Enter a percentage of net profit you want to set aside for taxes. This is your
              own estimate, not one this product provides: left blank until you enter one, and
              never saved.
            </p>
            <form method="GET" action="/reports/quarterly" className="flex flex-wrap items-center gap-2">
              <input type="hidden" name="year" value={year} />
              <input
                type="number"
                name="setAside"
                min={0}
                max={100}
                step="1"
                placeholder="e.g. 25"
                defaultValue={setAsidePercent ?? ""}
                aria-label="Set-aside percentage"
                className={FIELD_INPUT}
              />
              <span className="text-body-s text-ink-3">%</span>
              <LButton type="submit" variant="outline" size="sm">
                Apply
              </LButton>
            </form>
          </LCard>

          {report.periods.map((pf) => (
            <LCard key={pf.period.number}>
              <div className="mb-3">
                <p className="text-h3 font-semibold">
                  {pf.period.label} · {pf.period.covers}, {year}
                </p>
                <p className="text-body-s text-ink-2">
                  Payment due {pf.period.dueDateLabel}. When a due date falls on a Saturday,
                  Sunday, or legal holiday, the IRS moves the deadline to the next business day.
                  Confirm the exact date for {year} with the IRS or your accountant before you
                  pay.
                </p>
              </div>

              <LTable>
                <caption>
                  <span className="sr-only">{pf.period.label} figures</span>
                </caption>
                <thead>
                  <tr>
                    <LTh>
                      <span className="sr-only">Item</span>
                    </LTh>
                    <LTh numeric>Count</LTh>
                    <LTh numeric>Amount</LTh>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <th scope="row" className={ROW_HEADER}>
                      Cash received (paid-on basis)
                    </th>
                    <LTd numeric>{pf.paymentCount}</LTd>
                    <LTd numeric>{formatCents(pf.incomeCents)}</LTd>
                  </tr>
                  <tr>
                    <th scope="row" className={ROW_HEADER}>
                      Deductible expenses (incurred)
                    </th>
                    <LTd numeric>{pf.expenseCount}</LTd>
                    <LTd numeric>{formatCents(pf.deductibleCents)}</LTd>
                  </tr>
                  {/* Shown, not silently netted off. The income above
                      already contains whatever the client reimbursed, so
                      this cost has to come out of profit — but a figure
                      that moves net profit without appearing anywhere is
                      its own kind of wrong. Hidden at zero so a pilot who
                      never rebills doesn't carry a line that means nothing
                      to them. */}
                  {pf.rebilledCostCents > 0 ? (
                    <tr>
                      <th scope="row" className={ROW_HEADER}>
                        Rebilled costs (reimbursed by the client)
                      </th>
                      <LTd numeric />
                      <LTd numeric>{formatCents(pf.rebilledCostCents)}</LTd>
                    </tr>
                  ) : null}
                  <tr>
                    <th scope="row" className={cn(ROW_HEADER, "font-semibold")}>
                      Net profit
                    </th>
                    <LTd numeric />
                    <LTd numeric>
                      <span className="font-semibold">{formatCents(pf.netProfitCents)}</span>
                    </LTd>
                  </tr>
                  {/* Informational only — deliberately NOT in netProfitCents
                      above. The standard mileage rate and actual vehicle
                      expenses (fuel, rental car) are alternative deduction
                      methods for the same vehicle, never additive, and this
                      report can't tell which one a pilot elected — see
                      app/(app)/reports/year-end/queries.ts's identical
                      reasoning. Hidden at zero so a pilot who logs no
                      mileage doesn't carry a line that means nothing to
                      them. */}
                  {pf.mileageCount > 0 ? (
                    <tr>
                      <th scope="row" className={ROW_HEADER}>
                        Mileage, standard rate (informational, not in net profit)
                      </th>
                      <LTd numeric>{pf.mileageCount}</LTd>
                      <LTd numeric>
                        {pf.mileageAmountCents === null
                          ? "No rate on file"
                          : formatCents(pf.mileageAmountCents)}
                      </LTd>
                    </tr>
                  ) : null}
                  {pf.mileageCount > 0 ? (
                    <tr>
                      <th scope="row" className={ROW_HEADER}>
                        <span className="font-normal text-ink-2">
                          {pf.mileageMiles.toFixed(1)} mi
                          {pf.mileageRateCentsPerMile === null
                            ? `, no IRS rate on file for ${year}`
                            : ` @ ${pf.mileageRateCentsPerMile}¢/mi`}
                        </span>
                      </th>
                      <LTd numeric />
                      <LTd numeric />
                    </tr>
                  ) : null}
                  <tr>
                    <th scope="row" className={ROW_HEADER}>
                      Set aside{setAsidePercent !== null ? ` (${setAsidePercent}%)` : ""}
                    </th>
                    <LTd numeric />
                    <LTd numeric>
                      {setAsidePercent === null ? (
                        <span className="text-body-s font-normal text-ink-3">
                          Enter a percentage above
                        </span>
                      ) : (
                        formatCents(Math.round((pf.netProfitCents * setAsidePercent) / 100))
                      )}
                    </LTd>
                  </tr>
                </tbody>
              </LTable>

              {pf.unassigned.length > 0 ? (
                <div className="mt-4 flex flex-col gap-3">
                  <LAlert tone="warn" className="flex items-start gap-2">
                    <WarningIcon className="mt-0.5 shrink-0 text-warn" />
                    <span>
                      {pf.unassigned.length} receipt
                      {pf.unassigned.length === 1 ? "" : "s"} totaling{" "}
                      {formatCents(pf.unassignedTotalCents)} in this period are currently
                      counted in neither your income nor your deductions. An unassigned receipt
                      in a closed period is a deduction you&rsquo;re about to lose. Resolve them
                      on{" "}
                      <NextLink
                        href="/expenses"
                        className="font-medium text-accent underline-offset-2 hover:underline"
                      >
                        Expenses
                      </NextLink>
                      , where each one is a two-click decision.
                    </span>
                  </LAlert>
                  {pf.unassignedTruncated ? (
                    <LAlert tone="warn" className="flex items-start gap-2">
                      <WarningIcon className="mt-0.5 shrink-0 text-warn" />
                      <span>
                        There are more unassigned receipts in {year} than this page totals. This
                        period&rsquo;s count and total may also be partial.
                      </span>
                    </LAlert>
                  ) : null}
                  <LTable>
                    <caption>
                      <span className="sr-only">Unassigned receipts, {pf.period.label}</span>
                    </caption>
                    <thead>
                      <tr>
                        <LTh>Date</LTh>
                        <LTh>Category</LTh>
                        <LTh>Vendor</LTh>
                        <LTh numeric>Amount</LTh>
                      </tr>
                    </thead>
                    <tbody>
                      {pf.unassigned.map((e) => (
                        <tr key={e.id}>
                          <th scope="row" className={ROW_HEADER}>
                            <NextLink href={`/expenses/${e.id}`} className="text-accent hover:underline">
                              {formatDate(e.incurredOn)}
                            </NextLink>
                          </th>
                          <LTd>
                            <span className="text-ink-2">
                              {categoryLabels[e.category] ?? e.category}
                            </span>
                          </LTd>
                          <LTd>
                            <span className="text-ink-2">{e.vendor ?? "—"}</span>
                          </LTd>
                          <LTd numeric>{formatCents(e.amountCents)}</LTd>
                        </tr>
                      ))}
                    </tbody>
                  </LTable>
                </div>
              ) : null}
            </LCard>
          ))}
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

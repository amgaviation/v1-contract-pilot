import NextLink from "next/link";
import { LAlert, LCard, LPill, LTable, LTd, LTh, lButtonClass } from "@/components/ledger";
import { LPageShell } from "@/components/ledger/page-shell";

import { createClient } from "@/lib/supabase/server";
import { requireAccount } from "@/lib/supabase/account";
import { formatCents, formatDate } from "@/lib/format";
import { friendlyDbError } from "@/lib/db-errors";
import { currentTaxYear } from "./db";
import { loadOptionLabels } from "@/lib/custom-options-read";
import { loadYearEndReport } from "./queries";
import { loadTravelLog } from "./travel-log-queries";
import TaxFormEditor from "./tax-form-editor";
import { BRAND } from "@/lib/brand";

export const metadata = { title: "Year-end report" };

const YEAR_RANGE = 6;

function yearOptions(selected: number): number[] {
  const current = currentTaxYear();
  const base = Math.max(selected, current);
  const years: number[] = [];
  for (let y = base + 1; y >= base - YEAR_RANGE; y--) years.push(y);
  return years;
}

function csvHref(year: number, section: string): string {
  return `/reports/year-end/export?year=${year}&section=${section}`;
}

export default async function YearEndReportPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string }>;
}) {
  const { account } = await requireAccount("/reports/year-end");
  const { year: yearParam } = await searchParams;

  const current = currentTaxYear();
  const parsedYear = Number(yearParam);
  const year =
    yearParam && Number.isInteger(parsedYear) && parsedYear >= 2000 && parsedYear <= 2100
      ? parsedYear
      : current;

  const supabase = await createClient();
  // The tenant's own category names, retired ones included — this is a
  // history report, so a category that is no longer offered still has a
  // year of spend filed under it.
  const [report, travelLog, categoryLabels] = await Promise.all([
    loadYearEndReport(supabase, account.id, year),
    loadTravelLog(supabase, account.id, year),
    loadOptionLabels("expense_category"),
  ]);

  return (
    <LPageShell
      title="Year-end report"
      subtitle={`Tax year ${year} · a summary of what you recorded, not a tax return`}
      action={
        <div className="flex flex-wrap gap-2">
          {yearOptions(year).map((y) => (
            <NextLink
              key={y}
              href={`/reports/year-end?year=${y}`}
              className={lButtonClass({ variant: y === year ? "primary" : "outline", size: "sm" })}
            >
              {y}
            </NextLink>
          ))}
        </div>
      }
    >
      {/* LOAD-BEARING, deliberately first: this report summarizes the
          pilot's own records. It never computes tax owed, and it is never
          allowed to read as tax advice — see the migration and task brief
          this feature was built from. This sits above every figure on the
          page, not in a footnote underneath them. */}
      <LAlert tone="accent" className="flex items-start gap-2">
        <InfoIcon className="mt-0.5 shrink-0 text-accent" />
        <div>
          <div className="font-medium text-ink">
            This is a summary of what you recorded. It is not tax advice,
            and it is not a tax return.
          </div>
          <div className="mt-1">
            Every figure comes from the trips, expenses, and payments you
            entered. It doesn&rsquo;t know your deductions, your entity
            structure, or what the IRS will accept. Your CPA or tax preparer
            is the authority on what to file — use this to hand them clean numbers, not to
            decide what you owe.
          </div>
        </div>
      </LAlert>

      {report.error ? (
        <LCard>
          <LAlert tone="crit" className="flex items-start gap-2">
            <WarningIcon className="mt-0.5 shrink-0 text-crit" />
            <span>{friendlyDbError({ message: report.error }, "year-end.load")}</span>
          </LAlert>
        </LCard>
      ) : (
        <>
          {/* ---------------- A. Cash-basis income ---------------- */}
          <LCard>
            <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
              <div>
                <h2 className="text-h3 font-semibold">Income received, by client</h2>
                <p className="text-body-s text-ink-2">
                  Cash-basis: payments actually received between Jan 1 and
                  Dec 31, {year}. This does not include invoices issued or
                  sent in {year}, which can land you in the wrong tax
                  year.
                </p>
              </div>
              <a href={csvHref(year, "income")} download className={lButtonClass({ variant: "outline", size: "sm" })}>
                Download CSV
              </a>
            </div>

            {report.paymentsTruncated ? (
              <LAlert tone="warn" className="mb-3 flex items-start gap-2">
                <WarningIcon className="mt-0.5 shrink-0 text-warn" />
                <span>
                  There are more payments in {year} than this page totals.
                  The downloaded CSV may also be partial. Email {BRAND.supportEmail} if
                  your totals look short.
                </span>
              </LAlert>
            ) : null}

            {report.incomeByClient.length === 0 ? (
              <p className="text-body-s text-ink-2">No payments recorded as received in {year}.</p>
            ) : (
              <>
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
                <div className="mt-3 flex justify-end">
                  <span className="tnum-l font-bold">
                    Total received: {formatCents(report.incomeTotalCents)}
                  </span>
                </div>
              </>
            )}
          </LCard>

          {/* ---------------- B. Deductible expenses ---------------- */}
          <LCard>
            <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
              <div>
                <h2 className="text-h3 font-semibold">Deductible expenses, by category</h2>
                <p className="text-body-s text-ink-2">
                  Receipts you tagged &ldquo;Keep as a deduction&rdquo;,
                  dated in {year}.
                </p>
              </div>
              <a
                href={csvHref(year, "deductible")}
                download
                className={lButtonClass({ variant: "outline", size: "sm" })}
              >
                Download CSV
              </a>
            </div>

            {report.deductibleTruncated ? (
              <LAlert tone="warn" className="mb-3 flex items-start gap-2">
                <WarningIcon className="mt-0.5 shrink-0 text-warn" />
                <span>
                  There are more deductible expenses in {year} than this
                  page totals. The downloaded CSV may also be partial.
                </span>
              </LAlert>
            ) : null}

            {report.deductibleByCategory.length === 0 ? (
              <p className="text-body-s text-ink-2">No expenses tagged as deductions in {year}.</p>
            ) : (
              <>
                <LTable>
                  <thead>
                    <tr>
                      <LTh>Category</LTh>
                      <LTh numeric>Receipts</LTh>
                      <LTh numeric>Amount</LTh>
                    </tr>
                  </thead>
                  <tbody>
                    {report.deductibleByCategory.map((c) => (
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
                  </tbody>
                </LTable>
                <div className="mt-3 flex justify-end">
                  <span className="tnum-l font-bold">
                    Total deductible: {formatCents(report.deductibleTotalCents)}
                  </span>
                </div>
              </>
            )}
          </LCard>

          {/* ---------------- C. Rebilled expenses ---------------- */}
          <LCard>
            <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
              <div>
                <h2 className="text-h3 font-semibold">Rebilled expenses, reconciled</h2>
                <p className="text-body-s text-ink-2">
                  Receipts you tagged &ldquo;Rebill to the client&rdquo;,
                  dated in {year}, matched against the invoice line each one
                  became.
                </p>
              </div>
              <a
                href={csvHref(year, "rebilled")}
                download
                className={lButtonClass({ variant: "outline", size: "sm" })}
              >
                Download CSV
              </a>
            </div>

            {report.rebilledTruncated ? (
              <LAlert tone="warn" className="mb-3 flex items-start gap-2">
                <WarningIcon className="mt-0.5 shrink-0 text-warn" />
                <span>
                  There are more rebilled expenses in {year} than this page
                  totals. The downloaded CSV may also be partial.
                </span>
              </LAlert>
            ) : null}

            {report.rebilled.length === 0 ? (
              <p className="text-body-s text-ink-2">No expenses tagged for rebilling in {year}.</p>
            ) : (
              <>
                <LTable>
                  <thead>
                    <tr>
                      <LTh>Date</LTh>
                      <LTh>Category</LTh>
                      <LTh>Client</LTh>
                      <LTh numeric>Receipt</LTh>
                      <LTh numeric>Invoiced</LTh>
                      <LTh>Status</LTh>
                    </tr>
                  </thead>
                  <tbody>
                    {report.rebilled.map((r) => (
                      <tr key={r.expenseId}>
                        <th
                          scope="row"
                          className="border-b border-hair px-3 py-2.5 text-left align-baseline font-medium text-ink first:pl-0 last:pr-0"
                        >
                          {formatDate(r.incurredOn)}
                        </th>
                        <LTd>
                          <span className="text-ink-2">{categoryLabels[r.category] ?? r.category}</span>
                        </LTd>
                        <LTd>
                          <span className="text-ink-2">{r.clientName ?? "—"}</span>
                        </LTd>
                        <LTd numeric>{formatCents(r.expenseAmountCents)}</LTd>
                        <LTd numeric>
                          {r.lineAmountCents === null ? "—" : formatCents(r.lineAmountCents)}
                        </LTd>
                        <LTd>
                          <LPill tone={r.invoiceId ? "good" : "warn"}>
                            {r.invoiceId
                              ? r.invoiceStatus === "paid"
                                ? "Invoiced & paid"
                                : "Invoiced"
                              : "Not yet invoiced"}
                          </LPill>
                        </LTd>
                      </tr>
                    ))}
                  </tbody>
                </LTable>
                <div className="mt-3 flex flex-wrap justify-end gap-4">
                  <span className="tnum-l text-body-s text-ink-2">
                    Receipts: {formatCents(report.rebilledExpenseTotalCents)}
                  </span>
                  <span className="tnum-l font-bold">
                    Invoiced: {formatCents(report.rebilledInvoicedTotalCents)}
                  </span>
                </div>
              </>
            )}
          </LCard>

          {/* ---------------- D. Unassigned receipts ---------------- */}
          <LCard>
            <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
              <div>
                <h2 className="text-h3 font-semibold">Unassigned receipts</h2>
                <p className="text-body-s text-ink-2">
                  Dated in {year}, neither billed to a client nor claimed as
                  a deduction. Resolve them on{" "}
                  <NextLink href="/expenses" className="text-accent hover:underline">
                    Expenses
                  </NextLink>
                  , where each one is a two-click decision.
                </p>
              </div>
              <a
                href={csvHref(year, "unassigned")}
                download
                className={lButtonClass({ variant: "outline", size: "sm" })}
              >
                Download CSV
              </a>
            </div>

            {report.unassignedTruncated ? (
              <LAlert tone="warn" className="mb-3 flex items-start gap-2">
                <WarningIcon className="mt-0.5 shrink-0 text-warn" />
                <span>
                  There are more unassigned receipts in {year} than this
                  page totals. The downloaded CSV may also be partial.
                </span>
              </LAlert>
            ) : null}

            {report.unassigned.length === 0 ? (
              <p className="text-body-s text-ink-2">
                Nothing unassigned in {year}. Every receipt is either
                rebilled or deducted.
              </p>
            ) : (
              <>
                <LAlert tone="warn" className="mb-3 flex items-start gap-2">
                  <WarningIcon className="mt-0.5 shrink-0 text-warn" />
                  <span>
                    {report.unassigned.length} receipt
                    {report.unassigned.length === 1 ? "" : "s"} totaling{" "}
                    {formatCents(report.unassignedTotalCents)} are currently
                    counted in neither your income nor your deductions.
                  </span>
                </LAlert>
                <LTable>
                  <thead>
                    <tr>
                      <LTh>Date</LTh>
                      <LTh>Category</LTh>
                      <LTh>Vendor</LTh>
                      <LTh numeric>Amount</LTh>
                    </tr>
                  </thead>
                  <tbody>
                    {report.unassigned.map((e) => (
                      <tr key={e.id}>
                        <th
                          scope="row"
                          className="border-b border-hair px-3 py-2.5 text-left align-baseline font-medium text-ink first:pl-0 last:pr-0"
                        >
                          <NextLink href={`/expenses/${e.id}`} className="text-accent hover:underline">
                            {formatDate(e.incurredOn)}
                          </NextLink>
                        </th>
                        <LTd>
                          <span className="text-ink-2">{categoryLabels[e.category] ?? e.category}</span>
                        </LTd>
                        <LTd>
                          <span className="text-ink-2">{e.vendor ?? "—"}</span>
                        </LTd>
                        <LTd numeric>{formatCents(e.amountCents)}</LTd>
                      </tr>
                    ))}
                  </tbody>
                </LTable>
              </>
            )}
          </LCard>

          {/* ---------------- E. Mileage, standard rate ---------------- */}
          <LCard>
            <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
              <div>
                <h2 className="text-h3 font-semibold">Mileage, standard rate</h2>
                <p className="text-body-s text-ink-2">
                  Standard-mileage-rate drives logged in {year}. These are excluded from Deductible expenses above. The standard rate and
                  actual vehicle expenses (fuel, rental car) are alternative
                  methods for the same vehicle, never additive, and this
                  report can&rsquo;t tell which you elected, so folding this
                  in would risk a double-claimed deduction. Review it in{" "}
                  <NextLink href="/expenses/mileage" className="text-accent hover:underline">
                    Mileage
                  </NextLink>{" "}
                  before filing.
                </p>
              </div>
              <a href={csvHref(year, "mileage")} download className={lButtonClass({ variant: "outline", size: "sm" })}>
                Download CSV
              </a>
            </div>

            {report.mileageTruncated ? (
              <LAlert tone="warn" className="mb-3 flex items-start gap-2">
                <WarningIcon className="mt-0.5 shrink-0 text-warn" />
                <span>
                  There are more drives logged in {year} than this page
                  totals. The downloaded CSV may also be partial.
                </span>
              </LAlert>
            ) : null}

            {report.mileageCount === 0 ? (
              <p className="text-body-s text-ink-2">No mileage logged in {year}.</p>
            ) : (
              <>
                <LTable>
                  <thead>
                    <tr>
                      <LTh>Drives</LTh>
                      <LTh numeric>Miles</LTh>
                      <LTh numeric>Rate</LTh>
                      <LTh numeric>Amount</LTh>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <th
                        scope="row"
                        className="border-b border-hair px-3 py-2.5 text-left align-baseline font-medium text-ink first:pl-0 last:pr-0"
                      >
                        {report.mileageCount}
                      </th>
                      <LTd numeric>{report.mileageMiles.toFixed(1)}</LTd>
                      <LTd numeric>
                        <span className="text-ink-2">
                          {report.mileageRateCentsPerMile === null
                            ? "—"
                            : `${report.mileageRateCentsPerMile}¢/mi`}
                        </span>
                      </LTd>
                      <LTd numeric>
                        <span className="font-medium">
                          {report.mileageAmountCents === null
                            ? "No rate on file"
                            : formatCents(report.mileageAmountCents)}
                        </span>
                      </LTd>
                    </tr>
                  </tbody>
                </LTable>
                {report.mileageAmountCents === null ? (
                  <LAlert tone="warn" className="mt-3 flex items-start gap-2">
                    <WarningIcon className="mt-0.5 shrink-0 text-warn" />
                    <span>
                      {`There's no IRS standard rate on file for ${year}, so the ${report.mileageMiles.toFixed(1)} miles above have no dollar figure yet. Add a rate in `}
                      <NextLink href="/expenses/mileage" className="text-accent hover:underline">
                        Mileage
                      </NextLink>
                      {" and this recomputes."}
                    </span>
                  </LAlert>
                ) : null}
              </>
            )}
          </LCard>

          {/* ---------------- E2. Travel log & per-diem days ----------------
              Substantiation, not a dollar figure: the M&IE rate is the
              pilot's CPA's to apply (the pilot.mileage_rates precedent —
              never a hardcoded IRS/GSA number — and here no rate field
              exists at all), so this section counts days and says so.
              See travel-log.ts's header for the full reasoning. */}
          <LCard>
            <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
              <div>
                <h2 className="text-h3 font-semibold">Travel log &amp; per-diem days</h2>
                <p className="text-body-s text-ink-2">
                  One row per trip day you recorded in {year}: date,
                  client, day type, away-from-home, and the route flown
                  that day. For whoever prepares your return: this log
                  counts days and never applies an M&amp;IE rate or
                  computes a deduction. Your CPA or tax preparer applies
                  the current rate to the away-day counts below.
                </p>
              </div>
              <a
                href={csvHref(year, "travel-log")}
                download
                className={lButtonClass({ variant: "outline", size: "sm" })}
              >
                Download CSV
              </a>
            </div>

            {travelLog.error ? (
              <LAlert tone="crit" className="flex items-start gap-2">
                <WarningIcon className="mt-0.5 shrink-0 text-crit" />
                <span>{friendlyDbError({ message: travelLog.error }, "year-end.travel-log")}</span>
              </LAlert>
            ) : (
              <>
                {travelLog.truncated ? (
                  <LAlert tone="warn" className="mb-3 flex items-start gap-2">
                    <WarningIcon className="mt-0.5 shrink-0 text-warn" />
                    <span>
                      There are more trip days in {year} than this page can
                      list. The counts below may be short, and the CSV will
                      refuse to download. Email {BRAND.supportEmail} if your log looks
                      incomplete.
                    </span>
                  </LAlert>
                ) : null}

                {travelLog.rows.length === 0 ? (
                  <p className="text-body-s text-ink-2">No trip days recorded in {year}.</p>
                ) : (
                  <>
                    <LTable>
                      <thead>
                        <tr>
                          <LTh>Date</LTh>
                          <LTh>Client</LTh>
                          <LTh>Day type</LTh>
                          <LTh>Route flown</LTh>
                          <LTh>Away</LTh>
                          <LTh>Per diem</LTh>
                        </tr>
                      </thead>
                      <tbody>
                        {travelLog.rows.map((d) => (
                          <tr key={d.id}>
                            <th
                              scope="row"
                              className="border-b border-hair px-3 py-2.5 text-left align-baseline font-medium text-ink first:pl-0 last:pr-0"
                            >
                              <NextLink href={`/trips/${d.tripId}`} className="text-accent hover:underline">
                                {formatDate(d.dayOn)}
                              </NextLink>
                            </th>
                            <LTd>
                              <span className="text-ink-2">{d.clientName}</span>
                            </LTd>
                            <LTd>
                              <span className="text-ink-2">{d.dayTypeLabel}</span>
                            </LTd>
                            <LTd>
                              <span className="text-ink-2">{d.route ?? "—"}</span>
                            </LTd>
                            <LTd>
                              <span className="text-ink-2">{d.away ? "Away" : "Home"}</span>
                            </LTd>
                            <LTd>
                              <span className="text-ink-2">{d.perDiemDay ? "Yes" : "—"}</span>
                            </LTd>
                          </tr>
                        ))}
                      </tbody>
                    </LTable>
                    <div className="mt-3 flex flex-wrap justify-end gap-4">
                      <span className="tnum-l text-body-s text-ink-2">
                        Trip days: {travelLog.rows.length}
                      </span>
                      <span className="tnum-l text-body-s text-ink-2">
                        Away from home: {travelLog.awayDayCount}
                      </span>
                      <span className="tnum-l font-bold">
                        Per-diem days: {travelLog.perDiemDayCount}
                      </span>
                    </div>
                  </>
                )}
                {travelLog.canceledDayCount > 0 ? (
                  <p className="mt-2 text-caption text-ink-3">
                    {travelLog.canceledDayCount} day
                    {travelLog.canceledDayCount === 1 ? "" : "s"} on canceled
                    trips {travelLog.canceledDayCount === 1 ? "is" : "are"}{" "}
                    excluded from this log.
                  </p>
                ) : null}
              </>
            )}
          </LCard>

          {/* ---------------- F. 1099 reconciliation ---------------- */}
          <LCard>
            <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
              <div>
                <h2 className="text-h3 font-semibold">1099 reconciliation</h2>
                <p className="text-body-s text-ink-2">
                  Your cash-basis ledger for {year} beside what each client
                  reported to the IRS. A gap usually means a payment crossed
                  the Dec/Jan boundary: the client reports the year they
                  paid, your ledger the year you received it. Not an error
                  to fix, just a note for your CPA.
                </p>
              </div>
              <a
                href={csvHref(year, "tax-forms")}
                download
                className={lButtonClass({ variant: "outline", size: "sm" })}
              >
                Download CSV
              </a>
            </div>

            {report.taxForms.length === 0 ? (
              <p className="text-body-s text-ink-2">
                No client income and no 1099s recorded for {year} yet.
              </p>
            ) : (
              <LTable>
                <thead>
                  <tr>
                    <LTh>Client</LTh>
                    <LTh numeric>Your ledger</LTh>
                    <LTh>Form</LTh>
                    <LTh numeric>Form reports</LTh>
                    <LTh numeric>Delta</LTh>
                    <LTh />
                  </tr>
                </thead>
                <tbody>
                  {report.taxForms.map((t) => (
                    <tr key={`${t.clientId}:${t.formType ?? "none"}`}>
                      <th
                        scope="row"
                        className="border-b border-hair px-3 py-2.5 text-left align-baseline font-medium text-ink first:pl-0 last:pr-0"
                      >
                        {t.clientName}
                      </th>
                      <LTd numeric>{formatCents(t.ledgerCents)}</LTd>
                      <LTd>
                        <span className="text-ink-2">{t.formType ?? "—"}</span>
                      </LTd>
                      <LTd numeric>
                        {t.reportedAmountCents === null ? "—" : formatCents(t.reportedAmountCents)}
                      </LTd>
                      <LTd numeric>
                        {t.deltaCents === null ? (
                          <span className="text-ink-3">—</span>
                        ) : (
                          <LPill tone={t.deltaCents === 0 ? "good" : "warn"} className="tnum-l">
                            {t.deltaCents === 0
                              ? "Matches"
                              : `${t.deltaCents > 0 ? "+" : ""}${formatCents(t.deltaCents)}`}
                          </LPill>
                        )}
                      </LTd>
                      <LTd>
                        <TaxFormEditor
                          clientId={t.clientId}
                          clientName={t.clientName}
                          year={year}
                          existing={
                            t.formType && t.reportedAmountCents !== null
                              ? {
                                  formType: t.formType,
                                  reportedAmountCents: t.reportedAmountCents,
                                  receivedOn: t.receivedOn,
                                  notes: t.notes,
                                }
                              : null
                          }
                        />
                      </LTd>
                    </tr>
                  ))}
                </tbody>
              </LTable>
            )}
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

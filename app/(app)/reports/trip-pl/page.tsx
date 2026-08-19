import NextLink from "next/link";
import { LAlert, LCard, LPill, LTable, LTd, LTh, lButtonClass } from "@/components/ledger";
import { LPageShell } from "@/components/ledger/page-shell";
import { cn } from "@/lib/ledger/cn";

import { createClient } from "@/lib/supabase/server";
import { requireAccount } from "@/lib/supabase/account";
import { formatCents } from "@/lib/format";
import { friendlyDbError } from "@/lib/db-errors";
import { loadTripPLReport } from "./queries";
import {
  ItemMarginBarChart,
  type ItemMarginDatum,
} from "@/components/charts/item-margin-bar-chart";
import {
  formatDayQuantity,
  formatMiles,
  resolveTripPLPeriod,
  todayIso,
  type DayQuantitySource,
  type TripPLPeriod,
} from "./report-lib";
import { BRAND } from "@/lib/brand";

export const metadata = { title: "Trip profitability" };

const YEAR_RANGE = 6;

// A bar per client, not per trip: report.trips is capped at 1000 rows and
// a trip's own label (aircraft tail, or "Trip") repeats across a pilot's
// history in a way a client name doesn't, so a per-trip chart would be
// both too tall to read and full of duplicate labels. Clients are also
// the SMALLER, human-named axis — see the "By client" table this sits
// above.
const MAX_CHART_ITEMS = 12;

/**
 * The client rollup, already sorted by margin (report-lib.ts), narrowed
 * to a chart-sized set. Clients with no trips this period (a guarantee
 * invoiced with nothing flown) are dropped — their margin is always
 * exactly 0 by construction, and a bar for that isn't "per-trip margin",
 * it's noise. The kept set is chosen by LARGEST MAGNITUDE first (the
 * biggest wins and losses are the story a diverging chart tells), then
 * re-sorted by signed value for display so the bars read top-to-bottom
 * from best to worst.
 */
function buildClientMarginChartData(
  clients: { clientId: string | null; clientName: string; tripCount: number; marginCents: number }[]
): ItemMarginDatum[] {
  return clients
    .filter((c) => c.tripCount > 0)
    .slice()
    .sort((a, b) => Math.abs(b.marginCents) - Math.abs(a.marginCents))
    .slice(0, MAX_CHART_ITEMS)
    .sort((a, b) => b.marginCents - a.marginCents)
    .map((c) => ({
      id: c.clientId ?? c.clientName,
      label: c.clientName,
      marginCents: c.marginCents,
    }));
}

function yearOptions(selected: number, currentYear: number): number[] {
  const base = Math.max(selected, currentYear);
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
  if (extra) for (const [k, v] of Object.entries(extra)) params.set(k, String(v));
  return `/reports/trip-pl?${params.toString()}`;
}

/** The CSV gets the EXACT bounds the screen rendered, never a re-derivation
 *  of them — same rule as /reports/profit-loss/export. */
function csvHref(period: TripPLPeriod): string {
  const params = new URLSearchParams({
    kind: period.kind,
    start: period.start,
    end: period.end,
  });
  return `/reports/trip-pl/export?${params.toString()}`;
}

/** Signed money, coloured by sign. A margin is genuinely signed here — a
 *  trip whose deductible expenses exceed what it billed is a real row —
 *  so the sign is shown, never dropped. */
function Money({ cents, bold = false }: { cents: number; bold?: boolean }) {
  return (
    <span className={cn("tnum-l", bold ? "font-bold" : "font-medium", cents < 0 ? "text-warn" : "text-ink")}>
      {formatCents(cents)}
    </span>
  );
}

const DAY_SOURCE_NOTE: Record<DayQuantitySource, string | null> = {
  day_rows: null,
  scalar: "From the trip's day count, not a day grid",
  none: "No days recorded",
};

function TripDates({ startsOn, endsOn }: { startsOn: string; endsOn: string }) {
  return (
    <span className="text-body-s text-ink-2">
      {startsOn === endsOn ? startsOn : `${startsOn} → ${endsOn}`}
    </span>
  );
}

function billingStateTone(state: string): "good" | "accent" | "crit" | "neutral" {
  switch (state) {
    case "paid":
      return "good";
    case "invoiced":
      return "accent";
    case "written_off":
      return "crit";
    default:
      return "neutral";
  }
}

export default async function TripProfitabilityPage({
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
  const { account } = await requireAccount("/reports/trip-pl");
  const sp = await searchParams;

  const today = todayIso();
  const currentYear = Number(today.slice(0, 4));
  const parsedYear = Number(sp.year);
  const year =
    sp.year && Number.isInteger(parsedYear) && parsedYear >= 2000 && parsedYear <= 2100
      ? parsedYear
      : currentYear;

  const period = resolveTripPLPeriod(sp, today);

  const supabase = await createClient();
  const report = await loadTripPLReport(supabase, account.id, period);

  // Fed from report.clients — the exact rows the "By client" table below
  // renders, already assembled by assembleTripPL. No second read, no
  // re-aggregation, so the chart can never disagree with the table it
  // sits above.
  const marginChartData = buildClientMarginChartData(report.clients);
  const clientsWithTrips = report.clients.filter((c) => c.tripCount > 0).length;
  const marginChartAriaLabel =
    `Margin by client, ${period.label}` +
    (clientsWithTrips > marginChartData.length
      ? ` — top ${marginChartData.length} of ${clientsWithTrips} clients by margin size`
      : "") +
    `. ${marginChartData.map((d) => `${d.label}: ${formatCents(d.marginCents)}`).join("; ")}.`;

  const anyRebillActivity =
    report.totals.rebilledCostCents !== 0 || report.totals.rebillInvoicedCents !== 0;
  const anyExcluded =
    anyRebillActivity ||
    report.totals.unassignedExpenseCents !== 0 ||
    report.totals.mileageMiles !== 0;

  // The export route refuses (500 + a JSON body) in exactly these three
  // states. An <a download> pointed at a 500 does NOT surface the error —
  // the browser saves the JSON to disk as a file called "export", with
  // nothing on screen to say the download was refused, and the pilot ends
  // up with an artifact they might forward to an accountant. So the button
  // is disabled rather than left looking live; the page already explains
  // each of these states in the body below.
  const exportRefused = report.error !== null || report.refusal !== null || report.truncated;

  return (
    <LPageShell
      title="Trip profitability"
      subtitle={`${period.label} · invoiced, not collected`}
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
          {exportRefused ? (
            <span
              aria-disabled="true"
              className={lButtonClass({ variant: "outline", size: "sm", className: "pointer-events-none opacity-50" })}
            >
              Download CSV
            </span>
          ) : (
            <a href={csvHref(period)} download className={lButtonClass({ variant: "outline", size: "sm" })}>
              Download CSV
            </a>
          )}
        </div>
      }
    >
      {period.kind === "year" ? (
        <div className="flex flex-wrap gap-2">
          {yearOptions(year, currentYear).map((y) => (
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
          the other reports' disclaimers. The basis distinction is the
          single most misreadable thing on this screen: every figure here
          is INVOICED, and the three cash-basis reports next door answer
          "what did I make". Saying so once, prominently, is what keeps a
          pilot from reading this as income. */}
      <LAlert tone="accent" className="flex items-start gap-2">
        <InfoIcon className="mt-0.5 shrink-0 text-accent" />
        <div>
          <div className="font-medium text-ink">Invoiced, not collected.</div>
          <div className="mt-1">
            Every figure here is what you <strong>billed</strong> for a
            trip, not what has landed in your account. Payments are
            recorded per invoice, not per line, so there is no honest way
            to say which trip a given payment paid for. This report
            doesn&rsquo;t guess. For what you actually collected, see{" "}
            <NextLink href="/reports/profit-loss" className="text-accent hover:underline">
              profit &amp; loss
            </NextLink>{" "}
            (cash-basis), which stays the authority on &ldquo;what did I
            make&rdquo;.
          </div>
        </div>
      </LAlert>

      {report.error ? (
        <LCard>
          <LAlert tone="crit" className="flex items-start gap-2">
            <WarningIcon className="mt-0.5 shrink-0 text-crit" />
            <span>{friendlyDbError({ message: report.error }, "trip-pl.load")}</span>
          </LAlert>
        </LCard>
      ) : report.refusal ? (
        /* An assembly refusal, not a read failure. The reads worked; the
           rows don't support an honest report, so nothing is printed
           rather than printing a margin whose inputs are short. Same rule
           as the balance sheet refusing to render when A != L + E. */
        <LCard>
          <LAlert tone="crit" className="flex items-start gap-2">
            <WarningIcon className="mt-0.5 shrink-0 text-crit" />
            <div>
              <div className="font-medium text-ink">
                These figures don&rsquo;t add up, so they aren&rsquo;t shown.
              </div>
              <div className="mt-1">
                A margin is a subtraction: if part of the expense side is
                missing, the number comes out too <em>high</em>, which
                looks like good news. Rather than show that, this report
                stops, and the CSV export is disabled for the same reason.
                Email {BRAND.supportEmail} with this detail: {report.refusal}
              </div>
            </div>
          </LAlert>
        </LCard>
      ) : (
        <>
          {report.truncated ? (
            <LAlert tone="warn" className="flex items-start gap-2">
              <WarningIcon className="mt-0.5 shrink-0 text-warn" />
              <span>
                There are more{" "}
                {report.tripsTruncated ? "trips" : ""}
                {report.tripsTruncated && report.clientsTruncated ? " and " : ""}
                {report.clientsTruncated ? "clients" : ""}
                {!report.tripsTruncated && !report.clientsTruncated
                  ? "rows"
                  : ""}{" "}
                in this period than this page totals, so the figures below
                may be partial. Narrow the date range, or email {BRAND.supportEmail}.
                The CSV export is disabled while this is true.
              </span>
            </LAlert>
          ) : null}

          {/* ---------------- Headline ---------------- */}
          <LCard>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-h3 font-semibold">Margin</h2>
                <p className="text-body-s text-ink-2">
                  Invoiced day money minus the expenses you tagged as
                  deductions, across {report.totals.tripCount}{" "}
                  {report.totals.tripCount === 1 ? "trip" : "trips"} touching{" "}
                  {period.start} to {period.end}. Rebilled costs, undecided
                  receipts, and mileage are all excluded. Each is listed
                  below.
                </p>
              </div>
              <div className="flex flex-col items-end gap-1">
                <span className="tnum-l text-figure font-bold tracking-tight">
                  {formatCents(report.totals.marginCents)}
                </span>
                <span className="tnum-l text-body-s text-ink-2">
                  {report.totals.marginPerDayCents === null
                    ? "n/a (no billable days)"
                    : `${formatCents(report.totals.marginPerDayCents)} per day · ${formatDayQuantity(report.totals.dayQuantity)} days`}
                </span>
              </div>
            </div>
            {report.totals.draftDayMoneyCents !== 0 ? (
              <LAlert tone="warn" className="mt-3 flex items-start gap-2">
                <InfoIcon className="mt-0.5 shrink-0 text-warn" />
                <span>
                  <span className="tnum-l">{formatCents(report.totals.draftDayMoneyCents)}</span>{" "}
                  of the invoiced day money above sits on invoices that are
                  still <strong>drafts</strong>. They are counted here
                  because a draft line already commits the trip, even
                  though it has not been sent to anyone yet.
                </span>
              </LAlert>
            ) : null}
          </LCard>

          {/* ---------------- Per trip ---------------- */}
          <LCard>
            <h2 className="mb-1 text-h3 font-semibold">By trip</h2>
            <p className="mb-3 text-body-s text-ink-2">
              A trip appears here when its dates overlap the period. A trip
              that straddles the boundary is shown in full in both periods.
              Its money is not split across the boundary, because nothing
              in your records says which day of a day-rate invoice belongs
              to which side of it.
            </p>

            {report.trips.length === 0 ? (
              <p className="text-body-s text-ink-2">No trips overlap this period.</p>
            ) : (
              <LTable>
                <thead>
                  <tr>
                    <LTh>Trip</LTh>
                    <LTh>Client</LTh>
                    <LTh>Billing</LTh>
                    <LTh numeric>Days</LTh>
                    <LTh numeric>Invoiced day money</LTh>
                    <LTh numeric>Deductible expenses</LTh>
                    <LTh numeric>Margin</LTh>
                    <LTh numeric>Margin / day</LTh>
                  </tr>
                </thead>
                <tbody>
                  {report.trips.map((t) => (
                    <tr key={t.tripId}>
                      <th
                        scope="row"
                        className="border-b border-hair px-3 py-2.5 text-left align-baseline font-medium text-ink first:pl-0 last:pr-0"
                      >
                        <div className="flex flex-col gap-1">
                          <NextLink href={`/trips/${t.tripId}`} className="text-accent hover:underline">
                            {t.aircraftIdent ?? "Trip"}
                          </NextLink>
                          <TripDates startsOn={t.startsOn} endsOn={t.endsOn} />
                        </div>
                      </th>
                      <LTd>
                        <span className="text-ink-2">{t.clientName}</span>
                      </LTd>
                      <LTd>
                        <div className="flex flex-wrap gap-1">
                          <LPill tone={billingStateTone(t.billingState)}>
                            {t.billingState.replace("_", " ")}
                          </LPill>
                          {t.hasDraftMoney ? <LPill tone="warn">draft</LPill> : null}
                        </div>
                      </LTd>
                      <LTd numeric>
                        <div className="flex flex-col items-end gap-1">
                          <span>{formatDayQuantity(t.dayQuantity)}</span>
                          {DAY_SOURCE_NOTE[t.dayQuantitySource] ? (
                            <span className="text-caption font-normal text-ink-3">
                              {DAY_SOURCE_NOTE[t.dayQuantitySource]}
                            </span>
                          ) : null}
                        </div>
                      </LTd>
                      <LTd numeric>
                        <div className="flex flex-col items-end gap-1">
                          <Money cents={t.invoicedDayMoneyCents} />
                          {t.hasDraftMoney ? (
                            <span className="tnum-l text-caption font-normal text-ink-3">
                              incl. {formatCents(t.draftDayMoneyCents)} draft
                            </span>
                          ) : null}
                        </div>
                      </LTd>
                      <LTd numeric>
                        <Money cents={t.deductibleExpenseCents} />
                      </LTd>
                      <LTd numeric>
                        <Money cents={t.marginCents} bold />
                      </LTd>
                      <LTd numeric>
                        {t.marginPerDayCents === null ? (
                          <span className="text-ink-3">—</span>
                        ) : (
                          <Money cents={t.marginPerDayCents} />
                        )}
                      </LTd>
                    </tr>
                  ))}
                </tbody>
              </LTable>
            )}
          </LCard>

          {/* ---------------- Per client ---------------- */}
          <LCard>
            <h2 className="mb-1 text-h3 font-semibold">By client</h2>
            <p className="mb-3 text-body-s text-ink-2">
              The same trips, added up per client. Every figure is the sum
              of the trip rows above, so the columns reconcile by hand.
              &ldquo;Not tied to a trip&rdquo; is live invoice money for
              this client that belongs to no single trip. A monthly
              guarantee is the usual case. It is real revenue, and it stays
              deliberately outside the margin, because splitting it across
              trips would mean inventing an allocation. That one column is
              dated differently from the rest of this table: with no trip
              of its own, it lands in a period by its invoice&rsquo;s{" "}
              <em>issue date</em>, while trips land by the dates they were
              flown. So a guarantee for December work issued in January
              shows up here in January, alongside the December trips it
              tops up. Money on invoices you haven&rsquo;t sent yet is
              listed separately underneath and is never date-filtered.
            </p>

            {/* A one-bar chart is noise, so this needs at least two
                clients with actual trip activity — a period with a single
                active client has nothing for a bar chart to compare. */}
            {marginChartData.length >= 2 ? (
              <div className="mb-4">
                <ItemMarginBarChart data={marginChartData} ariaLabel={marginChartAriaLabel} />
              </div>
            ) : null}

            {report.clients.length === 0 ? (
              <p className="text-body-s text-ink-2">Nothing to roll up for this period.</p>
            ) : (
              <LTable>
                <thead>
                  <tr>
                    <LTh>Client</LTh>
                    <LTh numeric>Trips</LTh>
                    <LTh numeric>Days</LTh>
                    <LTh numeric>Invoiced day money</LTh>
                    <LTh numeric>Deductible expenses</LTh>
                    <LTh numeric>Margin</LTh>
                    <LTh numeric>Margin / day</LTh>
                    <LTh numeric>Not tied to a trip</LTh>
                  </tr>
                </thead>
                <tbody>
                  {report.clients.map((c) => (
                    <tr key={c.clientId ?? "no-client"}>
                      <th
                        scope="row"
                        className="border-b border-hair px-3 py-2.5 text-left align-baseline font-medium text-ink first:pl-0 last:pr-0"
                      >
                        {c.clientName}
                      </th>
                      <LTd numeric>{c.tripCount}</LTd>
                      <LTd numeric>{formatDayQuantity(c.dayQuantity)}</LTd>
                      <LTd numeric>
                        <Money cents={c.invoicedDayMoneyCents} />
                      </LTd>
                      <LTd numeric>
                        <Money cents={c.deductibleExpenseCents} />
                      </LTd>
                      <LTd numeric>
                        <Money cents={c.marginCents} bold />
                      </LTd>
                      <LTd numeric>
                        {c.marginPerDayCents === null ? (
                          <span className="text-ink-3">—</span>
                        ) : (
                          <Money cents={c.marginPerDayCents} />
                        )}
                      </LTd>
                      <LTd numeric>
                        {c.unattributedLineCents === 0 && c.draftUnattributedLineCents === 0 ? (
                          <span className="text-ink-3">—</span>
                        ) : (
                          <div className="flex flex-col items-end gap-1">
                            <Money cents={c.unattributedLineCents} />
                            {c.draftUnattributedLineCents !== 0 ? (
                              <span className="tnum-l text-caption font-normal text-ink-3">
                                {/* Additive, and safe to add: the SQL splits these
                                    two by invoice status, so no line is in both. Not
                                    labelled "undated" — a draft may carry a
                                    provisional issue date; what is true of every one
                                    of them is that it hasn't been sent. */}
                                + {formatCents(c.draftUnattributedLineCents)} on drafts (not sent)
                              </span>
                            ) : null}
                          </div>
                        )}
                      </LTd>
                    </tr>
                  ))}
                </tbody>
              </LTable>
            )}
          </LCard>

          {/* ---------------- Excluded from margin ---------------- */}
          <LCard>
            <h2 className="mb-1 text-h3 font-semibold">Excluded from margin</h2>
            <p className="mb-3 text-body-s text-ink-2">
              Each of these is real, and none of it belongs in a margin. Listed so nothing is hidden.
            </p>

            {!anyExcluded ? (
              <p className="text-body-s text-ink-2">
                Nothing excluded for these trips: no rebilled receipts, no
                undecided receipts, no mileage.
              </p>
            ) : (
              <div className="flex flex-col gap-4">
                {anyRebillActivity ? (
                  <div>
                    <h3 className="mb-1 text-body font-semibold">
                      Rebilled receipts: a pass-through, both legs out
                    </h3>
                    <p className="mb-2 text-body-s text-ink-2">
                      You paid{" "}
                      <span className="tnum-l">{formatCents(report.totals.rebilledCostCents)}</span>{" "}
                      out of pocket and billed{" "}
                      <span className="tnum-l">{formatCents(report.totals.rebillInvoicedCents)}</span>{" "}
                      of it back. Neither leg is in the margin: a rebill is
                      money passing through you, not money you earned.
                    </p>
                    {report.totals.rebillGapCents !== 0 ? (
                      <LAlert
                        tone={report.totals.rebillGapCents < 0 ? "warn" : "neutral"}
                        className="flex items-start gap-2"
                      >
                        <WarningIcon
                          className={cn(
                            "mt-0.5 shrink-0",
                            report.totals.rebillGapCents < 0 ? "text-warn" : "text-ink-3"
                          )}
                        />
                        <span>
                          {report.totals.rebillGapCents < 0 ? (
                            <>
                              <span className="tnum-l">
                                {formatCents(-report.totals.rebillGapCents)}
                              </span>{" "}
                              of rebilled cost was never billed back, or was
                              billed short. That is money you fronted and
                              haven&rsquo;t recovered. It is invisible in
                              the margin by design, which is exactly why
                              it&rsquo;s called out here. The{" "}
                              <NextLink href="/reports/year-end" className="text-accent hover:underline">
                                year-end report
                              </NextLink>{" "}
                              reconciles these line by line.
                            </>
                          ) : (
                            <>
                              You billed{" "}
                              <span className="tnum-l">{formatCents(report.totals.rebillGapCents)}</span>{" "}
                              more than the recorded receipts, usually
                              because a receipt was entered short or
                              because of a markup. Either way, it&rsquo;s
                              worth a look.
                            </>
                          )}
                        </span>
                      </LAlert>
                    ) : null}
                  </div>
                ) : null}

                {report.totals.unassignedExpenseCents !== 0 ? (
                  <div>
                    <h3 className="mb-1 text-body font-semibold">Undecided receipts</h3>
                    <p className="text-body-s text-ink-2">
                      <span className="tnum-l">{formatCents(report.totals.unassignedExpenseCents)}</span>{" "}
                      of receipts on these trips are still unassigned:
                      neither billed nor claimed as a deduction, and outside
                      every margin until you decide. Resolve them on{" "}
                      <NextLink href="/expenses" className="text-accent hover:underline">
                        Expenses
                      </NextLink>
                      .
                    </p>
                  </div>
                ) : null}

                {report.totals.mileageMiles !== 0 ? (
                  <div>
                    <h3 className="mb-1 text-body font-semibold">Mileage</h3>
                    <p className="text-body-s text-ink-2">
                      {formatMiles(report.totals.mileageMiles)} miles logged against these trips, shown in
                      miles on purpose: the standard rate and actual vehicle
                      expenses are alternative methods, never additive, so no
                      mileage figure can enter a trip margin. The deduction is
                      computed once, from the year&rsquo;s rate, on{" "}
                      <NextLink href="/expenses/mileage" className="text-accent hover:underline">
                        Mileage
                      </NextLink>
                      .
                    </p>
                  </div>
                ) : null}
              </div>
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

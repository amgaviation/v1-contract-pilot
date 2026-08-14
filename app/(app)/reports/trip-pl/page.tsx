import NextLink from "next/link";
import {
  Badge,
  Box,
  Button,
  Callout,
  Card,
  Flex,
  Heading,
  Link as RadixLink,
  Table,
  Text,
} from "@/components/ui";
import {
  ExclamationTriangleIcon,
  InfoCircledIcon,
} from "@radix-ui/react-icons";

import { createClient } from "@/lib/supabase/server";
import { requireAccount } from "@/lib/supabase/account";
import { formatCents } from "@/lib/format";
import { friendlyDbError } from "@/lib/db-errors";
import PageShell from "../../page-shell";
import { loadTripPLReport } from "./queries";
import {
  formatDayQuantity,
  formatMiles,
  resolveTripPLPeriod,
  todayIso,
  type DayQuantitySource,
  type TripPLPeriod,
} from "./report-lib";

export const metadata = { title: "Trip profitability" };

const YEAR_RANGE = 6;

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
    <Text
      className="tnum"
      weight={bold ? "bold" : "medium"}
      color={cents < 0 ? "amber" : undefined}
    >
      {formatCents(cents)}
    </Text>
  );
}

const DAY_SOURCE_NOTE: Record<DayQuantitySource, string | null> = {
  day_rows: null,
  scalar: "From the trip's day count, not a day grid",
  none: "No days recorded",
};

function TripDates({ startsOn, endsOn }: { startsOn: string; endsOn: string }) {
  return (
    <Text size="2" color="gray">
      {startsOn === endsOn ? startsOn : `${startsOn} → ${endsOn}`}
    </Text>
  );
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
    <PageShell
      title="Trip profitability"
      subtitle={`${period.label} · invoiced, not collected`}
      action={
        <Flex gap="2" wrap="wrap">
          <Flex gap="1" wrap="wrap">
            <Button asChild size="2" variant={period.kind === "year" ? "solid" : "soft"}>
              <NextLink href={periodHref(year, "year")}>Year</NextLink>
            </Button>
            <Button asChild size="2" variant={period.kind === "quarter" ? "solid" : "soft"}>
              <NextLink href={periodHref(year, "quarter", { quarter: 1 })}>Quarter</NextLink>
            </Button>
            <Button asChild size="2" variant={period.kind === "month" ? "solid" : "soft"}>
              <NextLink href={periodHref(year, "month", { month: 1 })}>Month</NextLink>
            </Button>
            <Button asChild size="2" variant={period.kind === "mtd" ? "solid" : "soft"}>
              <NextLink href={periodHref(year, "mtd")}>Month to date</NextLink>
            </Button>
          </Flex>
          {exportRefused ? (
            <Button variant="outline" size="2" disabled>
              Download CSV
            </Button>
          ) : (
            <Button asChild variant="outline" size="2">
              <a href={csvHref(period)} download>
                Download CSV
              </a>
            </Button>
          )}
        </Flex>
      }
    >
      {period.kind === "year" ? (
        <Flex gap="2" wrap="wrap">
          {yearOptions(year, currentYear).map((y) => (
            <Button key={y} asChild size="2" variant={y === year ? "solid" : "soft"}>
              <NextLink href={periodHref(y, "year")}>{y}</NextLink>
            </Button>
          ))}
        </Flex>
      ) : null}

      {period.kind === "quarter" ? (
        <Flex gap="2" wrap="wrap">
          {[1, 2, 3, 4].map((q) => (
            <Button
              key={q}
              asChild
              size="2"
              variant={sp.quarter === String(q) || (!sp.quarter && q === 1) ? "solid" : "soft"}
            >
              <NextLink href={periodHref(year, "quarter", { quarter: q })}>Q{q}</NextLink>
            </Button>
          ))}
        </Flex>
      ) : null}

      {period.kind === "month" ? (
        <Flex gap="2" wrap="wrap">
          {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
            <Button
              key={m}
              asChild
              size="2"
              variant={sp.month === String(m) || (!sp.month && m === 1) ? "solid" : "soft"}
            >
              <NextLink href={periodHref(year, "month", { month: m })}>{m}</NextLink>
            </Button>
          ))}
        </Flex>
      ) : null}

      {/* LOAD-BEARING, deliberately first — same placement and register as
          the other reports' disclaimers. The basis distinction is the
          single most misreadable thing on this screen: every figure here
          is INVOICED, and the three cash-basis reports next door answer
          "what did I make". Saying so once, prominently, is what keeps a
          pilot from reading this as income. */}
      <Callout.Root color="blue">
        <Callout.Icon>
          <InfoCircledIcon />
        </Callout.Icon>
        <Callout.Text>
          <Text as="div" weight="medium">
            Invoiced, not collected.
          </Text>
          <Text as="div" size="2">
            Every figure here is what you <strong>billed</strong> for a
            trip, not what has landed in your account. Payments are
            recorded per invoice, not per line, so there is no honest way
            to say which trip a given payment paid for. This report
            doesn&rsquo;t guess. For what you actually collected, see{" "}
            <RadixLink asChild>
              <NextLink href="/reports/profit-loss">profit &amp; loss</NextLink>
            </RadixLink>{" "}
            (cash-basis), which stays the authority on &ldquo;what did I
            make&rdquo;.
          </Text>
        </Callout.Text>
      </Callout.Root>

      {report.error ? (
        <Card size="3">
          <Callout.Root color="red">
            <Callout.Icon>
              <ExclamationTriangleIcon />
            </Callout.Icon>
            <Callout.Text>
              {friendlyDbError({ message: report.error }, "trip-pl.load")}
            </Callout.Text>
          </Callout.Root>
        </Card>
      ) : report.refusal ? (
        /* An assembly refusal, not a read failure. The reads worked; the
           rows don't support an honest report, so nothing is printed
           rather than printing a margin whose inputs are short. Same rule
           as the balance sheet refusing to render when A != L + E. */
        <Card size="3">
          <Callout.Root color="red">
            <Callout.Icon>
              <ExclamationTriangleIcon />
            </Callout.Icon>
            <Callout.Text>
              <Text as="div" weight="medium">
                These figures don&rsquo;t add up, so they aren&rsquo;t shown.
              </Text>
              <Text as="div" size="2">
                A margin is a subtraction: if part of the expense side is
                missing, the number comes out too <em>high</em>, which
                looks like good news. Rather than show that, this report
                stops, and the CSV export is disabled for the same reason.
                Contact support with this detail: {report.refusal}
              </Text>
            </Callout.Text>
          </Callout.Root>
        </Card>
      ) : (
        <Flex direction="column" gap="5">
          {report.truncated ? (
            <Callout.Root color="amber">
              <Callout.Icon>
                <ExclamationTriangleIcon />
              </Callout.Icon>
              <Callout.Text>
                There are more{" "}
                {report.tripsTruncated ? "trips" : ""}
                {report.tripsTruncated && report.clientsTruncated ? " and " : ""}
                {report.clientsTruncated ? "clients" : ""}
                {!report.tripsTruncated && !report.clientsTruncated
                  ? "rows"
                  : ""}{" "}
                in this period than this page totals, so the figures below
                may be partial. Narrow the date range, or contact support.
                The CSV export is disabled while this is true.
              </Callout.Text>
            </Callout.Root>
          ) : null}

          {/* ---------------- Headline ---------------- */}
          <Card size="3">
            <Flex justify="between" align="start" wrap="wrap" gap="3">
              <Box>
                <Heading as="h2" size="4">
                  Margin
                </Heading>
                <Text as="div" size="2" color="gray">
                  Invoiced day money minus the expenses you tagged as
                  deductions, across {report.totals.tripCount}{" "}
                  {report.totals.tripCount === 1 ? "trip" : "trips"} touching{" "}
                  {period.start} to {period.end}. Rebilled costs, undecided
                  receipts, and mileage are all excluded. Each is listed
                  below.
                </Text>
              </Box>
              <Flex direction="column" align="end" gap="1">
                <Text size="6" weight="bold" className="tnum">
                  {formatCents(report.totals.marginCents)}
                </Text>
                <Text size="2" color="gray" className="tnum">
                  {report.totals.marginPerDayCents === null
                    ? "n/a (no billable days)"
                    : `${formatCents(report.totals.marginPerDayCents)} per day · ${formatDayQuantity(report.totals.dayQuantity)} days`}
                </Text>
              </Flex>
            </Flex>
            {report.totals.draftDayMoneyCents !== 0 ? (
              <Callout.Root color="amber" mt="3">
                <Callout.Icon>
                  <InfoCircledIcon />
                </Callout.Icon>
                <Callout.Text>
                  <span className="tnum">
                    {formatCents(report.totals.draftDayMoneyCents)}
                  </span>{" "}
                  of the invoiced day money above sits on invoices that are
                  still <strong>drafts</strong>. They are counted here
                  because a draft line already commits the trip, even
                  though it has not been sent to anyone yet.
                </Callout.Text>
              </Callout.Root>
            ) : null}
          </Card>

          {/* ---------------- Per trip ---------------- */}
          <Card size="3">
            <Heading as="h2" size="4" mb="1">
              By trip
            </Heading>
            <Text as="div" size="2" color="gray" mb="3">
              A trip appears here when its dates overlap the period. A trip
              that straddles the boundary is shown in full in both periods.
              Its money is not split across the boundary, because nothing
              in your records says which day of a day-rate invoice belongs
              to which side of it.
            </Text>

            {report.trips.length === 0 ? (
              <Text size="2" color="gray">
                No trips overlap this period.
              </Text>
            ) : (
              <Box style={{ overflowX: "auto" }}>
                <Table.Root variant="ghost">
                  <Table.Header>
                    <Table.Row>
                      <Table.ColumnHeaderCell>Trip</Table.ColumnHeaderCell>
                      <Table.ColumnHeaderCell>Client</Table.ColumnHeaderCell>
                      <Table.ColumnHeaderCell>Billing</Table.ColumnHeaderCell>
                      <Table.ColumnHeaderCell justify="end">Days</Table.ColumnHeaderCell>
                      <Table.ColumnHeaderCell justify="end">Invoiced day money</Table.ColumnHeaderCell>
                      <Table.ColumnHeaderCell justify="end">Deductible expenses</Table.ColumnHeaderCell>
                      <Table.ColumnHeaderCell justify="end">Margin</Table.ColumnHeaderCell>
                      <Table.ColumnHeaderCell justify="end">Margin / day</Table.ColumnHeaderCell>
                    </Table.Row>
                  </Table.Header>
                  <Table.Body>
                    {report.trips.map((t) => (
                      <Table.Row key={t.tripId}>
                        <Table.RowHeaderCell>
                          <Flex direction="column" gap="1">
                            <RadixLink asChild>
                              <NextLink href={`/trips/${t.tripId}`}>
                                {t.aircraftIdent ?? "Trip"}
                              </NextLink>
                            </RadixLink>
                            <TripDates startsOn={t.startsOn} endsOn={t.endsOn} />
                          </Flex>
                        </Table.RowHeaderCell>
                        <Table.Cell>{t.clientName}</Table.Cell>
                        <Table.Cell>
                          <Flex gap="1" wrap="wrap">
                            <Badge
                              color={
                                t.billingState === "paid"
                                  ? "green"
                                  : t.billingState === "invoiced"
                                    ? "blue"
                                    : t.billingState === "written_off"
                                      ? "red"
                                      : "gray"
                              }
                            >
                              {t.billingState.replace("_", " ")}
                            </Badge>
                            {t.hasDraftMoney ? <Badge color="amber">draft</Badge> : null}
                          </Flex>
                        </Table.Cell>
                        <Table.Cell justify="end">
                          <Flex direction="column" align="end" gap="1">
                            <Text className="tnum">{formatDayQuantity(t.dayQuantity)}</Text>
                            {DAY_SOURCE_NOTE[t.dayQuantitySource] ? (
                              <Text size="1" color="gray">
                                {DAY_SOURCE_NOTE[t.dayQuantitySource]}
                              </Text>
                            ) : null}
                          </Flex>
                        </Table.Cell>
                        <Table.Cell justify="end">
                          <Flex direction="column" align="end" gap="1">
                            <Money cents={t.invoicedDayMoneyCents} />
                            {t.hasDraftMoney ? (
                              <Text size="1" color="gray" className="tnum">
                                incl. {formatCents(t.draftDayMoneyCents)} draft
                              </Text>
                            ) : null}
                          </Flex>
                        </Table.Cell>
                        <Table.Cell justify="end">
                          <Money cents={t.deductibleExpenseCents} />
                        </Table.Cell>
                        <Table.Cell justify="end">
                          <Money cents={t.marginCents} bold />
                        </Table.Cell>
                        <Table.Cell justify="end">
                          {t.marginPerDayCents === null ? (
                            <Text color="gray">—</Text>
                          ) : (
                            <Money cents={t.marginPerDayCents} />
                          )}
                        </Table.Cell>
                      </Table.Row>
                    ))}
                  </Table.Body>
                </Table.Root>
              </Box>
            )}
          </Card>

          {/* ---------------- Per client ---------------- */}
          <Card size="3">
            <Heading as="h2" size="4" mb="1">
              By client
            </Heading>
            <Text as="div" size="2" color="gray" mb="3">
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
            </Text>

            {report.clients.length === 0 ? (
              <Text size="2" color="gray">
                Nothing to roll up for this period.
              </Text>
            ) : (
              <Box style={{ overflowX: "auto" }}>
                <Table.Root variant="ghost">
                  <Table.Header>
                    <Table.Row>
                      <Table.ColumnHeaderCell>Client</Table.ColumnHeaderCell>
                      <Table.ColumnHeaderCell justify="end">Trips</Table.ColumnHeaderCell>
                      <Table.ColumnHeaderCell justify="end">Days</Table.ColumnHeaderCell>
                      <Table.ColumnHeaderCell justify="end">Invoiced day money</Table.ColumnHeaderCell>
                      <Table.ColumnHeaderCell justify="end">Deductible expenses</Table.ColumnHeaderCell>
                      <Table.ColumnHeaderCell justify="end">Margin</Table.ColumnHeaderCell>
                      <Table.ColumnHeaderCell justify="end">Margin / day</Table.ColumnHeaderCell>
                      <Table.ColumnHeaderCell justify="end">Not tied to a trip</Table.ColumnHeaderCell>
                    </Table.Row>
                  </Table.Header>
                  <Table.Body>
                    {report.clients.map((c) => (
                      <Table.Row key={c.clientId ?? "no-client"}>
                        <Table.RowHeaderCell>{c.clientName}</Table.RowHeaderCell>
                        <Table.Cell justify="end">
                          <Text className="tnum">{c.tripCount}</Text>
                        </Table.Cell>
                        <Table.Cell justify="end">
                          <Text className="tnum">{formatDayQuantity(c.dayQuantity)}</Text>
                        </Table.Cell>
                        <Table.Cell justify="end">
                          <Money cents={c.invoicedDayMoneyCents} />
                        </Table.Cell>
                        <Table.Cell justify="end">
                          <Money cents={c.deductibleExpenseCents} />
                        </Table.Cell>
                        <Table.Cell justify="end">
                          <Money cents={c.marginCents} bold />
                        </Table.Cell>
                        <Table.Cell justify="end">
                          {c.marginPerDayCents === null ? (
                            <Text color="gray">—</Text>
                          ) : (
                            <Money cents={c.marginPerDayCents} />
                          )}
                        </Table.Cell>
                        <Table.Cell justify="end">
                          {c.unattributedLineCents === 0 && c.draftUnattributedLineCents === 0 ? (
                            <Text color="gray">—</Text>
                          ) : (
                            <Flex direction="column" align="end" gap="1">
                              <Money cents={c.unattributedLineCents} />
                              {c.draftUnattributedLineCents !== 0 ? (
                                <Text size="1" color="gray" className="tnum">
                                  {/* Additive, and safe to add: the SQL splits these
                                      two by invoice status, so no line is in both. Not
                                      labelled "undated" — a draft may carry a
                                      provisional issue date; what is true of every one
                                      of them is that it hasn't been sent. */}
                                  + {formatCents(c.draftUnattributedLineCents)} on drafts (not sent)
                                </Text>
                              ) : null}
                            </Flex>
                          )}
                        </Table.Cell>
                      </Table.Row>
                    ))}
                  </Table.Body>
                </Table.Root>
              </Box>
            )}
          </Card>

          {/* ---------------- Excluded from margin ---------------- */}
          <Card size="3">
            <Heading as="h2" size="4" mb="1">
              Excluded from margin
            </Heading>
            <Text as="div" size="2" color="gray" mb="3">
              Each of these is real, and none of them belongs in a margin.
              They are listed rather than hidden so you can see the whole
              picture and act on it.
            </Text>

            {!anyExcluded ? (
              <Text size="2" color="gray">
                Nothing excluded for these trips: no rebilled receipts, no
                undecided receipts, no mileage.
              </Text>
            ) : (
              <Flex direction="column" gap="4">
                {anyRebillActivity ? (
                  <Box>
                    <Heading as="h3" size="3" mb="1">
                      Rebilled receipts: a pass-through, both legs out
                    </Heading>
                    <Text as="div" size="2" color="gray" mb="2">
                      You paid{" "}
                      <span className="tnum">
                        {formatCents(report.totals.rebilledCostCents)}
                      </span>{" "}
                      out of pocket and billed{" "}
                      <span className="tnum">
                        {formatCents(report.totals.rebillInvoicedCents)}
                      </span>{" "}
                      of it back. Neither leg is in the margin: a rebill is
                      money passing through you, not money you earned.
                    </Text>
                    {report.totals.rebillGapCents !== 0 ? (
                      <Callout.Root
                        color={report.totals.rebillGapCents < 0 ? "amber" : "gray"}
                      >
                        <Callout.Icon>
                          <ExclamationTriangleIcon />
                        </Callout.Icon>
                        <Callout.Text>
                          {report.totals.rebillGapCents < 0 ? (
                            <>
                              <span className="tnum">
                                {formatCents(-report.totals.rebillGapCents)}
                              </span>{" "}
                              of rebilled cost was never billed back, or was
                              billed short. That is money you fronted and
                              haven&rsquo;t recovered. It is invisible in
                              the margin by design, which is exactly why
                              it&rsquo;s called out here. The{" "}
                              <RadixLink asChild>
                                <NextLink href="/reports/year-end">
                                  year-end report
                                </NextLink>
                              </RadixLink>{" "}
                              reconciles these line by line.
                            </>
                          ) : (
                            <>
                              You billed{" "}
                              <span className="tnum">
                                {formatCents(report.totals.rebillGapCents)}
                              </span>{" "}
                              more than the recorded receipts, usually
                              because a receipt was entered short or
                              because of a markup. Either way, it&rsquo;s
                              worth a look.
                            </>
                          )}
                        </Callout.Text>
                      </Callout.Root>
                    ) : null}
                  </Box>
                ) : null}

                {report.totals.unassignedExpenseCents !== 0 ? (
                  <Box>
                    <Heading as="h3" size="3" mb="1">
                      Undecided receipts
                    </Heading>
                    <Text as="div" size="2" color="gray">
                      <span className="tnum">
                        {formatCents(report.totals.unassignedExpenseCents)}
                      </span>{" "}
                      of receipts on these trips are still tagged
                      unassigned. They are neither billed to the client nor
                      claimed as a deduction. Until you decide, they cost
                      you in
                      both directions and cannot be in any margin. Resolve
                      them on{" "}
                      <RadixLink asChild>
                        <NextLink href="/expenses">Expenses</NextLink>
                      </RadixLink>
                      .
                    </Text>
                  </Box>
                ) : null}

                {report.totals.mileageMiles !== 0 ? (
                  <Box>
                    <Heading as="h3" size="3" mb="1">
                      Mileage
                    </Heading>
                    <Text as="div" size="2" color="gray">
                      {formatMiles(report.totals.mileageMiles)} miles logged
                      against these trips, shown in miles and not in
                      dollars on purpose. The standard mileage rate and
                      actual vehicle expenses are alternative deduction
                      methods for the same vehicle. They are never
                      additive, so no mileage figure can go into a trip
                      margin. Your
                      deduction is computed once, from the year&rsquo;s
                      rate, on{" "}
                      <RadixLink asChild>
                        <NextLink href="/expenses/mileage">Mileage</NextLink>
                      </RadixLink>
                      .
                    </Text>
                  </Box>
                ) : null}
              </Flex>
            )}
          </Card>
        </Flex>
      )}
    </PageShell>
  );
}

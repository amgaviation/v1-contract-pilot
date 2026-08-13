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
import { formatCents, formatDate } from "@/lib/format";
import { friendlyDbError } from "@/lib/db-errors";
import PageShell from "../../page-shell";
import { currentTaxYear } from "./db";
import { loadOptionLabels } from "@/lib/custom-options-read";
import { loadYearEndReport } from "./queries";
import { loadTravelLog } from "./travel-log-queries";
import TaxFormEditor from "./tax-form-editor";

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
    <PageShell
      title="Year-end report"
      subtitle={`Tax year ${year} · a summary of what you recorded, not a tax return`}
      action={
        <Flex gap="2" wrap="wrap">
          {yearOptions(year).map((y) => (
            <Button
              key={y}
              asChild
              size="2"
              variant={y === year ? "solid" : "soft"}
            >
              <NextLink href={`/reports/year-end?year=${y}`}>{y}</NextLink>
            </Button>
          ))}
        </Flex>
      }
    >
      {/* LOAD-BEARING, deliberately first: this report summarizes the
          pilot's own records. It never computes tax owed, and it is never
          allowed to read as tax advice — see the migration and task brief
          this feature was built from. This sits above every figure on the
          page, not in a footnote underneath them. */}
      <Callout.Root color="blue" mb="4">
        <Callout.Icon>
          <InfoCircledIcon />
        </Callout.Icon>
        <Callout.Text>
          <Text as="div" weight="medium">
            This is a summary of what you recorded — not tax advice, and not
            a tax return.
          </Text>
          <Text as="div" size="2">
            Every figure below comes directly from the trips, expenses, and
            payments you entered in this product. It doesn&rsquo;t know your
            deductions, your entity structure, or what the IRS will
            ultimately accept. Your CPA or tax preparer is the authority on
            what to file — use this to hand them clean numbers, not to
            decide what you owe.
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
              {friendlyDbError({ message: report.error }, "year-end.load")}
            </Callout.Text>
          </Callout.Root>
        </Card>
      ) : (
        <Flex direction="column" gap="5">
          {/* ---------------- A. Cash-basis income ---------------- */}
          <Card size="3">
            <Flex justify="between" align="start" mb="3" wrap="wrap" gap="2">
              <Box>
                <Heading as="h2" size="4">
                  Income received, by client
                </Heading>
                <Text as="div" size="2" color="gray">
                  Cash-basis: payments actually received between Jan 1 and
                  Dec 31, {year} — not invoices issued or sent in{" "}
                  {year}, which can land you in the wrong tax year.
                </Text>
              </Box>
              <Button asChild variant="outline" size="2">
                <a href={csvHref(year, "income")} download>
                  Download CSV
                </a>
              </Button>
            </Flex>

            {report.paymentsTruncated ? (
              <Callout.Root color="amber" mb="3">
                <Callout.Icon>
                  <ExclamationTriangleIcon />
                </Callout.Icon>
                <Callout.Text>
                  There are more payments in {year} than this page totals —
                  the downloaded CSV may also be partial. Contact support if
                  your totals look short.
                </Callout.Text>
              </Callout.Root>
            ) : null}

            {report.incomeByClient.length === 0 ? (
              <Text size="2" color="gray">
                No payments recorded as received in {year}.
              </Text>
            ) : (
              <>
                <Table.Root variant="ghost">
                  <Table.Header>
                    <Table.Row>
                      <Table.ColumnHeaderCell>Client</Table.ColumnHeaderCell>
                      <Table.ColumnHeaderCell justify="end">
                        Payments
                      </Table.ColumnHeaderCell>
                      <Table.ColumnHeaderCell justify="end">
                        Received
                      </Table.ColumnHeaderCell>
                    </Table.Row>
                  </Table.Header>
                  <Table.Body>
                    {report.incomeByClient.map((c) => (
                      <Table.Row key={c.clientId || c.clientName}>
                        <Table.RowHeaderCell>{c.clientName}</Table.RowHeaderCell>
                        <Table.Cell justify="end">
                          <Text className="tnum">{c.paymentCount}</Text>
                        </Table.Cell>
                        <Table.Cell justify="end">
                          <Text className="tnum" weight="medium">
                            {formatCents(c.totalCents)}
                          </Text>
                        </Table.Cell>
                      </Table.Row>
                    ))}
                  </Table.Body>
                </Table.Root>
                <Flex justify="end" mt="3">
                  <Text weight="bold" className="tnum">
                    Total received: {formatCents(report.incomeTotalCents)}
                  </Text>
                </Flex>
              </>
            )}
          </Card>

          {/* ---------------- B. Deductible expenses ---------------- */}
          <Card size="3">
            <Flex justify="between" align="start" mb="3" wrap="wrap" gap="2">
              <Box>
                <Heading as="h2" size="4">
                  Deductible expenses, by category
                </Heading>
                <Text as="div" size="2" color="gray">
                  Receipts you tagged &ldquo;Keep as a deduction&rdquo;,
                  dated in {year}.
                </Text>
              </Box>
              <Button asChild variant="outline" size="2">
                <a href={csvHref(year, "deductible")} download>
                  Download CSV
                </a>
              </Button>
            </Flex>

            {report.deductibleTruncated ? (
              <Callout.Root color="amber" mb="3">
                <Callout.Icon>
                  <ExclamationTriangleIcon />
                </Callout.Icon>
                <Callout.Text>
                  There are more deductible expenses in {year} than this
                  page totals — the downloaded CSV may also be partial.
                </Callout.Text>
              </Callout.Root>
            ) : null}

            {report.deductibleByCategory.length === 0 ? (
              <Text size="2" color="gray">
                No expenses tagged as deductions in {year}.
              </Text>
            ) : (
              <>
                <Table.Root variant="ghost">
                  <Table.Header>
                    <Table.Row>
                      <Table.ColumnHeaderCell>Category</Table.ColumnHeaderCell>
                      <Table.ColumnHeaderCell justify="end">
                        Receipts
                      </Table.ColumnHeaderCell>
                      <Table.ColumnHeaderCell justify="end">
                        Amount
                      </Table.ColumnHeaderCell>
                    </Table.Row>
                  </Table.Header>
                  <Table.Body>
                    {report.deductibleByCategory.map((c) => (
                      <Table.Row key={c.category}>
                        <Table.RowHeaderCell>
                          {categoryLabels[c.category] ?? c.category}
                        </Table.RowHeaderCell>
                        <Table.Cell justify="end">
                          <Text className="tnum">{c.count}</Text>
                        </Table.Cell>
                        <Table.Cell justify="end">
                          <Text className="tnum" weight="medium">
                            {formatCents(c.totalCents)}
                          </Text>
                        </Table.Cell>
                      </Table.Row>
                    ))}
                  </Table.Body>
                </Table.Root>
                <Flex justify="end" mt="3">
                  <Text weight="bold" className="tnum">
                    Total deductible: {formatCents(report.deductibleTotalCents)}
                  </Text>
                </Flex>
              </>
            )}
          </Card>

          {/* ---------------- C. Rebilled expenses ---------------- */}
          <Card size="3">
            <Flex justify="between" align="start" mb="3" wrap="wrap" gap="2">
              <Box>
                <Heading as="h2" size="4">
                  Rebilled expenses, reconciled
                </Heading>
                <Text as="div" size="2" color="gray">
                  Receipts you tagged &ldquo;Rebill to the client&rdquo;,
                  dated in {year}, matched against the invoice line each one
                  became.
                </Text>
              </Box>
              <Button asChild variant="outline" size="2">
                <a href={csvHref(year, "rebilled")} download>
                  Download CSV
                </a>
              </Button>
            </Flex>

            {report.rebilledTruncated ? (
              <Callout.Root color="amber" mb="3">
                <Callout.Icon>
                  <ExclamationTriangleIcon />
                </Callout.Icon>
                <Callout.Text>
                  There are more rebilled expenses in {year} than this page
                  totals — the downloaded CSV may also be partial.
                </Callout.Text>
              </Callout.Root>
            ) : null}

            {report.rebilled.length === 0 ? (
              <Text size="2" color="gray">
                No expenses tagged for rebilling in {year}.
              </Text>
            ) : (
              <>
                <Table.Root variant="ghost">
                  <Table.Header>
                    <Table.Row>
                      <Table.ColumnHeaderCell>Date</Table.ColumnHeaderCell>
                      <Table.ColumnHeaderCell>Category</Table.ColumnHeaderCell>
                      <Table.ColumnHeaderCell>Client</Table.ColumnHeaderCell>
                      <Table.ColumnHeaderCell justify="end">
                        Receipt
                      </Table.ColumnHeaderCell>
                      <Table.ColumnHeaderCell justify="end">
                        Invoiced
                      </Table.ColumnHeaderCell>
                      <Table.ColumnHeaderCell>Status</Table.ColumnHeaderCell>
                    </Table.Row>
                  </Table.Header>
                  <Table.Body>
                    {report.rebilled.map((r) => (
                      <Table.Row key={r.expenseId}>
                        <Table.RowHeaderCell>
                          {formatDate(r.incurredOn)}
                        </Table.RowHeaderCell>
                        <Table.Cell>
                          <Text color="gray">
                            {categoryLabels[r.category] ?? r.category}
                          </Text>
                        </Table.Cell>
                        <Table.Cell>
                          <Text color="gray">{r.clientName ?? "—"}</Text>
                        </Table.Cell>
                        <Table.Cell justify="end">
                          <Text className="tnum">
                            {formatCents(r.expenseAmountCents)}
                          </Text>
                        </Table.Cell>
                        <Table.Cell justify="end">
                          <Text className="tnum">
                            {r.lineAmountCents === null
                              ? "—"
                              : formatCents(r.lineAmountCents)}
                          </Text>
                        </Table.Cell>
                        <Table.Cell>
                          <Badge color={r.invoiceId ? "green" : "amber"}>
                            {r.invoiceId
                              ? r.invoiceStatus === "paid"
                                ? "Invoiced & paid"
                                : "Invoiced"
                              : "Not yet invoiced"}
                          </Badge>
                        </Table.Cell>
                      </Table.Row>
                    ))}
                  </Table.Body>
                </Table.Root>
                <Flex justify="end" mt="3" gap="4" wrap="wrap">
                  <Text size="2" color="gray" className="tnum">
                    Receipts: {formatCents(report.rebilledExpenseTotalCents)}
                  </Text>
                  <Text weight="bold" className="tnum">
                    Invoiced: {formatCents(report.rebilledInvoicedTotalCents)}
                  </Text>
                </Flex>
              </>
            )}
          </Card>

          {/* ---------------- D. Unassigned receipts ---------------- */}
          <Card size="3">
            <Flex justify="between" align="start" mb="3" wrap="wrap" gap="2">
              <Box>
                <Heading as="h2" size="4">
                  Unassigned receipts
                </Heading>
                <Text as="div" size="2" color="gray">
                  Dated in {year}, neither billed to a client nor claimed as
                  a deduction — money you&rsquo;re currently losing in both
                  directions. Resolve them on{" "}
                  <RadixLink asChild>
                    <NextLink href="/expenses">Expenses</NextLink>
                  </RadixLink>
                  , where each one is a two-click decision.
                </Text>
              </Box>
              <Button asChild variant="outline" size="2">
                <a href={csvHref(year, "unassigned")} download>
                  Download CSV
                </a>
              </Button>
            </Flex>

            {report.unassignedTruncated ? (
              <Callout.Root color="amber" mb="3">
                <Callout.Icon>
                  <ExclamationTriangleIcon />
                </Callout.Icon>
                <Callout.Text>
                  There are more unassigned receipts in {year} than this
                  page totals — the downloaded CSV may also be partial.
                </Callout.Text>
              </Callout.Root>
            ) : null}

            {report.unassigned.length === 0 ? (
              <Text size="2" color="gray">
                Nothing unassigned in {year} — every receipt is either
                rebilled or deducted.
              </Text>
            ) : (
              <>
                <Callout.Root color="amber" mb="3">
                  <Callout.Icon>
                    <ExclamationTriangleIcon />
                  </Callout.Icon>
                  <Callout.Text>
                    {report.unassigned.length} receipt
                    {report.unassigned.length === 1 ? "" : "s"} totaling{" "}
                    {formatCents(report.unassignedTotalCents)} are currently
                    counted in neither your income nor your deductions.
                  </Callout.Text>
                </Callout.Root>
                <Table.Root variant="ghost">
                  <Table.Header>
                    <Table.Row>
                      <Table.ColumnHeaderCell>Date</Table.ColumnHeaderCell>
                      <Table.ColumnHeaderCell>Category</Table.ColumnHeaderCell>
                      <Table.ColumnHeaderCell>Vendor</Table.ColumnHeaderCell>
                      <Table.ColumnHeaderCell justify="end">
                        Amount
                      </Table.ColumnHeaderCell>
                    </Table.Row>
                  </Table.Header>
                  <Table.Body>
                    {report.unassigned.map((e) => (
                      <Table.Row key={e.id}>
                        <Table.RowHeaderCell>
                          <RadixLink asChild>
                            <NextLink href={`/expenses/${e.id}`}>
                              {formatDate(e.incurredOn)}
                            </NextLink>
                          </RadixLink>
                        </Table.RowHeaderCell>
                        <Table.Cell>
                          <Text color="gray">
                            {categoryLabels[e.category] ?? e.category}
                          </Text>
                        </Table.Cell>
                        <Table.Cell>
                          <Text color="gray">{e.vendor ?? "—"}</Text>
                        </Table.Cell>
                        <Table.Cell justify="end">
                          <Text className="tnum">{formatCents(e.amountCents)}</Text>
                        </Table.Cell>
                      </Table.Row>
                    ))}
                  </Table.Body>
                </Table.Root>
              </>
            )}
          </Card>

          {/* ---------------- E. Mileage, standard rate ---------------- */}
          <Card size="3">
            <Flex justify="between" align="start" mb="3" wrap="wrap" gap="2">
              <Box>
                <Heading as="h2" size="4">
                  Mileage, standard rate
                </Heading>
                <Text as="div" size="2" color="gray">
                  Standard-mileage-rate drives logged in {year} — excluded
                  from Deductible expenses above. The standard mileage rate
                  and actual vehicle expenses (fuel, rental car) are
                  alternative deduction methods for the same vehicle, never
                  additive, and this report can&rsquo;t tell which one
                  applies to a given vehicle and year — folding this in
                  automatically risks a double-claimed deduction. Review it
                  in{" "}
                  <RadixLink asChild>
                    <NextLink href="/expenses/mileage">Mileage</NextLink>
                  </RadixLink>{" "}
                  before filing.
                </Text>
              </Box>
              <Button asChild variant="outline" size="2">
                <a href={csvHref(year, "mileage")} download>
                  Download CSV
                </a>
              </Button>
            </Flex>

            {report.mileageTruncated ? (
              <Callout.Root color="amber" mb="3">
                <Callout.Icon>
                  <ExclamationTriangleIcon />
                </Callout.Icon>
                <Callout.Text>
                  There are more drives logged in {year} than this page
                  totals — the downloaded CSV may also be partial.
                </Callout.Text>
              </Callout.Root>
            ) : null}

            {report.mileageCount === 0 ? (
              <Text size="2" color="gray">
                No mileage logged in {year}.
              </Text>
            ) : (
              <>
                <Table.Root variant="ghost">
                  <Table.Header>
                    <Table.Row>
                      <Table.ColumnHeaderCell>Drives</Table.ColumnHeaderCell>
                      <Table.ColumnHeaderCell justify="end">
                        Miles
                      </Table.ColumnHeaderCell>
                      <Table.ColumnHeaderCell justify="end">
                        Rate
                      </Table.ColumnHeaderCell>
                      <Table.ColumnHeaderCell justify="end">
                        Amount
                      </Table.ColumnHeaderCell>
                    </Table.Row>
                  </Table.Header>
                  <Table.Body>
                    <Table.Row>
                      <Table.RowHeaderCell>
                        <Text className="tnum">{report.mileageCount}</Text>
                      </Table.RowHeaderCell>
                      <Table.Cell justify="end">
                        <Text className="tnum">
                          {report.mileageMiles.toFixed(1)}
                        </Text>
                      </Table.Cell>
                      <Table.Cell justify="end">
                        <Text className="tnum" color="gray">
                          {report.mileageRateCentsPerMile === null
                            ? "—"
                            : `${report.mileageRateCentsPerMile}¢/mi`}
                        </Text>
                      </Table.Cell>
                      <Table.Cell justify="end">
                        <Text weight="medium" className="tnum">
                          {report.mileageAmountCents === null
                            ? "No rate on file"
                            : formatCents(report.mileageAmountCents)}
                        </Text>
                      </Table.Cell>
                    </Table.Row>
                  </Table.Body>
                </Table.Root>
                {report.mileageAmountCents === null ? (
                  <Callout.Root color="amber" mt="3">
                    <Callout.Icon>
                      <ExclamationTriangleIcon />
                    </Callout.Icon>
                    <Callout.Text>
                      {`There's no IRS standard rate on file for ${year}, so the ${report.mileageMiles.toFixed(1)} miles above have no dollar figure yet. Add a rate in `}
                      <RadixLink asChild>
                        <NextLink href="/expenses/mileage">Mileage</NextLink>
                      </RadixLink>
                      {" and this recomputes."}
                    </Callout.Text>
                  </Callout.Root>
                ) : null}
              </>
            )}
          </Card>

          {/* ---------------- E2. Travel log & per-diem days ----------------
              Substantiation, not a dollar figure: the M&IE rate is the
              pilot's CPA's to apply (the pilot.mileage_rates precedent —
              never a hardcoded IRS/GSA number — and here no rate field
              exists at all), so this section counts days and says so.
              See travel-log.ts's header for the full reasoning. */}
          <Card size="3">
            <Flex justify="between" align="start" mb="3" wrap="wrap" gap="2">
              <Box>
                <Heading as="h2" size="4">
                  Travel log &amp; per-diem days
                </Heading>
                <Text as="div" size="2" color="gray">
                  One row per trip day you recorded in {year} — date,
                  client, day type, away-from-home, and the route flown
                  that day. For whoever prepares your return: this log
                  counts days and never applies an M&amp;IE rate or
                  computes a deduction. Your CPA or tax preparer applies
                  the current rate to the away-day counts below.
                </Text>
              </Box>
              <Button asChild variant="outline" size="2">
                <a href={csvHref(year, "travel-log")} download>
                  Download CSV
                </a>
              </Button>
            </Flex>

            {travelLog.error ? (
              <Callout.Root color="red">
                <Callout.Icon>
                  <ExclamationTriangleIcon />
                </Callout.Icon>
                <Callout.Text>
                  {friendlyDbError(
                    { message: travelLog.error },
                    "year-end.travel-log"
                  )}
                </Callout.Text>
              </Callout.Root>
            ) : (
              <>
                {travelLog.truncated ? (
                  <Callout.Root color="amber" mb="3">
                    <Callout.Icon>
                      <ExclamationTriangleIcon />
                    </Callout.Icon>
                    <Callout.Text>
                      There are more trip days in {year} than this page can
                      list — the counts below may be short and the CSV will
                      refuse to download. Contact support if your log looks
                      incomplete.
                    </Callout.Text>
                  </Callout.Root>
                ) : null}

                {travelLog.rows.length === 0 ? (
                  <Text size="2" color="gray">
                    No trip days recorded in {year}.
                  </Text>
                ) : (
                  <>
                    <Table.Root variant="ghost">
                      <Table.Header>
                        <Table.Row>
                          <Table.ColumnHeaderCell>Date</Table.ColumnHeaderCell>
                          <Table.ColumnHeaderCell>Client</Table.ColumnHeaderCell>
                          <Table.ColumnHeaderCell>Day type</Table.ColumnHeaderCell>
                          <Table.ColumnHeaderCell>
                            Route flown
                          </Table.ColumnHeaderCell>
                          <Table.ColumnHeaderCell>Away</Table.ColumnHeaderCell>
                          <Table.ColumnHeaderCell>Per diem</Table.ColumnHeaderCell>
                        </Table.Row>
                      </Table.Header>
                      <Table.Body>
                        {travelLog.rows.map((d) => (
                          <Table.Row key={d.id}>
                            <Table.RowHeaderCell>
                              <RadixLink asChild>
                                <NextLink href={`/trips/${d.tripId}`}>
                                  {formatDate(d.dayOn)}
                                </NextLink>
                              </RadixLink>
                            </Table.RowHeaderCell>
                            <Table.Cell>
                              <Text color="gray">{d.clientName}</Text>
                            </Table.Cell>
                            <Table.Cell>
                              <Text color="gray">{d.dayTypeLabel}</Text>
                            </Table.Cell>
                            <Table.Cell>
                              <Text color="gray">{d.route ?? "—"}</Text>
                            </Table.Cell>
                            <Table.Cell>
                              <Text color="gray">{d.away ? "Away" : "Home"}</Text>
                            </Table.Cell>
                            <Table.Cell>
                              <Text color="gray">{d.perDiemDay ? "Yes" : "—"}</Text>
                            </Table.Cell>
                          </Table.Row>
                        ))}
                      </Table.Body>
                    </Table.Root>
                    <Flex justify="end" mt="3" gap="4" wrap="wrap">
                      <Text size="2" color="gray" className="tnum">
                        Trip days: {travelLog.rows.length}
                      </Text>
                      <Text size="2" color="gray" className="tnum">
                        Away from home: {travelLog.awayDayCount}
                      </Text>
                      <Text weight="bold" className="tnum">
                        Per-diem days: {travelLog.perDiemDayCount}
                      </Text>
                    </Flex>
                  </>
                )}
                {travelLog.canceledDayCount > 0 ? (
                  <Text as="p" size="1" color="gray" mt="2">
                    {travelLog.canceledDayCount} day
                    {travelLog.canceledDayCount === 1 ? "" : "s"} on canceled
                    trips {travelLog.canceledDayCount === 1 ? "is" : "are"}{" "}
                    excluded from this log.
                  </Text>
                ) : null}
              </>
            )}
          </Card>

          {/* ---------------- F. 1099 reconciliation ---------------- */}
          <Card size="3">
            <Flex justify="between" align="start" mb="3" wrap="wrap" gap="2">
              <Box>
                <Heading as="h2" size="4">
                  1099 reconciliation
                </Heading>
                <Text as="div" size="2" color="gray">
                  Your cash-basis ledger for {year} against what each client
                  told the IRS they paid you. A difference here usually
                  means a payment crossed the Dec/Jan boundary — a client
                  who mailed a cheque on Dec 28 and had you deposit it Jan 4
                  reports it in one tax year while your own ledger, dated by
                  when you actually received it, lands it in the other. That
                  is not an error to fix in your books — it&rsquo;s a
                  reason the two numbers won&rsquo;t match, worth having
                  ready when your CPA asks about it.
                </Text>
              </Box>
              <Button asChild variant="outline" size="2">
                <a href={csvHref(year, "tax-forms")} download>
                  Download CSV
                </a>
              </Button>
            </Flex>

            {report.taxForms.length === 0 ? (
              <Text size="2" color="gray">
                No client income and no 1099s recorded for {year} yet.
              </Text>
            ) : (
              <Flex direction="column" gap="4">
                <Table.Root variant="ghost">
                  <Table.Header>
                    <Table.Row>
                      <Table.ColumnHeaderCell>Client</Table.ColumnHeaderCell>
                      <Table.ColumnHeaderCell justify="end">
                        Your ledger
                      </Table.ColumnHeaderCell>
                      <Table.ColumnHeaderCell>Form</Table.ColumnHeaderCell>
                      <Table.ColumnHeaderCell justify="end">
                        Form reports
                      </Table.ColumnHeaderCell>
                      <Table.ColumnHeaderCell justify="end">
                        Delta
                      </Table.ColumnHeaderCell>
                      <Table.ColumnHeaderCell />
                    </Table.Row>
                  </Table.Header>
                  <Table.Body>
                    {report.taxForms.map((t) => (
                      <Table.Row key={`${t.clientId}:${t.formType ?? "none"}`}>
                        <Table.RowHeaderCell>{t.clientName}</Table.RowHeaderCell>
                        <Table.Cell justify="end">
                          <Text className="tnum">{formatCents(t.ledgerCents)}</Text>
                        </Table.Cell>
                        <Table.Cell>
                          <Text color="gray">{t.formType ?? "—"}</Text>
                        </Table.Cell>
                        <Table.Cell justify="end">
                          <Text className="tnum">
                            {t.reportedAmountCents === null
                              ? "—"
                              : formatCents(t.reportedAmountCents)}
                          </Text>
                        </Table.Cell>
                        <Table.Cell justify="end">
                          {t.deltaCents === null ? (
                            <Text color="gray">—</Text>
                          ) : (
                            <Badge color={t.deltaCents === 0 ? "green" : "amber"}>
                              {t.deltaCents === 0
                                ? "Matches"
                                : `${t.deltaCents > 0 ? "+" : ""}${formatCents(t.deltaCents)}`}
                            </Badge>
                          )}
                        </Table.Cell>
                        <Table.Cell>
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
                        </Table.Cell>
                      </Table.Row>
                    ))}
                  </Table.Body>
                </Table.Root>
              </Flex>
            )}
          </Card>
        </Flex>
      )}
    </PageShell>
  );
}

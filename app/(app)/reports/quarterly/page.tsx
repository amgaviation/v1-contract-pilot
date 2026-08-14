import NextLink from "next/link";
import {
  Box,
  Button,
  Callout,
  Card,
  Flex,
  Heading,
  Link as RadixLink,
  Table,
  Text,
  TextField,
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
    <PageShell
      title="Quarterly estimated tax"
      subtitle={`Tax year ${year} · cash received and expenses incurred, by IRS estimated-tax period`}
      action={
        <Flex gap="2" wrap="wrap">
          {yearOptions(year).map((y) => (
            <Button
              key={y}
              asChild
              size="2"
              variant={y === year ? "solid" : "soft"}
            >
              <NextLink
                href={`/reports/quarterly?year=${y}${
                  setAsidePercent !== null ? `&setAside=${setAsidePercent}` : ""
                }`}
              >
                {y}
              </NextLink>
            </Button>
          ))}
          <Button asChild variant="outline" size="2">
            <a href={csvHref(year)} download>
              Download CSV
            </a>
          </Button>
        </Flex>
      }
    >
      {/* LOAD-BEARING, deliberately first — same placement and register as
          app/(app)/reports/year-end/page.tsx's own disclaimer. This screen
          shows net profit, which is an honest number straight from the
          pilot's own ledger, but it never computes what they owe: actual
          liability depends on self-employment tax, the QBI deduction,
          filing status, a spouse's withholding, and other income this
          product cannot see. */}
      <Callout.Root color="blue" mb="4">
        <Callout.Icon>
          <InfoCircledIcon />
        </Callout.Icon>
        <Callout.Text>
          <Text as="div" weight="medium">
            This is a planning aid computed from the records you entered.
            It is not a tax calculation, and it is not tax advice.
          </Text>
          <Text as="div" size="2">
            Net profit below is income minus deductible expenses and
            rebilled costs. It does NOT include the standard-mileage
            deduction, which is informational only. The standard rate and
            actual vehicle expenses are alternative deduction methods,
            never both, and this report can&rsquo;t tell which one you
            elected. It also does not account for self-employment tax, the
            QBI deduction, your filing status, a spouse&rsquo;s
            withholding, or other income. The &ldquo;Set aside&rdquo;
            column is simple arithmetic on a percentage you choose, applied
            to that same net profit, and it also does not include mileage.
            This is not a number this product is asserting as correct.
            Confirm amounts and due dates with a tax professional or the
            IRS before you pay.
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
              {friendlyDbError({ message: report.error }, "quarterly.load")}
            </Callout.Text>
          </Callout.Root>
        </Card>
      ) : (
        <Flex direction="column" gap="5">
          {(report.paymentsTruncated || report.deductibleTruncated) ? (
            <Callout.Root color="amber">
              <Callout.Icon>
                <ExclamationTriangleIcon />
              </Callout.Icon>
              <Callout.Text>
                There are more {report.paymentsTruncated ? "payments" : ""}
                {report.paymentsTruncated && report.deductibleTruncated
                  ? " and "
                  : ""}
                {report.deductibleTruncated ? "deductible expenses" : ""} in{" "}
                {year} than this page totals. The figures below and the
                downloaded CSV may both be partial. Contact support if your
                totals look short.
              </Callout.Text>
            </Callout.Root>
          ) : null}

          {report.mileageTruncated ? (
            <Callout.Root color="amber">
              <Callout.Icon>
                <ExclamationTriangleIcon />
              </Callout.Icon>
              <Callout.Text>
                There are more drives logged in {year} than this page
                totals. The mileage figures below and the downloaded CSV
                may both be partial.
              </Callout.Text>
            </Callout.Root>
          ) : null}

          {/* Set-aside rate: a plain GET form, not client state — see
              parseSetAsidePercent's comment above for why. Submitting
              re-requests this same page with ?setAside= added, so the
              server recomputes every period's "Set aside" column; nothing
              about the rate is ever written to the database. */}
          <Card size="3">
            <Heading as="h2" size="4" mb="2">
              Set-aside percentage
            </Heading>
            <Text as="div" size="2" color="gray" mb="3">
              Enter a percentage of net profit you want to set aside for
              taxes. This is your own estimate, not one this product
              provides — left blank until you enter one, and never saved.
            </Text>
            <form method="GET" action="/reports/quarterly">
              <Flex gap="2" align="center" wrap="wrap">
                <input type="hidden" name="year" value={year} />
                <Box width="6rem">
                  <TextField.Root
                    type="number"
                    name="setAside"
                    min={0}
                    max={100}
                    step="1"
                    placeholder="e.g. 25"
                    defaultValue={setAsidePercent ?? ""}
                    aria-label="Set-aside percentage"
                  />
                </Box>
                <Text size="2" color="gray">
                  %
                </Text>
                <Button type="submit" size="2" variant="soft">
                  Apply
                </Button>
              </Flex>
            </form>
          </Card>

          {report.periods.map((pf) => (
            <Card size="3" key={pf.period.number}>
              <Flex justify="between" align="start" mb="3" wrap="wrap" gap="2">
                <Box>
                  <Heading as="h2" size="4">
                    {pf.period.label} · {pf.period.covers}, {year}
                  </Heading>
                  <Text as="div" size="2" color="gray">
                    Payment due {pf.period.dueDateLabel}. When a due date
                    falls on a Saturday, Sunday, or legal holiday, the IRS
                    moves the deadline to the next business day. Confirm
                    the exact date for {year} with the IRS or your
                    accountant before you pay.
                  </Text>
                </Box>
              </Flex>

              <Table.Root variant="ghost">
                <Table.Header>
                  <Table.Row>
                    <Table.ColumnHeaderCell></Table.ColumnHeaderCell>
                    <Table.ColumnHeaderCell justify="end">
                      Count
                    </Table.ColumnHeaderCell>
                    <Table.ColumnHeaderCell justify="end">
                      Amount
                    </Table.ColumnHeaderCell>
                  </Table.Row>
                </Table.Header>
                <Table.Body>
                  <Table.Row>
                    <Table.RowHeaderCell>
                      Cash received (paid-on basis)
                    </Table.RowHeaderCell>
                    <Table.Cell justify="end">
                      <Text className="tnum">{pf.paymentCount}</Text>
                    </Table.Cell>
                    <Table.Cell justify="end">
                      <Text className="tnum">{formatCents(pf.incomeCents)}</Text>
                    </Table.Cell>
                  </Table.Row>
                  <Table.Row>
                    <Table.RowHeaderCell>
                      Deductible expenses (incurred)
                    </Table.RowHeaderCell>
                    <Table.Cell justify="end">
                      <Text className="tnum">{pf.expenseCount}</Text>
                    </Table.Cell>
                    <Table.Cell justify="end">
                      <Text className="tnum">
                        {formatCents(pf.deductibleCents)}
                      </Text>
                    </Table.Cell>
                  </Table.Row>
                  {/* Shown, not silently netted off. The income above
                      already contains whatever the client reimbursed, so
                      this cost has to come out of profit — but a figure
                      that moves net profit without appearing anywhere is
                      its own kind of wrong. Hidden at zero so a pilot who
                      never rebills doesn't carry a line that means nothing
                      to them. */}
                  {pf.rebilledCostCents > 0 ? (
                    <Table.Row>
                      <Table.RowHeaderCell>
                        Rebilled costs (reimbursed by the client)
                      </Table.RowHeaderCell>
                      <Table.Cell justify="end" />
                      <Table.Cell justify="end">
                        <Text className="tnum">
                          {formatCents(pf.rebilledCostCents)}
                        </Text>
                      </Table.Cell>
                    </Table.Row>
                  ) : null}
                  <Table.Row>
                    <Table.RowHeaderCell>
                      <Text weight="bold">Net profit</Text>
                    </Table.RowHeaderCell>
                    <Table.Cell justify="end" />
                    <Table.Cell justify="end">
                      <Text className="tnum" weight="bold">
                        {formatCents(pf.netProfitCents)}
                      </Text>
                    </Table.Cell>
                  </Table.Row>
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
                    <Table.Row>
                      <Table.RowHeaderCell>
                        Mileage, standard rate (informational — not in net
                        profit)
                      </Table.RowHeaderCell>
                      <Table.Cell justify="end">
                        <Text className="tnum">{pf.mileageCount}</Text>
                      </Table.Cell>
                      <Table.Cell justify="end">
                        <Text className="tnum">
                          {pf.mileageAmountCents === null
                            ? "No rate on file"
                            : formatCents(pf.mileageAmountCents)}
                        </Text>
                      </Table.Cell>
                    </Table.Row>
                  ) : null}
                  {pf.mileageCount > 0 ? (
                    <Table.Row>
                      <Table.RowHeaderCell>
                        <Text size="2" color="gray">
                          {pf.mileageMiles.toFixed(1)} mi
                          {pf.mileageRateCentsPerMile === null
                            ? `, no IRS rate on file for ${year}`
                            : ` @ ${pf.mileageRateCentsPerMile}¢/mi`}
                        </Text>
                      </Table.RowHeaderCell>
                      <Table.Cell justify="end" />
                      <Table.Cell justify="end" />
                    </Table.Row>
                  ) : null}
                  <Table.Row>
                    <Table.RowHeaderCell>
                      Set aside
                      {setAsidePercent !== null ? ` (${setAsidePercent}%)` : ""}
                    </Table.RowHeaderCell>
                    <Table.Cell justify="end" />
                    <Table.Cell justify="end">
                      {setAsidePercent === null ? (
                        <Text size="2" color="gray">
                          Enter a percentage above
                        </Text>
                      ) : (
                        <Text className="tnum">
                          {formatCents(
                            Math.round(
                              (pf.netProfitCents * setAsidePercent) / 100
                            )
                          )}
                        </Text>
                      )}
                    </Table.Cell>
                  </Table.Row>
                </Table.Body>
              </Table.Root>

              {pf.unassigned.length > 0 ? (
                <Box mt="4">
                  <Callout.Root color="amber" mb="3">
                    <Callout.Icon>
                      <ExclamationTriangleIcon />
                    </Callout.Icon>
                    <Callout.Text>
                      {pf.unassigned.length} receipt
                      {pf.unassigned.length === 1 ? "" : "s"} totaling{" "}
                      {formatCents(pf.unassignedTotalCents)} in this period
                      are currently counted in neither your income nor your
                      deductions. An unassigned receipt in a closed period
                      is a deduction you&rsquo;re about to lose. Resolve
                      them on{" "}
                      <RadixLink asChild>
                        <NextLink href="/expenses">Expenses</NextLink>
                      </RadixLink>
                      , where each one is a two-click decision.
                    </Callout.Text>
                  </Callout.Root>
                  {pf.unassignedTruncated ? (
                    <Callout.Root color="amber" mb="3">
                      <Callout.Icon>
                        <ExclamationTriangleIcon />
                      </Callout.Icon>
                      <Callout.Text>
                        There are more unassigned receipts in {year} than
                        this page totals. This period&rsquo;s count and
                        total may also be partial.
                      </Callout.Text>
                    </Callout.Root>
                  ) : null}
                  <Table.Root variant="ghost">
                    <Table.Header>
                      <Table.Row>
                        <Table.ColumnHeaderCell>Date</Table.ColumnHeaderCell>
                        <Table.ColumnHeaderCell>
                          Category
                        </Table.ColumnHeaderCell>
                        <Table.ColumnHeaderCell>
                          Vendor
                        </Table.ColumnHeaderCell>
                        <Table.ColumnHeaderCell justify="end">
                          Amount
                        </Table.ColumnHeaderCell>
                      </Table.Row>
                    </Table.Header>
                    <Table.Body>
                      {pf.unassigned.map((e) => (
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
                            <Text className="tnum">
                              {formatCents(e.amountCents)}
                            </Text>
                          </Table.Cell>
                        </Table.Row>
                      ))}
                    </Table.Body>
                  </Table.Root>
                </Box>
              ) : null}
            </Card>
          ))}
        </Flex>
      )}
    </PageShell>
  );
}

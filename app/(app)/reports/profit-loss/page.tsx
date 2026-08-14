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
import { currentTaxYear } from "../year-end/db";
import { loadOptionLabels } from "@/lib/custom-options-read";
import { loadProfitLossReport, resolvePLPeriod, type Comparison } from "./queries";

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
    return (
      <Text size="2" color="gray">
        No prior data
      </Text>
    );
  }
  const positive = comparison.deltaCents > 0;
  const negative = comparison.deltaCents < 0;
  // For expenses, a rise is unfavourable — invert which colour reads as
  // "good" without changing the arithmetic or the sign shown.
  const good = invert ? negative : positive;
  const bad = invert ? positive : negative;
  const color = good ? "green" : bad ? "amber" : "gray";
  const sign = comparison.deltaCents > 0 ? "+" : "";
  return (
    <Badge color={color}>
      <span className="tnum">
        {sign}
        {formatCents(comparison.deltaCents)}
        {comparison.deltaPercent !== null
          ? ` (${sign}${comparison.deltaPercent.toFixed(1)}%)`
          : ""}
      </span>
    </Badge>
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

  return (
    <PageShell
      title="Profit & loss"
      subtitle={`${period.label} · income and expenses, cash-basis`}
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
          <Button asChild variant="outline" size="2">
            <a href={csvHref(period)} download>
              Download CSV
            </a>
          </Button>
        </Flex>
      }
    >
      {period.kind === "year" ? (
        <Flex gap="2" wrap="wrap" mb="4">
          {yearOptions(year).map((y) => (
            <Button key={y} asChild size="2" variant={y === year ? "solid" : "soft"}>
              <NextLink href={periodHref(y, "year")}>{y}</NextLink>
            </Button>
          ))}
        </Flex>
      ) : null}

      {period.kind === "quarter" ? (
        <Flex gap="2" wrap="wrap" mb="4">
          {[1, 2, 3, 4].map((q) => (
            <Button key={q} asChild size="2" variant={sp.quarter === String(q) || (!sp.quarter && q === 1) ? "solid" : "soft"}>
              <NextLink href={periodHref(year, "quarter", { quarter: q })}>Q{q}</NextLink>
            </Button>
          ))}
        </Flex>
      ) : null}

      {period.kind === "month" ? (
        <Flex gap="2" wrap="wrap" mb="4">
          {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
            <Button key={m} asChild size="2" variant={sp.month === String(m) || (!sp.month && m === 1) ? "solid" : "soft"}>
              <NextLink href={periodHref(year, "month", { month: m })}>{m}</NextLink>
            </Button>
          ))}
        </Flex>
      ) : null}

      {/* LOAD-BEARING, deliberately first — same placement and register as
          app/(app)/reports/year-end/page.tsx and
          app/(app)/reports/quarterly/page.tsx's own disclaimers. This is
          arithmetic on the pilot's own ledger, not a filed return and not
          tax advice — but unlike quarterly's "net profit" line, this
          screen doesn't touch tax rates or set-asides at all, so it
          doesn't need to caveat as heavily. */}
      <Callout.Root color="blue" mb="4">
        <Callout.Icon>
          <InfoCircledIcon />
        </Callout.Icon>
        <Callout.Text>
          <Text as="div" weight="medium">
            This is your own ledger, summarized — not a filed statement.
          </Text>
          <Text as="div" size="2">
            Income is cash-basis: payments actually received in this
            period, not invoices issued. Expenses are the receipts you
            tagged as deductions. It doesn&rsquo;t know your tax situation
            — for that, see the{" "}
            <RadixLink asChild>
              <NextLink href="/reports/year-end">year-end report</NextLink>
            </RadixLink>{" "}
            or{" "}
            <RadixLink asChild>
              <NextLink href="/reports/quarterly">quarterly estimated tax</NextLink>
            </RadixLink>
            .
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
              {friendlyDbError({ message: report.error }, "profit-loss.load")}
            </Callout.Text>
          </Callout.Root>
        </Card>
      ) : (
        <Flex direction="column" gap="5">
          {period.priorIsApproximate ? (
            <Callout.Root color="gray">
              <Callout.Icon>
                <InfoCircledIcon />
              </Callout.Icon>
              <Callout.Text>
                A custom range has no calendar unit to compare against, so
                &ldquo;{period.priorLabel}&rdquo; is the same number of
                days immediately before your range — an approximation, not
                the same calendar period last cycle.
              </Callout.Text>
            </Callout.Root>
          ) : null}

          {report.incomeTruncated || report.expensesTruncated ? (
            <Callout.Root color="amber">
              <Callout.Icon>
                <ExclamationTriangleIcon />
              </Callout.Icon>
              <Callout.Text>
                There are more {report.incomeTruncated ? "payments (or clients)" : ""}
                {report.incomeTruncated && report.expensesTruncated ? " and " : ""}
                {report.expensesTruncated ? "deductible expenses" : ""} in
                this period (or its comparison period) than this page
                totals — the figures below and the downloaded CSV may both
                be partial. Contact support if your totals look short.
              </Callout.Text>
            </Callout.Root>
          ) : null}

          {/* ---------------- Income ---------------- */}
          <Card size="3">
            <Flex justify="between" align="start" mb="3" wrap="wrap" gap="2">
              <Box>
                <Heading as="h2" size="4">
                  Income, by client
                </Heading>
                <Text as="div" size="2" color="gray">
                  Cash-basis: payments received {period.start} through{" "}
                  {period.end}.
                </Text>
              </Box>
              <Flex direction="column" align="end" gap="1">
                <Text weight="bold" className="tnum">
                  {formatCents(report.incomeComparison.currentCents)}
                </Text>
                <DeltaBadge comparison={report.incomeComparison} />
              </Flex>
            </Flex>

            {report.incomeByClient.length === 0 ? (
              <Text size="2" color="gray">
                No payments recorded as received this period.
              </Text>
            ) : (
              <Table.Root variant="ghost">
                <Table.Header>
                  <Table.Row>
                    <Table.ColumnHeaderCell>Client</Table.ColumnHeaderCell>
                    <Table.ColumnHeaderCell justify="end">Payments</Table.ColumnHeaderCell>
                    <Table.ColumnHeaderCell justify="end">Received</Table.ColumnHeaderCell>
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
            )}
          </Card>

          {/* ---------------- Expenses ---------------- */}
          <Card size="3">
            <Flex justify="between" align="start" mb="3" wrap="wrap" gap="2">
              <Box>
                <Heading as="h2" size="4">
                  Expenses
                </Heading>
                <Text as="div" size="2" color="gray">
                  Deductible receipts plus rebilled costs, incurred{" "}
                  {period.start} through {period.end}. Unassigned receipts
                  are shown separately below.
                </Text>
              </Box>
              <Flex direction="column" align="end" gap="1">
                <Text weight="bold" className="tnum">
                  {formatCents(report.expensesComparison.currentCents)}
                </Text>
                <DeltaBadge comparison={report.expensesComparison} invert />
              </Flex>
            </Flex>

            {report.expensesByCategory.length === 0 && report.rebilledCount === 0 ? (
              <Text size="2" color="gray">
                No expenses this period.
              </Text>
            ) : (
              <Table.Root variant="ghost">
                <Table.Header>
                  <Table.Row>
                    <Table.ColumnHeaderCell>Category</Table.ColumnHeaderCell>
                    <Table.ColumnHeaderCell justify="end">Receipts</Table.ColumnHeaderCell>
                    <Table.ColumnHeaderCell justify="end">Amount</Table.ColumnHeaderCell>
                  </Table.Row>
                </Table.Header>
                <Table.Body>
                  {report.expensesByCategory.map((c) => (
                    <Table.Row key={c.category}>
                      <Table.RowHeaderCell>{categoryLabels[c.category] ?? c.category}</Table.RowHeaderCell>
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
                  {report.rebilledCount > 0 ? (
                    <Table.Row>
                      <Table.RowHeaderCell>Rebilled costs (paired with the reimbursement in Income above)</Table.RowHeaderCell>
                      <Table.Cell justify="end">
                        <Text className="tnum">{report.rebilledCount}</Text>
                      </Table.Cell>
                      <Table.Cell justify="end">
                        <Text className="tnum" weight="medium">
                          {formatCents(report.rebilledCostCents)}
                        </Text>
                      </Table.Cell>
                    </Table.Row>
                  ) : null}
                </Table.Body>
              </Table.Root>
            )}

            {report.rebilledCount > 0 ? (
              <Callout.Root color="gray" mt="4">
                <Callout.Icon>
                  <InfoCircledIcon />
                </Callout.Icon>
                <Callout.Text>
                  {report.rebilledCount} rebilled receipt
                  {report.rebilledCount === 1 ? "" : "s"} totaling{" "}
                  <span className="tnum">{formatCents(report.rebilledCostCents)}</span>{" "}
                  this period ARE counted above, as their own line, inside
                  Expenses — this is money the pilot actually paid out of
                  pocket. It is not excluded: the matching reimbursement is
                  a client payment already counted in Income above, and
                  only subtracting the outflow here lets the two sides of
                  that pass-through net out to the true economic result.
                  See the{" "}
                  <RadixLink asChild>
                    <NextLink href="/reports/year-end">year-end report</NextLink>
                  </RadixLink>{" "}
                  for the full rebilled/invoiced reconciliation.
                  {report.rebilledTruncated
                    ? " (There are more rebilled receipts than counted here, too.)"
                    : ""}
                </Callout.Text>
              </Callout.Root>
            ) : null}
          </Card>

          {/* ---------------- Mileage, flagged ---------------- */}
          <Card size="3">
            <Flex justify="between" align="start" wrap="wrap" gap="2">
              <Box>
                <Heading as="h2" size="4">
                  Mileage
                </Heading>
                <Text as="div" size="2" color="gray">
                  Standard-mileage-rate drives logged {period.start} through{" "}
                  {period.end} — excluded from Expenses above. The standard
                  mileage rate and actual vehicle expenses (fuel, rental
                  car) are alternative deduction methods for the same
                  vehicle, never additive, and this report can&rsquo;t tell
                  which one applies to a given vehicle and year — folding
                  this in automatically risks a double-claimed deduction.
                  Review it in{" "}
                  <RadixLink asChild>
                    <NextLink href="/expenses/mileage">Mileage</NextLink>
                  </RadixLink>{" "}
                  before filing.
                </Text>
              </Box>
              {report.mileageCount > 0 ? (
                <Badge color="gray" size="2">
                  <span className="tnum">
                    {report.mileageCount} · {formatCents(report.mileageTotalCents)}
                  </span>
                </Badge>
              ) : null}
            </Flex>
            {report.mileageMilesWithoutRate > 0 ? (
              <Callout.Root color="amber" mt="3">
                <Callout.Icon>
                  <ExclamationTriangleIcon />
                </Callout.Icon>
                <Callout.Text>
                  {`${report.mileageMilesWithoutRate} miles are not in the figure above. There's no IRS standard rate on file for their tax year. Add it in Settings and this recomputes.`}
                </Callout.Text>
              </Callout.Root>
            ) : null}
            {report.mileageTruncated ? (
              <Callout.Root color="amber" mt="3">
                <Callout.Icon>
                  <ExclamationTriangleIcon />
                </Callout.Icon>
                <Callout.Text>
                  There are more logged drives this period than this page
                  totals.
                </Callout.Text>
              </Callout.Root>
            ) : null}
            {report.mileageCount === 0 ? (
              <Text size="2" color="gray">
                No mileage logged this period.
              </Text>
            ) : null}
          </Card>

          {/* ---------------- Net profit ---------------- */}
          <Card size="3">
            <Flex justify="between" align="center" wrap="wrap" gap="2">
              <Heading as="h2" size="4">
                Net profit
              </Heading>
              <Flex direction="column" align="end" gap="1">
                <Text size="6" weight="bold" className="tnum">
                  {formatCents(netProfitCents)}
                </Text>
                <DeltaBadge comparison={report.netProfitComparison} />
              </Flex>
            </Flex>
            <Text as="div" size="2" color="gray" mt="2">
              Income minus deductible expenses for {period.label}, compared
              against {period.priorLabel}.
            </Text>
          </Card>

          {/* ---------------- Unassigned receipts, flagged ---------------- */}
          <Card size="3">
            <Flex justify="between" align="start" wrap="wrap" gap="2">
              <Box>
                <Heading as="h2" size="4">
                  Unassigned receipts
                </Heading>
                <Text as="div" size="2" color="gray">
                  Neither billed to a client nor claimed as a deduction —
                  excluded from both Income and Expenses above. Resolve
                  them on{" "}
                  <RadixLink asChild>
                    <NextLink href="/expenses">Expenses</NextLink>
                  </RadixLink>
                  .
                </Text>
              </Box>
              {report.unassignedCount > 0 ? (
                <Badge color="amber" size="2">
                  <span className="tnum">
                    {report.unassignedCount} · {formatCents(report.unassignedTotalCents)}
                  </span>
                </Badge>
              ) : null}
            </Flex>
            {report.unassignedTruncated ? (
              <Callout.Root color="amber" mt="3">
                <Callout.Icon>
                  <ExclamationTriangleIcon />
                </Callout.Icon>
                <Callout.Text>
                  There are more unassigned receipts this period than this
                  page totals.
                </Callout.Text>
              </Callout.Root>
            ) : null}
            {report.unassignedCount === 0 ? (
              <Text size="2" color="gray">
                Nothing unassigned this period.
              </Text>
            ) : null}
          </Card>
        </Flex>
      )}
    </PageShell>
  );
}

import NextLink from "next/link";
import {
  Badge,
  Box,
  Button,
  Callout,
  Card,
  Flex,
  Heading,
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
import { loadSalesTaxReport, SALES_TAX_LIMIT } from "./queries";
import {
  correctionNote,
  formatBps,
  resolveSalesTaxPeriod,
  todayIso,
} from "./report-lib";

export const metadata = { title: "Sales tax" };

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
  const { account } = await requireAccount("/reports/sales-tax");
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
    <PageShell
      title="Sales tax"
      subtitle={`${formatDate(period.from)} – ${formatDate(period.to)} · tax charged on invoices, cash-basis`}
      action={
        report.error === null && !report.truncated ? (
          <Button asChild variant="outline" size="2">
            <a href={csvHref} download>
              Download CSV
            </a>
          </Button>
        ) : undefined
      }
    >
      {/* Period controls: two presets plus an explicit range. Links and a
          GET form, no client component — the server re-resolves
          ?from=/?to= on every request, so the URL is shareable and the
          back button works (same pattern as the client statement). */}
      <Flex gap="2" wrap="wrap" align="center" mb="4">
        <Button asChild size="2" variant={isThisYear ? "solid" : "soft"}>
          <NextLink href="/reports/sales-tax">This year</NextLink>
        </Button>
        <Button asChild size="2" variant={isLastYear ? "solid" : "soft"}>
          <NextLink href={`/reports/sales-tax?from=${lastYear.from}&to=${lastYear.to}`}>
            Last year
          </NextLink>
        </Button>
        <form method="get">
          <Flex gap="2" align="center" wrap="wrap">
            <TextField.Root
              type="date"
              name="from"
              defaultValue={period.from}
              aria-label="Report period start"
            />
            <Text size="1" color="gray">
              to
            </Text>
            <TextField.Root
              type="date"
              name="to"
              defaultValue={period.to}
              aria-label="Report period end"
            />
            <Button type="submit" size="1" variant="soft">
              Apply
            </Button>
          </Flex>
        </form>
      </Flex>

      {/* LOAD-BEARING, deliberately first — same placement and register as
          the other reports' disclaimers. States the basis in plain words
          and what this page is NOT: it reports figures for whoever
          prepares the pilot's filings; it does not know or say what is
          owed, or where. */}
      <Callout.Root color="blue" mb="4">
        <Callout.Icon>
          <InfoCircledIcon />
        </Callout.Icon>
        <Callout.Text>
          <Text as="div" weight="medium">
            What your invoices charged as sales tax, and what&rsquo;s been
            collected — figures for whoever prepares your filings.
          </Text>
          <Text as="div" size="2">
            Cash-basis, matching this product&rsquo;s other reports: an
            invoice&rsquo;s tax counts on the day it was paid in full, not
            the day it was issued. If a payment is corrected later, the
            period it was originally counted in stands unchanged, and the
            correction appears as a negative row in the period the
            correction was made. Tax charged on invoices still awaiting
            payment is shown separately below and is not in the totals.
            This page doesn&rsquo;t know your filing requirements and
            doesn&rsquo;t calculate what to remit.
          </Text>
        </Callout.Text>
      </Callout.Root>

      {report.error !== null ? (
        // A failed read renders a FAILURE, never an empty report — a tax
        // page showing $0.00 is a claim that no tax was collected, and
        // this screen has no basis for that claim right now. See
        // lib/supabase/rows.ts for the house reasoning.
        <Card size="3">
          <Callout.Root color="red">
            <Callout.Icon>
              <ExclamationTriangleIcon />
            </Callout.Icon>
            <Callout.Text>
              {friendlyDbError({ message: report.error }, "sales-tax.load")}{" "}
              Nothing is shown rather than a partial figure — a short total
              here would misstate what was collected.
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
                This period has more than {SALES_TAX_LIMIT} rows behind one
                of its figures, so the totals below may be partial. Narrow
                the date range. The CSV export refuses a partial file
                outright.
              </Callout.Text>
            </Callout.Root>
          ) : null}

          {/* ---------------- Collected ---------------- */}
          <Card size="3">
            <Flex justify="between" align="start" mb="3" wrap="wrap" gap="2">
              <Box>
                <Heading as="h2" size="4">
                  Tax collected
                </Heading>
                <Text as="div" size="2" color="gray">
                  Invoices paid in full {formatDate(period.from)} through{" "}
                  {formatDate(period.to)} that charged tax, and corrections
                  made this period to previously counted payments.
                </Text>
              </Box>
              <Text weight="bold" size="6" className="tnum">
                {formatCents(report.taxTotalCents)}
              </Text>
            </Flex>

            {report.rows.length === 0 ? (
              <Text size="2" color="gray">
                No tax was collected on invoices paid in full this period.
              </Text>
            ) : (
              <Table.Root variant="ghost">
                <Table.Header>
                  <Table.Row>
                    <Table.ColumnHeaderCell>Invoice</Table.ColumnHeaderCell>
                    <Table.ColumnHeaderCell>Client</Table.ColumnHeaderCell>
                    <Table.ColumnHeaderCell>Issued</Table.ColumnHeaderCell>
                    {/* "Counted on", not "Paid in full": for a collected
                        row it IS the day the invoice was paid in full; for
                        a correction row it's the day the correction was
                        made — the header must be true of both. */}
                    <Table.ColumnHeaderCell>Counted on</Table.ColumnHeaderCell>
                    <Table.ColumnHeaderCell justify="end">
                      Taxable subtotal
                    </Table.ColumnHeaderCell>
                    <Table.ColumnHeaderCell justify="end">Rate</Table.ColumnHeaderCell>
                    <Table.ColumnHeaderCell justify="end">Tax</Table.ColumnHeaderCell>
                  </Table.Row>
                </Table.Header>
                <Table.Body>
                  {report.rows.map((row) => (
                    // One invoice can legitimately appear more than once —
                    // settled, corrected, settled again — so the key is
                    // the (invoice, event kind, date) triple, which the
                    // assembly guarantees unique.
                    <Table.Row key={`${row.invoiceId}-${row.kind}-${row.countedOn}`}>
                      <Table.RowHeaderCell>
                        {row.invoiceNumber}
                        {row.kind === "correction" && row.previouslyCountedOn ? (
                          <Text as="div" size="1" color="gray">
                            {correctionNote(formatDate(row.previouslyCountedOn))}
                          </Text>
                        ) : null}
                      </Table.RowHeaderCell>
                      <Table.Cell>{row.clientName}</Table.Cell>
                      <Table.Cell>{formatDate(row.issuedOn)}</Table.Cell>
                      <Table.Cell>{formatDate(row.countedOn)}</Table.Cell>
                      <Table.Cell justify="end">
                        <Text className="tnum">
                          {formatCents(row.taxableSubtotalCents)}
                        </Text>
                      </Table.Cell>
                      <Table.Cell justify="end">
                        <Text className="tnum">{formatBps(row.taxRateBps)}</Text>
                      </Table.Cell>
                      <Table.Cell justify="end">
                        <Text className="tnum" weight="medium">
                          {formatCents(row.taxCents)}
                        </Text>
                      </Table.Cell>
                    </Table.Row>
                  ))}
                  <Table.Row>
                    <Table.RowHeaderCell>
                      <Text weight="bold">Total</Text>
                    </Table.RowHeaderCell>
                    <Table.Cell />
                    <Table.Cell />
                    <Table.Cell />
                    <Table.Cell justify="end">
                      <Text className="tnum" weight="bold">
                        {formatCents(report.taxableTotalCents)}
                      </Text>
                    </Table.Cell>
                    <Table.Cell />
                    <Table.Cell justify="end">
                      <Text className="tnum" weight="bold">
                        {formatCents(report.taxTotalCents)}
                      </Text>
                    </Table.Cell>
                  </Table.Row>
                </Table.Body>
              </Table.Root>
            )}

            {report.untaxedPaidCount > 0 ? (
              <Text as="div" size="2" color="gray" mt="3">
                {report.untaxedPaidCount} other invoice
                {report.untaxedPaidCount === 1 ? "" : "s"} paid in full this
                period charged no tax and {report.untaxedPaidCount === 1 ? "isn't" : "aren't"}{" "}
                listed.
              </Text>
            ) : null}
          </Card>

          {/* ---------------- Charged, not yet collected ---------------- */}
          <Card size="3">
            <Flex justify="between" align="start" wrap="wrap" gap="2">
              <Box>
                <Heading as="h2" size="4">
                  Charged, not yet collected
                </Heading>
                <Text as="div" size="2" color="gray">
                  Tax on invoices issued {formatDate(period.from)} through{" "}
                  {formatDate(period.to)} that are still awaiting full
                  payment — not included in the totals above. Each will
                  count on the day it&rsquo;s paid in full.
                </Text>
              </Box>
              {report.awaitingCount > 0 ? (
                <Badge color="amber" size="2">
                  <span className="tnum">
                    {report.awaitingCount} · {formatCents(report.awaitingTaxCents)}
                  </span>
                </Badge>
              ) : null}
            </Flex>
            {report.awaitingCount === 0 ? (
              <Text size="2" color="gray">
                No tax outstanding on invoices issued this period.
              </Text>
            ) : null}
          </Card>
        </Flex>
      )}
    </PageShell>
  );
}

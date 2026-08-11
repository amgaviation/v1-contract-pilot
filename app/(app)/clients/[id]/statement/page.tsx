import NextLink from "next/link";
import { notFound } from "next/navigation";
import {
  Badge,
  Box,
  Button,
  Callout,
  Card,
  Flex,
  Grid,
  Link as RadixLink,
  Table,
  Text,
  TextField,
} from "@/components/ui";
import { ExclamationTriangleIcon } from "@radix-ui/react-icons";

import { createClient } from "@/lib/supabase/server";
import { requireAccount } from "@/lib/supabase/account";
import { formatCents, formatDate } from "@/lib/format";
import { friendlyDbError } from "@/lib/db-errors";
import PageShell from "../../../page-shell";
import { buildClientStatement, STATEMENT_LIST_LIMIT } from "./queries";
import {
  addressLines,
  resolveStatementPeriod,
  todayIso,
  STATEMENT_STATUS_LABEL,
  type StatementRow,
} from "./statement-lib";

export const metadata = { title: "Statement" };

/**
 * The statement screen: for one client, every invoice issued in a period,
 * what has been paid against each, and what is outstanding — the "here's
 * where we stand" document a contract pilot sends an aircraft owner or a
 * flight department whose AP pays in batches. The period defaults to the
 * current calendar year and is selectable via ?from=/?to=, validated
 * server-side (see resolveStatementPeriod).
 *
 * Every figure comes through buildClientStatement, which reads
 * invoice_totals and invoices_overdue — the same sources the invoice
 * screens use — and refuses on any failed read. The three states this
 * screen can render are deliberately distinct:
 *   - a red callout      → a read FAILED; nothing here can be trusted
 *   - "No invoices…"     → the reads succeeded and the period is empty
 *   - the statement      → the reads succeeded and there are rows
 */

const STATUS_COLOR: Record<StatementRow["status"], "blue" | "amber" | "green"> = {
  sent: "blue",
  partial: "amber",
  paid: "green",
};

export default async function ClientStatementPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const { id } = await params;
  const { account } = await requireAccount(`/clients/${id}/statement`);
  const sp = await searchParams;

  const today = todayIso();
  const period = resolveStatementPeriod(sp, today);
  const year = Number(today.slice(0, 4));
  const thisYear = { from: `${year}-01-01`, to: `${year}-12-31` };
  const lastYear = { from: `${year - 1}-01-01`, to: `${year - 1}-12-31` };
  const isThisYear = period.from === thisYear.from && period.to === thisYear.to;
  const isLastYear = period.from === lastYear.from && period.to === lastYear.to;

  const supabase = await createClient();
  const result = await buildClientStatement(supabase, account.id, id, period);

  // Another tenant's client id and a nonexistent one are indistinguishable
  // here, and that is the point — same note as clients/[id]/page.tsx.
  if (!result.ok && result.reason === "not_found") notFound();

  const statement = result.ok ? result.statement : null;
  const printHref = `/clients/${id}/statement/print?from=${period.from}&to=${period.to}`;

  return (
    <PageShell
      title="Statement"
      subtitle={
        statement
          ? `${statement.client.name} · invoices issued ${formatDate(period.from)} – ${formatDate(period.to)}`
          : "Couldn't load this statement — see below."
      }
      action={
        <Flex gap="2" wrap="wrap">
          <Button asChild variant="soft">
            <NextLink href={`/clients/${id}`}>Back to client</NextLink>
          </Button>
          {statement && !statement.truncated ? (
            <Button asChild>
              {/* A standalone print-quality document (see print/route.ts) —
                  opened in its own tab so the pilot can print or save it as
                  a PDF from the browser without losing this screen. */}
              <a href={printHref} target="_blank" rel="noopener">
                Print / save as PDF
              </a>
            </Button>
          ) : null}
        </Flex>
      }
    >
      {/* Period controls: two presets plus an explicit range. Links and a
          GET form, no client component — the server re-resolves ?from=/?to=
          on every request, so the URL is shareable and the back button
          works. */}
      <Flex gap="2" wrap="wrap" align="center">
        <Button asChild size="2" variant={isThisYear ? "solid" : "soft"}>
          <NextLink href={`/clients/${id}/statement`}>This year</NextLink>
        </Button>
        <Button asChild size="2" variant={isLastYear ? "solid" : "soft"}>
          <NextLink
            href={`/clients/${id}/statement?from=${lastYear.from}&to=${lastYear.to}`}
          >
            Last year
          </NextLink>
        </Button>
        <form method="get">
          <Flex gap="2" align="center" wrap="wrap">
            <TextField.Root
              type="date"
              name="from"
              defaultValue={period.from}
              aria-label="Statement period start"
            />
            <Text size="1" color="gray">
              to
            </Text>
            <TextField.Root
              type="date"
              name="to"
              defaultValue={period.to}
              aria-label="Statement period end"
            />
            <Button type="submit" size="1" variant="soft">
              Apply
            </Button>
          </Flex>
        </form>
      </Flex>

      {!result.ok ? (
        // A failed read renders a FAILURE, never an empty statement — a
        // client statement showing nothing is a claim that nothing is owed,
        // and this screen has no basis for that claim right now. See
        // lib/supabase/rows.ts for the house reasoning.
        <Card size="3">
          <Callout.Root color="red">
            <Callout.Icon>
              <ExclamationTriangleIcon />
            </Callout.Icon>
            <Callout.Text>
              {friendlyDbError(result.error, "client-statement.load")} This
              statement couldn&rsquo;t be assembled, so nothing is shown —
              a partial statement would misstate what&rsquo;s outstanding.
            </Callout.Text>
          </Callout.Root>
        </Card>
      ) : statement ? (
        <>
          {statement.truncated ? (
            <Callout.Root color="amber">
              <Callout.Icon>
                <ExclamationTriangleIcon />
              </Callout.Icon>
              <Callout.Text>
                This period has more than {STATEMENT_LIST_LIMIT} invoices, so
                the figures below cover only the first{" "}
                {STATEMENT_LIST_LIMIT} and the totals are partial. Narrow the
                date range. The print view refuses a partial statement
                outright.
              </Callout.Text>
            </Callout.Root>
          ) : null}

          <Card size="3">
            {/* The two parties — the same fields the invoice PDF renders
                (accounts.legal_name + address; clients.name/contact/address),
                so the statement and the invoices it summarizes name the
                same people the same way. */}
            <Grid columns={{ initial: "1", sm: "2" }} gap="4" mb="4">
              <Box>
                <Text as="div" size="1" color="gray" weight="medium">
                  From
                </Text>
                <Text as="div" size="2" weight="bold">
                  {account.legal_name}
                </Text>
                {addressLines(account).map((line, i) => (
                  <Text as="div" size="2" color="gray" key={i}>
                    {line}
                  </Text>
                ))}
              </Box>
              <Box>
                <Text as="div" size="1" color="gray" weight="medium">
                  Prepared for
                </Text>
                <Text as="div" size="2" weight="bold">
                  {statement.client.name}
                  {statement.clientArchived ? " (archived)" : ""}
                </Text>
                {statement.client.contact_name ? (
                  <Text as="div" size="2" color="gray">
                    {statement.client.contact_name}
                  </Text>
                ) : null}
                {addressLines(statement.client).map((line, i) => (
                  <Text as="div" size="2" color="gray" key={i}>
                    {line}
                  </Text>
                ))}
              </Box>
            </Grid>

            {statement.rows.length === 0 ? (
              // The VALID empty statement — reached only after every read
              // succeeded, so this sentence is a verified fact, not a
              // failed query wearing good news.
              <Flex direction="column" align="center" gap="2" py="6">
                <Text size="4" weight="bold">
                  No invoices issued this period
                </Text>
                <Text size="2" color="gray" align="center">
                  Nothing was issued to {statement.client.name} between{" "}
                  {formatDate(period.from)} and {formatDate(period.to)}.
                  Drafts and voided invoices are never part of a statement —
                  if you expected activity here, widen the date range.
                </Text>
              </Flex>
            ) : (
              <>
                <Grid columns={{ initial: "1", sm: "3" }} gap="3" mb="4">
                  <Flex direction="column" gap="1">
                    <Text size="1" color="gray">
                      Total invoiced
                    </Text>
                    <Text size="5" weight="bold" className="tnum">
                      {formatCents(statement.totals.invoicedCents)}
                    </Text>
                  </Flex>
                  <Flex direction="column" gap="1">
                    <Text size="1" color="gray">
                      Paid to date
                    </Text>
                    <Text size="5" weight="bold" className="tnum">
                      {formatCents(statement.totals.paidCents)}
                    </Text>
                  </Flex>
                  <Flex direction="column" gap="1">
                    <Text size="1" color="gray">
                      Balance outstanding
                    </Text>
                    <Text
                      size="5"
                      weight="bold"
                      className="tnum"
                      color={statement.totals.outstandingCents > 0 ? "amber" : "gray"}
                    >
                      {formatCents(statement.totals.outstandingCents)}
                    </Text>
                  </Flex>
                </Grid>

                <Table.Root variant="ghost">
                  <Table.Header>
                    <Table.Row>
                      <Table.ColumnHeaderCell>Number</Table.ColumnHeaderCell>
                      <Table.ColumnHeaderCell>Issued</Table.ColumnHeaderCell>
                      <Table.ColumnHeaderCell>Due</Table.ColumnHeaderCell>
                      <Table.ColumnHeaderCell justify="end">
                        Late
                      </Table.ColumnHeaderCell>
                      <Table.ColumnHeaderCell>Status</Table.ColumnHeaderCell>
                      <Table.ColumnHeaderCell justify="end">
                        Total
                      </Table.ColumnHeaderCell>
                      <Table.ColumnHeaderCell justify="end">
                        Paid to date
                      </Table.ColumnHeaderCell>
                      <Table.ColumnHeaderCell justify="end">
                        Balance due
                      </Table.ColumnHeaderCell>
                    </Table.Row>
                  </Table.Header>
                  <Table.Body>
                    {statement.rows.map((row) => {
                      const overdue = row.daysOverdue !== null;
                      return (
                        <Table.Row key={row.id}>
                          <Table.RowHeaderCell>
                            <RadixLink asChild weight="medium">
                              <NextLink href={`/invoices/${row.id}`}>
                                {row.invoiceNumber ?? "Invoice"}
                              </NextLink>
                            </RadixLink>
                          </Table.RowHeaderCell>
                          <Table.Cell>
                            <Text color="gray">{formatDate(row.issuedOn)}</Text>
                          </Table.Cell>
                          <Table.Cell>
                            <Text
                              color={overdue ? "red" : "gray"}
                              weight={overdue ? "medium" : "regular"}
                            >
                              {formatDate(row.dueOn)}
                            </Text>
                          </Table.Cell>
                          <Table.Cell justify="end">
                            {/* Days past due from invoices_overdue — the
                                same figure the invoices screen quotes, so
                                a pilot chasing "that one's 74 days out"
                                reads the identical number here. */}
                            {overdue ? (
                              <Text color="red" weight="medium" className="tnum">
                                {`${row.daysOverdue}d`}
                              </Text>
                            ) : (
                              <Text color="gray">—</Text>
                            )}
                          </Table.Cell>
                          <Table.Cell>
                            {overdue ? (
                              <Badge color="red">Overdue</Badge>
                            ) : (
                              <Badge color={STATUS_COLOR[row.status]}>
                                {STATEMENT_STATUS_LABEL[row.status]}
                              </Badge>
                            )}
                          </Table.Cell>
                          <Table.Cell justify="end">
                            <Text weight="medium" className="tnum">
                              {formatCents(row.totalCents)}
                            </Text>
                          </Table.Cell>
                          <Table.Cell justify="end">
                            <Text color="gray" className="tnum">
                              {formatCents(row.paidCents)}
                            </Text>
                          </Table.Cell>
                          <Table.Cell justify="end">
                            <Text
                              weight="medium"
                              color={row.balanceCents > 0 ? "amber" : "gray"}
                              className="tnum"
                            >
                              {formatCents(row.balanceCents)}
                            </Text>
                          </Table.Cell>
                        </Table.Row>
                      );
                    })}
                  </Table.Body>
                </Table.Root>
              </>
            )}

            <Box mt="4">
              <Text as="p" size="1" color="gray">
                Covers invoices issued {formatDate(period.from)} –{" "}
                {formatDate(period.to)} (sent, partially paid, or paid).
                Drafts and voided invoices are excluded. &ldquo;Paid to
                date&rdquo; reflects every payment recorded through{" "}
                {formatDate(today)}, including any received after the period
                ended.
              </Text>
            </Box>
          </Card>
        </>
      ) : null}
    </PageShell>
  );
}

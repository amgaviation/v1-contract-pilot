import { Button, Callout, Card, Flex, Grid, Table, Text, TextField } from "@/components/ui";
import { ExclamationTriangleIcon, InfoCircledIcon } from "@radix-ui/react-icons";
import { createClient } from "@/lib/supabase/server";
import { requireAccount } from "@/lib/supabase/account";
import { formatCents, formatDateRange } from "@/lib/format";
import PageShell from "../../page-shell";
import {
  assembleCashFlow,
  presentedBalanceCents,
  shiftIsoDate,
  type CashFlowLine,
  type CashFlowRow,
  type LedgerBalanceRow,
} from "../../accounting/ledger-lib";
import { resolveSalesTaxPeriod, todayIso } from "../sales-tax/report-lib";

export const metadata = { title: "Cash flow" };

function bankBalanceCents(rows: LedgerBalanceRow[]): number | null {
  const bank = rows.find((r) => r.system_key === "bank");
  return bank ? presentedBalanceCents("asset", bank.balance_cents) : null;
}

function FlowTable({ title, lines, totalCents }: { title: string; lines: CashFlowLine[]; totalCents: number }) {
  return (
    <Card size="3">
      <Text as="div" size="3" weight="bold" mb="2">
        {title}
      </Text>
      {lines.length === 0 ? (
        <Text size="2" color="gray">
          None in this period.
        </Text>
      ) : (
        <Table.Root variant="ghost">
          <Table.Body>
            {lines.map((line) => (
              <Table.Row key={line.chartAccountId}>
                <Table.RowHeaderCell>
                  <Text size="2">{line.name}</Text>
                </Table.RowHeaderCell>
                <Table.Cell>
                  <Text size="1" color="gray">
                    {line.entryCount} {line.entryCount === 1 ? "entry" : "entries"}
                  </Text>
                </Table.Cell>
                <Table.Cell justify="end">
                  <Text size="2" className="tnum">
                    {formatCents(line.cashCents)}
                  </Text>
                </Table.Cell>
              </Table.Row>
            ))}
            <Table.Row>
              <Table.RowHeaderCell>
                <Text size="2" weight="bold">
                  Total
                </Text>
              </Table.RowHeaderCell>
              <Table.Cell />
              <Table.Cell justify="end">
                <Text size="2" weight="bold" className="tnum">
                  {formatCents(totalCents)}
                </Text>
              </Table.Cell>
            </Table.Row>
          </Table.Body>
        </Table.Root>
      )}
    </Card>
  );
}

/**
 * Cash flow for a period, derived from the ledger's Cash & bank account:
 * every entry that moved cash, attributed to its counterpart accounts.
 * CASH BASIS BY CONSTRUCTION — only actual cash movements appear (client
 * payments in, expenses out, owner draws/contributions), and the page says
 * so. Opening + net must equal closing, both read from the same ledger;
 * a mismatch refuses the render.
 */
export default async function CashFlowPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const { account } = await requireAccount("/reports/cash-flow");
  const sp = await searchParams;
  const period = resolveSalesTaxPeriod(sp, todayIso());

  const supabase = await createClient();
  const { error: syncError } = await supabase.rpc("ledger_sync", {
    target_account_id: account.id,
  } as never);

  const [flowRes, openingRes, closingRes] = await Promise.all([
    supabase.rpc("ledger_cash_flow", {
      target_account_id: account.id,
      period_start: period.from,
      period_end: period.to,
    } as never),
    supabase.rpc("ledger_balances", {
      target_account_id: account.id,
      through_date: shiftIsoDate(period.from, -1),
    } as never),
    supabase.rpc("ledger_balances", {
      target_account_id: account.id,
      through_date: period.to,
    } as never),
  ]);

  const error =
    syncError?.message ??
    flowRes.error?.message ??
    openingRes.error?.message ??
    closingRes.error?.message ??
    null;

  const opening = error ? null : bankBalanceCents((openingRes.data ?? []) as LedgerBalanceRow[]);
  const closing = error ? null : bankBalanceCents((closingRes.data ?? []) as LedgerBalanceRow[]);
  const flow =
    error || opening === null || closing === null
      ? null
      : assembleCashFlow((flowRes.data ?? []) as CashFlowRow[], opening, closing);

  return (
    <PageShell
      title="Cash flow"
      subtitle={`${formatDateRange(period.from, period.to)} · cash basis, from your ledger's Cash & bank account`}
      action={
        <Button asChild variant="outline" size="2">
          <a href={`/reports/cash-flow/export?from=${period.from}&to=${period.to}`} download>
            Download CSV
          </a>
        </Button>
      }
    >
      <Card size="2">
        <form method="get" action="/reports/cash-flow">
          <Flex gap="3" align="end" wrap="wrap">
            <Flex direction="column" gap="1">
              <Text as="label" size="2" weight="medium" htmlFor="cf-from">
                From
              </Text>
              <TextField.Root id="cf-from" type="date" name="from" defaultValue={period.from} />
            </Flex>
            <Flex direction="column" gap="1">
              <Text as="label" size="2" weight="medium" htmlFor="cf-to">
                To
              </Text>
              <TextField.Root id="cf-to" type="date" name="to" defaultValue={period.to} />
            </Flex>
            <Button type="submit" variant="soft">
              View period
            </Button>
          </Flex>
        </form>
      </Card>

      {!flow ? (
        <Callout.Root color="red">
          <Callout.Icon>
            <ExclamationTriangleIcon />
          </Callout.Icon>
          <Callout.Text>
            Couldn&rsquo;t load your cash flow. Nothing is shown rather than
            figures that aren&rsquo;t true.
          </Callout.Text>
        </Callout.Root>
      ) : !flow.ties ? (
        <Callout.Root color="red">
          <Callout.Icon>
            <ExclamationTriangleIcon />
          </Callout.Icon>
          <Callout.Text>
            Opening balance plus net movement doesn&rsquo;t equal the closing
            balance, which should be impossible — refusing to present this
            statement as if it tied. Reload, and contact support if it
            persists.
          </Callout.Text>
        </Callout.Root>
      ) : (
        <>
          <Grid columns={{ initial: "1", sm: "4" }} gap="3">
            <Card size="2">
              <Text as="div" size="1" color="gray">
                Opening cash
              </Text>
              <Text as="div" size="4" weight="bold" className="tnum">
                {formatCents(flow.openingCents)}
              </Text>
            </Card>
            <Card size="2">
              <Text as="div" size="1" color="gray">
                Cash in
              </Text>
              <Text as="div" size="4" weight="bold" className="tnum" color="green">
                {formatCents(flow.inflowTotalCents)}
              </Text>
            </Card>
            <Card size="2">
              <Text as="div" size="1" color="gray">
                Cash out
              </Text>
              <Text as="div" size="4" weight="bold" className="tnum" color="red">
                {formatCents(flow.outflowTotalCents)}
              </Text>
            </Card>
            <Card size="2">
              <Text as="div" size="1" color="gray">
                Closing cash
              </Text>
              <Text as="div" size="4" weight="bold" className="tnum">
                {formatCents(flow.closingCents)}
              </Text>
              <Text as="div" size="1" color="gray" className="tnum">
                net {formatCents(flow.netCents)}
              </Text>
            </Card>
          </Grid>

          <FlowTable title="Cash in" lines={flow.inflows} totalCents={flow.inflowTotalCents} />
          <FlowTable title="Cash out" lines={flow.outflows} totalCents={flow.outflowTotalCents} />

          <Callout.Root color="blue">
            <Callout.Icon>
              <InfoCircledIcon />
            </Callout.Icon>
            <Callout.Text>
              <Text size="2">
                Cash basis: only money that actually moved. Client payments
                appear against Accounts receivable (the invoice&rsquo;s income was
                recognized at issue on the balance sheet side); mileage never
                appears here because the standard-rate deduction is not a cash
                outflow.
              </Text>
            </Callout.Text>
          </Callout.Root>
        </>
      )}
    </PageShell>
  );
}

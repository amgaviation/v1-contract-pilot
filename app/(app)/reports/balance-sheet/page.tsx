import { Button, Callout, Card, Flex, Table, Text, TextField } from "@/components/ui";
import { ExclamationTriangleIcon, InfoCircledIcon } from "@radix-ui/react-icons";
import { createClient } from "@/lib/supabase/server";
import { requireEntitlement } from "@/lib/supabase/entitlements";
import { formatCents, formatDate } from "@/lib/format";
import PageShell from "../../page-shell";
import {
  assembleBalanceSheet,
  type BalanceSheetSection,
  type LedgerBalanceRow,
} from "../../accounting/ledger-lib";
import { isValidIsoDate, todayIso } from "../sales-tax/report-lib";

export const metadata = { title: "Balance sheet" };

function SectionTable({ section }: { section: BalanceSheetSection }) {
  return (
    <Card size="3">
      <Text as="div" size="3" weight="bold" mb="2">
        {section.label}
      </Text>
      <Table.Root variant="ghost">
        <Table.Body>
          {section.lines.map((line) => (
            <Table.Row key={line.chartAccountId}>
              <Table.RowHeaderCell>
                <Text size="2">
                  {line.name}
                  {line.archived ? " (archived)" : ""}
                </Text>
              </Table.RowHeaderCell>
              <Table.Cell justify="end">
                <Text size="2" className="tnum">
                  {formatCents(line.balanceCents)}
                </Text>
              </Table.Cell>
            </Table.Row>
          ))}
          <Table.Row>
            <Table.RowHeaderCell>
              <Text size="2" weight="bold">
                Total {section.label.toLowerCase()}
              </Text>
            </Table.RowHeaderCell>
            <Table.Cell justify="end">
              <Text size="2" weight="bold" className="tnum">
                {formatCents(section.totalCents)}
              </Text>
            </Table.Cell>
          </Table.Row>
        </Table.Body>
      </Table.Root>
    </Card>
  );
}

/**
 * Balance sheet as of a date, from pilot.ledger_balances — an aggregate
 * read (one row per chart account), so the Data API's 1000-row cap cannot
 * shortchange a balance. The accounting identity assets = liabilities +
 * equity is ASSERTED in-page: if it doesn't hold, the page refuses to
 * present figures rather than render a sheet that quietly doesn't balance.
 */
export default async function BalanceSheetPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  const { account } = await requireEntitlement("accounting", "/reports/balance-sheet");
  const sp = await searchParams;
  const asOf = sp.date && isValidIsoDate(sp.date) ? sp.date : todayIso();

  const supabase = await createClient();
  const { error: syncError } = await supabase.rpc("ledger_sync", {
    target_account_id: account.id,
  } as never);
  const { data, error: balanceError } = await supabase.rpc("ledger_balances", {
    target_account_id: account.id,
    through_date: asOf,
  } as never);

  const error = syncError?.message ?? balanceError?.message ?? null;
  const sheet = error ? null : assembleBalanceSheet((data ?? []) as LedgerBalanceRow[]);

  return (
    <PageShell
      title="Balance sheet"
      subtitle={`As of ${formatDate(asOf)} · derived from your ledger (accrual: receivables count when invoiced)`}
      action={
        <Button asChild variant="outline" size="2">
          <a href={`/reports/balance-sheet/export?date=${asOf}`} download>
            Download CSV
          </a>
        </Button>
      }
    >
      <Card size="2">
        <form method="get" action="/reports/balance-sheet">
          <Flex gap="3" align="end" wrap="wrap">
            <Flex direction="column" gap="1">
              <Text as="label" size="2" weight="medium" htmlFor="bs-date">
                As of
              </Text>
              <TextField.Root id="bs-date" type="date" name="date" defaultValue={asOf} />
            </Flex>
            <Button type="submit" variant="soft">
              View
            </Button>
          </Flex>
        </form>
      </Card>

      {error || !sheet ? (
        <Callout.Root color="red">
          <Callout.Icon>
            <ExclamationTriangleIcon />
          </Callout.Icon>
          <Callout.Text>
            Couldn&rsquo;t load your balance sheet. Nothing is shown rather than
            figures that aren&rsquo;t true.
          </Callout.Text>
        </Callout.Root>
      ) : !sheet.balances ? (
        <Callout.Root color="red">
          <Callout.Icon>
            <ExclamationTriangleIcon />
          </Callout.Icon>
          <Callout.Text>
            This sheet does not balance (assets{" "}
            {formatCents(sheet.totalAssetsCents)} vs liabilities + equity{" "}
            {formatCents(sheet.totalLiabilitiesAndEquityCents)}), which should be
            impossible. The ledger enforces debits = credits. This report
            refuses to present it as if it did. Contact support.
          </Callout.Text>
        </Callout.Root>
      ) : (
        <>
          <SectionTable section={sheet.assets} />
          <SectionTable section={sheet.liabilities} />
          <Card size="3">
            <Text as="div" size="3" weight="bold" mb="2">
              Equity
            </Text>
            <Table.Root variant="ghost">
              <Table.Body>
                {sheet.equity.lines.map((line) => (
                  <Table.Row key={line.chartAccountId}>
                    <Table.RowHeaderCell>
                      <Text size="2">
                        {line.name}
                        {line.archived ? " (archived)" : ""}
                      </Text>
                    </Table.RowHeaderCell>
                    <Table.Cell justify="end">
                      <Text size="2" className="tnum">
                        {formatCents(line.balanceCents)}
                      </Text>
                    </Table.Cell>
                  </Table.Row>
                ))}
                <Table.Row>
                  <Table.RowHeaderCell>
                    <Text size="2">Net income to date</Text>
                  </Table.RowHeaderCell>
                  <Table.Cell justify="end">
                    <Text size="2" className="tnum">
                      {formatCents(sheet.netIncomeToDateCents)}
                    </Text>
                  </Table.Cell>
                </Table.Row>
                <Table.Row>
                  <Table.RowHeaderCell>
                    <Text size="2" weight="bold">
                      Total equity
                    </Text>
                  </Table.RowHeaderCell>
                  <Table.Cell justify="end">
                    <Text size="2" weight="bold" className="tnum">
                      {formatCents(sheet.equity.totalCents + sheet.netIncomeToDateCents)}
                    </Text>
                  </Table.Cell>
                </Table.Row>
              </Table.Body>
            </Table.Root>
          </Card>

          <Card size="3">
            <Flex justify="between" wrap="wrap" gap="3">
              <Text size="3" weight="bold">
                Assets {formatCents(sheet.totalAssetsCents)} = Liabilities + equity{" "}
                {formatCents(sheet.totalLiabilitiesAndEquityCents)}
              </Text>
              <Text size="2" color="green" weight="medium">
                Balances ✓
              </Text>
            </Flex>
          </Card>

          <Callout.Root color="blue">
            <Callout.Icon>
              <InfoCircledIcon />
            </Callout.Icon>
            <Callout.Text>
              <Text size="2">
                Accounts receivable counts invoices from the day they were
                issued (accrual). The P&amp;L and tax reports count income
                when payments arrive (cash). Both derive from the same
                records, on different bases, and each screen says which it
                uses.
              </Text>
            </Callout.Text>
          </Callout.Root>
        </>
      )}
    </PageShell>
  );
}

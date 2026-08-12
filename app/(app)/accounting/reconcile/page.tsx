import NextLink from "next/link";
import {
  Button,
  Callout,
  Card,
  Flex,
  Grid,
  Link as RadixLink,
  Select,
  Text,
  TextField,
} from "@/components/ui";
import { ExclamationTriangleIcon, InfoCircledIcon } from "@radix-ui/react-icons";
import { createClient } from "@/lib/supabase/server";
import { requireAccount } from "@/lib/supabase/account";
import { rowsOf } from "@/lib/supabase/rows";
import { formatCents } from "@/lib/format";
import PageShell from "../../page-shell";
import { reconciliationTotals } from "../ledger-lib";
import ReconcileBoard, {
  type LedgerLineView,
  type StatementLineView,
} from "./reconcile-board";
import { todayIso } from "../../reports/sales-tax/report-lib";

export const metadata = { title: "Reconcile" };

const LINES_LIMIT = 1000;

type BankAccountRow = { id: string; label: string; last4: string | null; kind: string };
type TxnRow = { id: string; posted_on: string; description: string; amount_cents: number };
type MatchRow = { id: string; bank_transaction_id: string; journal_line_id: string };
type BankLineRow = {
  journal_line_id: string;
  entry_id: string;
  entry_date: string;
  memo: string;
  source_type: string;
  signed_cents: number;
};

function monthBoundsOf(month: string): { start: string; end: string } {
  const parts = month.split("-");
  const y = Number(parts[0]);
  const m = Number(parts[1]);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return {
    start: `${month}-01`,
    end: `${month}-${lastDay < 10 ? `0${lastDay}` : lastDay}`,
  };
}

/**
 * Bank reconciliation: pick a statement source and a month; match the
 * statement's lines against the ledger's Cash & bank lines until the
 * difference reads zero. The difference figure is statement total minus
 * ledger total for the period — matching pairs (equal amounts by
 * construction) never moves it; RECORDING the missing side does, which is
 * exactly what "reconciled" means.
 */
export default async function ReconcilePage({
  searchParams,
}: {
  searchParams: Promise<{ bank?: string; month?: string }>;
}) {
  const { account } = await requireAccount("/accounting/reconcile");
  const sp = await searchParams;
  const supabase = await createClient();

  const { error: syncError } = await supabase.rpc("ledger_sync", {
    target_account_id: account.id,
  } as never);

  const bankAccountsResult = rowsOf<BankAccountRow>(
    (await supabase
      .from("bank_accounts")
      .select("id, label, last4, kind")
      .eq("account_id", account.id)
      .is("archived_at", null)
      .order("label", { ascending: true })
      .limit(100)) as never
  );

  if (syncError || !bankAccountsResult.ok) {
    return (
      <PageShell title="Reconcile">
        <Callout.Root color="red">
          <Callout.Icon>
            <ExclamationTriangleIcon />
          </Callout.Icon>
          <Callout.Text>
            Couldn&rsquo;t load your reconciliation data. Nothing is shown rather
            than a screen that pretends there&rsquo;s nothing to reconcile.
          </Callout.Text>
        </Callout.Root>
      </PageShell>
    );
  }

  const bankAccounts = bankAccountsResult.rows;
  const month =
    sp.month && /^\d{4}-\d{2}$/.test(sp.month) ? sp.month : todayIso().slice(0, 7);
  const bankId =
    sp.bank && bankAccounts.some((b) => b.id === sp.bank)
      ? sp.bank
      : bankAccounts[0]?.id ?? null;

  if (!bankId) {
    return (
      <PageShell
        title="Reconcile"
        subtitle="Match imported statement lines against your ledger's Cash & bank account."
      >
        <Card size="3">
          <Flex direction="column" align="center" gap="2" py="6">
            <Text size="4" weight="bold">
              No bank statements imported yet
            </Text>
            <Text size="2" color="gray" align="center">
              Import a bank or card statement under{" "}
              <RadixLink asChild>
                <NextLink href="/expenses/import">Expenses → Import</NextLink>
              </RadixLink>{" "}
              first — reconciliation matches those lines against your ledger.
            </Text>
          </Flex>
        </Card>
      </PageShell>
    );
  }

  const { start, end } = monthBoundsOf(month);

  const [txnRes, ledgerRes, matchRes] = await Promise.all([
    supabase
      .from("bank_transactions")
      .select("id, posted_on, description, amount_cents")
      .eq("account_id", account.id)
      .eq("bank_account_id", bankId)
      .gte("posted_on", start)
      .lte("posted_on", end)
      .order("posted_on", { ascending: true })
      .limit(LINES_LIMIT),
    supabase
      .rpc("ledger_bank_lines", {
        target_account_id: account.id,
        period_start: start,
        period_end: end,
      } as never)
      .limit(LINES_LIMIT),
    supabase
      .from("bank_statement_matches")
      .select("id, bank_transaction_id, journal_line_id")
      .eq("account_id", account.id)
      .limit(LINES_LIMIT),
  ]);

  const txnResult = rowsOf<TxnRow>(txnRes as never);
  const ledgerResult = rowsOf<BankLineRow>(ledgerRes as never);
  const matchResult = rowsOf<MatchRow>(matchRes as never);

  if (!txnResult.ok || !ledgerResult.ok || !matchResult.ok) {
    return (
      <PageShell title="Reconcile">
        <Callout.Root color="red">
          <Callout.Icon>
            <ExclamationTriangleIcon />
          </Callout.Icon>
          <Callout.Text>
            Couldn&rsquo;t load this period&rsquo;s lines. Nothing is shown rather than
            a difference figure that isn&rsquo;t true.
          </Callout.Text>
        </Callout.Root>
      </PageShell>
    );
  }

  const truncated =
    txnResult.rows.length === LINES_LIMIT ||
    ledgerResult.rows.length === LINES_LIMIT ||
    matchResult.rows.length === LINES_LIMIT;

  const matchByTxn = new Map(matchResult.rows.map((m) => [m.bank_transaction_id, m.id]));
  const matchByLine = new Map(matchResult.rows.map((m) => [m.journal_line_id, m.id]));

  const statementLines: StatementLineView[] = txnResult.rows.map((t) => ({
    id: t.id,
    postedOn: t.posted_on,
    description: t.description,
    amountCents: t.amount_cents,
    matchId: matchByTxn.get(t.id) ?? null,
  }));
  const ledgerLines: LedgerLineView[] = ledgerResult.rows.map((l) => ({
    journalLineId: l.journal_line_id,
    entryDate: l.entry_date,
    memo: l.memo,
    sourceType: l.source_type,
    signedCents: l.signed_cents,
    matchId: matchByLine.get(l.journal_line_id) ?? null,
  }));

  const totals = reconciliationTotals(
    statementLines.map((l) => l.amountCents),
    ledgerLines.map((l) => l.signedCents),
    statementLines.filter((l) => l.matchId !== null).length,
    ledgerLines.filter((l) => l.matchId !== null).length
  );

  const selectedBank = bankAccounts.find((b) => b.id === bankId);

  return (
    <PageShell
      title="Reconcile"
      subtitle={`${selectedBank?.label ?? "Bank"}${selectedBank?.last4 ? ` ••${selectedBank.last4}` : ""} · ${month}`}
      action={
        <Button asChild variant="soft" size="2">
          <NextLink href="/accounting">Chart of accounts</NextLink>
        </Button>
      }
    >
      <Card size="2">
        <form method="get" action="/accounting/reconcile">
          <Flex gap="3" align="end" wrap="wrap">
            <Flex direction="column" gap="1">
              <Text as="label" size="2" weight="medium" id="rec-bank-label">
                Statement source
              </Text>
              <Select.Root name="bank" defaultValue={bankId}>
                <Select.Trigger aria-labelledby="rec-bank-label" />
                <Select.Content>
                  {bankAccounts.map((b) => (
                    <Select.Item key={b.id} value={b.id}>
                      {b.label}
                      {b.last4 ? ` ••${b.last4}` : ""}
                    </Select.Item>
                  ))}
                </Select.Content>
              </Select.Root>
            </Flex>
            <Flex direction="column" gap="1">
              <Text as="label" size="2" weight="medium" htmlFor="rec-month">
                Month
              </Text>
              <TextField.Root id="rec-month" type="month" name="month" defaultValue={month} />
            </Flex>
            <Button type="submit" variant="soft">
              View period
            </Button>
          </Flex>
        </form>
      </Card>

      <Grid columns={{ initial: "1", sm: "3" }} gap="3">
        <Card size="2">
          <Text as="div" size="1" color="gray">
            Statement total
          </Text>
          <Text as="div" size="4" weight="bold" className="tnum">
            {formatCents(totals.statementTotalCents)}
          </Text>
        </Card>
        <Card size="2">
          <Text as="div" size="1" color="gray">
            Ledger total
          </Text>
          <Text as="div" size="4" weight="bold" className="tnum">
            {formatCents(totals.ledgerTotalCents)}
          </Text>
        </Card>
        <Card size="2">
          <Text as="div" size="1" color="gray">
            Difference (statement − ledger)
          </Text>
          <Text
            as="div"
            size="4"
            weight="bold"
            className="tnum"
            color={totals.differenceCents === 0 ? "green" : "red"}
          >
            {formatCents(totals.differenceCents)}
          </Text>
          {totals.differenceCents === 0 ? (
            <Text as="div" size="1" color="green">
              Reconciled — the books fully explain this period.
            </Text>
          ) : (
            <Text as="div" size="1" color="gray">
              Record the missing side (confirm an expense, record a payment, or
              add a journal entry) to bring this to zero — matching alone never
              moves it.
            </Text>
          )}
        </Card>
      </Grid>

      {truncated ? (
        <Callout.Root color="amber">
          <Callout.Icon>
            <InfoCircledIcon />
          </Callout.Icon>
          <Callout.Text>
            This period has more lines than one screen can safely total — the
            difference figure above may be incomplete. Narrow to a month with
            fewer lines.
          </Callout.Text>
        </Callout.Root>
      ) : null}

      <ReconcileBoard statementLines={statementLines} ledgerLines={ledgerLines} />
    </PageShell>
  );
}

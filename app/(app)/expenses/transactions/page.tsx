import { Box, Table, Text } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import { requireAccount } from "@/lib/supabase/account";
import { formatDateRange } from "@/lib/format";
import PageShell from "../../page-shell";
import TransactionRow, { type TransactionRowData, type TripOption } from "./transaction-row";

export const metadata = { title: "Review transactions" };

type TxnRow = {
  id: string;
  posted_on: string;
  description: string;
  amount_cents: number;
  suggested_category: string | null;
  bank_account_id: string;
};

type BankAccountRow = { id: string; label: string; last4: string | null };
type TripRow = { id: string; starts_on: string; ends_on: string; aircraft_ident: string | null };

// Same silent-truncation guard as expenses/page.tsx's EXPENSES_LIMIT.
const TXN_LIMIT = 1000;

/**
 * The review queue. Every row here is `review_state = 'unreviewed'` —
 * once a pilot confirms or dismisses one, it drops off this list
 * (confirmTransaction/ignoreTransaction move it out of 'unreviewed' and
 * this page reads only that state). Nothing on this page writes to
 * pilot.expenses directly; TransactionRow's "Confirm as expense" button
 * is the one path, and it goes through ./actions.ts's confirmTransaction.
 */
export default async function TransactionsPage() {
  await requireAccount("/expenses/transactions");
  const supabase = await createClient();

  const [{ data: txnData, error }, { data: accountData }, { data: tripData }] = await Promise.all([
    supabase
      .from("bank_transactions")
      .select("id, posted_on, description, amount_cents, suggested_category, bank_account_id")
      .eq("review_state", "unreviewed")
      .order("posted_on", { ascending: false })
      .limit(TXN_LIMIT),
    supabase.from("bank_accounts").select("id, label, last4"),
    supabase.from("trips").select("id, starts_on, ends_on, aircraft_ident").order("starts_on", { ascending: false }),
  ]);

  if (error) {
    return (
      <PageShell title="Review transactions">
        <Text color="red">{error.message}</Text>
      </PageShell>
    );
  }

  const accountsById = new Map(((accountData ?? []) as BankAccountRow[]).map((a) => [a.id, a]));
  const trips: TripOption[] = ((tripData ?? []) as TripRow[]).map((t) => ({
    id: t.id,
    label: `${formatDateRange(t.starts_on, t.ends_on)}${t.aircraft_ident ? ` · ${t.aircraft_ident}` : ""}`,
  }));

  const rows: TransactionRowData[] = ((txnData ?? []) as TxnRow[]).map((t) => {
    const acc = accountsById.get(t.bank_account_id);
    return {
      id: t.id,
      posted_on: t.posted_on,
      description: t.description,
      amount_cents: t.amount_cents,
      suggested_category: t.suggested_category,
      bank_account_label: acc ? `${acc.label}${acc.last4 ? ` ···${acc.last4}` : ""}` : "",
    };
  });

  return (
    <PageShell
      title="Review imported transactions"
      subtitle="Nothing here is in your books yet. Pick a category and treatment for each transaction to turn it into an expense — or dismiss it if it isn't one."
    >
      {rows.length === 0 ? (
        <Text color="gray">Nothing to review. Import a statement to get started.</Text>
      ) : (
        <Box style={{ overflowX: "auto" }}>
          <Table.Root variant="surface">
            <Table.Header>
              <Table.Row>
                <Table.ColumnHeaderCell>Date</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell>Description</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell>Amount</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell></Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell></Table.ColumnHeaderCell>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {rows.map((t) => (
                <TransactionRow key={t.id} txn={t} trips={trips} />
              ))}
            </Table.Body>
          </Table.Root>
          {rows.length === TXN_LIMIT ? (
            <Text size="1" color="gray">
              Showing the first {TXN_LIMIT.toLocaleString()} unreviewed transactions.
            </Text>
          ) : null}
        </Box>
      )}
    </PageShell>
  );
}

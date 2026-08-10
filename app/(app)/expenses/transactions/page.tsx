import { Box, Table, Text } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import { requireAccount } from "@/lib/supabase/account";
import { formatDateRange } from "@/lib/format";
import PageShell from "../../page-shell";
import TransactionRow, {
  type DuplicateCandidate,
  type TransactionRowData,
  type TripOption,
} from "./transaction-row";

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
type ExpenseCandidateRow = {
  id: string;
  incurred_on: string;
  vendor: string | null;
  amount_cents: number;
  treatment: string;
  bank_transaction_id: string | null;
};
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

  // -------------------------------------------------------------------
  // DUPLICATE SPEND — the one that reaches a paying client
  // -------------------------------------------------------------------
  // A pilot photographs a $312.00 hotel folio and files it rebill; a month
  // later the card statement imports the same charge. Nothing compared the
  // two, so both counted — and on a rebill the client saw two lines
  // totalling $624.00 for one night. They don't even read alike: the
  // imported row carries the raw bank descriptor and the manual one
  // whatever the pilot typed, so it looks like a two-night stay.
  //
  // Matched on AMOUNT and DATE, never on description, for exactly that
  // reason — the descriptions are the part that does NOT match on a real
  // duplicate. pilot.bank_transaction_duplicate_candidates is the
  // authoritative single-row form of this rule (what bank-import:verify's
  // DUP-1 proves); this is the same rule in one bounded query, so the
  // queue costs two round trips rather than one per row.
  //
  // Advisory, never blocking. Two identical same-day charges are real —
  // two crew meals at the same restaurant, a toll charged both ways — and
  // nothing downstream can tell those from a duplicate either.
  const txns = (txnData ?? []) as TxnRow[];
  const DUP_WINDOW_DAYS = 4;
  // Calendar arithmetic in UTC so a local timezone can never shift the
  // window by a day — lib/format.ts's "a date is a calendar fact" rule.
  const shiftDays = (iso: string, days: number) => {
    const [y, m, d] = iso.split("-").map(Number);
    const t = Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1) + days * 86_400_000;
    return new Date(t).toISOString().slice(0, 10);
  };

  const duplicatesByTxn = new Map<string, DuplicateCandidate[]>();
  if (txns.length > 0) {
    const dates = txns.map((t) => t.posted_on).sort();
    const { data: candidateData } = await supabase
      .from("expenses")
      .select("id, incurred_on, vendor, amount_cents, treatment, bank_transaction_id")
      .gte("incurred_on", shiftDays(dates[0]!, -DUP_WINDOW_DAYS))
      .lte("incurred_on", shiftDays(dates[dates.length - 1]!, DUP_WINDOW_DAYS))
      .limit(TXN_LIMIT);

    const byAmount = new Map<number, ExpenseCandidateRow[]>();
    for (const e of (candidateData ?? []) as ExpenseCandidateRow[]) {
      const list = byAmount.get(e.amount_cents);
      if (list) list.push(e);
      else byAmount.set(e.amount_cents, [e]);
    }

    for (const t of txns) {
      const from = shiftDays(t.posted_on, -DUP_WINDOW_DAYS);
      const to = shiftDays(t.posted_on, DUP_WINDOW_DAYS);
      const hits = (byAmount.get(Math.abs(t.amount_cents)) ?? [])
        .filter((e) => e.incurred_on >= from && e.incurred_on <= to)
        .filter((e) => e.bank_transaction_id !== t.id)
        .slice(0, 3)
        .map((e) => ({
          incurredOn: e.incurred_on,
          vendor: e.vendor,
          amountCents: e.amount_cents,
          treatment: e.treatment,
          fromBank: e.bank_transaction_id !== null,
        }));
      if (hits.length > 0) duplicatesByTxn.set(t.id, hits);
    }
  }

  const rows: TransactionRowData[] = txns.map((t) => {
    const acc = accountsById.get(t.bank_account_id);
    return {
      id: t.id,
      posted_on: t.posted_on,
      description: t.description,
      amount_cents: t.amount_cents,
      suggested_category: t.suggested_category,
      bank_account_label: acc ? `${acc.label}${acc.last4 ? ` ···${acc.last4}` : ""}` : "",
      duplicates: duplicatesByTxn.get(t.id) ?? [],
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

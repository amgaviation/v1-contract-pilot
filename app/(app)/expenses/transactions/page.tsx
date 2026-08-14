import NextLink from "next/link";
import { Box, Button, Callout, Card, Flex, Table, Text } from "@/components/ui";
import { ExclamationTriangleIcon } from "@radix-ui/react-icons";
import { createClient } from "@/lib/supabase/server";
import { requireEntitlement } from "@/lib/supabase/entitlements";
import { formatDateRange } from "@/lib/format";
import { friendlyDbError } from "@/lib/db-errors";
import { loadOptionChoices } from "@/lib/custom-options-read";
import PageShell from "../../page-shell";
import TransactionRow, {
  type DuplicateCandidate,
  type TransactionRowData,
  type TripOption,
} from "./transaction-row";
import DismissedQueue, { type DismissedRow } from "./dismissed-queue";

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
  await requireEntitlement("bank_import", "/expenses/transactions");
  const supabase = await createClient();

  const [
    { data: txnData, error },
    { data: accountData, error: accountsError },
    { data: tripData, error: tripsError },
    categories,
    { data: dismissedData },
  ] = await Promise.all([
    supabase
      .from("bank_transactions")
      .select("id, posted_on, description, amount_cents, suggested_category, bank_account_id")
      .eq("review_state", "unreviewed")
      .order("posted_on", { ascending: false })
      .limit(TXN_LIMIT),
    supabase.from("bank_accounts").select("id, label, last4"),
    supabase.from("trips").select("id, starts_on, ends_on, aircraft_ident").order("starts_on", { ascending: false }),
    // The same tenant vocabulary the expense form offers — a category
    // picked here becomes pilot.expenses.category, so the two lists must
    // not diverge.
    loadOptionChoices("expense_category"),
    // Everything that left 'unreviewed' WITHOUT becoming a visible
    // expense: dismissed rows (ignoreTransaction), and the schema's own
    // "rare, visible" state — a reviewed row whose expense was since
    // deleted (expense_id set null by the FK, category/treatment stay put).
    // Neither was listed anywhere before this — a mis-tapped Dismiss was
    // permanent, since re-importing the same statement collides on the
    // fingerprint that's already there.
    supabase
      .from("bank_transactions")
      .select("id, posted_on, description, amount_cents, review_state, expense_id")
      .or("review_state.eq.ignored,and(review_state.eq.reviewed,expense_id.is.null)")
      .order("posted_on", { ascending: false })
      .limit(TXN_LIMIT),
  ]);

  if (error) {
    // error.message is a raw PostgREST message — table/constraint names,
    // no help to the pilot reading it. friendlyDbError logs the detail
    // server-side and returns a sentence instead; see lib/db-errors.ts.
    return (
      <PageShell title="Review transactions">
        <Card size="3">
          <Callout.Root color="red">
            <Callout.Icon>
              <ExclamationTriangleIcon />
            </Callout.Icon>
            <Callout.Text>
              {friendlyDbError(error, "bank_transactions.select")}
            </Callout.Text>
          </Callout.Root>
        </Card>
      </PageShell>
    );
  }

  const accountsById = new Map(((accountData ?? []) as BankAccountRow[]).map((a) => [a.id, a]));
  const trips: TripOption[] = ((tripData ?? []) as TripRow[]).map((t) => ({
    id: t.id,
    label: `${formatDateRange(t.starts_on, t.ends_on)}${t.aircraft_ident ? ` · ${t.aircraft_ident}` : ""}`,
  }));
  // S2: same shape as U5's trip picker, on the other queue that assigns a
  // transaction to a trip. A failed read here used to empty the Trip
  // picker on every row and blank the bank-account label with no
  // explanation — advisory rather than blocking, since nothing on this
  // page prints a wrong dollar figure from either read.
  const pickersDegraded = Boolean(accountsError || tripsError);

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
  // A FAILED duplicate check is not "no duplicates". Discarding this error
  // made every row render exactly like a genuinely-new charge, so a $312
  // hotel folio already filed as rebill would be confirmed a second time
  // and the client's invoice would show two lines for one night. The
  // absence of a warning has to mean "we checked and found none", or the
  // warning is worth nothing.
  let duplicateCheckFailed = false;
  if (txns.length > 0) {
    const dates = txns.map((t) => t.posted_on).sort();
    const { data: candidateData, error: candidateError } = await supabase
      .from("expenses")
      .select("id, incurred_on, vendor, amount_cents, treatment, bank_transaction_id")
      .gte("incurred_on", shiftDays(dates[0]!, -DUP_WINDOW_DAYS))
      .lte("incurred_on", shiftDays(dates[dates.length - 1]!, DUP_WINDOW_DAYS))
      .limit(TXN_LIMIT);

    duplicateCheckFailed = Boolean(candidateError);
    if (candidateError) {
      console.error("[db] expenses.select(duplicate candidates)", candidateError.message);
    }

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

  const dismissedRows: DismissedRow[] = (
    (dismissedData ?? []) as {
      id: string;
      posted_on: string;
      description: string;
      amount_cents: number;
      review_state: string;
      expense_id: string | null;
    }[]
  ).map(
    (t): DismissedRow => ({
      id: t.id,
      posted_on: t.posted_on,
      description: t.description,
      amount_cents: t.amount_cents,
      kind: t.review_state === "ignored" ? "ignored" : "orphaned",
    })
  );

  return (
    <PageShell
      title="Review imported transactions"
      subtitle="Nothing here is in your books yet. Pick a category and treatment for each transaction to turn it into an expense, or dismiss it if it isn't one."
    >
      {pickersDegraded ? (
        <Callout.Root color="amber" mb="3">
          <Callout.Icon>
            <ExclamationTriangleIcon />
          </Callout.Icon>
          <Callout.Text>
            Couldn&rsquo;t load your trips or bank accounts, so the Trip
            picker below is empty and the account label may be blank on
            some rows. Reload before confirming these if you need to
            assign one to a trip.
          </Callout.Text>
        </Callout.Root>
      ) : null}

      {duplicateCheckFailed ? (
        <Callout.Root color="amber" mb="3">
          <Callout.Icon>
            <ExclamationTriangleIcon />
          </Callout.Icon>
          <Callout.Text>
            We couldn&rsquo;t check these against the expenses you&rsquo;ve already
            filed, so none of them are flagged as possible duplicates. Check for
            yourself before confirming. A charge you already photographed a receipt
            for would otherwise be billed twice.
          </Callout.Text>
        </Callout.Root>
      ) : null}

      {rows.length === 0 ? (
        <Flex direction="column" align="center" gap="3" py="6">
          <Text size="4" weight="bold">
            Nothing to review
          </Text>
          <Text size="2" color="gray" align="center">
            Import a bank statement and its transactions land here. Pick
            a category and treatment for each one to turn it into an
            expense.
          </Text>
          <Button asChild>
            <NextLink href="/expenses/import">Import a statement</NextLink>
          </Button>
        </Flex>
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
                <TransactionRow key={t.id} txn={t} trips={trips} categories={categories} />
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

      <DismissedQueue rows={dismissedRows} />
    </PageShell>
  );
}

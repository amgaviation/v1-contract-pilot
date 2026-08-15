import NextLink from "next/link";
import {
  Badge,
  Box,
  Button,
  Callout,
  Card,
  Flex,
  Link as RadixLink,
  Table,
  Text,
} from "@/components/ui";
import { ExclamationTriangleIcon } from "@radix-ui/react-icons";

import { createClient } from "@/lib/supabase/server";
import { requireAccount } from "@/lib/supabase/account";
import { formatCents, formatDate, formatDateRange } from "@/lib/format";
import { friendlyDbError } from "@/lib/db-errors";
import EmptyState from "@/components/ui/empty-state";
import PageShell from "../page-shell";
import { loadOptionLabels } from "@/lib/custom-options-read";
import { scheduleCMileageCents, type RatesByYear } from "@/lib/mileage";
import { resolveExpenseClient } from "@/lib/expense-client";
import UnassignedQueue, { type QueueRow } from "./unassigned-queue";

export const metadata = { title: "Expenses" };

type ExpenseRow = {
  id: string;
  incurred_on: string;
  category: string;
  vendor: string | null;
  amount_cents: number;
  treatment: string;
  trip_id: string | null;
  client_id: string | null;
  receipt_path: string | null;
};

type TripRow = {
  id: string;
  starts_on: string;
  ends_on: string;
  aircraft_ident: string | null;
  client_id: string | null;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The "not attributed to anyone" filter. A real question with a real
 * answer -- costs sitting against no client at all are the ones a pilot is
 * absorbing without knowing whose work caused them -- so it gets a value
 * rather than being reachable only by elimination. "none" cannot collide
 * with a client id, which is always a uuid.
 */
const NO_CLIENT_FILTER = "none";

type Badge = { color: "amber" | "blue" | "green"; label: string };
const TREATMENT_FALLBACK: Badge = { color: "amber", label: "Unassigned" };
const TREATMENT_BADGE: Record<string, Badge> = {
  unassigned: TREATMENT_FALLBACK,
  rebill: { color: "blue", label: "Rebill" },
  deduct: { color: "green", label: "Deduct" },
};

// Supabase's Data API caps rows (commonly 1000) and TRUNCATES SILENTLY on
// a plain select — no error, just a shorter array. An explicit .limit
// makes that boundary visible (rows.length === the limit) instead of
// invisible, and the callout below turns it into a caveat rather than a
// quietly wrong "unfiled" total. Same pattern as logbook/page.tsx's
// ENTRIES_LIMIT and page.tsx's AGGREGATE_LIMIT — copied, not reinvented.
const EXPENSES_LIMIT = 1000;

// Mirrors EXPENSES_LIMIT's truncation-visibility reasoning: only the
// mileage TOTAL is shown on this page (the log itself lives at
// /expenses/mileage), but the same silent-truncation hazard applies to it.
const MILEAGE_LIMIT = 1000;

export default async function ExpensesPage({
  searchParams,
}: {
  // ?client= narrows the ledger to one client's costs, and is where a
  // client's own cost panel links to. An unrecognized value is ignored
  // rather than rejected, same as trips/page.tsx: a stale or hand-edited
  // query string should degrade to "show everything", not a page error.
  searchParams: Promise<{ client?: string }>;
}) {
  await requireAccount("/expenses");
  const params = await searchParams;
  const clientFilter =
    params.client === NO_CLIENT_FILTER
      ? NO_CLIENT_FILTER
      : params.client && UUID_RE.test(params.client)
        ? params.client
        : null;

  const supabase = await createClient();
  // categoryLabels replaces a hand-written map that lived in this file
  // and had ALREADY fallen behind: it held the travel eight only, so
  // every self-funded category added in 20260810070000 — training,
  // medical, insurance, charts, equipment, uniform, dues — rendered as
  // "Other" on this screen. Resolving through the options table fixes
  // that and picks up the tenant's own renames at the same time, and it
  // includes retired categories, because this is a history screen.
  const [
    { data: expenseData, error },
    { data: tripData, error: tripsError },
    unreviewedCount,
    { data: mileageData, error: mileageError },
    { data: mileageRateData, error: mileageRateError },
    categoryLabels,
    { data: invoicedLinesData },
    { data: clientData, error: clientsError },
  ] = await Promise.all([
    supabase
      .from("expenses")
      .select(
        "id, incurred_on, category, vendor, amount_cents, treatment, trip_id, client_id, receipt_path"
      )
      .order("incurred_on", { ascending: false })
      .limit(EXPENSES_LIMIT),
    supabase
      .from("trips")
      .select("id, starts_on, ends_on, aircraft_ident, client_id")
      .order("starts_on", { ascending: false }),
    // count-only ("head: true" — no rows fetched) — this is a badge, not
    // a list, so nothing from bank_transactions itself needs to reach
    // this page's payload.
    supabase
      .from("bank_transactions")
      .select("id", { count: "exact", head: true })
      .eq("review_state", "unreviewed"),
    // drove_on and miles, not the per-row amount_cents — the deduction is
    // total miles for the year x that year's rate, rounded ONCE. See
    // lib/mileage.ts; this was the third surface computing it differently.
    supabase
      .from("mileage_entries")
      .select("drove_on, miles")
      .limit(MILEAGE_LIMIT),
    supabase.from("mileage_rates").select("tax_year, rate_cents_per_mile"),
    loadOptionLabels("expense_category"),
    // Same "every already-referenced expense_id" read as
    // invoices/[id]/page.tsx's rebillable-expense picker — invoice_lines
    // carries `unique (account_id, expense_id)`, so an expense_id showing
    // up here at all means it is already on an invoice, full stop, no
    // status filter needed. A failed read degrades to "exclude nothing",
    // which is the number this page already showed before this fix — not
    // a new failure mode, just a missed improvement.
    supabase.from("invoice_lines").select("expense_id").not("expense_id", "is", null),
    // Names for the Client column and the filter row. Archived clients are
    // included: this is a history screen, and a cost attributed to a client
    // the pilot has since archived still has to render as that client's.
    supabase.from("clients").select("id, name, archived_at").order("name"),
  ]);

  const allExpenses = (expenseData ?? []) as ExpenseRow[];
  const trips = (tripData ?? []) as TripRow[];
  // Measured BEFORE the client filter is applied, because that filter runs
  // in memory (see clientOf below) and would otherwise mask the cap: 1000
  // expenses narrowed to 12 for one client is not a list of 12 that happens
  // to be short, it is 12 out of an unknown number.
  const truncatedExpenses = allExpenses.length === EXPENSES_LIMIT;

  const clientRows = (clientData ?? []) as {
    id: string;
    name: string;
    archived_at: string | null;
  }[];
  const clientNames = new Map(clientRows.map((c) => [c.id, c.name]));
  // A failed clients read is not "you have no clients" -- the filter row is
  // withheld rather than rendered empty, and the Client column says so.
  const clientsLoadError = Boolean(clientsError);
  const clientChoices = clientRows.filter((c) => !c.archived_at);

  // The reading rule lives in lib/expense-client.ts so this screen, the
  // client record's cost panel, and anything added later cannot drift into
  // three different answers to "whose cost is this".
  const tripClientIds = new Map(trips.map((trip) => [trip.id, trip.client_id]));
  const clientOf = (expense: ExpenseRow) => resolveExpenseClient(expense, tripClientIds);

  const expenses = clientFilter
    ? allExpenses.filter((expense) => {
        const resolved = clientOf(expense).clientId;
        return clientFilter === NO_CLIENT_FILTER
          ? resolved === null
          : resolved === clientFilter;
      })
    : allExpenses;

  const mileageRows = (mileageData ?? []) as { drove_on: string; miles: number }[];
  const mileageRatesByYear: RatesByYear = Object.fromEntries(
    ((mileageRateData ?? []) as { tax_year: number; rate_cents_per_mile: number }[]).map(
      (r) => [r.tax_year, r.rate_cents_per_mile]
    )
  );
  const { amountCents: mileageTotalCents, milesWithoutRate } = scheduleCMileageCents(
    mileageRows,
    mileageRatesByYear
  );
  const mileageTotalMiles = mileageRows.reduce((sum, r) => sum + r.miles, 0);
  const mileageTruncated = mileageRows.length === MILEAGE_LIMIT;
  // A failed mileage_rates read must read the same as a failed
  // mileage_entries read, not as "no rate on file" — that day-one wording
  // is only honest when the rates query actually came back empty, not when
  // it errored and ratesByYear was silently built from nothing.
  const mileageFailed = Boolean(mileageError || mileageRateError);

  // U5: the trips read used to destructure `{ data: tripData }` only. On
  // failure `trips` degrades to `[]` exactly like a pilot with no trips
  // logged — every row in the Needs-filing queue below then shows a Trip
  // picker offering just "No trip" with its Rebill button disabled and no
  // explanation, and the Trip column here reads "—" for every trip that
  // does have one on file.
  const tripsLoadError = Boolean(tripsError);

  const tripLabel = (trip: TripRow) =>
    `${formatDateRange(trip.starts_on, trip.ends_on)}${
      trip.aircraft_ident ? ` · ${trip.aircraft_ident}` : ""
    }`;
  const tripLabels = new Map(trips.map((trip) => [trip.id, tripLabel(trip)]));
  const tripOptions = trips.map((trip) => ({ id: trip.id, label: tripLabel(trip) }));

  // The unassigned queue is a first-class surface, not a filter: these
  // receipts are neither billed nor deducted, which is money the pilot is
  // currently losing in both directions. It sits above the ledger.
  const unassigned = expenses.filter((e) => e.treatment === "unassigned");
  const unassignedTotal = unassigned.reduce((sum, e) => sum + e.amount_cents, 0);
  // "$X to rebill" has to mean outstanding, actionable money — not a
  // standing figure that still counts a receipt already sitting on an
  // invoice (drafted, sent, or paid). invoice_lines' unique
  // (account_id, expense_id) makes that state knowable without a join:
  // an expense_id present at all is already spoken for.
  const invoicedExpenseIds = new Set(
    ((invoicedLinesData ?? []) as { expense_id: string | null }[]).map((l) => l.expense_id)
  );
  const rebillTotal = expenses
    .filter((e) => e.treatment === "rebill" && !invoicedExpenseIds.has(e.id))
    .reduce((sum, e) => sum + e.amount_cents, 0);
  const deductTotal = expenses
    .filter((e) => e.treatment === "deduct")
    .reduce((sum, e) => sum + e.amount_cents, 0);

  // U5: this count-only read carried no error binding at all — a failed
  // read and "nothing to review" both collapsed to `count ?? 0`, silently
  // hiding the "Imported transactions to review" nudge on the one queue
  // whose entire point is that nothing sits unreviewed.
  const unreviewedCountError = Boolean(unreviewedCount.error);
  const unreviewedTransactions = unreviewedCount.count ?? 0;

  const filterLabel =
    clientFilter === null
      ? null
      : clientFilter === NO_CLIENT_FILTER
        ? "No client"
        : clientNames.get(clientFilter) ?? "Unknown client";

  /**
   * A /expenses link that sets or clears the client filter. Link-based
   * chips, no client JS, same idiom as trips/page.tsx: re-clicking the
   * active choice is how it clears.
   */
  const clientFilterHref = (next: string | null) =>
    next === null ? "/expenses" : `/expenses?client=${next}`;

  const queueRows: QueueRow[] = unassigned.map((expense) => ({
    id: expense.id,
    label: `${categoryLabels[expense.category] ?? "Other"}${
      expense.vendor ? ` · ${expense.vendor}` : ""
    }`,
    detail: `${formatDate(expense.incurred_on)} · ${formatCents(expense.amount_cents)}`,
    tripId: expense.trip_id,
  }));

  return (
    <PageShell
      title="Expenses"
      subtitle={
        error
          ? "Couldn't load your expenses."
          : `${filterLabel ? `${filterLabel} · ` : ""}${formatCents(
              rebillTotal
            )} to rebill · ${formatCents(deductTotal)} deductible${
              unassigned.length
                ? ` · ${formatCents(unassignedTotal)} unfiled`
                : ""
            }`
      }
      action={
        <Flex gap="3">
          <Button asChild variant="soft">
            <NextLink href="/expenses/import">Import statement</NextLink>
          </Button>
          <Button asChild variant="outline">
            <NextLink href="/expenses/mileage">Mileage log</NextLink>
          </Button>
          <Button asChild>
            <NextLink href="/expenses/new">Add expense</NextLink>
          </Button>
        </Flex>
      }
    >
      {error ? (
        <Card size="3">
          <Callout.Root color="red">
            <Callout.Icon>
              <ExclamationTriangleIcon />
            </Callout.Icon>
            <Callout.Text>{friendlyDbError(error, "expenses.select")}</Callout.Text>
          </Callout.Root>
        </Card>
      ) : (
        <>
          {truncatedExpenses ? (
            <Box mb="4">
              <Callout.Root color="amber">
                <Callout.Icon>
                  <ExclamationTriangleIcon />
                </Callout.Icon>
                <Callout.Text>
                  {clientFilter
                    ? `Totals above may be partial. This client's costs were picked out of your ${EXPENSES_LIMIT} most recent expenses, and you have more than that.`
                    : `Totals above may be partial. There are more than ${EXPENSES_LIMIT} expenses and only the first ${EXPENSES_LIMIT} were totaled.`}
                </Callout.Text>
              </Callout.Root>
            </Box>
          ) : null}

          {/* Costs by client. A cost reaches a client two ways -- the pilot
              attributed it directly, or it sits on one of that client's
              trips -- and both count here, because a client's cost picture
              that omitted either would be wrong in the direction that
              matters (too low). */}
          {clientsLoadError ? (
            <Box mb="4">
              <Callout.Root color="amber">
                <Callout.Icon>
                  <ExclamationTriangleIcon />
                </Callout.Icon>
                <Callout.Text>
                  Couldn&rsquo;t load your clients, so you can&rsquo;t filter
                  by one right now and the Client column below shows a link
                  instead of a name. Reload to try again.
                </Callout.Text>
              </Callout.Root>
            </Box>
          ) : clientChoices.length > 0 ? (
            <Flex gap="2" wrap="wrap" mb="4">
              <Button asChild size="1" variant={clientFilter === null ? "solid" : "soft"}>
                <NextLink href={clientFilterHref(null)}>Any client</NextLink>
              </Button>
              {clientChoices.map((client) => (
                <Button
                  key={client.id}
                  asChild
                  size="1"
                  variant={clientFilter === client.id ? "solid" : "soft"}
                >
                  <NextLink
                    href={clientFilterHref(clientFilter === client.id ? null : client.id)}
                  >
                    {client.name}
                  </NextLink>
                </Button>
              ))}
              <Button
                asChild
                size="1"
                variant={clientFilter === NO_CLIENT_FILTER ? "solid" : "soft"}
              >
                <NextLink
                  href={clientFilterHref(
                    clientFilter === NO_CLIENT_FILTER ? null : NO_CLIENT_FILTER
                  )}
                >
                  No client
                </NextLink>
              </Button>
            </Flex>
          ) : null}

          {/* U5: a failed count read must not silently look identical to
              "nothing to review" — it used to, because `count ?? 0` cannot
              tell "checked, found none" from "couldn't check" apart. */}
          {unreviewedCountError ? (
            <Box mb="4">
              <Callout.Root color="amber">
                <Callout.Icon>
                  <ExclamationTriangleIcon />
                </Callout.Icon>
                <Callout.Text>
                  Couldn&rsquo;t check for imported transactions awaiting
                  review. This is not a statement that there are none.
                  Reload, or check{" "}
                  <NextLink href="/expenses/transactions">
                    the review queue
                  </NextLink>{" "}
                  directly.
                </Callout.Text>
              </Callout.Root>
            </Box>
          ) : unreviewedTransactions > 0 ? (
            <Box mb="4">
              <Card size="3">
                <Flex align="center" justify="between" wrap="wrap" gap="3">
                  <Box>
                    <Text as="div" size="4" weight="bold">
                      Imported transactions to review
                    </Text>
                    <Text as="div" color="gray" className="tnum">
                      {unreviewedTransactions} transaction{unreviewedTransactions === 1 ? "" : "s"} from a bank
                      statement import {unreviewedTransactions === 1 ? "hasn't" : "haven't"} been categorized yet.
                      Nothing here is in your books until you review each one.
                    </Text>
                  </Box>
                  <Button asChild variant="soft">
                    <NextLink href="/expenses/transactions">Review now</NextLink>
                  </Button>
                </Flex>
              </Card>
            </Box>
          ) : null}

          {queueRows.length > 0 ? (
            <Box mb="4">
              <Card size="3">
                <Text as="div" size="4" weight="bold">
                  Needs filing
                </Text>
                <Text as="div" color="gray" mb="3">
                  {queueRows.length} receipt
                  {queueRows.length === 1 ? "" : "s"} that are neither billed
                  to a client nor claimed as a deduction.
                </Text>
                {/* U5: a failed trips read used to leave every row's Trip
                    picker offering just "No trip" with the Rebill button
                    disabled and no explanation why. */}
                {tripsLoadError ? (
                  <Callout.Root color="amber" size="1" mb="3">
                    <Callout.Text>
                      Couldn&rsquo;t load your trips, so the Trip picker
                      below only offers &ldquo;No trip&rdquo; and
                      Rebill is unavailable. Reload before filing these.
                    </Callout.Text>
                  </Callout.Root>
                ) : null}
                <UnassignedQueue rows={queueRows} trips={tripOptions} />
              </Card>
            </Box>
          ) : null}

          <Box mb="4">
            <Card size="3">
              <Flex justify="between" align="center" wrap="wrap" gap="3">
                <Flex direction="column" gap="1">
                  <Text as="div" size="4" weight="bold">
                    Mileage
                  </Text>
                  <Text as="div" size="2" color="gray">
                    {mileageFailed
                      ? "Couldn't load your mileage total."
                      : `${mileageTotalMiles.toFixed(1)} mi logged at the standard mileage rate${
                          mileageTruncated ? " (partial, see the mileage log)" : ""
                        }`}
                  </Text>
                </Flex>
                <Flex align="center" gap="4">
                  {!mileageFailed ? (
                    // A rate-less year must never render as a $0.00
                    // deduction — that reads as "your mileage is worth
                    // nothing" to a pilot who logged real drives. Same
                    // "No rate on file" wording as /expenses/mileage's
                    // by-tax-year table, which is the correct handling of
                    // this exact case. A MIXED set (some years priced, some
                    // not) falls through to the total below instead — see
                    // the Callout beneath the Card for how that case says
                    // so.
                    mileageTotalCents === 0 && milesWithoutRate > 0 ? (
                      <Text size="2" color="gray">
                        No rate on file
                      </Text>
                    ) : (
                      <Text size="5" weight="bold" className="tnum">
                        {formatCents(mileageTotalCents)}
                      </Text>
                    )
                  ) : null}
                  <Button asChild variant="soft">
                    <NextLink href="/expenses/mileage">Log a drive</NextLink>
                  </Button>
                </Flex>
              </Flex>
              {/* Same wording and shape as /reports/profit-loss's own
                  mileageMilesWithoutRate Callout — a MIXED set (some tax
                  years priced, some not) prints the total above with no
                  caveat otherwise, which quietly omits the rate-less
                  years' miles from a figure that looks complete. */}
              {!mileageFailed && mileageTotalCents > 0 && milesWithoutRate > 0 ? (
                <Callout.Root color="amber" mt="3">
                  <Callout.Icon>
                    <ExclamationTriangleIcon />
                  </Callout.Icon>
                  <Callout.Text>
                    {`${milesWithoutRate} miles are not in the figure above. There's no IRS standard rate on file for their tax year. Add it in Settings and this recomputes.`}
                  </Callout.Text>
                </Callout.Root>
              ) : null}
            </Card>
          </Box>

          <Card size="3">
            {expenses.length === 0 && clientFilter ? (
              // Filtered to nothing is a third case, distinct from both an
              // empty account and a failed read: the expenses exist, none
              // of them belong to this client.
              <EmptyState
                title={
                  clientFilter === NO_CLIENT_FILTER
                    ? "Every expense is attributed"
                    : "No expenses for this client"
                }
                action={
                  <Button asChild variant="soft">
                    <NextLink href="/expenses">Show all expenses</NextLink>
                  </Button>
                }
              >
                {clientFilter === NO_CLIENT_FILTER
                  ? "Nothing is sitting against no client at all."
                  : "Nothing here is attributed to them, directly or through one of their trips."}
              </EmptyState>
            ) : expenses.length === 0 ? (
              <EmptyState
                title="No expenses yet"
                action={
                  <Button asChild>
                    <NextLink href="/expenses/new">Add your first expense</NextLink>
                  </Button>
                }
                // No "import a statement" secondary action here on purpose:
                // bank import is Pro-gated (FEATURES.bank_import), and an
                // empty state that offers a Solo pilot a button straight to
                // the upgrade wall is an upsell wearing a first-run
                // instruction's clothes.
              >
                Capture the receipt once and tag it rebill or deduct. It files
                itself against the trip from there.
              </EmptyState>
            ) : (
              <Table.Root variant="ghost">
                <Table.Header>
                  <Table.Row>
                    <Table.ColumnHeaderCell>Date</Table.ColumnHeaderCell>
                    <Table.ColumnHeaderCell>Category</Table.ColumnHeaderCell>
                    <Table.ColumnHeaderCell>Vendor</Table.ColumnHeaderCell>
                    <Table.ColumnHeaderCell>Trip</Table.ColumnHeaderCell>
                    <Table.ColumnHeaderCell>Client</Table.ColumnHeaderCell>
                    <Table.ColumnHeaderCell justify="end">Amount</Table.ColumnHeaderCell>
                    <Table.ColumnHeaderCell>Treatment</Table.ColumnHeaderCell>
                    <Table.ColumnHeaderCell>Receipt</Table.ColumnHeaderCell>
                  </Table.Row>
                </Table.Header>
                <Table.Body>
                  {expenses.map((expense) => {
                    const badge = TREATMENT_BADGE[expense.treatment] ?? TREATMENT_FALLBACK;
                    const client = clientOf(expense);
                    return (
                      <Table.Row key={expense.id}>
                        <Table.RowHeaderCell>
                          <RadixLink asChild weight="medium">
                            <NextLink href={`/expenses/${expense.id}`}>
                              {formatDate(expense.incurred_on)}
                            </NextLink>
                          </RadixLink>
                        </Table.RowHeaderCell>
                        <Table.Cell>
                          <Text color="gray">{categoryLabels[expense.category] ?? "Other"}</Text>
                        </Table.Cell>
                        <Table.Cell>
                          <Text color="gray">{expense.vendor ?? "—"}</Text>
                        </Table.Cell>
                        <Table.Cell>
                          {expense.trip_id ? (
                            <RadixLink asChild color="gray">
                              <NextLink href={`/trips/${expense.trip_id}`}>
                                {tripLabels.get(expense.trip_id) ?? "View trip"}
                              </NextLink>
                            </RadixLink>
                          ) : (
                            <Text color="gray">—</Text>
                          )}
                        </Table.Cell>
                        <Table.Cell>
                          {client.clientId === null ? (
                            <Text color="gray">No client</Text>
                          ) : (
                            <RadixLink asChild color="gray">
                              <NextLink href={`/clients/${client.clientId}`}>
                                {clientsLoadError
                                  ? "View client"
                                  : clientNames.get(client.clientId) ?? "View client"}
                              </NextLink>
                            </RadixLink>
                          )}
                          {/* Says which of the two answers this is. "Via
                              trip" is not the pilot's own attribution and
                              will follow the trip if its client changes. */}
                          {client.source === "trip" ? (
                            <Text as="div" size="1" color="gray">
                              Via trip
                            </Text>
                          ) : null}
                        </Table.Cell>
                        <Table.Cell justify="end">
                          <Text weight="medium" className="tnum">
                            {formatCents(expense.amount_cents)}
                          </Text>
                        </Table.Cell>
                        <Table.Cell>
                          <Badge color={badge.color}>{badge.label}</Badge>
                        </Table.Cell>
                        <Table.Cell>
                          <Text size="1" color={expense.receipt_path ? "gray" : "red"}>
                            {expense.receipt_path ? "Attached" : "Missing"}
                          </Text>
                        </Table.Cell>
                      </Table.Row>
                    );
                  })}
                </Table.Body>
              </Table.Root>
            )}
          </Card>
        </>
      )}
    </PageShell>
  );
}

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
import PageShell from "../page-shell";
import { scheduleCMileageCents, type RatesByYear } from "@/lib/mileage";
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
  receipt_path: string | null;
};

type TripRow = {
  id: string;
  starts_on: string;
  ends_on: string;
  aircraft_ident: string | null;
};

const CATEGORY_LABEL: Record<string, string> = {
  airline: "Airline",
  hotel: "Hotel",
  rental_car: "Rental car",
  rideshare: "Rideshare",
  fuel: "Fuel",
  meals: "Meals",
  parking: "Parking",
  other: "Other",
};

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

export default async function ExpensesPage() {
  await requireAccount("/expenses");

  const supabase = await createClient();
  const [
    { data: expenseData, error },
    { data: tripData },
    unreviewedCount,
    { data: mileageData, error: mileageError },
    { data: mileageRateData, error: mileageRateError },
  ] = await Promise.all([
    supabase
      .from("expenses")
      .select(
        "id, incurred_on, category, vendor, amount_cents, treatment, trip_id, receipt_path"
      )
      .order("incurred_on", { ascending: false })
      .limit(EXPENSES_LIMIT),
    supabase
      .from("trips")
      .select("id, starts_on, ends_on, aircraft_ident")
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
  ]);

  const expenses = (expenseData ?? []) as ExpenseRow[];
  const trips = (tripData ?? []) as TripRow[];
  const truncatedExpenses = expenses.length === EXPENSES_LIMIT;

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
  const rebillTotal = expenses
    .filter((e) => e.treatment === "rebill")
    .reduce((sum, e) => sum + e.amount_cents, 0);
  const deductTotal = expenses
    .filter((e) => e.treatment === "deduct")
    .reduce((sum, e) => sum + e.amount_cents, 0);

  const unreviewedTransactions = unreviewedCount.count ?? 0;

  const queueRows: QueueRow[] = unassigned.map((expense) => ({
    id: expense.id,
    label: `${CATEGORY_LABEL[expense.category] ?? "Other"}${
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
          : `${formatCents(rebillTotal)} to rebill · ${formatCents(
              deductTotal
            )} deductible${
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
                  {`Totals above may be partial — there are more than ${EXPENSES_LIMIT} expenses and only the first ${EXPENSES_LIMIT} were totaled.`}
                </Callout.Text>
              </Callout.Root>
            </Box>
          ) : null}

          {unreviewedTransactions > 0 ? (
            <Box mb="4">
              <Card size="3">
                <Flex align="center" justify="between" wrap="wrap" gap="3">
                  <Box>
                    <Text as="div" size="4" weight="bold">
                      Imported transactions to review
                    </Text>
                    <Text as="div" color="gray" className="tnum">
                      {unreviewedTransactions} transaction{unreviewedTransactions === 1 ? "" : "s"} from a bank
                      statement import {unreviewedTransactions === 1 ? "hasn't" : "haven't"} been categorized yet —
                      nothing here is in your books until you review each one.
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
                          mileageTruncated ? " (partial — see the mileage log)" : ""
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
                    // this exact case.
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
            </Card>
          </Box>

          <Card size="3">
            {expenses.length === 0 ? (
              <Flex direction="column" align="center" gap="3" py="6">
                <Text size="4" weight="bold">
                  No expenses yet
                </Text>
                <Text size="2" color="gray" align="center">
                  Capture the receipt once and tag it rebill or deduct. It
                  files itself against the trip from there.
                </Text>
                <Button asChild>
                  <NextLink href="/expenses/new">Add your first expense</NextLink>
                </Button>
              </Flex>
            ) : (
              <Table.Root variant="ghost">
                <Table.Header>
                  <Table.Row>
                    <Table.ColumnHeaderCell>Date</Table.ColumnHeaderCell>
                    <Table.ColumnHeaderCell>Category</Table.ColumnHeaderCell>
                    <Table.ColumnHeaderCell>Vendor</Table.ColumnHeaderCell>
                    <Table.ColumnHeaderCell>Trip</Table.ColumnHeaderCell>
                    <Table.ColumnHeaderCell justify="end">Amount</Table.ColumnHeaderCell>
                    <Table.ColumnHeaderCell>Treatment</Table.ColumnHeaderCell>
                    <Table.ColumnHeaderCell>Receipt</Table.ColumnHeaderCell>
                  </Table.Row>
                </Table.Header>
                <Table.Body>
                  {expenses.map((expense) => {
                    const badge = TREATMENT_BADGE[expense.treatment] ?? TREATMENT_FALLBACK;
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
                          <Text color="gray">{CATEGORY_LABEL[expense.category] ?? "Other"}</Text>
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

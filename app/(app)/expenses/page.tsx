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
} from "@radix-ui/themes";
import { ExclamationTriangleIcon } from "@radix-ui/react-icons";

import { createClient } from "@/lib/supabase/server";
import { requireAccount } from "@/lib/supabase/account";
import { formatCents, formatDate, formatDateRange } from "@/lib/format";
import { friendlyDbError } from "@/lib/db-errors";
import PageShell from "../page-shell";
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

export default async function ExpensesPage() {
  await requireAccount("/expenses");

  const supabase = await createClient();
  const [{ data: expenseData, error }, { data: tripData }] = await Promise.all([
    supabase
      .from("expenses")
      .select(
        "id, incurred_on, category, vendor, amount_cents, treatment, trip_id, receipt_path"
      )
      .order("incurred_on", { ascending: false }),
    supabase
      .from("trips")
      .select("id, starts_on, ends_on, aircraft_ident")
      .order("starts_on", { ascending: false }),
  ]);

  const expenses = (expenseData ?? []) as ExpenseRow[];
  const trips = (tripData ?? []) as TripRow[];

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
        <Button asChild>
          <NextLink href="/expenses/new">Add expense</NextLink>
        </Button>
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
                          <Text color="gray">
                            {expense.trip_id ? tripLabels.get(expense.trip_id) ?? "—" : "—"}
                          </Text>
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

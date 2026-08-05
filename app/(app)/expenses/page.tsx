import NextLink from "next/link";
import Card from "@mui/material/Card";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";

import MDBox from "@/components/mdpro/MDBox";
import MDTypography from "@/components/mdpro/MDTypography";
import MDButton from "@/components/mdpro/MDButton";
import MDBadge from "@/components/mdpro/MDBadge";

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

type Badge = { tone: string; label: string };
const TREATMENT_FALLBACK: Badge = { tone: "warning", label: "Unassigned" };
const TREATMENT_BADGE: Record<string, Badge> = {
  unassigned: TREATMENT_FALLBACK,
  rebill: { tone: "info", label: "Rebill" },
  deduct: { tone: "success", label: "Deduct" },
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
        <MDButton
          component={NextLink}
          href="/expenses/new"
          variant="gradient"
          color="info"
        >
          Add expense
        </MDButton>
      }
    >
      {error ? (
        <Card>
          <MDBox p={3}>
            <MDTypography variant="button" color="error">
              {friendlyDbError(error, "expenses.select")}
            </MDTypography>
          </MDBox>
        </Card>
      ) : (
        <>
          {queueRows.length > 0 ? (
            <MDBox mb={3}>
              <Card>
                <MDBox p={3} pb={0} lineHeight={1.25}>
                  <MDTypography variant="h6">Needs filing</MDTypography>
                  <MDTypography variant="button" color="text" fontWeight="regular">
                    {queueRows.length} receipt
                    {queueRows.length === 1 ? "" : "s"} that are neither billed
                    to a client nor claimed as a deduction.
                  </MDTypography>
                </MDBox>
                <MDBox p={3} pt={2}>
                  <UnassignedQueue rows={queueRows} trips={tripOptions} />
                </MDBox>
              </Card>
            </MDBox>
          ) : null}

          <Card>
            <MDBox p={3}>
              {expenses.length === 0 ? (
                <MDBox py={4} textAlign="center">
                  <MDTypography variant="h6">No expenses yet</MDTypography>
                  <MDTypography variant="button" color="text" fontWeight="regular">
                    Capture the receipt once and tag it rebill or deduct. It
                    files itself against the trip from there.
                  </MDTypography>
                  <MDBox mt={3}>
                    <MDButton
                      component={NextLink}
                      href="/expenses/new"
                      variant="gradient"
                      color="info"
                    >
                      Add your first expense
                    </MDButton>
                  </MDBox>
                </MDBox>
              ) : (
                <TableContainer sx={{ boxShadow: "none" }}>
                  <Table>
                    <TableHead sx={{ display: "table-header-group" }}>
                      <TableRow>
                        {["Date", "Category", "Vendor", "Trip", "Amount", "Treatment", "Receipt"].map(
                          (heading, index) => (
                            <TableCell
                              key={heading}
                              align={index === 4 ? "right" : "left"}
                            >
                              <MDTypography
                                variant="caption"
                                fontWeight="bold"
                                textTransform="uppercase"
                              >
                                {heading}
                              </MDTypography>
                            </TableCell>
                          )
                        )}
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {expenses.map((expense) => {
                        const badge =
                          TREATMENT_BADGE[expense.treatment] ?? TREATMENT_FALLBACK;
                        return (
                          <TableRow key={expense.id}>
                            <TableCell component="th" scope="row">
                              <MDTypography
                                component={NextLink}
                                href={`/expenses/${expense.id}`}
                                variant="button"
                                fontWeight="medium"
                              >
                                {formatDate(expense.incurred_on)}
                              </MDTypography>
                            </TableCell>
                            <TableCell>
                              <MDTypography
                                variant="button"
                                color="text"
                                fontWeight="regular"
                              >
                                {CATEGORY_LABEL[expense.category] ?? "Other"}
                              </MDTypography>
                            </TableCell>
                            <TableCell>
                              <MDTypography
                                variant="button"
                                color="text"
                                fontWeight="regular"
                              >
                                {expense.vendor ?? "—"}
                              </MDTypography>
                            </TableCell>
                            <TableCell>
                              <MDTypography
                                variant="button"
                                color="text"
                                fontWeight="regular"
                              >
                                {expense.trip_id
                                  ? tripLabels.get(expense.trip_id) ?? "—"
                                  : "—"}
                              </MDTypography>
                            </TableCell>
                            <TableCell align="right">
                              <MDTypography variant="button" fontWeight="medium">
                                {formatCents(expense.amount_cents)}
                              </MDTypography>
                            </TableCell>
                            <TableCell>
                              <MDBadge
                                variant="gradient"
                                color={badge.tone}
                                badgeContent={badge.label}
                                size="sm"
                                container
                              />
                            </TableCell>
                            <TableCell>
                              <MDTypography
                                variant="caption"
                                color={expense.receipt_path ? "text" : "error"}
                              >
                                {expense.receipt_path ? "Attached" : "Missing"}
                              </MDTypography>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </TableContainer>
              )}
            </MDBox>
          </Card>
        </>
      )}
    </PageShell>
  );
}

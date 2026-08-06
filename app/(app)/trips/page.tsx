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
import { formatCents, formatDateRange } from "@/lib/format";
import { friendlyDbError } from "@/lib/db-errors";
import PageShell from "../page-shell";

export const metadata = { title: "Trips" };

type TripListRow = {
  id: string;
  client_id: string | null;
  trip_kind: string;
  status: string;
  starts_on: string;
  ends_on: string;
  aircraft_ident: string | null;
  day_rate_cents: number;
  day_count: number;
  travel_day_count: number | null;
  travel_day_rate_cents: number | null;
  billing_state: string;
};

type TripDayValueRow = { day_type_id: string; rate_cents: number; quantity: number };

/**
 * F3: once a trip has day_days rows, createInvoiceDraft prices it from
 * THEM — summing quantity x rate_cents over the BILLABLE rows — and
 * ignores day_rate_cents/day_count/travel_day_rate_cents/
 * travel_day_count entirely. Showing the scalar total for such a trip
 * would be exactly the "two sources for one number" defect this comment
 * used to warn about while creating it: a number on screen the invoice
 * will not actually bill. Flight days AND travel days, in the scalar
 * fallback, for the same reason as before — Phase 5 drafts travel days as
 * their own invoice line.
 */
function tripValueCents(
  trip: TripListRow,
  dayRowsByTrip: Map<string, TripDayValueRow[]>,
  billableByDayType: Map<string, boolean>
): number {
  const dayRows = dayRowsByTrip.get(trip.id);
  if (dayRows && dayRows.length > 0) {
    return dayRows.reduce((sum, row) => {
      if (!billableByDayType.get(row.day_type_id)) return sum;
      return sum + Math.round(Number(row.quantity) * row.rate_cents);
    }, 0);
  }
  return (
    Math.round(trip.day_rate_cents * Number(trip.day_count)) +
    Math.round(
      (trip.travel_day_rate_cents ?? 0) * Number(trip.travel_day_count ?? 0)
    )
  );
}

type Badge = { tone: string; label: string };

const STATUS_FALLBACK: Badge = { tone: "secondary", label: "Scheduled" };
const STATUS_BADGE: Record<string, Badge> = {
  scheduled: STATUS_FALLBACK,
  in_progress: { tone: "info", label: "In progress" },
  completed: { tone: "success", label: "Completed" },
  canceled: { tone: "dark", label: "Canceled" },
};

const BILLING_FALLBACK: Badge = { tone: "warning", label: "Unbilled" };
const BILLING_BADGE: Record<string, Badge> = {
  unbilled: BILLING_FALLBACK,
  invoiced: { tone: "info", label: "Invoiced" },
  paid: { tone: "success", label: "Paid" },
  written_off: { tone: "secondary", label: "Written off" },
};

export default async function TripsPage() {
  await requireAccount("/trips");

  const supabase = await createClient();
  const [{ data: tripData, error }, { data: clientData }] = await Promise.all([
    supabase
      .from("trips")
      .select(
        "id, client_id, trip_kind, status, starts_on, ends_on, aircraft_ident, day_rate_cents, day_count, travel_day_count, travel_day_rate_cents, billing_state"
      )
      .order("starts_on", { ascending: false }),
    supabase.from("clients").select("id, name"),
  ]);

  const trips = (tripData ?? []) as TripListRow[];
  // Resolved in memory rather than as a PostgREST embed: the embed's
  // return type resolves to `never` against the hand-authored types file
  // (same reason account.ts uses two queries), and a pilot's client list
  // is small enough that the join is free.
  const clientNames = new Map(
    ((clientData ?? []) as { id: string; name: string }[]).map((c) => [c.id, c.name])
  );

  // F3: day rows for exactly the trips just listed, plus the account's
  // day-type taxonomy to know which of them are billable. Skipped
  // entirely when there are no trips — an empty `.in()` list is a query
  // with nothing to answer.
  const dayRowsByTrip = new Map<string, TripDayValueRow[]>();
  const billableByDayType = new Map<string, boolean>();
  const tripIds = trips.map((t) => t.id);
  if (tripIds.length > 0) {
    const [{ data: dayRowsData, error: dayRowsError }, { data: dayTypeData, error: dayTypeError }] =
      await Promise.all([
        supabase
          .from("trip_days")
          .select("trip_id, day_type_id, rate_cents, quantity")
          .in("trip_id", tripIds),
        supabase.from("day_types").select("id, billable"),
      ]);

    // Can't safely tell which trips have day rows without both of these —
    // guessing "no day rows, use the scalar fallback" on a fetch failure
    // could understate a trip that actually bills more through its grid.
    if (dayRowsError || dayTypeError) {
      throw new Error(
        `Couldn't load day grids for the trips list: ${
          (dayRowsError ?? dayTypeError)?.message
        }`
      );
    }

    for (const row of (dayRowsData ?? []) as (TripDayValueRow & { trip_id: string })[]) {
      const forTrip = dayRowsByTrip.get(row.trip_id) ?? [];
      forTrip.push(row);
      dayRowsByTrip.set(row.trip_id, forTrip);
    }
    for (const t of (dayTypeData ?? []) as { id: string; billable: boolean }[]) {
      billableByDayType.set(t.id, t.billable);
    }
  }

  const unbilled = trips.filter(
    (trip) => trip.billing_state === "unbilled" && trip.status === "completed"
  ).length;

  return (
    <PageShell
      title="Trips"
      subtitle={
        error
          ? "Couldn't load your trips."
          : `${trips.length} trip${trips.length === 1 ? "" : "s"}${
              unbilled ? ` · ${unbilled} flown but not yet invoiced` : ""
            }`
      }
      action={
        <MDButton
          component={NextLink}
          href="/trips/new"
          variant="gradient"
          color="info"
        >
          Log a trip
        </MDButton>
      }
    >
      <Card>
        <MDBox p={3}>
          {error ? (
            <MDTypography variant="button" color="error">
              {friendlyDbError(error, "trips.select")}
            </MDTypography>
          ) : trips.length === 0 ? (
            <MDBox py={4} textAlign="center">
              <MDTypography variant="h6">No trips yet</MDTypography>
              <MDTypography variant="button" color="text" fontWeight="regular">
                Log the trip once. Its legs feed your logbook, its days feed
                the invoice, and its expenses file themselves against it.
              </MDTypography>
              <MDBox mt={3}>
                <MDButton
                  component={NextLink}
                  href="/trips/new"
                  variant="gradient"
                  color="info"
                >
                  Log your first trip
                </MDButton>
              </MDBox>
            </MDBox>
          ) : (
            <TableContainer sx={{ boxShadow: "none" }}>
              <Table>
                <TableHead sx={{ display: "table-header-group" }}>
                  <TableRow>
                    {["Dates", "Client", "Aircraft", "Days", "Value", "Status", "Billing"].map(
                      (heading, index) => (
                        <TableCell
                          key={heading}
                          align={index === 3 || index === 4 ? "right" : "left"}
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
                  {trips.map((trip) => {
                    const status = STATUS_BADGE[trip.status] ?? STATUS_FALLBACK;
                    const billing =
                      BILLING_BADGE[trip.billing_state] ?? BILLING_FALLBACK;
                    return (
                      <TableRow key={trip.id}>
                        <TableCell component="th" scope="row">
                          <MDTypography
                            component={NextLink}
                            href={`/trips/${trip.id}`}
                            variant="button"
                            fontWeight="medium"
                          >
                            {formatDateRange(trip.starts_on, trip.ends_on)}
                          </MDTypography>
                        </TableCell>
                        <TableCell>
                          <MDTypography
                            variant="button"
                            color="text"
                            fontWeight="regular"
                          >
                            {trip.client_id
                              ? clientNames.get(trip.client_id) ?? "—"
                              : "No client"}
                          </MDTypography>
                        </TableCell>
                        <TableCell>
                          <MDTypography
                            variant="button"
                            color="text"
                            fontWeight="regular"
                          >
                            {trip.aircraft_ident ?? "—"}
                          </MDTypography>
                        </TableCell>
                        <TableCell align="right">
                          <MDTypography variant="button" fontWeight="regular">
                            {trip.day_count}
                          </MDTypography>
                        </TableCell>
                        <TableCell align="right">
                          <MDTypography variant="button" fontWeight="medium">
                            {formatCents(tripValueCents(trip, dayRowsByTrip, billableByDayType))}
                          </MDTypography>
                        </TableCell>
                        <TableCell>
                          <MDBadge
                            variant="gradient"
                            color={status.tone}
                            badgeContent={status.label}
                            size="sm"
                            container
                          />
                        </TableCell>
                        <TableCell>
                          <MDBadge
                            variant="gradient"
                            color={billing.tone}
                            badgeContent={billing.label}
                            size="sm"
                            container
                          />
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
    </PageShell>
  );
}

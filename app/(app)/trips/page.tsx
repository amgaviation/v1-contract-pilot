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

/**
 * Flight days AND travel days. Phase 5 drafts travel days as their own
 * invoice line, so omitting them here would make this column and the
 * invoice disagree about what the job is worth — the "two sources for one
 * number" defect the invoices migration warns about repeatedly.
 */
function tripValueCents(trip: TripListRow): number {
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
                            {formatCents(tripValueCents(trip))}
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

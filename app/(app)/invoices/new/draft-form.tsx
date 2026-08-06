"use client";

import { useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import NextLink from "next/link";
import Card from "@mui/material/Card";
import Grid from "@mui/material/Grid";
import TextField from "@mui/material/TextField";
import MenuItem from "@mui/material/MenuItem";
import Checkbox from "@mui/material/Checkbox";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";

import MDBox from "@/components/mdpro/MDBox";
import MDTypography from "@/components/mdpro/MDTypography";
import MDButton from "@/components/mdpro/MDButton";
import { formatCents, formatDateRange } from "@/lib/format";
import type { InvoiceFormState } from "../actions";

export type ClientOption = { id: string; name: string };

export type TripOption = {
  id: string;
  starts_on: string;
  ends_on: string;
  aircraft_ident: string | null;
  day_rate_cents: number;
  day_count: number;
  travel_day_count: number;
  travel_day_rate_cents: number | null;
  rebillable_expense_cents: number;
  estimated_value_cents: number;
  missing_travel_rate: boolean;
  /** Whether estimated_value_cents was derived from this trip's day-by-day
   * grid (pilot.trip_days) rather than day_count/day_rate_cents — shown
   * as a caption so a pilot who edited the grid understands why the
   * figure moved. */
  has_day_rows: boolean;
  /** The label of a live (non-void) invoice already billing this trip —
   * pilot.trip_committed_invoice — or null. Set when the trip's
   * billing_state still reads 'unbilled' (it only advances on an invoice
   * STATUS change) but it's already sitting on someone else's live
   * invoice, including a draft. */
  committed_invoice_label: string | null;
};

const initialState: InvoiceFormState = { error: null };

export default function DraftForm({
  action,
  clients,
  selectedClientId,
  trips,
  tripsError,
}: {
  action: (state: InvoiceFormState, formData: FormData) => Promise<InvoiceFormState>;
  clients: ClientOption[];
  selectedClientId: string;
  trips: TripOption[];
  /** Set when the trips/expenses query failed — must render as an error,
   * never as "this client has no billable trips", which is what an empty
   * array and a failed read are otherwise indistinguishable from. */
  tripsError?: string | null;
}) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(action, initialState);
  const [selectedTrips, setSelectedTrips] = useState<Set<string>>(new Set());

  function pickClient(id: string) {
    setSelectedTrips(new Set());
    router.push(id ? `/invoices/new?client=${id}` : "/invoices/new");
  }

  function toggleTrip(trip: TripOption) {
    // Defence in depth alongside the checkbox's own `disabled` — a trip
    // already committed to a live invoice elsewhere can never enter
    // selection, so a stray toggle can't put it on the submitted
    // trip_ids list regardless of how it was triggered.
    if (trip.committed_invoice_label !== null) return;
    setSelectedTrips((prev) => {
      const next = new Set(prev);
      if (next.has(trip.id)) next.delete(trip.id);
      else next.add(trip.id);
      return next;
    });
  }

  const selectedValueCents = trips
    .filter((t) => selectedTrips.has(t.id))
    .reduce((sum, t) => sum + t.estimated_value_cents, 0);

  return (
    <Card>
      <MDBox p={3} component="form" action={formAction}>
        <input type="hidden" name="client_id" value={selectedClientId} />
        {[...selectedTrips].map((id) => (
          <input key={id} type="hidden" name="trip_ids" value={id} />
        ))}

        <Grid container spacing={2}>
          <Grid item xs={12} md={6}>
            <TextField
              select
              label="Client"
              fullWidth
              value={selectedClientId}
              onChange={(event) => pickClient(event.target.value)}
              helperText={
                clients.length === 0
                  ? "No active clients yet — add one before drafting an invoice."
                  : "Who this invoice bills"
              }
            >
              <MenuItem value="">Choose a client</MenuItem>
              {clients.map((client) => (
                <MenuItem key={client.id} value={client.id}>
                  {client.name}
                </MenuItem>
              ))}
            </TextField>
          </Grid>
          <Grid item xs={12} md={3}>
            <TextField
              name="tax_rate_percent"
              label="Tax rate (%)"
              fullWidth
              inputMode="decimal"
              defaultValue={state.values?.tax_rate_percent ?? ""}
              helperText="State sales/service tax, if any"
            />
          </Grid>
        </Grid>

        {selectedClientId ? (
          <MDBox mt={4}>
            <MDBox mb={1.5} display="flex" justifyContent="space-between" alignItems="center">
              <MDTypography variant="h6">Unbilled trips</MDTypography>
              {selectedTrips.size > 0 ? (
                <MDTypography variant="button" color="text" fontWeight="regular">
                  {selectedTrips.size} selected · est. {formatCents(selectedValueCents)}
                </MDTypography>
              ) : null}
            </MDBox>

            {tripsError ? (
              <MDTypography variant="button" color="error" role="alert">
                {tripsError}
              </MDTypography>
            ) : trips.length === 0 ? (
              <MDTypography variant="button" color="text" fontWeight="regular">
                No completed, unbilled trips for this client yet.
              </MDTypography>
            ) : (
              <TableContainer sx={{ boxShadow: "none" }}>
                <Table>
                  <TableHead sx={{ display: "table-header-group" }}>
                    <TableRow>
                      <TableCell />
                      {["Dates", "Aircraft", "Flight days", "Travel days", "Rebill", "Est. value"].map(
                        (heading, index) => (
                          <TableCell key={heading} align={index >= 2 ? "right" : "left"}>
                            <MDTypography variant="caption" fontWeight="bold" textTransform="uppercase">
                              {heading}
                            </MDTypography>
                          </TableCell>
                        )
                      )}
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {trips.map((trip) => {
                      const disabled = trip.committed_invoice_label !== null;
                      return (
                        <TableRow key={trip.id} sx={disabled ? { opacity: 0.55 } : undefined}>
                          <TableCell padding="checkbox">
                            <Checkbox
                              checked={selectedTrips.has(trip.id)}
                              onChange={() => toggleTrip(trip)}
                              disabled={disabled}
                            />
                          </TableCell>
                          <TableCell>
                            <MDTypography variant="button" fontWeight="regular">
                              {formatDateRange(trip.starts_on, trip.ends_on)}
                            </MDTypography>
                            {disabled ? (
                              <MDTypography variant="caption" color="warning" display="block">
                                Already on {trip.committed_invoice_label}
                              </MDTypography>
                            ) : null}
                          </TableCell>
                          <TableCell>
                            <MDTypography variant="button" color="text" fontWeight="regular">
                              {trip.aircraft_ident ?? "—"}
                            </MDTypography>
                          </TableCell>
                          <TableCell align="right">
                            {trip.has_day_rows ? (
                              <MDTypography variant="button" color="text" fontWeight="regular">
                                From day grid
                              </MDTypography>
                            ) : (
                              <MDTypography variant="button" fontWeight="regular">
                                {trip.day_count} × {formatCents(trip.day_rate_cents)}
                              </MDTypography>
                            )}
                          </TableCell>
                          <TableCell align="right">
                            {trip.has_day_rows ? (
                              <MDTypography variant="button" color="text" fontWeight="regular">
                                —
                              </MDTypography>
                            ) : (
                              <MDTypography
                                variant="button"
                                fontWeight="regular"
                                color={trip.missing_travel_rate ? "warning" : "text"}
                              >
                                {trip.travel_day_count > 0
                                  ? trip.missing_travel_rate
                                    ? `${trip.travel_day_count} × no rate set`
                                    : `${trip.travel_day_count} × ${formatCents(
                                        trip.travel_day_rate_cents
                                      )}`
                                  : "—"}
                              </MDTypography>
                            )}
                          </TableCell>
                          <TableCell align="right">
                            <MDTypography variant="button" color="text" fontWeight="regular">
                              {trip.rebillable_expense_cents > 0
                                ? formatCents(trip.rebillable_expense_cents)
                                : "—"}
                            </MDTypography>
                          </TableCell>
                          <TableCell align="right">
                            <MDTypography variant="button" fontWeight="medium">
                              {formatCents(trip.estimated_value_cents)}
                            </MDTypography>
                            {trip.has_day_rows ? (
                              <MDTypography
                                variant="caption"
                                color="text"
                                fontWeight="regular"
                                display="block"
                                title="Priced from this trip's day-by-day grid (quantity × rate for each billable day), not the trip's flat day count/rate."
                              >
                                from day grid
                              </MDTypography>
                            ) : null}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </TableContainer>
            )}
          </MDBox>
        ) : null}

        <MDBox mt={3} role="alert" aria-live="polite">
          {state.error ? (
            <MDTypography variant="caption" color="error">
              {state.error}
            </MDTypography>
          ) : null}
        </MDBox>

        <MDBox mt={3} display="flex" gap={1.5}>
          <MDButton
            type="submit"
            variant="gradient"
            color="info"
            disabled={pending || !selectedClientId}
          >
            {pending ? "Drafting…" : "Draft invoice"}
          </MDButton>
          <MDButton component={NextLink} href="/invoices" variant="outlined" color="info">
            Cancel
          </MDButton>
        </MDBox>
      </MDBox>
    </Card>
  );
}

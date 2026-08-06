"use client";

import { useActionState, useState } from "react";
import NextLink from "next/link";
import Card from "@mui/material/Card";
import Grid from "@mui/material/Grid";
import TextField from "@mui/material/TextField";
import MenuItem from "@mui/material/MenuItem";
import MDBox from "@/components/mdpro/MDBox";
import MDTypography from "@/components/mdpro/MDTypography";
import MDButton from "@/components/mdpro/MDButton";
import { centsToInput } from "@/lib/format";
import type { TripFormState } from "./actions";

export type TripFormValues = {
  id?: string;
  client_id?: string | null;
  trip_kind?: string | null;
  status?: string | null;
  starts_on?: string | null;
  ends_on?: string | null;
  aircraft_ident?: string | null;
  aircraft_type?: string | null;
  day_rate_cents?: number | null;
  day_count?: number | null;
  travel_day_count?: number | null;
  travel_day_rate_cents?: number | null;
  notes?: string | null;
};

export type ClientOption = {
  id: string;
  name: string;
  default_day_rate_cents: number | null;
  default_travel_day_rate_cents: number | null;
};

/**
 * Labels use the industry's words, not the database's. `owner_trip` is
 * what an aircraft owner's own flight is called; "repositioning" and
 * "ferry" are distinct operations and a pilot will notice if they're
 * collapsed.
 */
const TRIP_KINDS = [
  { value: "contract_pilot", label: "Contract pilot" },
  { value: "owner_trip", label: "Owner trip" },
  { value: "repositioning", label: "Repositioning" },
  { value: "ferry", label: "Ferry" },
  { value: "maintenance_flight", label: "Maintenance flight" },
  { value: "delivery_flight", label: "Delivery flight" },
  { value: "other", label: "Other" },
];

const STATUSES = [
  { value: "scheduled", label: "Scheduled" },
  { value: "in_progress", label: "In progress" },
  { value: "completed", label: "Completed" },
  { value: "canceled", label: "Canceled" },
];

const initialState: TripFormState = { error: null };

export default function TripForm({
  action,
  clients,
  values = {},
  submitLabel,
  cancelHref = "/trips",
  locked = false,
  hasDayRows = false,
}: {
  action: (state: TripFormState, formData: FormData) => Promise<TripFormState>;
  clients: ClientOption[];
  values?: TripFormValues;
  submitLabel: string;
  cancelHref?: string;
  /** The trip is on an invoice: its money and dates are frozen. */
  locked?: boolean;
  /**
   * F3: once the trip's day grid has rows, createInvoiceDraft prices the
   * trip from THEM and ignores this section's four columns entirely — so
   * the fields below stop being "what it bills" and become the day
   * grid's own seed input. Only ever true on the edit screen (a new trip
   * has no day grid yet); defaults false so trips/new's form reads
   * exactly as it always has.
   */
  hasDayRows?: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, initialState);

  // Echoed submission wins over the row's stored values, so a rejected
  // submit shows what the pilot typed rather than silently reverting to
  // what was there before (React 19 resets the form on every dispatch).
  const submitted = state.values;
  const initial = (key: keyof TripFormValues, fallback = "") => {
    const echoed = submitted?.[key as string];
    if (echoed !== undefined) return echoed;
    const stored = values[key];
    return stored === null || stored === undefined ? fallback : String(stored);
  };

  // The rate fields are controlled ONLY so picking a client can fill them
  // in — the "defaults from the client's rate agreement" the helper text
  // promises. Without this the day rate silently posts as 0 and the trip
  // is worth nothing.
  const [clientId, setClientId] = useState(() =>
    submitted?.client_id ?? (values.client_id ?? "")
  );
  const [dayRate, setDayRate] = useState(() =>
    submitted?.day_rate ?? centsToInput(values.day_rate_cents)
  );
  const [travelRate, setTravelRate] = useState(() =>
    submitted?.travel_day_rate ?? centsToInput(values.travel_day_rate_cents)
  );

  function pickClient(nextId: string) {
    setClientId(nextId);
    const picked = clients.find((c) => c.id === nextId);
    if (!picked) return;
    // Only fills a blank field. A rate typed by hand for this specific
    // trip is a deliberate override and must not be clobbered by
    // switching the client — the schema's own comment calls the trip rate
    // "snapshotted from the client, then independently editable".
    if (dayRate.trim() === "" && picked.default_day_rate_cents !== null) {
      setDayRate(centsToInput(picked.default_day_rate_cents));
    }
    if (
      travelRate.trim() === "" &&
      picked.default_travel_day_rate_cents !== null
    ) {
      setTravelRate(centsToInput(picked.default_travel_day_rate_cents));
    }
  }

  return (
    <Card>
      <MDBox p={3} component="form" action={formAction}>
        {values.id ? <input type="hidden" name="id" value={values.id} /> : null}

        <MDBox mb={2}>
          <MDTypography variant="h6">The job</MDTypography>
        </MDBox>
        <Grid container spacing={2}>
          <Grid item xs={12} md={6}>
            <TextField
              select
              name="client_id"
              label="Client"
              fullWidth
              value={clientId}
              onChange={(event) => pickClient(event.target.value)}
              disabled={locked}
              helperText={
                clients.length === 0
                  ? "No active clients yet — you can add one later."
                  : "Who you're billing for this trip"
              }
            >
              <MenuItem value="">No client yet</MenuItem>
              {clients.map((client) => (
                <MenuItem key={client.id} value={client.id}>
                  {client.name}
                </MenuItem>
              ))}
            </TextField>
          </Grid>
          <Grid item xs={12} md={3}>
            <TextField
              select
              name="trip_kind"
              label="Trip kind"
              fullWidth
              defaultValue={initial("trip_kind", "contract_pilot")}
            >
              {TRIP_KINDS.map((option) => (
                <MenuItem key={option.value} value={option.value}>
                  {option.label}
                </MenuItem>
              ))}
            </TextField>
          </Grid>
          <Grid item xs={12} md={3}>
            <TextField
              select
              name="status"
              label="Status"
              fullWidth
              defaultValue={initial("status", "scheduled")}
            >
              {STATUSES.map((option) => (
                <MenuItem key={option.value} value={option.value}>
                  {option.label}
                </MenuItem>
              ))}
            </TextField>
          </Grid>
          <Grid item xs={12} md={3}>
            <TextField
              type="date"
              name="starts_on"
              label="Starts"
              fullWidth
              required
              disabled={locked}
              InputLabelProps={{ shrink: true }}
              defaultValue={initial("starts_on")}
            />
          </Grid>
          <Grid item xs={12} md={3}>
            <TextField
              type="date"
              name="ends_on"
              label="Ends"
              fullWidth
              required
              disabled={locked}
              InputLabelProps={{ shrink: true }}
              defaultValue={initial("ends_on")}
            />
          </Grid>
          <Grid item xs={12} md={3}>
            <TextField
              name="aircraft_ident"
              label="Tail number"
              fullWidth
              defaultValue={initial("aircraft_ident")}
            />
          </Grid>
          <Grid item xs={12} md={3}>
            <TextField
              name="aircraft_type"
              label="Aircraft type"
              fullWidth
              defaultValue={initial("aircraft_type")}
              helperText="e.g. CE-560XL"
            />
          </Grid>
        </Grid>

        <MDBox mt={4} mb={2}>
          <MDTypography
            variant="h6"
            sx={hasDayRows ? { opacity: 0.6 } : undefined}
          >
            {hasDayRows ? "What it bills (legacy)" : "What it bills"}
          </MDTypography>
          <MDTypography variant="caption" color="text" fontWeight="regular">
            {hasDayRows
              ? "The day grid below now sets what's actually billed — these fields are the old scalar input, kept only as the day grid's original seed. Editing them does not change the invoice."
              : "Seeds the day grid below the first time it's opened. Once that grid has rows, they — not these fields — are what's actually billed."}
          </MDTypography>
        </MDBox>
        <Grid
          container
          spacing={2}
          sx={hasDayRows ? { opacity: 0.6 } : undefined}
        >
          <Grid item xs={12} md={4}>
            <TextField
              name="day_rate"
              label="Day rate (USD)"
              fullWidth
              required
              inputMode="decimal"
              value={dayRate}
              onChange={(event) => setDayRate(event.target.value)}
              disabled={locked}
              helperText="Fills in from the client's rate agreement"
            />
          </Grid>
          <Grid item xs={12} md={4}>
            <TextField
              type="number"
              name="day_count"
              label="Days"
              fullWidth
              inputProps={{ step: "0.5", min: "0" }}
              defaultValue={initial("day_count")}
              disabled={locked}
              helperText="Half days are allowed"
            />
          </Grid>
          <Grid item xs={12} md={4}>
            <TextField
              name="travel_day_rate"
              label="Travel day rate (USD)"
              fullWidth
              inputMode="decimal"
              value={travelRate}
              onChange={(event) => setTravelRate(event.target.value)}
              disabled={locked}
            />
          </Grid>
          <Grid item xs={12} md={4}>
            <TextField
              type="number"
              name="travel_day_count"
              label="Travel days"
              fullWidth
              inputProps={{ step: "1", min: "0" }}
              defaultValue={initial("travel_day_count", "0")}
              disabled={locked}
              helperText="Days to and from the aircraft"
            />
          </Grid>
          <Grid item xs={12}>
            <TextField
              name="notes"
              label="Notes"
              fullWidth
              multiline
              rows={3}
              defaultValue={initial("notes")}
            />
          </Grid>
        </Grid>

        {/* role="alert" so a screen reader hears the rejection; without it
            the form silently resets and nothing is announced. */}
        <MDBox mt={3} role="alert" aria-live="polite">
          {state.error ? (
            <MDTypography variant="caption" color="error">
              {state.error}
            </MDTypography>
          ) : state.saved ? (
            <MDTypography variant="caption" color="success">
              {state.daysRemoved
                ? `Trip saved. Removed ${state.daysRemoved} day row${
                    state.daysRemoved === 1 ? "" : "s"
                  } that fell outside the new dates.`
                : "Trip saved."}
            </MDTypography>
          ) : null}
        </MDBox>

        <MDBox mt={3} display="flex" gap={1.5}>
          <MDButton
            type="submit"
            variant="gradient"
            color="info"
            disabled={pending || locked}
            title={
              locked ? "This trip is on an invoice and can't be changed." : undefined
            }
          >
            {pending ? "Saving…" : submitLabel}
          </MDButton>
          <MDButton
            component={NextLink}
            href={cancelHref}
            variant="outlined"
            color="info"
          >
            Cancel
          </MDButton>
        </MDBox>
      </MDBox>
    </Card>
  );
}

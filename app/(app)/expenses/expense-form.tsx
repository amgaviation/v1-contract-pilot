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
import type { ExpenseFormState } from "./actions";

export type ExpenseFormValues = {
  id?: string;
  incurred_on?: string | null;
  category?: string | null;
  vendor?: string | null;
  amount_cents?: number | null;
  treatment?: string | null;
  trip_id?: string | null;
  notes?: string | null;
  receipt_path?: string | null;
};

export type TripOption = {
  id: string;
  label: string;
};

/** Ported verbatim from the schema's vocabulary; labels are the pilot's. */
const CATEGORIES = [
  { value: "airline", label: "Airline" },
  { value: "hotel", label: "Hotel" },
  { value: "rental_car", label: "Rental car" },
  { value: "rideshare", label: "Rideshare" },
  { value: "fuel", label: "Fuel" },
  { value: "meals", label: "Meals" },
  { value: "parking", label: "Parking" },
  { value: "other", label: "Other" },
];

const TREATMENTS = [
  { value: "unassigned", label: "Decide later" },
  { value: "rebill", label: "Rebill to the client" },
  { value: "deduct", label: "Keep as a deduction" },
];

const initialState: ExpenseFormState = { error: null };

export default function ExpenseForm({
  action,
  trips,
  values = {},
  submitLabel,
}: {
  action: (
    state: ExpenseFormState,
    formData: FormData
  ) => Promise<ExpenseFormState>;
  trips: TripOption[];
  values?: ExpenseFormValues;
  submitLabel: string;
}) {
  const [state, formAction, pending] = useActionState(action, initialState);

  const submitted = state.values;
  const initial = (key: string, stored: unknown, fallback = "") => {
    const echoed = submitted?.[key];
    if (echoed !== undefined) return echoed;
    return stored === null || stored === undefined ? fallback : String(stored);
  };

  // Treatment and trip are controlled together: "rebill" is only
  // meaningful with a trip attached (the database refuses the pair), so
  // the trip field becomes required in front of the pilot rather than
  // after a round trip.
  const [treatment, setTreatment] = useState(() =>
    submitted?.treatment ?? (values.treatment ?? "unassigned")
  );
  const [tripId, setTripId] = useState(() =>
    submitted?.trip_id ?? (values.trip_id ?? "")
  );
  const rebilling = treatment === "rebill";

  return (
    <Card>
      <MDBox p={3} component="form" action={formAction}>
        {values.id ? <input type="hidden" name="id" value={values.id} /> : null}

        <MDBox mb={2}>
          <MDTypography variant="h6">The receipt</MDTypography>
        </MDBox>
        <Grid container spacing={2}>
          <Grid item xs={12} md={3}>
            <TextField
              type="date"
              name="incurred_on"
              label="Date"
              fullWidth
              required
              InputLabelProps={{ shrink: true }}
              defaultValue={initial("incurred_on", values.incurred_on)}
            />
          </Grid>
          <Grid item xs={12} md={3}>
            <TextField
              select
              name="category"
              label="Category"
              fullWidth
              defaultValue={initial("category", values.category, "other")}
            >
              {CATEGORIES.map((option) => (
                <MenuItem key={option.value} value={option.value}>
                  {option.label}
                </MenuItem>
              ))}
            </TextField>
          </Grid>
          <Grid item xs={12} md={3}>
            <TextField
              name="vendor"
              label="Vendor"
              fullWidth
              defaultValue={initial("vendor", values.vendor)}
              helperText="Who you paid"
            />
          </Grid>
          <Grid item xs={12} md={3}>
            <TextField
              name="amount"
              label="Amount (USD)"
              fullWidth
              required
              inputMode="decimal"
              defaultValue={initial(
                "amount",
                values.amount_cents === null || values.amount_cents === undefined
                  ? null
                  : centsToInput(values.amount_cents)
              )}
            />
          </Grid>
        </Grid>

        <MDBox mt={4} mb={2}>
          <MDTypography variant="h6">How it's treated</MDTypography>
          <MDTypography variant="button" color="text" fontWeight="regular">
            Set once, here. Nothing downstream asks again.
          </MDTypography>
        </MDBox>
        <Grid container spacing={2}>
          <Grid item xs={12} md={6}>
            <TextField
              select
              name="treatment"
              label="Treatment"
              fullWidth
              value={treatment}
              onChange={(event) => setTreatment(event.target.value)}
            >
              {TREATMENTS.map((option) => (
                <MenuItem key={option.value} value={option.value}>
                  {option.label}
                </MenuItem>
              ))}
            </TextField>
          </Grid>
          <Grid item xs={12} md={6}>
            <TextField
              select
              name="trip_id"
              label="Trip"
              fullWidth
              required={rebilling}
              value={tripId}
              onChange={(event) => setTripId(event.target.value)}
              helperText={
                rebilling
                  ? "Required — a rebilled expense has to land on an invoice"
                  : "Optional. Leave blank and it waits in the unassigned queue."
              }
            >
              <MenuItem value="">No trip</MenuItem>
              {trips.map((trip) => (
                <MenuItem key={trip.id} value={trip.id}>
                  {trip.label}
                </MenuItem>
              ))}
            </TextField>
          </Grid>
          <Grid item xs={12}>
            <TextField
              name="notes"
              label="Notes"
              fullWidth
              multiline
              rows={2}
              defaultValue={initial("notes", values.notes)}
            />
          </Grid>
        </Grid>

        <MDBox mt={4} mb={2}>
          <MDTypography variant="h6">Receipt image</MDTypography>
        </MDBox>
        <MDBox>
          {/* A plain file input: the receipt is stored privately and read
              back through a short-lived signed URL, never a public URL. */}
          <input
            type="file"
            name="receipt"
            accept="image/jpeg,image/png,image/heic,image/webp,application/pdf"
            aria-label="Receipt image or PDF"
          />
          <MDBox mt={1}>
            <MDTypography variant="caption" color="text">
              {values.receipt_path
                ? "A receipt is already attached. Choosing a file replaces it."
                : "JPEG, PNG, HEIC, WebP or PDF, up to 10 MB. Optional."}
            </MDTypography>
          </MDBox>
        </MDBox>

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
            disabled={pending}
          >
            {pending ? "Saving…" : submitLabel}
          </MDButton>
          <MDButton
            component={NextLink}
            href="/expenses"
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

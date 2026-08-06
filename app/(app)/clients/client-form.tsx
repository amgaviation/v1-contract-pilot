"use client";

import { useActionState } from "react";
import NextLink from "next/link";
import Card from "@mui/material/Card";
import Grid from "@mui/material/Grid";
import TextField from "@mui/material/TextField";
import MenuItem from "@mui/material/MenuItem";
import MDBox from "@/components/mdpro/MDBox";
import MDTypography from "@/components/mdpro/MDTypography";
import MDButton from "@/components/mdpro/MDButton";
import { centsToInput } from "@/lib/format";
import type { ClientFormState } from "./actions";

export type ClientFormValues = {
  id?: string;
  name?: string | null;
  contact_name?: string | null;
  contact_email?: string | null;
  contact_phone?: string | null;
  address_line1?: string | null;
  address_line2?: string | null;
  city?: string | null;
  state?: string | null;
  postal_code?: string | null;
  country?: string | null;
  default_day_rate_cents?: number | null;
  default_per_diem_cents?: number | null;
  default_travel_day_rate_cents?: number | null;
  payment_terms_days?: number | null;
  default_expense_treatment?: string | null;
  per_diem_mode?: string | null;
  minimum_days?: number | null;
  cancellation_policy_note?: string | null;
  w9_status?: string | null;
  notes?: string | null;
};

const TREATMENTS = [
  { value: "unassigned", label: "Decide per expense" },
  { value: "rebill", label: "Rebill to the client" },
  { value: "deduct", label: "Keep as a deduction" },
];

const PER_DIEM_MODES = [
  { value: "receipts", label: "Itemised meal receipts" },
  { value: "per_diem", label: "Per diem" },
];

const W9_STATUSES = [
  { value: "not_requested", label: "Not requested" },
  { value: "requested", label: "Requested" },
  { value: "on_file", label: "On file" },
];

const initialState: ClientFormState = { error: null };

export default function ClientForm({
  action,
  values = {},
  submitLabel,
}: {
  action: (
    state: ClientFormState,
    formData: FormData
  ) => Promise<ClientFormState>;
  values?: ClientFormValues;
  submitLabel: string;
}) {
  const [state, formAction, pending] = useActionState(action, initialState);

  // Echoed submission wins over the stored row, so a rejected submit
  // shows what the pilot typed rather than blanking every field — React
  // 19 resets an uncontrolled form on every action dispatch, error path
  // included.
  const submitted = state.values;
  const initial = (key: string, stored: unknown, fallback = "") => {
    const echoed = submitted?.[key];
    if (echoed !== undefined) return echoed;
    return stored === null || stored === undefined ? fallback : String(stored);
  };

  return (
    <Card>
      <MDBox p={3} component="form" action={formAction}>
        {values.id ? <input type="hidden" name="id" value={values.id} /> : null}

        <MDBox mb={2}>
          <MDTypography variant="h6">Who they are</MDTypography>
        </MDBox>
        <Grid container spacing={2}>
          <Grid item xs={12} md={6}>
            <TextField
              name="name"
              label="Client name"
              fullWidth
              required
              defaultValue={initial("name", values.name)}
              helperText="The name that prints on their invoices"
            />
          </Grid>
          <Grid item xs={12} md={6}>
            <TextField
              name="contact_name"
              label="Contact"
              fullWidth
              defaultValue={initial("contact_name", values.contact_name)}
            />
          </Grid>
          <Grid item xs={12} md={6}>
            <TextField
              type="email"
              name="contact_email"
              label="Contact email"
              fullWidth
              defaultValue={initial("contact_email", values.contact_email)}
              helperText="Where a platform-sent invoice goes"
            />
          </Grid>
          <Grid item xs={12} md={6}>
            <TextField
              name="contact_phone"
              label="Contact phone"
              fullWidth
              defaultValue={initial("contact_phone", values.contact_phone)}
            />
          </Grid>
        </Grid>

        <MDBox mt={4} mb={2}>
          <MDTypography variant="h6">Billing address</MDTypography>
        </MDBox>
        <Grid container spacing={2}>
          <Grid item xs={12} md={6}>
            <TextField
              name="address_line1"
              label="Address"
              fullWidth
              defaultValue={initial("address_line1", values.address_line1)}
            />
          </Grid>
          <Grid item xs={12} md={6}>
            <TextField
              name="address_line2"
              label="Address line 2"
              fullWidth
              defaultValue={initial("address_line2", values.address_line2)}
            />
          </Grid>
          <Grid item xs={12} md={4}>
            <TextField
              name="city"
              label="City"
              fullWidth
              defaultValue={initial("city", values.city)}
            />
          </Grid>
          <Grid item xs={6} md={2}>
            <TextField
              name="state"
              label="State"
              fullWidth
              defaultValue={initial("state", values.state)}
            />
          </Grid>
          <Grid item xs={6} md={3}>
            <TextField
              name="postal_code"
              label="Postal code"
              fullWidth
              defaultValue={initial("postal_code", values.postal_code)}
            />
          </Grid>
          <Grid item xs={12} md={3}>
            <TextField
              name="country"
              label="Country"
              fullWidth
              defaultValue={initial("country", values.country)}
            />
          </Grid>
        </Grid>

        <MDBox mt={4} mb={2}>
          <MDTypography variant="h6">Rate agreement</MDTypography>
          <MDTypography variant="button" color="text" fontWeight="regular">
            Defaults only — every trip can override them.
          </MDTypography>
        </MDBox>
        <Grid container spacing={2}>
          <Grid item xs={12} md={4}>
            <TextField
              name="default_day_rate"
              label="Day rate (USD)"
              fullWidth
              inputMode="decimal"
              defaultValue={initial("default_day_rate", centsToInput(values.default_day_rate_cents))}
            />
          </Grid>
          <Grid item xs={12} md={4}>
            <TextField
              name="default_per_diem"
              label="Per diem (USD)"
              fullWidth
              inputMode="decimal"
              defaultValue={initial("default_per_diem", centsToInput(values.default_per_diem_cents))}
            />
          </Grid>
          <Grid item xs={12} md={4}>
            <TextField
              name="default_travel_day_rate"
              label="Travel day rate (USD)"
              fullWidth
              inputMode="decimal"
              defaultValue={initial("default_travel_day_rate", centsToInput(values.default_travel_day_rate_cents))}
              helperText="Days getting to or from the aircraft"
            />
          </Grid>
          <Grid item xs={12} md={4}>
            <TextField
              type="number"
              name="payment_terms_days"
              label="Payment terms (days)"
              fullWidth
              defaultValue={initial("payment_terms_days", values.payment_terms_days, "30")}
              helperText="Net 30 unless you agreed otherwise"
            />
          </Grid>
          <Grid item xs={12} md={6}>
            <TextField
              select
              name="default_expense_treatment"
              label="Expenses on this client's trips"
              fullWidth
              defaultValue={initial("default_expense_treatment", values.default_expense_treatment, "unassigned")}
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
              name="w9_status"
              label="W-9"
              fullWidth
              defaultValue={initial("w9_status", values.w9_status, "not_requested")}
            >
              {W9_STATUSES.map((option) => (
                <MenuItem key={option.value} value={option.value}>
                  {option.label}
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
              rows={3}
              defaultValue={initial("notes", values.notes)}
            />
          </Grid>
        </Grid>

        <MDBox mt={4} mb={2}>
          <MDTypography variant="h6">Contract terms</MDTypography>
          <MDTypography variant="button" color="text" fontWeight="regular">
            What this client&rsquo;s agreement says beyond the rates above.
          </MDTypography>
        </MDBox>
        <Grid container spacing={2}>
          <Grid item xs={12} md={6}>
            <TextField
              select
              name="per_diem_mode"
              label="Meals"
              fullWidth
              defaultValue={initial("per_diem_mode", values.per_diem_mode, "receipts")}
              // F3: the old copy read as unconditional. Per diem only
              // reaches the invoice draft for a trip whose day grid has
              // been filled in and saved — createInvoiceDraft has no
              // per-diem count to draw on otherwise, so a trip without one
              // still falls back to expecting meal receipts regardless of
              // this setting.
              helperText="Adds a per-diem line on trips whose day grid has been filled in. A trip without one still expects meal receipts."
            >
              {PER_DIEM_MODES.map((option) => (
                <MenuItem key={option.value} value={option.value}>
                  {option.label}
                </MenuItem>
              ))}
            </TextField>
          </Grid>
          <Grid item xs={12} md={6}>
            <TextField
              name="minimum_days"
              // F4: "Contract minimum" reads, to most pilots, as the OTHER
              // minimum this industry uses — a full day rate regardless of
              // hours flown (references/contract-pilot-business.md §4) —
              // which this product already honors for free by billing in
              // whole days. What this field actually sets is the other
              // one: a floor on the total days a short TRIP bills.
              // "Trip minimum" is the unambiguous name for that.
              label="Trip minimum (days)"
              fullWidth
              inputMode="decimal"
              defaultValue={initial("minimum_days", values.minimum_days)}
              // F3 + F4: names the behavior in the same terms a pilot
              // reads their own invoice in, and states the gate — this
              // only bites once the trip's day grid has been filled in
              // and saved; a trip without one isn't held to it.
              helperText="A 1-day trip for a client with a 2-day minimum bills 2 days — once the trip's day grid has been filled in."
            />
          </Grid>
          <Grid item xs={12}>
            <TextField
              name="cancellation_policy_note"
              label="Cancellation terms"
              fullWidth
              multiline
              rows={2}
              defaultValue={initial("cancellation_policy_note", values.cancellation_policy_note)}
              helperText="Recorded for reference only — not applied automatically. Add the fee line yourself if the client owes one."
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
          ) : null}
        </MDBox>

        <MDBox mt={4} display="flex" gap={1.5}>
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
            href="/clients"
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

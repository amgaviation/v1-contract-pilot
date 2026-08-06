"use client";

import { useActionState } from "react";
import Card from "@mui/material/Card";
import Grid from "@mui/material/Grid";
import TextField from "@mui/material/TextField";
import MDBox from "@/components/mdpro/MDBox";
import MDTypography from "@/components/mdpro/MDTypography";
import MDButton from "@/components/mdpro/MDButton";
import { updateSettings, type SettingsFormState } from "./actions";

export type SettingsValues = {
  legal_name?: string | null;
  address_line1?: string | null;
  address_line2?: string | null;
  city?: string | null;
  state?: string | null;
  postal_code?: string | null;
  country?: string | null;
  invoice_prefix?: string | null;
};

const initialState: SettingsFormState = { error: null };

export default function SettingsForm({
  values,
  canEdit,
}: {
  values: SettingsValues;
  canEdit: boolean;
}) {
  const [state, formAction, pending] = useActionState(updateSettings, initialState);

  // React 19 resets an uncontrolled form on every dispatch, error path
  // included, so a rejected submit would blank every field without this.
  const submitted = state.values;
  const initial = (key: keyof SettingsValues, fallback = "") => {
    const echoed = submitted?.[key];
    if (echoed !== undefined) return echoed;
    const stored = values[key];
    return stored === null || stored === undefined ? fallback : String(stored);
  };

  return (
    <Card>
      <MDBox p={3} component="form" action={formAction}>
        <MDBox mb={2} lineHeight={1.25}>
          <MDTypography variant="h6">Your business</MDTypography>
          <MDTypography variant="button" color="text" fontWeight="regular">
            This is what prints on the invoices your clients receive.
          </MDTypography>
        </MDBox>

        <Grid container spacing={2}>
          <Grid item xs={12} md={8}>
            <TextField
              name="legal_name"
              label="Business name"
              fullWidth
              required
              disabled={!canEdit}
              defaultValue={initial("legal_name")}
              helperText="Appears as the payee on every invoice"
            />
          </Grid>
          <Grid item xs={12} md={4}>
            <TextField
              name="invoice_prefix"
              label="Invoice prefix"
              fullWidth
              disabled={!canEdit}
              defaultValue={initial("invoice_prefix", "INV")}
              helperText="Numbers already issued keep their old prefix"
            />
          </Grid>

          <Grid item xs={12} md={6}>
            <TextField
              name="address_line1"
              label="Address"
              fullWidth
              disabled={!canEdit}
              defaultValue={initial("address_line1")}
            />
          </Grid>
          <Grid item xs={12} md={6}>
            <TextField
              name="address_line2"
              label="Address line 2"
              fullWidth
              disabled={!canEdit}
              defaultValue={initial("address_line2")}
            />
          </Grid>
          <Grid item xs={12} md={4}>
            <TextField
              name="city"
              label="City"
              fullWidth
              disabled={!canEdit}
              defaultValue={initial("city")}
            />
          </Grid>
          <Grid item xs={6} md={2}>
            <TextField
              name="state"
              label="State"
              fullWidth
              disabled={!canEdit}
              defaultValue={initial("state")}
            />
          </Grid>
          <Grid item xs={6} md={3}>
            <TextField
              name="postal_code"
              label="Postal code"
              fullWidth
              disabled={!canEdit}
              defaultValue={initial("postal_code")}
            />
          </Grid>
          <Grid item xs={12} md={3}>
            <TextField
              name="country"
              label="Country"
              fullWidth
              disabled={!canEdit}
              defaultValue={initial("country")}
            />
          </Grid>
        </Grid>

        <MDBox mt={3} role="alert" aria-live="polite">
          {state.error ? (
            <MDTypography variant="caption" color="error">
              {state.error}
            </MDTypography>
          ) : state.saved ? (
            <MDTypography variant="caption" color="success">
              Saved.
            </MDTypography>
          ) : null}
        </MDBox>

        {canEdit ? (
          <MDBox mt={3}>
            <MDButton
              type="submit"
              variant="gradient"
              color="info"
              disabled={pending}
            >
              {pending ? "Saving…" : "Save changes"}
            </MDButton>
          </MDBox>
        ) : (
          <MDBox mt={3}>
            <MDTypography variant="caption" color="text">
              Only the account owner can change these.
            </MDTypography>
          </MDBox>
        )}
      </MDBox>
    </Card>
  );
}

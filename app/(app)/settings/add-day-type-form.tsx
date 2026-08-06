"use client";

import { useActionState } from "react";
import Card from "@mui/material/Card";
import Grid from "@mui/material/Grid";
import TextField from "@mui/material/TextField";
import MenuItem from "@mui/material/MenuItem";
import Switch from "@mui/material/Switch";
import MDBox from "@/components/mdpro/MDBox";
import MDTypography from "@/components/mdpro/MDTypography";
import MDButton from "@/components/mdpro/MDButton";
import { createDayType, type DayTypeFormState } from "./day-types-actions";

const initialState: DayTypeFormState = { error: null };

const LINE_TYPE_OPTIONS = [
  { value: "flight_day", label: "Flight day line" },
  { value: "travel_day", label: "Travel day line" },
  { value: "other", label: "Other line" },
] as const;

export default function AddDayTypeForm() {
  const [state, formAction, pending] = useActionState(createDayType, initialState);

  // On success no `values` are echoed, so React 19's per-dispatch form
  // reset clears the fields for the next entry. On error they ARE
  // echoed, so a rejected add doesn't lose what was typed.
  const submitted = state.values;
  const initial = (key: string, fallback = "") => submitted?.[key] ?? fallback;
  const checked = (key: string, fallback: boolean) => {
    const echoed = submitted?.[key];
    return echoed === undefined ? fallback : echoed === "on";
  };

  return (
    <Card>
      <MDBox p={3} component="form" action={formAction}>
        <MDBox mb={2} lineHeight={1.25}>
          <MDTypography variant="h6">Add a day type</MDTypography>
          <MDTypography variant="button" color="text" fontWeight="regular">
            Give it a name your trips and invoices will use. You choose
            which invoice line it bills as; that part is fixed.
          </MDTypography>
        </MDBox>

        <Grid container spacing={2} alignItems="flex-start">
          <Grid item xs={12} md={4}>
            <TextField
              name="label"
              label="Label"
              fullWidth
              required
              defaultValue={initial("label")}
              helperText="Ground school day, for example"
            />
          </Grid>
          <Grid item xs={6} md={2}>
            <MDBox display="flex" alignItems="center" gap={1} pt={1}>
              <Switch
                name="billable"
                defaultChecked={checked("billable", true)}
                inputProps={{ "aria-label": "Billable" }}
              />
              <MDTypography variant="caption" color="text">
                Billable
              </MDTypography>
            </MDBox>
          </Grid>
          <Grid item xs={6} md={2}>
            <MDBox display="flex" alignItems="center" gap={1} pt={1}>
              <Switch
                name="counts_for_per_diem"
                defaultChecked={checked("counts_for_per_diem", true)}
                inputProps={{ "aria-label": "Counts for per diem" }}
              />
              <MDTypography variant="caption" color="text">
                Per diem
              </MDTypography>
            </MDBox>
          </Grid>
          <Grid item xs={12} md={2}>
            <TextField
              name="default_rate"
              label="Default rate (USD)"
              fullWidth
              inputMode="decimal"
              defaultValue={initial("default_rate")}
              helperText="Optional"
            />
          </Grid>
          <Grid item xs={12} md={2}>
            <TextField
              select
              name="invoice_line_type"
              label="Bills as"
              fullWidth
              defaultValue={initial("invoice_line_type", "flight_day")}
            >
              {LINE_TYPE_OPTIONS.map((option) => (
                <MenuItem key={option.value} value={option.value}>
                  {option.label}
                </MenuItem>
              ))}
            </TextField>
          </Grid>
        </Grid>

        <MDBox mt={2} role="alert" aria-live="polite">
          {state.error ? (
            <MDTypography variant="caption" color="error">
              {state.error}
            </MDTypography>
          ) : state.saved ? (
            <MDTypography variant="caption" color="success">
              Added.
            </MDTypography>
          ) : null}
        </MDBox>

        <MDBox mt={2}>
          <MDButton type="submit" variant="gradient" color="info" disabled={pending}>
            {pending ? "Adding…" : "Add day type"}
          </MDButton>
        </MDBox>
      </MDBox>
    </Card>
  );
}

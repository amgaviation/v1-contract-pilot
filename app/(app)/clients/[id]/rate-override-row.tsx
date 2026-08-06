"use client";

import { useActionState } from "react";
import TextField from "@mui/material/TextField";
import MDBox from "@/components/mdpro/MDBox";
import MDTypography from "@/components/mdpro/MDTypography";
import MDButton from "@/components/mdpro/MDButton";
import { centsToInput, formatCents } from "@/lib/format";
import { setClientRateOverride, type RateOverrideFormState } from "./rate-overrides-actions";

const initialState: RateOverrideFormState = { error: null };

export default function RateOverrideRow({
  clientId,
  dayTypeId,
  label,
  archived = false,
  defaultRateCents,
  overrideRateCents,
}: {
  clientId: string;
  dayTypeId: string;
  label: string;
  /** F10: this day type is archived but kept visible because an override
   * on it still exists — see RateOverridesPanel's filtering note. */
  archived?: boolean;
  defaultRateCents: number | null;
  overrideRateCents: number | null;
}) {
  const [state, formAction, pending] = useActionState(setClientRateOverride, initialState);

  // React 19 resets an uncontrolled form on every action dispatch, error
  // path included — echo the submitted rate back so a rejected save
  // doesn't blank what was typed.
  const rateValue =
    state.values?.rate !== undefined ? state.values.rate : centsToInput(overrideRateCents);

  return (
    <MDBox
      component="form"
      action={formAction}
      display="flex"
      alignItems="flex-start"
      flexWrap="wrap"
      gap={2}
      py={1.5}
    >
      <input type="hidden" name="client_id" value={clientId} />
      <input type="hidden" name="day_type_id" value={dayTypeId} />

      <MDBox sx={{ minWidth: 180, flex: "1 1 180px" }} pt={1}>
        <MDTypography variant="button" fontWeight="medium">
          {label}
        </MDTypography>
        <MDTypography display="block" variant="caption" color="text">
          Default: {defaultRateCents === null ? "no rate agreed" : formatCents(defaultRateCents)}
        </MDTypography>
        {archived ? (
          <MDTypography display="block" variant="caption" color="warning">
            Archived — kept here only because this client still has an
            override on it
          </MDTypography>
        ) : null}
      </MDBox>

      <TextField
        name="rate"
        label="Override (USD)"
        inputMode="decimal"
        size="small"
        defaultValue={rateValue}
        helperText="Blank uses the default"
      />

      <MDButton type="submit" variant="outlined" color="info" size="small" disabled={pending}>
        {pending ? "Saving…" : "Save"}
      </MDButton>

      <MDBox role="alert" aria-live="polite" sx={{ minWidth: 80 }}>
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
    </MDBox>
  );
}

"use client";

import { useActionState } from "react";
import Card from "@mui/material/Card";
import TextField from "@mui/material/TextField";
import MDBox from "@/components/mdpro/MDBox";
import MDTypography from "@/components/mdpro/MDTypography";
import MDButton from "@/components/mdpro/MDButton";
import { BRAND } from "@/lib/brand";
import { setNewPassword, type ResetPasswordState } from "./actions";

const initialState: ResetPasswordState = { error: null };

export default function ResetPasswordForm() {
  const [state, formAction, pending] = useActionState(
    setNewPassword,
    initialState
  );

  return (
    <Card sx={{ width: "100%", maxWidth: "22rem" }}>
      <MDBox p={4} component="form" action={formAction}>
        <MDBox mb={3} textAlign="center">
          <MDTypography variant="h4" fontWeight="bold">
            {BRAND.name}
          </MDTypography>
          <MDTypography variant="button" color="text" fontWeight="regular">
            Choose a new password
          </MDTypography>
        </MDBox>

        <MDBox mb={2}>
          <TextField
            type="password"
            name="password"
            label="New password"
            fullWidth
            autoComplete="new-password"
            required
          />
        </MDBox>
        <MDBox mb={2}>
          <TextField
            type="password"
            name="confirm"
            label="Confirm new password"
            fullWidth
            autoComplete="new-password"
            required
          />
        </MDBox>

        {state.error ? (
          <MDBox mb={2}>
            <MDTypography variant="caption" color="error">
              {state.error}
            </MDTypography>
          </MDBox>
        ) : null}

        <MDBox mt={2}>
          <MDButton
            type="submit"
            variant="gradient"
            color="info"
            fullWidth
            disabled={pending}
          >
            {pending ? "Saving…" : "Save password"}
          </MDButton>
        </MDBox>
      </MDBox>
    </Card>
  );
}

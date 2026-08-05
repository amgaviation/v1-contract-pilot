"use client";

import { useActionState } from "react";
import NextLink from "next/link";
import Card from "@mui/material/Card";
import TextField from "@mui/material/TextField";
import MDBox from "@/components/mdpro/MDBox";
import MDTypography from "@/components/mdpro/MDTypography";
import MDButton from "@/components/mdpro/MDButton";
import { BRAND } from "@/lib/brand";
import { signUp, type SignUpState } from "./actions";

const initialState: SignUpState = { error: null };

export default function SignUpForm() {
  const [state, formAction, pending] = useActionState(signUp, initialState);

  if (state.needsConfirmation) {
    return (
      <Card sx={{ width: "100%", maxWidth: "22rem" }}>
        <MDBox p={4} textAlign="center" lineHeight={1.5}>
          <MDTypography variant="h5" fontWeight="bold" mb={1}>
            Check your email
          </MDTypography>
          <MDTypography variant="body2" color="text">
            Click the confirmation link we just sent, then sign in to start
            your trial.
          </MDTypography>
          <MDBox mt={3}>
            <MDButton
              component={NextLink}
              href="/login"
              variant="gradient"
              color="info"
              fullWidth
            >
              Go to sign in
            </MDButton>
          </MDBox>
        </MDBox>
      </Card>
    );
  }

  return (
    <Card sx={{ width: "100%", maxWidth: "22rem" }}>
      <MDBox p={4} component="form" action={formAction}>
        <MDBox mb={3} textAlign="center">
          <MDTypography variant="h4" fontWeight="bold">
            Start your trial
          </MDTypography>
          <MDTypography variant="button" color="text" fontWeight="regular">
            {BRAND.name} — {BRAND.descriptor}
          </MDTypography>
        </MDBox>

        <MDBox mb={2}>
          <TextField
            type="email"
            name="email"
            label="Email"
            fullWidth
            autoComplete="email"
            required
          />
        </MDBox>
        <MDBox mb={2}>
          <TextField
            type="password"
            name="password"
            label="Password"
            fullWidth
            autoComplete="new-password"
            required
            helperText="At least 8 characters"
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
            {pending ? "Creating account…" : "Create account"}
          </MDButton>
        </MDBox>

        <MDBox mt={2} textAlign="center">
          <MDTypography variant="caption" color="text">
            Already have an account?{" "}
            <MDTypography
              component={NextLink}
              href="/login"
              variant="caption"
              color="info"
              fontWeight="medium"
            >
              Sign in
            </MDTypography>
          </MDTypography>
        </MDBox>
      </MDBox>
    </Card>
  );
}

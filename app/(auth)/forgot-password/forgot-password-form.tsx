"use client";

import { useActionState } from "react";
import NextLink from "next/link";
import Card from "@mui/material/Card";
import TextField from "@mui/material/TextField";
import MDBox from "@/components/mdpro/MDBox";
import MDTypography from "@/components/mdpro/MDTypography";
import MDButton from "@/components/mdpro/MDButton";
import { BRAND } from "@/lib/brand";
import { requestPasswordReset, type ForgotPasswordState } from "./actions";

const initialState: ForgotPasswordState = { error: null, sent: false };

export default function ForgotPasswordForm({
  expired = false,
}: {
  expired?: boolean;
}) {
  const [state, formAction, pending] = useActionState(
    requestPasswordReset,
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
            Reset your password
          </MDTypography>
        </MDBox>

        {state.sent ? (
          <MDBox mb={2}>
            <MDTypography variant="button" color="text" fontWeight="regular">
              If that email has an account, a reset link is on its way. The
              link is single-use and expires shortly, so use it soon.
            </MDTypography>
          </MDBox>
        ) : (
          <>
            {expired ? (
              <MDBox mb={2}>
                <MDTypography variant="caption" color="error">
                  That reset link has expired or was already used. Request a
                  new one below.
                </MDTypography>
              </MDBox>
            ) : null}

            <MDBox mb={2}>
              <MDTypography variant="button" color="text" fontWeight="regular">
                Enter your email and we&rsquo;ll send you a link to set a new
                password.
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
                {pending ? "Sending…" : "Send reset link"}
              </MDButton>
            </MDBox>
          </>
        )}

        <MDBox mt={2} textAlign="center">
          <MDTypography
            component={NextLink}
            href="/login"
            variant="caption"
            color="info"
            fontWeight="medium"
          >
            Back to sign in
          </MDTypography>
        </MDBox>
      </MDBox>
    </Card>
  );
}

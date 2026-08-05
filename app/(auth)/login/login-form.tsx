"use client";

import { useActionState } from "react";
import Card from "@mui/material/Card";
import TextField from "@mui/material/TextField";
import MDBox from "@/components/mdpro/MDBox";
import MDTypography from "@/components/mdpro/MDTypography";
import MDButton from "@/components/mdpro/MDButton";
import { BRAND } from "@/lib/brand";
import { signIn, type SignInState } from "./actions";

const initialState: SignInState = { error: null };

export default function LoginForm({ next }: { next: string }) {
  const [state, formAction, pending] = useActionState(signIn, initialState);

  return (
    <Card sx={{ width: "100%", maxWidth: "22rem" }}>
      <MDBox p={4} component="form" action={formAction}>
        <MDBox mb={3} textAlign="center">
          <MDTypography variant="h4" fontWeight="bold">
            {BRAND.name}
          </MDTypography>
          <MDTypography variant="button" color="text" fontWeight="regular">
            {BRAND.descriptor}
          </MDTypography>
        </MDBox>

        <input type="hidden" name="next" value={next} />

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
            autoComplete="current-password"
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
            {pending ? "Signing in…" : "Sign in"}
          </MDButton>
        </MDBox>
      </MDBox>
    </Card>
  );
}

"use client";

import { useActionState } from "react";
import MDBox from "@/components/mdpro/MDBox";
import MDTypography from "@/components/mdpro/MDTypography";
import MDButton from "@/components/mdpro/MDButton";
import { startCheckout, type CheckoutState } from "./actions";

const initialState: CheckoutState = { error: null };

export function StartTrialButton({ priceLabel }: { priceLabel: string }) {
  const [state, formAction, pending] = useActionState(
    startCheckout,
    initialState
  );

  return (
    <MDBox>
      <form action={formAction}>
        <MDButton
          type="submit"
          variant="gradient"
          color="info"
          fullWidth
          disabled={pending}
        >
          {pending ? "Opening checkout…" : "Start your 7-day trial"}
        </MDButton>
      </form>
      <MDBox mt={1}>
        <MDTypography variant="caption" color="text">
          {priceLabel} after the trial. Card required now, cancel anytime.
        </MDTypography>
      </MDBox>
      {state.error ? (
        <MDBox mt={2}>
          <MDTypography variant="caption" color="error">
            {state.error}
          </MDTypography>
        </MDBox>
      ) : null}
    </MDBox>
  );
}

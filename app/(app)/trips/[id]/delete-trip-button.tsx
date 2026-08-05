"use client";

import { useState, useTransition } from "react";
import MDBox from "@/components/mdpro/MDBox";
import MDTypography from "@/components/mdpro/MDTypography";
import MDButton from "@/components/mdpro/MDButton";
import { deleteTrip } from "../actions";

/**
 * Delete, not archive — a trip has no archived state, and an
 * accidentally-logged trip should leave nothing behind. Disabled once the
 * trip has been invoiced: the invoice's lines reference it, and Phase 5's
 * triggers refuse to let billed work vanish out from under a document
 * that has already gone to a client.
 */
export default function DeleteTripButton({
  id,
  disabled,
}: {
  id: string;
  disabled: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <MDBox textAlign="right">
      <MDButton
        variant="outlined"
        color="error"
        disabled={disabled || pending}
        title={disabled ? "This trip has been invoiced and can't be deleted." : undefined}
        onClick={() => {
          if (!window.confirm("Delete this trip and its legs? This can't be undone.")) {
            return;
          }
          startTransition(async () => {
            // A successful delete redirects and never returns, so anything
            // that comes back is a failure worth showing.
            const result = await deleteTrip(id);
            setError(result?.error ?? null);
          });
        }}
      >
        {pending ? "Deleting…" : "Delete trip"}
      </MDButton>
      {error ? (
        <MDBox mt={1}>
          <MDTypography variant="caption" color="error">
            {error}
          </MDTypography>
        </MDBox>
      ) : null}
    </MDBox>
  );
}

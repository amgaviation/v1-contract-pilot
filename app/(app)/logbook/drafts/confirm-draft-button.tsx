"use client";

import { useState, useTransition } from "react";
import MDBox from "@/components/mdpro/MDBox";
import MDTypography from "@/components/mdpro/MDTypography";
import MDButton from "@/components/mdpro/MDButton";
import { confirmLegDraft, confirmTripDrafts } from "../actions";

/**
 * The one and only UI path that writes a source='trip' logbook_entries
 * row. Both buttons re-read the trip/leg on the server before inserting
 * (see actions.ts) — this component just triggers that and shows the
 * result; it never sends flight numbers of its own.
 */
export function ConfirmLegButton({ tripLegId, label }: { tripLegId: string; label: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  if (done) {
    return (
      <MDTypography variant="caption" color="success" fontWeight="bold">
        Confirmed
      </MDTypography>
    );
  }

  return (
    <MDBox textAlign="right">
      <MDButton
        variant="outlined"
        color="info"
        size="small"
        disabled={pending}
        aria-label={`Confirm leg ${label}`}
        onClick={() =>
          startTransition(async () => {
            const result = await confirmLegDraft(tripLegId);
            if (result.error) setError(result.error);
            else setDone(true);
          })
        }
      >
        {pending ? "Confirming…" : "Confirm"}
      </MDButton>
      {error ? (
        <MDTypography display="block" variant="caption" color="error" role="alert">
          {error}
        </MDTypography>
      ) : null}
    </MDBox>
  );
}

export function ConfirmTripButton({ tripId, legCount }: { tripId: string; legCount: number }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  if (done) {
    return (
      <MDTypography variant="caption" color="success" fontWeight="bold">
        All confirmed
      </MDTypography>
    );
  }

  return (
    <MDBox>
      <MDButton
        variant="gradient"
        color="info"
        size="small"
        disabled={pending}
        aria-label={`Confirm all ${legCount} leg${legCount === 1 ? "" : "s"}`}
        onClick={() =>
          startTransition(async () => {
            const result = await confirmTripDrafts(tripId);
            if (result.error) setError(result.error);
            else setDone(true);
          })
        }
      >
        {pending ? "Confirming…" : `Confirm all ${legCount} leg${legCount === 1 ? "" : "s"}`}
      </MDButton>
      {error ? (
        <MDBox mt={1} role="alert">
          <MDTypography variant="caption" color="error">
            {error}
          </MDTypography>
        </MDBox>
      ) : null}
    </MDBox>
  );
}

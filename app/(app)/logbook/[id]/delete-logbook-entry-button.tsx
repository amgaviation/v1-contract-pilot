"use client";

import { useState, useTransition } from "react";
import MDBox from "@/components/mdpro/MDBox";
import MDTypography from "@/components/mdpro/MDTypography";
import MDButton from "@/components/mdpro/MDButton";
import { deleteLogbookEntry } from "../actions";

export default function DeleteLogbookEntryButton({ id }: { id: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <MDBox textAlign="right">
      <MDButton
        variant="outlined"
        color="error"
        disabled={pending}
        onClick={() => {
          if (!window.confirm("Delete this logbook entry? This can't be undone.")) {
            return;
          }
          startTransition(async () => {
            // A successful delete redirects and never returns, so anything
            // that comes back is a failure worth showing.
            const result = await deleteLogbookEntry(id);
            setError(result?.error ?? null);
          });
        }}
      >
        {pending ? "Deleting…" : "Delete entry"}
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

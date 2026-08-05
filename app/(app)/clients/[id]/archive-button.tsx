"use client";

import { useState, useTransition } from "react";
import MDBox from "@/components/mdpro/MDBox";
import MDTypography from "@/components/mdpro/MDTypography";
import MDButton from "@/components/mdpro/MDButton";
import { setClientArchived } from "../actions";

/**
 * Archive / restore. Deliberately not a delete: `pilot.trips` references
 * a client ON DELETE RESTRICT, so a client who has ever flown is not
 * deletable — and shouldn't be, since that history is what the invoices
 * were built from.
 */
export default function ArchiveButton({
  id,
  archived,
}: {
  id: string;
  archived: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <MDBox textAlign="right">
      <MDButton
        variant="outlined"
        color={archived ? "info" : "error"}
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await setClientArchived(id, !archived);
            setError(result.error);
          })
        }
      >
        {pending ? "Working…" : archived ? "Restore client" : "Archive client"}
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

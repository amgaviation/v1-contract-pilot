"use client";

import { useState, useTransition } from "react";
import TextField from "@mui/material/TextField";
import MenuItem from "@mui/material/MenuItem";
import MDBox from "@/components/mdpro/MDBox";
import MDTypography from "@/components/mdpro/MDTypography";
import MDButton from "@/components/mdpro/MDButton";
import { fileExpense } from "./actions";

export type QueueRow = {
  id: string;
  label: string;
  detail: string;
  tripId: string | null;
};

export type QueueTrip = { id: string; label: string };

/**
 * Files one receipt without leaving the page. The queue's whole purpose
 * is that these receipts are currently earning the pilot nothing in
 * either direction, so the fix has to be two clicks — sending them
 * through the full edit form for a decision this small is what leaves the
 * queue permanently full.
 */
function QueueItem({ row, trips }: { row: QueueRow; trips: QueueTrip[] }) {
  const [tripId, setTripId] = useState(row.tripId ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function file(treatment: "rebill" | "deduct") {
    setError(null);
    startTransition(async () => {
      const result = await fileExpense(row.id, tripId, treatment);
      setError(result.error);
    });
  }

  return (
    <MDBox component="li" py={1.5}>
      <MDBox
        display="flex"
        flexDirection={{ xs: "column", md: "row" }}
        justifyContent="space-between"
        alignItems={{ xs: "stretch", md: "center" }}
        gap={2}
      >
        <MDBox lineHeight={1.4}>
          <MDTypography display="block" variant="button" fontWeight="medium">
            {row.label}
          </MDTypography>
          <MDTypography display="block" variant="caption" color="text">
            {row.detail}
          </MDTypography>
        </MDBox>

        <MDBox display="flex" gap={1.5} alignItems="center" flexWrap="wrap">
          <TextField
            select
            size="small"
            label="Trip"
            value={tripId}
            onChange={(event) => setTripId(event.target.value)}
            sx={{ minWidth: "14rem" }}
            aria-label={`Trip for ${row.label}`}
          >
            <MenuItem value="">No trip</MenuItem>
            {trips.map((trip) => (
              <MenuItem key={trip.id} value={trip.id}>
                {trip.label}
              </MenuItem>
            ))}
          </TextField>

          <MDButton
            variant="outlined"
            color="info"
            size="small"
            // Rebill needs a trip — the database refuses the pair
            // outright, so the control refuses it first.
            disabled={pending || tripId === ""}
            onClick={() => file("rebill")}
            aria-label={`Rebill ${row.label} to the client`}
          >
            Rebill
          </MDButton>
          <MDButton
            variant="outlined"
            color="success"
            size="small"
            disabled={pending}
            onClick={() => file("deduct")}
            aria-label={`Keep ${row.label} as a deduction`}
          >
            Deduct
          </MDButton>
        </MDBox>
      </MDBox>

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

export default function UnassignedQueue({
  rows,
  trips,
}: {
  rows: QueueRow[];
  trips: QueueTrip[];
}) {
  return (
    <MDBox component="ul" sx={{ listStyle: "none", m: 0, p: 0 }}>
      {rows.map((row) => (
        <QueueItem key={row.id} row={row} trips={trips} />
      ))}
    </MDBox>
  );
}

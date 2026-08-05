"use client";

import { useActionState, useState, useTransition } from "react";
import Grid from "@mui/material/Grid";
import TextField from "@mui/material/TextField";
import MDBox from "@/components/mdpro/MDBox";
import MDTypography from "@/components/mdpro/MDTypography";
import MDButton from "@/components/mdpro/MDButton";
import { formatDate } from "@/lib/format";
import { addLeg, deleteLeg, type LegFormState } from "./actions";

const initialState: LegFormState = { error: null };

export type LegRow = {
  id: string;
  leg_date: string;
  from_icao: string | null;
  to_icao: string | null;
  block_hours: number | null;
  night_hours: number | null;
  instrument_hours: number | null;
  day_landings: number;
  night_takeoffs: number;
  night_landings_full_stop: number;
  night_landings_touch_go: number;
  approaches: number;
  holds: number;
};

function DeleteLegButton({
  id,
  tripId,
  label,
}: {
  id: string;
  tripId: string;
  /** Distinguishes this button from every other "Remove" on the page. */
  label: string;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <MDBox textAlign="right">
      <MDButton
        variant="text"
        color="error"
        size="small"
        disabled={pending}
        aria-label={`Remove leg ${label}`}
        onClick={() =>
          startTransition(async () => {
            const result = await deleteLeg(id, tripId);
            setError(result.error);
          })
        }
      >
        {pending ? "Removing…" : "Remove"}
      </MDButton>
      {error ? (
        <MDTypography display="block" variant="caption" color="error">
          {error}
        </MDTypography>
      ) : null}
    </MDBox>
  );
}

/**
 * Legs are captured one at a time rather than as an editable grid. A leg
 * carries the currency-relevant counts (night takeoffs, full-stop vs
 * touch-and-go night landings, approaches, holds) that FAR 61.57 is
 * computed from, and those are worth typing deliberately once rather than
 * tabbing past in a dense table.
 *
 * The full-stop / touch-and-go split is not a nicety: 61.57(b) requires
 * night landings **to a full stop**, and a logbook that records only a
 * total night-landing count cannot answer the question at all.
 */
export default function LegEditor({
  tripId,
  legs,
  defaultDate,
}: {
  tripId: string;
  legs: LegRow[];
  defaultDate: string;
}) {
  const [state, formAction, pending] = useActionState(addLeg, initialState);

  return (
    <MDBox>
      {legs.length === 0 ? (
        <MDBox pb={3}>
          <MDTypography variant="button" color="text" fontWeight="regular">
            No legs yet. Add them as you fly — they become the route on the
            invoice and the draft entries for your logbook.
          </MDTypography>
        </MDBox>
      ) : (
        <MDBox pb={2} component="ul" sx={{ listStyle: "none", m: 0, p: 0 }}>
          {legs.map((leg) => (
            <MDBox
              key={leg.id}
              component="li"
              display="flex"
              justifyContent="space-between"
              alignItems="flex-start"
              py={1.5}
            >
              <MDBox lineHeight={1.4}>
                <MDTypography display="block" variant="button" fontWeight="medium">
                  {leg.from_icao ?? "—"} → {leg.to_icao ?? "—"}
                </MDTypography>
                <MDTypography display="block" variant="caption" color="text">
                  {formatDate(leg.leg_date)}
                  {leg.block_hours ? ` · ${leg.block_hours} block` : ""}
                  {leg.night_hours ? ` · ${leg.night_hours} night` : ""}
                  {leg.instrument_hours ? ` · ${leg.instrument_hours} inst` : ""}
                </MDTypography>
                <MDTypography display="block" variant="caption" color="text">
                  {leg.day_landings} day ldg · {leg.night_takeoffs} night T/O ·{" "}
                  {leg.night_landings_full_stop} night full-stop ·{" "}
                  {leg.night_landings_touch_go} night T&amp;G ·{" "}
                  {leg.approaches} appr · {leg.holds} hold
                </MDTypography>
              </MDBox>
              <DeleteLegButton
                id={leg.id}
                tripId={tripId}
                label={`${leg.from_icao ?? "?"} to ${leg.to_icao ?? "?"} on ${formatDate(leg.leg_date)}`}
              />
            </MDBox>
          ))}
        </MDBox>
      )}

      {/* React 19 resets an uncontrolled form after a form action
          completes, so the fields clear on their own once a leg is added —
          no manual reset, and none of the races one would bring. */}
      <MDBox component="form" action={formAction} pt={2}>
        <input type="hidden" name="trip_id" value={tripId} />
        <MDBox mb={2}>
          <MDTypography variant="button" fontWeight="medium">
            Add a leg
          </MDTypography>
        </MDBox>
        <Grid container spacing={2}>
          <Grid item xs={12} md={3}>
            <TextField
              type="date"
              name="leg_date"
              label="Date"
              fullWidth
              required
              InputLabelProps={{ shrink: true }}
              defaultValue={defaultDate}
            />
          </Grid>
          <Grid item xs={6} md={2}>
            <TextField name="from_icao" label="From" fullWidth placeholder="KBED" />
          </Grid>
          <Grid item xs={6} md={2}>
            <TextField name="to_icao" label="To" fullWidth placeholder="KTEB" />
          </Grid>
          <Grid item xs={4} md={2}>
            <TextField
              type="number"
              name="block_hours"
              label="Block"
              fullWidth
              inputProps={{ step: "0.1", min: "0" }}
            />
          </Grid>
          <Grid item xs={4} md={2}>
            <TextField
              type="number"
              name="night_hours"
              label="Night"
              fullWidth
              inputProps={{ step: "0.1", min: "0" }}
            />
          </Grid>
          <Grid item xs={4} md={2}>
            <TextField
              type="number"
              name="instrument_hours"
              label="Instrument"
              fullWidth
              inputProps={{ step: "0.1", min: "0" }}
            />
          </Grid>

          <Grid item xs={6} md={2}>
            <TextField
              type="number"
              name="day_landings"
              label="Day landings"
              fullWidth
              defaultValue={0}
              inputProps={{ step: "1", min: "0" }}
            />
          </Grid>
          <Grid item xs={6} md={2}>
            <TextField
              type="number"
              name="night_takeoffs"
              label="Night takeoffs"
              fullWidth
              defaultValue={0}
              inputProps={{ step: "1", min: "0" }}
            />
          </Grid>
          <Grid item xs={6} md={2}>
            <TextField
              type="number"
              name="night_landings_full_stop"
              label="Night full-stop"
              fullWidth
              defaultValue={0}
              inputProps={{ step: "1", min: "0" }}
              helperText="Counts for 61.57(b)"
            />
          </Grid>
          <Grid item xs={6} md={2}>
            <TextField
              type="number"
              name="night_landings_touch_go"
              label="Night touch & go"
              fullWidth
              defaultValue={0}
              inputProps={{ step: "1", min: "0" }}
            />
          </Grid>
          <Grid item xs={6} md={2}>
            <TextField
              type="number"
              name="approaches"
              label="Approaches"
              fullWidth
              defaultValue={0}
              inputProps={{ step: "1", min: "0" }}
            />
          </Grid>
          <Grid item xs={6} md={2}>
            <TextField
              type="number"
              name="holds"
              label="Holds"
              fullWidth
              defaultValue={0}
              inputProps={{ step: "1", min: "0" }}
            />
          </Grid>
        </Grid>

        <MDBox mt={2} role="alert" aria-live="polite">
          {state.error ? (
            <MDTypography variant="caption" color="error">
              {state.error}
            </MDTypography>
          ) : null}
        </MDBox>

        <MDBox mt={3}>
          <MDButton type="submit" variant="outlined" color="info" disabled={pending}>
            {pending ? "Adding…" : "Add leg"}
          </MDButton>
        </MDBox>
      </MDBox>
    </MDBox>
  );
}

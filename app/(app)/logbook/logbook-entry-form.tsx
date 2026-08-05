"use client";

import { useActionState } from "react";
import NextLink from "next/link";
import Card from "@mui/material/Card";
import Grid from "@mui/material/Grid";
import TextField from "@mui/material/TextField";
import MenuItem from "@mui/material/MenuItem";
import MDBox from "@/components/mdpro/MDBox";
import MDTypography from "@/components/mdpro/MDTypography";
import MDButton from "@/components/mdpro/MDButton";
import type { LogbookFormState } from "./actions";

export type LogbookEntryFormValues = {
  id?: string;
  entry_date?: string | null;
  aircraft_ident?: string | null;
  aircraft_type?: string | null;
  from_icao?: string | null;
  to_icao?: string | null;
  role?: string | null;
  total_time?: number | null;
  pic_time?: number | null;
  sic_time?: number | null;
  solo_time?: number | null;
  cross_country_time?: number | null;
  night_time?: number | null;
  instrument_actual_time?: number | null;
  instrument_simulated_time?: number | null;
  flight_instructor_time?: number | null;
  dual_received_time?: number | null;
  simulator_time?: number | null;
  simulator_device_type?: string | null;
  day_landings_full_stop?: number | null;
  day_landings_touch_go?: number | null;
  night_takeoffs?: number | null;
  night_landings_full_stop?: number | null;
  night_landings_touch_go?: number | null;
  approaches_count?: number | null;
  approach_type?: string | null;
  holds?: number | null;
  remarks?: string | null;
};

const ROLES = [
  { value: "PIC", label: "PIC" },
  { value: "SIC", label: "SIC" },
];

const SIMULATOR_DEVICES = [
  { value: "", label: "N/A" },
  { value: "ftd", label: "FTD" },
  { value: "atd", label: "ATD" },
  { value: "other", label: "Other device" },
];

const APPROACH_TYPES = [
  { value: "", label: "Not recorded" },
  { value: "ils", label: "ILS" },
  { value: "rnav_lpv", label: "RNAV (LPV)" },
  { value: "rnav_lnav", label: "RNAV (LNAV)" },
  { value: "vor", label: "VOR" },
  { value: "loc", label: "LOC" },
  { value: "ndb", label: "NDB" },
  { value: "visual", label: "Visual" },
  { value: "other", label: "Other" },
];

const initialState: LogbookFormState = { error: null };

/**
 * Shared by /logbook/new (manual create) and /logbook/[id] (edit, any
 * source). It only ever writes flight-data columns — source, trip linkage
 * and import lineage are never form fields, because they aren't in the
 * UPDATE grant and createLogbookEntry sets them itself. See actions.ts.
 */
export default function LogbookEntryForm({
  action,
  values = {},
  submitLabel,
  provenanceNote,
}: {
  action: (state: LogbookFormState, formData: FormData) => Promise<LogbookFormState>;
  values?: LogbookEntryFormValues;
  submitLabel: string;
  /** Read-only context shown above the form, e.g. "Confirmed from a trip on 12 AUG 2026". */
  provenanceNote?: string;
}) {
  const [state, formAction, pending] = useActionState(action, initialState);

  // Echoed submission wins over the row's stored values — React 19 resets
  // an uncontrolled form on every dispatch, including a rejected one.
  const submitted = state.values;
  const initial = (key: keyof LogbookEntryFormValues, fallback = "") => {
    const echoed = submitted?.[key as string];
    if (echoed !== undefined) return echoed;
    const stored = values[key];
    return stored === null || stored === undefined ? fallback : String(stored);
  };

  return (
    <Card>
      <MDBox p={3} component="form" action={formAction}>
        {values.id ? <input type="hidden" name="id" value={values.id} /> : null}

        {provenanceNote ? (
          <MDBox mb={3}>
            <MDTypography variant="caption" color="text" fontWeight="regular">
              {provenanceNote}
            </MDTypography>
          </MDBox>
        ) : null}

        <MDBox mb={2}>
          <MDTypography variant="h6">The flight</MDTypography>
        </MDBox>
        <Grid container spacing={2}>
          <Grid item xs={12} md={3}>
            <TextField
              type="date"
              name="entry_date"
              label="Date"
              fullWidth
              required
              InputLabelProps={{ shrink: true }}
              defaultValue={initial("entry_date")}
            />
          </Grid>
          <Grid item xs={6} md={3}>
            <TextField
              name="aircraft_ident"
              label="Tail number"
              fullWidth
              defaultValue={initial("aircraft_ident")}
            />
          </Grid>
          <Grid item xs={6} md={3}>
            <TextField
              name="aircraft_type"
              label="Aircraft type"
              fullWidth
              defaultValue={initial("aircraft_type")}
              helperText="e.g. CE-560XL"
            />
          </Grid>
          <Grid item xs={6} md={1.5}>
            <TextField name="from_icao" label="From" fullWidth placeholder="KBED" defaultValue={initial("from_icao")} />
          </Grid>
          <Grid item xs={6} md={1.5}>
            <TextField name="to_icao" label="To" fullWidth placeholder="KTEB" defaultValue={initial("to_icao")} />
          </Grid>
          <Grid item xs={12} md={3}>
            <TextField
              select
              name="role"
              label="Role"
              fullWidth
              defaultValue={initial("role", "PIC")}
              helperText="PIC or SIC for this flight"
            >
              {ROLES.map((option) => (
                <MenuItem key={option.value} value={option.value}>
                  {option.label}
                </MenuItem>
              ))}
            </TextField>
          </Grid>
        </Grid>

        <MDBox mt={4} mb={2}>
          <MDTypography variant="h6">Time (hours, tenths)</MDTypography>
        </MDBox>
        <Grid container spacing={2}>
          <Grid item xs={6} md={2}>
            <TextField
              type="number"
              name="total_time"
              label="Total time"
              fullWidth
              required
              inputProps={{ step: "0.1", min: "0" }}
              defaultValue={initial("total_time")}
            />
          </Grid>
          <Grid item xs={6} md={2}>
            <TextField
              type="number"
              name="pic_time"
              label="PIC"
              fullWidth
              inputProps={{ step: "0.1", min: "0" }}
              defaultValue={initial("pic_time")}
            />
          </Grid>
          <Grid item xs={6} md={2}>
            <TextField
              type="number"
              name="sic_time"
              label="SIC"
              fullWidth
              inputProps={{ step: "0.1", min: "0" }}
              defaultValue={initial("sic_time")}
            />
          </Grid>
          <Grid item xs={6} md={2}>
            <TextField
              type="number"
              name="solo_time"
              label="Solo"
              fullWidth
              inputProps={{ step: "0.1", min: "0" }}
              defaultValue={initial("solo_time")}
            />
          </Grid>
          <Grid item xs={6} md={2}>
            <TextField
              type="number"
              name="cross_country_time"
              label="Cross-country"
              fullWidth
              inputProps={{ step: "0.1", min: "0" }}
              defaultValue={initial("cross_country_time")}
            />
          </Grid>
          <Grid item xs={6} md={2}>
            <TextField
              type="number"
              name="night_time"
              label="Night"
              fullWidth
              inputProps={{ step: "0.1", min: "0" }}
              defaultValue={initial("night_time")}
            />
          </Grid>
          <Grid item xs={6} md={2}>
            <TextField
              type="number"
              name="instrument_actual_time"
              label="Instrument, actual"
              fullWidth
              inputProps={{ step: "0.1", min: "0" }}
              defaultValue={initial("instrument_actual_time")}
            />
          </Grid>
          <Grid item xs={6} md={2}>
            <TextField
              type="number"
              name="instrument_simulated_time"
              label="Instrument, hood/sim"
              fullWidth
              inputProps={{ step: "0.1", min: "0" }}
              defaultValue={initial("instrument_simulated_time")}
            />
          </Grid>
          <Grid item xs={6} md={2}>
            <TextField
              type="number"
              name="flight_instructor_time"
              label="CFI given"
              fullWidth
              inputProps={{ step: "0.1", min: "0" }}
              defaultValue={initial("flight_instructor_time")}
            />
          </Grid>
          <Grid item xs={6} md={2}>
            <TextField
              type="number"
              name="dual_received_time"
              label="Dual received"
              fullWidth
              inputProps={{ step: "0.1", min: "0" }}
              defaultValue={initial("dual_received_time")}
            />
          </Grid>
          <Grid item xs={6} md={2}>
            <TextField
              type="number"
              name="simulator_time"
              label="Simulator / FTD / ATD"
              fullWidth
              inputProps={{ step: "0.1", min: "0" }}
              defaultValue={initial("simulator_time")}
            />
          </Grid>
          <Grid item xs={6} md={2}>
            <TextField
              select
              name="simulator_device_type"
              label="Device type"
              fullWidth
              defaultValue={initial("simulator_device_type", "")}
              helperText="Required if sim time > 0"
            >
              {SIMULATOR_DEVICES.map((option) => (
                <MenuItem key={option.value} value={option.value}>
                  {option.label}
                </MenuItem>
              ))}
            </TextField>
          </Grid>
        </Grid>

        <MDBox mt={4} mb={2}>
          <MDTypography variant="h6">Landings, approaches, holds</MDTypography>
        </MDBox>
        <Grid container spacing={2}>
          <Grid item xs={6} md={2}>
            <TextField
              type="number"
              name="day_landings_full_stop"
              label="Day full-stop"
              fullWidth
              inputProps={{ step: "1", min: "0" }}
              defaultValue={initial("day_landings_full_stop", "0")}
            />
          </Grid>
          <Grid item xs={6} md={2}>
            <TextField
              type="number"
              name="day_landings_touch_go"
              label="Day touch & go"
              fullWidth
              inputProps={{ step: "1", min: "0" }}
              defaultValue={initial("day_landings_touch_go", "0")}
            />
          </Grid>
          <Grid item xs={6} md={2}>
            <TextField
              type="number"
              name="night_takeoffs"
              label="Night takeoffs"
              fullWidth
              inputProps={{ step: "1", min: "0" }}
              defaultValue={initial("night_takeoffs", "0")}
            />
          </Grid>
          <Grid item xs={6} md={2}>
            <TextField
              type="number"
              name="night_landings_full_stop"
              label="Night full-stop"
              fullWidth
              inputProps={{ step: "1", min: "0" }}
              defaultValue={initial("night_landings_full_stop", "0")}
              helperText="Counts for 61.57(b)"
            />
          </Grid>
          <Grid item xs={6} md={2}>
            <TextField
              type="number"
              name="night_landings_touch_go"
              label="Night touch & go"
              fullWidth
              inputProps={{ step: "1", min: "0" }}
              defaultValue={initial("night_landings_touch_go", "0")}
            />
          </Grid>
          <Grid item xs={6} md={2}>
            <TextField
              type="number"
              name="holds"
              label="Holds"
              fullWidth
              inputProps={{ step: "1", min: "0" }}
              defaultValue={initial("holds", "0")}
            />
          </Grid>
          <Grid item xs={6} md={3}>
            <TextField
              type="number"
              name="approaches_count"
              label="Approaches"
              fullWidth
              inputProps={{ step: "1", min: "0" }}
              defaultValue={initial("approaches_count", "0")}
              helperText="Counts for 61.57(c)"
            />
          </Grid>
          <Grid item xs={12} md={4}>
            <TextField
              select
              name="approach_type"
              label="Approach type"
              fullWidth
              defaultValue={initial("approach_type", "")}
              helperText="If the source gives you one"
            >
              {APPROACH_TYPES.map((option) => (
                <MenuItem key={option.value} value={option.value}>
                  {option.label}
                </MenuItem>
              ))}
            </TextField>
          </Grid>
        </Grid>

        <MDBox mt={4} mb={2}>
          <TextField
            name="remarks"
            label="Remarks"
            fullWidth
            multiline
            rows={2}
            defaultValue={initial("remarks")}
          />
        </MDBox>

        {/* role="alert" so a screen reader hears the rejection; the form
            resets on every dispatch and nothing else announces it. */}
        <MDBox mt={1} role="alert" aria-live="polite">
          {state.error ? (
            <MDTypography variant="caption" color="error">
              {state.error}
            </MDTypography>
          ) : null}
        </MDBox>

        <MDBox mt={3} display="flex" gap={1.5}>
          <MDButton type="submit" variant="gradient" color="info" disabled={pending}>
            {pending ? "Saving…" : submitLabel}
          </MDButton>
          <MDButton component={NextLink} href="/logbook" variant="outlined" color="info">
            Cancel
          </MDButton>
        </MDBox>
      </MDBox>
    </Card>
  );
}

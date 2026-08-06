"use client";

import { useActionState, useState, useTransition } from "react";
import Card from "@mui/material/Card";
import Grid from "@mui/material/Grid";
import TextField from "@mui/material/TextField";
import MenuItem from "@mui/material/MenuItem";
import Switch from "@mui/material/Switch";
import MDBox from "@/components/mdpro/MDBox";
import MDTypography from "@/components/mdpro/MDTypography";
import MDButton from "@/components/mdpro/MDButton";
import { centsToInput } from "@/lib/format";
import type { Database } from "@/lib/supabase/database.types";
import {
  updateDayType,
  setDayTypeArchived,
  deleteDayType,
  type DayTypeFormState,
} from "./day-types-actions";

type DayTypeRowValue = Database["pilot"]["Tables"]["day_types"]["Row"];

const initialState: DayTypeFormState = { error: null };

const LINE_TYPE_OPTIONS = [
  { value: "flight_day", label: "Flight day line" },
  { value: "travel_day", label: "Travel day line" },
  { value: "other", label: "Other line" },
] as const;

/**
 * One day type, editable in place. Save/rename/rate/bills-as/order share
 * a single form; archive and delete are separate immediate actions (not
 * form fields), each with its own pending state, so a slow archive click
 * can't be confused with a slow save.
 */
export default function DayTypeRow({
  dayType,
  canEdit,
}: {
  dayType: DayTypeRowValue;
  canEdit: boolean;
}) {
  const [state, formAction, pending] = useActionState(updateDayType, initialState);
  const [archiving, startArchive] = useTransition();
  const [deleting, startDelete] = useTransition();
  const [rowError, setRowError] = useState<string | null>(null);

  // F7: the action returns `requiresConfirm` instead of saving when
  // billable/invoice_line_type changed and un-invoiced trips already use
  // this type. The hidden field below flips to "1" once that happens, so
  // the SAME form's next Save actually applies the change — no separate
  // dialog or extra client state needed, `state` already persists across
  // the two dispatches.
  const awaitingConfirm = Boolean(state.requiresConfirm);

  // React 19 resets an uncontrolled form on every action dispatch, error
  // path included — echo what was submitted so a rejected save doesn't
  // blank the rename the pilot just typed.
  const submitted = state.values;
  const initial = (key: string, stored: unknown, fallback = "") => {
    const echoed = submitted?.[key];
    if (echoed !== undefined) return echoed;
    return stored === null || stored === undefined ? fallback : String(stored);
  };
  const checked = (key: "billable" | "counts_for_per_diem", stored: boolean) => {
    const echoed = submitted?.[key];
    return echoed === undefined ? stored : echoed === "on";
  };

  const archived = Boolean(dayType.archived_at);

  return (
    <Card>
      <MDBox p={3} component="form" action={formAction}>
        <input type="hidden" name="id" value={dayType.id} />
        <input type="hidden" name="confirm_reprice" value={awaitingConfirm ? "1" : ""} />

        <MDBox
          mb={2}
          display="flex"
          justifyContent="space-between"
          alignItems="center"
          flexWrap="wrap"
          gap={1}
        >
          <MDTypography variant="caption" color="text" textTransform="uppercase" fontWeight="bold">
            {dayType.is_builtin ? "Starting day type" : "Custom day type"}
          </MDTypography>
          {archived ? (
            <MDTypography variant="caption" color="text">
              Archived — hidden from pickers, still used on past trips
            </MDTypography>
          ) : null}
        </MDBox>

        <Grid container spacing={2} alignItems="flex-start">
          <Grid item xs={12} md={3}>
            <TextField
              name="label"
              label="Label"
              fullWidth
              required
              disabled={!canEdit}
              defaultValue={initial("label", dayType.label)}
            />
          </Grid>
          <Grid item xs={6} md={2}>
            <MDBox display="flex" alignItems="center" gap={1} pt={1}>
              <Switch
                name="billable"
                disabled={!canEdit}
                defaultChecked={checked("billable", dayType.billable)}
                inputProps={{ "aria-label": "Billable" }}
              />
              <MDTypography variant="caption" color="text">
                Billable
              </MDTypography>
            </MDBox>
          </Grid>
          <Grid item xs={6} md={3}>
            <MDBox display="flex" alignItems="center" gap={1} pt={1}>
              <Switch
                name="counts_for_per_diem"
                disabled={!canEdit}
                defaultChecked={checked("counts_for_per_diem", dayType.counts_for_per_diem)}
                inputProps={{ "aria-label": "Counts for per diem" }}
              />
              <MDTypography variant="caption" color="text">
                Counts for per diem
              </MDTypography>
            </MDBox>
          </Grid>
          <Grid item xs={6} md={2}>
            <TextField
              name="default_rate"
              label="Default rate (USD)"
              fullWidth
              inputMode="decimal"
              disabled={!canEdit}
              defaultValue={initial("default_rate", centsToInput(dayType.default_rate_cents))}
              helperText="Blank = no rate agreed"
            />
          </Grid>
          <Grid item xs={6} md={2}>
            <TextField
              type="number"
              name="sort_order"
              label="Order"
              fullWidth
              disabled={!canEdit}
              defaultValue={initial("sort_order", dayType.sort_order)}
              helperText="Lower shows first"
            />
          </Grid>

          <Grid item xs={12} md={5}>
            <TextField
              select
              name="invoice_line_type"
              label="Bills as"
              fullWidth
              disabled={!canEdit}
              defaultValue={initial("invoice_line_type", dayType.invoice_line_type)}
            >
              {LINE_TYPE_OPTIONS.map((option) => (
                <MenuItem key={option.value} value={option.value}>
                  {option.label}
                </MenuItem>
              ))}
            </TextField>
          </Grid>
          <Grid item xs={12} md={7}>
            <MDBox pt={{ xs: 0, md: 2 }}>
              <MDTypography variant="caption" color="text">
                The name is yours to change. Which invoice line it bills as
                is fixed, because the invoice&rsquo;s own billing rules
                depend on it.
              </MDTypography>
            </MDBox>
          </Grid>
        </Grid>

        <MDBox mt={2} role="alert" aria-live="polite">
          {state.error ? (
            <MDTypography variant="caption" color="error">
              {state.error}
            </MDTypography>
          ) : awaitingConfirm ? (
            // F7: not saved yet — naming the consequence rather than
            // blocking it. Save again (the hidden confirm_reprice field is
            // now "1") to apply the change anyway.
            <MDTypography variant="caption" color="warning">
              Changing Billable or Bills as will change how already-recorded
              days bill on {state.affectedTripCount}{" "}
              {state.affectedTripCount === 1 ? "trip that hasn't" : "trips that haven't"}{" "}
              been invoiced yet. Save again to apply it anyway.
            </MDTypography>
          ) : state.saved ? (
            <MDTypography variant="caption" color="success">
              Saved.
            </MDTypography>
          ) : null}
          {rowError ? (
            <MDTypography display="block" variant="caption" color="error">
              {rowError}
            </MDTypography>
          ) : null}
        </MDBox>

        {canEdit ? (
          <MDBox mt={2} display="flex" gap={1.5} flexWrap="wrap">
            <MDButton type="submit" variant="gradient" color="info" size="small" disabled={pending}>
              {pending ? "Saving…" : awaitingConfirm ? "Save anyway" : "Save"}
            </MDButton>
            <MDButton
              type="button"
              variant="outlined"
              color={archived ? "info" : "warning"}
              size="small"
              disabled={archiving}
              onClick={() =>
                startArchive(async () => {
                  setRowError(null);
                  const result = await setDayTypeArchived(dayType.id, !archived);
                  setRowError(result.error);
                })
              }
            >
              {archiving ? "Working…" : archived ? "Restore" : "Archive"}
            </MDButton>
            {/* F1: never offer Delete on a built-in row — Archive/Restore
                already do everything a pilot actually wants here, and
                unlike delete it's reversible. The database rejects a
                built-in delete outright (23514), but the control shouldn't
                exist to invite trying. */}
            {dayType.is_builtin ? null : (
              <MDButton
                type="button"
                variant="text"
                color="error"
                size="small"
                disabled={deleting}
                onClick={() =>
                  startDelete(async () => {
                    setRowError(null);
                    const result = await deleteDayType(dayType.id);
                    setRowError(result.error);
                  })
                }
              >
                {deleting ? "Deleting…" : "Delete"}
              </MDButton>
            )}
          </MDBox>
        ) : null}
      </MDBox>
    </Card>
  );
}

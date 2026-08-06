"use client";

import { Fragment, useActionState, useMemo, useState } from "react";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import TextField from "@mui/material/TextField";
import MenuItem from "@mui/material/MenuItem";
import MDBox from "@/components/mdpro/MDBox";
import MDTypography from "@/components/mdpro/MDTypography";
import MDButton from "@/components/mdpro/MDButton";
import { formatDateWithWeekday, formatCents, centsToInput } from "@/lib/format";
import { saveTripDays, type TripDaysFormState } from "./actions";
import {
  enumerateDates,
  dayTypeFieldName,
  rateFieldName,
  quantityFieldName,
  notesFieldName,
  computeSeed,
  resolveRate,
  quantityToInput,
  type SeedDayType,
  type SeedScalars,
  type SeedRow,
} from "./day-utils";

export type DayTypeOption = {
  id: string;
  key: string;
  label: string;
  billable: boolean;
  default_rate_cents: number | null;
  sort_order: number;
  archived_at: string | null;
};

export type TripDayRow = {
  day_on: string;
  day_type_id: string;
  rate_cents: number;
  quantity: number;
  notes: string | null;
};

export type ClientRateOption = {
  day_type_id: string;
  rate_cents: number;
};

/** Full day / Half day cover the common cases; a stored value that isn't
 * either (any other 0.1-step quantity, from a prior edit or a future
 * finer-grained entry point) still has to round-trip rather than silently
 * snap to one of the two — same shape as optionsFor()'s handling of an
 * archived day type below. */
const QUANTITY_OPTIONS = [
  { value: "1.0", label: "Full day" },
  { value: "0.5", label: "Half day" },
];

function quantityOptionsFor(value: string) {
  if (QUANTITY_OPTIONS.some((o) => o.value === value)) return QUANTITY_OPTIONS;
  return [...QUANTITY_OPTIONS, { value, label: `${value} day (custom)` }];
}

const initialState: TripDaysFormState = { error: null };

/**
 * One row per calendar day of the trip. A trip with no saved trip_days
 * seeds its displayed, UNSAVED state from the trip's scalar day counts
 * (see day-utils.ts's computeSeed) — nothing is written until the pilot
 * saves this form.
 */
export default function DayGrid({
  tripId,
  startsOn,
  endsOn,
  locked,
  billedOn,
  dayTypes,
  existingDays,
  clientRates,
  scalars,
}: {
  tripId: string;
  startsOn: string;
  endsOn: string;
  /** The trip is referenced by a live invoice: its day rows are frozen. */
  locked: boolean;
  /** The invoice number (or "a draft invoice") locking it, when `locked`. */
  billedOn?: string | null;
  dayTypes: DayTypeOption[];
  existingDays: TripDayRow[];
  clientRates: ClientRateOption[];
  scalars: SeedScalars;
}) {
  const [state, formAction, pending] = useActionState(saveTripDays, initialState);

  const dates = useMemo(() => enumerateDates(startsOn, endsOn), [startsOn, endsOn]);

  const activeDayTypes = useMemo(
    () =>
      dayTypes
        .filter((t) => !t.archived_at)
        .sort((a, b) => a.sort_order - b.sort_order || a.key.localeCompare(b.key)),
    [dayTypes]
  );
  const dayTypeById = useMemo(
    () => new Map(dayTypes.map((t): [string, SeedDayType] => [t.id, t])),
    [dayTypes]
  );
  const clientRateByType = useMemo(
    () => new Map(clientRates.map((r): [string, number] => [r.day_type_id, r.rate_cents])),
    [clientRates]
  );
  const existingByDate = useMemo(
    () => new Map(existingDays.map((d) => [d.day_on, d])),
    [existingDays]
  );

  const seed = useMemo(
    () =>
      existingDays.length === 0
        ? computeSeed(dates, dayTypes, scalars)
        : { rows: {}, seeded: false, approximate: false },
    [dates, dayTypes, scalars, existingDays.length]
  );

  const [rows, setRows] = useState<Record<string, SeedRow>>(() => {
    const initial: Record<string, SeedRow> = {};
    for (const date of dates) {
      const existing = existingByDate.get(date);
      if (existing) {
        initial[date] = {
          dayTypeId: existing.day_type_id,
          rate: centsToInput(existing.rate_cents),
          notes: existing.notes ?? "",
          quantity: quantityToInput(existing.quantity),
        };
      } else {
        initial[date] = seed.rows[date] ?? { dayTypeId: "", rate: "", notes: "", quantity: "1" };
      }
    }
    return initial;
  });

  function optionsFor(dayTypeId: string) {
    if (!dayTypeId || activeDayTypes.some((t) => t.id === dayTypeId)) {
      return activeDayTypes;
    }
    // The row's saved choice has since been archived. It still has to
    // appear as a selectable option, or MUI's Select warns about an
    // out-of-range value and the pilot's already-captured day type
    // silently disappears from view.
    const archived = dayTypeById.get(dayTypeId);
    return archived
      ? [...activeDayTypes, { ...archived, label: dayTypeLabel(archived, dayTypes) }]
      : activeDayTypes;
  }

  function setRow(date: string, next: Partial<SeedRow>) {
    setRows((prev) => ({
      ...prev,
      [date]: { ...(prev[date] ?? { dayTypeId: "", rate: "", notes: "", quantity: "1" }), ...next },
    }));
  }

  function handleDayTypeChange(date: string, dayTypeId: string) {
    setRow(date, {
      dayTypeId,
      rate: dayTypeId ? resolveRate(dayTypeId, clientRateByType, dayTypeById) : "",
    });
  }

  if (locked) {
    return (
      <MDBox>
        <MDBox mb={2}>
          <MDTypography variant="caption" color="text" fontWeight="regular">
            {billedOn
              ? `This trip is billed on ${billedOn}. Its day rows are frozen here — correcting them would leave the trip and that invoice disagreeing about what was flown. Remove it from the invoice first.`
              : "This trip is on an invoice. Its day rows are frozen here — correcting them would leave the trip and the invoice that has already gone out disagreeing about what was flown."}
          </MDTypography>
        </MDBox>
        <ReadOnlyGrid dates={dates} existingByDate={existingByDate} dayTypeById={dayTypeById} allDayTypes={dayTypes} />
      </MDBox>
    );
  }

  return (
    <MDBox component="form" action={formAction}>
      <input type="hidden" name="trip_id" value={tripId} />

      {existingDays.length === 0 && seed.seeded ? (
        <MDBox mb={2}>
          <MDTypography variant="caption" color="text" fontWeight="regular">
            Seeded from this trip&apos;s day counts — check it before saving.
            Which dates are travel versus flight days (travel first and
            last, flight in between), and where a half day lands, is a
            guess based on the counts alone, not this trip&apos;s real
            day-by-day record — verify every row.
            {seed.approximate
              ? " Some days didn't fit the trip's dates and were left blank."
              : ""}
          </MDTypography>
        </MDBox>
      ) : null}

      <TableContainer sx={{ boxShadow: "none" }}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>
                <MDTypography variant="caption" fontWeight="bold" textTransform="uppercase">
                  Date
                </MDTypography>
              </TableCell>
              <TableCell>
                <MDTypography variant="caption" fontWeight="bold" textTransform="uppercase">
                  Day type
                </MDTypography>
              </TableCell>
              <TableCell sx={{ minWidth: 130 }}>
                <MDTypography variant="caption" fontWeight="bold" textTransform="uppercase">
                  Quantity
                </MDTypography>
              </TableCell>
              <TableCell align="right">
                <MDTypography variant="caption" fontWeight="bold" textTransform="uppercase">
                  Rate (USD)
                </MDTypography>
              </TableCell>
              <TableCell>
                <MDTypography variant="caption" fontWeight="bold" textTransform="uppercase">
                  Notes
                </MDTypography>
              </TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {dates.map((date) => {
              const row = rows[date] ?? { dayTypeId: "", rate: "", notes: "", quantity: "1" };
              const selectedType = row.dayTypeId ? dayTypeById.get(row.dayTypeId) : undefined;
              const nonBillable = selectedType ? selectedType.billable === false : false;
              const fieldError = state.fieldErrors?.[date];
              return (
                <Fragment key={date}>
                  <TableRow>
                    <TableCell sx={{ whiteSpace: "nowrap" }}>
                      <MDTypography variant="button" fontWeight="regular">
                        {formatDateWithWeekday(date)}
                      </MDTypography>
                    </TableCell>
                    <TableCell sx={{ minWidth: 180 }}>
                      <TextField
                        select
                        size="small"
                        fullWidth
                        name={dayTypeFieldName(date)}
                        value={row.dayTypeId}
                        onChange={(event) => handleDayTypeChange(date, event.target.value)}
                      >
                        <MenuItem value="">— not counted —</MenuItem>
                        {optionsFor(row.dayTypeId).map((t) => (
                          <MenuItem key={t.id} value={t.id}>
                            {t.archived_at ? `${t.label} (archived)` : t.label}
                          </MenuItem>
                        ))}
                      </TextField>
                    </TableCell>
                    <TableCell sx={{ minWidth: 130 }}>
                      <TextField
                        select
                        size="small"
                        fullWidth
                        name={quantityFieldName(date)}
                        value={row.quantity}
                        disabled={!row.dayTypeId}
                        onChange={(event) => setRow(date, { quantity: event.target.value })}
                      >
                        {quantityOptionsFor(row.quantity).map((o) => (
                          <MenuItem key={o.value} value={o.value}>
                            {o.label}
                          </MenuItem>
                        ))}
                      </TextField>
                    </TableCell>
                    <TableCell align="right" sx={{ minWidth: 140 }}>
                      {row.dayTypeId && nonBillable ? (
                        <>
                          <input type="hidden" name={rateFieldName(date)} value="0" />
                          <MDTypography variant="caption" color="text" fontWeight="regular">
                            Doesn&apos;t bill
                          </MDTypography>
                        </>
                      ) : (
                        <TextField
                          size="small"
                          fullWidth
                          inputMode="decimal"
                          name={rateFieldName(date)}
                          value={row.rate}
                          disabled={!row.dayTypeId}
                          onChange={(event) => setRow(date, { rate: event.target.value })}
                        />
                      )}
                    </TableCell>
                    <TableCell sx={{ minWidth: 180 }}>
                      <TextField
                        size="small"
                        fullWidth
                        name={notesFieldName(date)}
                        value={row.notes}
                        onChange={(event) => setRow(date, { notes: event.target.value })}
                      />
                    </TableCell>
                  </TableRow>
                  {fieldError ? (
                    <TableRow>
                      <TableCell colSpan={5} sx={{ pt: 0 }}>
                        <MDTypography variant="caption" color="error">
                          {fieldError}
                        </MDTypography>
                      </TableCell>
                    </TableRow>
                  ) : null}
                </Fragment>
              );
            })}
          </TableBody>
        </Table>
      </TableContainer>

      <MDBox mt={2} role="alert" aria-live="polite">
        {state.error ? (
          <MDTypography variant="caption" color="error">
            {state.error}
          </MDTypography>
        ) : state.fieldErrors && Object.keys(state.fieldErrors).length > 0 ? (
          <MDTypography variant="caption" color="error">
            Fix the {Object.keys(state.fieldErrors).length === 1 ? "row" : "rows"} highlighted
            above before saving.
          </MDTypography>
        ) : state.saved ? (
          <MDTypography variant="caption" color="success">
            Day grid saved.
          </MDTypography>
        ) : null}
      </MDBox>

      <MDBox mt={3}>
        <MDButton type="submit" variant="gradient" color="info" disabled={pending}>
          {pending ? "Saving…" : "Save day grid"}
        </MDButton>
      </MDBox>
    </MDBox>
  );
}

function dayTypeLabel(dayType: SeedDayType, allDayTypes: DayTypeOption[]): string {
  return allDayTypes.find((t) => t.id === dayType.id)?.label ?? dayType.key;
}

function ReadOnlyGrid({
  dates,
  existingByDate,
  dayTypeById,
  allDayTypes,
}: {
  dates: string[];
  existingByDate: Map<string, TripDayRow>;
  dayTypeById: Map<string, SeedDayType>;
  allDayTypes: DayTypeOption[];
}) {
  return (
    <TableContainer sx={{ boxShadow: "none" }}>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>
              <MDTypography variant="caption" fontWeight="bold" textTransform="uppercase">
                Date
              </MDTypography>
            </TableCell>
            <TableCell>
              <MDTypography variant="caption" fontWeight="bold" textTransform="uppercase">
                Day type
              </MDTypography>
            </TableCell>
            <TableCell>
              <MDTypography variant="caption" fontWeight="bold" textTransform="uppercase">
                Quantity
              </MDTypography>
            </TableCell>
            <TableCell align="right">
              <MDTypography variant="caption" fontWeight="bold" textTransform="uppercase">
                Rate
              </MDTypography>
            </TableCell>
            <TableCell>
              <MDTypography variant="caption" fontWeight="bold" textTransform="uppercase">
                Notes
              </MDTypography>
            </TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {dates.map((date) => {
            const existing = existingByDate.get(date);
            const label = existing
              ? dayTypeLabel(
                  dayTypeById.get(existing.day_type_id) ?? {
                    id: existing.day_type_id,
                    key: "",
                    default_rate_cents: null,
                    archived_at: null,
                    billable: true,
                  },
                  allDayTypes
                )
              : "— not counted —";
            return (
              <TableRow key={date}>
                <TableCell sx={{ whiteSpace: "nowrap" }}>
                  <MDTypography variant="button" fontWeight="regular">
                    {formatDateWithWeekday(date)}
                  </MDTypography>
                </TableCell>
                <TableCell>
                  <MDTypography variant="button" color="text" fontWeight="regular">
                    {label}
                  </MDTypography>
                </TableCell>
                <TableCell>
                  <MDTypography variant="button" color="text" fontWeight="regular">
                    {existing ? quantityToInput(existing.quantity) : "—"}
                  </MDTypography>
                </TableCell>
                <TableCell align="right">
                  <MDTypography variant="button" fontWeight="regular">
                    {existing ? formatCents(existing.rate_cents) : "—"}
                  </MDTypography>
                </TableCell>
                <TableCell>
                  <MDTypography variant="button" color="text" fontWeight="regular">
                    {existing?.notes ?? ""}
                  </MDTypography>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </TableContainer>
  );
}

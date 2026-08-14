"use client";

import { Fragment, useActionState, useEffect, useMemo, useState } from "react";
import {
  Box,
  Button,
  Callout,
  Checkbox,
  Select,
  Table,
  Text,
  TextField,
} from "@/components/ui";
import { formatDateWithWeekday, formatCents, centsToInput, parseDollarsToCents } from "@/lib/format";
import { tripValueCents, type TripDayValueRow, type TripValueScalar } from "@/lib/trip-value";
import { saveTripDays, type TripDaysFormState } from "./actions";
import {
  enumerateDates,
  dayTypeFieldName,
  rateFieldName,
  quantityFieldName,
  unitsFieldName,
  awayFieldName,
  notesFieldName,
  computeSeed,
  resolveAway,
  resolveRate,
  resolveUnits,
  quantityToInput,
  unitsToInput,
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
  /** 20260807070000: default rate fraction, resolved into a row's `units`
   * at capture the same way default_rate_cents resolves into `rate`. */
  default_units: number | null;
  sort_order: number;
  archived_at: string | null;
};

export type TripDayRow = {
  day_on: string;
  day_type_id: string;
  rate_cents: number;
  quantity: number;
  /** 20260807070000: rate fraction this day bills at (0 < x <= 1). */
  units: number;
  /** 20260807070000: away from home base — per diem requires
   * counts_for_per_diem (on the day type) AND this. */
  away: boolean;
  notes: string | null;
};

export type ClientRateOption = {
  day_type_id: string;
  rate_cents: number;
};

/** Radix forbids an empty-string Select.Item value. "— not counted —" is a
 * real, postable choice (day_type_id is optional per row), so it gets a
 * sentinel that never leaves this component — a hidden input per row
 * always posts the real day_type_id, translating the sentinel back to ""
 * before it reaches the field name the server action reads. */
const NOT_COUNTED = "__none__";

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

/** Full rate / Half rate cover the common cases (a travel day paid at half
 * the day rate is the domain's own example — see
 * 20260807070000_trip_day_units_away_cancel.sql's header); a stored value
 * that isn't either still round-trips, same shape as QUANTITY_OPTIONS
 * above. */
const UNITS_OPTIONS = [
  { value: "1.00", label: "Full rate" },
  { value: "0.50", label: "Half rate" },
];

function unitsOptionsFor(value: string) {
  if (UNITS_OPTIONS.some((o) => o.value === value)) return UNITS_OPTIONS;
  return [...UNITS_OPTIONS, { value, label: `${value}x rate (custom)` }];
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

  // Radix's Select.Root always renders its posting <select> with
  // `defaultValue`, never `value` (see @radix-ui/react-select's
  // SelectBubbleInput) — so it is uncontrolled from React's point of view
  // no matter what we pass to Select.Root. React 19's post-action
  // form.reset() restores that <select> to its mount-time option, which
  // fires a change event Radix forwards straight into onValueChange —
  // calling handleDayTypeChange with the STALE, mount-time day type and
  // silently overwriting whatever rate the pilot had typed since.
  //
  // Rather than try to detect and ignore that spurious callback, we make
  // the stale defaultValue impossible: every dispatch (success or reject)
  // remounts every row's Selects via a generation-keyed `key`. The remount
  // happens during the same commit's DOM-mutation phase, before React's
  // effect-scheduled form.reset() runs — so by the time the browser resets
  // the (now-replaced) <select>, its fresh defaultValue already reflects
  // the pilot's latest state, and the reset is a no-op.
  const [formGen, setFormGen] = useState(0);
  useEffect(() => {
    setFormGen((g) => g + 1);
  }, [state]);

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
          units: unitsToInput(existing.units),
          away: existing.away,
        };
      } else {
        initial[date] = seed.rows[date] ?? {
          dayTypeId: "",
          rate: "",
          notes: "",
          quantity: "1.0",
          units: "1.00",
          away: false,
        };
      }
    }
    return initial;
  });

  // MEDIUM 22: a pilot edits up to 31 rows on this exact screen to set
  // what they get paid, and previously had no total until the save
  // round-tripped and the server-rendered headline value updated. This
  // mirrors that headline number's own definition instead of re-deriving
  // it: lib/trip-value.ts's tripValueCents is the SAME function
  // trips/[id]/page.tsx calls for the persisted figure, called here
  // against the grid's live, unsaved `rows` state — so the two can never
  // disagree, and rounding happens exactly where tripValueCents' header
  // says it must: once per (day_type_id, rate_cents) group, on the
  // group's summed quantity, not once per row.
  const billableByDayType = useMemo(
    () => new Map(dayTypes.map((t): [string, boolean] => [t.id, t.billable])),
    [dayTypes]
  );
  const scalarValue: TripValueScalar = {
    day_rate_cents: scalars.dayRateCents,
    day_count: scalars.dayCount,
    travel_day_rate_cents: scalars.travelDayRateCents,
    travel_day_count: scalars.travelDayCount,
  };
  const liveTotalCents = useMemo(() => {
    const liveDayRows: TripDayValueRow[] = [];
    for (const date of dates) {
      const row = rows[date];
      if (!row || !row.dayTypeId) continue;
      liveDayRows.push({
        day_type_id: row.dayTypeId,
        // Blank/unparseable rate reads as 0 here, same as an empty rate
        // reaching the server would — this total previews what Save
        // would produce, it does not itself validate the form.
        rate_cents: parseDollarsToCents(row.rate) ?? 0,
        quantity: Number(row.quantity) || 0,
        // Same "preview what Save would do" logic for units: an
        // unparseable/blank value reads as 1.00 (full rate) here, not 0 —
        // 0 would zero the row out of the running total entirely, which
        // is not what an empty units field means to the server (parseUnits
        // rejects it as a validation error, it doesn't bill nothing).
        units: Number(row.units) || 1,
      });
    }
    // Mirrors saveTripDays: a row with no day type chosen is never
    // written, so an all-blank grid has zero day rows after saving and
    // this falls back to the trip's scalar value exactly as the
    // server-rendered headline does for a trip with no day rows yet.
    return tripValueCents(
      scalarValue,
      liveDayRows.length > 0 ? liveDayRows : undefined,
      billableByDayType
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dates, rows, billableByDayType, scalarValue]);

  function optionsFor(dayTypeId: string) {
    if (!dayTypeId || activeDayTypes.some((t) => t.id === dayTypeId)) {
      return activeDayTypes;
    }
    // The row's saved choice has since been archived. It still has to
    // appear as a selectable option, or the Select would carry a value
    // with no matching Item and the pilot's already-captured day type
    // silently disappears from view.
    const archived = dayTypeById.get(dayTypeId);
    return archived
      ? [...activeDayTypes, { ...archived, label: dayTypeLabel(archived, dayTypes) }]
      : activeDayTypes;
  }

  function setRow(date: string, next: Partial<SeedRow>) {
    setRows((prev) => ({
      ...prev,
      [date]: {
        ...(prev[date] ?? {
          dayTypeId: "",
          rate: "",
          notes: "",
          quantity: "1.0",
          units: "1.00",
          away: false,
        }),
        ...next,
      },
    }));
  }

  function handleDayTypeChange(date: string, dayTypeId: string) {
    setRow(date, {
      dayTypeId,
      rate: dayTypeId ? resolveRate(dayTypeId, clientRateByType, dayTypeById) : "",
      units: dayTypeId ? resolveUnits(dayTypeId, dayTypeById) : "1.00",
      // Pre-tick Away from the day type, exactly as rate and units resolve.
      // Per diem needs counts_for_per_diem AND away, so leaving this false
      // by default meant a pilot who never noticed the column silently
      // billed no per diem — the same under-count the backfill fixed for
      // history, reproduced on every new trip. This is a visible, editable
      // default, not an assertion about where the pilot physically was.
      away: dayTypeId ? resolveAway(dayTypeId, dayTypeById) : false,
    });
  }

  if (locked) {
    return (
      <Box>
        <Box mb="3">
          <Text size="1" color="gray">
            {billedOn
              ? `This trip is billed on ${billedOn}. Its day rows are frozen here. Correcting them would leave the trip and that invoice disagreeing about what was flown. Remove it from the invoice first.`
              : "This trip is on an invoice. Its day rows are frozen here. Correcting them would leave the trip and the invoice that has already gone out disagreeing about what was flown."}
          </Text>
        </Box>
        <ReadOnlyGrid dates={dates} existingByDate={existingByDate} dayTypeById={dayTypeById} allDayTypes={dayTypes} />
      </Box>
    );
  }

  const failingDates = state.fieldErrors ? Object.keys(state.fieldErrors) : [];

  return (
    <form action={formAction}>
      <input type="hidden" name="trip_id" value={tripId} />

      {existingDays.length === 0 && seed.seeded ? (
        <Box mb="3">
          <Text size="1" color="gray">
            Seeded from this trip&apos;s day counts — check it before saving.
            Which dates are travel versus flight days (travel first and
            last, flight in between), and where a half day lands, is a
            guess based on the counts alone, not this trip&apos;s real
            day-by-day record — verify every row.
            {seed.approximate
              ? " Some days didn't fit the trip's dates and were left blank."
              : ""}
          </Text>
        </Box>
      ) : null}

      <Box overflowX="auto">
        <Table.Root size="1">
          <Table.Header>
            <Table.Row>
              <Table.ColumnHeaderCell>Date</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell>Day type</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell minWidth="130px">Quantity</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell justify="end">Rate (USD)</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell minWidth="130px">Rate fraction</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell>Away</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell>Notes</Table.ColumnHeaderCell>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {dates.map((date) => {
              const row =
                rows[date] ?? {
                  dayTypeId: "",
                  rate: "",
                  notes: "",
                  quantity: "1.0",
                  units: "1.00",
                  away: false,
                };
              const selectedType = row.dayTypeId ? dayTypeById.get(row.dayTypeId) : undefined;
              const nonBillable = selectedType ? selectedType.billable === false : false;
              const fieldError = state.fieldErrors?.[date];
              const errorId = `day-error-${date}`;
              const dayTypeCtlId = `day-type-${date}`;
              const quantityCtlId = `quantity-${date}`;
              const rateCtlId = `rate-${date}`;
              const unitsCtlId = `units-${date}`;
              const awayCtlId = `away-${date}`;
              const notesCtlId = `notes-${date}`;
              return (
                <Fragment key={date}>
                  <Table.Row>
                    <Table.Cell style={{ whiteSpace: "nowrap" }}>
                      <Text size="2">{formatDateWithWeekday(date)}</Text>
                    </Table.Cell>
                    <Table.Cell minWidth="180px">
                      {/* The real day_type_id, always in sync with row.dayTypeId
                          — see NOT_COUNTED above for why the Select itself
                          can't post this directly. */}
                      <input type="hidden" name={dayTypeFieldName(date)} value={row.dayTypeId} />
                      <Select.Root
                        key={`day-type-${date}-${formGen}`}
                        size="1"
                        value={row.dayTypeId === "" ? NOT_COUNTED : row.dayTypeId}
                        onValueChange={(next) =>
                          handleDayTypeChange(date, next === NOT_COUNTED ? "" : next)
                        }
                      >
                        <Select.Trigger
                          id={dayTypeCtlId}
                          aria-label={`Day type for ${formatDateWithWeekday(date)}`}
                          aria-invalid={fieldError ? true : undefined}
                          aria-describedby={fieldError ? errorId : undefined}
                          style={{ width: "100%" }}
                        />
                        <Select.Content>
                          <Select.Item value={NOT_COUNTED}>— not counted —</Select.Item>
                          {optionsFor(row.dayTypeId).map((t) => (
                            <Select.Item key={t.id} value={t.id}>
                              {t.archived_at ? `${t.label} (archived)` : t.label}
                            </Select.Item>
                          ))}
                        </Select.Content>
                      </Select.Root>
                    </Table.Cell>
                    <Table.Cell minWidth="130px">
                      {/* Quantity is never blank, so the field name can go
                          directly on the Select — no sentinel needed. */}
                      <input type="hidden" name={quantityFieldName(date)} value={row.quantity} />
                      <Select.Root
                        key={`quantity-${date}-${formGen}`}
                        size="1"
                        value={row.quantity}
                        disabled={!row.dayTypeId}
                        onValueChange={(next) => setRow(date, { quantity: next })}
                      >
                        <Select.Trigger
                          id={quantityCtlId}
                          aria-label={`Quantity for ${formatDateWithWeekday(date)}`}
                          aria-invalid={fieldError ? true : undefined}
                          aria-describedby={fieldError ? errorId : undefined}
                          style={{ width: "100%" }}
                        />
                        <Select.Content>
                          {quantityOptionsFor(row.quantity).map((o) => (
                            <Select.Item key={o.value} value={o.value}>
                              {o.label}
                            </Select.Item>
                          ))}
                        </Select.Content>
                      </Select.Root>
                    </Table.Cell>
                    <Table.Cell justify="end" minWidth="140px">
                      {row.dayTypeId && nonBillable ? (
                        <>
                          <input type="hidden" name={rateFieldName(date)} value="0" />
                          <Text size="1" color="gray">
                            Doesn&apos;t bill
                          </Text>
                        </>
                      ) : (
                        <>
                          <Text as="label" htmlFor={rateCtlId} style={{ display: "none" }}>
                            {`Rate for ${formatDateWithWeekday(date)}`}
                          </Text>
                          <TextField.Root
                            id={rateCtlId}
                            size="1"
                            inputMode="decimal"
                            name={rateFieldName(date)}
                            value={row.rate}
                            disabled={!row.dayTypeId}
                            aria-label={`Rate for ${formatDateWithWeekday(date)}`}
                            aria-invalid={fieldError ? true : undefined}
                            aria-describedby={fieldError ? errorId : undefined}
                            onChange={(event) => setRow(date, { rate: event.target.value })}
                          />
                        </>
                      )}
                    </Table.Cell>
                    <Table.Cell minWidth="130px">
                      {/* Rate fraction is never blank, same as Quantity —
                          no sentinel needed on the Select. Shown even for
                          a non-billable day type: it stores a value
                          regardless (harmless, since rate_cents is forced
                          to 0 for those rows), and hiding it would be one
                          more special case for no benefit. */}
                      <input type="hidden" name={unitsFieldName(date)} value={row.units} />
                      <Select.Root
                        key={`units-${date}-${formGen}`}
                        size="1"
                        value={row.units}
                        disabled={!row.dayTypeId}
                        onValueChange={(next) => setRow(date, { units: next })}
                      >
                        <Select.Trigger
                          id={unitsCtlId}
                          aria-label={`Rate fraction for ${formatDateWithWeekday(date)}`}
                          aria-invalid={fieldError ? true : undefined}
                          aria-describedby={fieldError ? errorId : undefined}
                          style={{ width: "100%" }}
                        />
                        <Select.Content>
                          {unitsOptionsFor(row.units).map((o) => (
                            <Select.Item key={o.value} value={o.value}>
                              {o.label}
                            </Select.Item>
                          ))}
                        </Select.Content>
                      </Select.Root>
                    </Table.Cell>
                    <Table.Cell>
                      <Text as="label" size="2" htmlFor={awayCtlId}>
                        <input
                          type="hidden"
                          name={awayFieldName(date)}
                          value={row.away ? "on" : "off"}
                        />
                        <Checkbox
                          id={awayCtlId}
                          checked={row.away}
                          disabled={!row.dayTypeId}
                          aria-label={`Away from home base on ${formatDateWithWeekday(date)}`}
                          onCheckedChange={(checked) =>
                            setRow(date, { away: checked === true })
                          }
                        />
                      </Text>
                    </Table.Cell>
                    <Table.Cell minWidth="180px">
                      <TextField.Root
                        id={notesCtlId}
                        size="1"
                        name={notesFieldName(date)}
                        value={row.notes}
                        aria-label={`Notes for ${formatDateWithWeekday(date)}`}
                        aria-invalid={fieldError ? true : undefined}
                        aria-describedby={fieldError ? errorId : undefined}
                        onChange={(event) => setRow(date, { notes: event.target.value })}
                      />
                    </Table.Cell>
                  </Table.Row>
                  {fieldError ? (
                    <Table.Row>
                      <Table.Cell colSpan={7} pt="0">
                        <Text id={errorId} size="1" color="red">
                          {fieldError}
                        </Text>
                      </Table.Cell>
                    </Table.Row>
                  ) : null}
                </Fragment>
              );
            })}
          </Table.Body>
        </Table.Root>
      </Box>

      <Box mt="3">
        <Text size="2" weight="medium" className="tnum">
          Running total: {formatCents(liveTotalCents)}
        </Text>
        <Text as="div" size="1" color="gray">
          Updates as you edit below, before you save. Day rows only — per
          diem, the contract minimum and rebilled expenses aren&rsquo;t
          included, so this won&rsquo;t match the invoice total.
        </Text>
      </Box>

      <Box mt="3" role="alert" aria-live="polite">
        {state.error ? (
          <Callout.Root color="red" size="1">
            <Callout.Text>{state.error}</Callout.Text>
          </Callout.Root>
        ) : failingDates.length > 0 ? (
          <Callout.Root color="red" size="1">
            <Callout.Text>
              Fix {failingDates.length === 1 ? "this date" : "these dates"} before saving:{" "}
              {failingDates.map((d) => formatDateWithWeekday(d)).join(", ")}.
            </Callout.Text>
          </Callout.Root>
        ) : state.saved ? (
          <Callout.Root color="green" size="1">
            <Callout.Text>Day grid saved.</Callout.Text>
          </Callout.Root>
        ) : null}
      </Box>

      <Box mt="4">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save day grid"}
        </Button>
      </Box>
    </form>
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
    <Box overflowX="auto">
      <Table.Root size="1">
        <Table.Header>
          <Table.Row>
            <Table.ColumnHeaderCell>Date</Table.ColumnHeaderCell>
            <Table.ColumnHeaderCell>Day type</Table.ColumnHeaderCell>
            <Table.ColumnHeaderCell>Quantity</Table.ColumnHeaderCell>
            <Table.ColumnHeaderCell justify="end">Rate</Table.ColumnHeaderCell>
            <Table.ColumnHeaderCell>Rate fraction</Table.ColumnHeaderCell>
            <Table.ColumnHeaderCell>Away</Table.ColumnHeaderCell>
            <Table.ColumnHeaderCell>Notes</Table.ColumnHeaderCell>
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {dates.map((date) => {
            const existing = existingByDate.get(date);
            const label = existing
              ? dayTypeLabel(
                  dayTypeById.get(existing.day_type_id) ?? {
                    id: existing.day_type_id,
                    key: "",
                    default_rate_cents: null,
                    default_units: null,
                    archived_at: null,
                    billable: true,
                  },
                  allDayTypes
                )
              : "(not counted)";
            return (
              <Table.Row key={date}>
                <Table.Cell style={{ whiteSpace: "nowrap" }}>
                  <Text size="2">{formatDateWithWeekday(date)}</Text>
                </Table.Cell>
                <Table.Cell>
                  <Text size="2" color="gray">
                    {label}
                  </Text>
                </Table.Cell>
                <Table.Cell>
                  <Text size="2" color="gray" className="tnum">
                    {existing ? quantityToInput(existing.quantity) : "—"}
                  </Text>
                </Table.Cell>
                <Table.Cell justify="end">
                  <Text size="2" className="tnum">
                    {existing ? formatCents(existing.rate_cents) : "—"}
                  </Text>
                </Table.Cell>
                <Table.Cell>
                  <Text size="2" color="gray" className="tnum">
                    {existing ? unitsToInput(existing.units) : "—"}
                  </Text>
                </Table.Cell>
                <Table.Cell>
                  <Text size="2" color="gray">
                    {existing ? (existing.away ? "Away" : "Home base") : "—"}
                  </Text>
                </Table.Cell>
                <Table.Cell>
                  <Text size="2" color="gray">
                    {existing?.notes ?? ""}
                  </Text>
                </Table.Cell>
              </Table.Row>
            );
          })}
        </Table.Body>
      </Table.Root>
    </Box>
  );
}

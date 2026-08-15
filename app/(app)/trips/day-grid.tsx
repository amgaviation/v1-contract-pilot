"use client";

import { Fragment, useActionState, useEffect, useMemo, useState } from "react";
import {
  Box,
  Button,
  Callout,
  Card,
  Checkbox,
  Flex,
  Grid,
  Heading,
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

/** A row with no day type chosen yet — every date starts here, or falls
 * back here if `rows` and the zero-state seed both somehow miss a date.
 * Pulled out to one place because the bulk-apply actions below need the
 * same fallback the per-row code already leaned on in three spots (the initial
 * `rows` state, setRow, and the table/card render), and a fourth inline
 * copy was one too many. */
function emptyRow(): SeedRow {
  return {
    dayTypeId: "",
    rate: "",
    notes: "",
    quantity: "1.0",
    units: "1.00",
    away: false,
  };
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
        initial[date] = seed.rows[date] ?? emptyRow();
      }
    }
    return initial;
  });

  // Bulk apply: a compact "Set many days at once" affordance above
  // the editor. `bulkDayTypeId`/`bulkRate` are plain controlled state —
  // nothing they touch has a `name`, and neither button is type="submit"
  // (see the JSX below), so nothing here can post on its own. Applying
  // either one writes straight into the SAME `rows` state every per-row
  // control reads and writes, via the SAME setRow/resolution functions —
  // see applyDayTypeToAll/applyRateToMatching below — so the bulk tools
  // can never leave `rows` in a shape a row-by-row edit couldn't also have
  // produced. `bulkNotice` is a one-shot polite announcement, same pattern
  // as settings/category-row.tsx's moveNotice: the only feedback a purely
  // client-side state change gets is whatever this component says out
  // loud, so an application that announces nothing is invisible to a
  // screen reader.
  const [bulkDayTypeId, setBulkDayTypeId] = useState("");
  const [bulkRate, setBulkRate] = useState("");
  const [bulkNotice, setBulkNotice] = useState<string | null>(null);

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
        ...(prev[date] ?? emptyRow()),
        ...next,
      },
    }));
  }

  /**
   * Resolves rate/units/away for a NEWLY CHOSEN day type. Split out from
   * handleDayTypeChange (which is now a one-line call to it) so the bulk
   * "Apply to all days" action below can set every date's day type through the
   * exact same resolution a single row's Select uses — rate/units/away
   * re-resolve per date exactly as they would if the pilot had picked this
   * day type on that row by hand, so a bulk apply can never leave a row
   * disagreeing with what picking that type one-by-one would have set.
   */
  function resolveDayTypeFields(
    dayTypeId: string
  ): Pick<SeedRow, "dayTypeId" | "rate" | "units" | "away"> {
    return {
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
    };
  }

  function handleDayTypeChange(date: string, dayTypeId: string) {
    setRow(date, resolveDayTypeFields(dayTypeId));
  }

  // dayTypeById is typed to SeedDayType (day-utils.ts's own minimal
  // shape, used for rate/units/away resolution) and carries no `label` —
  // activeDayTypes is the DayTypeOption[] that does, and it's also the
  // exact list the bulk day-type Select itself offers, so a bulk-selected
  // id can never fail to resolve a label here.
  function labelForDayType(dayTypeId: string): string | undefined {
    return activeDayTypes.find((t) => t.id === dayTypeId)?.label;
  }

  // Every date at once, via resolveDayTypeFields above — never a
  // second, hand-rolled resolution. One setRows call rather than N per-date
  // setRow calls, so a 31-day trip's bulk apply is one re-render, not 31.
  // quantity/notes are left alone, same as a single row's own Select only
  // ever touches dayTypeId/rate/units/away.
  function applyDayTypeToAll() {
    if (!bulkDayTypeId) return;
    const fields = resolveDayTypeFields(bulkDayTypeId);
    setRows((prev) => {
      const next: Record<string, SeedRow> = {};
      for (const date of dates) {
        next[date] = { ...(prev[date] ?? emptyRow()), ...fields };
      }
      return next;
    });
    const label = labelForDayType(bulkDayTypeId) ?? "that day type";
    setBulkNotice(
      `Set ${dates.length} day${dates.length === 1 ? "" : "s"} to ${label}.`
    );
  }

  // `rate` alone, on every row CURRENTLY at the bulk-selected type —
  // never dayTypeId/units/away, and never a row of a different type. Reads
  // `bulkRate` fresh (rather than trusting a render-time value passed in)
  // so this always applies whatever the pilot most recently typed.
  function applyRateToMatching() {
    if (!bulkDayTypeId || matchingCount === 0) return;
    const cents = parseDollarsToCents(bulkRate);
    if (cents === null || cents === undefined || cents < 0) return;
    const rateText = centsToInput(cents);
    setRows((prev) => {
      const next: Record<string, SeedRow> = { ...prev };
      for (const date of dates) {
        const row = prev[date];
        if (row && row.dayTypeId === bulkDayTypeId) {
          next[date] = { ...row, rate: rateText };
        }
      }
      return next;
    });
    const label = labelForDayType(bulkDayTypeId) ?? "matching";
    setBulkNotice(
      `Applied ${formatCents(cents)} to ${matchingCount} ${label} day${
        matchingCount === 1 ? "" : "s"
      }.`
    );
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

  // Bulk apply: derived render-time values for the two bulk
  // buttons' disabled state and copy. Recomputed from `bulkRate` fresh
  // inside applyRateToMatching itself (see its own comment) rather than
  // trusted from bulkRateCents here — this pair only decides what the
  // BUTTON looks like.
  const bulkRateCents = parseDollarsToCents(bulkRate);
  const bulkRateValid = typeof bulkRateCents === "number" && bulkRateCents >= 0;
  const bulkTypeLabel = bulkDayTypeId ? labelForDayType(bulkDayTypeId) : undefined;
  const matchingCount = bulkDayTypeId
    ? dates.filter((d) => rows[d]?.dayTypeId === bulkDayTypeId).length
    : 0;

  // One array of per-date data, walked ONCE, that produces BOTH
  // shapes — a <Table.Row> (+ its optional error row) for the md-and-up
  // table, and a <Card> for the below-md stack. Building both from the
  // same iteration is what keeps `row`/`selectedType`/`nonBillable`/
  // `fieldError`/every control id computed exactly once and identically
  // for both shapes, rather than risking the two drifting if they were
  // ever computed by two separate `dates.map()` calls.
  //
  // ONLY THE TABLE ROW CARRIES `name` ATTRIBUTES (and the per-row hidden
  // sentinel inputs). The card's controls are name-less and fully
  // controlled by the SAME `row` value via the SAME setRow/
  // handleDayTypeChange calls — see this file's header for why display:
  // none does not stop an input posting, which is exactly why only one
  // shape may carry a `name` at all. Both shapes stay mounted always;
  // app-shell.tsx's nav rail/strip is the same idiom (see nav-rail.tsx).
  const dayRows = dates.map((date) => {
    const row = rows[date] ?? emptyRow();
    const selectedType = row.dayTypeId ? dayTypeById.get(row.dayTypeId) : undefined;
    const nonBillable = selectedType ? selectedType.billable === false : false;
    const fieldError = state.fieldErrors?.[date];
    const errorId = `day-error-${date}`;
    const weekday = formatDateWithWeekday(date);
    const dayTypeCtlId = `day-type-${date}`;
    const quantityCtlId = `quantity-${date}`;
    const rateCtlId = `rate-${date}`;
    const unitsCtlId = `units-${date}`;
    const awayCtlId = `away-${date}`;
    const notesCtlId = `notes-${date}`;
    const options = optionsFor(row.dayTypeId);

    const tableRow = (
      <Fragment key={date}>
        <Table.Row>
          <Table.Cell style={{ whiteSpace: "nowrap" }}>
            <Text size="2">{weekday}</Text>
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
                aria-label={`Day type for ${weekday}`}
                aria-invalid={fieldError ? true : undefined}
                aria-describedby={fieldError ? errorId : undefined}
                style={{ width: "100%" }}
              />
              <Select.Content>
                <Select.Item value={NOT_COUNTED}>(not counted)</Select.Item>
                {options.map((t) => (
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
                aria-label={`Quantity for ${weekday}`}
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
                  {`Rate for ${weekday}`}
                </Text>
                <TextField.Root
                  id={rateCtlId}
                  size="1"
                  inputMode="decimal"
                  name={rateFieldName(date)}
                  value={row.rate}
                  disabled={!row.dayTypeId}
                  aria-label={`Rate for ${weekday}`}
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
                aria-label={`Rate fraction for ${weekday}`}
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
                aria-label={`Away from home base on ${weekday}`}
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
              aria-label={`Notes for ${weekday}`}
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

    // The stacked-card shape. Same `row`, same setRow/
    // handleDayTypeChange calls as the table row above — this can never
    // disagree with it because it IS it, read from the same state. Every
    // control gets its OWN visible label (a card has no column header to
    // borrow one from, unlike the table) and its own `-m` id suffix so
    // ids stay unique across both always-mounted shapes; the formGen key
    // below is the same remount trick the table's Selects use, for the
    // same reason — see this component's own formGen comment, near its
    // top (the useState/useEffect pair that defines it).
    const card = (
      <Card key={date}>
        <Flex direction="column" gap="3">
          <Heading as="h3" size="2">
            {weekday}
          </Heading>

          <Flex direction="column" gap="1">
            <Text as="label" size="2" weight="medium" htmlFor={`${dayTypeCtlId}-m`}>
              Day type
            </Text>
            <Select.Root
              key={`day-type-${date}-${formGen}-m`}
              size="1"
              value={row.dayTypeId === "" ? NOT_COUNTED : row.dayTypeId}
              onValueChange={(next) =>
                handleDayTypeChange(date, next === NOT_COUNTED ? "" : next)
              }
            >
              <Select.Trigger
                id={`${dayTypeCtlId}-m`}
                aria-label={`Day type for ${weekday}`}
                aria-invalid={fieldError ? true : undefined}
                aria-describedby={fieldError ? `${errorId}-m` : undefined}
                style={{ width: "100%" }}
              />
              <Select.Content>
                <Select.Item value={NOT_COUNTED}>(not counted)</Select.Item>
                {options.map((t) => (
                  <Select.Item key={t.id} value={t.id}>
                    {t.archived_at ? `${t.label} (archived)` : t.label}
                  </Select.Item>
                ))}
              </Select.Content>
            </Select.Root>
          </Flex>

          <Grid columns="2" gap="3">
            <Flex direction="column" gap="1">
              <Text as="label" size="2" weight="medium" htmlFor={`${quantityCtlId}-m`}>
                Quantity
              </Text>
              <Select.Root
                key={`quantity-${date}-${formGen}-m`}
                size="1"
                value={row.quantity}
                disabled={!row.dayTypeId}
                onValueChange={(next) => setRow(date, { quantity: next })}
              >
                <Select.Trigger
                  id={`${quantityCtlId}-m`}
                  aria-label={`Quantity for ${weekday}`}
                  aria-invalid={fieldError ? true : undefined}
                  aria-describedby={fieldError ? `${errorId}-m` : undefined}
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
            </Flex>

            <Flex direction="column" gap="1">
              <Text as="label" size="2" weight="medium" htmlFor={`${unitsCtlId}-m`}>
                Rate fraction
              </Text>
              <Select.Root
                key={`units-${date}-${formGen}-m`}
                size="1"
                value={row.units}
                disabled={!row.dayTypeId}
                onValueChange={(next) => setRow(date, { units: next })}
              >
                <Select.Trigger
                  id={`${unitsCtlId}-m`}
                  aria-label={`Rate fraction for ${weekday}`}
                  aria-invalid={fieldError ? true : undefined}
                  aria-describedby={fieldError ? `${errorId}-m` : undefined}
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
            </Flex>
          </Grid>

          {row.dayTypeId && nonBillable ? (
            <Text size="1" color="gray">
              Doesn&apos;t bill
            </Text>
          ) : (
            <Flex direction="column" gap="1">
              <Text as="label" size="2" weight="medium" htmlFor={`${rateCtlId}-m`}>
                Rate (USD)
              </Text>
              <TextField.Root
                id={`${rateCtlId}-m`}
                size="1"
                inputMode="decimal"
                value={row.rate}
                disabled={!row.dayTypeId}
                aria-label={`Rate for ${weekday}`}
                aria-invalid={fieldError ? true : undefined}
                aria-describedby={fieldError ? `${errorId}-m` : undefined}
                onChange={(event) => setRow(date, { rate: event.target.value })}
              />
            </Flex>
          )}

          {/* Visible label — on the table, "Away" is a column header and
              the checkbox itself carries only an aria-label; a card has
              no header row to borrow that context from, so the label has
              to be here, in sight, not just in the accessibility tree. */}
          <Text as="label" size="2" htmlFor={`${awayCtlId}-m`}>
            <Flex align="center" gap="2">
              <Checkbox
                id={`${awayCtlId}-m`}
                checked={row.away}
                disabled={!row.dayTypeId}
                aria-label={`Away from home base on ${weekday}`}
                onCheckedChange={(checked) => setRow(date, { away: checked === true })}
              />
              Away from home base
            </Flex>
          </Text>

          <Flex direction="column" gap="1">
            <Text as="label" size="2" weight="medium" htmlFor={`${notesCtlId}-m`}>
              Notes
            </Text>
            <TextField.Root
              id={`${notesCtlId}-m`}
              size="1"
              value={row.notes}
              aria-label={`Notes for ${weekday}`}
              aria-invalid={fieldError ? true : undefined}
              aria-describedby={fieldError ? `${errorId}-m` : undefined}
              onChange={(event) => setRow(date, { notes: event.target.value })}
            />
          </Flex>

          {fieldError ? (
            <Text id={`${errorId}-m`} size="1" color="red">
              {fieldError}
            </Text>
          ) : null}
        </Flex>
      </Card>
    );

    return { date, tableRow, card };
  });

  return (
    <form action={formAction}>
      <input type="hidden" name="trip_id" value={tripId} />

      {existingDays.length === 0 && seed.seeded ? (
        <Box mb="3">
          <Text size="1" color="gray">
            Seeded from this trip&apos;s day counts. Check it before saving.
            Which dates are travel versus flight days (travel first and
            last, flight in between), and where a half day lands, is a
            guess based on the counts alone, not this trip&apos;s real
            day-by-day record. Verify every row.
            {seed.approximate
              ? " Some days didn't fit the trip's dates and were left blank."
              : ""}
          </Text>
        </Box>
      ) : null}

      {/* Bulk apply, above the editor (both shapes below it) — see
          applyDayTypeToAll/applyRateToMatching above for the mechanism.
          A Card, not a Box, so it reads as one distinct tool rather than
          floating unbounded above the grid. */}
      <Card mb="4">
        <Text as="div" size="2" weight="medium" mb="2">
          Set many days at once
        </Text>
        <Flex gap="3" wrap="wrap" align="end">
          <Flex direction="column" gap="1">
            <Text as="label" size="2" weight="medium" htmlFor="bulk-day-type">
              Day type
            </Text>
            {/* Same generation-keyed remount as every other Select in this
                form — see the formGen comment near the top of this
                component. This select has no `name`, but form.reset()
                resets every listed element in the form regardless of
                `name`, so it is exposed to the same stale-defaultValue
                hazard as a posting one. */}
            <Select.Root
              key={`bulk-day-type-${formGen}`}
              size="2"
              value={bulkDayTypeId}
              onValueChange={setBulkDayTypeId}
            >
              <Select.Trigger
                id="bulk-day-type"
                placeholder="Choose a day type…"
                style={{ minWidth: "200px" }}
              />
              <Select.Content>
                {activeDayTypes.map((t) => (
                  <Select.Item key={t.id} value={t.id}>
                    {t.label}
                  </Select.Item>
                ))}
              </Select.Content>
            </Select.Root>
          </Flex>
          <Button
            type="button"
            variant="soft"
            disabled={pending || !bulkDayTypeId}
            onClick={applyDayTypeToAll}
          >
            Apply to all days
          </Button>

          <Flex direction="column" gap="1">
            <Text as="label" size="2" weight="medium" htmlFor="bulk-rate">
              Rate (USD)
            </Text>
            <TextField.Root
              id="bulk-rate"
              size="2"
              inputMode="decimal"
              value={bulkRate}
              style={{ width: "110px" }}
              onChange={(event) => setBulkRate(event.target.value)}
            />
          </Flex>
          <Button
            type="button"
            variant="soft"
            disabled={pending || !bulkDayTypeId || !bulkRateValid || matchingCount === 0}
            onClick={applyRateToMatching}
          >
            {bulkTypeLabel ? `Apply to all ${bulkTypeLabel} days` : "Apply to all matching days"}
          </Button>
        </Flex>

        {/* One-shot announcement, same pattern as settings/category-row.tsx's
            moveNotice — separate from the role="alert" region below (which is
            keyed to the SAVE action's state), because a bulk apply changes
            nothing on the server and would otherwise say nothing at all to a
            screen reader. */}
        <div aria-live="polite" role="status">
          {bulkNotice ? (
            <Text as="div" size="1" color="gray" mt="2">
              {bulkNotice}
            </Text>
          ) : null}
        </div>
      </Card>

      {/* Two shapes of the SAME editor, both always in the DOM —
          only `display` toggles across the `md` breakpoint, the same
          idiom nav-rail.tsx's NavRail/NavStrip and app-shell.tsx document.
          Never conditionally mounted: that would re-run this component's
          mount logic (and could desync from `rows`) every time a window
          crosses the breakpoint, which is exactly what this idiom exists
          to avoid. */}
      <Box display={{ initial: "none", md: "block" }}>
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
            <Table.Body>{dayRows.map((r) => r.tableRow)}</Table.Body>
          </Table.Root>
        </Box>
      </Box>

      <Box display={{ initial: "block", md: "none" }}>
        <Flex direction="column" gap="3">
          {dayRows.map((r) => r.card)}
        </Flex>
      </Box>

      <Box mt="3">
        <Text size="2" weight="medium" className="tnum">
          Running total: {formatCents(liveTotalCents)}
        </Text>
        <Text as="div" size="1" color="gray">
          Updates as you edit below, before you save. Day rows only.
          Per diem, the contract minimum and rebilled expenses aren&rsquo;t
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
  // Same "compute each date's display values once, render both shapes
  // from it" shape as DayGrid's own dayRows — see that comment above.
  const rows = dates.map((date) => {
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
    return { date, existing, label };
  });

  return (
    <Box>
      {/* The locked view gets the same always-mounted,
          display-toggled table/card pair as the editable grid — nothing
          here posts, so there is no name/hidden-input concern, only the
          same layout swap. */}
      <Box display={{ initial: "none", md: "block" }}>
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
              {rows.map(({ date, existing, label }) => (
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
              ))}
            </Table.Body>
          </Table.Root>
        </Box>
      </Box>

      <Box display={{ initial: "block", md: "none" }}>
        <Flex direction="column" gap="3">
          {rows.map(({ date, existing, label }) => (
            <Card key={date}>
              <Flex direction="column" gap="2">
                <Heading as="h3" size="2">
                  {formatDateWithWeekday(date)}
                </Heading>
                <ReadOnlyField label="Day type" value={label} />
                <ReadOnlyField
                  label="Quantity"
                  value={existing ? quantityToInput(existing.quantity) : "—"}
                  numeric
                />
                <ReadOnlyField
                  label="Rate"
                  value={existing ? formatCents(existing.rate_cents) : "—"}
                  numeric
                />
                <ReadOnlyField
                  label="Rate fraction"
                  value={existing ? unitsToInput(existing.units) : "—"}
                  numeric
                />
                <ReadOnlyField
                  label="Away"
                  value={existing ? (existing.away ? "Away" : "Home base") : "—"}
                />
                <ReadOnlyField label="Notes" value={existing?.notes ?? ""} />
              </Flex>
            </Card>
          ))}
        </Flex>
      </Box>
    </Box>
  );
}

/** A read-only card's one label/value pair. The table leans on its column
 * headers for context; a card has none, so every value needs its own
 * visible caption — same reasoning as the editable card's field labels
 * above. */
function ReadOnlyField({
  label,
  value,
  numeric,
}: {
  label: string;
  value: string;
  numeric?: boolean;
}) {
  return (
    <Box>
      <Text as="div" size="1" color="gray">
        {label}
      </Text>
      <Text as="div" size="2" color="gray" className={numeric ? "tnum" : undefined}>
        {value}
      </Text>
    </Box>
  );
}

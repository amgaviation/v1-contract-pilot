"use client";

import { Fragment, useActionState, useEffect, useMemo, useState } from "react";
import { LAlert, LButton, LCard, LTable, LTd, LTh } from "@/components/ledger";
import { LCheckbox, LField, LInput, LSelect } from "@/components/ledger/forms";
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

/** A native <select> takes an empty-string option value without complaint,
 * unlike the Radix Select this component used before the Ledger migration —
 * but "— not counted —" is still translated through a sentinel rather than
 * posted directly, so the mechanics below (formGen remount included) stay
 * byte-for-byte what they were: a hidden input per row always posts the
 * real day_type_id, translating the sentinel back to "" before it reaches
 * the field name the server action reads. */
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

  // WHY formGen EXISTS, PRESERVED FROM THE PRE-LEDGER RADIX VERSION OF
  // THIS FILE RATHER THAN RE-DERIVED: Radix's Select.Root always rendered
  // its posting <select> with `defaultValue`, never `value`, so it was
  // uncontrolled from React's point of view no matter what was passed to
  // Select.Root, and React 19's post-action form.reset() restored that
  // <select> to its mount-time option — firing a change event Radix
  // forwarded straight into onValueChange with the STALE, mount-time day
  // type, silently overwriting whatever the pilot had typed since.
  //
  // The fix was to make the stale defaultValue impossible: every dispatch
  // (success or reject) remounts every row's selects via a
  // generation-keyed `key`. The remount happens during the same commit's
  // DOM-mutation phase, before React's effect-scheduled form.reset() runs
  // — so by the time the browser resets the (now-replaced) <select>, its
  // fresh defaultValue already reflects the pilot's latest state, and the
  // reset is a no-op.
  //
  // Every select below is now a real, controlled native <select
  // value={...}>, which React's own controlled-input value tracker keeps
  // in sync after an external DOM mutation like form.reset() even without
  // this mechanism — but the migration brief for this file calls for
  // reskinning the JSX only, preserving the pattern and its mechanics
  // exactly, so formGen and every one of its remount keys stay exactly as
  // they were.
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
    // appear as a selectable option, or the select would carry a value
    // with no matching option and the pilot's already-captured day type
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
   * exact same resolution a single row's select uses — rate/units/away
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
  // exact list the bulk day-type select itself offers, so a bulk-selected
  // id can never fail to resolve a label here.
  function labelForDayType(dayTypeId: string): string | undefined {
    return activeDayTypes.find((t) => t.id === dayTypeId)?.label;
  }

  // Every date at once, via resolveDayTypeFields above — never a
  // second, hand-rolled resolution. One setRows call rather than N per-date
  // setRow calls, so a 31-day trip's bulk apply is one re-render, not 31.
  // quantity/notes are left alone, same as a single row's own select only
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
      <div>
        <div className="mb-3">
          <p className="text-caption text-ink-3">
            {billedOn
              ? `This trip is billed on ${billedOn}. Its day rows are frozen here. Correcting them would leave the trip and that invoice disagreeing about what was flown. Remove it from the invoice first.`
              : "This trip is on an invoice. Its day rows are frozen here. Correcting them would leave the trip and the invoice that has already gone out disagreeing about what was flown."}
          </p>
        </div>
        <ReadOnlyGrid dates={dates} existingByDate={existingByDate} dayTypeById={dayTypeById} allDayTypes={dayTypes} />
      </div>
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
  // shapes — a <tr> (+ its optional error row) for the md-and-up
  // table, and a card for the below-md stack. Building both from the
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
        <tr>
          <LTd className="whitespace-nowrap">{weekday}</LTd>
          <LTd className="min-w-[180px]">
            {/* The real day_type_id, always in sync with row.dayTypeId
                — see NOT_COUNTED above for why the select itself
                can't post this directly. */}
            <input type="hidden" name={dayTypeFieldName(date)} value={row.dayTypeId} />
            <LSelect
              key={`day-type-${date}-${formGen}`}
              id={dayTypeCtlId}
              value={row.dayTypeId === "" ? NOT_COUNTED : row.dayTypeId}
              onChange={(e) =>
                handleDayTypeChange(date, e.target.value === NOT_COUNTED ? "" : e.target.value)
              }
              aria-label={`Day type for ${weekday}`}
              aria-invalid={fieldError ? true : undefined}
              aria-describedby={fieldError ? errorId : undefined}
            >
              <option value={NOT_COUNTED}>(not counted)</option>
              {options.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.archived_at ? `${t.label} (archived)` : t.label}
                </option>
              ))}
            </LSelect>
          </LTd>
          <LTd className="min-w-[130px]">
            {/* Quantity is never blank, so the field name can go
                directly on the select — no sentinel needed. */}
            <input type="hidden" name={quantityFieldName(date)} value={row.quantity} />
            <LSelect
              key={`quantity-${date}-${formGen}`}
              id={quantityCtlId}
              value={row.quantity}
              disabled={!row.dayTypeId}
              onChange={(e) => setRow(date, { quantity: e.target.value })}
              aria-label={`Quantity for ${weekday}`}
              aria-invalid={fieldError ? true : undefined}
              aria-describedby={fieldError ? errorId : undefined}
            >
              {quantityOptionsFor(row.quantity).map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </LSelect>
          </LTd>
          <LTd numeric className="min-w-[140px]">
            {row.dayTypeId && nonBillable ? (
              <>
                <input type="hidden" name={rateFieldName(date)} value="0" />
                <span className="text-caption text-ink-3">Doesn&apos;t bill</span>
              </>
            ) : (
              <LInput
                id={rateCtlId}
                inputMode="decimal"
                name={rateFieldName(date)}
                value={row.rate}
                disabled={!row.dayTypeId}
                aria-label={`Rate for ${weekday}`}
                aria-invalid={fieldError ? true : undefined}
                aria-describedby={fieldError ? errorId : undefined}
                onChange={(event) => setRow(date, { rate: event.target.value })}
              />
            )}
          </LTd>
          <LTd className="min-w-[130px]">
            {/* Rate fraction is never blank, same as Quantity —
                no sentinel needed on the select. Shown even for
                a non-billable day type: it stores a value
                regardless (harmless, since rate_cents is forced
                to 0 for those rows), and hiding it would be one
                more special case for no benefit. */}
            <input type="hidden" name={unitsFieldName(date)} value={row.units} />
            <LSelect
              key={`units-${date}-${formGen}`}
              id={unitsCtlId}
              value={row.units}
              disabled={!row.dayTypeId}
              onChange={(e) => setRow(date, { units: e.target.value })}
              aria-label={`Rate fraction for ${weekday}`}
              aria-invalid={fieldError ? true : undefined}
              aria-describedby={fieldError ? errorId : undefined}
            >
              {unitsOptionsFor(row.units).map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </LSelect>
          </LTd>
          <LTd>
            <input type="hidden" name={awayFieldName(date)} value={row.away ? "on" : "off"} />
            <LCheckbox
              id={awayCtlId}
              checked={row.away}
              disabled={!row.dayTypeId}
              aria-label={`Away from home base on ${weekday}`}
              onChange={(e) => setRow(date, { away: e.target.checked })}
            />
          </LTd>
          <LTd className="min-w-[180px]">
            <LInput
              id={notesCtlId}
              name={notesFieldName(date)}
              value={row.notes}
              aria-label={`Notes for ${weekday}`}
              aria-invalid={fieldError ? true : undefined}
              aria-describedby={fieldError ? errorId : undefined}
              onChange={(event) => setRow(date, { notes: event.target.value })}
            />
          </LTd>
        </tr>
        {fieldError ? (
          <tr>
            <td colSpan={7} className="pt-0 pb-2.5 px-3">
              <p id={errorId} className="text-caption font-medium text-crit">
                {fieldError}
              </p>
            </td>
          </tr>
        ) : null}
      </Fragment>
    );

    // The stacked-card shape. Same `row`, same setRow/
    // handleDayTypeChange calls as the table row above — this can never
    // disagree with it because it IS it, read from the same state. Every
    // control gets its OWN visible label (a card has no column header to
    // borrow one from, unlike the table) and its own `-m` id suffix so
    // ids stay unique across both always-mounted shapes; the formGen key
    // below is the same remount trick the table's selects use, for the
    // same reason — see this component's own formGen comment, near its
    // top (the useState/useEffect pair that defines it).
    const card = (
      <LCard key={date}>
        <div className="flex flex-col gap-3">
          <h3 className="text-h3 font-semibold">{weekday}</h3>

          <LField label="Day type" htmlFor={`${dayTypeCtlId}-m`}>
            <LSelect
              key={`day-type-${date}-${formGen}-m`}
              id={`${dayTypeCtlId}-m`}
              value={row.dayTypeId === "" ? NOT_COUNTED : row.dayTypeId}
              onChange={(e) =>
                handleDayTypeChange(date, e.target.value === NOT_COUNTED ? "" : e.target.value)
              }
              aria-invalid={fieldError ? true : undefined}
              aria-describedby={fieldError ? `${errorId}-m` : undefined}
            >
              <option value={NOT_COUNTED}>(not counted)</option>
              {options.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.archived_at ? `${t.label} (archived)` : t.label}
                </option>
              ))}
            </LSelect>
          </LField>

          <div className="grid grid-cols-2 gap-3">
            <LField label="Quantity" htmlFor={`${quantityCtlId}-m`}>
              <LSelect
                key={`quantity-${date}-${formGen}-m`}
                id={`${quantityCtlId}-m`}
                value={row.quantity}
                disabled={!row.dayTypeId}
                onChange={(e) => setRow(date, { quantity: e.target.value })}
                aria-invalid={fieldError ? true : undefined}
                aria-describedby={fieldError ? `${errorId}-m` : undefined}
              >
                {quantityOptionsFor(row.quantity).map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </LSelect>
            </LField>

            <LField label="Rate fraction" htmlFor={`${unitsCtlId}-m`}>
              <LSelect
                key={`units-${date}-${formGen}-m`}
                id={`${unitsCtlId}-m`}
                value={row.units}
                disabled={!row.dayTypeId}
                onChange={(e) => setRow(date, { units: e.target.value })}
                aria-invalid={fieldError ? true : undefined}
                aria-describedby={fieldError ? `${errorId}-m` : undefined}
              >
                {unitsOptionsFor(row.units).map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </LSelect>
            </LField>
          </div>

          {row.dayTypeId && nonBillable ? (
            <span className="text-caption text-ink-3">Doesn&apos;t bill</span>
          ) : (
            <LField label="Rate (USD)" htmlFor={`${rateCtlId}-m`}>
              <LInput
                id={`${rateCtlId}-m`}
                inputMode="decimal"
                value={row.rate}
                disabled={!row.dayTypeId}
                aria-invalid={fieldError ? true : undefined}
                aria-describedby={fieldError ? `${errorId}-m` : undefined}
                onChange={(event) => setRow(date, { rate: event.target.value })}
              />
            </LField>
          )}

          {/* Visible label — on the table, "Away" is a column header and
              the checkbox itself carries only an aria-label; a card has
              no header row to borrow that context from, so the label has
              to be here, in sight, not just in the accessibility tree. */}
          <label htmlFor={`${awayCtlId}-m`} className="flex items-center gap-2 text-body-s text-ink">
            <LCheckbox
              id={`${awayCtlId}-m`}
              checked={row.away}
              disabled={!row.dayTypeId}
              aria-label={`Away from home base on ${weekday}`}
              onChange={(e) => setRow(date, { away: e.target.checked })}
            />
            Away from home base
          </label>

          <LField label="Notes" htmlFor={`${notesCtlId}-m`}>
            <LInput
              id={`${notesCtlId}-m`}
              value={row.notes}
              aria-invalid={fieldError ? true : undefined}
              aria-describedby={fieldError ? `${errorId}-m` : undefined}
              onChange={(event) => setRow(date, { notes: event.target.value })}
            />
          </LField>

          {fieldError ? (
            <p id={`${errorId}-m`} className="text-caption font-medium text-crit">
              {fieldError}
            </p>
          ) : null}
        </div>
      </LCard>
    );

    return { date, tableRow, card };
  });

  return (
    <form action={formAction}>
      <input type="hidden" name="trip_id" value={tripId} />

      {existingDays.length === 0 && seed.seeded ? (
        <div className="mb-3">
          <p className="text-caption text-ink-3">
            Seeded from this trip&apos;s day counts: travel first and last,
            flight between, half days guessed from the counts alone, not the
            real day-by-day record. Verify every row before saving.
            {seed.approximate
              ? " Some days didn't fit the trip's dates and were left blank."
              : ""}
          </p>
        </div>
      ) : null}

      {/* Bulk apply, above the editor (both shapes below it) — see
          applyDayTypeToAll/applyRateToMatching above for the mechanism.
          An LCard, so it reads as one distinct tool rather than floating
          unbounded above the grid. */}
      <LCard className="mb-4">
        <div className="mb-2 text-body-s font-medium text-ink">Set many days at once</div>
        <div className="flex flex-wrap items-end gap-3">
          <LField label="Day type" htmlFor="bulk-day-type">
            {/* Same generation-keyed remount as every other select in this
                form — see the formGen comment near the top of this
                component. This select has no `name`, but form.reset()
                resets every listed element in the form regardless of
                `name`, so it is kept in step with the same remount as a
                posting one. */}
            <LSelect
              key={`bulk-day-type-${formGen}`}
              id="bulk-day-type"
              className="min-w-[200px]"
              value={bulkDayTypeId}
              onChange={(e) => setBulkDayTypeId(e.target.value)}
            >
              <option value="" disabled>
                Choose a day type…
              </option>
              {activeDayTypes.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </LSelect>
          </LField>
          <LButton
            type="button"
            variant="outline"
            disabled={pending || !bulkDayTypeId}
            onClick={applyDayTypeToAll}
          >
            Apply to all days
          </LButton>

          <LField label="Rate (USD)" htmlFor="bulk-rate">
            <LInput
              id="bulk-rate"
              inputMode="decimal"
              value={bulkRate}
              className="w-[110px]"
              onChange={(event) => setBulkRate(event.target.value)}
            />
          </LField>
          <LButton
            type="button"
            variant="outline"
            disabled={pending || !bulkDayTypeId || !bulkRateValid || matchingCount === 0}
            onClick={applyRateToMatching}
          >
            {bulkTypeLabel ? `Apply to all ${bulkTypeLabel} days` : "Apply to all matching days"}
          </LButton>
        </div>

        {/* One-shot announcement, same pattern as settings/category-row.tsx's
            moveNotice — separate from the role="alert" region below (which is
            keyed to the SAVE action's state), because a bulk apply changes
            nothing on the server and would otherwise say nothing at all to a
            screen reader. */}
        <div aria-live="polite" role="status">
          {bulkNotice ? <p className="mt-2 text-caption text-ink-3">{bulkNotice}</p> : null}
        </div>
      </LCard>

      {/* Two shapes of the SAME editor, both always in the DOM —
          only `display` toggles across the `md` breakpoint, the same
          idiom nav-rail.tsx's NavRail/NavStrip and app-shell.tsx document.
          Never conditionally mounted: that would re-run this component's
          mount logic (and could desync from `rows`) every time a window
          crosses the breakpoint, which is exactly what this idiom exists
          to avoid. */}
      <div className="hidden md:block">
        <LTable>
          <caption>
            <span className="sr-only">Day grid</span>
          </caption>
          <thead>
            <tr>
              <LTh>Date</LTh>
              <LTh>Day type</LTh>
              <LTh className="min-w-[130px]">Quantity</LTh>
              <LTh numeric>Rate (USD)</LTh>
              <LTh className="min-w-[130px]">Rate fraction</LTh>
              <LTh>Away</LTh>
              <LTh>Notes</LTh>
            </tr>
          </thead>
          <tbody>{dayRows.map((r) => r.tableRow)}</tbody>
        </LTable>
      </div>

      <div className="block md:hidden">
        <div className="flex flex-col gap-3">{dayRows.map((r) => r.card)}</div>
      </div>

      <div className="mt-3">
        <p className="tnum-l text-body-s font-medium text-ink">
          Running total: {formatCents(liveTotalCents)}
        </p>
        <p className="text-caption text-ink-3">
          Updates as you edit below, before you save. Day rows only.
          Per diem, the contract minimum and rebilled expenses aren&rsquo;t
          included, so this won&rsquo;t match the invoice total.
        </p>
      </div>

      <div className="mt-3" role="alert" aria-live="polite">
        {state.error ? (
          <LAlert tone="crit">{state.error}</LAlert>
        ) : failingDates.length > 0 ? (
          <LAlert tone="crit">
            Fix {failingDates.length === 1 ? "this date" : "these dates"} before saving:{" "}
            {failingDates.map((d) => formatDateWithWeekday(d)).join(", ")}.
          </LAlert>
        ) : state.saved ? (
          <LAlert tone="good">Day grid saved.</LAlert>
        ) : null}
      </div>

      <div className="mt-4">
        <LButton type="submit" variant="outline" disabled={pending}>
          {pending ? "Saving…" : "Save day grid"}
        </LButton>
      </div>
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
    <div>
      {/* The locked view gets the same always-mounted,
          display-toggled table/card pair as the editable grid — nothing
          here posts, so there is no name/hidden-input concern, only the
          same layout swap. */}
      <div className="hidden md:block">
        <LTable>
          <caption>
            <span className="sr-only">Day grid (locked)</span>
          </caption>
          <thead>
            <tr>
              <LTh>Date</LTh>
              <LTh>Day type</LTh>
              <LTh>Quantity</LTh>
              <LTh numeric>Rate</LTh>
              <LTh>Rate fraction</LTh>
              <LTh>Away</LTh>
              <LTh>Notes</LTh>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ date, existing, label }) => (
              <tr key={date}>
                <LTd className="whitespace-nowrap">{formatDateWithWeekday(date)}</LTd>
                <LTd>
                  <span className="text-ink-2">{label}</span>
                </LTd>
                <LTd>
                  <span className="tnum-l text-ink-2">
                    {existing ? quantityToInput(existing.quantity) : "—"}
                  </span>
                </LTd>
                <LTd numeric>{existing ? formatCents(existing.rate_cents) : "—"}</LTd>
                <LTd>
                  <span className="tnum-l text-ink-2">
                    {existing ? unitsToInput(existing.units) : "—"}
                  </span>
                </LTd>
                <LTd>
                  <span className="text-ink-2">
                    {existing ? (existing.away ? "Away" : "Home base") : "—"}
                  </span>
                </LTd>
                <LTd>
                  <span className="text-ink-2">{existing?.notes ?? ""}</span>
                </LTd>
              </tr>
            ))}
          </tbody>
        </LTable>
      </div>

      <div className="block md:hidden">
        <div className="flex flex-col gap-3">
          {rows.map(({ date, existing, label }) => (
            <LCard key={date}>
              <div className="flex flex-col gap-2">
                <h3 className="text-h3 font-semibold">{formatDateWithWeekday(date)}</h3>
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
              </div>
            </LCard>
          ))}
        </div>
      </div>
    </div>
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
    <div>
      <div className="text-caption text-ink-3">{label}</div>
      <div className={numeric ? "tnum-l text-body-s text-ink-2" : "text-body-s text-ink-2"}>
        {value}
      </div>
    </div>
  );
}

/**
 * Pure helpers shared between the day grid's client component
 * (day-grid.tsx) and its server action (actions.ts). No "use client" or
 * "use server" directive on purpose — this file is imported from both.
 */
import { centsToInput, parseTenth } from "@/lib/format";

/**
 * Every calendar date from `startsOn` to `endsOn` inclusive, as
 * "YYYY-MM-DD" strings. Computed in UTC for the same reason
 * lib/format.ts's formatDate parses dates in UTC: a `date` column is a
 * calendar fact, not an instant, and must not shift with the server's or
 * the browser's local timezone.
 *
 * This is the ONLY source of the dates the day grid ever renders or
 * saves. The server action calls this against the trip's freshly-read
 * starts_on/ends_on rather than trusting anything posted from the
 * browser — see actions.ts's saveTripDays for why that matters.
 */
export function enumerateDates(startsOn: string, endsOn: string): string[] {
  const [sy, sm, sd] = startsOn.slice(0, 10).split("-").map(Number);
  const [ey, em, ed] = endsOn.slice(0, 10).split("-").map(Number);
  if (!sy || !sm || !sd || !ey || !em || !ed) return [];

  const start = Date.UTC(sy, sm - 1, sd);
  const end = Date.UTC(ey, em - 1, ed);
  const dates: string[] = [];
  for (let t = start; t <= end; t += 86_400_000) {
    dates.push(new Date(t).toISOString().slice(0, 10));
  }
  return dates;
}

/**
 * Field-name builders for the per-date inputs in the day grid's single
 * form. Keying by date rather than by row index means the server action
 * can look each one up directly against the date list IT computed —
 * it never has to trust (or even look at) a date value the browser
 * posted back.
 */
export function dayTypeFieldName(date: string): string {
  return `day_type:${date}`;
}
export function rateFieldName(date: string): string {
  return `rate:${date}`;
}
export function quantityFieldName(date: string): string {
  return `quantity:${date}`;
}
/** 20260807070000_trip_day_units_away_cancel.sql — the rate FRACTION this
 * day bills at (0 < x <= 1), distinct from quantityFieldName's TIME
 * fraction. */
export function unitsFieldName(date: string): string {
  return `units:${date}`;
}
/** Same migration — per-day "away from home base", the second half of
 * per-diem eligibility alongside the day type's counts_for_per_diem. */
export function awayFieldName(date: string): string {
  return `away:${date}`;
}
export function notesFieldName(date: string): string {
  return `notes:${date}`;
}

export type SeedDayType = {
  id: string;
  key: string;
  default_rate_cents: number | null;
  /** 20260807070000: the day type's default rate FRACTION, resolved into
   * a row's `units` at capture the same way default_rate_cents resolves
   * into `rate`. */
  default_units: number | null;
  archived_at: string | null;
  /**
   * Added for F2: a non-billable day type (e.g. the seeded "Off day")
   * never demands a rate — the day grid hides the rate field for it and
   * the server forces rate_cents to 0 regardless of what was posted.
   */
  billable: boolean;
  /**
   * M5 fix (2026-08-07): pilot.day_types.counts_for_per_diem — whether
   * this day type is the kind that ordinarily puts a pilot away from home
   * base (a flight or travel day, typically) versus one that never would
   * (an off day). Used to pre-tick a newly generated row's `away` instead
   * of a hardcoded false — see computeSeed and resolveAway below. Optional
   * (not `?? true` defaulted at the type level) because the caller may not
   * have this column plumbed through yet; every read site here falls back
   * to `true` rather than the old `false` when it's missing, since `true`
   * matches pilot.day_types.counts_for_per_diem's own DB default and a
   * missing column should not silently resurrect the bug this field
   * exists to fix.
   */
  counts_for_per_diem?: boolean;
};

export type SeedScalars = {
  dayRateCents: number;
  dayCount: number;
  travelDayRateCents: number | null;
  travelDayCount: number;
};

export type SeedRow = {
  dayTypeId: string;
  rate: string;
  notes: string;
  /**
   * The plain decimal text a <select> or its "custom value" fallback
   * shows — "1" for a full day, "0.5" for a half — never blank. Round-
   * trips any stored 0.1-step value even though the control only offers
   * Full/Half, the same way optionsFor() round-trips an archived day
   * type: see quantityToInput/parseQuantity below.
   */
  quantity: string;
  /**
   * 20260807070000: the rate FRACTION text ("1.00" full rate, "0.50" half
   * rate) — distinct from `quantity`. Never blank, same round-trip
   * discipline as quantity: see unitsToInput/parseUnits below.
   */
  units: string;
  /** 20260807070000: away from home base, for per-diem eligibility.
   * M5 fix: pre-ticked from the row's day type's counts_for_per_diem at
   * generation time (see computeSeed/resolveAway below) rather than
   * always false — the pilot still sees and can untick it per day, the
   * default just stops being wrong for the common case (a flight or
   * travel day almost always IS away from home base; an off day almost
   * never is). This is a visible, editable pre-tick, not a silent
   * determination — see 20260807070000's header, which objects to the
   * product GUESSING per diem, not to it defaulting a checkbox a pilot
   * can see and change before saving anything. */
  away: boolean;
};

export type SeedResult = {
  rows: Record<string, SeedRow>;
  /** True if anything was actually seeded (the trip has flight/travel days at all). */
  seeded: boolean;
  /**
   * True if the seed could not be an exact translation of the scalar
   * counts — more whole days were billed than the trip has calendar dates
   * for, a fractional day had nowhere left to land, or the 'flight'/
   * 'travel' day type doesn't exist (or was archived) so that slot was
   * left blank. Does NOT cover a fractional day_count on its own anymore
   * (F1) — that now seeds an exact half-day quantity row instead of being
   * floored away.
   */
  approximate: boolean;
};

/** Cents → plain decimal input text. Kept local to this file's quantity
 * concern (see centsToInput in lib/format.ts for the money equivalent):
 * a quantity is a fraction of a day, not money, and doesn't belong in the
 * money formatter. */
export function quantityToInput(quantity: number | null | undefined): string {
  if (quantity === null || quantity === undefined || !Number.isFinite(quantity)) {
    return "1";
  }
  return quantity.toFixed(1);
}

/**
 * Parses a day grid quantity field into the fraction of a day it
 * represents, or `undefined` if it isn't a valid pilot.trip_days.quantity
 * value — outside (0, 1], or carrying a second decimal place.
 *
 * Reuses parseTenth rather than re-deriving its bound-checking: the
 * column is numeric(3,1), and Postgres silently ROUNDS a second decimal
 * (0.25 -> 0.3) instead of rejecting it — parseTenth exists precisely to
 * catch that before it reaches the database. parseTenth alone allows 0
 * (it only rejects negative/over-max); the `quantity > 0` half of the
 * column's CHECK is enforced here.
 */
export function parseQuantity(raw: string): number | undefined {
  const value = parseTenth(raw, { max: 1 });
  // parseTenth only returns null when `allowBlank` is passed, which this
  // call doesn't — checked anyway so the type (number | null | undefined)
  // doesn't leak a null through as if it were a valid quantity.
  if (value === undefined || value === null || value <= 0) return undefined;
  return value;
}

/** Units (a rate fraction) → plain decimal input text, "1.00" for full
 * rate. Two decimal places, matching pilot.trip_days.units' numeric(3,2) —
 * quantityToInput above only needs one because trip_days.quantity is
 * numeric(3,1). */
export function unitsToInput(units: number | null | undefined): string {
  if (units === null || units === undefined || !Number.isFinite(units)) {
    return "1.00";
  }
  return units.toFixed(2);
}

/**
 * Parses a day grid units field into the rate fraction it represents, or
 * `undefined` if it isn't a valid pilot.trip_days.units value — outside
 * (0, 1], or carrying more than two decimal places.
 *
 * A local parser rather than reusing parseTenth: that helper checks ONE
 * decimal place (day_count/quantity are numeric(*,1)), but trip_days.units
 * is numeric(3,2) — two decimal places — and Postgres would silently
 * ROUND a third decimal rather than reject it, so the same "check the
 * scale here, not just the bound" reasoning parseTenth documents applies,
 * at a different scale.
 */
export function parseUnits(raw: string): number | undefined {
  const value = raw.trim();
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(value)) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 1) return undefined;
  return parsed;
}

/**
 * The trip screen's zero-state seed: turns the trip's existing scalar
 * day_rate_cents/day_count/travel_day_rate_cents/travel_day_count into a
 * displayed, UNSAVED grid — never written until the pilot saves. See the
 * migration's header comment ("ON THE BACKFILL") for why this must not
 * become a database write: the counts have no record of which calendar
 * dates were flight vs. travel days, so any placement is a guess, and a
 * machine must not silently re-price work by turning that guess into a
 * row.
 *
 * PLACEMENT (F6): travel days split between the front and back of the
 * trip — the canonical shape is travel out on day 1, travel back on the
 * last day — rather than all bunched at the start. Odd counts favor the
 * front. Flight days fill the calendar dates left in the middle.
 *
 * FRACTIONS (F1): a fractional day_count no longer floors away its
 * remainder. The whole flight days fill first, and if there's a leftover
 * fraction (e.g. 2.5 -> 2 whole + 0.5) it seeds one more row, at the
 * fractional quantity, in the next open slot — an exact translation, not
 * an approximation, so it no longer sets `approximate` on its own.
 */
export function computeSeed(
  dates: string[],
  dayTypes: SeedDayType[],
  scalars: SeedScalars
): SeedResult {
  const rows: Record<string, SeedRow> = {};
  for (const date of dates)
    rows[date] = {
      dayTypeId: "",
      rate: "",
      notes: "",
      quantity: "1",
      // This placeholder row (no day type assigned yet) always starts
      // units=1.00/away=false — there is no day type here to resolve
      // either from. The travel/flight loops below OVERWRITE this
      // placeholder once a day type is known: units stays hardcoded
      // 1.00 there too (see the loops' own comment — deliberately NOT
      // resolved from default_units, for backfill byte-compatibility),
      // but away IS resolved from the day type's counts_for_per_diem
      // (M5) since there is no equivalent "must match legacy billing
      // exactly" constraint on a checkbox that didn't exist before.
      units: "1.00",
      away: false,
    };

  const travelType =
    dayTypes.find((t) => t.key === "travel" && !t.archived_at) ?? null;
  const flightType =
    dayTypes.find((t) => t.key === "flight" && !t.archived_at) ?? null;

  const n = dates.length;
  let approximate = false;

  // Travel days: whole numbers only (parseTripForm requires
  // travel_day_count to be an integer), but guarded against a stray
  // fractional/negative value all the same.
  const travelRaw = Math.max(scalars.travelDayCount, 0);
  const travelWhole = Math.floor(travelRaw);
  if (travelWhole !== travelRaw) approximate = true;

  const travelClipped = Math.min(travelWhole, n);
  if (travelClipped < travelWhole) approximate = true;

  // Split front/back. Odd counts favor the front — travel OUT matters
  // more to a pilot scanning the grid than travel back, and it's also
  // the date a pilot looks at first.
  const frontTravel = Math.ceil(travelClipped / 2);
  const backTravel = travelClipped - frontTravel;

  const dayRaw = Math.max(scalars.dayCount, 0);
  const dayWhole = Math.floor(dayRaw);
  // Rounded to the nearest tenth rather than trusted raw: dayRaw came off
  // a numeric(5,1) column via floating point, and 2.5 - 2 can render as
  // 0.49999999999999994.
  const dayFraction = Math.round((dayRaw - dayWhole) * 10) / 10;

  const remainingSlots = Math.max(n - frontTravel - backTravel, 0);
  const dayWholeClipped = Math.min(dayWhole, remainingSlots);
  if (dayWholeClipped < dayWhole) approximate = true;

  const slotsAfterWholeDays = remainingSlots - dayWholeClipped;
  const hasFraction = dayFraction > 0;
  const fractionFits = hasFraction && slotsAfterWholeDays > 0;
  // A fraction with nowhere to land is exactly the old floor-and-drop
  // behavior — still approximate, because a day of billing silently has
  // no row.
  if (hasFraction && !fractionFits) approximate = true;

  const frontDates = dates.slice(0, frontTravel);
  const backDates = backTravel > 0 ? dates.slice(n - backTravel) : [];
  const middleDates = dates.slice(frontTravel, n - backTravel);
  const flightWholeDates = middleDates.slice(0, dayWholeClipped);
  const fractionDate = fractionFits ? middleDates[dayWholeClipped] : undefined;

  for (const date of [...frontDates, ...backDates]) {
    if (travelType) {
      rows[date] = {
        dayTypeId: travelType.id,
        rate: centsToInput(scalars.travelDayRateCents ?? 0),
        notes: "",
        quantity: "1",
        units: "1.00",
        away: resolveAwayFromDayType(travelType),
      };
    } else {
      approximate = true;
    }
  }
  for (const date of flightWholeDates) {
    if (flightType) {
      rows[date] = {
        dayTypeId: flightType.id,
        rate: centsToInput(scalars.dayRateCents),
        notes: "",
        quantity: "1",
        units: "1.00",
        away: resolveAwayFromDayType(flightType),
      };
    } else {
      approximate = true;
    }
  }
  if (fractionDate !== undefined) {
    if (flightType) {
      rows[fractionDate] = {
        dayTypeId: flightType.id,
        rate: centsToInput(scalars.dayRateCents),
        notes: "",
        quantity: quantityToInput(dayFraction),
        units: "1.00",
        away: resolveAwayFromDayType(flightType),
      };
    } else {
      approximate = true;
    }
  }

  const seeded =
    frontTravel > 0 || backTravel > 0 || dayWholeClipped > 0 || fractionDate !== undefined;
  return { rows, seeded, approximate: seeded && approximate };
}

/** Resolves a day type's pre-filled rate at capture: client override, then
 * the day type's own default, else blank. Never reads a saved
 * trip_days.rate_cents — see the migration's comment on that column for
 * why a resolved value must never overwrite a snapshot. */
export function resolveRate(
  dayTypeId: string,
  clientRateByType: Map<string, number>,
  dayTypeById: Map<string, SeedDayType>
): string {
  if (!dayTypeId) return "";
  const override = clientRateByType.get(dayTypeId);
  if (override !== undefined) return centsToInput(override);
  const dayType = dayTypeById.get(dayTypeId);
  if (dayType && dayType.default_rate_cents !== null) {
    return centsToInput(dayType.default_rate_cents);
  }
  return "";
}

/**
 * Resolves a day type's pre-filled rate FRACTION at capture: the day
 * type's own default_units, else "1.00" (full rate). No client-level
 * override exists for units — pilot.client_rates only overrides
 * rate_cents (see the trip_days migration's own comment on client_rates:
 * "Consulted ONLY at day capture, to fill trip_days.rate_cents"), and
 * this does not add a parallel per-client units override that was never
 * asked for. Never reads a saved trip_days.units — same snapshot
 * discipline as resolveRate.
 */
export function resolveUnits(
  dayTypeId: string,
  dayTypeById: Map<string, SeedDayType>
): string {
  if (!dayTypeId) return "1.00";
  const dayType = dayTypeById.get(dayTypeId);
  if (dayType && dayType.default_units !== null && dayType.default_units !== undefined) {
    return unitsToInput(dayType.default_units);
  }
  return "1.00";
}

/** M5: `true` unless the day type explicitly says
 * counts_for_per_diem = false. See SeedDayType.counts_for_per_diem's
 * comment for why the fallback is `true`, not the old `false` default,
 * when the caller hasn't fetched the column yet. */
function resolveAwayFromDayType(dayType: SeedDayType): boolean {
  return dayType.counts_for_per_diem !== false;
}

/**
 * Resolves a day type's pre-filled `away` value at capture: a visible,
 * editable pre-tick from the day type's own counts_for_per_diem, exactly
 * paralleling resolveRate/resolveUnits above. This is the capture-time
 * counterpart to computeSeed's use of the same rule for the legacy-trip
 * zero-state seed — call this whenever a day type is newly assigned to a
 * row that previously had none (the day grid's "pick a day type for this
 * date" interaction), so a fresh row does not silently default to "no per
 * diem" the way it did before M5. See SeedDayType.counts_for_per_diem and
 * the SeedRow.away comment for the full reasoning; the pilot still sees
 * and can untick this per day, the default just stops being wrong for the
 * common case.
 */
export function resolveAway(
  dayTypeId: string,
  dayTypeById: Map<string, SeedDayType>
): boolean {
  if (!dayTypeId) return false;
  const dayType = dayTypeById.get(dayTypeId);
  if (!dayType) return false;
  return resolveAwayFromDayType(dayType);
}

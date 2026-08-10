/**
 * Vocabularies and shapes for the currency engine. No logic lives here —
 * see docs/CURRENCY-SPEC.md for the regulatory reading each type encodes
 * and window.ts/general.ts/night.ts/instrument.ts/flight-review.ts/
 * medical.ts/part135.ts for the arithmetic.
 *
 * Dates are ISO "YYYY-MM-DD" STRINGS end to end, never Date objects across
 * a module boundary. lib/format.ts's parseCalendarDate comment already
 * documents why: `new Date("2026-08-05")` is UTC midnight, and a viewer
 * west of Greenwich renders it as August 4th. String comparison
 * (`a <= b`) is exact for zero-padded ISO and cannot drift with a
 * timezone — see window.ts's withinInclusive.
 *
 * SCOPE, STATED RATHER THAN LEFT SILENT (a deliberate refusal, not an
 * oversight — see docs/CURRENCY-SPEC.md §8 and the regulatory findings
 * this phase's audit produced): 61.57(f) and (g), night-vision-goggle
 * currency, are out of scope. Both carry their own calendar-month windows
 * (2 and 4 calendar months preceding the month of the flight) and no
 * pilot in this product's market flies NVG operations. Not built, not
 * gated, not a CurrencyType — recorded here so a reader diffing this file
 * against 61.57 finds a stated exclusion, not a silent gap.
 */

export type IsoDate = string; // "YYYY-MM-DD"

/**
 * VERBATIM, five, final. Note 'passenger_day' and 'passenger_night' are
 * legacy labels docs/PLAN.md locks — 61.57(a) is neither passenger-only
 * nor day-only (it reaches an empty two-crew repositioning leg and has no
 * time-of-day limit; see general.ts). The DISPLAY label lives in
 * describe.ts, never in this string.
 */
export type CurrencyType =
  | "passenger_day"
  | "passenger_night"
  | "instrument"
  | "flight_review"
  | "medical";

/**
 * VERBATIM, three, no fourth. "Estimated" is the whole claim — never
 * "current" / "legal" / "compliant". No "expiring soon": proximity is a
 * rendering concern, not a status.
 */
export type CurrencyStatus =
  | "estimated_current"
  | "estimated_not_current"
  | "insufficient_data";

/**
 * WHICH regulation produced a result. Not a second CurrencyType: a Part
 * 135 pilot who asserted 61.57(e)(3) gets a 'passenger_night' row computed
 * under 135.247(a)(2), whose landings need not be to a full stop where
 * 61.57(b)(1)'s must — see part135.ts. Without this field the two
 * arithmetics are indistinguishable once stored.
 */
export type RuleBasis =
  | "61.57(a)"
  | "61.57(b)"
  | "61.57(c)"
  | "61.56"
  | "61.23"
  | "135.247(a)(1)"
  | "135.247(a)(2)";

/**
 * Every reason a result can be `insufficient_data`. Each value names ONE
 * missing fact, never a bundle — a card that says "which field is missing
 * and where to enter it" needs a value per fact, not a category.
 */
export type MissingInput =
  | "airman_unattributed"
  | "role_unrecorded"
  | "sole_manipulator_unrecorded"
  | "intended_aircraft_absent"
  | "aircraft_unregistered"
  | "aircraft_gear_unrecorded"
  | "aircraft_category_class_unrecorded"
  | "aircraft_type_unrecorded"
  | "night_window_unasserted"
  | "approach_condition_unrecorded"
  | "unresolvable_simulator_row"
  | "device_category_unconfirmed"
  | "operating_rule_unspecified"
  | "flight_review_completion_absent"
  | "flight_review_completion_in_future"
  | "medical_never_computed"
  | "window_truncated";

/** Stable render order for a card's remedy list — never the order gates happened to fire in. */
export const MISSING_INPUT_ORDER: readonly MissingInput[] = [
  "airman_unattributed",
  "role_unrecorded",
  "sole_manipulator_unrecorded",
  "intended_aircraft_absent",
  "aircraft_unregistered",
  "aircraft_gear_unrecorded",
  "aircraft_category_class_unrecorded",
  "aircraft_type_unrecorded",
  "night_window_unasserted",
  "approach_condition_unrecorded",
  "unresolvable_simulator_row",
  "device_category_unconfirmed",
  "operating_rule_unspecified",
  "flight_review_completion_absent",
  "flight_review_completion_in_future",
  "medical_never_computed",
  "window_truncated",
];

/** BOTH ENDS INCLUSIVE, always. See window.ts's withinInclusive. */
export type DateWindow = { start: IsoDate; end: IsoDate };

/**
 * The resolved facts about an aircraft the engine needs — never a tail
 * number. lib/currency/read.ts is the only module that ever sees a tail
 * number; it resolves one to this shape (via tailKey +
 * pilot.aircraft) before calling any pure module here.
 */
export type AircraftFacts = {
  tailKey: string;
  typeRating: string | null;
  typeDesignator: string | null;
  categoryClass: string | null;
  gear: "tricycle" | "tailwheel" | "skid" | "float" | "ski" | null;
};

/** One logbook row, already resolved. NOT a database row — read.ts does that mapping. */
export type CurrencyEntry = {
  id: string;
  entryDate: IsoDate;
  airmanUserId: string | null;
  role: "PIC" | "SIC" | "SOLO" | "DUAL_RECEIVED" | null;
  /** null = unrecorded, NEVER read as false. See general.ts's gate. */
  soleManipulator: boolean | null;
  dayTakeoffs: number;
  nightTakeoffs: number;
  dayLandingsFullStop: number;
  dayLandingsTouchGo: number;
  nightLandingsFullStop: number;
  nightLandingsTouchGo: number;
  /** The 61.57(b)(1) window (1 hr after sunset to 1 hr before sunrise) — NOT the same clock as 14 CFR 1.1 night. See night.ts. */
  nightWindowAsserted: boolean | null;
  nightTime: number | null;
  approachesCount: number;
  approachType: string | null;
  approachCondition: "actual" | "simulated" | "neither" | null;
  holds: number;
  coursesInterceptedTracked: boolean;
  simulatorTime: number | null;
  simulatorDeviceType: "ffs" | "ftd" | "atd" | "other" | null;
  /**
   * pilot.logbook_entries.total_time — NOT NULL in the schema. This
   * product's own definition of a WHOLLY-simulator entry, reused rather
   * than invented here: supabase/migrations/20260810020000's CHECK
   * (logbook_entries_role_required_unless_simulator) permits a null role
   * only when `total_time = simulator_time`, and pilot.logbook_totals /
   * pilot.logbook_time_by_type (20260810110000/20260810150000) compute
   * AIRCRAFT time the same way, as total_time minus simulator_time. See
   * passenger-shared.ts's classifyForCurrency, which is the one place
   * this module compares the two.
   */
  totalTime: number;
  /** null = tail not in pilot.aircraft (unregistered), not "no aircraft flown." */
  aircraft: AircraftFacts | null;
};

/** One counted logbook row, for display item 3 — "the entries counted." */
export type CountedEntry = {
  entryId: string;
  entryDate: IsoDate;
  takeoffs: number;
  landings: number;
  approaches: number;
};

export type CurrencyResult = {
  currencyType: CurrencyType;
  ruleBasis: RuleBasis;
  status: CurrencyStatus;
  /** null only for medical — 61.23(d) has no single window; see medical.ts. */
  window: DateWindow | null;
  required: Record<string, number>; // e.g. {takeoffs: 3, landings: 3}
  observed: Record<string, number>;
  counted: readonly CountedEntry[];
  limitingDate: IsoDate | null;
  throughDate: IsoDate | null;
  /** medical's pilot-entered date — never computed. See medical.ts. */
  displayDate: IsoDate | null;
  /** non-empty IFF status === "insufficient_data". */
  missing: readonly MissingInput[];
  /** Informational text. Never changes status. */
  notes: readonly string[];
  /** Conservative choices made in producing this result, for the card. */
  assumptions: readonly string[];
};

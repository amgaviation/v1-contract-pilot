import type { FieldDef, CanonicalKey } from "./types";

/**
 * The canonical field catalogue every import path (ForeFlight, LogTen,
 * generic) maps onto. This is the single place that knows what a
 * logbook_entries row can hold, so the alias tables in foreflight.ts/
 * logten.ts and the pilot-facing mapper in generic.ts all stay in sync
 * with the schema by construction instead of by three copies agreeing.
 */
export const FIELD_DEFS: FieldDef[] = [
  { key: "entry_date", label: "Date", kind: "date", required: true },
  { key: "aircraft_ident", label: "Aircraft ident (tail number)", kind: "text" },
  { key: "aircraft_type", label: "Aircraft type", kind: "text" },
  { key: "from_icao", label: "From", kind: "icao" },
  { key: "to_icao", label: "To", kind: "icao" },
  { key: "role", label: "Role (PIC/SIC)", kind: "enum", options: ["PIC", "SIC"] },
  { key: "total_time", label: "Total time", kind: "time", required: true },
  { key: "pic_time", label: "PIC time", kind: "time" },
  { key: "sic_time", label: "SIC time", kind: "time" },
  { key: "solo_time", label: "Solo time", kind: "time" },
  { key: "cross_country_time", label: "Cross-country time", kind: "time" },
  { key: "night_time", label: "Night time", kind: "time" },
  { key: "instrument_actual_time", label: "Instrument (actual)", kind: "time" },
  { key: "instrument_simulated_time", label: "Instrument (simulated/hood)", kind: "time" },
  { key: "flight_instructor_time", label: "Dual given (CFI)", kind: "time" },
  { key: "dual_received_time", label: "Dual received", kind: "time" },
  { key: "simulator_time", label: "Full flight simulator/FTD/ATD time", kind: "time" },
  {
    key: "simulator_device_type",
    label: "Simulator device type",
    kind: "enum",
    // 'ffs' = full flight simulator, the only device 61.57(b)(2) accepts
    // for night currency; see the Phase 6-corrections migration.
    options: ["ffs", "ftd", "atd", "other"],
  },
  { key: "day_takeoffs", label: "Day takeoffs", kind: "count" },
  { key: "day_landings_full_stop", label: "Day landings: full stop", kind: "count" },
  { key: "day_landings_touch_go", label: "Day landings: touch & go", kind: "count" },
  { key: "night_takeoffs", label: "Night takeoffs", kind: "count" },
  { key: "night_landings_full_stop", label: "Night landings: full stop", kind: "count" },
  { key: "night_landings_touch_go", label: "Night landings: touch & go", kind: "count" },
  {
    key: "landings_total",
    label: "Landings: undifferentiated total (day/night, full-stop/touch-and-go not split)",
    kind: "count",
  },
  { key: "approaches_count", label: "Approaches (count)", kind: "count" },
  {
    key: "approach_type",
    label: "Approach type",
    kind: "enum",
    options: ["ils", "rnav_lpv", "rnav_lnav", "vor", "loc", "ndb", "visual", "other"],
  },
  {
    key: "approach_condition",
    label: "Approach condition: actual/simulated/neither (61.57(c)(1))",
    kind: "enum",
    // A different axis from approach_type (see db.ts's ApproachCondition
    // comment) — 'neither' is a real, disqualifying, asserted value,
    // distinct from an unmapped column (which stays null/unknown).
    options: ["actual", "simulated", "neither"],
  },
  { key: "holds", label: "Holds", kind: "count" },
  {
    key: "courses_intercepted_tracked",
    label: "Intercepted & tracked a course (61.57(c)(1)(iii))",
    kind: "enum",
    options: ["true", "false"],
  },
  { key: "view_limiting_pilot_name", label: "Safety pilot name (61.51(b)(1)(v))", kind: "text" },
  { key: "remarks", label: "Remarks", kind: "text" },
];

export const FIELD_DEF_BY_KEY: Partial<Record<CanonicalKey, FieldDef>> = Object.fromEntries(
  FIELD_DEFS.map((f) => [f.key, f])
);

/**
 * Parses a date cell that may be "YYYY-MM-DD" (ISO, what our own export
 * emits) or "M/D/YYYY" / "MM/DD/YYYY" (what ForeFlight, LogTen, and most
 * spreadsheet-edited logbooks emit). Returns an ISO "YYYY-MM-DD" string or
 * null.
 *
 * Deliberately does NOT go through `new Date(str)` anywhere — per
 * lib/format.ts's parseCalendarDate, that shifts across timezones for a
 * bare calendar date. Every branch below extracts y/m/d as integers by
 * hand and validates them arithmetically (including that the day exists
 * in that month, so "2026-02-30" is rejected rather than silently rolling
 * over to March).
 */
export function parseFlexibleDate(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;

  const isoMatch = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(value);
  const usMatch = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value);

  let y: number, m: number, d: number;
  if (isoMatch) {
    y = Number(isoMatch[1]);
    m = Number(isoMatch[2]);
    d = Number(isoMatch[3]);
  } else if (usMatch) {
    m = Number(usMatch[1]);
    d = Number(usMatch[2]);
    y = Number(usMatch[3]);
  } else {
    return null;
  }

  if (m < 1 || m > 12) return null;
  const daysInMonth = [31, isLeapYear(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const maxDay = daysInMonth[m - 1] ?? 31;
  if (d < 1 || d > maxDay) return null;
  if (y < 1900 || y > 2100) return null;

  const pad = (n: number) => String(n).padStart(2, "0");
  return `${y}-${pad(m)}-${pad(d)}`;
}

function isLeapYear(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

/** Non-negative whole number, capped the same way actions.ts's count() caps a manual entry. */
export function parseCount(raw: string): number | undefined {
  const value = raw.trim();
  if (value === "") return 0;
  if (!/^\d+$/.test(value)) return undefined;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0 || n > 999) return undefined;
  return n;
}

/** Uppercases and validates against the same pattern the schema's CHECK enforces. */
export function normalizeIcao(raw: string): string | null | undefined {
  const value = raw.trim().toUpperCase();
  if (value === "") return null;
  return /^[A-Z0-9]{3,4}$/.test(value) ? value : undefined;
}

/** Case-insensitive exact match against an enum's known values; no fuzzy guessing. */
export function normalizeEnum<T extends string>(
  raw: string,
  options: readonly T[]
): T | null | undefined {
  const value = raw.trim();
  if (value === "") return null;
  const hit = options.find((o) => o.toLowerCase() === value.toLowerCase());
  return hit ?? undefined;
}

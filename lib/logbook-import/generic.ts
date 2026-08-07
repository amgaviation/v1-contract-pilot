import { parseCsv } from "./csv";
import { applyMapping } from "./apply-mapping";
import { FIELD_DEFS } from "./fields";
import type { ColumnMapping, ParseResult } from "./types";

/**
 * The generic column mapper — the ONE path that must never be skipped
 * (see the import brief): any logbook kept outside ForeFlight or LogTen
 * has no other way in. Unlike foreflight.ts/logten.ts, there is no fixed
 * alias table standing in for the pilot's judgment; `suggestMapping`
 * below is a best-effort autofill to save typing, and the pilot reviews
 * and corrects it before anything is parsed for real via `applyGenericMapping`.
 */

function normalizeHeader(h: string): string {
  return h.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Loose, non-authoritative header-name guesses — always pilot-reviewable, never applied silently. */
const SUGGEST_ALIASES: Record<string, string> = {
  date: "entry_date",
  flightdate: "entry_date",
  tailnumber: "aircraft_ident",
  aircraftid: "aircraft_ident",
  aircraft: "aircraft_ident",
  aircrafttype: "aircraft_type",
  type: "aircraft_type",
  from: "from_icao",
  departure: "from_icao",
  origin: "from_icao",
  to: "to_icao",
  destination: "to_icao",
  arrival: "to_icao",
  role: "role",
  crewposition: "role",
  totaltime: "total_time",
  total: "total_time",
  pic: "pic_time",
  pictime: "pic_time",
  sic: "sic_time",
  sictime: "sic_time",
  solo: "solo_time",
  xc: "cross_country_time",
  crosscountry: "cross_country_time",
  night: "night_time",
  nighttime: "night_time",
  actualinstrument: "instrument_actual_time",
  imc: "instrument_actual_time",
  simulatedinstrument: "instrument_simulated_time",
  hood: "instrument_simulated_time",
  dualgiven: "flight_instructor_time",
  cfi: "flight_instructor_time",
  dualreceived: "dual_received_time",
  simulator: "simulator_time",
  sim: "simulator_time",
  simulatortype: "simulator_device_type",
  daylandingsfullstop: "day_landings_full_stop",
  daylandingstouchandgo: "day_landings_touch_go",
  nighttakeoffs: "night_takeoffs",
  nightlandingsfullstop: "night_landings_full_stop",
  nightlandingstouchandgo: "night_landings_touch_go",
  landings: "landings_total",
  totallandings: "landings_total",
  approaches: "approaches_count",
  approachtype: "approach_type",
  holds: "holds",
  remarks: "remarks",
  comments: "remarks",
  notes: "remarks",
};

export function parseGenericHeader(text: string): { header: string[]; dataRecords: ReturnType<typeof parseCsv> } | { error: string } {
  const records = parseCsv(text);
  if (records.length === 0) return { error: "That file is empty." };
  return { header: records[0]!.fields, dataRecords: records.slice(1) };
}

/** A best-effort starting mapping the pilot reviews and can change for every column before anything is imported. */
export function suggestMapping(header: string[]): ColumnMapping {
  return header.map((h) => {
    const guess = SUGGEST_ALIASES[normalizeHeader(h)];
    return (guess as ColumnMapping[number]) ?? "ignore";
  });
}

export function applyGenericMapping(
  header: string[],
  dataRecords: ReturnType<typeof parseCsv>,
  mapping: ColumnMapping
): ParseResult {
  return applyMapping({ format: "generic_csv", headerRow: header, dataRecords, mapping });
}

export const MAPPABLE_FIELDS = FIELD_DEFS;

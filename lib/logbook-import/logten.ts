import { parseCsv } from "./csv";
import { applyMapping } from "./apply-mapping";
import type { ColumnMapping, ParseResult } from "./types";

/**
 * LogTen Pro's CSV export, unlike ForeFlight's, is one flat table with a
 * single header row — no sections to locate. Its column names vary
 * somewhat by the pilot's chosen export template (LogTen lets a user pick
 * which fields to include and rename them), so this alias table covers
 * LogTen's standard/default field names; a pilot on a customized template
 * whose headers don't match falls through to "couldn't recognize enough
 * columns" and is pointed at the generic mapper, same as ForeFlight.
 */
const LOGTEN_ALIASES: Record<string, string> = {
  flightdate: "entry_date",
  date: "entry_date",
  aircraftid: "aircraft_ident",
  aircrafttailnumber: "aircraft_ident",
  aircrafttype: "aircraft_type",
  from: "from_icao",
  departureairport: "from_icao",
  to: "to_icao",
  destinationairport: "to_icao",
  totaltime: "total_time",
  totalflighttime: "total_time",
  pictime: "pic_time",
  sictime: "sic_time",
  solotime: "solo_time",
  crosscountrytime: "cross_country_time",
  nighttime: "night_time",
  actualinstrumenttime: "instrument_actual_time",
  simulatedinstrumenttime: "instrument_simulated_time",
  cfitime: "flight_instructor_time",
  dualgiven: "flight_instructor_time",
  dualreceivedtime: "dual_received_time",
  simulatortime: "simulator_time",
  simulatortype: "simulator_device_type",
  daytakeoffs: "day_takeoffs",
  daylandingsfullstop: "day_landings_full_stop",
  daylandingstouchandgo: "day_landings_touch_go",
  nighttakeoffs: "night_takeoffs",
  nightlandingsfullstop: "night_landings_full_stop",
  nightlandingstouchandgo: "night_landings_touch_go",
  totallandings: "landings_total",
  approaches: "approaches_count",
  numberapproaches: "approaches_count",
  approachtype: "approach_type",
  holds: "holds",
  remarks: "remarks",
  comments: "remarks",
};

function normalizeHeader(h: string): string {
  return h.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function parseLogTen(text: string): ParseResult | { error: string } {
  const records = parseCsv(text);
  if (!Array.isArray(records)) return records; // { error }: e.g. an unclosed quote
  if (records.length === 0) {
    return { error: "That file is empty." };
  }
  const headerRow = records[0]!.fields;
  const dataRecords = records.slice(1);

  const mapping: ColumnMapping = headerRow.map((h) => {
    const key = LOGTEN_ALIASES[normalizeHeader(h)];
    return key as ColumnMapping[number];
  });

  if (!mapping.includes("entry_date") || !mapping.includes("total_time")) {
    return {
      error:
        "Couldn't find Date and TotalTime columns in this file's header. Try the generic CSV mapper instead.",
    };
  }

  return applyMapping({ format: "logten", headerRow, dataRecords, mapping });
}

import { parseCsv } from "./csv";
import { applyMapping } from "./apply-mapping";
import type { ColumnMapping, ParseResult } from "./types";

/**
 * ForeFlight's "Logbook" CSV export is not one flat table — it's several
 * sections in one file: an "Aircraft Table" (tail numbers/types the pilot
 * has flown), then a "Flights Table" (the actual flight records this
 * import cares about), each introduced by a line whose first cell is the
 * section's name and followed by its own header row. Anything before or
 * after the Flights Table (the Aircraft Table, ForeFlight's disclaimer
 * preamble, per-aircraft/category totals ForeFlight appends at the end)
 * is not flight data and must be skipped, not fed to the row parser as
 * malformed rows.
 *
 * ALIASES BELOW mirror ForeFlight's documented Flights Table column
 * names. A pilot whose export doesn't match this table (a ForeFlight
 * template variant, or a future ForeFlight schema change) gets a clear
 * "couldn't find a Flights Table" error directing them to the generic
 * mapper instead of a wall of per-row rejections — the generic path is
 * the deliberate fallback for exactly this case.
 */
const FOREFLIGHT_ALIASES: Record<string, string> = {
  date: "entry_date",
  aircraftid: "aircraft_ident",
  aircrafttype: "aircraft_type",
  typecode: "aircraft_type",
  from: "from_icao",
  to: "to_icao",
  totaltime: "total_time",
  pic: "pic_time",
  sic: "sic_time",
  solo: "solo_time",
  crosscountry: "cross_country_time",
  night: "night_time",
  actualinstrument: "instrument_actual_time",
  simulatedinstrument: "instrument_simulated_time",
  dualgiven: "flight_instructor_time",
  dualreceived: "dual_received_time",
  simulatedflight: "simulator_time",
  daytakeoffs: "ignore",
  daylandingsfullstop: "day_landings_full_stop",
  nighttakeoffs: "night_takeoffs",
  nightlandingsfullstop: "night_landings_full_stop",
  alllandings: "landings_total",
  holds: "holds",
  pilotcomments: "remarks",
  instructorcomments: "remarks",
};

function normalizeHeader(h: string): string {
  return h.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Locates the "Flights Table" section: the line whose sole/first
 * meaningful cell equals "Flights Table" (ForeFlight's own section
 * marker), takes the following line as that section's header, and reads
 * data rows until the next section marker (a line whose first cell ends
 * in "Table") or end of file.
 */
export function parseForeflight(text: string): ParseResult | { error: string } {
  const records = parseCsv(text);
  const sectionStart = records.findIndex(
    (r) => (r.fields[0] ?? "").trim().toLowerCase() === "flights table"
  );
  if (sectionStart === -1 || sectionStart + 1 >= records.length) {
    return {
      error:
        "Couldn't find a \"Flights Table\" section — this doesn't look like a ForeFlight logbook export. Try the generic CSV mapper instead.",
    };
  }

  // Non-null: the length guard above already rejects sectionStart + 1
  // being out of bounds.
  const headerRow = records[sectionStart + 1]!.fields;
  const dataRecords: typeof records = [];
  for (let i = sectionStart + 2; i < records.length; i++) {
    const record = records[i]!;
    const first = (record.fields[0] ?? "").trim().toLowerCase();
    // Two independent signals that the Flights Table has ended: an
    // explicit "... Table" marker (the start of the NEXT section, if one
    // follows), or — the more reliable one, since ForeFlight also
    // appends per-aircraft/category "Totals" sections that don't end in
    // "Table" at all — a row whose column count no longer matches the
    // Flights Table's own header. A totals/summary row is structurally a
    // different shape, so this catches it without hardcoding every
    // possible trailing section name ForeFlight might use.
    if (first.endsWith("table") || record.fields.length !== headerRow.length) break;
    dataRecords.push(record);
  }

  const mapping: ColumnMapping = headerRow.map((h) => {
    const key = FOREFLIGHT_ALIASES[normalizeHeader(h)];
    return key as ColumnMapping[number];
  });

  if (!mapping.includes("entry_date") || !mapping.includes("total_time")) {
    return {
      error:
        "Recognized a Flights Table but couldn't find Date and TotalTime columns in it. Try the generic CSV mapper instead.",
    };
  }

  return applyMapping({ format: "foreflight", headerRow, dataRecords, mapping });
}

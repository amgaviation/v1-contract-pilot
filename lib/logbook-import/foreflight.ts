import { parseCsv, type CsvRecord } from "./csv";
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
 *
 * NO "approaches_count" alias, DELIBERATELY: ForeFlight's own official
 * logbook CSV template (verified against the template shipped in
 * https://github.com/riscfuture/logten2foreflight, a converter targeting
 * ForeFlight's real column set) has no single "approaches count" column
 * at all — instrument approaches are recorded as up to six separate
 * columns (Approach1..Approach6), each holding one approach's type as
 * text, not a count. That doesn't fit this pipeline's one-canonical-key-
 * per-source-column model, and NOT VERIFIED here is what a Flights-Table
 * EXPORT (as opposed to the import template) calls its approach columns,
 * if it exports them at all — so rather than guess a plausible-looking
 * column name (which would silently swallow real approach counts under a
 * name that doesn't exist in the pilot's file), approaches_count is left
 * unmapped. apply-mapping.ts's `unmappedCountLabels` mechanism turns that
 * into an honest per-row remarks note instead of a bare, indistinguishable
 * "0 approaches" — see the comment there.
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

/** A data record whose row-shape is already known to be unrecoverable (more columns than the header) — carries the rejection reason through to applyMapping unparsed, so numbering/ordering stays a single pass over the section. */
type MappableRecord = CsvRecord & { forceReject?: string };

/**
 * Locates the "Flights Table" section: the line whose sole/first
 * meaningful cell equals "Flights Table" (ForeFlight's own section
 * marker), takes the following line as that section's header, and reads
 * data rows until the next section marker (a line whose first cell ends
 * in "Table") or end of file.
 */
export function parseForeflight(text: string): ParseResult | { error: string } {
  const records = parseCsv(text);
  if (!Array.isArray(records)) return records; // { error }: e.g. an unclosed quote

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
  const dataRecords: MappableRecord[] = [];
  for (let i = sectionStart + 2; i < records.length; i++) {
    const record = records[i]!;
    const first = (record.fields[0] ?? "").trim().toLowerCase();
    // The ONE reliable end-of-section signal is an explicit "... Table"
    // marker — the start of the NEXT section, if one follows. A row's
    // column count no longer matching the header is NOT the same signal:
    // that's a malformed/ragged DATA row (a spreadsheet round-trip
    // leaving a stray trailing comma is common), and treating it as
    // "end of section" used to silently drop it and every row after it
    // for the rest of the file. Handle the two independently below.
    if (first.endsWith("table")) break;

    if (record.fields.length === headerRow.length) {
      dataRecords.push(record);
      continue;
    }
    if (record.fields.length < headerRow.length) {
      // Fewer fields than the header is recoverable: the fields that ARE
      // present keep their original column meaning (a short row reads a
      // trailing run of columns as blank, same as if the pilot's export
      // just omitted trailing optional cells), so pad rather than reject.
      const padded = record.fields.concat(
        Array(headerRow.length - record.fields.length).fill("")
      );
      dataRecords.push({ fields: padded, raw: record.raw });
      continue;
    }
    // MORE fields than the header is not safely recoverable — there is no
    // way to know which cell is the spurious extra one (a stray comma
    // from a spreadsheet round-trip could be anywhere in the row), so
    // guessing would risk shifting every later column silently. Reject
    // this one row, by name, and keep reading the rest of the section.
    dataRecords.push({
      fields: [],
      raw: record.raw,
      forceReject: `Row has ${record.fields.length} columns; the Flights Table header has ${headerRow.length}. Skipped — couldn't tell which column was extra.`,
    });
  }

  if (dataRecords.length === 0) {
    return {
      error:
        "Found a \"Flights Table\" header but no data rows after it. If your logbook has flights, this file's Flights Table section may be empty or malformed — try re-exporting from ForeFlight, or use the generic CSV mapper.",
    };
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

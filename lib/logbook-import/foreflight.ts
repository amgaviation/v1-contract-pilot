import { parseCsv, type CsvRecord } from "./csv";
import { applyMapping } from "./apply-mapping";
import type { ColumnMapping, ParseResult } from "./types";

/**
 * ForeFlight's "Logbook" CSV export is not one flat table — it's several
 * sections in one file: an "Aircraft Table" (every tail number the pilot
 * has flown, with its type/gear/engine data), then a "Flights Table " (note
 * the trailing space in ForeFlight's own marker) holding the actual flight
 * records, each introduced by a line whose first cell is the section's name
 * and followed by its own header row. Anything before or after the Flights
 * Table (ForeFlight's disclaimer preamble, per-aircraft/category totals
 * ForeFlight appends at the end) is not flight data and must be skipped,
 * not fed to the row parser as malformed rows. The Aircraft Table IS parsed
 * (see parseAircraftTable below) — it's the only source of aircraft type
 * for a flight row, since the Flights Table itself carries no type column,
 * only AircraftID (a bare tail number).
 *
 * ALIASES BELOW were rebuilt against a real ForeFlight "Logbook" export
 * (verified locally against a real file; not committed to this repo — see
 * the house rule against live pilot data as fixtures). The real Flights
 * Table header is exactly:
 *
 *   Date,AircraftID,From,To,Route,TimeOut,TimeOff,TimeOn,TimeIn,OnDuty,
 *   OffDuty,TotalTime,PIC,SIC,Night,Solo,CrossCountry,PICUS,MultiPilot,IFR,
 *   Examiner,NVG,NVG Ops,Distance,ActualInstrument,SimulatedInstrument,
 *   HobbsStart,HobbsEnd,TachStart,TachEnd,Holds,Approach1..Approach6,
 *   DualGiven,DualReceived,SimulatedFlight,GroundTraining,
 *   GroundTrainingGiven,InstructorName,InstructorComments,
 *   Person1..Person6,PilotComments,Flight Review (FAA),IPC (FAA),
 *   Checkride (FAA),FAA 61.58 (FAA),NVG Proficiency (FAA),Takeoff Day,
 *   Takeoff Night,Landing Full-Stop Day,Landing Full-Stop Night,
 *   DayTakeoffs,DayLandingsFullStop,NightTakeoffs,NightLandingsFullStop,
 *   AllLandings,[Numeric]FFS
 *
 * There is NO "AircraftType"/"TypeCode" column in the Flights Table at all
 * (those only exist per-tail in the Aircraft Table) and there is NO
 * "NightTime"/"PICTime"/"CrossCountryTime" — the real column names are the
 * bare ones above (Night, PIC, CrossCountry, ...). An earlier version of
 * this file aliased invented names that never appear in a real export,
 * which meant every real ForeFlight file silently mapped nothing and fell
 * through to the generic mapper. Fixed here against the real header.
 *
 * APPROACHES ARE IN THE EXPORT, via six columns (Approach1..Approach6),
 * each a semicolon-delimited record: `count;type;runway;airport;comment;
 * flags`. This format has no single "approaches count" column — the count
 * is the leading field of up to six separate per-approach records — so it
 * is computed here (summing the leading count of each non-blank
 * Approach1..6 cell) into a synthetic column rather than a straight alias.
 * The type/runway/airport/comment text is free-form and per-approach,
 * which does not fit the schema's single-valued approach_type enum without
 * guessing a mapping from ForeFlight's free-text approach names (e.g.
 * "RNAV (GPS) RWY 05") onto that enum — so, consistent with this pipeline's
 * standing rule to never fuzzy-guess an enum (see fields.ts's
 * normalizeEnum), the raw approach text is preserved in remarks instead of
 * forced into approach_type.
 */

const FOREFLIGHT_ALIASES: Record<string, string> = {
  date: "entry_date",
  aircraftid: "aircraft_ident",
  from: "from_icao",
  to: "to_icao",
  route: "remarks",
  totaltime: "total_time",
  pic: "pic_time",
  sic: "sic_time",
  night: "night_time",
  solo: "solo_time",
  crosscountry: "cross_country_time",
  actualinstrument: "instrument_actual_time",
  simulatedinstrument: "instrument_simulated_time",
  holds: "holds",
  approach1: "remarks",
  approach2: "remarks",
  approach3: "remarks",
  approach4: "remarks",
  approach5: "remarks",
  approach6: "remarks",
  dualgiven: "flight_instructor_time",
  dualreceived: "dual_received_time",
  simulatedflight: "simulator_time",
  instructorname: "remarks",
  instructorcomments: "remarks",
  pilotcomments: "remarks",
  // FAA event flags: surfaced to the pilot in the preview via remarks
  // (see the note appended below), NEVER used to silently create a
  // documents record — currency/checkride/flight-review documents are a
  // pilot-confirmed action elsewhere in the product, not something an
  // import should assert on its own authority.
  flightreviewfaa: "remarks",
  ipcfaa: "remarks",
  checkridefaa: "remarks",
  faa6158faa: "remarks",
  nvgproficiencyfaa: "remarks",
  // Takeoff Day/Night and Landing Full-Stop Day/Night (the "live" columns)
  // are DELIBERATELY not aliased here — they're merged into their
  // "Deprecated" counterparts (DayTakeoffs/NightTakeoffs/
  // DayLandingsFullStop/NightLandingsFullStop) by mergeLandingColumns
  // below before mapping, per the measured rule documented there. Aliasing
  // both sides to the same canonical key would instead run them through
  // apply-mapping.ts's multi-source reconcile(), which REJECTS the row
  // when two mapped columns disagree — the wrong behavior here, since
  // "prefer live, fall back to deprecated" is not the same rule as
  // "assert both sides already agree."
  daytakeoffs: "day_takeoffs",
  daylandingsfullstop: "day_landings_full_stop",
  nighttakeoffs: "night_takeoffs",
  nightlandingsfullstop: "night_landings_full_stop",
  alllandings: "landings_total",
  // [Numeric]FFS is read separately (deriveSimulatorDeviceType below) to
  // decide simulator_device_type, not aliased to a time field — SimulatedFlight
  // already supplies simulator_time, and treating FFS hours as a SECOND
  // simulator-time source would put it through reconcile() against
  // SimulatedFlight for no reason (they are not always equal — FFS is a
  // sub-classification, not an independent duration).
};

function normalizeHeader(h: string): string {
  return h.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** A data record whose row-shape is already known to be unrecoverable (more columns than the header) — carries the rejection reason through to applyMapping unparsed, so numbering/ordering stays a single pass over the section. */
type MappableRecord = CsvRecord & { forceReject?: string };

type AircraftInfo = {
  typeCode: string | null;
  make: string | null;
  model: string | null;
  equipType: string | null;
};

/**
 * Parses the Aircraft Table section (AircraftID -> TypeCode/Make/Model/
 * equipType), keyed by AircraftID normalized the same way apply-mapping.ts
 * normalizes aircraft_ident (strip a spreadsheet "force text" leading
 * apostrophe, trim, uppercase) so a flight row's AircraftID reliably looks
 * up its aircraft even if one side went through a spreadsheet round-trip.
 * Returns an empty map (not an error) when there's no Aircraft Table —
 * aircraft_type just stays unfilled for every row in that case, same as
 * any other unmapped field.
 */
function parseAircraftTable(records: CsvRecord[]): Map<string, AircraftInfo> {
  const table = new Map<string, AircraftInfo>();
  const start = records.findIndex((r) => (r.fields[0] ?? "").trim().toLowerCase() === "aircraft table");
  if (start === -1 || start + 1 >= records.length) return table;

  const header = records[start + 1]!.fields.map(normalizeHeader);
  const idIdx = header.indexOf("aircraftid");
  const typeIdx = header.indexOf("typecode");
  const makeIdx = header.indexOf("make");
  const modelIdx = header.indexOf("model");
  const equipIdx = header.indexOf("equiptypefaa");
  if (idIdx === -1) return table;

  for (let i = start + 2; i < records.length; i++) {
    const fields = records[i]!.fields;
    const first = (fields[0] ?? "").trim().toLowerCase();
    if (first.endsWith("table")) break;
    let id = (fields[idIdx] ?? "").trim();
    if (id.startsWith("'")) id = id.slice(1);
    id = id.trim().toUpperCase();
    if (!id) continue;
    table.set(id, {
      typeCode: (fields[typeIdx] ?? "").trim() || null,
      make: (fields[makeIdx] ?? "").trim() || null,
      model: (fields[modelIdx] ?? "").trim() || null,
      equipType: (fields[equipIdx] ?? "").trim().toLowerCase() || null,
    });
  }
  return table;
}

function normalizeAircraftId(raw: string): string {
  let id = raw.trim();
  if (id.startsWith("'")) id = id.slice(1);
  return id.trim().toUpperCase();
}

/** Leading integer of a ForeFlight approach cell ("1;RNAV (GPS) RWY 05;05;KMMU;;" -> 1). Blank or unparseable leads to 0 rather than rejecting the row — a malformed approach cell shouldn't block an otherwise-good flight record. */
function approachLeadingCount(raw: string): number {
  const match = /^\s*(\d+)/.exec(raw);
  return match ? Number(match[1]) : 0;
}

/**
 * Merges each "live" landing/takeoff column into its "Deprecated: Do not
 * edit manually" counterpart, in place, before the generic mapper ever
 * sees the row — see MERGE_PAIRS below for the measured rule this
 * implements. Operates on the already-padded 66-wide field arrays (or
 * whatever width this file's header actually has); a column that isn't
 * found in this file's header is simply skipped, so this is a no-op
 * against a Flights Table that doesn't have these columns at all.
 */
const MERGE_PAIRS: readonly [live: string, deprecated: string][] = [
  ["takeoffday", "daytakeoffs"],
  ["takeoffnight", "nighttakeoffs"],
  ["landingfullstopday", "daylandingsfullstop"],
  ["landingfullstopnight", "nightlandingsfullstop"],
];

export function parseForeflight(text: string): ParseResult | { error: string } {
  const records = parseCsv(text);
  if (!Array.isArray(records)) return records; // { error }: e.g. an unclosed quote

  const aircraftTable = parseAircraftTable(records);

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
  const normalizedHeader = headerRow.map(normalizeHeader);
  const aircraftIdIdx = normalizedHeader.indexOf("aircraftid");
  const ffsIdx = normalizedHeader.indexOf("numericffs");
  const simulatedFlightIdx = normalizedHeader.indexOf("simulatedflight");

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
      dataRecords.push({ fields: record.fields.slice(), raw: record.raw });
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

  // Live/deprecated landing-and-takeoff column merge — see MERGE_PAIRS.
  // Measured on a real export: the "Deprecated" columns (DayTakeoffs,
  // DayLandingsFullStop, NightTakeoffs, NightLandingsFullStop) are the
  // ones actually populated across the large majority of rows; the "live"
  // columns (Takeoff Day, Takeoff Night, Landing Full-Stop Day, Landing
  // Full-Stop Night) are populated on a smaller subset, and where both are
  // present they agree. So: prefer the live column's value whenever it's
  // non-blank, otherwise keep whatever the deprecated column already has.
  // Writing the merged winner INTO the deprecated column's slot (rather
  // than aliasing both to the same canonical key) is what keeps this a
  // single-source column by the time applyMapping's reconcile() sees it —
  // seec the FOREFLIGHT_ALIASES comment above for why that matters.
  for (const [liveKey, deprecatedKey] of MERGE_PAIRS) {
    const liveIdx = normalizedHeader.indexOf(liveKey);
    const deprecatedIdx = normalizedHeader.indexOf(deprecatedKey);
    if (liveIdx === -1 || deprecatedIdx === -1) continue;
    for (const record of dataRecords) {
      if (record.forceReject) continue;
      const liveRaw = (record.fields[liveIdx] ?? "").trim();
      if (liveRaw !== "") record.fields[deprecatedIdx] = liveRaw;
    }
  }

  // Three synthetic columns appended after the real 66: aircraft type
  // (from the Aircraft Table lookup — the Flights Table itself has no
  // type column), the summed approach count (from Approach1..6), and the
  // derived simulator device type (from [Numeric]FFS / the Aircraft
  // Table's equipType). Each is computed once per row here rather than
  // expressed as an alias, because each needs more than "read this one
  // cell" — a lookup, a sum, or a cross-column decision.
  const syntheticHeader = [
    "Aircraft type (from Aircraft Table)",
    "Approaches (summed from Approach1-6)",
    "Simulator device type (derived)",
  ];
  const fullHeaderRow = headerRow.concat(syntheticHeader);

  for (const record of dataRecords) {
    if (record.forceReject) continue;

    // Aircraft type: TypeCode preferred (the canonical ICAO-style type
    // designator, e.g. "SR22T"), falling back to Make + Model when a tail
    // is in the table without a TypeCode. Never invented when the
    // AircraftID isn't in the Aircraft Table at all — the field stays
    // blank, same as any other unmapped value, rather than guessing.
    const aircraftId = aircraftIdIdx === -1 ? "" : normalizeAircraftId(record.fields[aircraftIdIdx] ?? "");
    const info = aircraftId ? aircraftTable.get(aircraftId) : undefined;
    const aircraftType = info?.typeCode || [info?.make, info?.model].filter(Boolean).join(" ") || "";

    // Approaches: sum the leading count of every non-blank Approach1..6
    // cell on this row.
    let approachSum = 0;
    for (let a = 1; a <= 6; a++) {
      const idx = normalizedHeader.indexOf(`approach${a}`);
      if (idx === -1) continue;
      const raw = (record.fields[idx] ?? "").trim();
      if (raw !== "") approachSum += approachLeadingCount(raw);
    }

    // Simulator device type: [Numeric]FFS > 0 on THIS row is the
    // authoritative signal — it's a fact about this specific session, not
    // a generalization from the tail number. Falls back to the Aircraft
    // Table's equipType only when this row logs simulator time but the row
    // itself doesn't say FFS — e.g. an export where FFS hours weren't
    // itemized per flight. Neither branch is a guess: both read an actual
    // recorded fact, just from two different places in the file. ForeFlight
    // also records FTD/ATD/BATD/AATD equipment types (same evidence quality
    // as the ffs case), so those fall back the same way rather than needing
    // a manual per-row device pick even though the file states the class.
    const simulatorTimeRaw = simulatedFlightIdx === -1 ? "" : (record.fields[simulatedFlightIdx] ?? "").trim();
    const simulatorTimeValue = simulatorTimeRaw === "" ? 0 : Number(simulatorTimeRaw) || 0;
    const ffsRaw = ffsIdx === -1 ? "" : (record.fields[ffsIdx] ?? "").trim();
    const ffsHours = ffsRaw === "" ? 0 : Number(ffsRaw) || 0;
    let simulatorDeviceType = "";
    if (simulatorTimeValue > 0) {
      if (ffsHours > 0) simulatorDeviceType = "ffs";
      else if (info?.equipType === "ffs") simulatorDeviceType = "ffs";
      else if (info?.equipType === "ftd") simulatorDeviceType = "ftd";
      else if (info?.equipType === "atd" || info?.equipType === "batd" || info?.equipType === "aatd") {
        simulatorDeviceType = "atd";
      }
    }

    record.fields.push(aircraftType, approachSum > 0 ? String(approachSum) : "", simulatorDeviceType);
  }

  const mapping: ColumnMapping = fullHeaderRow.map((_h, idx) => {
    if (idx === headerRow.length) return "aircraft_type" as ColumnMapping[number];
    if (idx === headerRow.length + 1) return "approaches_count" as ColumnMapping[number];
    if (idx === headerRow.length + 2) return "simulator_device_type" as ColumnMapping[number];
    const key = FOREFLIGHT_ALIASES[normalizedHeader[idx] ?? ""];
    return key as ColumnMapping[number];
  });

  if (!mapping.includes("entry_date") || !mapping.includes("total_time")) {
    return {
      error:
        "Recognized a Flights Table but couldn't find Date and TotalTime columns in it. Try the generic CSV mapper instead.",
    };
  }

  return applyMapping({ format: "foreflight", headerRow: fullHeaderRow, dataRecords, mapping });
}

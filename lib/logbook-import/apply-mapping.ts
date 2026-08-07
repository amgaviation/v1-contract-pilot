import { parseTenth } from "@/lib/format";
import type { CsvRecord } from "./csv";
import { parseFlexibleDate, parseCount, normalizeIcao, normalizeEnum } from "./fields";
import type {
  ImportFormat,
  ColumnMapping,
  ParseResult,
  ParsedRow,
  ParsedRowValues,
  RejectedRow,
  RoleSource,
} from "./types";

const ROLES = ["PIC", "SIC"] as const;
const SIM_DEVICES = ["ftd", "atd", "other"] as const;
const APPROACH_TYPES = [
  "ils",
  "rnav_lpv",
  "rnav_lnav",
  "vor",
  "loc",
  "ndb",
  "visual",
  "other",
] as const;

/**
 * The one parser every import path shares. ForeFlight and LogTen supply a
 * MAPPING they compute from a fixed alias table (see foreflight.ts /
 * logten.ts); the generic path supplies a mapping the pilot picked by
 * hand in the UI. Either way, from here down it's the same code doing the
 * same validation — which is the point: there is exactly one place that
 * decides what a valid logbook_entries row looks like, so a bug fixed for
 * one format is fixed for all three.
 */
export function applyMapping(params: {
  format: ImportFormat;
  headerRow: string[];
  dataRecords: CsvRecord[];
  mapping: ColumnMapping;
}): ParseResult {
  const { format, headerRow, dataRecords, mapping } = params;
  const valid: ParsedRow[] = [];
  const rejected: RejectedRow[] = [];

  // Column headers, de-duplicated for use as sourceRow keys — a source
  // file with two columns literally named "Time" (it happens) would
  // otherwise silently clobber one in the JSONB provenance blob.
  const headerKeys = headerRow.map((h, i) => {
    const base = h.trim() || `column_${i + 1}`;
    return base;
  });
  const seen = new Map<string, number>();
  const uniqueHeaderKeys = headerKeys.map((k) => {
    const count = (seen.get(k) ?? 0) + 1;
    seen.set(k, count);
    return count === 1 ? k : `${k} (${count})`;
  });

  const cellFor = (fields: string[], key: string): string => {
    const idx = mapping.findIndex((m) => m === key);
    if (idx === -1) return "";
    return (fields[idx] ?? "").trim();
  };
  const isMapped = (key: string): boolean => mapping.includes(key as never);

  dataRecords.forEach((record, i) => {
    const rowNumber = i + 1;
    const fields = record.fields;
    const sourceRow: Record<string, string> = {};
    uniqueHeaderKeys.forEach((key, idx) => {
      sourceRow[key] = fields[idx] ?? "";
    });

    const reject = (reason: string) => {
      rejected.push({ rowNumber, raw: record.raw, reason });
    };

    // A row that is entirely empty (every cell blank) is not a malformed
    // row worth surfacing as a rejection — it's almost always a trailing
    // blank line the source export left in. Skip it silently.
    if (fields.every((f) => f.trim() === "")) return;

    const dateRaw = cellFor(fields, "entry_date");
    if (!dateRaw) {
      reject("Missing date.");
      return;
    }
    const entryDate = parseFlexibleDate(dateRaw);
    if (!entryDate) {
      reject(`Date isn't in a recognized format: "${dateRaw}". Expected YYYY-MM-DD or M/D/YYYY.`);
      return;
    }

    const totalRaw = cellFor(fields, "total_time");
    if (!totalRaw) {
      reject("Missing total time.");
      return;
    }
    const totalTime = parseTenth(totalRaw, { max: 999, allowBlank: false });
    // allowBlank:false means parseTenth's runtime contract never returns
    // null (only undefined-on-invalid or a real number) — but its type
    // covers null too since the allowBlank branch is a runtime, not
    // type-level, distinction. Guard both so `totalTime` narrows to a
    // plain `number` below.
    if (totalTime === undefined || totalTime === null) {
      reject(`Total time isn't a valid number of hours (at most one decimal place): "${totalRaw}".`);
      return;
    }

    const timeField = (key: string, label: string): number | null | undefined => {
      if (!isMapped(key)) return null;
      const raw = cellFor(fields, key);
      const v = parseTenth(raw, { max: 999, allowBlank: true });
      if (v === undefined) reject(`${label} isn't a valid number of hours: "${raw}".`);
      return v;
    };
    const countField = (key: string, label: string): number | undefined => {
      if (!isMapped(key)) return 0;
      const raw = cellFor(fields, key);
      const v = parseCount(raw);
      if (v === undefined) reject(`${label} isn't a whole number: "${raw}".`);
      return v;
    };
    const icaoField = (key: string, label: string): string | null | undefined => {
      if (!isMapped(key)) return null;
      const raw = cellFor(fields, key);
      const v = normalizeIcao(raw);
      if (v === undefined) reject(`${label} isn't a valid airport identifier: "${raw}".`);
      return v;
    };

    const picTime = timeField("pic_time", "PIC time");
    if (picTime === undefined) return;
    const sicTime = timeField("sic_time", "SIC time");
    if (sicTime === undefined) return;
    const soloTime = timeField("solo_time", "Solo time");
    if (soloTime === undefined) return;
    const crossCountryTime = timeField("cross_country_time", "Cross-country time");
    if (crossCountryTime === undefined) return;
    const nightTime = timeField("night_time", "Night time");
    if (nightTime === undefined) return;
    const instrumentActualTime = timeField("instrument_actual_time", "Instrument (actual) time");
    if (instrumentActualTime === undefined) return;
    const instrumentSimulatedTime = timeField(
      "instrument_simulated_time",
      "Instrument (simulated) time"
    );
    if (instrumentSimulatedTime === undefined) return;
    const flightInstructorTime = timeField("flight_instructor_time", "Dual given time");
    if (flightInstructorTime === undefined) return;
    const dualReceivedTime = timeField("dual_received_time", "Dual received time");
    if (dualReceivedTime === undefined) return;
    const simulatorTime = timeField("simulator_time", "Simulator time");
    if (simulatorTime === undefined) return;

    const fromIcao = icaoField("from_icao", "From");
    if (fromIcao === undefined) return;
    const toIcao = icaoField("to_icao", "To");
    if (toIcao === undefined) return;

    const dayFullStop = countField("day_landings_full_stop", "Day landings (full stop)");
    if (dayFullStop === undefined) return;
    const dayTouchGo = countField("day_landings_touch_go", "Day landings (touch & go)");
    if (dayTouchGo === undefined) return;
    const nightTakeoffs = countField("night_takeoffs", "Night takeoffs");
    if (nightTakeoffs === undefined) return;
    const nightFullStop = countField("night_landings_full_stop", "Night landings (full stop)");
    if (nightFullStop === undefined) return;
    const nightTouchGo = countField("night_landings_touch_go", "Night landings (touch & go)");
    if (nightTouchGo === undefined) return;
    const approachesCount = countField("approaches_count", "Approaches");
    if (approachesCount === undefined) return;
    const holds = countField("holds", "Holds");
    if (holds === undefined) return;

    // The undifferentiated-landings rule (aviation correctness): a
    // mapped "landings_total" column is NEVER distributed across the
    // typed day/night/full-stop/touch-and-go columns above — those stay
    // at whatever their OWN mapped columns say (0 if unmapped). The
    // total is preserved in remarks instead, exactly like
    // draftPayloadForLeg does for a trip leg's undifferentiated
    // day_landings.
    let unclassifiedLandings: number | null = null;
    if (isMapped("landings_total")) {
      const raw = cellFor(fields, "landings_total");
      const v = parseCount(raw);
      if (v === undefined) {
        reject(`Landings total isn't a whole number: "${raw}".`);
        return;
      }
      // Only actually "unclassified" if this row's typed landing columns
      // are all zero — a source that maps BOTH a total and the split
      // columns (real ForeFlight exports do exactly this) already has a
      // classification; flagging it anyway would be a false "we don't
      // know" note next to landings the row demonstrably does know.
      const typedLandings = dayFullStop + dayTouchGo + nightFullStop + nightTouchGo;
      if (v > 0 && typedLandings === 0) unclassifiedLandings = v;
    }

    // Role: explicit mapped column, else inferred from an unambiguous
    // PIC/SIC time signal, else deferred to the pilot. Never guessed.
    let role: (typeof ROLES)[number] | null = null;
    let roleSource: RoleSource = "needs_selection";
    if (isMapped("role")) {
      const raw = cellFor(fields, "role");
      const parsed = normalizeEnum(raw, ROLES);
      if (parsed) {
        role = parsed;
        roleSource = "explicit";
      }
      // A mapped-but-unrecognized role value falls through to
      // needs_selection rather than rejecting the row — the flight data
      // itself is fine, only the role is unresolved.
    }
    if (!role) {
      const picPositive = (picTime ?? 0) > 0;
      const sicPositive = (sicTime ?? 0) > 0;
      if (picPositive && !sicPositive) {
        role = "PIC";
        roleSource = "inferred";
      } else if (sicPositive && !picPositive) {
        role = "SIC";
        roleSource = "inferred";
      } else {
        role = null;
        roleSource = "needs_selection";
      }
    }

    // Simulator device type: required by the schema's CHECK whenever
    // simulator_time > 0. Never defaulted — an unresolved row is flagged
    // and blocks confirmation until the pilot picks ftd/atd/other.
    let simulatorDeviceType: (typeof SIM_DEVICES)[number] | null = null;
    let needsSimulatorDeviceType = false;
    if ((simulatorTime ?? 0) > 0) {
      if (isMapped("simulator_device_type")) {
        const raw = cellFor(fields, "simulator_device_type");
        const parsed = normalizeEnum(raw, SIM_DEVICES);
        if (parsed) simulatorDeviceType = parsed;
      }
      if (!simulatorDeviceType) needsSimulatorDeviceType = true;
    }

    // approach_type is only meaningful alongside a non-zero approach
    // count (the schema's CHECK requires it) — rather than reject a row
    // over a source file that recorded an approach type without a count,
    // the type is dropped and preserved in remarks so nothing is lost.
    let approachType: (typeof APPROACH_TYPES)[number] | null = null;
    let droppedApproachType: string | null = null;
    if (isMapped("approach_type")) {
      const raw = cellFor(fields, "approach_type");
      const parsed = normalizeEnum(raw, APPROACH_TYPES);
      if (parsed) {
        if (approachesCount > 0) approachType = parsed;
        else droppedApproachType = raw.trim();
      } else if (raw.trim()) {
        droppedApproachType = raw.trim();
      }
    }

    const remarksMapped = isMapped("remarks") ? cellFor(fields, "remarks") : "";
    const notes: string[] = [];
    if (remarksMapped) notes.push(remarksMapped);
    if (unclassifiedLandings !== null) {
      notes.push(
        `${unclassifiedLandings} landing${unclassifiedLandings === 1 ? "" : "s"} from the source file (day/night, full-stop/touch-and-go not recorded there)`
      );
    }
    if (droppedApproachType) {
      notes.push(`Approach type "${droppedApproachType}" noted in source with no approach count — not applied`);
    }
    const remarks = notes.length ? notes.join(" — ") : null;

    const values: ParsedRowValues = {
      entry_date: entryDate,
      aircraft_ident: isMapped("aircraft_ident") ? cellFor(fields, "aircraft_ident") || null : null,
      aircraft_type: isMapped("aircraft_type") ? cellFor(fields, "aircraft_type") || null : null,
      from_icao: fromIcao,
      to_icao: toIcao,
      // Stays null until roleSource is "explicit" or "inferred" above —
      // there is no placeholder value here. A "needs_selection" row's
      // `role` is genuinely null and every downstream consumer
      // (resolve-row.ts, the preview UI, confirmImport) must treat null
      // as "cannot import yet," never coerce it.
      role,
      total_time: totalTime,
      pic_time: picTime,
      sic_time: sicTime,
      solo_time: soloTime,
      cross_country_time: crossCountryTime,
      night_time: nightTime,
      instrument_actual_time: instrumentActualTime,
      instrument_simulated_time: instrumentSimulatedTime,
      flight_instructor_time: flightInstructorTime,
      dual_received_time: dualReceivedTime,
      simulator_time: simulatorTime,
      simulator_device_type: simulatorDeviceType,
      day_landings_full_stop: dayFullStop,
      day_landings_touch_go: dayTouchGo,
      night_takeoffs: nightTakeoffs,
      night_landings_full_stop: nightFullStop,
      night_landings_touch_go: nightTouchGo,
      approaches_count: approachesCount,
      approach_type: approachType,
      holds,
      remarks,
    };

    valid.push({
      rowNumber,
      raw: record.raw,
      sourceRow,
      values,
      roleSource,
      unclassifiedLandings,
      needsSimulatorDeviceType,
    });
  });

  return { format, header: headerRow, valid, rejected };
}

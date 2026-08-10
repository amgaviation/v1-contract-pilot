import { parseTenth } from "@/lib/format";
import type { CsvRecord } from "./csv";
import { parseFlexibleDate, parseCount, normalizeIcao, normalizeEnum, FIELD_DEFS } from "./fields";
import type {
  ImportFormat,
  ColumnMapping,
  ParseResult,
  ParsedRow,
  ParsedRowValues,
  RejectedRow,
  RoleSource,
} from "./types";

// PIC/SIC/SOLO/DUAL_RECEIVED — see app/(app)/logbook/db.ts's LogbookRole
// comment and supabase/migrations/20260809000000_logbook_role_vocabulary.sql
// for why this list doesn't include DUAL_GIVEN.
const ROLES = ["PIC", "SIC", "SOLO", "DUAL_RECEIVED"] as const;
// 'ffs' = full flight simulator; see the Phase 6-corrections migration for
// why it's a distinct device class from 'ftd'/'atd'.
const SIM_DEVICES = ["ffs", "ftd", "atd", "other"] as const;
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
// 61.57(c)(1) condition — a different axis from APPROACH_TYPES; see
// db.ts's ApproachCondition comment.
const APPROACH_CONDITIONS = ["actual", "simulated", "neither"] as const;

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
  // The `forceReject` addition lets a caller that already knows a
  // specific row is unrecoverable (foreflight.ts: a data row with MORE
  // fields than the Flights Table header) hand that verdict through in
  // its original file-order position rather than filtering it out before
  // calling in — that would misnumber every row after it relative to the
  // source file and lose why-it-was-rejected in the process.
  dataRecords: (CsvRecord & { forceReject?: string })[];
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

  // Every source column mapped to `key`, in header order, each carrying
  // its own header label — NOT just the first. `mapping.findIndex` used
  // to be the only lookup here, which silently reads just the first
  // matching column whenever a format's alias table (or a pilot's own
  // generic mapping) points two source columns at the same canonical
  // field. That's a real shape in this codebase, not a hypothetical:
  // ForeFlight's PilotComments AND InstructorComments both alias to
  // "remarks", its AircraftType AND TypeCode both alias to
  // "aircraft_type", and LogTen's CfiTime AND DualGiven both alias to
  // "flight_instructor_time". `cellFor` (kept below, unchanged in
  // behavior) still returns only the first for the handful of fields
  // that are genuinely single-valued and never double-aliased
  // (entry_date, total_time, role, approach_type, simulator_device_type,
  // landings_total); every field kind that IS known to collide routes
  // through `cellsFor` instead, each with its own reconciliation rule —
  // see timeField/countField/icaoField and the remarks/aircraft_type
  // handling below.
  const cellsFor = (fields: string[], key: string): { header: string; raw: string }[] =>
    mapping.flatMap((m, idx) =>
      m === key ? [{ header: uniqueHeaderKeys[idx] ?? `column_${idx + 1}`, raw: (fields[idx] ?? "").trim() }] : []
    );
  const cellFor = (fields: string[], key: string): string => cellsFor(fields, key)[0]?.raw ?? "";
  const isMapped = (key: string): boolean => mapping.includes(key as never);

  // Regulatory count fields this format's alias table (or the pilot's own
  // generic mapping) never points ANY column at read as 0 below —
  // `countField`'s unmapped branch returns 0 because that's the schema's
  // own not-null default and a genuine zero must be representable. But a
  // truly absent source column and a mapped column whose value happens to
  // be zero are NOT the same fact, and FAR currency (61.57(c) approaches,
  // 61.57(a) landings, holds as an IPC/currency signal) depends on which
  // one is true. Computed once per file (not per row: whether a field is
  // mapped doesn't vary row to row) and attached to every row's remarks
  // below so "0 approaches" reads as "this file doesn't record
  // approaches" rather than "flown with zero approaches." Excludes
  // "landings_total": that key isn't a real output field (it's the
  // undifferentiated-landings input handled by `unclassifiedLandings`
  // below), so it would never legitimately appear in this list anyway.
  const unmappedCountLabels = FIELD_DEFS.filter(
    (f) => f.kind === "count" && f.key !== "landings_total" && !mapping.includes(f.key)
  ).map((f) => f.label);

  dataRecords.forEach((record, i) => {
    const rowNumber = i + 1;
    const fields = record.fields;

    if (record.forceReject) {
      rejected.push({ rowNumber, raw: record.raw, reason: record.forceReject });
      return;
    }

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
    // max 999.9, matching logbook_entries.total_time's actual schema type
    // numeric(4,1) (supabase/migrations/20260805220000_phase6_logbook.sql)
    // — the old max:999 rejected a perfectly legal 999.9 the column can
    // hold. Same bound applied to every other numeric(4,1) time column
    // below (timeField) for the same reason.
    const totalTime = parseTenth(totalRaw, { max: 999.9, allowBlank: false });
    // allowBlank:false means parseTenth's runtime contract never returns
    // null (only undefined-on-invalid or a real number) — but its type
    // covers null too since the allowBlank branch is a runtime, not
    // type-level, distinction. Guard both so `totalTime` narrows to a
    // plain `number` below.
    if (totalTime === undefined || totalTime === null) {
      reject(`Total time isn't a valid number of hours (at most one decimal place, up to 999.9): "${totalRaw}".`);
      return;
    }

    // Multi-source reconciliation shared by timeField/countField/
    // icaoField below: collect every mapped, non-blank cell for `key`,
    // parse each with `parse`, and either (a) they all parse to the same
    // value — silently fine, this is the common case of one real source
    // column plus a blank duplicate-mapped one; (b) any one fails to
    // parse — reject, same message shape as the single-source case used
    // to give; or (c) two SOURCES DISAGREE — reject naming both source
    // columns and their values, rather than silently keeping whichever
    // happened to be mapped first. Guessing which of two disagreeing
    // numbers is "the real one" is exactly the kind of silent
    // fabrication this pipeline elsewhere refuses to do for role/
    // simulator-device-type/landings; a numeric conflict gets the same
    // treatment.
    function reconcile<T>(
      key: string,
      label: string,
      parse: (raw: string) => T | undefined
    ): { cells: { header: string; raw: string; v: T }[] } | undefined {
      const cells = cellsFor(fields, key)
        .filter((c) => c.raw !== "")
        .map((c) => ({ ...c, v: parse(c.raw) }));
      const invalid = cells.find((c) => c.v === undefined);
      if (invalid) {
        reject(`${label} isn't valid: "${invalid.raw}".`);
        return undefined;
      }
      const distinctValues = new Set(cells.map((c) => c.v));
      if (distinctValues.size > 1) {
        reject(
          `${label} has conflicting values across mapped columns: ${cells
            .map((c) => `${c.header}="${c.raw}"`)
            .join(", ")}.`
        );
        return undefined;
      }
      return { cells: cells as { header: string; raw: string; v: T }[] };
    }

    const timeField = (key: string, label: string): number | null | undefined => {
      if (!isMapped(key)) return null;
      const result = reconcile(key, label, (raw) => parseTenth(raw, { max: 999.9, allowBlank: true }) ?? undefined);
      if (!result) return undefined;
      return result.cells[0]?.v ?? null;
    };
    const countField = (key: string, label: string): number | undefined => {
      if (!isMapped(key)) return 0;
      const result = reconcile(key, label, parseCount);
      if (!result) return undefined;
      return result.cells[0]?.v ?? 0;
    };
    const icaoField = (key: string, label: string): string | null | undefined => {
      if (!isMapped(key)) return null;
      const result = reconcile(key, label, normalizeIcao);
      if (!result) return undefined;
      return result.cells[0]?.v ?? null;
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

    const dayTakeoffs = countField("day_takeoffs", "Day takeoffs");
    if (dayTakeoffs === undefined) return;
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
    // typed day/night/full-stop/touch-and-go columns above by guessing —
    // those stay at whatever their OWN mapped columns say (0 if
    // unmapped). Instead, whatever of the total those typed columns do
    // NOT account for is the RESIDUAL — landings_total minus the sum of
    // the four typed columns — and that residual, whenever it's
    // positive, is surfaced via `unclassifiedLandings` (which flows into
    // remarks below) rather than silently discarded.
    //
    // This is deliberately NOT gated on "only when the typed columns are
    // all zero." ForeFlight's own alias table (foreflight.ts) maps
    // DayLandingsFullStop, NightLandingsFullStop, and AllLandings but has
    // NO touch-and-go columns at all, so AllLandings − (DayFullStop +
    // NightFullStop) is exactly the touch-and-go count on every ForeFlight
    // row that has any — and it is a NON-ZERO residual sitting alongside
    // non-zero typed columns, which the old zero-typed-columns gate threw
    // away outright. FAR 61.57(a) day-passenger currency counts
    // touch-and-goes, so silently dropping them understates currency.
    //
    // A NEGATIVE residual (typed columns already sum to more than the
    // total) is not a rounding artifact to clamp away — it means the
    // source file's own total contradicts its own typed columns — so
    // that rejects the row with a reason naming both sides, rather than
    // importing self-contradictory landing data.
    let unclassifiedLandings: number | null = null;
    if (isMapped("landings_total")) {
      const raw = cellFor(fields, "landings_total");
      const v = parseCount(raw);
      if (v === undefined) {
        reject(`Landings total isn't a whole number: "${raw}".`);
        return;
      }
      const typedLandings = dayFullStop + dayTouchGo + nightFullStop + nightTouchGo;
      const residual = v - typedLandings;
      if (residual < 0) {
        reject(
          `Landings total (${v}) is less than the typed landings on this row (${typedLandings}: ${dayFullStop} day full-stop + ${dayTouchGo} day touch-and-go + ${nightFullStop} night full-stop + ${nightTouchGo} night touch-and-go) — the source file contradicts itself.`
        );
        return;
      }
      if (residual > 0) unclassifiedLandings = residual;
    }

    // Role: explicit mapped column, else inferred from an unambiguous time
    // signal, else deferred to the pilot. Never guessed. Precedence — see
    // supabase/migrations/20260809000000_logbook_role_vocabulary.sql's
    // header for the full reasoning:
    //   1. picTime > 0 && !sicTime  -> PIC (unaffected by dualReceivedTime
    //      also being present — a rated pilot logs PIC as sole manipulator
    //      under 61.51(e)(1)(i) while simultaneously receiving instruction
    //      under 61.51(h) on the same flight; that combination is real and
    //      the role stays PIC).
    //   2. sicTime > 0 && !picTime  -> SIC.
    //   3. Neither PIC nor SIC asserted:
    //        a. soloTime > 0        -> SOLO (61.51(d)).
    //        b. else dualReceivedTime > 0 -> DUAL_RECEIVED (61.51(h)).
    //        c. else                -> needs_selection.
    //   4. Both PIC and SIC asserted -> needs_selection, unchanged: a
    //      genuinely ambiguous multi-crew-logging row still asks the pilot.
    // Solo is checked before dual-received in 3 because the two are
    // mutually exclusive in practice (solo = sole occupant; dual received =
    // an instructor aboard) and solo is the more specific signal of the two
    // whenever both happen to be mapped.
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
      const soloPositive = (soloTime ?? 0) > 0;
      const dualReceivedPositive = (dualReceivedTime ?? 0) > 0;
      if (picPositive && !sicPositive) {
        role = "PIC";
        roleSource = "inferred";
      } else if (sicPositive && !picPositive) {
        role = "SIC";
        roleSource = "inferred";
      } else if (!picPositive && !sicPositive && soloPositive) {
        role = "SOLO";
        roleSource = "inferred";
      } else if (!picPositive && !sicPositive && dualReceivedPositive) {
        role = "DUAL_RECEIVED";
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

    // approach_condition: 61.57(c)(1)'s actual/simulated/neither axis,
    // separate from approach_type. Same "only meaningful alongside a
    // non-zero approach count" rule as approach_type, and — since a
    // 'visual' approach_type can never legitimately pair with 'actual' or
    // 'simulated' (see the migration's CHECK) — a mapped condition that
    // contradicts a 'visual' approach_type is dropped rather than
    // imported, and both facts are preserved in remarks so nothing is
    // silently lost or silently asserted.
    let approachCondition: (typeof APPROACH_CONDITIONS)[number] | null = null;
    let droppedApproachCondition: string | null = null;
    if (isMapped("approach_condition")) {
      const raw = cellFor(fields, "approach_condition");
      const parsed = normalizeEnum(raw, APPROACH_CONDITIONS);
      if (parsed) {
        if (approachesCount === 0) {
          droppedApproachCondition = raw.trim();
        } else if (approachType === "visual" && (parsed === "actual" || parsed === "simulated")) {
          droppedApproachCondition = raw.trim();
        } else {
          approachCondition = parsed;
        }
      } else if (raw.trim()) {
        droppedApproachCondition = raw.trim();
      }
    }

    // courses_intercepted_tracked: 61.57(c)(1)(iii)'s intercept/track task
    // is a boolean fact, not a count — mapped column parses to true/false
    // (case-insensitive), same normalizeEnum discipline as role/device
    // type/approach type. Unmapped defaults false, matching the schema's
    // not-null default rather than treating "not recorded" as true.
    let coursesInterceptedTracked = false;
    if (isMapped("courses_intercepted_tracked")) {
      const raw = cellFor(fields, "courses_intercepted_tracked");
      const parsed = normalizeEnum(raw, ["true", "false"] as const);
      if (parsed) coursesInterceptedTracked = parsed === "true";
    }

    // view_limiting_pilot_name: 61.51(b)(1)(v). A single descriptive value, same
    // treatment as aircraft_ident/aircraft_type — not a narrative field.
    const safetyPilotName = isMapped("view_limiting_pilot_name")
      ? cellFor(fields, "view_limiting_pilot_name") || null
      : null;

    // aircraft_ident: strip an Excel/Numbers/Sheets "force text" leading
    // apostrophe (a spreadsheet round-trip on a tail number like "N12345"
    // adds `'N12345` so it isn't read as a formula/number — that
    // apostrophe is spreadsheet metadata, never part of the real
    // registration) and reject anything that clearly isn't a plausible
    // tail number. This matters beyond display: aircraft_ident feeds
    // fingerprint.ts's dedup hash verbatim, so an un-normalized leading
    // apostrophe would also make a later, cleanly-exported re-import of
    // the SAME flight hash differently and fail to dedup.
    let aircraftIdent: string | null = null;
    if (isMapped("aircraft_ident")) {
      let raw = cellFor(fields, "aircraft_ident");
      if (raw.startsWith("'")) raw = raw.slice(1);
      raw = raw.trim().toUpperCase();
      if (raw === "") {
        aircraftIdent = null;
      } else if (!/^[A-Z0-9-]{2,10}$/.test(raw)) {
        reject(`Aircraft ident isn't a plausible tail number: "${cellFor(fields, "aircraft_ident")}".`);
        return;
      } else {
        aircraftIdent = raw;
      }
    }

    // aircraft_type: unlike remarks (below), this is a single descriptive
    // value, not a narrative — concatenating two sources would produce a
    // nonsensical "Cessna 172|C172" type string. When two columns are
    // mapped here (ForeFlight's AircraftType and TypeCode both alias to
    // this field), prefer the LAST mapped column that has a value: in
    // ForeFlight's real Flights Table, TypeCode (the canonical ICAO type
    // designator, e.g. "C172") is the more specific of the two and is
    // listed after AircraftType (a freer-form description), so "last
    // mapped wins" picks the more specific value without this function
    // needing per-format column-name knowledge. The value(s) NOT used are
    // preserved in remarks rather than silently dropped, in case the two
    // disagree in a way that matters to the pilot.
    const aircraftTypeCells = cellsFor(fields, "aircraft_type").filter((c) => c.raw !== "");
    const aircraftType = aircraftTypeCells.length
      ? aircraftTypeCells[aircraftTypeCells.length - 1]!.raw
      : null;
    const aircraftTypeAlternates = aircraftTypeCells
      .slice(0, -1)
      .filter((c) => c.raw !== aircraftType);

    // remarks: a narrative field, so — unlike aircraft_type above —
    // multiple mapped sources are NOT a "pick one" situation. ForeFlight
    // maps both PilotComments and InstructorComments here, and the
    // instructor's text is often the legally significant half of a
    // training record; dropping it silently (the old first-match-only
    // behavior) is not acceptable. All mapped, non-empty sources are kept,
    // each labelled with its own source column so it's clear which text
    // came from where. A single mapped source (the common case for every
    // format except ForeFlight) is left unprefixed, unchanged from prior
    // behavior.
    const remarksCells = cellsFor(fields, "remarks").filter((c) => c.raw !== "");
    const remarksMapped =
      remarksCells.length <= 1
        ? (remarksCells[0]?.raw ?? "")
        : remarksCells.map((c) => `${c.header}: ${c.raw}`).join(" — ");

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
    if (droppedApproachCondition) {
      notes.push(
        `Approach condition "${droppedApproachCondition}" noted in source but not applied (no approach count, or contradicts a visual approach type)`
      );
    }
    if (aircraftTypeAlternates.length) {
      notes.push(
        `Aircraft type: source also had ${aircraftTypeAlternates
          .map((c) => `"${c.raw}" (${c.header})`)
          .join(", ")} — used "${aircraftType}" (${aircraftTypeCells[aircraftTypeCells.length - 1]!.header})`
      );
    }
    if (unmappedCountLabels.length) {
      notes.push(`Not recorded in this file (shown as 0): ${unmappedCountLabels.join(", ")}`);
    }
    const remarks = notes.length ? notes.join(" — ") : null;

    const values: ParsedRowValues = {
      entry_date: entryDate,
      aircraft_ident: aircraftIdent,
      aircraft_type: aircraftType,
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
      day_takeoffs: dayTakeoffs,
      day_landings_full_stop: dayFullStop,
      day_landings_touch_go: dayTouchGo,
      night_takeoffs: nightTakeoffs,
      night_landings_full_stop: nightFullStop,
      night_landings_touch_go: nightTouchGo,
      approaches_count: approachesCount,
      approach_type: approachType,
      approach_condition: approachCondition,
      courses_intercepted_tracked: coursesInterceptedTracked,
      holds,
      view_limiting_pilot_name: safetyPilotName,
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

"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireAccount } from "@/lib/supabase/account";
import { friendlyDbError } from "@/lib/db-errors";
import { logbookFrom, type LogbookRole, type SimulatorDeviceType, type ApproachType } from "../db";
import { rowFingerprint } from "@/lib/logbook-import/fingerprint";
import type { ImportFormat, ImportEntryInsert } from "@/lib/logbook-import/types";
import type { LogbookEntryFlightFields } from "../db";

// PIC/SIC/SOLO/DUAL_RECEIVED — see db.ts's LogbookRole comment and
// supabase/migrations/20260809000000_logbook_role_vocabulary.sql for why
// this list doesn't include DUAL_GIVEN. This is the server-side boundary
// (validateRow, below) — it must independently allow whatever the client's
// resolveRow/apply-mapping.ts can now resolve, or a crafted request would
// be the only thing rejecting a legitimately-resolved SOLO/DUAL_RECEIVED
// row.
const ROLES: readonly LogbookRole[] = ["PIC", "SIC", "SOLO", "DUAL_RECEIVED"];
// "ffs" included alongside the pilot-pickable ftd/atd/other: ForeFlight
// rows can carry a derived simulator_device_type of "ffs" (see
// lib/logbook-import/foreflight.ts's deriveSimulatorDeviceType logic,
// inlined in parseForeflight) that the pilot never chose from a picker —
// rejecting it here would abort an otherwise-valid ForeFlight confirm.
const SIM_DEVICES: readonly SimulatorDeviceType[] = ["ffs", "ftd", "atd", "other"];
const APPROACH_TYPES: readonly ApproachType[] = [
  "ils",
  "rnav_lpv",
  "rnav_lnav",
  "vor",
  "loc",
  "ndb",
  "visual",
  "other",
];
const FORMATS: readonly ImportFormat[] = ["foreflight", "logten", "generic_csv"];

/**
 * A hard ceiling on one confirm request, sized to what the request can
 * actually deliver — not a product limit on logbook size. A career logbook
 * that exceeds this splits across two file uploads/imports, each with its
 * own batch.
 *
 * WHY 5,000 AND NOT 20,000: `sourceRow` re-serializes every source cell
 * keyed by its ORIGINAL header name (on top of the already-parsed
 * `values`), which inflates the POST body far past the CSV's own size —
 * and this action runs behind next.config.ts's `bodySizeLimit: "10mb"`
 * (owned elsewhere; not editable here), so the row cap has to actually fit
 * under that, not just be some round number. Measured with a synthetic
 * ForeFlight-shaped fixture (24 source columns, matching a real ForeFlight
 * Logbook export) via confirmImport's own payload shape:
 *
 *   rows    minimal remarks   60-char remarks   200-char remarks
 *   1,000        1.17 MB           1.29 MB           —
 *   5,000        5.74 MB           6.33 MB           7.73 MB
 *   9,000       10.51 MB          11.57 MB           —
 *   20,000      23.37 MB          25.73 MB           —
 *
 * 5,000 rows stays comfortably under 10 MB even with realistic remarks;
 * 9,000 (this product's stated adoption target — a pilot with 9,000 hours
 * importing a career logbook) is already over the limit on minimal
 * remarks alone, which is why that pilot MUST split their file rather
 * than hit an opaque framework error. These are OUR measurements against
 * a synthetic fixture we built for this fix (not the reviewer's exact
 * numbers, which used a different column set) — re-measure if the source
 * column count or `sourceRow`'s shape changes.
 *
 * A row cap alone is not sufficient on its own: very long remarks can
 * still blow the budget under 5,000 rows (measured: 5,000 rows x 500-char
 * remarks = 10.73 MB). import-workspace.tsx's client-side byte-size
 * estimate (ESTIMATED_PAYLOAD_BYTE_LIMIT) is the second layer that catches
 * that case BEFORE the POST is even sent, with a specific message instead
 * of the framework's opaque one.
 */
const MAX_ROWS_PER_CONFIRM = 5000;
/** How many rejected-row / duplicate-row details are kept in error_summary — matches the house "explicit limit + truncation callout" rule rather than storing an unbounded blob. */
const MAX_STORED_REJECTIONS = 500;
/**
 * How many fingerprints go in one dedup `.in()` lookup. supabase-js emits
 * this as a GET with the fingerprint list in the query string
 * (`?row_fingerprint=in.(...)`), not the request body — a SHA-256 hex
 * fingerprint is 64 chars, ~65 bytes once comma-joined, so an unbounded
 * `.in()` over a multi-thousand-row import can build a multi-hundred-KB
 * URL and hit a gateway's 414/header-size limit, aborting the whole
 * import at the dedup step (`fail("dedup lookup failed", ...)`) long
 * before any row is even validated for insert. 40 fingerprints is
 * ~2.6 KB of query string — comfortably inside even a conservative 8 KB
 * total header budget alongside auth/cookie headers, which a fingerprint
 * count sized to fit under a 10 MB *body* limit would not by itself
 * guarantee, since this is a URL length problem, not a body size one.
 */
const FINGERPRINT_LOOKUP_CHUNK = 40;

export type ConfirmImportRow = {
  rowNumber: number;
  sourceRow: Record<string, string>;
  values: LogbookEntryFlightFields;
};

export type ConfirmImportPayload = {
  format: ImportFormat;
  fileName: string;
  /** valid.length + rejected.length as counted by the client parser, BEFORE any pilot-side exclusions — the true size of the source file. */
  totalRows: number;
  rows: ConfirmImportRow[];
  rejected: { rowNumber: number; raw: string; reason: string }[];
  /** Rows the parser could place (no parse error) but the pilot chose not to include — kept as a count only, for the batch summary. */
  excludedByPilot: number;
};

export type DuplicateRowDetail = {
  rowNumber: number;
  sourceRow: Record<string, string>;
  /**
   * "in_logbook" — this row's fingerprint already exists in
   * logbook_entries from an earlier import; the flight is presumed
   * already recorded.
   * "in_file" — this row's fingerprint collides with an EARLIER row in
   * THIS SAME confirm. This is not necessarily the same flight (see
   * fingerprint.ts's documented collision case: two identical pattern
   * hops flown back to back on a first-ever import) — it is reported
   * separately from "in_logbook" precisely so the pilot isn't told a
   * false "already in your logbook from a previous import" about a row
   * that was never previously imported at all.
   */
  kind: "in_logbook" | "in_file";
};

export type ConfirmImportResult = {
  error: string | null;
  batchId?: string;
  imported?: number;
  duplicatesInLogbook?: number;
  duplicatesInFile?: number;
  duplicateDetail?: DuplicateRowDetail[];
  duplicateDetailTruncated?: boolean;
  rejectedCount?: number;
  /**
   * Every row from the file that did not make it in, with the reason —
   * the client parser's own rejections and this action's validation
   * rejections merged into one list, sorted by row number.
   *
   * Returned rather than only persisted to the batch's error_summary,
   * because the pilot needs to see it in the same breath as "203
   * imported" and nothing in the product reads a batch row back.
   */
  rejectedDetail?: { rowNumber: number; raw: string; reason: string }[];
  /**
   * True when some rows landed in the logbook but the confirm didn't
   * finish (a later chunk/row failed after earlier ones committed).
   * `error` is null in this case on purpose — it isn't a failure the
   * pilot needs to retry from scratch, it's an incomplete run they need
   * to act on. See actions.ts's fail() for why.
   */
  partial?: boolean;
  partialMessage?: string;
};

function isRole(v: unknown): v is LogbookRole {
  return (ROLES as readonly string[]).includes(String(v));
}
function isSimDevice(v: unknown): v is SimulatorDeviceType {
  return (SIM_DEVICES as readonly string[]).includes(String(v));
}
function isApproachType(v: unknown): v is ApproachType {
  return (APPROACH_TYPES as readonly string[]).includes(String(v));
}
function isTenth(v: unknown, max: number): v is number {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= max && Math.round(v * 10) === v * 10;
}
function isCount(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 999;
}
/**
 * Validates entry_date is a REAL calendar date, not just `\d{4}-\d{2}-\d{2}`
 * shaped text. The shape-only regex this replaced accepted "2026-02-30",
 * which Postgres rejects at insert time with 22008 (date/time field value
 * out of range) — AFTER earlier chunks in the same confirm may already be
 * committed (see the insert loop's comment on why that used to report a
 * false total failure). Catching this here, before anything is inserted,
 * is what makes step 3's "validate every row before anything is
 * fingerprinted or inserted" promise actually true for a bad date.
 *
 * Written independently of lib/logbook-import/fields.ts's
 * parseFlexibleDate (which does the equivalent arithmetic day-count check
 * for the CLIENT parser) rather than importing it — that module is owned
 * by a different agent's concurrent work and its shape may change; this
 * function only needs to re-verify a date the client already normalized
 * to ISO, not parse arbitrary source formats.
 */
function isDateString(v: unknown): v is string {
  if (typeof v !== "string") return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1900 || year > 2100) return false;
  if (month < 1 || month > 12) return false;
  const isLeapYear = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const daysInMonth = [31, isLeapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const maxDay = daysInMonth[month - 1] ?? 31;
  if (day < 1 || day > maxDay) return false;
  return true;
}
function isIcaoOrNull(v: unknown): v is string | null {
  if (v === null) return true;
  return typeof v === "string" && /^[A-Z0-9]{3,4}$/.test(v);
}

/** Every column a `source='import'` row is ever allowed to carry from the
 * client's parsed `values`, listed explicitly and copied field-by-field
 * (see toFlightFields below) rather than via object spread. `values` is
 * typed as LogbookEntryFlightFields at compile time, but this is a "use
 * server" action — nothing stops a crafted POST's JSON body from carrying
 * extra keys (trip_id, trip_leg_id, account_id, source, ...) that
 * TypeScript's static type never sees at runtime. `{ ...row.values, ... }`
 * would forward every one of those straight into the insert, trusting the
 * *shape* of client JSON in exactly the way this file's own top comment
 * says it must not. An explicit allowlist copy makes that whole bug class
 * unreachable regardless of what the payload's JSON actually contains. */
const FLIGHT_FIELDS: (keyof LogbookEntryFlightFields)[] = [
  "entry_date",
  "aircraft_ident",
  "aircraft_type",
  "from_icao",
  "to_icao",
  "role",
  "total_time",
  "pic_time",
  "sic_time",
  "solo_time",
  "cross_country_time",
  "night_time",
  "instrument_actual_time",
  "instrument_simulated_time",
  "flight_instructor_time",
  "dual_received_time",
  "simulator_time",
  "simulator_device_type",
  "day_landings_full_stop",
  "day_landings_touch_go",
  "night_takeoffs",
  "night_landings_full_stop",
  "night_landings_touch_go",
  "approaches_count",
  "approach_type",
  "holds",
  "remarks",
];

function toFlightFields(values: LogbookEntryFlightFields): LogbookEntryFlightFields {
  const out = {} as LogbookEntryFlightFields;
  for (const key of FLIGHT_FIELDS) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (out as any)[key] = values[key];
  }
  return out;
}

/** An import row this action builds itself: ImportEntryInsert (from the
 * parser-owned types.ts) plus an explicit, always-null trip_id/trip_leg_id
 * — see toInsert.push below and the migration's
 * logbook_entries_import_no_trip_lineage CHECK for why these are pinned
 * rather than merely omitted. */
type ImportRowInsert = ImportEntryInsert & { trip_id: null; trip_leg_id: null };

/**
 * Defense-in-depth revalidation of a row this server never computed
 * itself — the client parsed the file and resolved role/simulator device
 * type (lib/logbook-import's apply-mapping.ts + resolve-row.ts), and this
 * action trusts that the same way createLogbookEntry trusts a manual
 * entry's form fields. What it does NOT trust is that the payload's
 * *shape* is honest: a crafted POST could send a string where a number
 * belongs, an out-of-range enum, or a role that bypassed the "must not be
 * guessed" resolution entirely. This is the one gate every row passes
 * through before it can become an insert.
 */
function validateRow(values: LogbookEntryFlightFields): string | null {
  if (!isDateString(values.entry_date)) return "invalid entry_date";
  if (!isTenth(values.total_time, 999)) return "invalid total_time";
  if (!isRole(values.role)) return "missing or invalid role";
  const optionalTimes: (keyof LogbookEntryFlightFields)[] = [
    "pic_time",
    "sic_time",
    "solo_time",
    "cross_country_time",
    "night_time",
    "instrument_actual_time",
    "instrument_simulated_time",
    "flight_instructor_time",
    "dual_received_time",
    "simulator_time",
  ];
  for (const key of optionalTimes) {
    const v = values[key];
    if (v !== null && !isTenth(v, 999)) return `invalid ${key}`;
  }
  // Cross-field time sanity, mirroring the CHECK constraints added by
  // 20260807100000_logbook_import_integrity.sql — each of these is a
  // PORTION of the same flight total_time measures, so it can never
  // exceed total_time. pic_time/sic_time are bounded here too (a real
  // physical impossibility on their own — 900 hours of PIC time on a
  // 1-hour flight), but deliberately NOT bounded by their SUM: see that
  // migration's comment on 61.51(e)(1)(i) dual-logged PIC+SIC time for
  // why pic_time + sic_time > total_time is a legitimate, common
  // professional-pilot logbook pattern, not a defect.
  const boundedByTotal: (keyof LogbookEntryFlightFields)[] = [
    "pic_time",
    "sic_time",
    "solo_time",
    "cross_country_time",
    "night_time",
    "instrument_actual_time",
    "instrument_simulated_time",
  ];
  for (const key of boundedByTotal) {
    const v = values[key];
    if (typeof v === "number" && v > values.total_time) {
      return `${key} cannot be greater than total_time`;
    }
  }
  const counts: (keyof LogbookEntryFlightFields)[] = [
    "day_landings_full_stop",
    "day_landings_touch_go",
    "night_takeoffs",
    "night_landings_full_stop",
    "night_landings_touch_go",
    "approaches_count",
    "holds",
  ];
  for (const key of counts) {
    if (!isCount(values[key])) return `invalid ${key}`;
  }
  if (!isIcaoOrNull(values.from_icao)) return "invalid from_icao";
  if (!isIcaoOrNull(values.to_icao)) return "invalid to_icao";
  if (values.simulator_device_type !== null && !isSimDevice(values.simulator_device_type)) {
    return "invalid simulator_device_type";
  }
  // Mirrors the schema's own CHECK constraints so a bad payload fails
  // here with a sentence instead of a raw Postgres error.
  if ((values.simulator_time ?? 0) > 0 && !values.simulator_device_type) {
    return "simulator time without a device type";
  }
  if (values.approach_type !== null) {
    if (!isApproachType(values.approach_type)) return "invalid approach_type";
    if (values.approaches_count === 0) return "approach type without an approach count";
  }
  return null;
}

/**
 * Turns validateRow's terse internal reason into a sentence that tells the
 * pilot what is actually wrong with THEIR row and what to do about it.
 *
 * validateRow's strings ("missing or invalid role", "invalid total_time")
 * are written for the developer reading a server log, which is where they
 * used to go and stop. Now that they reach the pilot, they need to name
 * the thing in the vocabulary of the logbook rather than the column.
 *
 * The role case is the one that matters most in practice: a ForeFlight
 * export of a professional pilot's logbook routinely contains full-flight-
 * simulator sessions with no PIC, SIC, solo or dual-received time on them
 * at all — there is nothing to infer a role from, because in the sim there
 * wasn't one in the FAA's four-value sense.
 */
function explainValidationFailure(problem: string, values: LogbookEntryFlightFields): string {
  if (problem.startsWith("missing or invalid role")) {
    if ((values.simulator_time ?? 0) > 0) {
      return "This is a simulator session with no PIC, SIC, solo or dual-received time on it, so there's no way to tell which role to log it under. Add it by hand from the logbook, choosing the role yourself.";
    }
    return "No PIC, SIC, solo or dual-received time is recorded on this flight, so there's no way to tell which role to log it under. Add it by hand from the logbook, choosing the role yourself.";
  }
  const overTotal = /^(\w+) cannot be greater than total_time$/.exec(problem);
  if (overTotal) {
    const label: Record<string, string> = {
      pic_time: "PIC time",
      sic_time: "SIC time",
      solo_time: "solo time",
      cross_country_time: "cross-country time",
      night_time: "night time",
      instrument_actual_time: "actual instrument time",
      instrument_simulated_time: "simulated instrument time",
    };
    const field = overTotal[1] ?? "";
    const name = label[field] ?? field.replace(/_/g, " ");
    const value = values[field as keyof LogbookEntryFlightFields];
    return `The ${name} on this flight (${String(value)}) is greater than its total time (${values.total_time}), which can't be right — each of those is a portion of the same flight. Fix it in ForeFlight and re-import, or add this flight by hand.`;
  }
  if (problem === "simulator time without a device type") {
    return "This row logs simulator time but doesn't say what kind of device it was (FFS, FTD or ATD), which the logbook needs in order to record it.";
  }
  if (problem === "approach type without an approach count") {
    return "This row names an approach type but records zero approaches.";
  }
  if (problem.startsWith("invalid entry_date")) {
    return "This row's date isn't a real calendar date.";
  }
  if (problem.startsWith("invalid total_time")) {
    return "This row's total time isn't a number the logbook can record (it must be zero or more, in tenths of an hour).";
  }
  const invalidField = /^invalid (\w+)/.exec(problem);
  if (invalidField) {
    return `This row's ${(invalidField[1] ?? "").replace(/_/g, " ")} isn't a value the logbook can record.`;
  }
  return problem;
}

export async function confirmImport(payload: ConfirmImportPayload): Promise<ConfirmImportResult> {
  const { account, user } = await requireAccount("/logbook/import");

  if (!(FORMATS as readonly string[]).includes(payload.format)) {
    return { error: "That import format isn't recognized." };
  }
  if (payload.rows.length === 0 && payload.rejected.length === 0) {
    return { error: "That file has no rows to import." };
  }
  if (payload.rows.length + payload.rejected.length > MAX_ROWS_PER_CONFIRM) {
    return {
      error: `That file has more than ${MAX_ROWS_PER_CONFIRM.toLocaleString()} rows — split it and import in parts.`,
    };
  }
  const fileName = payload.fileName.trim().slice(0, 255) || "import.csv";

  const supabase = await createClient();

  // 1. The batch row — everything below hangs off its id.
  const batchInsert = await logbookFrom(supabase, "logbook_import_batches")
    .insert(
      {
        account_id: account.id,
        source_format: payload.format,
        status: "processing",
        total_rows: payload.totalRows,
      } as never,
      { count: "exact" }
    )
    .select("id")
    .single();

  if (batchInsert.error || !batchInsert.data) {
    return { error: friendlyDbError(batchInsert.error, "logbook_import_batches.insert") };
  }
  const batchId = (batchInsert.data as { id: string }).id;

  // Set once the source-file row is created (step 2). `fail` reads this
  // by closure, not by parameter, because it can be called before that
  // row exists (the source-file insert failing IS one of its call sites).
  let sourceFileId: string | undefined;

  /**
   * Reports a confirm that could not finish. What "recoverable" means
   * here depends on whether anything already landed:
   *
   *   importedSoFar === 0 — nothing from this confirm is in
   *   logbook_entries yet, so nothing REFERENCES this batch/source-file
   *   pair (import_batch_id/source_file_id are ON DELETE RESTRICT — see
   *   20260805220000's header — specifically because a real entry must
   *   never lose its lineage, but an EMPTY batch has no such entry to
   *   protect). Delete both rows outright so a retry starts clean instead
   *   of leaving a permanently dangling status:'failed' row an account
   *   can never remove — the exact problem the reviewer flagged. This is
   *   best-effort: if the delete itself errors, the batch just remains as
   *   a harmless historical 'failed' row, no worse than before this fix.
   *
   *   importedSoFar > 0 — real rows are already committed (chunks/rows
   *   before this one succeeded; see the insert loop below — each
   *   round-trip is its own statement, not one transaction, because this
   *   action runs as the authenticated pilot under RLS and this app has
   *   exactly one service-role entry point (the Stripe webhook), which
   *   this is not it). Telling the pilot "failed" here would be a lie on
   *   top of committed data — the actual harm the reviewer found. Instead
   *   the batch is marked 'partial' (status CHECK widened for this by
   *   20260807100000) with the true imported_rows count, and the pilot is
   *   told exactly how many rows landed and what to do about the rest.
   */
  const fail = async (message: string, error: unknown, importedSoFar: number): Promise<ConfirmImportResult> => {
    console.error("[logbook import]", message, error);

    if (importedSoFar === 0) {
      if (sourceFileId) {
        await logbookFrom(supabase, "logbook_source_files")
          .delete()
          .eq("id", sourceFileId)
          .eq("account_id", account.id);
      }
      await logbookFrom(supabase, "logbook_import_batches")
        .delete()
        .eq("id", batchId)
        .eq("account_id", account.id);
      return { error: "Couldn't complete that import. Nothing was added to your logbook — check the file and try again." };
    }

    const reason = friendlyDbError(error as { code?: string; message?: string } | null, message);
    const partialSummary = JSON.stringify({ failedAt: message, importedBeforeFailure: importedSoFar });
    await logbookFrom(supabase, "logbook_import_batches")
      .update(
        { status: "partial", imported_rows: importedSoFar, error_summary: partialSummary } as never,
        { count: "exact" }
      )
      .eq("id", batchId)
      .eq("account_id", account.id);
    return {
      error: null,
      batchId,
      imported: importedSoFar,
      partial: true,
      partialMessage: `${importedSoFar} row${importedSoFar === 1 ? "" : "s"} were saved to your logbook before the import stopped. ${reason} The remaining rows were not attempted — re-export just the rows after this point and import them separately.`,
    };
  };

  // 2. The source file row.
  const fileInsert = await logbookFrom(supabase, "logbook_source_files")
    .insert(
      {
        account_id: account.id,
        import_batch_id: batchId,
        file_name: fileName,
        row_count: payload.totalRows,
      } as never,
      { count: "exact" }
    )
    .select("id")
    .single();

  if (fileInsert.error || !fileInsert.data) {
    return await fail("source file insert failed", fileInsert.error, 0);
  }
  sourceFileId = (fileInsert.data as { id: string }).id;

  // 3. Validate every row's shape before anything is fingerprinted or
  // inserted, since these rows never went through parseEntryForm's
  // server-side checks the way a manual entry does.
  //
  // A ROW THAT CANNOT BE STORED IS REJECTED ON ITS OWN. It used to abort
  // the entire confirm: `return await fail("row N: ...", null, 0)`, which
  // deleted the batch and told the pilot "Couldn't complete that import.
  // Nothing was added to your logbook — check the file and try again."
  // The row number and the actual reason went to console.error, where no
  // pilot will ever see them.
  //
  // Found the hard way against a real 221-row ForeFlight export: 20 rows
  // tripped this (18 full-flight-simulator sessions with no PIC/SIC/solo/
  // dual time to infer a role from, one row logging PIC and SIC and Solo
  // simultaneously, and one whose CrossCountry exceeded its TotalTime) —
  // and all 221 rows were refused, with no way to tell which 20 or why.
  // 201 perfectly good entries were unreachable because of 20 the file
  // itself could not express.
  //
  // That is the wrong trade for a logbook. An import is not a
  // transaction the pilot asked to be atomic; it is a bulk entry of
  // independent legal records, and one unusable row says nothing about
  // the other 220. This product already has the right surface for this —
  // `rejected` rows flow into the batch's error_summary and render in the
  // import workspace — the validator simply wasn't using it.
  const serverRejected: { rowNumber: number; raw: string; reason: string }[] = [];
  const acceptedRows: ConfirmImportRow[] = [];
  for (const row of payload.rows) {
    const problem = validateRow(row.values);
    if (problem) {
      serverRejected.push({
        rowNumber: row.rowNumber,
        raw: "",
        reason: explainValidationFailure(problem, row.values),
      });
      continue;
    }
    acceptedRows.push(row);
  }

  // Every row unusable is still worth reporting precisely rather than
  // generically — the pilot gets the same per-row reasons, and the batch
  // is cleaned up exactly as `fail` would have done.
  if (acceptedRows.length === 0) {
    if (sourceFileId) {
      await logbookFrom(supabase, "logbook_source_files")
        .delete()
        .eq("id", sourceFileId)
        .eq("account_id", account.id);
    }
    await logbookFrom(supabase, "logbook_import_batches")
      .delete()
      .eq("id", batchId)
      .eq("account_id", account.id);
    const first = serverRejected[0];
    return {
      error: `None of the ${payload.rows.length} row${payload.rows.length === 1 ? "" : "s"} in that file could be imported. The first problem is on row ${first?.rowNumber ?? 1}: ${first?.reason ?? "the row could not be read."}`,
    };
  }

  // 4. Fingerprint + dedup. row_fingerprint is ALWAYS computed here, never
  // accepted from the client — see fingerprint.ts for why these six
  // fields and not others. Only source='import' rows are ever queried or
  // written with a fingerprint, so manual/trip-derived rows can never be
  // matched or overwritten by this dedup — see that partial unique
  // index's WHERE clause.
  const withFingerprint = acceptedRows.map((row) => ({
    row,
    fingerprint: rowFingerprint(row.values),
  }));
  const candidateFingerprints = Array.from(new Set(withFingerprint.map((r) => r.fingerprint)));

  // Looked up in bounded chunks, not one `.in()` call — see
  // FINGERPRINT_LOOKUP_CHUNK's comment for why an unbounded list here is
  // a URL-length failure mode, not a body-size one.
  const seenFingerprints = new Set<string>();
  for (let i = 0; i < candidateFingerprints.length; i += FINGERPRINT_LOOKUP_CHUNK) {
    const chunk = candidateFingerprints.slice(i, i + FINGERPRINT_LOOKUP_CHUNK);
    const existing = await logbookFrom(supabase, "logbook_entries")
      .select("row_fingerprint")
      .eq("account_id", account.id)
      .eq("source", "import")
      .in("row_fingerprint", chunk);

    if (existing.error) {
      return await fail("dedup lookup failed", existing.error, 0);
    }
    for (const r of (existing.data ?? []) as { row_fingerprint: string }[]) {
      seenFingerprints.add(r.row_fingerprint);
    }
  }

  let duplicatesInLogbook = 0;
  let duplicatesInFile = 0;
  const duplicateDetail: DuplicateRowDetail[] = [];
  // Fingerprints seen so far WITHIN THIS FILE, kept separate from
  // seenFingerprints (which is only ever populated from logbook_entries
  // above). Conflating the two — as a single shared set that both starts
  // pre-loaded from the DB lookup AND accumulates during the loop — is
  // what made every in-file duplicate get reported with the same
  // "already in your logbook from a previous import" sentence as a true
  // DB match, which is false for a first-ever import (see
  // fingerprint.ts's documented pattern-work-hop collision case).
  const fileFingerprints = new Set<string>();
  const toInsert: ImportRowInsert[] = [];
  for (const { row, fingerprint } of withFingerprint) {
    if (seenFingerprints.has(fingerprint)) {
      duplicatesInLogbook += 1;
      if (duplicateDetail.length < MAX_STORED_REJECTIONS) {
        duplicateDetail.push({ rowNumber: row.rowNumber, sourceRow: row.sourceRow, kind: "in_logbook" });
      }
      continue;
    }
    if (fileFingerprints.has(fingerprint)) {
      duplicatesInFile += 1;
      if (duplicateDetail.length < MAX_STORED_REJECTIONS) {
        duplicateDetail.push({ rowNumber: row.rowNumber, sourceRow: row.sourceRow, kind: "in_file" });
      }
      continue;
    }
    fileFingerprints.add(fingerprint);
    toInsert.push({
      ...toFlightFields(row.values),
      account_id: account.id,
      airman_user_id: user.id,
      source: "import",
      // Explicitly pinned, not merely omitted: trip_id/trip_leg_id are
      // granted on INSERT (20260807090000, for the confirmed-draft flow)
      // and are NOT part of LogbookEntryFlightFields/ConfirmImportRow, but
      // toFlightFields' explicit allowlist copy is the thing that stops a
      // crafted payload's extra JSON keys from reaching this object at
      // all — these two lines are the second half of that fix, stating
      // the intent in code instead of leaving it implicit. See
      // logbook_entries_import_no_trip_lineage (20260807100000) for the
      // hard boundary behind this.
      trip_id: null,
      trip_leg_id: null,
      import_batch_id: batchId,
      source_file_id: sourceFileId,
      source_row_number: row.rowNumber,
      row_fingerprint: fingerprint,
      source_row: row.sourceRow,
    });
  }

  // 5. Insert in chunks — a career logbook can be thousands of rows, and
  // one giant INSERT is both a worse failure unit (one bad row voids the
  // whole batch) and closer to PostgREST/connection payload limits than
  // several smaller ones.
  //
  // HONESTY, NOT ATOMICITY: these chunks are separate round-trips, not one
  // transaction — this action runs as the authenticated pilot under RLS,
  // and this app has exactly one service-role entry point (the Stripe
  // webhook; see lib/supabase/service-role.ts), which import must not
  // become a second one of. That means a failure at chunk k genuinely
  // leaves chunks 1..k-1 committed. Rather than wrap that in a fake
  // all-or-nothing story, `fail()` above reports it truthfully: exactly
  // how many rows landed and what to do about the rest. `imported` below
  // is only ever incremented by a COUNT POSTGREST ACTUALLY RETURNED — see
  // the `gotCount` checks — never assumed, so this number is never a
  // guess.
  const CHUNK = 500;
  let imported = 0;
  for (let i = 0; i < toInsert.length; i += CHUNK) {
    const chunk = toInsert.slice(i, i + CHUNK);
    const insertResult = await logbookFrom(supabase, "logbook_entries").insert(chunk as never, {
      count: "exact",
    });

    if (insertResult.error) {
      // 23505 here means a fingerprint that wasn't in our pre-check
      // landed anyway — another confirm for the same file racing this
      // one. Same race class confirmLegDraft already handles for trip
      // drafts: fall back to inserting this chunk row-by-row so the rest
      // of the batch still lands instead of the whole chunk failing.
      if ((insertResult.error as { code?: string }).code === "23505") {
        for (const singleRow of chunk) {
          const single = await logbookFrom(supabase, "logbook_entries").insert(
            singleRow as never,
            { count: "exact" }
          );
          if (single.error) {
            if ((single.error as { code?: string }).code === "23505") {
              duplicatesInLogbook += 1;
              continue;
            }
            return await fail("insert failed mid-batch", single.error, imported);
          }
          if (single.count === 1) imported += 1;
        }
        continue;
      }
      return await fail("insert failed", insertResult.error, imported);
    }
    const gotCount = typeof insertResult.count === "number" ? insertResult.count : null;
    if (gotCount === null) {
      // PostgREST didn't return a count even though { count: "exact" }
      // was requested — an anomaly, not a success we can vouch for.
      // Fabricating `chunk.length` here (the previous behavior) would
      // make the pilot's final "N entries added" a guess rather than a
      // fact; treat it the same as any other insert failure instead.
      return await fail("insert returned no count", null, imported);
    }
    imported += gotCount;
  }

  // 6. Close out the batch with a durable record of what happened —
  // including what was rejected, per "a rejected-row surface... not
  // silently dropped." Capped the same way the logbook page caps its own
  // entries list, with the same kind of truncation note rather than an
  // unbounded blob.
  //
  // The two rejection sources are merged, not tracked separately: the
  // client parser's own rejections (a row it could not read at all) and
  // this action's validation rejections (a row it read fine but the
  // logbook cannot store) are the same thing from the pilot's side — a
  // row from their file that did not make it in, with a reason. Keeping
  // them apart would mean two counts to reconcile and two places for one
  // to be forgotten, which is how the validation rejections came to be
  // invisible in the first place.
  const allRejected = [...payload.rejected, ...serverRejected].sort(
    (a, b) => a.rowNumber - b.rowNumber
  );
  const rejectedForSummary = allRejected.slice(0, MAX_STORED_REJECTIONS).map((r) => ({
    rowNumber: r.rowNumber,
    raw: r.raw.slice(0, 500),
    reason: r.reason,
  }));
  const duplicateDetailTruncated = duplicateDetail.length >= MAX_STORED_REJECTIONS;
  const errorSummary = JSON.stringify({
    rejected: rejectedForSummary,
    rejectedTruncated: allRejected.length > MAX_STORED_REJECTIONS,
    duplicatesInLogbook,
    duplicatesInFile,
    duplicateDetail,
    duplicateDetailTruncated,
    excludedByPilot: payload.excludedByPilot,
  });

  const closeOut = await logbookFrom(supabase, "logbook_import_batches")
    .update(
      {
        status: "completed",
        imported_rows: imported,
        rejected_rows: allRejected.length,
        error_summary: errorSummary,
      } as never,
      { count: "exact" }
    )
    .eq("id", batchId)
    .eq("account_id", account.id);

  if (closeOut.error) {
    // The entries are already safely written at this point — a failure
    // here is a bookkeeping problem on the batch row, not a lost import,
    // so it's logged rather than reported as a failed import (which
    // would wrongly suggest to the pilot that nothing landed).
    console.error("[logbook import] batch close-out failed", closeOut.error);
  }

  revalidatePath("/logbook");
  revalidatePath("/logbook/import");

  return {
    error: null,
    batchId,
    imported,
    duplicatesInLogbook,
    duplicatesInFile,
    duplicateDetail,
    duplicateDetailTruncated,
    rejectedCount: allRejected.length,
    rejectedDetail: rejectedForSummary,
  };
}

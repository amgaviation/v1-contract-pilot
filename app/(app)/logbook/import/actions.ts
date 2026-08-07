"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireAccount } from "@/lib/supabase/account";
import { friendlyDbError } from "@/lib/db-errors";
import { logbookFrom, type LogbookRole, type SimulatorDeviceType, type ApproachType } from "../db";
import { rowFingerprint } from "@/lib/logbook-import/fingerprint";
import type { ImportFormat, ImportEntryInsert } from "@/lib/logbook-import/types";
import type { LogbookEntryFlightFields } from "../db";

const ROLES: readonly LogbookRole[] = ["PIC", "SIC"];
const SIM_DEVICES: readonly SimulatorDeviceType[] = ["ftd", "atd", "other"];
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

/** A hard ceiling on one confirm request — not a product limit on logbook size, just a guard against an unbounded payload in one HTTP request. A career logbook that exceeds this splits across two file uploads/imports, each with its own batch. */
const MAX_ROWS_PER_CONFIRM = 20000;
/** How many rejected-row details are kept in error_summary — matches the house "explicit limit + truncation callout" rule rather than storing an unbounded blob. */
const MAX_STORED_REJECTIONS = 500;

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

export type ConfirmImportResult = {
  error: string | null;
  batchId?: string;
  imported?: number;
  duplicates?: number;
  rejectedCount?: number;
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
function isDateString(v: unknown): v is string {
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
}
function isIcaoOrNull(v: unknown): v is string | null {
  if (v === null) return true;
  return typeof v === "string" && /^[A-Z0-9]{3,4}$/.test(v);
}

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

  const fail = async (message: string, error: unknown) => {
    console.error("[logbook import]", message, error);
    await logbookFrom(supabase, "logbook_import_batches")
      .update({ status: "failed", error_summary: message } as never)
      .eq("id", batchId)
      .eq("account_id", account.id);
    return { error: "Couldn't complete that import. Try again." };
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
    return fail("source file insert failed", fileInsert.error);
  }
  const sourceFileId = (fileInsert.data as { id: string }).id;

  // 3. Validate every row's shape before anything is fingerprinted or
  // inserted — one bad row aborts the whole confirm rather than landing
  // a partially-validated batch, since these rows never went through
  // parseEntryForm's server-side checks the way a manual entry does.
  for (const row of payload.rows) {
    const problem = validateRow(row.values);
    if (problem) {
      return await fail(`row ${row.rowNumber}: ${problem}`, null);
    }
  }

  // 4. Fingerprint + dedup. row_fingerprint is ALWAYS computed here, never
  // accepted from the client — see fingerprint.ts for why these six
  // fields and not others. Only source='import' rows are ever queried or
  // written with a fingerprint, so manual/trip-derived rows can never be
  // matched or overwritten by this dedup — see that partial unique
  // index's WHERE clause.
  const withFingerprint = payload.rows.map((row) => ({
    row,
    fingerprint: rowFingerprint(row.values),
  }));
  const candidateFingerprints = Array.from(new Set(withFingerprint.map((r) => r.fingerprint)));

  const existing = await logbookFrom(supabase, "logbook_entries")
    .select("row_fingerprint")
    .eq("account_id", account.id)
    .eq("source", "import")
    .in("row_fingerprint", candidateFingerprints);

  if (existing.error) {
    return await fail("dedup lookup failed", existing.error);
  }
  const seenFingerprints = new Set<string>(
    ((existing.data ?? []) as { row_fingerprint: string }[]).map((r) => r.row_fingerprint)
  );

  let duplicates = 0;
  const toInsert: ImportEntryInsert[] = [];
  for (const { row, fingerprint } of withFingerprint) {
    if (seenFingerprints.has(fingerprint)) {
      duplicates += 1;
      continue;
    }
    seenFingerprints.add(fingerprint); // guards against two identical rows within THIS file too
    toInsert.push({
      ...row.values,
      account_id: account.id,
      airman_user_id: user.id,
      source: "import",
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
              duplicates += 1;
              continue;
            }
            return await fail("insert failed mid-batch", single.error);
          }
          if (single.count === 1) imported += 1;
        }
        continue;
      }
      return await fail("insert failed", insertResult.error);
    }
    imported += insertResult.count ?? chunk.length;
  }

  // 6. Close out the batch with a durable record of what happened —
  // including what was rejected, per "a rejected-row surface... not
  // silently dropped." Capped the same way the logbook page caps its own
  // entries list, with the same kind of truncation note rather than an
  // unbounded blob.
  const rejectedForSummary = payload.rejected.slice(0, MAX_STORED_REJECTIONS).map((r) => ({
    rowNumber: r.rowNumber,
    raw: r.raw.slice(0, 500),
    reason: r.reason,
  }));
  const errorSummary = JSON.stringify({
    rejected: rejectedForSummary,
    rejectedTruncated: payload.rejected.length > MAX_STORED_REJECTIONS,
    duplicatesSkipped: duplicates,
    excludedByPilot: payload.excludedByPilot,
  });

  const closeOut = await logbookFrom(supabase, "logbook_import_batches")
    .update(
      {
        status: "completed",
        imported_rows: imported,
        rejected_rows: payload.rejected.length,
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
    duplicates,
    rejectedCount: payload.rejected.length,
  };
}

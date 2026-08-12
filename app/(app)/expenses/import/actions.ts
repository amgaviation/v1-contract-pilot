"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireEntitlement } from "@/lib/supabase/entitlements";
import { friendlyDbError } from "@/lib/db-errors";
import { transactionFingerprint } from "@/lib/bank-import/fingerprint";
import type { BankFileFormat } from "@/lib/bank-import/types";
import type { Database } from "@/lib/supabase/database.types";

type BankAccountRow = Database["pilot"]["Tables"]["bank_accounts"]["Row"];
type BankAccountInsert = Database["pilot"]["Tables"]["bank_accounts"]["Insert"];

const KINDS: readonly BankAccountRow["kind"][] = ["checking", "savings", "credit_card"];
const FORMATS: readonly BankFileFormat[] = ["csv_signed", "csv_debit_credit", "ofx", "qfx"];

/**
 * A hard ceiling on one confirm request, same reasoning as
 * lib/logbook-import's MAX_ROWS_PER_CONFIRM — sized to stay under
 * next.config.ts's bodySizeLimit given this payload's shape
 * (source_row is re-serialized per row on top of the parsed fields). A
 * statement with more rows than this splits across two uploads.
 */
const MAX_ROWS_PER_CONFIRM = 5000;
const MAX_STORED_REJECTIONS = 500;
/** Same URL-length reasoning as logbook's FINGERPRINT_LOOKUP_CHUNK. */
const FINGERPRINT_LOOKUP_CHUNK = 40;

export type BankAccountOption = {
  id: string;
  label: string;
  last4: string | null;
  kind: BankAccountRow["kind"];
};

export async function listBankAccounts(): Promise<{ accounts: BankAccountOption[]; error: string | null }> {
  await requireEntitlement("bank_import", "/expenses/import");
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("bank_accounts")
    .select("id, label, last4, kind")
    .is("archived_at", null)
    .order("label", { ascending: true });
  if (error) return { accounts: [], error: friendlyDbError(error, "bank_accounts.select") };
  return { accounts: (data ?? []) as BankAccountOption[], error: null };
}

export type CreateBankAccountResult = { error: string | null; account?: BankAccountOption };

export async function createBankAccount(formData: FormData): Promise<CreateBankAccountResult> {
  const { account } = await requireEntitlement("bank_import", "/expenses/import");
  const label = String(formData.get("label") ?? "").trim().slice(0, 200);
  if (!label) return { error: "Give this account a name — e.g. \"Chase checking\"." };
  const kindRaw = String(formData.get("kind") ?? "");
  if (!(KINDS as readonly string[]).includes(kindRaw)) return { error: "Pick an account type." };
  const kind = kindRaw as BankAccountRow["kind"];
  let last4: string | null = String(formData.get("last4") ?? "").trim().slice(0, 4) || null;
  if (last4 && !/^[A-Za-z0-9]{2,4}$/.test(last4)) {
    return { error: "Last 4 should just be the last few digits/characters on the statement." };
  }

  const supabase = await createClient();
  const payload: BankAccountInsert = { account_id: account.id, label, last4, kind };
  const insert = await supabase.from("bank_accounts").insert(payload as never).select("id, label, last4, kind").maybeSingle();
  if (insert.error || !insert.data) {
    return { error: friendlyDbError(insert.error, "bank_accounts.insert") };
  }
  revalidatePath("/expenses/import");
  return { error: null, account: insert.data as BankAccountOption };
}

export type ConfirmBankImportRow = {
  rowNumber: number;
  sourceRow: Record<string, string>;
  postedOn: string;
  description: string;
  amountCents: number;
};

export type ConfirmBankImportPayload = {
  format: BankFileFormat;
  bankAccountId: string;
  fileName: string;
  totalRows: number;
  rows: ConfirmBankImportRow[];
  rejected: { rowNumber: number; raw: string; reason: string }[];
  excludedByPilot: number;
};

export type DuplicateTxnDetail = {
  rowNumber: number;
  sourceRow: Record<string, string>;
  kind: "in_ledger" | "in_file";
};

export type ConfirmBankImportResult = {
  error: string | null;
  batchId?: string;
  imported?: number;
  duplicatesInLedger?: number;
  duplicatesInFile?: number;
  duplicateDetail?: DuplicateTxnDetail[];
  duplicateDetailTruncated?: boolean;
  rejectedCount?: number;
  partial?: boolean;
  partialMessage?: string;
};

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
  return day >= 1 && day <= maxDay;
}

/**
 * Defense-in-depth revalidation of a row this server never computed
 * itself — the browser parsed the file (lib/bank-import/*), and this
 * action does not trust the payload's *shape* is honest, same posture as
 * logbook's confirmImport / validateRow.
 */
function validateRow(row: ConfirmBankImportRow): string | null {
  if (!isDateString(row.postedOn)) return "invalid posted_on";
  if (typeof row.description !== "string" || row.description.trim() === "") return "missing description";
  if (row.description.length > 2000) return "description too long";
  if (typeof row.amountCents !== "number" || !Number.isInteger(row.amountCents) || row.amountCents === 0) {
    return "invalid amount_cents";
  }
  if (Math.abs(row.amountCents) > 999_999_999_99) return "amount out of range";
  return null;
}

export async function confirmBankImport(payload: ConfirmBankImportPayload): Promise<ConfirmBankImportResult> {
  const { account } = await requireEntitlement("bank_import", "/expenses/import");

  if (!(FORMATS as readonly string[]).includes(payload.format)) {
    return { error: "That import format isn't recognized." };
  }
  if (!payload.bankAccountId) {
    return { error: "Pick which account this statement is from." };
  }
  if (payload.rows.length === 0 && payload.rejected.length === 0) {
    return { error: "That file has no rows to import." };
  }
  if (payload.rows.length + payload.rejected.length > MAX_ROWS_PER_CONFIRM) {
    return {
      error: `That file has more than ${MAX_ROWS_PER_CONFIRM.toLocaleString()} rows — split it and import in parts.`,
    };
  }
  const fileName = payload.fileName.trim().slice(0, 255) || "statement";

  const supabase = await createClient();

  // Confirm the bank account belongs to this tenant before anything else
  // — RLS already guarantees this at the DB layer for every insert below,
  // this is only so a bad bankAccountId fails with a sentence instead of
  // a cryptic FK violation.
  const bankAccountCheck = await supabase
    .from("bank_accounts")
    .select("id")
    .eq("id", payload.bankAccountId)
    .maybeSingle();
  if (bankAccountCheck.error || !bankAccountCheck.data) {
    return { error: "That account isn't recognized. Refresh and try again." };
  }

  const batchInsertPayload: Database["pilot"]["Tables"]["bank_import_batches"]["Insert"] = {
    account_id: account.id,
    bank_account_id: payload.bankAccountId,
    source_format: payload.format,
    status: "processing",
    total_rows: payload.totalRows,
  };
  const batchInsert = await supabase
    .from("bank_import_batches")
    .insert(batchInsertPayload as never)
    .select("id")
    .maybeSingle();
  if (batchInsert.error || !batchInsert.data) {
    return { error: friendlyDbError(batchInsert.error, "bank_import_batches.insert") };
  }
  const batchId = (batchInsert.data as { id: string }).id;

  let sourceFileId: string | undefined;

  const fail = async (message: string, error: unknown, importedSoFar: number): Promise<ConfirmBankImportResult> => {
    console.error("[bank import]", message, error);

    if (importedSoFar === 0) {
      if (sourceFileId) {
        await supabase.from("bank_source_files").delete().eq("id", sourceFileId).eq("account_id", account.id);
      }
      await supabase.from("bank_import_batches").delete().eq("id", batchId).eq("account_id", account.id);
      return { error: "Couldn't complete that import. Nothing was added — check the file and try again." };
    }

    const reason = friendlyDbError(error as { code?: string; message?: string } | null, message);
    const partialSummary = JSON.stringify({ failedAt: message, importedBeforeFailure: importedSoFar });
    await supabase
      .from("bank_import_batches")
      .update({ status: "partial", imported_rows: importedSoFar, error_summary: partialSummary } as never, {
        count: "exact",
      })
      .eq("id", batchId)
      .eq("account_id", account.id);
    return {
      error: null,
      batchId,
      imported: importedSoFar,
      partial: true,
      partialMessage: `${importedSoFar} transaction${importedSoFar === 1 ? "" : "s"} were saved before the import stopped. ${reason} The remaining rows were not attempted — re-export just the rows after this point and import them separately.`,
    };
  };

  const fileInsertPayload: Database["pilot"]["Tables"]["bank_source_files"]["Insert"] = {
    account_id: account.id,
    import_batch_id: batchId,
    file_name: fileName,
    row_count: payload.totalRows,
  };
  const fileInsert = await supabase
    .from("bank_source_files")
    .insert(fileInsertPayload as never)
    .select("id")
    .maybeSingle();
  if (fileInsert.error || !fileInsert.data) {
    return await fail("source file insert failed", fileInsert.error, 0);
  }
  sourceFileId = (fileInsert.data as { id: string }).id;

  for (const row of payload.rows) {
    const problem = validateRow(row);
    if (problem) return await fail(`row ${row.rowNumber}: ${problem}`, null, 0);
  }

  // Fingerprint + dedup — see fingerprint.ts. Computed here, never
  // accepted from the client.
  const withFingerprint = payload.rows.map((row) => ({
    row,
    fingerprint: transactionFingerprint({
      postedOn: row.postedOn,
      description: row.description,
      amountCents: row.amountCents,
    }),
  }));
  const candidateFingerprints = Array.from(new Set(withFingerprint.map((r) => r.fingerprint)));

  const seenFingerprints = new Set<string>();
  for (let i = 0; i < candidateFingerprints.length; i += FINGERPRINT_LOOKUP_CHUNK) {
    const chunk = candidateFingerprints.slice(i, i + FINGERPRINT_LOOKUP_CHUNK);
    const existing = await supabase
      .from("bank_transactions")
      .select("fingerprint")
      .eq("account_id", account.id)
      .eq("bank_account_id", payload.bankAccountId)
      .in("fingerprint", chunk);
    if (existing.error) return await fail("dedup lookup failed", existing.error, 0);
    for (const r of (existing.data ?? []) as { fingerprint: string }[]) seenFingerprints.add(r.fingerprint);
  }

  let duplicatesInLedger = 0;
  let duplicatesInFile = 0;
  const duplicateDetail: DuplicateTxnDetail[] = [];
  const fileFingerprints = new Set<string>();
  const toInsert: Database["pilot"]["Tables"]["bank_transactions"]["Insert"][] = [];
  for (const { row, fingerprint } of withFingerprint) {
    if (seenFingerprints.has(fingerprint)) {
      duplicatesInLedger += 1;
      if (duplicateDetail.length < MAX_STORED_REJECTIONS) {
        duplicateDetail.push({ rowNumber: row.rowNumber, sourceRow: row.sourceRow, kind: "in_ledger" });
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
      account_id: account.id,
      bank_account_id: payload.bankAccountId,
      import_batch_id: batchId,
      source_file_id: sourceFileId,
      source_row_number: row.rowNumber,
      source_row: row.sourceRow as never,
      posted_on: row.postedOn,
      description: row.description,
      amount_cents: row.amountCents,
      fingerprint,
    });
  }

  const CHUNK = 500;
  let imported = 0;
  for (let i = 0; i < toInsert.length; i += CHUNK) {
    const chunk = toInsert.slice(i, i + CHUNK);
    const insertResult = await supabase.from("bank_transactions").insert(chunk as never, { count: "exact" });
    if (insertResult.error) {
      if ((insertResult.error as { code?: string }).code === "23505") {
        for (const singleRow of chunk) {
          const single = await supabase.from("bank_transactions").insert(singleRow as never, { count: "exact" });
          if (single.error) {
            if ((single.error as { code?: string }).code === "23505") {
              duplicatesInLedger += 1;
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
    if (gotCount === null) return await fail("insert returned no count", null, imported);
    imported += gotCount;
  }

  const rejectedForSummary = payload.rejected.slice(0, MAX_STORED_REJECTIONS).map((r) => ({
    rowNumber: r.rowNumber,
    raw: r.raw.slice(0, 500),
    reason: r.reason,
  }));
  const duplicateDetailTruncated = duplicateDetail.length >= MAX_STORED_REJECTIONS;
  const errorSummary = JSON.stringify({
    rejected: rejectedForSummary,
    rejectedTruncated: payload.rejected.length > MAX_STORED_REJECTIONS,
    duplicatesInLedger,
    duplicatesInFile,
    duplicateDetail,
    duplicateDetailTruncated,
    excludedByPilot: payload.excludedByPilot,
  });

  const closeOut = await supabase
    .from("bank_import_batches")
    .update(
      {
        status: "completed",
        imported_rows: imported,
        rejected_rows: payload.rejected.length,
        duplicate_rows: duplicatesInLedger + duplicatesInFile,
        error_summary: errorSummary,
      } as never,
      { count: "exact" }
    )
    .eq("id", batchId)
    .eq("account_id", account.id);
  if (closeOut.error) {
    console.error("[bank import] batch close-out failed", closeOut.error);
  }

  revalidatePath("/expenses");
  revalidatePath("/expenses/import");
  revalidatePath("/expenses/transactions");

  return {
    error: null,
    batchId,
    imported,
    duplicatesInLedger,
    duplicatesInFile,
    duplicateDetail,
    duplicateDetailTruncated,
    rejectedCount: payload.rejected.length,
  };
}

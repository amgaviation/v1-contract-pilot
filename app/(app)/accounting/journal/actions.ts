"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireAccount } from "@/lib/supabase/account";
import { friendlyDbError } from "@/lib/db-errors";
import { parseJournalLines } from "../ledger-lib";

export type JournalFormState = {
  error: string | null;
  values?: {
    entry_date: string;
    memo: string;
    accounts: string[];
    sides: string[];
    amounts: string[];
  };
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(value);
}

function revalidateLedger() {
  revalidatePath("/accounting");
  revalidatePath("/accounting/journal");
  revalidatePath("/accounting/reconcile");
  revalidatePath("/reports/balance-sheet");
  revalidatePath("/reports/cash-flow");
}

/**
 * A MANUAL journal entry — the two-line-minimum form. Parsing happens in
 * ledger-lib's parseJournalLines (pure, unit-tested); the write is ONE
 * call to pilot.journal_entry_create, which inserts header + lines in one
 * transaction and re-checks balance in the database (the deferred
 * debits-equals-credits trigger backstops even that).
 */
export async function createJournalEntry(
  _prev: JournalFormState,
  formData: FormData
): Promise<JournalFormState> {
  const { account } = await requireAccount("/accounting/journal");

  const entryDate = String(formData.get("entry_date") ?? "").trim();
  const memo = String(formData.get("memo") ?? "").trim();
  const accounts = formData.getAll("line_account").map(String);
  const sides = formData.getAll("line_side").map(String);
  const amounts = formData.getAll("line_amount").map(String);
  const echo = { entry_date: entryDate, memo, accounts, sides, amounts };

  if (!entryDate || !isDate(entryDate)) {
    return { error: "When did this happen? Enter a valid date.", values: echo };
  }
  if (!memo) {
    return {
      error: "Give the entry a memo — six months from now it has to explain itself.",
      values: echo,
    };
  }
  if (memo.length > 500) {
    return { error: "Keep the memo under 500 characters.", values: echo };
  }

  const parsed = parseJournalLines(accounts, sides, amounts);
  if (!parsed.ok) return { error: parsed.error, values: echo };

  const supabase = await createClient();
  const { error } = await supabase.rpc("journal_entry_create", {
    target_account_id: account.id,
    p_entry_date: entryDate,
    p_memo: memo,
    p_lines: parsed.lines,
  } as never);

  if (error) {
    return { error: friendlyDbError(error, "journal_entry_create"), values: echo };
  }
  revalidateLedger();
  return { error: null };
}

/**
 * Delete a MANUAL entry (fix-by-re-entry, same discipline as mileage's
 * locked rate). The database refuses derived entries — those clear
 * automatically when their source changes — and that message is surfaced.
 */
export async function deleteJournalEntry(id: string): Promise<{ error: string | null }> {
  if (!UUID_RE.test(id)) return { error: "Missing journal entry id." };
  await requireAccount("/accounting/journal");

  const supabase = await createClient();
  const { error } = await supabase.rpc("journal_entry_delete", {
    p_entry_id: id,
  } as never);

  if (error) return { error: friendlyDbError(error, "journal_entry_delete") };
  revalidateLedger();
  return { error: null };
}

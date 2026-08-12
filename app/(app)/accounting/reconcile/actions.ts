"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireAccount } from "@/lib/supabase/account";
import { friendlyDbError } from "@/lib/db-errors";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Pair one statement line with one ledger Cash & bank line. All the
 * integrity lives in the database (20260812100001): identical amounts and
 * a bank-account line enforced by trigger (P0001), one match per side by
 * unique index (23505), tenancy by RLS + composite FKs. This action just
 * carries the pilot's choice there and surfaces the refusal verbatim.
 */
export async function matchStatementLine(
  bankTransactionId: string,
  journalLineId: string
): Promise<{ error: string | null }> {
  if (!UUID_RE.test(bankTransactionId) || !UUID_RE.test(journalLineId)) {
    return { error: "Pick one statement line and one ledger line to match." };
  }
  const { account } = await requireAccount("/accounting/reconcile");

  const supabase = await createClient();
  const { error } = await supabase.from("bank_statement_matches").insert({
    account_id: account.id,
    bank_transaction_id: bankTransactionId,
    journal_line_id: journalLineId,
  } as never);

  if (error) return { error: friendlyDbError(error, "bank_statement_matches.insert") };
  revalidatePath("/accounting/reconcile");
  return { error: null };
}

export async function unmatchStatementLine(
  matchId: string
): Promise<{ error: string | null }> {
  if (!UUID_RE.test(matchId)) return { error: "Missing match id." };
  const { account } = await requireAccount("/accounting/reconcile");

  const supabase = await createClient();
  const { error, count } = await supabase
    .from("bank_statement_matches")
    .delete({ count: "exact" })
    .eq("id", matchId)
    .eq("account_id", account.id);

  if (error) return { error: friendlyDbError(error, "bank_statement_matches.delete") };
  if (count === 0) return { error: "That match no longer exists." };
  revalidatePath("/accounting/reconcile");
  return { error: null };
}

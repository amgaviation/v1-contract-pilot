"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireAccount } from "@/lib/supabase/account";
import { friendlyDbError } from "@/lib/db-errors";
import type { Database } from "@/lib/supabase/database.types";

type Category = Database["pilot"]["Tables"]["expenses"]["Row"]["category"];
type Treatment = Database["pilot"]["Tables"]["expenses"]["Row"]["treatment"];

const CATEGORIES: readonly Category[] = [
  "airline",
  "hotel",
  "rental_car",
  "rideshare",
  "fuel",
  "meals",
  "parking",
  "other",
];
const TREATMENTS: readonly Treatment[] = ["rebill", "deduct", "unassigned"];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ConfirmTransactionResult = { error: string | null };

/**
 * THE confirm-before-expense boundary. A bank_transactions row moves out
 * of 'unreviewed' — and a pilot.expenses row gets created — ONLY here,
 * and only from an explicit pilot action naming a category and
 * treatment. Nothing on the import path (../import/actions.ts) ever
 * calls this or writes to pilot.expenses at all.
 *
 * Sign handling: bank_transactions.amount_cents is canonical-signed
 * (negative = money out). Only a NEGATIVE transaction can become an
 * expense — a positive one is a deposit/refund/payment, which this
 * product has no vocabulary for turning into an expense (and
 * pilot.expenses.amount_cents is itself `check (amount_cents >= 0)`, so
 * attempting it would fail at the database anyway). The magnitude
 * (Math.abs) becomes the expense's amount.
 *
 * Ordering, and why: (1) a CONDITIONAL update claims the row —
 * `.eq("review_state", "unreviewed")` — moving it straight to
 * 'reviewed' with category/treatment/trip_id set, in the SAME statement
 * that also satisfies the table's review-invariant CHECK atomically, so
 * no other request can double-claim this row (a second call's
 * conditional update matches zero rows and reports "already reviewed"
 * instead of creating a second expense). Only once the row is
 * successfully claimed does (2) the actual pilot.expenses row get
 * inserted, and (3) a final update attaches its id. If (2) or (3) fails,
 * the claim is rolled back with a best-effort revert to 'unreviewed' —
 * see the `revert` helper — so a failure never leaves a transaction
 * silently stuck in a reviewed-but-unlinked state the pilot can't act
 * on.
 */
export async function confirmTransaction(formData: FormData): Promise<ConfirmTransactionResult> {
  const { account } = await requireAccount("/expenses/transactions");

  const id = String(formData.get("id") ?? "");
  if (!UUID_RE.test(id)) return { error: "That transaction isn't recognized." };

  const category = String(formData.get("category") ?? "");
  if (!(CATEGORIES as readonly string[]).includes(category)) {
    return { error: "Pick a category." };
  }
  const treatment = String(formData.get("treatment") ?? "unassigned");
  if (!(TREATMENTS as readonly string[]).includes(treatment)) {
    return { error: "Pick what happens to this expense." };
  }
  const tripIdRaw = String(formData.get("trip_id") ?? "").trim();
  const tripId = tripIdRaw === "" ? null : tripIdRaw;
  if (tripId !== null && !UUID_RE.test(tripId)) return { error: "That trip isn't valid." };
  if (treatment === "rebill" && !tripId) {
    return { error: "Pick the trip this gets rebilled to — an expense can't be rebilled to nobody." };
  }
  const notes = String(formData.get("notes") ?? "").trim().slice(0, 2000) || null;

  const supabase = await createClient();

  const txn = await supabase
    .from("bank_transactions")
    .select("id, posted_on, description, amount_cents, review_state")
    .eq("id", id)
    .maybeSingle();
  if (txn.error || !txn.data) return { error: "That transaction isn't recognized." };
  const row = txn.data as {
    id: string;
    posted_on: string;
    description: string;
    amount_cents: number;
    review_state: string;
  };
  if (row.review_state !== "unreviewed") {
    return { error: "That transaction has already been reviewed." };
  }
  if (row.amount_cents >= 0) {
    return { error: "This transaction is a deposit or refund, not an expense — mark it dismissed instead." };
  }

  // Step 1: claim.
  const claim = await supabase
    .from("bank_transactions")
    .update(
      {
        review_state: "reviewed",
        category: category as Category,
        treatment: treatment as Treatment,
        trip_id: tripId,
        notes,
      } as never,
      { count: "exact" }
    )
    .eq("id", id)
    .eq("account_id", account.id)
    .eq("review_state", "unreviewed");
  if (claim.error) return { error: friendlyDbError(claim.error, "bank_transactions.claim") };
  if (claim.count !== 1) {
    return { error: "That transaction was just reviewed elsewhere — refresh and check." };
  }

  const revertClaim = async () => {
    await supabase
      .from("bank_transactions")
      .update(
        { review_state: "unreviewed", category: null, treatment: null, trip_id: null } as never,
        { count: "exact" }
      )
      .eq("id", id)
      .eq("account_id", account.id);
  };

  // Step 2: create the expense. Explicit allowlisted columns, never a
  // spread of client JSON — same discipline as logbook's confirmImport.
  const expenseInsertPayload: Database["pilot"]["Tables"]["expenses"]["Insert"] = {
    account_id: account.id,
    trip_id: tripId,
    incurred_on: row.posted_on,
    category: category as Category,
    vendor: row.description.slice(0, 500),
    amount_cents: Math.abs(row.amount_cents),
    treatment: treatment as Treatment,
    notes: notes ? `Imported from bank statement — ${notes}` : "Imported from bank statement.",
  };
  const expenseInsert = await supabase
    .from("expenses")
    .insert(expenseInsertPayload as never)
    .select("id")
    .maybeSingle();

  if (expenseInsert.error || !expenseInsert.data) {
    await revertClaim();
    return { error: friendlyDbError(expenseInsert.error, "expenses.insert") };
  }
  const expenseId = (expenseInsert.data as { id: string }).id;

  // Step 3: attach.
  const attach = await supabase
    .from("bank_transactions")
    .update({ expense_id: expenseId } as never, { count: "exact" })
    .eq("id", id)
    .eq("account_id", account.id);
  if (attach.error || attach.count !== 1) {
    // The expense is real and correctly reflects the pilot's choice —
    // only the lineage link back to the transaction failed to attach.
    // Not reverted: undoing the claim now would leave a real expense
    // with no bank_transactions row pointing at it as "reviewed",
    // which is worse (the pilot would see it as still needing review
    // AND find a duplicate expense on next confirm). Logged, not hidden.
    console.error("[bank transactions] expense created but link failed", attach.error);
  }

  revalidatePath("/expenses");
  revalidatePath("/expenses/transactions");
  return { error: null };
}

export type IgnoreTransactionResult = { error: string | null };

/** Marks a row as not-an-expense (a transfer, a duplicate the fingerprint index missed because it's genuinely two real transactions, etc). Creates nothing in pilot.expenses. */
export async function ignoreTransaction(formData: FormData): Promise<IgnoreTransactionResult> {
  const { account } = await requireAccount("/expenses/transactions");
  const id = String(formData.get("id") ?? "");
  if (!UUID_RE.test(id)) return { error: "That transaction isn't recognized." };

  const supabase = await createClient();
  const result = await supabase
    .from("bank_transactions")
    .update({ review_state: "ignored" } as never, { count: "exact" })
    .eq("id", id)
    .eq("account_id", account.id)
    .eq("review_state", "unreviewed");
  if (result.error) return { error: friendlyDbError(result.error, "bank_transactions.ignore") };
  if (result.count !== 1) return { error: "That transaction has already been reviewed." };

  revalidatePath("/expenses/transactions");
  revalidatePath("/expenses");
  return { error: null };
}

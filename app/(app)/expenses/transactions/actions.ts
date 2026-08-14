"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireEntitlement } from "@/lib/supabase/entitlements";
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
  // What a contract pilot self-funds — see
  // 20260810070000_pilot_expense_categories.sql.
  "training",
  "medical",
  "insurance",
  "charts",
  "equipment",
  "uniform",
  "dues",
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
  // The account isn't destructured any more: pilot.bank_transaction_confirm
  // derives it from the transaction's own row after checking
  // pilot.current_account_ids(), so an account id passed from here is a
  // value the database would have to distrust anyway. This call remains
  // the auth gate.
  await requireEntitlement("bank_import", "/expenses/transactions");

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

  // ONE CALL, ONE TRANSACTION (20260810040000).
  //
  // This used to be three round trips — claim, insert the expense, attach
  // the link — and the gaps between them were reachable states, not
  // theoretical ones:
  //
  //   - dying between the claim and the insert left the row 'reviewed'
  //     with expense_id null and NO expense. It then vanished from every
  //     surface (the queue filters on 'unreviewed', nothing anywhere
  //     selects reviewed-with-null-expense), the money was silently
  //     missing from the books, and a retry was told "That transaction
  //     has already been reviewed";
  //
  //   - a LOST REPLY on the insert was indistinguishable from a REJECTED
  //     insert — postgrest-js synthesises {error, status: 0} for a dead
  //     socket — so the code reverted the claim and invited a retry that
  //     created a SECOND expense for one bank line, both rebillable.
  //
  // pilot.bank_transaction_confirm does all three as one statement,
  // locking the row FOR UPDATE so two confirms racing it serialize. It is
  // SECURITY DEFINER but scoped by pilot.current_account_ids() — the same
  // narrow-door pattern as invoice_share_create and
  // generate_recurring_invoice, not a second service-role caller.
  //
  // The retry hazard is also closed underneath: expenses.bank_transaction_id
  // carries a partial unique index, so a duplicate confirm costs a 23505
  // rather than a second expense, whatever the network did.
  const confirmed = await supabase.rpc("bank_transaction_confirm", {
    p_transaction_id: id,
    p_category: category,
    p_treatment: treatment,
    p_trip_id: tripId,
    p_notes: notes,
  } as never);

  if (confirmed.error) {
    // 23505 here is the idempotency index: this transaction already became
    // an expense, which after a lost reply is a SUCCESS the pilot should
    // not be told to retry.
    if ((confirmed.error as { code?: string }).code === "23505") {
      revalidatePath("/expenses");
      revalidatePath("/expenses/transactions");
      return { error: null };
    }
    return { error: friendlyDbError(confirmed.error, "bank_transaction_confirm") };
  }

  revalidatePath("/expenses");
  revalidatePath("/expenses/transactions");
  return { error: null };
}

export type IgnoreTransactionResult = { error: string | null };

/** Marks a row as not-an-expense (a transfer, a duplicate the fingerprint index missed because it's genuinely two real transactions, etc). Creates nothing in pilot.expenses. */
export async function ignoreTransaction(formData: FormData): Promise<IgnoreTransactionResult> {
  const { account } = await requireEntitlement("bank_import", "/expenses/transactions");
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

export type UnignoreTransactionResult = { error: string | null };

/**
 * Puts a dismissed row back in the review queue. A mis-tap on Dismiss (one
 * click, no confirm) used to be permanent — nothing anywhere listed
 * 'ignored' rows, and re-importing the statement couldn't resurrect one
 * either, since its fingerprint row already existed and dedup collided on
 * it. 20260810050000's grant already permits authenticated UPDATE of
 * review_state, so this needs no schema change: the conditional
 * `.eq("review_state", "ignored")` is the same claim-style guard
 * ignoreTransaction uses, just run in reverse.
 *
 * Scoped to 'ignored' only — a 'reviewed' row with expense_id null (the
 * expense it became was since deleted) has category/treatment already SET,
 * and neither column is grantable to `authenticated` any more
 * (20260810050000), so there is no direct-UPDATE path back to 'unreviewed'
 * for that state. It is shown, not un-doable, from this action.
 */
export async function unignoreTransaction(formData: FormData): Promise<UnignoreTransactionResult> {
  const { account } = await requireEntitlement("bank_import", "/expenses/transactions");
  const id = String(formData.get("id") ?? "");
  if (!UUID_RE.test(id)) return { error: "That transaction isn't recognized." };

  const supabase = await createClient();
  const result = await supabase
    .from("bank_transactions")
    .update({ review_state: "unreviewed" } as never, { count: "exact" })
    .eq("id", id)
    .eq("account_id", account.id)
    .eq("review_state", "ignored");
  if (result.error) return { error: friendlyDbError(result.error, "bank_transactions.unignore") };
  if (result.count !== 1) return { error: "That transaction isn't dismissed any more." };

  revalidatePath("/expenses/transactions");
  revalidatePath("/expenses");
  return { error: null };
}

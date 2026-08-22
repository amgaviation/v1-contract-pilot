"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireEntitlement } from "@/lib/supabase/entitlements";
import { friendlyDbError } from "@/lib/db-errors";
import type { Database } from "@/lib/supabase/database.types";
import { MAX_BULK_TRANSACTIONS } from "./bulk-limit";

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

/**
 * The same window pilot.bank_transaction_duplicate_candidates defaults to
 * and transactions/page.tsx renders the queue's warnings from. Passed
 * explicitly below so the three cannot silently drift apart.
 */
const DUP_WINDOW_DAYS = 4;

type SupabaseClient = Awaited<ReturnType<typeof createClient>>;

export type ConfirmTransactionResult = { error: string | null };

/**
 * THE confirm-before-expense boundary. A bank_transactions row moves out
 * of 'unreviewed' — and a pilot.expenses row gets created — ONLY here,
 * and only from an explicit pilot action naming a category and
 * treatment. Nothing on the import path (../import/actions.ts) ever
 * calls this or writes to pilot.expenses at all.
 *
 * Both public confirm paths funnel through this one function: the
 * single-row `confirmTransaction` below, and `bulkConfirmTransactions`,
 * which is a LOOP over this — same validation, same sign rule, same
 * atomic claim, once per row. There is no second, looser confirm.
 * Everything the caller hands over is still a raw string here, because
 * the validation is part of the boundary and must not become something a
 * caller can skip by pre-parsing.
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
async function confirmOne(
  supabase: SupabaseClient,
  raw: { id: string; category: string; treatment: string; tripId: string; notes: string }
): Promise<ConfirmTransactionResult> {
  const id = raw.id;
  if (!UUID_RE.test(id)) return { error: "That transaction isn't recognized." };

  const category = raw.category;
  if (!(CATEGORIES as readonly string[]).includes(category)) {
    return { error: "Pick a category." };
  }
  const treatment = raw.treatment;
  if (!(TREATMENTS as readonly string[]).includes(treatment)) {
    return { error: "Pick what happens to this expense." };
  }
  const tripIdRaw = raw.tripId.trim();
  const tripId = tripIdRaw === "" ? null : tripIdRaw;
  if (tripId !== null && !UUID_RE.test(tripId)) return { error: "That trip isn't valid." };
  if (treatment === "rebill" && !tripId) {
    return { error: "Pick the trip this gets rebilled to. An expense can't be rebilled to nobody." };
  }
  const notes = raw.notes.trim().slice(0, 2000) || null;

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
    return { error: "This transaction is a deposit or refund, not an expense. Mark it dismissed instead." };
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
      return { error: null };
    }
    return { error: friendlyDbError(confirmed.error, "bank_transaction_confirm") };
  }

  return { error: null };
}

/** The single-row confirm: one pilot, one row, category and treatment named on the form. */
export async function confirmTransaction(formData: FormData): Promise<ConfirmTransactionResult> {
  // The account isn't destructured here: pilot.bank_transaction_confirm
  // derives it from the transaction's own row after checking
  // pilot.current_account_ids(), so an account id passed from here is a
  // value the database would have to distrust anyway. This call remains
  // the auth gate.
  await requireEntitlement("bank_import", "/expenses/transactions");

  const supabase = await createClient();
  const result = await confirmOne(supabase, {
    id: String(formData.get("id") ?? ""),
    category: String(formData.get("category") ?? ""),
    treatment: String(formData.get("treatment") ?? "unassigned"),
    tripId: String(formData.get("trip_id") ?? ""),
    notes: String(formData.get("notes") ?? ""),
  });
  if (result.error) return result;

  revalidatePath("/expenses");
  revalidatePath("/expenses/transactions");
  return { error: null };
}

export type IgnoreTransactionResult = { error: string | null };

/**
 * Marks a row as not-an-expense (a transfer, a duplicate the fingerprint
 * index missed because it's genuinely two real transactions, etc). Creates
 * nothing in pilot.expenses.
 *
 * As with confirmOne, this is the ONE dismissal path — the bulk variant
 * loops it rather than widening the `.in(...)` on a single UPDATE, so the
 * tenant filter, the `unreviewed` claim and the zero-row check are applied
 * per row and a row that lost its claim to another tab is reported as such
 * instead of vanishing into a count that came back one short.
 */
async function ignoreOne(
  supabase: SupabaseClient,
  accountId: string,
  id: string
): Promise<IgnoreTransactionResult> {
  if (!UUID_RE.test(id)) return { error: "That transaction isn't recognized." };

  const result = await supabase
    .from("bank_transactions")
    .update({ review_state: "ignored" } as never, { count: "exact" })
    .eq("id", id)
    .eq("account_id", accountId)
    .eq("review_state", "unreviewed");
  if (result.error) return { error: friendlyDbError(result.error, "bank_transactions.ignore") };
  if (result.count !== 1) return { error: "That transaction has already been reviewed." };

  return { error: null };
}

export async function ignoreTransaction(formData: FormData): Promise<IgnoreTransactionResult> {
  const { account } = await requireEntitlement("bank_import", "/expenses/transactions");
  const supabase = await createClient();
  const result = await ignoreOne(supabase, account.id, String(formData.get("id") ?? ""));
  if (result.error) return result;

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

/* ═══ UNATTENDED CONFIRMS ═══════════════════════════════════════════════
 *
 * A three-month statement is ~150 rows, and reviewing it one row at a time
 * — expand, category, treatment, confirm — is several hundred clicks. The
 * actions below take that down to one click a row, or a couple of passes
 * for the whole statement, WITHOUT opening a second, looser way into the
 * books.
 *
 * There are two of them and they are the SAME code: quickConfirmTransaction
 * is one id, bulkConfirmTransactions is a loop, and both go through
 * confirmSuggested → confirmOne. What makes them "unattended" is that
 * nobody is reading a duplicate warning at the moment they fire, and that
 * is the whole reason the rules below live server-side:
 *
 *   - the category is read FROM THE ROW, never accepted from the client.
 *     Their promise is "accept the suggestion you can see on the row", so
 *     the suggestion is the only thing they may act on; anything else is a
 *     Review, one row at a time, where the pilot names the category;
 *
 *   - a row with DUPLICATE CANDIDATES is refused, and a duplicate check
 *     that FAILED is refused too (a failed check is not "no duplicates" —
 *     the same rule page.tsx states for the queue-wide probe). The queue's
 *     own duplicate flags are a page-render snapshot: they can be stale by
 *     the time a button is clicked (a receipt filed in another tab), and
 *     they are empty both when there genuinely are none AND when the
 *     queue's probe failed. A client-side gate over that snapshot is an
 *     affordance, not a guarantee, and this is the surface that reaches a
 *     client's invoice — so the probe is re-run here, per row, against
 *     pilot.bank_transaction_duplicate_candidates;
 *
 *   - treatment is always 'deduct' with no trip. 'rebill' is unreachable
 *     from here by construction: it needs a trip, and it puts a line on
 *     someone else's invoice.
 *
 * NOT applied to confirmTransaction, deliberately. That is the expanded
 * Review path, where the candidates are on screen and the pilot has
 * already clicked "It's a different charge: record it anyway". Re-checking
 * there would refuse the exact decision the pilot just made.
 *
 * The bulk pair is additionally a LOOP over confirmSuggested / ignoreOne,
 * the same per-row functions the single-row actions call — same
 * entitlement gate, same validation, same atomic claim, same tenant
 * filter, once per row. Nothing is batched into one wide UPDATE, because a
 * wide UPDATE trades the per-row claim (and the per-row answer about which
 * rows it actually moved) for one number. And the ids come from the
 * pilot's own ticked checkboxes and nowhere else: neither action derives
 * its working set from a query, so there is no "dismiss every deposit"
 * here, only "dismiss these nineteen rows you are looking at".
 */

/**
 * Each row's own suggested_category, for rows still in the queue.
 * RLS-scoped like every other select on this page: an id belonging to
 * another tenant simply doesn't come back, and its absence from the map is
 * what confirmSuggested reports as no longer in the queue.
 */
async function readSuggestions(
  supabase: SupabaseClient,
  ids: string[]
): Promise<{ suggestedById: Map<string, string | null>; error: string | null }> {
  const suggestions = await supabase
    .from("bank_transactions")
    .select("id, suggested_category")
    .in("id", ids)
    .eq("review_state", "unreviewed");
  if (suggestions.error) {
    return {
      suggestedById: new Map(),
      error: friendlyDbError(suggestions.error, "bank_transactions.select(suggested)"),
    };
  }
  return {
    suggestedById: new Map(
      ((suggestions.data ?? []) as { id: string; suggested_category: string | null }[]).map((r) => [
        r.id,
        r.suggested_category,
      ])
    ),
    error: null,
  };
}

/**
 * ONE ROW, CONFIRMED AT ITS OWN SUGGESTION — the shared core of the
 * one-click button and the bulk pass. Every rule in the section header
 * that separates an unattended confirm from a Review lives here and only
 * here, so the two callers differ in nothing but how many ids they hand
 * over.
 */
async function confirmSuggested(
  supabase: SupabaseClient,
  id: string,
  suggestedById: Map<string, string | null>
): Promise<ConfirmTransactionResult> {
  if (!suggestedById.has(id)) {
    return { error: "That transaction isn't in the review queue any more." };
  }
  const suggested = suggestedById.get(id) ?? null;
  if (suggested === null) {
    return { error: "No suggested category for this one — open Review and pick one." };
  }

  // The duplicate gate. pilot.bank_transaction_duplicate_candidates is the
  // authoritative form of the same amount+date rule the queue draws its
  // warnings from, SECURITY INVOKER so it reads through RLS.
  const duplicates = await supabase.rpc("bank_transaction_duplicate_candidates", {
    p_transaction_id: id,
    p_day_window: DUP_WINDOW_DAYS,
  } as never);
  if (duplicates.error) {
    console.error("[db] bank_transaction_duplicate_candidates", duplicates.error.message);
    return {
      error: "We couldn't check this against what you've already filed. Open Review and confirm it yourself.",
    };
  }
  if (((duplicates.data ?? []) as unknown[]).length > 0) {
    return {
      error: "Possible duplicate — this looks like an expense you already recorded. Open Review to decide.",
    };
  }

  return confirmOne(supabase, {
    id,
    category: suggested,
    treatment: "deduct",
    tripId: "",
    notes: "",
  });
}

/**
 * The collapsed row's one-click confirm. Takes an id and nothing else —
 * the category is the row's own suggestion, read server-side, and the
 * duplicate probe is re-run before anything is written.
 */
export async function quickConfirmTransaction(formData: FormData): Promise<ConfirmTransactionResult> {
  await requireEntitlement("bank_import", "/expenses/transactions");
  const id = String(formData.get("id") ?? "");
  if (!UUID_RE.test(id)) return { error: "That transaction isn't recognized." };

  const supabase = await createClient();
  const { suggestedById, error } = await readSuggestions(supabase, [id]);
  if (error) return { error };

  const result = await confirmSuggested(supabase, id, suggestedById);
  if (result.error) return result;

  revalidatePath("/expenses");
  revalidatePath("/expenses/transactions");
  return { error: null };
}

export type BulkTransactionResult = {
  /** Set only when NOTHING was attempted — bad input, or more ids than one call takes. */
  error: string | null;
  /** Ids that left 'unreviewed'. */
  succeeded: string[];
  /** Per-row failures, in the same sentences the single-row actions return. */
  failures: { id: string; error: string }[];
};

const EMPTY_BULK: Omit<BulkTransactionResult, "error"> = { succeeded: [], failures: [] };

/**
 * Every id or nothing. One malformed id fails the whole call rather than
 * being skipped: a pilot who ticked twenty rows and got nineteen back with
 * no explanation is worse off than one who got an error. Duplicated ids
 * are collapsed — a repeated id in the payload must not mean two confirms
 * of one row.
 */
function readBulkIds(formData: FormData): { ids: string[]; error: string | null } {
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const value of formData.getAll("id")) {
    const id = String(value);
    if (!UUID_RE.test(id)) return { ids: [], error: "Those transactions aren't recognized." };
    if (seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  if (ids.length === 0) return { ids: [], error: "Pick at least one transaction first." };
  if (ids.length > MAX_BULK_TRANSACTIONS) {
    return { ids: [], error: `That's more than ${MAX_BULK_TRANSACTIONS} at once. Untick some and go again.` };
  }
  return { ids, error: null };
}

/** Dismisses the ticked rows, one conditional claim each. Creates nothing in pilot.expenses. */
export async function bulkIgnoreTransactions(formData: FormData): Promise<BulkTransactionResult> {
  const { account } = await requireEntitlement("bank_import", "/expenses/transactions");
  const { ids, error } = readBulkIds(formData);
  if (error) return { error, ...EMPTY_BULK };

  const supabase = await createClient();
  const succeeded: string[] = [];
  const failures: { id: string; error: string }[] = [];
  for (const id of ids) {
    const result = await ignoreOne(supabase, account.id, id);
    if (result.error) failures.push({ id, error: result.error });
    else succeeded.push(id);
  }

  if (succeeded.length > 0) {
    revalidatePath("/expenses/transactions");
    revalidatePath("/expenses");
  }
  return { error: null, succeeded, failures };
}

/**
 * The ticked rows, each confirmed at its own suggested category — the
 * self-funded case, which is the one a suggestion can stand in for. One
 * pass of the same per-row core the one-click button uses, so a row the
 * bulk pass refuses is refused for exactly the reason it would have been
 * refused on its own.
 */
export async function bulkConfirmTransactions(formData: FormData): Promise<BulkTransactionResult> {
  await requireEntitlement("bank_import", "/expenses/transactions");
  const { ids, error } = readBulkIds(formData);
  if (error) return { error, ...EMPTY_BULK };

  const supabase = await createClient();

  // One read for the whole pass; the per-row rules are confirmSuggested's,
  // identical to the ones the one-click button goes through.
  const { suggestedById, error: readError } = await readSuggestions(supabase, ids);
  if (readError) return { error: readError, ...EMPTY_BULK };

  const succeeded: string[] = [];
  const failures: { id: string; error: string }[] = [];
  for (const id of ids) {
    const result = await confirmSuggested(supabase, id, suggestedById);
    if (result.error) failures.push({ id, error: result.error });
    else succeeded.push(id);
  }

  if (succeeded.length > 0) {
    revalidatePath("/expenses");
    revalidatePath("/expenses/transactions");
  }
  return { error: null, succeeded, failures };
}

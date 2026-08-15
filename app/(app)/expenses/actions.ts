"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireAccount } from "@/lib/supabase/account";
import { parseDollarsToCents } from "@/lib/format";
import { friendlyDbError } from "@/lib/db-errors";
import { clientIdForStorage } from "@/lib/expense-client";
import type { Database } from "@/lib/supabase/database.types";

type ExpenseInsert = Database["pilot"]["Tables"]["expenses"]["Insert"];
type ExpenseUpdate = Database["pilot"]["Tables"]["expenses"]["Update"];
/** Everything the form writes except account_id, which comes from the session. */
type ExpenseFields = Omit<ExpenseInsert, "account_id">;

export type ExpenseFormState = {
  error: string | null;
  values?: Record<string, string>;
};

// NOT exported: a "use server" module may only export async functions —
// every other export would be treated as a server action. Constants that
// the client needs live in a plain module instead.
const RECEIPT_BUCKET = "receipts";

/** Mirrors the bucket's own limit, so the error is a sentence not a 413. */
const MAX_RECEIPT_BYTES = 10 * 1024 * 1024;
const RECEIPT_TYPES = [
  "image/jpeg",
  "image/png",
  "image/heic",
  // Same container and the same `ftyp` box as HEIC — some browsers report
  // an iPhone photo as one and some as the other. Accepting only "heic"
  // meant a pilot could pick a photo, scan it, fill in the whole form and
  // only then be told receipts must be a JPEG, PNG, HEIC, WebP or PDF.
  "image/heif",
  "image/webp",
  "application/pdf",
];

const CATEGORIES = [
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
] as const;

const TREATMENTS = ["rebill", "deduct", "unassigned"] as const;

const EXPENSE_FIELDS = [
  "incurred_on",
  "category",
  "vendor",
  "amount",
  "treatment",
  "trip_id",
  "client_id",
  "notes",
] as const;

function echo(formData: FormData) {
  const out: Record<string, string> = {};
  for (const field of EXPENSE_FIELDS) out[field] = String(formData.get(field) ?? "");
  return out;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function optional(formData: FormData, key: string): string | null {
  const value = String(formData.get(key) ?? "").trim();
  return value === "" ? null : value;
}

function optionalUuid(formData: FormData, key: string): string | null | undefined {
  const value = optional(formData, key);
  if (value === null) return null;
  return UUID_RE.test(value) ? value : undefined;
}

function isDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(value);
}

function oneOf<T extends readonly string[]>(
  formData: FormData,
  key: string,
  allowed: T,
  fallback: T[number]
): T[number] {
  const value = String(formData.get(key) ?? "");
  return (allowed as readonly string[]).includes(value)
    ? (value as T[number])
    : fallback;
}

function parseExpenseForm(formData: FormData): {
  values: ExpenseFields | null;
  error: string | null;
} {
  const incurredOn = String(formData.get("incurred_on") ?? "").trim();
  if (!incurredOn) return { values: null, error: "When was this spent?" };
  if (!isDate(incurredOn)) return { values: null, error: "That date isn't valid." };

  const amount = parseDollarsToCents(String(formData.get("amount") ?? ""));
  if (amount === undefined) {
    return { values: null, error: "Amount must be a number like 84 or 84.50." };
  }
  if (amount === null) return { values: null, error: "How much was it?" };
  if (amount < 0) return { values: null, error: "An expense can't be negative." };

  const tripId = optionalUuid(formData, "trip_id");
  if (tripId === undefined) return { values: null, error: "That trip isn't valid." };

  const clientId = optionalUuid(formData, "client_id");
  if (clientId === undefined) return { values: null, error: "That client isn't valid." };

  const treatment = oneOf(formData, "treatment", TREATMENTS, "unassigned");

  // The database enforces this too (`treatment <> 'rebill' or trip_id is
  // not null`), because the invoice arithmetic breaks silently if a
  // rebilled line has no trip to attach to. Catching it here is only so
  // the pilot gets a sentence instead of a constraint name.
  if (treatment === "rebill" && !tripId) {
    return {
      values: null,
      error: "Pick the trip this gets rebilled to. An expense can't be rebilled to nobody.",
    };
  }

  return {
    error: null,
    values: {
      incurred_on: incurredOn,
      category: oneOf(formData, "category", CATEGORIES, "other"),
      vendor: optional(formData, "vendor"),
      amount_cents: amount,
      treatment,
      trip_id: tripId,
      // A trip stores NULL here, not the trip's client. See
      // clientIdForStorage for the three things that depend on the column
      // meaning "attributed directly" and nothing else. The trip itself is
      // still checked (settleTripAndClient below) so a bad trip id is
      // caught rather than filed.
      client_id: clientIdForStorage(clientId, Boolean(tripId)),
      notes: optional(formData, "notes"),
    },
  };
}

/**
 * Checks the trip before the row is written.
 *
 * `client_id` is already null for anything with a trip (clientIdForStorage
 * decided that in parseExpenseForm), so there is no pair for the composite
 * FK to reject and nothing here corrects a value. What this does is refuse
 * a trip that is not the caller's: without it, a POST carrying another
 * account's trip id would be filed and only fail at the FK, reported as a
 * generic "that record is linked to something else". The read is RLS-scoped
 * like every other, so another account's trip simply returns no row.
 */
async function settleTripAndClient(
  supabase: Awaited<ReturnType<typeof createClient>>,
  accountId: string,
  values: ExpenseFields
): Promise<{ values: ExpenseFields | null; error: string | null }> {
  if (!values.trip_id) return { values, error: null };

  const { data, error } = await supabase
    .from("trips")
    .select("id")
    .eq("id", values.trip_id)
    .eq("account_id", accountId)
    .maybeSingle();

  if (error) return { values: null, error: friendlyDbError(error, "trips.select") };
  if (!data) return { values: null, error: "That trip no longer exists." };

  return { values: { ...values, client_id: null }, error: null };
}

/**
 * Checks the file's actual leading bytes against its declared type.
 *
 * WHY: `file.type` is whatever the browser said, and the bucket's
 * `allowed_mime_types` validates the same client-declared header — so
 * neither layer looks at the bytes. That is not a tenant-isolation hole
 * (Storage serves from a different origin than the app, so a mislabelled
 * HTML payload cannot reach app cookies), but it does mean arbitrary
 * content can sit in the bucket labelled `image/png`. Sniffing the magic
 * number closes the gap for the formats we accept.
 *
 * HEIC is checked loosely — it is an ISO-BMFF container whose brand
 * varies (`heic`, `heix`, `mif1`, …) — so this asserts the `ftyp` box
 * rather than enumerating brands and rejecting a valid photo.
 */
function looksLikeDeclaredType(bytes: Uint8Array, type: string): boolean {
  const startsWith = (...sig: number[]) =>
    sig.every((byte, index) => bytes[index] === byte);

  switch (type) {
    case "image/jpeg":
      return startsWith(0xff, 0xd8, 0xff);
    case "image/png":
      return startsWith(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
    case "application/pdf":
      return startsWith(0x25, 0x50, 0x44, 0x46); // %PDF
    case "image/webp":
      // "RIFF" .... "WEBP"
      return (
        startsWith(0x52, 0x49, 0x46, 0x46) &&
        [0x57, 0x45, 0x42, 0x50].every((byte, i) => bytes[8 + i] === byte)
      );
    case "image/heic":
    case "image/heif":
      // "ftyp" at offset 4. One case for both: they are the same ISOBMFF
      // container, and which of the two a browser reports for the same
      // iPhone photo is not something this app gets to decide.
      return [0x66, 0x74, 0x79, 0x70].every((byte, i) => bytes[4 + i] === byte);
    default:
      return false;
  }
}

/**
 * Uploads the receipt, if one was attached, and returns its object path.
 *
 * The path is `<account_id>/<expense_id>/<filename>` because the storage
 * policies key tenancy off the FIRST path segment — storage.objects has
 * no account_id column, so the name IS the tenant key. Getting this
 * shape wrong doesn't fail open (the policy would reject the write), it
 * just fails.
 */
async function uploadReceipt(
  supabase: Awaited<ReturnType<typeof createClient>>,
  accountId: string,
  expenseId: string,
  file: File
): Promise<{ path: string | null; error: string | null }> {
  if (file.size === 0) return { path: null, error: null };
  if (file.size > MAX_RECEIPT_BYTES) {
    return { path: null, error: "That receipt is larger than 10 MB." };
  }
  if (!RECEIPT_TYPES.includes(file.type)) {
    return { path: null, error: "Receipts can be a JPEG, PNG, HEIC, WebP or PDF." };
  }

  const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  if (!looksLikeDeclaredType(head, file.type)) {
    return {
      path: null,
      error: "That file doesn't look like the kind of file it claims to be.",
    };
  }

  // Strip anything path-like out of the browser-supplied name. The
  // storage API treats "/" as a separator, so an unsanitised filename
  // could push the object outside its expense folder.
  const safeName = file.name.replace(/[^\w.\-]+/g, "_").slice(-120) || "receipt";
  // A timestamp prefix (fixed after review) guarantees this upload can
  // never land on the SAME object key as whatever the expense already
  // points at, even when the pilot re-attaches a file with an identical
  // name. That used to matter because `upsert` overwrites an identical key
  // in place: replacing receipt.jpg with a new receipt.jpg rewrote the old
  // object's bytes before the caller had any row update, success or
  // failure, to react to. With a unique key, the old object is untouched
  // until the caller (updateExpense) has confirmed the row update that
  // will make it safe to remove.
  const path = `${accountId}/${expenseId}/${Date.now()}-${safeName}`;

  const { error } = await supabase.storage
    .from(RECEIPT_BUCKET)
    .upload(path, file, { upsert: true, contentType: file.type });

  if (error) {
    console.error("[storage] receipt upload", error.message);
    return { path: null, error: "Couldn't upload that receipt. Try again." };
  }

  return { path, error: null };
}

/**
 * Removes a receipt object, logging rather than surfacing failure — same
 * posture as deleteExpense's own storage cleanup below: the row-level
 * outcome (which the caller has already decided) is the thing worth
 * reporting to the pilot, not a lingering object in a private bucket.
 */
async function removeReceiptObject(
  supabase: Awaited<ReturnType<typeof createClient>>,
  path: string,
  context: string
): Promise<void> {
  const { error } = await supabase.storage.from(RECEIPT_BUCKET).remove([path]);
  if (error) {
    console.error(`[storage] ${context}`, error.message);
  }
}

export async function createExpense(
  _prev: ExpenseFormState,
  formData: FormData
): Promise<ExpenseFormState> {
  const { account } = await requireAccount("/expenses/new");
  const { values, error } = parseExpenseForm(formData);
  if (error || !values) {
    return { error: error ?? "Couldn't read that form.", values: echo(formData) };
  }

  const supabase = await createClient();
  const { values: filed, error: clientError } = await settleTripAndClient(
    supabase,
    account.id,
    values
  );
  if (clientError || !filed) {
    return { error: clientError ?? "Couldn't read that form.", values: echo(formData) };
  }

  const payload: ExpenseInsert = { ...filed, account_id: account.id };
  const { data, error: insertError } = await supabase
    .from("expenses")
    .insert(payload as never)
    .select("id")
    .single();

  if (insertError) {
    return {
      error: friendlyDbError(insertError, "expenses.insert"),
      values: echo(formData),
    };
  }

  const expenseId = (data as { id: string }).id;
  const file = formData.get("receipt");
  if (file instanceof File) {
    const { path, error: uploadError } = await uploadReceipt(
      supabase,
      account.id,
      expenseId,
      file
    );
    if (uploadError) {
      // The expense row is kept. Losing a correctly-entered expense
      // because its photo failed to upload would be the worse outcome —
      // the receipt can be attached again from the edit screen.
      revalidatePath("/expenses");
      return {
        error: `${uploadError} The expense was saved without it.`,
        values: echo(formData),
      };
    }
    if (path) {
      const { error: linkError, count: linkCount } = await supabase
        .from("expenses")
        .update({ receipt_path: path } satisfies ExpenseUpdate as never, {
          count: "exact",
        })
        .eq("id", expenseId)
        .eq("account_id", account.id);
      // The file is already in the bucket at this point. If the row
      // update fails or matches nothing, nothing points at that object —
      // orphaned in storage forever, and the pilot sees a receipt-less
      // expense despite having uploaded successfully. Match
      // updateExpense's own write below (and documents/actions.ts's
      // linkError/linkCount pattern): check both, and say so.
      if (linkError || !linkCount) {
        revalidatePath("/expenses");
        return {
          error: linkError
            ? `${friendlyDbError(linkError, "expenses.update")} The receipt uploaded but wasn't linked. Try attaching it again from the edit screen.`
            : "The expense was saved without the receipt link. Try attaching it again from the edit screen.",
          values: echo(formData),
        };
      }
    }
  }

  revalidatePath("/expenses");
  redirect("/expenses");
}

export async function updateExpense(
  _prev: ExpenseFormState,
  formData: FormData
): Promise<ExpenseFormState> {
  const id = String(formData.get("id") ?? "");
  if (!id || !UUID_RE.test(id)) return { error: "Missing expense id." };

  const { account } = await requireAccount(`/expenses/${id}`);
  const { values, error } = parseExpenseForm(formData);
  if (error || !values) {
    return { error: error ?? "Couldn't read that form.", values: echo(formData) };
  }

  const supabase = await createClient();

  const { values: filed, error: clientError } = await settleTripAndClient(
    supabase,
    account.id,
    values
  );
  if (clientError || !filed) {
    return { error: clientError ?? "Couldn't read that form.", values: echo(formData) };
  }

  // AUTHORIZE BEFORE TOUCHING STORAGE. Uploading first would let a POST
  // carrying any id write an object into the caller's own folder that no
  // expense row will ever reference — an unbounded storage-write
  // primitive that deleteExpense can never reclaim, since nothing points
  // at it. Reading the row first also lets the replaced receipt be
  // cleaned up and turns a zero-row update into an honest error instead
  // of a redirect that looks like success.
  const { data: existing, error: readError } = await supabase
    .from("expenses")
    .select("receipt_path")
    .eq("id", id)
    .eq("account_id", account.id)
    .maybeSingle();

  if (readError) {
    return {
      error: friendlyDbError(readError, "expenses.select"),
      values: echo(formData),
    };
  }
  if (!existing) return { error: "That expense no longer exists." };

  const previousPath = (existing as { receipt_path: string | null }).receipt_path;

  const file = formData.get("receipt");
  let receiptPath: string | null = null;
  if (file instanceof File && file.size > 0) {
    const { path, error: uploadError } = await uploadReceipt(supabase, account.id, id, file);
    if (uploadError) return { error: uploadError, values: echo(formData) };
    receiptPath = path;
  }

  // account_id filter is defence in depth, not the boundary — RLS is.
  // See the note in clients/actions.ts.
  const payload: ExpenseUpdate = receiptPath
    ? { ...filed, receipt_path: receiptPath }
    : filed;
  const { error: updateError, count } = await supabase
    .from("expenses")
    .update(payload as never, { count: "exact" })
    .eq("id", id)
    .eq("account_id", account.id);

  // The replacement (if any) was uploaded under a key that can never
  // collide with `previousPath` — see uploadReceipt — so the OLD object is
  // still exactly what it was before this request, no matter what happens
  // to the row update. That matters because this update has real,
  // reachable failure paths: expenses_protect_billed_trip on a billed
  // rebill expense, the invoice_lines composite FK on an invoiced
  // expense's treatment change, a concurrent delete (count === 0). On any
  // of those the row still points at the OLD receipt — which, unlike
  // before this fix, still exists — instead of "View receipt" failing
  // forever for a rebilled, invoiced expense's audit evidence. The just
  // uploaded object is the one cleaned up instead, since nothing will ever
  // point at it.
  if (updateError || count === 0) {
    if (receiptPath) {
      await removeReceiptObject(supabase, receiptPath, "orphaned receipt remove after failed update");
    }
    if (updateError) {
      return {
        error: friendlyDbError(updateError, "expenses.update"),
        values: echo(formData),
      };
    }
    // PostgREST returns 200 with no error for a write that matched
    // nothing, so "no error" is not "it saved".
    return { error: "That expense no longer exists.", values: echo(formData) };
  }

  // Only now — with the row durably pointing at the new object — is the
  // previous one safe to remove. `upsert` only overwrote in place when the
  // sanitised filename was byte-identical, so a stale previous object
  // would otherwise sit there, still readable to anyone in the account,
  // billing storage forever.
  if (receiptPath && previousPath && previousPath !== receiptPath) {
    await removeReceiptObject(supabase, previousPath, "replaced receipt remove");
  }

  revalidatePath("/expenses");
  revalidatePath(`/expenses/${id}`);
  redirect("/expenses");
}

export async function deleteExpense(
  id: string
): Promise<{ error: string | null }> {
  const { account } = await requireAccount("/expenses");

  const supabase = await createClient();

  // Read the path before deleting the row — afterwards there is nothing
  // left pointing at the object, and it would sit in the bucket forever
  // billing storage for a receipt nobody can reach.
  const { data } = await supabase
    .from("expenses")
    .select("receipt_path")
    .eq("id", id)
    .eq("account_id", account.id)
    .maybeSingle();

  const { error, count } = await supabase
    .from("expenses")
    .delete({ count: "exact" })
    .eq("id", id)
    .eq("account_id", account.id);

  if (error) return { error: friendlyDbError(error, "expenses.delete") };
  // Zero rows matched: the row is not the caller's, or is already gone.
  // Reporting success here would be a lie, and would also send the
  // storage remove below after a path we never owned.
  if (count === 0) return { error: "That expense no longer exists." };

  const path = (data as { receipt_path: string | null } | null)?.receipt_path;
  if (path) {
    const { error: removeError } = await supabase.storage
      .from(RECEIPT_BUCKET)
      .remove([path]);
    // Deliberately not surfaced: the expense IS gone, which is what was
    // asked for. An orphaned object is a cleanup problem, not a failure
    // to report back to the pilot.
    if (removeError) {
      console.error("[storage] receipt remove", removeError.message);
    }
  }

  revalidatePath("/expenses");
  return { error: null };
}

/**
 * Assigns an unassigned receipt to a trip and sets how it's treated —
 * the one action the unassigned queue exists to make fast. Rebill
 * requires a trip for the same reason the form does.
 */
export async function fileExpense(
  id: string,
  tripId: string,
  treatment: "rebill" | "deduct"
): Promise<{ error: string | null }> {
  const { account } = await requireAccount("/expenses");

  if (treatment === "rebill" && !UUID_RE.test(tripId)) {
    return { error: "Pick the trip this gets rebilled to." };
  }

  const supabase = await createClient();
  const filedTripId = UUID_RE.test(tripId) ? tripId : null;
  const payload: ExpenseUpdate = { trip_id: filedTripId, treatment };

  // Filing onto a trip clears client_id, the same rule the form follows
  // (clientIdForStorage): with a trip, the client is derived, never stored.
  // Clearing is required rather than tidy -- a receipt already attributed
  // to client A, filed onto client B's trip, is the exact pair the
  // composite FK refuses, so leaving the old value would fail the queue's
  // two-click fix on precisely the receipts a pilot had taken the trouble
  // to attribute. The trip is read first so an unknown one is reported as
  // itself instead of as a foreign key error.
  //
  // Filing with NO trip leaves client_id alone. "This receipt is client
  // A's" is something the pilot said on purpose; deciding to deduct it
  // rather than rebill it is not a retraction of that.
  if (filedTripId) {
    const { data: trip, error: tripError } = await supabase
      .from("trips")
      .select("id")
      .eq("id", filedTripId)
      .eq("account_id", account.id)
      .maybeSingle();
    if (tripError) return { error: friendlyDbError(tripError, "trips.select") };
    if (!trip) return { error: "That trip no longer exists." };
    payload.client_id = null;
  }

  const { error, count } = await supabase
    .from("expenses")
    .update(payload as never, { count: "exact" })
    .eq("id", id)
    .eq("account_id", account.id);

  if (error) return { error: friendlyDbError(error, "expenses.file") };
  if (count === 0) return { error: "That expense no longer exists." };

  revalidatePath("/expenses");
  return { error: null };
}

/**
 * A short-lived signed URL for a private receipt. Generated per view
 * rather than stored, so a URL that leaks into a log or a shared screen
 * stops working shortly afterwards.
 */
export async function receiptUrl(path: string): Promise<string | null> {
  const { account } = await requireAccount("/expenses");

  // Defence in depth, NOT the boundary — the receipts_select storage
  // policy is, and it refuses to sign an object outside the caller's
  // folder. But this endpoint takes an arbitrary string from a public
  // POST, and unlike every table path here it had no application-level
  // check at all: a single dropped or widened policy would have turned it
  // into a cross-tenant read of every receipt in the product. Two
  // controls cost one line.
  if (!path.startsWith(`${account.id}/`)) return null;

  const supabase = await createClient();
  const { data, error } = await supabase.storage
    .from(RECEIPT_BUCKET)
    .createSignedUrl(path, 60);
  if (error) {
    console.error("[storage] signed url", error.message);
    return null;
  }
  return data?.signedUrl ?? null;
}

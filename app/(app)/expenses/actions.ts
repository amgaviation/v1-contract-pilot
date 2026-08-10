"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireAccount } from "@/lib/supabase/account";
import { parseDollarsToCents } from "@/lib/format";
import { friendlyDbError } from "@/lib/db-errors";
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

  const treatment = oneOf(formData, "treatment", TREATMENTS, "unassigned");

  // The database enforces this too (`treatment <> 'rebill' or trip_id is
  // not null`), because the invoice arithmetic breaks silently if a
  // rebilled line has no trip to attach to. Catching it here is only so
  // the pilot gets a sentence instead of a constraint name.
  if (treatment === "rebill" && !tripId) {
    return {
      values: null,
      error: "Pick the trip this gets rebilled to — an expense can't be rebilled to nobody.",
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
      notes: optional(formData, "notes"),
    },
  };
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
  file: File,
  /** The object this one replaces, removed once the new one is in place. */
  previousPath?: string | null
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
  const path = `${accountId}/${expenseId}/${safeName}`;

  const { error } = await supabase.storage
    .from(RECEIPT_BUCKET)
    .upload(path, file, { upsert: true, contentType: file.type });

  if (error) {
    console.error("[storage] receipt upload", error.message);
    return { path: null, error: "Couldn't upload that receipt. Try again." };
  }

  // `upsert` only overwrites when the sanitised filename is byte-identical,
  // so attaching b.jpg over a.jpg repoints the row and strands a.jpg —
  // still readable to anyone in the account, and billing storage forever.
  // Removed only AFTER the replacement is safely written, so a failed
  // upload never destroys the receipt the pilot already had.
  if (previousPath && previousPath !== path) {
    const { error: removeError } = await supabase.storage
      .from(RECEIPT_BUCKET)
      .remove([previousPath]);
    if (removeError) {
      console.error("[storage] replaced receipt remove", removeError.message);
    }
  }

  return { path, error: null };
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
  const payload: ExpenseInsert = { ...values, account_id: account.id };
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
            ? `${friendlyDbError(linkError, "expenses.update")} The receipt uploaded but wasn't linked — try attaching it again from the edit screen.`
            : "The expense was saved without the receipt link — try attaching it again from the edit screen.",
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
    const { path, error: uploadError } = await uploadReceipt(
      supabase,
      account.id,
      id,
      file,
      previousPath
    );
    if (uploadError) return { error: uploadError, values: echo(formData) };
    receiptPath = path;
  }

  // account_id filter is defence in depth, not the boundary — RLS is.
  // See the note in clients/actions.ts.
  const payload: ExpenseUpdate = receiptPath
    ? { ...values, receipt_path: receiptPath }
    : values;
  const { error: updateError, count } = await supabase
    .from("expenses")
    .update(payload as never, { count: "exact" })
    .eq("id", id)
    .eq("account_id", account.id);

  if (updateError) {
    return {
      error: friendlyDbError(updateError, "expenses.update"),
      values: echo(formData),
    };
  }
  // PostgREST returns 200 with no error for a write that matched nothing,
  // so "no error" is not "it saved".
  if (count === 0) {
    return { error: "That expense no longer exists.", values: echo(formData) };
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
  const payload: ExpenseUpdate = {
    trip_id: UUID_RE.test(tripId) ? tripId : null,
    treatment,
  };
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

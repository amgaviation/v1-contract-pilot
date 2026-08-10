"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireAccount } from "@/lib/supabase/account";
import { friendlyDbError } from "@/lib/db-errors";
import { DOCUMENT_KINDS } from "./kinds";
import type { Database } from "@/lib/supabase/database.types";

type DocumentInsert = Database["pilot"]["Tables"]["documents"]["Insert"];
type DocumentUpdate = Database["pilot"]["Tables"]["documents"]["Update"];
/** Everything the form writes except account_id, which comes from the session. */
type DocumentFields = Omit<DocumentInsert, "account_id">;

export type DocumentFormState = {
  error: string | null;
  values?: Record<string, string>;
};

// NOT exported: a "use server" module may only export async functions —
// every other export would be treated as a server action. Constants that
// the client needs live in a plain module instead (see kinds.ts).
//
// This screen reuses the SAME private `receipts` bucket the expenses
// surface already uses, rather than standing up a second bucket. The
// bucket's storage policies key tenancy off the first path segment of the
// object name (account_id), not off any bucket-specific rule, so they are
// already generic over what kind of file lives underneath — a medical
// certificate scan is just another object whose first path segment is the
// caller's account_id. A second bucket would mean a second set of storage
// policies to keep in sync with zero behavioural difference.
const DOCUMENT_BUCKET = "receipts";

/** Mirrors the bucket's own limit, so the error is a sentence not a 413. */
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const FILE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/heic",
  "image/webp",
  "application/pdf",
];

/**
 * DERIVED, not retyped. This was a hand-copied array and it had fallen a
 * value behind ./kinds.ts: "pic_proficiency_check" was missing, so a pilot
 * who picked "PIC proficiency check (61.58)" had it silently rewritten to
 * "other" by oneOf()'s fallback — no error, no hint, and the document then
 * sat in the wrong bucket on the expirations board 61.58 is the whole
 * reason for.
 *
 * ./kinds.ts is a plain module (no "use server"), so importing it here is
 * safe, and deriving is the only version of "keep these in lockstep" that
 * survives the next kind being added.
 */
const KINDS = DOCUMENT_KINDS.map((k) => k.value);

const DOCUMENT_FIELDS = [
  "kind",
  "label",
  "issued_on",
  "expires_on",
  "client_id",
  "notes",
] as const;

function echo(formData: FormData) {
  const out: Record<string, string> = {};
  for (const field of DOCUMENT_FIELDS) out[field] = String(formData.get(field) ?? "");
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

function optionalDate(formData: FormData, key: string): string | null | undefined {
  const value = optional(formData, key);
  if (value === null) return null;
  return isDate(value) ? value : undefined;
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

function parseDocumentForm(formData: FormData): {
  values: DocumentFields | null;
  error: string | null;
} {
  const label = String(formData.get("label") ?? "").trim();
  if (!label) return { values: null, error: "Give this document a label." };

  const issuedOn = optionalDate(formData, "issued_on");
  if (issuedOn === undefined) return { values: null, error: "That issue date isn't valid." };

  const expiresOn = optionalDate(formData, "expires_on");
  if (expiresOn === undefined) return { values: null, error: "That expiration date isn't valid." };

  // The database also enforces this (`issued_on is null or expires_on is
  // null or expires_on >= issued_on`); catching it here turns a constraint
  // name into a sentence instead.
  if (issuedOn && expiresOn && expiresOn < issuedOn) {
    return { values: null, error: "The expiration date is before the issue date." };
  }

  const clientId = optionalUuid(formData, "client_id");
  if (clientId === undefined) return { values: null, error: "That client isn't valid." };

  return {
    error: null,
    values: {
      kind: oneOf(formData, "kind", KINDS, "other"),
      label,
      issued_on: issuedOn,
      expires_on: expiresOn,
      client_id: clientId,
      notes: optional(formData, "notes"),
    },
  };
}

/**
 * Checks the file's actual leading bytes against its declared type.
 *
 * Same rationale as expenses/actions.ts: `file.type` and the bucket's
 * `allowed_mime_types` both trust the browser-declared Content-Type, so
 * neither layer looks at the bytes. Sniffing the magic number closes that
 * gap for the formats accepted here.
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
      // "ftyp" at offset 4.
      return [0x66, 0x74, 0x79, 0x70].every((byte, i) => bytes[4 + i] === byte);
    default:
      return false;
  }
}

/**
 * Uploads the scan/photo, if one was attached, and returns its object
 * path.
 *
 * The path is `<account_id>/<document_id>/<filename>` — identical shape to
 * expenses/actions.ts's `uploadReceipt` — because the storage policies key
 * tenancy off the FIRST path segment (storage.objects has no account_id
 * column). Getting this shape wrong doesn't fail open, it just fails.
 */
async function uploadDocumentFile(
  supabase: Awaited<ReturnType<typeof createClient>>,
  accountId: string,
  documentId: string,
  file: File,
  /** The object this one replaces, removed once the new one is in place. */
  previousPath?: string | null
): Promise<{ path: string | null; error: string | null }> {
  if (file.size === 0) return { path: null, error: null };
  if (file.size > MAX_FILE_BYTES) {
    return { path: null, error: "That file is larger than 10 MB." };
  }
  if (!FILE_TYPES.includes(file.type)) {
    return { path: null, error: "Files can be a JPEG, PNG, HEIC, WebP or PDF." };
  }

  const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  if (!looksLikeDeclaredType(head, file.type)) {
    return {
      path: null,
      error: "That file doesn't look like the kind of file it claims to be.",
    };
  }

  // Strip anything path-like out of the browser-supplied name — "/" is a
  // separator in the storage API, so an unsanitised filename could push
  // the object outside its document folder.
  const safeName = file.name.replace(/[^\w.\-]+/g, "_").slice(-120) || "document";
  const path = `${accountId}/${documentId}/${safeName}`;

  const { error } = await supabase.storage
    .from(DOCUMENT_BUCKET)
    .upload(path, file, { upsert: true, contentType: file.type });

  if (error) {
    console.error("[storage] document upload", error.message);
    return { path: null, error: "Couldn't upload that file. Try again." };
  }

  // `upsert` only overwrites when the sanitised filename is byte-identical,
  // so replacing a.pdf with b.pdf repoints the row and strands a.pdf.
  // Removed only AFTER the replacement is safely written, so a failed
  // upload never destroys the file the pilot already had.
  if (previousPath && previousPath !== path) {
    const { error: removeError } = await supabase.storage
      .from(DOCUMENT_BUCKET)
      .remove([previousPath]);
    if (removeError) {
      console.error("[storage] replaced document remove", removeError.message);
    }
  }

  return { path, error: null };
}

export async function createDocument(
  _prev: DocumentFormState,
  formData: FormData
): Promise<DocumentFormState> {
  const { account } = await requireAccount("/documents/new");
  const { values, error } = parseDocumentForm(formData);
  if (error || !values) {
    return { error: error ?? "Couldn't read that form.", values: echo(formData) };
  }

  const supabase = await createClient();
  const payload: DocumentInsert = { ...values, account_id: account.id };
  const { data, error: insertError } = await supabase
    .from("documents")
    .insert(payload as never)
    .select("id")
    .single();

  if (insertError) {
    return {
      error: friendlyDbError(insertError, "documents.insert"),
      values: echo(formData),
    };
  }

  const documentId = (data as { id: string }).id;
  const file = formData.get("file");
  if (file instanceof File) {
    const { path, error: uploadError } = await uploadDocumentFile(
      supabase,
      account.id,
      documentId,
      file
    );
    if (uploadError) {
      // The document row is kept — losing a correctly-entered document
      // because its scan failed to upload would be the worse outcome. It
      // can be attached again from the edit screen.
      revalidatePath("/documents");
      return {
        error: `${uploadError} The document was saved without it.`,
        values: echo(formData),
      };
    }
    if (path) {
      // Checked the same way updateDocument checks its write — an
      // unreported failure here leaves the scan sitting in the bucket
      // with no row pointing at it, while createDocument still redirects
      // as if everything saved.
      const { error: linkError, count: linkCount } = await supabase
        .from("documents")
        .update({ file_path: path } satisfies DocumentUpdate as never, { count: "exact" })
        .eq("id", documentId)
        .eq("account_id", account.id);
      if (linkError || !linkCount) {
        revalidatePath("/documents");
        return {
          error: `${
            linkError
              ? friendlyDbError(linkError, "documents.update")
              : "Couldn't attach the uploaded file to the document."
          } The document was saved without it.`,
          values: echo(formData),
        };
      }
    }
  }

  revalidatePath("/documents");
  redirect("/documents");
}

export async function updateDocument(
  _prev: DocumentFormState,
  formData: FormData
): Promise<DocumentFormState> {
  const id = String(formData.get("id") ?? "");
  if (!id || !UUID_RE.test(id)) return { error: "Missing document id." };

  const { account } = await requireAccount(`/documents/${id}`);
  const { values, error } = parseDocumentForm(formData);
  if (error || !values) {
    return { error: error ?? "Couldn't read that form.", values: echo(formData) };
  }

  const supabase = await createClient();

  // AUTHORIZE BEFORE TOUCHING STORAGE — same reasoning as
  // expenses/actions.ts's updateExpense: uploading first would let a POST
  // carrying any id write into the caller's own folder with no row ever
  // referencing it, and reading first turns a zero-row update into an
  // honest error instead of a redirect that looks like success.
  const { data: existing, error: readError } = await supabase
    .from("documents")
    .select("file_path")
    .eq("id", id)
    .eq("account_id", account.id)
    .maybeSingle();

  if (readError) {
    return {
      error: friendlyDbError(readError, "documents.select"),
      values: echo(formData),
    };
  }
  if (!existing) return { error: "That document no longer exists." };

  const previousPath = (existing as { file_path: string | null }).file_path;

  const file = formData.get("file");
  let filePath: string | null = null;
  if (file instanceof File && file.size > 0) {
    const { path, error: uploadError } = await uploadDocumentFile(
      supabase,
      account.id,
      id,
      file,
      previousPath
    );
    if (uploadError) return { error: uploadError, values: echo(formData) };
    filePath = path;
  }

  // account_id filter is defence in depth, not the boundary — RLS is.
  const payload: DocumentUpdate = filePath
    ? { ...values, file_path: filePath }
    : values;
  const { error: updateError, count } = await supabase
    .from("documents")
    .update(payload as never, { count: "exact" })
    .eq("id", id)
    .eq("account_id", account.id);

  if (updateError) {
    return {
      error: friendlyDbError(updateError, "documents.update"),
      values: echo(formData),
    };
  }
  // PostgREST returns 200 with no error for a write that matched nothing,
  // so "no error" is not "it saved".
  if (count === 0) {
    return { error: "That document no longer exists.", values: echo(formData) };
  }

  revalidatePath("/documents");
  revalidatePath(`/documents/${id}`);
  redirect("/documents");
}

export async function deleteDocument(
  id: string
): Promise<{ error: string | null }> {
  // Validated the same way updateDocument validates its id — an
  // unvalidated string reaches Postgres as a malformed uuid, which
  // surfaces as a raw 22P02 error instead of an honest "not found".
  if (!UUID_RE.test(id)) return { error: "That document no longer exists." };

  const { account } = await requireAccount("/documents");

  const supabase = await createClient();

  // Read the path before deleting the row — afterwards nothing points at
  // the object, and it would sit in the bucket forever billing storage for
  // a file nobody can reach.
  const { data } = await supabase
    .from("documents")
    .select("file_path")
    .eq("id", id)
    .eq("account_id", account.id)
    .maybeSingle();

  const { error, count } = await supabase
    .from("documents")
    .delete({ count: "exact" })
    .eq("id", id)
    .eq("account_id", account.id);

  if (error) return { error: friendlyDbError(error, "documents.delete") };
  // Zero rows matched: the row is not the caller's, or is already gone.
  if (count === 0) return { error: "That document no longer exists." };

  const path = (data as { file_path: string | null } | null)?.file_path;
  if (path) {
    const { error: removeError } = await supabase.storage
      .from(DOCUMENT_BUCKET)
      .remove([path]);
    // Deliberately not surfaced: the document row IS gone, which is what
    // was asked for. An orphaned object is a cleanup problem, not a
    // failure to report back to the pilot.
    if (removeError) {
      console.error("[storage] document remove", removeError.message);
    }
  }

  revalidatePath("/documents");
  return { error: null };
}

/**
 * A short-lived signed URL for a private document scan. Generated per
 * view rather than stored, so a URL that leaks into a log or a shared
 * screen stops working shortly afterwards.
 */
export async function documentUrl(path: string): Promise<string | null> {
  const { account } = await requireAccount("/documents");

  // Defence in depth, NOT the boundary — the receipts_select storage
  // policy is, and it refuses to sign an object outside the caller's
  // folder. But this endpoint takes an arbitrary string from a public
  // POST, so a single dropped or widened policy would otherwise turn it
  // into a cross-tenant read of every document in the product.
  if (!path.startsWith(`${account.id}/`)) return null;

  const supabase = await createClient();
  const { data, error } = await supabase.storage
    .from(DOCUMENT_BUCKET)
    .createSignedUrl(path, 60);
  if (error) {
    console.error("[storage] signed url", error.message);
    return null;
  }
  return data?.signedUrl ?? null;
}

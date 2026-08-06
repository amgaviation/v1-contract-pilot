"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireAccount } from "@/lib/supabase/account";
import { friendlyDbError } from "@/lib/db-errors";
import type { Database } from "@/lib/supabase/database.types";

type AccountUpdate = Database["pilot"]["Tables"]["accounts"]["Update"];

export type SettingsFormState = {
  error: string | null;
  saved?: boolean;
  values?: Record<string, string>;
};

/**
 * Reuses the existing private `receipts` bucket rather than minting a
 * second one. Its four RLS policies are generic over the FIRST path
 * segment (`<account_id>/...`) checked against pilot.current_account_ids(),
 * so they already scope any object correctly regardless of what it holds.
 * A second bucket would mean a second set of policies to keep in step with
 * the first — a copy of a security control is a control that drifts.
 */
const BUCKET = "receipts";
const LOGO_PREFIX = "branding";

/** Deliberately smaller than a receipt: this is a letterhead mark. */
const MAX_LOGO_BYTES = 2 * 1024 * 1024;

/**
 * PNG and JPEG only. Not SVG — an SVG is an executable document, and
 * although Storage serves from a different origin than the app, react-pdf
 * cannot render one anyway. Not PDF or HEIC for the same rendering reason.
 */
const LOGO_TYPES = ["image/png", "image/jpeg"];

const SETTINGS_FIELDS = [
  "legal_name",
  "address_line1",
  "address_line2",
  "city",
  "state",
  "postal_code",
  "country",
  "invoice_prefix",
] as const;

function echo(formData: FormData) {
  const out: Record<string, string> = {};
  for (const field of SETTINGS_FIELDS) out[field] = String(formData.get(field) ?? "");
  return out;
}

function optional(formData: FormData, key: string): string | null {
  const value = String(formData.get(key) ?? "").trim();
  return value === "" ? null : value;
}

/** Same magic-number discipline as receipts — see expenses/actions.ts. */
function looksLikeDeclaredType(bytes: Uint8Array, type: string): boolean {
  const startsWith = (...sig: number[]) =>
    sig.every((byte, index) => bytes[index] === byte);
  switch (type) {
    case "image/png":
      return startsWith(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
    case "image/jpeg":
      return startsWith(0xff, 0xd8, 0xff);
    default:
      return false;
  }
}

export async function updateSettings(
  _prev: SettingsFormState,
  formData: FormData
): Promise<SettingsFormState> {
  const { account, role } = await requireAccount("/settings");

  // Business identity prints on every invoice, so it is an owner's call.
  // This check is for the MESSAGE, not the boundary: the `accounts_update`
  // policy is `pilot.is_account_owner(id)` on both USING and WITH CHECK,
  // so a non-owner's write matches zero rows at the database no matter
  // what this function does. Returning a sentence beats a silent no-op.
  if (role !== "owner") {
    return { error: "Only the account owner can change business details." };
  }

  const legalName = String(formData.get("legal_name") ?? "").trim();
  if (!legalName) {
    return {
      error: "Your business name prints on every invoice — it can't be blank.",
      values: echo(formData),
    };
  }

  // The invoice prefix is baked into already-issued invoice numbers by
  // pilot.next_invoice_number(). Changing it does NOT rewrite history —
  // past invoices keep the number they were issued under — but it does
  // mean a pilot's numbering changes series mid-stream, which an
  // accountant will ask about. Constrained to a short, uppercase,
  // alphanumeric token so it cannot become something that reads as part
  // of the number itself.
  const prefixRaw = String(formData.get("invoice_prefix") ?? "").trim().toUpperCase();
  const prefix = prefixRaw === "" ? "INV" : prefixRaw;
  if (!/^[A-Z0-9]{1,8}$/.test(prefix)) {
    return {
      error: "Invoice prefix must be 1–8 letters or digits, such as INV.",
      values: echo(formData),
    };
  }

  const supabase = await createClient();

  const payload: AccountUpdate = {
    legal_name: legalName,
    address_line1: optional(formData, "address_line1"),
    address_line2: optional(formData, "address_line2"),
    city: optional(formData, "city"),
    state: optional(formData, "state"),
    postal_code: optional(formData, "postal_code"),
    country: optional(formData, "country"),
    invoice_prefix: prefix,
  };

  // No billing column appears above, and none may: `plan`, `status`,
  // `seat_count`, `trial_ends_at`, the Stripe ids and `connect_account_id`
  // are withheld from the authenticated UPDATE grant AND blocked by the
  // accounts_protect_billing_columns trigger. The account_id filter is
  // defence in depth; RLS is the boundary.
  const { error, count } = await supabase
    .from("accounts")
    .update(payload as never, { count: "exact" })
    .eq("id", account.id);

  if (error) {
    return { error: friendlyDbError(error, "accounts.update"), values: echo(formData) };
  }
  // PostgREST returns 200 with no error for a write that matched nothing.
  if (count === 0) {
    return { error: "Couldn't save those details.", values: echo(formData) };
  }

  revalidatePath("/settings");
  // The account name is rendered in the app chrome, so the whole shell
  // needs to pick up a rename.
  revalidatePath("/", "layout");
  return { error: null, saved: true };
}

export async function uploadLogo(
  _prev: SettingsFormState,
  formData: FormData
): Promise<SettingsFormState> {
  const { account, role } = await requireAccount("/settings");
  if (role !== "owner") {
    return { error: "Only the account owner can change the logo." };
  }

  const file = formData.get("logo");
  if (!(file instanceof File) || file.size === 0) {
    return { error: "Choose an image first." };
  }
  if (file.size > MAX_LOGO_BYTES) {
    return { error: "That image is larger than 2 MB." };
  }
  if (!LOGO_TYPES.includes(file.type)) {
    return { error: "The logo has to be a PNG or JPEG." };
  }

  const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  if (!looksLikeDeclaredType(head, file.type)) {
    return { error: "That file doesn't look like the kind of image it claims to be." };
  }

  const supabase = await createClient();

  // <account_id>/branding/logo.<ext> — the account id must stay the FIRST
  // segment because that is what the storage policies check.
  const extension = file.type === "image/png" ? "png" : "jpg";
  const path = `${account.id}/${LOGO_PREFIX}/logo.${extension}`;

  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(path, file, { upsert: true, contentType: file.type });

  if (uploadError) {
    console.error("[storage] logo upload", uploadError.message);
    return { error: "Couldn't upload that image. Try again." };
  }

  // A fixed filename per extension means re-uploading the same format
  // overwrites in place. Switching format leaves the other one behind, so
  // remove it explicitly — otherwise a PNG→JPEG swap strands the PNG.
  const stale = `${account.id}/${LOGO_PREFIX}/logo.${extension === "png" ? "jpg" : "png"}`;
  await supabase.storage.from(BUCKET).remove([stale]);

  const { error, count } = await supabase
    .from("accounts")
    .update({ logo_url: path } satisfies AccountUpdate as never, { count: "exact" })
    .eq("id", account.id);

  if (error) return { error: friendlyDbError(error, "accounts.logo") };
  if (count === 0) return { error: "Couldn't save the logo." };

  revalidatePath("/settings");
  return { error: null, saved: true };
}

export async function removeLogo(): Promise<{ error: string | null }> {
  const { account, role } = await requireAccount("/settings");
  if (role !== "owner") {
    return { error: "Only the account owner can change the logo." };
  }

  const supabase = await createClient();

  // Read the path before clearing the column, or the object is orphaned
  // with nothing left pointing at it.
  const { data } = await supabase
    .from("accounts")
    .select("logo_url")
    .eq("id", account.id)
    .maybeSingle();

  const { error, count } = await supabase
    .from("accounts")
    .update({ logo_url: null } satisfies AccountUpdate as never, { count: "exact" })
    .eq("id", account.id);

  if (error) return { error: friendlyDbError(error, "accounts.logo") };
  if (count === 0) return { error: "Couldn't remove the logo." };

  const path = (data as { logo_url: string | null } | null)?.logo_url;
  if (path) {
    const { error: removeError } = await supabase.storage.from(BUCKET).remove([path]);
    // Not surfaced: the logo IS off the invoice, which is what was asked.
    if (removeError) console.error("[storage] logo remove", removeError.message);
  }

  revalidatePath("/settings");
  return { error: null };
}

/**
 * A short-lived signed URL for the logo, minted on demand — same reasoning
 * as receipts: a signed URL is a bearer token in a query string and must
 * not be baked into a rendered page.
 */
export async function logoPreviewUrl(): Promise<string | null> {
  const { account } = await requireAccount("/settings");
  const supabase = await createClient();

  const { data } = await supabase
    .from("accounts")
    .select("logo_url")
    .eq("id", account.id)
    .maybeSingle();

  const path = (data as { logo_url: string | null } | null)?.logo_url;
  if (!path) return null;
  if (!path.startsWith(`${account.id}/`)) return null;

  const { data: signed, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(path, 60);
  if (error) {
    console.error("[storage] logo signed url", error.message);
    return null;
  }
  return signed?.signedUrl ?? null;
}

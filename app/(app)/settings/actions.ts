"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireAccount } from "@/lib/supabase/account";
import { friendlyDbError } from "@/lib/db-errors";
import { parseDollarsToCents } from "@/lib/format";
import { accountLogoUrl } from "@/lib/account-logo";
// The one 14 CFR 61.5(a)(1) certificate list, shared with the onboarding
// wizard — see lib/airman.ts and tests/airman-certificates.test.mjs.
import { CERTIFICATE_TYPES } from "@/lib/airman";
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

/**
 * Every field the "Profile & billing defaults" panel edits — the rest of
 * what the onboarding wizard collects, honoring its "editable later in
 * Settings" promise (onboarding-wizard.tsx). Same echo discipline as
 * SETTINGS_FIELDS: every rendered input must be listed, or a rejected
 * submit silently blanks the unlisted ones while the pilot retypes only
 * the flagged field — then saves the blanks.
 */
const PROFILE_DEFAULTS_FIELDS = [
  "dba_name",
  "phone",
  "home_base",
  "certificate_type",
  "certificate_number",
  "ratings",
  "default_day_rate",
  "default_travel_day_rate",
  "default_per_diem",
  "default_payment_terms_days",
] as const;

function echo(formData: FormData, fields: readonly string[]) {
  const out: Record<string, string> = {};
  for (const field of fields) out[field] = String(formData.get(field) ?? "");
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
      error: "Your business name prints on every invoice, so it can't be blank.",
      values: echo(formData, SETTINGS_FIELDS),
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
      error: "Invoice prefix must be 1 to 8 letters or digits, such as INV.",
      values: echo(formData, SETTINGS_FIELDS),
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
    return { error: friendlyDbError(error, "accounts.update"), values: echo(formData, SETTINGS_FIELDS) };
  }
  // PostgREST returns 200 with no error for a write that matched nothing.
  if (count === 0) {
    return { error: "Couldn't save those details.", values: echo(formData, SETTINGS_FIELDS) };
  }

  revalidatePath("/settings");
  // The account name is rendered in the app chrome, so the whole shell
  // needs to pick up a rename.
  revalidatePath("/", "layout");
  return { error: null, saved: true };
}

/**
 * Parses a money field to cents. Empty → null (a default a pilot chose to
 * leave blank), a malformed number → the sentinel so the caller can reject
 * it with a message rather than write garbage. Same helper as the
 * onboarding wizard's (app/(onboarding)/onboarding/actions.ts) — the two
 * actions write the same columns and must accept the same inputs.
 */
function money(
  formData: FormData,
  key: string
): { ok: true; cents: number | null } | { ok: false } {
  const raw = String(formData.get(key) ?? "");
  if (raw.trim() === "") return { ok: true, cents: null };
  const cents = parseDollarsToCents(raw);
  if (cents === undefined) return { ok: false };
  return { ok: true, cents };
}

/**
 * The "Profile & billing defaults" panel's write — the wizard's own fields
 * (dba/phone/home base, airman profile, rate & terms defaults), editable
 * after first run, which is what the wizard's "editable later in Settings"
 * copy promises. Mirrors updateSettings exactly: owner gate for the
 * MESSAGE (the accounts_update RLS policy — pilot.is_account_owner(id) on
 * USING and WITH CHECK — is the boundary), count:'exact' zero-row
 * detection, friendlyDbError, echo-on-error. Validation reuses the
 * wizard's rules and sentences VERBATIM so a value the wizard accepted is
 * never rejected here, and vice versa. Every column written below is in
 * the 20260812400000 column-scoped UPDATE grant — no migration needed.
 */
export async function updateProfileDefaults(
  _prev: SettingsFormState,
  formData: FormData
): Promise<SettingsFormState> {
  const { account, role } = await requireAccount("/settings");

  if (role !== "owner") {
    return { error: "Only the account owner can change these defaults." };
  }

  // Membership check against the shared 61.5(a)(1) list — the DB CHECK
  // (20260812400000) enforces the same set, so this exists to return a
  // sentence instead of a Postgres error string.
  const certificateType = optional(formData, "certificate_type");
  if (certificateType && !CERTIFICATE_TYPES.includes(certificateType as never)) {
    return {
      error: "Pick a certificate from the list.",
      values: echo(formData, PROFILE_DEFAULTS_FIELDS),
    };
  }

  const dayRate = money(formData, "default_day_rate");
  const travelRate = money(formData, "default_travel_day_rate");
  const perDiem = money(formData, "default_per_diem");
  if (!dayRate.ok || !travelRate.ok || !perDiem.ok) {
    return {
      error: "Enter rates as plain dollar amounts, like 1200 or 1200.00.",
      values: echo(formData, PROFILE_DEFAULTS_FIELDS),
    };
  }
  // parseDollarsToCents deliberately accepts a leading "-" (expense
  // amounts can be credits), but a negative standing rate default is
  // never meaningful, and the 20260812400000 CHECKs (`... >= 0`) would
  // refuse it with friendlyDbError's generic 23514 sentence that names
  // no field. Rejected here with a real message instead. Same guard,
  // verbatim, in completeOnboarding — the two actions write the same
  // columns and must accept the same inputs.
  if (
    (dayRate.cents ?? 0) < 0 ||
    (travelRate.cents ?? 0) < 0 ||
    (perDiem.cents ?? 0) < 0
  ) {
    return {
      error: "Rates can't be negative.",
      values: echo(formData, PROFILE_DEFAULTS_FIELDS),
    };
  }

  // Net terms: a whole number of days, or blank. A negative or non-integer
  // would produce a due date before the issue date downstream.
  let paymentTerms: number | null = null;
  const termsRaw = String(formData.get("default_payment_terms_days") ?? "").trim();
  if (termsRaw !== "") {
    if (!/^\d{1,4}$/.test(termsRaw)) {
      return {
        error: "Payment terms are a whole number of days, like 30.",
        values: echo(formData, PROFILE_DEFAULTS_FIELDS),
      };
    }
    paymentTerms = Number(termsRaw);
  }

  const supabase = await createClient();

  // Form field names carry no _cents suffix (they hold dollar text); the
  // columns do — mapped here, never spread. Blank money and terms fields
  // store NULL ("no standing default"), which downstream consumers treat
  // as no-fallback, never as $0.00 or Net 0.
  const payload: AccountUpdate = {
    dba_name: optional(formData, "dba_name"),
    phone: optional(formData, "phone"),
    home_base: optional(formData, "home_base"),
    certificate_type: certificateType as AccountUpdate["certificate_type"],
    certificate_number: optional(formData, "certificate_number"),
    ratings: optional(formData, "ratings"),
    default_day_rate_cents: dayRate.cents,
    default_travel_day_rate_cents: travelRate.cents,
    default_per_diem_cents: perDiem.cents,
    default_payment_terms_days: paymentTerms,
  };

  const { error, count } = await supabase
    .from("accounts")
    .update(payload as never, { count: "exact" })
    .eq("id", account.id);

  if (error) {
    return {
      error: friendlyDbError(error, "accounts.profile"),
      values: echo(formData, PROFILE_DEFAULTS_FIELDS),
    };
  }
  // PostgREST returns 200 with no error for a write that matched nothing.
  if (count === 0) {
    return {
      error: "Couldn't save those details.",
      values: echo(formData, PROFILE_DEFAULTS_FIELDS),
    };
  }

  revalidatePath("/settings");
  // These defaults pre-fill screens OUTSIDE /settings — the new-trip and
  // new-client forms — so the whole tree must pick up the change, same
  // call shape updateSettings already uses for the chrome.
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
 * not be baked into a rendered page. Shared with the app shell's header
 * logo via lib/account-logo.ts.
 */
export async function logoPreviewUrl(): Promise<string | null> {
  const { account } = await requireAccount("/settings");
  const supabase = await createClient();
  return accountLogoUrl(supabase, account.id);
}

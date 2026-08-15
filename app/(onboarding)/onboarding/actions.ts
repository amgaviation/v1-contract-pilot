"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireAccount } from "@/lib/supabase/account";
import { friendlyDbError } from "@/lib/db-errors";
import { parseDollarsToCents } from "@/lib/format";
import { DASHBOARD_PATH } from "@/lib/nav";
// lib/airman.ts is the one list of 14 CFR 61.5(a)(1) certificate levels —
// this action used to carry its own copy, which is exactly the drift
// tests/airman-certificates.test.mjs now exists to prevent.
import { CERTIFICATE_TYPES } from "@/lib/airman";
import type { Database } from "@/lib/supabase/database.types";

type AccountUpdate = Database["pilot"]["Tables"]["accounts"]["Update"];

export type OnboardingState = {
  error: string | null;
  values?: Record<string, string>;
};

/**
 * Every field the wizard collects, so a rejected submit can echo them all
 * back (React 19 blanks an uncontrolled form on every dispatch). The
 * step-1/2/3 grouping is the UI's; the write is one row, one update.
 */
const FIELDS = [
  "legal_name",
  "dba_name",
  "phone",
  "home_base",
  "address_line1",
  "address_line2",
  "city",
  "state",
  "postal_code",
  "country",
  "certificate_type",
  "certificate_number",
  "ratings",
  "default_day_rate",
  "default_travel_day_rate",
  "default_per_diem",
  "default_payment_terms_days",
  "invoice_prefix",
] as const;

function echo(formData: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const field of FIELDS) out[field] = String(formData.get(field) ?? "");
  return out;
}

function optional(formData: FormData, key: string): string | null {
  const value = String(formData.get(key) ?? "").trim();
  return value === "" ? null : value;
}

/**
 * Parses a money field to cents. Empty → null (a default a pilot chose to
 * leave blank), a malformed number → the sentinel so the caller can reject
 * it with a message rather than write garbage. Mirrors settings/expenses.
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
 * Finishes (or skips) the post-checkout onboarding wizard. In BOTH paths the
 * one thing that must happen is onboarding_complete → true, which lifts the
 * (app) layout's redirect and lets the pilot into the product. "Skip for now"
 * writes only that flag; "Finish" writes the flag plus everything they filled
 * in. Either way we land on the dashboard.
 *
 * onboarding_complete and every field here are in the authenticated column
 * UPDATE grant (20260812400000), so this runs as the RLS-scoped owner — no
 * service-role. A non-owner cannot reach this: a solo account's only member
 * IS the owner, and requireAccount + the accounts_update owner policy is the
 * boundary regardless.
 */
export async function completeOnboarding(
  _prev: OnboardingState,
  formData: FormData
): Promise<OnboardingState> {
  // allowUnonboarded: this IS the wizard, so requireAccount must not bounce
  // the very account it is trying to onboard back into itself.
  const { account, role } = await requireAccount("/onboarding", {
    allowUnonboarded: true,
  });

  if (role !== "owner") {
    return { error: "Only the account owner can set this up." };
  }

  const supabase = await createClient();
  const intent = String(formData.get("intent") ?? "finish");

  if (intent === "skip") {
    const { error, count } = await supabase
      .from("accounts")
      .update({ onboarding_complete: true } satisfies AccountUpdate as never, {
        count: "exact",
      })
      .eq("id", account.id);
    if (error) return { error: friendlyDbError(error, "accounts.onboarding") };
    if (count === 0) return { error: "Couldn't finish setup. Try again." };
    revalidatePath("/", "layout");
    redirect(DASHBOARD_PATH);
  }

  // legal_name is NOT NULL and prints on every invoice — it is prefilled from
  // signup, so this only fails if the pilot cleared it.
  const legalName = String(formData.get("legal_name") ?? "").trim();
  if (!legalName) {
    return {
      error: "Your business name prints on every invoice. It can't be blank.",
      values: echo(formData),
    };
  }

  const certificateType = optional(formData, "certificate_type");
  if (certificateType && !CERTIFICATE_TYPES.includes(certificateType as never)) {
    return { error: "Pick a certificate from the list.", values: echo(formData) };
  }

  const dayRate = money(formData, "default_day_rate");
  const travelRate = money(formData, "default_travel_day_rate");
  const perDiem = money(formData, "default_per_diem");
  if (!dayRate.ok || !travelRate.ok || !perDiem.ok) {
    return {
      error: "Enter rates as plain dollar amounts, like 1200 or 1200.00.",
      values: echo(formData),
    };
  }
  // parseDollarsToCents deliberately accepts a leading "-" (expense
  // amounts can be credits), but a negative standing rate default is
  // never meaningful, and the 20260812400000 CHECKs (`... >= 0`) would
  // refuse it with friendlyDbError's generic 23514 sentence that names
  // no field. Rejected here with a real message instead. Same guard,
  // verbatim, in updateProfileDefaults — the two actions write the same
  // columns and must accept the same inputs.
  if (
    (dayRate.cents ?? 0) < 0 ||
    (travelRate.cents ?? 0) < 0 ||
    (perDiem.cents ?? 0) < 0
  ) {
    return {
      error: "Rates can't be negative.",
      values: echo(formData),
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
        values: echo(formData),
      };
    }
    paymentTerms = Number(termsRaw);
  }

  // Invoice prefix: same constraint as Settings (1–8 uppercase alphanumerics),
  // blank keeps whatever the account already has rather than forcing INV here.
  let invoicePrefix: string | undefined;
  const prefixRaw = String(formData.get("invoice_prefix") ?? "").trim().toUpperCase();
  if (prefixRaw !== "") {
    if (!/^[A-Z0-9]{1,8}$/.test(prefixRaw)) {
      return {
        error: "Invoice prefix must be 1 to 8 letters or digits, such as INV.",
        values: echo(formData),
      };
    }
    invoicePrefix = prefixRaw;
  }

  const payload: AccountUpdate = {
    legal_name: legalName,
    dba_name: optional(formData, "dba_name"),
    phone: optional(formData, "phone"),
    home_base: optional(formData, "home_base"),
    address_line1: optional(formData, "address_line1"),
    address_line2: optional(formData, "address_line2"),
    city: optional(formData, "city"),
    state: optional(formData, "state"),
    postal_code: optional(formData, "postal_code"),
    country: optional(formData, "country"),
    certificate_type: certificateType as AccountUpdate["certificate_type"],
    certificate_number: optional(formData, "certificate_number"),
    ratings: optional(formData, "ratings"),
    default_day_rate_cents: dayRate.cents,
    default_travel_day_rate_cents: travelRate.cents,
    default_per_diem_cents: perDiem.cents,
    default_payment_terms_days: paymentTerms,
    onboarding_complete: true,
  };
  if (invoicePrefix !== undefined) payload.invoice_prefix = invoicePrefix;

  const { error, count } = await supabase
    .from("accounts")
    .update(payload as never, { count: "exact" })
    .eq("id", account.id);

  if (error) {
    return { error: friendlyDbError(error, "accounts.onboarding"), values: echo(formData) };
  }
  if (count === 0) {
    return { error: "Couldn't save your setup. Try again.", values: echo(formData) };
  }

  // The account name renders in the app chrome, so the shell must refresh.
  revalidatePath("/", "layout");
  redirect(DASHBOARD_PATH);
}

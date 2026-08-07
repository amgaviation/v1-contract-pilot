"use server";

import { revalidatePath } from "next/cache";
import { requireAccount } from "@/lib/supabase/account";
import { createClient } from "@/lib/supabase/server";
import { parseDollarsToCents } from "@/lib/format";
import { friendlyDbError } from "@/lib/db-errors";
import {
  reportsFrom,
  type ClientTaxFormInsert,
  type ClientTaxFormUpdate,
} from "./db";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const FORM_TYPES = ["1099-NEC", "1099-MISC", "other"] as const;

export type TaxFormState = { error: string | null };

function isDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(value);
}

function optional(formData: FormData, key: string): string | null {
  const value = String(formData.get(key) ?? "").trim();
  return value === "" ? null : value;
}

/**
 * Records or corrects what a client's 1099 reported for a tax year. This
 * is the pilot transcribing a document THEY received — never a computed
 * figure, and never treated as one: nothing here derives, checks, or
 * disputes the client's number, it only stores it next to the pilot's own
 * cash-basis ledger so the delta on /reports/year-end is a visible fact.
 *
 * Upserts on (account_id, client_id, tax_year, form_type) — the same
 * unique constraint the migration puts on the table — so re-submitting the
 * form for a client/year/type the pilot already recorded corrects that row
 * instead of erroring or duplicating it.
 */
export async function saveClientTaxForm(
  _prev: TaxFormState,
  formData: FormData
): Promise<TaxFormState> {
  const { account } = await requireAccount("/reports/year-end");

  const clientId = String(formData.get("client_id") ?? "");
  if (!UUID_RE.test(clientId)) return { error: "Pick a client." };

  const taxYearRaw = String(formData.get("tax_year") ?? "");
  const taxYear = Number(taxYearRaw);
  if (!Number.isInteger(taxYear) || taxYear < 2000 || taxYear > 2100) {
    return { error: "That tax year isn't valid." };
  }

  const formType = String(formData.get("form_type") ?? "1099-NEC");
  if (!(FORM_TYPES as readonly string[]).includes(formType)) {
    return { error: "That form type isn't valid." };
  }

  const reportedAmount = parseDollarsToCents(
    String(formData.get("reported_amount") ?? "")
  );
  if (reportedAmount === undefined) {
    return { error: "The reported amount must be a number like 12500 or 12500.00." };
  }
  if (reportedAmount === null) {
    return { error: "Enter the amount the form reports." };
  }
  if (reportedAmount < 0) {
    return { error: "The reported amount can't be negative." };
  }

  const receivedOnRaw = optional(formData, "received_on");
  if (receivedOnRaw && !isDate(receivedOnRaw)) {
    return { error: "That received date isn't valid." };
  }

  const notes = optional(formData, "notes");

  const supabase = await createClient();

  // Look up an existing row for this (client, year, form type) first —
  // there is no ON CONFLICT available through PostgREST's insert(), and
  // the unique constraint means a blind insert on a re-submission would
  // just fail with 23505 instead of correcting the figure, which is
  // exactly the case a pilot fixing a mistyped amount hits.
  const { data: existing, error: readError } = await reportsFrom(
    supabase,
    "client_tax_forms"
  )
    .select("id")
    .eq("account_id", account.id)
    .eq("client_id", clientId)
    .eq("tax_year", taxYear)
    .eq("form_type", formType)
    .maybeSingle();

  if (readError) {
    return { error: friendlyDbError(readError, "client_tax_forms.select") };
  }

  if (existing) {
    const update: ClientTaxFormUpdate = {
      reported_amount_cents: reportedAmount,
      received_on: receivedOnRaw,
      notes,
    };
    const { error, count } = await reportsFrom(supabase, "client_tax_forms")
      .update(update, { count: "exact" })
      .eq("id", (existing as { id: string }).id)
      .eq("account_id", account.id);
    if (error) return { error: friendlyDbError(error, "client_tax_forms.update") };
    if (!count) return { error: "That record no longer exists." };
  } else {
    const insert: ClientTaxFormInsert = {
      account_id: account.id,
      client_id: clientId,
      tax_year: taxYear,
      form_type: formType as ClientTaxFormInsert["form_type"],
      reported_amount_cents: reportedAmount,
      received_on: receivedOnRaw,
      notes,
    };
    const { error } = await reportsFrom(supabase, "client_tax_forms").insert(insert);
    if (error) return { error: friendlyDbError(error, "client_tax_forms.insert") };
  }

  revalidatePath("/reports/year-end");
  return { error: null };
}

export async function deleteClientTaxForm(
  id: string
): Promise<{ error: string | null }> {
  const { account } = await requireAccount("/reports/year-end");
  if (!UUID_RE.test(id)) return { error: "That record isn't valid." };

  const supabase = await createClient();
  const { error, count } = await reportsFrom(supabase, "client_tax_forms")
    .delete({ count: "exact" })
    .eq("id", id)
    .eq("account_id", account.id);

  if (error) return { error: friendlyDbError(error, "client_tax_forms.delete") };
  if (!count) return { error: "That record no longer exists." };

  revalidatePath("/reports/year-end");
  return { error: null };
}

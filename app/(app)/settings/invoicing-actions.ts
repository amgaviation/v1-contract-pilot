"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireAccount } from "@/lib/supabase/account";
import { friendlyDbError } from "@/lib/db-errors";
import type { Database } from "@/lib/supabase/database.types";
import type { SettingsFormState } from "./actions";

type AccountUpdate = Database["pilot"]["Tables"]["accounts"]["Update"];

/**
 * WHAT AN INVOICE LOOKS LIKE, in one place.
 *
 * Before this, a pilot could change exactly one thing about their
 * invoices' identity — the prefix — and it was filed under their postal
 * address because that is where the field happened to be added. Everything
 * else was a constant compiled into pilot.next_invoice_number or a field
 * they retyped on every invoice.
 *
 * invoice_prefix MOVED here from settings/actions.ts rather than being
 * copied. Both actions rebuild the full accounts payload from their own
 * form, so two forms carrying the same field means whichever saves last
 * wins — saving an address would have silently reset the prefix to 'INV'.
 * See that file's note where the field used to be.
 *
 * THE NUMBER FORMAT IS NOT RETROACTIVE and the panel says so out loud.
 * pilot.invoices.invoice_number is immutable text assigned once, on issue;
 * changing pad or the year toggle changes the NEXT number and nothing that
 * already exists. That is the correct behaviour — an invoice a client
 * holds must keep the number printed on it — but it is also the thing a
 * pilot will misread if nobody tells them.
 */

/** Every input this panel renders, echoed back on a rejected submit. */
const INVOICING_FIELDS = [
  "invoice_prefix",
  "invoice_number_pad",
  "invoice_number_include_year",
  "default_tax_rate_percent",
  "default_invoice_notes",
  "invoice_footer",
] as const;

function echo(formData: FormData) {
  const out: Record<string, string> = {};
  for (const field of INVOICING_FIELDS) out[field] = String(formData.get(field) ?? "");
  return out;
}

/** "" and whitespace both mean "not set", which is a real state here. */
function optionalText(formData: FormData, field: string): string | null {
  const value = String(formData.get(field) ?? "").trim();
  return value === "" ? null : value;
}

export async function updateInvoicing(
  _prev: SettingsFormState,
  formData: FormData
): Promise<SettingsFormState> {
  const { account } = await requireAccount("/settings");

  // The prefix is baked into already-issued invoice numbers by
  // pilot.next_invoice_number(). Changing it does NOT rewrite history — past
  // invoices keep the number they were issued under — but it does mean a
  // pilot's numbering changes series mid-stream, which an accountant will
  // ask about. Constrained to a short, uppercase, alphanumeric token so it
  // cannot become something that reads as part of the number itself.
  // (Moved verbatim from settings/actions.ts.)
  const prefixRaw = String(formData.get("invoice_prefix") ?? "").trim().toUpperCase();
  const prefix = prefixRaw === "" ? "INV" : prefixRaw;
  if (!/^[A-Z0-9]{1,8}$/.test(prefix)) {
    return {
      error: "Invoice prefix must be 1 to 8 letters or digits, such as INV.",
      values: echo(formData),
    };
  }

  // Checked here as well as by the CHECK constraint, and not because the
  // constraint is in doubt: a server action is a public POST endpoint, so
  // an out-of-range value arrives whether or not the <input min> was
  // honoured, and 23514 rendered through friendlyDbError says "Some of
  // those values aren't valid together" — true, and useless.
  const padRaw = String(formData.get("invoice_number_pad") ?? "").trim();
  const pad = Number(padRaw);
  if (!/^\d+$/.test(padRaw) || !Number.isInteger(pad) || pad < 1 || pad > 8) {
    return {
      error: "Number length must be a whole number from 1 to 8 digits.",
      values: echo(formData),
    };
  }

  // A checkbox that is off is ABSENT from the form data, not "false" — the
  // one HTML detail this whole panel turns on.
  const includeYear = formData.get("invoice_number_include_year") !== null;

  // Same shape as parsePercentToBps in estimates/estimate-lib.ts, kept
  // local rather than imported because that module is estimate-line
  // parsing and this is one field: "" is a legitimate "no default", which
  // is why undefined (malformed) and null (blank) are distinct outcomes.
  const taxRaw = String(formData.get("default_tax_rate_percent") ?? "").trim();
  let taxBps: number | null = null;
  if (taxRaw !== "") {
    if (!/^\d{1,2}(\.\d{1,2})?$/.test(taxRaw)) {
      return {
        error: "Default tax rate must be a percent like 8.25, up to 25%.",
        values: echo(formData),
      };
    }
    taxBps = Math.round(Number(taxRaw) * 100);
    if (!Number.isFinite(taxBps) || taxBps < 0 || taxBps > 2500) {
      return {
        error: "Default tax rate must be a percent like 8.25, up to 25%.",
        values: echo(formData),
      };
    }
  }

  const notes = optionalText(formData, "default_invoice_notes");
  const footer = optionalText(formData, "invoice_footer");
  // Matches the CHECK constraints, for the same reason the pad check does.
  if ((notes?.length ?? 0) > 2000 || (footer?.length ?? 0) > 2000) {
    return {
      error: "Notes and the footer are limited to 2,000 characters each.",
      values: echo(formData),
    };
  }

  const supabase = await createClient();

  const payload: AccountUpdate = {
    invoice_prefix: prefix,
    invoice_number_pad: pad,
    invoice_number_include_year: includeYear,
    default_tax_rate_bps: taxBps,
    default_invoice_notes: notes,
    invoice_footer: footer,
  };

  // No billing column appears above, and none may — they are withheld from
  // the authenticated UPDATE grant AND blocked by
  // accounts_protect_billing_columns. The id filter is defence in depth;
  // RLS is the boundary.
  const { error, count } = await supabase
    .from("accounts")
    .update(payload as never, { count: "exact" })
    .eq("id", account.id);

  if (error) return { error: friendlyDbError(error, "accounts.invoicing"), values: echo(formData) };
  // No error and no rows is not success — see every other write in this
  // product that learned it the same way.
  if (count === 0) return { error: "Couldn't save those settings.", values: echo(formData) };

  revalidatePath("/settings");
  // The new-invoice form prefills its tax and notes from these.
  revalidatePath("/invoices/new");
  return { error: null, saved: true };
}

/**
 * MOVE THE COUNTER FORWARD — the one thing a pilot migrating off another
 * system needs and could not do.
 *
 * The write itself is pilot.set_next_invoice_number, not an UPDATE, and
 * that is the security-relevant part: pilot.invoice_number_sequences has no
 * tenant-facing UPDATE grant and must never get one, because a tenant who
 * could lower the counter could re-mint a number an issued invoice already
 * holds. The function only ever raises. See its migration.
 *
 * P0001 (the refusal) and P0002 (not your account / no sequence row) are
 * separated here so a genuine "you cannot go backwards" reads as the
 * sentence the function wrote, while a structural failure does not get
 * dressed up as a business rule — the distinction lib/autopay/run.ts had to
 * learn the hard way.
 */
export async function setNextInvoiceNumber(
  _prev: SettingsFormState,
  formData: FormData
): Promise<SettingsFormState> {
  const { account } = await requireAccount("/settings");

  const raw = String(formData.get("next_invoice_number") ?? "").trim();
  if (!/^\d{1,9}$/.test(raw) || Number(raw) < 1) {
    return {
      error: "The next invoice number must be a whole number of at least 1.",
      values: { next_invoice_number: raw },
    };
  }

  const supabase = await createClient();
  // The same hand-authored-types gap logbookFrom exists to bridge:
  // lib/supabase/database.types.ts does not carry pilot functions, and
  // widening it is what pushed supabase-js past its generic-instantiation
  // depth limit once already. Narrowed to this one name by the cast's
  // literal argument, so it cannot become a way to call anything at all.
  const { error } = await (
    supabase as unknown as {
      rpc: (
        name: "set_next_invoice_number",
        args: { target_account: string; p_next: number }
      ) => Promise<{ error: { code?: string; message: string } | null }>;
    }
  ).rpc("set_next_invoice_number", {
    target_account: account.id,
    p_next: Number(raw),
  });

  if (error) {
    if (error.code === "P0001") {
      // The function's own sentence, which already names the current value.
      return { error: error.message, values: { next_invoice_number: raw } };
    }
    return {
      error: friendlyDbError(error, "accounts.next_invoice_number"),
      values: { next_invoice_number: raw },
    };
  }

  revalidatePath("/settings");
  return { error: null, saved: true };
}

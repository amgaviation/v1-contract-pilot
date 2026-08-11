"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireAccount } from "@/lib/supabase/account";
import { parseDollarsToCents } from "@/lib/format";
import { friendlyDbError } from "@/lib/db-errors";
import type { Database } from "@/lib/supabase/database.types";
import {
  ESTIMATE_LINE_TYPES,
  estimateRefusalMessage,
  isDate,
  parsePercentToBps,
  parseQuantity,
  type EstimateStatus,
} from "./estimate-lib";

type EstimateInsert = Database["pilot"]["Tables"]["estimates"]["Insert"];
type EstimateUpdate = Database["pilot"]["Tables"]["estimates"]["Update"];
type EstimateLineInsert = Database["pilot"]["Tables"]["estimate_lines"]["Insert"];
type EstimateLineUpdate = Database["pilot"]["Tables"]["estimate_lines"]["Update"];

/**
 * `values` echoes what was submitted so a rejected form can repopulate
 * itself — React 19 resets an uncontrolled form on every action dispatch,
 * including the error path (same pattern as invoices/actions.ts and
 * trips/actions.ts).
 */
export type EstimateFormState = {
  error: string | null;
  saved?: boolean;
  values?: Record<string, string>;
};

export type EstimateLineFormValues = {
  line_type?: string;
  description?: string;
  quantity?: string;
  unit_amount?: string;
  taxable?: string;
};

export type EstimateLineFormState = { error: string | null; values?: EstimateLineFormValues };

/** Every field the line form posts, as submitted, for the error path. */
function lineFormValues(formData: FormData): EstimateLineFormValues {
  const str = (k: string) => {
    const v = formData.get(k);
    return v === null ? undefined : String(v);
  };
  return {
    line_type: str("line_type"),
    description: str("description"),
    quantity: str("quantity"),
    unit_amount: str("unit_amount"),
    taxable: str("taxable"),
  };
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function optional(formData: FormData, key: string): string | null {
  const value = String(formData.get(key) ?? "").trim();
  return value === "" ? null : value;
}

/** Fields updateEstimateHeader's form submits — mirrors invoices' echo(). */
const ESTIMATE_HEADER_FIELDS = [
  "client_id",
  "valid_until",
  "tax_rate_percent",
  "terms",
  "notes",
] as const;

function echo(formData: FormData) {
  const out: Record<string, string> = {};
  for (const field of ESTIMATE_HEADER_FIELDS) out[field] = String(formData.get(field) ?? "");
  return out;
}

/**
 * The estimate triggers raise their refusals as P0001 with messages worth
 * translating (estimateRefusalMessage); everything else goes through the
 * same scrubber every other action uses.
 */
function estimateDbError(
  error: { code?: string | null; message?: string | null } | null | undefined,
  context: string
): string {
  const known = estimateRefusalMessage(error);
  if (known) {
    // Still logged server-side, same as friendlyDbError would.
    console.error(`[db] ${context}`, {
      code: error?.code ?? null,
      message: error?.message ?? null,
    });
    return known;
  }
  return friendlyDbError(error, context);
}

// ---------------------------------------------------------------------------
// Draft an estimate: a client, the quote's own terms, and typed-in lines.
//
// Unlike createInvoiceDraft there is no trip arithmetic here — a quote is
// usually written BEFORE any trip record exists (the migration's own
// framing: "what would three days in the Citation cost me?"), so the lines
// are exactly what the pilot types, parsed with the same money/quantity
// discipline the invoice line forms use.
// ---------------------------------------------------------------------------
export async function createEstimateDraft(
  _prev: EstimateFormState,
  formData: FormData
): Promise<EstimateFormState> {
  const { account } = await requireAccount("/estimates/new");

  const clientId = String(formData.get("client_id") ?? "").trim();
  if (!UUID_RE.test(clientId)) {
    return { error: "Choose a client to quote.", values: echo(formData) };
  }

  const taxBps = parsePercentToBps(String(formData.get("tax_rate_percent") ?? ""));
  if (taxBps === undefined) {
    return {
      error: "Tax rate must be a percent like 8.25, up to 25%.",
      values: echo(formData),
    };
  }

  const validUntil = optional(formData, "valid_until");
  if (validUntil !== null && !isDate(validUntil)) {
    return { error: "That valid-until date isn't valid.", values: echo(formData) };
  }

  // The line rows post as parallel arrays, one entry per row for EVERY
  // field (the form posts hidden inputs for select/checkbox values, so the
  // arrays cannot misalign the way unchecked checkboxes would misalign
  // them). A row left entirely blank is skipped; a row half filled in is
  // an error that names the row.
  const lineTypes = formData.getAll("line_type").map(String);
  const descriptions = formData.getAll("line_description").map(String);
  const quantities = formData.getAll("line_quantity").map(String);
  const unitAmounts = formData.getAll("line_unit_amount").map(String);
  const taxables = formData.getAll("line_taxable").map(String);

  if (
    descriptions.length !== lineTypes.length ||
    quantities.length !== lineTypes.length ||
    unitAmounts.length !== lineTypes.length ||
    taxables.length !== lineTypes.length
  ) {
    return { error: "The line items didn't submit cleanly. Try again.", values: echo(formData) };
  }

  type ParsedLine = {
    line_type: EstimateLineInsert["line_type"];
    description: string;
    quantity: number;
    unit_amount_cents: number;
    taxable: boolean;
  };
  const parsedLines: ParsedLine[] = [];
  for (let i = 0; i < lineTypes.length; i++) {
    const lineType = lineTypes[i] ?? "";
    const description = (descriptions[i] ?? "").trim();
    const unitAmountRaw = (unitAmounts[i] ?? "").trim();
    if (description === "" && unitAmountRaw === "") continue; // an untouched row

    const row = `Line ${i + 1}`;
    if (!(ESTIMATE_LINE_TYPES as readonly string[]).includes(lineType)) {
      return { error: `${row}: choose a line type.`, values: echo(formData) };
    }
    if (!description) {
      return { error: `${row}: give it a description.`, values: echo(formData) };
    }
    const quantity = parseQuantity(quantities[i] ?? "");
    if (quantity === undefined) {
      return {
        error: `${row}: quantity must be a positive number, like 1 or 2.5.`,
        values: echo(formData),
      };
    }
    const unitAmountCents = parseDollarsToCents(unitAmountRaw);
    if (unitAmountCents === undefined || unitAmountCents === null || unitAmountCents < 0) {
      return {
        error: `${row}: unit amount must be an amount like 1500 or 1500.00.`,
        values: echo(formData),
      };
    }
    parsedLines.push({
      line_type: lineType as EstimateLineInsert["line_type"],
      description,
      quantity,
      unit_amount_cents: unitAmountCents,
      taxable: taxables[i] === "on",
    });
  }

  const supabase = await createClient();

  const estimatePayload: EstimateInsert = {
    account_id: account.id,
    client_id: clientId,
    tax_rate_bps: taxBps ?? 0,
    valid_until: validUntil,
    terms: optional(formData, "terms"),
    notes: optional(formData, "notes"),
  };
  const { data: estimateData, error: estimateError } = await supabase
    .from("estimates")
    .insert(estimatePayload as never)
    .select("id")
    .single();

  if (estimateError) {
    return {
      error: friendlyDbError(estimateError, "estimates.insert"),
      values: echo(formData),
    };
  }
  const estimateId = (estimateData as { id: string }).id;

  if (parsedLines.length > 0) {
    // One batch insert: either every line lands or none do (a single
    // Postgres statement), so the draft is never left with half its lines.
    const linePayloads: EstimateLineInsert[] = parsedLines.map((line, index) => ({
      account_id: account.id,
      estimate_id: estimateId,
      line_type: line.line_type,
      description: line.description,
      quantity: line.quantity,
      unit_amount_cents: line.unit_amount_cents,
      taxable: line.taxable,
      sort_order: index,
    }));
    const { error: linesError } = await supabase
      .from("estimate_lines")
      .insert(linePayloads as never);

    if (linesError) {
      // The header estimate already exists as a valid, empty draft; there
      // is no cross-table transaction available from app code, so — same
      // as createInvoiceDraft — the failure is disclosed on the draft's
      // own screen rather than silently swallowed.
      redirect(
        `/estimates/${estimateId}?warning=${encodeURIComponent(
          `Created the draft, but couldn't add the line items: ${estimateDbError(
            linesError,
            "estimate_lines.insert"
          )}`
        )}`
      );
    }
  }

  revalidatePath("/estimates");
  redirect(`/estimates/${estimateId}`);
}

// ---------------------------------------------------------------------------
// Header edits — the estimate stays a draft (or has been revised back to
// one); pilot.estimates_protect is the real gate for everything else.
// ---------------------------------------------------------------------------
export async function updateEstimateHeader(
  _prev: EstimateFormState,
  formData: FormData
): Promise<EstimateFormState> {
  const id = String(formData.get("id") ?? "");
  if (!UUID_RE.test(id)) return { error: "Missing estimate id.", values: echo(formData) };

  const { account } = await requireAccount(`/estimates/${id}`);

  const clientId = String(formData.get("client_id") ?? "").trim();
  if (!UUID_RE.test(clientId)) {
    return { error: "Choose a client to quote.", values: echo(formData) };
  }

  const validUntil = optional(formData, "valid_until");
  if (validUntil !== null && !isDate(validUntil)) {
    return { error: "That valid-until date isn't valid.", values: echo(formData) };
  }

  const taxBps = parsePercentToBps(String(formData.get("tax_rate_percent") ?? ""));
  if (taxBps === undefined) {
    return { error: "Tax rate must be a percent like 8.25, up to 25%.", values: echo(formData) };
  }

  const payload: EstimateUpdate = {
    client_id: clientId,
    valid_until: validUntil,
    tax_rate_bps: taxBps ?? 0,
    terms: optional(formData, "terms"),
    notes: optional(formData, "notes"),
  };

  const supabase = await createClient();
  // { count: "exact" } because PostgREST returns 200 with no error on a
  // write that matched zero rows — a wrong id or another tenant's row must
  // not render as "Saved." (same discipline as invoices/actions.ts).
  const { error, count } = await supabase
    .from("estimates")
    .update(payload as never, { count: "exact" })
    .eq("id", id)
    .eq("account_id", account.id); // defence in depth alongside RLS

  if (error) {
    // The one 23514 a validated form can still hit: a revised estimate
    // (sent once, back in draft) already carries issued_on, and the
    // migration's CHECK refuses a valid_until before it.
    if (error.code === "23514") {
      return {
        error:
          "Those dates don't work together — the valid-until date can't be before the issue date this estimate already carries.",
        values: echo(formData),
      };
    }
    return { error: estimateDbError(error, "estimates.update"), values: echo(formData) };
  }
  if (!count) {
    return { error: "That estimate no longer exists.", values: echo(formData) };
  }

  revalidatePath(`/estimates/${id}`);
  revalidatePath("/estimates");
  return { error: null, saved: true };
}

/** Notes-only edit, valid in any status (notes stays writable throughout). */
export async function updateEstimateNotes(
  _prev: EstimateFormState,
  formData: FormData
): Promise<EstimateFormState> {
  const id = String(formData.get("id") ?? "");
  if (!UUID_RE.test(id)) return { error: "Missing estimate id." };

  const { account } = await requireAccount(`/estimates/${id}`);
  const supabase = await createClient();

  const payload: EstimateUpdate = { notes: optional(formData, "notes") };
  const { error, count } = await supabase
    .from("estimates")
    .update(payload as never, { count: "exact" })
    .eq("id", id)
    .eq("account_id", account.id);

  if (error) return { error: estimateDbError(error, "estimates.update") };
  if (!count) return { error: "That estimate no longer exists." };

  revalidatePath(`/estimates/${id}`);
  return { error: null, saved: true };
}

// ---------------------------------------------------------------------------
// Status transitions. The state machine lives in pilot.estimates_protect
// (draft -> sent, sent -> accepted|declined|draft, declined -> sent|accepted)
// and numbering-on-send lives in estimates_assign_number_on_issue — these
// actions only supply the intent, never bypass the triggers.
// ---------------------------------------------------------------------------
async function setEstimateStatus(
  id: string,
  to: EstimateStatus,
  context: string
): Promise<{ error: string | null }> {
  if (!UUID_RE.test(id)) return { error: "That estimate no longer exists." };

  const { account } = await requireAccount(`/estimates/${id}`);
  const supabase = await createClient();

  const payload: EstimateUpdate = { status: to };
  const { error, count } = await supabase
    .from("estimates")
    .update(payload as never, { count: "exact" })
    .eq("id", id)
    .eq("account_id", account.id);

  if (error) {
    // Sending stamps issued_on = today, and the migration's CHECK then
    // refuses a valid_until that has already gone by — the one 23514 this
    // update can produce.
    if (error.code === "23514" && to === "sent") {
      return {
        error:
          "This estimate's valid-until date has already passed, so it can't be sent as it stands. Move the date forward first.",
      };
    }
    return { error: estimateDbError(error, context) };
  }
  if (!count) return { error: "That estimate no longer exists." };

  revalidatePath(`/estimates/${id}`);
  revalidatePath("/estimates");
  return { error: null };
}

/**
 * Draft -> sent. The estimates_assign_number_on_issue trigger mints the
 * permanent estimate number and stamps issued_on/sent_at on this exact
 * transition — nothing here writes any of those columns (the grant
 * withholds them anyway). Also the declined -> sent path: re-sending a
 * declined quote keeps the number it already has.
 */
export async function markEstimateSent(id: string): Promise<{ error: string | null }> {
  return setEstimateStatus(id, "sent", "estimates.send");
}

/**
 * Sent -> draft, the revision loop the migration builds in deliberately:
 * "the client says 'can you do it for less', and the pilot revises and
 * re-sends." The number, once minted, survives the round trip.
 */
export async function reviseEstimate(id: string): Promise<{ error: string | null }> {
  return setEstimateStatus(id, "draft", "estimates.revise");
}

export async function markEstimateAccepted(id: string): Promise<{ error: string | null }> {
  return setEstimateStatus(id, "accepted", "estimates.accept");
}

export async function markEstimateDeclined(id: string): Promise<{ error: string | null }> {
  return setEstimateStatus(id, "declined", "estimates.decline");
}

/**
 * An abandoned draft quote is not a financial record and can be deleted —
 * but ONLY one that was never sent. The RLS delete policy (status='draft'
 * AND estimate_number IS NULL AND never converted) is the enforcement; a
 * numbered estimate is a document a client has seen, and the policy
 * silently filters it out of the DELETE, which is why the zero-count check
 * below is load-bearing rather than decorative.
 */
export async function deleteEstimateDraft(id: string): Promise<{ error: string | null }> {
  if (!UUID_RE.test(id)) return { error: "That estimate no longer exists." };

  const { account } = await requireAccount(`/estimates/${id}`);
  const supabase = await createClient();

  const { error, count } = await supabase
    .from("estimates")
    .delete({ count: "exact" })
    .eq("id", id)
    .eq("account_id", account.id);

  if (error) return { error: friendlyDbError(error, "estimates.delete") };
  if (count === 0) {
    return {
      error:
        "This estimate couldn't be deleted. Once one has been sent it keeps its number and its record — it may have moved on since this page loaded.",
    };
  }

  revalidatePath("/estimates");
  redirect("/estimates");
}

/**
 * Accepted estimate -> DRAFT invoice, via pilot.estimate_convert_to_invoice
 * — one SECURITY DEFINER function so the invoice insert, the line copy and
 * the conversion stamp all happen atomically (the migration's header
 * explains why three client calls can't be trusted with this). The
 * function refuses a quote that isn't accepted, one with no lines, and a
 * second conversion of the same quote.
 *
 * On success the pilot lands on the new invoice, which is a DRAFT they
 * still review and send — conversion never contacts the client.
 */
export async function convertEstimateToInvoice(
  id: string
): Promise<{ error: string | null }> {
  if (!UUID_RE.test(id)) return { error: "That estimate no longer exists." };

  await requireAccount(`/estimates/${id}`);
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("estimate_convert_to_invoice", {
    target_estimate_id: id,
  } as never);

  if (error) return { error: estimateDbError(error, "estimates.convert") };

  const newInvoiceId = data as string | null;
  if (!newInvoiceId || !UUID_RE.test(newInvoiceId)) {
    // The function returns the new invoice's uuid; anything else means the
    // conversion can't be confirmed, and claiming success would be worse
    // than saying so.
    return {
      error:
        "The conversion didn't confirm. Reload this page — if the estimate shows as converted, open the invoice from here.",
    };
  }

  revalidatePath(`/estimates/${id}`);
  revalidatePath("/estimates");
  revalidatePath("/invoices");
  redirect(`/invoices/${newInvoiceId}`);
}

// ---------------------------------------------------------------------------
// Lines. Editable until the quote becomes an invoice —
// estimate_lines_protect_converted enforces that in the database regardless
// of what these actions send. The UI only offers editing on a draft, which
// is a narrower, deliberate choice: a sent quote is revised by taking it
// back to draft first, so what the client saw and what the pilot edited
// never silently diverge.
// ---------------------------------------------------------------------------
export async function addEstimateLine(
  _prev: EstimateLineFormState,
  formData: FormData
): Promise<EstimateLineFormState> {
  const estimateId = String(formData.get("estimate_id") ?? "");
  if (!UUID_RE.test(estimateId)) return { error: "Missing estimate id." };

  const values = lineFormValues(formData);
  const { account } = await requireAccount(`/estimates/${estimateId}`);

  const lineType = String(formData.get("line_type") ?? "");
  if (!(ESTIMATE_LINE_TYPES as readonly string[]).includes(lineType)) {
    return { error: "Choose a line type.", values };
  }

  const description = String(formData.get("description") ?? "").trim();
  if (!description) return { error: "Give the line a description.", values };

  const quantity = parseQuantity(String(formData.get("quantity") ?? ""));
  if (quantity === undefined) {
    return { error: "Quantity must be a positive number, like 1 or 2.5.", values };
  }

  const unitAmountCents = parseDollarsToCents(String(formData.get("unit_amount") ?? ""));
  if (unitAmountCents === undefined || unitAmountCents === null || unitAmountCents < 0) {
    return { error: "Unit amount must be an amount like 1500 or 1500.00.", values };
  }

  const taxable = formData.get("taxable") === "on";

  const supabase = await createClient();
  const payload: EstimateLineInsert = {
    account_id: account.id,
    estimate_id: estimateId,
    line_type: lineType as EstimateLineInsert["line_type"],
    description,
    quantity,
    unit_amount_cents: unitAmountCents,
    taxable,
  };

  const { error } = await supabase.from("estimate_lines").insert(payload as never);
  if (error) return { error: estimateDbError(error, "estimate_lines.insert"), values };

  revalidatePath(`/estimates/${estimateId}`);
  return { error: null };
}

export async function updateEstimateLine(
  _prev: EstimateLineFormState,
  formData: FormData
): Promise<EstimateLineFormState> {
  const id = String(formData.get("id") ?? "");
  const estimateId = String(formData.get("estimate_id") ?? "");
  if (!UUID_RE.test(id) || !UUID_RE.test(estimateId)) {
    return { error: "Missing line id." };
  }

  const values = lineFormValues(formData);
  const { account } = await requireAccount(`/estimates/${estimateId}`);

  const description = String(formData.get("description") ?? "").trim();
  if (!description) return { error: "Give the line a description.", values };

  const quantity = parseQuantity(String(formData.get("quantity") ?? ""));
  if (quantity === undefined) {
    return { error: "Quantity must be a positive number, like 1 or 2.5.", values };
  }

  const unitAmountCents = parseDollarsToCents(String(formData.get("unit_amount") ?? ""));
  if (unitAmountCents === undefined || unitAmountCents === null || unitAmountCents < 0) {
    return { error: "Unit amount must be an amount like 1500 or 1500.00.", values };
  }

  const taxable = formData.get("taxable") === "on";

  const supabase = await createClient();
  const payload: EstimateLineUpdate = {
    description,
    quantity,
    unit_amount_cents: unitAmountCents,
    taxable,
  };

  const { error, count } = await supabase
    .from("estimate_lines")
    .update(payload as never, { count: "exact" })
    .eq("id", id)
    .eq("account_id", account.id); // defence in depth alongside RLS

  if (error) return { error: estimateDbError(error, "estimate_lines.update"), values };
  if (!count) return { error: "That line no longer exists.", values };

  revalidatePath(`/estimates/${estimateId}`);
  return { error: null };
}

export async function deleteEstimateLine(
  id: string,
  estimateId: string
): Promise<{ error: string | null }> {
  if (!UUID_RE.test(id) || !UUID_RE.test(estimateId)) {
    return { error: "That line is no longer on this estimate." };
  }

  const { account } = await requireAccount(`/estimates/${estimateId}`);
  const supabase = await createClient();

  const { error, count } = await supabase
    .from("estimate_lines")
    .delete({ count: "exact" })
    .eq("id", id)
    .eq("account_id", account.id);

  if (error) return { error: estimateDbError(error, "estimate_lines.delete") };
  // PostgREST returns 200 with no error for a delete that matched nothing —
  // "no error" is not "it's gone" on a money document.
  if (count === 0) return { error: "That line is no longer on this estimate." };

  revalidatePath(`/estimates/${estimateId}`);
  return { error: null };
}

"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireEntitlement } from "@/lib/supabase/entitlements";
import { parseDollarsToCents } from "@/lib/format";
import { friendlyDbError } from "@/lib/db-errors";
import { sendEstimateEmail } from "@/lib/email/send-estimate";
import { MAX_CUSTOM_MESSAGE_CHARS } from "@/lib/email/invoice-message";
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

/**
 * REVIEW FINDING (P1, stale-draft mutations): the database deliberately
 * permits header and line edits on a SENT estimate (the phase 10 grant
 * hands `authenticated` UPDATE on client_id/valid_until/tax_rate_bps/…
 * with no status condition, and estimates_protect only freezes a quote
 * once CONVERTED) — softer than invoices on purpose, because "revise and
 * re-send" is the estimate lifecycle. The UI's draft-only discipline is
 * therefore enforced HERE: a draft screen left open in one tab while
 * another tab sends or accepts must not keep writing to a quote the
 * client has already seen. Every draft-only mutation carries
 * `.eq("status", "draft")` in its own statement, counts its matches, and
 * turns zero matches into this sentence rather than "Saved."
 */
const ESTIMATE_NOT_DRAFT_ERROR =
  "This estimate is no longer a draft. Reload the page to see where it stands.";

type Supa = Awaited<ReturnType<typeof createClient>>;

/**
 * A draft-only write matched zero rows: either the estimate left draft
 * since the page loaded, or it's gone entirely. One follow-up read tells
 * the two apart so the pilot gets the right instruction. If that read
 * itself fails, say "reload" — it's the correct move in every case and
 * never claims a quote was deleted when we simply couldn't find out.
 */
async function staleEstimateError(
  supabase: Supa,
  id: string,
  accountId: string
): Promise<string> {
  const { data, error } = await supabase
    .from("estimates")
    .select("status")
    .eq("id", id)
    .eq("account_id", accountId)
    .maybeSingle();
  if (error) return ESTIMATE_NOT_DRAFT_ERROR;
  return data ? ESTIMATE_NOT_DRAFT_ERROR : "That estimate no longer exists.";
}

/**
 * The draft gate for LINE writes. PostgREST gives an UPDATE/DELETE on
 * pilot.estimate_lines no way to reference the parent row in the same
 * statement (embedded-resource filters exist for reads only), so the
 * parent estimate row ITSELF is the guard: a conditional same-value
 * UPDATE (`set status = 'draft' where … and status = 'draft'`, zero data
 * change, passes estimates_protect because the status is not changing).
 *
 * Why an UPDATE and not a SELECT re-check: the UPDATE takes the parent's
 * row lock, so if another tab's send is in flight this statement BLOCKS
 * until that transaction commits and then re-evaluates its WHERE against
 * the new row — count 0, refused. A SELECT would read the pre-send
 * snapshot and wave the write through. What this cannot close is a send
 * that starts and commits entirely between this statement and the line
 * write (PostgREST offers no cross-statement transaction); that residual
 * window is why the count checks on the line writes themselves stay
 * load-bearing, and the schema's own converted-freeze remains the hard
 * backstop.
 */
async function requireDraftEstimate(
  supabase: Supa,
  estimateId: string,
  accountId: string
): Promise<string | null> {
  const { error, count } = await supabase
    .from("estimates")
    .update({ status: "draft" } as never, { count: "exact" })
    .eq("id", estimateId)
    .eq("account_id", accountId) // defence in depth alongside RLS
    .eq("status", "draft");
  if (error) return estimateDbError(error, "estimates.draft_guard");
  if (!count) return staleEstimateError(supabase, estimateId, accountId);
  return null;
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
  const { account } = await requireEntitlement("estimates", "/estimates/new");

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

  const { account } = await requireEntitlement("estimates", `/estimates/${id}`);

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
  // `.eq("status", "draft")` makes the draft-only rule part of the SAME
  // statement: if another tab sent or accepted this quote while the form
  // sat open, the WHERE matches nothing and nothing is written — the DB
  // itself would happily update a sent estimate's header (see
  // ESTIMATE_NOT_DRAFT_ERROR's note), so the condition must ride the
  // write, not a separate check before it.
  const { error, count } = await supabase
    .from("estimates")
    .update(payload as never, { count: "exact" })
    .eq("id", id)
    .eq("account_id", account.id) // defence in depth alongside RLS
    .eq("status", "draft");

  if (error) {
    // The one 23514 a validated form can still hit: a revised estimate
    // (sent once, back in draft) already carries issued_on, and the
    // migration's CHECK refuses a valid_until before it.
    if (error.code === "23514") {
      return {
        error:
          "Those dates don't work together. The valid-until date can't be before the issue date this estimate already carries.",
        values: echo(formData),
      };
    }
    return { error: estimateDbError(error, "estimates.update"), values: echo(formData) };
  }
  if (!count) {
    return {
      error: await staleEstimateError(supabase, id, account.id),
      values: echo(formData),
    };
  }

  revalidatePath(`/estimates/${id}`);
  revalidatePath("/estimates");
  return { error: null, saved: true };
}

/** Notes-only edit, valid in any status (notes stays writable throughout),
 *  so — deliberately — NO `.eq("status", "draft")` here: the locked header
 *  form posts this for sent/accepted/declined quotes too. */
export async function updateEstimateNotes(
  _prev: EstimateFormState,
  formData: FormData
): Promise<EstimateFormState> {
  const id = String(formData.get("id") ?? "");
  if (!UUID_RE.test(id)) return { error: "Missing estimate id." };

  const { account } = await requireEntitlement("estimates", `/estimates/${id}`);
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

  const { account } = await requireEntitlement("estimates", `/estimates/${id}`);
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

  const { account } = await requireEntitlement("estimates", `/estimates/${id}`);
  const supabase = await createClient();

  const { error, count } = await supabase
    .from("estimates")
    .delete({ count: "exact" })
    .eq("id", id)
    .eq("account_id", account.id)
    // The RLS policy already refuses anything but an unnumbered draft;
    // stated here too so this statement reads as the draft-only mutation
    // it is, same as every other one in this file.
    .eq("status", "draft");

  if (error) return { error: friendlyDbError(error, "estimates.delete") };
  if (count === 0) {
    return {
      error:
        "This estimate couldn't be deleted. Once one has been sent it keeps its number and its record. It may have moved on since this page loaded.",
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

  await requireEntitlement("estimates", `/estimates/${id}`);
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
        "The conversion didn't confirm. Reload this page. If the estimate shows as converted, open the invoice from here.",
    };
  }

  revalidatePath(`/estimates/${id}`);
  revalidatePath("/estimates");
  revalidatePath("/invoices");
  redirect(`/invoices/${newInvoiceId}`);
}

// ---------------------------------------------------------------------------
// Lines. The DATABASE keeps these editable until the quote becomes an
// invoice (estimate_lines_protect_converted); the draft-only rule is this
// app's own, narrower, deliberate choice: a sent quote is revised by
// taking it back to draft first, so what the client saw and what the
// pilot edited never silently diverge. That rule is enforced by
// requireDraftEstimate in each action below — not just by which screens
// render an edit control — because a draft screen left open in a stale
// tab still posts here after another tab has sent or accepted the quote.
// ---------------------------------------------------------------------------
export async function addEstimateLine(
  _prev: EstimateLineFormState,
  formData: FormData
): Promise<EstimateLineFormState> {
  const estimateId = String(formData.get("estimate_id") ?? "");
  if (!UUID_RE.test(estimateId)) return { error: "Missing estimate id." };

  const values = lineFormValues(formData);
  const { account } = await requireEntitlement("estimates", `/estimates/${estimateId}`);

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

  const guardError = await requireDraftEstimate(supabase, estimateId, account.id);
  if (guardError) return { error: guardError, values };

  // REVIEW FINDING (appended lines tie at sort_order 0): the column
  // defaults to 0, so every appended line used to land in a tie whose
  // resolution could change between reads. Append AFTER the current last
  // line instead. Two simultaneous adds can still mint the same value —
  // the (sort_order, id) read order below and on the detail page keeps
  // even that tie stable.
  const { data: lastLine, error: lastLineError } = await supabase
    .from("estimate_lines")
    .select("sort_order")
    .eq("estimate_id", estimateId)
    .eq("account_id", account.id)
    .order("sort_order", { ascending: false })
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (lastLineError) {
    return { error: estimateDbError(lastLineError, "estimate_lines.sort_order"), values };
  }
  const sortOrder = ((lastLine as { sort_order: number } | null)?.sort_order ?? -1) + 1;

  const payload: EstimateLineInsert = {
    account_id: account.id,
    estimate_id: estimateId,
    line_type: lineType as EstimateLineInsert["line_type"],
    description,
    quantity,
    unit_amount_cents: unitAmountCents,
    taxable,
    sort_order: sortOrder,
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
  const { account } = await requireEntitlement("estimates", `/estimates/${estimateId}`);

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

  const guardError = await requireDraftEstimate(supabase, estimateId, account.id);
  if (guardError) return { error: guardError, values };

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
    .eq("account_id", account.id) // defence in depth alongside RLS
    .eq("estimate_id", estimateId); // the guard above vouched for THIS parent, no other

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

  const { account } = await requireEntitlement("estimates", `/estimates/${estimateId}`);
  const supabase = await createClient();

  const guardError = await requireDraftEstimate(supabase, estimateId, account.id);
  if (guardError) return { error: guardError };

  const { error, count } = await supabase
    .from("estimate_lines")
    .delete({ count: "exact" })
    .eq("id", id)
    .eq("account_id", account.id)
    .eq("estimate_id", estimateId); // the guard above vouched for THIS parent, no other

  if (error) return { error: estimateDbError(error, "estimate_lines.delete") };
  // PostgREST returns 200 with no error for a delete that matched nothing —
  // "no error" is not "it's gone" on a money document.
  if (count === 0) return { error: "That line is no longer on this estimate." };

  revalidatePath(`/estimates/${estimateId}`);
  return { error: null };
}

// ---------------------------------------------------------------------------
// Emailing the estimate itself — the client-facing send, distinct from
// markEstimateSent (which only records that the pilot quoted the client some
// other way). Mirrors sendInvoiceReminder's shape: it never touches status,
// so it works on sent, accepted and declined estimates alike — but it
// refuses a draft, which has no permanent number and is not a document a
// client should ever hold.
// ---------------------------------------------------------------------------
export async function sendEstimate(
  id: string,
  /** The pilot's per-send note. Bounded and trimmed here; null/empty means
   *  the standard message alone goes out. */
  customMessage: string | null = null
): Promise<{ error: string | null }> {
  if (!UUID_RE.test(id)) return { error: "That estimate no longer exists." };

  const { user, account } = await requireEntitlement("estimates", `/estimates/${id}`);

  // Checked before anything else so an over-long note refuses cleanly with
  // nothing sent — same ordering argument as sendInvoice's.
  const note = customMessage?.trim() ?? "";
  if (note.length > MAX_CUSTOM_MESSAGE_CHARS) {
    return {
      error: `That message is longer than ${MAX_CUSTOM_MESSAGE_CHARS} characters. Nothing was sent. Shorten it and try again.`,
    };
  }

  const supabase = await createClient();

  const { data: row, error: readError } = await supabase
    .from("estimates")
    .select("status")
    .eq("id", id)
    .eq("account_id", account.id)
    .maybeSingle();
  if (readError) return { error: estimateDbError(readError, "estimates.send_email") };
  if (!row) return { error: "That estimate no longer exists." };
  if ((row as { status: string }).status === "draft") {
    return {
      error: "This estimate is still a draft. Send it (which assigns its number) before emailing it.",
    };
  }

  const sent = await sendEstimateEmail(supabase, account.id, id, user.email, note === "" ? null : note);
  if (!sent.ok) return { error: sent.error };

  revalidatePath(`/estimates/${id}`);
  return { error: null };
}

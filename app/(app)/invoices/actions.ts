"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireAccount } from "@/lib/supabase/account";
import { parseDollarsToCents } from "@/lib/format";
import { friendlyDbError } from "@/lib/db-errors";
import type { Database } from "@/lib/supabase/database.types";

type InvoiceInsert = Database["pilot"]["Tables"]["invoices"]["Insert"];
type InvoiceUpdate = Database["pilot"]["Tables"]["invoices"]["Update"];
type LineInsert = Database["pilot"]["Tables"]["invoice_lines"]["Insert"];
type LineUpdate = Database["pilot"]["Tables"]["invoice_lines"]["Update"];
type PaymentInsert = Database["pilot"]["Tables"]["invoice_payments"]["Insert"];

/**
 * `values` echoes what was submitted so a rejected form can repopulate
 * itself — React 19 resets an uncontrolled form on every action dispatch,
 * including the error path (same pattern as trips/actions.ts).
 */
export type InvoiceFormState = {
  error: string | null;
  saved?: boolean;
  values?: Record<string, string>;
};
export type LineFormState = { error: string | null };

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** "YYYY-MM-DD", and a date that actually exists. */
function isDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(value);
}

function optional(formData: FormData, key: string): string | null {
  const value = String(formData.get(key) ?? "").trim();
  return value === "" ? null : value;
}

/** Fields updateInvoiceHeader's form submits — mirrors expenses/actions.ts's echo(). */
const INVOICE_HEADER_FIELDS = [
  "client_id",
  "issued_on",
  "due_on",
  "tax_rate_percent",
  "notes",
] as const;

/**
 * `values` echoes what was submitted so a rejected form can repopulate
 * itself — React 19 resets an uncontrolled form on every action dispatch,
 * including the error path, and without this the pilot's edits vanish on
 * any validation error (same pattern as expenses/actions.ts's echo()).
 */
function echo(formData: FormData) {
  const out: Record<string, string> = {};
  for (const field of INVOICE_HEADER_FIELDS) out[field] = String(formData.get(field) ?? "");
  return out;
}

/**
 * A tax percent input ("8.25") to the basis-points integer the column
 * stores ("825"). Kept local to this file rather than lib/format.ts
 * (owned by another agent's work right now) — the arithmetic is trivial
 * and specific to this one field.
 */
function parsePercentToBps(raw: string): number | null | undefined {
  const value = raw.trim();
  if (value === "") return null;
  if (!/^\d{1,2}(\.\d{1,2})?$/.test(value)) return undefined;
  const bps = Math.round(Number(value) * 100);
  if (!Number.isFinite(bps) || bps < 0 || bps > 2500) return undefined;
  return bps;
}

/**
 * A quantity destined for invoice_lines.quantity, numeric(6,2). Checked
 * here for the same reason lib/format.ts's parseTenth checks numeric(5,1)
 * columns: Postgres would silently ROUND an out-of-scale value rather than
 * reject it, and a server action is a public POST endpoint that cannot
 * rely on the browser's <input step> to have been honored.
 */
function parseQuantity(raw: string): number | undefined {
  const value = raw.trim();
  if (!/^\d{1,4}(\.\d{1,2})?$/.test(value)) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 9999) return undefined;
  return parsed;
}

const MANUAL_LINE_TYPES = [
  "flight_day",
  "travel_day",
  "per_diem",
  "cancellation_fee",
  "other",
] as const;

// ---------------------------------------------------------------------------
// Draft an invoice from a client + selected unbilled trips.
//
// There is no SQL drafting function in the Phase 5 migration (checked: the
// migration adds next_invoice_number() for numbering only, nothing that
// turns a trip into invoice lines) — so the flight_day/travel_day/rebill
// arithmetic happens here, from server-refetched trip and expense rows,
// never from client-submitted amounts.
// ---------------------------------------------------------------------------
export async function createInvoiceDraft(
  _prev: InvoiceFormState,
  formData: FormData
): Promise<InvoiceFormState> {
  const { account } = await requireAccount("/invoices/new");

  const clientId = String(formData.get("client_id") ?? "").trim();
  if (!UUID_RE.test(clientId)) {
    return { error: "Choose a client to bill.", values: { client_id: clientId } };
  }

  const taxBps = parsePercentToBps(String(formData.get("tax_rate_percent") ?? ""));
  if (taxBps === undefined) {
    return {
      error: "Tax rate must be a percent like 8.25, up to 25%.",
      values: { client_id: clientId },
    };
  }

  const tripIds = formData
    .getAll("trip_ids")
    .map((v) => String(v))
    .filter((v) => UUID_RE.test(v));

  const supabase = await createClient();

  const invoicePayload: InvoiceInsert = {
    account_id: account.id,
    client_id: clientId,
    tax_rate_bps: taxBps ?? 0,
  };
  const { data: invoiceData, error: invoiceError } = await supabase
    .from("invoices")
    .insert(invoicePayload as never)
    .select("id")
    .single();

  if (invoiceError) {
    return {
      error: friendlyDbError(invoiceError, "invoices.insert"),
      values: { client_id: clientId },
    };
  }

  const invoiceId = (invoiceData as { id: string }).id;

  if (tripIds.length === 0) {
    revalidatePath("/invoices");
    redirect(`/invoices/${invoiceId}`);
  }

  // Re-fetch trips server-side, scoped to this tenant AND this client —
  // never trust a submitted trip id's rate/day-count, and never let a
  // trip belonging to a different client sneak a line onto this invoice
  // (the invoice_lines_validate_trip trigger would also reject it, but
  // failing here is a clearer message than a raised exception).
  const { data: tripRows, error: tripsError } = await supabase
    .from("trips")
    .select(
      "id, client_id, starts_on, ends_on, day_rate_cents, day_count, travel_day_count, travel_day_rate_cents, billing_state"
    )
    .eq("account_id", account.id)
    .eq("client_id", clientId)
    // The picker only OFFERS completed trips, but a server action is a
    // public endpoint and the offered set is not the enforced set. Without
    // this a crafted POST could draft an invoice from a scheduled or
    // in-progress trip, whose day count is still moving — billing a client
    // for a job that has not finished.
    .eq("status", "completed")
    .in("id", tripIds);

  if (tripsError) {
    redirect(
      `/invoices/${invoiceId}?warning=${encodeURIComponent(
        friendlyDbError(tripsError, "trips.select")
      )}`
    );
  }

  type TripRow = {
    id: string;
    starts_on: string;
    ends_on: string;
    day_rate_cents: number;
    day_count: number;
    travel_day_count: number;
    travel_day_rate_cents: number | null;
    billing_state: string;
  };
  const trips = ((tripRows ?? []) as TripRow[]).filter(
    (t) => t.billing_state === "unbilled"
  );

  const { data: expenseRows, error: expensesError } = await supabase
    .from("expenses")
    .select("id, trip_id, category, vendor, amount_cents, incurred_on, treatment")
    .eq("account_id", account.id)
    .eq("treatment", "rebill")
    .in(
      "trip_id",
      trips.map((t) => t.id)
    );

  if (expensesError) {
    redirect(
      `/invoices/${invoiceId}?warning=${encodeURIComponent(
        friendlyDbError(expensesError, "expenses.select")
      )}`
    );
  }

  type ExpenseRow = {
    id: string;
    trip_id: string | null;
    category: string;
    vendor: string | null;
    amount_cents: number;
    incurred_on: string;
  };
  const expenses = (expenseRows ?? []) as ExpenseRow[];

  const lines: LineInsert[] = [];
  let sortOrder = 0;
  let skippedTravelDays = false;

  for (const trip of trips) {
    if (Number(trip.day_count) > 0) {
      lines.push({
        account_id: account.id,
        invoice_id: invoiceId,
        line_type: "flight_day",
        description: `Flight days — ${trip.starts_on} to ${trip.ends_on}`,
        quantity: trip.day_count,
        unit_amount_cents: trip.day_rate_cents,
        taxable: true,
        trip_id: trip.id,
        sort_order: sortOrder++,
      });
    }
    if (Number(trip.travel_day_count) > 0) {
      // A travel day with no rate on the trip has nothing to price it
      // with — dropped rather than billed at $0, and reported in the
      // warning so the pilot notices instead of the trip silently
      // undercharging.
      if (trip.travel_day_rate_cents !== null) {
        lines.push({
          account_id: account.id,
          invoice_id: invoiceId,
          line_type: "travel_day",
          description: `Travel days — ${trip.starts_on} to ${trip.ends_on}`,
          quantity: trip.travel_day_count,
          unit_amount_cents: trip.travel_day_rate_cents,
          taxable: true,
          trip_id: trip.id,
          sort_order: sortOrder++,
        });
      } else {
        skippedTravelDays = true;
      }
    }
  }

  for (const expense of expenses) {
    lines.push({
      account_id: account.id,
      invoice_id: invoiceId,
      line_type: "reimbursable_expense",
      description: `${categoryLabel(expense.category)}${
        expense.vendor ? ` — ${expense.vendor}` : ""
      } (${expense.incurred_on})`,
      quantity: 1,
      unit_amount_cents: expense.amount_cents,
      // C10: a straight expense reimbursement is commonly not taxable —
      // see the migration's invoice_lines.taxable comment.
      taxable: false,
      expense_id: expense.id,
      expense_treatment: "rebill",
      sort_order: sortOrder++,
    });
  }

  if (lines.length > 0) {
    // One batch insert: either every line lands or none do (a single
    // Postgres statement), so a mid-batch trigger rejection (e.g. a trip
    // already billed on another live invoice, caught by
    // invoice_lines_validate_trip's double-bill guard) never leaves the
    // draft with half its lines.
    const { error: linesError } = await supabase
      .from("invoice_lines")
      .insert(lines as never);

    if (linesError) {
      // The header invoice already exists (it is a valid, empty draft —
      // sending it is blocked by the migration's own "no line items"
      // check until lines are added, by hand, from the invoice screen).
      // There is no cross-table transaction available from app code here
      // (no drafting RPC exists in the schema to wrap both writes), so
      // this is the best correctness this call site can offer.
      redirect(
        `/invoices/${invoiceId}?warning=${encodeURIComponent(
          `Created the draft, but couldn't add the trip lines: ${friendlyDbError(
            linesError,
            "invoice_lines.insert"
          )}`
        )}`
      );
    }
  }

  revalidatePath("/invoices");
  revalidatePath("/trips");
  if (skippedTravelDays) {
    redirect(
      `/invoices/${invoiceId}?warning=${encodeURIComponent(
        "One or more trips had travel days but no travel day rate set, so those days weren't billed. Add a rate on the trip and re-draft, or add a line by hand."
      )}`
    );
  }
  redirect(`/invoices/${invoiceId}`);
}

function categoryLabel(category: string): string {
  const labels: Record<string, string> = {
    airline: "Airline",
    hotel: "Hotel",
    rental_car: "Rental car",
    rideshare: "Rideshare",
    fuel: "Fuel",
    meals: "Meals",
    parking: "Parking",
    other: "Expense",
  };
  return labels[category] ?? "Expense";
}

// ---------------------------------------------------------------------------
// Header edits — only meaningful while draft. The grant permits writing
// these columns in any state, but invoices_protect_issued rejects the
// write once status has left 'draft'; that trigger IS the server-side
// enforcement here, not just the disabled inputs on the page.
// ---------------------------------------------------------------------------
export async function updateInvoiceHeader(
  _prev: InvoiceFormState,
  formData: FormData
): Promise<InvoiceFormState> {
  const id = String(formData.get("id") ?? "");
  if (!UUID_RE.test(id)) return { error: "Missing invoice id.", values: echo(formData) };

  const { account } = await requireAccount(`/invoices/${id}`);

  const clientId = String(formData.get("client_id") ?? "").trim();
  if (!UUID_RE.test(clientId)) {
    return { error: "Choose a client to bill.", values: echo(formData) };
  }

  const issuedOn = optional(formData, "issued_on");
  if (issuedOn !== null && !isDate(issuedOn)) {
    return { error: "That issue date isn't valid.", values: echo(formData) };
  }
  const dueOn = optional(formData, "due_on");
  if (dueOn !== null && !isDate(dueOn)) {
    return { error: "That due date isn't valid.", values: echo(formData) };
  }

  const taxBps = parsePercentToBps(String(formData.get("tax_rate_percent") ?? ""));
  if (taxBps === undefined) {
    return { error: "Tax rate must be a percent like 8.25, up to 25%.", values: echo(formData) };
  }

  const payload: InvoiceUpdate = {
    client_id: clientId,
    issued_on: issuedOn,
    due_on: dueOn,
    tax_rate_bps: taxBps ?? 0,
    notes: optional(formData, "notes"),
  };

  const supabase = await createClient();
  // { count: "exact" } because PostgREST returns 200 with no error on a
  // write that matched zero rows — a wrong id, another tenant's row, or
  // (the real case here) an issued invoice that invoices_protect_issued
  // silently... actually the trigger RAISES, so it errors loudly; the
  // count check instead catches the id-not-found/cross-tenant case, which
  // an error-only check would miss entirely.
  const { error, count } = await supabase
    .from("invoices")
    .update(payload as never, { count: "exact" })
    .eq("id", id)
    .eq("account_id", account.id); // defence in depth alongside RLS

  if (error) {
    return { error: friendlyDbError(error, "invoices.update"), values: echo(formData) };
  }
  if (!count) {
    return { error: "That invoice no longer exists.", values: echo(formData) };
  }

  revalidatePath(`/invoices/${id}`);
  revalidatePath("/invoices");
  return { error: null, saved: true };
}

/** Notes-only edit, valid in any status (notes stays writable once issued). */
export async function updateInvoiceNotes(
  _prev: InvoiceFormState,
  formData: FormData
): Promise<InvoiceFormState> {
  const id = String(formData.get("id") ?? "");
  if (!UUID_RE.test(id)) return { error: "Missing invoice id." };

  const { account } = await requireAccount(`/invoices/${id}`);
  const supabase = await createClient();

  const payload: InvoiceUpdate = { notes: optional(formData, "notes") };
  const { error, count } = await supabase
    .from("invoices")
    .update(payload as never, { count: "exact" })
    .eq("id", id)
    .eq("account_id", account.id);

  if (error) return { error: friendlyDbError(error, "invoices.update") };
  if (!count) return { error: "That invoice no longer exists." };

  revalidatePath(`/invoices/${id}`);
  return { error: null, saved: true };
}

// ---------------------------------------------------------------------------
// Status transitions. The forward-only state machine and its column
// restrictions live in invoices_protect_issued/invoices_assign_number_on_
// issue — these actions only supply the intent, never bypass the trigger.
// ---------------------------------------------------------------------------
export async function sendInvoice(
  id: string,
  deliveryMethod: "platform_email" | "manual_download"
): Promise<{ error: string | null }> {
  // Validated the same way updateInvoiceHeader validates its id — an
  // unvalidated string reaches Postgres as a malformed uuid, which
  // surfaces as a raw 22P02 error instead of an honest "not found".
  if (!UUID_RE.test(id)) return { error: "That invoice no longer exists." };

  const { account } = await requireAccount(`/invoices/${id}`);
  const supabase = await createClient();

  const payload: InvoiceUpdate = {
    status: "sent",
    sent_at: new Date().toISOString(),
    delivery_method: deliveryMethod,
  };
  const { error, count } = await supabase
    .from("invoices")
    .update(payload as never, { count: "exact" })
    .eq("id", id)
    .eq("account_id", account.id);

  if (error) return { error: friendlyDbError(error, "invoices.update") };
  if (!count) return { error: "That invoice no longer exists." };

  revalidatePath(`/invoices/${id}`);
  revalidatePath("/invoices");
  revalidatePath("/trips");
  return { error: null };
}

export async function voidInvoice(id: string): Promise<{ error: string | null }> {
  if (!UUID_RE.test(id)) return { error: "That invoice no longer exists." };

  const { account } = await requireAccount(`/invoices/${id}`);
  const supabase = await createClient();

  const payload: InvoiceUpdate = { status: "void" };
  const { error, count } = await supabase
    .from("invoices")
    .update(payload as never, { count: "exact" })
    .eq("id", id)
    .eq("account_id", account.id);

  if (error) return { error: friendlyDbError(error, "invoices.update") };
  if (!count) return { error: "That invoice no longer exists." };

  revalidatePath(`/invoices/${id}`);
  revalidatePath("/invoices");
  revalidatePath("/trips");
  return { error: null };
}

// ---------------------------------------------------------------------------
// Lines — draft only (invoice_lines_protect_issued enforces this in the
// database regardless of what this action sends).
// ---------------------------------------------------------------------------
export async function addInvoiceLine(
  _prev: LineFormState,
  formData: FormData
): Promise<LineFormState> {
  const invoiceId = String(formData.get("invoice_id") ?? "");
  if (!UUID_RE.test(invoiceId)) return { error: "Missing invoice id." };

  const { account } = await requireAccount(`/invoices/${invoiceId}`);

  const lineType = String(formData.get("line_type") ?? "");
  if (!(MANUAL_LINE_TYPES as readonly string[]).includes(lineType)) {
    // reimbursable_expense is deliberately excluded from manual add — the
    // migration's own CHECK ties that line_type to an actual expense_id;
    // use the "add a rebillable expense" list instead, which sets both
    // together.
    return { error: "Choose a line type." };
  }

  const description = String(formData.get("description") ?? "").trim();
  if (!description) return { error: "Give the line a description." };

  const quantity = parseQuantity(String(formData.get("quantity") ?? ""));
  if (quantity === undefined) {
    return { error: "Quantity must be a positive number, like 1 or 2.5." };
  }

  const unitAmountCents = parseDollarsToCents(
    String(formData.get("unit_amount") ?? "")
  );
  if (unitAmountCents === undefined || unitAmountCents === null || unitAmountCents < 0) {
    return { error: "Unit amount must be an amount like 150 or 150.00." };
  }

  const taxable = formData.get("taxable") === "on";
  const tripId = optional(formData, "trip_id");
  if (tripId !== null && !UUID_RE.test(tripId)) {
    return { error: "That trip isn't valid." };
  }

  const supabase = await createClient();
  const payload: LineInsert = {
    account_id: account.id,
    invoice_id: invoiceId,
    line_type: lineType as LineInsert["line_type"],
    description,
    quantity,
    unit_amount_cents: unitAmountCents,
    taxable,
    trip_id: tripId,
  };

  const { error } = await supabase.from("invoice_lines").insert(payload as never);
  if (error) return { error: friendlyDbError(error, "invoice_lines.insert") };

  revalidatePath(`/invoices/${invoiceId}`);
  return { error: null };
}

/** Adds a specific unbilled `treatment='rebill'` expense as its own line. */
export async function addRebillExpenseLine(
  invoiceId: string,
  expenseId: string
): Promise<{ error: string | null }> {
  if (!UUID_RE.test(invoiceId) || !UUID_RE.test(expenseId)) {
    return { error: "Missing invoice or expense id." };
  }
  const { account } = await requireAccount(`/invoices/${invoiceId}`);
  const supabase = await createClient();

  // Re-fetched server-side rather than trusting a submitted amount — the
  // expense row is the only source of truth for what it cost.
  const { data, error: readError } = await supabase
    .from("expenses")
    .select("id, category, vendor, amount_cents, incurred_on, treatment")
    .eq("id", expenseId)
    .eq("account_id", account.id)
    .maybeSingle();

  if (readError) return { error: friendlyDbError(readError, "expenses.select") };
  const expense = data as
    | { id: string; category: string; vendor: string | null; amount_cents: number; incurred_on: string; treatment: string }
    | null;
  if (!expense || expense.treatment !== "rebill") {
    return { error: "That expense isn't available to rebill." };
  }

  const payload: LineInsert = {
    account_id: account.id,
    invoice_id: invoiceId,
    line_type: "reimbursable_expense",
    description: `${categoryLabel(expense.category)}${
      expense.vendor ? ` — ${expense.vendor}` : ""
    } (${expense.incurred_on})`,
    quantity: 1,
    unit_amount_cents: expense.amount_cents,
    taxable: false,
    expense_id: expense.id,
    expense_treatment: "rebill",
  };

  const { error } = await supabase.from("invoice_lines").insert(payload as never);
  if (error) return { error: friendlyDbError(error, "invoice_lines.insert") };

  revalidatePath(`/invoices/${invoiceId}`);
  return { error: null };
}

export async function updateInvoiceLine(
  _prev: LineFormState,
  formData: FormData
): Promise<LineFormState> {
  const id = String(formData.get("id") ?? "");
  const invoiceId = String(formData.get("invoice_id") ?? "");
  if (!UUID_RE.test(id) || !UUID_RE.test(invoiceId)) {
    return { error: "Missing line id." };
  }

  const { account } = await requireAccount(`/invoices/${invoiceId}`);

  const description = String(formData.get("description") ?? "").trim();
  if (!description) return { error: "Give the line a description." };

  const quantity = parseQuantity(String(formData.get("quantity") ?? ""));
  if (quantity === undefined) {
    return { error: "Quantity must be a positive number, like 1 or 2.5." };
  }

  const unitAmountCents = parseDollarsToCents(
    String(formData.get("unit_amount") ?? "")
  );
  if (unitAmountCents === undefined || unitAmountCents === null || unitAmountCents < 0) {
    return { error: "Unit amount must be an amount like 150 or 150.00." };
  }

  const taxable = formData.get("taxable") === "on";

  const supabase = await createClient();
  const payload: LineUpdate = {
    description,
    quantity,
    unit_amount_cents: unitAmountCents,
    taxable,
  };

  const { error, count } = await supabase
    .from("invoice_lines")
    .update(payload as never, { count: "exact" })
    .eq("id", id)
    .eq("account_id", account.id); // defence in depth alongside RLS

  if (error) return { error: friendlyDbError(error, "invoice_lines.update") };
  if (!count) return { error: "That line no longer exists." };

  revalidatePath(`/invoices/${invoiceId}`);
  return { error: null };
}

export async function deleteInvoiceLine(
  id: string,
  invoiceId: string
): Promise<{ error: string | null }> {
  if (!UUID_RE.test(id) || !UUID_RE.test(invoiceId)) {
    return { error: "That line is no longer on this invoice." };
  }

  const { account } = await requireAccount(`/invoices/${invoiceId}`);
  const supabase = await createClient();

  const { error, count } = await supabase
    .from("invoice_lines")
    .delete({ count: "exact" })
    .eq("id", id)
    .eq("account_id", account.id);

  if (error) return { error: friendlyDbError(error, "invoice_lines.delete") };
  // PostgREST returns 200 with no error for a delete that matched nothing,
  // so "no error" is not "it's gone" — a stale or already-removed line id
  // would otherwise re-render as a successful delete on a money document.
  if (count === 0) return { error: "That line is no longer on this invoice." };

  revalidatePath(`/invoices/${invoiceId}`);
  return { error: null };
}

// ---------------------------------------------------------------------------
// Payments — pilot.invoice_payments has no update/delete grant for
// authenticated (a recorded payment is a ledger entry), so this action is
// insert-only by construction; there is nothing to build a delete/edit path
// for on this surface.
// ---------------------------------------------------------------------------
export async function recordPayment(
  _prev: InvoiceFormState,
  formData: FormData
): Promise<InvoiceFormState> {
  const invoiceId = String(formData.get("invoice_id") ?? "");
  if (!UUID_RE.test(invoiceId)) return { error: "Missing invoice id." };

  const { account } = await requireAccount(`/invoices/${invoiceId}`);

  const paidOn = String(formData.get("paid_on") ?? "").trim();
  if (!paidOn || !isDate(paidOn)) return { error: "Give the payment a valid date." };

  const amountCents = parseDollarsToCents(String(formData.get("amount") ?? ""));
  if (amountCents === undefined || amountCents === null || amountCents <= 0) {
    return { error: "Amount must be a positive amount like 1500 or 1500.00." };
  }

  const methodRaw = optional(formData, "method");
  const methods = ["ach", "check", "wire", "card", "cash", "other"] as const;
  const method = methodRaw && (methods as readonly string[]).includes(methodRaw)
    ? (methodRaw as (typeof methods)[number])
    : null;

  const supabase = await createClient();
  const payload: PaymentInsert = {
    account_id: account.id,
    invoice_id: invoiceId,
    paid_on: paidOn,
    amount_cents: amountCents,
    method,
    notes: optional(formData, "notes"),
  };

  const { error: paymentError } = await supabase
    .from("invoice_payments")
    .insert(payload as never);

  if (paymentError) {
    return { error: friendlyDbError(paymentError, "invoice_payments.insert") };
  }

  // Advance status to match the ledger — pilot.invoice_totals is the one
  // source for the balance (C2/C3), so read it rather than summing here.
  // Only attempted from 'sent'/'partial': invoices_protect_issued already
  // refuses 'draft' -> 'paid'/'partial' and 'paid' has no outbound
  // transition, so there is nothing to advance in either of those states.
  const { data: invoiceData } = await supabase
    .from("invoices")
    .select("status")
    .eq("id", invoiceId)
    .eq("account_id", account.id)
    .maybeSingle();
  const status = (invoiceData as { status: string } | null)?.status;

  if (status === "sent" || status === "partial") {
    const { data: totalsData } = await supabase
      .from("invoice_totals")
      .select("balance_due_cents")
      .eq("invoice_id", invoiceId)
      .maybeSingle();
    const balance = (totalsData as { balance_due_cents: number } | null)
      ?.balance_due_cents;

    if (balance !== undefined) {
      const nextStatus = balance <= 0 ? "paid" : "partial";
      // { count: "exact" } because a swallowed error/zero-match here is the
      // exact defect this exists to prevent: the payment already landed, so
      // balance_due_cents reads 0, but if this UPDATE silently fails the
      // invoice stays 'sent' — still counted as awaiting payment and still
      // showing up as overdue even though it's paid.
      const { error: statusError, count: statusCount } = await supabase
        .from("invoices")
        .update({ status: nextStatus } as never, { count: "exact" })
        .eq("id", invoiceId)
        .eq("account_id", account.id);

      if (statusError || !statusCount) {
        revalidatePath(`/invoices/${invoiceId}`);
        revalidatePath("/invoices");
        revalidatePath("/trips");
        return {
          error:
            "Payment recorded, but the invoice status couldn't be updated to match. Refresh and check its status.",
        };
      }
    }
  }

  revalidatePath(`/invoices/${invoiceId}`);
  revalidatePath("/invoices");
  revalidatePath("/trips");
  return { error: null, saved: true };
}

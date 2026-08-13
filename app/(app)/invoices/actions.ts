"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireAccount } from "@/lib/supabase/account";
import { parseDollarsToCents, formatDate, formatDateRange } from "@/lib/format";
import { friendlyDbError } from "@/lib/db-errors";
import { deactivatePaymentLink, LINK_STILL_LIVE_WARNING } from "@/lib/stripe/connect";
import { isLiveMode } from "@/lib/stripe/server";
import { DASHBOARD_PATH } from "@/lib/nav";
import { buildInvoiceDocument } from "@/lib/invoice-document";
import { sendEmail, emailIsConfigured, looksLikeEmail } from "@/lib/email/send";
import {
  buildInvoiceMessage,
  buildReminderMessage,
  daysOverdue,
  MAX_CUSTOM_MESSAGE_CHARS,
} from "@/lib/email/invoice-message";
import { loadPreferences } from "@/lib/preferences";
import {
  dayQuantityThousandths,
  roundThousandthsToHundredths,
} from "@/lib/trip-value";
import { categoryLabel } from "./labels";
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
  /**
   * Something that happened as a SIDE EFFECT of a successful action and
   * that the pilot needs to know — currently only "recording (or
   * correcting) this payment switched off the online payment link", set by
   * recordPayment and correctPayment alike (both change balance_due_cents,
   * both retire a stale link the same way). Not an error (the thing they
   * asked for worked) and not a validation message, so it renders
   * separately from `error`.
   */
  notice?: string;
};
/**
 * A rejected line edit used to re-render the STORED values, which silently
 * discarded whatever the pilot had just typed — the same error-path data
 * loss the other forms in this product guard against. `values` echoes the
 * submission back so the row shows what was actually entered.
 *
 * Optional so both call sites can keep returning a bare `{ error }` on the
 * paths where there is nothing worth echoing (a missing invoice id means
 * the form was not the source of the problem).
 */
export type LineFormValues = {
  line_type?: string;
  description?: string;
  quantity?: string;
  unit_amount?: string;
  taxable?: string;
  trip_id?: string;
};

export type LineFormState = { error: string | null; values?: LineFormValues };

/** Every field the line form posts, as submitted, for the error path. */
function lineFormValues(formData: FormData): LineFormValues {
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
    trip_id: str("trip_id"),
  };
}

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

/**
 * Rounds a day-line quantity to invoice_lines.quantity's numeric(6,2)
 * scale. Summing several trip_days.quantity values (each 0.1-1.0, one
 * decimal place) can only ever produce a result with at most one decimal
 * place mathematically, but IEEE 754 float addition doesn't know that —
 * 0.1 + 0.2 is 0.30000000000000004 in JS. This is a guard against that
 * drift, not a fudge: it never changes what the sum "should" be, it only
 * removes noise below the column's own scale.
 *
 * NOT SUFFICIENT ON ITS OWN for a sum of `quantity * units` products — see
 * dayQuantityThousandths in lib/trip-value.ts. Those products carry three
 * decimals, so a group sum can land exactly on a .xx5 boundary, and at that
 * boundary the double is as likely to sit below the true value as on it:
 * `0.5 * 0.29` is 0.14499999999999999, which this rounds DOWN to 0.14 while
 * the exact 0.145 rounds up to 0.15. Every day-row group therefore
 * accumulates in integer thousandths and rounds with
 * roundThousandthsToHundredths; this function is kept for the quantities
 * that are already at 2dp scale (a minimum's shortfall, a sum of emitted
 * line quantities), where no such boundary case exists.
 */
function roundQuantity(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * F3: a day-row group's dates, rendered for an invoice line description.
 * Contiguous dates ("Mar 1 to Mar 4") read as a span the way the fixed
 * flight_day/travel_day lines always have; non-contiguous dates ("Mar 1,
 * Mar 3, Mar 5") are listed individually instead, because a min→max span
 * over a gap reads as billing the days in between too. `sortedIsoDates`
 * must already be sorted ascending — every caller sorts before calling.
 */
function describeDayDates(sortedIsoDates: string[]): string {
  if (isContiguous(sortedIsoDates)) {
    return formatDateRange(sortedIsoDates[0], sortedIsoDates[sortedIsoDates.length - 1]);
  }
  return sortedIsoDates.map((iso) => formatDate(iso)).join(", ");
}

/** Whether a sorted list of "YYYY-MM-DD" dates has no gaps — each date is
 * exactly one calendar day after the one before it. A single date (or an
 * empty list) is trivially contiguous. */
function isContiguous(sortedIsoDates: string[]): boolean {
  for (let i = 1; i < sortedIsoDates.length; i++) {
    const prev = new Date(`${sortedIsoDates[i - 1]}T00:00:00Z`);
    const curr = new Date(`${sortedIsoDates[i]}T00:00:00Z`);
    const diffDays = (curr.getTime() - prev.getTime()) / 86_400_000;
    if (diffDays !== 1) return false;
  }
  return true;
}

/**
 * F6: friendlyDbError scrubs every error code it doesn't recognize —
 * including invoice_lines_validate_trip's double-bill guard, which does a
 * plain `raise exception` with no explicit errcode and so defaults to
 * P0001 — down to a generic "Couldn't save that. Try again." That's safe
 * (no raw exception reaches the browser) but useless: it doesn't tell the
 * pilot which trip conflicted or that the fix is to look at another
 * invoice, and the trigger's own message does. That message DOES contain
 * raw uuids, though (unlike trip_days/actions.ts's dayRowsDbError case,
 * where the trigger message is already pilot-readable), so it's not
 * passed through verbatim — this substitutes a specific, friendly
 * sentence instead. Same pattern as trips/actions.ts's dayRowsDbError.
 *
 * Why this can legitimately happen: trips.billing_state only advances on
 * an INVOICE STATUS CHANGE (pilot.invoices_sync_trip_billing_state), never
 * on a line being added to a draft. A trip already carrying lines on
 * someone else's draft invoice therefore still reads 'unbilled' here, so
 * createInvoiceDraft's `billing_state === "unbilled"` filter can offer it
 * again — and this is what the second attempt sees when the database's
 * own double-bill guard (Phase 5's invoice_lines_validate_trip) rejects
 * the batched insert.
 */
function linesDbError(
  error: { code?: string | null; message?: string | null } | null | undefined,
  context: string
): string {
  if (
    error?.code === "P0001" &&
    error.message?.toLowerCase().includes("already billed on invoice")
  ) {
    return "One or more of these trips is already on another invoice (possibly a draft). Remove it from that invoice, or drop it from this one and choose a different trip.";
  }
  return friendlyDbError(error, context);
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
    // for a job that has not finished. NEVER relax this to also admit
    // 'canceled' — the cancellation-note warning below uses a separate,
    // warning-only query instead of loosening this filter, specifically so
    // this stays true.
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
  const billingStateUnbilled = ((tripRows ?? []) as TripRow[]).filter(
    (t) => t.billing_state === "unbilled"
  );

  // F8 (mirrored from trips/actions.ts): billing_state only advances on an
  // invoice STATUS change, never when a line is added to a draft, so a
  // trip already sitting on someone else's still-DRAFT invoice still
  // reads 'unbilled' here and would otherwise be billed a second time.
  // pilot.trip_committed_invoice answers "is a LIVE invoice line already
  // referencing this trip" directly — the same definition the database's
  // own double-bill trigger (invoice_lines_validate_trip) enforces — so
  // checking it here lets a partially-bad submission still draft the
  // trips that ARE clean, with a warning naming the ones that aren't,
  // instead of the whole batched insert failing opaquely on whichever
  // trip the trigger happens to hit first.
  //
  // Best-effort per trip, same as the picker (invoices/new/page.tsx) and
  // trips/actions.ts: an individual RPC failure reads as "not known to be
  // committed elsewhere" rather than blocking the draft — the trigger is
  // still the real enforcement either way, this only makes the common
  // case (one stale trip among several clean ones) fail nicer.
  const committedResults = await Promise.all(
    billingStateUnbilled.map((t) =>
      supabase.rpc("trip_committed_invoice", {
        p_account_id: account.id,
        p_trip_id: t.id,
      } as never)
    )
  );
  const committedByTrip = new Map<string, string | null>(
    billingStateUnbilled.map((t, index) => [
      t.id,
      (committedResults[index]?.data as string | null | undefined) ?? null,
    ])
  );
  const preselectionWarnings: string[] = [];
  const trips = billingStateUnbilled.filter((t) => {
    const committedLabel = committedByTrip.get(t.id);
    if (committedLabel) {
      preselectionWarnings.push(
        `${formatDateRange(t.starts_on, t.ends_on)}: already billed on ${committedLabel} — not added to this invoice.`
      );
      return false;
    }
    return true;
  });
  const tripIdsToBill = trips.map((t) => t.id);

  // ---------------------------------------------------------------------
  // Phase 9: everything needed to prefer day rows over the scalar
  // day_count/day_rate_cents pair, price per diem, and apply a contract
  // minimum — fetched in parallel, alongside the pre-existing rebillable-
  // expenses read. Joined to trip_days in app code below (a flat select
  // plus a Map), not via a PostgREST embed — matches this codebase's
  // existing join style (see the expenses/rebillByTrip Map in
  // invoices/new/page.tsx), and .select() resolves to `never` here either
  // way.
  // ---------------------------------------------------------------------
  type ExpenseRow = {
    id: string;
    trip_id: string | null;
    category: string;
    vendor: string | null;
    amount_cents: number;
    incurred_on: string;
  };
  type TripDayRow = {
    id: string;
    trip_id: string;
    day_on: string;
    day_type_id: string;
    rate_cents: number;
    // F1: 20260807020000 adds trip_days.quantity — the fraction of the
    // day worked (0.1-1.0, numeric(3,1)) — so a half day is finally
    // representable. Not yet in database.types.ts's hand-authored
    // trip_days type (that file is Phase 9's, owned by the trips work
    // happening concurrently), but .select() already resolves to `never`
    // against these tables regardless of which columns are requested, so
    // this is cast at the boundary the same way every row here already
    // is, and needs no change there.
    quantity: number;
    // 20260807070000_trip_day_units_away_cancel.sql. units is a RATE
    // fraction (0 < x <= 1, numeric(3,2)) — distinct from quantity's TIME
    // fraction — multiplied into a row's contribution to its invoice
    // group's summed quantity below; see that migration's header for why
    // it does not join the (day_type_id, rate_cents) grouping key. away
    // is per-diem's other half: per diem now requires
    // counts_for_per_diem (the day type) AND away (the day), not
    // counts_for_per_diem alone.
    units: number;
    away: boolean;
  };
  type DayTypeRow = {
    id: string;
    label: string;
    billable: boolean;
    counts_for_per_diem: boolean;
    invoice_line_type: "flight_day" | "travel_day" | "other";
  };
  type ClientBillingRow = {
    per_diem_mode: "per_diem" | "receipts";
    default_per_diem_cents: number | null;
    minimum_days: number | null;
    // BUG FIX (supabase/migrations/20260807040000_client_minimum_basis.sql):
    // minimum_days used to have exactly one meaning, a per-trip floor,
    // because that was the only thing this function did with it. A client
    // on a monthly guarantee had no field to say so, typed the guaranteed
    // number in here anyway, and got a top-up line on EVERY short trip
    // instead of one for the month. minimum_basis is the fix: 'per_trip'
    // keeps today's behavior (and is what every row defaults to and every
    // existing row already has), 'per_month' routes through the
    // guarantee_periods settlement below instead.
    minimum_basis: "per_trip" | "per_month";
    cancellation_policy_note: string | null;
  };

  const [
    { data: expenseRows, error: expensesError },
    { data: dayRows, error: dayRowsError },
    { data: dayTypeRows, error: dayTypesError },
    { data: clientBillingRow, error: clientBillingError },
    { data: canceledTripRows, error: canceledTripsError },
  ] = await Promise.all([
    supabase
      .from("expenses")
      .select("id, trip_id, category, vendor, amount_cents, incurred_on, treatment")
      .eq("account_id", account.id)
      .eq("treatment", "rebill")
      .in("trip_id", tripIdsToBill),
    supabase
      .from("trip_days")
      .select("id, trip_id, day_on, day_type_id, rate_cents, quantity, units, away")
      .eq("account_id", account.id)
      .in("trip_id", tripIdsToBill),
    // The tenant's whole day-type taxonomy — a handful of rows per
    // account, cheaper to fetch in full than to round-trip on the exact
    // set of day_type_ids the fetched trip_days actually use.
    supabase
      .from("day_types")
      .select("id, label, billable, counts_for_per_diem, invoice_line_type")
      .eq("account_id", account.id),
    // This one client's billing terms. clientId is already a validated
    // UUID; RLS plus the account_id filter below scope this to the tenant.
    supabase
      .from("clients")
      .select(
        "per_diem_mode, default_per_diem_cents, minimum_days, minimum_basis, cancellation_policy_note"
      )
      .eq("account_id", account.id)
      .eq("id", clientId)
      .maybeSingle(),
    // Read-only, used for exactly one thing: deciding whether to surface
    // cancellation_policy_note as a warning. A SEPARATE query with its own
    // status='canceled' filter — not a relaxation of the completed-only
    // filter on the trips query above, which stays exactly as written.
    // These rows never feed `lines`. starts_on/canceled_at/
    // cancellation_notice_from (20260807070000) are what let the warning
    // say WHEN a trip was cancelled and how far ahead of its start that
    // was, instead of just that it happened.
    supabase
      .from("trips")
      .select("id, starts_on, canceled_at, cancellation_notice_from")
      .eq("account_id", account.id)
      .eq("client_id", clientId)
      .eq("status", "canceled")
      .in("id", tripIds),
  ]);

  if (expensesError) {
    redirect(
      `/invoices/${invoiceId}?warning=${encodeURIComponent(
        friendlyDbError(expensesError, "expenses.select")
      )}`
    );
  }
  if (dayRowsError || dayTypesError) {
    // Can't safely tell which trips have day rows without both of these —
    // guessing "no day rows, use the scalar fallback" on a fetch failure
    // could under-bill a trip that actually has them. Fail loud instead.
    redirect(
      `/invoices/${invoiceId}?warning=${encodeURIComponent(
        friendlyDbError(dayRowsError ?? dayTypesError, "trip_days.select")
      )}`
    );
  }
  if (clientBillingError) {
    // Same reasoning: without per_diem_mode/minimum_days we can't tell
    // whether to add a per-diem line or apply a contract minimum, and
    // silently treating "fetch failed" as "neither applies" could
    // under-bill a trip the client's terms say should bill more.
    redirect(
      `/invoices/${invoiceId}?warning=${encodeURIComponent(
        friendlyDbError(clientBillingError, "clients.select")
      )}`
    );
  }

  const expenses = (expenseRows ?? []) as ExpenseRow[];

  const dayTypeMap = new Map<string, DayTypeRow>(
    ((dayTypeRows ?? []) as DayTypeRow[]).map(
      (dt): [string, DayTypeRow] => [dt.id, dt]
    )
  );
  const dayRowsByTrip = new Map<string, TripDayRow[]>();
  for (const row of (dayRows ?? []) as TripDayRow[]) {
    const forTrip = dayRowsByTrip.get(row.trip_id) ?? [];
    forTrip.push(row);
    dayRowsByTrip.set(row.trip_id, forTrip);
  }

  const clientBilling = clientBillingRow as ClientBillingRow | null;
  // The rate to bill per diem at, or null if this client isn't on per diem
  // (or has no rate agreed) — narrowing on this variable, not a derived
  // boolean, is what lets TypeScript treat it as definitely-a-number at
  // the one place it's used below.
  const perDiemRateCents: number | null =
    clientBilling && clientBilling.per_diem_mode === "per_diem"
      ? clientBilling.default_per_diem_cents
      : null;
  // Absent minimum_basis reads as 'per_trip' — matches the column's own
  // DEFAULT (every row written before this feature existed has exactly
  // that value), so a null client row (client somehow not found) or a
  // stale cached read behaves the same as "no monthly guarantee".
  const minimumBasis: "per_trip" | "per_month" =
    clientBilling?.minimum_basis ?? "per_trip";

  // ---------------------------------------------------------------------
  // MONTHLY GUARANTEE accumulator — 'per_month' path only. Keyed by the
  // first-of-month date ("YYYY-MM-01") of each BILLABLE, PRICED trip_days
  // row's own day_on, not by the trip's start date. A trip spanning a
  // month boundary (flown Jan 30 - Feb 2) must have its days split across
  // both months' totals — trip_days is one row per calendar date
  // specifically so that "which month did this day happen in" always has
  // a per-day answer, and anything coarser (the trip's start month, its
  // majority month) would move days between an owner's January and
  // February invoices depending on where in the month the trip happened to
  // fall, which is not something either month's true-up should depend on.
  // Populated inside the per-trip loop below, alongside (never instead of)
  // the existing per-day-type-and-rate grouping — this is a second view of
  // the same rows, not a replacement for the first.
  // ---------------------------------------------------------------------
  const monthlyBillable = new Map<
    string,
    // qtyThousandths, not qty: the month's billable days accumulate in exact
    // integer thousandths for the same reason the day-line groups do — see
    // dayQuantityThousandths in lib/trip-value.ts. A guarantee compared
    // against a float-drifted worked total tops up the wrong number of days.
    { qtyThousandths: number; bestRateCents: number }
  >();
  // Best-effort: a failed read here means "don't know", so it suppresses
  // the cancellation-note warning rather than blocking the draft — no
  // billing value depends on it, only a piece of review-time copy.
  type CanceledTripRow = {
    id: string;
    starts_on: string;
    canceled_at: string | null;
    cancellation_notice_from: string | null;
  };
  const canceledTripsSelected: CanceledTripRow[] = canceledTripsError
    ? []
    : ((canceledTripRows ?? []) as CanceledTripRow[]);

  const lines: LineInsert[] = [];
  let sortOrder = 0;
  let skippedFlightDays = false;
  let skippedTravelDays = false;
  const warnings: string[] = [...preselectionWarnings];

  // D: guarantee_periods.settled_invoice_id must never be stamped for a
  // month before the invoice_lines that settlement is supposed to justify
  // are actually written — there is no DB transaction spanning the two
  // (see the "no cross-table transaction available" note on the
  // invoice_lines insert below), so writing the settlement first meant a
  // rejected lines batch (most commonly invoice_lines_validate_trip's
  // double-bill guard) permanently burned that month's guarantee against
  // an invoice that ended up with zero lines. The monthly-guarantee loop
  // below only fills this array; the actual write happens in the loop
  // right after invoice_lines lands, which is the earliest point the
  // lines are known-written (a lines-insert failure redirects and never
  // reaches it).
  type PendingGuaranteeSettlement = {
    monthKey: string;
    monthLabel: string;
    existingPeriodId: string | null;
    minDays: number;
  };
  const pendingGuaranteeSettlements: PendingGuaranteeSettlement[] = [];
  type GuaranteePeriodInsert =
    Database["pilot"]["Tables"]["guarantee_periods"]["Insert"];

  for (const trip of trips) {
    const tripDayRows = dayRowsByTrip.get(trip.id) ?? [];

    if (tripDayRows.length > 0) {
      // ---------------------------------------------------------------
      // DAY-ROW PATH. Group BILLABLE day rows by (day_type_id, rate_cents)
      // — rate_cents is the SNAPSHOT taken at capture, never re-resolved
      // from day_types.default_rate_cents or client_rates here (the
      // trip_days migration's comment explains why: re-resolving would
      // restate work already flown).
      // ---------------------------------------------------------------
      const groups = new Map<
        string,
        {
          dayTypeId: string;
          rateCents: number;
          dayOns: string[];
          /**
           * The group's summed quantity in EXACT INTEGER THOUSANDTHS, not
           * as a float. quantity is numeric(3,1) and units numeric(3,2), so
           * every contribution is an exact multiple of 0.001 that a double
           * usually cannot hold — and a sum landing on a .xx5 boundary
           * would then round the wrong way, billing a cent-scale
           * disagreement against the same trip's figure on Overview and the
           * trips list. See dayQuantityThousandths in lib/trip-value.ts.
           */
          quantityThousandths: number;
        }
      >();
      const unpriced = new Map<string, number>(); // day type label -> count

      for (const row of tripDayRows) {
        const dayType = dayTypeMap.get(row.day_type_id);
        // F5: a non-billable day type (e.g. an 'off' day) is filtered out
        // HERE, before the zero-rate check below ever runs — an off day
        // is part of the trip's shape, never a line, and (per the trips
        // grid) sends rate_cents=0 by design, not by mistake. That
        // ordering is what keeps a deliberate non-billable zero from ever
        // reaching the "had no rate set" warning meant for a genuine
        // billable-day pricing gap.
        if (!dayType || !dayType.billable) continue;

        const rateCents = Number(row.rate_cents);
        if (rateCents === 0) {
          // F5: only reached for a BILLABLE day type now — a billable day
          // with no rate is a real gap in the trip's setup, worth the
          // pilot's attention. Skipped the same way the scalar path below
          // skips a travel day with no rate rather than billing $0.
          unpriced.set(dayType.label, (unpriced.get(dayType.label) ?? 0) + 1);
          continue;
        }

        const key = `${row.day_type_id}::${rateCents}`;
        const group = groups.get(key) ?? {
          dayTypeId: row.day_type_id,
          rateCents,
          dayOns: [],
          quantityThousandths: 0,
        };
        group.dayOns.push(row.day_on);
        // F1: sum the rows' OWN quantity (0.1-1.0 each, a half day is a
        // shipped feature) rather than counting rows — a group of two
        // rows can be 2.0 days or 1.3, and counting rows always says 2.
        //
        // 20260807070000: multiplied by the row's OWN units (a rate
        // fraction, e.g. 0.5 for "this travel day pays half") — a row's
        // contribution to the group's summed quantity is quantity*units,
        // not bare quantity. rateCents (the group's unit_amount_cents) is
        // untouched by units; only how much of that rate this row
        // contributes moves. Every row written before this column existed
        // has units=1.00, so this sum is byte-for-byte unchanged for them.
        // See that migration's header for why units does not join the
        // grouping key above.
        //
        // Accumulated in integer thousandths so the sum is EXACT: the same
        // group is priced in `numeric` by pilot.unbilled_trip_money for
        // Overview, and a float sum disagrees with it at every .xx5
        // boundary (lib/trip-value.ts's dayQuantityThousandths carries the
        // worked example).
        group.quantityThousandths += dayQuantityThousandths(row.quantity, row.units);
        groups.set(key, group);

        // Monthly guarantee accumulation — see monthlyBillable's own
        // comment above for why this buckets by the ROW's day_on rather
        // than the trip's month. Only worth doing for a 'per_month'
        // client; a 'per_trip' client's invoice must come out byte-for-
        // byte identical to before this feature existed, so this branch
        // must never run any code that could affect it.
        //
        // Bucketed at quantity*units too, for the same reason the
        // per-trip minimum below is: a monthly guarantee is a floor on
        // PAY, not on calendar days, so a half-rate day should count as
        // half toward it — see 20260807070000's header for the full
        // reasoning.
        if (minimumBasis === "per_month") {
          const monthKey = `${row.day_on.slice(0, 7)}-01`;
          const bucket = monthlyBillable.get(monthKey) ?? {
            qtyThousandths: 0,
            bestRateCents: 0,
          };
          bucket.qtyThousandths += dayQuantityThousandths(row.quantity, row.units);
          if (rateCents > bucket.bestRateCents) bucket.bestRateCents = rateCents;
          monthlyBillable.set(monthKey, bucket);
        }
      }

      for (const [label, count] of unpriced) {
        // Not `${label} day(s)` — the seeded labels already end in "day"
        // ("Flight day", "Travel day", ...), which would read "flight day
        // day(s)". A day type's own label can't be assumed to include the
        // word "day" at all (a tenant can rename it), so it's named
        // explicitly instead of concatenated into a plural.
        warnings.push(
          `${formatDateRange(trip.starts_on, trip.ends_on)}: ${count} day(s) of type "${label}" had no rate set and weren't billed.`
        );
      }

      const tripDayLines: LineInsert[] = [];
      for (const group of groups.values()) {
        const dayType = dayTypeMap.get(group.dayTypeId)!;
        // F1: round the summed quantity to invoice_lines.quantity's
        // numeric(6,2) scale — a deliberate guard against float drift,
        // not a fudge (see roundQuantity's own comment) — and never emit
        // a line for a group whose summed quantity rounds to zero. Every
        // row's own quantity is checked > 0 at the database, so this can
        // only trip on a genuine float artifact, never on real data; it
        // exists so that artifact fails silently-safe (no line) instead
        // of reaching invoice_lines' `quantity > 0` CHECK as a raw 23514.
        const qty = roundThousandthsToHundredths(group.quantityThousandths);
        if (qty <= 0) continue;

        const sortedDays = [...group.dayOns].sort();
        tripDayLines.push({
          account_id: account.id,
          invoice_id: invoiceId,
          line_type: dayType.invoice_line_type,
          // F3: min→max always read as a span, so flight days on the
          // 1st/3rd/5th and travel days on the 2nd/4th produced two
          // lines both reading "1st to 5th" — an overlap that looks like
          // double-billing to a client's AP department. Contiguous dates
          // still get the span form (readable, and matches the fixed
          // flight_day/travel_day lines' own style); non-contiguous dates
          // are listed out instead. formatDate/formatDateRange
          // (lib/format.ts) are the one date format this file uses
          // anywhere a pilot or client reads it — no second one invented
          // here.
          description: `${dayType.label}s — ${describeDayDates(sortedDays)}`,
          quantity: qty,
          unit_amount_cents: group.rateCents,
          taxable: true,
          trip_id: trip.id,
          sort_order: sortOrder++,
        });
      }

      // Contract minimum, PER-TRIP basis — day-row path ONLY. A trip with
      // no day rows never reaches this branch, so minimum_days can never
      // change what a scalar-path trip bills.
      //
      // BUG FIX: this used to run unconditionally whenever minimum_days
      // was set, which is what produced one top-up line per trip even for
      // a client whose minimum_days actually meant a MONTHLY guarantee —
      // see minimumBasis's own comment above. Gating on
      // `minimumBasis === "per_trip"` is what makes the per_trip path
      // byte-for-byte unchanged (it's every existing client's value, and
      // the column's own DEFAULT) while routing a 'per_month' client to
      // the once-per-invoice settlement block after this loop instead.
      if (minimumBasis === "per_trip" && clientBilling?.minimum_days != null) {
        const minDays = Number(clientBilling.minimum_days);
        if (tripDayLines.length === 0) {
          warnings.push(
            `${formatDateRange(trip.starts_on, trip.ends_on)}: this client has a ${formatMinDays(minDays)}-day contract minimum, but the trip has no billable day line to apply it to.`
          );
        } else {
          const totalBillableQty = roundQuantity(
            tripDayLines.reduce((sum, line) => sum + Number(line.quantity ?? 0), 0)
          );
          if (totalBillableQty < minDays) {
            // F2: the shortfall used to be folded into an existing day
            // line's quantity ("Flight days — Mar 1 to Mar 1" at quantity
            // 2 for a 1-day trip) — a one-day range billing two days is
            // exactly what a client's AP department flags as
            // double-billing. It's now its own line instead, so the day
            // lines keep describing only the days actually worked.
            //
            // RATE CHOICE (documented here because there is no other
            // place the pilot can see it): priced at the HIGHEST
            // unit_amount_cents among this trip's own day lines — not an
            // average, and not day_types.default_rate_cents, since the
            // pilot may have overridden a rate on this specific trip.
            // Billing the shortfall at the trip's most valuable day rate
            // means the contract minimum can never pay the pilot LESS
            // than the day it's topping off would have. Ties (two day
            // types at the same rate) go to whichever already has more
            // days on this trip, purely for a reproducible pick — there
            // is no meaningful difference between the two once rates tie.
            let bestRateLine = tripDayLines[0]!;
            for (const line of tripDayLines) {
              if (
                line.unit_amount_cents > bestRateLine.unit_amount_cents ||
                (line.unit_amount_cents === bestRateLine.unit_amount_cents &&
                  Number(line.quantity ?? 0) > Number(bestRateLine.quantity ?? 0))
              ) {
                bestRateLine = line;
              }
            }
            const shortfall = roundQuantity(minDays - totalBillableQty);
            if (shortfall > 0) {
              const worked = formatMinDays(totalBillableQty);
              tripDayLines.push({
                account_id: account.id,
                invoice_id: invoiceId,
                line_type: "other",
                description: `Contract minimum — ${formatMinDays(minDays)}-day minimum, ${worked} ${
                  totalBillableQty === 1 ? "day" : "days"
                } worked`,
                quantity: shortfall,
                unit_amount_cents: bestRateLine.unit_amount_cents,
                taxable: true,
                trip_id: trip.id,
                sort_order: sortOrder++,
              });
            }
          }
        }
      }

      lines.push(...tripDayLines);
    } else {
      // ---------------------------------------------------------------
      // SCALAR PATH — otherwise the pre-Phase-9 logic, unchanged: a trip
      // with zero trip_days rows still bills with no minimum-days or other
      // Phase-9 behavior applied. The one deliberate departure from
      // byte-for-byte is the day_rate_cents > 0 guard just below, which
      // brings the flight-day line in line with the travel-day line right
      // after it (both were previously asymmetric — see that branch).
      // ---------------------------------------------------------------
      if (Number(trip.day_count) > 0) {
        // A trip with no day rate set has nothing to price flight days
        // with — dropped rather than billed at $0, and reported in the
        // warning so the pilot notices instead of the trip silently
        // invoicing for free. Mirrors the travel-day branch immediately
        // below (trip.day_rate_cents is `bigint not null default 0`, so a
        // blank rate on the trip form lands here as 0, not null).
        if (Number(trip.day_rate_cents) > 0) {
          lines.push({
            account_id: account.id,
            invoice_id: invoiceId,
            line_type: "flight_day",
            description: `Flight days — ${formatDateRange(trip.starts_on, trip.ends_on)}`,
            quantity: trip.day_count,
            unit_amount_cents: trip.day_rate_cents,
            taxable: true,
            trip_id: trip.id,
            sort_order: sortOrder++,
          });
        } else {
          skippedFlightDays = true;
        }
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
            description: `Travel days — ${formatDateRange(trip.starts_on, trip.ends_on)}`,
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

    // Per diem. Gated on the trip HAVING day rows, regardless of which
    // branch above ran — a trip with no day rows has no
    // counts_for_per_diem count to draw on, so it gets a warning, never a
    // line guessed from day_count.
    if (perDiemRateCents !== null) {
      if (tripDayRows.length > 0) {
        // 20260807070000: per diem is for being AWAY, not for the kind of
        // day alone — counts_for_per_diem (the day type) is now ANDed
        // with away (the day). A standby day at home base no longer
        // draws per diem just because "standby" is configured to count;
        // it also has to be a day the pilot was actually away. See that
        // migration's header for why away defaults false on every row
        // written before this column existed (a deliberate, conservative
        // under-count on legacy data — flagged there, not hidden here).
        const perDiemCount = tripDayRows.filter(
          (row) =>
            dayTypeMap.get(row.day_type_id)?.counts_for_per_diem === true &&
            row.away === true
        ).length;
        if (perDiemCount > 0) {
          lines.push({
            account_id: account.id,
            invoice_id: invoiceId,
            line_type: "per_diem",
            description: `Per diem — ${formatDateRange(trip.starts_on, trip.ends_on)}`,
            quantity: perDiemCount,
            unit_amount_cents: perDiemRateCents,
            // C10: a straight expense reimbursement is commonly not
            // taxable — see the migration's invoice_lines.taxable comment.
            taxable: false,
            trip_id: trip.id,
            sort_order: sortOrder++,
          });
        } else {
          // F4: this used to fall through silently — the client is on
          // per diem, the trip HAS day rows to count, and yet nothing
          // billed and nothing was said. That's exactly the case worth a
          // warning: either every day type on this trip has
          // counts_for_per_diem=false (unlikely after the migration's fix
          // to seed 'off' as true — an off day is the paradigm per-diem
          // day, the pilot is away and eating whether or not they fly —
          // but a tenant can still turn it off on a custom day type), or
          // this trip is made up entirely of day types that don't count,
          // OR (20260807070000) every eligible day type's rows are marked
          // `away = false` — including every row on a trip captured
          // before that column existed, which defaults false on all of
          // them. The wording covers both causes rather than guessing
          // which one applies to this trip.
          warnings.push(
            `${formatDateRange(trip.starts_on, trip.ends_on)}: this client is on per diem, but no day on this trip both counts toward it and is marked away from home base, so no per-diem line was added. Check the day grid's "Away" column.`
          );
        }
      } else {
        warnings.push(
          `${formatDateRange(trip.starts_on, trip.ends_on)}: this client is on per diem, but the trip has no day rows to count, so no per-diem line was added.`
        );
      }
    }
  }

  // ---------------------------------------------------------------------
  // Monthly guarantee settlement — 'per_month' basis ONLY, applied ONCE
  // PER COVERED MONTH ACROSS THE WHOLE INVOICE, never per trip. This is
  // the actual fix: the old code's per-trip loop above would have emitted
  // one top-up line for every short trip in a month; this emits at most
  // one, sized against the month's TOTAL billable days across every trip
  // selected on this draft.
  //
  // monthlyBillable is empty for every 'per_trip' client (the accumulator
  // is only ever written when minimumBasis === "per_month") and for a
  // 'per_month' client whose selected trips produced no billable day rows
  // at all, so this block is a no-op in both of those cases — nothing
  // below can affect a 'per_trip' client's invoice.
  //
  // KNOWN LIMITATION, stated rather than hidden: "worked" below is the sum
  // ONLY across trips SELECTED ON THIS INVOICE, not every trip this client
  // has ever had billed in that month. If a month's trips get split across
  // two invoices (drafted separately), the FIRST invoice to touch that
  // month settles it — sized against whatever it alone saw — and the
  // second sees pilot.guarantee_periods already holds a settled row for
  // that month and stops, warning instead of computing a second, possibly
  // more informed, top-up. That is the conservative side of the tradeoff:
  // it can under-apply a guarantee split across invoices, but it can never
  // double-apply one, which is the failure this whole feature exists to
  // close. A pilot who deliberately splits one month's trips across
  // invoices should draft the smaller ones first if they want the
  // guarantee sized off the fuller picture.
  // ---------------------------------------------------------------------
  if (
    minimumBasis === "per_month" &&
    clientBilling?.minimum_days != null &&
    monthlyBillable.size > 0
  ) {
    const minDays = Number(clientBilling.minimum_days);
    const monthKeys = [...monthlyBillable.keys()].sort();

    const { data: periodRows, error: periodsError } = await supabase
      .from("guarantee_periods")
      .select("id, period_month, guaranteed_days, settled_invoice_id")
      .eq("account_id", account.id)
      .eq("client_id", clientId)
      .in("period_month", monthKeys);

    if (periodsError) {
      // Can't safely tell which months are already settled without this
      // read — guessing "none settled" on a fetch failure could top up a
      // month a sibling invoice already topped up, which is precisely the
      // double-bill this table exists to prevent. Fail loud, same
      // reasoning as the dayRows/dayTypes/clientBilling fetch failures
      // above.
      redirect(
        `/invoices/${invoiceId}?warning=${encodeURIComponent(
          `Created the draft, but couldn't check this client's monthly guarantee history, so no monthly minimum was applied: ${friendlyDbError(
            periodsError,
            "guarantee_periods.select"
          )}`
        )}`
      );
    }

    type PeriodRow = {
      id: string;
      period_month: string;
      guaranteed_days: number;
      settled_invoice_id: string | null;
    };
    const existingPeriodByMonth = new Map<string, PeriodRow>(
      ((periodRows ?? []) as PeriodRow[]).map((r) => [r.period_month, r])
    );

    // L1: name the settling invoice the way every other warning in this
    // file does (formatDateRange/formatMonthLabel) instead of printing
    // settled_invoice_id — a uuid — straight into pilot-facing text.
    // Same label shape pilot.trip_committed_invoice already uses for the
    // per-trip version of this warning above: the invoice_number if the
    // settling invoice has been issued one, else "a draft invoice".
    const settledIds = [
      ...new Set(
        ((periodRows ?? []) as PeriodRow[])
          .map((r) => r.settled_invoice_id)
          .filter((id): id is string => id != null)
      ),
    ];
    const settledInvoiceLabelById = new Map<string, string>();
    if (settledIds.length > 0) {
      const { data: settledInvoiceRows } = await supabase
        .from("invoices")
        .select("id, invoice_number")
        .eq("account_id", account.id)
        .in("id", settledIds);
      for (const row of (settledInvoiceRows ?? []) as {
        id: string;
        invoice_number: string | null;
      }[]) {
        settledInvoiceLabelById.set(
          row.id,
          row.invoice_number ?? "a draft invoice"
        );
      }
    }

    for (const monthKey of monthKeys) {
      const bucket = monthlyBillable.get(monthKey)!;
      const monthLabel = formatMonthLabel(monthKey);
      const existingPeriod = existingPeriodByMonth.get(monthKey);
      const alreadySettled = existingPeriod?.settled_invoice_id ?? null;

      if (alreadySettled) {
        // IDEMPOTENCY: a different invoice already settled this month —
        // the common shape being a second invoice for the same client,
        // drafted later, that happens to also cover a trip inside an
        // already-topped-up month. No second TOP-UP line is added.
        //
        // BUT SKIPPING THE TOP-UP IS NOT THE SAME AS BILLING CORRECTLY,
        // and this warning used to imply it was. The day lines for this
        // month are still on the invoice below, and the earlier top-up
        // already charged the client for a guaranteed number of days that
        // these ones now duplicate.
        //
        // Worked example, from the review that found this: a 10-day
        // monthly minimum at $1,200/day, four 3-day trips in August
        // invoiced one at a time — the product's own default flow, since
        // the picker offers completed unbilled trips singly. Invoice A
        // bills 3 flight days plus a 7-day top-up. Invoices B, C and D
        // bill 3 days each on top. The client is billed 19 days for a
        // month whose honest total is 12, and whose guarantee is 10.
        // $8,400 of days nobody flew, on documents an owner's AP
        // department reads.
        //
        // A full fix reconciles: it credits back the overlap between what
        // this invoice adds and what the earlier top-up already covered.
        // That needs guarantee_periods to record how many days were billed
        // into the month at settlement, which it does not — it stores
        // guaranteed_days and settled_invoice_id and nothing about days
        // worked. So this warning states the exposure in the terms it can
        // actually compute — how many days THIS invoice adds to a month
        // already topped up — without inventing a precise credit figure
        // the data does not support.
        const settledLabel =
          settledInvoiceLabelById.get(alreadySettled) ?? "a draft invoice";
        const addedDays = roundThousandthsToHundredths(bucket.qtyThousandths);
        warnings.push(
          `${monthLabel}: this client's monthly guarantee was already settled on invoice ${settledLabel}, so no second top-up line was added — but this invoice still bills ${formatMinDays(
            addedDays
          )} ${addedDays === 1 ? "day" : "days"} in that month. Invoice ${settledLabel}'s top-up already charged for the guaranteed days, so check these aren't being billed twice before you send this.`
        );
        continue;
      }

      const worked = roundThousandthsToHundredths(bucket.qtyThousandths);
      if (worked < minDays) {
        const shortfall = roundQuantity(minDays - worked);
        // RATE CHOICE — same reasoning as the per-trip minimum's own
        // comment above, extended to a month: the HIGHEST
        // unit_amount_cents among this month's own billable day rows
        // (tracked as monthlyBillable's bestRateCents while those rows
        // were grouped, above), so the guarantee can never pay the pilot
        // less than the day it is topping off would have.
        lines.push({
          account_id: account.id,
          invoice_id: invoiceId,
          line_type: "other",
          // Names the month explicitly — an aircraft owner's AP
          // department sees ONE line for a STATED month, backed by a
          // stated worked-vs-guaranteed day count, not one line per trip.
          description: `Monthly guarantee — ${monthLabel} — ${formatMinDays(
            minDays
          )}-day minimum, ${formatMinDays(worked)} ${
            worked === 1 ? "day" : "days"
          } worked`,
          quantity: shortfall,
          unit_amount_cents: bucket.bestRateCents,
          taxable: true,
          // No trip_id: this line is a monthly aggregate across however
          // many trips contributed to the month, not one trip's own line
          // — unlike every other line this function emits.
          sort_order: sortOrder++,
        });
      }

      // Recorded whether or not a line was emitted — "worked already met
      // the guarantee" is a legitimate settlement outcome too, and
      // recording it here is what stops a later invoice from re-deriving
      // (and potentially double-counting) the same month.
      //
      // NOT WRITTEN HERE — see pendingGuaranteeSettlements's own comment
      // above. This pass only records what to write; the actual
      // guarantee_periods write happens in the loop right after
      // invoice_lines is inserted, below.
      pendingGuaranteeSettlements.push({
        monthKey,
        monthLabel,
        existingPeriodId: existingPeriod?.id ?? null,
        minDays,
      });
    }
  }

  // Cancellation — a note per canceled SELECTED trip, if the client has a
  // policy on file. Never a computed fee: see
  // pilot.clients.cancellation_policy_note's comment in the Phase 9
  // migration on why an unenforceable percentage is worse than recording
  // the agreement and letting the pilot add the manual cancellation_fee
  // line themselves.
  //
  // 20260807070000_trip_day_units_away_cancel.sql made this specific: it
  // used to be one generic sentence for the whole invoice ("one or more
  // selected trips is canceled"); now it names WHICH trip, WHEN it was
  // cancelled, and how far ahead of its start date that was — the actual
  // evidence a cancellation-fee clause needs and a client's AP department
  // would otherwise contest. One line per canceled trip, not one for the
  // invoice, because each trip's timing is its own fact.
  if (clientBilling?.cancellation_policy_note) {
    for (const trip of canceledTripsSelected) {
      warnings.push(
        `This client has a cancellation policy on file: "${clientBilling.cancellation_policy_note}". ${formatDate(
          trip.starts_on
        )} trip was ${describeCancellationTiming(trip)} — add a cancellation_fee line by hand if it applies.`
      );
    }
  }

  for (const expense of expenses) {
    lines.push({
      account_id: account.id,
      invoice_id: invoiceId,
      line_type: "reimbursable_expense",
      description: `${categoryLabel(expense.category)}${
        expense.vendor ? ` — ${expense.vendor}` : ""
      } (${formatDate(expense.incurred_on)})`,
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
      //
      // F6: linesDbError (not friendlyDbError) — the billing_state filter
      // above can legitimately let a trip through that's already
      // committed to someone else's draft invoice (see linesDbError's own
      // comment), and when that happens this is the error the double-bill
      // guard raises. linesDbError turns it into a sentence that names
      // the actual problem instead of a generic "couldn't save".
      redirect(
        `/invoices/${invoiceId}?warning=${encodeURIComponent(
          `Created the draft, but couldn't add the trip lines: ${linesDbError(
            linesError,
            "invoice_lines.insert"
          )}`
        )}`
      );
    }
  }

  // D: guarantee_periods is stamped ONLY here — after invoice_lines is
  // known-written (the redirect() above throws and never falls through to
  // this point on a rejected batch). See pendingGuaranteeSettlements's own
  // comment near the top of this function for what used to go wrong when
  // the settlement write ran ahead of the lines it was meant to justify.
  for (const settlement of pendingGuaranteeSettlements) {
    // C2 FIX — lookup-then-insert-or-update, the same shape
    // trips/actions.ts's trip_days save and
    // clients/[id]/rate-overrides-actions.ts's client_rates write both
    // already use, and for the same reason: PostgREST's `.upsert()`
    // compiles to `ON CONFLICT ... DO UPDATE SET <every payload column> =
    // excluded.<col>`, and Postgres checks UPDATE privilege on every
    // column named in that SET list STATICALLY — before any conflict is
    // even evaluated, and even when the incoming value matches the stored
    // one. The payload here is (account_id, client_id, period_month,
    // guaranteed_days, settled_invoice_id); this migration's UPDATE grant
    // is only (guaranteed_days, settled_invoice_id) — account_id/
    // client_id/period_month identify the row and are insert-only, the
    // same discipline client_rates already uses for (account_id,
    // client_id, day_type_id). So `.upsert()` 42501'd for `authenticated`
    // on every call, the table was never actually written, and the
    // monthly guarantee double-billed every month split across two
    // invoices (see this file's own header comment above).
    // existingPeriodId is already in hand from the loop above, so no
    // extra read is needed — just branch on it, and check
    // `{count:"exact"}` on the write so a silently-denied write surfaces
    // here instead of at a client's AP department.
    if (settlement.existingPeriodId) {
      const { error: updateError, count: updateCount } = await supabase
        .from("guarantee_periods")
        .update(
          {
            guaranteed_days: settlement.minDays,
            settled_invoice_id: invoiceId,
          } as never,
          { count: "exact" }
        )
        .eq("id", settlement.existingPeriodId)
        .eq("account_id", account.id);

      if (updateError) {
        // The invoice's lines are already committed by this point —
        // losing the settlement record is a "this month might get topped
        // up again" risk, not a "this invoice is wrong" one, so it's a
        // warning, not a hard failure.
        warnings.push(
          `Couldn't record ${settlement.monthLabel}'s guarantee settlement (${friendlyDbError(
            updateError,
            "guarantee_periods.update"
          )}). A later invoice for this client may re-offer the same month.`
        );
      } else if (updateCount === 0) {
        warnings.push(
          `Couldn't record ${settlement.monthLabel}'s guarantee settlement — no matching record to update. A later invoice for this client may re-offer the same month.`
        );
      }
    } else {
      const insertPayload: GuaranteePeriodInsert = {
        account_id: account.id,
        client_id: clientId,
        period_month: settlement.monthKey,
        guaranteed_days: settlement.minDays,
        settled_invoice_id: invoiceId,
      };
      const { error: insertError, count: insertCount } = await supabase
        .from("guarantee_periods")
        .insert(insertPayload as never, { count: "exact" });

      if (insertError) {
        warnings.push(
          `Couldn't record ${settlement.monthLabel}'s guarantee settlement (${friendlyDbError(
            insertError,
            "guarantee_periods.insert"
          )}). A later invoice for this client may re-offer the same month.`
        );
      } else if (insertCount !== 1) {
        warnings.push(
          `Couldn't record ${settlement.monthLabel}'s guarantee settlement — the write didn't take. A later invoice for this client may re-offer the same month.`
        );
      }
    }
  }

  revalidatePath("/invoices");
  revalidatePath("/trips");
  if (skippedFlightDays) {
    warnings.push(
      "One or more trips had flight days but no day rate set, so those days weren't billed. Add a rate on the trip and re-draft, or add a line by hand."
    );
  }
  if (skippedTravelDays) {
    warnings.push(
      "One or more trips had travel days but no travel day rate set, so those days weren't billed. Add a rate on the trip and re-draft, or add a line by hand."
    );
  }
  if (warnings.length > 0) {
    // Extends the existing single-`warning`-param mechanism rather than
    // inventing a second one — every distinct thing skipped this draft
    // (unpriced day rows, a per-diem/minimum that couldn't be applied, a
    // cancellation note, a legacy unpriced travel day) collapses into one
    // string for the invoice page's single warning banner.
    redirect(
      `/invoices/${invoiceId}?warning=${encodeURIComponent(warnings.join(" "))}`
    );
  }
  redirect(`/invoices/${invoiceId}`);
}

/** "2" for a whole number, "2.5" for a fractional one — minimum_days is numeric(5,1). */
function formatMinDays(days: number): string {
  return Number.isInteger(days) ? String(days) : days.toFixed(1);
}

/**
 * "YYYY-MM-01" (a guarantee_periods.period_month value) to "August 2026",
 * for the monthly guarantee's own line description and warnings — the one
 * place on the invoice a pilot or client sees WHICH month was settled.
 * Parsed as UTC midnight, same rule as every other date in this file
 * (lib/format.ts's parseCalendarDate comment explains why: a viewer west
 * of Greenwich formatting a local Date sees the wrong calendar day/month).
 */
function formatMonthLabel(periodMonth: string): string {
  const [y, m] = periodMonth.slice(0, 7).split("-").map(Number);
  const date = new Date(Date.UTC(y!, (m ?? 1) - 1, 1));
  return date.toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

/**
 * The cancellation warning's specific, evidence-bearing clause —
 * 20260807070000_trip_day_units_away_cancel.sql's whole point: "canceled
 * on Aug 7 at 6:00 PM UTC, 6 hours before the trip's Aug 8 start date"
 * instead of just "is canceled".
 *
 * HONEST ABOUT GRANULARITY: pilot.trips.starts_on is a `date` column —
 * this product records no time-of-day for a trip's start anywhere — so
 * "hours before start" is measured against that date's UTC midnight, not
 * an actual show time. Stated in the sentence itself ("start date", not
 * "start time") rather than implying a precision this product doesn't
 * have.
 */
function describeCancellationTiming(trip: {
  starts_on: string;
  canceled_at: string | null;
  cancellation_notice_from: string | null;
}): string {
  const noticeFrom = trip.cancellation_notice_from
    ? ` (notice from ${trip.cancellation_notice_from})`
    : "";
  if (!trip.canceled_at) {
    // Predates the trigger, or was never captured — no timestamp to
    // reason about. Said plainly rather than guessed: see the migration's
    // header on why no CHECK backfills this and no code should either.
    return `canceled, but there's no cancellation timestamp on record${noticeFrom}`;
  }
  const canceledAt = new Date(trip.canceled_at);
  const startOfDay = new Date(`${trip.starts_on.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(canceledAt.getTime()) || Number.isNaN(startOfDay.getTime())) {
    return `canceled${noticeFrom}`;
  }
  const hours = (startOfDay.getTime() - canceledAt.getTime()) / 3_600_000;
  const canceledAtLabel = new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(canceledAt);
  const timingLabel =
    hours >= 0
      ? `${formatHoursSpan(hours)} before its start date`
      : `${formatHoursSpan(-hours)} after its start date`;
  return `canceled ${canceledAtLabel} UTC — ${timingLabel}${noticeFrom}`;
}

/** "6 hours" / "1.5 hours" / "1 hour" — rounded to a tenth, same reasoning
 * as roundQuantity: hides sub-tenth float noise without changing the
 * figure a pilot would compute by hand. */
function formatHoursSpan(hours: number): string {
  const rounded = Math.round(hours * 10) / 10;
  const text = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
  return `${text} hour${rounded === 1 ? "" : "s"}`;
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
/**
 * MARKING AN INVOICE SENT — and, when the pilot picks email, actually sending it.
 *
 * This action used to take `deliveryMethod: "platform_email"`, write
 * status='sent' with delivery_method='platform_email', and send nothing. The
 * column had existed since the Phase 5 migration and the screen offered the
 * choice, so a pilot could tell the product to email their client, watch the
 * invoice move to Sent, and then wait on payment for a document that had never
 * been sent. A failure that looks like nothing happened is bad; one that looks
 * like success is worse, and this was the second kind.
 *
 * ORDER OF OPERATIONS, and why it is THIS way round after being the other way.
 *
 * The first version of this sent the mail FIRST and wrote the status after, on
 * the reasoning that an invoice must never claim Sent for mail still in
 * flight. That reasoning was sound and the conclusion was still wrong, because
 * of a fact about this schema it did not account for:
 * `invoices_assign_number_on_issue` (20260805090000) assigns invoice_number —
 * and the issue/due dates — ON the draft->sent transition, and only there. A
 * draft has no number by deliberate design, so rendering the PDF before the
 * transition emailed the client a document numbered "—", filed as
 * `invoice-<uuid>.pdf`, while the invoice the pilot then sees carries a real
 * permanent number. The client's copy and the pilot's record disagree, on the
 * one field an accounts-payable department keys on, and neither party is
 * positioned to notice. A reviewer caught it; it is the sharper failure.
 *
 * So: the transition runs FIRST, which mints the number, and only then is the
 * document rendered and sent. That reinstates the window the original ordering
 * was avoiding, and the window is handled by SAYING SO rather than by
 * pretending — a failed send after a successful transition returns an error
 * naming exactly what is true: the invoice is issued and numbered, the mail
 * did not go, download it and send it yourself. The pilot is never left
 * guessing, and the document is correct in every copy that exists.
 *
 * Rolling the status back instead was considered and rejected:
 * invoices_protect_issued permits no sent->draft edge, so the "rollback" would
 * have to be a void, which burns the number and is far more destructive than
 * an accurate sentence.
 *
 * manual_download is unchanged and sends nothing, by design — it means "I will
 * send this myself", and it is also the fallback the error copy points at
 * whenever email is unconfigured or refused.
 */
export async function sendInvoice(
  id: string,
  deliveryMethod: "platform_email" | "manual_download",
  /**
   * Whether the emailed PDF carries the rebilled-expense receipt pages
   * (lib/invoice-document.tsx). Default ON to match the PDF route's own
   * default; the send dialog's checkbox (status-actions.tsx) is what
   * turns it off. Ignored for manual_download, which attaches nothing.
   */
  includeReceipts: boolean = true,
  /**
   * What the pilot typed in this send's dialog, for this client, once. It
   * rides ALONGSIDE the account's saved template rather than replacing it
   * (lib/email/invoice-message.ts places the two in different blocks), so
   * a pilot who has set standing wording does not lose it by adding a note
   * about one trip. Bounded and trimmed below; empty means send exactly
   * what would have been sent before this parameter existed.
   */
  customMessage: string | null = null
): Promise<{ error: string | null }> {
  // Validated the same way updateInvoiceHeader validates its id — an
  // unvalidated string reaches Postgres as a malformed uuid, which
  // surfaces as a raw 22P02 error instead of an honest "not found".
  if (!UUID_RE.test(id)) return { error: "That invoice no longer exists." };

  const { user, account } = await requireAccount(`/invoices/${id}`);

  // CHECKED BEFORE THE STATUS TRANSITION, not after. A server action is a
  // public endpoint and the dialog's maxLength is a courtesy, not a
  // control — but the ORDERING is the part that matters: the transition
  // below mints the permanent invoice number and cannot be undone, so
  // refusing an over-long note afterwards would leave the invoice issued
  // with the pilot's words silently dropped and no way back.
  const note = customMessage?.trim() ?? "";
  if (note.length > MAX_CUSTOM_MESSAGE_CHARS) {
    return {
      error: `That message is longer than ${MAX_CUSTOM_MESSAGE_CHARS} characters. Nothing was sent and the invoice is still a draft — shorten it and try again.`,
    };
  }

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
  revalidatePath(DASHBOARD_PATH);

  if (deliveryMethod === "platform_email") {
    // Numbered and dated by the transition above, so the attachment now
    // matches the record exactly.
    const sent = await emailInvoice(
      supabase,
      account.id,
      id,
      "invoice",
      user.email,
      includeReceipts,
      note === "" ? null : note
    );
    if (!sent.ok) {
      return {
        error: `The invoice is now issued and numbered, but the email didn't go out — ${sent.error} Download the PDF and send it yourself; don't try to issue it again.`,
      };
    }
  }

  return { error: null };
}

/**
 * Sending a reminder on an invoice that is already out.
 *
 * Separate from sendInvoice because it must NOT touch status: an invoice that
 * is sent, or partly paid, stays exactly where it is when it is chased. Only
 * the mail goes out. Nothing here computes a late fee or threatens one — the
 * reference material is explicit that late-fee percentages are negotiated
 * convention rather than law, and a tool inventing a consequence the pilot has
 * not agreed with their client would do them real damage.
 */
export async function sendInvoiceReminder(
  id: string,
  /** Same per-send note as sendInvoice's — see that parameter's own comment. */
  customMessage: string | null = null
): Promise<{ error: string | null }> {
  if (!UUID_RE.test(id)) return { error: "That invoice no longer exists." };

  const { user, account } = await requireAccount(`/invoices/${id}`);

  const note = customMessage?.trim() ?? "";
  if (note.length > MAX_CUSTOM_MESSAGE_CHARS) {
    return {
      error: `That message is longer than ${MAX_CUSTOM_MESSAGE_CHARS} characters. Nothing was sent — shorten it and try again.`,
    };
  }

  const supabase = await createClient();

  // STATUS IS RE-READ HERE, not trusted from the screen that offered the
  // button. A server action is a public endpoint, not a private helper of the
  // component that rendered it, and the gap between render and click is
  // exactly where an invoice gets paid — by a Stripe webhook, in another tab,
  // or by the pilot recording a cheque on their phone. Without this check a
  // settled invoice can be chased for a balance of $0.00, and a voided one
  // chased for money nobody owes. Both land in the client's inbox and neither
  // is retractable.
  const { data: statusRow, error: statusError } = await supabase
    .from("invoices")
    .select("status")
    .eq("id", id)
    .eq("account_id", account.id)
    .maybeSingle();

  if (statusError) {
    return {
      error: `${friendlyDbError(statusError, "invoices.select")} Nothing was sent.`,
    };
  }
  const current = (statusRow as { status: string } | null)?.status;
  if (!current) return { error: "That invoice no longer exists." };
  if (current !== "sent" && current !== "partial") {
    const why =
      current === "paid"
        ? "It's already been paid in full."
        : current === "void"
          ? "It's been voided."
          : "It hasn't been issued yet.";
    return { error: `No reminder sent. ${why} Reload the page to see where it stands.` };
  }

  const sent = await emailInvoice(
    supabase,
    account.id,
    id,
    "reminder",
    user.email,
    // Receipts default ON everywhere else and a reminder keeps that
    // default; passed explicitly only because the note is positional after
    // it.
    //
    // NOT NECESSARILY "the same document the client already has", which is
    // what this comment claimed before and is false in two ordinary cases.
    // sendInvoice's receipts checkbox is a PER-SEND choice stored nowhere,
    // so an invoice first emailed with it UNticked gets a reminder carrying
    // the very receipt pages the pilot left out; and a manual_download
    // invoice was never emailed by this product at all, so there is no
    // "again" to appeal to. Rather than have the reminder guess at a
    // decision it cannot read, the reminder dialog now states plainly that
    // the full PDF goes with receipts included (status-actions.tsx), so the
    // pilot decides with that in front of them.
    //
    // Remembering the original choice is the better fix and is a schema
    // change — a column on pilot.invoices written at the draft->sent
    // transition, which is an owner-gated migration in this repo. It would
    // settle the same question for the client share link, whose half of
    // this is carried by share-panel.tsx.
    true,
    note === "" ? null : note
  );
  if (!sent.ok) return { error: sent.error };

  revalidatePath(`/invoices/${id}`);
  revalidatePath("/invoices");
  return { error: null };
}

/**
 * The shared half of both: load the client, render the document, compose the
 * words, hand it to the mail service. Returns rather than throws so every
 * caller has to deal with the failure in the UI.
 */
async function emailInvoice(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  accountId: string,
  invoiceId: string,
  kind: "invoice" | "reminder",
  /**
   * WHERE A REPLY GOES, and it must not be the platform.
   *
   * INVOICE_FROM_EMAIL is one deployment-wide sender shared by every tenant,
   * so without an explicit reply-to a client hitting Reply writes to a mailbox
   * belonging to the software vendor rather than to their pilot. That is wrong
   * in every case and actively harmful on a reminder, whose own words invite a
   * reply: "if anything on it needs correcting, let me know and I will send a
   * revised copy." The one person who can revise the bill would never see it,
   * and — worse for a product whose trust story is that AMG cannot see a
   * pilot's client relationships — the vendor would.
   *
   * The pilot's own signed-in address is the right target: it is verified by
   * Supabase Auth, it is theirs, and it needs no new column. If an account-level
   * billing address is ever wanted, this is the one place to change.
   */
  replyTo: string | undefined,
  /**
   * Attach rebilled-expense receipt pages to the PDF. Defaults true so the
   * reminder path keeps the same default as every other surface; only
   * sendInvoice's dialog checkbox ever passes false.
   */
  includeReceipts: boolean = true,
  /**
   * The pilot's per-send note, already trimmed and length-checked by the
   * caller. null on every path that does not offer the box.
   */
  customMessage: string | null = null
): Promise<{ ok: true; note: string } | { ok: false; error: string }> {
  if (!emailIsConfigured()) {
    return {
      ok: false,
      error:
        "Emailing isn't set up on this account yet, so nothing was sent. Download the PDF and send it yourself, or set the mail service up in the project's environment first.",
    };
  }

  const { data: invoiceRow, error: invoiceError } = await supabase
    .from("invoices")
    .select(
      "id, client_id, notes, stripe_payment_link_url, stripe_payment_link_livemode"
    )
    .eq("id", invoiceId)
    .eq("account_id", accountId)
    .maybeSingle();

  if (invoiceError) {
    return {
      ok: false,
      error: `${friendlyDbError(invoiceError, "invoices.select")} Nothing was sent.`,
    };
  }
  const invoice = invoiceRow as {
    client_id: string;
    notes: string | null;
    stripe_payment_link_url: string | null;
    stripe_payment_link_livemode: boolean | null;
    due_on?: string | null;
  } | null;
  if (!invoice) return { ok: false, error: "That invoice no longer exists." };

  const { data: clientRow, error: clientError } = await supabase
    .from("clients")
    .select("name, contact_name, contact_email")
    .eq("id", invoice.client_id)
    .eq("account_id", accountId)
    .maybeSingle();

  if (clientError) {
    return {
      ok: false,
      error: `${friendlyDbError(clientError, "clients.select")} Nothing was sent.`,
    };
  }
  const client = clientRow as {
    name: string;
    contact_name: string | null;
    contact_email: string | null;
  } | null;
  if (!client) {
    return { ok: false, error: "That invoice's client no longer exists." };
  }
  // The most common reason a send cannot happen, and the one the pilot can fix
  // in ten seconds — so it names the client and points at the screen.
  if (!looksLikeEmail(client.contact_email)) {
    return {
      ok: false,
      error: `${client.name} has no email address on file, so nothing was sent. Add one on the client's page and try again.`,
    };
  }

  const built = await buildInvoiceDocument(supabase, accountId, invoiceId, {
    includeReceipts,
  });
  if (!built.ok) {
    return { ok: false, error: `${built.error} Nothing was sent.` };
  }
  const doc = built.document;

  // THE MODE GUARD. A payment link minted in Stripe test mode is unpayable,
  // and putting one in a real client's inbox wastes their time and the
  // pilot's credibility. Same condition the invoice screen already applies
  // before it shows the link — kept identical on purpose.
  const paymentUrl =
    invoice.stripe_payment_link_url &&
    invoice.stripe_payment_link_livemode === isLiveMode()
      ? invoice.stripe_payment_link_url
      : null;

  // THE ACCOUNT'S SAVED WORDING, read at SEND time rather than carried in
  // from the screen that offered the button. Two reasons, and the second is
  // the load-bearing one: the reminder path has no dialog that could carry
  // it at all, and a template edited in another tab between render and
  // click must not send yesterday's sentence.
  //
  // loadPreferences is total — a missing row (the ordinary state) and a
  // failed read both resolve to the product's own defaults, which for this
  // section means "no template", i.e. exactly the built-in copy. So a
  // preferences outage costs a pilot their custom opening line and never
  // costs them the send. That is the right way round: the invoice going out
  // matters more than the sentence it opens with.
  const preferences = await loadPreferences(accountId);
  const template =
    kind === "reminder"
      ? preferences.templates.reminder
      : preferences.templates.invoice;

  const shared = {
    accountName: doc.accountName,
    clientName: client.name,
    contactName: client.contact_name,
    invoiceNumber: doc.invoiceNumber,
    dueOn: doc.dueOn,
    totalCents: doc.totalCents,
    balanceDueCents: doc.balanceDueCents,
    paymentUrl,
    notes: invoice.notes,
    // Genuinely-embedded receipt IMAGES only — not fallback/caption pages,
    // and never the toggle's intent. buildInvoiceDocument counts only images
    // that decoded and embedded, so the email cannot claim a receipt that
    // rode along as an on-request caption page. See
    // InvoiceMessageInput.receiptCount.
    receiptCount: doc.receiptCount,
    template,
    customMessage,
  };

  const message =
    kind === "reminder"
      ? buildReminderMessage({
          ...shared,
          daysOverdue: daysOverdue(doc.dueOn, new Date()),
        })
      : buildInvoiceMessage(shared);

  const result = await sendEmail({
    to: client.contact_email as string,
    subject: message.subject,
    text: message.text,
    // Only set when it is a usable address — a malformed reply-to is worse
    // than none, because some clients silently drop the whole message.
    replyTo: looksLikeEmail(replyTo) ? replyTo : undefined,
    attachments: [{ filename: doc.filename, content: doc.buffer }],
  });

  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true, note: result.id };
}

/**
 * Voiding an invoice that had a Stripe payment link on it USED TO FAIL
 * OUTRIGHT — raised in review, then reproduced against the schema rather
 * than taken on trust. `invoices_payment_link_requires_sendable_status`
 * (20260809040000) permits a stored link only on a sent/partial/paid
 * invoice; this action sent `{ status: 'void' }` and nothing else, so the
 * new row still carried the link, the CHECK fired 23514, and the pilot
 * got "Some of those values aren't valid together." on the one action
 * they most needed to work.
 *
 * The constraint is right and stays (see 20260810010000's header). What
 * was missing is the other half of voiding: a cancelled invoice must stop
 * being payable. So this deactivates the link on Stripe first, then
 * clears all four link columns in the SAME update that sets the status —
 * satisfying the CHECK — and tells the pilot when Stripe couldn't confirm
 * the deactivation, because then a live payment URL for a cancelled
 * invoice is still out there and only they can finish killing it.
 */
export async function voidInvoice(id: string): Promise<{ error: string | null }> {
  if (!UUID_RE.test(id)) return { error: "That invoice no longer exists." };

  const { account } = await requireAccount(`/invoices/${id}`);
  const supabase = await createClient();

  const { data: linkData } = await supabase
    .from("invoices")
    .select("stripe_payment_link_id")
    .eq("id", id)
    .eq("account_id", account.id)
    .maybeSingle();
  const paymentLinkId = (linkData as { stripe_payment_link_id: string | null } | null)
    ?.stripe_payment_link_id;

  let warning: string | undefined;
  if (paymentLinkId) {
    if (account.connect_account_id) {
      try {
        await deactivatePaymentLink({
          connectAccountId: account.connect_account_id,
          paymentLinkId,
        });
      } catch (err) {
        console.error(
          `deactivatePaymentLink failed while voiding invoice ${id}: ${
            err instanceof Error ? err.message : "unknown error"
          }`
        );
        warning = LINK_STILL_LIVE_WARNING;
      }
    } else {
      // A stored link with no connected account: Stripe was disconnected
      // between generating the link and voiding (connect_account_unlink
      // clears these columns, so this is a narrow window, not a normal
      // state). We have no way to reach the link — say so rather than
      // letting the pilot assume it died with the invoice.
      warning = LINK_STILL_LIVE_WARNING;
    }
  }

  const payload: InvoiceUpdate = {
    status: "void",
    stripe_payment_link_id: null,
    stripe_payment_link_url: null,
    stripe_payment_link_livemode: null,
    stripe_payment_link_amount_cents: null,
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

  // The warning travels as a query param rather than a return value
  // because StatusActions unmounts the moment the invoice becomes void
  // (it renders nothing for a void invoice) — a warning returned to that
  // component would be thrown away in the same render that produced it.
  // The invoice screen already renders `?warning=` as an amber callout,
  // which outlives the transition.
  if (warning) {
    redirect(`/invoices/${id}?warning=${encodeURIComponent(warning)}`);
  }
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

  const values = lineFormValues(formData);
  const { account } = await requireAccount(`/invoices/${invoiceId}`);

  const lineType = String(formData.get("line_type") ?? "");
  if (!(MANUAL_LINE_TYPES as readonly string[]).includes(lineType)) {
    // reimbursable_expense is deliberately excluded from manual add — the
    // migration's own CHECK ties that line_type to an actual expense_id;
    // use the "add a rebillable expense" list instead, which sets both
    // together.
    return { error: "Choose a line type.", values };
  }

  const description = String(formData.get("description") ?? "").trim();
  if (!description) return { error: "Give the line a description.", values };

  const quantity = parseQuantity(String(formData.get("quantity") ?? ""));
  if (quantity === undefined) {
    return { error: "Quantity must be a positive number, like 1 or 2.5.", values };
  }

  const unitAmountCents = parseDollarsToCents(
    String(formData.get("unit_amount") ?? "")
  );
  if (unitAmountCents === undefined || unitAmountCents === null || unitAmountCents < 0) {
    return { error: "Unit amount must be an amount like 150 or 150.00.", values };
  }

  const taxable = formData.get("taxable") === "on";
  const tripId = optional(formData, "trip_id");
  if (tripId !== null && !UUID_RE.test(tripId)) {
    return { error: "That trip isn't valid.", values };
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

  // F6: linesDbError, not friendlyDbError — this line can carry a
  // tripId, so it goes through the same invoice_lines_validate_trip
  // double-bill guard createInvoiceDraft's batched insert does.
  const { error } = await supabase.from("invoice_lines").insert(payload as never);
  if (error) return { error: linesDbError(error, "invoice_lines.insert"), values };

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
    } (${formatDate(expense.incurred_on)})`,
    quantity: 1,
    unit_amount_cents: expense.amount_cents,
    taxable: false,
    expense_id: expense.id,
    expense_treatment: "rebill",
  };

  // F6: linesDbError — this line resolves its trip via expense_id, so it
  // hits the same double-bill guard (the expense's trip could already be
  // committed to another live invoice).
  const { error } = await supabase.from("invoice_lines").insert(payload as never);
  if (error) return { error: linesDbError(error, "invoice_lines.insert") };

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

  const values = lineFormValues(formData);
  const { account } = await requireAccount(`/invoices/${invoiceId}`);

  const description = String(formData.get("description") ?? "").trim();
  if (!description) return { error: "Give the line a description.", values };

  const quantity = parseQuantity(String(formData.get("quantity") ?? ""));
  if (quantity === undefined) {
    return { error: "Quantity must be a positive number, like 1 or 2.5.", values };
  }

  const unitAmountCents = parseDollarsToCents(
    String(formData.get("unit_amount") ?? "")
  );
  if (unitAmountCents === undefined || unitAmountCents === null || unitAmountCents < 0) {
    return { error: "Unit amount must be an amount like 150 or 150.00.", values };
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

  if (error) return { error: friendlyDbError(error, "invoice_lines.update"), values };
  if (!count) return { error: "That line no longer exists.", values };

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
/**
 * Every field the payment form posts, as submitted — mirrors echo() /
 * lineFormValues() above. Payment-panel.tsx's `echoed()` reads
 * `state.values` on a rejected submit; without this, `values` never gets
 * set on any validation-failure return, so the echo was dead code and a
 * rejected payment blanked date/amount/method/notes on a money ledger.
 */
function paymentFormValues(formData: FormData): Record<string, string> {
  const str = (k: string) => String(formData.get(k) ?? "");
  return {
    invoice_id: str("invoice_id"),
    paid_on: str("paid_on"),
    amount: str("amount"),
    method: str("method"),
    notes: str("notes"),
  };
}

export async function recordPayment(
  _prev: InvoiceFormState,
  formData: FormData
): Promise<InvoiceFormState> {
  const invoiceId = String(formData.get("invoice_id") ?? "");
  if (!UUID_RE.test(invoiceId)) return { error: "Missing invoice id." };

  const { account } = await requireAccount(`/invoices/${invoiceId}`);

  const paidOn = String(formData.get("paid_on") ?? "").trim();
  if (!paidOn || !isDate(paidOn)) {
    return { error: "Give the payment a valid date.", values: paymentFormValues(formData) };
  }

  const amountCents = parseDollarsToCents(String(formData.get("amount") ?? ""));
  if (amountCents === undefined || amountCents === null || amountCents <= 0) {
    return {
      error: "Amount must be a positive amount like 1500 or 1500.00.",
      values: paymentFormValues(formData),
    };
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
    return {
      error: friendlyDbError(paymentError, "invoice_payments.insert"),
      values: paymentFormValues(formData),
    };
  }

  // Advance status to match the ledger — pilot.invoice_totals is the one
  // source for the balance (C2/C3), so read it rather than summing here.
  // Only attempted from 'sent'/'partial': invoices_protect_issued already
  // refuses 'draft' -> 'paid'/'partial' and 'paid' has no outbound
  // transition, so there is nothing to advance in either of those states.
  // The `error` is READ, not discarded. Dropping it made a failed read
  // indistinguishable from "this invoice isn't in an advanceable state":
  // `status` came back undefined, the whole advance block below was
  // skipped, and the function still returned saved: true. The payment had
  // landed, so the invoice stayed 'sent' — counted as awaiting payment and
  // rendered red as overdue by pilot.invoices_overdue (which filters on
  // status in ('sent','partial')) for an invoice that was fully paid. That
  // is the precise outcome the comment below this block says must not
  // happen; it guarded the UPDATE and not the two reads gating it.
  const { data: invoiceData, error: invoiceReadError } = await supabase
    .from("invoices")
    .select("status, stripe_payment_link_id")
    .eq("id", invoiceId)
    .eq("account_id", account.id)
    .maybeSingle();
  if (invoiceReadError) {
    return {
      error:
        "The payment was recorded, but the invoice's status couldn't be updated — reopen it and check whether it still shows as awaiting payment.",
      saved: true,
    };
  }
  const invoiceRow = invoiceData as {
    status: string;
    stripe_payment_link_id: string | null;
  } | null;
  const status = invoiceRow?.status;

  if (status === "sent" || status === "partial") {
    const { data: totalsData, error: totalsReadError } = await supabase
      .from("invoice_totals")
      .select("balance_due_cents")
      .eq("invoice_id", invoiceId)
      .maybeSingle();
    if (totalsReadError) {
      return {
        error:
          "The payment was recorded, but the invoice's status couldn't be updated — reopen it and check whether it still shows as awaiting payment.",
        saved: true,
      };
    }
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

  // RETIRE ANY LIVE PAYMENT LINK (added after review). A Payment Link is
  // priced from a Price created at generation time, which snapshots the
  // balance due at that moment. Once ANY payment lands the stored link is
  // stale by definition: a $2,000 cheque against a $5,000 invoice leaves a
  // link that still charges the full $5,000, and the invoice screen would
  // have kept handing it out. So a recorded payment kills the link and
  // clears the columns; if there's still a balance, the pilot generates a
  // fresh link for the new amount in one click.
  //
  // Order is deliberate — this runs AFTER the payment and status writes,
  // so a Stripe outage here never blocks recording money that has actually
  // arrived. It runs for a fully-paid invoice too: 'paid' is a legal state
  // to hold a link in (the CHECK allows it, for the race where the client
  // pays before the pilot records it), but there is nothing left to
  // collect, so leaving one live serves no one.
  const linkNotice = invoiceRow?.stripe_payment_link_id
    ? await retirePaymentLink({
        supabase,
        accountId: account.id,
        connectAccountId: account.connect_account_id,
        invoiceId,
        paymentLinkId: invoiceRow.stripe_payment_link_id,
      })
    : undefined;

  revalidatePath(`/invoices/${invoiceId}`);
  revalidatePath("/invoices");
  revalidatePath("/trips");
  return { error: null, saved: true, notice: linkNotice };
}

/**
 * Deactivates a Payment Link on Stripe and clears the invoice's four stored
 * link columns. Returns the sentence to show the pilot.
 *
 * The Stripe outcome and the DB outcome are deliberately different
 * sentences, because they ask different things of the pilot: a clean
 * retirement is just information ("that link is dead, make a new one if
 * you need it"); a failed Stripe deactivation is a task only they can
 * finish, in a dashboard this app cannot reach; and a failed or zero-row
 * clear of the four columns below means the app's OWN record of the link
 * is now wrong regardless of what Stripe did, which is worth its own
 * warning rather than silently trusting a screen that may be lying.
 */
async function retirePaymentLink(params: {
  supabase: Awaited<ReturnType<typeof createClient>>;
  accountId: string;
  connectAccountId: string | null;
  invoiceId: string;
  paymentLinkId: string;
}): Promise<string> {
  let notice =
    "The online payment link for this invoice was switched off, because it was priced for the previous balance. Generate a new one if you still need it.";

  if (params.connectAccountId) {
    try {
      await deactivatePaymentLink({
        connectAccountId: params.connectAccountId,
        paymentLinkId: params.paymentLinkId,
      });
    } catch (err) {
      console.error(
        `deactivatePaymentLink failed after recording a payment on invoice ${params.invoiceId}: ${
          err instanceof Error ? err.message : "unknown error"
        }`
      );
      notice = LINK_STILL_LIVE_WARNING;
    }
  } else {
    notice = LINK_STILL_LIVE_WARNING;
  }

  const { error, count } = await params.supabase
    .from("invoices")
    .update(
      {
        stripe_payment_link_id: null,
        stripe_payment_link_url: null,
        stripe_payment_link_livemode: null,
        stripe_payment_link_amount_cents: null,
      } as never,
      { count: "exact" }
    )
    .eq("id", params.invoiceId)
    .eq("account_id", params.accountId);

  if (error) {
    // Not worth failing the caller's payment/correction over — that already
    // landed — but the row still points at a link this app can no longer
    // manage, so the pilot needs telling, not just a server log.
    console.error(`[db] invoices.update(clear payment_link) ${error.message}`);
    return `${notice} This invoice's own record of that link also failed to clear — reload the page before trusting what it shows.`;
  }

  if (count === 0) {
    // PostgREST returns 200 even when the WHERE clause matches nothing —
    // wrong account_id (RLS) or the row moved between the read that found
    // paymentLinkId and this write. Either way the four columns above were
    // NOT cleared, so the screen would otherwise keep offering a link that
    // may already be dead on Stripe (or, if the Stripe call above also
    // failed, one that's still live) with no way to tell which.
    console.error(
      `[db] invoices.update(clear payment_link) matched 0 rows for invoice ${params.invoiceId}`
    );
    return `${notice} This invoice's own record of that link couldn't be updated — reload the page before trusting what it shows.`;
  }

  return notice;
}

/**
 * Correct a mistyped payment.
 *
 * NOT AN EDIT. pilot.invoice_payments has no UPDATE and no DELETE grant,
 * and this deliberately does not add one: the correction is a new row
 * carrying exactly the negative of the one it names, so the ledger shows
 * both what was recorded and what corrected it. If a client ever disputes
 * what they paid, that is evidence; a number that changed silently is not.
 * All of the arithmetic — same invoice, exact negative, not a correction
 * of a correction, only once — is enforced by the trigger and the unique
 * index in supabase/migrations/20260810120000_payment_reversals.sql, and
 * this function's job is to turn a form submission into that INSERT.
 *
 * The invoice's own status walks itself back (paid -> partial/sent) from
 * an AFTER trigger on the insert, so there is nothing to update here — and
 * nothing here can move an invoice's status by hand.
 */
export async function correctPayment(
  _prev: InvoiceFormState,
  formData: FormData
): Promise<InvoiceFormState> {
  const invoiceId = String(formData.get("invoice_id") ?? "");
  const paymentId = String(formData.get("payment_id") ?? "");
  if (!UUID_RE.test(invoiceId) || !UUID_RE.test(paymentId)) {
    return { error: "Missing payment." };
  }

  const { account } = await requireAccount(`/invoices/${invoiceId}`);
  const supabase = await createClient();

  // The amount is read back rather than taken from the form. The trigger
  // would reject a wrong one anyway, but a hidden input carrying the
  // figure a correction must equal is a field worth not having.
  const { data: original, error: readError } = await supabase
    .from("invoice_payments")
    .select("amount_cents")
    .eq("account_id", account.id)
    .eq("invoice_id", invoiceId)
    .eq("id", paymentId)
    .maybeSingle();

  if (readError) return { error: friendlyDbError(readError, "invoice_payments.select") };
  if (!original) return { error: "That payment is no longer on this invoice." };

  const reason = optional(formData, "reversal_reason");
  const payload = {
    account_id: account.id,
    invoice_id: invoiceId,
    // Today, not the original's date: the correction happened now, and
    // back-dating it would put a change to the books in a period that may
    // already have been reported.
    paid_on: new Date().toISOString().slice(0, 10),
    amount_cents: -(original as { amount_cents: number }).amount_cents,
    reverses_payment_id: paymentId,
    reversal_reason: reason,
  };

  const { error } = await supabase.from("invoice_payments").insert(payload as never);

  if (error) {
    // The trigger's own refusals are already written for a pilot to read.
    if (
      typeof error.message === "string" &&
      /cannot be corrected|cannot have a payment corrected|same invoice|exactly the negative|no such payment/.test(
        error.message
      )
    ) {
      return { error: error.message };
    }
    if (error.code === "23505") {
      return { error: "That payment has already been corrected." };
    }
    return { error: friendlyDbError(error, "invoice_payments.correct") };
  }

  // RETIRE ANY LIVE PAYMENT LINK — a correction changes balance_due_cents
  // for exactly the same reason recordPayment's own payment does (see that
  // function's comment above retirePaymentLink), so a stored link must be
  // killed here too. Without this, correcting an overstated payment leaves
  // a Payment Link on Stripe still priced for the WRONG, smaller balance —
  // the invoice screen would keep handing a client a link that charges
  // less than they actually owe. Read fresh rather than reused: nothing
  // earlier in this function touched pilot.invoices.
  const { data: invoiceData, error: invoiceReadError } = await supabase
    .from("invoices")
    .select("stripe_payment_link_id")
    .eq("id", invoiceId)
    .eq("account_id", account.id)
    .maybeSingle();

  let linkNotice: string | undefined;
  if (invoiceReadError) {
    // The correction already landed — the payment ledger is right either
    // way. A stale link surviving this read failure is the same "generate
    // a fresh one if the balance is off" recovery path recordPayment
    // leaves for its own Stripe-side failures, not a reason to fail a
    // correction that has already happened.
    console.error(
      `[db] invoices.select(stripe_payment_link_id) after correctPayment ${invoiceReadError.message}`
    );
  } else {
    const linkId = (invoiceData as { stripe_payment_link_id: string | null } | null)
      ?.stripe_payment_link_id;
    if (linkId) {
      linkNotice = await retirePaymentLink({
        supabase,
        accountId: account.id,
        connectAccountId: account.connect_account_id,
        invoiceId,
        paymentLinkId: linkId,
      });
    }
  }

  revalidatePath(`/invoices/${invoiceId}`);
  revalidatePath("/invoices");
  revalidatePath("/reports");
  return { error: null, saved: true, notice: linkNotice };
}

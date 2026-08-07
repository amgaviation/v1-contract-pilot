"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireAccount } from "@/lib/supabase/account";
import { parseDollarsToCents, formatDate, formatDateRange } from "@/lib/format";
import { friendlyDbError } from "@/lib/db-errors";
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
      .select("id, trip_id, day_on, day_type_id, rate_cents, quantity")
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
        "per_diem_mode, default_per_diem_cents, minimum_days, cancellation_policy_note"
      )
      .eq("account_id", account.id)
      .eq("id", clientId)
      .maybeSingle(),
    // Read-only, used for exactly one thing: deciding whether to surface
    // cancellation_policy_note as a warning. A SEPARATE query with its own
    // status='canceled' filter — not a relaxation of the completed-only
    // filter on the trips query above, which stays exactly as written.
    // These rows never feed `lines`.
    supabase
      .from("trips")
      .select("id")
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
  // Best-effort: a failed read here means "don't know", so it suppresses
  // the cancellation-note warning rather than blocking the draft — no
  // billing value depends on it, only a piece of review-time copy.
  const anyCanceledSelected =
    !canceledTripsError &&
    ((canceledTripRows ?? []) as { id: string }[]).length > 0;

  const lines: LineInsert[] = [];
  let sortOrder = 0;
  let skippedTravelDays = false;
  const warnings: string[] = [...preselectionWarnings];

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
        { dayTypeId: string; rateCents: number; dayOns: string[]; quantitySum: number }
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
          quantitySum: 0,
        };
        group.dayOns.push(row.day_on);
        // F1: sum the rows' OWN quantity (0.1-1.0 each, a half day is a
        // shipped feature) rather than counting rows — a group of two
        // rows can be 2.0 days or 1.3, and counting rows always says 2.
        group.quantitySum += Number(row.quantity);
        groups.set(key, group);
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
        const qty = roundQuantity(group.quantitySum);
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

      // Contract minimum — day-row path ONLY. A trip with no day rows
      // never reaches this branch, so minimum_days can never change what
      // a scalar-path trip bills.
      if (clientBilling?.minimum_days != null) {
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
      // SCALAR PATH — byte-for-byte the pre-Phase-9 logic. Left untouched
      // so a trip with zero trip_days rows bills exactly as it did before
      // this change, with no minimum-days or other new behavior applied.
      // ---------------------------------------------------------------
      if (Number(trip.day_count) > 0) {
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
        const perDiemCount = tripDayRows.filter(
          (row) => dayTypeMap.get(row.day_type_id)?.counts_for_per_diem === true
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
          // this trip is made up entirely of day types that don't count.
          warnings.push(
            `${formatDateRange(trip.starts_on, trip.ends_on)}: this client is on per diem, but none of this trip's day types count toward it, so no per-diem line was added.`
          );
        }
      } else {
        warnings.push(
          `${formatDateRange(trip.starts_on, trip.ends_on)}: this client is on per diem, but the trip has no day rows to count, so no per-diem line was added.`
        );
      }
    }
  }

  // Cancellation — a note, once, if the client has one on file and any
  // SELECTED trip is canceled. Never a computed fee: see
  // pilot.clients.cancellation_policy_note's comment in the Phase 9
  // migration on why an unenforceable percentage is worse than recording
  // the agreement and letting the pilot add the manual cancellation_fee
  // line themselves.
  if (clientBilling?.cancellation_policy_note && anyCanceledSelected) {
    warnings.push(
      `This client has a cancellation policy on file: "${clientBilling.cancellation_policy_note}". One or more selected trips is canceled — add a cancellation_fee line by hand if it applies.`
    );
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

  revalidatePath("/invoices");
  revalidatePath("/trips");
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

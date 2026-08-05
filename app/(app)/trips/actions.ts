"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireAccount } from "@/lib/supabase/account";
import { parseDollarsToCents, parseTenth } from "@/lib/format";
import { friendlyDbError } from "@/lib/db-errors";
import type { Database } from "@/lib/supabase/database.types";

type TripInsert = Database["pilot"]["Tables"]["trips"]["Insert"];
type TripUpdate = Database["pilot"]["Tables"]["trips"]["Update"];
/**
 * What the form produces: every writable column except account_id, which
 * comes from the session. Typed off Insert rather than Update so the
 * compiler still requires starts_on/ends_on — Update makes everything
 * optional, which would let a missing required column through.
 */
type TripFields = Omit<TripInsert, "account_id">;
type LegInsert = Database["pilot"]["Tables"]["trip_legs"]["Insert"];

/**
 * `values` echoes what was submitted so the form can repopulate itself.
 * React 19 resets an uncontrolled form on EVERY action dispatch, including
 * the one that came back with a validation error — without this, a single
 * typo in the day rate wipes every other field the pilot filled in.
 */
export type TripFormState = {
  error: string | null;
  saved?: boolean;
  values?: Record<string, string>;
};
export type LegFormState = { error: string | null };

const TRIP_KINDS = [
  "owner_trip",
  "ferry",
  "maintenance_flight",
  "repositioning",
  "contract_pilot",
  "delivery_flight",
  "other",
] as const;

const TRIP_STATUSES = ["scheduled", "in_progress", "completed", "canceled"] as const;

/**
 * `written_off` is deliberately NOT here. The migration describes it as
 * set by hand and never overwritten by the invoice sync, so a written-off
 * trip has not necessarily been invoiced at all — telling its owner "this
 * trip has been invoiced" and refusing to delete it would be false on both
 * counts.
 */
const INVOICED_STATES = ["invoiced", "paid"] as const;

/** Fields whose submitted text is echoed back on a failed submit. */
const TRIP_FIELDS = [
  "client_id",
  "trip_kind",
  "status",
  "starts_on",
  "ends_on",
  "aircraft_ident",
  "aircraft_type",
  "day_rate",
  "day_count",
  "travel_day_rate",
  "travel_day_count",
  "notes",
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

/**
 * A uuid from a form. Shape-checked here so a crafted POST comes back as
 * a sentence rather than as a raw `22P02 invalid input syntax for type
 * uuid` from Postgres.
 */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function optionalUuid(formData: FormData, key: string): string | null | undefined {
  const value = optional(formData, key);
  if (value === null) return null;
  return UUID_RE.test(value) ? value : undefined;
}

/** "YYYY-MM-DD", and a date that actually exists. */
function isDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(value);
}

function oneOf<T extends readonly string[]>(
  formData: FormData,
  key: string,
  allowed: T,
  fallback: T[number]
): T[number] {
  const value = String(formData.get(key) ?? "");
  return (allowed as readonly string[]).includes(value)
    ? (value as T[number])
    : fallback;
}

/**
 * ICAO identifiers are stored uppercase — the CHECK constraint on
 * trip_legs is `^[A-Z0-9]{3,4}$`, so a pilot typing "kbed" would
 * otherwise be rejected by the database for a formatting reason they
 * didn't cause. Normalising here is the fix; loosening the constraint
 * would let genuinely malformed identifiers in.
 */
function icao(formData: FormData, key: string): string | null {
  const value = String(formData.get(key) ?? "").trim().toUpperCase();
  return value === "" ? null : value;
}

type ParsedTrip = { values: TripFields | null; error: string | null };

function parseTripForm(formData: FormData): ParsedTrip {
  const startsOn = String(formData.get("starts_on") ?? "").trim();
  const endsOn = String(formData.get("ends_on") ?? "").trim();

  if (!startsOn || !endsOn) {
    return { values: null, error: "A trip needs a start and end date." };
  }
  if (!isDate(startsOn) || !isDate(endsOn)) {
    return { values: null, error: "Those dates aren't valid." };
  }
  if (endsOn < startsOn) {
    return { values: null, error: "The end date can't be before the start date." };
  }

  const clientId = optionalUuid(formData, "client_id");
  if (clientId === undefined) {
    return { values: null, error: "That client isn't valid." };
  }

  const dayRate = parseDollarsToCents(String(formData.get("day_rate") ?? ""));
  if (dayRate === undefined) {
    return { values: null, error: "Day rate must be an amount like 1500 or 1500.00." };
  }

  // Travel days bill at their own rate and draft their own invoice line
  // (Phase 5's `travel_day` line_type). Kept separate from flight days
  // rather than folded in, because a client who agreed to a reduced
  // travel rate would otherwise be billed the full day rate for them.
  const travelRate = parseDollarsToCents(
    String(formData.get("travel_day_rate") ?? "")
  );
  if (travelRate === undefined) {
    return { values: null, error: "Travel day rate must be an amount like 900 or 900.00." };
  }

  if ((dayRate ?? 0) < 0 || (travelRate ?? 0) < 0) {
    return { values: null, error: "Rates can't be negative." };
  }

  // numeric(5,1): one decimal place, and Postgres would silently round a
  // second one rather than refuse it. See parseTenth.
  const dayCount = parseTenth(String(formData.get("day_count") ?? ""), {
    max: 999,
  });
  if (dayCount === undefined || dayCount === null) {
    return {
      values: null,
      error: "Days must be a number with at most one decimal place, like 2 or 2.5.",
    };
  }

  const travelCountRaw = String(formData.get("travel_day_count") ?? "").trim();
  const travelCount = travelCountRaw === "" ? 0 : Number(travelCountRaw);
  if (!Number.isInteger(travelCount) || travelCount < 0 || travelCount > 999) {
    return { values: null, error: "Travel days must be a whole number." };
  }

  return {
    error: null,
    values: {
      client_id: clientId,
      trip_kind: oneOf(formData, "trip_kind", TRIP_KINDS, "contract_pilot"),
      status: oneOf(formData, "status", TRIP_STATUSES, "scheduled"),
      starts_on: startsOn,
      ends_on: endsOn,
      aircraft_ident: optional(formData, "aircraft_ident"),
      aircraft_type: optional(formData, "aircraft_type"),
      day_rate_cents: dayRate ?? 0,
      day_count: dayCount,
      travel_day_count: travelCount,
      travel_day_rate_cents: travelRate,
      notes: optional(formData, "notes"),
    },
  };
}

export async function createTrip(
  _prev: TripFormState,
  formData: FormData
): Promise<TripFormState> {
  const { account } = await requireAccount("/trips/new");
  const { values, error } = parseTripForm(formData);
  if (error || !values) {
    return {
      error: error ?? "Couldn't read that form.",
      values: echo(formData, TRIP_FIELDS),
    };
  }

  const supabase = await createClient();
  // Typed as Insert before the cast so a mistyped column name is a
  // compile error. The `as never` is only there because recent
  // supabase-js resolves .insert() against this hand-authored types file
  // to `never`; without the annotation above it, the cast would silently
  // disable every column-name check.
  const payload: TripInsert = { ...values, account_id: account.id };
  const { data, error: insertError } = await supabase
    .from("trips")
    .insert(payload as never)
    .select("id")
    .single();

  if (insertError) {
    return {
      error: friendlyDbError(insertError, "trips.insert"),
      values: echo(formData, TRIP_FIELDS),
    };
  }

  revalidatePath("/trips");
  // Straight into the trip, because the next thing a pilot does is add
  // legs — a trip with no legs derives no logbook entry and no route.
  redirect(`/trips/${(data as { id: string }).id}`);
}

export async function updateTrip(
  _prev: TripFormState,
  formData: FormData
): Promise<TripFormState> {
  const id = String(formData.get("id") ?? "");
  if (!id) return { error: "Missing trip id." };

  const { account } = await requireAccount(`/trips/${id}`);

  const supabase = await createClient();

  // The invoiced-trip lock is checked BEFORE the form is parsed. The
  // page disables the frozen fields, and a disabled input submits no
  // value at all — parsing first would reject a locked trip with "a trip
  // needs a start and end date", which is both wrong and baffling.
  //
  // The lock is enforced HERE, not only by the disabled
  // controls on the page. Phase 5's triggers guard the trip's client_id
  // once it has been billed but leave the amounts writable, so without
  // this a tenant could rewrite day_rate_cents or day_count on a trip
  // that has already gone out on an invoice and leave the two records
  // disagreeing about what was flown.
  const { data: current, error: readError } = await supabase
    .from("trips")
    .select("billing_state")
    .eq("id", id)
    .eq("account_id", account.id)
    .maybeSingle();

  if (readError) {
    return { error: friendlyDbError(readError, "trips.select") };
  }

  const billingState = (current as { billing_state: string } | null)?.billing_state;
  if (!billingState) return { error: "That trip no longer exists." };
  if ((INVOICED_STATES as readonly string[]).includes(billingState)) {
    return {
      error:
        "This trip is on an invoice, so its dates and amounts can't be changed. Correct the invoice instead.",
    };
  }

  const { values, error } = parseTripForm(formData);
  if (error || !values) {
    return {
      error: error ?? "Couldn't read that form.",
      values: echo(formData, TRIP_FIELDS),
    };
  }

  // billing_state is deliberately NOT in this payload even though the
  // grant allows it: it is derived from invoicing (Phase 5 keeps it in
  // sync via trigger), so letting a trip form set it by hand would let
  // the two disagree.
  // The account_id filter is defence in depth, not the boundary — see the
  // note in clients/actions.ts.
  const payload: TripUpdate = values;
  const { error: updateError } = await supabase
    .from("trips")
    .update(payload as never)
    .eq("id", id)
    .eq("account_id", account.id);

  if (updateError) {
    return {
      error: friendlyDbError(updateError, "trips.update"),
      values: echo(formData, TRIP_FIELDS),
    };
  }

  revalidatePath("/trips");
  revalidatePath(`/trips/${id}`);
  // No redirect — the pilot stays on the trip to keep working on its
  // legs — so `saved` is what tells them anything happened at all.
  return { error: null, saved: true };
}

export async function deleteTrip(id: string): Promise<{ error: string | null }> {
  const { account } = await requireAccount("/trips");

  const supabase = await createClient();
  const { error } = await supabase
    .from("trips")
    .delete()
    .eq("id", id)
    .eq("account_id", account.id);

  // Returned, not thrown. Two real cases reach here: a trip held by
  // invoice_lines' ON DELETE RESTRICT, and a trip carrying a `rebill`
  // expense, where the FK's ON DELETE SET NULL then trips the
  // `treatment <> 'rebill' or trip_id is not null` CHECK. A throw inside
  // the client's useTransition is swallowed, so the button would simply
  // appear to do nothing.
  if (error) return { error: friendlyDbError(error, "trips.delete") };

  revalidatePath("/trips");
  redirect("/trips");
}

// ---------------------------------------------------------------------------
// Legs
// ---------------------------------------------------------------------------

export async function addLeg(
  _prev: LegFormState,
  formData: FormData
): Promise<LegFormState> {
  const tripId = String(formData.get("trip_id") ?? "");
  if (!tripId || !UUID_RE.test(tripId)) return { error: "Missing trip id." };

  const { account } = await requireAccount(`/trips/${tripId}`);

  const legDate = String(formData.get("leg_date") ?? "").trim();
  if (!legDate) return { error: "Give the leg a date." };
  if (!isDate(legDate)) return { error: "That leg date isn't valid." };

  // numeric(4,1) — see parseTenth on why one decimal place is checked
  // here rather than left to Postgres to round away.
  const blockHours = parseTenth(String(formData.get("block_hours") ?? ""), {
    max: 999,
    allowBlank: true,
  });
  const nightHours = parseTenth(String(formData.get("night_hours") ?? ""), {
    max: 999,
    allowBlank: true,
  });
  const instrumentHours = parseTenth(
    String(formData.get("instrument_hours") ?? ""),
    { max: 999, allowBlank: true }
  );
  if (
    blockHours === undefined ||
    nightHours === undefined ||
    instrumentHours === undefined
  ) {
    return {
      error: "Times must be hours with at most one decimal place, like 1.4.",
    };
  }

  const counts: Record<string, number> = {};
  for (const field of [
    "day_landings",
    "night_takeoffs",
    "night_landings_full_stop",
    "night_landings_touch_go",
    "approaches",
    "holds",
  ]) {
    const raw = String(formData.get(field) ?? "").trim();
    const value = raw === "" ? 0 : Number(raw);
    if (!Number.isInteger(value) || value < 0 || value > 999) {
      return {
        error: "Landings, takeoffs, approaches and holds must be whole numbers.",
      };
    }
    counts[field] = value;
  }

  const supabase = await createClient();
  const payload: LegInsert = {
    account_id: account.id,
    // The composite FK (account_id, trip_id) → trips is what actually
    // stops a leg being attached to another tenant's trip; RLS on
    // trip_legs alone only checks the LEG's account_id, which the
    // migration's own header calls out as the trap here.
    trip_id: tripId,
    leg_date: legDate,
    from_icao: icao(formData, "from_icao"),
    to_icao: icao(formData, "to_icao"),
    block_hours: blockHours,
    night_hours: nightHours,
    instrument_hours: instrumentHours,
    day_landings: counts.day_landings,
    night_takeoffs: counts.night_takeoffs,
    night_landings_full_stop: counts.night_landings_full_stop,
    night_landings_touch_go: counts.night_landings_touch_go,
    approaches: counts.approaches,
    holds: counts.holds,
  };

  const { error } = await supabase.from("trip_legs").insert(payload as never);

  if (error) return { error: friendlyDbError(error, "trip_legs.insert") };

  revalidatePath(`/trips/${tripId}`);
  return { error: null };
}

export async function deleteLeg(
  id: string,
  tripId: string
): Promise<{ error: string | null }> {
  const { account } = await requireAccount(`/trips/${tripId}`);

  const supabase = await createClient();
  const { error } = await supabase
    .from("trip_legs")
    .delete()
    .eq("id", id)
    .eq("account_id", account.id);

  if (error) return { error: friendlyDbError(error, "trip_legs.delete") };

  revalidatePath(`/trips/${tripId}`);
  return { error: null };
}

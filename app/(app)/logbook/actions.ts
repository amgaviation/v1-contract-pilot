"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireAccount } from "@/lib/supabase/account";
import { parseTenth } from "@/lib/format";
import { friendlyDbError } from "@/lib/db-errors";
import {
  logbookFrom,
  draftPayloadForLeg,
  type LogbookEntryInsert,
  type LogbookEntryUpdate,
  type LogbookEntryFlightFields,
  type DraftLegRow,
  type DraftTripRow,
  type LogbookRole,
} from "./db";

export type LogbookFormState = {
  error: string | null;
  saved?: boolean;
  values?: Record<string, string>;
};

const ROLES = ["PIC", "SIC"] as const;
const SIMULATOR_DEVICE_TYPES = ["ftd", "atd", "other"] as const;
const APPROACH_TYPES = [
  "ils",
  "rnav_lpv",
  "rnav_lnav",
  "vor",
  "loc",
  "ndb",
  "visual",
  "other",
] as const;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Fields whose submitted text is echoed back on a failed submit. */
const ENTRY_FIELDS = [
  "entry_date",
  "aircraft_ident",
  "aircraft_type",
  "from_icao",
  "to_icao",
  "role",
  "total_time",
  "pic_time",
  "sic_time",
  "solo_time",
  "cross_country_time",
  "night_time",
  "instrument_actual_time",
  "instrument_simulated_time",
  "flight_instructor_time",
  "dual_received_time",
  "simulator_time",
  "simulator_device_type",
  "day_landings_full_stop",
  "day_landings_touch_go",
  "night_takeoffs",
  "night_landings_full_stop",
  "night_landings_touch_go",
  "approaches_count",
  "approach_type",
  "holds",
  "remarks",
] as const;

function echo(formData: FormData) {
  const out: Record<string, string> = {};
  for (const field of ENTRY_FIELDS) out[field] = String(formData.get(field) ?? "");
  return out;
}

function optional(formData: FormData, key: string): string | null {
  const value = String(formData.get(key) ?? "").trim();
  return value === "" ? null : value;
}

function isDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(value);
}

function optionalOneOf<T extends readonly string[]>(
  formData: FormData,
  key: string,
  allowed: T
): T[number] | null {
  const value = optional(formData, key);
  if (value === null) return null;
  return (allowed as readonly string[]).includes(value) ? (value as T[number]) : null;
}

/** ICAO identifiers are stored uppercase; see app/(app)/trips/actions.ts's icao() for why. */
function icao(formData: FormData, key: string): string | null {
  const value = String(formData.get(key) ?? "").trim().toUpperCase();
  return value === "" ? null : value;
}

/** numeric(4,1) time field: at most one decimal place, non-negative. */
function time(formData: FormData, key: string): number | null | undefined {
  return parseTenth(String(formData.get(key) ?? ""), { max: 999, allowBlank: true });
}

/** integer count field, e.g. landings or approaches. */
function count(formData: FormData, key: string): number | undefined {
  const raw = String(formData.get(key) ?? "").trim();
  const value = raw === "" ? 0 : Number(raw);
  if (!Number.isInteger(value) || value < 0 || value > 999) return undefined;
  return value;
}

type ParsedEntry = { values: LogbookEntryFlightFields | null; error: string | null };

/**
 * Parses the flight-data fields only — the fields a manual create or any
 * edit is allowed to touch. Provenance (source, trip_id, trip_leg_id, the
 * import-lineage columns) never comes from this form; it's set once, by
 * the code path that creates the row, and is withheld from the UPDATE
 * grant so it can't be rewritten later even by a crafted POST.
 */
function parseEntryForm(formData: FormData): ParsedEntry {
  const entryDate = String(formData.get("entry_date") ?? "").trim();
  if (!entryDate) return { values: null, error: "What date did you fly?" };
  if (!isDate(entryDate)) return { values: null, error: "That date isn't valid." };

  const totalTime = time(formData, "total_time");
  if (totalTime === undefined) {
    return { values: null, error: "Total time must be hours with at most one decimal place, like 1.4." };
  }
  if (totalTime === null) {
    return { values: null, error: "How much total time did you fly?" };
  }

  // A missing or unrecognised role used to fall back to "PIC" silently,
  // the same guess HIGH-CRITICAL flagged in the trip-draft confirm path.
  // On a legal record there is no safe default crew role — reject it the
  // same way total_time already is, rather than letting a crafted or
  // stale POST assert PIC on the pilot's behalf.
  const roleRaw = String(formData.get("role") ?? "");
  if (!(ROLES as readonly string[]).includes(roleRaw)) {
    return { values: null, error: "Pick a crew role — PIC or SIC." };
  }
  const role = roleRaw as (typeof ROLES)[number];

  const timeFields = [
    "pic_time",
    "sic_time",
    "solo_time",
    "cross_country_time",
    "night_time",
    "instrument_actual_time",
    "instrument_simulated_time",
    "flight_instructor_time",
    "dual_received_time",
    "simulator_time",
  ] as const;
  const times: Record<string, number | null> = {};
  for (const field of timeFields) {
    const value = time(formData, field);
    if (value === undefined) {
      return { values: null, error: "Times must be hours with at most one decimal place, like 1.4." };
    }
    times[field] = value;
  }

  const countFields = [
    "day_landings_full_stop",
    "day_landings_touch_go",
    "night_takeoffs",
    "night_landings_full_stop",
    "night_landings_touch_go",
    "approaches_count",
    "holds",
  ] as const;
  const counts: Record<string, number> = {};
  for (const field of countFields) {
    const value = count(formData, field);
    if (value === undefined) {
      return {
        values: null,
        error: "Landings, takeoffs, approaches and holds must be whole numbers.",
      };
    }
    counts[field] = value;
  }

  const simulatorDeviceType = optionalOneOf(
    formData,
    "simulator_device_type",
    SIMULATOR_DEVICE_TYPES
  );
  // Matches the migration's CHECK: non-zero simulator_time needs a device
  // type. Caught here so a mismatch is a sentence, not a raw constraint
  // name from friendlyDbError.
  if ((times.simulator_time ?? 0) > 0 && !simulatorDeviceType) {
    return {
      values: null,
      error: "Pick the simulator/FTD/ATD device type for the simulator time you logged.",
    };
  }

  const approachType = optionalOneOf(formData, "approach_type", APPROACH_TYPES);
  if (approachType && counts.approaches_count === 0) {
    return {
      values: null,
      error: "You picked an approach type but logged zero approaches — add the count.",
    };
  }

  return {
    error: null,
    values: {
      entry_date: entryDate,
      aircraft_ident: optional(formData, "aircraft_ident"),
      aircraft_type: optional(formData, "aircraft_type"),
      from_icao: icao(formData, "from_icao"),
      to_icao: icao(formData, "to_icao"),
      role,
      total_time: totalTime,
      pic_time: times.pic_time ?? null,
      sic_time: times.sic_time ?? null,
      solo_time: times.solo_time ?? null,
      cross_country_time: times.cross_country_time ?? null,
      night_time: times.night_time ?? null,
      instrument_actual_time: times.instrument_actual_time ?? null,
      instrument_simulated_time: times.instrument_simulated_time ?? null,
      flight_instructor_time: times.flight_instructor_time ?? null,
      dual_received_time: times.dual_received_time ?? null,
      simulator_time: times.simulator_time ?? null,
      simulator_device_type: simulatorDeviceType,
      day_landings_full_stop: counts.day_landings_full_stop ?? 0,
      day_landings_touch_go: counts.day_landings_touch_go ?? 0,
      night_takeoffs: counts.night_takeoffs ?? 0,
      night_landings_full_stop: counts.night_landings_full_stop ?? 0,
      night_landings_touch_go: counts.night_landings_touch_go ?? 0,
      approaches_count: counts.approaches_count ?? 0,
      approach_type: approachType,
      holds: counts.holds ?? 0,
      remarks: optional(formData, "remarks"),
    },
  };
}

// ---------------------------------------------------------------------------
// Manual entries
// ---------------------------------------------------------------------------

export async function createLogbookEntry(
  _prev: LogbookFormState,
  formData: FormData
): Promise<LogbookFormState> {
  const { account } = await requireAccount("/logbook/new");
  const { values, error } = parseEntryForm(formData);
  if (error || !values) {
    return { error: error ?? "Couldn't read that form.", values: echo(formData) };
  }

  const supabase = await createClient();
  const payload: LogbookEntryInsert = {
    ...values,
    account_id: account.id,
    // Every entry created from this form is a manual entry by definition
    // — there is no path from here into 'trip', 'import', or
    // 'foreflight_sync'. Those are set only by confirmLegDraft/
    // confirmTripDrafts and (in a later phase) the import/sync code.
    source: "manual",
    trip_id: null,
    trip_leg_id: null,
  };
  const { error: insertError } = await logbookFrom(supabase, "logbook_entries").insert(
    payload as never
  );

  if (insertError) {
    return {
      error: friendlyDbError(insertError, "logbook_entries.insert"),
      values: echo(formData),
    };
  }

  revalidatePath("/logbook");
  redirect("/logbook");
}

export async function updateLogbookEntry(
  _prev: LogbookFormState,
  formData: FormData
): Promise<LogbookFormState> {
  const id = String(formData.get("id") ?? "");
  if (!id || !UUID_RE.test(id)) return { error: "Missing logbook entry id." };

  const { account } = await requireAccount(`/logbook/${id}`);
  const { values, error } = parseEntryForm(formData);
  if (error || !values) {
    return { error: error ?? "Couldn't read that form.", values: echo(formData) };
  }

  const supabase = await createClient();
  // Only the flight-data columns are ever sent, matching the UPDATE
  // grant — source/trip_id/trip_leg_id/import lineage cannot be changed
  // by this or any other action; see the migration's GRANTS comment.
  const payload: LogbookEntryUpdate = values;
  // account_id filter is defence in depth, not the boundary — RLS is.
  const { error: updateError, count: rowCount } = await logbookFrom(
    supabase,
    "logbook_entries"
  )
    .update(payload as never, { count: "exact" })
    .eq("id", id)
    .eq("account_id", account.id);

  if (updateError) {
    return {
      error: friendlyDbError(updateError, "logbook_entries.update"),
      values: echo(formData),
    };
  }
  // PostgREST returns 200 with no error for a write that matched no rows.
  if (rowCount === 0) {
    return { error: "That logbook entry no longer exists.", values: echo(formData) };
  }

  revalidatePath("/logbook");
  revalidatePath(`/logbook/${id}`);
  redirect("/logbook");
}

export async function deleteLogbookEntry(id: string): Promise<{ error: string | null }> {
  const { account } = await requireAccount("/logbook");

  const supabase = await createClient();
  const { error, count: rowCount } = await logbookFrom(supabase, "logbook_entries")
    .delete({ count: "exact" })
    .eq("id", id)
    .eq("account_id", account.id);

  if (error) return { error: friendlyDbError(error, "logbook_entries.delete") };
  if (rowCount === 0) return { error: "That logbook entry no longer exists." };

  revalidatePath("/logbook");
  redirect("/logbook");
}

// ---------------------------------------------------------------------------
// Trip-derived drafts — confirmed, never triggered. See the Phase 6
// migration's file header for why there is no draft/proposal TABLE: the
// proposal is computed at read time (app/(app)/logbook/drafts/page.tsx)
// from trip_legs that no logbook_entries row yet references via
// trip_leg_id, and confirming here is the ONLY code path that ever writes
// a source='trip' row.
// ---------------------------------------------------------------------------

/** Shape-checks a role posted from the drafts screen the same way UUID_RE guards an id. */
function isRole(value: unknown): value is LogbookRole {
  return (ROLES as readonly string[]).includes(String(value));
}

/**
 * Confirms ONE leg's proposed entry. Re-reads the trip and the leg fresh
 * (never trusts anything the client sent beyond the id) so the numbers
 * that land in the logbook are exactly what's on the trip right now, not
 * whatever was on screen when the pilot opened the drafts page.
 *
 * `role` is required and validated here rather than defaulted — see
 * draftPayloadForLeg's comment in db.ts for why trip_legs never supplies
 * one on its own.
 */
export async function confirmLegDraft(
  tripLegId: string,
  role: LogbookRole
): Promise<{ error: string | null }> {
  if (!UUID_RE.test(tripLegId)) return { error: "That leg isn't valid." };
  if (!isRole(role)) return { error: "Pick PIC or SIC before confirming." };
  const { account } = await requireAccount("/logbook/drafts");

  const supabase = await createClient();
  const { data: legData, error: legError } = await supabase
    .from("trip_legs")
    .select(
      "id, trip_id, leg_date, from_icao, to_icao, block_hours, night_hours, instrument_hours, day_landings, night_takeoffs, night_landings_full_stop, night_landings_touch_go, approaches, holds"
    )
    .eq("id", tripLegId)
    .eq("account_id", account.id)
    .maybeSingle();

  if (legError) return { error: friendlyDbError(legError, "trip_legs.select") };
  const leg = legData as DraftLegRow | null;
  if (!leg) return { error: "That leg no longer exists." };

  const { data: tripData, error: tripError } = await supabase
    .from("trips")
    .select("id, starts_on, ends_on, aircraft_ident, aircraft_type, status")
    .eq("id", leg.trip_id)
    .eq("account_id", account.id)
    .maybeSingle();

  if (tripError) return { error: friendlyDbError(tripError, "trips.select") };
  const trip = tripData as DraftTripRow | null;
  if (!trip) return { error: "That trip no longer exists." };
  if (trip.status !== "completed") {
    return { error: "Only legs on a completed trip can be confirmed to the logbook." };
  }

  const payload: LogbookEntryInsert = {
    ...draftPayloadForLeg(trip, leg, role),
    account_id: account.id,
    source: "trip",
  };

  const { error: insertError } = await logbookFrom(supabase, "logbook_entries").insert(
    payload as never
  );

  if (insertError) {
    // 23505 here means logbook_entries_trip_leg_uniq fired — someone
    // (this pilot, in another tab) already confirmed this exact leg. That
    // is a race, not a real failure: the entry exists either way.
    if ((insertError as { code?: string }).code === "23505") {
      revalidatePath("/logbook/drafts");
      return { error: "That leg was already confirmed to your logbook." };
    }
    return { error: friendlyDbError(insertError, "logbook_entries.insert") };
  }

  revalidatePath("/logbook/drafts");
  revalidatePath("/logbook");
  return { error: null };
}

/**
 * Confirms every not-yet-confirmed leg on one completed trip in a single
 * insert. Same re-read-fresh discipline as confirmLegDraft — the set of
 * "unconfirmed" legs is computed here, at confirm time, not accepted from
 * the caller.
 *
 * `role` applies to every leg the batch confirms. Trip_legs has no
 * per-leg seat assignment, and requiring N separate role choices for one
 * "confirm the whole trip" click would defeat the point of a batch
 * button — so this asks once, for the trip, on the understanding that a
 * contract pilot flies one seat for the duration of a trip. A pilot who
 * swapped seats mid-trip can still confirm legs individually with
 * confirmLegDraft, each with its own role.
 */
export async function confirmTripDrafts(
  tripId: string,
  role: LogbookRole
): Promise<{ error: string | null }> {
  if (!UUID_RE.test(tripId)) return { error: "That trip isn't valid." };
  if (!isRole(role)) return { error: "Pick PIC or SIC before confirming." };
  const { account } = await requireAccount("/logbook/drafts");

  const supabase = await createClient();
  const { data: tripData, error: tripError } = await supabase
    .from("trips")
    .select("id, starts_on, ends_on, aircraft_ident, aircraft_type, status")
    .eq("id", tripId)
    .eq("account_id", account.id)
    .maybeSingle();

  if (tripError) return { error: friendlyDbError(tripError, "trips.select") };
  const trip = tripData as DraftTripRow | null;
  if (!trip) return { error: "That trip no longer exists." };
  if (trip.status !== "completed") {
    return { error: "Only a completed trip's legs can be confirmed to the logbook." };
  }

  const { data: legData, error: legsError } = await supabase
    .from("trip_legs")
    .select(
      "id, trip_id, leg_date, from_icao, to_icao, block_hours, night_hours, instrument_hours, day_landings, night_takeoffs, night_landings_full_stop, night_landings_touch_go, approaches, holds"
    )
    .eq("trip_id", tripId)
    .eq("account_id", account.id);

  if (legsError) return { error: friendlyDbError(legsError, "trip_legs.select") };
  const legs = (legData ?? []) as DraftLegRow[];
  if (legs.length === 0) return { error: "This trip has no legs to confirm." };

  const { data: confirmedData, error: confirmedError } = await logbookFrom(
    supabase,
    "logbook_entries"
  )
    .select("trip_leg_id")
    .eq("account_id", account.id)
    .eq("trip_id", tripId)
    .not("trip_leg_id", "is", null);

  if (confirmedError) {
    return { error: friendlyDbError(confirmedError, "logbook_entries.select") };
  }
  const confirmedLegIds = new Set(
    ((confirmedData ?? []) as { trip_leg_id: string }[]).map((row) => row.trip_leg_id)
  );

  const unconfirmed = legs.filter((leg) => !confirmedLegIds.has(leg.id));
  if (unconfirmed.length === 0) {
    return { error: "Every leg on this trip is already in your logbook." };
  }

  const payload: LogbookEntryInsert[] = unconfirmed.map((leg) => ({
    ...draftPayloadForLeg(trip, leg, role),
    account_id: account.id,
    source: "trip",
  }));

  const { error: insertError } = await logbookFrom(supabase, "logbook_entries").insert(
    payload as never
  );

  if (insertError) {
    return { error: friendlyDbError(insertError, "logbook_entries.insert") };
  }

  revalidatePath("/logbook/drafts");
  revalidatePath("/logbook");
  return { error: null };
}

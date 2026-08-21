"use server";

/**
 * The pilot's fleet: register an airframe, correct it, retire it.
 *
 * A PILOT CANNOT DELETE ONE THAT HAS FLOWN. pilot.aircraft used to carry
 * no DELETE grant at all and a `using (false)` policy behind it, because a
 * registry row is what gives three years of logbook entries their type —
 * deleting one would silently retype history that the pilot never touched.
 * Retiring is `archived_at`, which takes the airframe out of the pickers
 * and leaves the join alone, and it is still the right answer for a tail
 * that has been anywhere.
 *
 * 20260820100000 narrows that blanket refusal to the rows it was actually
 * about. The policy is now ordinary tenancy, and deleteAircraft below
 * carries the other half of the rule — no logbook entry, no trip — because
 * the database CANNOT carry it: the logbook joins this table on a
 * normalised tail key computed at read time, not through a foreign key, so
 * there is no reference for Postgres to restrict on. A tail typed wrong
 * and registered five minutes ago can now simply go.
 *
 * That is a statement about tenants, NOT about the row. The account FK is
 * `on delete cascade`, and referential-integrity actions bypass both RLS
 * and grants — closing an account takes its fleet with it. Nothing closes
 * an account today (only service_role can, and the Stripe webhook updates
 * status rather than deleting), so this is dormant teardown semantics and
 * the right shape. Whoever builds account closure should know the fleet
 * goes silently.
 */

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireAccount } from "@/lib/supabase/account";
import { friendlyDbError } from "@/lib/db-errors";
// This directory moved from app/(app)/logbook/aircraft to app/(app)/aircraft
// (promoted to a top-level section); logbookFrom still lives one level up
// from its OLD position, so the relative "../db" that used to reach it no
// longer resolves and this is now an absolute import instead.
import { logbookFrom } from "@/app/(app)/logbook/db";
import {
  normaliseTypeDesignator,
  normaliseTypeRating,
  parseTristate,
  tailKey,
  type AircraftGear,
  type AircraftInsert,
  type AircraftUpdate,
} from "./db";

/**
 * `values` echoes what was submitted so the form can repopulate itself.
 * React 19 calls native form.reset() on EVERY action dispatch, the error
 * path included — without this, one bad character in the type designator
 * blanks the whole form.
 */
export type AircraftFormState = {
  error: string | null;
  values?: Record<string, string>;
  /**
   * Set ONLY by a write that actually happened. The form uses it to close
   * its panel, and it has to be an explicit flag rather than "no error and
   * no echoed values" — that description is also true of the initial state,
   * so the panel would have closed itself on mount, before the pilot typed
   * anything.
   */
  saved?: true;
};

const FIELDS = [
  "tail_number",
  "type_designator",
  "type_rating",
  "make_model",
  "gear",
  "category_class",
  "client_id",
  "is_turbine",
  "is_retractable",
  "notes",
] as const;

function echo(formData: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const field of FIELDS) out[field] = String(formData.get(field) ?? "");
  return out;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const GEARS: readonly AircraftGear[] = ["tricycle", "tailwheel", "skid", "float", "ski"];
const TYPE_DESIGNATOR_RE = /^[A-Z0-9]{2,4}$/;
const TYPE_RATING_RE = /^[A-Z0-9-]{2,10}$/;

function trimmedOrNull(formData: FormData, field: string): string | null {
  const value = String(formData.get(field) ?? "").trim();
  return value === "" ? null : value;
}

/**
 * A uuid from a form, or null for "not set" — undefined signals a
 * malformed value so the caller can reject it with a sentence rather than
 * let a crafted POST reach Postgres as a raw `22P02 invalid input syntax
 * for type uuid`. Same idiom as expenses/actions.ts and
 * documents/actions.ts's own optionalUuid; this one is built on
 * trimmedOrNull above rather than duplicating it under a second name.
 */
function optionalUuid(formData: FormData, field: string): string | null | undefined {
  const value = trimmedOrNull(formData, field);
  if (value === null) return null;
  return UUID_RE.test(value) ? value : undefined;
}

type Parsed =
  | { ok: false; error: string }
  | {
      ok: true;
      fields: {
        tail_number: string;
        type_designator: string | null;
        type_rating: string | null;
        make_model: string | null;
        gear: AircraftGear | null;
        category_class: string | null;
        client_id: string | null;
        is_turbine: boolean | null;
        is_retractable: boolean | null;
        notes: string | null;
      };
    };

function parse(formData: FormData): Parsed {
  const tailNumber = String(formData.get("tail_number") ?? "").trim();
  if (tailNumber.length < 2 || tailNumber.length > 12) {
    return { ok: false, error: "A registration is between 2 and 12 characters, for example N447SP or G-ABCD." };
  }
  if (tailKey(tailNumber) === "") {
    return { ok: false, error: "That registration has no letters or numbers in it." };
  }

  const designatorRaw = String(formData.get("type_designator") ?? "");
  const designator = normaliseTypeDesignator(designatorRaw);
  if (designator !== null && !TYPE_DESIGNATOR_RE.test(designator)) {
    // Checked here as well as in the CHECK so the pilot gets the reason
    // rather than "Some of those values aren't valid together" — the type
    // designator is the field most likely to be filled in with a marketing
    // name, and "Citation V" is a reasonable thing to have typed.
    return {
      ok: false,
      error:
        "The ICAO type designator is 2 to 4 letters or digits, for example C560 for a Citation V or BE40 for a Beechjet. Leave it blank if you're not sure.",
    };
  }

  const rating = normaliseTypeRating(String(formData.get("type_rating") ?? ""));
  if (rating !== null && !TYPE_RATING_RE.test(rating)) {
    return {
      ok: false,
      error:
        "A type rating is 2 to 10 letters, digits or hyphens, for example CE-500 for the Citation series, B-737, or LR-JET. Leave it blank if you don't hold one.",
    };
  }

  const gearRaw = String(formData.get("gear") ?? "").trim();
  if (gearRaw !== "" && !GEARS.includes(gearRaw as AircraftGear)) {
    return { ok: false, error: "That isn't one of the landing gear options." };
  }

  // Shape-checked here; tenancy is enforced by the composite FK
  // (aircraft_client_fk, 20260818220000) at write time, the same division
  // of labour documents/actions.ts and expenses/actions.ts use for their
  // own optional client_id — a cross-tenant or invented id fails there and
  // friendlyDbError turns the 23503 into a sentence.
  const clientId = optionalUuid(formData, "client_id");
  if (clientId === undefined) {
    return { ok: false, error: "That client isn't valid." };
  }

  return {
    ok: true,
    fields: {
      tail_number: tailNumber,
      type_designator: designator,
      type_rating: rating,
      make_model: trimmedOrNull(formData, "make_model"),
      // Left unstated rather than guessed. 61.57(a)(1)'s full-stop
      // condition turns on this, and "nobody said" is a different fact
      // from "tricycle".
      gear: gearRaw === "" ? null : (gearRaw as AircraftGear),
      category_class: trimmedOrNull(formData, "category_class"),
      // Optional, and not merely absent: a freelance-fleet tail belongs to
      // no client at all. See the migration header for why the link lives
      // on the registry row rather than on a trip or logbook entry.
      client_id: clientId,
      // TRI-STATE, and left unstated rather than guessed — the same rule as
      // `gear` above, and the same rule the columns themselves carry
      // (20260811040000, 20260813110000): NULL means nobody said, and it
      // must never resolve to false. A turbine or retract figure computed
      // over an unannotated fleet would be confidently short, so the
      // pilot-history report reports the shortfall instead of hiding it —
      // which only works if "not recorded" survives this parse. Anything
      // unrecognised takes the same route, so a malformed post cannot
      // manufacture an assertion.
      is_turbine: parseTristate(String(formData.get("is_turbine") ?? "")),
      is_retractable: parseTristate(String(formData.get("is_retractable") ?? "")),
      notes: trimmedOrNull(formData, "notes"),
    },
  };
}

export async function createAircraft(
  _prev: AircraftFormState,
  formData: FormData
): Promise<AircraftFormState> {
  const parsed = parse(formData);
  if (!parsed.ok) return { error: parsed.error, values: echo(formData) };

  const { account } = await requireAccount("/aircraft");
  if (!account) return { error: "No account.", values: echo(formData) };

  const supabase = await createClient();
  const payload: AircraftInsert = { account_id: account.id, ...parsed.fields };

  const { error } = await logbookFrom(supabase, "aircraft").insert(payload);

  if (error) {
    // 23505 is the unique key doing its job — the pilot already has this
    // airframe under a different spelling. Name it, because "That already
    // exists" leaves them hunting for something they wrote as N-447SP.
    if (error.code === "23505") {
      const key = tailKey(parsed.fields.tail_number);
      // RLS already confines this SELECT to the pilot's own accounts, so
      // the account_id filter is redundant — and stays anyway. This is the
      // one read in the feature whose result is rendered back to a user as
      // another row's content, which makes "confined by one mechanism" a
      // worse answer than "confined by two".
      const { data } = await logbookFrom(supabase, "aircraft")
        .select("tail_number")
        .eq("account_id", account.id)
        .eq("tail_key", key)
        .maybeSingle();
      const existing = (data as { tail_number: string } | null)?.tail_number;
      return {
        error: existing
          ? `You already have this aircraft. It's in your fleet as ${existing}.`
          : "You already have this aircraft.",
        values: echo(formData),
      };
    }
    return { error: friendlyDbError(error, "aircraft.insert"), values: echo(formData) };
  }

  revalidatePath("/aircraft");
  revalidatePath("/logbook");
  return { error: null, saved: true };
}

export async function updateAircraft(
  _prev: AircraftFormState,
  formData: FormData
): Promise<AircraftFormState> {
  const id = String(formData.get("id") ?? "");
  if (!UUID_RE.test(id)) return { error: "Missing aircraft.", values: echo(formData) };

  const parsed = parse(formData);
  if (!parsed.ok) return { error: parsed.error, values: echo(formData) };

  const { account } = await requireAccount("/aircraft");
  if (!account) return { error: "No account.", values: echo(formData) };

  const supabase = await createClient();
  const payload: AircraftUpdate = parsed.fields;

  // PostgREST answers 200 for a write that matched no rows, so the count
  // is the only thing that distinguishes "saved" from "silently did
  // nothing because RLS filtered the row out".
  const { error, count } = await logbookFrom(supabase, "aircraft")
    .update(payload, { count: "exact" })
    .eq("id", id)
    .eq("account_id", account.id);

  if (error) {
    if (error.code === "23505") {
      return {
        error: "Another aircraft in your fleet already has that registration.",
        values: echo(formData),
      };
    }
    return { error: friendlyDbError(error, "aircraft.update"), values: echo(formData) };
  }
  if (count === 0) return { error: "That aircraft is no longer in your fleet.", values: echo(formData) };

  revalidatePath("/aircraft");
  revalidatePath("/logbook");
  return { error: null, saved: true };
}

/**
 * Retire an airframe, or bring it back. Not a delete — see the file
 * header. `archived` is read from the form rather than toggled from the
 * current value so a double-submit is idempotent instead of flipping.
 */
export async function setAircraftArchived(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  if (!UUID_RE.test(id)) return;
  const archived = String(formData.get("archived") ?? "") === "true";

  const { account } = await requireAccount("/aircraft");
  if (!account) return;

  const supabase = await createClient();
  const payload: AircraftUpdate = { archived_at: archived ? new Date().toISOString() : null };
  await logbookFrom(supabase, "aircraft")
    .update(payload)
    .eq("id", id)
    .eq("account_id", account.id);

  revalidatePath("/aircraft");
  revalidatePath("/logbook");
}

/**
 * Remove a registry row — only when nothing points at the tail.
 *
 * THE TWO COUNTS ARE THE WHOLE SAFETY ARGUMENT, and they are read from
 * views rather than computed here because the link they check is a
 * normalised-text join: 'N-123AB' in the logbook and 'N123AB' in the
 * registry are the same airframe, and no `ilike` this code could write
 * says so. pilot.aircraft_time_by_tail.entry_count answers the logbook;
 * pilot.aircraft_trip_usage.trip_count (20260820100000) answers trips.
 * Both are security_invoker, so they see only the caller's own rows.
 *
 * FAIL CLOSED ON AN UNREADABLE COUNT, which is the opposite of what
 * deleteClient does with its pre-check, and the difference is the point:
 * there, the count is a courtesy and the database's ON DELETE RESTRICT is
 * the real guard, so falling through costs nothing. Here there IS no
 * database guard — the view is the only thing that knows — so a count we
 * could not read is a reference we cannot rule out.
 *
 * Returned, not thrown, and not a redirect: this runs from a button inside
 * a useTransition, same as setAircraftArchived's neighbours elsewhere.
 */
export async function deleteAircraft(id: string): Promise<{ error: string | null }> {
  if (!UUID_RE.test(id)) return { error: "That aircraft no longer exists." };

  const { account } = await requireAccount("/aircraft");
  if (!account) return { error: "That aircraft no longer exists." };

  const supabase = await createClient();

  const [{ data: logbookUse, error: logbookError }, { data: tripUse, error: tripError }] =
    await Promise.all([
      logbookFrom(supabase, "aircraft_time_by_tail")
        .select("entry_count")
        .eq("aircraft_id", id)
        .eq("account_id", account.id)
        .maybeSingle(),
      logbookFrom(supabase, "aircraft_trip_usage")
        .select("trip_count")
        .eq("aircraft_id", id)
        .eq("account_id", account.id)
        .maybeSingle(),
    ]);

  if (logbookError || tripError) {
    return {
      error:
        "Couldn't check whether anything still uses this tail, so it wasn't deleted. Try again in a moment.",
    };
  }
  // Both views LEFT JOIN from pilot.aircraft, so a registered airframe
  // always has a row. No row means the id is not this account's — say the
  // same thing a zero-row delete would.
  if (!logbookUse || !tripUse) return { error: "That aircraft no longer exists." };

  const entries = Number((logbookUse as { entry_count: number | string }).entry_count ?? 0);
  const trips = Number((tripUse as { trip_count: number | string }).trip_count ?? 0);
  if (entries > 0 || trips > 0) {
    const parts: string[] = [];
    if (entries > 0) parts.push(`${entries} logbook ${entries === 1 ? "entry" : "entries"}`);
    if (trips > 0) parts.push(`${trips} ${trips === 1 ? "trip" : "trips"}`);
    return {
      error: `This tail is on ${parts.join(" and ")}, so it can't be deleted — deleting it would strip the type off those records. Retire it instead to take it out of your pickers.`,
    };
  }

  const { error, count } = await logbookFrom(supabase, "aircraft")
    .delete({ count: "exact" })
    .eq("id", id)
    .eq("account_id", account.id);

  if (error) return { error: friendlyDbError(error, "aircraft.delete") };
  if (count === 0) return { error: "That aircraft no longer exists." };

  revalidatePath("/aircraft");
  revalidatePath("/logbook");
  return { error: null };
}

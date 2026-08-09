"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireAccount } from "@/lib/supabase/account";
import { parseTenth } from "@/lib/format";
import { friendlyDbError } from "@/lib/db-errors";
import type { Database } from "@/lib/supabase/database.types";

type MileageInsert = Database["pilot"]["Tables"]["mileage_entries"]["Insert"];
type MileageUpdate = Database["pilot"]["Tables"]["mileage_entries"]["Update"];

export type MileageFormState = {
  error: string | null;
  values?: Record<string, string>;
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ENTRY_FIELDS = [
  "drove_on",
  "miles",
  "from_place",
  "to_place",
  "purpose",
  "trip_id",
  "client_id",
  "rate_cents_per_mile",
  "notes",
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

function optionalUuid(formData: FormData, key: string): string | null | undefined {
  const value = optional(formData, key);
  if (value === null) return null;
  return UUID_RE.test(value) ? value : undefined;
}

function isDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(value);
}

/**
 * The rate the pilot typed, parsed as cents-per-mile with up to three
 * fractional-cent digits — mirroring pilot.mileage_rates.rate_cents_per_mile
 * numeric(6,3). Not `parseDollarsToCents`: that returns whole cents for a
 * DOLLAR amount, and this field is entered in cents-per-mile, which is
 * a different unit entirely. Rejecting rather than rounding an
 * out-of-precision entry here matches the house rule that a silently-
 * rounding numeric column (parseTenth's own reason for existing) must be
 * guarded at the app layer, not left to Postgres to round quietly.
 */
function parseRate(raw: string): number | null | undefined {
  const value = raw.trim();
  if (value === "") return null;
  if (!/^\d{1,3}(\.\d{1,3})?$/.test(value)) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 999.999) return undefined;
  return parsed;
}

/**
 * Fields shared by create and update. rate_cents_per_mile is deliberately
 * NOT parsed here — see parseEntryForm (create-only) below. As of
 * 20260809050000, `authenticated` has no UPDATE grant on
 * mileage_entries.rate_cents_per_mile at all (the column is snapshotted at
 * capture and genuinely immutable), so an update payload must never
 * attempt to write it — including a value that happens to match what's
 * already stored, since the point is that this code path no longer
 * resolves or reasons about the rate at all.
 */
function parseCommonEntryFields(formData: FormData): {
  values: Omit<MileageInsert, "account_id" | "rate_cents_per_mile"> | null;
  error: string | null;
} {
  const droveOn = String(formData.get("drove_on") ?? "").trim();
  if (!droveOn) return { values: null, error: "When was this drive?" };
  if (!isDate(droveOn)) return { values: null, error: "That date isn't valid." };

  // numeric(7,1) — one decimal, same shape as trips.day_count and
  // trip_legs.block_hours. parseTenth is the shared guard against
  // numeric(p,s)'s silent rounding (lib/format.ts).
  const miles = parseTenth(String(formData.get("miles") ?? ""), { max: 99999 });
  // allowBlank is left at its default (false), so parseTenth never actually
  // returns null here — but its signature is shared with callers that do
  // pass allowBlank, so TypeScript still sees `number | null | undefined`.
  if (miles === undefined || miles === null || miles <= 0) {
    return { values: null, error: "How many miles did you drive? Enter a number like 42 or 42.3." };
  }

  const fromPlace = String(formData.get("from_place") ?? "").trim();
  if (!fromPlace) return { values: null, error: "Where did the drive start?" };
  if (fromPlace.length > 200) return { values: null, error: "Keep the starting place under 200 characters." };

  const toPlace = String(formData.get("to_place") ?? "").trim();
  if (!toPlace) return { values: null, error: "Where did the drive end?" };
  if (toPlace.length > 200) return { values: null, error: "Keep the destination under 200 characters." };

  const purpose = String(formData.get("purpose") ?? "").trim();
  if (!purpose) {
    return {
      values: null,
      error: "Say what the drive was for — this is what lets you (or your tax preparer) later tell business driving from commuting.",
    };
  }
  if (purpose.length > 500) return { values: null, error: "Keep the purpose under 500 characters." };

  const tripId = optionalUuid(formData, "trip_id");
  if (tripId === undefined) return { values: null, error: "That trip isn't valid." };
  const clientId = optionalUuid(formData, "client_id");
  if (clientId === undefined) return { values: null, error: "That client isn't valid." };

  return {
    error: null,
    values: {
      drove_on: droveOn,
      miles,
      from_place: fromPlace,
      to_place: toPlace,
      purpose,
      trip_id: tripId,
      client_id: clientId,
      notes: optional(formData, "notes"),
    },
  };
}

/** Create-only: also parses the rate, required for a brand-new entry. */
function parseEntryForm(formData: FormData): {
  values: Omit<MileageInsert, "account_id"> | null;
  error: string | null;
} {
  const common = parseCommonEntryFields(formData);
  if (common.error || !common.values) return { values: null, error: common.error };

  const rate = parseRate(String(formData.get("rate_cents_per_mile") ?? ""));
  if (rate === undefined) {
    return {
      values: null,
      // No example figure: a plausible number in an error string reads as
      // guidance, and the IRS rate changes annually. State the FORMAT.
      error:
        "Rate must be a number of cents per mile, with up to three decimal places.",
    };
  }
  if (rate === null) {
    return {
      values: null,
      error: "Enter the rate for this drive's tax year — set it once under Settings → Mileage rates and it'll be offered here.",
    };
  }

  return {
    error: null,
    values: { ...common.values, rate_cents_per_mile: rate },
  };
}

export async function createMileageEntry(
  _prev: MileageFormState,
  formData: FormData
): Promise<MileageFormState> {
  const { account } = await requireAccount("/expenses/mileage");
  const { values, error } = parseEntryForm(formData);
  if (error || !values) {
    return { error: error ?? "Couldn't read that form.", values: echo(formData) };
  }

  const supabase = await createClient();
  const payload: MileageInsert = { ...values, account_id: account.id };
  const { error: insertError } = await supabase.from("mileage_entries").insert(payload as never);

  if (insertError) {
    return { error: friendlyDbError(insertError, "mileage_entries.insert"), values: echo(formData) };
  }

  revalidatePath("/expenses/mileage");
  revalidatePath("/expenses");
  return { error: null };
}

export async function updateMileageEntry(
  _prev: MileageFormState,
  formData: FormData
): Promise<MileageFormState> {
  const id = String(formData.get("id") ?? "");
  if (!id || !UUID_RE.test(id)) return { error: "Missing mileage entry id." };

  const { account } = await requireAccount("/expenses/mileage");
  // rate_cents_per_mile is intentionally NOT parsed or written here — see
  // parseCommonEntryFields' comment. The database also refuses this
  // (authenticated has no UPDATE grant on that column as of
  // 20260809050000), but the app layer doesn't even attempt it: a wrong
  // rate is corrected by deleting the entry and logging it again, never by
  // editing the rate on an already-recorded drive.
  const { values, error } = parseCommonEntryFields(formData);
  if (error || !values) {
    return { error: error ?? "Couldn't read that form.", values: echo(formData) };
  }

  const supabase = await createClient();
  const payload: MileageUpdate = values;
  const { error: updateError, count } = await supabase
    .from("mileage_entries")
    .update(payload as never, { count: "exact" })
    .eq("id", id)
    .eq("account_id", account.id);

  if (updateError) {
    return { error: friendlyDbError(updateError, "mileage_entries.update"), values: echo(formData) };
  }
  if (count === 0) {
    return { error: "That mileage entry no longer exists.", values: echo(formData) };
  }

  revalidatePath("/expenses/mileage");
  revalidatePath("/expenses");
  return { error: null };
}

export async function deleteMileageEntry(id: string): Promise<{ error: string | null }> {
  const { account } = await requireAccount("/expenses/mileage");
  const supabase = await createClient();
  const { error, count } = await supabase
    .from("mileage_entries")
    .delete({ count: "exact" })
    .eq("id", id)
    .eq("account_id", account.id);

  if (error) return { error: friendlyDbError(error, "mileage_entries.delete") };
  if (count === 0) return { error: "That mileage entry no longer exists." };

  revalidatePath("/expenses/mileage");
  revalidatePath("/expenses");
  return { error: null };
}

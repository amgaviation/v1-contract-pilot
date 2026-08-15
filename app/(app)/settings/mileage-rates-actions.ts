"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireAccount } from "@/lib/supabase/account";
import { friendlyDbError } from "@/lib/db-errors";
import type { Database } from "@/lib/supabase/database.types";

type MileageRateInsert = Database["pilot"]["Tables"]["mileage_rates"]["Insert"];
type MileageRateUpdate = Database["pilot"]["Tables"]["mileage_rates"]["Update"];

export type MileageRateFormState = {
  error: string | null;
  values?: Record<string, string>;
  saved?: boolean;
};

/**
 * The rate the pilot typed, in cents-per-mile with up to three
 * fractional-cent digits — mirroring pilot.mileage_rates.rate_cents_per_mile
 * numeric(6,3). See that migration's header: the published standard mileage
 * rate carries a fractional cent, so this is not the same shape as
 * lib/format.ts's parseDollarsToCents (whole dollars → whole cents).
 * Duplicated here rather than imported from app/(app)/expenses/mileage/
 * actions.ts — this task's file list keeps the two screens' server actions
 * in separate files, and the parser is small enough that sharing it isn't
 * worth reaching outside the allowed set.
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
 * Add or update this account's mileage rate for a tax year. Deliberately
 * NOT `.upsert()` — the house CRITICAL on that idiom: it compiles to
 * `ON CONFLICT DO UPDATE SET <every payload column>`, checked statically
 * against the column-scoped grants, and 42501s under them. Instead: try an
 * update keyed on the (account_id, tax_year) unique constraint first; if
 * nothing matched, insert.
 *
 * NEVER supplies a default figure — a blank/invalid rate is rejected, not
 * coerced to some plausible-looking number. See the migration header
 * (20260809020000_mileage.sql) for why: the rate is volatile and must come
 * from the pilot, looked up at
 * https://www.irs.gov/tax-professionals/standard-mileage-rates (verified
 * reachable 2026-08-09) — never hardcoded in this codebase.
 */
export async function saveMileageRate(
  _prev: MileageRateFormState,
  formData: FormData
): Promise<MileageRateFormState> {
  const { account, role } = await requireAccount("/settings");
  if (role !== "owner") {
    return { error: "Only the account owner can set the mileage rate." };
  }

  const echoRate = () => ({
    tax_year: String(formData.get("tax_year") ?? ""),
    rate_cents_per_mile: String(formData.get("rate_cents_per_mile") ?? ""),
    notes: String(formData.get("notes") ?? ""),
  });

  const yearRaw = String(formData.get("tax_year") ?? "").trim();
  const taxYear = Number(yearRaw);
  if (!yearRaw || !Number.isInteger(taxYear) || taxYear < 2000 || taxYear > 2100) {
    return { error: "Enter a valid tax year, like 2026.", values: echoRate() };
  }

  const rate = parseRate(String(formData.get("rate_cents_per_mile") ?? ""));
  if (rate === undefined || rate === null) {
    return {
      error:
        "Enter the rate for that year in cents per mile. Look it up at the IRS standard mileage rates page rather than guessing.",
      values: echoRate(),
    };
  }

  const supabase = await createClient();
  const notes = String(formData.get("notes") ?? "").trim() || null;

  const updatePayload: MileageRateUpdate = { rate_cents_per_mile: rate, notes };
  const { count: updateCount, error: updateError } = await supabase
    .from("mileage_rates")
    .update(updatePayload as never, { count: "exact" })
    .eq("account_id", account.id)
    .eq("tax_year", taxYear);

  if (updateError) {
    return { error: friendlyDbError(updateError, "mileage_rates.update"), values: echoRate() };
  }

  if (!updateCount) {
    const insertPayload: MileageRateInsert = {
      account_id: account.id,
      tax_year: taxYear,
      rate_cents_per_mile: rate,
      notes,
    };
    const { error: insertError } = await supabase.from("mileage_rates").insert(insertPayload as never);
    if (insertError) {
      return { error: friendlyDbError(insertError, "mileage_rates.insert"), values: echoRate() };
    }
  }

  revalidatePath("/settings");
  revalidatePath("/expenses/mileage");
  return { error: null, saved: true };
}

/**
 * Removes a year's rate. Entries that already snapshotted it are
 * unaffected — pilot.mileage_entries.rate_cents_per_mile is a copy, not a
 * live reference, exactly per the migration's snapshot-at-capture rule.
 */
export async function deleteMileageRate(id: string): Promise<{ error: string | null }> {
  const { account, role } = await requireAccount("/settings");
  if (role !== "owner") {
    return { error: "Only the account owner can remove a mileage rate." };
  }

  const supabase = await createClient();
  const { error, count } = await supabase
    .from("mileage_rates")
    .delete({ count: "exact" })
    .eq("id", id)
    .eq("account_id", account.id);

  if (error) return { error: friendlyDbError(error, "mileage_rates.delete") };
  if (count === 0) return { error: "That rate no longer exists." };

  revalidatePath("/settings");
  revalidatePath("/expenses/mileage");
  return { error: null };
}

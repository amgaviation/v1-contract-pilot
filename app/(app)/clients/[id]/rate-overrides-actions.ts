"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireAccount } from "@/lib/supabase/account";
import { parseDollarsToCents } from "@/lib/format";
import { friendlyDbError } from "@/lib/db-errors";
import type { Database } from "@/lib/supabase/database.types";

type ClientRateInsert = Database["pilot"]["Tables"]["client_rates"]["Insert"];
type ClientRateUpdate = Database["pilot"]["Tables"]["client_rates"]["Update"];

export type RateOverrideFormState = {
  error: string | null;
  saved?: boolean;
  values?: Record<string, string>;
};

/** Matches the UUID_RE every other action in this phase validates ids
 * with (see invoices/actions.ts) — kept local rather than shared, the
 * same way that file keeps its own copy. */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Insert-or-update-or-delete for a single (client, day type) override.
 *
 * The migration's grant is deliberate about the shape of this: INSERT
 * carries the full row, but UPDATE is scoped to `rate_cents` alone —
 * (account_id, client_id, day_type_id) is what IDENTIFIES an override,
 * so re-pointing one is a delete-and-insert, never an update. That is
 * why this cannot be a single `.upsert()` call: PostgREST's upsert would
 * try to also set client_id/day_type_id in its DO UPDATE clause (even
 * when they aren't changing), and the column-scoped grant would refuse
 * that write outright. So: look the row up, then branch.
 */
export async function setClientRateOverride(
  _prev: RateOverrideFormState,
  formData: FormData
): Promise<RateOverrideFormState> {
  const clientId = String(formData.get("client_id") ?? "");
  const dayTypeId = String(formData.get("day_type_id") ?? "");
  // F9: every other id-keyed action in this phase (invoices/actions.ts)
  // shape-checks its ids before they reach PostgREST — an id that isn't a
  // well-formed uuid otherwise surfaces as a raw 22P02, which
  // friendlyDbError only scrubs to "That request wasn't valid," not to a
  // sentence naming what's actually wrong.
  if (!UUID_RE.test(clientId) || !UUID_RE.test(dayTypeId)) {
    return { error: "That client or day type isn't valid." };
  }

  const { account, role } = await requireAccount(`/clients/${clientId}`);
  // F6: day-types-actions.ts gates every write on `role !== "owner"`; this
  // action didn't, even though a rate card is at least as sensitive as a
  // day type's own settings. This check is for the MESSAGE, not the
  // boundary: `client_rates_insert`/`_update`/`_delete` are
  // `account_id in (select pilot.current_account_ids())` for ANY member —
  // membership-based, not owner-based — so a non-owner's write would
  // still succeed at the database no matter what this function does.
  // Returning a sentence beats a silent success a bookkeeper didn't
  // expect to be allowed.
  if (role !== "owner") {
    return { error: "Only the account owner can change rate overrides." };
  }

  const rateInput = String(formData.get("rate") ?? "");
  // Blank means "no override — use the day type's default". Do NOT
  // coerce it to zero; that would bill this client nothing for the day
  // type instead of falling back to the agreed default.
  const rateCents = parseDollarsToCents(rateInput);
  if (rateCents === undefined) {
    return {
      error: "Rate must be an amount like 1500 or 1500.00, or left blank to use the default.",
      values: { rate: rateInput },
    };
  }
  if (rateCents !== null && rateCents < 0) {
    return { error: "Rate can't be negative.", values: { rate: rateInput } };
  }

  const supabase = await createClient();

  // The unique (account_id, client_id, day_type_id) means this can only
  // ever resolve zero or one rows. The account_id filter here — as on
  // every id-keyed mutation in this app — is defence in depth; RLS's
  // USING clause is the actual boundary.
  const { data: existingData, error: selectError } = await supabase
    .from("client_rates")
    .select("id")
    .eq("account_id", account.id)
    .eq("client_id", clientId)
    .eq("day_type_id", dayTypeId)
    .maybeSingle();

  if (selectError) {
    return {
      error: friendlyDbError(selectError, "client_rates.select"),
      values: { rate: rateInput },
    };
  }
  const existing = existingData as { id: string } | null;

  if (rateCents === null) {
    // Clearing an override is a delete, not an update to null —
    // rate_cents is NOT NULL on this table; "no override" is expressed
    // by the row's absence.
    if (!existing) {
      return { error: null, saved: true };
    }
    const { error, count } = await supabase
      .from("client_rates")
      .delete({ count: "exact" })
      .eq("id", existing.id)
      .eq("account_id", account.id);
    if (error) return { error: friendlyDbError(error, "client_rates.delete") };
    if (count === 0) return { error: "Couldn't clear that override." };

    revalidatePath(`/clients/${clientId}`);
    // F2: a client-rate override feeds the trip day grid's rate
    // pre-fill (resolveRate in day-utils.ts) via /trips/[id], not just
    // this client page.
    revalidatePath("/trips/[id]", "page");
    return { error: null, saved: true };
  }

  if (existing) {
    const payload: ClientRateUpdate = { rate_cents: rateCents };
    const { error, count } = await supabase
      .from("client_rates")
      .update(payload as never, { count: "exact" })
      .eq("id", existing.id)
      .eq("account_id", account.id);
    if (error) {
      return { error: friendlyDbError(error, "client_rates.update"), values: { rate: rateInput } };
    }
    if (count === 0) {
      return { error: "Couldn't save that rate.", values: { rate: rateInput } };
    }
  } else {
    const payload: ClientRateInsert = {
      account_id: account.id,
      client_id: clientId,
      day_type_id: dayTypeId,
      rate_cents: rateCents,
    };
    // F9: `{ count: "exact" }`, checked — every other write in this phase
    // does this; this insert didn't. A write PostgREST accepts but that
    // matches nothing (e.g. an RLS policy silently narrowing it) returns
    // 200 with no error, and without the count check that read as saved.
    const { error: insertError, count: insertCount } = await supabase
      .from("client_rates")
      .insert(payload as never, { count: "exact" });
    if (insertError) {
      return {
        error: friendlyDbError(insertError, "client_rates.insert"),
        values: { rate: rateInput },
      };
    }
    if (insertCount === 0) {
      return { error: "Couldn't save that rate.", values: { rate: rateInput } };
    }
  }

  revalidatePath(`/clients/${clientId}`);
  revalidatePath("/trips/[id]", "page");
  return { error: null, saved: true };
}

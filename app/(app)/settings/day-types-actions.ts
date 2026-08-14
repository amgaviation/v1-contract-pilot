"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireAccount } from "@/lib/supabase/account";
import { parseDollarsToCents } from "@/lib/format";
import { friendlyDbError } from "@/lib/db-errors";
import type { Database } from "@/lib/supabase/database.types";

type DayTypeInsert = Database["pilot"]["Tables"]["day_types"]["Insert"];
type DayTypeUpdate = Database["pilot"]["Tables"]["day_types"]["Update"];

/**
 * `values` echoes what was submitted so a row's form can repopulate
 * itself. React 19 resets an uncontrolled form on EVERY action dispatch,
 * the error path included — without this, a typo in the rate field would
 * blank the label the pilot just renamed.
 */
export type DayTypeFormState = {
  error: string | null;
  saved?: boolean;
  values?: Record<string, string>;
  /**
   * F7: set when `billable` or `invoice_line_type` changed and at least
   * one trip that isn't yet on a live invoice has captured days of this
   * type. The save was NOT applied — the row re-submits with
   * `confirm_reprice=1` (see day-type-row.tsx) to go through.
   */
  requiresConfirm?: boolean;
  affectedTripCount?: number;
};

const LINE_TYPES = ["flight_day", "travel_day", "other"] as const;

/** Fields echoed back to a day-type row's form on a failed submit. */
const DAY_TYPE_FIELDS = [
  "label",
  "billable",
  "counts_for_per_diem",
  "default_rate",
  "default_units",
  "invoice_line_type",
  "sort_order",
] as const;

function echo(formData: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const field of DAY_TYPE_FIELDS) {
    if (field === "billable" || field === "counts_for_per_diem") {
      // Checkbox/switch semantics: an unchecked control is absent from
      // FormData entirely, so its echoed value must default to "off"
      // rather than "" reading as unset.
      out[field] = formData.get(field) === "on" ? "on" : "";
    } else {
      out[field] = String(formData.get(field) ?? "");
    }
  }
  return out;
}

type DayTypeFields = {
  label: string;
  billable: boolean;
  counts_for_per_diem: boolean;
  default_rate_cents: number | null;
  /** M3 fix: the default rate FRACTION (0 < x <= 1), e.g. 0.50 so a
   * travel day type can default to "half rate" the way the trips/day-
   * utils.ts/20260807070000 header's own motivating example describes,
   * without the pilot having to tick Half rate on every individual day. */
  default_units: number | null;
  invoice_line_type: (typeof LINE_TYPES)[number];
  sort_order: number;
};

type ParsedDayType = {
  values: DayTypeFields;
  error: string | null;
};

/**
 * Shared parse + validate for both the add form and a row's edit form.
 * The database enforces the real constraints (the label length check,
 * the invoice_line_type vocabulary, non-negative rates) — this exists so
 * a typo comes back as a sentence, not as the boundary itself. RLS plus
 * the column-scoped grants are the boundary.
 */
function parseDayTypeForm(formData: FormData): ParsedDayType {
  const empty = { values: {} as DayTypeFields, error: null as string | null };

  const label = String(formData.get("label") ?? "").trim();
  if (!label) return { ...empty, error: "Give the day type a name." };
  if (label.length > 60) {
    return { ...empty, error: "Keep the name under 60 characters." };
  }

  const billable = formData.get("billable") === "on";
  const countsForPerDiem = formData.get("counts_for_per_diem") === "on";

  // Blank is meaningful here: "no rate agreed yet". Do NOT coerce it to
  // zero — createInvoiceDraft skips an unpriced day rather than billing
  // it at nothing, and a stored 0 would look like an agreed free rate.
  const defaultRate = parseDollarsToCents(String(formData.get("default_rate") ?? ""));
  if (defaultRate === undefined) {
    return {
      ...empty,
      error: "Default rate must be an amount like 1500 or 1500.00, or left blank.",
    };
  }
  if (defaultRate !== null && defaultRate < 0) {
    return { ...empty, error: "Rate can't be negative." };
  }

  // M3: default_units is a rate FRACTION (0 < x <= 1), same numeric(3,2)
  // shape trip_days.units already uses — blank means "no default set",
  // resolveUnits (day-utils.ts) then falls back to 1.00 (full rate) at
  // capture, same as a blank default_rate means "no rate agreed".
  const rawUnits = String(formData.get("default_units") ?? "").trim();
  let defaultUnits: number | null = null;
  if (rawUnits !== "") {
    if (!/^\d{1,3}(\.\d{1,2})?$/.test(rawUnits)) {
      return {
        ...empty,
        error: "Default rate fraction must be a number like 0.5 or 1, or left blank.",
      };
    }
    defaultUnits = Number(rawUnits);
    if (!Number.isFinite(defaultUnits) || defaultUnits <= 0 || defaultUnits > 1) {
      return {
        ...empty,
        error: "Default rate fraction must be greater than 0 and at most 1 (e.g. 0.5 for half rate).",
      };
    }
  }

  const lineType = String(formData.get("invoice_line_type") ?? "");
  if (!(LINE_TYPES as readonly string[]).includes(lineType)) {
    return { ...empty, error: "Choose which invoice line this day type bills as." };
  }

  const sortRaw = String(formData.get("sort_order") ?? "").trim();
  const sortOrder = sortRaw === "" ? 0 : Number(sortRaw);
  if (!Number.isInteger(sortOrder) || sortOrder < -100000 || sortOrder > 100000) {
    return { ...empty, error: "Order must be a whole number." };
  }

  return {
    error: null,
    values: {
      label,
      billable,
      counts_for_per_diem: countsForPerDiem,
      default_rate_cents: defaultRate,
      default_units: defaultUnits,
      invoice_line_type: lineType as (typeof LINE_TYPES)[number],
      sort_order: sortOrder,
    },
  };
}

/**
 * Longest key the check constraint allows: `^[a-z][a-z0-9_]{0,30}$` is a
 * leading letter plus up to 30 more characters.
 */
const MAX_KEY_LEN = 31;

/**
 * Label -> a `key` slug matching the day_types check constraint. The
 * pilot never sees or types this — it is derived once, at creation, and
 * never changes (the migration withholds UPDATE on `key`).
 *
 *   1. lowercase
 *   2. any run of characters that isn't a-z0-9 becomes a single "_"
 *      (this is what "collapses repeats" — a run of spaces/punctuation
 *      collapses to one separator in the same replace)
 *   3. leading characters that still aren't a-z (digits, underscores
 *      left over from step 2) are trimmed, since the key must START
 *      with a letter
 *   4. a trailing separator left over from trimming is dropped
 *   5. truncated to the 31-character bound above
 *
 * A label that yields nothing usable (e.g. "123" or "!!!") falls back to
 * a fixed base rather than producing an empty, invalid key.
 */
function slugifyLabel(label: string): string {
  let slug = label.toLowerCase().replace(/[^a-z0-9]+/g, "_");
  slug = slug.replace(/^[^a-z]+/, "");
  slug = slug.replace(/_+$/, "");
  slug = slug.slice(0, MAX_KEY_LEN);
  return slug === "" ? "type" : slug;
}

/**
 * Resolves a collision by suffixing `_2`, `_3`, ... — trimming the base
 * as needed so the suffixed candidate still fits the 31-character bound.
 */
function uniqueDayTypeKey(label: string, existingKeys: readonly string[]): string {
  const base = slugifyLabel(label);
  const taken = new Set(existingKeys);
  if (!taken.has(base)) return base;

  for (let n = 2; ; n++) {
    const suffix = `_${n}`;
    const candidate = `${base.slice(0, MAX_KEY_LEN - suffix.length)}${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/**
 * F8: a hard cap, comfortably under any realistic PostgREST max-rows
 * configuration. `createDayType` below reads every existing row to derive
 * a unique key and the next sort order — without a cap, an account past
 * PostgREST's row limit gets a SILENTLY TRUNCATED read: `uniqueDayTypeKey`
 * can propose a key that is actually taken (surfacing as a raw 23505
 * instead of the sentence below), and `nextSortOrder` can regress instead
 * of advancing. Checking the count FIRST, before that select runs, and
 * keeping the cap well under the select's own `.limit()`, means the
 * select can never be looking at a truncated view of an account under the
 * cap.
 */
const MAX_DAY_TYPES_PER_ACCOUNT = 200;

export async function createDayType(
  _prev: DayTypeFormState,
  formData: FormData
): Promise<DayTypeFormState> {
  const { account, role } = await requireAccount("/settings");
  // This check is for the MESSAGE, not the boundary: day_types_insert is
  // `account_id in (select pilot.current_account_ids())` for ANY member,
  // not owner-only at the database — but business terms like these are
  // the same class of decision as the business-details panel, so the app
  // holds the same owner line here as settings/actions.ts does.
  if (role !== "owner") {
    return { error: "Only the account owner can add day types." };
  }

  const { values, error } = parseDayTypeForm(formData);
  if (error) return { error, values: echo(formData) };

  const supabase = await createClient();

  // F8: check the count BEFORE the key-listing select below, and reject
  // outright once at the cap — see MAX_DAY_TYPES_PER_ACCOUNT's comment for
  // why order matters here.
  const { count: existingCount, error: countError } = await supabase
    .from("day_types")
    .select("id", { count: "exact", head: true })
    .eq("account_id", account.id);

  if (countError) {
    return { error: friendlyDbError(countError, "day_types.count"), values: echo(formData) };
  }
  if ((existingCount ?? 0) >= MAX_DAY_TYPES_PER_ACCOUNT) {
    return {
      error: `You've reached the limit of ${MAX_DAY_TYPES_PER_ACCOUNT} day types. Archive one you no longer use before adding another.`,
      values: echo(formData),
    };
  }

  // Key uniqueness is per-account (`unique (account_id, key)`), so the
  // existing set must be scoped to this account, not just whatever RLS
  // happens to return for the caller. `.limit()` is set well above the
  // cap just checked, rather than left unbounded, so this can never be a
  // silently truncated read either (F8).
  const { data: existing, error: listError } = await supabase
    .from("day_types")
    .select("key, sort_order")
    .eq("account_id", account.id)
    .limit(MAX_DAY_TYPES_PER_ACCOUNT * 2);

  if (listError) {
    return { error: friendlyDbError(listError, "day_types.list"), values: echo(formData) };
  }

  const rows = (existing ?? []) as { key: string; sort_order: number }[];
  const key = uniqueDayTypeKey(values.label, rows.map((r) => r.key));
  // New types land after everything else in the picker order.
  const nextSortOrder = rows.length
    ? Math.max(...rows.map((r) => r.sort_order)) + 10
    : 10;

  // `is_builtin` is never sent: it is absent from the Insert type because
  // the migration withholds it from the grant entirely — a tenant may
  // neither claim nor disclaim seeded provenance.
  const payload: DayTypeInsert = {
    account_id: account.id,
    key,
    label: values.label,
    billable: values.billable,
    counts_for_per_diem: values.counts_for_per_diem,
    default_rate_cents: values.default_rate_cents,
    default_units: values.default_units,
    invoice_line_type: values.invoice_line_type,
    sort_order: nextSortOrder,
  };

  const { error: insertError } = await supabase.from("day_types").insert(payload as never);
  if (insertError) {
    return { error: friendlyDbError(insertError, "day_types.insert"), values: echo(formData) };
  }

  revalidatePath("/settings");
  // F2: the trip day grid lives on /trips/[id], not /trips — the list
  // route revalidating alone left a newly-added day type invisible in the
  // picker on an already-rendered trip page until a hard reload.
  // revalidatePath("/trips") is still needed too: the trips LIST reads
  // billing_state/day counts that don't change here, but keeping both
  // calls matches every other write in this file and costs nothing.
  revalidatePath("/trips");
  revalidatePath("/trips/[id]", "page");
  return { error: null, saved: true };
}

/**
 * F7: `trip_days.rate_cents` is snapshotted at capture, but `billable` and
 * `invoice_line_type` are NOT — they are re-resolved from `day_types` at
 * DRAFT TIME (see invoices/actions.ts's createInvoiceDraft, day-row path).
 * So toggling either on a day type changes how days that were already
 * captured — but not yet drafted onto any invoice — will bill, even
 * though the pilot never touched that trip. Not the same class of bug as
 * a missing snapshot column (we are NOT adding one this pass); this is
 * about making the consequence visible before it happens, not preventing
 * it.
 *
 * Counts distinct trips that (a) have at least one trip_days row of this
 * type, and (b) are not already committed to a live (non-void) invoice —
 * a trip already on an invoice had its lines resolved and persisted in
 * the past, so nothing about it changes here; only a trip whose day rows
 * are still waiting to be drafted is at risk.
 *
 * Approximation, and documented as one: "committed" is read here as
 * "already has a live invoice_lines row with this trip_id", which is
 * exactly the path a day-row-derived line takes. It does not additionally
 * follow a rebilled expense's own trip_id the way
 * pilot.trip_committed_invoice does — that function exists to gate
 * whether trip_days may be EDITED at all, a stricter question than this
 * one, which is only ever used to size a confirmation message, never to
 * block anything.
 */
async function countAtRiskTrips(
  supabase: Awaited<ReturnType<typeof createClient>>,
  accountId: string,
  dayTypeId: string
): Promise<number> {
  const { data: dayRows } = await supabase
    .from("trip_days")
    .select("trip_id")
    .eq("account_id", accountId)
    .eq("day_type_id", dayTypeId)
    .limit(5000);

  const tripIds = Array.from(
    new Set(((dayRows ?? []) as { trip_id: string }[]).map((r) => r.trip_id))
  );
  if (tripIds.length === 0) return 0;

  // Two flat selects joined in JS, rather than an embedded
  // `invoice_lines.select("trip_id, invoices(status)")` — matches this
  // app's existing style for cross-table reads (see createInvoiceDraft's
  // Promise.all) and sidesteps relying on the hand-authored types file to
  // model an embedded resource correctly.
  const { data: lineRows } = await supabase
    .from("invoice_lines")
    .select("trip_id, invoice_id")
    .eq("account_id", accountId)
    .in("trip_id", tripIds)
    .limit(5000);

  const lines = (lineRows ?? []) as { trip_id: string | null; invoice_id: string }[];
  const invoiceIds = Array.from(new Set(lines.map((l) => l.invoice_id)));
  if (invoiceIds.length === 0) return tripIds.length;

  const { data: invoiceRows } = await supabase
    .from("invoices")
    .select("id, status")
    .eq("account_id", accountId)
    .in("id", invoiceIds)
    .limit(5000);

  const liveInvoiceIds = new Set(
    ((invoiceRows ?? []) as { id: string; status: string }[])
      .filter((r) => r.status !== "void")
      .map((r) => r.id)
  );

  const committed = new Set(
    lines
      .filter((l) => l.trip_id && liveInvoiceIds.has(l.invoice_id))
      .map((l) => l.trip_id as string)
  );

  return tripIds.filter((id) => !committed.has(id)).length;
}

export async function updateDayType(
  _prev: DayTypeFormState,
  formData: FormData
): Promise<DayTypeFormState> {
  const id = String(formData.get("id") ?? "");
  if (!id) return { error: "Missing day type id." };

  const { account, role } = await requireAccount("/settings");
  if (role !== "owner") {
    return { error: "Only the account owner can change day types." };
  }

  const { values, error } = parseDayTypeForm(formData);
  if (error) return { error, values: echo(formData) };

  const supabase = await createClient();

  // F7: compare against what's actually stored, not what the form
  // started from, so a stale echo can't skip the check. Read here rather
  // than trusted from a hidden field — the pilot's browser is not the
  // source of truth for what changed.
  const { data: currentData } = await supabase
    .from("day_types")
    .select("billable, invoice_line_type")
    .eq("id", id)
    .eq("account_id", account.id)
    .maybeSingle();
  const current = currentData as
    | { billable: boolean; invoice_line_type: string }
    | null;

  const pricingChanged =
    current !== null &&
    (current.billable !== values.billable ||
      current.invoice_line_type !== values.invoice_line_type);
  const confirmed = formData.get("confirm_reprice") === "1";

  if (pricingChanged && !confirmed) {
    const affected = await countAtRiskTrips(supabase, account.id, id);
    if (affected > 0) {
      return {
        error: null,
        values: echo(formData),
        requiresConfirm: true,
        affectedTripCount: affected,
      };
    }
  }

  // `key` and `is_builtin` are absent from this payload's type entirely
  // — the migration withholds UPDATE on both, so there is no input to
  // get wrong. The account_id filter is defence in depth; RLS's USING
  // clause is the boundary.
  const payload: DayTypeUpdate = values;
  const { error: updateError, count } = await supabase
    .from("day_types")
    .update(payload as never, { count: "exact" })
    .eq("id", id)
    .eq("account_id", account.id);

  if (updateError) {
    return { error: friendlyDbError(updateError, "day_types.update"), values: echo(formData) };
  }
  // PostgREST returns 200 with no error for a write that matched nothing.
  if (count === 0) {
    return { error: "Couldn't save that day type.", values: echo(formData) };
  }

  revalidatePath("/settings");
  revalidatePath("/trips");
  revalidatePath("/trips/[id]", "page");
  return { error: null, saved: true };
}

/**
 * Archive / restore — the primary way to retire a day type. Never a
 * delete: a day type attached to years of trips must keep rendering.
 * Archived types disappear from pickers but still resolve on old trips.
 */
export async function setDayTypeArchived(
  id: string,
  archived: boolean
): Promise<{ error: string | null }> {
  const { account, role } = await requireAccount("/settings");
  if (role !== "owner") {
    return { error: "Only the account owner can change day types." };
  }

  const supabase = await createClient();
  const payload: DayTypeUpdate = {
    archived_at: archived ? new Date().toISOString() : null,
  };
  const { error, count } = await supabase
    .from("day_types")
    .update(payload as never, { count: "exact" })
    .eq("id", id)
    .eq("account_id", account.id);

  // Returned rather than thrown: this runs inside a useTransition on the
  // client, where a throw is swallowed and the button just appears to do
  // nothing.
  if (error) return { error: friendlyDbError(error, "day_types.archive") };
  if (count === 0) return { error: "Couldn't update that day type." };

  revalidatePath("/settings");
  revalidatePath("/trips");
  revalidatePath("/trips/[id]", "page");
  return { error: null };
}

/**
 * A real DELETE, offered only where it is safe — and, since
 * 20260807020000, never on a built-in row at all: the day-type row's UI
 * doesn't render a Delete button for one (day-type-row.tsx), and even if
 * it did, `pilot.day_types_protect_builtin_delete` rejects it with 23514
 * before the RESTRICT below is ever reached. Caught here rather than left
 * to `friendlyDbError`, which would genericise it to "Some of those
 * values aren't valid together" — the trigger's own sentence already
 * names the fix.
 *
 * `trip_days.day_type_id` references this table ON DELETE RESTRICT, so a
 * (non-built-in) type that has ever priced a captured day raises 23503
 * here — caught and reworded, rather than surfaced as a generic "linked
 * to something else" sentence, since the fix (archive it) is specific and
 * worth saying.
 */
export async function deleteDayType(id: string): Promise<{ error: string | null }> {
  const { account, role } = await requireAccount("/settings");
  if (role !== "owner") {
    return { error: "Only the account owner can delete day types." };
  }

  const supabase = await createClient();
  const { error, count } = await supabase
    .from("day_types")
    .delete({ count: "exact" })
    .eq("id", id)
    .eq("account_id", account.id);

  if (error) {
    if (error.code === "23503") {
      return {
        error: "This day type is used by trips already recorded. Archive it instead.",
      };
    }
    // F1: pilot.day_types_protect_builtin_delete raises 23514 for a
    // built-in row. friendlyDbError's generic 23514 sentence ("Some of
    // those values aren't valid together") would be actively confusing
    // here — this isn't a validation problem, it's that the row can't be
    // deleted at all. Match the trigger's own wording so the two agree.
    if (error.code === "23514") {
      return {
        error:
          "This is one of the starting day types and cannot be deleted. Archive it instead; archived types stay on the trips that already use them.",
      };
    }
    return { error: friendlyDbError(error, "day_types.delete") };
  }
  if (count === 0) return { error: "Couldn't delete that day type." };

  revalidatePath("/settings");
  revalidatePath("/trips");
  revalidatePath("/trips/[id]", "page");
  return { error: null };
}

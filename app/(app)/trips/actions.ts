"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireAccount } from "@/lib/supabase/account";
import { DASHBOARD_PATH } from "@/lib/nav";
import { formatDateRange, parseDollarsToCents, parseTenth } from "@/lib/format";
import { friendlyDbError } from "@/lib/db-errors";
import type { Database } from "@/lib/supabase/database.types";
import {
  enumerateDates,
  dayTypeFieldName,
  rateFieldName,
  quantityFieldName,
  unitsFieldName,
  awayFieldName,
  notesFieldName,
  parseQuantity,
  parseUnits,
} from "./day-utils";

type TripInsert = Database["pilot"]["Tables"]["trips"]["Insert"];
type TripUpdate = Database["pilot"]["Tables"]["trips"]["Update"];
type TripDayInsert = Database["pilot"]["Tables"]["trip_days"]["Insert"];
type TripDayUpdate = Database["pilot"]["Tables"]["trip_days"]["Update"];
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
  /**
   * How many trip_days rows were removed because updateTrip narrowed
   * starts_on/ends_on out from under them. See the pruning step below —
   * removing billable days silently is not acceptable, so this rides
   * along on the same success state trip-form.tsx already renders.
   */
  daysRemoved?: number;
  /**
   * gap S: a non-blocking heads-up that this trip's dates intersect
   * another live trip on the same calendar — never withholds the save.
   * Set by findOverlappingTrip below; rendered by trip-form.tsx alongside
   * the "saved" confirmation, never in place of it.
   */
  overlapWarning?: string | null;
};
/**
 * `values` echoes the submitted leg fields on a validation failure — same
 * reason as TripFormState above: React 19 resets an uncontrolled form on
 * every action dispatch, including the rejected one, so without this a
 * single bad field (say, a non-numeric block time) would wipe every other
 * field the pilot had already typed for this leg.
 */
export type LegFormState = { error: string | null; values?: Record<string, string> };
/**
 * `fieldErrors` is keyed by date ("2026-03-04") and holds every row's
 * validation problem at once — F2's fix for a 12-row grid that used to be
 * 12 round trips, one rejected row at a time. `error` stays for problems
 * that aren't about any one row (a missing trip id, a frozen trip).
 */
export type TripDaysFormState = {
  error: string | null;
  saved?: boolean;
  fieldErrors?: Record<string, string>;
};

const TRIP_KINDS = [
  "owner_trip",
  "ferry",
  "maintenance_flight",
  "repositioning",
  "contract_pilot",
  "delivery_flight",
  "other",
] as const;

// 20260814094000: 'hold' is a tentative, unconfirmed block on the
// calendar — see that migration's header for why every revenue-facing
// consumer of status already treats it as inert without needing changes.
const TRIP_STATUSES = ["scheduled", "in_progress", "completed", "canceled", "hold"] as const;

// 20260807130000. Always exactly one part for a trip — see
// lib/operating-rule.ts's TripOperatingRule. 'part_91' is the fallback,
// matching the column's own DEFAULT.
const TRIP_OPERATING_RULES = ["part_91", "part_135"] as const;

// 20260807070000_trip_day_units_away_cancel.sql. Freely pilot-editable —
// see that migration's comment on cancellation_notice_from for why this is
// NOT canceled_at (which is trigger-owned and never appears in a form).
const CANCELLATION_NOTICE_FROM = [
  "client",
  "pilot",
  "weather",
  "maintenance",
  "other",
] as const;

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
  "cancellation_notice_from",
  "notes",
  "operating_rule",
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

/**
 * friendlyDbError scrubs every 23514 down to "Some of those values aren't
 * valid together" — right for most check violations, but the two freeze
 * guards' own messages (pilot.trip_days_protect_billed and
 * pilot.trips_protect_billed_facts, both in
 * 20260807020000_phase9_review_fixes.sql) ARE the sentence a pilot needs
 * to read, and the task is explicit that they must reach them unedited.
 *
 * F8: those triggers were rewritten to key on whether a live invoice line
 * references the trip rather than on the cached billing_state column, and
 * their wording changed with it — both now read "This trip is billed on
 * %. Remove it from that invoice before changing its ...". Matching on
 * "invoiced" stopped matching; "billed on" is what both new messages
 * share. Used for every trip_days write AND the trips-table update in
 * updateTrip below, since trips_protect_billed_facts fires on that
 * statement — every other 23514 on this file still gets the generic,
 * scrubbed message.
 */
function billedTripDbError(
  error: { code?: string | null; message?: string | null } | null | undefined,
  context: string
): string {
  if (error?.code === "23514" && error.message?.toLowerCase().includes("billed on")) {
    return error.message;
  }
  return friendlyDbError(error, context);
}

/**
 * The app-side precheck's own wording for "this trip is committed to a
 * live invoice" — phrased to match the two trigger messages above
 * (`pilot.trip_committed_invoice`'s label substituted in the same spot)
 * so a pilot sees the same sentence whether the block happens here or at
 * the database.
 */
function billedTripMessage(committedOn: string, scope: "days" | "facts"): string {
  return scope === "days"
    ? `This trip is billed on ${committedOn}. Remove it from that invoice before changing its days.`
    : `This trip is billed on ${committedOn}. Remove it from that invoice before changing its dates, rates or status.`;
}

/**
 * gap S: overlapping-trip warning (double-booking / double-entry guard).
 * Nothing anywhere previously detected that a new or edited trip's date
 * range intersects an existing one. Two real failure modes this catches:
 * an accidental duplicate entry of the same job — which can then be
 * double-invoiced from two "different" trips — and a genuine double-
 * booking a solo pilot wants to see before accepting more work.
 *
 * NEVER A HARD BLOCK. Split-duty, same-day positioning legs and
 * simultaneous ferry/owner work are real; a database-enforced exclusion
 * constraint (or a rejected save here) would refuse a pilot's own honest
 * calendar. This only ever informs — see TripFormState.overlapWarning and
 * the redirect query param createTrip uses for its own success path.
 *
 * Canceled trips are excluded — a canceled trip no longer holds the date,
 * the same reasoning clients/[id]/page.tsx's unbilled-trips filter now
 * applies. Best-effort: a failed lookup here degrades to "no warning"
 * rather than failing the trip save the warning rides along on — this is
 * advisory, not the write that matters.
 */
async function findOverlappingTrip(
  supabase: Awaited<ReturnType<typeof createClient>>,
  accountId: string,
  startsOn: string,
  endsOn: string,
  excludeId: string | null
): Promise<{ starts_on: string; ends_on: string } | null> {
  let query = supabase
    .from("trips")
    .select("starts_on, ends_on")
    .eq("account_id", accountId)
    .neq("status", "canceled")
    .lte("starts_on", endsOn)
    .gte("ends_on", startsOn)
    .limit(1);
  if (excludeId) query = query.neq("id", excludeId);
  const { data, error } = await query.maybeSingle();
  if (error || !data) return null;
  return data as { starts_on: string; ends_on: string };
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

  // A typo'd end-date YEAR (2026 -> 2062) still passes the check above and
  // then renders a several-thousand-row day grid (enumerateDates has no
  // cap of its own, and saveTripDays re-enumerates and diffs that same
  // list on every save). Contract trips run days to weeks; nothing
  // legitimate needs a range over a year. Catching the typo here, where it
  // was made, matches this file's parseTenth-style philosophy elsewhere
  // rather than letting it surface downstream as a frozen page.
  const tripSpanDays =
    Math.round(
      (new Date(`${endsOn}T00:00:00Z`).getTime() -
        new Date(`${startsOn}T00:00:00Z`).getTime()) /
        86_400_000
    ) + 1;
  if (tripSpanDays > 370) {
    return {
      values: null,
      error: `That's a ${tripSpanDays}-day trip. Check the end date's year.`,
    };
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

  // 20260807070000: nullable, unlike status/trip_kind — "no notice source
  // recorded" is a real, common state (most trips are never cancelled),
  // not a fallback value to coerce a blank submission into.
  const cancellationNoticeFrom = optional(formData, "cancellation_notice_from");
  if (
    cancellationNoticeFrom !== null &&
    !(CANCELLATION_NOTICE_FROM as readonly string[]).includes(cancellationNoticeFrom)
  ) {
    return { values: null, error: "That cancellation notice source isn't valid." };
  }

  return {
    error: null,
    values: {
      client_id: clientId,
      trip_kind: oneOf(formData, "trip_kind", TRIP_KINDS, "contract_pilot"),
      // `as TripFields["status"]`: same hand-authored-types-file cast as
      // cancellation_notice_from below. lib/supabase/database.types.ts's
      // status literal union predates 'hold' (20260814094000) and sits
      // outside this fix's file allowlist — TRIP_STATUSES (validated just
      // above, oneOf() only ever returns one of its own members) is the
      // real, single-sourced vocabulary; this cast just gets a value TS
      // hasn't been told about yet past a stale local type.
      status: oneOf(formData, "status", TRIP_STATUSES, "scheduled") as TripFields["status"],
      starts_on: startsOn,
      ends_on: endsOn,
      aircraft_ident: optional(formData, "aircraft_ident"),
      aircraft_type: optional(formData, "aircraft_type"),
      day_rate_cents: dayRate ?? 0,
      day_count: dayCount,
      travel_day_count: travelCount,
      travel_day_rate_cents: travelRate,
      cancellation_notice_from:
        cancellationNoticeFrom as TripFields["cancellation_notice_from"],
      notes: optional(formData, "notes"),
      operating_rule: oneOf(formData, "operating_rule", TRIP_OPERATING_RULES, "part_91"),
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

  const createdId = (data as { id: string }).id;
  // gap S: advisory only — see findOverlappingTrip. A redirect carries no
  // return value, so the warning rides along as a query param the trip
  // page reads and renders as its own non-blocking callout.
  const overlap = await findOverlappingTrip(
    supabase,
    account.id,
    values.starts_on,
    values.ends_on,
    null
  );

  revalidatePath("/trips");
  // Straight into the trip, because the next thing a pilot does is add
  // legs — a trip with no legs derives no logbook entry and no route.
  redirect(`/trips/${createdId}${overlap ? "?overlap=1" : ""}`);
}

/**
 * True for exactly the 23514 pilot.trips_protect_day_range raises when
 * narrowing starts_on/ends_on would strand a trip_days row outside the
 * new range ("Changing these dates would leave % day row(s) outside the
 * trip. Remove those days first.") — distinguished from
 * pilot.trip_days_validate_within_trip's per-row message ("Day % is
 * outside the trip dates (% to %)") by the word "row(s)", which only the
 * trips-table guard's wording contains.
 */
function isStrandedDayRowsError(
  error: { code?: string | null; message?: string | null } | null | undefined
): boolean {
  return (
    error?.code === "23514" &&
    !!error.message?.toLowerCase().includes("day row(s) outside the trip")
  );
}

export async function updateTrip(
  _prev: TripFormState,
  formData: FormData
): Promise<TripFormState> {
  const id = String(formData.get("id") ?? "");
  if (!id) return { error: "Missing trip id." };

  const { account } = await requireAccount(`/trips/${id}`);

  const supabase = await createClient();

  // The billed-trip lock is checked BEFORE the form is parsed. The page
  // disables the frozen fields, and a disabled input submits no value at
  // all — parsing first would reject a locked trip with "a trip needs a
  // start and end date", which is both wrong and baffling.
  //
  // The lock is enforced HERE, not only by the disabled controls on the
  // page. Phase 5's triggers guard the trip's client_id once it has been
  // billed but leave the amounts writable, so without this a tenant
  // could rewrite day_rate_cents or day_count on a trip that has already
  // gone out on an invoice and leave the two records disagreeing about
  // what was flown.
  //
  // F8: this used to read trips.billing_state, which the sync trigger
  // only updates on an invoice STATUS change — so a trip sitting on a
  // still-DRAFT invoice read 'unbilled' and stayed fully editable right
  // through the window a pilot is most likely to be fixing it in. What
  // actually has to gate this is whether a live invoice line references
  // the trip, which is exactly what pilot.trip_committed_invoice answers
  // — the same definition trips_protect_billed_facts now enforces at the
  // database, so this precheck and that trigger can't drift apart.
  const [{ data: current, error: readError }, { data: committedOn, error: committedError }] =
    await Promise.all([
      supabase.from("trips").select("id").eq("id", id).eq("account_id", account.id).maybeSingle(),
      // `as never`: supabase-js's .rpc() resolves its args parameter to
      // `undefined` against this hand-authored types file for any
      // function that takes arguments — the same quirk the codebase's
      // `.insert()`/`.update()` call sites work around the same way (see
      // createTrip's comment above). The Args shape is still compile-time
      // checked via the Database["pilot"]["Functions"] entry the cast
      // target itself is defined against.
      supabase.rpc("trip_committed_invoice", {
        p_account_id: account.id,
        p_trip_id: id,
      } as never),
    ]);

  if (readError) {
    return { error: friendlyDbError(readError, "trips.select") };
  }
  if (!current) return { error: "That trip no longer exists." };
  if (committedError) {
    return { error: friendlyDbError(committedError, "trip_committed_invoice") };
  }
  if (committedOn) {
    return { error: billedTripMessage(committedOn, "facts") };
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
  const attemptUpdate = () =>
    supabase
      .from("trips")
      .update(payload as never)
      .eq("id", id)
      .eq("account_id", account.id);

  // F4: the old order pruned any trip_days rows outside the new date
  // range BEFORE attempting this update, unconditionally whenever the
  // dates changed — so a typo'd end date deleted billable rows, and if
  // the update failed afterwards for an unrelated reason, they were gone
  // for nothing. Reordered: attempt the update FIRST. Most date edits
  // never strand anything and this succeeds immediately with nothing
  // pruned. It fails only via pilot.trips_protect_day_range's specific
  // "day row(s) outside the trip" 23514 when the new range really would
  // strand rows — and ONLY THEN do we prune (never silently: the removed
  // count rides back on the success state) and retry once. Any other
  // failure — including a race where the trip got billed since the check
  // above — reaches the pilot with nothing deleted.
  let daysRemoved = 0;
  let { error: updateError } = await attemptUpdate();

  if (updateError && isStrandedDayRowsError(updateError)) {
    const { error: pruneError, count: prunedCount } = await supabase
      .from("trip_days")
      .delete({ count: "exact" })
      .eq("account_id", account.id)
      .eq("trip_id", id)
      .or(`day_on.lt.${values.starts_on},day_on.gt.${values.ends_on}`);

    if (pruneError) {
      return {
        error: billedTripDbError(pruneError, "trip_days.prune"),
        values: echo(formData, TRIP_FIELDS),
      };
    }
    daysRemoved = prunedCount ?? 0;

    ({ error: updateError } = await attemptUpdate());
  }

  if (updateError) {
    return {
      error: billedTripDbError(updateError, "trips.update"),
      values: echo(formData, TRIP_FIELDS),
    };
  }

  // gap S: advisory only — see findOverlappingTrip.
  const overlap = await findOverlappingTrip(
    supabase,
    account.id,
    values.starts_on,
    values.ends_on,
    id
  );

  revalidatePath("/trips");
  revalidatePath(`/trips/${id}`);
  // No redirect — the pilot stays on the trip to keep working on its
  // legs — so `saved` is what tells them anything happened at all.
  return {
    error: null,
    saved: true,
    daysRemoved,
    overlapWarning: overlap
      ? `This trip's dates overlap another trip on your calendar (${formatDateRange(
          overlap.starts_on,
          overlap.ends_on
        )}) — check you haven't double-booked or double-entered it.`
      : null,
  };
}

/**
 * Mark a trip flown.
 *
 * ***************************************************************************
 * WHY THIS EXISTS, AND WHY IT IS THE MOST IMPORTANT BUTTON IN THE PRODUCT
 * ***************************************************************************
 * A trip is created as 'scheduled'. Everything downstream — the invoice
 * picker, the logbook drafts queue, Overview's "flown but not yet
 * invoiced" — filters on status = 'completed', and until now NOTHING in
 * the product ever advanced it. There is no trigger and no date rule; a
 * review checked.
 *
 * So a pilot could fly ten trips, open the app to bill them, and be told
 * by three separate screens that they had nothing: "0 trips flown and
 * logged but not yet invoiced", "No completed, unbilled trips for this
 * client yet", "Nothing waiting — every completed trip's legs are already
 * in your logbook." All three false, none of them naming the cause, and
 * the only cure a Status dropdown buried in the middle of a long edit
 * form. That single field gated 100% of this product's value.
 *
 * The state stays the pilot's to set — a trip is not complete because a
 * date passed, and auto-advancing would be the silent write this codebase
 * refuses everywhere else. What changes is that asking for it is now one
 * tap from the list and from the trip, and the screens that used to lie
 * now say what is actually true.
 */
export async function markTripCompleted(
  id: string
): Promise<{ error: string | null }> {
  const { account } = await requireAccount("/trips");
  if (!UUID_RE.test(id)) return { error: "That trip couldn't be found." };

  const supabase = await createClient();
  // { count: "exact" }: PostgREST answers 200 for a write that matched no
  // rows, and "we marked it flown" when nothing moved is the failure this
  // whole action exists to end, not to reproduce.
  const { error, count } = await supabase
    .from("trips")
    .update({ status: "completed" } as never, { count: "exact" })
    .eq("id", id)
    .eq("account_id", account.id)
    // Only from a state that can still advance. A canceled trip is not
    // flown, and a completed one is already there — narrowing here rather
    // than reading first keeps it a single statement, so two taps on a
    // slow connection cannot race.
    .in("status", ["scheduled", "in_progress"]);

  if (error) return { error: billedTripDbError(error, "trips.update") };
  if (!count) {
    return {
      error:
        "That trip couldn't be marked flown. It may already be completed, or canceled.",
    };
  }

  revalidatePath("/trips");
  revalidatePath(`/trips/${id}`);
  revalidatePath("/invoices/new");
  revalidatePath("/logbook/drafts");
  // The dashboard, whose "Unbilled work" figure, "Ready to invoice" panel and
  // "N trips still marked Scheduled" subtitle all move on this write. This
  // said "/" until the landing page took that path, at which point the one
  // line whose entire job was "refresh Overview" was refreshing a marketing
  // page instead — and unlike the six redirects in the same class, no
  // bounce covered for it.
  //
  // Honest about the size of it: nothing was visibly stale, because Overview
  // reads cookies (requireAccount) and so is dynamically rendered with no
  // route cache to purge, and any revalidatePath inside a server action drops
  // the client router cache regardless of which path it names. This was a
  // DEAD REFERENCE, not a live staleness bug. It becomes a live one the day
  // anyone adds `export const revalidate` or PPR to Overview, which is
  // precisely the kind of delayed fuse a stale route string leaves behind.
  revalidatePath(DASHBOARD_PATH);
  return { error: null };
}

export async function deleteTrip(id: string): Promise<{ error: string | null }> {
  const { account } = await requireAccount("/trips");
  // Every sibling write in this file (markTripCompleted, addLeg, updateLeg,
  // deleteLeg, saveTripDays) shape-checks its id before it ever reaches
  // PostgREST; this one didn't, so a malformed id surfaced as a raw,
  // scrubbed 22P02 instead of the same sentence every other bad id gets.
  if (!UUID_RE.test(id)) return { error: "That trip couldn't be found." };

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

/** Fields whose submitted text is echoed back on a failed leg submit. */
const LEG_FIELDS = [
  "leg_date",
  "from_icao",
  "to_icao",
  "block_hours",
  "night_hours",
  "instrument_hours",
  "instrument_actual_hours",
  "instrument_simulated_hours",
  "cross_country_hours",
  "day_takeoffs",
  "day_landings",
  "day_landings_full_stop",
  "night_takeoffs",
  "night_landings_full_stop",
  "night_landings_touch_go",
  "approaches",
  "holds",
] as const;

function echoLeg(formData: FormData): Record<string, string> {
  return echo(formData, LEG_FIELDS);
}

type ParsedLeg = { values: Omit<LegInsert, "account_id" | "trip_id"> | null; error: string | null };

/**
 * Shared by addLeg and updateLeg so the two can never validate a leg
 * differently — the currency-relevant counts (night takeoffs, full-stop
 * vs touch-and-go night landings, approaches, holds) this file's header
 * calls out are the same facts whether they're being typed for the first
 * time or corrected.
 */
function parseLegForm(
  formData: FormData,
  tripDates: { starts_on: string; ends_on: string }
): ParsedLeg {
  const legDate = String(formData.get("leg_date") ?? "").trim();
  if (!legDate) return { values: null, error: "Give the leg a date." };
  if (!isDate(legDate)) return { values: null, error: "That leg date isn't valid." };

  // trip_days got a dedicated trigger (trip_days_validate_within_trip) for
  // exactly this reason — a fat-fingered date (wrong year via the date
  // input is the common way) bills or logs a day that was never part of
  // the job. Legs had no equivalent check anywhere: a mis-dated leg
  // silently produces a wrong-dated logbook draft, sorts into the wrong
  // place in the leg list, and can drop out of a date-bounded query (the
  // CPA travel log) that trusts leg_date to fall inside the trip. Blocking
  // here is defensible the same way the day grid's trigger is — a trip's
  // own dates should already cover any positioning legs.
  if (legDate < tripDates.starts_on || legDate > tripDates.ends_on) {
    return {
      values: null,
      error: `This leg is dated outside the trip's ${formatDateRange(
        tripDates.starts_on,
        tripDates.ends_on
      )} dates.`,
    };
  }

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
  // 61.51(b)(3) names ACTUAL and SIMULATED instrument as two separate
  // conditions of flight, so they are two fields. The legacy combined
  // `instrument_hours` stays writable for rows that predate the split and
  // is never derived from these — see the column comment in
  // 20260810080000_trip_legs_currency_fields.sql.
  const instrumentActual = parseTenth(
    String(formData.get("instrument_actual_hours") ?? ""),
    { max: 999, allowBlank: true }
  );
  const instrumentSimulated = parseTenth(
    String(formData.get("instrument_simulated_hours") ?? ""),
    { max: 999, allowBlank: true }
  );
  const crossCountryHours = parseTenth(
    String(formData.get("cross_country_hours") ?? ""),
    { max: 999, allowBlank: true }
  );
  if (
    blockHours === undefined ||
    nightHours === undefined ||
    instrumentHours === undefined ||
    instrumentActual === undefined ||
    instrumentSimulated === undefined ||
    crossCountryHours === undefined
  ) {
    return {
      values: null,
      error: "Times must be hours with at most one decimal place, like 1.4.",
    };
  }

  const counts: Record<string, number> = {};
  for (const field of [
    "day_takeoffs",
    "day_landings",
    "day_landings_full_stop",
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
        values: null,
        error: "Landings, takeoffs, approaches and holds must be whole numbers.",
      };
    }
    counts[field] = value;
  }

  // Mirrors trip_legs_day_full_stop_within_landings so the pilot gets a
  // sentence instead of a constraint name. The database is still the
  // authority.
  if ((counts.day_landings_full_stop ?? 0) > (counts.day_landings ?? 0)) {
    return {
      values: null,
      error:
        "Full-stop landings can't exceed the day landings. The full-stop count is how many of them came to a stop.",
    };
  }

  return {
    error: null,
    values: {
      leg_date: legDate,
      from_icao: icao(formData, "from_icao"),
      to_icao: icao(formData, "to_icao"),
      block_hours: blockHours,
      night_hours: nightHours,
      instrument_hours: instrumentHours,
      instrument_actual_hours: instrumentActual,
      instrument_simulated_hours: instrumentSimulated,
      cross_country_hours: crossCountryHours,
      day_takeoffs: counts.day_takeoffs,
      day_landings: counts.day_landings,
      day_landings_full_stop: counts.day_landings_full_stop,
      night_takeoffs: counts.night_takeoffs,
      night_landings_full_stop: counts.night_landings_full_stop,
      night_landings_touch_go: counts.night_landings_touch_go,
      approaches: counts.approaches,
      holds: counts.holds,
    },
  };
}

export async function addLeg(
  _prev: LegFormState,
  formData: FormData
): Promise<LegFormState> {
  const tripId = String(formData.get("trip_id") ?? "");
  if (!tripId || !UUID_RE.test(tripId)) return { error: "Missing trip id." };

  const { account } = await requireAccount(`/trips/${tripId}`);
  const supabase = await createClient();

  // Read fresh, never trusted from the form — same discipline saveTripDays
  // applies to a trip's own dates, and needed here so parseLegForm can
  // reject a leg dated outside them.
  const { data: tripRow, error: tripReadError } = await supabase
    .from("trips")
    .select("starts_on, ends_on")
    .eq("id", tripId)
    .eq("account_id", account.id)
    .maybeSingle();
  if (tripReadError) {
    return { error: friendlyDbError(tripReadError, "trips.select"), values: echoLeg(formData) };
  }
  if (!tripRow) return { error: "That trip no longer exists.", values: echoLeg(formData) };

  const { values, error: parseError } = parseLegForm(
    formData,
    tripRow as { starts_on: string; ends_on: string }
  );
  if (parseError || !values) {
    return { error: parseError ?? "Couldn't read that leg.", values: echoLeg(formData) };
  }

  const payload: LegInsert = {
    account_id: account.id,
    // The composite FK (account_id, trip_id) → trips is what actually
    // stops a leg being attached to another tenant's trip; RLS on
    // trip_legs alone only checks the LEG's account_id, which the
    // migration's own header calls out as the trap here.
    trip_id: tripId,
    ...values,
  };

  const { error } = await supabase.from("trip_legs").insert(payload as never);

  if (error) {
    return { error: friendlyDbError(error, "trip_legs.insert"), values: echoLeg(formData) };
  }

  revalidatePath(`/trips/${tripId}`);
  return { error: null };
}

/**
 * Corrects a leg in place. Added alongside the delete confirm dialog
 * (HIGH 4) so a typo'd block time — or any of the FAR 61.57 currency
 * counts this file's header calls out — no longer requires deleting the
 * leg and losing them to retype from scratch.
 *
 * Same shape as updateTrip: id validated with UUID_RE, account re-derived
 * server-side (never trusted from the form), values echoed back on every
 * validation or database failure so a rejected save doesn't blank the
 * rest of what was typed, and the update checked for both `error` and
 * `count` — PostgREST returns 200 with no error for a write that matched
 * no rows (another tab's delete, or a crafted id), and silently reporting
 * success there would tell a pilot their correction landed when it didn't.
 */
export async function updateLeg(
  _prev: LegFormState,
  formData: FormData
): Promise<LegFormState> {
  const id = String(formData.get("id") ?? "");
  if (!id || !UUID_RE.test(id)) return { error: "That leg isn't valid." };

  const tripId = String(formData.get("trip_id") ?? "");
  if (!tripId || !UUID_RE.test(tripId)) return { error: "Missing trip id." };

  const { account } = await requireAccount(`/trips/${tripId}`);
  const supabase = await createClient();

  // Same fresh, never-trusted-from-the-form read addLeg does — needed so
  // an EDITED leg date is checked against the trip's actual range too, not
  // just a newly added one.
  const { data: tripRow, error: tripReadError } = await supabase
    .from("trips")
    .select("starts_on, ends_on")
    .eq("id", tripId)
    .eq("account_id", account.id)
    .maybeSingle();
  if (tripReadError) {
    return { error: friendlyDbError(tripReadError, "trips.select"), values: echoLeg(formData) };
  }
  if (!tripRow) return { error: "That trip no longer exists.", values: echoLeg(formData) };

  const { values, error: parseError } = parseLegForm(
    formData,
    tripRow as { starts_on: string; ends_on: string }
  );
  if (parseError || !values) {
    return { error: parseError ?? "Couldn't read that leg.", values: echoLeg(formData) };
  }

  const { error, count: rowCount } = await supabase
    .from("trip_legs")
    .update(values as never, { count: "exact" })
    .eq("id", id)
    .eq("trip_id", tripId)
    .eq("account_id", account.id);

  if (error) {
    return { error: friendlyDbError(error, "trip_legs.update"), values: echoLeg(formData) };
  }
  // PostgREST returns 200 with no error for a write that matched no rows.
  if (rowCount === 0) {
    return { error: "That leg no longer exists.", values: echoLeg(formData) };
  }

  revalidatePath(`/trips/${tripId}`);
  return { error: null };
}

export async function deleteLeg(
  id: string,
  tripId: string
): Promise<{ error: string | null }> {
  const { account } = await requireAccount(`/trips/${tripId}`);

  const supabase = await createClient();
  const { error, count: rowCount } = await supabase
    .from("trip_legs")
    .delete({ count: "exact" })
    .eq("id", id)
    .eq("account_id", account.id);

  if (error) return { error: friendlyDbError(error, "trip_legs.delete") };
  if (rowCount === 0) return { error: "That leg no longer exists." };

  revalidatePath(`/trips/${tripId}`);
  return { error: null };
}

// ---------------------------------------------------------------------------
// Day grid — the whole grid is one form, saved in one round trip.
// ---------------------------------------------------------------------------

/**
 * Saves the trip's day grid: one row per calendar day of the trip.
 *
 * The dates this reads are NEVER taken from the submission. day-grid.tsx
 * names its inputs by date (`day_type:2026-08-06`, ...), but the set of
 * dates that matters is recomputed HERE from the trip's own, freshly-read
 * starts_on/ends_on via the same enumerateDates the form used to render
 * them. A posted field for a date outside that recomputed list is simply
 * never looked at — there is no field name for it to be reached through,
 * so an out-of-range date can't reach the database no matter what a
 * crafted POST contains.
 */
export async function saveTripDays(
  _prev: TripDaysFormState,
  formData: FormData
): Promise<TripDaysFormState> {
  const tripId = String(formData.get("trip_id") ?? "");
  if (!tripId || !UUID_RE.test(tripId)) return { error: "Missing trip id." };

  const { account } = await requireAccount(`/trips/${tripId}`);
  const supabase = await createClient();

  // Trip dates, the freeze check, and the account's day-type taxonomy
  // (needed below to know which day types are billable — F2) are all
  // independent reads, fetched together rather than as three round trips.
  const [
    { data: tripData, error: tripError },
    { data: committedOn, error: committedError },
    { data: dayTypeData, error: dayTypeError },
  ] = await Promise.all([
    supabase
      .from("trips")
      .select("starts_on, ends_on")
      .eq("id", tripId)
      .eq("account_id", account.id)
      .maybeSingle(),
    // F8: replaces a trips.billing_state check. billing_state only moves
    // on an invoice STATUS change, so a trip sitting on a still-draft
    // invoice read 'unbilled' and stayed editable — see updateTrip's
    // comment on the same fix for the full reasoning. `as never`: see the
    // matching comment on updateTrip's own rpc() call.
    supabase.rpc("trip_committed_invoice", {
      p_account_id: account.id,
      p_trip_id: tripId,
    } as never),
    supabase.from("day_types").select("id, billable").eq("account_id", account.id),
  ]);

  if (tripError) return { error: friendlyDbError(tripError, "trips.select") };
  const trip = tripData as { starts_on: string; ends_on: string } | null;
  if (!trip) return { error: "That trip no longer exists." };

  if (committedError) {
    return { error: friendlyDbError(committedError, "trip_committed_invoice") };
  }
  // Checked here, not just by rendering the grid read-only: a page left
  // open across an invoice being sent must not be able to post a write
  // the database would reject anyway with a worse-worded error.
  if (committedOn) {
    return { error: billedTripMessage(committedOn, "days") };
  }
  if (dayTypeError) {
    return { error: friendlyDbError(dayTypeError, "day_types.select") };
  }

  const billableByType = new Map(
    ((dayTypeData ?? []) as { id: string; billable: boolean }[]).map((t): [string, boolean] => [
      t.id,
      t.billable,
    ])
  );

  const dates = enumerateDates(trip.starts_on, trip.ends_on);

  // A fully-populated day row, unlike TripDayInsert — whose rate_cents/
  // quantity/notes are optional at the type level (the columns have a DB
  // default / are nullable) even though this action always supplies all
  // three. Keeping `submitted` on this stricter type is what lets the
  // diff below compare `row.rate_cents`/`row.quantity`/`row.notes`
  // without TS widening them to include `undefined`.
  type SubmittedDay = {
    account_id: string;
    trip_id: string;
    day_on: string;
    day_type_id: string;
    rate_cents: number;
    quantity: number;
    units: number;
    away: boolean;
    notes: string | null;
  };

  // A date whose posted day type is blank means "no row for this day" —
  // collected to delete. Everything else is a candidate write, diffed
  // against what's already saved below.
  const submitted: SubmittedDay[] = [];
  const clearDates: string[] = [];
  // F2: every row's problems are collected here, keyed by date, instead
  // of returning on the first bad row — a 12-row grid used to be up to 12
  // round trips, one rejected row at a time.
  const fieldErrors: Record<string, string> = {};

  for (const date of dates) {
    const dayTypeId = String(formData.get(dayTypeFieldName(date)) ?? "").trim();
    if (!dayTypeId) {
      clearDates.push(date);
      continue;
    }
    if (!UUID_RE.test(dayTypeId)) {
      fieldErrors[date] = "That day type isn't valid.";
      continue;
    }

    // F2: a NON-BILLABLE day type (e.g. the seeded "Off day") never
    // demands a rate — the grid hides the field and posts 0 for it, and
    // this ignores whatever a crafted POST sent instead, forcing 0
    // regardless. A day type this trip's account doesn't recognize is
    // treated as billable (fail toward requiring a rate, not away from
    // it) — the FK will reject a genuinely foreign id at write time.
    const billable = billableByType.get(dayTypeId) ?? true;
    const issues: string[] = [];
    let rateCents = 0;

    if (billable) {
      const parsedRate = parseDollarsToCents(String(formData.get(rateFieldName(date)) ?? ""));
      if (parsedRate === undefined) {
        issues.push("The rate must be an amount like 1500 or 1500.00.");
      } else if (parsedRate === null) {
        issues.push("Enter a rate. Use 0 if this day doesn't bill.");
      } else if (parsedRate < 0) {
        issues.push("The rate can't be negative.");
      } else {
        rateCents = parsedRate;
      }
    }

    // F1: reject anything outside 0.1–1.0, or carrying a second decimal
    // place — see parseQuantity/parseTenth for why that has to be
    // checked here rather than left to Postgres.
    const quantity = parseQuantity(String(formData.get(quantityFieldName(date)) ?? ""));
    if (quantity === undefined) {
      issues.push(
        "Quantity must be a fraction of a day between 0.1 and 1.0, with at most one decimal place, like 0.5."
      );
    }

    // 20260807070000: units (a rate FRACTION, distinct from quantity's
    // time fraction) is required the same way quantity is — the grid
    // never posts it blank, and a crafted POST that omits or mangles it
    // is rejected here rather than silently defaulting to something that
    // changes what the day bills.
    const units = parseUnits(String(formData.get(unitsFieldName(date)) ?? ""));
    if (units === undefined) {
      issues.push(
        "Rate fraction must be between 0.01 and 1.00, with at most two decimal places, like 0.5 for half rate."
      );
    }

    if (issues.length > 0) {
      fieldErrors[date] = issues.join(" ");
      continue;
    }

    submitted.push({
      account_id: account.id,
      trip_id: tripId,
      day_on: date,
      day_type_id: dayTypeId,
      rate_cents: rateCents,
      quantity: quantity as number,
      units: units as number,
      // A checkbox posts nothing at all when unchecked, so "on" is the
      // only value to test for — same pattern as addInvoiceLine's
      // `taxable` field (invoices/actions.ts).
      away: String(formData.get(awayFieldName(date)) ?? "") === "on",
      // optional() already returns null (never undefined) for a blank
      // field, so an update payload built from this always carries an
      // explicit `notes: null` rather than omitting the key — omitting it
      // would leave a stale note in place on a row the pilot just cleared.
      notes: optional(formData, notesFieldName(date)),
    });
  }

  // Nothing is written until every row is clean — a save that silently
  // wrote the 10 valid rows and reported only the 2 bad ones would leave
  // the grid in a state the pilot didn't actually ask for.
  if (Object.keys(fieldErrors).length > 0) {
    return { error: null, fieldErrors };
  }

  // Read what's already saved so a save only touches rows that actually
  // changed.
  //
  // WHY NOT ONE .upsert(): PostgREST compiles an upsert's ON CONFLICT
  // into `DO UPDATE SET <every payload column> = excluded.<col>`,
  // including account_id and trip_id — and Postgres checks UPDATE
  // privilege on every column named in that SET list even when the
  // incoming value is identical to the stored one. The Phase 9 migration
  // grants `authenticated` update on only (day_on, day_type_id,
  // rate_cents, quantity, units, away, notes); account_id/trip_id are
  // deliberately withheld (account_id is the tenancy key and must never be
  // tenant-updatable). So a single upsert 42501s on the conflict path —
  // i.e. on every date that already has a row, which is every save after
  // the first. Diffing into three targeted writes, each naming only
  // granted columns, is the fix, and it has a second benefit: an unedited
  // row is written to by nothing, so it keeps its created_at and a no-op
  // save is actually a no-op.
  const { data: existingData, error: existingError } = await supabase
    .from("trip_days")
    .select("day_on, day_type_id, rate_cents, quantity, units, away, notes")
    .eq("account_id", account.id)
    .eq("trip_id", tripId);

  if (existingError) {
    return { error: friendlyDbError(existingError, "trip_days.select") };
  }

  type ExistingDay = {
    day_on: string;
    day_type_id: string;
    rate_cents: number;
    quantity: number;
    units: number;
    away: boolean;
    notes: string | null;
  };
  const existingByDate = new Map(
    ((existingData ?? []) as ExistingDay[]).map((row) => [row.day_on, row])
  );

  const toInsert: TripDayInsert[] = [];
  const toUpdate: {
    date: string;
    day_type_id: string;
    rate_cents: number;
    quantity: number;
    units: number;
    away: boolean;
    notes: string | null;
  }[] = [];

  for (const row of submitted) {
    const existing = existingByDate.get(row.day_on);
    if (!existing) {
      toInsert.push(row);
      continue;
    }
    if (
      existing.day_type_id !== row.day_type_id ||
      existing.rate_cents !== row.rate_cents ||
      Number(existing.quantity) !== row.quantity ||
      Number(existing.units) !== row.units ||
      Boolean(existing.away) !== row.away ||
      existing.notes !== row.notes
    ) {
      toUpdate.push({
        date: row.day_on,
        day_type_id: row.day_type_id,
        rate_cents: row.rate_cents,
        quantity: row.quantity,
        units: row.units,
        away: row.away,
        notes: row.notes,
      });
    }
  }

  // toDelete: run first, same as before — dates the pilot cleared. A zero
  // count is expected and fine, most cleared dates never had a row; only
  // an error, never a silent no-op, is what this checks for.
  if (clearDates.length > 0) {
    const { error: deleteError } = await supabase
      .from("trip_days")
      .delete({ count: "exact" })
      .eq("account_id", account.id)
      .eq("trip_id", tripId)
      .in("day_on", clearDates);

    if (deleteError) {
      return { error: billedTripDbError(deleteError, "trip_days.delete") };
    }
  }

  // toInsert: one batched insert, not a round trip per date. Never
  // restructured as delete-all-then-insert-all — that would leave a
  // window where a failed insert has already destroyed rows nobody
  // asked to change, and it would churn created_at on every row.
  if (toInsert.length > 0) {
    const { error: insertError, count: insertCount } = await supabase
      .from("trip_days")
      .insert(toInsert as never, { count: "exact" });

    if (insertError) {
      return { error: billedTripDbError(insertError, "trip_days.insert") };
    }
    // PostgREST returns 200 with no error for a write that matched/
    // affected zero rows — an insert that silently landed fewer rows
    // than submitted must not read back as a clean save.
    if (insertCount !== toInsert.length) {
      return { error: "Some day rows didn't save. Refresh and try again." };
    }
  }

  // toUpdate: only the granted columns (day_type_id, rate_cents,
  // quantity, units, away, notes) — never account_id or trip_id — keyed on
  // the three columns that identify the row. Run concurrently: a trip is
  // bounded by its own date range, so this is at most a few dozen
  // statements, not a scan.
  if (toUpdate.length > 0) {
    const results = await Promise.all(
      toUpdate.map((row) => {
        const payload: TripDayUpdate = {
          day_type_id: row.day_type_id,
          rate_cents: row.rate_cents,
          quantity: row.quantity,
          units: row.units,
          away: row.away,
          notes: row.notes,
        };
        return supabase
          .from("trip_days")
          .update(payload as never, { count: "exact" })
          .eq("account_id", account.id)
          .eq("trip_id", tripId)
          .eq("day_on", row.date);
      })
    );

    for (const result of results) {
      if (result.error) {
        return { error: billedTripDbError(result.error, "trip_days.update") };
      }
      // Each statement is keyed to exactly one existing row (it came
      // from existingByDate), so its expected count is exactly 1 — not
      // "at least 1" or "any" — and anything else means that row didn't
      // actually get the pilot's edit.
      if (result.count !== 1) {
        return { error: "Some day rows didn't save. Refresh and try again." };
      }
    }
  }

  revalidatePath(`/trips/${tripId}`);
  return { error: null, saved: true };
}

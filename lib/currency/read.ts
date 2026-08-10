/**
 * THE ONLY I/O MODULE in lib/currency/**. Every export begins with
 * assertCurrencyEngineEnabled() — see gate.ts for why that, and not a
 * route check alone, is what stops a stray import from rendering a real-
 * looking answer computed from nothing.
 *
 * No screen imports this yet — the flag is off and nothing renders. This
 * file exists so the read/write shape is settled and reviewable now,
 * ahead of the UI batch that will actually call it.
 */
import "server-only";
import { createClient } from "@/lib/supabase/server";
import { requireAccount } from "@/lib/supabase/account";
import { logbookFrom } from "@/app/(app)/logbook/db";
import { tailKey } from "@/app/(app)/logbook/aircraft/db";
import { CURRENCY_DISCLAIMER } from "@/lib/brand";
import { assertCurrencyEngineEnabled } from "./gate";
import { describeResult } from "./describe";
import { isWellFormedIsoDate } from "./window";
import type { TripOperatingRule } from "@/lib/operating-rule";
import type { AircraftFacts, CurrencyEntry, CurrencyResult, IsoDate } from "./types";

// Same reasoning as app/(app)/logbook/export/route.ts: the Supabase Data
// API caps a single request's rows and TRUNCATES SILENTLY above that cap.
// A page size well under any plausible cap, paged with .range(), keeps
// any ONE request from ever hitting that cap — but a project-level
// PostgREST "max rows" setting configured below PAGE_SIZE could still
// truncate a single page silently, which would look identical to a
// genuinely short last page. loadCurrencyInput's paging loop below
// verifies this by EXACT EQUALITY against the query's own exact row
// count, never by a heuristic (rows.length !== the requested exact count
// -> entriesTruncated: true, which evaluateCurrency turns into
// insufficient_data with "window_truncated" for every entries-dependent
// result).
const PAGE_SIZE = 500;

/**
 * The pilot.aircraft/logbook_entries escape hatch this file uses
 * (logbookFrom, imported above) is scoped to its own table union in
 * app/(app)/logbook/db.ts — out of this task's file set to extend. Same
 * cast idiom, applied locally to the two tables this file reads/writes
 * that logbookFrom does not cover (documents, currency_snapshots): the
 * client is already schema-pinned to `pilot` at createClient() (see
 * lib/supabase/server.ts), so `.from()` alone reaches them.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function pilotFrom(supabase: Awaited<ReturnType<typeof createClient>>, table: string): any {
  return (supabase as unknown as { from: (t: string) => unknown }).from(table);
}

/**
 * Row shapes this file reads. Hand-authored, matching the house pattern
 * app/(app)/logbook/db.ts and app/(app)/logbook/aircraft/db.ts already
 * use for these same tables — lib/supabase/database.types.ts is kept in
 * lockstep with migrations by hand and does not yet carry the columns
 * this phase's migration adds (sole_manipulator, night_window_asserted,
 * is_turbine, certificated_more_than_one_pilot, documents.completed_on),
 * so the payload is typed against these shapes before it reaches a
 * `.from()` call typed as `any` — the same discipline used everywhere
 * else in this app (e.g. app/(app)/trips/actions.ts).
 */
type LogbookEntryRow = {
  id: string;
  entry_date: string;
  airman_user_id: string | null;
  aircraft_ident: string | null;
  role: "PIC" | "SIC" | "SOLO" | "DUAL_RECEIVED" | null;
  sole_manipulator: boolean | null;
  day_takeoffs: number;
  night_takeoffs: number;
  day_landings_full_stop: number;
  day_landings_touch_go: number;
  night_landings_full_stop: number;
  night_landings_touch_go: number;
  night_window_asserted: boolean | null;
  night_time: number | null;
  approaches_count: number;
  approach_type: string | null;
  approach_condition: "actual" | "simulated" | "neither" | null;
  holds: number;
  courses_intercepted_tracked: boolean;
  simulator_time: number | null;
  simulator_device_type: "ffs" | "ftd" | "atd" | "other" | null;
};

type AircraftRow = {
  tail_key: string;
  type_rating: string | null;
  type_designator: string | null;
  category_class: string | null;
  gear: "tricycle" | "tailwheel" | "skid" | "float" | "ski" | null;
};

type DocumentCompletionRow = {
  kind: string;
  completed_on: string | null;
  expires_on: string | null;
  airman_user_id: string | null;
};

export type CurrencyInput = {
  asOf: IsoDate;
  airmanUserId: string;
  intendedAircraft: AircraftFacts | null;
  operatingRule: TripOperatingRule | "unspecified";
  exemptionAsserted: boolean;
  flightReviewCompletedOn: IsoDate | null;
  medicalExpiresOn: IsoDate | null;
  entries: CurrencyEntry[];
  /**
   * True when the logbook read below could not confirm it retrieved every
   * row for this airman — see PAGE_SIZE's comment. evaluateCurrency uses
   * this to force every entries-dependent result to insufficient_data
   * with "window_truncated" rather than a count computed from a logbook
   * that might be missing rows.
   */
  entriesTruncated: boolean;
};

/**
 * Resolves an aircraft ident (a free-text logbook field) to the pilot's
 * registry, at READ time, matching pilot.aircraft's own read-time-join
 * design (20260810110000_aircraft_registry.sql: a registry row annotates
 * history, it never rewrites logbook_entries). Not filtered on
 * archived_at — an archived airframe still gives three years of entries
 * their type.
 */
function resolveAircraft(ident: string | null, registry: Map<string, AircraftRow>): AircraftFacts | null {
  if (!ident) return null;
  const key = tailKey(ident); // The one implementation — see this file's header.
  const row = registry.get(key);
  if (!row) return null;
  return {
    tailKey: row.tail_key,
    typeRating: row.type_rating,
    typeDesignator: row.type_designator,
    categoryClass: row.category_class,
    gear: row.gear,
  };
}

function toCurrencyEntry(row: LogbookEntryRow, registry: Map<string, AircraftRow>): CurrencyEntry {
  return {
    id: row.id,
    entryDate: row.entry_date,
    airmanUserId: row.airman_user_id,
    role: row.role,
    soleManipulator: row.sole_manipulator,
    dayTakeoffs: row.day_takeoffs,
    nightTakeoffs: row.night_takeoffs,
    dayLandingsFullStop: row.day_landings_full_stop,
    dayLandingsTouchGo: row.day_landings_touch_go,
    nightLandingsFullStop: row.night_landings_full_stop,
    nightLandingsTouchGo: row.night_landings_touch_go,
    nightWindowAsserted: row.night_window_asserted,
    nightTime: row.night_time,
    approachesCount: row.approaches_count,
    approachType: row.approach_type,
    approachCondition: row.approach_condition,
    holds: row.holds,
    coursesInterceptedTracked: row.courses_intercepted_tracked,
    simulatorTime: row.simulator_time,
    simulatorDeviceType: row.simulator_device_type,
    aircraft: resolveAircraft(row.aircraft_ident, registry),
  };
}

/**
 * Loads everything evaluateCurrency() needs for the signed-in airman, as
 * of the given date. Does not itself call evaluateCurrency() — that stays
 * the caller's job, keeping this module's only responsibility "get real
 * rows, safely."
 */
export async function loadCurrencyInput(opts: { asOf: IsoDate; intendedTail: string | null }): Promise<CurrencyInput> {
  assertCurrencyEngineEnabled();

  const { account, user } = await requireAccount("/currency");
  const supabase = await createClient();

  // Aircraft registry — small (a pilot's own fleet), loaded whole rather
  // than paged.
  const { data: aircraftRows, error: aircraftError } = await logbookFrom(supabase, "aircraft")
    .select("tail_key, type_rating, type_designator, category_class, gear")
    .eq("account_id", account.id);
  if (aircraftError) {
    throw new Error(`lib/currency/read.ts: failed to load pilot.aircraft: ${aircraftError.message}`);
  }
  const registry = new Map<string, AircraftRow>();
  for (const row of (aircraftRows ?? []) as AircraftRow[]) {
    registry.set(row.tail_key, row);
  }

  const intendedAircraft = opts.intendedTail ? resolveAircraft(opts.intendedTail, registry) : null;

  // Logbook entries, PAGED — see PAGE_SIZE's comment. Scoped to
  // account_id AND airman_user_id = the session user: 61.57/61.56 are
  // per-airman duties (docs/CURRENCY-SPEC.md, this phase's regulatory
  // findings, S2) and a business account can have more than one seat.
  //
  // TRUNCATION DETECTION IS EXACT, NEVER A HEURISTIC. A page shorter than
  // PAGE_SIZE is only trustworthy as "the last page" if the server's own
  // exact row count (requested once, on the first page — it does not
  // change across pages of the same filter) agrees with what this loop
  // actually retrieved. That guards against the one real gap in a
  // paged-with-.range() read: if the project's PostgREST "max rows" is
  // ever configured below PAGE_SIZE, a SINGLE request can come back short
  // for a reason that has nothing to do with reaching the end of the
  // data, and a short page would otherwise be indistinguishable from a
  // genuinely last one. `count: null` (the exact-count Prefer header not
  // honoured) is exactly as untrustworthy as a mismatch — see
  // recordSnapshots's identical rule for writes below — and is never
  // treated as "must be fine."
  const entries: CurrencyEntry[] = [];
  let offset = 0;
  let expectedTotal: number | null | undefined = undefined;
  for (;;) {
    const wantCount = offset === 0;
    const { data, error, count } = await logbookFrom(supabase, "logbook_entries")
      .select(
        "id, entry_date, airman_user_id, aircraft_ident, role, sole_manipulator, day_takeoffs, night_takeoffs, day_landings_full_stop, day_landings_touch_go, night_landings_full_stop, night_landings_touch_go, night_window_asserted, night_time, approaches_count, approach_type, approach_condition, holds, courses_intercepted_tracked, simulator_time, simulator_device_type",
        wantCount ? { count: "exact" } : undefined
      )
      .eq("account_id", account.id)
      .eq("airman_user_id", user.id)
      .order("entry_date", { ascending: false })
      .order("id", { ascending: false })
      .range(offset, offset + PAGE_SIZE - 1);

    if (error) {
      throw new Error(`lib/currency/read.ts: failed to load pilot.logbook_entries: ${error.message}`);
    }
    if (wantCount) expectedTotal = count;
    const page = (data ?? []) as LogbookEntryRow[];
    for (const row of page) entries.push(toCurrencyEntry(row, registry));
    if (page.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }
  const entriesTruncated = expectedTotal === null || expectedTotal === undefined || entries.length !== expectedTotal;

  // Flight review and medical documents — pilot.documents, kind IN
  // ('flight_review', 'medical'). Scoped to airman_user_id = the session
  // user, exactly like the logbook read above: 61.56 and 61.23(d) are
  // per-airman duties, and pilot.documents has no other way to say whose
  // document a row is until this phase's migration adds the column (see
  // its comment there). `.eq("airman_user_id", user.id)` drops a NULL row
  // at the SQL level (NULL = anything is NULL, never true) — which is
  // every row today, since no UI sets this column yet, so flight_review
  // and medical correctly read insufficient_data rather than adopt
  // another member's flight review or MEDICAL EXPIRY (REG-4/SEC-2). The
  // `.filter` below is belt and braces so a future edit that loosens the
  // query cannot silently widen this back to account-scoped without this
  // line also changing. completed_on is added by this phase's migration
  // too; latest by completed_on wins if a pilot has logged more than one
  // flight review.
  const { data: docRows, error: docError } = await pilotFrom(supabase, "documents")
    .select("kind, completed_on, expires_on, airman_user_id")
    .eq("account_id", account.id)
    .eq("airman_user_id", user.id)
    .in("kind", ["flight_review", "medical"]);
  if (docError) {
    throw new Error(`lib/currency/read.ts: failed to load pilot.documents: ${docError.message}`);
  }
  const documents = ((docRows ?? []) as unknown as DocumentCompletionRow[]).filter(
    (d) => d.airman_user_id === user.id
  );

  const flightReviewCompletedOn =
    documents
      .filter((d) => d.kind === "flight_review" && d.completed_on)
      .map((d) => d.completed_on as IsoDate)
      .sort()
      .at(-1) ?? null;

  const medicalExpiresOn =
    documents
      .filter((d) => d.kind === "medical" && d.expires_on)
      .map((d) => d.expires_on as IsoDate)
      .sort()
      .at(-1) ?? null;

  return {
    asOf: opts.asOf,
    airmanUserId: user.id,
    intendedAircraft,
    // No trip context on the first flag-on panel — see
    // docs/CURRENCY-SPEC.md's spec-correction S4. Resolves to
    // insufficient_data for the 135.247 branch by construction, honestly,
    // until a trip-scoped surface supplies a real operatingRule.
    operatingRule: "unspecified",
    exemptionAsserted: false,
    flightReviewCompletedOn,
    medicalExpiresOn,
    entries,
    entriesTruncated,
  };
}

/**
 * Writes a computed batch of results as new snapshot rows. APPEND-ONLY —
 * see supabase/migrations/20260811040000_currency_snapshots.sql: there is
 * no UPDATE grant to `authenticated`, so recomputing the same day writes a
 * new row rather than rewriting yesterday's answer.
 *
 * `asOf` is the date the CALLER evaluated `results` for — it is threaded
 * through explicitly rather than read from the server clock, because
 * `new Date()` here is today's UTC wall-clock date, not necessarily the
 * date the panel was computed for (a planned-trip evaluation, or any
 * client west of Greenwich after 17:00 local), and as_of/window_end would
 * silently disagree on the same row (REG-5/SEC-8). Every rule module
 * already keys its window on an explicit asOf string — this is the same
 * discipline applied at the write boundary.
 *
 * Uses { count: "exact" } and branches on the count NOT matching the
 * number of rows written: PostgREST returns 200 for a zero-row write (an
 * RLS reject that inserts nothing is not an error), so "no error" is not
 * "it wrote." A `count` of `null` — the exact-count Prefer header not
 * honoured — is exactly as untrustworthy as a mismatch, never treated as
 * success (SEC-9).
 */
export async function recordSnapshots(results: CurrencyResult[], asOf: IsoDate): Promise<void> {
  assertCurrencyEngineEnabled();

  if (!isWellFormedIsoDate(asOf)) {
    throw new Error(`lib/currency/read.ts: recordSnapshots asOf is not a well-formed ISO date: "${asOf}".`);
  }

  const { account, user } = await requireAccount("/currency");
  const supabase = await createClient();

  const rows = results.map((r) => ({
    account_id: account.id,
    airman_user_id: user.id,
    currency_type: r.currencyType,
    status: r.status,
    rule_basis: r.ruleBasis,
    as_of: asOf,
    window_start: r.window?.start ?? null,
    window_end: r.window?.end ?? null,
    through_date: r.throughDate,
    // limiting_item is the human-readable label (describe.ts's prose, the
    // one place currency-card copy lives); limiting_date is the raw date
    // the same result carries — two different columns, not a repeat.
    limiting_item: describeResult(r).limitingItem,
    limiting_date: r.limitingDate,
    counts: { required: r.required, observed: r.observed },
    counted_entry_ids: r.counted.map((c) => c.entryId),
    missing_inputs: r.missing,
    // COUNSEL-REVIEWED COPY. Never paraphrased — see lib/brand.ts's own
    // comment marking this string reviewed.
    limitations: CURRENCY_DISCLAIMER,
  }));

  // Nothing to write is not a write failure — evaluateCurrency always
  // returns exactly five results today, but this function's own contract
  // should not silently misreport an empty batch as "zero rows written."
  if (rows.length === 0) return;

  const { error, count } = await pilotFrom(supabase, "currency_snapshots").insert(rows, { count: "exact" });

  if (error) {
    throw new Error(`lib/currency/read.ts: failed to write pilot.currency_snapshots: ${error.message}`);
  }
  if (count !== rows.length) {
    throw new Error(
      `lib/currency/read.ts: currency_snapshots insert wrote ${count === null ? "an unknown number of" : count} of ${rows.length} rows — PostgREST returns 200 for a partial, zero-row, or unconfirmed write, so this is not a success.`
    );
  }
}

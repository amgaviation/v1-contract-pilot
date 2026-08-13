import "server-only";
import type { createClient } from "@/lib/supabase/server";
import {
  assembleTripPL,
  type TripPLAssembly,
  type TripPLClientRow,
  type TripPLPeriod,
  type TripPLRawRow,
  type TripPLTotals,
  type TripPLTripRow,
  type UnattributedRawRow,
} from "./report-lib";

type Supa = Awaited<ReturnType<typeof createClient>>;

// ---------------------------------------------------------------------------
// ROW CAPS — the same house rule as app/(app)/reports/profit-loss/queries.ts,
// app/(app)/reports/year-end/queries.ts and quarterly/queries.ts.
//
// 1000, NOT a larger number. The Supabase Data API clamps every response to
// db-max-rows (1000) and TRUNCATES SILENTLY — no error, no flag. Every
// truncation guard below detects the cap by EXACT EQUALITY
// (`rows.length === LIMIT`), so a limit ABOVE the server's own cap can never
// be reached and the guard becomes dead code: the query asks for 2000,
// PostgREST returns 1000, 1000 !== 2000, and a short report is presented as
// complete.
//
// WHY THE CAP BITES SO MUCH LESS HERE than on the other reports, and why it
// still has to be checked: pilot.trip_pl aggregates in the database and
// returns ONE ROW PER TRIP, so the thing being capped is a trip count — a
// number the pilot can see and reason about — rather than an invisible count
// of invoice lines or receipts underneath a figure. That is the whole point
// of doing the aggregation in SQL (see the migration header). But a set-
// returning function is still read through PostgREST, so its result set is
// clamped exactly like a table read, and a pilot with more than 1000 trips
// in one period would otherwise get a silently short report.
// ---------------------------------------------------------------------------
const TRIPS_LIMIT = 1000;
const CLIENTS_LIMIT = 1000;
// One row per client, so this is bounded by the client roster, not by the
// line count underneath it. Capped anyway, for the same reason the roster is.
const UNATTRIBUTED_LIMIT = 1000;

export type TripPLReport = {
  period: TripPLPeriod;
  /** A failed READ (database error). Mutually exclusive with `refusal`. */
  error: string | null;
  /**
   * A failed ASSEMBLY — the reads succeeded but the rows do not support an
   * honest report (a short join, figures that don't reconcile). Separate
   * from `error` because the two mean different things to the reader and
   * the CSV route: an error is "we couldn't fetch this", a refusal is "we
   * fetched it and it doesn't add up, so we won't print it."
   */
  refusal: string | null;

  trips: TripPLTripRow[];
  clients: TripPLClientRow[];
  totals: TripPLTotals;

  /** Any cap hit. The page warns; the CSV route refuses outright. */
  truncated: boolean;
  tripsTruncated: boolean;
  clientsTruncated: boolean;
  unattributedTruncated: boolean;
};

const EMPTY_TOTALS: TripPLTotals = {
  tripCount: 0,
  invoicedDayMoneyCents: 0,
  draftDayMoneyCents: 0,
  rebilledCostCents: 0,
  rebillInvoicedCents: 0,
  rebillGapCents: 0,
  deductibleExpenseCents: 0,
  unassignedExpenseCents: 0,
  marginCents: 0,
  dayQuantity: 0,
  marginPerDayCents: null,
  unattributedLineCents: 0,
  unattributedLineCount: 0,
  draftUnattributedLineCents: 0,
  draftUnattributedLineCount: 0,
  mileageMiles: 0,
};

/**
 * Everything /reports/trip-pl needs, assembled from three reads and shared
 * by the screen and the CSV export — the "one source for one number"
 * discipline the other reports follow (see loadProfitLossReport's note).
 * The export route calls THIS function, never its own variant, so a
 * downloaded CSV cannot disagree with the screen it came from.
 *
 * account-scoped throughout: every read filters on account_id even though
 * RLS is the real boundary — defence in depth, matching the note in
 * app/(app)/expenses/actions.ts. Both RPCs are SECURITY INVOKER, so
 * target_account_id is a FILTER applied on top of the caller's own RLS,
 * never a grant of authority; passing another tenant's id returns nothing
 * because RLS removed the rows.
 */
export async function loadTripPLReport(
  supabase: Supa,
  accountId: string,
  period: TripPLPeriod
): Promise<TripPLReport> {
  const [
    { data: tripData, error: tripError },
    { data: unattributedData, error: unattributedError },
    { data: clientData, error: clientError },
  ] = await Promise.all([
    // `as never` on the args, matching app/(app)/reports/balance-sheet/page.tsx's
    // ledger_balances call: supabase-js's rpc() arg inference does not
    // resolve through the schema-generic client this product pins
    // (createServerClient<Database, "pilot">), so the parameter type
    // collapses to `undefined`. The cast is on the ARGS only — the
    // RETURNED row type still comes from database.types.ts, which is
    // where the column list is checked, so this loses no type safety over
    // the shape the assembly actually consumes.
    supabase
      .rpc("trip_pl", {
        target_account_id: accountId,
        period_start: period.start,
        period_end: period.end,
      } as never)
      .limit(TRIPS_LIMIT),
    supabase
      .rpc("client_unattributed_lines", {
        target_account_id: accountId,
        period_start: period.start,
        period_end: period.end,
      } as never)
      .limit(UNATTRIBUTED_LIMIT),
    // The client roster, capped like every other list read. A truncated
    // roster does not corrupt a margin — it makes assembleTripPL REFUSE,
    // because a trip whose client name is missing would otherwise split
    // one client's work across two rollup buckets. The cap flag is
    // surfaced too, so the reader is told "your roster is larger than this
    // page reads" rather than only the refusal's consequence.
    // .eq("account_id") alongside RLS, matching
    // app/(app)/reports/year-end/travel-log-queries.ts — RLS is the real
    // boundary, but this read is the one place here that is a plain table
    // select rather than an account-filtered RPC, and the docstring above
    // promises defence in depth for every read.
    supabase
      .from("clients")
      .select("id, name")
      .eq("account_id", accountId)
      .limit(CLIENTS_LIMIT),
  ]);

  const error =
    tripError?.message ?? unattributedError?.message ?? clientError?.message ?? null;

  if (error) {
    return {
      period,
      error,
      refusal: null,
      trips: [],
      clients: [],
      totals: EMPTY_TOTALS,
      truncated: false,
      tripsTruncated: false,
      clientsTruncated: false,
      unattributedTruncated: false,
    };
  }

  const tripRows = (tripData ?? []) as TripPLRawRow[];
  const unattributedRows = (unattributedData ?? []) as UnattributedRawRow[];
  const clientRows = (clientData ?? []) as { id: string; name: string }[];

  const tripsTruncated = tripRows.length === TRIPS_LIMIT;
  const unattributedTruncated = unattributedRows.length === UNATTRIBUTED_LIMIT;
  const clientsTruncated = clientRows.length === CLIENTS_LIMIT;

  const assembly: TripPLAssembly = assembleTripPL({
    trips: tripRows,
    unattributed: unattributedRows,
    clientNames: new Map(clientRows.map((c) => [c.id, c.name])),
  });

  const truncated = tripsTruncated || unattributedTruncated || clientsTruncated;

  if (!assembly.ok) {
    return {
      period,
      error: null,
      refusal: assembly.reason,
      trips: [],
      clients: [],
      totals: EMPTY_TOTALS,
      truncated,
      tripsTruncated,
      clientsTruncated,
      unattributedTruncated,
    };
  }

  return {
    period,
    error: null,
    refusal: null,
    trips: assembly.trips,
    clients: assembly.clients,
    totals: assembly.totals,
    truncated,
    tripsTruncated,
    clientsTruncated,
    unattributedTruncated,
  };
}

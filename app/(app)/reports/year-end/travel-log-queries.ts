import "server-only";
import type { createClient } from "@/lib/supabase/server";
import { rowsOf } from "@/lib/supabase/rows";
import { yearBounds } from "./db";
import {
  assembleTravelLog,
  type TravelLogDayType,
  type TravelLogLeg,
  type TravelLogRow,
  type TravelLogTrip,
  type TravelLogTripDay,
} from "./travel-log";

type Supa = Awaited<ReturnType<typeof createClient>>;

/**
 * Same cap discipline as every list read in this report (see the long note
 * in queries.ts): the Data API clamps every response to 1000 rows and
 * TRUNCATES SILENTLY, every guard below detects the cap by exact equality
 * (`rows.length === LIMIT`), so a limit above the server's own clamp would
 * make the guard dead code. 1000, not more. A year holds at most 365-6
 * days, but a pilot can log multiple trips' day rows on one date, so the
 * guard is not dead code even here.
 */
export const TRAVEL_LOG_LIMIT = 1000;

export type TravelLogReport = {
  year: number;
  /** Non-null → a read failed or the join didn't reconcile. The page
   *  renders a visible failure and the export refuses — never an empty
   *  log presented as "you didn't travel". */
  error: string | null;
  /** True when any read hit TRAVEL_LOG_LIMIT — the log may be partial.
   *  The page shows a loud callout; the export refuses outright. */
  truncated: boolean;

  rows: TravelLogRow[];
  awayDayCount: number;
  perDiemDayCount: number;
  canceledDayCount: number;
};

/**
 * Everything the travel-log section needs, assembled once and shared by
 * the screen (page.tsx) and the CSV export (export/route.ts) — the same
 * "one source for one number" discipline as loadYearEndReport, in its own
 * loader because no other section reads trips/trip_days/trip_legs and the
 * export route only loads what its ?section= asks for.
 *
 * account-scoped throughout even though RLS is the real boundary —
 * defence in depth, matching the house note in
 * app/(app)/expenses/actions.ts. No embeds — every join is flat queries
 * resolved in memory, same as queries.ts.
 */
export async function loadTravelLog(
  supabase: Supa,
  accountId: string,
  year: number
): Promise<TravelLogReport> {
  const { start, end } = yearBounds(year);

  const failed = (message: string): TravelLogReport => ({
    year,
    error: message,
    truncated: false,
    rows: [],
    awayDayCount: 0,
    perDiemDayCount: 0,
    canceledDayCount: 0,
  });

  const [tripDaysResult, dayTypesResult, clientsResult] = await Promise.all([
    // One row per captured day dated in the tax year. Both bounds are
    // plain "YYYY-MM-DD" strings compared by Postgres against the `date`
    // column — no JS Date, no timezone conversion (see db.ts's header).
    rowsOf<TravelLogTripDay>(
      await supabase
        .from("trip_days")
        .select("id, trip_id, day_on, day_type_id, away")
        .eq("account_id", accountId)
        .gte("day_on", start)
        .lte("day_on", end)
        .order("day_on", { ascending: true })
        .order("id", { ascending: true })
        .limit(TRAVEL_LOG_LIMIT)
    ),
    // Every day type, archived included — a day captured under a
    // since-archived type still happened and still prints (the F10
    // reasoning on the client page, applied to a report).
    rowsOf<TravelLogDayType>(
      await supabase
        .from("day_types")
        .select("id, label, counts_for_per_diem")
        .eq("account_id", accountId)
    ),
    // A pilot's client list is small (same reasoning as queries.ts) —
    // fetched whole, not paged.
    rowsOf<{ id: string; name: string }>(
      await supabase.from("clients").select("id, name").eq("account_id", accountId)
    ),
  ]);

  if (!tripDaysResult.ok) {
    return failed(tripDaysResult.error.message ?? "trip_days read failed");
  }
  if (!dayTypesResult.ok) {
    return failed(dayTypesResult.error.message ?? "day_types read failed");
  }
  if (!clientsResult.ok) {
    return failed(clientsResult.error.message ?? "clients read failed");
  }

  const tripIds = [...new Set(tripDaysResult.rows.map((d) => d.trip_id))];

  // The trips behind every day row, and the year's legs for those trips.
  // `.in()` on a de-duplicated set of at most TRAVEL_LOG_LIMIT ids, so the
  // same cap bounds both (the profit-loss defect-9 lesson: an unbounded
  // .in() truncates silently just like a list query).
  const [tripsResult, legsResult] = tripIds.length
    ? await Promise.all([
        (async () =>
          rowsOf<TravelLogTrip>(
            await supabase
              .from("trips")
              .select("id, client_id, status, aircraft_ident")
              .eq("account_id", accountId)
              .in("id", tripIds)
              .limit(TRAVEL_LOG_LIMIT)
          ))(),
        (async () =>
          rowsOf<TravelLogLeg>(
            await supabase
              .from("trip_legs")
              .select("id, trip_id, leg_date, from_icao, to_icao, out_at")
              .eq("account_id", accountId)
              .in("trip_id", tripIds)
              .gte("leg_date", start)
              .lte("leg_date", end)
              .order("leg_date", { ascending: true })
              .order("id", { ascending: true })
              .limit(TRAVEL_LOG_LIMIT)
          ))(),
      ])
    : [
        { ok: true as const, rows: [] as TravelLogTrip[] },
        { ok: true as const, rows: [] as TravelLogLeg[] },
      ];

  if (!tripsResult.ok) {
    return failed(tripsResult.error.message ?? "trips lookup failed");
  }
  if (!legsResult.ok) {
    return failed(legsResult.error.message ?? "trip_legs read failed");
  }

  const assembly = assembleTravelLog({
    tripDays: tripDaysResult.rows,
    trips: tripsResult.rows,
    dayTypes: dayTypesResult.rows,
    legs: legsResult.rows,
    clientNames: new Map(clientsResult.rows.map((c) => [c.id, c.name])),
  });
  if (!assembly.ok) {
    return failed(assembly.reason);
  }

  const truncated =
    tripDaysResult.rows.length === TRAVEL_LOG_LIMIT ||
    tripsResult.rows.length === TRAVEL_LOG_LIMIT ||
    legsResult.rows.length === TRAVEL_LOG_LIMIT ||
    dayTypesResult.rows.length === TRAVEL_LOG_LIMIT ||
    clientsResult.rows.length === TRAVEL_LOG_LIMIT;

  return {
    year,
    error: null,
    truncated,
    rows: assembly.rows,
    awayDayCount: assembly.awayDayCount,
    perDiemDayCount: assembly.perDiemDayCount,
    canceledDayCount: assembly.canceledDayCount,
  };
}

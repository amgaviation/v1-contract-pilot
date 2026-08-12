import "server-only";
import type { createClient } from "@/lib/supabase/server";
import { rowsOf } from "@/lib/supabase/rows";
import { logbookFrom } from "../../logbook/db";
import {
  computeFlightTimeReport,
  type FlightTimeEntry,
  type FlightTimeReportData,
  type FlightTimeWindow,
} from "./report-lib";

type Supa = Awaited<ReturnType<typeof createClient>>;

/**
 * Same cap discipline as every list read in this app (see the long note
 * in app/(app)/reports/profit-loss/queries.ts): the Data API clamps every
 * response to 1000 rows and truncates silently, so reads either page to
 * completeness or the report refuses. 1000, not more.
 */
const ENTRIES_LIMIT = 1000;

/**
 * The entries read pages past the cap with .range() rather than warning:
 * a flight-time total short by whatever fell off the end is exactly the
 * reassuring-number defect this report exists to avoid — an operator asks
 * for these figures before assignment, and an undercount is the one
 * direction the page must never err in. The ceiling bounds the loop at
 * ~10,000 entries inside a fifteen-month range, several careers' worth of
 * density; past it the report refuses rather than totals a partial read.
 */
const MAX_ENTRY_PAGES = 10;

export type FlightTimeReport = {
  /** Non-null → a read failed or came back short. The page renders a
   *  visible failure — never figures over a partial logbook read. */
  error: string | null;
  data: FlightTimeReportData | null;
};

/**
 * Everything /reports/flight-time needs. Reads pilot.logbook_entries —
 * the pilot's own record, which is the point: 135.267's limits count
 * flying across every operator, and the logbook is the one place all of
 * it lands (trip-derived entries, imports, manual entries alike).
 *
 * account-scoped throughout even though RLS is the real boundary —
 * defence in depth, matching the house note in
 * app/(app)/expenses/actions.ts. Goes through logbookFrom (the logbook
 * tables' typed-client escape hatch — see app/(app)/logbook/db.ts's
 * header for why they are absent from the generated types).
 */
export async function loadFlightTimeReport(
  supabase: Supa,
  accountId: string,
  windows: FlightTimeWindow[]
): Promise<FlightTimeReport> {
  const failed = (message: string): FlightTimeReport => ({
    error: message,
    data: null,
  });

  // Coverage is a fact about the WHOLE logbook, not the fetched range:
  // the earliest entry anywhere is what bounds what any window's figure
  // can honestly claim.
  const earliestResult = rowsOf<{ entry_date: string }>(
    await logbookFrom(supabase, "logbook_entries")
      .select("entry_date")
      .eq("account_id", accountId)
      .order("entry_date", { ascending: true })
      .limit(1)
  );
  if (!earliestResult.ok) {
    return failed(earliestResult.error.message ?? "logbook read failed");
  }
  const earliestEntryDate = earliestResult.rows[0]?.entry_date ?? null;

  if (earliestEntryDate === null) {
    // Genuinely empty logbook (the read SUCCEEDED — rowsOf keeps that
    // distinct from a failure): the compute step turns this into the
    // page's honest no-figures state.
    return { error: null, data: computeFlightTimeReport([], windows, null) };
  }

  // One fetch spanning every window: the two-consecutive-quarters window
  // reaches back furthest except in Q4, when Jan 1 is earlier. Lexical
  // min is date min for ISO dates.
  const from = windows.reduce(
    (min, w) => (w.from < min ? w.from : min),
    windows[0]!.from
  );
  const to = windows.reduce((max, w) => (w.to > max ? w.to : max), windows[0]!.to);

  const entries: FlightTimeEntry[] = [];
  let offset = 0;
  for (;;) {
    if (offset >= ENTRIES_LIMIT * MAX_ENTRY_PAGES) {
      return failed(
        "your logbook holds more entries in this date range than the report can read completely — totals over a partial read would understate your flying, so none are shown"
      );
    }
    const page = rowsOf<FlightTimeEntry>(
      await logbookFrom(supabase, "logbook_entries")
        .select("entry_date, total_time, simulator_time")
        .eq("account_id", accountId)
        .gte("entry_date", from)
        .lte("entry_date", to)
        .order("entry_date", { ascending: true })
        .order("id", { ascending: true })
        .range(offset, offset + ENTRIES_LIMIT - 1)
    );
    if (!page.ok) {
      return failed(page.error.message ?? "logbook entries read failed");
    }
    entries.push(...page.rows);
    offset += page.rows.length;
    if (page.rows.length < ENTRIES_LIMIT) break;
  }

  return {
    error: null,
    data: computeFlightTimeReport(entries, windows, earliestEntryDate),
  };
}

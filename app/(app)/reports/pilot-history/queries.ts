import "server-only";
import type { createClient } from "@/lib/supabase/server";
import { rowsOf } from "@/lib/supabase/rows";
import { logbookFrom } from "../../logbook/db";
import {
  computePilotHistoryReport,
  RECORDED_DATE_KINDS,
  type PilotHistoryAircraft,
  type PilotHistoryDocument,
  type PilotHistoryEntry,
  type PilotHistoryReportData,
} from "./report-lib";

type Supa = Awaited<ReturnType<typeof createClient>>;

/**
 * pilot.documents is reached through the same local `.from()` cast
 * lib/currency/read.ts uses and for the same reason: it needs
 * `completed_on` and `airman_user_id` (20260811040000), and
 * lib/supabase/database.types.ts is hand-authored and does not yet carry
 * them, so a typed select resolves the row to a shape without those
 * columns. The client is already schema-pinned to `pilot` at
 * createClient(), so `.from()` alone reaches the table; the row shape is
 * asserted here instead, exactly the discipline used elsewhere.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function pilotFrom(supabase: Supa, table: string): any {
  return (supabase as unknown as { from: (t: string) => unknown }).from(table);
}

/**
 * Same cap discipline as every list read in this app: the Data API clamps
 * a response and TRUNCATES SILENTLY, so reads either page to completeness
 * or the report refuses.
 *
 * 500, NOT 1000, and the margin is the point. 1000 is the Supabase default
 * for the Data API's max-rows, so a page size of exactly 1000 makes this
 * loop's end-of-data test ("a short page is the last page") rest on that
 * setting never being lowered: under a stricter clamp every full page
 * comes back clamped, reads as final, and the loop exits with a truncated
 * career. The sibling entries export already pages at 500 for this exact
 * reason, and the completeness check below is what actually guarantees the
 * result either way — this is the margin that keeps the guarantee from
 * being reached in the first place.
 */
const ENTRIES_PAGE = 500;

/**
 * The ceiling on that loop, in ENTRIES rather than pages so changing the
 * page size cannot quietly move it. Higher than the flight-time report's,
 * and it has to be: that report reads a fifteen-month range, this one reads
 * a WHOLE CAREER, which is the figure at the top of every form it exists to
 * fill. 30,000 entries is well past a thirty-year airline career logged leg
 * by leg. Past it the report refuses rather than totals a partial read —
 * see the module note below on why that direction is not negotiable.
 */
const MAX_ENTRIES = 30_000;

/**
 * A fleet is small — the registry has one row per airframe a pilot has
 * ever flown for anyone, and a very busy freelancer's is dozens. This is
 * one request, and a fleet past it is refused rather than silently halved,
 * because a missing registry row does not error: it quietly demotes every
 * entry in that airframe to the unmatched bucket, which is a WRONG
 * BREAKDOWN that looks exactly like a correct one.
 */
const AIRCRAFT_LIMIT = 1000;

/** Credentials on file. One request; a pilot has a handful. */
const DOCUMENTS_LIMIT = 500;

/**
 * The airman-scoped reads are the queries in this feature that build a
 * PostgREST filter by STRING INTERPOLATION — `.or()` takes raw filter
 * syntax and there is no parameterised form of it. The value interpolated
 * is the session user's id, which comes from supabase.auth.getUser() and
 * is not user input, so this is not an injection today. It is checked
 * anyway, because "not user input" is a property of the call site rather
 * than of this function, and a comma or a parenthesis reaching that string
 * would not fail loudly — it would silently reshape the filter into one
 * that still runs and admits the wrong rows.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isAirmanId(value: string): boolean {
  return UUID_RE.test(value);
}

/**
 * THIS AIRMAN'S ROWS, PLUS THE ONES THAT NAME NOBODY — the filter string,
 * defined once because two surfaces (the report and its entries CSV) must
 * scope identically or the evidence contradicts the totals it backs.
 *
 * WHY NOT ACCOUNT-SCOPED. 14 CFR 61.51 is a per-airman duty and
 * pilot.account_members can hold more than one seat, so account_id is a
 * BILLING boundary, not an airman. The logbook SCREEN is deliberately
 * account-wide (20260807050000: a business account's members should see the
 * whole account's flying); this document is the opposite kind of thing —
 * one airman's history, letterheaded and signed by them — and summing a
 * colleague's hours into it would be the account-vs-airman scoping defect
 * docs/LAUNCH-GATES.md G1 already records once, inverted.
 *
 * WHY NOT `.eq(airman_user_id, me)` LIKE lib/currency/read.ts. That module
 * decides eligibility, where adopting an unattributed entry would be an
 * unsafe guess about a regulated duty. This one adds hours up: the column
 * was not backfilled on multi-member accounts, so filtering to attributed
 * rows alone would silently delete a career from a report whose whole
 * promise is completeness. Unattributed rows are therefore counted, and
 * SAID OUT LOUD on every surface (unattributedEntryCount) — the identical
 * three-way posture the documents read below already takes.
 *
 * On today's single-seat accounts every row is attributed to the sole
 * member (the 20260807050000 backfill), so this admits exactly what the
 * account-scoped read did.
 */
export function airmanScopeFilter(sessionUserId: string): string {
  return `airman_user_id.eq.${sessionUserId},airman_user_id.is.null`;
}

export type PilotHistoryReport = {
  /** Non-null → a read failed or came back short. The page renders a
   *  visible failure — never figures over a partial read. */
  error: string | null;
  data: PilotHistoryReportData | null;
};

/**
 * Everything /reports/pilot-history needs, in three reads.
 *
 * ===========================================================================
 * REFUSE, DO NOT WARN. Every other paged read in this app can degrade to a
 * caption; this one cannot. The figures this loader feeds are transcribed
 * onto an insurance questionnaire or an operator's pilot record and
 * signed, by a pilot who has no way to audit them against anything. A
 * total short by whatever fell off the end of a paged read would look
 * exactly like a correct total, and the pilot would attest to it. So every
 * failure mode here — a failed read, a fleet past its cap, an entry count
 * past its cap, a paged read whose result does not match the server's own
 * count — returns an error and NO data, and the page renders the failure
 * instead of the report.
 *
 * That includes the failure modes that are not errors. A short fleet read
 * does not throw; it just leaves airframes unmatched, and unmatched
 * airframes produce a plausible-looking breakdown with the wrong hours in
 * the wrong rows. Nor does a clamped page or a concurrent import throw —
 * they just return a total that is quietly short or long. Every one of
 * those is treated as a failure rather than as a limit.
 * ===========================================================================
 *
 * account-scoped throughout even though RLS is the real boundary — defence
 * in depth, matching the house note in app/(app)/expenses/actions.ts — and
 * AIRMAN-scoped on top of that for the two reads that describe a person
 * rather than a business. See airmanScopeFilter.
 */
export async function loadPilotHistoryReport(
  supabase: Supa,
  accountId: string,
  sessionUserId: string,
  today: string
): Promise<PilotHistoryReport> {
  /**
   * EVERY REFUSAL IS ALREADY A SENTENCE FOR THE PILOT. `error` is rendered
   * to them verbatim, so a raw PostgREST message must never become its
   * value: those carry table and constraint names, say nothing the reader
   * can act on, and are what lib/db-errors.ts exists to keep off a screen.
   * A read failure is logged with its detail and reported as the one thing
   * the pilot needs to know — the report was not compiled, and no figures
   * are shown.
   */
  const failed = (message: string): PilotHistoryReport => ({
    error: message,
    data: null,
  });
  const readFailed = (what: string, error: unknown): PilotHistoryReport => {
    console.error(`[pilot-history] ${what} read failed`, error);
    return failed(
      "your pilot history couldn't be compiled just now, so no figures are shown rather than a partial set. Try again in a moment"
    );
  };

  if (!isAirmanId(sessionUserId)) {
    // See UUID_RE's comment. Refusing is the only safe branch: the
    // alternative shapes are "widen the documents read to the whole
    // account" (which would print another seat's medical on this pilot's
    // history) and "drop the section" (which would look like the pilot has
    // no paperwork on file).
    return failed("couldn't establish which airman this report is for");
  }

  // -- The fleet. Read FIRST: if this one is unreliable, there is no point
  //    paging a career's worth of entries to annotate them against it.
  const aircraftResult = rowsOf<PilotHistoryAircraft>(
    await logbookFrom(supabase, "aircraft")
      .select(
        "tail_number, tail_key, type_designator, type_rating, make_model, category_class, is_turbine, is_retractable"
      )
      .eq("account_id", accountId)
      .order("tail_number", { ascending: true })
      .limit(AIRCRAFT_LIMIT)
  );
  if (!aircraftResult.ok) {
    return readFailed("aircraft", aircraftResult.error);
  }
  if (aircraftResult.rows.length >= AIRCRAFT_LIMIT) {
    return failed(
      "your fleet holds more aircraft than this report can read in one request — without all of them, hours would be filed under the wrong make and model, so no figures are shown"
    );
  }
  // ARCHIVED AIRFRAMES ARE KEPT, deliberately. archived_at takes an
  // aeroplane out of the pickers; it does not unfly the hours. Filtering
  // them out here would move a retired airframe's entire history into the
  // unmatched bucket the day a pilot tidies their fleet.

  // -- The logbook, whole. No date bound: the all-time column IS the
  //    headline figure on every form this report exists to fill. Scoped to
  //    this airman — see airmanScopeFilter's note on why an account is not
  //    an airman and why unattributed rows are admitted rather than
  //    dropped.
  //
  //    COMPLETENESS IS PROVEN, NOT INFERRED. "A page shorter than
  //    ENTRIES_PAGE is the last page" is a heuristic, and it is wrong in
  //    two ways that both end in a silently short career total: a max-rows
  //    clamp below the page size makes every full page look final, and a
  //    row inserted or deleted between pages (an import running in another
  //    tab) shifts every later offset, duplicating one entry or dropping
  //    another. So the server's own exact count is requested on the first
  //    page and the loop's result must match it EXACTLY — a mismatch in
  //    either direction refuses. This is lib/currency/read.ts's rule
  //    (see its own long note), applied to the read whose figures get
  //    signed.
  const entries: PilotHistoryEntry[] = [];
  let offset = 0;
  let expectedTotal: number | null = null;
  for (;;) {
    if (offset >= MAX_ENTRIES) {
      return failed(
        "your logbook holds more entries than this report can read completely — totals over a partial read would understate your flying on a form you have to sign, so none are shown"
      );
    }
    const wantCount = offset === 0;
    const response = await logbookFrom(supabase, "logbook_entries")
      .select(
        "entry_date, airman_user_id, aircraft_ident, aircraft_type, role, total_time, pic_time, sic_time, solo_time, cross_country_time, night_time, instrument_actual_time, instrument_simulated_time, flight_instructor_time, dual_received_time, simulator_time, day_takeoffs, night_takeoffs, day_landings_full_stop, day_landings_touch_go, night_landings_full_stop, night_landings_touch_go",
        wantCount ? { count: "exact" } : undefined
      )
      .eq("account_id", accountId)
      .or(airmanScopeFilter(sessionUserId))
      .order("entry_date", { ascending: true })
      // A second, unique key so the page boundary is deterministic. Two
      // entries on one date with no tiebreak can be returned in a
      // different order on each request, which duplicates one row across
      // a page boundary and drops another.
      .order("id", { ascending: true })
      .range(offset, offset + ENTRIES_PAGE - 1);
    const page = rowsOf<PilotHistoryEntry>(response);
    if (!page.ok) {
      return readFailed("logbook entries", page.error);
    }
    if (wantCount) expectedTotal = (response as { count: number | null }).count;
    entries.push(...page.rows);
    offset += page.rows.length;
    if (page.rows.length < ENTRIES_PAGE) break;
  }
  // A count the server declined to give is exactly as untrustworthy as one
  // that disagrees, and is never read as "must be fine".
  if (expectedTotal === null || entries.length !== expectedTotal) {
    return failed(
      "your logbook could not be read completely just now — totals over a partial read would misstate your flying on a form you have to sign, so none are shown. Try again in a moment"
    );
  }

  // -- The credentials that carry a date.
  //
  //    WHOSE DOCUMENTS. pilot.documents.airman_user_id (20260811040000) is
  //    nullable and was not backfilled, so a row is either this airman's,
  //    nobody's, or another seat's. This read admits the first two and
  //    excludes the third at the SQL level. It cannot simply filter to
  //    `= sessionUserId` the way lib/currency/read.ts does, and the
  //    difference is deliberate: that module decides eligibility, where
  //    adopting an unattributed medical would be an unsafe guess about a
  //    regulated duty. This report decides nothing — it prints dates the
  //    pilot typed, captioned as such — and filtering to attributed rows
  //    alone would empty the section for every account that predates the
  //    column, which is essentially all of them. So unattributed rows are
  //    shown and LABELLED unattributed (report-lib.ts's RecordedDate),
  //    which is the only option that neither hides the pilot's own
  //    paperwork nor claims a colleague's is theirs.
  const documentsResult = rowsOf<PilotHistoryDocument>(
    await pilotFrom(supabase, "documents")
      .select("kind, label, completed_on, issued_on, expires_on, airman_user_id")
      .eq("account_id", accountId)
      .in("kind", [...RECORDED_DATE_KINDS])
      .or(airmanScopeFilter(sessionUserId))
      .order("kind", { ascending: true })
      .limit(DOCUMENTS_LIMIT)
  );
  if (!documentsResult.ok) {
    return readFailed("documents", documentsResult.error);
  }
  if (documentsResult.rows.length >= DOCUMENTS_LIMIT) {
    return failed(
      "you have more credential documents on file than this report can list in one request, so no figures are shown rather than a partial set of dates"
    );
  }

  return {
    error: null,
    data: computePilotHistoryReport(
      entries,
      aircraftResult.rows,
      documentsResult.rows,
      sessionUserId,
      today
    ),
  };
}

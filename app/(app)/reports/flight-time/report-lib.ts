/**
 * Pure computation for the cross-operator flight-time report — no I/O, no
 * Supabase, no Next imports, so tests/flight-time.test.mjs can exercise it
 * directly (the same split as the sales-tax report's report-lib.ts).
 *
 * ---- THE REGULATION THIS REPORT EXISTS FOR -------------------------------
 * 14 CFR 135.267 — "Flight time limitations and rest requirements:
 * Unscheduled one- and two-pilot crews." Verified against the eCFR
 * (https://www.ecfr.gov/current/title-14/chapter-I/subchapter-G/part-135/
 * subpart-F/section-135.267), current text as of the 2026-08-10 title
 * issue date, retrieved 2026-08-11 via the eCFR versioner API. The bucket
 * text, verbatim:
 *
 *   (a) No certificate holder may assign any flight crewmember, and no
 *   flight crewmember may accept an assignment, for flight time as a
 *   member of a one- or two-pilot crew if that crewmember's total flight
 *   time in all commercial flying will exceed—
 *     (1) 500 hours in any calendar quarter.
 *     (2) 800 hours in any two consecutive calendar quarters.
 *     (3) 1,400 hours in any calendar year.
 *
 *   (b) Except as provided in paragraph (c) of this section, during any
 *   24 consecutive hours the total flight time of the assigned flight
 *   when added to any other commercial flying by that flight crewmember
 *   may not exceed—
 *     (1) 8 hours for a flight crew consisting of one pilot; or
 *     (2) 10 hours for a flight crew consisting of two pilots qualified
 *     under this part for the operation being conducted.
 *
 *   [Docket 23634, 50 FR 29320, July 18, 1985, as amended by Amdt.
 *   135-33, 54 FR 39294, Sept. 25, 1989; Amdt. 135-60, 61 FR 2616,
 *   Jan. 26, 1996]
 *
 * So the windows this report totals are exactly the reg's: a trailing
 * 24-hour window, the calendar quarter, two consecutive calendar
 * quarters, and the calendar year. Regs amend — re-verify at ecfr.gov
 * before changing any window here, per the house rule in
 * docs/CURRENCY-SPEC.md.
 *
 * ---- WHY THE PILOT, NOT THE OPERATOR, NEEDS THIS -------------------------
 * The limits count "all commercial flying" — flying for every certificate
 * holder plus any other commercial work. No single operator can see a
 * freelancer's flying for the others; the reg itself makes the
 * multi-operator pilot the only person positioned to aggregate. That is
 * this page: the pilot's own cross-operator picture, from the pilot's own
 * logbook, to hand an operator who asks "what else have you flown this
 * quarter" before assignment.
 *
 * ---- TOTALS ONLY, BY DESIGN ----------------------------------------------
 * This module computes HOURS. It renders no verdicts, no limits math, no
 * "legal / not legal", no remaining-hours countdowns — the assigning
 * certificate holder's own program governs assignment, and legality
 * wording in this product sits behind the counsel gate
 * (docs/LAUNCH-GATES.md G1 family). Stating the reg's own figures in
 * page copy, cited, is citation; comparing them to the pilot's totals is
 * a verdict and does not happen here.
 *
 * ---- HONEST APPROXIMATIONS, STATED, ALL CONSERVATIVE ---------------------
 * 1. BLOCK ≈ FLIGHT TIME. 135.267 counts flight time (14 CFR 1.1:
 *    moves-under-own-power to rest after landing). The logbook's
 *    total_time for trip-derived entries is block (out→in), which is
 *    equal or slightly longer. Counting more than the reg requires is
 *    the conservative direction; the page says so rather than hiding it.
 * 2. ALL LOGGED FLYING, not just commercial. The logbook does not tag
 *    entries commercial-vs-personal, so the totals include everything
 *    (simulator sessions excluded — a box is not flight time; the same
 *    greatest(total - simulator, 0) arithmetic as pilot.logbook_totals).
 *    Again conservative: the reg's own basis can only be lower.
 * 3. THE TRAILING-24-HOUR FIGURE COVERS THREE CALENDAR DATES. Entries carry
 *    a date, not off/on times, so a clock-exact rolling window (the
 *    house rule for rolling windows is timestamps, docs/CURRENCY-SPEC
 *    §rolling) cannot be computed from them. pilot.logbook_entries.entry_date
 *    is a plain pilot-typed date with no timezone convention enforced, and
 *    US pilots overwhelmingly log LOCAL dates (UTC-5 to UTC-10) rather
 *    than UTC ones. A two-calendar-day UTC window (today and yesterday)
 *    is only a superset of every 24-hour window ending now if entry_date
 *    is itself a UTC date — for a pilot logging local dates, the UTC
 *    rollover (14:00-19:00 local, depending on offset) can put last
 *    night's flying, still inside the preceding 24 clock hours, on a date
 *    before that window's from-bound. Widening to the last THREE calendar
 *    dates (UTC) covers every 24-hour window ending now under any
 *    entry-date convention within +/-12h of UTC, so it can only
 *    over-cover, never miss flying. Stated on-page in exactly those terms.
 *
 * ---- HONEST DEGRADATION --------------------------------------------------
 * A logbook that starts mid-window cannot verify that window's total: the
 * report says "your logbook's earliest entry is <date> — flying before
 * that is not in this figure" instead of printing a low number as if
 * verified. An empty logbook produces NO figures, never a page of 0.0s
 * (product-translation §3: degrade honestly, and lib/supabase/rows.ts's
 * empty-vs-unknown rule applied to coverage instead of a read).
 */

// ---------------------------------------------------------------------------
// Calendar windows.
// ---------------------------------------------------------------------------

export type FlightTimeWindowKey =
  | "trailing24h"
  | "quarter"
  | "twoQuarters"
  | "year";

export type FlightTimeWindow = {
  key: FlightTimeWindowKey;
  /** Inclusive "YYYY-MM-DD" bounds, compared lexically (ISO dates sort). */
  from: string;
  to: string;
  /** e.g. "Calendar quarter (Q3 2026)". */
  label: string;
  /** Which part of 135.267 names this window — a citation, not a verdict. */
  citation: string;
};

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** Today as "YYYY-MM-DD" in UTC — calendar facts are UTC facts in this
 *  codebase (see parseCalendarDate's note in lib/format.ts). */
export function todayIso(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${pad2(now.getUTCMonth() + 1)}-${pad2(now.getUTCDate())}`;
}

/** The previous calendar date, in the pure string/UTC domain. */
export function previousDayIso(today: string): string {
  const [y, m, d] = today.split("-").map(Number);
  const date = new Date(Date.UTC(y!, m! - 1, d! - 1));
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`;
}

/** First day of the calendar quarter containing `today`. */
export function quarterStartIso(today: string): string {
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  const startMonth = month - ((month - 1) % 3);
  return `${year}-${pad2(startMonth)}-01`;
}

/** First day of the PREVIOUS calendar quarter — crosses the year boundary
 *  when the current quarter is Q1 (previous is last year's Q4). */
export function previousQuarterStartIso(today: string): string {
  const start = quarterStartIso(today);
  const year = Number(start.slice(0, 4));
  const month = Number(start.slice(5, 7));
  return month === 1
    ? `${year - 1}-10-01`
    : `${year}-${pad2(month - 3)}-01`;
}

function quarterLabel(dateIso: string): string {
  const year = Number(dateIso.slice(0, 4));
  const q = Math.floor((Number(dateIso.slice(5, 7)) - 1) / 3) + 1;
  return `Q${q} ${year}`;
}

/**
 * The four 135.267 windows, ending at `today` (passed in so tests can pin
 * it; the page passes todayIso()). All are TO-DATE windows: the reg
 * limits totals within the calendar period, and the pilot's operational
 * question is "what have I flown in the one we're in".
 */
export function flightTimeWindows(today: string): FlightTimeWindow[] {
  if (!ISO_DATE_RE.test(today)) {
    // A malformed clock read must not silently produce nonsense windows.
    throw new Error(`flightTimeWindows: not an ISO date: ${today}`);
  }
  const qStart = quarterStartIso(today);
  const prevQStart = previousQuarterStartIso(today);
  return [
    {
      key: "trailing24h",
      // Two days back, not one — see the header's point 3. A pilot who
      // logs local dates can put flying from inside the preceding 24
      // clock hours on a date one earlier than a UTC-only two-date window
      // would catch.
      from: previousDayIso(previousDayIso(today)),
      to: today,
      label: "Last three calendar days",
      citation: "135.267(b): any 24 consecutive hours",
    },
    {
      key: "quarter",
      from: qStart,
      to: today,
      label: `Calendar quarter (${quarterLabel(today)}), to date`,
      citation: "135.267(a)(1): any calendar quarter",
    },
    {
      key: "twoQuarters",
      from: prevQStart,
      to: today,
      label: `Two consecutive quarters (${quarterLabel(prevQStart)} to ${quarterLabel(today)}), to date`,
      citation: "135.267(a)(2): any two consecutive calendar quarters",
    },
    {
      key: "year",
      from: `${today.slice(0, 4)}-01-01`,
      to: today,
      label: `Calendar year (${today.slice(0, 4)}), to date`,
      citation: "135.267(a)(3): any calendar year",
    },
  ];
}

// ---------------------------------------------------------------------------
// Totals.
// ---------------------------------------------------------------------------

/** The columns read from pilot.logbook_entries. */
export type FlightTimeEntry = {
  entry_date: string;
  total_time: number;
  simulator_time: number | null;
};

export type FlightTimeFigure = {
  window: FlightTimeWindow;
  hours: number;
  /** How many entries the figure sums — "0.0 over 0 entries" is visibly
   *  different from "0.0 hours" alone. */
  entryCount: number;
  /**
   * Non-null → the logbook's earliest entry is dated AFTER this window
   * opened, so flying before that date is not in the figure. The page
   * prints this beside the number instead of presenting it as verified.
   */
  coverageGapFrom: string | null;
};

export type FlightTimeReportData =
  | {
      /** No logbook entries at all: there are no figures to state, and a
       *  page of 0.0s would be a claim, not an absence. */
      ok: false;
      reason: "empty-logbook";
    }
  | {
      ok: true;
      figures: FlightTimeFigure[];
      /** The logbook's earliest entry date — the start of what these
       *  figures can honestly cover. */
      earliestEntryDate: string;
    };

/**
 * Aircraft (non-simulator) hours of one entry — the same
 * greatest(total_time - simulator_time, 0) arithmetic as the
 * pilot.logbook_totals view (20260810150000), kept identical so this
 * report and the logbook screen can never disagree about what an entry
 * contributes. A box session is not flight time under 14 CFR 1.1 and
 * does not count toward 135.267.
 */
export function entryFlightHours(entry: FlightTimeEntry): number {
  return Math.max(entry.total_time - (entry.simulator_time ?? 0), 0);
}

/** Sums to one decimal, once, at the end — logbook times are tenths, and
 *  binary float dust from summing must not leak into a printed figure. */
function roundTenth(hours: number): number {
  return Math.round(hours * 10) / 10;
}

export function computeFlightTimeReport(
  entries: FlightTimeEntry[],
  windows: FlightTimeWindow[],
  /** The earliest entry_date in the WHOLE logbook (not just the fetched
   *  range) — coverage is a fact about the record, not the query. */
  earliestEntryDate: string | null
): FlightTimeReportData {
  if (earliestEntryDate === null) {
    return { ok: false, reason: "empty-logbook" };
  }

  const figures: FlightTimeFigure[] = windows.map((window) => {
    let hours = 0;
    let entryCount = 0;
    for (const entry of entries) {
      // ISO dates sort lexically, so string comparison is date comparison.
      if (entry.entry_date < window.from || entry.entry_date > window.to) {
        continue;
      }
      const flightHours = entryFlightHours(entry);
      // Simulator-only entries contribute 0 hours and are not counted as
      // entries either — "over N entries" should mean N flights.
      if (flightHours <= 0) continue;
      hours += flightHours;
      entryCount += 1;
    }
    return {
      window,
      hours: roundTenth(hours),
      entryCount,
      coverageGapFrom:
        earliestEntryDate > window.from ? earliestEntryDate : null,
    };
  });

  return { ok: true, figures, earliestEntryDate };
}

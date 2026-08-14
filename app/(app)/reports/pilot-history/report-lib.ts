/**
 * Pure computation for the pilot-history report — no I/O, no Supabase, no
 * Next imports, so tests/pilot-history.test.mjs can exercise it directly
 * (the same split as the flight-time and sales-tax reports' report-lib.ts).
 *
 * ===========================================================================
 * THE LINE THIS WHOLE FEATURE IS BUILT TO, verbatim, and it governs every
 * function below, every string the page renders, the PDF, and the CSV:
 *
 *     pure arithmetic over what the pilot logged and recorded; NO
 *     currency/legality conclusion anywhere, no 61.57 references in
 *     USER-FACING copy, no "current"/"qualified" wording.
 *
 * What that rules out, concretely, so nobody has to interpret it later:
 * no "you are current", no "you meet", no "you need N more", no
 * remaining-hours countdown, no red/green verdict on a figure, no
 * comparison of any total against any minimum — an operator's, an
 * underwriter's, or a regulation's. This module adds numbers up. Whether
 * those numbers are enough for anything is decided by the person reading
 * them under the certificate or the policy that governs, and never here.
 * The product's currency engine, which DOES reason about eligibility,
 * ships dark behind its own flag for exactly this reason
 * (docs/LAUNCH-GATES.md G1) — nothing in this file, the page, the PDF or
 * the CSV may reach around that gate by phrasing a verdict as a total.
 *
 * The sibling flight-time report draws the same line and states the
 * distinction it turns on: citing a regulation's own figures in page copy
 * is citation; comparing them to the pilot's totals is a verdict. This
 * report does not even cite — an underwriter's form is not a regulation,
 * and there is no rule to quote for "how much time do you have in the
 * 560?". So no CFR section number appears in anything a pilot sees here.
 * Where a column's MEANING comes from a reg, that belongs in a code
 * comment, and it stays in one.
 * ===========================================================================
 *
 * WHAT THE REPORT IS FOR. A contract pilot is asked for this document
 * several times a year and it is never quite the same form: an insurance
 * underwriter's pilot-history questionnaire before a policy or an
 * open-pilot endorsement, a management company's onboarding pack, a Part
 * 135 operator's pilot record, a chief pilot's phone call. They all ask
 * the same handful of things — total time, PIC and SIC, night, cross
 * country, instrument, time in make and model, time in the specific
 * airframe, turbine time, retractable-gear time, time in the last twelve
 * months, and the dates on the paperwork. The pilot answers them by
 * flipping through a logbook with a calculator, once per form, and every
 * form gets slightly different numbers.
 *
 * ---- HOW THE FIGURES ARE COMPUTED, and every choice that could be made
 * ---- another way, stated rather than buried.
 *
 * 1. AIRCRAFT TIME, NOT LOGGED TIME. A wholly-simulator session stores its
 *    hours in total_time (20260810020000's CHECK requires exactly that),
 *    so every "total" here is total_time MINUS simulator_time, floored at
 *    zero — byte-identical arithmetic to pilot.logbook_totals
 *    (20260810150000) and pilot.logbook_time_by_type, kept identical so
 *    this report and the logbook screen can never disagree about what an
 *    entry contributes. Simulator hours are reported on their own line and
 *    never added in. Every form asks for the two separately, because time
 *    in a box is not time in an aeroplane.
 *
 * 2. NOTHING IS EVER DROPPED. An entry whose ident matches no registered
 *    airframe still counts toward every total, and appears in the by-type
 *    and by-tail tables under an explicit "not matched to a registered
 *    aircraft" line rather than vanishing. A breakdown that silently
 *    understates a career is worse than no breakdown: the pilot copies it
 *    onto a form and signs it.
 *
 * 3. THE REGISTRY IS AN ANNOTATION, NEVER AN EDIT. Matching is done here,
 *    at read time, on the same normalised key pilot.aircraft.tail_key is
 *    generated with (tailKeyOf, one implementation — see
 *    lib/logbook-views.ts). pilot.logbook_entries holds what the pilot
 *    wrote and is not rewritten by anything in this feature.
 *
 * 4. THREE-STATE FLAGS STAY THREE-STATE. is_turbine and is_retractable are
 *    nullable on purpose and NULL means not recorded, never false. So a
 *    turbine figure is reported together with how many hours the fleet
 *    cannot answer for, and when NO airframe records the flag at all the
 *    figure is withheld entirely rather than printed as 0.0 — a confident
 *    zero on an underwriter's form is a worse answer than a blank one. The
 *    same rule governs category and class, which is free text and
 *    frequently empty.
 *
 * 5. A PARTIAL READ PRODUCES NO REPORT. Assembly refuses — see queries.ts.
 *    The figures on this page are transcribed onto a form and signed; a
 *    total short by whatever fell off the end of a paged read is the exact
 *    reassuring-number defect the whole house discipline exists to stop.
 *    An empty logbook likewise produces NO figures, never a page of 0.0s.
 */

import { tailKeyOf } from "@/lib/logbook-views";

// ---------------------------------------------------------------------------
// Calendar windows.
// ---------------------------------------------------------------------------

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const MONTH_ABBR = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
] as const;

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** Today as "YYYY-MM-DD" in UTC — calendar facts are UTC facts in this
 *  codebase (see parseCalendarDate's note in lib/format.ts). */
export function todayIso(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${pad2(now.getUTCMonth() + 1)}-${pad2(now.getUTCDate())}`;
}

export type ReportWindow = {
  key: "all-time" | "last-12-months" | "last-90-days";
  /** Inclusive "YYYY-MM-DD" bounds, compared lexically (ISO dates sort).
   *  `from: null` on the all-time window means "no lower bound at all",
   *  which is a different thing from "bounded at the earliest entry" — the
   *  latter would silently become wrong the moment an older entry is
   *  imported. */
  from: string | null;
  to: string;
  label: string;
};

/**
 * The last twelve calendar months, ending with the month `today` falls in.
 *
 * WHY CALENDAR MONTHS AND NOT A ROLLING 365 DAYS. Every form this report
 * exists to fill asks for "the last 12 months", and a pilot answering it
 * from a paper logbook counts months, not days. A rolling 365-day window
 * would also mean the figure changes every single day for entries that
 * did not move, which makes two printouts a week apart disagree for no
 * reason a reader could reconstruct.
 *
 * THE CURRENT MONTH IS INCLUDED, TO DATE. So the span is eleven complete
 * calendar months plus however much of this one has happened — and the
 * page and the PDF both print the actual date range beside the figure
 * rather than the phrase, because "the last 12 months" is exactly the kind
 * of label two people read two different ways. The alternative (twelve
 * COMPLETE months, ending last month) omits the pilot's most recent flying
 * from the figure most often used to judge recency, which is the wrong
 * direction to be wrong in.
 *
 * Month arithmetic is done in a flat month count so the year boundary is
 * not a special case: January 2026 correctly reaches back to February
 * 2025.
 */
export function lastTwelveCalendarMonths(today: string): ReportWindow {
  if (!ISO_DATE_RE.test(today)) {
    // A malformed clock read must not silently produce a nonsense window.
    throw new Error(`lastTwelveCalendarMonths: not an ISO date: ${today}`);
  }
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  const months = year * 12 + (month - 1) - 11;
  const fromYear = Math.floor(months / 12);
  const fromMonth = months - fromYear * 12;
  const from = `${fromYear}-${pad2(fromMonth + 1)}-01`;

  return {
    key: "last-12-months",
    from,
    to: today,
    label: `${MONTH_ABBR[fromMonth]} ${fromYear} to ${MONTH_ABBR[month - 1]} ${year}`,
  };
}

export function allTimeWindow(today: string): ReportWindow {
  if (!ISO_DATE_RE.test(today)) {
    throw new Error(`allTimeWindow: not an ISO date: ${today}`);
  }
  return { key: "all-time", from: null, to: today, label: "Everything on file" };
}

/**
 * The last 90 CALENDAR days, ending today (inclusive) — the third window
 * underwriter pilot-history questionnaires typically ask for alongside
 * last-12-months and all-time. Same to-date convention as
 * lastTwelveCalendarMonths: today counts as one of the 90, so the window
 * is [today - 89 days, today], and the page/PDF print the actual date
 * range beside the label for the same "two people would read the phrase
 * two different ways" reason lastTwelveCalendarMonths's header gives.
 *
 * Calendar days, not months — 90 days is the reg-adjacent unit these forms
 * use (see 61.57(a)'s own 90-day currency window), so shifting by whole
 * days rather than approximating with 3 calendar months keeps this exact
 * rather than off by a few days either way.
 */
export function lastNinetyCalendarDays(today: string): ReportWindow {
  if (!ISO_DATE_RE.test(today)) {
    throw new Error(`lastNinetyCalendarDays: not an ISO date: ${today}`);
  }
  const [y, m, d] = today.split("-").map(Number);
  const fromDate = new Date(Date.UTC(y!, m! - 1, d! - 89));
  const from = `${fromDate.getUTCFullYear()}-${pad2(fromDate.getUTCMonth() + 1)}-${pad2(fromDate.getUTCDate())}`;
  return { key: "last-90-days", from, to: today, label: "Last 90 days" };
}

function entryInWindow(entryDate: string, window: ReportWindow): boolean {
  // ISO dates sort lexically, so string comparison is date comparison.
  if (window.from !== null && entryDate < window.from) return false;
  return entryDate <= window.to;
}

// ---------------------------------------------------------------------------
// Inputs.
// ---------------------------------------------------------------------------

/** The columns read from pilot.logbook_entries. */
export type PilotHistoryEntry = {
  entry_date: string;
  /**
   * WHOSE FLYING THIS IS. 14 CFR 61.51 is a per-airman duty and
   * pilot.account_members can hold more than one seat, so an account is not
   * an airman (20260807050000). queries.ts admits this airman's rows and
   * unattributed ones and excludes another seat's at the SQL level —
   * exactly what it already does for documents. A NULL row is counted and
   * LABELLED rather than silently claimed; see
   * PilotHistoryReportData.unattributedEntryCount.
   */
  airman_user_id: string | null;
  aircraft_ident: string | null;
  aircraft_type: string | null;
  role: "PIC" | "SIC" | "SOLO" | "DUAL_RECEIVED" | null;
  total_time: number;
  pic_time: number | null;
  sic_time: number | null;
  solo_time: number | null;
  cross_country_time: number | null;
  night_time: number | null;
  instrument_actual_time: number | null;
  instrument_simulated_time: number | null;
  flight_instructor_time: number | null;
  dual_received_time: number | null;
  simulator_time: number | null;
  day_takeoffs: number | null;
  night_takeoffs: number | null;
  day_landings_full_stop: number | null;
  day_landings_touch_go: number | null;
  night_landings_full_stop: number | null;
  night_landings_touch_go: number | null;
};

/** The columns read from pilot.aircraft. */
export type PilotHistoryAircraft = {
  tail_number: string;
  tail_key: string;
  type_designator: string | null;
  type_rating: string | null;
  make_model: string | null;
  category_class: string | null;
  is_turbine: boolean | null;
  is_retractable: boolean | null;
};

/** The columns read from pilot.documents, already narrowed to the kinds
 *  that carry a date worth putting on a history form. */
export type PilotHistoryDocument = {
  kind: string;
  label: string;
  completed_on: string | null;
  issued_on: string | null;
  expires_on: string | null;
  /** NULL on the row means the document names no airman. See
   *  RecordedDate.attribution for why that is surfaced rather than
   *  resolved. */
  airman_user_id: string | null;
};

// ---------------------------------------------------------------------------
// Per-entry arithmetic.
// ---------------------------------------------------------------------------

function num(value: number | null | undefined): number {
  // logbookFrom() is typed `any` and numeric(4,1) can arrive as a string
  // from PostgREST; Number() here is the same coercion /logbook's page
  // already applies, so a string can never become `"1.2" + "3.4"`.
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Aircraft (non-simulator) hours of one entry — the same
 * greatest(total_time - simulator_time, 0) arithmetic as
 * pilot.logbook_totals, kept identical on purpose. greatest(...,0) because
 * an entry whose simulator time somehow exceeds its total must not
 * subtract from the career figure: a bad row costs its own hours, never
 * someone else's.
 */
export function aircraftHours(entry: PilotHistoryEntry): number {
  return Math.max(num(entry.total_time) - num(entry.simulator_time), 0);
}

/** Sums are rounded to one decimal ONCE, at the end — logbook times are
 *  tenths, and binary float dust from summing must not reach a printed
 *  figure or a form. */
function roundTenth(hours: number): number {
  return Math.round(hours * 10) / 10;
}

// ---------------------------------------------------------------------------
// Hour blocks.
// ---------------------------------------------------------------------------

export type HoursBlock = {
  entryCount: number;
  /** AIRCRAFT time. Simulator hours are never in here. */
  total: number;
  pic: number;
  sic: number;
  solo: number;
  dualReceived: number;
  instructorGiven: number;
  crossCountry: number;
  night: number;
  instrumentActual: number;
  instrumentSimulated: number;
  /** Its own figure, on its own line, never folded into `total`. */
  simulator: number;
  dayTakeoffs: number;
  nightTakeoffs: number;
  dayLandingsFullStop: number;
  dayLandingsTouchGo: number;
  nightLandingsFullStop: number;
  nightLandingsTouchGo: number;
};

const ZERO_BLOCK: HoursBlock = {
  entryCount: 0,
  total: 0,
  pic: 0,
  sic: 0,
  solo: 0,
  dualReceived: 0,
  instructorGiven: 0,
  crossCountry: 0,
  night: 0,
  instrumentActual: 0,
  instrumentSimulated: 0,
  simulator: 0,
  dayTakeoffs: 0,
  nightTakeoffs: 0,
  dayLandingsFullStop: 0,
  dayLandingsTouchGo: 0,
  nightLandingsFullStop: 0,
  nightLandingsTouchGo: 0,
};

function emptyBlock(): HoursBlock {
  return { ...ZERO_BLOCK };
}

function addEntry(block: HoursBlock, entry: PilotHistoryEntry): void {
  block.entryCount += 1;
  block.total += aircraftHours(entry);
  block.pic += num(entry.pic_time);
  block.sic += num(entry.sic_time);
  block.solo += num(entry.solo_time);
  block.dualReceived += num(entry.dual_received_time);
  block.instructorGiven += num(entry.flight_instructor_time);
  block.crossCountry += num(entry.cross_country_time);
  block.night += num(entry.night_time);
  block.instrumentActual += num(entry.instrument_actual_time);
  block.instrumentSimulated += num(entry.instrument_simulated_time);
  block.simulator += num(entry.simulator_time);
  block.dayTakeoffs += num(entry.day_takeoffs);
  block.nightTakeoffs += num(entry.night_takeoffs);
  block.dayLandingsFullStop += num(entry.day_landings_full_stop);
  block.dayLandingsTouchGo += num(entry.day_landings_touch_go);
  block.nightLandingsFullStop += num(entry.night_landings_full_stop);
  block.nightLandingsTouchGo += num(entry.night_landings_touch_go);
}

function roundBlock(block: HoursBlock): HoursBlock {
  return {
    entryCount: block.entryCount,
    total: roundTenth(block.total),
    pic: roundTenth(block.pic),
    sic: roundTenth(block.sic),
    solo: roundTenth(block.solo),
    dualReceived: roundTenth(block.dualReceived),
    instructorGiven: roundTenth(block.instructorGiven),
    crossCountry: roundTenth(block.crossCountry),
    night: roundTenth(block.night),
    instrumentActual: roundTenth(block.instrumentActual),
    instrumentSimulated: roundTenth(block.instrumentSimulated),
    simulator: roundTenth(block.simulator),
    dayTakeoffs: block.dayTakeoffs,
    nightTakeoffs: block.nightTakeoffs,
    dayLandingsFullStop: block.dayLandingsFullStop,
    dayLandingsTouchGo: block.dayLandingsTouchGo,
    nightLandingsFullStop: block.nightLandingsFullStop,
    nightLandingsTouchGo: block.nightLandingsTouchGo,
  };
}

/** Every landing however it ended — the headline count. The full-stop
 *  split is preserved above and is a different question. */
export function totalLandings(block: HoursBlock): number {
  return (
    block.dayLandingsFullStop +
    block.dayLandingsTouchGo +
    block.nightLandingsFullStop +
    block.nightLandingsTouchGo
  );
}

export function totalTakeoffs(block: HoursBlock): number {
  return block.dayTakeoffs + block.nightTakeoffs;
}

/** Actual + simulated, summed HERE and only here, for a form that asks for
 *  one instrument figure. The two stay separate everywhere else. */
export function totalInstrument(block: HoursBlock): number {
  return roundTenth(block.instrumentActual + block.instrumentSimulated);
}

// ---------------------------------------------------------------------------
// Breakdowns.
// ---------------------------------------------------------------------------

export const UNSPECIFIED_LABEL = "Unspecified";
export const UNMATCHED_LABEL = "Not matched to a registered aircraft";

export type BreakdownRow = {
  label: string;
  /** Secondary line — make and model for a tail row, nothing for the rest. */
  sublabel: string | null;
  entryCount: number;
  total: number;
  pic: number;
  sic: number;
  night: number;
  simulator: number;
  /** Most recent date with real aircraft time. A registered airframe that
   *  has only ever been sat in a simulator session does not get one. */
  lastFlownOn: string | null;
  /** True when at least ONE entry in this row was flown in an airframe on
   *  file. False means none was, and the row is labelled accordingly. */
  registered: boolean;
  /** How many of this row's entries matched no registered airframe. A row
   *  can be registered AND hold unmatched entries — a type flown in a
   *  fleet aeroplane and in one whose registration was typed wrong is one
   *  row — so the two facts are reported separately rather than one
   *  standing in for the other. */
  unmatchedEntryCount: number;
};

type Accumulator = {
  label: string;
  sublabel: string | null;
  block: HoursBlock;
  lastFlownOn: string | null;
  registered: boolean;
  unmatchedEntryCount: number;
  /** Sort tiebreaker so equal-hours rows come out in a stable order rather
   *  than in whatever order the entries happened to be read in. */
  sortKey: string;
};

/** What ONE entry contributes to its bucket's provenance. */
type Provenance = {
  /** Did this entry's ident resolve to an airframe in the fleet. */
  registered: boolean;
  /** The secondary line this entry can offer — only ever read off a
   *  registry row, so an unmatched entry contributes none. */
  sublabel: string | null;
};

/**
 * PROVENANCE IS A PROPERTY OF THE BUCKET, NEVER OF WHICHEVER ENTRY LANDED
 * IN IT FIRST. Buckets mix: one type label can hold hours flown in a fleet
 * aeroplane and hours logged against an ident that matches nothing (a
 * typo'd registration, an aeroplane flown before it was added). Seeding
 * `registered` and `sublabel` from the first arrival made both an accident
 * of read order — entries are read date-ascending, so one mistyped ident on
 * an old entry would stamp "not matched to a registered aircraft" on a type
 * that IS in the fleet and drop its make and model, and the reverse order
 * would hide that unmatched hours were folded in. Both are false claims on
 * a page a pilot transcribes onto a signed form. So `registered` is an OR
 * across every contributing entry, `sublabel` is taken from the first entry
 * that actually resolved to a registry row, and the unmatched entries are
 * COUNTED so a mixed row can say so.
 */
function accumulate(
  map: Map<string, Accumulator>,
  key: string,
  seed: () => { label: string; sortKey: string },
  entry: PilotHistoryEntry,
  provenance: Provenance
): void {
  let bucket = map.get(key);
  if (!bucket) {
    bucket = {
      ...seed(),
      sublabel: null,
      registered: false,
      unmatchedEntryCount: 0,
      block: emptyBlock(),
      lastFlownOn: null,
    };
    map.set(key, bucket);
  }
  if (provenance.registered) {
    bucket.registered = true;
    if (bucket.sublabel === null && provenance.sublabel !== null) {
      bucket.sublabel = provenance.sublabel;
    }
  } else {
    bucket.unmatchedEntryCount += 1;
  }
  addEntry(bucket.block, entry);
  if (aircraftHours(entry) > 0) {
    if (bucket.lastFlownOn === null || entry.entry_date > bucket.lastFlownOn) {
      bucket.lastFlownOn = entry.entry_date;
    }
  }
}

function toRows(map: Map<string, Accumulator>): BreakdownRow[] {
  return [...map.values()]
    .map((bucket) => ({
      label: bucket.label,
      sublabel: bucket.sublabel,
      entryCount: bucket.block.entryCount,
      total: roundTenth(bucket.block.total),
      pic: roundTenth(bucket.block.pic),
      sic: roundTenth(bucket.block.sic),
      night: roundTenth(bucket.block.night),
      simulator: roundTenth(bucket.block.simulator),
      lastFlownOn: bucket.lastFlownOn,
      registered: bucket.registered,
      unmatchedEntryCount: bucket.unmatchedEntryCount,
      sortKey: bucket.sortKey,
    }))
    // Most hours first, then alphabetical — the order a pilot reads a
    // history form's make-and-model table in.
    .sort((a, b) => (b.total - a.total) || a.sortKey.localeCompare(b.sortKey))
    .map(({ sortKey: _sortKey, ...row }) => row);
}

// ---------------------------------------------------------------------------
// Equipment flags (turbine, retractable gear).
// ---------------------------------------------------------------------------

/**
 * Hours in airframes the fleet records a given flag TRUE for, together
 * with everything that figure cannot speak for.
 *
 * THE THREE-STATE RULE MADE VISIBLE. `hours` alone would be a lie by
 * omission on a form: it counts only airframes somebody annotated, and a
 * pilot who has annotated three of their twelve would copy a number that
 * is confidently short and has no way to notice. So the shortfall travels
 * with the figure, and when NOTHING in the fleet records the flag the
 * report withholds the number entirely rather than printing 0.0.
 */
export type FlaggedHours = {
  /** Aircraft hours in airframes recorded as TRUE for this flag. */
  hours: number;
  /**
   * Aircraft hours this figure cannot speak for: flown in an airframe that
   * is not in the fleet, or in one whose flag was left unrecorded.
   */
  unrecordedHours: number;
  /** Registered airframes that record the flag either way. ZERO means
   *  `hours` is meaningless and must not be rendered as a figure. */
  aircraftRecording: number;
};

export function flagIsAnswerable(figure: FlaggedHours): boolean {
  return figure.aircraftRecording > 0;
}

// ---------------------------------------------------------------------------
// Recorded dates.
// ---------------------------------------------------------------------------

/**
 * A date the PILOT ENTERED, carried with the fact that they entered it.
 *
 * PROVENANCE IS NOT DECORATION HERE. pilot.documents stores whatever date
 * the pilot typed and this product derives NO expiry from any issue date —
 * a house rule with its own long explanation in
 * app/(app)/documents/kinds.ts. So every date on this report is captioned
 * as recorded by the pilot, and nothing on it may read as though it came
 * from the FAA, a registry, an operator, or an examiner. The credential
 * packet takes the identical field-by-field posture.
 */
export type RecordedDate = {
  kind: string;
  label: string;
  /** When the event happened, for the kinds that record one. */
  completedOn: string | null;
  /** What is printed on the certificate, for the kinds that record one. */
  issuedOn: string | null;
  /** Whatever the pilot typed. NEVER computed from the two above. */
  expiresOn: string | null;
  /**
   * Whose document this is.
   *
   * "you" — the row names the signed-in airman.
   * "unattributed" — the row names nobody. Every document written before
   *   pilot.documents grew an airman column reads this way, so excluding
   *   these would empty the section for essentially every existing
   *   account; including them silently would let a second seat's medical
   *   appear on this pilot's history. Shown, and labelled, is the only
   *   honest third option.
   *
   * A row naming a DIFFERENT airman never reaches this type — queries.ts
   * filters it out before assembly.
   */
  attribution: "you" | "unattributed";
};

/**
 * The kinds that carry a date a history form asks about, in the order the
 * report prints them. Anything else on file (passports, W-9s, insurance
 * certificates, aircraft paperwork) is deliberately absent: this section is
 * the airman's own credentials, and a report that swept in every document
 * would put the pilot's passport number's neighbours on an underwriter's
 * desk.
 */
export const RECORDED_DATE_KINDS = [
  "medical",
  "flight_review",
  "pic_proficiency_check",
  "certificate",
] as const;

const KIND_ORDER = new Map<string, number>(
  RECORDED_DATE_KINDS.map((kind, index) => [kind, index])
);

// ---------------------------------------------------------------------------
// The report.
// ---------------------------------------------------------------------------

export type PilotHistoryFigures = {
  window: ReportWindow;
  hours: HoursBlock;
  byCategoryClass: BreakdownRow[];
  byType: BreakdownRow[];
  byTail: BreakdownRow[];
  turbine: FlaggedHours;
  retractable: FlaggedHours;
  /**
   * True when every by-category row is the "Unspecified" bucket — i.e. the
   * fleet records no category and class at all. The section is then
   * withheld with a sentence instead of shown as one meaningless row.
   */
  categoryClassUnrecorded: boolean;
};

export type PilotHistoryReportData =
  | {
      /** No logbook entries at all. There are no figures to state, and a
       *  page of 0.0s would be a claim rather than an absence. */
      ok: false;
      reason: "empty-logbook";
    }
  | {
      ok: true;
      /** The date the report was compiled — printed on it, because a
       *  pilot-history figure without an as-of date is unreadable a month
       *  later. */
      compiledOn: string;
      allTime: PilotHistoryFigures;
      lastTwelveMonths: PilotHistoryFigures;
      /** Last 90 calendar days, to date — see lastNinetyCalendarDays. */
      lastNinetyDays: PilotHistoryFigures;
      /**
       * The span the figures actually cover — the earliest and latest
       * entry that WAS COUNTED, not the earliest and latest on file. The
       * two differ only when the logbook holds a future-dated entry, and
       * conflating them would caption a total with a span it does not
       * include.
       */
      earliestEntryDate: string;
      latestEntryDate: string;
      /**
       * Entries dated after today, which every window excludes — flying
       * that has not happened must not appear in a figure someone signs.
       * Reported rather than silently skipped: it is almost always a typed
       * year, and the pilot is the only person who can fix it.
       */
      futureDatedEntryCount: number;
      /**
       * Counted entries that name NO airman.
       *
       * queries.ts admits this airman's rows and unattributed ones, and
       * excludes another seat's — the same three-way posture the recorded
       * dates take, for the same reason: pilot.logbook_entries.airman_user_id
       * was not backfilled on multi-member accounts (20260807050000), so
       * excluding unattributed rows would silently drop a career, and
       * claiming them silently would put a colleague's hours under one
       * airman's name. They are counted, included, and SAID OUT LOUD.
       * Zero on a single-seat account, which is every account today.
       */
      unattributedEntryCount: number;
      /** Registered airframes with no logged hours at all — reported so the
       *  fleet list and this report cannot appear to disagree. */
      registeredAircraftCount: number;
      recordedDates: RecordedDate[];
      /** True when at least one recorded date names no airman. The page
       *  and the PDF caption the section accordingly. */
      hasUnattributedDates: boolean;
    };

function buildFigures(
  entries: PilotHistoryEntry[],
  byTailKey: Map<string, PilotHistoryAircraft>,
  window: ReportWindow
): PilotHistoryFigures {
  const hours = emptyBlock();
  const categoryMap = new Map<string, Accumulator>();
  const typeMap = new Map<string, Accumulator>();
  const tailMap = new Map<string, Accumulator>();

  let turbineHours = 0;
  let turbineUnrecorded = 0;
  let retractHours = 0;
  let retractUnrecorded = 0;

  for (const entry of entries) {
    if (!entryInWindow(entry.entry_date, window)) continue;

    addEntry(hours, entry);

    const identKey = tailKeyOf(entry.aircraft_ident ?? "");
    const aircraft = identKey === "" ? undefined : byTailKey.get(identKey);
    const registered = aircraft !== undefined;
    const flightHours = aircraftHours(entry);

    // -- Category and class. Free text on the registry row, so it is
    //    trimmed but never re-spelled: "AMEL" and "Multi-Engine Land" stay
    //    two rows here, because collapsing them would mean guessing they
    //    mean the same thing.
    const categoryLabel =
      aircraft?.category_class?.trim() || UNSPECIFIED_LABEL;
    accumulate(
      categoryMap,
      categoryLabel,
      () => ({ label: categoryLabel, sortKey: categoryLabel }),
      entry,
      { registered, sublabel: null }
    );

    // -- Type. THE VIEW'S OWN COALESCE, character for character
    //    (pilot.logbook_time_by_type): FAA type rating first, because one
    //    CE-500 rating spans seven Citation models that ICAO splits five
    //    ways, then the ICAO designator, then whatever the pilot typed on
    //    the entry itself, then Unspecified. A report that grouped
    //    differently from the panel the pilot clicked through from would be
    //    a discrepancy they could not explain to an underwriter.
    const typeLabel =
      aircraft?.type_rating?.trim() ||
      aircraft?.type_designator?.trim() ||
      entry.aircraft_type?.trim() ||
      UNSPECIFIED_LABEL;
    accumulate(
      typeMap,
      typeLabel,
      () => ({ label: typeLabel, sortKey: typeLabel }),
      entry,
      { registered, sublabel: aircraft?.make_model?.trim() || null }
    );

    // -- Tail. Registered airframes are keyed and labelled from the
    //    REGISTRY (so three spellings of one registration are one row);
    //    everything else lands in a single explicit remainder row rather
    //    than being dropped or being given a row per spelling, which would
    //    put the pilot's own typos on an underwriter's desk.
    if (aircraft) {
      accumulate(
        tailMap,
        identKey,
        () => ({ label: aircraft.tail_number, sortKey: aircraft.tail_number }),
        entry,
        {
          registered: true,
          sublabel:
            aircraft.make_model?.trim() ||
            aircraft.type_rating?.trim() ||
            aircraft.type_designator?.trim() ||
            null,
        }
      );
    } else {
      accumulate(
        tailMap,
        ` unmatched`,
        () => ({
          label: UNMATCHED_LABEL,
          // Sorts last among equal totals; it is a remainder, not an
          // airframe.
          sortKey: "￿",
        }),
        entry,
        { registered: false, sublabel: null }
      );
    }

    // -- Equipment flags. `undefined` (no registry row) and `null` (a row
    //    that leaves the flag unrecorded) both land in `unrecorded`: the
    //    pilot flew those hours, and the fleet cannot say what in.
    if (aircraft?.is_turbine === true) turbineHours += flightHours;
    else if (aircraft?.is_turbine !== false) turbineUnrecorded += flightHours;

    if (aircraft?.is_retractable === true) retractHours += flightHours;
    else if (aircraft?.is_retractable !== false) retractUnrecorded += flightHours;
  }

  // Counted over the WHOLE FLEET, not over the entries in this window: the
  // question "does your fleet record this at all" is a fact about the
  // registry, and answering it from a twelve-month slice would withhold a
  // figure on the last-12-months table that the all-time table prints.
  let turbineRecording = 0;
  let retractRecording = 0;
  for (const aircraft of byTailKey.values()) {
    if (aircraft.is_turbine !== null) turbineRecording += 1;
    if (aircraft.is_retractable !== null) retractRecording += 1;
  }

  const byCategoryClass = toRows(categoryMap);

  return {
    window,
    hours: roundBlock(hours),
    byCategoryClass,
    byType: toRows(typeMap),
    byTail: toRows(tailMap),
    turbine: {
      hours: roundTenth(turbineHours),
      unrecordedHours: roundTenth(turbineUnrecorded),
      aircraftRecording: turbineRecording,
    },
    retractable: {
      hours: roundTenth(retractHours),
      unrecordedHours: roundTenth(retractUnrecorded),
      aircraftRecording: retractRecording,
    },
    // One row that is the Unspecified bucket is not a breakdown, it is the
    // total wearing a label. Same judgement /logbook already makes about
    // its hours-by-type panel.
    categoryClassUnrecorded:
      byCategoryClass.length === 0 ||
      byCategoryClass.every((row) => row.label === UNSPECIFIED_LABEL),
  };
}

/**
 * A document row → the report's own shape, or null when the row carries no
 * date at all. A credential with no dates on it says nothing a history
 * form wants and would just be a name in a table.
 */
function toRecordedDate(
  document: PilotHistoryDocument,
  sessionUserId: string
): RecordedDate | null {
  if (
    document.completed_on === null &&
    document.issued_on === null &&
    document.expires_on === null
  ) {
    return null;
  }
  return {
    kind: document.kind,
    label: document.label,
    completedOn: document.completed_on,
    issuedOn: document.issued_on,
    expiresOn: document.expires_on,
    attribution:
      document.airman_user_id === sessionUserId ? "you" : "unattributed",
  };
}

/**
 * Everything the report renders, from three reads and a clock.
 *
 * `entries` must be the COMPLETE set for the account — queries.ts pages to
 * completeness or refuses, and this function has no way to tell a short
 * read from a small logbook. That contract is the whole reason the loader
 * refuses rather than warns.
 */
export function computePilotHistoryReport(
  entries: PilotHistoryEntry[],
  aircraft: PilotHistoryAircraft[],
  documents: PilotHistoryDocument[],
  sessionUserId: string,
  today: string
): PilotHistoryReportData {
  if (entries.length === 0) {
    return { ok: false, reason: "empty-logbook" };
  }

  const byTailKey = new Map<string, PilotHistoryAircraft>();
  for (const row of aircraft) {
    // Keyed on the registry's own generated key where present, and
    // re-normalised from the registration otherwise so a hand-built
    // fixture and a real row behave identically.
    const key = row.tail_key?.trim() || tailKeyOf(row.tail_number ?? "");
    if (key !== "") byTailKey.set(key, row);
  }

  // COMPUTED OVER THE COUNTED SET, not over every row. Both windows close
  // at `today`, so a future-dated entry contributes to no figure — and
  // letting it set latestEntryDate would print "your logbook runs to
  // 12 Mar 2027" above totals that stop at today.
  let earliestEntryDate: string | null = null;
  let latestEntryDate: string | null = null;
  let futureDatedEntryCount = 0;
  let unattributedEntryCount = 0;
  for (const entry of entries) {
    if (entry.entry_date > today) {
      futureDatedEntryCount += 1;
      continue;
    }
    // Same test as a document's attribution, on purpose: anything that is
    // not positively this airman's is unattributed, never assumed.
    if (entry.airman_user_id !== sessionUserId) unattributedEntryCount += 1;
    if (earliestEntryDate === null || entry.entry_date < earliestEntryDate) {
      earliestEntryDate = entry.entry_date;
    }
    if (latestEntryDate === null || entry.entry_date > latestEntryDate) {
      latestEntryDate = entry.entry_date;
    }
  }
  // Every entry on file is dated in the future. There is nothing to state
  // — the same answer as an empty logbook, for the same reason: a figure
  // here would be a claim about flying that has not happened.
  if (earliestEntryDate === null || latestEntryDate === null) {
    return { ok: false, reason: "empty-logbook" };
  }

  const recordedDates = documents
    .map((document) => toRecordedDate(document, sessionUserId))
    .filter((date): date is RecordedDate => date !== null)
    .sort((a, b) => {
      const orderA = KIND_ORDER.get(a.kind) ?? RECORDED_DATE_KINDS.length;
      const orderB = KIND_ORDER.get(b.kind) ?? RECORDED_DATE_KINDS.length;
      if (orderA !== orderB) return orderA - orderB;
      return a.label.localeCompare(b.label);
    });

  return {
    ok: true,
    compiledOn: today,
    allTime: buildFigures(entries, byTailKey, allTimeWindow(today)),
    lastTwelveMonths: buildFigures(
      entries,
      byTailKey,
      lastTwelveCalendarMonths(today)
    ),
    lastNinetyDays: buildFigures(entries, byTailKey, lastNinetyCalendarDays(today)),
    earliestEntryDate,
    latestEntryDate,
    futureDatedEntryCount,
    unattributedEntryCount,
    registeredAircraftCount: byTailKey.size,
    recordedDates,
    hasUnattributedDates: recordedDates.some(
      (date) => date.attribution === "unattributed"
    ),
  };
}

// ---------------------------------------------------------------------------
// THE CAVEATS, DEFINED ONCE.
//
// Each of these qualifies a figure, and a figure travels: the PDF is
// emailed to an underwriter and the CSV is forwarded again from there,
// both without the screen around them. A caveat the page shows and the
// downloads do not is not a smaller version of the same report — it is a
// document that reads as complete while omitting the one sentence that
// explains why it disagrees with the pilot's own logbook screen. So the
// wording lives here, beside the arithmetic it qualifies, exactly as
// compiledFromFooter does, and the three surfaces render the same string.
// ---------------------------------------------------------------------------

/**
 * Entries dated after today. They are in the logbook and in none of these
 * figures — almost always a mistyped year, and the pilot is the only person
 * who can reconcile the two.
 */
export function futureDatedNote(count: number): string | null {
  if (count <= 0) return null;
  return count === 1
    ? "1 entry is dated after today and is not counted in any figure here. Check its date in your logbook."
    : `${count} entries are dated after today and are not counted in any figure here. Check their dates in your logbook.`;
}

/**
 * Counted entries that name no airman — see
 * PilotHistoryReportData.unattributedEntryCount. Zero on a single-seat
 * account, so this sentence appears only where it is actually true.
 */
export function unattributedEntriesNote(count: number): string | null {
  if (count <= 0) return null;
  return count === 1
    ? "1 entry counted here names no airman. It is included rather than dropped. On an account with more than one pilot, it may not be this airman's."
    : `${count} entries counted here name no airman. They are included rather than dropped. On an account with more than one pilot, some of them may not be this airman's.`;
}

/**
 * The hours a flagged figure cannot speak for, PER WINDOW.
 *
 * The all-time shortfall alone was ambiguous beside a last-12-months
 * figure: a pilot copying "turbine time, last 12 months" onto a form got a
 * caveat quantifying a different window's hours. The recent window's own
 * shortfall is a subset of the all-time one, so both are stated and which
 * is which is named.
 */
export function unrecordedHoursNote(
  allTime: FlaggedHours,
  recent: FlaggedHours
): string | null {
  if (allTime.unrecordedHours <= 0) return null;
  const all = allTime.unrecordedHours.toFixed(1);
  const window =
    recent.unrecordedHours > 0
      ? ` (${recent.unrecordedHours.toFixed(1)} of them in the last 12 months)`
      : "";
  return `${all} hours all time${window} are not counted either way. They were flown in an aircraft that is not on file, or in one where this is not recorded.`;
}

/**
 * A breakdown row that holds hours from airframes on file AND hours that
 * matched none. See BreakdownRow.unmatchedEntryCount.
 */
export function mixedProvenanceNote(row: BreakdownRow): string | null {
  if (!row.registered || row.unmatchedEntryCount <= 0) return null;
  return row.unmatchedEntryCount === 1
    ? "includes 1 entry not matched to an aircraft on file"
    : `includes ${row.unmatchedEntryCount} entries not matched to an aircraft on file`;
}

/**
 * THE NEUTRAL FOOTER. One sentence, on the page, in the PDF and in the
 * CSV, and nothing else — it states where the numbers came from and makes
 * no claim about what they mean. Defined once so the three surfaces cannot
 * drift, and assembled from lib/brand.ts because the product name is a
 * brand string with exactly one origin (scripts/verify-tokens.mjs enforces
 * that mechanically).
 */
export function compiledFromFooter(productName: string): string {
  return `Compiled from your logbook and document records in ${productName}.`;
}

import test from "node:test";
import assert from "node:assert/strict";

const {
  lastTwelveCalendarMonths,
  lastNinetyCalendarDays,
  allTimeWindow,
  aircraftHours,
  totalInstrument,
  totalLandings,
  totalTakeoffs,
  flagIsAnswerable,
  computePilotHistoryReport,
  compiledFromFooter,
  futureDatedNote,
  mixedProvenanceNote,
  unattributedEntriesNote,
  unrecordedHoursNote,
  UNSPECIFIED_LABEL,
  UNMATCHED_LABEL,
} = await import("../app/(app)/reports/pilot-history/report-lib.ts");

/**
 * The pilot-history report's pure core. All fixtures synthetic.
 *
 * What carries weight here:
 * 1. CALENDAR-MONTH WINDOW EDGES. The last-12-months figure is the one an
 *    underwriter reads for recency, and its boundary is a calendar month,
 *    not 365 days — so the year boundary, month lengths and leap day all
 *    have to fall exactly where the definition says.
 * 2. SIMULATOR TIME IS NEVER AIRCRAFT TIME, using the same
 *    greatest(total - sim, 0) arithmetic as pilot.logbook_totals, so this
 *    report and the logbook screen cannot disagree.
 * 3. NOTHING IS DROPPED. An entry matching no registered airframe still
 *    counts toward every total and appears in a labelled remainder row.
 * 4. THREE-STATE FLAGS STAY THREE-STATE. A fleet that records nothing
 *    about turbine or retractable gear yields a WITHHELD figure, never a
 *    0.0 that reads as an answer.
 * 5. HONEST DEGRADATION: an empty logbook produces no figures at all.
 * 6. NO VERDICT WORDING anywhere in the module's own strings.
 */

const SESSION_USER = "11111111-1111-1111-1111-111111111111";
const OTHER_USER = "22222222-2222-2222-2222-222222222222";

function entry(overrides = {}) {
  return {
    entry_date: "2026-08-01",
    // Whose flying this is. queries.ts admits this airman's rows and the
    // ones naming nobody, so the default fixture is the signed-in airman's.
    airman_user_id: SESSION_USER,
    aircraft_ident: "N447SP",
    aircraft_type: "C560",
    role: "PIC",
    total_time: 2.5,
    pic_time: 2.5,
    sic_time: null,
    solo_time: null,
    cross_country_time: null,
    night_time: null,
    instrument_actual_time: null,
    instrument_simulated_time: null,
    flight_instructor_time: null,
    dual_received_time: null,
    simulator_time: null,
    day_takeoffs: 1,
    night_takeoffs: 0,
    day_landings_full_stop: 1,
    day_landings_touch_go: 0,
    night_landings_full_stop: 0,
    night_landings_touch_go: 0,
    ...overrides,
  };
}

function aircraft(overrides = {}) {
  return {
    tail_number: "N447SP",
    tail_key: "N447SP",
    type_designator: "C560",
    type_rating: "CE-500",
    make_model: "Cessna 560 Citation V",
    category_class: "AMEL",
    is_turbine: null,
    is_retractable: null,
    ...overrides,
  };
}

function report(entries, fleet = [], documents = [], today = "2026-08-13") {
  return computePilotHistoryReport(entries, fleet, documents, SESSION_USER, today);
}

// ---------------------------------------------------------------------------
// 1. Calendar-month window edges.
// ---------------------------------------------------------------------------

test("the last-12-months window opens on the first of the month eleven months back", () => {
  const window = lastTwelveCalendarMonths("2026-08-13");
  assert.equal(window.from, "2025-09-01");
  assert.equal(window.to, "2026-08-13");
  assert.equal(window.label, "Sep 2025 to Aug 2026");
});

test("the window crosses the year boundary without a special case", () => {
  // January: eleven months back is February of the PREVIOUS year.
  assert.equal(lastTwelveCalendarMonths("2026-01-01").from, "2025-02-01");
  assert.equal(lastTwelveCalendarMonths("2026-01-31").from, "2025-02-01");
  // December: eleven months back is January of the SAME year.
  assert.equal(lastTwelveCalendarMonths("2026-12-31").from, "2026-01-01");
});

test("the window opens on the 1st regardless of month length or a leap day", () => {
  // 29 Feb in a leap year, and a 31-day month reaching back into a 28-day one.
  assert.equal(lastTwelveCalendarMonths("2028-02-29").from, "2027-03-01");
  assert.equal(lastTwelveCalendarMonths("2026-03-31").from, "2025-04-01");
  assert.equal(lastTwelveCalendarMonths("2026-07-31").from, "2025-08-01");
});

test("the window is inclusive at BOTH edges, to the day", () => {
  const onOpeningDay = entry({ entry_date: "2025-09-01", total_time: 1.0 });
  const dayBefore = entry({ entry_date: "2025-08-31", total_time: 4.0 });
  const today = entry({ entry_date: "2026-08-13", total_time: 2.0 });
  const tomorrow = entry({ entry_date: "2026-08-14", total_time: 8.0 });

  const data = report([dayBefore, onOpeningDay, today, tomorrow]);
  assert.equal(data.ok, true);
  // 1.0 + 2.0 — the day before the window opens and the day after it
  // closes are both outside.
  assert.equal(data.lastTwelveMonths.hours.total, 3.0);
  // All-time has no lower bound at all, but is still capped at today: a
  // future-dated entry is not flying that has happened.
  assert.equal(data.allTime.hours.total, 7.0);
});

test("the last-90-days window is 90 calendar days inclusive of today", () => {
  const window = lastNinetyCalendarDays("2026-08-13");
  // 2026-08-13 minus 89 days = 2026-05-16 — 90 days total, today included.
  assert.equal(window.from, "2026-05-16");
  assert.equal(window.to, "2026-08-13");
  assert.equal(window.key, "last-90-days");
});

test("the 90-day window crosses a year boundary without a special case", () => {
  assert.equal(lastNinetyCalendarDays("2026-01-15").from, "2025-10-18");
});

test("the 90-day figure threads through computePilotHistoryReport and is inclusive at both edges", () => {
  const onOpeningDay = entry({ entry_date: "2026-05-16", total_time: 1.0 });
  const dayBefore = entry({ entry_date: "2026-05-15", total_time: 4.0 });
  const today = entry({ entry_date: "2026-08-13", total_time: 2.0 });

  const data = report([dayBefore, onOpeningDay, today]);
  assert.equal(data.ok, true);
  // The day before the 90-day window opens is excluded; the opening day
  // and today are both included.
  assert.equal(data.lastNinetyDays.hours.total, 3.0);
  assert.equal(data.lastNinetyDays.window.key, "last-90-days");
});

test("a malformed clock read throws rather than producing a nonsense window", () => {
  assert.throws(() => lastTwelveCalendarMonths("13-08-2026"));
  assert.throws(() => lastNinetyCalendarDays("13-08-2026"));
  assert.throws(() => allTimeWindow(""));
});

// ---------------------------------------------------------------------------
// 2. Simulator time is never aircraft time.
// ---------------------------------------------------------------------------

test("aircraftHours subtracts simulator time and floors at zero", () => {
  assert.equal(aircraftHours(entry({ total_time: 2.5, simulator_time: null })), 2.5);
  assert.equal(aircraftHours(entry({ total_time: 2.5, simulator_time: 1.0 })), 1.5);
  // A wholly-simulator session: hours live in total_time per the schema's
  // own CHECK, and contribute no aircraft time.
  assert.equal(aircraftHours(entry({ total_time: 1.8, simulator_time: 1.8 })), 0);
  // A bad row costs its own hours, never someone else's.
  assert.equal(aircraftHours(entry({ total_time: 1.0, simulator_time: 4.0 })), 0);
});

test("a simulator session is reported on its own line and never in the total", () => {
  const data = report([
    entry({ total_time: 2.0, simulator_time: null }),
    entry({ entry_date: "2026-08-02", total_time: 4.0, simulator_time: 4.0, role: null, pic_time: null }),
  ]);
  assert.equal(data.ok, true);
  assert.equal(data.allTime.hours.total, 2.0);
  assert.equal(data.allTime.hours.simulator, 4.0);
});

// ---------------------------------------------------------------------------
// Rounding happens once, at the end.
// ---------------------------------------------------------------------------

test("tenths sum exactly — no binary float dust reaches a printed figure", () => {
  const entries = Array.from({ length: 10 }, (_, i) =>
    entry({ entry_date: `2026-08-0${(i % 9) + 1}`, total_time: 0.1, pic_time: 0.1 })
  );
  const data = report(entries);
  assert.equal(data.ok, true);
  assert.equal(data.allTime.hours.total, 1.0);
  assert.equal(data.allTime.hours.pic, 1.0);
});

// ---------------------------------------------------------------------------
// 3. Nothing is dropped.
// ---------------------------------------------------------------------------

test("an entry matching no registered airframe still counts, in a labelled row", () => {
  const data = report(
    [
      entry({ aircraft_ident: "N447SP", total_time: 3.0 }),
      entry({ entry_date: "2026-08-02", aircraft_ident: "N999ZZ", aircraft_type: "BE40", total_time: 2.0 }),
    ],
    [aircraft()]
  );
  assert.equal(data.ok, true);
  // Both entries are in the headline total.
  assert.equal(data.allTime.hours.total, 5.0);

  const unmatched = data.allTime.byTail.find((row) => row.label === UNMATCHED_LABEL);
  assert.ok(unmatched, "unmatched hours get their own explicit row");
  assert.equal(unmatched.total, 2.0);
  assert.equal(unmatched.registered, false);

  const registered = data.allTime.byTail.find((row) => row.label === "N447SP");
  assert.equal(registered.total, 3.0);
  assert.equal(registered.registered, true);
});

test("three spellings of one registration are one airframe, not three", () => {
  const data = report(
    [
      entry({ aircraft_ident: "N447SP", total_time: 1.0 }),
      entry({ entry_date: "2026-08-02", aircraft_ident: "N-447SP", total_time: 1.0 }),
      entry({ entry_date: "2026-08-03", aircraft_ident: "n447sp", total_time: 1.0 }),
    ],
    [aircraft()]
  );
  assert.equal(data.ok, true);
  assert.equal(data.allTime.byTail.length, 1);
  assert.equal(data.allTime.byTail[0].label, "N447SP");
  assert.equal(data.allTime.byTail[0].total, 3.0);
});

test("type grouping prefers the FAA rating over the ICAO designator", () => {
  // One CE-500 rating spans models ICAO splits apart — the whole reason
  // pilot.logbook_time_by_type groups on type_rating first.
  const data = report(
    [
      entry({ aircraft_ident: "N447SP", aircraft_type: "C560", total_time: 2.0 }),
      entry({ entry_date: "2026-08-02", aircraft_ident: "N100AB", aircraft_type: "C550", total_time: 3.0 }),
    ],
    [
      aircraft({ tail_number: "N447SP", tail_key: "N447SP" }),
      aircraft({
        tail_number: "N100AB",
        tail_key: "N100AB",
        type_designator: "C550",
        make_model: "Cessna 550 Citation II",
      }),
    ]
  );
  assert.equal(data.ok, true);
  assert.equal(data.allTime.byType.length, 1);
  assert.equal(data.allTime.byType[0].label, "CE-500");
  assert.equal(data.allTime.byType[0].total, 5.0);
});

test("an unregistered entry is grouped under what the pilot typed, then Unspecified", () => {
  const data = report([
    entry({ aircraft_ident: "N999ZZ", aircraft_type: "BE40", total_time: 1.0 }),
    entry({ entry_date: "2026-08-02", aircraft_ident: "N888YY", aircraft_type: null, total_time: 2.0 }),
  ]);
  assert.equal(data.ok, true);
  const labels = data.allTime.byType.map((row) => row.label).sort();
  assert.deepEqual(labels, ["BE40", UNSPECIFIED_LABEL]);
});

test("a bucket's provenance is an OR over its entries, not its first arrival", () => {
  // The registered C560 plus one older entry whose ident was typed wrong
  // but whose type was not — both land in the C560 bucket. Entries are read
  // date-ascending, so the typo'd one seeds it, and that used to stamp "no
  // aircraft on file" on a type that IS in the fleet and drop its make and
  // model.
  const data = report(
    [
      entry({ entry_date: "2019-04-02", aircraft_ident: "N44SP", total_time: 1.0 }),
      entry({ entry_date: "2026-08-01", aircraft_ident: "N447SP", total_time: 2.0 }),
    ],
    [aircraft({ type_rating: null })]
  );
  assert.equal(data.ok, true);
  const row = data.allTime.byType.find((r) => r.label === "C560");
  assert.ok(row, "both entries group under the one type label");
  assert.equal(row.registered, true);
  assert.equal(row.sublabel, "Cessna 560 Citation V");
  // And the unmatched entry is not hidden by that: it is counted.
  assert.equal(row.unmatchedEntryCount, 1);
  assert.equal(row.entryCount, 2);
  assert.equal(
    mixedProvenanceNote(row),
    "includes 1 entry not matched to an aircraft on file"
  );
});

test("a row with no registered airframe behind it stays labelled as such", () => {
  const data = report(
    [entry({ aircraft_ident: "N999ZZ", aircraft_type: "BE40", total_time: 1.0 })],
    [aircraft()]
  );
  const row = data.allTime.byType.find((r) => r.label === "BE40");
  assert.equal(row.registered, false);
  assert.equal(row.unmatchedEntryCount, 1);
  // The badge already says it; the mixed note must not say it twice.
  assert.equal(mixedProvenanceNote(row), null);
});

test("last flown ignores a session in a box", () => {
  const data = report(
    [
      entry({ entry_date: "2026-06-01", total_time: 2.0 }),
      // Later date, but wholly simulator: the airframe did not move.
      entry({
        entry_date: "2026-08-10",
        total_time: 4.0,
        simulator_time: 4.0,
        role: null,
        pic_time: null,
      }),
    ],
    [aircraft()]
  );
  assert.equal(data.ok, true);
  assert.equal(data.allTime.byTail[0].lastFlownOn, "2026-06-01");
});

// ---------------------------------------------------------------------------
// 4. Three-state flags.
// ---------------------------------------------------------------------------

test("a fleet that records nothing about turbine WITHHOLDS the figure", () => {
  const data = report([entry({ total_time: 3.0 })], [aircraft({ is_turbine: null })]);
  assert.equal(data.ok, true);
  assert.equal(flagIsAnswerable(data.allTime.turbine), false);
  assert.equal(flagIsAnswerable(data.allTime.retractable), false);
  // The hours are still accounted for — as unanswerable, not as zero.
  assert.equal(data.allTime.turbine.unrecordedHours, 3.0);
});

test("turbine hours count only recorded-true airframes, and the shortfall travels with them", () => {
  const data = report(
    [
      entry({ aircraft_ident: "N447SP", total_time: 3.0 }),
      entry({ entry_date: "2026-08-02", aircraft_ident: "N100AB", total_time: 2.0 }),
      entry({ entry_date: "2026-08-03", aircraft_ident: "N222CC", total_time: 1.0 }),
      // Not in the fleet at all.
      entry({ entry_date: "2026-08-04", aircraft_ident: "N999ZZ", total_time: 4.0 }),
    ],
    [
      aircraft({ tail_number: "N447SP", tail_key: "N447SP", is_turbine: true, is_retractable: true }),
      aircraft({ tail_number: "N100AB", tail_key: "N100AB", is_turbine: false, is_retractable: true }),
      // Recorded for retract, silent on turbine.
      aircraft({ tail_number: "N222CC", tail_key: "N222CC", is_turbine: null, is_retractable: false }),
    ]
  );
  assert.equal(data.ok, true);
  assert.equal(flagIsAnswerable(data.allTime.turbine), true);
  assert.equal(data.allTime.turbine.hours, 3.0);
  // 1.0 on the airframe that stays silent + 4.0 on the one not on file.
  // The 2.0 recorded FALSE is answered, not unrecorded.
  assert.equal(data.allTime.turbine.unrecordedHours, 5.0);

  assert.equal(data.allTime.retractable.hours, 5.0);
  assert.equal(data.allTime.retractable.unrecordedHours, 4.0);
});

test("a flag stays answerable on the 12-month table even when nothing recent was flown in it", () => {
  // The "does the fleet record this at all" question is a fact about the
  // registry, not about a twelve-month slice — otherwise the two tables
  // would disagree about whether a figure exists.
  const data = report(
    [entry({ entry_date: "2019-05-01", total_time: 3.0 })],
    [aircraft({ is_turbine: true })]
  );
  assert.equal(data.ok, true);
  assert.equal(flagIsAnswerable(data.lastTwelveMonths.turbine), true);
  assert.equal(data.lastTwelveMonths.turbine.hours, 0);
  assert.equal(data.allTime.turbine.hours, 3.0);
});

test("category and class is withheld when no airframe records one", () => {
  const withNothing = report([entry()], [aircraft({ category_class: null })]);
  assert.equal(withNothing.allTime.categoryClassUnrecorded, true);

  const withOne = report([entry()], [aircraft({ category_class: "AMEL" })]);
  assert.equal(withOne.allTime.categoryClassUnrecorded, false);
  assert.equal(withOne.allTime.byCategoryClass[0].label, "AMEL");
});

// ---------------------------------------------------------------------------
// Derived display figures.
// ---------------------------------------------------------------------------

test("instrument total is actual plus simulated, summed once", () => {
  const data = report([
    entry({ instrument_actual_time: 1.2, instrument_simulated_time: 0.6 }),
  ]);
  assert.equal(data.allTime.hours.instrumentActual, 1.2);
  assert.equal(data.allTime.hours.instrumentSimulated, 0.6);
  assert.equal(totalInstrument(data.allTime.hours), 1.8);
});

test("landings and takeoffs count every kind", () => {
  const data = report([
    entry({
      day_takeoffs: 2,
      night_takeoffs: 1,
      day_landings_full_stop: 1,
      day_landings_touch_go: 3,
      night_landings_full_stop: 2,
      night_landings_touch_go: 1,
    }),
  ]);
  assert.equal(totalTakeoffs(data.allTime.hours), 3);
  assert.equal(totalLandings(data.allTime.hours), 7);
});

test("numeric columns arriving as strings still add up", () => {
  // logbookFrom() is typed `any` and PostgREST can hand back numeric(4,1)
  // as a string; `+` would concatenate.
  const data = report([
    entry({ total_time: "2.5", pic_time: "2.5" }),
    entry({ entry_date: "2026-08-02", total_time: "1.5", pic_time: "1.5" }),
  ]);
  assert.equal(data.allTime.hours.total, 4.0);
  assert.equal(data.allTime.hours.pic, 4.0);
});

// ---------------------------------------------------------------------------
// 5. Honest degradation.
// ---------------------------------------------------------------------------

test("an empty logbook produces NO figures, never a page of zeroes", () => {
  const data = report([]);
  assert.equal(data.ok, false);
  assert.equal(data.reason, "empty-logbook");
});

test("earliest and latest entry dates bound what the figures can claim", () => {
  const data = report([
    entry({ entry_date: "2026-08-05" }),
    entry({ entry_date: "2011-02-19" }),
    entry({ entry_date: "2020-12-31" }),
  ]);
  assert.equal(data.earliestEntryDate, "2011-02-19");
  assert.equal(data.latestEntryDate, "2026-08-05");
  assert.equal(data.futureDatedEntryCount, 0);
});

test("a future-dated entry sets no coverage date and is counted separately", () => {
  // Almost always a mistyped year. It contributes to no figure, so it must
  // not caption one either: "your logbook runs to Mar 2027" printed above
  // totals that stop at today is a span the figures do not include.
  const data = report([
    entry({ entry_date: "2026-08-05", total_time: 2.0 }),
    entry({ entry_date: "2027-03-12", total_time: 9.9 }),
  ]);
  assert.equal(data.ok, true);
  assert.equal(data.latestEntryDate, "2026-08-05");
  assert.equal(data.allTime.hours.total, 2.0);
  assert.equal(data.futureDatedEntryCount, 1);
});

test("a logbook that is ENTIRELY future-dated states no figures at all", () => {
  const data = report([entry({ entry_date: "2030-01-01", total_time: 5.0 })]);
  assert.equal(data.ok, false);
  assert.equal(data.reason, "empty-logbook");
});

test("an entry naming no airman is counted and SAID, never claimed silently", () => {
  // queries.ts admits this airman's rows and unattributed ones; the column
  // was never backfilled on multi-member accounts, so dropping these would
  // delete a career and adopting them silently would put a colleague's
  // hours under one airman's name.
  const data = report([
    entry({ total_time: 2.0 }),
    entry({ entry_date: "2026-08-02", airman_user_id: null, total_time: 3.0 }),
  ]);
  assert.equal(data.ok, true);
  assert.equal(data.allTime.hours.total, 5.0);
  assert.equal(data.unattributedEntryCount, 1);
  assert.match(unattributedEntriesNote(1), /names no airman/);
  assert.equal(unattributedEntriesNote(0), null);
  // A single-seat account — every row attributed — says nothing at all.
  assert.equal(report([entry()]).unattributedEntryCount, 0);
});

test("the caveats that qualify a figure are one string, for every surface", () => {
  // The page, the PDF and the CSV all render these. A caveat the screen
  // shows and the downloads do not is a document that reads as complete
  // while omitting the sentence explaining why it disagrees with the
  // pilot's own logbook screen.
  assert.equal(futureDatedNote(0), null);
  assert.match(futureDatedNote(1), /^1 entry is dated after today/);
  assert.match(futureDatedNote(3), /^3 entries are dated after today/);

  // The shortfall names its window: an unlabelled all-time figure beside a
  // last-12-months one qualifies a number the reader is not looking at.
  const answerable = { hours: 10, unrecordedHours: 12.5, aircraftRecording: 2 };
  const recent = { hours: 4, unrecordedHours: 3, aircraftRecording: 2 };
  const note = unrecordedHoursNote(answerable, recent);
  assert.match(note, /12\.5 hours all time/);
  assert.match(note, /3\.0 of them in the last 12 months/);
  // Nothing recent to qualify → no second clause invented.
  assert.doesNotMatch(
    unrecordedHoursNote(answerable, { ...recent, unrecordedHours: 0 }),
    /last 12 months/
  );
  assert.equal(
    unrecordedHoursNote({ ...answerable, unrecordedHours: 0 }, recent),
    null
  );
});

// ---------------------------------------------------------------------------
// Recorded dates and their provenance.
// ---------------------------------------------------------------------------

test("a document naming this airman is attributed; one naming nobody is flagged", () => {
  const data = report(
    [entry()],
    [],
    [
      {
        kind: "medical",
        label: "First class medical",
        completed_on: "2026-03-02",
        issued_on: null,
        expires_on: "2027-03-31",
        airman_user_id: SESSION_USER,
      },
      {
        kind: "flight_review",
        label: "Flight review",
        completed_on: "2025-08-15",
        issued_on: null,
        expires_on: null,
        airman_user_id: null,
      },
    ]
  );
  assert.equal(data.recordedDates.length, 2);
  assert.equal(data.recordedDates[0].kind, "medical");
  assert.equal(data.recordedDates[0].attribution, "you");
  assert.equal(data.recordedDates[1].attribution, "unattributed");
  assert.equal(data.hasUnattributedDates, true);
});

test("a document with no dates at all is not listed", () => {
  const data = report(
    [entry()],
    [],
    [
      {
        kind: "certificate",
        label: "Commercial certificate",
        completed_on: null,
        issued_on: null,
        expires_on: null,
        airman_user_id: SESSION_USER,
      },
    ]
  );
  assert.equal(data.recordedDates.length, 0);
  assert.equal(data.hasUnattributedDates, false);
});

test("a row belonging to another seat is never attributed to this airman", () => {
  // queries.ts excludes these at the SQL level; if one ever reaches the
  // pure layer it must not be claimed as the session user's.
  const data = report(
    [entry()],
    [],
    [
      {
        kind: "medical",
        label: "Someone else's medical",
        completed_on: "2026-01-01",
        issued_on: null,
        expires_on: null,
        airman_user_id: OTHER_USER,
      },
    ]
  );
  assert.equal(data.recordedDates[0].attribution, "unattributed");
});

// ---------------------------------------------------------------------------
// 6. The legal line, asserted mechanically.
// ---------------------------------------------------------------------------

test("the neutral footer is exactly the one approved sentence", () => {
  assert.equal(
    compiledFromFooter("Widget"),
    "Compiled from your logbook and document records in Widget."
  );
});

test("no label the module emits carries verdict or currency wording", () => {
  // The figures this report states must never read as a conclusion about
  // eligibility. This asserts it over every string the pure layer
  // produces, so a well-meant label added later trips a test rather than
  // shipping onto an underwriter's form.
  const data = report(
    [entry({ aircraft_ident: "N999ZZ" }), entry({ entry_date: "2026-08-02" })],
    [aircraft({ is_turbine: true, is_retractable: false })],
    [
      {
        kind: "medical",
        label: "First class medical",
        completed_on: "2026-03-02",
        issued_on: null,
        expires_on: "2027-03-31",
        airman_user_id: SESSION_USER,
      },
    ]
  );

  const strings = [
    data.allTime.window.label,
    data.lastTwelveMonths.window.label,
    ...data.allTime.byType.map((row) => `${row.label} ${row.sublabel ?? ""}`),
    ...data.allTime.byTail.map((row) => `${row.label} ${row.sublabel ?? ""}`),
    ...data.allTime.byCategoryClass.map((row) => row.label),
    ...data.recordedDates.map((row) => row.label),
    compiledFromFooter("Widget"),
    // The caveat sentences too — they travel on the PDF and the CSV, which
    // is exactly where a well-meant verdict would do the most damage.
    futureDatedNote(2),
    unattributedEntriesNote(2),
    unrecordedHoursNote(
      { hours: 1, unrecordedHours: 2, aircraftRecording: 1 },
      { hours: 1, unrecordedHours: 1, aircraftRecording: 1 }
    ),
    ...data.allTime.byType.map((row) => mixedProvenanceNote(row) ?? ""),
  ].join(" | ");

  for (const banned of [
    /\bcurrent\b/i,
    /\bcurrency\b/i,
    /\bqualified\b/i,
    /\beligible\b/i,
    /\bcompliant\b/i,
    /\bmeets\b/i,
    /\b61\.\d+/,
    /\b135\.\d+/,
    /\b14 CFR\b/i,
  ]) {
    assert.equal(
      banned.test(strings),
      false,
      `report-lib emitted a string matching ${banned}: ${strings}`
    );
  }
});

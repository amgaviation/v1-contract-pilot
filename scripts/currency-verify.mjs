#!/usr/bin/env node
/**
 * Phase 7 verification — the currency engine (lib/currency/**) and its
 * database contract (supabase/migrations/20260811040000_currency_snapshots.sql).
 *
 * TWO HALVES, ONE SCRIPT, because the engine is two things wearing one
 * name: a pure TypeScript rules library with no database of its own, and
 * an append-only snapshot table that library writes into once a screen
 * exists. Testing only one half would miss the other's failure mode.
 *
 * HALF A — table-driven pure fixtures, run against the REAL lib/currency/*.ts
 * sources via scripts/lib/ts-extensionless-loader.mjs (the same loader
 * scripts/foreflight-import-verify.mjs uses to run real .ts parser code).
 * No database, no mocks: window.ts, match.ts, general.ts, night.ts,
 * instrument.ts, flight-review.ts, medical.ts, part135.ts, index.ts and
 * describe.ts are imported and called directly, exactly as
 * lib/currency/read.ts calls them. gate.ts is imported too, under
 * `--conditions=react-server` — the "server-only" package throws
 * unconditionally when required outside a Next.js Server Component build,
 * and that condition is the documented way to make its exports resolve to
 * its no-op stub instead, letting isCurrencyEngineEnabled() and
 * assertCurrencyEngineEnabled() run as the pure functions they are without
 * pretending to be inside Next.
 *
 * HALF B — the snapshot table's DATABASE contract: RLS, column-scoped
 * grants, and the five CHECK constraints that keep a bad row from ever
 * reaching a pilot's screen. Replayed from the real migrations onto a
 * scratch database, driven as the real `authenticated` role with a real
 * auth.uid(), inside transactions that roll back. This is
 * scripts/aircraft-verify.mjs's harness, reused verbatim (same psql/
 * asTenant/asAdmin/refuses/equals shape, same bootstrap contract) — read
 * that file's header for the reasoning behind every structural choice
 * here. Same two failure modes it names:
 *   1. Treating "no rows" as proof of isolation. Every positive read
 *      asserts the row it expects is PRESENT, so a query returning
 *      nothing for the wrong reason fails instead of passing quietly.
 *   2. Treating "an error happened" as proof of a refusal. Every negative
 *      case names a SPECIFIC SQLSTATE. A misspelled column must never
 *      read as a control working.
 *
 * TWO NON-NEGOTIABLES THIS SCRIPT EXISTS TO PIN, specifically because the
 * feature is gated on counsel review and a silent default-on or a
 * disclaimer-less row are the two ways that gate gets defeated by accident:
 *   1. THE FLAG IS OFF BY DEFAULT. See the "GATE" section of Half A —
 *      isCurrencyEngineEnabled() with no env var set, and every documented
 *      wrong-spelling pitfall from gate.ts's own comment, must all read
 *      OFF, and assertCurrencyEngineEnabled() must throw. Combined with
 *      the read.ts structural check just below it (assertCurrencyEngineEnabled()
 *      is the first statement in every exported I/O function) and S-9
 *      through S-17's grant/RLS tests, this is the chain that keeps a
 *      flag-off deploy from ever writing a snapshot or computing an answer.
 *   2. limitations IS NEVER SEPARATED FROM THE NUMBER. See the read.ts
 *      source check (every row recordSnapshots builds carries
 *      `limitations: CURRENCY_DISCLAIMER`) and S-1/S-2 (the database CHECK
 *      that makes NOT NULL alone insufficient, since '' is not null).
 *      Two independent layers on purpose — if a future edit deletes the
 *      TypeScript line, the CHECK still stops the row; if a future
 *      migration drops the CHECK, the source-check still catches it.
 *
 * All fixtures are synthetic. No live pilot data, ever.
 *
 *   npm run currency:verify
 *
 * Half B needs a local Postgres and CURRENCY_VERIFY_BOOTSTRAP set to the
 * Supabase-shaped scaffold (roles anon/authenticated/service_role, schema
 * auth with auth.uid(), an extensions schema, a storage stub) — same
 * contract as AIRCRAFT_VERIFY_BOOTSTRAP / ESTIMATES_VERIFY_BOOTSTRAP.
 * Half A needs neither and always runs. CURRENCY_VERIFY_URL overrides the
 * default admin connection (postgresql://postgres@127.0.0.1:55432/postgres).
 */
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, rmSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";

const REPO_ROOT = new URL("..", import.meta.url).pathname;

let totalPassed = 0;
let totalFailed = 0;
// SEC-3: Half B (every database-contract assertion — CHECK constraints, RLS refusals,
// cross-tenant isolation) returns early with a plain `return` when there is no bootstrap,
// and that early return does not fail anything, so the final line must say so unmistakably
// itself rather than let a bootstrap-less run print an unqualified "passed".
let halfBSkipped = false;

// =============================================================================
// HALF A — the pure engine, run against its real .ts sources.
// =============================================================================

function runHalfA() {
  console.log("=== Half A: lib/currency/** (pure, no database) ===\n");

  const work = mkdtempSync(join(tmpdir(), "currency-verify-"));
  const runnerPath = join(work, "run.mts");
  writeFileSync(runnerPath, buildRunnerSource(), "utf8");

  const loaderUrl = pathToFileURL(join(REPO_ROOT, "scripts/lib/ts-extensionless-loader.mjs")).href;
  const run = spawnSync(
    process.execPath,
    // --conditions=react-server: see this file's header. Applies to every
    // import in the runner, not only gate.ts's — harmless for the others,
    // none of which branch on package export conditions.
    ["--experimental-strip-types", "--conditions=react-server", "--import", loaderUrl, runnerPath],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }
  );
  rmSync(work, { recursive: true, force: true });

  if (run.status === null) {
    console.log("Half A FAILED — the runner crashed rather than exiting:");
    console.log(String(run.stderr ?? "").slice(0, 4000));
    totalFailed += 1;
    return;
  }
  console.log(run.stdout);
  if (run.status !== 0 && !/##HALF_A_SUMMARY##/.test(run.stdout)) {
    // A crash before the summary line printed — surface stderr, since
    // otherwise this reads as "0 checks ran" instead of "the runner broke."
    console.log(String(run.stderr ?? "").slice(0, 4000));
  }

  const m = /##HALF_A_SUMMARY## passed=(\d+) failed=(\d+)/.exec(run.stdout);
  if (!m) {
    console.log("Half A FAILED — no summary line, the runner did not complete.");
    totalFailed += 1;
    return;
  }
  totalPassed += Number(m[1]);
  totalFailed += Number(m[2]);

  // ---------------------------------------------------------------------
  // Source-level checks for the two non-negotiables, on the parts of
  // lib/currency that cannot be exercised without a live Supabase project
  // (read.ts's exported functions need Next.js request context — see the
  // implementer's own risk note). These are text checks, not type checks:
  // a future edit that quietly deletes the wiring below is exactly what
  // they exist to catch, and they fail loudly if it happens.
  // ---------------------------------------------------------------------
  console.log("Source checks — read.ts's I/O wiring (cannot run without a live Supabase project)");
  checkReadTsWiring();
  console.log("");
}

function ok(label) {
  totalPassed++;
  console.log(`  ok    ${label}`);
}
function bad(label, detail) {
  totalFailed++;
  console.log(`  FAIL  ${label}${detail ? `\n          ${detail}` : ""}`);
}

function checkReadTsWiring() {
  const readSrc = readFileSync(join(REPO_ROOT, "lib/currency/read.ts"), "utf8");
  const brandSrc = readFileSync(join(REPO_ROOT, "lib/brand.ts"), "utf8");

  const disclaimerMatch = /export const CURRENCY_DISCLAIMER =\s*\n?\s*"([^"]+)"/.exec(brandSrc);
  if (disclaimerMatch && disclaimerMatch[1].trim().length > 0) {
    ok("lib/brand.ts exports a non-blank CURRENCY_DISCLAIMER");
  } else {
    bad("lib/brand.ts exports a non-blank CURRENCY_DISCLAIMER", "could not find or the value is blank — recordSnapshots has nothing real to attach");
  }

  // Non-negotiable #2: every row recordSnapshots() builds carries the
  // disclaimer under this exact key. A future edit that renames the
  // column mapping, or that builds the row from `describeResult()`
  // instead, silently drops the disclaimer while the DB's NOT NULL/CHECK
  // still passes (a DIFFERENT non-blank string would satisfy them) — so
  // this source check is the layer that actually pins THIS string to
  // THAT column, which S-1/S-2 cannot do on their own.
  if (readSrc.includes("limitations: CURRENCY_DISCLAIMER")) {
    ok("recordSnapshots() maps every row's limitations to lib/brand.ts's CURRENCY_DISCLAIMER");
  } else {
    bad(
      "recordSnapshots() maps every row's limitations to lib/brand.ts's CURRENCY_DISCLAIMER",
      "the literal `limitations: CURRENCY_DISCLAIMER` is not in lib/currency/read.ts — the disclaimer may have been separated from the write path"
    );
  }

  // Non-negotiable #1's other half: the gate must be the FIRST thing each
  // exported I/O function does, not a check the function gets around to
  // eventually after already reaching Supabase. Sliced per function body
  // so a gate call anywhere else in the file (e.g. a comment, or a
  // different function) cannot make this pass for the wrong reason.
  for (const fnName of ["loadCurrencyInput", "recordSnapshots"]) {
    const fnStart = readSrc.indexOf(`export async function ${fnName}(`);
    if (fnStart === -1) {
      bad(`${fnName}() exists in lib/currency/read.ts`, "function not found");
      continue;
    }
    const nextFnStart = readSrc.indexOf("export async function ", fnStart + 1);
    const body = readSrc.slice(fnStart, nextFnStart === -1 ? undefined : nextFnStart);
    const gateAt = body.indexOf("assertCurrencyEngineEnabled();");
    const firstIoAt = Math.min(
      ...["createClient(", "requireAccount(", ".insert(", ".select("]
        .map((needle) => body.indexOf(needle))
        .filter((i) => i !== -1)
    );
    if (gateAt === -1) {
      bad(`${fnName}() calls assertCurrencyEngineEnabled()`, "not found in the function body — this is a routing/import bug waiting to happen, per gate.ts's own comment");
    } else if (Number.isFinite(firstIoAt) && gateAt > firstIoAt) {
      bad(`${fnName}() checks the flag before touching Supabase`, `assertCurrencyEngineEnabled() appears at offset ${gateAt}, after the first I/O call at offset ${firstIoAt}`);
    } else {
      ok(`${fnName}() checks the flag before any Supabase call`);
    }
  }
}

function buildRunnerSource() {
  const p = (rel) => JSON.stringify(join(REPO_ROOT, rel));
  return [
    'import { rollingDayWindow, calendarMonthLookback, calendarMonthThroughDate, addDays, addMonths, rollingMonthWindow, isWellFormedIsoDate } from ' + p("lib/currency/window.ts") + ";",
    'import { evaluateGeneralExperience } from ' + p("lib/currency/general.ts") + ";",
    'import { evaluateNightExperience } from ' + p("lib/currency/night.ts") + ";",
    'import { evaluateInstrumentExperience } from ' + p("lib/currency/instrument.ts") + ";",
    'import { evaluateFlightReview } from ' + p("lib/currency/flight-review.ts") + ";",
    'import { evaluateMedical } from ' + p("lib/currency/medical.ts") + ";",
    'import { evaluatePart135Recency } from ' + p("lib/currency/part135.ts") + ";",
    'import { evaluateCurrency, InvalidAsOfDateError } from ' + p("lib/currency/index.ts") + ";",
    'import { describeResult } from ' + p("lib/currency/describe.ts") + ";",
    'import { isCurrencyEngineEnabled, assertCurrencyEngineEnabled, CURRENCY_FLAG_ENV } from ' + p("lib/currency/gate.ts") + ";",
    "",
    RUNNER_BODY,
  ].join("\n");
}

// ---------------------------------------------------------------------------
// The runner body. Plain JS (no TS-only syntax needed beyond what the
// imports above already require) so this string needs no escaping beyond
// what JSON.stringify already handled for the import paths above.
// ---------------------------------------------------------------------------
const RUNNER_BODY = `
var passed = 0;
var failed = 0;
function ok(label) { passed++; console.log("  ok    " + label); }
function bad(label, detail) { failed++; console.log("  FAIL  " + label + (detail ? ("\\n          " + detail) : "")); }

function checkField(rowId, field, actual, expected) {
  var a = JSON.stringify(actual);
  var e = JSON.stringify(expected);
  if (a === e) { ok(rowId + " " + field); }
  else { bad(rowId + " " + field, "expected " + e + " got " + a); }
}

function sortedIds(arr) { return arr.slice().sort(); }

var allResults = [];   // every CurrencyResult produced anywhere below, for D-15/17/18/M-4's sweeps
var allCurrencyRuns = []; // every evaluateCurrency() 5-tuple, for D-15's "always five, in order"

function track(result) { allResults.push(result); return result; }
function trackRun(results) { allCurrencyRuns.push(results); return results; }

function checkResult(rowId, why, actual, expect) {
  track(actual);
  if (expect.status !== undefined) checkField(rowId, "status (" + why + ")", actual.status, expect.status);
  if (expect.ruleBasis !== undefined) checkField(rowId, "ruleBasis", actual.ruleBasis, expect.ruleBasis);
  if (expect.window !== undefined) checkField(rowId, "window", actual.window, expect.window);
  if (expect.throughDate !== undefined) checkField(rowId, "throughDate", actual.throughDate, expect.throughDate);
  if (expect.limitingDate !== undefined) checkField(rowId, "limitingDate", actual.limitingDate, expect.limitingDate);
  if (expect.displayDate !== undefined) checkField(rowId, "displayDate", actual.displayDate, expect.displayDate);
  if (expect.observed !== undefined) {
    for (var k in expect.observed) checkField(rowId, "observed." + k, actual.observed[k], expect.observed[k]);
  }
  if (expect.countedIds !== undefined) {
    checkField(rowId, "counted (entry ids, order-insensitive)", sortedIds(actual.counted.map(function (c) { return c.entryId; })), sortedIds(expect.countedIds));
  }
  if (expect.missing !== undefined) checkField(rowId, "missing", actual.missing, expect.missing);
  if (expect.notesInclude) {
    var joined = actual.notes.join(" | ");
    expect.notesInclude.forEach(function (s) {
      if (joined.indexOf(s) !== -1) ok(rowId + ' notes include "' + s + '"');
      else bad(rowId + ' notes include "' + s + '"', "notes were: " + JSON.stringify(actual.notes));
    });
  }
  return actual;
}

function section(title) { console.log("\\n" + title); }

var ASOF = "2026-08-07";
var AIRMAN = "11111111-1111-1111-1111-111111111111";
var OTHER_AIRMAN = "22222222-2222-2222-2222-222222222222";

var N1V = { tailKey: "N1V", typeRating: "CE-500", typeDesignator: "C560", categoryClass: "AMEL", gear: "tricycle" };
var N2V = { tailKey: "N2V", typeRating: "CE-500", typeDesignator: "C560", categoryClass: "AMEL", gear: "tailwheel" };
var N3V = { tailKey: "N3V", typeRating: "CE-500", typeDesignator: "C560", categoryClass: "AMEL", gear: null };
var N4V = { tailKey: "N4V", typeRating: "BE-40", typeDesignator: "BE40", categoryClass: "AMEL", gear: "tricycle" };
var N5V = { tailKey: "N5V", typeRating: "CE-500", typeDesignator: "C550", categoryClass: "AMEL", gear: "tricycle" };
var N1V_ASEL = { tailKey: "N1V", typeRating: "CE-500", typeDesignator: "C560", categoryClass: "ASEL", gear: "tricycle" };
// Same category/class/type as N2V (the tailwheel fixture above) — isolates
// REGU-1/REGU-2's gear-only defect from a category/type mismatch, which
// A-11/A-12/A-13 above already cover.
var N2V_TRI = { tailKey: "N2VT", typeRating: "CE-500", typeDesignator: "C560", categoryClass: "AMEL", gear: "tricycle" };
var N2V_NULLGEAR = { tailKey: "N2VN", typeRating: "CE-500", typeDesignator: "C560", categoryClass: "AMEL", gear: null };
// P1: a blank-typeRating intended aircraft — no verify fixture exercised
// this alongside more than one entry before this pass, which is precisely
// why the third review round's critical finding shipped green through 492
// checks and 200 tests.
var NBLANK = { tailKey: "NBL", typeRating: null, typeDesignator: "PA28", categoryClass: "ASEL", gear: "tricycle" };
var NBLANK_SAME = { tailKey: "NBL2", typeRating: null, typeDesignator: "PA28", categoryClass: "ASEL", gear: "tricycle" };
var NBLANK_DIFF = { tailKey: "NBL3", typeRating: null, typeDesignator: "C172", categoryClass: "ASEL", gear: "tricycle" };
var NHELI = { tailKey: "NHEL", typeRating: null, typeDesignator: "B407", categoryClass: "HELICOPTER", gear: "skid" };

function mkEntry(id, overrides) {
  var base = {
    id: id,
    entryDate: "2026-06-01",
    airmanUserId: AIRMAN,
    role: "PIC",
    soleManipulator: true,
    dayTakeoffs: 0,
    nightTakeoffs: 0,
    dayLandingsFullStop: 0,
    dayLandingsTouchGo: 0,
    nightLandingsFullStop: 0,
    nightLandingsTouchGo: 0,
    nightWindowAsserted: null,
    nightTime: null,
    approachesCount: 0,
    approachType: null,
    approachCondition: null,
    holds: 0,
    coursesInterceptedTracked: false,
    simulatorTime: null,
    simulatorDeviceType: null,
    aircraft: N1V,
  };
  return Object.assign(base, overrides || {});
}

function threeDated(prefix, dates, overrides) {
  return dates.map(function (d, i) { return mkEntry(prefix + "-" + i, Object.assign({ entryDate: d }, overrides || {})); });
}

function baseCurrencyInput(overrides) {
  return Object.assign({
    asOf: ASOF,
    airmanUserId: AIRMAN,
    intendedAircraft: N1V,
    operatingRule: "part_91",
    exemptionAsserted: false,
    flightReviewCompletedOn: "2024-08-15",
    medicalExpiresOn: null,
    entries: [],
  }, overrides || {});
}

// =============================================================================
// GATE — the flag is off by default. NON-NEGOTIABLE #1.
// =============================================================================
section("GATE — CURRENCY_ENGINE_ENABLED reads OFF by default and by every documented pitfall spelling");
{
  delete process.env[CURRENCY_FLAG_ENV];
  checkField("GATE-1", "isCurrencyEngineEnabled() with the var unset", isCurrencyEngineEnabled(), false);
  var threwUnset = false;
  try { assertCurrencyEngineEnabled(); } catch (e) { threwUnset = e instanceof Error; }
  checkField("GATE-1b", "assertCurrencyEngineEnabled() throws with the var unset", threwUnset, true);

  process.env[CURRENCY_FLAG_ENV] = "false";
  checkField("GATE-2", 'the STRING "false" reads OFF (the Boolean(...) pitfall)', isCurrencyEngineEnabled(), false);

  process.env[CURRENCY_FLAG_ENV] = "TRUE";
  checkField("GATE-3", '"TRUE" reads OFF (case-sensitivity)', isCurrencyEngineEnabled(), false);

  process.env[CURRENCY_FLAG_ENV] = "1";
  checkField("GATE-4", '"1" reads OFF (the accepted-spellings-list pitfall)', isCurrencyEngineEnabled(), false);

  process.env[CURRENCY_FLAG_ENV] = "";
  checkField("GATE-5", 'an empty string reads OFF (the Vercel blank-var pitfall)', isCurrencyEngineEnabled(), false);

  process.env[CURRENCY_FLAG_ENV] = " true \\n";
  checkField("GATE-6", '"true" with surrounding whitespace reads ON (trimmed)', isCurrencyEngineEnabled(), true);

  process.env[CURRENCY_FLAG_ENV] = "true";
  checkField("GATE-7", 'the exact literal "true" reads ON', isCurrencyEngineEnabled(), true);
  var threwSet = false;
  try { assertCurrencyEngineEnabled(); } catch (e) { threwSet = true; }
  checkField("GATE-7b", "assertCurrencyEngineEnabled() does not throw once the exact literal is set", threwSet, false);

  delete process.env[CURRENCY_FLAG_ENV]; // restore OFF for the rest of this run
}

// =============================================================================
// W — window arithmetic (window.ts directly)
// =============================================================================
section("W — window arithmetic");
{
  checkField("W-1", "rollingDayWindow(2026-08-07,90)", rollingDayWindow("2026-08-07", 90), { start: "2026-05-10", end: "2026-08-07" });
  checkField("W-2", "rollingDayWindow(2026-03-01,90) year cross", rollingDayWindow("2026-03-01", 90), { start: "2025-12-02", end: "2026-03-01" });
  checkField("W-3", "rollingDayWindow(2028-03-01,90) leap Feb", rollingDayWindow("2028-03-01", 90), { start: "2027-12-03", end: "2028-03-01" });
  checkField("W-4", "calendarMonthLookback(2026-08-07,6)", calendarMonthLookback("2026-08-07", 6), { start: "2026-02-01", end: "2026-08-07" });
  checkField("W-5", "calendarMonthLookback(2026-01-15,6)", calendarMonthLookback("2026-01-15", 6), { start: "2025-07-01", end: "2026-01-15" });
  checkField("W-6", "calendarMonthThroughDate(2024-08-15,24)", calendarMonthThroughDate("2024-08-15", 24), "2026-08-31");
  checkField("W-7", "calendarMonthThroughDate(2024-08-01,24) any day in the month", calendarMonthThroughDate("2024-08-01", 24), "2026-08-31");
  checkField("W-8", "calendarMonthThroughDate(2024-08-31,24) same answer", calendarMonthThroughDate("2024-08-31", 24), "2026-08-31");
  checkField("W-9", "calendarMonthThroughDate(2026-01-31,24) month-end event", calendarMonthThroughDate("2026-01-31", 24), "2028-01-31");
  checkField("W-10", "calendarMonthThroughDate(2026-02-15,24) leap-year Feb end", calendarMonthThroughDate("2026-02-15", 24), "2028-02-29");
  checkField("W-11", "calendarMonthThroughDate(2025-02-15,24) non-leap Feb end", calendarMonthThroughDate("2025-02-15", 24), "2027-02-28");
  checkField("W-12", "calendarMonthThroughDate(2024-03-31,24)", calendarMonthThroughDate("2024-03-31", 24), "2026-03-31");
  checkField("W-13", "rollingMonthWindow(2026-08-31,6).start clamps (no Feb 31)", rollingMonthWindow("2026-08-31", 6).start, "2026-02-28");
  checkField("W-14", "rollingMonthWindow(2028-08-31,6).start clamps, leap year", rollingMonthWindow("2028-08-31", 6).start, "2028-02-29");

  // W-15: both-forms agreement, over the same completedOn values W-6..W-12 used. throughDate
  // comes from calling calendarMonthThroughDate itself (not a hard-coded literal) — this is
  // the cross-check between the two forms of the 61.56 calculation, and it is only a
  // cross-check if both sides are computed, not one side asserted and the other read off
  // the table (SEC-15).
  [
    "2024-08-15", "2024-08-01", "2024-08-31",
    "2026-01-31", "2026-02-15", "2025-02-15", "2024-03-31",
  ].forEach(function (completedOn) {
    var throughDate = calendarMonthThroughDate(completedOn, 24);
    var lookbackStart = calendarMonthLookback(ASOF, 24).start;
    var lhs = completedOn >= lookbackStart;
    var rhs = throughDate >= ASOF;
    checkField("W-15 " + completedOn, "(completedOn >= 24mo lookback start) === (throughDate >= asOf)", lhs, rhs);
  });

  checkField("W-16a", "addDays(2026-08-07,-180)", addDays("2026-08-07", -180), "2026-02-08");
  var w16 = calendarMonthLookback("2026-08-07", 6).start < addDays("2026-08-07", -180);
  checkField("W-16b", "calendarMonthLookback(...).start is strictly earlier than the day-counting reading (regression guard for 01-07 FEB)", w16, true);

  var w17 = calendarMonthLookback("2026-08-07", 6).start !== addMonths("2026-08-07", -6);
  checkField("W-17", "calendarMonthLookback(...).start is not addMonths of the FLIGHT DATE — the reg anchors on the month, not the day", w17, true);

  checkField("W-isWellFormed-ok", "isWellFormedIsoDate(2026-08-07)", isWellFormedIsoDate("2026-08-07"), true);
  checkField("W-isWellFormed-bad", "isWellFormedIsoDate(2026-02-30) — a real-looking date naming no real day", isWellFormedIsoDate("2026-02-30"), false);
}

var W90 = rollingDayWindow(ASOF, 90);
var W6M = calendarMonthLookback(ASOF, 6);

// =============================================================================
// A — 61.57(a) general experience, currency_type passenger_day
// =============================================================================
section("A — 61.57(a) general experience");
{
  var a1 = evaluateGeneralExperience({ asOf: ASOF, airmanUserId: AIRMAN, intendedAircraft: N1V,
    entries: threeDated("a1", ["2026-06-01", "2026-06-02", "2026-06-03"], { dayTakeoffs: 1, dayLandingsTouchGo: 1 }) });
  checkResult("A-1", "touch-and-go counts for a non-tailwheel aircraft; (a) is neither passenger-only nor day-only", a1, {
    status: "estimated_current", ruleBasis: "61.57(a)", window: W90, observed: { takeoffs: 3, landings: 3 },
    limitingDate: "2026-06-01", countedIds: ["a1-0", "a1-1", "a1-2"], missing: [],
  });

  var a2 = evaluateGeneralExperience({ asOf: ASOF, airmanUserId: AIRMAN, intendedAircraft: N1V,
    entries: [mkEntry("a2-0", { entryDate: "2026-05-10", dayTakeoffs: 3, dayLandingsFullStop: 3 })] });
  checkResult("A-2", "the 90-day boundary, inside", a2, {
    status: "estimated_current", limitingDate: "2026-05-10", observed: { takeoffs: 3, landings: 3 }, missing: [],
  });

  var a3 = evaluateGeneralExperience({ asOf: ASOF, airmanUserId: AIRMAN, intendedAircraft: N1V,
    entries: [mkEntry("a3-0", { entryDate: "2026-05-09", dayTakeoffs: 3, dayLandingsFullStop: 3 })] });
  checkResult("A-3", "the 90-day boundary, outside — the pair with A-2 pins the conservative reading", a3, {
    status: "estimated_not_current", countedIds: [], observed: { takeoffs: 0, landings: 0 }, missing: [],
  });

  var a4 = evaluateGeneralExperience({ asOf: ASOF, airmanUserId: AIRMAN, intendedAircraft: N2V,
    entries: [mkEntry("a4-0", { entryDate: "2026-06-01", dayTakeoffs: 3, dayLandingsTouchGo: 3, aircraft: N2V })] });
  checkResult("A-4", "61.57(a)(1)(ii) — tailwheel touch-and-goes do not count as landings", a4, {
    status: "estimated_not_current", observed: { takeoffs: 3, landings: 0 }, missing: [],
  });

  var a5 = evaluateGeneralExperience({ asOf: ASOF, airmanUserId: AIRMAN, intendedAircraft: N2V,
    entries: [mkEntry("a5-0", { entryDate: "2026-06-01", dayTakeoffs: 3, dayLandingsFullStop: 3, aircraft: N2V })] });
  checkResult("A-5", "same, but full-stop", a5, { status: "estimated_current", observed: { takeoffs: 3, landings: 3 }, missing: [] });

  var a6 = evaluateGeneralExperience({ asOf: ASOF, airmanUserId: AIRMAN, intendedAircraft: N3V, entries: [] });
  checkResult("A-6", "NULL gear must never be read as tricycle", a6, { status: "insufficient_data", missing: ["aircraft_gear_unrecorded"] });

  var a7 = evaluateGeneralExperience({ asOf: ASOF, airmanUserId: AIRMAN, intendedAircraft: N1V,
    entries: threeDated("a7", ["2026-06-01", "2026-06-02", "2026-06-03"], { dayTakeoffs: 1, dayLandingsFullStop: 1, role: "DUAL_RECEIVED" }) });
  checkResult("A-7", "61.51(h) training received is not acting as PIC", a7, { status: "estimated_not_current", countedIds: [], missing: [] });

  // A-8 used to set dualReceivedTime: 1.5 on the fixture entry, but CurrencyEntry has no
  // such field (dual_received_time is a logbook column consumed upstream, at role
  // inference — see lib/logbook-import/apply-mapping.ts and
  // scripts/foreflight-import-verify.mjs's "row9" — never by the currency engine). The
  // override landed on a property nothing here reads (SEC-12); deleted rather than kept as
  // a check that could not fail.

  var a9 = evaluateGeneralExperience({ asOf: ASOF, airmanUserId: AIRMAN, intendedAircraft: N1V,
    entries: threeDated("a9", ["2026-06-01", "2026-06-02", "2026-06-03"], { dayTakeoffs: 1, dayLandingsFullStop: 1, role: "SOLO" }) });
  checkResult("A-9", "pins O-6's resolution: SOLO counts", a9, { status: "estimated_current", observed: { takeoffs: 3, landings: 3 }, missing: [] });

  // A null role, isolated from every other gate (SEC-11: the old fixture also set
  // simulatorTime, so unresolvable_simulator_row fired first and role_unrecorded's own
  // behavior was never exercised — soleManipulator true and real takeoffs/landings here
  // mean role_unrecorded is the ONLY thing that can make this insufficient_data).
  var a10 = evaluateGeneralExperience({ asOf: ASOF, airmanUserId: AIRMAN, intendedAircraft: N1V,
    entries: threeDated("a10", ["2026-06-01", "2026-06-02", "2026-06-03"], { role: null, soleManipulator: true, dayTakeoffs: 1, dayLandingsFullStop: 1 }) });
  checkResult("A-10", "a null role is its own missing input (role_unrecorded), not a silent exclusion — REG-9", a10, {
    status: "insufficient_data", missing: ["role_unrecorded"],
  });

  var a11 = evaluateGeneralExperience({ asOf: ASOF, airmanUserId: AIRMAN, intendedAircraft: N1V,
    entries: [mkEntry("a11-0", { entryDate: "2026-06-01", dayTakeoffs: 3, dayLandingsFullStop: 3, aircraft: N4V })] });
  checkResult("A-11", "BE-40 entries do not cover a CE-500 intended aircraft", a11, { status: "estimated_not_current", countedIds: [], missing: [] });

  var a12 = evaluateGeneralExperience({ asOf: ASOF, airmanUserId: AIRMAN, intendedAircraft: N1V,
    entries: [mkEntry("a12-0", { entryDate: "2026-06-01", dayTakeoffs: 3, dayLandingsFullStop: 3, aircraft: N5V })] });
  checkResult("A-12", "one CE-500 rating covers the whole family — the ICAO designator alone would have refused this", a12, {
    status: "estimated_current", observed: { takeoffs: 3, landings: 3 }, missing: [],
  });

  var a13 = evaluateGeneralExperience({ asOf: ASOF, airmanUserId: AIRMAN, intendedAircraft: N1V,
    entries: [mkEntry("a13-0", { entryDate: "2026-06-01", dayTakeoffs: 3, dayLandingsFullStop: 3, aircraft: N1V_ASEL })] });
  checkResult("A-13", "ASEL entries do not cover an AMEL intended aircraft", a13, { status: "estimated_not_current", countedIds: [], missing: [] });

  var a14 = evaluateGeneralExperience({ asOf: ASOF, airmanUserId: AIRMAN, intendedAircraft: N1V,
    entries: [mkEntry("a14-0", { entryDate: "2026-06-01", dayLandingsFullStop: 1, nightLandingsTouchGo: 2, dayTakeoffs: 1, nightTakeoffs: 2 })] });
  checkResult("A-14", "(a) has no time-of-day limit", a14, { status: "estimated_current", observed: { takeoffs: 3, landings: 3 }, missing: [] });

  var a15 = evaluateGeneralExperience({ asOf: ASOF, airmanUserId: AIRMAN, intendedAircraft: N2V,
    entries: [mkEntry("a15-0", { entryDate: "2026-06-01", dayTakeoffs: 3, dayLandingsFullStop: 3, aircraft: N2V_TRI })] });
  checkResult("A-15", "REGU-1: same category/class/type as the tailwheel intended aircraft, but flown in a TRICYCLE airplane — must not count", a15, {
    status: "estimated_not_current", observed: { takeoffs: 0, landings: 0 }, missing: [],
  });

  var a16 = evaluateGeneralExperience({ asOf: ASOF, airmanUserId: AIRMAN, intendedAircraft: N2V,
    entries: [mkEntry("a16-0", { entryDate: "2026-06-01", dayTakeoffs: 3, dayLandingsFullStop: 3, aircraft: N2V_NULLGEAR })] });
  checkResult("A-16", "REGU-5: the LOGGED aircraft's own gear unrecorded is a missing input, not a silent pass", a16, {
    status: "insufficient_data", missing: ["aircraft_gear_unrecorded"],
  });

  // A-17..A-20 — P1: matchGates's "could this change the answer" scoping,
  // the highest-severity finding of the third review round.
  var a17 = evaluateGeneralExperience({ asOf: ASOF, airmanUserId: AIRMAN, intendedAircraft: NBLANK,
    entries: threeDated("a17", ["2026-06-01", "2026-06-02", "2026-06-03"], { dayTakeoffs: 1, dayLandingsFullStop: 1, aircraft: NBLANK_SAME })
      .concat([mkEntry("a17-3", { entryDate: "2026-06-04", dayTakeoffs: 3, dayLandingsFullStop: 3, aircraft: NBLANK_DIFF })]) });
  checkResult("A-17", "P1: three CERTAIN qualifying entries already answer this card — the fourth entry's unresolvable type could never change it and must not gate", a17, {
    status: "estimated_current", observed: { takeoffs: 3, landings: 3 }, missing: [],
  });

  var a18 = evaluateGeneralExperience({ asOf: ASOF, airmanUserId: AIRMAN, intendedAircraft: NBLANK,
    entries: threeDated("a18", ["2026-06-01", "2026-06-02"], { dayTakeoffs: 1, dayLandingsFullStop: 1, aircraft: NBLANK_SAME })
      .concat([mkEntry("a18-2", { entryDate: "2026-06-03", dayTakeoffs: 3, dayLandingsFullStop: 3, aircraft: NBLANK_DIFF })]) });
  checkResult("A-18", "P1: only 2/2 CERTAIN — the ambiguous entry COULD make up the difference, so this is insufficient_data (naming the entry), not a false not-current", a18, {
    status: "insufficient_data", missing: ["aircraft_type_unrecorded"],
  });
  var a18remedyNotes = a18.notes.join(" | ");
  checkField("A-18 notes name the entry", "the card must say which entry is unresolved, not just that one is", a18remedyNotes.indexOf("2026-06-03") !== -1, true);

  var a19 = evaluateGeneralExperience({ asOf: ASOF, airmanUserId: AIRMAN, intendedAircraft: NBLANK,
    entries: [mkEntry("a19-0", { entryDate: "2026-06-01", dayTakeoffs: 2, dayLandingsFullStop: 2, aircraft: NBLANK_DIFF })] });
  checkResult("A-19", "P1: short even in the BEST case (2 of 3, alone) — the ambiguous entry could not have changed a not-current answer either, so it must not gate", a19, {
    status: "estimated_not_current", missing: [],
  });

  var a20zero = evaluateGeneralExperience({ asOf: ASOF, airmanUserId: AIRMAN, intendedAircraft: NBLANK,
    entries: [mkEntry("a20zero-0", { entryDate: "2026-06-01", dayTakeoffs: 0, dayLandingsFullStop: 0, aircraft: NBLANK_DIFF })] });
  checkResult("A-20 zero movements", "an entry that could never contribute never gates, even alone", a20zero, { status: "estimated_not_current", missing: [] });

  var a20other = evaluateGeneralExperience({ asOf: ASOF, airmanUserId: AIRMAN, intendedAircraft: NBLANK,
    entries: [mkEntry("a20other-0", { entryDate: "2026-06-01", dayTakeoffs: 3, dayLandingsFullStop: 3, aircraft: NBLANK_DIFF, airmanUserId: OTHER_AIRMAN })] });
  checkResult("A-20 other airman", "another airman's entry never gates this pilot's card", a20other, { status: "estimated_not_current", missing: [] });

  var a20dual = evaluateGeneralExperience({ asOf: ASOF, airmanUserId: AIRMAN, intendedAircraft: NBLANK,
    entries: [mkEntry("a20dual-0", { entryDate: "2026-06-01", dayTakeoffs: 3, dayLandingsFullStop: 3, aircraft: NBLANK_DIFF, role: "DUAL_RECEIVED" })] });
  checkResult("A-20 DUAL_RECEIVED", "DUAL_RECEIVED never gates — it could never have counted regardless of type", a20dual, { status: "estimated_not_current", missing: [] });

  var a20heli = evaluateGeneralExperience({ asOf: ASOF, airmanUserId: AIRMAN, intendedAircraft: NBLANK,
    entries: [mkEntry("a20heli-0", { entryDate: "2026-06-01", dayTakeoffs: 3, dayLandingsFullStop: 3, aircraft: NHELI })] });
  checkResult("A-20 unrelated category", "a KNOWN different category (helicopter vs. ASEL) is a decisive non-match, not an unresolved type — match.ts's short-circuit", a20heli, {
    status: "estimated_not_current", missing: [],
  });
}

// =============================================================================
// N — 61.57(b) night, currency_type passenger_night
// =============================================================================
section("N — 61.57(b) night takeoff/landing experience");
{
  var n1 = evaluateNightExperience({ asOf: ASOF, airmanUserId: AIRMAN, intendedAircraft: N1V,
    entries: threeDated("n1", ["2026-06-01", "2026-06-02", "2026-06-03"], { nightTakeoffs: 1, nightLandingsTouchGo: 1, nightWindowAsserted: true }) });
  checkResult("N-1", "THE FULL-STOP NIGHT LANDING RULE — touch-and-go never counts under (b)", n1, {
    status: "estimated_not_current", observed: { takeoffs: 3, landings: 0 }, missing: [],
  });

  var n2 = evaluateNightExperience({ asOf: ASOF, airmanUserId: AIRMAN, intendedAircraft: N1V,
    entries: threeDated("n2", ["2026-06-01", "2026-06-02", "2026-06-03"], { nightTakeoffs: 1, nightLandingsFullStop: 1, nightWindowAsserted: true }) });
  checkResult("N-2", "full-stop", n2, { status: "estimated_current", observed: { takeoffs: 3, landings: 3 }, missing: [] });

  var n3entries = [
    mkEntry("n3-0", { entryDate: "2026-06-01", nightTakeoffs: 1, nightLandingsFullStop: 1, nightWindowAsserted: true }),
    mkEntry("n3-1", { entryDate: "2026-06-02", nightTakeoffs: 1, nightLandingsFullStop: 1, nightWindowAsserted: true }),
    mkEntry("n3-2", { entryDate: "2026-06-03", nightTakeoffs: 1, nightLandingsTouchGo: 1, nightWindowAsserted: true }),
  ];
  var n3 = evaluateNightExperience({ asOf: ASOF, airmanUserId: AIRMAN, intendedAircraft: N1V, entries: n3entries });
  checkResult("N-3", "2 full-stop + 1 touch-and-go", n3, { status: "estimated_not_current", observed: { takeoffs: 3, landings: 2 }, missing: [] });

  // Exactly at threshold, alone, so the ambiguity genuinely could be the
  // difference (Q1-class scoping: a null nightWindowAsserted on a row that
  // could never reach 3/3 on its own must NOT gate — see N-4b below for
  // that control case).
  var n4 = evaluateNightExperience({ asOf: ASOF, airmanUserId: AIRMAN, intendedAircraft: N1V,
    entries: [mkEntry("n4-0", { entryDate: "2026-06-01", nightTakeoffs: 3, nightLandingsFullStop: 3, nightWindowAsserted: null })] });
  checkResult("N-4", "civil twilight vs 61.57(b)(1)'s window — the single most dangerous silent error", n4, {
    status: "insufficient_data", missing: ["night_window_unasserted"],
  });

  // N-4b: nightWindowAsserted === FALSE is a STATED NEGATIVE ("this
  // landing was confirmed outside the (b)(1) window"), not an unknown —
  // same discipline as D-5's soleManipulator === false. Silently excluded,
  // never gated; three OTHER certain entries still answer the card.
  var n4bEntries = threeDated("n4b", ["2026-06-01", "2026-06-02", "2026-06-03"], { nightTakeoffs: 1, nightLandingsFullStop: 1, nightWindowAsserted: true })
    .concat([mkEntry("n4b-3", { entryDate: "2026-06-04", nightTakeoffs: 3, nightLandingsFullStop: 3, nightWindowAsserted: false })]);
  var n4b = evaluateNightExperience({ asOf: ASOF, airmanUserId: AIRMAN, intendedAircraft: N1V, entries: n4bEntries });
  checkResult("N-4b", "a STATED false is not an unknown — excluded, not gated, even though it alone would have reached 3/3", n4b, {
    status: "estimated_current", observed: { takeoffs: 3, landings: 3 }, missing: [],
  });

  var n5entries = threeDated("n5", ["2026-06-01", "2026-06-02", "2026-06-03"], { nightTakeoffs: 1, nightLandingsFullStop: 1, nightWindowAsserted: true })
    .concat([mkEntry("n5-3", { entryDate: "2026-06-04", nightTime: 2.0, nightTakeoffs: 0, nightLandingsFullStop: 0 })]);
  var n5 = evaluateNightExperience({ asOf: ASOF, airmanUserId: AIRMAN, intendedAircraft: N1V, entries: n5entries });
  checkResult("N-5", "a night flight with a daytime landing is a NOTE, not a state change", n5, {
    status: "estimated_current", observed: { takeoffs: 3, landings: 3 }, missing: [],
    notesInclude: ["no night takeoff or full-stop night landing"],
  });

  var n6 = evaluateNightExperience({ asOf: ASOF, airmanUserId: AIRMAN, intendedAircraft: N2V,
    entries: threeDated("n6", ["2026-06-01", "2026-06-02", "2026-06-03"], { nightTakeoffs: 1, nightLandingsFullStop: 1, nightWindowAsserted: true, aircraft: N2V }) });
  checkResult("N-6", "(b) has no tailwheel clause of its own — same arithmetic as N-2", n6, {
    status: "estimated_current", observed: { takeoffs: 3, landings: 3 }, missing: [],
  });

  var n7out = evaluateNightExperience({ asOf: ASOF, airmanUserId: AIRMAN, intendedAircraft: N1V,
    entries: [mkEntry("n7o-0", { entryDate: "2026-05-09", nightTakeoffs: 3, nightLandingsFullStop: 3, nightWindowAsserted: true })] });
  checkResult("N-7-outside", "(b)'s own 90-day boundary, outside", n7out, { status: "estimated_not_current", missing: [] });
  var n7in = evaluateNightExperience({ asOf: ASOF, airmanUserId: AIRMAN, intendedAircraft: N1V,
    entries: [mkEntry("n7i-0", { entryDate: "2026-05-10", nightTakeoffs: 3, nightLandingsFullStop: 3, nightWindowAsserted: true })] });
  checkResult("N-7-inside", "(b)'s own 90-day boundary, inside", n7in, { status: "estimated_current", missing: [] });

  var n8 = evaluateNightExperience({ asOf: ASOF, airmanUserId: AIRMAN, intendedAircraft: N1V,
    entries: [mkEntry("n8-0", { entryDate: "2026-06-01", nightTakeoffs: 3, nightLandingsFullStop: 3, nightWindowAsserted: true, simulatorTime: 4.0, simulatorDeviceType: "ffs" })] });
  checkResult("N-8", "61.57(b)(2) needs device approval and a part 142 course this schema cannot assert", n8, {
    status: "insufficient_data", missing: ["unresolvable_simulator_row"],
  });
}

// =============================================================================
// I — 61.57(c) instrument, currency_type instrument
// =============================================================================
section("I — 61.57(c) instrument experience");
{
  var i1 = evaluateInstrumentExperience({ asOf: ASOF, airmanUserId: AIRMAN, intendedAircraft: N1V,
    entries: [mkEntry("i1-0", { entryDate: "2026-02-01", approachesCount: 6, approachType: "ils", approachCondition: "actual", holds: 1, coursesInterceptedTracked: true })] });
  checkResult("I-1", "the 6-calendar-month lookback, inside — qualifying by exactly one day", i1, {
    status: "estimated_current", window: W6M, limitingDate: "2026-02-01", observed: { approaches: 6, holds: 1, intercepts: 1 }, missing: [],
  });

  var i2 = evaluateInstrumentExperience({ asOf: ASOF, airmanUserId: AIRMAN, intendedAircraft: N1V,
    entries: [mkEntry("i2-0", { entryDate: "2026-01-31", approachesCount: 6, approachType: "ils", approachCondition: "actual", holds: 1, coursesInterceptedTracked: true })] });
  checkResult("I-2", "outside", i2, { status: "estimated_not_current", observed: { approaches: 0 }, missing: [] });

  var i3 = evaluateInstrumentExperience({ asOf: ASOF, airmanUserId: AIRMAN, intendedAircraft: N1V,
    entries: [mkEntry("i3-0", { entryDate: "2026-02-05", approachesCount: 6, approachType: "ils", approachCondition: "actual", holds: 1, coursesInterceptedTracked: true })] });
  checkResult("I-3", "a 180-day implementation would report not-current here — this is the failure the spec names by name", i3, {
    status: "estimated_current", limitingDate: "2026-02-05", missing: [],
  });

  var i4 = evaluateInstrumentExperience({ asOf: ASOF, airmanUserId: AIRMAN, intendedAircraft: N1V,
    entries: [mkEntry("i4-0", { entryDate: "2026-03-01", approachesCount: 5, approachType: "ils", approachCondition: "actual", holds: 1, coursesInterceptedTracked: true })] });
  checkResult("I-4 / I-14", "5 approaches; also pins 61.57(d) is never a state, and the IPC pathway note", i4, {
    status: "estimated_not_current", ruleBasis: "61.57(c)", observed: { approaches: 5 }, missing: [],
    notesInclude: ["instrument proficiency check"],
  });

  var i5 = evaluateInstrumentExperience({ asOf: ASOF, airmanUserId: AIRMAN, intendedAircraft: N1V,
    entries: [mkEntry("i5-0", { entryDate: "2026-03-01", approachesCount: 6, approachType: "ils", approachCondition: "actual", holds: 0, coursesInterceptedTracked: true })] });
  checkResult("I-5", "no hold", i5, { status: "estimated_not_current", observed: { approaches: 6, holds: 0, intercepts: 1 }, missing: [] });

  var i6 = evaluateInstrumentExperience({ asOf: ASOF, airmanUserId: AIRMAN, intendedAircraft: N1V,
    entries: [mkEntry("i6-0", { entryDate: "2026-03-01", approachesCount: 6, approachType: "ils", approachCondition: "actual", holds: 1, coursesInterceptedTracked: false })] });
  checkResult("I-6", "no course intercept", i6, { status: "estimated_not_current", observed: { approaches: 6, holds: 1, intercepts: 0 }, missing: [] });

  var i7entries = [
    mkEntry("i7-0", { entryDate: "2026-03-01", approachesCount: 6, approachType: "ils", approachCondition: "actual" }),
    // REG-2/REG-3: holds and course intercepts are governed by 61.57(c)(1)'s own
    // condition/category clause, the same as approaches — a hold or intercept row needs
    // approachCondition recorded (and a matching aircraft category) just as much as an
    // approach row does.
    mkEntry("i7-1", { entryDate: "2026-04-01", holds: 1, approachCondition: "actual" }),
    mkEntry("i7-2", { entryDate: "2026-05-01", coursesInterceptedTracked: true, approachCondition: "actual" }),
  ];
  var i7 = evaluateInstrumentExperience({ asOf: ASOF, airmanUserId: AIRMAN, intendedAircraft: N1V, entries: i7entries });
  checkResult("I-7", "the tasks need not be on the same flight", i7, {
    status: "estimated_current", observed: { approaches: 6, holds: 1, intercepts: 1 }, countedIds: ["i7-0"], missing: [],
  });

  var i8 = evaluateInstrumentExperience({ asOf: ASOF, airmanUserId: AIRMAN, intendedAircraft: N1V,
    entries: [mkEntry("i8-0", { entryDate: "2026-03-01", approachesCount: 6, approachType: "ils", approachCondition: null, holds: 1, coursesInterceptedTracked: true })] });
  checkResult("I-8", "unknown condition is not qualifying and not disqualifying", i8, { status: "insufficient_data", missing: ["approach_condition_unrecorded"] });

  var i9 = evaluateInstrumentExperience({ asOf: ASOF, airmanUserId: AIRMAN, intendedAircraft: N1V,
    entries: [mkEntry("i9-0", { entryDate: "2026-03-01", approachesCount: 6, approachType: "ils", approachCondition: "neither", holds: 1, coursesInterceptedTracked: true })] });
  checkResult("I-9", "'neither' is a stated disqualifying fact, distinct from NULL — excluded, not insufficient_data", i9, {
    status: "estimated_not_current", observed: { approaches: 0 }, missing: [],
  });

  var i10 = evaluateInstrumentExperience({ asOf: ASOF, airmanUserId: AIRMAN, intendedAircraft: N1V,
    entries: [mkEntry("i10-0", { entryDate: "2026-03-01", approachesCount: 6, approachType: "visual", approachCondition: "neither", holds: 1, coursesInterceptedTracked: true })] });
  checkResult("I-10", "visual/neither, the only pairing the CHECK permits", i10, { status: "estimated_not_current", observed: { approaches: 0 }, missing: [] });

  // P2: a device row can never be CERTAIN — this schema has no field
  // recording whether a device "represents the category of aircraft for
  // the instrument rating privileges to be maintained" (61.57(c)(2)'s own
  // predicate) — so a LONE device row that is the ONLY source of currency
  // must ask, not answer. This replaced an earlier, permissive fixture
  // that asserted estimated_current here; that assertion was the P2 bug.
  var i11 = evaluateInstrumentExperience({ asOf: ASOF, airmanUserId: AIRMAN, intendedAircraft: N1V,
    entries: [mkEntry("i11-0", { entryDate: "2026-03-01", simulatorTime: 2.0, simulatorDeviceType: "atd", approachCondition: "simulated", approachType: "ils", approachesCount: 6, holds: 1, coursesInterceptedTracked: true })] });
  checkResult("I-11", "P2: a lone device row is never CERTAIN — 61.57(c)(2)'s own device-represents-category predicate is unconfirmable, so it can gate, not silently credit", i11, {
    status: "insufficient_data", missing: ["device_category_unconfirmed"],
  });

  var i12 = evaluateInstrumentExperience({ asOf: ASOF, airmanUserId: AIRMAN, intendedAircraft: N1V,
    entries: [mkEntry("i12-0", { entryDate: "2026-03-01", simulatorTime: 2.0, simulatorDeviceType: "other", approachCondition: "simulated", approachType: "ils", approachesCount: 6, holds: 1, coursesInterceptedTracked: true })] });
  checkResult("I-12", "'other' satisfies no row of the device matrix", i12, { status: "insufficient_data", missing: ["unresolvable_simulator_row"] });

  // I-13 previously asserted this NEEDED device row was credited
  // unconditionally (the P2 permissive bug); now it correctly asks.
  var i13entries = [
    mkEntry("i13-0", { entryDate: "2026-03-01", approachesCount: 3, approachType: "ils", approachCondition: "actual", holds: 1 }),
    mkEntry("i13-1", { entryDate: "2026-04-01", simulatorTime: 1.5, simulatorDeviceType: "ffs", approachesCount: 3, approachType: "ils", approachCondition: "simulated", coursesInterceptedTracked: true }),
  ];
  var i13 = evaluateInstrumentExperience({ asOf: ASOF, airmanUserId: AIRMAN, intendedAircraft: N1V, entries: i13entries });
  checkResult("I-13", "P2: 3 certain approaches from the real aircraft + a NEEDED FFS row to reach 6 — the device row is the difference, so this asks rather than answers", i13, {
    status: "insufficient_data", missing: ["device_category_unconfirmed"],
  });

  // I-15 still pins REGU-4/CORR-1's reachability fix (aircraft: null must
  // NOT fall back to the registry gate — see the missing[] assertion) —
  // but P2 means the answer is now insufficient_data, not credit.
  var i15 = evaluateInstrumentExperience({ asOf: ASOF, airmanUserId: AIRMAN, intendedAircraft: N1V,
    entries: [mkEntry("i15-0", { entryDate: "2026-03-01", simulatorTime: 2.0, simulatorDeviceType: "atd", approachCondition: "simulated", approachType: "ils", approachesCount: 6, holds: 1, coursesInterceptedTracked: true, aircraft: null })] });
  checkResult("I-15", "REGU-4/CORR-1 + P2: a device row with no tail number is gated by NAME (device_category_unconfirmed), never by falling back to aircraft_unregistered", i15, {
    status: "insufficient_data", missing: ["device_category_unconfirmed"],
  });

  var i16entries = [
    mkEntry("i16-0", { entryDate: "2026-03-01", approachesCount: 6, approachType: "ils", approachCondition: "actual", holds: 1, coursesInterceptedTracked: true }),
    mkEntry("i16-1", { entryDate: "2026-03-05", simulatorTime: 1.0, simulatorDeviceType: "atd", approachCondition: "simulated", approachType: "ils", approachesCount: 2, aircraft: null }),
  ];
  var i16 = evaluateInstrumentExperience({ asOf: ASOF, airmanUserId: AIRMAN, intendedAircraft: N1V, entries: i16entries });
  checkResult("I-16", "P1/ambiguous-facts.ts generalized to instrument.ts: the real aircraft alone already reaches 6/6, so the unneeded, unconfirmable device row must not gate or be credited", i16, {
    status: "estimated_current", observed: { approaches: 6, holds: 1, intercepts: 1 }, missing: [],
  });

  var i17 = evaluateInstrumentExperience({ asOf: ASOF, airmanUserId: AIRMAN, intendedAircraft: N1V_ASEL,
    entries: [mkEntry("i17-0", { entryDate: "2026-03-01", approachesCount: 6, approachType: "ils", approachCondition: "actual", holds: 1, coursesInterceptedTracked: true, aircraft: N1V })] });
  checkResult("I-17", "CORR-2: category_class is matched whole, so an AMEL entry does not count toward an ASEL card even though both are the airplane category", i17, {
    status: "estimated_not_current", observed: { approaches: 0 }, missing: [],
  });

  // I-14b (SEC-13) used to assert allResults.every(r => !r.ruleBasis.includes("(d)")) —
  // the RuleBasis union (types.ts) has seven literals, none containing "(d)", and every
  // module returns one of those literals, so the check could not fail for any input;
  // TypeScript's own exhaustiveness on the union already guards a future value that did
  // name 61.57(d). Deleted rather than kept as a check that could not fail. The real claim
  // — that a lapse triggers the IPC note, not a fabricated (d) state — is I-4/I-14's
  // notesInclude assertion above.
}

// =============================================================================
// R — 61.56 flight review, currency_type flight_review
// =============================================================================
section("R — 61.56 flight review");
{
  var r1 = evaluateFlightReview({ asOf: "2026-08-07", completedOn: "2024-08-15" });
  checkResult("R-1", "worked example 2", r1, { status: "estimated_current", throughDate: "2026-08-31" });

  var r2 = evaluateFlightReview({ asOf: "2026-08-31", completedOn: "2024-08-15" });
  checkResult("R-2", "last day, inclusive", r2, { status: "estimated_current", throughDate: "2026-08-31" });

  var r3 = evaluateFlightReview({ asOf: "2026-09-01", completedOn: "2024-08-15" });
  checkResult("R-3", "one day past", r3, { status: "estimated_not_current", throughDate: "2026-08-31" });

  var r4 = evaluateFlightReview({ asOf: "2026-08-07", completedOn: "2024-07-31" });
  checkResult("R-4", "worked example 2, excluded side", r4, { status: "estimated_not_current", throughDate: "2026-07-31" });

  var r5 = evaluateFlightReview({ asOf: "2026-08-07", completedOn: "2024-08-01" });
  checkResult("R-5", "qualifying side", r5, { status: "estimated_current" });

  var r6 = evaluateFlightReview({ asOf: "2026-08-07", completedOn: null });
  checkResult("R-6", "no completion recorded", r6, { status: "insufficient_data", missing: ["flight_review_completion_absent"] });

  var r7 = evaluateFlightReview({ asOf: "2026-08-07", completedOn: "2026-12-01" });
  checkResult("R-7", "a review not yet given cannot establish currency", r7, {
    status: "insufficient_data", missing: ["flight_review_completion_in_future"], displayDate: "2026-12-01",
  });

  checkField("R-8a", "R-3 carries the 61.56(d) substitution note", r3.notes.join(" | ").indexOf("61.56(d)") !== -1, true);
  checkField("R-8b", "R-4 carries the 61.56(d) substitution note", r4.notes.join(" | ").indexOf("61.56(d)") !== -1, true);

  // R-9: both-forms agreement, over R-1..R-5's own (completedOn, asOf) pairs.
  [
    ["2024-08-15", "2026-08-07"], ["2024-08-15", "2026-08-31"], ["2024-08-15", "2026-09-01"],
    ["2024-07-31", "2026-08-07"], ["2024-08-01", "2026-08-07"],
  ].forEach(function (pair) {
    var completedOn = pair[0], asOf = pair[1];
    var throughDate = calendarMonthThroughDate(completedOn, 24);
    var lhs = completedOn >= calendarMonthLookback(asOf, 24).start;
    var rhs = throughDate >= asOf;
    checkField("R-9 " + completedOn + "/" + asOf, "both-forms agreement", lhs, rhs);
  });
}

// =============================================================================
// M — 61.23 medical, currency_type medical
// =============================================================================
section("M — 61.23 medical");
{
  var m1 = evaluateMedical({ pilotEnteredExpiresOn: "2027-03-31" });
  checkResult("M-1", "never computed", m1, { status: "insufficient_data", missing: ["medical_never_computed"], displayDate: "2027-03-31", window: null });

  var m2 = evaluateMedical({ pilotEnteredExpiresOn: null });
  checkResult("M-2", "no date entered", m2, { status: "insufficient_data", displayDate: null });

  var m3 = evaluateMedical({ pilotEnteredExpiresOn: "2027-03-31", class: "first", ageAtExam: 45, examDate: "2026-03-15" });
  checkResult("M-3", "refusal is by construction, not by absence of data", m3, { status: "insufficient_data", displayDate: "2027-03-31" });
  // M-4 (the sweep — no medical result is ever current/not-current) runs in the D-block sweep below, over every tracked result.
}

// =============================================================================
// P — 135.247, when operatingRule is part_135
// =============================================================================
section("P — 135.247");
{
  var p1entries = threeDated("p1", ["2026-06-01", "2026-06-02", "2026-06-03"], { dayTakeoffs: 1, dayLandingsFullStop: 1 });
  var p1 = trackRun(evaluateCurrency(baseCurrencyInput({ operatingRule: "part_135", exemptionAsserted: true, entries: p1entries })));
  checkResult("P-1", "sole manipulator, same type, day", p1[0], { status: "estimated_current", ruleBasis: "135.247(a)(1)" });

  var p2entries = threeDated("p2", ["2026-06-01", "2026-06-02", "2026-06-03"], { nightTakeoffs: 1, nightLandingsTouchGo: 1, nightWindowAsserted: true });
  var p2 = trackRun(evaluateCurrency(baseCurrencyInput({ operatingRule: "part_135", exemptionAsserted: true, entries: p2entries })));
  checkResult("P-2", "THE PAIR WITH N-1 — 135.247(a)(2) does not require full stop", p2[1], { status: "estimated_current", ruleBasis: "135.247(a)(2)" });

  var p3entries = p2entries.map(function (e) { return Object.assign({}, e, { aircraft: N2V }); });
  var p3 = trackRun(evaluateCurrency(baseCurrencyInput({ intendedAircraft: N2V, operatingRule: "part_135", exemptionAsserted: true, entries: p3entries })));
  checkResult("P-3", "135.247(b) — the tailwheel rule the spec never mentions, reaching the night variant", p3[1], {
    status: "estimated_not_current", ruleBasis: "135.247(a)(2)",
  });

  var p3bEntries = threeDated("p3b", ["2026-06-01", "2026-06-02", "2026-06-03"], { nightTakeoffs: 1, nightLandingsFullStop: 1, nightWindowAsserted: true, aircraft: N2V_TRI });
  var p3b = evaluatePart135Recency({ asOf: ASOF, airmanUserId: AIRMAN, operatingRule: "part_135", exemptionAsserted: false, intendedAircraft: N2V, entries: p3bEntries });
  checkResult("P-3b", "REGU-2: full-stop landings in a TRICYCLE airplane of the same category/class/type as the tailwheel intended aircraft must not count", p3b.night, {
    status: "estimated_not_current", observed: { takeoffs: 0, landings: 0 }, missing: [],
  });

  var p3cEntries = threeDated("p3c", ["2026-06-01", "2026-06-02", "2026-06-03"], { nightTakeoffs: 1, nightLandingsFullStop: 1, nightWindowAsserted: true, aircraft: N2V_NULLGEAR });
  var p3c = evaluatePart135Recency({ asOf: ASOF, airmanUserId: AIRMAN, operatingRule: "part_135", exemptionAsserted: false, intendedAircraft: N2V, entries: p3cEntries });
  checkResult("P-3c", "REGU-5: the LOGGED aircraft's own gear unrecorded is a missing input under 135.247(b) too", p3c.night, {
    status: "insufficient_data", missing: ["aircraft_gear_unrecorded"],
  });

  checkResult("P-4", "the trailing sentence of (a) — night recency satisfies the day variant too", p2[0], {
    status: "estimated_current", ruleBasis: "135.247(a)(2)",
  });

  var p5 = evaluatePart135Recency({ asOf: ASOF, airmanUserId: AIRMAN, operatingRule: "unspecified", exemptionAsserted: false, intendedAircraft: N1V, entries: [] });
  track(p5.day); track(p5.night);
  checkField("P-5 day status", "operatingRule unspecified — assuming either part is a silent error", p5.day.status, "insufficient_data");
  checkField("P-5 day missing", "", p5.day.missing, ["operating_rule_unspecified"]);
  checkField("P-5 night status", "", p5.night.status, "insufficient_data");
  checkField("P-5 night missing", "", p5.night.missing, ["operating_rule_unspecified"]);
  checkField("P-5 day remedy names client", "", p5.day.notes.join(" | ").indexOf("client") !== -1, true);
  checkField("P-5 day remedy names trip", "", p5.day.notes.join(" | ").indexOf("trip") !== -1, true);

  var p6entries = threeDated("p6", ["2026-06-01", "2026-06-02", "2026-06-03"], { dayTakeoffs: 1, dayLandingsFullStop: 1 });
  var p6 = trackRun(evaluateCurrency(baseCurrencyInput({ operatingRule: "part_135", exemptionAsserted: false, entries: p6entries })));
  checkResult("P-6", "exemption not asserted — 61.57 computed normally, with the (e)(3) path named as available", p6[0], {
    status: "estimated_current", ruleBasis: "61.57(a)", notesInclude: ["61.57(e)(3) may be available"],
  });

  var p7entries = threeDated("p7", ["2026-06-01", "2026-06-02", "2026-06-03"], { dayTakeoffs: 1, dayLandingsFullStop: 1 });
  var p7 = trackRun(evaluateCurrency(baseCurrencyInput({ operatingRule: "part_91", exemptionAsserted: true, entries: p7entries })));
  checkResult("P-7", "part_91 + exemption asserted anyway — 61.57 stays primary, RELABELLED not suppressed", p7[0], {
    status: "estimated_current", ruleBasis: "61.57(a)",
    notesInclude: ["under parts 91 or 135 for the certificate holder you asserted the exemption for"],
  });

  var p8 = trackRun(evaluateCurrency(baseCurrencyInput({ operatingRule: "unspecified", exemptionAsserted: true, entries: [] })));
  p8.forEach(track);
  checkField("P-8 day no (e)(3) note", "REGU-8: 'unspecified' gets no (e)(3) note even when exemptionAsserted is true", p8[0].notes.join(" | ").indexOf("61.57(e)(3)") !== -1, false);
  checkField("P-8 night no (e)(3) note", "", p8[1].notes.join(" | ").indexOf("61.57(e)(3)") !== -1, false);

  var p9 = trackRun(evaluateCurrency(baseCurrencyInput({ operatingRule: "part_135", exemptionAsserted: true, entries: [] })));
  p9.forEach(track);
  // P7: p9[2].ruleBasis === "61.57(c)" cannot fail — evaluateInstrumentExperience
  // hard-codes that string literal in both of its return statements, and
  // index.ts never rewrites it, so the check was true for every possible
  // input. REGU-6's real claim is that applyPart135Exemption's (e)(3)
  // substitution reaches ONLY passenger_day/passenger_night, never
  // instrument — so this instead computes the instrument card TWICE, once
  // under the Part 135 exemption and once without it, and asserts they
  // are byte-for-byte identical. A regression that made the exemption
  // touch instrument in ANY way — ruleBasis, a note, a status change —
  // would make this fail; the old assertion could not have caught any of
  // those.
  var p9NoExemption = trackRun(evaluateCurrency(baseCurrencyInput({ operatingRule: "part_91", exemptionAsserted: false, entries: [] })));
  checkField("P-9 instrument untouched by (e)(3)", "REGU-6: the instrument card is byte-for-byte identical whether or not the Part 135 exemption is asserted", JSON.stringify(p9[2]), JSON.stringify(p9NoExemption[2]));
}

// =============================================================================
// D — insufficient_data, the default posture, not a fallback
// =============================================================================
section("D — insufficient_data is the default posture");
{
  var d1g = evaluateGeneralExperience({ asOf: ASOF, airmanUserId: AIRMAN, intendedAircraft: N1V, entries: [] });
  checkResult("D-1 (general)", "THE MOST IMPORTANT ROW — no flying is a COMPUTED answer, not missing data", d1g, {
    status: "estimated_not_current", countedIds: [], missing: [],
  });
  var d1n = evaluateNightExperience({ asOf: ASOF, airmanUserId: AIRMAN, intendedAircraft: N1V, entries: [] });
  checkResult("D-1 (night)", "same principle, 61.57(b)", d1n, { status: "estimated_not_current", countedIds: [], missing: [] });
  var d1i = evaluateInstrumentExperience({ asOf: ASOF, airmanUserId: AIRMAN, intendedAircraft: N1V, entries: [] });
  checkResult("D-1 (instrument)", "same principle, 61.57(c)", d1i, { status: "estimated_not_current", countedIds: [], missing: [] });

  var d2 = trackRun(evaluateCurrency(baseCurrencyInput({ intendedAircraft: null, entries: [] })));
  checkResult("D-2 day", "intendedAircraft absent — gates are per-type, not global", d2[0], { status: "insufficient_data", missing: ["intended_aircraft_absent"] });
  checkResult("D-2 night", "", d2[1], { status: "insufficient_data", missing: ["intended_aircraft_absent"] });
  checkResult("D-2 instrument", "", d2[2], { status: "insufficient_data", missing: ["intended_aircraft_absent"] });
  checkField("D-2 flight_review unaffected", "flight_review computes normally with no intended aircraft at all", d2[3].status !== "insufficient_data", true);
  checkField("D-2 medical always insufficient", "", d2[4].status, "insufficient_data");

  // D-3a: only 2/2 CERTAIN — the ambiguous soleManipulator entry COULD
  // make up the difference, so this genuinely asks.
  var d3aEntries = threeDated("d3a", ["2026-06-01", "2026-06-02"], { dayTakeoffs: 1, dayLandingsFullStop: 1 })
    .concat([mkEntry("d3a-2", { entryDate: "2026-06-03", dayTakeoffs: 1, dayLandingsFullStop: 1, soleManipulator: null })]);
  var d3a = evaluateGeneralExperience({ asOf: ASOF, airmanUserId: AIRMAN, intendedAircraft: N1V, entries: d3aEntries });
  checkResult("D-3a", "a missing input that COULD change the answer — short without it, sufficient with it", d3a, {
    status: "insufficient_data", missing: ["sole_manipulator_unrecorded"],
  });

  // D-3b — Q1's class of bug, generalized to sole_manipulator_unrecorded:
  // 3/3 CERTAIN already answers this card; a FOURTH, unrelated entry
  // carrying the identical ambiguous fact could never change that answer
  // and must not gate it, even though the count IS met and the fact IS
  // present in the window — the naive "any ambiguous fact anywhere gates"
  // reading this row used to assert is exactly the bug five review rounds
  // kept finding in a new gate each time.
  var d3bEntries = threeDated("d3b", ["2026-06-01", "2026-06-02", "2026-06-03"], { dayTakeoffs: 1, dayLandingsFullStop: 1 })
    .concat([mkEntry("d3b-3", { entryDate: "2026-06-04", dayTakeoffs: 3, dayLandingsFullStop: 3, soleManipulator: null })]);
  var d3b = evaluateGeneralExperience({ asOf: ASOF, airmanUserId: AIRMAN, intendedAircraft: N1V, entries: d3bEntries });
  checkResult("D-3b", "a missing input that could NOT change the answer — the count is already met on certain entries alone", d3b, {
    status: "estimated_current", observed: { takeoffs: 3, landings: 3 }, missing: [],
  });

  var d4entries = threeDated("d4", ["2026-06-01", "2026-06-02", "2026-06-03"], { dayTakeoffs: 1, dayLandingsFullStop: 1 })
    .concat([mkEntry("d4-3", { entryDate: "2026-05-09", soleManipulator: null })]);
  var d4 = evaluateGeneralExperience({ asOf: ASOF, airmanUserId: AIRMAN, intendedAircraft: N1V, entries: d4entries });
  checkResult("D-4", "the gate is scoped to the window, not to the table", d4, { status: "estimated_current", missing: [] });

  var d5entries = threeDated("d5", ["2026-06-01", "2026-06-02", "2026-06-03"], { dayTakeoffs: 1, dayLandingsFullStop: 1, soleManipulator: false });
  var d5 = evaluateGeneralExperience({ asOf: ASOF, airmanUserId: AIRMAN, intendedAircraft: N1V, entries: d5entries });
  checkResult("D-5", "a stated negative is not an unknown", d5, { status: "estimated_not_current", missing: [] });

  // Exactly at threshold, alone, so attributing it genuinely could be the
  // difference (same Q1-class scoping as N-4/D-10a below).
  var d6 = evaluateGeneralExperience({ asOf: ASOF, airmanUserId: AIRMAN, intendedAircraft: N1V,
    entries: [mkEntry("d6-0", { entryDate: "2026-06-01", dayTakeoffs: 3, dayLandingsFullStop: 3, airmanUserId: null })] });
  checkResult("D-6", "unattributed entry", d6, { status: "insufficient_data", missing: ["airman_unattributed"] });

  // D-6b: the SAME unattributed entry, but short even in the best case (1
  // of 3) — attributing it could not have changed a not-current answer
  // either, so it must not gate.
  var d6b = evaluateGeneralExperience({ asOf: ASOF, airmanUserId: AIRMAN, intendedAircraft: N1V,
    entries: [mkEntry("d6b-0", { entryDate: "2026-06-01", dayTakeoffs: 1, dayLandingsFullStop: 1, airmanUserId: null })] });
  checkResult("D-6b", "an unattributed entry that is short even in the best case never gates", d6b, {
    status: "estimated_not_current", missing: [],
  });

  var d7entries = threeDated("d7other", ["2026-06-01", "2026-06-02", "2026-06-03"], { dayTakeoffs: 1, dayLandingsFullStop: 1, airmanUserId: OTHER_AIRMAN })
    .concat([mkEntry("d7-mine", { entryDate: "2026-06-04", dayTakeoffs: 1, dayLandingsFullStop: 1, airmanUserId: AIRMAN })]);
  var d7 = evaluateGeneralExperience({ asOf: ASOF, airmanUserId: AIRMAN, intendedAircraft: N1V, entries: d7entries });
  checkResult("D-7", "a two-seat business account does not merge two pilots' landings into one verdict true of neither", d7, {
    status: "estimated_not_current", missing: [], countedIds: ["d7-mine"],
  });

  var d8 = evaluateGeneralExperience({ asOf: ASOF, airmanUserId: AIRMAN, intendedAircraft: N1V,
    entries: [mkEntry("d8-0", { entryDate: "2026-06-01", dayTakeoffs: 3, dayLandingsFullStop: 3, aircraft: null })] });
  checkResult("D-8", "tail not in pilot.aircraft", d8, { status: "insufficient_data", missing: ["aircraft_unregistered"] });
  var d8remedy = describeResult(d8).remedies.filter(function (m) { return m.missing === "aircraft_unregistered"; })[0];
  checkField("D-8 remedy href", "points at the real registration route, /logbook/aircraft (see app/(app)/logbook/aircraft)", d8remedy && d8remedy.href, "/logbook/aircraft");

  var d9entries = threeDated("d9", ["2026-06-01", "2026-06-02", "2026-06-03"], { dayTakeoffs: 1, dayLandingsFullStop: 1 })
    .concat([mkEntry("d9-3", { entryDate: "2026-06-04", aircraft: null, dayTakeoffs: 0, dayLandingsFullStop: 0 })]);
  var d9 = evaluateGeneralExperience({ asOf: ASOF, airmanUserId: AIRMAN, intendedAircraft: N1V, entries: d9entries });
  checkResult("D-9", "the gate fires only for entries that could change the answer", d9, { status: "estimated_current", missing: [] });

  var d10a = evaluateGeneralExperience({ asOf: ASOF, airmanUserId: AIRMAN, intendedAircraft: N1V,
    entries: [mkEntry("d10a-0", { entryDate: "2026-06-01", dayTakeoffs: 3, dayLandingsFullStop: 3, simulatorTime: 1.0, simulatorDeviceType: "ffs" })] });
  checkResult("D-10a", "an FFS row in the (a) window", d10a, { status: "insufficient_data", missing: ["unresolvable_simulator_row"] });
  var d10b = evaluateInstrumentExperience({ asOf: ASOF, airmanUserId: AIRMAN, intendedAircraft: N1V,
    entries: [mkEntry("d10b-0", { entryDate: "2026-03-01", simulatorTime: 1.0, simulatorDeviceType: "ffs", approachesCount: 6, approachType: "ils", approachCondition: "simulated", holds: 1, coursesInterceptedTracked: true })] });
  checkResult("D-10b", "the IDENTICAL row shape, in the (c) window — (c) does not copy (a)/(b)'s blanket unresolvable_simulator_row gate, but a device row still can't singlehandedly prove currency (P2): it gates by the more specific device_category_unconfirmed instead", d10b, {
    status: "insufficient_data", missing: ["device_category_unconfirmed"],
  });

  var d11 = evaluateGeneralExperience({ asOf: ASOF, airmanUserId: AIRMAN,
    intendedAircraft: { tailKey: "NB", typeRating: "CE-500", typeDesignator: "C560", categoryClass: "", gear: "tricycle" }, entries: [] });
  checkResult("D-11", "blank is not a value", d11, { status: "insufficient_data", missing: ["aircraft_category_class_unrecorded"] });

  var d12 = evaluateGeneralExperience({ asOf: ASOF, airmanUserId: AIRMAN,
    intendedAircraft: { tailKey: "NC", typeRating: null, typeDesignator: null, categoryClass: "AMEL", gear: "tricycle" }, entries: [] });
  checkResult("D-12", "no type rating and no type designator", d12, { status: "insufficient_data", missing: ["aircraft_type_unrecorded"] });

  var d13intended = { tailKey: "NX", typeRating: null, typeDesignator: null, categoryClass: "", gear: null };
  var d13 = evaluateGeneralExperience({ asOf: ASOF, airmanUserId: AIRMAN, intendedAircraft: d13intended, entries: [] });
  checkResult("D-13", "three INTENDED-aircraft-level gates at once, deduplicated, in MISSING_INPUT_ORDER", d13, {
    status: "insufficient_data",
    missing: ["aircraft_gear_unrecorded", "aircraft_category_class_unrecorded", "aircraft_type_unrecorded"],
  });

  // D-13b: the entry-level equivalent — ONE entry, ambiguous on FOUR axes
  // at once (airman/role/sole-manipulator/registration), exactly at
  // threshold so all four genuinely could be the difference. Proves
  // deduplication (one entry, four facts, four codes) and
  // MISSING_INPUT_ORDER together, now against a resolvable intended
  // aircraft so it exercises classifyForCurrency rather than the
  // upstream intended-aircraft gates D-13 above already covers.
  var d13b = evaluateGeneralExperience({ asOf: ASOF, airmanUserId: AIRMAN, intendedAircraft: N1V,
    entries: [mkEntry("d13b-0", { entryDate: "2026-06-01", dayTakeoffs: 3, dayLandingsFullStop: 3, airmanUserId: null, role: null, soleManipulator: null, aircraft: null })] });
  checkResult("D-13b", "four per-entry gates at once, deduplicated, in MISSING_INPUT_ORDER", d13b, {
    status: "insufficient_data",
    missing: ["airman_unattributed", "role_unrecorded", "sole_manipulator_unrecorded", "aircraft_unregistered"],
  });

  var threwEmpty = false, threwSlash = false;
  try { evaluateCurrency(baseCurrencyInput({ asOf: "" })); } catch (e) { threwEmpty = e instanceof InvalidAsOfDateError; }
  try { evaluateCurrency(baseCurrencyInput({ asOf: "07/08/2026" })); } catch (e) { threwSlash = e instanceof InvalidAsOfDateError; }
  checkField("D-14a", 'asOf "" throws InvalidAsOfDateError, does not return a state', threwEmpty, true);
  checkField("D-14b", 'asOf "07/08/2026" throws InvalidAsOfDateError, does not return a state', threwSlash, true);
}

// =============================================================================
// D-15 / D-16 / D-17 / D-18 / M-4 — sweeps over every tracked result above.
// (D-16, the CURRENCY_DISCLAIMER-travels-with-every-row guarantee, is
// checked at the source level in the outer script — see its own section —
// because CurrencyResult itself carries no "limitations" field; that field
// is added only where recordSnapshots() builds a database row.)
// =============================================================================
section("Sweeps — D-15, D-17, D-18, M-4, over " + allResults.length + " tracked results and " + allCurrencyRuns.length + " evaluateCurrency() runs");
{
  allCurrencyRuns.forEach(function (results, idx) {
    checkField("D-15#" + idx, "evaluateCurrency returns exactly five results", results.length, 5);
    checkField("D-15#" + idx, "in vocabulary order, no card ever omitted", results.map(function (r) { return r.currencyType; }),
      ["passenger_day", "passenger_night", "instrument", "flight_review", "medical"]);
  });

  var allowedHeadlines = ["Estimated current", "Estimated not current", "Not enough information"];
  allResults.forEach(function (r, idx) {
    var tag = r.currencyType + "/" + r.status + "#" + idx;

    var hasMissing = r.missing.length > 0;
    var isInsufficient = r.status === "insufficient_data";
    if (hasMissing === isInsufficient) ok("D-17 " + tag + " missing.length>0 IFF insufficient_data");
    else bad("D-17 " + tag + " missing.length>0 IFF insufficient_data", "missing=" + JSON.stringify(r.missing) + " status=" + r.status);

    var headline = describeResult(r).headline;
    if (allowedHeadlines.indexOf(headline) !== -1) ok("D-18 " + tag + " headline is the locked vocabulary");
    else bad("D-18 " + tag + " headline is the locked vocabulary", "got " + JSON.stringify(headline) + " — contains an unqualified current/legal/compliant/you-may-fly claim");

    if (r.currencyType === "medical") checkField("M-4 " + tag, "medical never estimated_current or estimated_not_current", r.status, "insufficient_data");
  });

  // Extra due-diligence check, beyond the numbered rows: since D-8 found
  // the aircraft_unregistered remedy pointing at a route that does not
  // exist (/aircraft instead of /logbook/aircraft), check whether the
  // other four aircraft-related remedy codes share the same defect —
  // "a pilot who fixes one field and watches a second appear" (D-13's own
  // words) should at least land somewhere real when they click through.
  var aircraftCodes = ["intended_aircraft_absent", "aircraft_unregistered", "aircraft_gear_unrecorded", "aircraft_category_class_unrecorded", "aircraft_type_unrecorded"];
  var sample = describeResult({ status: "insufficient_data", missing: aircraftCodes, currencyType: "passenger_day", ruleBasis: "61.57(a)", window: null, required: {}, observed: {}, counted: [], limitingDate: null, throughDate: null, displayDate: null, notes: [], assumptions: [] });
  var wrongHrefs = sample.remedies.filter(function (m) { return aircraftCodes.indexOf(m.missing) !== -1 && m.href !== "/logbook/aircraft"; });
  if (wrongHrefs.length === 0) ok("all five aircraft-related remedies route to /logbook/aircraft");
  else bad("all five aircraft-related remedies route to /logbook/aircraft", wrongHrefs.length + " of 5 point elsewhere: " + JSON.stringify(wrongHrefs.map(function (m) { return m.missing + " -> " + m.href; })));
}

console.log("\\n##HALF_A_SUMMARY## passed=" + passed + " failed=" + failed);
`;

// =============================================================================
// HALF B — the snapshot table's database contract.
// =============================================================================

function runHalfB() {
  const ADMIN_URL = process.env.CURRENCY_VERIFY_URL ?? "postgresql://postgres@127.0.0.1:55432/postgres";
  const DB = "v1_currency_verify";
  const work = mkdtempSync(join(tmpdir(), "currency-verify-db-"));

  let passed = 0;
  let failed = 0;
  const note = (...a) => console.log(...a);
  function ok(label) {
    passed++;
    note(`  ok    ${label}`);
  }
  function bad(label, detail) {
    failed++;
    note(`  FAIL  ${label}\n          ${String(detail).split("\n").join("\n          ")}`);
  }

  function psql(url, sql) {
    const file = join(work, "q.sql");
    writeFileSync(file, sql);
    try {
      const out = execFileSync(
        "psql",
        ["-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1", url, "-f", file],
        { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
      );
      return { ok: true, out: out.trim(), sqlstate: null };
    } catch (error) {
      const stderr = String(error.stderr ?? "");
      const m = /\bERROR:\s+([0-9A-Z]{5}):/.exec(stderr);
      return { ok: false, out: "", sqlstate: m?.[1] ?? null, stderr };
    }
  }

  const DB_URL = () => `${ADMIN_URL.replace(/\/[^/]*$/, "")}/${DB}`;

  function asTenant(userId, sql) {
    return psql(
      DB_URL(),
      `\\set VERBOSITY verbose
begin;
set local role authenticated;
do $$ begin perform set_config('request.jwt.claims', '{"sub":"${userId}","role":"authenticated"}', true); end $$;
${sql}
rollback;`
    );
  }

  function asAdmin(sql, label) {
    const r = psql(DB_URL(), `\\set VERBOSITY verbose\nset role service_role;\n${sql}`);
    if (!r.ok && label) bad(`fixture: ${label}`, r.stderr?.slice(0, 400));
    return r;
  }

  function refuses(label, userId, sql, expectedSqlstate) {
    const r = asTenant(userId, sql);
    if (r.ok) {
      bad(label, "the statement SUCCEEDED — the control under test is not working");
      return;
    }
    if (r.sqlstate !== expectedSqlstate) {
      bad(label, `expected SQLSTATE ${expectedSqlstate}, got ${r.sqlstate ?? "(none parsed)"}\n${r.stderr?.slice(0, 400)}`);
      return;
    }
    ok(`${label}  [${expectedSqlstate}]`);
  }

  function equals(label, actual, expected) {
    if (String(actual).trim() === String(expected)) ok(label);
    else bad(label, `expected ${JSON.stringify(String(expected))}, got ${JSON.stringify(String(actual).trim())}`);
  }

  console.log("\n=== Half B: pilot.currency_snapshots (database contract) ===\n");

  const BOOTSTRAP = process.env.CURRENCY_VERIFY_BOOTSTRAP;
  if (!BOOTSTRAP) {
    note("Half B SKIPPED — set CURRENCY_VERIFY_BOOTSTRAP to the Supabase-shaped");
    note("  scaffold (roles anon/authenticated/service_role, schema auth with");
    note("  auth.uid(), an extensions schema, a storage stub). Nothing about");
    note("  the engine is broken by this skip — Half A already ran above.");
    note("  NONE of S-1..S-17 (CHECK constraints, RLS refusals, cross-tenant");
    note("  isolation, row locks, the latest-view security_invoker proof) ran.");
    halfBSkipped = true;
    return;
  }

  try {
    execFileSync("psql", ["-X", "-q", ADMIN_URL, "-c", `drop database if exists ${DB}`], { stdio: "pipe" });
    execFileSync("psql", ["-X", "-q", ADMIN_URL, "-c", `create database ${DB}`], { stdio: "pipe" });
  } catch (error) {
    note(`Half B SKIPPED — no Postgres at ${ADMIN_URL}\n  ${String(error.stderr ?? error).slice(0, 200)}`);
    note("  NONE of S-1..S-17 (CHECK constraints, RLS refusals, cross-tenant");
    note("  isolation, row locks, the latest-view security_invoker proof) ran.");
    halfBSkipped = true;
    rmSync(work, { recursive: true, force: true });
    return;
  }

  try {
    execFileSync("psql", ["-X", "-q", "-v", "ON_ERROR_STOP=1", DB_URL(), "-f", BOOTSTRAP], { stdio: "pipe" });
    const migrations = execFileSync("ls", ["supabase/migrations"], { encoding: "utf8", cwd: REPO_ROOT })
      .trim()
      .split("\n")
      .filter((f) => f.endsWith(".sql"))
      .sort();
    for (const file of migrations) {
      execFileSync(
        "psql",
        ["-X", "-q", "-v", "ON_ERROR_STOP=1", DB_URL(), "-f", join(REPO_ROOT, "supabase/migrations", file)],
        { stdio: "pipe" }
      );
    }
    note(`Replayed ${migrations.length} migrations onto a scratch database.\n`);
  } catch (error) {
    note("Half B FAILED — the migrations do not replay cleanly.");
    note(String(error.stderr ?? error).slice(0, 2000));
    totalFailed += 1;
    rmSync(work, { recursive: true, force: true });
    return;
  }

  // ---------------------------------------------------------------------
  // Two synthetic tenants. A carries a second member for S-9 (a
  // business account really can have two seats — 61.57/61.56 are
  // per-airman duties, which is the whole reason airman_user_id exists
  // on this table at all).
  // ---------------------------------------------------------------------
  const A = { user: "11111111-1111-4111-8111-111111111111", user2: "11111111-1111-4111-8111-111111111112", account: "aaaaaaaa-0000-4000-8000-000000000001" };
  const B = { user: "22222222-2222-4222-8222-222222222222", account: "bbbbbbbb-0000-4000-8000-000000000002" };

  const seed = psql(
    DB_URL(),
    `\\set VERBOSITY verbose
insert into auth.users (id, email) values
  ('${A.user}', 'synthetic-a@example.invalid'),
  ('${A.user2}', 'synthetic-a2@example.invalid'),
  ('${B.user}', 'synthetic-b@example.invalid');

set role service_role;

insert into pilot.accounts (id, kind, legal_name) values
  ('${A.account}', 'business', 'Synthetic Alpha Air'),
  ('${B.account}', 'solo', 'Synthetic Bravo Air');

insert into pilot.account_members (account_id, user_id, role) values
  ('${A.account}', '${A.user}', 'owner'),
  ('${A.account}', '${A.user2}', 'member'),
  ('${B.account}', '${B.user}', 'owner');
`
  );
  if (!seed.ok) {
    note("Half B FAILED — the fixtures did not seed.");
    note(String(seed.stderr).slice(0, 2000));
    totalFailed += 1;
    rmSync(work, { recursive: true, force: true });
    return;
  }

  const DISCLAIMER =
    "Currency is calculated from the entries you logged and is a planning aid, not a determination of regulatory compliance. You remain responsible for your own currency and airworthiness decisions.";

  // A fully valid row, as a set of column -> literal overrides. Every S-1..S-8
  // negative below overrides EXACTLY ONE field from this baseline, so a
  // failure is unambiguous: it can only be the one CHECK named in the
  // label, never a second violation riding along uncontrolled.
  const COLUMNS = [
    "account_id", "airman_user_id", "currency_type", "status", "rule_basis", "as_of",
    "window_start", "window_end", "through_date", "limiting_item", "limiting_date",
    "counts", "counted_entry_ids", "missing_inputs", "limitations",
  ];
  function validRow(overrides) {
    const defaults = {
      account_id: `'${A.account}'`,
      airman_user_id: `'${A.user}'`,
      currency_type: "'passenger_day'",
      status: "'estimated_current'",
      rule_basis: "'61.57(a)'",
      as_of: "current_date",
      window_start: "current_date - 10",
      window_end: "current_date",
      through_date: "null",
      limiting_item: "'3 of 3 takeoffs, 3 of 3 landings'",
      limiting_date: "current_date - 10",
      counts: "'{}'::jsonb",
      counted_entry_ids: "'{}'::uuid[]",
      missing_inputs: "'{}'::text[]",
      limitations: `'${DISCLAIMER}'`,
    };
    const values = Object.assign(defaults, overrides || {});
    return `insert into pilot.currency_snapshots (${COLUMNS.join(", ")}) values (${COLUMNS.map((c) => values[c]).join(", ")});`;
  }

  note("A valid write, as the baseline every S-check below deviates from by exactly one field");
  {
    const good = asTenant(A.user, `${validRow()}\nselect count(*) from pilot.currency_snapshots;`);
    equals("a fully valid row is accepted", good.out, "1");
  }

  note("\nCHECK constraints — the vocabulary and the disclaimer are enforced in the database, not only in TypeScript");
  {
    refuses("S-1 limitations = '' — NOT NULL alone does not carry the disclaimer", A.user, validRow({ limitations: "''" }), "23514");
    refuses("S-2 limitations = '   ' — btrim is the half that makes it true", A.user, validRow({ limitations: "'   '" }), "23514");
    refuses("S-3 status = 'current' — the hedged vocabulary is enforced here, not just in TS", A.user, validRow({ status: "'current'" }), "23514");
    refuses("S-4 currency_type = 'night_passenger' (misspelled)", A.user, validRow({ currency_type: "'night_passenger'" }), "23514");
    refuses("S-5 insufficient_data with missing_inputs '{}' — no remedy, no row", A.user, validRow({ status: "'insufficient_data'", missing_inputs: "'{}'::text[]" }), "23514");
    refuses("S-6 estimated_current with missing_inputs '{x}' — the converse", A.user, validRow({ missing_inputs: "'{x}'::text[]" }), "23514");
    refuses("S-7 currency_type medical with status estimated_current", A.user, validRow({ currency_type: "'medical'", rule_basis: "'61.23'" }), "23514");
    refuses("S-8 estimated_current with window_start null — no arithmetic to hand-check", A.user, validRow({ window_start: "null" }), "23514");
  }

  note("\nRLS — writes");
  {
    refuses("S-9 airman_user_id set to another member's uuid", A.user, validRow({ airman_user_id: `'${A.user2}'` }), "42501");
    refuses("S-10 UPDATE as authenticated — there is no UPDATE grant at all", A.user, `update pilot.currency_snapshots set status = 'estimated_not_current' where account_id = '${A.account}';`, "42501");
    refuses("S-11 DELETE as authenticated — there is no DELETE grant at all", A.user, `delete from pilot.currency_snapshots where account_id = '${A.account}';`, "42501");
  }

  note("\nTenancy");
  let seededId = null;
  {
    const seedRow = asAdmin(`${validRow()} select id from pilot.currency_snapshots order by created_at desc limit 1;`, "tenant A's currency snapshot");
    seededId = seedRow.out;
    const mine = asTenant(A.user, `select count(*) from pilot.currency_snapshots where id = '${seededId}';`);
    equals("S-12a tenant A's own snapshot is PRESENT", mine.out, "1");
    const theirs = asTenant(B.user, `select count(*) from pilot.currency_snapshots where id = '${seededId}';`);
    equals("S-12b tenant B sees none of it", theirs.out, "0");
  }

  note("\nRow locks");
  {
    refuses("S-13 SELECT ... FOR UPDATE — a SELECT+INSERT-only table cannot be locked", A.user, `select * from pilot.currency_snapshots where id = '${seededId}' for update;`, "42501");
  }

  note("\nThe expiry ladder");
  {
    const gaps = asTenant(A.user, `select count(*) from pilot.expiration_coverage_gaps();`);
    equals("S-14 through_date was not named expires_on and did not silently join the ladder", gaps.out, "0");
  }

  note("\nThe latest-per-airman view");
  {
    asAdmin(`${validRow()}\n${validRow()}`, "two more snapshots for the same (airman, type, as_of) as S-12's row");
    const total = asTenant(A.user, `select count(*) from pilot.currency_snapshots where account_id = '${A.account}' and airman_user_id = '${A.user}' and currency_type = 'passenger_day';`);
    equals("three snapshots exist for the same as_of (fixture sanity check)", total.out, "3");
    const latest = asTenant(A.user, `select count(*) from pilot.currency_snapshots_latest where account_id = '${A.account}' and airman_user_id = '${A.user}' and currency_type = 'passenger_day';`);
    equals("S-15 the view returns exactly one row for that (airman, currency_type)", latest.out, "1");
    const theirsLatest = asTenant(B.user, `select count(*) from pilot.currency_snapshots_latest;`);
    equals("S-16 tenant B sees zero rows through the view — security_invoker is actually on it", theirsLatest.out, "0");
  }

  note("\nProvenance columns cannot be forged through a direct POST");
  {
    const forgeCols = ["account_id", "airman_user_id", "currency_type", "status", "rule_basis", "as_of", "window_start", "window_end", "limiting_item", "limiting_date", "counts", "counted_entry_ids", "missing_inputs", "limitations"];
    const forgeVals = [`'${A.account}'`, `'${A.user}'`, "'passenger_day'", "'estimated_current'", "'61.57(a)'", "current_date", "current_date - 10", "current_date", "'x'", "current_date - 10", "'{}'::jsonb", "'{}'::uuid[]", "'{}'::text[]", `'${DISCLAIMER}'`];
    refuses(
      "S-17a insert setting id explicitly",
      A.user,
      `insert into pilot.currency_snapshots (id, ${forgeCols.join(", ")}) values (gen_random_uuid(), ${forgeVals.join(", ")});`,
      "42501"
    );
    refuses(
      "S-17b insert setting computed_at explicitly",
      A.user,
      `insert into pilot.currency_snapshots (computed_at, ${forgeCols.join(", ")}) values (now(), ${forgeVals.join(", ")});`,
      "42501"
    );
    refuses(
      "S-17c insert setting created_at explicitly",
      A.user,
      `insert into pilot.currency_snapshots (created_at, ${forgeCols.join(", ")}) values (now(), ${forgeVals.join(", ")});`,
      "42501"
    );
  }

  try {
    execFileSync("psql", ["-X", "-q", ADMIN_URL, "-c", `drop database if exists ${DB}`], { stdio: "pipe" });
  } catch {
    // A leftover scratch database is untidy, not a failure of the thing under test.
  }
  rmSync(work, { recursive: true, force: true });

  totalPassed += passed;
  totalFailed += failed;
  note(failed === 0 ? `\nHalf B passed — ${passed} checks` : `\nHalf B FAILED — ${failed} of ${passed + failed} checks`);
}

// =============================================================================
runHalfA();
runHalfB();

// SEC-3: a bootstrap-less run must never read as a full pass. Half B (every
// database-contract assertion — CHECK constraints, RLS refusals, cross-tenant isolation,
// row locks, the latest-view security_invoker proof) contributes zero to totalFailed when
// skipped, so the word SKIPPED has to appear in this line itself, not just in Half B's own
// console output above, or a reader who only checks the final line never sees it.
console.log(
  totalFailed === 0
    ? halfBSkipped
      ? `\ncurrency:verify passed — ${totalPassed} checks — Half A ONLY. Half B SKIPPED: the database contract (CHECK constraints, RLS, cross-tenant isolation, row locks) was NOT verified. Set CURRENCY_VERIFY_BOOTSTRAP to run it.`
      : `\ncurrency:verify passed — ${totalPassed} checks`
    : `\ncurrency:verify FAILED — ${totalFailed} of ${totalPassed + totalFailed} checks`
);
process.exit(totalFailed === 0 ? 0 : 1);

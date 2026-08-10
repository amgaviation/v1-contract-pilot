#!/usr/bin/env node
/**
 * Logbook verification (docs/PLAN.md `npm run logbook:verify`):
 *
 *   - a ForeFlight-shaped CSV, a LogTen Pro-shaped CSV and a generic
 *     column-mapped CSV each import;
 *   - a row the parser cannot place is REJECTED, not dropped — it shows up
 *     in the same `rejected` list the import workspace renders;
 *   - dedup by row fingerprint: importing the same file twice does not
 *     double-enter the logbook;
 *   - trip-derived and manual entries BYPASS fingerprinting entirely — they
 *     are not imports, and the partial unique index that does the deduping
 *     never even indexes them;
 *   - nothing reaches pilot.logbook_entries without an explicit confirm.
 *     The draft itself is never a stored row (app/(app)/logbook/drafts/
 *     page.tsx computes it at read time); logbook_entries_trip_leg_uniq is
 *     what makes that safe under a race between two confirm clicks. See
 *     20260805220000_phase6_logbook.sql's header for both.
 *
 * TWO KINDS OF GUARANTEE, TWO KINDS OF PROBE.
 * ---------------------------------------------------------------------------
 * "A ForeFlight/LogTen/generic file imports" and "a bad row is rejected,
 * not dropped" are guarantees of the PARSER (lib/logbook-import/*.ts) — no
 * database involved, so they run unconditionally, the same way
 * scripts/foreflight-import-verify.mjs does: spawn a child `node
 * --experimental-strip-types` process that imports the real parser code
 * against a synthetic fixture and reports back as JSON.
 *
 * "Dedup by fingerprint", "manual/trip bypass it", and "nothing lands
 * without a confirm" are guarantees of the DATABASE — a partial unique
 * index, a CHECK, and (for the "nothing lands automatically" half) the
 * simple fact that no trigger on trips/trip_legs exists to write one. Those
 * are asserted the way scripts/aircraft-verify.mjs and
 * scripts/estimates-verify.mjs assert their guarantees: replayed from the
 * real migrations onto a scratch database, driven as `authenticated` with a
 * real auth.uid(), inside transactions that roll back. Read either of
 * those files' headers for the reasoning behind the harness shape reused
 * here; it is not repeated below. This script does NOT call confirmImport
 * or confirmLegDraft (app/(app)/logbook/import/actions.ts,
 * app/(app)/logbook/actions.ts) — those are Next.js server actions that
 * need a live app and a signed-in session. It drives the same INSERT
 * shapes those actions issue, directly against Postgres, which is what
 * every other schema-guarantee verify script in this repo does instead of
 * standing up the app.
 *
 * THE TWO FAILURE MODES THIS SCRIPT IS WRITTEN TO AVOID, same as the
 * siblings above:
 *   1. Treating "no rows" as proof of isolation/dedup. Every positive read
 *      here asserts the row it expects is PRESENT, so a query that returns
 *      nothing for the wrong reason fails instead of passing quietly.
 *   2. Treating "an error happened" as proof of a refusal. Every negative
 *      case asserts a SPECIFIC SQLSTATE by name — 23505 for the two
 *      partial unique indexes this feature depends on.
 *
 * All fixtures are synthetic. No live pilot data, ever.
 *
 *   npm run logbook:verify
 *
 * The database half needs a local Postgres and a bootstrap SQL file (same
 * Supabase-shaped scaffold the other scratch-DB verify scripts use — roles
 * anon/authenticated/service_role, schema auth with auth.uid(), an
 * extensions schema, a storage stub). Set LOGBOOK_VERIFY_BOOTSTRAP to that
 * file's path to run it; LOGBOOK_VERIFY_URL overrides the default admin
 * connection (postgresql://postgres@127.0.0.1:55432/postgres). Without
 * LOGBOOK_VERIFY_BOOTSTRAP the parser half still runs — it needs no
 * database — and the database half is skipped with a clear note about
 * which guarantees were not checked in that run.
 */

import { execFileSync, spawnSync } from "node:child_process";
import { writeFileSync, rmSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

let failures = 0;
function check(label, cond) {
  if (cond) {
    console.log(`  ok    ${label}`);
  } else {
    console.log(`  FAIL  ${label}`);
    failures += 1;
  }
}
const note = (...a) => console.log(...a);

// =============================================================================
// PART 1 — the parser: three import shapes, and a rejected row that surfaces.
// =============================================================================
note("logbook:verify — parser (no database required)");

const repoRoot = new URL("..", import.meta.url).pathname;
const parserWork = mkdtempSync(join(tmpdir(), "logbook-verify-parser-"));
const runnerPath = join(parserWork, "run.mts");

// Every value below is invented for this script — synthetic tail numbers,
// dates and airport pairings, none of them a real pilot's data.
writeFileSync(
  runnerPath,
  `
import { parseForeflight } from ${JSON.stringify(join(repoRoot, "lib/logbook-import/foreflight.ts"))};
import { parseLogTen } from ${JSON.stringify(join(repoRoot, "lib/logbook-import/logten.ts"))};
import { parseGenericHeader, applyGenericMapping } from ${JSON.stringify(join(repoRoot, "lib/logbook-import/generic.ts"))};
import { rowFingerprint } from ${JSON.stringify(join(repoRoot, "lib/logbook-import/fingerprint.ts"))};

// ---- ForeFlight-shaped fixture -----------------------------------------
// The 66-column Flights Table header is the real export's own fixed shape
// (lib/logbook-import/foreflight.ts's own comment gives the exact list) —
// not fixture data, so it is reproduced verbatim; the flight VALUES below
// are invented for this script.
const FF_HEADER = [
  "Date", "AircraftID", "From", "To", "Route", "TimeOut", "TimeOff", "TimeOn", "TimeIn",
  "OnDuty", "OffDuty", "TotalTime", "PIC", "SIC", "Night", "Solo", "CrossCountry", "PICUS",
  "MultiPilot", "IFR", "Examiner", "NVG", "NVG Ops", "Distance", "ActualInstrument",
  "SimulatedInstrument", "HobbsStart", "HobbsEnd", "TachStart", "TachEnd", "Holds",
  "Approach1", "Approach2", "Approach3", "Approach4", "Approach5", "Approach6",
  "DualGiven", "DualReceived", "SimulatedFlight", "GroundTraining", "GroundTrainingGiven",
  "InstructorName", "InstructorComments", "Person1", "Person2", "Person3", "Person4",
  "Person5", "Person6", "PilotComments", "Flight Review (FAA)", "IPC (FAA)",
  "Checkride (FAA)", "FAA 61.58 (FAA)", "NVG Proficiency (FAA)", "Takeoff Day",
  "Takeoff Night", "Landing Full-Stop Day", "Landing Full-Stop Night", "DayTakeoffs",
  "DayLandingsFullStop", "NightTakeoffs", "NightLandingsFullStop", "AllLandings",
  "[Numeric]FFS",
];
const FF_IDX = Object.fromEntries(FF_HEADER.map((h, i) => [h, i]));
function ffPad(cells) {
  const out = cells.slice();
  while (out.length < FF_HEADER.length) out.push("");
  return out;
}
function ffRow(cells) {
  return ffPad(cells).join(",");
}
function ffFlight(o) {
  const cells = ffPad([]);
  cells[FF_IDX["Date"]] = o.date;
  cells[FF_IDX["AircraftID"]] = o.tail;
  cells[FF_IDX["From"]] = o.from;
  cells[FF_IDX["To"]] = o.to;
  cells[FF_IDX["TotalTime"]] = o.total;
  cells[FF_IDX["PIC"]] = o.pic ?? "";
  cells[FF_IDX["Night"]] = o.night ?? "";
  cells[FF_IDX["DayTakeoffs"]] = o.dayTakeoffs ?? "";
  cells[FF_IDX["DayLandingsFullStop"]] = o.dayLandings ?? "";
  cells[FF_IDX["NightLandingsFullStop"]] = o.nightLandings ?? "";
  cells[FF_IDX["AllLandings"]] = o.allLandings ?? "";
  return cells.join(",");
}
const ffLines = [
  ffRow(["Aircraft Table"]),
  ffRow(["AircraftID", "TypeCode", "Year", "Make", "Model", "GearType", "EngineType", "equipType (FAA)"]),
  ffRow(["N321QT", "PA34", "2004", "Piper", "Seneca III", "fixed_tricycle", "Piston", "aircraft"]),
  ffRow([]),
  ffRow(["Flights Table "]),
  ffRow(FF_HEADER),
  ffFlight({ date: "2026-02-02", tail: "N321QT", from: "KPWK", to: "KMKE", total: "1.3", pic: "1.3", dayTakeoffs: "1", dayLandings: "1", allLandings: "1" }),
  ffFlight({ date: "2026-02-03", tail: "N321QT", from: "KMKE", to: "KPWK", total: "1.4", pic: "1.4", night: "0.3", dayTakeoffs: "1", nightLandings: "1", allLandings: "1" }),
];
const foreflightResult = parseForeflight(ffLines.join("\\r\\n") + "\\r\\n");

// ---- LogTen Pro-shaped fixture ------------------------------------------
const ltLines = [
  ["Date", "AircraftID", "From", "To", "TotalTime", "PICTime", "SICTime", "Remarks"],
  ["2026-03-11", "N768LT", "KJVL", "KORD", "1.6", "1.6", "", "Synthetic LogTen row one"],
  ["2026-03-12", "N768LT", "KORD", "KJVL", "1.7", "", "1.7", "Synthetic LogTen row two"],
].map((r) => r.join(","));
const logtenResult = parseLogTen(ltLines.join("\\r\\n") + "\\r\\n");

// ---- Generic column-mapped fixture, plus the rejected-row case ---------
// A pilot's own hand-picked mapping (suggestMapping is only ever a
// starting guess a pilot can override — see generic.ts's header), and one
// row this mapping cannot place: an unrecognizable date. This third row is
// what proves rejection SURFACES rather than vanishing — the same
// applyMapping() code every format shares (apply-mapping.ts) is what does
// the rejecting, so this one case stands for all three formats.
const genHeader = ["Flight Date", "Tail Number", "Departure", "Arrival", "Hobbs Total", "PIC Hours", "Role", "Notes"];
const genRows = [
  ["2026-04-05", "N55CP", "KRFD", "KDPA", "1.1", "1.1", "PIC", "Synthetic generic row one"],
  ["2026-04-06", "N55CP", "KDPA", "KRFD", "1.2", "1.2", "PIC", "Synthetic generic row two"],
  ["not-a-real-date", "N55CP", "KDPA", "KRFD", "1.0", "1.0", "PIC", "This row's date cannot be read"],
];
const genText = [genHeader, ...genRows].map((r) => r.join(",")).join("\\r\\n") + "\\r\\n";
const genParsedHeader = parseGenericHeader(genText);
let genericResult;
if ("error" in genParsedHeader) {
  genericResult = { error: genParsedHeader.error };
} else {
  const mapping = ["entry_date", "aircraft_ident", "from_icao", "to_icao", "total_time", "pic_time", "role", "remarks"];
  genericResult = applyGenericMapping(genParsedHeader.header, genParsedHeader.dataRecords, mapping);
}

// ---- rowFingerprint: same flight (case-only difference) vs. a genuinely
// different one (total_time changed) ----
const fpFlight = { entry_date: "2026-05-01", aircraft_ident: "n123ab", from_icao: "kabc", to_icao: "kdef", total_time: 1.0, role: "PIC" };
const fpSameFlightDifferentCase = { ...fpFlight, aircraft_ident: "N123AB", from_icao: "KABC", to_icao: "KDEF" };
const fpDifferentFlight = { ...fpFlight, total_time: 1.1 };

process.stdout.write(JSON.stringify({
  foreflight: foreflightResult,
  logten: logtenResult,
  generic: genericResult,
  fp: {
    flight: rowFingerprint(fpFlight),
    sameFlightDifferentCase: rowFingerprint(fpSameFlightDifferentCase),
    differentFlight: rowFingerprint(fpDifferentFlight),
  },
}));
`,
  "utf8"
);

const loaderUrl = pathToFileURL(join(repoRoot, "scripts/lib/ts-extensionless-loader.mjs")).href;
const parserRun = spawnSync(
  process.execPath,
  ["--experimental-strip-types", "--import", loaderUrl, runnerPath],
  { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 }
);
if (parserRun.status !== 0) {
  console.error(parserRun.stdout);
  console.error(parserRun.stderr);
  process.exit(1);
}
const parsed = JSON.parse(parserRun.stdout);
rmSync(parserWork, { recursive: true, force: true });

// --- ForeFlight ---
check(
  "a ForeFlight-shaped CSV imports (2 valid rows, 0 rejected)",
  parsed.foreflight.valid?.length === 2 && parsed.foreflight.rejected?.length === 0
);
const ffByDate = Object.fromEntries((parsed.foreflight.valid ?? []).map((r) => [r.values.entry_date, r]));
check(
  "the ForeFlight row's aircraft type comes from the file's own Aircraft Table",
  ffByDate["2026-02-02"]?.values.aircraft_type === "PA34"
);
check(
  "the ForeFlight row's role is inferred from PIC time, not guessed from nothing",
  ffByDate["2026-02-02"]?.values.role === "PIC" && ffByDate["2026-02-02"]?.roleSource === "inferred"
);

// --- LogTen ---
check(
  "a LogTen Pro-shaped CSV imports (2 valid rows, 0 rejected)",
  parsed.logten.valid?.length === 2 && parsed.logten.rejected?.length === 0
);
const ltByDate = Object.fromEntries((parsed.logten.valid ?? []).map((r) => [r.values.entry_date, r]));
check("LogTen's PICTime column resolves to a PIC role", ltByDate["2026-03-11"]?.values.role === "PIC");
check("LogTen's SICTime column resolves to an SIC role", ltByDate["2026-03-12"]?.values.role === "SIC");

// --- Generic, plus the rejected row ---
check(
  "a generic column-mapped CSV imports its 2 good rows",
  parsed.generic.valid?.length === 2
);
check(
  "and its 1 unreadable row is REJECTED, not silently dropped — every one of the file's 3 rows is accounted for",
  parsed.generic.rejected?.length === 1 &&
    parsed.generic.valid?.length + parsed.generic.rejected?.length === 3
);
check(
  "the rejected row names which row and why, so the pilot sees it — not a swallowed error",
  parsed.generic.rejected?.[0]?.rowNumber === 3 && /date/i.test(parsed.generic.rejected?.[0]?.reason ?? "")
);

// --- rowFingerprint itself ---
check(
  "the same flight fingerprints identically regardless of case",
  parsed.fp.flight === parsed.fp.sameFlightDifferentCase
);
check(
  "a genuinely different flight (different total_time) fingerprints differently",
  parsed.fp.flight !== parsed.fp.differentFlight
);

// =============================================================================
// PART 2 — the database: fingerprint dedup, the manual/trip bypass, and the
// draft-confirm boundary.
// =============================================================================
const ADMIN_URL = process.env.LOGBOOK_VERIFY_URL ?? "postgresql://postgres@127.0.0.1:55432/postgres";
const DB = "v1_logbook_verify";
const BOOTSTRAP = process.env.LOGBOOK_VERIFY_BOOTSTRAP;

note("\nlogbook:verify — database");
if (!BOOTSTRAP) {
  note("  SKIPPED — set LOGBOOK_VERIFY_BOOTSTRAP to the Supabase-shaped scaffold");
  note("  (roles anon/authenticated/service_role, schema auth with auth.uid(),");
  note("  an extensions schema, a storage stub) to check dedup, the manual/trip");
  note("  fingerprint bypass, and the draft-confirm boundary. Nothing about the");
  note("  app is broken by this skip — the parser guarantees above still ran.");
  finish();
}

const work = mkdtempSync(join(tmpdir(), "logbook-verify-db-"));

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
    // psql prefixes diagnostics with "psql:<file>:<line>: ", so an anchored
    // ^ERROR never matches. Match the severity anywhere on the line.
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
function ok(label) {
  note(`  ok    ${label}`);
}
function bad(label, detail) {
  failures++;
  note(`  FAIL  ${label}\n          ${String(detail).split("\n").join("\n          ")}`);
}
function equals(label, actual, expected) {
  if (String(actual).trim() === String(expected)) ok(label);
  else bad(label, `expected ${JSON.stringify(String(expected))}, got ${JSON.stringify(String(actual).trim())}`);
}
/** A negative case: must fail, and fail with THIS SQLSTATE. */
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

try {
  execFileSync("psql", ["-X", "-q", ADMIN_URL, "-c", `drop database if exists ${DB}`], { stdio: "pipe" });
  execFileSync("psql", ["-X", "-q", ADMIN_URL, "-c", `create database ${DB}`], { stdio: "pipe" });
} catch (error) {
  note(`  SKIPPED — no Postgres at ${ADMIN_URL}\n  ${String(error.stderr ?? error).slice(0, 200)}`);
  rmSync(work, { recursive: true, force: true });
  finish();
}

try {
  execFileSync("psql", ["-X", "-q", "-v", "ON_ERROR_STOP=1", DB_URL(), "-f", BOOTSTRAP], { stdio: "pipe" });
  const migrations = execFileSync("ls", ["supabase/migrations"], { encoding: "utf8" })
    .trim()
    .split("\n")
    .filter((f) => f.endsWith(".sql"))
    .sort();
  for (const file of migrations) {
    execFileSync(
      "psql",
      ["-X", "-q", "-v", "ON_ERROR_STOP=1", DB_URL(), "-f", join("supabase/migrations", file)],
      { stdio: "pipe" }
    );
  }
  note(`  Replayed ${migrations.length} migrations onto a scratch database.\n`);
} catch (error) {
  note("  FAILED — the migrations do not replay cleanly.");
  note(String(error.stderr ?? error).slice(0, 2000));
  failures += 1;
  finish();
}

// ---------------------------------------------------------------------------
// One synthetic tenant with a completed trip and two identically-flown legs
// — same date, same route, same hours, the pattern-work-hop shape
// fingerprint.ts's own header names as the case fingerprinting cannot tell
// apart. Exactly the shape that proves the bypass: if trip-derived entries
// were ever fingerprinted like imports, confirming both would collide.
// ---------------------------------------------------------------------------
const A = { user: "11111111-1111-4111-8111-111111111111", account: "aaaaaaaa-0000-4000-8000-000000000001" };

const seed = psql(
  DB_URL(),
  `\\set VERBOSITY verbose
insert into auth.users (id, email) values ('${A.user}', 'synthetic-logbook@example.invalid');
set role service_role;
insert into pilot.accounts (id, kind, legal_name) values ('${A.account}', 'solo', 'Synthetic Logbook Air');
insert into pilot.account_members (account_id, user_id, role) values ('${A.account}', '${A.user}', 'owner');
insert into pilot.trips (id, account_id, starts_on, ends_on, status, aircraft_ident, aircraft_type)
values ('cccccccc-0000-4000-8000-000000000001', '${A.account}', '2026-06-01', '2026-06-01', 'completed', 'N741PW', 'C172');
insert into pilot.trip_legs (id, account_id, trip_id, leg_date, from_icao, to_icao, block_hours)
values
  ('dddddddd-0000-4000-8000-000000000001', '${A.account}', 'cccccccc-0000-4000-8000-000000000001', '2026-06-01', 'KABC', 'KABC', 1.0),
  ('dddddddd-0000-4000-8000-000000000002', '${A.account}', 'cccccccc-0000-4000-8000-000000000001', '2026-06-01', 'KABC', 'KABC', 1.0);`
);
if (!seed.ok) {
  note("  FAILED — the fixtures did not seed.");
  note(String(seed.stderr).slice(0, 2000));
  failures += 1;
  finish();
}
const TRIP = "cccccccc-0000-4000-8000-000000000001";
const LEG1 = "dddddddd-0000-4000-8000-000000000001";
const LEG2 = "dddddddd-0000-4000-8000-000000000002";
// Computed by the real rowFingerprint() in Part 1 above, for the flight
// (2026-05-01, N123AB, KABC, KDEF, 1.0h, PIC) — reused below so the import
// dedup tests exercise the actual hash the app would compute, not a string
// this script made up.
const FP_FLIGHT = parsed.fp.flight;
const FP_DIFFERENT_FLIGHT = parsed.fp.differentFlight;

note("Nothing reaches the logbook without an explicit confirm");
{
  const zero = asTenant(A.user, `select count(*) from pilot.logbook_entries where trip_id = '${TRIP}';`);
  equals("a completed trip with unconfirmed legs has produced zero logbook rows", zero.out, "0");

  // trips and trip_legs carry several triggers of their own (protecting a
  // billed trip's facts, stamping canceled_at, and so on) — none of that is
  // this script's business. What matters here is narrower and directly
  // checkable: does ANY trigger function reachable from these two tables
  // write to logbook_entries? If one ever did, this is where it would show.
  const triggers = asTenant(
    A.user,
    `select count(*) from pg_trigger t
     join pg_class c on c.oid = t.tgrelid
     join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'pilot' and c.relname in ('trips', 'trip_legs')
       and not t.tgisinternal
       and pg_get_functiondef(t.tgfoid) ilike '%logbook_entries%';`
  );
  equals(
    "no trigger on trips or trip_legs mentions logbook_entries at all — a confirmed entry can only ever come from an explicit insert",
    triggers.out,
    "0"
  );
}

note("\nConfirming a trip-derived draft");
{
  const confirmLeg = (legId) => `
    insert into pilot.logbook_entries
      (account_id, airman_user_id, source, trip_id, trip_leg_id,
       entry_date, aircraft_ident, aircraft_type, from_icao, to_icao, role, total_time, pic_time)
    values ('${A.account}', '${A.user}', 'trip', '${TRIP}', '${legId}',
            '2026-06-01', 'N741PW', 'C172', 'KABC', 'KABC', 'PIC', 1.0, 1.0);`;

  const bothConfirmed = asTenant(
    A.user,
    `${confirmLeg(LEG1)} ${confirmLeg(LEG2)}
     select count(*) from pilot.logbook_entries where trip_id = '${TRIP}';`
  );
  equals(
    "two legs flown identically both confirm — trip-derived entries never fingerprint-dedup against each other",
    bothConfirmed.out,
    "2"
  );

  refuses(
    "confirming the same leg a second time is refused — at most one logbook entry per leg, ever",
    A.user,
    `${confirmLeg(LEG1)} ${confirmLeg(LEG1)}`,
    "23505"
  );
}

note("\nManual entries bypass fingerprinting too");
{
  const manualEntry = (remarks) => `
    insert into pilot.logbook_entries
      (account_id, airman_user_id, source, entry_date, aircraft_ident, from_icao, to_icao, role, total_time, pic_time, remarks)
    values ('${A.account}', '${A.user}', 'manual', '2026-06-15', 'N55CP', 'KRFD', 'KRFD', 'PIC', 0.5, 0.5, '${remarks}');`;

  const twiceManual = asTenant(
    A.user,
    `${manualEntry("pattern work, hop 1")} ${manualEntry("pattern work, hop 2")}
     select count(*) from pilot.logbook_entries where source = 'manual' and entry_date = '2026-06-15';`
  );
  equals(
    "two manual entries with the same date/tail/route/time/role both land — logging the same route twice in a day is two flights, not a duplicate",
    twiceManual.out,
    "2"
  );
}

note("\nDedup by row fingerprint — import rows only");
{
  const seedBatchAndFile = `
    insert into pilot.logbook_import_batches (account_id, source_format, status, total_rows)
    values ('${A.account}', 'generic_csv', 'completed', 2);
    insert into pilot.logbook_source_files (account_id, import_batch_id, file_name, row_count)
    select account_id, id, 'synthetic-import.csv', 2 from pilot.logbook_import_batches
     where account_id = '${A.account}' order by created_at desc limit 1;`;
  const importRow = (rowNumber, fingerprint) => `
    insert into pilot.logbook_entries
      (account_id, airman_user_id, source, import_batch_id, source_file_id, source_row_number, row_fingerprint, source_row,
       entry_date, aircraft_ident, from_icao, to_icao, role, total_time, pic_time)
    select '${A.account}', '${A.user}', 'import', b.id, f.id, ${rowNumber}, '${fingerprint}', '{"row":${rowNumber}}'::jsonb,
           '2026-05-01', 'N123AB', 'KABC', 'KDEF', 'PIC', 1.0, 1.0
      from pilot.logbook_import_batches b
      join pilot.logbook_source_files f on f.account_id = b.account_id and f.import_batch_id = b.id
     where b.account_id = '${A.account}' order by b.created_at desc limit 1;`;

  refuses(
    "importing the same row fingerprint twice is refused — this is what stops a re-imported file from doubling every flight",
    A.user,
    `${seedBatchAndFile} ${importRow(1, FP_FLIGHT)} ${importRow(2, FP_FLIGHT)}`,
    "23505"
  );

  const distinctFingerprints = asTenant(
    A.user,
    `${seedBatchAndFile} ${importRow(1, FP_FLIGHT)} ${importRow(2, FP_DIFFERENT_FLIGHT)}
     select count(*) from pilot.logbook_entries where source = 'import';`
  );
  equals(
    "two genuinely different fingerprints both import — the refusal above is dedup, not a blanket second-row rejection",
    distinctFingerprints.out,
    "2"
  );

  const notBlockedByManual = asTenant(
    A.user,
    `insert into pilot.logbook_entries
       (account_id, airman_user_id, source, entry_date, aircraft_ident, from_icao, to_icao, role, total_time, pic_time)
     values ('${A.account}', '${A.user}', 'manual', '2026-05-01', 'N123AB', 'KABC', 'KDEF', 'PIC', 1.0, 1.0);
     ${seedBatchAndFile}
     ${importRow(1, FP_FLIGHT)}
     select count(*) from pilot.logbook_entries where entry_date = '2026-05-01' and aircraft_ident = 'N123AB';`
  );
  equals(
    "importing a flight already logged manually still lands — the fingerprint index only ever compares an import against other imports",
    notBlockedByManual.out,
    "2"
  );
}

try {
  execFileSync("psql", ["-X", "-q", ADMIN_URL, "-c", `drop database if exists ${DB}`], { stdio: "pipe" });
} catch {
  // A leftover scratch database is untidy, not a failure of the thing under test.
}
rmSync(work, { recursive: true, force: true });

finish();

function finish() {
  note(
    failures === 0
      ? `\nlogbook:verify passed`
      : `\nlogbook:verify FAILED — ${failures} check${failures === 1 ? "" : "s"}`
  );
  process.exit(failures === 0 ? 0 : 1);
}

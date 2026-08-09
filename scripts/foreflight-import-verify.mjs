#!/usr/bin/env node
// node --experimental-strip-types scripts/foreflight-import-verify.mjs
//
// Verifies lib/logbook-import/foreflight.ts against a FULLY SYNTHETIC
// fixture built to the same shape as a real ForeFlight "Logbook" CSV
// export (BOM, CRLF, 66-wide padded rows, Aircraft Table + "Flights Table "
// sections, both landing-column generations, a multi-approach row, a
// residual/touch-and-go row, and an FFS row). No live pilot data anywhere
// in this file or anything it writes — see docs/PLAN.md's standing rule.
//
// Run via: npm run foreflight-import:verify

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const FLIGHTS_HEADER = [
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
assert.equal(FLIGHTS_HEADER.length, 66, "fixture header must be 66 columns, matching the real export");

function pad66(cells) {
  const out = cells.slice();
  while (out.length < 66) out.push("");
  assert.equal(out.length, 66);
  return out;
}
function row(cells) {
  return pad66(cells).join(",");
}

// col index shortcuts, by name, so the flight rows below read declaratively
const IDX = Object.fromEntries(FLIGHTS_HEADER.map((h, i) => [h, i]));
function flight(overrides) {
  const cells = pad66([]);
  cells[IDX["Date"]] = overrides.date ?? "2026-01-05";
  cells[IDX["AircraftID"]] = overrides.tail ?? "N100AM";
  cells[IDX["From"]] = overrides.from ?? "KAAA";
  cells[IDX["To"]] = overrides.to ?? "KBBB";
  cells[IDX["TotalTime"]] = overrides.total ?? "1.0";
  cells[IDX["PIC"]] = overrides.pic ?? "";
  cells[IDX["SIC"]] = overrides.sic ?? "";
  cells[IDX["Night"]] = overrides.night ?? "";
  cells[IDX["Solo"]] = overrides.solo ?? "";
  cells[IDX["CrossCountry"]] = overrides.xc ?? "";
  cells[IDX["ActualInstrument"]] = overrides.actualInst ?? "";
  cells[IDX["SimulatedInstrument"]] = overrides.simInst ?? "";
  cells[IDX["Holds"]] = overrides.holds ?? "";
  if (overrides.approach1) cells[IDX["Approach1"]] = overrides.approach1;
  if (overrides.approach2) cells[IDX["Approach2"]] = overrides.approach2;
  cells[IDX["DualGiven"]] = overrides.dualGiven ?? "";
  cells[IDX["DualReceived"]] = overrides.dualReceived ?? "";
  cells[IDX["SimulatedFlight"]] = overrides.simFlight ?? "";
  cells[IDX["PilotComments"]] = overrides.pilotComments ?? "";
  cells[IDX["Checkride (FAA)"]] = overrides.checkride ?? "";
  cells[IDX["FAA 61.58 (FAA)"]] = overrides.faa6158 ?? "";
  cells[IDX["Takeoff Day"]] = overrides.takeoffDayLive ?? "";
  cells[IDX["Landing Full-Stop Day"]] = overrides.landingDayLive ?? "";
  cells[IDX["Landing Full-Stop Night"]] = overrides.landingNightLive ?? "";
  cells[IDX["DayTakeoffs"]] = overrides.dayTakeoffsDep ?? "";
  cells[IDX["DayLandingsFullStop"]] = overrides.dayLandingsDep ?? "";
  cells[IDX["NightTakeoffs"]] = overrides.nightTakeoffsDep ?? "";
  cells[IDX["NightLandingsFullStop"]] = overrides.nightLandingsDep ?? "";
  cells[IDX["AllLandings"]] = overrides.allLandings ?? "";
  cells[IDX["[Numeric]FFS"]] = overrides.ffs ?? "";
  return cells.join(",");
}

const lines = [];
lines.push(row(["ForeFlight Logbook Import", "This row is required for importing into ForeFlight. Do not delete or modify."]));
lines.push(row([]));
lines.push(row(["Aircraft Table"]));
lines.push(row(["AircraftID", "TypeCode", "Year", "Make", "Model", "GearType", "EngineType", "equipType (FAA)", "aircraftClass (FAA)", "complexAircraft (FAA)", "taa (FAA)", "highPerformance (FAA)", "pressurized (FAA)"]));
lines.push(row(["N100AM", "C172", "2015", "Cessna", "172S", "fixed_tricycle", "Piston", "aircraft", "airplane_single_engine_land"]));
lines.push(row(["N200AM", "PA31", "1998", "Piper", "Navajo", "fixed_tricycle", "Piston", "aircraft", "airplane_multi_engine_land"]));
lines.push(row(["N999SIM", "", "", "", "Redbird FMX", "", "", "ffs", ""]));
lines.push(row([]));
// The real marker row has a trailing space after "Flights Table" and uses
// ", , , ," (spaces between commas) padding, not plain commas, plus five
// "Deprecated: Do not edit manually" markers over the deprecated
// landing/takeoff columns (DayTakeoffs..AllLandings).
{
  const cells = Array(66).fill(" ");
  cells[0] = "Flights Table ";
  cells[IDX["DayTakeoffs"]] = "Deprecated: Do not edit manually";
  cells[IDX["DayLandingsFullStop"]] = "Deprecated: Do not edit manually";
  cells[IDX["NightTakeoffs"]] = "Deprecated: Do not edit manually";
  cells[IDX["NightLandingsFullStop"]] = "Deprecated: Do not edit manually";
  cells[IDX["AllLandings"]] = "Deprecated: Do not edit manually";
  lines.push(cells.join(","));
}
lines.push(row(FLIGHTS_HEADER));

// Row 1: ordinary PIC flight, deprecated-only landing columns (the common
// real-file shape).
lines.push(flight({
  date: "2026-01-05", tail: "N100AM", pic: "1.0", total: "1.0",
  dayTakeoffsDep: "1", dayLandingsDep: "1", allLandings: "1",
}));

// Row 2: both live and deprecated landing columns present and agreeing.
lines.push(flight({
  date: "2026-01-06", tail: "N100AM", pic: "1.2", total: "1.2", night: "0.3",
  takeoffDayLive: "1", landingDayLive: "1", landingNightLive: "1",
  dayTakeoffsDep: "1", dayLandingsDep: "1", nightLandingsDep: "1",
  allLandings: "2",
}));

// Row 3: multi-approach row (two approaches, counts 1 + 1 = 2).
lines.push(flight({
  date: "2026-01-07", tail: "N200AM", pic: "1.5", total: "1.5",
  actualInst: "0.4", holds: "1",
  approach1: "1;RNAV (GPS) RWY 09;09;KCCC;;",
  approach2: "1;ILS RWY 27;27;KDDD;circle to land;CIRCLE",
  dayLandingsDep: "1", allLandings: "1",
}));

// Row 4: residual landings — AllLandings exceeds the typed full-stop
// columns, i.e. a touch-and-go ForeFlight never itemizes on its own.
lines.push(flight({
  date: "2026-01-08", tail: "N100AM", pic: "0.8", total: "0.8",
  dayTakeoffsDep: "3", dayLandingsDep: "1", allLandings: "3",
}));

// Row 5: FFS session — SimulatedFlight time + [Numeric]FFS hours.
lines.push(flight({
  date: "2026-01-09", tail: "N999SIM", pic: "2.0", total: "2.0",
  simFlight: "2.0", ffs: "2.0",
}));

// Row 6: DualReceived-only — no PIC/SIC signal at all, role must come
// back unresolved (needs_selection), never guessed.
lines.push(flight({
  date: "2026-01-10", tail: "N100AM", total: "1.1", dualReceived: "1.1",
}));

// Row 7: SIC flight, with a Checkride (FAA) flag — surfaced via remarks,
// never auto-creating a documents record.
lines.push(flight({
  date: "2026-01-11", tail: "N200AM", sic: "2.0", total: "2.0",
  checkride: "TRUE", pilotComments: "Type ride",
}));

const FIXTURE = "﻿" + lines.join("\r\n") + "\r\n";

// ---- run the real parser (compiled TS, via --experimental-strip-types) ----
const workDir = mkdtempSync(join(tmpdir(), "ff-verify-"));
const fixturePath = join(workDir, "fixture.csv");
writeFileSync(fixturePath, FIXTURE, "utf8");

const runnerPath = join(workDir, "run.mts");
const repoRoot = new URL("..", import.meta.url).pathname;
writeFileSync(
  runnerPath,
  `
import { readFileSync } from "node:fs";
import { parseForeflight } from ${JSON.stringify(join(repoRoot, "lib/logbook-import/foreflight.ts"))};
const text = readFileSync(${JSON.stringify(fixturePath)}, "utf8");
const result = parseForeflight(text);
process.stdout.write(JSON.stringify(result));
`,
  "utf8"
);

const loaderUrl = pathToFileURL(join(repoRoot, "scripts/lib/ts-extensionless-loader.mjs")).href;
const run = spawnSync(
  process.execPath,
  ["--experimental-strip-types", "--import", loaderUrl, runnerPath],
  {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  }
);
if (run.status !== 0) {
  console.error(run.stdout);
  console.error(run.stderr);
  process.exit(1);
}
const result = JSON.parse(run.stdout);

let failures = 0;
function check(label, cond) {
  if (cond) {
    console.log(`  ok  ${label}`);
  } else {
    console.log(`FAIL  ${label}`);
    failures += 1;
  }
}

console.log("foreflight-import:verify");
console.log(`  parsed: ${result.valid?.length ?? "ERROR"} valid, ${result.rejected?.length ?? "?"} rejected`);
if (result.error) {
  console.log("  parseForeflight returned an error:", result.error);
  process.exit(1);
}

check("all 7 synthetic flight rows parsed (0 rejected)", result.valid.length === 7 && result.rejected.length === 0);

const byDate = Object.fromEntries(result.valid.map((r) => [r.values.entry_date, r]));

// Row 1 — deprecated-only landings feed day_landings_full_stop.
check("row1 day_landings_full_stop from deprecated column", byDate["2026-01-05"]?.values.day_landings_full_stop === 1);
check("row1 role inferred PIC", byDate["2026-01-05"]?.values.role === "PIC" && byDate["2026-01-05"]?.roleSource === "inferred");

// Row 2 — live+deprecated agree; merged value used.
check("row2 day_takeoffs from live column merged into deprecated slot", byDate["2026-01-06"]?.values.day_takeoffs === 1);
check("row2 night_landings_full_stop merged", byDate["2026-01-06"]?.values.night_landings_full_stop === 1);

// Row 3 — approaches summed from Approach1+Approach2 (1 + 1 = 2), types in remarks not approach_type.
check("row3 approaches_count summed to 2", byDate["2026-01-07"]?.values.approaches_count === 2);
check("row3 approach_type left null (free text, not guessed)", byDate["2026-01-07"]?.values.approach_type === null);
check("row3 approach text preserved in remarks", (byDate["2026-01-07"]?.values.remarks ?? "").includes("RNAV (GPS) RWY 09"));

// Row 4 — residual landings surfaced as unclassifiedLandings (touch-and-go).
check("row4 residual/touch-and-go landings surfaced", byDate["2026-01-08"]?.unclassifiedLandings === 2);

// Row 5 — FFS derived device type.
check("row5 simulator_device_type derived as ffs", byDate["2026-01-09"]?.values.simulator_device_type === "ffs");
check("row5 needsSimulatorDeviceType false (resolved, not left for the pilot)", byDate["2026-01-09"]?.needsSimulatorDeviceType === false);

// Row 6 — DualReceived-only: role NOT guessed.
check("row6 role left unresolved (needs_selection), never guessed PIC/SIC", byDate["2026-01-10"]?.values.role === null && byDate["2026-01-10"]?.roleSource === "needs_selection");
check("row6 dual_received_time carried through as a time, not forced into a role", byDate["2026-01-10"]?.values.dual_received_time === 1.1);

// Row 7 — SIC role, FAA event flag surfaced via remarks (never a documents record — this parser has no documents-table access at all).
check("row7 role explicit-inferred SIC", byDate["2026-01-11"]?.values.role === "SIC");
check("row7 Checkride (FAA) flag surfaced in remarks", (byDate["2026-01-11"]?.values.remarks ?? "").includes("TRUE"));

// Aircraft Table lookup feeds aircraft_type (Flights Table has no type column of its own).
check("aircraft_type resolved via Aircraft Table lookup", byDate["2026-01-05"]?.values.aircraft_type === "C172");
check("aircraft_type resolved for second tail", byDate["2026-01-11"]?.values.aircraft_type === "PA31");

console.log(failures === 0 ? "\nPASS" : `\nFAIL (${failures} check${failures === 1 ? "" : "s"})`);
process.exit(failures === 0 ? 0 : 1);

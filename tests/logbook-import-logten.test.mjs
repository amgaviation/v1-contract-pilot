import test from "node:test";
import assert from "node:assert/strict";

const { parseLogTen } = await import("../lib/logbook-import/logten.ts");

/**
 * LogTen Pro CSV import — day takeoffs. All fixtures synthetic.
 *
 * P1 regression: LOGTEN_ALIASES used to map "DayTakeoffs" to "ignore"
 * (stale from before 20260807120000 added the day_takeoffs column), so
 * every LogTen row imported with day_takeoffs=0 — the exact field
 * 61.57(a)(1) counts — and, because the field was then unmapped,
 * unmappedCountLabels appended a false "Not recorded in this file (shown
 * as 0): Day takeoffs" remark to every entry, even though the file
 * recorded it and the importer just dropped it.
 */

const HEADER = [
  "Date",
  "AircraftID",
  "TotalTime",
  "PICTime",
  "DayTakeoffs",
  "DayLandingsFullStop",
];

function csv(rows) {
  return [HEADER.join(","), ...rows.map((r) => r.join(","))].join("\n");
}

test("LogTen's DayTakeoffs column survives import as day_takeoffs, not ignored", () => {
  const text = csv([["2026-08-10", "N447SP", "1.5", "1.5", "3", "2"]]);
  const result = parseLogTen(text);
  assert.equal("error" in result, false, JSON.stringify(result));
  assert.equal(result.valid.length, 1);
  assert.equal(result.rejected.length, 0);
  const row = result.valid[0];
  assert.equal(row.values.day_takeoffs, 3);
});

test("a recorded DayTakeoffs column does not get flagged as unrecorded in remarks", () => {
  const text = csv([["2026-08-10", "N447SP", "1.5", "1.5", "3", "2"]]);
  const result = parseLogTen(text);
  const row = result.valid[0];
  assert.doesNotMatch(row.values.remarks ?? "", /Day takeoffs/);
});

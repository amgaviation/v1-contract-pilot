import test from "node:test";
import assert from "node:assert/strict";

const { applyGenericMapping } = await import("../lib/logbook-import/generic.ts");

/**
 * Import-side time parsing. All fixtures synthetic.
 *
 * P2 regression: every time column funnels through parseTenth
 * (lib/format.ts), whose regex only accepts a bare tenth ("1.4") — it
 * rejects "1:24" (LogTen Pro's hours:minutes display convention) and
 * "1.25" (hundredths some LogTen templates emit) outright, so a file in
 * either shape had essentially every row rejected.
 */

const HEADER = ["Date", "TotalTime", "PICTime"];
const MAPPING = ["entry_date", "total_time", "pic_time"];

function run(totalTime, picTime) {
  return applyGenericMapping(HEADER, [{ fields: ["2026-08-10", totalTime, picTime], raw: "" }], MAPPING);
}

test("h:mm total time converts exactly (minutes/60) when it lands on a tenth", () => {
  const result = run("1:24", "1:24"); // 1 + 24/60 = 1.4 exactly
  assert.equal(result.rejected.length, 0, JSON.stringify(result.rejected));
  assert.equal(result.valid.length, 1);
  assert.equal(result.valid[0].values.total_time, 1.4);
  assert.equal(result.valid[0].values.pic_time, 1.4);
});

test("hundredths that land exactly on a tenth are accepted", () => {
  const result = run("1.40", "1.40");
  assert.equal(result.rejected.length, 0, JSON.stringify(result.rejected));
  assert.equal(result.valid[0].values.total_time, 1.4);
});

test("h:mm that does NOT land on a tenth is rejected, not silently rounded", () => {
  // 1:15 = 1.25h — the column is numeric(4,1) and cannot hold this exactly.
  const result = run("1:15", "");
  assert.equal(result.valid.length, 0);
  assert.equal(result.rejected.length, 1);
  assert.match(result.rejected[0].reason, /Total time/);
});

test("hundredths that don't land on a tenth (1.25) are rejected, not silently rounded", () => {
  const result = run("1.25", "");
  assert.equal(result.valid.length, 0);
  assert.equal(result.rejected.length, 1);
});

test("a plain tenth still parses exactly as before", () => {
  const result = run("1.5", "1.5");
  assert.equal(result.rejected.length, 0);
  assert.equal(result.valid[0].values.total_time, 1.5);
});

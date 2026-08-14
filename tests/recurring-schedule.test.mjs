import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

/**
 * app/(app)/invoices/recurring/actions.ts's `computeDuePeriods` is the
 * Nth-period due-date math for recurring invoices: the anchor's
 * day-of-month clamped to the last day of a shorter month (the
 * 31st-in-a-30-day-month and Feb/leap cases its own header calls out),
 * monthly vs. quarterly stepping, period_start always the first of the
 * month, and the 600-period runaway cap. A clamp bug here bills a client
 * on the wrong date every month, silently — exactly the calendar-month
 * edge class this repo's testing convention singles out for unit tests
 * (tests/README.md: "Fast, deterministic... money parsing, date
 * arithmetic"), and until now it had none.
 *
 * WHY THIS FILE REGISTERS A MODULE HOOK instead of just `import`-ing the
 * action file the way every other tests/*.test.mjs imports real lib code:
 * this repo's own convention (tests/README.md) is "the real .ts sources
 * are exercised directly rather than a re-implementation that could
 * drift" — but actions.ts is a `"use server"` file, and Next.js requires
 * every export from one to be an async function, so it also imports
 * next/cache, next/headers (via lib/supabase/server.ts) and next/navigation
 * (via lib/supabase/entitlements.ts) at module scope even though
 * computeDuePeriods touches none of them. Those subpaths resolve only
 * inside Next's own bundler, not under plain `node --experimental-strip-
 * types` (confirmed: importing the file directly fails with `Cannot find
 * module '.../node_modules/next/cache'`), and `server-only`'s default
 * export THROWS outside the "react-server" condition Next sets. The hook
 * below stubs exactly those four specifiers with harmless no-ops and lets
 * every other import (the "@/" alias, the real lib/format.ts,
 * lib/db-errors.ts, etc.) resolve normally through the SAME
 * ts-extensionless-loader chain `npm run test:unit` already registers —
 * so what runs below is the actual shipped computeDuePeriods, not a copy.
 *
 * If a future refactor extracts the pure period/due-on math into its own
 * lib module (removing the need for this), point the import below at that
 * module and delete this hook — the assertions themselves don't change.
 */
const STUB_MODULES = {
  "next/cache": "export function revalidatePath() {}\nexport function revalidateTag() {}\n",
  "next/headers":
    "export async function cookies() { return { getAll: () => [], get: () => undefined, set: () => {} }; }\nexport async function headers() { return new Map(); }\n",
  "next/navigation":
    "export function redirect(u) { throw new Error('recurring-schedule.test.mjs: unexpected redirect(' + u + ') — computeDuePeriods is pure and should never reach this'); }\n",
  "server-only": "export {};\n",
};
const HOOK_SOURCE = `
const STUB_MODULES = ${JSON.stringify(STUB_MODULES)};
export async function resolve(specifier, context, nextResolve) {
  if (Object.prototype.hasOwnProperty.call(STUB_MODULES, specifier)) {
    return { url: "recurring-schedule-stub:" + specifier, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}
export async function load(url, context, nextLoad) {
  if (url.startsWith("recurring-schedule-stub:")) {
    const specifier = url.slice("recurring-schedule-stub:".length);
    return { format: "module", source: STUB_MODULES[specifier], shortCircuit: true };
  }
  return nextLoad(url, context);
}
`;
register(`data:text/javascript,${encodeURIComponent(HOOK_SOURCE)}`, { parentURL: import.meta.url });

const { computeDuePeriods } = await import("../app/(app)/invoices/recurring/actions.ts");

/** Convenience: schedule_id doesn't matter to the arithmetic. */
function schedule(cadence, anchor_date, end_date = null) {
  return { id: "sched-1", cadence, anchor_date, end_date };
}

test("monthly clamping: Jan 31 anchor lands on the last real day of shorter months", async () => {
  const due = await computeDuePeriods(schedule("monthly", "2026-01-31"), new Set(), "2026-05-01");
  assert.deepEqual(
    due.map((d) => [d.period_start, d.due_on]),
    [
      ["2026-01-01", "2026-01-31"],
      ["2026-02-01", "2026-02-28"], // 2026 is not a leap year
      ["2026-03-01", "2026-03-31"],
      ["2026-04-01", "2026-04-30"],
    ]
  );
});

test("leap year: a Jan 31 anchor clamps to Feb 29 in 2028", async () => {
  const due = await computeDuePeriods(schedule("monthly", "2028-01-31"), new Set(), "2028-03-01");
  assert.deepEqual(
    due.map((d) => [d.period_start, d.due_on]),
    [
      ["2028-01-01", "2028-01-31"],
      ["2028-02-01", "2028-02-29"], // 2028 IS a leap year
    ]
  );
});

test("quarterly: an Oct 31 anchor clamps every third month across a year boundary", async () => {
  const due = await computeDuePeriods(schedule("quarterly", "2026-10-31"), new Set(), "2027-08-01");
  assert.deepEqual(
    due.map((d) => [d.period_start, d.due_on]),
    [
      ["2026-10-01", "2026-10-31"],
      ["2027-01-01", "2027-01-31"], // January has 31 — no clamp needed
      ["2027-04-01", "2027-04-30"], // April has 30 — clamped from 31
      ["2027-07-01", "2027-07-31"], // July has 31 — no clamp needed
    ]
  );
});

test("period_start is always the first of the month, never the anchor's day-of-month", async () => {
  const due = await computeDuePeriods(schedule("monthly", "2026-01-31"), new Set(), "2026-05-01");
  assert.ok(due.length > 0);
  for (const period of due) {
    assert.match(period.period_start, /-01$/, `period_start ${period.period_start} is not the first of its month`);
  }
});

test("N=0 identity: the anchor's own period is due exactly on the anchor date", async () => {
  const due = await computeDuePeriods(schedule("monthly", "2026-06-15"), new Set(), "2026-06-15");
  assert.deepEqual(due, [{ schedule_id: "sched-1", period_start: "2026-06-01", due_on: "2026-06-15" }]);
});

test("already-generated periods are excluded from what's offered as due", async () => {
  const due = await computeDuePeriods(
    schedule("monthly", "2026-01-15"),
    new Set(["2026-02-01"]),
    "2026-04-01"
  );
  assert.deepEqual(
    due.map((d) => d.period_start),
    ["2026-01-01", "2026-03-01"]
  );
});

test("end_date stops generation once a period's due_on would fall past it", async () => {
  const due = await computeDuePeriods(
    schedule("monthly", "2026-01-15", "2026-02-20"),
    new Set(),
    "2026-06-01" // far in the future — end_date, not today, must be the limiter
  );
  assert.deepEqual(
    due.map((d) => d.due_on),
    ["2026-01-15", "2026-02-15"] // March's due_on (03-15) would exceed end_date
  );
});

test("the 600-period runaway cap holds even for a today far beyond it", async () => {
  const due = await computeDuePeriods(schedule("monthly", "1900-01-01"), new Set(), "9999-12-31");
  assert.equal(due.length, 600);
  assert.equal(due[0].period_start, "1900-01-01");
  // 600 months (50 years) after Jan 1900 is Dec 1949 — the 600th and last.
  assert.equal(due[599].period_start, "1949-12-01");
});

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

/**
 * A Vercel Cron request carries `Authorization: Bearer $CRON_SECRET` and NO
 * session cookie. lib/supabase/proxy.ts's `refreshSession` redirects any
 * cookie-less, non-allow-listed request to /login before the route it was
 * headed for ever runs — which is exactly right for a browser, and exactly
 * wrong for a cron: the route authenticates by CRON_SECRET (constant-time
 * compared), which is stronger than a cookie, so gating it behind one just
 * silently kills the scheduled job. Vercel logs a 307/200 (the login page),
 * nothing the route itself would have logged ever appears, and the only
 * visible symptom is a metric that never advances — see
 * app/(app)/settings/reminders-panel.tsx, which keeps claiming "the daily
 * run is switched on" the whole time.
 *
 * This test parses vercel.json's crons[] — the actual source of truth for
 * what Vercel will call unauthenticated — and asserts every path named
 * there is on lib/supabase/proxy.ts's allow-list, mechanically, so a future
 * cron cannot ship blocked the same way /api/reminders/run did.
 */

function cronPaths() {
  const vercelJson = JSON.parse(
    readFileSync(new URL("../vercel.json", import.meta.url), "utf8")
  );
  const crons = Array.isArray(vercelJson.crons) ? vercelJson.crons : [];
  assert.ok(crons.length > 0, "vercel.json has no crons[] — update this test's fixture assumption if that's now intentional");
  return crons.map((c) => c.path);
}

function proxySource() {
  return readFileSync(new URL("../lib/supabase/proxy.ts", import.meta.url), "utf8");
}

// Every exact-match (`normalizedPath === "/x"`) and prefix-match
// (`path.startsWith("/x/")`) allow-list entry in the middleware, extracted
// mechanically rather than hand-copied, so this test does not itself go
// stale the way the thing it is guarding against did.
function allowListEntries(source) {
  const exact = [...source.matchAll(/normalizedPath === "([^"]+)"/g)].map((m) => m[1]);
  const prefixes = [...source.matchAll(/path\.startsWith\("([^"]+)"\)/g)].map((m) => m[1]);
  return { exact, prefixes };
}

function isAllowListed(cronPath, { exact, prefixes }) {
  if (exact.includes(cronPath)) return true;
  return prefixes.some((prefix) => cronPath.startsWith(prefix));
}

test("every cron path in vercel.json is on the middleware allow-list", () => {
  const paths = cronPaths();
  const source = proxySource();
  const entries = allowListEntries(source);

  const missing = paths.filter((p) => !isAllowListed(p, entries));

  assert.deepEqual(
    missing,
    [],
    `These cron paths from vercel.json have no matching entry in ` +
      `lib/supabase/proxy.ts's allow-list, so a live Vercel Cron request ` +
      `(no session cookie) would be 307-redirected to /login and the job ` +
      `would silently never run: ${missing.join(", ")}`
  );
});

test("the reminders cron specifically is allow-listed (the regression this guards)", () => {
  const paths = cronPaths();
  assert.ok(
    paths.includes("/api/reminders/run"),
    "vercel.json no longer schedules /api/reminders/run — update this fixture assumption if intentional"
  );

  const { exact, prefixes } = allowListEntries(proxySource());
  assert.ok(
    exact.includes("/api/reminders/run") ||
      prefixes.some((p) => "/api/reminders/run".startsWith(p)),
    "lib/supabase/proxy.ts does not allow-list /api/reminders/run — the " +
      "cron pass will 307 to /login and never execute"
  );
});

test("the allow-list does not blanket-admit all of /api/ (would defeat the auth gate)", () => {
  const { prefixes } = allowListEntries(proxySource());
  assert.ok(
    !prefixes.includes("/api/") && !prefixes.includes("/api"),
    "the allow-list widened to all of /api/ — every gated API route would " +
      "be reachable without a session"
  );
});

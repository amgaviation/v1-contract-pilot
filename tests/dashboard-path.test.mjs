import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const { DASHBOARD_PATH } = await import("../lib/nav.ts");

const ROOT = fileURLToPath(new URL("..", import.meta.url));

/**
 * WHERE THE DASHBOARD LIVES, asserted mechanically.
 *
 * The history this exists to stop repeating: Overview served at "/" until the
 * public landing page took that path. Seven call sites had spelled the
 * dashboard as the literal "/" — a revalidatePath, a requireAccount, and five
 * redirects — and every one of them kept compiling, kept passing typecheck,
 * and kept passing review, because a route is a string and a string cannot be
 * wrong at build time. An automated reviewer eventually found ONE of the
 * seven, three weeks and one merge later.
 *
 * Six were invisible: app/(marketing)/page.tsx bounces a provisioned session
 * to the dashboard, so a login that redirected to "/" still ARRIVED at
 * Overview, one wasted round trip later. That is correct by accident, and it
 * holds only while the marketing page keeps bouncing — the day someone
 * decides a signed-in pilot should be able to READ the landing page, five
 * redirects silently become dead ends. The seventh had no bounce at all.
 *
 * So this file does not test that seven particular lines were fixed. Fixing
 * named instances is not fixing a class, which is the lesson this repo has now
 * learned three separate times (see lib/supabase/rows.ts's header and
 * lib/currency's six review rounds). It tests the invariant: NO source file
 * outside the marketing surface may name the dashboard by a literal path.
 * There is one string, it lives in lib/nav.ts, and everything else imports it.
 */

const SEARCH_DIRS = ["app", "lib", "components", "scripts"];

/**
 * The three places a bare "/" is legitimately NOT the dashboard, each for a
 * reason that survives the dashboard moving again:
 *
 * - app/(marketing)/** IS the root route. Its own redirects and links spell
 *   "/" because that is genuinely where it serves.
 * - lib/nav.ts is the definition. Something has to hold the string.
 * - lib/supabase/proxy.ts allow-lists "/" as a signed-out surface — that is a
 *   statement about the PUBLIC path, not about the dashboard, and it must
 *   keep saying "/" even if Overview moves again.
 * - app/robots.ts and app/sitemap.ts describe the crawlable public site.
 * - app/not-found.tsx is the ROOT 404, reached signed in or signed out. Its
 *   "Back home" button means the front door, not the dashboard: a signed-out
 *   visitor should land on the landing page, and a signed-in one is carried
 *   on to Overview by app/(marketing)/page.tsx's own redirect. Pointing it at
 *   DASHBOARD_PATH would send a stranger who mistyped a URL straight into a
 *   login wall. This is the one case where the bounce is the feature.
 */
const EXEMPT = [
  "app/(marketing)/",
  "lib/nav.ts",
  "lib/supabase/proxy.ts",
  "app/robots.ts",
  "app/sitemap.ts",
  "app/not-found.tsx",
  // This file. It quotes the forbidden literals in order to forbid them.
  "tests/dashboard-path.test.mjs",
];

/**
 * The four call shapes that mean "go to / refresh the dashboard". Each is
 * matched only in its `"/"`-argument form — `redirect("/trips")` and
 * `revalidatePath("/", "layout")` are both fine and must stay fine.
 *
 * revalidatePath("/", "layout") is deliberately NOT caught: the second
 * argument makes it a whole-tree invalidation rooted at the root layout,
 * which is a different operation from naming a page, and app/(app)/settings/
 * actions.ts uses it correctly to re-render every screen after the account's
 * own details change.
 */
const FORBIDDEN = [
  { pattern: /\bredirect\(\s*["'`]\/["'`]\s*\)/g, what: 'redirect("/")' },
  {
    pattern: /\brevalidatePath\(\s*["'`]\/["'`]\s*\)/g,
    what: 'revalidatePath("/")',
  },
  {
    pattern: /\brequireAccount\(\s*["'`]\/["'`]\s*\)/g,
    what: 'requireAccount("/")',
  },
  {
    pattern: /\bhref=\{?\s*["'`]\/["'`]\s*\}?/g,
    what: 'href="/"',
  },
];

function sourceFiles(dir) {
  const out = [];
  let entries;
  try {
    entries = readdirSync(join(ROOT, dir));
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry === "node_modules" || entry === ".next") continue;
    const abs = join(ROOT, dir, entry);
    const rel = relative(ROOT, abs);
    if (statSync(abs).isDirectory()) {
      out.push(...sourceFiles(rel));
    } else if (/\.(ts|tsx|mjs|js|jsx)$/.test(entry)) {
      out.push(rel);
    }
  }
  return out;
}

test("the dashboard's path is written down exactly once", async (t) => {
  await t.test("lib/nav.ts is the definition", () => {
    // If this ever needs changing, it is a ONE-line change and this whole
    // suite is what proves that.
    assert.equal(DASHBOARD_PATH, "/overview");
    assert.ok(DASHBOARD_PATH.startsWith("/"), "must be an absolute path");
    assert.notEqual(
      DASHBOARD_PATH,
      "/",
      'the root belongs to the marketing page — see app/(marketing)/page.tsx'
    );
  });

  await t.test("no source file names the dashboard by a bare literal", () => {
    const offences = [];

    for (const dir of SEARCH_DIRS) {
      for (const file of sourceFiles(dir)) {
        const normalized = file.split("\\").join("/");
        if (EXEMPT.some((prefix) => normalized.startsWith(prefix))) continue;

        const text = readFileSync(join(ROOT, file), "utf8");
        for (const { pattern, what } of FORBIDDEN) {
          pattern.lastIndex = 0;
          let match;
          while ((match = pattern.exec(text)) !== null) {
            const line = text.slice(0, match.index).split("\n").length;
            offences.push(`${normalized}:${line} — ${what}`);
          }
        }
      }
    }

    assert.deepEqual(
      offences,
      [],
      `These name the dashboard by a literal "/" instead of importing ` +
        `DASHBOARD_PATH from lib/nav.ts. "/" is the public landing page ` +
        `(app/(marketing)/page.tsx), not the dashboard. If one of these ` +
        `genuinely means the marketing root, add it to EXEMPT in this file ` +
        `with a reason.\n\n  ${offences.join("\n  ")}\n`
    );
  });

  await t.test("the nav's Overview entry uses the constant", async () => {
    const { NAV_SECTIONS } = await import("../lib/nav.ts");
    const overview = NAV_SECTIONS.find((s) => s.label === "Overview");
    assert.ok(overview, "Overview must still be in the nav");
    assert.equal(overview.href, DASHBOARD_PATH);
  });
});

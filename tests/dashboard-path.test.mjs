import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const { DASHBOARD_PATH, NAV_SECTIONS, NAV_SETTINGS } = await import("../lib/nav.ts");

const ROOT = fileURLToPath(new URL("..", import.meta.url));

/**
 * WHERE THE DASHBOARD LIVES, asserted mechanically.
 *
 * The history this exists to stop repeating: Overview served at "/" until the
 * public landing page took that path. Seven call sites had spelled the
 * dashboard as the literal "/" — a revalidatePath, a requireAccount, and five
 * redirects — and every one kept compiling, kept passing typecheck, and kept
 * passing review, because a route is a string and a string cannot be wrong at
 * build time. An automated reviewer eventually found ONE of the seven, three
 * weeks and one merge later.
 *
 * Six were invisible: app/(marketing)/page.tsx bounces a provisioned session
 * to the dashboard, so a login that redirected to "/" still ARRIVED at
 * Overview, one wasted round trip later. That is correct by accident, and it
 * holds only while the marketing page keeps bouncing.
 *
 * THE FIRST VERSION OF THIS FILE GOT IT HALF RIGHT, and the same reviewer
 * caught that too. It forbade the OLD literal "/" and said nothing about the
 * CURRENT one, so its own title was false: four executable sites still spelled
 * "/overview" by hand (the landing page's bounce, both wordmark links in the
 * app shell, and the root error boundary's "Back to overview"), and moving
 * DASHBOARD_PATH again would have left every one of them pointing at a route
 * that no longer existed — with this test passing throughout. A guard that
 * only knows the value it was written against is not a guard, it is a record
 * of one migration.
 *
 * So both directions are checked below. The rules are keyed to a MEANING —
 * "this literal is the dashboard" — and exemptions are scoped per rule rather
 * than per file, because app/(marketing)/ is legitimately exempt from the "/"
 * rules (it IS the root) and legitimately NOT exempt from the DASHBOARD_PATH
 * ones (its redirect really does mean the dashboard).
 */

const SEARCH_DIRS = ["app", "lib", "components", "scripts", "tests"];

/**
 * RULE 1 — the OLD value. "/" is the public landing page
 * (app/(marketing)/page.tsx), so naming it in one of these four call shapes
 * means someone is still thinking of it as the dashboard.
 *
 * revalidatePath("/", "layout") is deliberately NOT matched: the second
 * argument makes it a whole-tree invalidation rooted at the root layout,
 * a different operation from naming a page, and app/(app)/settings/actions.ts
 * uses it correctly.
 */
const ROOT_AS_DASHBOARD = {
  name: 'the retired "/" spelling',
  patterns: [
    { pattern: /\bredirect\(\s*["'`]\/["'`]\s*\)/g, what: 'redirect("/")' },
    { pattern: /\brevalidatePath\(\s*["'`]\/["'`]\s*\)/g, what: 'revalidatePath("/")' },
    { pattern: /\brequireAccount\(\s*["'`]\/["'`]\s*\)/g, what: 'requireAccount("/")' },
    { pattern: /\bhref=\{?\s*["'`]\/["'`]\s*\}?/g, what: 'href="/"' },
  ],
  exempt: [
    // These four genuinely mean the ROOT, and must keep saying "/" even if
    // the dashboard moves again.
    "app/(marketing)/", // is the root route
    "lib/supabase/proxy.ts", // allow-lists "/" as a signed-out surface
    "app/robots.ts",
    "app/sitemap.ts",
    // The root 404, reached signed in or signed out. Its "Back home" means
    // the front door: a signed-out visitor should land on the landing page,
    // and a signed-in one is carried on by the marketing page's own redirect.
    // Pointing it at the dashboard would send a stranger who mistyped a URL
    // straight into a login wall. The one case where the bounce is the point.
    "app/not-found.tsx",
    "lib/nav.ts",
    "tests/dashboard-path.test.mjs",
  ],
};

/**
 * RULE 2 — the CURRENT value, whatever it is. This is the half the first
 * version missed. Any quoted occurrence of DASHBOARD_PATH's value outside the
 * exemptions is a literal that will go stale the next time the constant moves.
 *
 * Matching the QUOTED forms only ("/overview", not /overview) is what keeps
 * prose references such as "see app/(app)/overview/page.tsx" from tripping it
 * — those name a SOURCE FILE, which does not move when the route does.
 */
const CURRENT_AS_LITERAL = {
  name: `the current value (${DASHBOARD_PATH}) spelled by hand`,
  patterns: [
    {
      pattern: new RegExp(`["'\`]${DASHBOARD_PATH.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["'\`]`, "g"),
      what: `a quoted "${DASHBOARD_PATH}" literal — import DASHBOARD_PATH instead`,
    },
  ],
  exempt: [
    "lib/nav.ts", // the definition, and its own explanatory comment
    // A fixture for the open-redirect guard. It uses this string as an
    // example of a safe same-origin path, not as a reference to the
    // dashboard, and would stay valid if the dashboard moved.
    "tests/safe-next.test.mjs",
    "tests/dashboard-path.test.mjs",
  ],
};

/**
 * Blanks out comments so only EXECUTABLE text is scanned, replacing each
 * comment character with a space so every byte offset — and therefore every
 * reported line number — stays exactly where it was.
 *
 * Needed because these files explain themselves at length, and a header that
 * says `Overview moved from "/" to "/overview"` is documentation of the very
 * migration this guard enforces, not a violation of it. Without this the rule
 * would punish writing the explanation down.
 *
 * A real lexer rather than a regex, because the cheap version breaks on the
 * two things this codebase is full of: a "//" inside a string (every https://
 * URL in a comment-free line) and a quote inside a comment.
 */
function stripComments(text) {
  let out = "";
  let i = 0;
  const n = text.length;
  const blank = (s) => s.replace(/[^\n]/g, " ");

  while (i < n) {
    const two = text.slice(i, i + 2);

    if (two === "//") {
      const end = text.indexOf("\n", i);
      const stop = end === -1 ? n : end;
      out += blank(text.slice(i, stop));
      i = stop;
      continue;
    }
    if (two === "/*") {
      const end = text.indexOf("*/", i + 2);
      const stop = end === -1 ? n : end + 2;
      out += blank(text.slice(i, stop));
      i = stop;
      continue;
    }

    const ch = text[i];
    if (ch === '"' || ch === "'" || ch === "`") {
      // Copy the string literal through verbatim — its contents are exactly
      // what the rules are looking for.
      const quote = ch;
      let j = i + 1;
      while (j < n) {
        if (text[j] === "\\") {
          j += 2;
          continue;
        }
        if (text[j] === quote) {
          j += 1;
          break;
        }
        // An unterminated single/double quote cannot span a line; bail so a
        // stray apostrophe in ordinary code can't swallow the rest of a file.
        if (quote !== "`" && text[j] === "\n") break;
        j += 1;
      }
      out += text.slice(i, j);
      i = j;
      continue;
    }

    out += ch;
    i += 1;
  }
  return out;
}

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

function offencesFor(rule) {
  const offences = [];
  for (const dir of SEARCH_DIRS) {
    for (const file of sourceFiles(dir)) {
      const normalized = file.split("\\").join("/");
      if (rule.exempt.some((prefix) => normalized.startsWith(prefix))) continue;

      const text = stripComments(readFileSync(join(ROOT, file), "utf8"));
      for (const { pattern, what } of rule.patterns) {
        pattern.lastIndex = 0;
        let match;
        while ((match = pattern.exec(text)) !== null) {
          const line = text.slice(0, match.index).split("\n").length;
          offences.push(`${normalized}:${line} — ${what}`);
        }
      }
    }
  }
  return offences;
}

test("the dashboard's path is written down exactly once", async (t) => {
  await t.test("lib/nav.ts is the definition", () => {
    assert.ok(DASHBOARD_PATH.startsWith("/"), "must be an absolute path");
    assert.notEqual(
      DASHBOARD_PATH,
      "/",
      "the root belongs to the marketing page — see app/(marketing)/page.tsx"
    );
  });

  await t.test("no source file still spells the dashboard as the retired \"/\"", () => {
    assert.deepEqual(
      offencesFor(ROOT_AS_DASHBOARD),
      [],
      `These name the dashboard by a literal "/" instead of importing ` +
        `DASHBOARD_PATH from lib/nav.ts. "/" is the public landing page ` +
        `(app/(marketing)/page.tsx), not the dashboard. If one genuinely ` +
        `means the marketing root, add it to ROOT_AS_DASHBOARD.exempt with ` +
        `a reason.\n\n  ${offencesFor(ROOT_AS_DASHBOARD).join("\n  ")}\n`
    );
  });

  // The rule that makes this a guard rather than a record of one migration:
  // it is written against DASHBOARD_PATH's value, so it moves when the
  // constant moves and fails on whatever was left behind.
  await t.test("no source file spells the CURRENT dashboard path by hand", () => {
    assert.deepEqual(
      offencesFor(CURRENT_AS_LITERAL),
      [],
      `These hardcode the dashboard's current path. Import DASHBOARD_PATH ` +
        `from lib/nav.ts so the next move stays a one-line change — a ` +
        `hardcoded copy would silently point at a route that no longer ` +
        `exists.\n\n  ${offencesFor(CURRENT_AS_LITERAL).join("\n  ")}\n`
    );
  });

  await t.test("the nav's Overview entry uses the constant", () => {
    const overview = NAV_SECTIONS.find((s) => s.label === "Overview");
    assert.ok(overview, "Overview must still be in the nav");
    assert.equal(overview.href, DASHBOARD_PATH);
  });

  // robots.txt used to retype all nine signed-in sections. Deriving them is
  // what makes "every section is disallowed" true by construction; this
  // asserts the derivation was not quietly unwound back into a literal list
  // that a new or moved section could fall out of.
  await t.test("robots.txt disallows every signed-in section, including the dashboard", async () => {
    process.env.VERCEL_ENV = "production";
    const robots = (await import("../app/robots.ts")).default;
    const rules = robots().rules;
    const disallow = Array.isArray(rules.disallow) ? rules.disallow : [rules.disallow];

    for (const section of [...NAV_SECTIONS, NAV_SETTINGS]) {
      assert.ok(
        disallow.includes(section.href),
        `robots.txt does not disallow ${section.href} (${section.label}) — a ` +
          `signed-in screen that a crawler is invited into`
      );
    }
    assert.ok(
      disallow.includes(DASHBOARD_PATH),
      "robots.txt does not disallow the dashboard itself"
    );
  });
});

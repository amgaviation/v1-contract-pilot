import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const { CERTIFICATE_TYPES, CERTIFICATE_LABELS, CERTIFICATE_OPTIONS, NO_CERTIFICATE } =
  await import("../lib/airman.ts");

const ROOT = fileURLToPath(new URL("..", import.meta.url));

/**
 * THE CERTIFICATE VOCABULARY IS WRITTEN DOWN TWICE, ON PURPOSE, AND THIS
 * HOLDS THE TWO COPIES IN STEP.
 *
 * lib/airman.ts is the single TypeScript source for the 14 CFR 61.5(a)(1)
 * pilot certificate levels — the onboarding wizard (both its Select and
 * its server-side membership check) and the Settings "Profile & billing
 * defaults" panel all import it. But the database enforces its own copy:
 * the CHECK constraint on pilot.accounts.certificate_type, added by the
 * migration named below. That copy CANNOT import anything — it is SQL —
 * so drift between the two is a real failure mode: a value added to the
 * TS list but not the CHECK gives a pilot a Select option whose save is
 * refused by Postgres; a value in the CHECK but not the TS list is a
 * legal stored value the UI can neither display nor re-save.
 *
 * The migration file is immutable history — if the vocabulary ever
 * changes, the change arrives as a NEW migration altering the CHECK, plus
 * the matching edit to lib/airman.ts, plus pointing MIGRATION below at
 * the newest migration that defines the constraint. Never edit the
 * shipped SQL.
 *
 * Because shipped SQL is immutable, the test cannot just read the pinned
 * file: a later migration recreating the CHECK with a value added or
 * removed — lib/airman.ts untouched — would leave both directions of the
 * set-equality below comparing against stale SQL and stay green, which is
 * exactly the drift class this file exists to catch. So the test scans
 * every migration for a CHECK definition, requires the newest one found
 * to BE the pinned file, and only then extracts the vocabulary from it —
 * a forgotten repoint fails loudly instead of guarding the wrong file.
 */
const MIGRATIONS_DIR = "supabase/migrations";
const MIGRATION = `${MIGRATIONS_DIR}/20260812400000_account_onboarding_profile.sql`;

/** The executable text `certificate_type in ('student', ...)` — inside a
 * comment-stripped migration it appears only in the column's CHECK
 * constraint. Shared by the scan (which file defines the CHECK?) and the
 * extraction (what values does it allow?). */
const CHECK_PATTERN = /certificate_type\s+in\s*\(([\s\S]*?)\)/i;

/**
 * Blanks SQL line comments so the migration's prose header — which names
 * the certificate levels in English — can never satisfy or confuse the
 * extraction below. Same reasoning as dashboard-path.test.mjs's
 * stripComments; a line-based pass is enough here because the migration
 * contains no string literal with an embedded "--".
 */
function stripSqlComments(sql) {
  return sql
    .split("\n")
    .map((line) => {
      const i = line.indexOf("--");
      return i === -1 ? line : line.slice(0, i);
    })
    .join("\n");
}

test("the certificate vocabulary matches the database CHECK", async (t) => {
  // Scan the whole migrations directory for files defining the CHECK.
  // Migration filenames start with a fixed-width UTC timestamp, so a
  // plain lexicographic sort IS chronological order.
  const definers = readdirSync(join(ROOT, MIGRATIONS_DIR))
    .filter((name) => name.endsWith(".sql"))
    .sort()
    .filter((name) =>
      CHECK_PATTERN.test(
        stripSqlComments(readFileSync(join(ROOT, MIGRATIONS_DIR, name), "utf8"))
      )
    );
  assert.ok(
    definers.length > 0,
    `No migration in ${MIGRATIONS_DIR} contains the certificate_type ` +
      `CHECK's "in (...)" list — the constraint this test guards seems to ` +
      `be gone, or its SQL no longer matches ${CHECK_PATTERN}.`
  );
  const newest = `${MIGRATIONS_DIR}/${definers[definers.length - 1]}`;
  assert.equal(
    newest,
    MIGRATION,
    `The newest migration defining the certificate_type CHECK is ` +
      `${newest}, but this test is pinned to ${MIGRATION}. Point ` +
      `MIGRATION at the newest file (after making the matching ` +
      `lib/airman.ts edit) — the guard is only a guard while it reads ` +
      `the SQL that actually defines the CHECK.`
  );

  const sql = stripSqlComments(readFileSync(join(ROOT, MIGRATION), "utf8"));
  const check = sql.match(CHECK_PATTERN);
  const dbValues = [...check[1].matchAll(/'([^']*)'/g)].map((m) => m[1]);

  await t.test("every UI value is accepted by the database", () => {
    const missing = CERTIFICATE_TYPES.filter((v) => !dbValues.includes(v));
    assert.deepEqual(
      missing,
      [],
      `lib/airman.ts lists certificate values the CHECK constraint does ` +
        `not: ${missing.join(", ")}. The wizard and Settings would offer ` +
        `an option whose save Postgres refuses. A vocabulary change ships ` +
        `as a NEW migration altering the CHECK (verify against eCFR 14 CFR ` +
        `61.5 first) together with the lib/airman.ts edit — then point ` +
        `this test's MIGRATION at the new file.`
    );
  });

  await t.test("every database value is known to the UI", () => {
    const missing = dbValues.filter((v) => !CERTIFICATE_TYPES.includes(v));
    assert.deepEqual(
      missing,
      [],
      `The CHECK constraint accepts certificate values lib/airman.ts does ` +
        `not know: ${missing.join(", ")}. A pilot could hold a stored value ` +
        `the Select can't display — reopening Settings would silently show ` +
        `"Prefer not to say" and the next save would erase it. Add the ` +
        `value (with its label) to lib/airman.ts.`
    );
  });

  await t.test("the list has no duplicates", () => {
    assert.equal(
      new Set(CERTIFICATE_TYPES).size,
      CERTIFICATE_TYPES.length,
      "CERTIFICATE_TYPES repeats a value"
    );
  });

  await t.test("the UI option list is derived, not a drifted copy", () => {
    // "Prefer not to say" first (the NULL presentation), then the six real
    // values in 61.5(a)(1) order — the order lib/airman.ts documents as
    // deliberate. If this fails, someone rebuilt CERTIFICATE_OPTIONS by
    // hand instead of deriving it from CERTIFICATE_TYPES.
    assert.deepEqual(
      CERTIFICATE_OPTIONS.map((o) => o.value),
      [NO_CERTIFICATE, ...CERTIFICATE_TYPES]
    );
    for (const value of CERTIFICATE_TYPES) {
      assert.ok(
        CERTIFICATE_LABELS[value],
        `CERTIFICATE_LABELS is missing a display name for "${value}" — ` +
          `the raw database token would render in the Select`
      );
    }
    assert.ok(
      !dbValues.includes(NO_CERTIFICATE),
      `The UI-only "${NO_CERTIFICATE}" sentinel leaked into the database ` +
        `CHECK — it must post as "" (NULL), never be stored`
    );
  });
});

#!/usr/bin/env node
/**
 * Aircraft registry verification — pilot.aircraft, pilot.logbook_time_by_type
 * and pilot.aircraft_unregistered_idents
 * (supabase/migrations/20260810110000_aircraft_registry.sql).
 *
 * WHY THIS EXISTS AT ALL. The registry's entire value is one claim: that
 * "N447SP", "N-447SP" and "n447sp" are ONE airframe. That claim is a
 * generated column plus a unique constraint — a database guarantee, so it
 * is asserted against a database, replayed from the real migrations onto a
 * scratch copy, driven as the real `authenticated` role with a real
 * auth.uid(), inside a transaction that rolls back. Same harness as
 * scripts/estimates-verify.mjs; read that file's header for the reasoning
 * behind every structural choice here.
 *
 * THE TWO FAILURE MODES THIS IS WRITTEN TO AVOID:
 *   1. Treating "no rows" as proof of isolation. Every positive read
 *      asserts the row it expects is PRESENT, so a query returning nothing
 *      for the wrong reason fails instead of passing quietly.
 *   2. Treating "an error happened" as proof of a refusal. Every negative
 *      case names a SPECIFIC SQLSTATE — 23505 for the unique key that does
 *      the de-duplicating, 42501 for a column the grant withholds, 23514
 *      for a CHECK. A misspelled column must never read as a control
 *      working.
 *
 * The hours assertions are the other half. A time-in-type table that
 * silently drops an unmatched entry understates a pilot's experience on a
 * form an insurance underwriter reads, so "unmatched hours are still
 * counted" is tested as hard as tenancy is.
 *
 * All fixtures are synthetic. No live pilot data, ever.
 *
 *   npm run aircraft:verify
 */
import { execFileSync } from "node:child_process";
import { writeFileSync, rmSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const ADMIN_URL =
  process.env.AIRCRAFT_VERIFY_URL ?? "postgresql://postgres@127.0.0.1:55432/postgres";
const DB = "v1_aircraft_verify";
const work = mkdtempSync(join(tmpdir(), "aircraft-verify-"));

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
    // psql prefixes diagnostics with "psql:<file>:<line>: ", so an anchored
    // ^ERROR never matches. Match the severity anywhere on the line.
    const m = /\bERROR:\s+([0-9A-Z]{5}):/.exec(stderr);
    return { ok: false, out: "", sqlstate: m?.[1] ?? null, stderr };
  }
}

const DB_URL = () => `${ADMIN_URL.replace(/\/[^/]*$/, "")}/${DB}`;

/** Run SQL as a tenant. VERBOSITY verbose is what exposes the SQLSTATE. */
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

/** A negative case: must fail, and fail with THIS SQLSTATE. */
function refuses(label, userId, sql, expectedSqlstate) {
  const r = asTenant(userId, sql);
  if (r.ok) {
    bad(label, "the statement SUCCEEDED — the control under test is not working");
    return;
  }
  if (r.sqlstate !== expectedSqlstate) {
    bad(
      label,
      `expected SQLSTATE ${expectedSqlstate}, got ${r.sqlstate ?? "(none parsed)"}\n${r.stderr?.slice(0, 400)}`
    );
    return;
  }
  ok(`${label}  [${expectedSqlstate}]`);
}

function equals(label, actual, expected) {
  if (String(actual).trim() === String(expected)) ok(label);
  else
    bad(
      label,
      `expected ${JSON.stringify(String(expected))}, got ${JSON.stringify(String(actual).trim())}`
    );
}

// ---------------------------------------------------------------------------
const BOOTSTRAP = process.env.AIRCRAFT_VERIFY_BOOTSTRAP;
if (!BOOTSTRAP) {
  note("aircraft:verify SKIPPED — set AIRCRAFT_VERIFY_BOOTSTRAP to the");
  note("  Supabase-shaped scaffold (roles anon/authenticated/service_role,");
  note("  schema auth with auth.uid(), an extensions schema, a storage stub).");
  note("  Nothing about the app is broken by this skip.");
  process.exit(0);
}

try {
  execFileSync("psql", ["-X", "-q", ADMIN_URL, "-c", `drop database if exists ${DB}`], {
    stdio: "pipe",
  });
  execFileSync("psql", ["-X", "-q", ADMIN_URL, "-c", `create database ${DB}`], { stdio: "pipe" });
} catch (error) {
  note(
    `aircraft:verify SKIPPED — no Postgres at ${ADMIN_URL}\n  ${String(error.stderr ?? error).slice(0, 200)}`
  );
  rmSync(work, { recursive: true, force: true });
  process.exit(0);
}

try {
  execFileSync("psql", ["-X", "-q", "-v", "ON_ERROR_STOP=1", DB_URL(), "-f", BOOTSTRAP], {
    stdio: "pipe",
  });
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
  note(`Replayed ${migrations.length} migrations onto a scratch database.\n`);
} catch (error) {
  note("aircraft:verify FAILED — the migrations do not replay cleanly.");
  note(String(error.stderr ?? error).slice(0, 2000));
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Two synthetic tenants, each with logbook history. Tenant A's history is
// deliberately messy in exactly the way real history is: the same airframe
// written three ways across three entries.
// ---------------------------------------------------------------------------
const A = { user: "11111111-1111-4111-8111-111111111111", account: "aaaaaaaa-0000-4000-8000-000000000001" };
const B = { user: "22222222-2222-4222-8222-222222222222", account: "bbbbbbbb-0000-4000-8000-000000000002" };

const seed = psql(
  DB_URL(),
  `\\set VERBOSITY verbose
insert into auth.users (id, email) values
  ('${A.user}', 'synthetic-a@example.invalid'),
  ('${B.user}', 'synthetic-b@example.invalid');

set role service_role;

insert into pilot.accounts (id, kind, legal_name) values
  ('${A.account}', 'solo', 'Synthetic Alpha Air'),
  ('${B.account}', 'solo', 'Synthetic Bravo Air');

insert into pilot.account_members (account_id, user_id, role) values
  ('${A.account}', '${A.user}', 'owner'),
  ('${B.account}', '${B.user}', 'owner');

-- Tenant A's history is deliberately shaped like real history:
--   * one airframe written three ways
--   * a tail that is never registered, whose type the pilot typed one way
--     and then another (so "most recent" and "lexical max" disagree)
--   * a row whose ident is punctuation only, the shape a CSV import leaves
--   * a full-flight-simulator session logged against a real tail, which
--     61.51(b)(1)(iv) puts in this same field
--   * a session logged under a DEVICE identifier too long to be a
--     registration
insert into pilot.logbook_entries
  (account_id, source, airman_user_id, entry_date, aircraft_ident, aircraft_type, role, total_time, pic_time, sic_time)
values
  ('${A.account}', 'manual', '${A.user}', '2026-01-05', 'N447SP',  'C560',          'PIC', 3.2, 3.2, null),
  ('${A.account}', 'manual', '${A.user}', '2026-02-11', 'N-447SP', 'C560',          'PIC', 2.4, 2.4, null),
  ('${A.account}', 'manual', '${A.user}', '2026-03-19', 'n447sp',  null,            'PIC', 1.4, 1.4, null),
  ('${A.account}', 'manual', '${A.user}', '2026-04-02', 'N912XT',  'Beechjet 400A', 'SIC', 5.0, null, 5.0),
  ('${A.account}', 'manual', '${A.user}', '2026-04-20', 'N912XT',  'BE40',          'SIC', 3.0, null, 3.0),
  ('${A.account}', 'manual', '${A.user}', '2026-04-09', '  -  ',   null,            'PIC', 1.1, 1.1, null),
  ('${A.account}', 'manual', '${A.user}', '2026-05-11', 'FRASCA TRUFLITE 142', null, 'PIC', 1.5, 1.5, null);

-- A wholly-simulator session: role is null and every hour is simulator
-- time, which is the shape 20260810020000's CHECK requires. Logged
-- against N447SP, the way a pilot records recurrent in their own aircraft
-- type.
insert into pilot.logbook_entries
  (account_id, source, airman_user_id, entry_date, aircraft_ident, aircraft_type, role,
   total_time, simulator_time, simulator_device_type)
values
  ('${A.account}', 'manual', '${A.user}', '2026-05-04', 'N447SP', 'C560', null, 4.0, 4.0, 'ffs');

-- Tenant B flies a tail with the SAME normalised key. Two accounts holding
-- one registration is ordinary — the unique key is per account, and if it
-- were not, the first pilot to register a tail would lock out the second.
insert into pilot.logbook_entries
  (account_id, source, airman_user_id, entry_date, aircraft_ident, aircraft_type, role, total_time, pic_time)
values
  ('${B.account}', 'manual', '${B.user}', '2026-05-01', 'N447SP', 'C560', 'PIC', 9.9, 9.9);
`
);
if (!seed.ok) {
  note("aircraft:verify FAILED — the fixtures did not seed.");
  note(String(seed.stderr).slice(0, 2000));
  process.exit(1);
}

// A registry row for tenant A, seeded once so the read-side assertions have
// something to match against. Written as the tenant, not as service_role:
// registering an aircraft is something the pilot does, and if the INSERT
// grant were wrong this is where it would show.
const REGISTER_A = `
insert into pilot.aircraft (account_id, tail_number, type_designator, make_model, gear, category_class)
values ('${A.account}', 'N447SP', 'C560', 'Cessna 560 Citation V', 'tricycle', 'AMEL');`;

note("Normalising the tail number");
{
  const r = asTenant(
    A.user,
    `${REGISTER_A}
     select tail_key from pilot.aircraft where account_id = '${A.account}';`
  );
  equals("tail_key strips punctuation and case-folds", r.out, "N447SP");

  refuses(
    "the same airframe written differently is refused as a duplicate",
    A.user,
    `${REGISTER_A}
     insert into pilot.aircraft (account_id, tail_number)
     values ('${A.account}', 'n-447-sp');`,
    "23505"
  );

  const two = asTenant(
    A.user,
    `${REGISTER_A}
     insert into pilot.aircraft (account_id, tail_number) values ('${A.account}', 'N912XT');
     select count(*) from pilot.aircraft where account_id = '${A.account}';`
  );
  equals("but two genuinely different tails both register", two.out, "2");

  // The generated column cannot drift, because nothing can write it.
  // 428C9 (generated_always), not the 42501 a withheld column grant would
  // give: the rewriter rejects the statement before privileges are even
  // consulted, so the guarantee holds for service_role too.
  refuses(
    "tail_key cannot be written by hand",
    A.user,
    `insert into pilot.aircraft (account_id, tail_number, tail_key)
     values ('${A.account}', 'N447SP', 'SOMETHINGELSE');`,
    "428C9"
  );

  const renamed = asTenant(
    A.user,
    `${REGISTER_A}
     update pilot.aircraft set tail_number = 'N-912-XT' where account_id = '${A.account}';
     select tail_key from pilot.aircraft where account_id = '${A.account}';`
  );
  equals("and it follows a correction to the tail number", renamed.out, "N912XT");
}

note("\nWhat the schema refuses to record");
{
  refuses(
    "a gear type that is not one of the two 61.57(a)(1) cares about",
    A.user,
    `insert into pilot.aircraft (account_id, tail_number, gear)
     values ('${A.account}', 'N447SP', 'nosewheel');`,
    "23514"
  );
  refuses(
    "a type designator that is not an ICAO designator",
    A.user,
    `insert into pilot.aircraft (account_id, tail_number, type_designator)
     values ('${A.account}', 'N447SP', 'Citation 560');`,
    "23514"
  );
  refuses(
    "a tail number that is only whitespace",
    A.user,
    `insert into pilot.aircraft (account_id, tail_number)
     values ('${A.account}', '     ');`,
    "23514"
  );
  // Two characters, so the length CHECK is happy — but it normalises to
  // nothing. One such row takes the account's single `unique (account_id,
  // '')` slot, matches no logbook entry ever, and makes the NEXT one fail
  // with a duplicate error naming an aircraft the pilot cannot find.
  refuses(
    "a tail number that normalises to nothing, however long it is",
    A.user,
    `insert into pilot.aircraft (account_id, tail_number)
     values ('${A.account}', '--');`,
    "23514"
  );

  // gear is nullable ON PURPOSE. A currency engine must be able to tell
  // "this is a tricycle-gear airplane" from "nobody said" — reading the
  // second as the first would tell a tailwheel pilot they are current on
  // touch-and-goes that 61.57(a)(1) does not count.
  const unstated = asTenant(
    A.user,
    `insert into pilot.aircraft (account_id, tail_number) values ('${A.account}', 'N447SP');
     select coalesce(gear, 'not recorded') from pilot.aircraft where account_id = '${A.account}';`
  );
  equals("gear may be left unstated, and reads as unstated", unstated.out, "not recorded");
}

// Runs BEFORE the Tenancy section, deliberately. asAdmin() commits, and
// the registry row it seeds there would register N447SP for real — after
// which the suggestion list correctly stops offering it and every
// assertion below would fail for a reason that has nothing to do with the
// view. Ordering is the fixture isolation here; the rolled-back tenant
// transactions provide the rest.
note("\nThe fleet a pilot already has");
{
  const suggestions = asTenant(
    A.user,
    `select tail_key || '=' || entry_count || '/' || total_time || '/' || last_flown_on
     from pilot.aircraft_unregistered_idents order by tail_key;`
  );
  // Before anything is registered: both real tails are offered, the
  // punctuation-only ident is not, and N447SP is offered ONCE despite
  // being written three ways — which is the reason the registry exists.
  // Before anything is registered: both real tails are offered, once each
  // despite N447SP being written three ways. What is NOT offered is the
  // point — the punctuation-only ident (no key), the "FRASCA TRUFLITE 142"
  // device identifier (too long to be a registration, so registering it
  // would fail on submit and it would be re-offered forever), and the
  // wholly-simulator session, which 61.51(b)(1)(iv) puts in this same
  // field and which is not an airframe at all.
  equals(
    "every unregistered tail is offered once, and nothing is offered that could not be accepted",
    suggestions.out.split("\n").join(" | "),
    "N447SP=3/7.0/2026-03-19 | N912XT=2/8.0/2026-04-20"
  );

  const suggestedType = asTenant(
    A.user,
    `select coalesce(aircraft_type, '(none)') from pilot.aircraft_unregistered_idents
      where tail_key = 'N912XT';`
  );
  // The type the pilot typed MOST RECENTLY. The lexical maximum here is
  // "Beechjet 400A", which the fleet screen would have filed as a make and
  // model — throwing away the correct ICAO designator the pilot had
  // already typed on the newer entry.
  equals("with the type they typed most recently, not the alphabetical one", suggestedType.out, "BE40");

  const label = asTenant(
    A.user,
    `select aircraft_ident from pilot.aircraft_unregistered_idents where tail_key = 'N447SP';`
  );
  // Offered back as the pilot most recently wrote it, not as the key —
  // "n447sp" is what they last typed, and a suggestion that renders as a
  // normalised string reads like the software correcting them.
  equals("shown as the pilot last wrote it", label.out, "n447sp");

  const afterRegistering = asTenant(
    A.user,
    `${REGISTER_A}
     select count(*) from pilot.aircraft_unregistered_idents;`
  );
  equals("registering one drops it from the list", afterRegistering.out, "1");

  const theirs = asTenant(B.user, `select tail_key from pilot.aircraft_unregistered_idents;`);
  equals("and the list is the pilot's own history, nobody else's", theirs.out, "N447SP");
}

note("\nTenancy");
{
  const isolated = asTenant(
    B.user,
    `${REGISTER_A.replace(A.account, A.account)}
     select count(*) from pilot.aircraft;`
  );
  // A's row was inserted inside B's transaction above and would be visible
  // to nobody if RLS worked and to B if it did not — except A's INSERT is
  // itself refused for B, which is the stronger statement. Assert that.
  if (isolated.ok) {
    bad("tenant B cannot register an aircraft into tenant A's fleet", "the INSERT succeeded");
  } else if (isolated.sqlstate !== "42501") {
    bad(
      "tenant B cannot register an aircraft into tenant A's fleet",
      `expected 42501, got ${isolated.sqlstate ?? "(none parsed)"}`
    );
  } else {
    ok("tenant B cannot register an aircraft into tenant A's fleet  [42501]");
  }

  asAdmin(
    `insert into pilot.aircraft (account_id, tail_number, type_designator)
     values ('${A.account}', 'N447SP', 'C560');`,
    "tenant A's registered aircraft"
  );

  const mine = asTenant(A.user, `select count(*) from pilot.aircraft;`);
  equals("tenant A sees their own fleet", mine.out, "1");
  const theirs = asTenant(B.user, `select count(*) from pilot.aircraft;`);
  equals("tenant B sees none of it", theirs.out, "0");

  // Two accounts, one registration number. Ordinary — and if the unique
  // key were global rather than per account, the second pilot to fly a
  // shared airframe could never register it.
  const both = asTenant(
    B.user,
    `insert into pilot.aircraft (account_id, tail_number) values ('${B.account}', 'N447SP');
     select count(*) from pilot.aircraft;`
  );
  equals("and can still register the same tail in their own fleet", both.out, "1");

  refuses(
    "an aircraft cannot be moved to another account",
    A.user,
    `update pilot.aircraft set account_id = '${B.account}' where account_id = '${A.account}';`,
    "42501"
  );

  // Two independent controls say no here — there is no DELETE grant, and
  // the DELETE policy is `using (false)` behind it. The grant is what
  // fires, so 42501 is what a pilot's client would see. Three years of
  // entries get their type from this row; deleting it would silently
  // retype them, which is why retiring an airframe is archived_at.
  refuses(
    "deleting an airframe is not how you retire it — archived_at is",
    A.user,
    `delete from pilot.aircraft where account_id = '${A.account}';`,
    "42501"
  );

  const archived = asTenant(
    A.user,
    `update pilot.aircraft set archived_at = now() where account_id = '${A.account}';
     select count(*) from pilot.aircraft where archived_at is not null;`
  );
  equals("archiving it is allowed, and keeps the row", archived.out, "1");
}

note("\nHours by type");
{
  const grouped = asTenant(
    A.user,
    `select type_label || '=' || total_time || '/sim ' || simulator_time
            || '/pic ' || pic_time || '/sic ' || sic_time
            || '/' || entry_count || '/' || has_registered_aircraft
     from pilot.logbook_time_by_type order by type_label;`
  );
  // N447SP's three flights (3.2 + 2.4 + 1.4 = 7.0) collapse under the
  // registry's C560 — INCLUDING the third, which the pilot left without an
  // aircraft_type at all. That is the whole point: the registry supplies a
  // type the entry never carried.
  //
  // The FFS session is in that group too, and contributes ZERO to
  // total_time while reporting its 4.0 hours as simulator time. Summing
  // total_time would have credited the airframe with four hours it never
  // flew, on the table a pilot copies onto an underwriter's form.
  //
  // N912XT is unregistered, so its hours group under what the pilot typed
  // — TWICE, because they typed two different things. That is the
  // fragmentation the registry exists to end, shown working as designed
  // for a tail nobody has registered yet.
  //
  // The punctuation-only ident and the device identifier both land under
  // Unspecified. Nothing is dropped.
  equals(
    "hours group by type, simulator time is reported separately, nothing is dropped",
    grouped.out.split("\n").join(" | "),
    "BE40=3.0/sim 0/pic 0/sic 3.0/1/false | " +
      "Beechjet 400A=5.0/sim 0/pic 0/sic 5.0/1/false | " +
      "C560=7.0/sim 4.0/pic 7.0/sic 0/4/true | " +
      "Unspecified=2.6/sim 0/pic 2.6/sic 0/2/false"
  );

  const rated = asTenant(
    A.user,
    `update pilot.aircraft set type_rating = 'CE-500' where account_id = '${A.account}';
     select type_label || '=' || total_time from pilot.logbook_time_by_type
      where has_registered_aircraft;`
  );
  // One CE-500 rating covers the Cessna 500/501/550/551/S550/552/560. A
  // pilot who states the rating gets one row for all of it instead of one
  // per ICAO designator — which is how an underwriter and 61.57(a)(1)(ii)
  // both ask the question.
  equals("the FAA type rating wins over the ICAO designator when stated", rated.out, "CE-500=7.0");

  const isolated = asTenant(
    B.user,
    `select coalesce(sum(total_time), 0) from pilot.logbook_time_by_type;`
  );
  equals("and one pilot's hours never appear in another's", isolated.out, "9.9");

  const byTail = asTenant(
    A.user,
    `select entry_count || '/' || total_time || '/sim ' || simulator_time
            || '/pic ' || pic_time || '/' || coalesce(last_flown_on::text, 'never')
     from pilot.aircraft_time_by_tail;`
  );
  // The three spellings again, this time asked per airframe rather than
  // per type — the number an open-pilot warranty is written against when a
  // pilot flies two of the same type for two owners. last_flown_on is
  // 19 MAR, not 04 MAY: a recurrent session in a box is not a day the
  // airframe moved.
  equals(
    "hours attach to the airframe, however the tail was written, and a sim session is not a flight",
    byTail.out,
    "4/7.0/sim 4.0/pic 7.0/2026-03-19"
  );

  const neverFlown = asTenant(
    A.user,
    `insert into pilot.aircraft (account_id, tail_number) values ('${A.account}', 'N999ZZ');
     select entry_count || '/' || total_time || '/' || coalesce(last_flown_on::text, 'never')
     from pilot.aircraft_time_by_tail
     where aircraft_id = (select id from pilot.aircraft where tail_key = 'N999ZZ');`
  );
  // Registered this morning, not flown yet. It must still be in the
  // pilot's own fleet list — an inner join would have made it vanish.
  equals("an airframe added before it is flown reports zero, not nothing", neverFlown.out, "0/0/never");

  // Both tenants hold a registration with the same normalised key, and
  // tenant B has flown theirs. If the join predicate ever loses its
  // account_id term, B's 9.9 hours land on A's airframe and nobody
  // notices, because both numbers stay plausible.
  const sharedKey = asTenant(
    B.user,
    `insert into pilot.aircraft (account_id, tail_number) values ('${B.account}', 'N447SP');
     select total_time from pilot.aircraft_time_by_tail;`
  );
  equals("two accounts, one registration, and neither sees the other's hours", sharedKey.out, "9.9");

  const archivedStillCounts = asTenant(
    A.user,
    `update pilot.aircraft set archived_at = now() where account_id = '${A.account}';
     select total_time from pilot.logbook_time_by_type where type_label = 'C560';`
  );
  // An airframe a pilot no longer flies still gave them the hours. If
  // archiving retyped three years of history, archiving would be a data
  // loss event rather than a tidy-up.
  equals("archiving an airframe does not retype the hours flown in it", archivedStillCounts.out, "7.0");
}

// ---------------------------------------------------------------------------
try {
  execFileSync("psql", ["-X", "-q", ADMIN_URL, "-c", `drop database if exists ${DB}`], {
    stdio: "pipe",
  });
} catch {
  // A leftover scratch database is untidy, not a failure of the thing under test.
}
rmSync(work, { recursive: true, force: true });

note(
  failed === 0
    ? `\naircraft:verify passed — ${passed} checks`
    : `\naircraft:verify FAILED — ${failed} of ${passed + failed} checks`
);
process.exit(failed === 0 ? 0 : 1);

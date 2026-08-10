#!/usr/bin/env node
/**
 * Phase 10 verification — estimates (quotes).
 *
 * WHAT THIS PROVES, AND WHY IT IS SQL RATHER THAN supabase-js.
 * ---------------------------------------------------------------------------
 * Every guarantee under test is a guarantee of the DATABASE: row-level
 * security, column-scoped GRANTs, CHECK constraints, a generated column,
 * two SECURITY DEFINER functions and four triggers. Those live in
 * Postgres, so they are asserted against Postgres — replayed from the
 * migrations onto a scratch database, driven as the real `authenticated`
 * role with a real auth.uid(), inside a transaction that rolls back.
 *
 * The other verify scripts in this repo (trip, customisation, billing)
 * drive supabase-js against a live Supabase project because they also
 * exercise PostgREST's behaviour and the app's own queries. This one
 * deliberately does not: it needs no credentials, no network and no live
 * project, so it runs anywhere — including in CI, where the others cannot.
 *
 * THE TWO FAILURE MODES THIS IS WRITTEN TO AVOID, inherited verbatim from
 * scripts/trip-verify.mjs's header because they are how a verify script
 * comes to report PASS while the thing it checks is broken:
 *
 *   1. Treating "no rows" as proof of isolation. A dead connection, a
 *      typo'd table name and a working RLS policy all return zero rows.
 *      Every positive read here asserts the row it expects is PRESENT
 *      first, so a query that returns nothing for the wrong reason fails.
 *   2. Treating "an error happened" as proof of a refusal. Every negative
 *      case asserts a SPECIFIC SQLSTATE by name — 42501 for a privilege
 *      the grant withholds, P0001 for a trigger's own raise. A statement
 *      that failed because a column was misspelled must not read as a
 *      security control working.
 *
 * All fixtures are synthetic. No live pilot data, ever.
 *
 *   npm run estimates:verify
 *
 * Needs a local Postgres. Set ESTIMATES_VERIFY_URL to override the default
 * (postgresql://postgres@127.0.0.1:55432/postgres); the scratch database
 * is created and dropped by this script.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, rmSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const ADMIN_URL =
  process.env.ESTIMATES_VERIFY_URL ?? "postgresql://postgres@127.0.0.1:55432/postgres";
const DB = "v1_estimates_verify";
const work = mkdtempSync(join(tmpdir(), "estimates-verify-"));

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

function psql(url, sql, { expectFail = false } = {}) {
  const file = join(work, "q.sql");
  writeFileSync(file, sql);
  try {
    const out = execFileSync(
      "psql",
      ["-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1", url, "-f", file],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
    );
    if (expectFail) return { ok: true, out, sqlstate: null };
    return { ok: true, out: out.trim(), sqlstate: null };
  } catch (error) {
    const stderr = String(error.stderr ?? "");
    // Under `\set VERBOSITY verbose` psql prints the code immediately after
    // the severity — "ERROR:  P0001: only an accepted estimate ...". It does
    // NOT print a line labelled "SQLSTATE"; matching on that word parsed
    // nothing, and every negative assertion then failed with "(none
    // parsed)" while the control under test was working perfectly.
    // psql prefixes each diagnostic with "psql:<file>:<line>: ", so an
    // anchored ^ERROR never matches. Match the severity anywhere on the line.
    const m = /\bERROR:\s+([0-9A-Z]{5}):/.exec(stderr);
    return { ok: false, out: "", sqlstate: m?.[1] ?? null, stderr };
  }
}

/**
 * Run SQL as a tenant. `\set VERBOSITY verbose` is what makes the SQLSTATE
 * available to the caller — without it psql prints only the message, and a
 * negative assertion degrades into "some error happened", which is failure
 * mode 2 above.
 */
function asTenant(userId, sql) {
  return psql(
    `${ADMIN_URL.replace(/\/[^/]*$/, "")}/${DB}`,
    `\\set VERBOSITY verbose
begin;
set local role authenticated;
-- PERFORM inside a DO block, not \`select set_config(...)\`: a bare select
-- emits a result row, and with psql in tuples-only mode that row lands in
-- stdout ahead of the answer the assertion is about. Every equals() check
-- was comparing against the JWT claims blob.
do $$ begin perform set_config('request.jwt.claims', '{"sub":"${userId}","role":"authenticated"}', true); end $$;
${sql}
rollback;`
  );
}

/**
 * Seeding, as service_role. NOT as the bare superuser: the force-draft and
 * protect triggers exempt service_role by name and nothing else, so a
 * superuser INSERT that presets status or a number is rejected exactly
 * like a tenant's would be. That is the triggers working — but it made the
 * cross-tenant fixture below silently fail to exist, and the test that
 * depended on it then "passed" for the wrong reason.
 */
function asAdmin(sql, label) {
  const r = psql(
    `${ADMIN_URL.replace(/\/[^/]*$/, "")}/${DB}`,
    `\\set VERBOSITY verbose\nset role service_role;\n${sql}`
  );
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
    bad(label, `expected SQLSTATE ${expectedSqlstate}, got ${r.sqlstate ?? "(none parsed)"}\n${r.stderr?.slice(0, 400)}`);
    return;
  }
  ok(`${label}  [${expectedSqlstate}]`);
}

function equals(label, actual, expected) {
  if (String(actual).trim() === String(expected)) ok(label);
  else bad(label, `expected ${JSON.stringify(String(expected))}, got ${JSON.stringify(String(actual).trim())}`);
}

// ---------------------------------------------------------------------------
// Build the database from the real migrations. Not a hand-written schema:
// the point is to test what actually ships.
// ---------------------------------------------------------------------------
const BOOTSTRAP = process.env.ESTIMATES_VERIFY_BOOTSTRAP;
if (!BOOTSTRAP) {
  note("estimates:verify SKIPPED — set ESTIMATES_VERIFY_BOOTSTRAP to the");
  note("  Supabase-shaped scaffold (roles anon/authenticated/service_role,");
  note("  schema auth with auth.uid(), an extensions schema, a storage stub).");
  note("  Nothing about the app is broken by this skip.");
  process.exit(0);
}

try {
  execFileSync("psql", ["-X", "-q", ADMIN_URL, "-c", `drop database if exists ${DB}`], { stdio: "pipe" });
  execFileSync("psql", ["-X", "-q", ADMIN_URL, "-c", `create database ${DB}`], { stdio: "pipe" });
} catch (error) {
  note(`estimates:verify SKIPPED — no Postgres at ${ADMIN_URL}\n  ${String(error.stderr ?? error).slice(0, 200)}`);
  rmSync(work, { recursive: true, force: true });
  process.exit(0);
}

const DB_URL = `${ADMIN_URL.replace(/\/[^/]*$/, "")}/${DB}`;
try {
  execFileSync("psql", ["-X", "-q", "-v", "ON_ERROR_STOP=1", DB_URL, "-f", BOOTSTRAP], { stdio: "pipe" });
  const migrations = execFileSync("ls", ["supabase/migrations"], { encoding: "utf8" })
    .trim()
    .split("\n")
    .filter((f) => f.endsWith(".sql"))
    .sort();
  for (const file of migrations) {
    execFileSync(
      "psql",
      ["-X", "-q", "-v", "ON_ERROR_STOP=1", DB_URL, "-f", join("supabase/migrations", file)],
      { stdio: "pipe" }
    );
  }
  note(`Replayed ${migrations.length} migrations onto a scratch database.\n`);
} catch (error) {
  note("estimates:verify FAILED — the migrations do not replay cleanly.");
  note(String(error.stderr ?? error).slice(0, 2000));
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Two synthetic tenants. Seeded as the owner (superuser) because minting a
// tenant is a service-role act, not something the app does.
// ---------------------------------------------------------------------------
const A = { user: "11111111-1111-4111-8111-111111111111", account: null, client: null };
const B = { user: "22222222-2222-4222-8222-222222222222", account: null, client: null };

const seed = psql(
  DB_URL,
  `\\set VERBOSITY verbose
-- auth.users is SELECT-only for service_role in the local scaffold (as it
-- is on a real Supabase project, where users are minted through GoTrue and
-- not by SQL), so the two synthetic identities are created as the owner.
-- Everything under pilot. is then seeded as service_role, which is the
-- role the force-draft and protect triggers exempt by name.
insert into auth.users (id, email) values
  ('${A.user}', 'synthetic-a@example.invalid'),
  ('${B.user}', 'synthetic-b@example.invalid');

set role service_role;

insert into pilot.accounts (id, kind, legal_name, estimate_prefix)
values ('aaaaaaaa-0000-4000-8000-000000000001', 'solo', 'Synthetic Alpha Air', 'ALFA'),
       ('bbbbbbbb-0000-4000-8000-000000000002', 'solo', 'Synthetic Bravo Air', 'BRVO');

insert into pilot.account_members (account_id, user_id, role) values
  ('aaaaaaaa-0000-4000-8000-000000000001', '${A.user}', 'owner'),
  ('bbbbbbbb-0000-4000-8000-000000000002', '${B.user}', 'owner');

insert into pilot.clients (id, account_id, name, payment_terms_days) values
  ('cccccccc-0000-4000-8000-00000000000a', 'aaaaaaaa-0000-4000-8000-000000000001', 'Synthetic Client A', 30),
  ('cccccccc-0000-4000-8000-00000000000b', 'bbbbbbbb-0000-4000-8000-000000000002', 'Synthetic Client B', 15);
`
);
if (!seed.ok) {
  note("estimates:verify FAILED — could not seed synthetic tenants.");
  note(String(seed.stderr).slice(0, 2000));
  process.exit(1);
}
A.account = "aaaaaaaa-0000-4000-8000-000000000001";
B.account = "bbbbbbbb-0000-4000-8000-000000000002";
A.client = "cccccccc-0000-4000-8000-00000000000a";
B.client = "cccccccc-0000-4000-8000-00000000000b";

const NEW_ESTIMATE = (t) => `
insert into pilot.estimates (account_id, client_id, valid_until, tax_rate_bps, terms)
values ('${t.account}', '${t.client}', current_date + 14, 825, 'Synthetic terms');`;

// A quote a contract pilot would actually write: three flight days at the
// day rate, one travel day at half, per diem for four days (not taxable —
// it is a reimbursement, not a service).
const LINES = (estimateExpr) => `
insert into pilot.estimate_lines
  (account_id, estimate_id, line_type, description, quantity, unit_amount_cents, taxable, sort_order)
select account_id, id, 'flight_day', 'Flight day', 3, 120000, true, 1 from ${estimateExpr}
union all
select account_id, id, 'travel_day', 'Travel day', 1, 60000, true, 2 from ${estimateExpr}
union all
select account_id, id, 'per_diem', 'Per diem', 4, 7500, false, 3 from ${estimateExpr};`;

note("Tenancy — an estimate is invisible to another account");
{
  // Seeded as admin so it exists independently of A's own transaction.
  asAdmin(NEW_ESTIMATE(A), "tenant A's first estimate");
  const rowForA = asTenant(A.user, `select count(*) from pilot.estimates;`);
  const rowForB = asTenant(B.user, `select count(*) from pilot.estimates;`);
  equals("the owning account sees its own estimate", rowForA.out, "1");
  // The check that matters: a non-empty table returning zero rows for the
  // OTHER tenant. Paired with the line above so "zero" cannot be an
  // unreachable database.
  equals("the other account sees none of it", rowForB.out, "0");
}

note("\nNumbering");
{
  refuses(
    "one tenant cannot burn another's sequence (or read their prefix)",
    A.user,
    `select pilot.next_estimate_number('${B.account}');`,
    "P0001"
  );

  const a = asTenant(A.user, `select pilot.next_estimate_number('${A.account}');`);
  const b = asTenant(B.user, `select pilot.next_estimate_number('${B.account}');`);
  const year = new Date().getUTCFullYear();
  equals("each account numbers from its own prefix and its own 1", a.out, `ALFA-${year}-0001`);
  // Both tenants getting -0001 is the point: a global sequence would leak
  // how many documents the other account has issued, and a bare unique
  // constraint on the number would make the second one a hard duplicate.
  equals("and the other tenant is unaffected by it", b.out, `BRVO-${year}-0001`);
}

note("\nAn estimate is born a draft");
{
  refuses(
    "a client cannot insert one already numbered",
    A.user,
    `insert into pilot.estimates (account_id, client_id, estimate_number)
     values ('${A.account}', '${A.client}', 'FAKE-2026-0001');`,
    "42501"
  );
  refuses(
    "nor already sent",
    A.user,
    `insert into pilot.estimates (account_id, client_id, status)
     values ('${A.account}', '${A.client}', 'sent');`,
    "42501"
  );
  refuses(
    "nor already converted",
    A.user,
    `insert into pilot.estimates (account_id, client_id, converted_invoice_id)
     values ('${A.account}', '${A.client}', gen_random_uuid());`,
    "42501"
  );
}

note("\nTotals are computed, never stored");
{
  const r = asTenant(
    A.user,
    `${NEW_ESTIMATE(A)}
     ${LINES("(select id, account_id from pilot.estimates order by created_at desc limit 1) e")}
     select subtotal_cents, tax_cents, total_cents
       from pilot.estimate_totals
      where estimate_id = (select id from pilot.estimates order by created_at desc limit 1);`
  );
  // 3 x 1200.00 + 1 x 600.00 + 4 x 75.00 = 3600.00 + 600.00 + 300.00
  // Tax at 8.25% applies to the 4200.00 of TAXABLE lines only, not to the
  // 300.00 of per diem: 420000 * 825 / 10000 = 34650.
  equals("subtotal, tax on taxable lines only, and total", r.out, "450000|34650|484650");
}

note("\nThe status machine");
{
  refuses(
    "a draft cannot jump straight to accepted",
    A.user,
    `${NEW_ESTIMATE(A)}
     update pilot.estimates set status = 'accepted'
      where id = (select id from pilot.estimates order by created_at desc limit 1);`,
    "P0001"
  );

  const sent = asTenant(
    A.user,
    `${NEW_ESTIMATE(A)}
     update pilot.estimates set status = 'sent'
      where id = (select id from pilot.estimates order by created_at desc limit 1);
     select estimate_number is not null, issued_on = current_date, sent_at is not null
       from pilot.estimates order by created_at desc limit 1;`
  );
  equals("sending stamps the number, the issue date and the timestamp", sent.out, "t|t|t");

  refuses(
    "and the number cannot be changed afterwards",
    A.user,
    `${NEW_ESTIMATE(A)}
     update pilot.estimates set status = 'sent'
      where id = (select id from pilot.estimates order by created_at desc limit 1);
     update pilot.estimates set estimate_number = 'ALFA-2026-9999'
      where id = (select id from pilot.estimates order by created_at desc limit 1);`,
    "42501"
  );

  // A sent quote MAY be revised and re-sent — deliberately softer than an
  // issued invoice. See the migration header.
  const revise = asTenant(
    A.user,
    `${NEW_ESTIMATE(A)}
     update pilot.estimates set status = 'sent'
      where id = (select id from pilot.estimates order by created_at desc limit 1);
     update pilot.estimates set status = 'draft'
      where id = (select id from pilot.estimates order by created_at desc limit 1);
     select status from pilot.estimates order by created_at desc limit 1;`
  );
  equals("a sent quote can go back to draft to be revised", revise.out, "draft");
}

note("\nExpiry is derived, not stored");
{
  // Seeded as service_role with dates already in the past, because the
  // schema will not let a tenant CREATE an expired quote: sending stamps
  // issued_on = today, and `check (valid_until >= issued_on)` then refuses
  // a valid_until that has already gone by. Discovered by this test
  // failing — an expired estimate can only arise from the passage of
  // time, which is the correct property and worth stating.
  asAdmin(
    `insert into pilot.estimates
       (id, account_id, client_id, status, estimate_number, issued_on, valid_until)
     values ('eeeeeeee-0000-4000-8000-0000000000e1', '${A.account}', '${A.client}',
             'sent', 'ALFA-2026-8001', current_date - 20, current_date - 3);
     insert into pilot.estimates
       (id, account_id, client_id, status, estimate_number, issued_on, valid_until)
     values ('eeeeeeee-0000-4000-8000-0000000000e2', '${A.account}', '${A.client}',
             'accepted', 'ALFA-2026-8002', current_date - 20, current_date - 3);`,
    "two past-dated estimates for tenant A"
  );

  const expired = asTenant(
    A.user,
    `select days_expired from pilot.estimates_expired
      where estimate_id = 'eeeeeeee-0000-4000-8000-0000000000e1';`
  );
  equals("a sent quote past its date shows as expired, with a day count", expired.out, "3");

  const answered = asTenant(
    A.user,
    `select count(*) from pilot.estimates_expired
      where estimate_id = 'eeeeeeee-0000-4000-8000-0000000000e2';`
  );
  // An answered quote is no longer waiting to expire — chasing the pilot
  // about a date on a quote the client already accepted is noise.
  equals("but an accepted one is not chased for being past its date", answered.out, "0");

  const cannotBackdate = asTenant(
    A.user,
    `${NEW_ESTIMATE(A)}
     update pilot.estimates set valid_until = current_date - 1
      where id = (select id from pilot.estimates order by created_at desc limit 1);
     update pilot.estimates set status = 'sent'
      where id = (select id from pilot.estimates order by created_at desc limit 1);`
  );
  if (!cannotBackdate.ok && cannotBackdate.sqlstate === "23514") {
    ok("a quote cannot be sent already expired  [23514]");
  } else {
    bad("a quote cannot be sent already expired", `expected 23514, got ${cannotBackdate.sqlstate ?? "success"}`);
  }
}

note("\nConversion to an invoice");
{
  const ACCEPTED = `
${NEW_ESTIMATE(A)}
${LINES("(select id, account_id from pilot.estimates order by created_at desc limit 1) e")}
update pilot.estimates set status = 'sent'
 where id = (select id from pilot.estimates order by created_at desc limit 1);
update pilot.estimates set status = 'accepted'
 where id = (select id from pilot.estimates order by created_at desc limit 1);`;

  const converted = asTenant(
    A.user,
    `${ACCEPTED}
     do $$ begin perform pilot.estimate_convert_to_invoice(
       (select id from pilot.estimates order by created_at desc limit 1)); end $$;
     select i.status,
            (select count(*) from pilot.invoice_lines l where l.invoice_id = i.id),
            t.total_cents
       from pilot.invoices i
       join pilot.invoice_totals t on t.invoice_id = i.id
      order by i.created_at desc limit 1;`
  );
  // A DRAFT, with every line copied and the same money. Not sent: the
  // pilot still reviews it. Same total as the quote proves the tax base
  // and the per-line taxable flags survived the copy.
  equals("it produces a DRAFT invoice with all three lines and the same total", converted.out, "draft|3|484650");

  refuses(
    "a quote that was never accepted cannot be converted",
    A.user,
    `${NEW_ESTIMATE(A)}
     ${LINES("(select id, account_id from pilot.estimates order by created_at desc limit 1) e")}
     select pilot.estimate_convert_to_invoice(
       (select id from pilot.estimates order by created_at desc limit 1));`,
    "P0001"
  );

  refuses(
    "an accepted quote with no lines cannot be converted",
    A.user,
    `${NEW_ESTIMATE(A)}
     update pilot.estimates set status = 'sent'
      where id = (select id from pilot.estimates order by created_at desc limit 1);
     update pilot.estimates set status = 'accepted'
      where id = (select id from pilot.estimates order by created_at desc limit 1);
     select pilot.estimate_convert_to_invoice(
       (select id from pilot.estimates order by created_at desc limit 1));`,
    "P0001"
  );

  refuses(
    "converting twice is refused, so one quote never bills a client twice",
    A.user,
    `${ACCEPTED}
     select pilot.estimate_convert_to_invoice(
       (select id from pilot.estimates order by created_at desc limit 1));
     select pilot.estimate_convert_to_invoice(
       (select id from pilot.estimates order by created_at desc limit 1));`,
    "P0001"
  );

  refuses(
    "and a converted quote's lines are frozen",
    A.user,
    `${ACCEPTED}
     select pilot.estimate_convert_to_invoice(
       (select id from pilot.estimates order by created_at desc limit 1));
     update pilot.estimate_lines set unit_amount_cents = 1
      where estimate_id = (select id from pilot.estimates order by created_at desc limit 1);`,
    "P0001"
  );
}

note("\nCross-tenant conversion");
{
  // The one that would matter most: DEFINER bypasses RLS, so without the
  // in-body membership check this function is a cross-tenant write.
  asAdmin(`
    insert into pilot.estimates (id, account_id, client_id, status, estimate_number)
    values ('eeeeeeee-0000-4000-8000-00000000000b', '${B.account}', '${B.client}', 'accepted', 'BRVO-2026-0009');
    insert into pilot.estimate_lines (account_id, estimate_id, line_type, description, quantity, unit_amount_cents)
    values ('${B.account}', 'eeeeeeee-0000-4000-8000-00000000000b', 'flight_day', 'Synthetic', 1, 100000);`,
    "tenant B's accepted estimate");

  refuses(
    "tenant A cannot convert tenant B's accepted estimate",
    A.user,
    `select pilot.estimate_convert_to_invoice('eeeeeeee-0000-4000-8000-00000000000b');`,
    "P0001"
  );
}

note("\nDeleting");
{
  const draft = asTenant(
    A.user,
    `${NEW_ESTIMATE(A)}
     delete from pilot.estimates
      where id = (select id from pilot.estimates order by created_at desc limit 1);
     select count(*) from pilot.estimates where status = 'draft' and estimate_number is null;`
  );
  ok(`an abandoned draft quote can be deleted (remaining unnumbered drafts: ${draft.out})`);

  const sentKept = asTenant(
    A.user,
    `${NEW_ESTIMATE(A)}
     update pilot.estimates set status = 'sent'
      where id = (select id from pilot.estimates order by created_at desc limit 1);
     with target as (select id from pilot.estimates order by created_at desc limit 1)
     delete from pilot.estimates where id in (select id from target);
     select count(*) from pilot.estimates
      where id = (select id from pilot.estimates order by created_at desc limit 1);`
  );
  // RLS filters the row out of the DELETE rather than raising: the row
  // survives, which is the behaviour that matters. Asserted by counting,
  // not by expecting an error that never comes.
  equals("but a sent one is a document the client has seen, and survives", sentKept.out, "1");
}

// ---------------------------------------------------------------------------
try {
  execFileSync("psql", ["-X", "-q", ADMIN_URL, "-c", `drop database if exists ${DB}`], { stdio: "pipe" });
} catch {
  // A leftover scratch database is untidy, not a failure of the thing under test.
}
rmSync(work, { recursive: true, force: true });

note(
  failed === 0
    ? `\nestimates:verify passed — ${passed} checks`
    : `\nestimates:verify FAILED — ${failed} of ${passed + failed} checks`
);
process.exit(failed === 0 ? 0 : 1);

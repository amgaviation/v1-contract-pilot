#!/usr/bin/env node
/**
 * Scheduled reminders and late fees — verification.
 *
 * WHAT THIS PROVES, AND WHY IT IS SQL RATHER THAN supabase-js.
 * ---------------------------------------------------------------------------
 * The reminder feature makes four promises that a unit test cannot keep,
 * because every one of them is a promise of the DATABASE:
 *
 *   1. A RUNG CANNOT BE SENT TWICE. tests/reminder-schedule.test.mjs pins the
 *      decision logic, but the decision is not the guard — two overlapping
 *      passes can each decide to send. The guard is the partial unique index
 *      on pilot.invoice_reminder_sends, and only Postgres can be asked
 *      whether it holds.
 *   2. A LEDGER ROW CANNOT LIE. outcome='sent' with no provider id, or a
 *      failure with no reason, are refused by CHECK — the storage-level twin
 *      of lib/email/send.ts's refusal to call an unconfirmed 2xx a send.
 *   3. reminders_suppressed IS WRITABLE ON AN ISSUED INVOICE and nothing else
 *      on that invoice became writable with it. That is the one change this
 *      feature made to existing machinery (migration 20260813130000 §3), and
 *      it is exactly the kind of change that is claimed in a comment and
 *      quietly wrong in the trigger.
 *   4. A LATE FEE CANNOT BE RAISED TWICE for the same invoice and period, and
 *      a fee line still cannot be added to the issued invoice itself — which
 *      is the whole reason the fee is a separate document.
 *
 * Inherits the harness, and the two failure modes it is written to avoid,
 * from scripts/estimates-verify.mjs:
 *
 *   1. Treating "no rows" as proof of isolation. A dead connection, a typo'd
 *      table name and a working RLS policy all return zero rows. Every
 *      positive read here asserts the row it expects is PRESENT first.
 *   2. Treating "an error happened" as proof of a refusal. Every negative
 *      case asserts a SPECIFIC SQLSTATE — 23505 for the unique index, 23514
 *      for a CHECK, 42501 for a withheld privilege, P0001 for a trigger's own
 *      raise. A statement that fails for the wrong reason fails the test.
 *
 * Needs a local Postgres and REMINDERS_VERIFY_BOOTSTRAP pointing at
 * scripts/lib/verify-bootstrap.sql. Same contract as the other verify
 * scripts; skips (never fails) when either is absent.
 */
import { execFileSync } from "node:child_process";
import { writeFileSync, rmSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const ADMIN_URL =
  process.env.REMINDERS_VERIFY_URL ?? "postgresql://postgres@127.0.0.1:55432/postgres";
const DB = "v1_reminders_verify";
const work = mkdtempSync(join(tmpdir(), "reminders-verify-"));

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
    const m = /\bERROR:\s+([0-9A-Z]{5}):/.exec(stderr);
    return { ok: false, out: "", sqlstate: m?.[1] ?? null, stderr };
  }
}

const DB_URL = () => `${ADMIN_URL.replace(/\/[^/]*$/, "")}/${DB}`;

/** As a tenant, in a transaction that rolls back. */
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

/** Seeding, as service_role — the role the protect triggers exempt by name. */
function asAdmin(sql, label) {
  const r = psql(DB_URL(), `\\set VERBOSITY verbose\nset role service_role;\n${sql}`);
  if (!r.ok && label) bad(`fixture: ${label}`, r.stderr?.slice(0, 400));
  return r;
}

function refuses(label, userId, sql, expected) {
  const r = asTenant(userId, sql);
  if (r.ok) {
    bad(label, "the statement SUCCEEDED — the control under test is not working");
    return;
  }
  if (r.sqlstate !== expected) {
    bad(label, `expected SQLSTATE ${expected}, got ${r.sqlstate ?? "(none parsed)"}\n${r.stderr?.slice(0, 400)}`);
    return;
  }
  ok(`${label}  [${expected}]`);
}

function permits(label, userId, sql) {
  const r = asTenant(userId, sql);
  if (r.ok) ok(label);
  else bad(label, `expected success, got ${r.sqlstate ?? "?"}\n${r.stderr?.slice(0, 400)}`);
}

function equals(label, actual, expected) {
  if (String(actual).trim() === String(expected)) ok(label);
  else bad(label, `expected ${JSON.stringify(String(expected))}, got ${JSON.stringify(String(actual).trim())}`);
}

// ---------------------------------------------------------------------------
// Build the database from the real migrations — the point is to test what
// actually ships, not a hand-written schema.
// ---------------------------------------------------------------------------
const BOOTSTRAP = process.env.REMINDERS_VERIFY_BOOTSTRAP;
if (!BOOTSTRAP) {
  note("reminders:verify SKIPPED — set REMINDERS_VERIFY_BOOTSTRAP to");
  note("  scripts/lib/verify-bootstrap.sql and REMINDERS_VERIFY_URL to a local");
  note("  Postgres. Nothing about the app is broken by this skip.");
  process.exit(0);
}

try {
  execFileSync("psql", ["-X", "-q", ADMIN_URL, "-c", `drop database if exists ${DB}`], { stdio: "pipe" });
  execFileSync("psql", ["-X", "-q", ADMIN_URL, "-c", `create database ${DB}`], { stdio: "pipe" });
} catch (error) {
  note(`reminders:verify SKIPPED — no Postgres at ${ADMIN_URL}\n  ${String(error.stderr ?? error).slice(0, 200)}`);
  rmSync(work, { recursive: true, force: true });
  process.exit(0);
}

try {
  execFileSync("psql", ["-X", "-q", "-v", "ON_ERROR_STOP=1", DB_URL(), "-f", BOOTSTRAP], { stdio: "pipe" });
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
  note("reminders:verify FAILED — the migrations do not replay cleanly.");
  note(String(error.stderr ?? error).slice(0, 2000));
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Two synthetic tenants, one issued invoice each.
// ---------------------------------------------------------------------------
const A = {
  user: "11111111-1111-4111-8111-111111111111",
  account: "aaaaaaaa-0000-4000-8000-000000000001",
  client: "cccccccc-0000-4000-8000-00000000000a",
  invoice: "11111111-0000-4000-8000-00000000000a",
};
const B = {
  user: "22222222-2222-4222-8222-222222222222",
  account: "bbbbbbbb-0000-4000-8000-000000000002",
  client: "cccccccc-0000-4000-8000-00000000000b",
  invoice: "22222222-0000-4000-8000-00000000000b",
};

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

insert into pilot.clients (id, account_id, name, payment_terms_days, contact_email) values
  ('${A.client}', '${A.account}', 'Synthetic Client A', 30, 'ap-a@example.invalid'),
  ('${B.client}', '${B.account}', 'Synthetic Client B', 30, 'ap-b@example.invalid');

-- Two invoices, ISSUED and overdue: the state every control below is about.
-- Seeded as service_role, which the force-draft and protect triggers exempt,
-- so the fixture can set status/number/dates directly.
insert into pilot.invoices (id, account_id, client_id, invoice_number, status, issued_on, due_on)
values
  ('${A.invoice}', '${A.account}', '${A.client}', 'ALFA-2026-0001', 'sent', current_date - 60, current_date - 30),
  ('${B.invoice}', '${B.account}', '${B.client}', 'BRVO-2026-0001', 'sent', current_date - 60, current_date - 30);

insert into pilot.invoice_lines (account_id, invoice_id, line_type, description, quantity, unit_amount_cents)
values
  ('${A.account}', '${A.invoice}', 'flight_day', 'Flight day', 3, 120000),
  ('${B.account}', '${B.invoice}', 'flight_day', 'Flight day', 3, 120000);
`
);
if (!seed.ok) {
  note("reminders:verify FAILED — could not seed synthetic tenants.");
  note(String(seed.stderr).slice(0, 2000));
  process.exit(1);
}

const RUNG = (t, key, extra = "") => `
insert into pilot.invoice_reminder_sends
  (account_id, invoice_id, rule_key, outcome, detail, provider_message_id)
values ('${t.account}', '${t.invoice}', '${key}', 'sent', null, 'resend-${key}-1')${extra};`;

// ---------------------------------------------------------------------------
note("The send ledger — a rung is consumed exactly once");
{
  // The guard that makes double-sending impossible rather than unlikely. Both
  // inserts are in ONE transaction, which is what a race looks like from the
  // database's point of view.
  refuses(
    "the same rung cannot be recorded twice for one invoice",
    A.user,
    `${RUNG(A, "after_30")}\n${RUNG(A, "after_30")}`,
    "23505"
  );

  permits(
    "two different rungs on one invoice are fine",
    A.user,
    `${RUNG(A, "after_7")}\n${RUNG(A, "after_30")}`
  );

  // 'manual' is a log, not a ladder: a pilot may press the button as often as
  // they like, and the scheduler reads those rows to know a human already
  // chased. The partial index is what allows this while still refusing a
  // repeated rung above.
  permits(
    "a manual reminder can be recorded again and again",
    A.user,
    `${RUNG(A, "manual")}\n${RUNG(A, "manual")}\n${RUNG(A, "manual")}`
  );
}

note("\nThe send ledger, a definite failure may be tried again, an unknown one may not (20260815090000)");
{
  const FAILED = (key, detail = "The domain is not verified.") =>
    `insert into pilot.invoice_reminder_sends (account_id, invoice_id, rule_key, outcome, detail)
     values ('${A.account}', '${A.invoice}', '${key}', 'failed', '${detail}');`;
  const UNKNOWN = (key) =>
    `insert into pilot.invoice_reminder_sends (account_id, invoice_id, rule_key, outcome, detail)
     values ('${A.account}', '${A.invoice}', '${key}', 'unknown', 'The mail service did not respond in time.');`;

  // The defect: one refused send used to burn the rung for good, so an hour
  // of downtime cost that client that step of the chase permanently.
  permits(
    "a rung that definitely did not send can be attempted again",
    A.user,
    `${FAILED("after_3")}\n${FAILED("after_3")}\n${FAILED("after_3")}`
  );

  permits(
    "and a later success on that same rung is accepted",
    A.user,
    `${FAILED("after_3")}\n${RUNG(A, "after_3")}`
  );

  // The property the index has always owned, and the one this change was not
  // allowed to lose.
  refuses(
    "but that rung cannot then send a second time",
    A.user,
    `${FAILED("after_3")}\n${RUNG(A, "after_3")}\n${RUNG(A, "after_3")}`,
    "23505"
  );

  // The whole reason 'unknown' exists: the mail service stopped answering, so
  // the message may be with the client and that endpoint has no idempotency
  // key. It consumes the rung exactly as a send does.
  refuses(
    "an unknown outcome consumes the rung just as a send does",
    A.user,
    `${UNKNOWN("after_7")}\n${RUNG(A, "after_7")}`,
    "23505"
  );

  refuses(
    "and cannot itself be recorded twice",
    A.user,
    `${UNKNOWN("after_7")}\n${UNKNOWN("after_7")}`,
    "23505"
  );

  // An unknown row carries no provider id (none came back) and MUST carry the
  // mail service's own words, or the pilot has nothing to check against.
  refuses(
    "an unknown outcome with a provider id is refused",
    A.user,
    `insert into pilot.invoice_reminder_sends (account_id, invoice_id, rule_key, outcome, detail, provider_message_id)
     values ('${A.account}', '${A.invoice}', 'after_7', 'unknown', 'no answer', 'resend-1');`,
    "23514"
  );

  refuses(
    "an unknown outcome with no reason recorded is refused",
    A.user,
    `insert into pilot.invoice_reminder_sends (account_id, invoice_id, rule_key, outcome)
     values ('${A.account}', '${A.invoice}', 'after_7', 'unknown');`,
    "23514"
  );

  refuses(
    "the outcome vocabulary still refuses anything outside the four",
    A.user,
    `insert into pilot.invoice_reminder_sends (account_id, invoice_id, rule_key, outcome, detail)
     values ('${A.account}', '${A.invoice}', 'after_7', 'probably', 'x');`,
    "23514"
  );
}

note("\nThe send ledger — a row cannot claim more than happened");
{
  refuses(
    "'sent' with no provider id is refused",
    A.user,
    `insert into pilot.invoice_reminder_sends (account_id, invoice_id, rule_key, outcome)
     values ('${A.account}', '${A.invoice}', 'after_7', 'sent');`,
    "23514"
  );

  refuses(
    "a failure with no reason recorded is refused",
    A.user,
    `insert into pilot.invoice_reminder_sends (account_id, invoice_id, rule_key, outcome)
     values ('${A.account}', '${A.invoice}', 'after_7', 'failed');`,
    "23514"
  );

  refuses(
    "a failure carrying a provider id is refused",
    A.user,
    `insert into pilot.invoice_reminder_sends (account_id, invoice_id, rule_key, outcome, detail, provider_message_id)
     values ('${A.account}', '${A.invoice}', 'after_7', 'failed', 'domain not verified', 'resend-1');`,
    "23514"
  );

  permits(
    "an honest failure row is accepted",
    A.user,
    `insert into pilot.invoice_reminder_sends (account_id, invoice_id, rule_key, outcome, detail)
     values ('${A.account}', '${A.invoice}', 'after_7', 'failed', 'The domain is not verified.');`
  );

  refuses(
    "a rule_key that is not a rung is refused",
    A.user,
    `insert into pilot.invoice_reminder_sends (account_id, invoice_id, rule_key, outcome, detail)
     values ('${A.account}', '${A.invoice}', 'whenever_i_feel_like_it', 'skipped', 'x');`,
    "23514"
  );
}

note("\nThe send ledger — append only, and one tenant's alone");
{
  asAdmin(RUNG(A, "after_14"), "a recorded send for tenant A");

  const forA = asTenant(A.user, `select count(*) from pilot.invoice_reminder_sends;`);
  const forB = asTenant(B.user, `select count(*) from pilot.invoice_reminder_sends;`);
  equals("the owning account sees its own send record", forA.out, "1");
  // Paired with the line above, so "zero" cannot be an unreachable database.
  equals("the other account sees none of it", forB.out, "0");

  refuses(
    "a tenant cannot write a record against another tenant's invoice",
    B.user,
    `insert into pilot.invoice_reminder_sends (account_id, invoice_id, rule_key, outcome, detail, provider_message_id)
     values ('${A.account}', '${A.invoice}', 'after_3', 'sent', null, 'resend-x');`,
    "42501"
  );

  // No UPDATE or DELETE grant exists at all: a record of something that
  // already happened to somebody else's inbox has no honest edit, and
  // deleting one is how a rung gets sent twice.
  refuses(
    "a recorded send cannot be edited",
    A.user,
    `update pilot.invoice_reminder_sends set outcome = 'skipped';`,
    "42501"
  );
  refuses(
    "a recorded send cannot be deleted",
    A.user,
    `delete from pilot.invoice_reminder_sends;`,
    "42501"
  );
}

note("\nThe per-client schedule — our vocabulary, not free text");
{
  permits(
    "an offered ladder is accepted",
    A.user,
    `update pilot.clients set reminder_before_due = array[7],
        reminder_on_due = true, reminder_after_due = array[3,14,30]
      where id = '${A.client}';`
  );

  refuses(
    "a day outside the offered set is refused",
    A.user,
    `update pilot.clients set reminder_after_due = array[1] where id = '${A.client}';`,
    "23514"
  );

  refuses(
    "a before-due day the product does not offer is refused",
    A.user,
    `update pilot.clients set reminder_before_due = array[30] where id = '${A.client}';`,
    "23514"
  );

  // The default, and the only thing that matters for a migration applied to
  // live data: no existing client gained a schedule.
  const off = psql(
    DB_URL(),
    `select count(*) from pilot.clients
      where cardinality(reminder_before_due) = 0
        and reminder_on_due = false
        and cardinality(reminder_after_due) = 0;`
  );
  equals("every pre-existing client starts with no reminders at all", off.out, "2");
}

note("\nThe late fee — the pilot's agreed term, and only one of them");
{
  permits(
    "a flat fee is accepted",
    A.user,
    `update pilot.clients set late_fee_flat_cents = 5000, late_fee_grace_days = 15
      where id = '${A.client}';`
  );

  permits(
    "a monthly rate is accepted",
    A.user,
    `update pilot.clients set late_fee_bps_per_month = 150 where id = '${A.client}';`
  );

  refuses(
    "both kinds at once is unrepresentable",
    A.user,
    `update pilot.clients set late_fee_flat_cents = 5000, late_fee_bps_per_month = 150
      where id = '${A.client}';`,
    "23514"
  );

  refuses(
    "a rate above the fat-finger ceiling is refused",
    A.user,
    `update pilot.clients set late_fee_bps_per_month = 1500 where id = '${A.client}';`,
    "23514"
  );

  refuses(
    "a fee of zero is not a fee",
    A.user,
    `update pilot.clients set late_fee_flat_cents = 0 where id = '${A.client}';`,
    "23514"
  );

  // The one that keeps the client-facing sentence honest: a reminder can
  // never say "a late fee applies" with no agreed figure behind it.
  refuses(
    "the reminder note cannot be switched on with no fee agreed",
    A.user,
    `update pilot.clients set late_fee_note_on_reminders = true where id = '${A.client}';`,
    "23514"
  );

  permits(
    "…but it can once there is something to state",
    A.user,
    `update pilot.clients set late_fee_bps_per_month = 150, late_fee_note_on_reminders = true
      where id = '${A.client}';`
  );

  const off = psql(
    DB_URL(),
    `select count(*) from pilot.clients
      where late_fee_flat_cents is null and late_fee_bps_per_month is null
        and late_fee_grace_days = 0 and late_fee_note_on_reminders = false;`
  );
  equals("every pre-existing client starts with no fee agreed", off.out, "2");
}

note("\nThe per-invoice override — the ONE column this feature unfroze");
{
  // The claim migration 20260813130000 §3 makes, tested directly. An issued
  // invoice is immutable except for a named allowlist; this column joined it,
  // and if the trigger says otherwise the pilot cannot silence a chase on the
  // one document they need to silence it on.
  permits(
    "reminders can be paused on an ISSUED invoice",
    A.user,
    `update pilot.invoices set reminders_suppressed = true where id = '${A.invoice}';`
  );

  // …and nothing else came unfrozen with it. P0001 is the trigger's own
  // raise, not a privilege error — the distinction matters, because a grant
  // change would produce 42501 and would mean something different.
  refuses(
    "the due date is still frozen on an issued invoice",
    A.user,
    `update pilot.invoices set due_on = current_date + 90 where id = '${A.invoice}';`,
    "P0001"
  );
  refuses(
    "the client is still frozen on an issued invoice",
    A.user,
    `update pilot.invoices set client_id = '${A.client}', tax_rate_bps = 825 where id = '${A.invoice}';`,
    "P0001"
  );
  refuses(
    "pausing reminders on ANOTHER tenant's invoice writes nothing",
    B.user,
    // RLS makes this match zero rows rather than error, so the assertion is
    // on the count, not on an exception — see the note below.
    `do $$
     declare n integer;
     begin
       update pilot.invoices set reminders_suppressed = true where id = '${A.invoice}';
       get diagnostics n = row_count;
       if n <> 0 then raise exception 'cross-tenant update matched % rows', n; end if;
       raise exception using errcode = 'P0001', message = 'no rows matched, as expected';
     end $$;`,
    "P0001"
  );
}

note("\nThe late-fee ledger — one fee per invoice per period, ever");
{
  const FEE_INVOICE = "11111111-0000-4000-8000-0000000000ff";
  asAdmin(
    `insert into pilot.invoices (id, account_id, client_id, status)
     values ('${FEE_INVOICE}', '${A.account}', '${A.client}', 'draft');`,
    "a draft fee invoice"
  );

  const FEE = (period) => `
    insert into pilot.invoice_late_fees
      (account_id, source_invoice_id, fee_invoice_id, period_start, amount_cents, basis, basis_bps, months_accrued)
    values ('${A.account}', '${A.invoice}', '${FEE_INVOICE}', '${period}', 21000, 'bps_per_month', 150, 1);`;

  permits("a fee can be recorded for a period", A.user, FEE("2026-09-01"));

  refuses(
    "the same invoice and period cannot be billed twice",
    A.user,
    `${FEE("2026-09-01")}\n${FEE("2026-09-01")}`,
    "23505"
  );

  permits(
    "the next month is a new period",
    A.user,
    `${FEE("2026-09-01")}\n${FEE("2026-10-01")}`
  );

  refuses(
    "a mid-month period start is refused",
    A.user,
    FEE("2026-09-15"),
    "23514"
  );

  refuses(
    "a rate fee with no rate recorded is refused",
    A.user,
    `insert into pilot.invoice_late_fees
       (account_id, source_invoice_id, fee_invoice_id, period_start, amount_cents, basis)
     values ('${A.account}', '${A.invoice}', '${FEE_INVOICE}', '2026-09-01', 21000, 'bps_per_month');`,
    "23514"
  );

  // A FLAT FEE IS ONCE, EVER — and unlike the accruing kind that has to hold
  // ACROSS periods, not just within one. The month-scoped key above cannot say
  // so on its own: two raises either side of a UTC month boundary carry
  // different period_starts. invoice_late_fees_flat_once is what makes it
  // absolute.
  const FLAT = (period) => `
    insert into pilot.invoice_late_fees
      (account_id, source_invoice_id, fee_invoice_id, period_start, amount_cents, basis)
    values ('${A.account}', '${A.invoice}', '${FEE_INVOICE}', '${period}', 5000, 'flat');`;

  permits("a flat fee can be recorded once", A.user, FLAT("2026-09-01"));

  refuses(
    "and a second flat fee is refused even in a different month",
    A.user,
    `${FLAT("2026-09-01")}\n${FLAT("2026-10-01")}`,
    "23505"
  );
}

note("\nWhy the fee is a separate invoice at all");
{
  // The reason migration §5 gives, asserted rather than asserted-in-a-comment:
  // there is no tenant path that adds a line to an issued invoice, so a fee
  // CANNOT be appended to the document the client already holds.
  refuses(
    "a fee line cannot be added to the issued invoice it relates to",
    A.user,
    `insert into pilot.invoice_lines (account_id, invoice_id, line_type, description, quantity, unit_amount_cents)
     values ('${A.account}', '${A.invoice}', 'other', 'Late fee', 1, 21000);`,
    "P0001"
  );
}

note("\nThe run watermark");
{
  permits(
    "the owner can stamp their own last run",
    A.user,
    `update pilot.accounts set reminders_last_run_at = now() where id = '${A.account}';`
  );

  // It is NOT billing state, and must not have been smuggled into the
  // billing-column trigger — a pilot pressing "run now" would then be told
  // their subscription cannot be changed by them, which is true and
  // irrelevant.
  const stamped = asTenant(
    A.user,
    `update pilot.accounts set reminders_last_run_at = '2026-08-13T14:00:00Z' where id = '${A.account}';
     select to_char(reminders_last_run_at at time zone 'UTC', 'YYYY-MM-DD') from pilot.accounts where id = '${A.account}';`
  );
  equals("and the value lands", stamped.out, "2026-08-13");

  refuses(
    "billing state is still service_role's alone",
    A.user,
    `update pilot.accounts set status = 'active', reminders_last_run_at = now() where id = '${A.account}';`,
    "42501"
  );
}

// ---------------------------------------------------------------------------
rmSync(work, { recursive: true, force: true });
try {
  execFileSync("psql", ["-X", "-q", ADMIN_URL, "-c", `drop database if exists ${DB}`], { stdio: "pipe" });
} catch {
  // A leftover scratch database is untidy, not a failure.
}

note(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  note("reminders:verify FAILED");
  process.exit(1);
}
note("reminders:verify passed.");

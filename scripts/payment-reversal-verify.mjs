#!/usr/bin/env node
/**
 * Payment corrections — pilot.invoice_payments.reverses_payment_id
 * (supabase/migrations/20260810120000_payment_reversals.sql).
 *
 * WHAT IS UNDER TEST, in one sentence: that a pilot who typed $4,500
 * instead of $450 can fix it, that the fix is a new row rather than an
 * edit, and that everything the ledger refused before it is still
 * refused.
 *
 * The money assertions are the point. An invoice that reads PAID with a
 * balance outstanding, or a correction that does not exactly cancel what
 * it names, is a worse state than the bug this feature fixes — so the
 * totals are checked in cents after every step, not merely "an error did
 * not happen".
 *
 * Same harness as scripts/estimates-verify.mjs: real migrations replayed
 * onto a scratch database, driven as the real `authenticated` role with a
 * real auth.uid(), inside a transaction that rolls back. Every negative
 * case names a SPECIFIC SQLSTATE — 23514 for a CHECK, 23505 for the
 * unique index, P0001 for a trigger's own raise — because "an error
 * happened" is how a verify script reports PASS while the control is
 * broken.
 *
 * All fixtures are synthetic. No live pilot data, ever.
 *
 *   npm run payment-reversal:verify
 */
import { execFileSync } from "node:child_process";
import { writeFileSync, rmSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const ADMIN_URL =
  process.env.PAYMENT_REVERSAL_VERIFY_URL ?? "postgresql://postgres@127.0.0.1:55432/postgres";
const DB = "v1_payment_reversal_verify";
const work = mkdtempSync(join(tmpdir(), "payment-reversal-verify-"));

let passed = 0;
let failed = 0;
const note = (...a) => console.log(...a);
const ok = (label) => {
  passed++;
  note(`  ok    ${label}`);
};
const bad = (label, detail) => {
  failed++;
  note(`  FAIL  ${label}\n          ${String(detail).split("\n").join("\n          ")}`);
};

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
  if (!r.ok && label) bad(`fixture: ${label}`, r.stderr?.slice(0, 500));
  return r;
}

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
const BOOTSTRAP = process.env.PAYMENT_REVERSAL_VERIFY_BOOTSTRAP;
if (!BOOTSTRAP) {
  note("payment-reversal:verify SKIPPED — set PAYMENT_REVERSAL_VERIFY_BOOTSTRAP");
  note("  to the Supabase-shaped scaffold. Nothing about the app is broken");
  note("  by this skip.");
  process.exit(0);
}

try {
  execFileSync("psql", ["-X", "-q", ADMIN_URL, "-c", `drop database if exists ${DB}`], {
    stdio: "pipe",
  });
  execFileSync("psql", ["-X", "-q", ADMIN_URL, "-c", `create database ${DB}`], { stdio: "pipe" });
} catch (error) {
  note(
    `payment-reversal:verify SKIPPED — no Postgres at ${ADMIN_URL}\n  ${String(error.stderr ?? error).slice(0, 200)}`
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
  note("payment-reversal:verify FAILED — the migrations do not replay cleanly.");
  note(String(error.stderr ?? error).slice(0, 2000));
  process.exit(1);
}

// ---------------------------------------------------------------------------
// One tenant, one client, one SENT invoice for $450.00, and the mistyped
// payment that started all this: $4,500.00, which settles it and marks it
// paid.
// ---------------------------------------------------------------------------
const A = { user: "11111111-1111-4111-8111-111111111111", account: "aaaaaaaa-0000-4000-8000-000000000001" };
const CLIENT = "cccccccc-0000-4000-8000-00000000000c";
const INVOICE = "11111111-0000-4000-8000-00000000000f";
const PAYMENT = "22222222-0000-4000-8000-00000000000f";
// A second invoice, settled by a REAL part-payment plus the same typo, so
// the "what does the status go back to" question has both answers in the
// fixtures rather than one.
const INVOICE2 = "33333333-0000-4000-8000-00000000000f";
const PAYMENT2 = "44444444-0000-4000-8000-00000000000f";

const seed = psql(
  DB_URL(),
  `\\set VERBOSITY verbose
insert into auth.users (id, email) values ('${A.user}', 'synthetic-a@example.invalid');

set role service_role;

insert into pilot.accounts (id, kind, legal_name) values ('${A.account}', 'solo', 'Synthetic Alpha Air');
insert into pilot.account_members (account_id, user_id, role) values ('${A.account}', '${A.user}', 'owner');
insert into pilot.clients (id, account_id, name, payment_terms_days)
  values ('${CLIENT}', '${A.account}', 'Synthetic Charter Co', 30);

insert into pilot.invoices (id, account_id, client_id, status, invoice_number, issued_on, due_on)
  values ('${INVOICE}', '${A.account}', '${CLIENT}', 'sent', 'ALFA-2026-0001', current_date, current_date + 30);

insert into pilot.invoice_lines (account_id, invoice_id, line_type, description, quantity, unit_amount_cents)
  values ('${A.account}', '${INVOICE}', 'flight_day', 'Synthetic day rate', 1, 45000);

-- The typo: 450000 cents, not 45000. Recorded as service_role so the
-- fixture is the state a pilot would already be in when they notice.
insert into pilot.invoice_payments (id, account_id, invoice_id, paid_on, amount_cents, method)
  values ('${PAYMENT}', '${A.account}', '${INVOICE}', current_date, 450000, 'ach');

update pilot.invoices set status = 'paid' where id = '${INVOICE}';

-- Second invoice: $450 owed, $200 genuinely paid by cheque, then the same
-- $4,500 typo on top. Seeded as service_role because a tenant cannot
-- record a payment against an invoice that is already paid — which is the
-- state being reproduced.
insert into pilot.invoices (id, account_id, client_id, status, invoice_number, issued_on, due_on)
  values ('${INVOICE2}', '${A.account}', '${CLIENT}', 'sent', 'ALFA-2026-0002', current_date, current_date + 30);
insert into pilot.invoice_lines (account_id, invoice_id, line_type, description, quantity, unit_amount_cents)
  values ('${A.account}', '${INVOICE2}', 'flight_day', 'Synthetic day rate', 1, 45000);
insert into pilot.invoice_payments (account_id, invoice_id, paid_on, amount_cents, method)
  values ('${A.account}', '${INVOICE2}', current_date, 20000, 'check');
insert into pilot.invoice_payments (id, account_id, invoice_id, paid_on, amount_cents, method)
  values ('${PAYMENT2}', '${A.account}', '${INVOICE2}', current_date, 450000, 'ach');
update pilot.invoices set status = 'paid' where id = '${INVOICE2}';
`
);
if (!seed.ok) {
  note("payment-reversal:verify FAILED — the fixtures did not seed.");
  note(String(seed.stderr).slice(0, 2000));
  process.exit(1);
}

const REVERSE = `
insert into pilot.invoice_payments
  (account_id, invoice_id, paid_on, amount_cents, reverses_payment_id, reversal_reason)
values
  ('${A.account}', '${INVOICE}', current_date, -450000, '${PAYMENT}', 'Typo — meant 450.00');`;

note("The state a pilot is stuck in today");
{
  const before = asTenant(
    A.user,
    `select status || '/' || amount_paid_cents || '/' || balance_due_cents
     from pilot.invoices i join pilot.invoice_totals t on t.invoice_id = i.id
     where i.id = '${INVOICE}';`
  );
  // $4,500 recorded against a $450 invoice: reads PAID, and the client is
  // $4,050 in credit that nobody owes them.
  equals("an overstated payment settles the invoice and marks it paid", before.out, "paid/450000/-405000");

  refuses(
    "and it cannot be edited",
    A.user,
    `update pilot.invoice_payments set amount_cents = 45000 where id = '${PAYMENT}';`,
    "42501"
  );
  refuses(
    "or deleted",
    A.user,
    `delete from pilot.invoice_payments where id = '${PAYMENT}';`,
    "42501"
  );
}

note("\nCorrecting it");
{
  const after = asTenant(
    A.user,
    `${REVERSE}
     select status || '/' || amount_paid_cents || '/' || balance_due_cents
     from pilot.invoices i join pilot.invoice_totals t on t.invoice_id = i.id
     where i.id = '${INVOICE}';`
  );
  // The correction cancels the payment exactly, the balance goes back to
  // the full $450, and the invoice stops reading as paid — which is the
  // whole feature. 'sent', not 'partial': nothing is left paid.
  equals(
    "a correction cancels it exactly, and the invoice stops reading as paid",
    after.out,
    "sent/0/45000"
  );

  const both = asTenant(
    A.user,
    `${REVERSE}
     select count(*) || '/' || sum(amount_cents)
     from pilot.invoice_payments where invoice_id = '${INVOICE}';`
  );
  // TWO rows, not one edited row. What was recorded and what corrected it
  // both stay readable — the reason this shape was chosen over an UPDATE.
  equals("both rows survive — the ledger is appended to, never rewritten", both.out, "2/0");

  const thenRight = asTenant(
    A.user,
    `${REVERSE}
     insert into pilot.invoice_payments (account_id, invoice_id, paid_on, amount_cents, method)
     values ('${A.account}', '${INVOICE}', current_date, 45000, 'ach');
     update pilot.invoices set status = 'paid' where id = '${INVOICE}';
     select status || '/' || amount_paid_cents || '/' || balance_due_cents
     from pilot.invoices i join pilot.invoice_totals t on t.invoice_id = i.id
     where i.id = '${INVOICE}';`
  );
  // The full journey a pilot actually takes: correct the typo, enter the
  // real payment, mark it paid. The invoice ends where it should have
  // started.
  equals("and the right payment can then be recorded", thenRight.out, "paid/45000/0");

  const partialLeft = asTenant(
    A.user,
    `insert into pilot.invoice_payments
       (account_id, invoice_id, paid_on, amount_cents, reverses_payment_id)
     values ('${A.account}', '${INVOICE2}', current_date, -450000, '${PAYMENT2}');
     select status || '/' || amount_paid_cents || '/' || balance_due_cents
     from pilot.invoices i join pilot.invoice_totals t on t.invoice_id = i.id
     where i.id = '${INVOICE2}';`
  );
  // With a genuine part-payment still standing, the invoice goes back to
  // 'partial' rather than 'sent'. Walking it all the way back would erase
  // the $200 the client really did send.
  equals(
    "an invoice with a real payment left on it goes back to partial, not sent",
    partialLeft.out,
    "partial/20000/25000"
  );
}

note("\nWhat a correction is not");
{
  refuses(
    "it cannot be for a different amount",
    A.user,
    `insert into pilot.invoice_payments
       (account_id, invoice_id, paid_on, amount_cents, reverses_payment_id)
     values ('${A.account}', '${INVOICE}', current_date, -40000, '${PAYMENT}');`,
    "P0001"
  );
  // P0001, not the CHECK's 23514: a BEFORE trigger runs ahead of
  // constraint evaluation, so the pilot gets the sentence rather than the
  // constraint name. invoice_payments_reversal_sign is still there as the
  // backstop for anything that bypasses the trigger.
  refuses(
    "it cannot be positive",
    A.user,
    `insert into pilot.invoice_payments
       (account_id, invoice_id, paid_on, amount_cents, reverses_payment_id)
     values ('${A.account}', '${INVOICE}', current_date, 450000, '${PAYMENT}');`,
    "P0001"
  );
  // These two run AFTER a correction, so the invoice is back to 'sent'.
  // On the paid invoice the status rule fires first and the CHECK under
  // test never gets a chance — the test would have passed on the wrong
  // control.
  refuses(
    "an ordinary payment cannot be negative",
    A.user,
    `${REVERSE}
     insert into pilot.invoice_payments (account_id, invoice_id, paid_on, amount_cents)
     values ('${A.account}', '${INVOICE}', current_date, -1000);`,
    "23514"
  );
  refuses(
    "a payment of nothing is still refused",
    A.user,
    `${REVERSE}
     insert into pilot.invoice_payments (account_id, invoice_id, paid_on, amount_cents)
     values ('${A.account}', '${INVOICE}', current_date, 0);`,
    "23514"
  );
  refuses(
    "the same payment cannot be corrected twice",
    A.user,
    `${REVERSE}${REVERSE}`,
    "23505"
  );
  refuses(
    "a correction cannot itself be corrected",
    A.user,
    `${REVERSE}
     insert into pilot.invoice_payments
       (account_id, invoice_id, paid_on, amount_cents, reverses_payment_id)
     select '${A.account}', '${INVOICE}', current_date, 450000, id
       from pilot.invoice_payments where reverses_payment_id is not null;`,
    "P0001"
  );
  refuses(
    "and a correction cannot be filed against a different invoice than the payment it names",
    A.user,
    `insert into pilot.invoice_payments
       (account_id, invoice_id, paid_on, amount_cents, reverses_payment_id)
     values ('${A.account}', '${INVOICE2}', current_date, -450000, '${PAYMENT}');`,
    "P0001"
  );
}

note("\nThe status door stays shut for everything else");
{
  refuses(
    "a paid invoice still cannot simply be walked back by hand",
    A.user,
    `update pilot.invoices set status = 'sent' where id = '${INVOICE}';`,
    "P0001"
  );
  refuses(
    "a voided invoice cannot have a payment corrected",
    A.user,
    `update pilot.invoices set status = 'void' where id = '${INVOICE}';
     ${REVERSE}`,
    "P0001"
  );
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
    ? `\npayment-reversal:verify passed — ${passed} checks`
    : `\npayment-reversal:verify FAILED — ${failed} of ${passed + failed} checks`
);
process.exit(failed === 0 ? 0 : 1);

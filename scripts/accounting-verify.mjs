#!/usr/bin/env node
/**
 * Accounting core verification — chart of accounts, double-entry ledger,
 * derived postings, bank reconciliation (20260812100000 + 20260812100001).
 *
 * Everything under test is a guarantee of the DATABASE — RLS, column
 * grants, CHECK constraints, deferred constraint triggers, SECURITY
 * DEFINER functions — so it is asserted against Postgres, replayed from
 * the real migrations onto a scratch database, driven as the real
 * `authenticated` role with a real auth.uid(). Same harness and the same
 * two failure-mode rules as scripts/estimates-verify.mjs (read its header):
 * positive reads assert presence first, negative cases assert a SPECIFIC
 * SQLSTATE.
 *
 * WHAT THIS FILE PROVES, mapped to the build's own claims:
 *   1. SEEDED CHART: creating a tenant seeds the aviation chart (trigger),
 *      and the seeded system accounts are the full posting surface.
 *   2. DEBITS = CREDITS: an unbalanced manual entry is refused with P0001
 *      naming the sums; the journal tables have NO direct write path for
 *      authenticated at all (42501).
 *   3. IDEMPOTENT POSTING: ledger_sync twice creates nothing the second
 *      time; a duplicate derived entry for the same source row is refused
 *      by UNIQUE INDEX (23505), not by convention — re-posting the same
 *      invoice cannot double.
 *   4. TENANCY: every new table is invisible cross-tenant, and every
 *      write door checks membership.
 *   5. P&L RECONCILIATION: the ledger's cash figures tie TO THE CENT with
 *      the P&L's own arithmetic (payments in period, void invoices
 *      excluded, reversals netted; expenses = deduct + rebill) on a
 *      fixture that includes a partial payment, a reversal, a voided
 *      invoice carrying a payment, and an unassigned expense.
 *   6. RECONCILIATION GUARDS: a match requires identical amounts, a
 *      Cash & bank line, and one match per side (P0001 / 23505).
 *
 * All fixtures are synthetic. No live pilot data, ever.
 *
 *   npm run accounting:verify
 *
 * Needs a local Postgres. Set ACCOUNTING_VERIFY_URL to override the
 * default (postgresql://postgres@127.0.0.1:55432/postgres) and
 * ACCOUNTING_VERIFY_BOOTSTRAP to point at scripts/lib/verify-bootstrap.sql.
 */
import { execFileSync } from "node:child_process";
import { writeFileSync, rmSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const ADMIN_URL =
  process.env.ACCOUNTING_VERIFY_URL ?? "postgresql://postgres@127.0.0.1:55432/postgres";
const DB = "v1_accounting_verify";
const work = mkdtempSync(join(tmpdir(), "accounting-verify-"));

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

function asTenant(userId, sql) {
  return psql(
    `${ADMIN_URL.replace(/\/[^/]*$/, "")}/${DB}`,
    `\\set VERBOSITY verbose
begin;
set local role authenticated;
do $$ begin perform set_config('request.jwt.claims', '{"sub":"${userId}","role":"authenticated"}', true); end $$;
${sql}
commit;`
  );
}

/** Like asTenant but rolls back — for probes that must not persist. */
function asTenantRollback(userId, sql) {
  return psql(
    `${ADMIN_URL.replace(/\/[^/]*$/, "")}/${DB}`,
    `\\set VERBOSITY verbose
begin;
set local role authenticated;
do $$ begin perform set_config('request.jwt.claims', '{"sub":"${userId}","role":"authenticated"}', true); end $$;
${sql}
rollback;`
  );
}

function asAdmin(sql, label) {
  const r = psql(
    `${ADMIN_URL.replace(/\/[^/]*$/, "")}/${DB}`,
    `\\set VERBOSITY verbose\nset role service_role;\n${sql}`
  );
  if (!r.ok && label) bad(`fixture: ${label}`, r.stderr?.slice(0, 600));
  return r;
}

function refuses(label, result, expectedSqlstate) {
  if (result.ok) {
    bad(label, "the statement SUCCEEDED — the control under test is not working");
    return;
  }
  if (result.sqlstate !== expectedSqlstate) {
    bad(
      label,
      `expected SQLSTATE ${expectedSqlstate}, got ${result.sqlstate ?? "(none parsed)"}\n${result.stderr?.slice(0, 400)}`
    );
    return;
  }
  ok(`${label}  [${expectedSqlstate}]`);
}

function equals(label, actual, expected) {
  if (String(actual).trim() === String(expected)) ok(label);
  else bad(label, `expected ${JSON.stringify(String(expected))}, got ${JSON.stringify(String(actual).trim())}`);
}

// ---------------------------------------------------------------------------
// Build the database from the real migrations.
// ---------------------------------------------------------------------------
const BOOTSTRAP = process.env.ACCOUNTING_VERIFY_BOOTSTRAP;
if (!BOOTSTRAP) {
  note("accounting:verify SKIPPED — set ACCOUNTING_VERIFY_BOOTSTRAP to the");
  note("  Supabase-shaped scaffold (scripts/lib/verify-bootstrap.sql).");
  note("  Nothing about the app is broken by this skip.");
  process.exit(0);
}

try {
  execFileSync("psql", ["-X", "-q", ADMIN_URL, "-c", `drop database if exists ${DB}`], { stdio: "pipe" });
  execFileSync("psql", ["-X", "-q", ADMIN_URL, "-c", `create database ${DB}`], { stdio: "pipe" });
} catch (error) {
  note(`accounting:verify SKIPPED — no Postgres at ${ADMIN_URL}\n  ${String(error.stderr ?? error).slice(0, 200)}`);
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
  note("accounting:verify FAILED — the migrations do not replay cleanly.");
  note(String(error.stderr ?? error).slice(0, 2000));
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Fixtures: two tenants. Money facts seeded as service_role (minting
// tenants and issuing documents directly is a service act; the protect
// triggers exempt it), then everything tenant-facing driven as
// `authenticated`.
// ---------------------------------------------------------------------------
const A = {
  user: "11111111-1111-4111-8111-111111111111",
  account: "aaaaaaaa-1111-4111-8111-111111111111",
};
const B = {
  user: "22222222-2222-4222-8222-222222222222",
  account: "bbbbbbbb-2222-4222-8222-222222222222",
};

const CLIENT_A = "cccccccc-1111-4111-8111-000000000001";
const TRIP_A = "dddddddd-1111-4111-8111-000000000001";
// Invoices: V1 partial-paid with tax; V2 paid; V3 paid then reversed;
// V4 partial then VOIDED with its payment stranded.
const INV1 = "eeeeeeee-1111-4111-8111-000000000001";
const INV2 = "eeeeeeee-1111-4111-8111-000000000002";
const INV3 = "eeeeeeee-1111-4111-8111-000000000003";
const INV4 = "eeeeeeee-1111-4111-8111-000000000004";
const PAY1 = "ffffffff-1111-4111-8111-000000000001";
const PAY2 = "ffffffff-1111-4111-8111-000000000002";
const PAY3 = "ffffffff-1111-4111-8111-000000000003";
const PAY3R = "ffffffff-1111-4111-8111-000000000013";
const PAY4 = "ffffffff-1111-4111-8111-000000000004";
const EXP_DEDUCT = "abababab-1111-4111-8111-000000000001";
const EXP_REBILL = "abababab-1111-4111-8111-000000000002";
const EXP_UNASSIGNED = "abababab-1111-4111-8111-000000000003";
const BANK_ACCT = "acacacac-1111-4111-8111-000000000001";
const BATCH = "adadadad-1111-4111-8111-000000000001";
const SRCFILE = "aeaeaeae-1111-4111-8111-000000000001";
const TXN_HOTEL = "afafafaf-1111-4111-8111-000000000001";
const TXN_DEPOSIT = "afafafaf-1111-4111-8111-000000000002";
const TXN_UNKNOWN = "afafafaf-1111-4111-8111-000000000003";

const seed = psql(
  DB_URL,
  `\\set VERBOSITY verbose
insert into auth.users (id, instance_id, aud, role, email)
values ('${A.user}', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'a@verify.test'),
       ('${B.user}', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'b@verify.test');
set role service_role;
insert into pilot.accounts (id, kind, legal_name) values
  ('${A.account}', 'solo', 'Tenant A LLC'),
  ('${B.account}', 'solo', 'Tenant B LLC');
reset role;
insert into pilot.account_members (account_id, user_id, role) values
  ('${A.account}', '${A.user}', 'owner'),
  ('${B.account}', '${B.user}', 'owner');
set role service_role;
insert into pilot.clients (id, account_id, name) values
  ('${CLIENT_A}', '${A.account}', 'Acme Jets');
insert into pilot.trips (id, account_id, client_id, starts_on, ends_on) values
  ('${TRIP_A}', '${A.account}', '${CLIENT_A}', '2026-07-10', '2026-07-14');

-- V1: 3 flight days @ $1,500 (taxable) + 3 per diem @ $75 (not), 8.25%.
insert into pilot.invoices (id, account_id, client_id, tax_rate_bps, status, issued_on, invoice_number)
  values ('${INV1}', '${A.account}', '${CLIENT_A}', 825, 'partial', '2026-07-01', 'VER-2026-0001');
insert into pilot.invoice_lines (account_id, invoice_id, line_type, description, quantity, unit_amount_cents, taxable) values
  ('${A.account}', '${INV1}', 'flight_day', '3 flight days', 3, 150000, true),
  ('${A.account}', '${INV1}', 'per_diem', 'per diem', 3, 7500, false);
insert into pilot.invoice_payments (id, account_id, invoice_id, paid_on, amount_cents)
  values ('${PAY1}', '${A.account}', '${INV1}', '2026-07-15', 200000);

-- V2: one travel day, no tax, paid in full.
insert into pilot.invoices (id, account_id, client_id, tax_rate_bps, status, issued_on, invoice_number)
  values ('${INV2}', '${A.account}', '${CLIENT_A}', 0, 'paid', '2026-07-05', 'VER-2026-0002');
insert into pilot.invoice_lines (account_id, invoice_id, line_type, description, quantity, unit_amount_cents, taxable) values
  ('${A.account}', '${INV2}', 'travel_day', 'positioning day', 1, 80000, true);
insert into pilot.invoice_payments (id, account_id, invoice_id, paid_on, amount_cents)
  values ('${PAY2}', '${A.account}', '${INV2}', '2026-07-20', 80000);

-- V3: paid, then the payment REVERSED (20260810120000 correction row).
insert into pilot.invoices (id, account_id, client_id, tax_rate_bps, status, issued_on, invoice_number)
  values ('${INV3}', '${A.account}', '${CLIENT_A}', 0, 'sent', '2026-07-08', 'VER-2026-0003');
insert into pilot.invoice_lines (account_id, invoice_id, line_type, description, quantity, unit_amount_cents, taxable) values
  ('${A.account}', '${INV3}', 'flight_day', 'one day', 1, 100000, true);
insert into pilot.invoice_payments (id, account_id, invoice_id, paid_on, amount_cents)
  values ('${PAY3}', '${A.account}', '${INV3}', '2026-07-21', 100000);
insert into pilot.invoice_payments (id, account_id, invoice_id, paid_on, amount_cents, reverses_payment_id, reversal_reason)
  values ('${PAY3R}', '${A.account}', '${INV3}', '2026-07-25', -100000, '${PAY3}', 'typo');

-- V4: partial payment, then VOIDED — the payment is stranded on a void
-- invoice and must leave income (P&L already excludes it).
insert into pilot.invoices (id, account_id, client_id, tax_rate_bps, status, issued_on, invoice_number)
  values ('${INV4}', '${A.account}', '${CLIENT_A}', 0, 'void', '2026-07-02', 'VER-2026-0004');
insert into pilot.invoice_lines (account_id, invoice_id, line_type, description, quantity, unit_amount_cents, taxable) values
  ('${A.account}', '${INV4}', 'flight_day', 'one day', 1, 50000, true);
insert into pilot.invoice_payments (id, account_id, invoice_id, paid_on, amount_cents)
  values ('${PAY4}', '${A.account}', '${INV4}', '2026-07-03', 20000);

-- Expenses: one of each treatment. Unassigned must NOT post.
insert into pilot.expenses (id, account_id, incurred_on, category, vendor, amount_cents, treatment, trip_id) values
  ('${EXP_DEDUCT}', '${A.account}', '2026-07-10', 'hotel', 'Synth Inn', 31200, 'deduct', null),
  ('${EXP_REBILL}', '${A.account}', '2026-07-12', 'fuel', 'Synth Fuel', 15000, 'rebill', '${TRIP_A}'),
  ('${EXP_UNASSIGNED}', '${A.account}', '2026-07-13', 'meals', 'Synth Diner', 5000, 'unassigned', null);

-- Mileage: 100 mi @ 70 cents.
insert into pilot.mileage_entries (account_id, drove_on, miles, from_place, to_place, purpose, rate_cents_per_mile)
  values ('${A.account}', '2026-07-11', 100, 'home', 'KTEB', 'sim training', 70);

-- Bank statement fixture: one source, three lines. Canonical sign:
-- negative = money out. The hotel line mirrors EXP_DEDUCT; the deposit
-- mirrors PAY1; the third has no counterpart in the books.
insert into pilot.bank_accounts (id, account_id, label, kind) values
  ('${BANK_ACCT}', '${A.account}', 'Verify Checking', 'checking');
insert into pilot.bank_import_batches (id, account_id, bank_account_id, source_format) values
  ('${BATCH}', '${A.account}', '${BANK_ACCT}', 'csv_signed');
insert into pilot.bank_source_files (id, account_id, import_batch_id, file_name) values
  ('${SRCFILE}', '${A.account}', '${BATCH}', 'july.csv');
insert into pilot.bank_transactions
  (id, account_id, bank_account_id, import_batch_id, source_file_id, source_row_number, source_row, posted_on, description, amount_cents, fingerprint) values
  ('${TXN_HOTEL}', '${A.account}', '${BANK_ACCT}', '${BATCH}', '${SRCFILE}', 1, '{}', '2026-07-10', 'SYNTH INN 88', -31200, 'fp-hotel'),
  ('${TXN_DEPOSIT}', '${A.account}', '${BANK_ACCT}', '${BATCH}', '${SRCFILE}', 2, '{}', '2026-07-15', 'ACH ACME JETS', 200000, 'fp-deposit'),
  ('${TXN_UNKNOWN}', '${A.account}', '${BANK_ACCT}', '${BATCH}', '${SRCFILE}', 3, '{}', '2026-07-16', 'CARD 4471 MYSTERY', -9999, 'fp-unknown');

-- Tenant B gets a minimal parallel world for isolation probes.
insert into pilot.clients (id, account_id, name) values
  ('cccccccc-2222-4222-8222-000000000001', '${B.account}', 'Bravo Air');
`
);
if (!seed.ok) {
  note("Seeding failed:\n" + seed.stderr);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// 1. Seeded chart of accounts.
// ---------------------------------------------------------------------------
note("1. Seeded chart of accounts");

let r = asTenant(A.user, `select count(*) from pilot.accounts_chart where account_id = '${A.account}';`);
equals("account creation seeded the aviation chart (28 accounts)", r.out, "28");

r = asTenant(
  A.user,
  `select count(*) from pilot.accounts_chart where account_id = '${A.account}' and system_key in
   ('bank','accounts_receivable','sales_tax_payable','client_credit','owner_draws','owner_contributions',
    'income_flight_day','income_travel_day','income_per_diem','income_reimbursable_expense',
    'income_cancellation_fee','income_other','expense_mileage');`
);
equals("every posting-target system_key exists", r.out, "13");

r = asTenant(
  A.user,
  `select count(*) from pilot.accounts_chart
   where account_id = '${A.account}' and kind = 'expense' and system_key like 'expense\\_%';`
);
equals("an expense account per category (15) plus mileage", r.out, "16");

// Editable: add / rename / archive; system accounts protected.
r = asTenant(
  A.user,
  `insert into pilot.accounts_chart (account_id, name, kind) values ('${A.account}', 'Simulator rental income', 'income');
   update pilot.accounts_chart set name = 'Day rates' where account_id = '${A.account}' and system_key = 'income_flight_day';
   select name from pilot.accounts_chart where account_id = '${A.account}' and system_key = 'income_flight_day';`
);
equals("pilot can add an account and rename a seeded one", r.out, "Day rates");

refuses(
  "archiving a built-in posting account is refused",
  asTenantRollback(
    A.user,
    `update pilot.accounts_chart set archived_at = now() where account_id = '${A.account}' and system_key = 'bank';`
  ),
  "P0001"
);
refuses(
  "changing a system_key is not even grantable",
  asTenantRollback(
    A.user,
    `update pilot.accounts_chart set system_key = 'bank2' where account_id = '${A.account}' and system_key = 'bank';`
  ),
  "42501"
);
r = asTenant(
  A.user,
  `update pilot.accounts_chart set archived_at = now()
     where account_id = '${A.account}' and name = 'Simulator rental income' and system_key is null;
   select count(*) from pilot.accounts_chart where account_id = '${A.account}' and archived_at is not null;`
);
equals("a pilot-created account archives cleanly", r.out, "1");

// ---------------------------------------------------------------------------
// 2. Debits = credits, and no side door.
// ---------------------------------------------------------------------------
note("\n2. Double-entry enforcement");

refuses(
  "an unbalanced manual entry is refused",
  asTenantRollback(
    A.user,
    `select pilot.journal_entry_create('${A.account}', '2026-07-30', 'unbalanced', jsonb_build_array(
       jsonb_build_object('chart_account_id', (select id from pilot.accounts_chart where account_id='${A.account}' and system_key='bank'), 'side', 'debit', 'amount_cents', 1000),
       jsonb_build_object('chart_account_id', (select id from pilot.accounts_chart where account_id='${A.account}' and system_key='owner_contributions'), 'side', 'credit', 'amount_cents', 900)
     ));`
  ),
  "P0001"
);
refuses(
  "a one-line entry is refused",
  asTenantRollback(
    A.user,
    `select pilot.journal_entry_create('${A.account}', '2026-07-30', 'single', jsonb_build_array(
       jsonb_build_object('chart_account_id', (select id from pilot.accounts_chart where account_id='${A.account}' and system_key='bank'), 'side', 'debit', 'amount_cents', 1000)
     ));`
  ),
  "P0001"
);
refuses(
  "direct INSERT into journal_entries has no grant",
  asTenantRollback(
    A.user,
    `insert into pilot.journal_entries (account_id, entry_date, memo) values ('${A.account}', '2026-07-30', 'side door');`
  ),
  "42501"
);
refuses(
  "direct INSERT into journal_lines has no grant",
  asTenantRollback(
    A.user,
    `insert into pilot.journal_lines (account_id, entry_id, chart_account_id, side, amount_cents)
     values ('${A.account}', gen_random_uuid(), gen_random_uuid(), 'debit', 100);`
  ),
  "42501"
);

// A balanced manual entry works: an owner draw — the honest solo-pilot
// payroll equivalent this chart is built around.
r = asTenant(
  A.user,
  `select pilot.journal_entry_create('${A.account}', '2026-07-28', 'Owner draw', jsonb_build_array(
     jsonb_build_object('chart_account_id', (select id from pilot.accounts_chart where account_id='${A.account}' and system_key='owner_draws'), 'side', 'debit', 'amount_cents', 250000),
     jsonb_build_object('chart_account_id', (select id from pilot.accounts_chart where account_id='${A.account}' and system_key='bank'), 'side', 'credit', 'amount_cents', 250000)
   )) is not null;`
);
equals("a balanced owner-draw entry posts", r.out, "t");

// The deferred trigger catches even service_role: an entry inserted with
// no lines cannot COMMIT.
refuses(
  "even service_role cannot commit a line-less entry (deferred trigger)",
  asAdmin(
    `insert into pilot.journal_entries (account_id, entry_date, memo) values ('${A.account}', '2026-07-30', 'no lines');`
  ),
  "P0001"
);

// ---------------------------------------------------------------------------
// 3. Derived postings: idempotent by unique index.
// ---------------------------------------------------------------------------
note("\n3. Idempotent derived postings");

r = asTenant(A.user, `select (pilot.ledger_sync('${A.account}'))->>'created';`);
equals("first sync derives 14 entries (4 issues, 1 void, 5 payments, 1 reclass, 2 expenses, 1 mileage)", r.out, "14");

r = asTenant(A.user, `select (pilot.ledger_sync('${A.account}'))->>'created';`);
equals("second sync creates NOTHING — same facts, same keys", r.out, "0");

r = asTenant(
  A.user,
  `select count(*) from pilot.journal_entries where account_id='${A.account}' and source_type='invoice_issued' and source_id='${INV1}';`
);
equals("exactly one issue entry for the invoice", r.out, "1");

refuses(
  "a duplicate derived entry is refused BY INDEX even for service_role",
  asAdmin(
    `insert into pilot.journal_entries (account_id, entry_date, memo, source_type, source_id)
     select '${A.account}', '2026-07-15', 'dupe', 'payment', '${PAY1}';`
  ),
  "23505"
);

// Drift: editing an expense refreshes its entry under the same key.
r = asAdmin(
  `update pilot.expenses set amount_cents = 32000 where id = '${EXP_DEDUCT}';`,
  "drift the deduct expense"
);
r = asTenant(
  A.user,
  `select pilot.ledger_sync('${A.account}');
   select amount_cents from pilot.journal_lines jl
   join pilot.journal_entries je on je.id = jl.entry_id
   where je.account_id='${A.account}' and je.source_type='expense' and je.source_id='${EXP_DEDUCT}' and jl.side='debit';`
);
equals("an edited expense re-derives at the new amount (one entry, refreshed)", r.out.split("\n").pop(), "32000");
asAdmin(`update pilot.expenses set amount_cents = 31200 where id = '${EXP_DEDUCT}';`, "restore expense");
asTenant(A.user, `select pilot.ledger_sync('${A.account}');`);

// Unassigned expenses never post (mirrors the P&L's exclusion).
r = asTenant(
  A.user,
  `select count(*) from pilot.journal_entries where account_id='${A.account}' and source_type='expense' and source_id='${EXP_UNASSIGNED}';`
);
equals("an unassigned expense is NOT posted", r.out, "0");

// ---------------------------------------------------------------------------
// 4. Tenancy isolation on every new table.
// ---------------------------------------------------------------------------
note("\n4. Tenancy isolation");

r = asTenant(A.user, `select count(*) > 27 from pilot.accounts_chart;`);
equals("A sees A's chart (presence first)", r.out, "t");
r = asTenant(B.user, `select count(*) from pilot.accounts_chart where account_id = '${A.account}';`);
equals("B sees none of A's chart", r.out, "0");
r = asTenant(B.user, `select count(*) from pilot.journal_entries where account_id = '${A.account}';`);
equals("B sees none of A's journal entries", r.out, "0");
r = asTenant(B.user, `select count(*) from pilot.journal_lines where account_id = '${A.account}';`);
equals("B sees none of A's journal lines", r.out, "0");
r = asTenant(B.user, `select count(*) from pilot.ledger_balances('${A.account}', '2026-12-31') where balance_cents <> 0;`);
equals("ledger_balances is INVOKER — B reads zero of A's balances through it", r.out, "0");
refuses(
  "B cannot sync A's ledger",
  asTenantRollback(B.user, `select pilot.ledger_sync('${A.account}');`),
  "P0001"
);
refuses(
  "B cannot write a manual entry into A's journal",
  asTenantRollback(
    B.user,
    `select pilot.journal_entry_create('${A.account}', '2026-07-30', 'intruder', jsonb_build_array(
       jsonb_build_object('chart_account_id', gen_random_uuid(), 'side', 'debit', 'amount_cents', 100),
       jsonb_build_object('chart_account_id', gen_random_uuid(), 'side', 'credit', 'amount_cents', 100)
     ));`
  ),
  "P0001"
);
refuses(
  "B cannot insert a chart account into A's tenant",
  asTenantRollback(
    B.user,
    `insert into pilot.accounts_chart (account_id, name, kind) values ('${A.account}', 'sneak', 'income');`
  ),
  "42501"
);
refuses(
  "B cannot delete A's manual entry",
  asTenantRollback(
    B.user,
    `select pilot.journal_entry_delete((select id from pilot.journal_entries where account_id='${A.account}' and source_type='manual' limit 1));`
  ),
  "P0001"
);

// ---------------------------------------------------------------------------
// 5. THE RECONCILIATION: ledger figures tie with the P&L's arithmetic.
//    P&L income (cash) = sum of invoice_payments in period, excluding
//    payments on invoices whose status is now 'void' (reversals net out
//    as negative rows) — exactly reports/profit-loss/queries.ts.
//    Ledger equivalent = signed Cash & bank movement of 'payment' entries
//    minus the 'payment_void_reclass' amounts.
// ---------------------------------------------------------------------------
note("\n5. P&L-vs-ledger reconciliation (July 2026)");

// The P&L's own arithmetic, in SQL: 200000 + 80000 + 100000 - 100000 = 280000.
r = asTenant(
  A.user,
  `select coalesce(sum(p.amount_cents), 0) from pilot.invoice_payments p
   join pilot.invoices i on i.id = p.invoice_id
   where p.account_id = '${A.account}' and p.paid_on between '2026-07-01' and '2026-07-31'
     and i.status <> 'void';`
);
equals("P&L cash income for July (the existing report's own sum)", r.out, "280000");

r = asTenant(
  A.user,
  `with payment_cash as (
     select coalesce(sum(case jl.side when 'debit' then jl.amount_cents else -jl.amount_cents end), 0) as cents
     from pilot.journal_entries je
     join pilot.journal_lines jl on jl.entry_id = je.id
     join pilot.accounts_chart c on c.id = jl.chart_account_id
     where je.account_id = '${A.account}' and je.source_type = 'payment'
       and je.entry_date between '2026-07-01' and '2026-07-31'
       and c.system_key = 'bank'
   ), reclass as (
     select coalesce(sum(case jl.side when 'debit' then jl.amount_cents else -jl.amount_cents end), 0) as cents
     from pilot.journal_entries je
     join pilot.journal_lines jl on jl.entry_id = je.id
     join pilot.accounts_chart c on c.id = jl.chart_account_id
     where je.account_id = '${A.account}' and je.source_type = 'payment_void_reclass'
       and je.entry_date between '2026-07-01' and '2026-07-31'
       and c.system_key = 'accounts_receivable'
   )
   select payment_cash.cents - reclass.cents from payment_cash, reclass;`
);
equals("ledger cash income for July ties TO THE CENT", r.out, "280000");

// Expenses: P&L counts deduct + rebill = 31200 + 15000 = 46200 (never
// unassigned, never mileage).
r = asTenant(
  A.user,
  `select coalesce(sum(amount_cents), 0) from pilot.expenses
   where account_id = '${A.account}' and treatment in ('deduct','rebill')
     and incurred_on between '2026-07-01' and '2026-07-31';`
);
equals("P&L expenses for July (deduct + rebill)", r.out, "46200");

r = asTenant(
  A.user,
  `select coalesce(sum(case jl.side when 'debit' then jl.amount_cents else -jl.amount_cents end), 0)
   from pilot.journal_entries je
   join pilot.journal_lines jl on jl.entry_id = je.id
   join pilot.accounts_chart c on c.id = jl.chart_account_id
   where je.account_id = '${A.account}' and je.source_type = 'expense'
     and je.entry_date between '2026-07-01' and '2026-07-31'
     and c.kind = 'expense' and c.system_key is distinct from 'expense_mileage';`
);
equals("ledger expense postings tie TO THE CENT", r.out, "46200");

// Mileage: per-entry snapshot amounts, in its own account (see the
// migration header for why this is asserted separately from the P&L's
// year-rounded Schedule C figure).
r = asTenant(
  A.user,
  `select
    (select coalesce(sum(amount_cents),0) from pilot.mileage_entries where account_id = '${A.account}')
    =
    (select coalesce(sum(jl.amount_cents),0) from pilot.journal_entries je
     join pilot.journal_lines jl on jl.entry_id = je.id and jl.side = 'debit'
     where je.account_id = '${A.account}' and je.source_type = 'mileage');`
);
equals("mileage account equals the per-entry snapshot sum", r.out, "t");

// The whole ledger balances, and the balance-sheet identity holds.
r = asTenant(
  A.user,
  `select coalesce(sum(case side when 'debit' then amount_cents else -amount_cents end), 0)
   from pilot.journal_lines where account_id = '${A.account}';`
);
equals("every debit has its credit: signed sum of ALL lines is zero", r.out, "0");

r = asTenant(
  A.user,
  `with b as (select * from pilot.ledger_balances('${A.account}', '2026-12-31'))
   select
     (select coalesce(sum(balance_cents),0) from b where kind = 'asset')
     =
     (select coalesce(sum(-balance_cents),0) from b where kind in ('liability','equity'))
     + (select coalesce(sum(-balance_cents),0) from b where kind in ('income','expense'));`
);
equals("assets = liabilities + equity (incl. net income) as of year end", r.out, "t");

// AR spot-check: V1 outstanding 309625; V3 back to 100000 after reversal;
// V4 fully reclassed to client_credit. AR = 309625 + 100000 = 409625.
r = asTenant(
  A.user,
  `select balance_cents from pilot.ledger_balances('${A.account}', '2026-12-31') where system_key = 'accounts_receivable';`
);
equals("accounts receivable = V1 balance + V3 after reversal", r.out, "409625");
r = asTenant(
  A.user,
  `select -balance_cents from pilot.ledger_balances('${A.account}', '2026-12-31') where system_key = 'client_credit';`
);
equals("the void invoice's stranded payment sits in client funds held", r.out, "20000");
r = asTenant(
  A.user,
  `select -balance_cents from pilot.ledger_balances('${A.account}', '2026-12-31') where system_key = 'sales_tax_payable';`
);
equals("sales tax collected = invoice_totals.tax_cents for V1", r.out, "37125");

// ---------------------------------------------------------------------------
// 6. Bank reconciliation.
// ---------------------------------------------------------------------------
note("\n6. Bank reconciliation");

// The two real matches: hotel expense line (-31200) and PAY1 deposit (+200000).
r = asTenant(
  A.user,
  `insert into pilot.bank_statement_matches (account_id, bank_transaction_id, journal_line_id)
   select '${A.account}', '${TXN_HOTEL}', jl.id
   from pilot.journal_entries je
   join pilot.journal_lines jl on jl.entry_id = je.id and jl.side = 'credit'
   join pilot.accounts_chart c on c.id = jl.chart_account_id and c.system_key = 'bank'
   where je.account_id = '${A.account}' and je.source_type = 'expense' and je.source_id = '${EXP_DEDUCT}';
   insert into pilot.bank_statement_matches (account_id, bank_transaction_id, journal_line_id)
   select '${A.account}', '${TXN_DEPOSIT}', jl.id
   from pilot.journal_entries je
   join pilot.journal_lines jl on jl.entry_id = je.id and jl.side = 'debit'
   join pilot.accounts_chart c on c.id = jl.chart_account_id and c.system_key = 'bank'
   where je.account_id = '${A.account}' and je.source_type = 'payment' and je.source_id = '${PAY1}';
   select count(*) from pilot.bank_statement_matches where account_id = '${A.account}';`
);
equals("statement lines match their ledger counterparts", r.out, "2");

refuses(
  "a mismatched amount cannot be matched",
  asTenantRollback(
    A.user,
    `insert into pilot.bank_statement_matches (account_id, bank_transaction_id, journal_line_id)
     select '${A.account}', '${TXN_UNKNOWN}', jl.id
     from pilot.journal_entries je
     join pilot.journal_lines jl on jl.entry_id = je.id and jl.side = 'credit'
     join pilot.accounts_chart c on c.id = jl.chart_account_id and c.system_key = 'bank'
     where je.account_id = '${A.account}' and je.source_type = 'manual' limit 1;`
  ),
  "P0001"
);
refuses(
  "a non-bank ledger line cannot be matched",
  asTenantRollback(
    A.user,
    `insert into pilot.bank_statement_matches (account_id, bank_transaction_id, journal_line_id)
     select '${A.account}', '${TXN_HOTEL}', jl.id
     from pilot.journal_entries je
     join pilot.journal_lines jl on jl.entry_id = je.id
     join pilot.accounts_chart c on c.id = jl.chart_account_id and c.system_key = 'expense_hotel'
     where je.account_id = '${A.account}' and je.source_type = 'expense' and je.source_id = '${EXP_DEDUCT}';`
  ),
  "P0001"
);
refuses(
  "a statement line cannot clear twice",
  asTenantRollback(
    A.user,
    `insert into pilot.bank_statement_matches (account_id, bank_transaction_id, journal_line_id)
     select '${A.account}', '${TXN_HOTEL}', jl.id
     from pilot.journal_entries je
     join pilot.journal_lines jl on jl.entry_id = je.id and jl.side = 'credit'
     join pilot.accounts_chart c on c.id = jl.chart_account_id and c.system_key = 'bank'
     where je.account_id = '${A.account}' and je.source_type = 'expense' and je.source_id = '${EXP_DEDUCT}';`
  ),
  "23505"
);
r = asTenant(B.user, `select count(*) from pilot.bank_statement_matches where account_id = '${A.account}';`);
equals("B sees none of A's matches", r.out, "0");
refuses(
  // P0001, not 42501: the validation trigger (BEFORE ROW) fires ahead of
  // the RLS WITH CHECK, and its own lookup — running under B's RLS — sees
  // none of A's rows, so it refuses with "not recognized" without ever
  // confirming the line exists. The write is blocked either way; RLS
  // remains the backstop for a row the trigger would have accepted.
  "B cannot mint a match inside A's tenant",
  asTenantRollback(
    B.user,
    `insert into pilot.bank_statement_matches (account_id, bank_transaction_id, journal_line_id)
     values ('${A.account}', '${TXN_UNKNOWN}', gen_random_uuid());`
  ),
  "P0001"
);

// Unmatch is a delete, and the ledger-side refresh cascades: re-deriving
// the matched expense kills the match rather than leaving it pointing at
// a dead line.
r = asAdmin(
  `update pilot.expenses set amount_cents = 31300 where id = '${EXP_DEDUCT}';`,
  "drift the matched expense"
);
r = asTenant(
  A.user,
  `select pilot.ledger_sync('${A.account}');
   select count(*) from pilot.bank_statement_matches where account_id = '${A.account}' and bank_transaction_id = '${TXN_HOTEL}';`
);
equals("refreshing a matched entry cascades the match away (honest unclearing)", r.out.split("\n").pop(), "0");

note("");
note(`${passed} passed, ${failed} failed`);
rmSync(work, { recursive: true, force: true });
process.exit(failed === 0 ? 0 : 1);

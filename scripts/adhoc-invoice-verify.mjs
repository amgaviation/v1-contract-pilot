#!/usr/bin/env node
/**
 * Verification for 20260815100000_invoices_without_a_client.sql.
 *
 * WHAT THIS PROVES, AND WHY IT IS SQL RATHER THAN supabase-js.
 * ---------------------------------------------------------------------------
 * Everything the feature rests on is a guarantee of the DATABASE: a dropped
 * NOT NULL, a check constraint, two column-scoped GRANTs, a trigger that now
 * has two branches for the due date, and a SECURITY DEFINER function whose
 * inner join would have made a shared clientless invoice 404 in silence. Those
 * live in Postgres, so they are asserted against Postgres, replayed from the
 * real migrations onto a scratch database and driven as the real
 * `authenticated` role with a real auth.uid().
 *
 * Same two failure modes every verify script in this repo is written against:
 *
 *   1. Treating "no rows" as proof. A dead connection, a typo'd table name
 *      and a working policy all return nothing. Every positive read asserts
 *      the value it expects.
 *   2. Treating "an error happened" as proof of a refusal. Every negative case
 *      asserts a SPECIFIC SQLSTATE: 23514 for the check constraint, 23503 for
 *      the foreign key, 42501 for a withheld privilege, P0001 for a trigger's
 *      own raise.
 *
 * All fixtures are synthetic. No live pilot data, ever.
 *
 *   npm run adhoc-invoice:verify
 *
 * Needs a local Postgres. Set ADHOC_INVOICE_VERIFY_URL to override the default
 * (postgresql://postgres@127.0.0.1:55432/postgres); the scratch database is
 * created and dropped by this script.
 */
import { execFileSync } from "node:child_process";
import { writeFileSync, rmSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const ADMIN_URL =
  process.env.ADHOC_INVOICE_VERIFY_URL ?? "postgresql://postgres@127.0.0.1:55432/postgres";
const DB = "v1_adhoc_invoice_verify";
const work = mkdtempSync(join(tmpdir(), "adhoc-invoice-verify-"));

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
    // Under `\set VERBOSITY verbose` psql prints the code right after the
    // severity, and prefixes the line with "psql:<file>:<line>: ", so an
    // anchored ^ERROR never matches. Match the severity anywhere on the line.
    const m = /\bERROR:\s+([0-9A-Z]{5}):/.exec(stderr);
    return { ok: false, out: "", sqlstate: m?.[1] ?? null, stderr };
  }
}

const DB_URL = () => `${ADMIN_URL.replace(/\/[^/]*$/, "")}/${DB}`;

/** Run SQL as a tenant, inside a transaction that always rolls back. */
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

/** Run SQL as a tenant and KEEP it: for the multi-step lifecycle below. */
function asTenantCommitted(userId, sql) {
  return psql(
    DB_URL(),
    `\\set VERBOSITY verbose
begin;
set local role authenticated;
do $$ begin perform set_config('request.jwt.claims', '{"sub":"${userId}","role":"authenticated"}', true); end $$;
${sql}
commit;`
  );
}

/** As anon, the role the public share link actually runs as. */
function asAnon(sql) {
  return psql(DB_URL(), `\\set VERBOSITY verbose\nset role anon;\n${sql}`);
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
    bad(label, "the statement SUCCEEDED: the control under test is not working");
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
// Build the database from the real migrations.
// ---------------------------------------------------------------------------
const BOOTSTRAP = process.env.ADHOC_INVOICE_VERIFY_BOOTSTRAP;
if (!BOOTSTRAP) {
  note("adhoc-invoice:verify SKIPPED. Set ADHOC_INVOICE_VERIFY_BOOTSTRAP to the");
  note("  Supabase-shaped scaffold (scripts/lib/verify-bootstrap.sql).");
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
    `adhoc-invoice:verify SKIPPED. No Postgres at ${ADMIN_URL}\n  ${String(error.stderr ?? error).slice(0, 200)}`
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
  note("adhoc-invoice:verify FAILED. The migrations do not replay cleanly.");
  note(String(error.stderr ?? error).slice(0, 2000));
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Two synthetic tenants. Account A sets its own default terms (Net 45) so the
// clientless due-date branch is proved against a value that is neither the
// client's terms nor the hardcoded 30-day fallback: if the trigger read the
// wrong source, the date would land on a different day and the assertion would
// catch it. Account B leaves them null, which proves the 30-day fallback.
// ---------------------------------------------------------------------------
const A = {
  user: "11111111-1111-4111-8111-111111111111",
  account: "aaaaaaaa-0000-4000-8000-000000000001",
  client: "cccccccc-0000-4000-8000-00000000000a",
};
const B = {
  user: "22222222-2222-4222-8222-222222222222",
  account: "bbbbbbbb-0000-4000-8000-000000000002",
  client: "cccccccc-0000-4000-8000-00000000000b",
};

const seed = psql(
  DB_URL(),
  `\\set VERBOSITY verbose
insert into auth.users (id, email) values
  ('${A.user}', 'synthetic-a@example.invalid'),
  ('${B.user}', 'synthetic-b@example.invalid');

set role service_role;

insert into pilot.accounts (id, kind, legal_name, invoice_prefix, default_payment_terms_days)
values ('${A.account}', 'solo', 'Synthetic Alpha Air', 'ALFA', 45),
       ('${B.account}', 'solo', 'Synthetic Bravo Air', 'BRVO', null);

insert into pilot.account_members (account_id, user_id, role) values
  ('${A.account}', '${A.user}', 'owner'),
  ('${B.account}', '${B.user}', 'owner');

insert into pilot.clients (id, account_id, name, payment_terms_days, contact_email) values
  ('${A.client}', '${A.account}', 'Synthetic Client A', 30, 'ap-a@example.invalid'),
  ('${B.client}', '${B.account}', 'Synthetic Client B', 15, 'ap-b@example.invalid');

-- AN EXISTING, PRE-MIGRATION-SHAPED INVOICE. Client-linked, no bill_to_*.
-- Every assertion about "the linked case does not move" is made against this
-- row, and the check constraint had to accept it at VALIDATE time or the
-- migration would not have replayed at all above.
insert into pilot.invoices (id, account_id, client_id, tax_rate_bps)
values ('dddddddd-0000-4000-8000-00000000000a', '${A.account}', '${A.client}', 0);
insert into pilot.invoice_lines (account_id, invoice_id, line_type, description, quantity, unit_amount_cents)
values ('${A.account}', 'dddddddd-0000-4000-8000-00000000000a', 'flight_day', 'Synthetic day', 2, 90000);
`
);
if (!seed.ok) {
  note("adhoc-invoice:verify FAILED. Could not seed synthetic tenants.");
  note(String(seed.stderr).slice(0, 2000));
  process.exit(1);
}

note("Migration shape\n");

// ---------------------------------------------------------------------------
// 1. THE COLUMN IS NULLABLE, THE FK IS UNCHANGED, THE POLICIES ARE UNCHANGED.
// ---------------------------------------------------------------------------
equals(
  "invoices.client_id is nullable",
  psql(
    DB_URL(),
    `select is_nullable from information_schema.columns
      where table_schema = 'pilot' and table_name = 'invoices' and column_name = 'client_id';`
  ).out,
  "YES"
);

// The `on delete restrict` property the brief requires be preserved. Asserted
// from the catalog rather than inferred from a successful delete, because a
// delete that succeeds for some OTHER reason would read the same.
equals(
  "the client FK is still ON DELETE RESTRICT",
  psql(
    DB_URL(),
    `select confdeltype from pg_constraint
      where conrelid = 'pilot.invoices'::regclass and contype = 'f'
        and confrelid = 'pilot.clients'::regclass;`
  ).out,
  "r"
);

// RLS: the migration's own comment claims client_id appears in no policy on
// this table. Asserted, not trusted: a policy that started consulting it would
// be exactly the widening the brief forbids.
equals(
  "no RLS policy on pilot.invoices mentions client_id",
  psql(
    DB_URL(),
    `select count(*) from pg_policies
      where schemaname = 'pilot' and tablename = 'invoices'
        and (coalesce(qual, '') like '%client_id%' or coalesce(with_check, '') like '%client_id%');`
  ).out,
  "0"
);
// EVERY policy on pilot.invoices is scoped by account_id — asserted as a
// comparison against the live policy count, not against a hardcoded number.
//
// This used to read "all three ... expected 3", and 20260820100000 added a
// fourth (invoices_delete) without updating it, so the suite failed over a
// policy that is in fact correctly scoped. Deriving both sides means the
// assertion keeps testing what it is actually for — that no policy on this
// table escapes tenant scoping — instead of needing a hand-bump every time
// a policy is added, which is how a control quietly stops controlling
// anything.
//
// An INSERT policy has no USING clause at all, so qual is null for it and
// with_check carries the predicate; checking only one column would silently
// under-count and read as a pass.
// Deriving both sides removes one failure mode and introduces two, so both
// are closed before the comparison runs. `psql()` returns out:"" on ANY
// error, so a typo or a dead connection would otherwise compare "" to "" and
// read as a pass; and a migration that dropped every policy without adding
// one back would compare 0 to 0 and do the same. Either would be this file's
// own header sin (":15-23", "Treating 'no rows' as proof"), so the count is
// asserted present and non-zero first, and only then compared.
{
  const scopedR = psql(
    DB_URL(),
    `select count(*) from pg_policies
      where schemaname = 'pilot' and tablename = 'invoices'
        and (coalesce(qual, '') like '%current_account_ids%'
             or coalesce(with_check, '') like '%current_account_ids%');`
  );
  const totalR = psql(
    DB_URL(),
    `select count(*) from pg_policies
      where schemaname = 'pilot' and tablename = 'invoices';`
  );

  if (!scopedR.ok || !totalR.ok) {
    bad(
      "invoice policy scoping could not be read",
      `psql failed, so this assertion proved nothing: ${
        (scopedR.stderr ?? totalR.stderr ?? "").slice(0, 300)
      }`
    );
  } else {
    const total = String(totalR.out).trim();
    const scoped = String(scopedR.out).trim();
    // pilot.invoices has carried policies since 20260805090000. Zero here
    // means they were dropped, not that they are all scoped.
    if (!/^[0-9]+$/.test(total) || Number(total) === 0) {
      bad(
        "invoice policy scoping could not be read",
        `expected at least one policy on pilot.invoices, got ${JSON.stringify(total)}`
      );
    } else {
      equals(
        `every invoice policy is still scoped by account_id alone (${total} on the table)`,
        scoped,
        total
      );
    }
  }
}

note("\nThe check constraint: exactly one bill-to source, never zero\n");

refuses(
  "an invoice with no client and no typed name is refused",
  A.user,
  `insert into pilot.invoices (account_id, tax_rate_bps) values ('${A.account}', 0);`,
  "23514"
);

refuses(
  "an invoice cannot carry BOTH a client and a typed name",
  A.user,
  `insert into pilot.invoices (account_id, client_id, bill_to_name)
     values ('${A.account}', '${A.client}', 'Should Not Exist');`,
  "23514"
);

refuses(
  "a client-linked invoice cannot have a typed name bolted on later",
  A.user,
  `update pilot.invoices set bill_to_name = 'Sneaky'
     where id = 'dddddddd-0000-4000-8000-00000000000a';`,
  "23514"
);

// The tenancy boundary is untouched by any of this: a null client_id does not
// let a tenant reach another account's row, and a SET client_id still cannot
// name a stranger's client.
refuses(
  "a clientless invoice still cannot be created on another tenant's account",
  A.user,
  `insert into pilot.invoices (account_id, bill_to_name)
     values ('${B.account}', 'Cross Tenant Ops');`,
  "42501"
);
refuses(
  "an invoice still cannot name another tenant's client",
  A.user,
  `insert into pilot.invoices (account_id, client_id) values ('${A.account}', '${B.client}');`,
  "23503"
);

note("\nGrants: the new columns are writable, the withheld ones still are not\n");

{
  const r = asTenant(
    A.user,
    `insert into pilot.invoices
       (account_id, bill_to_name, bill_to_contact_name, bill_to_email,
        bill_to_address_line1, bill_to_city, bill_to_state, bill_to_postal_code,
        bill_to_country, tax_rate_bps)
     values ('${A.account}', 'Ad Hoc Ferry Ops', 'Dispatch', 'ap@example.invalid',
             '1 Ramp Road', 'Teterboro', 'NJ', '07608', 'US', 0);
     select bill_to_name from pilot.invoices where bill_to_name = 'Ad Hoc Ferry Ops';`
  );
  if (!r.ok) bad("a tenant can insert a clientless invoice", r.stderr?.slice(0, 400));
  else equals("a tenant can insert a clientless invoice", r.out, "Ad Hoc Ferry Ops");
}

refuses(
  "status is still withheld from the INSERT grant on a clientless invoice",
  A.user,
  `insert into pilot.invoices (account_id, bill_to_name, status)
     values ('${A.account}', 'Ad Hoc Ferry Ops', 'sent');`,
  "42501"
);

note("\nLifecycle: created, sent, paid, with no client anywhere\n");

/**
 * A TENANT CANNOT CHOOSE ITS OWN PRIMARY KEY, and this script must not pretend
 * otherwise. `id` is deliberately absent from the INSERT grant on
 * pilot.invoices (the Phase 5 rule that a client never picks its own key), so
 * these fixtures insert as the real authenticated role WITHOUT an id and read
 * the generated one back. Seeding them as service_role instead would have
 * skipped the very grant path the feature adds columns to.
 */
function createAdHocInvoice(user, account, name, extraColumns = "", extraValues = "") {
  const r = asTenantCommitted(
    user,
    `insert into pilot.invoices (account_id, bill_to_name, tax_rate_bps${extraColumns})
       values ('${account}', '${name}', 0${extraValues});`
  );
  if (!r.ok) {
    bad(`fixture: create "${name}"`, r.stderr?.slice(0, 600));
    return null;
  }
  return psql(
    DB_URL(),
    `select id from pilot.invoices where account_id = '${account}' and bill_to_name = '${name}';`
  ).out;
}

const ADHOC = createAdHocInvoice(
  A.user,
  A.account,
  "Ad Hoc Ferry Ops",
  ", bill_to_email, bill_to_city, bill_to_state",
  ", 'ap@example.invalid', 'Teterboro', 'NJ'"
);
if (!ADHOC) {
  note("adhoc-invoice:verify FAILED. Could not create the ad-hoc fixture invoice.");
  process.exit(1);
}
ok("a tenant created a clientless invoice and the database assigned its id");

{
  const lines = asTenantCommitted(
    A.user,
    `insert into pilot.invoice_lines
       (account_id, invoice_id, line_type, description, quantity, unit_amount_cents)
     values ('${A.account}', '${ADHOC}', 'other', 'Ferry flight, KTEB to KVNY', 1, 250000);`
  );
  if (!lines.ok) bad("lines can be added to a clientless invoice by hand", lines.stderr?.slice(0, 600));
  else ok("lines can be added to a clientless invoice by hand");
}

{
  // SENT. This is the transition that mints the number and the dates, and the
  // one the trigger's new due-date branch runs in.
  const sent = asTenantCommitted(
    A.user,
    `update pilot.invoices set status = 'sent', sent_at = now(), delivery_method = 'manual_download'
       where id = '${ADHOC}';`
  );
  if (!sent.ok) bad("a clientless invoice can be sent", sent.stderr?.slice(0, 600));
  else ok("a clientless invoice can be sent");
}

{
  // The number pattern, not a hardcoded sequence position: the prefix and the
  // year are the parts that prove it came from THIS account's sequence, and
  // pinning the counter would make this test depend on how many fixtures ran
  // before it.
  const number = psql(DB_URL(), `select invoice_number from pilot.invoices where id = '${ADHOC}';`).out;
  if (/^ALFA-\d{4}-\d{4}$/.test(number))
    ok(`sending it minted a real invoice number (${number})`);
  else bad("sending it minted a real invoice number", `got ${JSON.stringify(number)}`);
}

// THE DUE DATE. 45 days, from pilot.accounts.default_payment_terms_days, not
// the client's 30 and not the hardcoded 30-day fallback. Three distinguishable
// numbers on purpose: if the trigger read the wrong one, this fails.
equals(
  "the due date came from the ACCOUNT's terms, not a client's and not the fallback",
  psql(
    DB_URL(),
    `select (due_on - issued_on)::text from pilot.invoices where id = '${ADHOC}';`
  ).out,
  "45"
);

{
  // PAID. invoices_protect_issued refuses 'paid' with a nonzero balance, so
  // this also proves invoice_totals resolves for a row with no client.
  const paid = asTenantCommitted(
    A.user,
    `insert into pilot.invoice_payments (account_id, invoice_id, paid_on, amount_cents, method)
       values ('${A.account}', '${ADHOC}', current_date, 250000, 'ach');
     update pilot.invoices set status = 'paid' where id = '${ADHOC}';`
  );
  if (!paid.ok) bad("a clientless invoice can be paid in full", paid.stderr?.slice(0, 600));
  else ok("a clientless invoice can be paid in full");
}

equals(
  "its balance reads zero through pilot.invoice_totals",
  psql(DB_URL(), `select balance_due_cents from pilot.invoice_totals where invoice_id = '${ADHOC}';`)
    .out,
  "0"
);

// ACCOUNT B SET NO DEFAULT TERMS, so its clientless invoices fall back to 30
// days. The two accounts differ by exactly this one column, so a trigger that
// ignored it would give both the same answer and one of the two assertions
// would fail.
{
  const id = createAdHocInvoice(B.user, B.account, "Bravo Ad Hoc Ops");
  if (id) {
    const r = asTenantCommitted(
      B.user,
      `insert into pilot.invoice_lines
         (account_id, invoice_id, line_type, description, quantity, unit_amount_cents)
         values ('${B.account}', '${id}', 'other', 'One day', 1, 100000);
       update pilot.invoices set status = 'sent', sent_at = now(),
         delivery_method = 'manual_download' where id = '${id}';`
    );
    if (!r.ok) bad("an account with no default terms can still send", r.stderr?.slice(0, 400));
    else
      equals(
        "with no account default set, a clientless invoice falls back to 30 days",
        psql(DB_URL(), `select (due_on - issued_on)::text from pilot.invoices where id = '${id}';`).out,
        "30"
      );
  }
}

note("\nThe linked case did not move\n");

{
  // The pre-existing invoice, sent the same way. Its due date must still come
  // from its CLIENT's 30-day terms, not the account's 45.
  const sent = asTenantCommitted(
    A.user,
    `update pilot.invoices set status = 'sent', sent_at = now(), delivery_method = 'manual_download'
       where id = 'dddddddd-0000-4000-8000-00000000000a';`
  );
  if (!sent.ok) bad("a client-linked invoice still sends", sent.stderr?.slice(0, 600));
  else ok("a client-linked invoice still sends");
}
equals(
  "a linked invoice's due date still comes from its CLIENT's terms",
  psql(
    DB_URL(),
    `select (due_on - issued_on)::text from pilot.invoices
       where id = 'dddddddd-0000-4000-8000-00000000000a';`
  ).out,
  "30"
);
equals(
  "a linked invoice still carries no bill_to_* values",
  psql(
    DB_URL(),
    `select coalesce(bill_to_name, '(null)') from pilot.invoices
       where id = 'dddddddd-0000-4000-8000-00000000000a';`
  ).out,
  "(null)"
);

// The property `on delete restrict` exists for, proved by behaviour as well as
// by the catalog: the linked invoice blocks its client's deletion.
{
  const r = asAdmin(
    `delete from pilot.clients where id = '${A.client}';`
  );
  if (r.ok) bad("a client with invoices still cannot be deleted", "the delete SUCCEEDED");
  else if (r.sqlstate !== "23503")
    bad("a client with invoices still cannot be deleted", `expected 23503, got ${r.sqlstate}`);
  else ok("a client with invoices still cannot be deleted  [23503]");
}

note("\nImmutability: the new columns are frozen once issued\n");

refuses(
  "bill_to_name cannot be edited on an issued invoice",
  A.user,
  `update pilot.invoices set bill_to_name = 'Renamed After Issue' where id = '${ADHOC}';`,
  "P0001"
);
refuses(
  "bill_to_email cannot be edited on an issued invoice",
  A.user,
  `update pilot.invoices set bill_to_email = 'elsewhere@example.invalid' where id = '${ADHOC}';`,
  "P0001"
);

note("\nThe shared link works for a clientless invoice\n");

{
  // The exact path a client takes: a share row, then anon calling
  // pilot.invoice_public. Before the left join this returned NULL and the
  // public page rendered not-found, with nothing in any log to say why.
  const share = asAdmin(
    `insert into pilot.invoice_shares (account_id, invoice_id, token)
       values ('${A.account}', '${ADHOC}', 'synthetic-token-adhoc-000000000000000000000');`,
    "share row"
  );
  if (share.ok) {
    const r = asAnon(
      `select pilot.invoice_public('synthetic-token-adhoc-000000000000000000000') -> 'client' ->> 'name';`
    );
    if (!r.ok) bad("anon can open a clientless invoice's share link", r.stderr?.slice(0, 400));
    else
      equals(
        "the share payload names the typed bill-to, not null",
        r.out,
        "Ad Hoc Ferry Ops"
      );

    const city = asAnon(
      `select pilot.invoice_public('synthetic-token-adhoc-000000000000000000000') -> 'client' ->> 'city';`
    );
    equals("the share payload carries the typed address too", city.out, "Teterboro");

    const totals = asAnon(
      `select pilot.invoice_public('synthetic-token-adhoc-000000000000000000000') -> 'totals' ->> 'total_cents';`
    );
    equals("the share payload still carries real totals", totals.out, "250000");
  }
}

{
  // The linked invoice's share payload must be byte-identical in shape and
  // must still read the CLIENT's live name, not a frozen copy.
  const share = asAdmin(
    `insert into pilot.invoice_shares (account_id, invoice_id, token)
       values ('${A.account}', 'dddddddd-0000-4000-8000-00000000000a', 'synthetic-token-linked-00000000000000000000');`,
    "linked share row"
  );
  if (share.ok) {
    asAdmin(`update pilot.clients set name = 'Synthetic Client A, Renamed' where id = '${A.client}';`);
    const r = asAnon(
      `select pilot.invoice_public('synthetic-token-linked-00000000000000000000') -> 'client' ->> 'name';`
    );
    equals(
      "a linked invoice's share link still reads the client's CURRENT name",
      r.out,
      "Synthetic Client A, Renamed"
    );
    asAdmin(`update pilot.clients set name = 'Synthetic Client A' where id = '${A.client}';`);
  }
}

note("\nWhat a clientless invoice is deliberately excluded from\n");

// CLIENT STATEMENTS. The statement query is `.eq("client_id", <id>)`; the
// clientless invoice must not appear on ANY client's statement, and this is
// the SQL form of that predicate.
equals(
  "a clientless invoice appears on no client's statement",
  psql(
    DB_URL(),
    `select count(*) from pilot.invoices i
       join pilot.clients c on c.account_id = i.account_id and c.id = i.client_id
      where i.id = '${ADHOC}';`
  ).out,
  "0"
);

// THE SCHEDULED REMINDER RUN. Its invoice query filters `client_id is not
// null` explicitly (lib/reminders/run.ts) as well as `in (client ids)`. Both
// forms are asserted, because the exclusion has to survive someone widening
// the client set later.
equals(
  "the reminder run's client filter never matches a clientless invoice",
  psql(
    DB_URL(),
    `select count(*) from pilot.invoices
      where id = '${ADHOC}' and client_id in ('${A.client}', '${B.client}');`
  ).out,
  "0"
);
equals(
  "the reminder run's explicit not-null filter excludes it too",
  psql(
    DB_URL(),
    `select count(*) from pilot.invoices where id = '${ADHOC}' and client_id is not null;`
  ).out,
  "0"
);

note("\nWhat it is deliberately INCLUDED in\n");

// A/R. Money owed is money owed: the aging view and the receivables reads are
// not grouped by client, so a clientless invoice must still be reachable
// through them. Proved on a second, unpaid ad-hoc invoice.
const OWED = createAdHocInvoice(A.user, A.account, "Ad Hoc Overdue Ops");
if (OWED) {
  const r = asTenantCommitted(
    A.user,
    `insert into pilot.invoice_lines
       (account_id, invoice_id, line_type, description, quantity, unit_amount_cents)
       values ('${A.account}', '${OWED}', 'other', 'Training day', 1, 120000);
     update pilot.invoices
       set status = 'sent', sent_at = now(), delivery_method = 'manual_download',
           issued_on = current_date - 90, due_on = current_date - 60
       where id = '${OWED}';`
  );
  if (!r.ok) bad("an overdue clientless invoice can be set up", r.stderr?.slice(0, 600));
  else ok("an overdue clientless invoice can be set up");
}
equals(
  "a clientless invoice still appears in pilot.invoices_overdue",
  psql(DB_URL(), `select count(*) from pilot.invoices_overdue where invoice_id = '${OWED}';`).out,
  "1"
);
equals(
  "its balance is still counted, so receivables are not understated",
  psql(DB_URL(), `select balance_due_cents from pilot.invoice_totals where invoice_id = '${OWED}';`)
    .out,
  "120000"
);

// The trip P&L's unattributed-lines function groups by client_id and now emits
// a null group. The report handles it (tests/adhoc-invoice.test.mjs pins the
// pure side); this proves the group is genuinely produced, so that branch is
// reachable rather than defensive.
equals(
  "client_unattributed_lines emits a null-client group for these lines",
  psql(
    DB_URL(),
    `set role service_role;
     select count(*) from pilot.client_unattributed_lines(
       '${A.account}', (current_date - 365)::date, (current_date + 1)::date)
      where client_id is null;`
  ).out,
  "1"
);

note("\nTrips and clientless invoices do not mix\n");

{
  asAdmin(
    `insert into pilot.trips (id, account_id, client_id, starts_on, ends_on, status, billing_state)
       values ('ffffffff-0000-4000-8000-00000000000a', '${A.account}', '${A.client}',
               current_date - 10, current_date - 8, 'completed', 'unbilled');`,
    "trip"
  );
}
refuses(
  "a client's trip cannot be billed on a clientless invoice",
  A.user,
  `with created as (
     insert into pilot.invoices (account_id, bill_to_name)
       values ('${A.account}', 'Ad Hoc Trip Attempt') returning id
   )
   insert into pilot.invoice_lines
     (account_id, invoice_id, line_type, description, quantity, unit_amount_cents, trip_id)
   select '${A.account}', created.id, 'flight_day', 'Day', 1, 90000,
          'ffffffff-0000-4000-8000-00000000000a'
     from created;`,
  "P0001"
);

// ---------------------------------------------------------------------------
note("");
note(`${passed} passed, ${failed} failed`);
try {
  execFileSync("psql", ["-X", "-q", ADMIN_URL, "-c", `drop database if exists ${DB}`], {
    stdio: "pipe",
  });
} catch {
  // A leftover scratch database is noise, not a failure.
}
rmSync(work, { recursive: true, force: true });
process.exit(failed === 0 ? 0 : 1);

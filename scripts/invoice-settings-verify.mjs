#!/usr/bin/env node
/**
 * Invoice settings, and the deletes that came with them
 * (supabase/migrations/20260820100000_deletes_and_invoice_settings.sql).
 *
 * WHY THIS EXISTS. That migration ships two things a unit test cannot
 * reach, both of which are load-bearing for money:
 *
 *   1. `invoices_delete`, whose USING clause is the ONLY thing standing
 *      between "discard this draft" and "delete an invoice a client
 *      holds". The server action checks the status too, but that check is
 *      for the sentence — the policy is the control, and a policy is only
 *      real if a real `authenticated` role, with a real auth.uid(), is
 *      refused by it.
 *
 *   2. `pilot.set_next_invoice_number`, which exists precisely so that
 *      pilot.invoice_number_sequences never needs a tenant-facing UPDATE
 *      grant. Two claims there: the function refuses to go backwards, and
 *      the grant it replaces genuinely is absent.
 *
 * AND ONE THING THAT IS EASY TO GET WRONG QUIETLY: the number format.
 * pilot.next_invoice_number now reads three columns instead of one, and a
 * NULL anywhere in that concatenation produces a NULL invoice_number on an
 * ISSUED invoice — a support incident, not an error anyone sees at write
 * time. So the format is asserted by issuing invoices and reading the
 * numbers back.
 *
 * A DELETE THAT MATCHES NOTHING IS SILENT. RLS does not raise on a DELETE
 * it refuses; it deletes zero rows and reports success. Every negative case
 * below therefore COUNTS rows afterwards rather than looking for an error —
 * checking `ok` alone would pass against a table with no policy at all.
 *
 * Same harness as scripts/aircraft-verify.mjs; read that file's header for
 * the reasoning behind every structural choice here. All fixtures are
 * synthetic. No live pilot data, ever.
 *
 *   npm run invoice-settings:verify
 */
import { execFileSync } from "node:child_process";
import { writeFileSync, rmSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const ADMIN_URL =
  process.env.INVOICE_SETTINGS_VERIFY_URL ?? "postgresql://postgres@127.0.0.1:55432/postgres";
const DB = "v1_invoice_settings_verify";
const work = mkdtempSync(join(tmpdir(), "invoice-settings-verify-"));

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
const BOOTSTRAP = process.env.INVOICE_SETTINGS_VERIFY_BOOTSTRAP;
if (!BOOTSTRAP) {
  note("invoice-settings:verify SKIPPED — set INVOICE_SETTINGS_VERIFY_BOOTSTRAP to the");
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
    `invoice-settings:verify SKIPPED — no Postgres at ${ADMIN_URL}\n  ${String(error.stderr ?? error).slice(0, 200)}`
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
  note("invoice-settings:verify FAILED — the migrations do not replay cleanly.");
  note(String(error.stderr ?? error).slice(0, 2000));
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Two synthetic tenants. Tenant A does the work; tenant B exists so that
// every "can't touch what isn't yours" claim has something to fail against.
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

insert into pilot.accounts (id, kind, legal_name, invoice_prefix) values
  ('${A.account}', 'solo', 'Synthetic Alpha Air', 'ALFA'),
  ('${B.account}', 'solo', 'Synthetic Bravo Air', 'BRVO');

insert into pilot.account_members (account_id, user_id, role) values
  ('${A.account}', '${A.user}', 'owner'),
  ('${B.account}', '${B.user}', 'owner');

insert into pilot.clients (id, account_id, name) values
  ('cccccccc-0000-4000-8000-00000000000a', '${A.account}', 'Alpha Client'),
  ('cccccccc-0000-4000-8000-00000000000b', '${B.account}', 'Bravo Client');
`
);
if (!seed.ok) {
  note("invoice-settings:verify FAILED — the fixture would not load.");
  note(String(seed.stderr).slice(0, 2000));
  process.exit(1);
}

/**
 * NO TEST HERE MAY CHOOSE ITS OWN PRIMARY KEY, and that is not a style
 * preference — `id` is withheld from every tenant-facing INSERT grant in
 * this schema ("a client never chooses its own primary key"), so an insert
 * naming it fails 42501 and every assertion downstream reads back an empty
 * string. Rows are created with RETURNING inside a DO block and their ids
 * parked in a temp table, which is also how the app's own code has to do
 * it.
 */
const DRAFT = (account, client, key) => `
create temp table if not exists _ids (k text primary key, v uuid);
do $$
declare new_id uuid;
begin
  insert into pilot.invoices (account_id, client_id)
    values ('${account}', '${client}') returning id into new_id;
  insert into _ids values ('${key}', new_id);
end $$;`;

/** Issue the draft parked under `key`: a line, then the status move. */
const ISSUE = (account, key) => `
do $$
declare target uuid := (select v from _ids where k = '${key}');
begin
  insert into pilot.invoice_lines
    (account_id, invoice_id, line_type, description, quantity, unit_amount_cents)
    values ('${account}', target, 'other', 'Synthetic line', 1, 10000);
  update pilot.invoices set status = 'sent' where id = target;
end $$;`;

/**
 * One invoice, issued, as its owner. Returns the number the database
 * minted. A line is required: invoices_protect_issued refuses to issue an
 * invoice with nothing on it.
 */
function issueInvoice(tenant, clientId, key) {
  return asTenant(
    tenant.user,
    `${DRAFT(tenant.account, clientId, key)}
     ${ISSUE(tenant.account, key)}
     select invoice_number from pilot.invoices where id = (select v from _ids where k = '${key}');`
  );
}

note("\nThe invoice number format");
{
  // The shipped defaults: pad 4, year on. This is the format every invoice
  // issued before this migration used, so the migration's own claim to be
  // status-quo-preserving is what is being asserted here.
  const year = new Date().getUTCFullYear();
  const first = issueInvoice(A, "cccccccc-0000-4000-8000-00000000000a", "first");
  equals("the default format is unchanged: PREFIX-YYYY-0001", first.out, `ALFA-${year}-0001`);

  // Both format columns changed at once, in the same transaction as the
  // issue, so what is read back can only have come from the new values.
  const reshaped = asTenant(
    A.user,
    `update pilot.accounts
        set invoice_number_pad = 6, invoice_number_include_year = false
      where id = '${A.account}';
     ${DRAFT(A.account, "cccccccc-0000-4000-8000-00000000000a", "reshaped")}
     ${ISSUE(A.account, "reshaped")}
     select invoice_number from pilot.invoices where id = (select v from _ids where k = 'reshaped');`
  );
  equals("pad and the year toggle both reach the minted number", reshaped.out, "ALFA-000001");

  // The five new columns are the tenant's own to set — and are the ONLY
  // new columns the grant admits. `plan` stands in for everything the
  // grant withholds; if the additive grant had been written as a bare
  // `grant update on pilot.accounts`, this is what would stop saying 42501.
  const saved = asTenant(
    A.user,
    `update pilot.accounts
        set default_tax_rate_bps = 825,
            default_invoice_notes = 'Thanks for flying.',
            invoice_footer = 'Remit to Synthetic Alpha Air.'
      where id = '${A.account}';
     select default_tax_rate_bps || '/' || default_invoice_notes || '/' || invoice_footer
       from pilot.accounts where id = '${A.account}';`
  );
  equals(
    "a tenant owns their own invoice defaults",
    saved.out,
    "825/Thanks for flying./Remit to Synthetic Alpha Air."
  );

  refuses(
    "and the additive grant did not quietly widen to the billing columns",
    A.user,
    `update pilot.accounts set plan = 'business' where id = '${A.account}';`,
    "42501"
  );

  refuses(
    "the pad is bounded by a CHECK, not just by the form's min/max",
    A.user,
    `update pilot.accounts set invoice_number_pad = 20 where id = '${A.account}';`,
    "23514"
  );
}

note("\nDeleting an invoice");
{
  // A draft is a piece of paper nobody has seen: no number, no payments,
  // no reader. Deleting one must work.
  const draft = asTenant(
    A.user,
    `${DRAFT(A.account, "cccccccc-0000-4000-8000-00000000000a", "draft")}
     delete from pilot.invoices where id = (select v from _ids where k = 'draft');
     select count(*) from pilot.invoices where id = (select v from _ids where k = 'draft');`
  );
  equals("a draft can be discarded", draft.out, "0");

  // THE ONE THAT MATTERS. Counted, not error-checked: RLS refuses a DELETE
  // by matching zero rows and reporting success, so `ok === true` here is
  // expected and proves nothing on its own.
  const issued = asTenant(
    A.user,
    `${DRAFT(A.account, "cccccccc-0000-4000-8000-00000000000a", "issued")}
     ${ISSUE(A.account, "issued")}
     delete from pilot.invoices where id = (select v from _ids where k = 'issued');
     select count(*) from pilot.invoices where id = (select v from _ids where k = 'issued');`
  );
  equals("an ISSUED invoice cannot be deleted, by anyone, ever", issued.out, "1");

  // The claim swaps are the same set_config asTenant performs. One call,
  // because each call is its own transaction and ends in ROLLBACK — a
  // fixture written by one is not there for the next.
  const claims = (user) =>
    `do $$ begin perform set_config('request.jwt.claims', '{"sub":"${user}","role":"authenticated"}', true); end $$;`;
  const crossTenant = asTenant(
    B.user,
    `${DRAFT(B.account, "cccccccc-0000-4000-8000-00000000000b", "bravo")}
     ${claims(A.user)}
     delete from pilot.invoices where id = (select v from _ids where k = 'bravo');
     ${claims(B.user)}
     select count(*) from pilot.invoices where id = (select v from _ids where k = 'bravo');`
  );
  equals("and one tenant cannot discard another's draft", crossTenant.out, "1");
}

note("\nSetting the invoice count");
{
  // The grant this function exists to avoid needing. If this ever stops
  // being 42501, a tenant can lower their own counter directly and re-mint
  // a number an issued invoice already holds.
  refuses(
    "a tenant still cannot write pilot.invoice_number_sequences directly",
    A.user,
    `update pilot.invoice_number_sequences set next_number = 1 where account_id = '${A.account}';`,
    "42501"
  );

  const forward = asTenant(
    A.user,
    `select pilot.set_next_invoice_number('${A.account}', 1043);
     select next_number from pilot.invoice_number_sequences where account_id = '${A.account}';`
  );
  equals("the count can be moved forward", forward.out.split("\n").pop(), "1043");

  refuses(
    "but never backwards",
    A.user,
    `select pilot.set_next_invoice_number('${A.account}', 1043);
     select pilot.set_next_invoice_number('${A.account}', 2);`,
    "P0001"
  );

  refuses(
    "and never into another tenant's numbering",
    A.user,
    `select pilot.set_next_invoice_number('${B.account}', 5000);`,
    "P0002"
  );

  refuses(
    "zero is not a number to start at",
    A.user,
    `select pilot.set_next_invoice_number('${A.account}', 0);`,
    "P0001"
  );

  // The counter and the format meet here: a count set forward shows up in
  // the next minted number, padded by the account's own pad.
  const year = new Date().getUTCFullYear();
  const minted = asTenant(
    A.user,
    `select pilot.set_next_invoice_number('${A.account}', 1043);
     ${DRAFT(A.account, "cccccccc-0000-4000-8000-00000000000a", "minted")}
     ${ISSUE(A.account, "minted")}
     select invoice_number from pilot.invoices where id = (select v from _ids where k = 'minted');`
  );
  equals(
    "and the next invoice issued uses it",
    minted.out.split("\n").pop(),
    `ALFA-${year}-1043`
  );
}

note("\nDeleting a crew member");
{
  const gone = asTenant(
    A.user,
    `create temp table _ids (k text primary key, v uuid);
     do $$ declare new_id uuid; begin
       insert into pilot.crew_members (account_id, name)
         values ('${A.account}', 'Synthetic Crew') returning id into new_id;
       insert into _ids values ('crew', new_id);
     end $$;
     delete from pilot.crew_members where id = (select v from _ids where k = 'crew');
     select count(*) from pilot.crew_members where id = (select v from _ids where k = 'crew');`
  );
  equals("a crew member can be deleted", gone.out, "0");

  const claims = (user) =>
    `do $$ begin perform set_config('request.jwt.claims', '{"sub":"${user}","role":"authenticated"}', true); end $$;`;
  const survived = asTenant(
    B.user,
    `create temp table _ids (k text primary key, v uuid);
     do $$ declare new_id uuid; begin
       insert into pilot.crew_members (account_id, name)
         values ('${B.account}', 'Bravo Crew') returning id into new_id;
       insert into _ids values ('crew', new_id);
     end $$;
     ${claims(A.user)}
     delete from pilot.crew_members where id = (select v from _ids where k = 'crew');
     ${claims(B.user)}
     select count(*) from pilot.crew_members where id = (select v from _ids where k = 'crew');`
  );
  equals("but not somebody else's", survived.out, "1");
}

rmSync(work, { recursive: true, force: true });
note(
  `\ninvoice-settings:verify ${failed ? "FAILED" : "passed"} — ${
    failed ? `${failed} of ${passed + failed}` : `${passed}`
  } checks`
);
process.exit(failed ? 1 : 0);

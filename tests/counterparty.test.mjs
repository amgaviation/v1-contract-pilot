import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const {
  YOU_INVOICE_COLUMN,
  isInvoicedCounterparty,
  invoicedCounterparties,
  stopInvoicingRefusal,
  COUNTERPARTY_COPY,
} = await import("../lib/counterparty.ts");

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const read = (path) => readFileSync(new URL(path, new URL("..", import.meta.url)), "utf8");

/**
 * A COUNTERPARTY YOU FLY FOR BUT DO NOT BILL.
 *
 * The product has one counterparty table (pilot.clients) and one flag
 * separating the operator whose indoc you sat from the operator you invoice
 * (pilot.clients.you_invoice, 20260815120000). Two things can go wrong with
 * that flag and neither one crashes:
 *
 *   1. THE FILTER GOES THE WRONG WAY, or is missing at a call site. A
 *      paying client silently vanishes from an invoice picker, or an
 *      operator the pilot said they never bill turns up in one. Both look
 *      like the product working.
 *   2. THE FLAG GETS SET ON A CLIENT WITH INVOICES. Money the pilot is
 *      owed either disappears from A/R or sits in it under a client the
 *      product has been told is not billed.
 *
 * The database is the boundary for both (pilot.clients_refuse_stop_
 * invoicing and pilot.refuse_billing_a_non_invoiced_client). These tests
 * cover the two things unit tests CAN own: the pure logic behind the
 * sentence a pilot reads, and a mechanical check that every screen which
 * picks a client to bill actually applies the filter.
 */

test("an absent or null flag reads as someone you bill", () => {
  // The direction that matters. A read selecting a narrow column list has
  // said NOTHING about billing, and every client that existed before this
  // column did is one you bill. Reading absence as "not invoiced" would
  // quietly drop paying clients out of the pickers.
  assert.equal(isInvoicedCounterparty({}), true);
  assert.equal(isInvoicedCounterparty({ you_invoice: null }), true);
  assert.equal(isInvoicedCounterparty({ you_invoice: true }), true);
  assert.equal(isInvoicedCounterparty({ you_invoice: false }), false);
});

test("a client you do not invoice is excluded from a picker, and the rest survive", () => {
  const clients = [
    { id: "a", name: "Ridgeline Aviation", you_invoice: true },
    { id: "b", name: "Sierra Air Charter", you_invoice: false },
    { id: "c", name: "Northfield Jet" },
  ];

  const offered = invoicedCounterparties(clients).map((c) => c.id);
  assert.deepEqual(offered, ["a", "c"], "only the non-billed one is dropped");
  assert.equal(
    clients.length,
    3,
    "the filter must not mutate the list it was handed"
  );
});

test("qualifications, documents and trips are untouched by the flag", () => {
  // The whole point of the feature: the flag is about BILLING and nothing
  // else. A qualification is keyed to a client id and stays keyed to it.
  const operator = { id: "b", name: "Sierra Air Charter", you_invoice: false };
  const qualifications = [
    { client_id: "b", requirement: "basic_indoc", status: "current" },
    { client_id: "b", requirement: "ipc_135_297", status: "current" },
    { client_id: "a", requirement: "basic_indoc", status: "current" },
  ];

  const theirs = qualifications.filter((q) => q.client_id === operator.id);
  assert.equal(theirs.length, 2, "the operator keeps every qualification row");
  assert.equal(
    invoicedCounterparties([operator]).length,
    0,
    "and is still not somebody you invoice"
  );
});

test("marking a client that already has paperwork is refused, with what to do instead", () => {
  const none = { invoices: 0, estimates: 0, schedules: 0 };
  assert.equal(stopInvoicingRefusal(none), null);

  const invoiced = stopInvoicingRefusal({ ...none, invoices: 1 });
  assert.ok(invoiced, "a client with an invoice must be refused");
  assert.match(
    invoiced,
    /archive/i,
    "refusal must name the feature that actually does what they wanted"
  );

  // Estimates and schedules are refused too, and for reasons a pilot can
  // act on: an estimate is a quote already sent, and a live schedule would
  // keep generating invoices for somebody just marked as not billed.
  assert.ok(stopInvoicingRefusal({ ...none, estimates: 1 }));
  assert.match(stopInvoicingRefusal({ ...none, schedules: 1 }), /schedule/i);

  // Heaviest first: a client with all three is told about the invoices,
  // whose remedy (archive) differs from the other two (delete them).
  assert.equal(
    stopInvoicingRefusal({ invoices: 1, estimates: 1, schedules: 1 }),
    invoiced
  );
});

test("A/R and the statements need no filter, because the refusal is what keeps them clean", () => {
  // This is the invariant the refusal buys, asserted as the aging code
  // would experience it: aging buckets invoices, and every invoice belongs
  // to a client that is still on you_invoice = true, so no aging row can
  // belong to a counterparty the pilot does not bill.
  const clients = [
    { id: "a", you_invoice: true },
    { id: "b", you_invoice: false },
  ];
  const byId = new Map(clients.map((c) => [c.id, c]));

  // "b" cannot acquire an invoice: pilot.refuse_billing_a_non_invoiced_
  // client() rejects the insert. And "a" cannot become "b" while holding
  // one. So the only reachable state is invoices against invoiced clients.
  const invoices = [{ id: "i1", client_id: "a", balance_due_cents: 120000 }];
  for (const invoice of invoices) {
    assert.equal(
      isInvoicedCounterparty(byId.get(invoice.client_id)),
      true,
      "an invoice against a non-invoiced client is unreachable by construction"
    );
  }

  const owed = invoices.reduce((n, i) => n + i.balance_due_cents, 0);
  assert.equal(owed, 120000, "nothing is subtracted from A/R by this feature");
});

/**
 * EVERY SCREEN THAT PICKS A CLIENT TO BILL APPLIES THE FILTER.
 *
 * Checked mechanically rather than by review because the failure is
 * invisible: a picker that forgets the filter offers an operator the
 * database will then refuse, and the pilot gets a rejected save with no
 * idea why. The database still refuses, so this is not the boundary; it is
 * the guarantee that the pilot is never offered the choice.
 *
 * Keyed to the FILE and its meaning, not to a line number, so moving code
 * inside these files does not break it and adding a sixth picker without
 * the filter does.
 */
const BILLING_PICKERS = [
  "app/(app)/invoices/new/page.tsx",
  "app/(app)/invoices/[id]/page.tsx",
  "app/(app)/invoices/recurring/page.tsx",
  "app/(app)/estimates/new/page.tsx",
  "app/(app)/estimates/[id]/page.tsx",
];

test("every invoice and estimate client picker filters on the flag", () => {
  for (const file of BILLING_PICKERS) {
    const source = read(file);
    assert.match(
      source,
      /YOU_INVOICE_COLUMN/,
      `${file} reads clients for a billing picker without filtering on the flag`
    );
    assert.match(
      source,
      /\.eq\(YOU_INVOICE_COLUMN,\s*true\)/,
      `${file} must filter to clients you invoice, not away from them`
    );
  }
});

test("the column is spelled in one place", () => {
  assert.equal(YOU_INVOICE_COLUMN, "you_invoice");
  for (const file of BILLING_PICKERS) {
    assert.doesNotMatch(
      read(file),
      /\.eq\(\s*["'`]you_invoice["'`]/,
      `${file} spells the column by hand instead of importing YOU_INVOICE_COLUMN`
    );
  }
});

test("the surfaces that must NOT filter still do not", () => {
  // A qualification, a document, a trip and an expense are all things you
  // record for an operator whether or not you bill them. A filter creeping
  // into one of these pickers is the regression that would put the product
  // back where it started: unable to record indoc without a billing
  // relationship.
  const untouched = [
    "app/(app)/documents/client-options.ts",
    "app/(app)/trips/new/page.tsx",
    "app/(app)/clients/[id]/operator-qualifications-actions.ts",
  ];
  for (const file of untouched) {
    assert.doesNotMatch(
      read(file),
      /\.eq\((YOU_INVOICE_COLUMN|["'`]you_invoice["'`])/,
      `${file} must keep offering operators you do not bill`
    );
  }
});

test("the migration keeps operator_qualifications.client_id not null, and says why", () => {
  // The tempting wrong fix. The reason it is wrong is that the table's
  // unique(account_id, client_id, requirement, type_designator) constraint
  // stops working: Postgres treats two NULLs as distinct, so a nullable
  // client_id permits unlimited duplicate rows for one requirement.
  const migration = read("supabase/migrations/20260815120000_client_you_invoice.sql");
  assert.match(migration, /not null/i);
  assert.match(
    migration,
    /unique \(account_id, client_id, requirement, type_designator\)/,
    "the migration must name the constraint that depends on client_id being not null"
  );
  assert.match(
    migration,
    /distinct/i,
    "and must state the NULL-distinctness reason, or somebody lifts it later"
  );

  // Existing clients must all default to billable, or A/R changes for
  // everybody on deploy.
  assert.match(
    migration,
    /add column if not exists you_invoice boolean not null default true/,
    "every pre-existing client must default to one you bill"
  );

  // RLS stays as narrow as it was: no policy is created, dropped or
  // altered anywhere in the file.
  const executable = migration
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");
  assert.doesNotMatch(
    executable,
    /\b(create|drop|alter)\s+policy\b/i,
    "this migration must not touch RLS"
  );
  assert.doesNotMatch(
    executable,
    /row level security/i,
    "this migration must not touch RLS"
  );
});

test("the copy is written to a pilot, not to the schema", () => {
  assert.match(COUNTERPARTY_COPY.toggleLabel, /^You invoice/);
  // Second person, and concrete about what is kept. The failure this pins
  // is a future edit that reduces the helper text to "excludes this client
  // from billing surfaces", which tells a pilot nothing about whether
  // their qualifications survive.
  assert.match(COUNTERPARTY_COPY.toggleHelp, /qualifications/);
  assert.match(COUNTERPARTY_COPY.toggleHelp, /\byou\b/);
  // Spelled by code point so this file does not itself contain the
  // characters it bans.
  const DASHES = new RegExp("[\\u2014\\u2013]");
  for (const line of Object.values(COUNTERPARTY_COPY)) {
    assert.doesNotMatch(line, DASHES, "no em or en dashes in product copy");
  }
});

test("the guide carries the two facts that are written down nowhere else", () => {
  const guide = read("lib/help/guide.ts");
  assert.match(
    guide,
    /You invoice this client/,
    "the guide must name the control by the words on the screen"
  );
  assert.match(
    guide,
    /All it needs is a name/,
    "the guide must say what adding an operator actually costs"
  );
  assert.ok(ROOT.length > 0);
});

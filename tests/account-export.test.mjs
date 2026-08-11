import test from "node:test";
import assert from "node:assert/strict";

const {
  EXPORT_ENTITIES,
  emptyLookups,
  centsToDollarsString,
  bpsToPercentString,
  isoDate,
  fileBasename,
  yesNo,
  slugify,
  clientValues,
  tripValues,
  tripDayValues,
  invoiceValues,
  invoicePaymentValues,
  CLIENT_HEADER,
  INVOICE_HEADER,
} = await import("../app/(app)/settings/export/entities.ts");
const { csvRow, csvField } = await import("../lib/csv.ts");

/**
 * The account-wide export's pure layer (headers, row→values mappers,
 * formatting helpers). The streaming, paging and auth around it live in
 * app/(app)/settings/export/[entity]/route.ts and are exercised against a
 * real database, not here — see tests/README.md for that split.
 */

test("money exports in the year-end report's numeric form: dollars, two decimals, blank for unknown", () => {
  // Same function name, same body, as reports/year-end/export/route.ts —
  // the two exports must never disagree about what "1234.56" means.
  assert.equal(centsToDollarsString(350000), "3500.00");
  assert.equal(centsToDollarsString(1), "0.01");
  assert.equal(centsToDollarsString(0), "0.00");
  // Blank is "not known", which must stay distinct from a real zero — a
  // report that turns a failed lookup into "0.00" is claiming a figure.
  assert.equal(centsToDollarsString(null), "");
  assert.equal(centsToDollarsString(undefined), "");
});

test("a negative amount survives the CSV formula guard as a plain number", () => {
  // lib/csv.ts quarantines leading "-" as a formula EXCEPT for a bare
  // negative number. A credit/reversal amount must round-trip readable.
  assert.equal(centsToDollarsString(-12345), "-123.45");
  assert.equal(csvField(centsToDollarsString(-12345)), "-123.45");
});

test("tax rate: basis points to an exact percent string", () => {
  assert.equal(bpsToPercentString(875), "8.75");
  assert.equal(bpsToPercentString(0), "0.00");
  assert.equal(bpsToPercentString(10000), "100.00");
  assert.equal(bpsToPercentString(null), "");
});

test("timestamps flatten to ISO YYYY-MM-DD; date columns pass through", () => {
  assert.equal(isoDate("2026-08-11T12:34:56.789Z"), "2026-08-11");
  assert.equal(isoDate("2026-08-11"), "2026-08-11");
  assert.equal(isoDate(null), "");
  assert.equal(isoDate(undefined), "");
});

test("document filename is the storage path's last segment, never the whole path", () => {
  // Paths are `${accountId}/${documentId}/${safeName}` (documents/actions.ts)
  // — the two leading segments are internal IDs, not the pilot's filename.
  assert.equal(fileBasename("acct-1/doc-2/medical.pdf"), "medical.pdf");
  assert.equal(fileBasename("medical.pdf"), "medical.pdf");
  assert.equal(fileBasename(null), "");
});

test("booleans read as Yes/No, matching the logbook export's convention", () => {
  assert.equal(yesNo(true), "Yes");
  assert.equal(yesNo(false), "No");
  assert.equal(yesNo(null), "No");
});

test("filename slug matches the other exports' behavior", () => {
  assert.equal(slugify("Jane Q. Pilot, LLC"), "Jane-Q-Pilot-LLC");
  assert.equal(slugify("   "), "pilot");
});

test("every entity's header and mapper agree on column count", () => {
  // The logbook export once drifted four columns behind its schema; a
  // mismatched CSV SHIFTS silently instead of failing. entities.ts throws
  // at module load on a mismatch; this restates it per entity so a
  // failure names the file.
  for (const [key, spec] of Object.entries(EXPORT_ENTITIES)) {
    const probe = spec.mapRow({}, emptyLookups());
    assert.equal(
      probe.length,
      spec.header.length,
      `${key}: header has ${spec.header.length} columns but rows emit ${probe.length}`
    );
  }
});

test("every entity pages on a total order — unique id as the final tiebreak", () => {
  // .range() pagination is only coherent when every page request agrees
  // on one ordering; without a unique tiebreak the server may break ties
  // differently per page and drop or double rows at page boundaries.
  for (const [key, spec] of Object.entries(EXPORT_ENTITIES)) {
    const last = spec.orderBy[spec.orderBy.length - 1];
    assert.equal(last.column, "id", `${key}: orderBy must end on the unique id column`);
    assert.match(spec.select, /\bid\b/, `${key}: select must include id`);
  }
});

test("every entity's URL key, registry key and spec key are the same word", () => {
  for (const [key, spec] of Object.entries(EXPORT_ENTITIES)) {
    assert.equal(spec.key, key);
  }
});

test("a hostile client name is neutralised by the shared CSV encoder", () => {
  // A client name is transcribed off someone else's paperwork — exactly
  // the cell lib/csv.ts's formula-injection guard exists for. The export
  // must go through csvRow, and csvRow must neutralise it.
  const row = csvRow(
    clientValues({
      name: '=HYPERLINK("https://evil.example","open")',
      operating_rule: "part_91",
      per_diem_mode: "receipts",
      default_expense_treatment: "unassigned",
      minimum_basis: "per_trip",
      w9_status: "not_requested",
      payment_terms_days: 30,
      id: "c-1",
    })
  );
  assert.ok(
    row.startsWith(`"'=HYPERLINK(`),
    `first cell must carry the apostrophe shield, got: ${row.slice(0, 30)}`
  );
});

test("clients: W-9 status and dates land in the columns the header names", () => {
  const values = clientValues({
    id: "c-1",
    name: "Skyline Aviation LLC",
    contact_email: "ops@skyline.example",
    operating_rule: "both",
    per_diem_mode: "per_diem",
    default_expense_treatment: "rebill",
    minimum_basis: "per_month",
    payment_terms_days: 30,
    w9_status: "on_file",
    w9_sent_at: "2026-01-05T15:00:00Z",
    w9_received_at: "2026-01-12T09:30:00Z",
  });
  const byHeader = Object.fromEntries(CLIENT_HEADER.map((h, i) => [h, values[i]]));
  assert.equal(byHeader["W-9 status"], "On file");
  assert.equal(byHeader["W-9 requested on"], "2026-01-05");
  assert.equal(byHeader["W-9 received on"], "2026-01-12");
  assert.equal(byHeader["Operating rule"], "Both — varies by trip");
  assert.equal(byHeader["Contact email"], "ops@skyline.example");
});

test("trips: client resolves by name; a missing client is 'Unknown client', a null one is blank", () => {
  const lookups = emptyLookups();
  lookups.clientNameById.set("c-1", "Skyline Aviation LLC");
  const base = {
    id: "t-1",
    trip_kind: "contract_pilot",
    status: "completed",
    starts_on: "2026-03-01",
    ends_on: "2026-03-03",
    aircraft_ident: "N123AB",
    operating_rule: "part_135",
    day_rate_cents: 350000,
    day_count: 3,
    billing_state: "invoiced",
  };

  const known = tripValues({ ...base, client_id: "c-1" }, lookups);
  assert.ok(known.includes("Skyline Aviation LLC"));
  assert.ok(known.includes("N123AB"), "tail number must come through");
  assert.ok(known.includes("Part 135"));
  assert.ok(known.includes("3500.00"), "day rate in dollars");

  // A set client_id that fails to resolve is a broken cross-reference and
  // must SAY so — a blank would read as "this trip has no client".
  const missing = tripValues({ ...base, client_id: "c-gone" }, lookups);
  assert.ok(missing.includes("Unknown client"));

  const none = tripValues({ ...base, client_id: null }, lookups);
  assert.ok(!none.includes("Unknown client"));
});

test("trip days: day type label resolves; a vanished day type says so instead of blanking", () => {
  const lookups = emptyLookups();
  lookups.dayTypeLabelById.set("dt-1", "Standby");
  lookups.tripById.set("t-1", {
    starts_on: "2026-03-01",
    aircraft_ident: "N123AB",
    client_id: null,
  });
  const values = tripDayValues(
    {
      id: "d-1",
      trip_id: "t-1",
      day_on: "2026-03-02",
      day_type_id: "dt-1",
      rate_cents: 175000,
      quantity: 1,
      units: 0.5,
      away: true,
      notes: null,
    },
    lookups
  );
  assert.ok(values.includes("Standby"));
  assert.ok(values.includes("1750.00"));
  assert.ok(values.includes("Yes"), "away exports as Yes");

  const orphan = tripDayValues(
    { id: "d-2", trip_id: "t-1", day_on: "2026-03-03", day_type_id: "dt-gone" },
    lookups
  );
  assert.ok(orphan.includes("Unknown day type"));
});

test("invoices: totals come from the invoice_totals lookup; missing totals stay blank, never 0.00", () => {
  const lookups = emptyLookups();
  lookups.clientNameById.set("c-1", "Skyline Aviation LLC");
  lookups.totalsByInvoiceId.set("i-1", {
    subtotal_cents: 1050000,
    tax_cents: 0,
    total_cents: 1050000,
    amount_paid_cents: 500000,
    last_paid_on: "2026-04-02",
    balance_due_cents: 550000,
  });
  const row = {
    id: "i-1",
    client_id: "c-1",
    invoice_number: "INV-0042",
    status: "partial",
    issued_on: "2026-03-05",
    due_on: "2026-04-04",
    tax_rate_bps: 0,
    created_at: "2026-03-05T12:00:00Z",
  };
  const values = invoiceValues(row, lookups);
  const byHeader = Object.fromEntries(INVOICE_HEADER.map((h, i) => [h, values[i]]));
  assert.equal(byHeader["Status"], "Partially paid");
  assert.equal(byHeader["Subtotal"], "10500.00");
  assert.equal(byHeader["Amount paid"], "5000.00");
  assert.equal(byHeader["Balance due"], "5500.00");
  assert.equal(byHeader["Last paid on"], "2026-04-02");

  // No totals row: blank money. "0.00" would claim a computed zero the
  // database never produced.
  const bare = invoiceValues({ ...row, id: "i-untotalled" }, lookups);
  const bareByHeader = Object.fromEntries(INVOICE_HEADER.map((h, i) => [h, bare[i]]));
  assert.equal(bareByHeader["Subtotal"], "");
  assert.equal(bareByHeader["Total"], "");
  assert.notEqual(bareByHeader["Total"], "0.00");
});

test("payments: a payment on a voided invoice exports with the Void status visible", () => {
  // The year-end income figure excludes payments whose invoice was later
  // voided; the raw ledger export includes them, and the status column is
  // what lets a spreadsheet user apply the same filter.
  const lookups = emptyLookups();
  lookups.clientNameById.set("c-1", "Skyline Aviation LLC");
  lookups.invoiceById.set("i-9", {
    invoice_number: "INV-0009",
    status: "void",
    client_id: "c-1",
  });
  const values = invoicePaymentValues(
    {
      id: "p-1",
      invoice_id: "i-9",
      paid_on: "2026-02-01",
      amount_cents: 100000,
      method: "ach",
      notes: null,
    },
    lookups
  );
  assert.ok(values.includes("Void"));
  assert.ok(values.includes("ACH"));
  assert.ok(values.includes("1000.00"));
});

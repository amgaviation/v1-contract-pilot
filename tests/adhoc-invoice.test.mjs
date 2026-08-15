import test from "node:test";
import assert from "node:assert/strict";

const {
  resolveBillTo,
  billToListLabel,
  billToEmail,
  NO_CLIENT_LABEL,
  NO_CLIENT_REMINDER_NOTICE,
  NO_CLIENT_LATE_FEE_NOTICE,
} = await import("../lib/invoice-bill-to.ts");

const { assembleTripPL } = await import("../app/(app)/reports/trip-pl/report-lib.ts");

/**
 * INVOICES WITH NO CLIENT. All fixtures synthetic.
 *
 * pilot.invoices.client_id became nullable in 20260815100000. The database
 * half of that is proved against a real Postgres by
 * scripts/adhoc-invoice-verify.mjs (created, sent, paid, share link, the check
 * constraint, the grants, the due-date branch). What is pinned HERE is the
 * pure layer above it, where every failure is a SILENT WRONG SENTENCE rather
 * than an error:
 *
 * 1. THE LINKED CASE MUST NOT MOVE. A client-linked invoice still resolves its
 *    bill-to from the client's CURRENT row, not a snapshot, because that is
 *    what shipped and freezing it now would change what an already-issued
 *    invoice renders. Anything that reads the typed columns for a linked
 *    invoice is a bug that shows up on a client's bill.
 *
 * 2. "NO CLIENT" AND "UNKNOWN CLIENT" ARE DIFFERENT FACTS. The first is a real
 *    state a pilot chose; the second is a lookup that came back short. Saying
 *    the second when the first is true tells a pilot something is broken when
 *    nothing is, and saying the first when the second is true hides a failed
 *    read behind a plausible label.
 *
 * 3. THE TRIP P&L MUST NOT REFUSE TO PRINT. pilot.client_unattributed_lines
 *    groups by client_id and now emits a null group. The assembler used to
 *    refuse outright on a client name it could not resolve, so the whole trip
 *    P&L would have gone down the first time a pilot billed a one-off.
 */

const LINKED_INVOICE = {
  client_id: "cccccccc-0000-4000-8000-00000000000a",
  bill_to_name: null,
  bill_to_contact_name: null,
  bill_to_email: null,
  bill_to_address_line1: null,
  bill_to_address_line2: null,
  bill_to_city: null,
  bill_to_state: null,
  bill_to_postal_code: null,
  bill_to_country: null,
};

const ADHOC_INVOICE = {
  client_id: null,
  bill_to_name: "Ad Hoc Ferry Ops",
  bill_to_contact_name: "Dispatch",
  bill_to_email: "ap@example.invalid",
  bill_to_address_line1: "1 Ramp Road",
  bill_to_address_line2: null,
  bill_to_city: "Teterboro",
  bill_to_state: "NJ",
  bill_to_postal_code: "07608",
  bill_to_country: "US",
};

const CLIENT_ROW = {
  name: "Synthetic Client A",
  contact_name: "Chief Pilot",
  contact_email: "ops@example.invalid",
  billing_email: "payables@example.invalid",
  address_line1: "9 Hangar Lane",
  address_line2: "Suite 2",
  city: "Van Nuys",
  state: "CA",
  postal_code: "91406",
  country: "US",
};

// The one validator every caller shares (lib/email/send.ts's looksLikeEmail is
// server-only, so its rule is mirrored here rather than imported).
const looksLikeEmail = (value) =>
  typeof value === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());

// ---------------------------------------------------------------------------
// resolveBillTo: which source wins, and when there is no source at all.
// ---------------------------------------------------------------------------

test("a linked invoice reads the client's CURRENT details, never a snapshot", () => {
  const resolved = resolveBillTo(LINKED_INVOICE, CLIENT_ROW);
  assert.equal(resolved.name, "Synthetic Client A");
  assert.equal(resolved.contact_name, "Chief Pilot");
  assert.equal(resolved.city, "Van Nuys");

  // Rename the client. The invoice row is untouched, and the resolved block
  // must follow the client, because nothing about a linked invoice is frozen
  // at send today and this feature did not change that.
  const renamed = resolveBillTo(LINKED_INVOICE, {
    ...CLIENT_ROW,
    name: "Synthetic Client A, Renamed",
  });
  assert.equal(renamed.name, "Synthetic Client A, Renamed");
});

test("a linked invoice never reads the typed columns, even if a row carries both", () => {
  // The check constraint makes this row impossible through the app. Pinned
  // anyway: the whole point of the constraint is that no reader needs a
  // tie-break rule, and this asserts the reader does not invent one.
  const contradictory = { ...LINKED_INVOICE, bill_to_name: "Should Be Ignored" };
  assert.equal(resolveBillTo(contradictory, CLIENT_ROW).name, "Synthetic Client A");
});

test("a clientless invoice resolves its whole block from the typed columns", () => {
  const resolved = resolveBillTo(ADHOC_INVOICE, null);
  assert.deepEqual(resolved, {
    name: "Ad Hoc Ferry Ops",
    contact_name: "Dispatch",
    address_line1: "1 Ramp Road",
    address_line2: null,
    city: "Teterboro",
    state: "NJ",
    postal_code: "07608",
    country: "US",
  });
});

test("a clientless invoice resolves even when a client row is handed in by mistake", () => {
  // A caller that fetched a client for the wrong reason must not be able to
  // put a stranger's name on this bill.
  assert.equal(resolveBillTo(ADHOC_INVOICE, CLIENT_ROW).name, "Ad Hoc Ferry Ops");
});

test("a linked invoice with no client row resolves to null, which is a FAILED READ", () => {
  // The PDF builder treats null as not-found and refuses to render. That has
  // to stay a hard failure: a bill with an empty "Bill to" block cannot be
  // paid and looks like nobody's fault.
  assert.equal(resolveBillTo(LINKED_INVOICE, null), null);
  assert.equal(resolveBillTo(LINKED_INVOICE, undefined), null);
  // A clientless invoice never produces that null, so the two cases can never
  // be confused for one another.
  assert.notEqual(resolveBillTo(ADHOC_INVOICE, null), null);
});

// ---------------------------------------------------------------------------
// billToListLabel: the three sentences, kept apart.
// ---------------------------------------------------------------------------

test("a list labels the three cases differently", () => {
  const names = new Map([[LINKED_INVOICE.client_id, "Synthetic Client A"]]);

  assert.equal(billToListLabel(LINKED_INVOICE, names), "Synthetic Client A");
  assert.equal(billToListLabel(ADHOC_INVOICE, names), "Ad Hoc Ferry Ops");

  // A SET client_id that did not resolve is a short read, and still says so.
  // If this ever started saying "No client", a truncated clients query would
  // look exactly like a pilot's deliberate choice.
  assert.equal(
    billToListLabel({ client_id: "missing-id", bill_to_name: null }, names),
    "Unknown client"
  );
});

test("a clientless invoice with no name at all still labels, never blank", () => {
  // Unreachable through the app (the check constraint requires the name), but
  // a blank cell in a Client column reads as a rendering bug rather than as
  // data, so the fallback is a word.
  assert.equal(
    billToListLabel({ client_id: null, bill_to_name: null }, new Map()),
    NO_CLIENT_LABEL
  );
  assert.equal(NO_CLIENT_LABEL, "No client");
  assert.notEqual(NO_CLIENT_LABEL, "Unknown client");
});

// ---------------------------------------------------------------------------
// billToEmail: where a send actually goes.
// ---------------------------------------------------------------------------

test("a linked invoice prefers the client's billing email, exactly as before", () => {
  assert.equal(
    billToEmail(LINKED_INVOICE, CLIENT_ROW, looksLikeEmail),
    "payables@example.invalid"
  );
});

test("a linked invoice falls back to contact_email when billing_email is not usable", () => {
  for (const billing of [null, "", "   ", "not-an-address"]) {
    assert.equal(
      billToEmail(LINKED_INVOICE, { ...CLIENT_ROW, billing_email: billing }, looksLikeEmail),
      "ops@example.invalid",
      `billing_email ${JSON.stringify(billing)} should not have been used`
    );
  }
});

test("a clientless invoice sends to the single typed address", () => {
  assert.equal(billToEmail(ADHOC_INVOICE, null, looksLikeEmail), "ap@example.invalid");
});

test("a clientless invoice with no usable address returns null, so the send refuses", () => {
  for (const email of [null, "", "   ", "ops at example"]) {
    assert.equal(
      billToEmail({ client_id: null, bill_to_email: email }, null, looksLikeEmail),
      null
    );
  }
});

test("a clientless invoice ignores a client row's addresses entirely", () => {
  // Otherwise a screen that happened to have a client in hand could promise
  // "Goes to payables@..." for an invoice the send would address elsewhere.
  assert.equal(
    billToEmail({ client_id: null, bill_to_email: null }, CLIENT_ROW, looksLikeEmail),
    null
  );
});

// ---------------------------------------------------------------------------
// The two notices the screens must actually say.
// ---------------------------------------------------------------------------

test("the reminder and late-fee notices name the reason and the remaining option", () => {
  // The decision is "no automatic reminders for a clientless invoice". The
  // screen has to state that, and has to say what still works, or a pilot
  // reasonably assumes the ladder is running.
  assert.match(NO_CLIENT_REMINDER_NOTICE, /no client/i);
  assert.match(NO_CLIENT_REMINDER_NOTICE, /by hand/i);
  assert.match(NO_CLIENT_LATE_FEE_NOTICE, /no client/i);
  assert.match(NO_CLIENT_LATE_FEE_NOTICE, /nothing is charged automatically/i);
});

// ---------------------------------------------------------------------------
// The trip P&L, which is where a null client_id could have taken a whole
// report down.
// ---------------------------------------------------------------------------

/** The smallest complete trip row the assembler accepts. */
function tripRow(overrides = {}) {
  return {
    trip_id: "tttttttt-0000-4000-8000-00000000000a",
    client_id: null,
    trip_kind: "contract_pilot",
    trip_status: "completed",
    billing_state: "invoiced",
    starts_on: "2026-03-01",
    ends_on: "2026-03-03",
    aircraft_ident: "N123SP",
    invoiced_day_money_cents: 0,
    draft_day_money_cents: 0,
    rebilled_cost_cents: 0,
    rebill_invoiced_cents: 0,
    deductible_cents: 0,
    unassigned_cents: 0,
    has_day_rows: false,
    day_quantity: 0,
    scalar_day_count: 0,
    mileage_miles: 0,
    mileage_entry_count: 0,
    ...overrides,
  };
}

function unattributedRow(overrides = {}) {
  return {
    client_id: null,
    unattributed_line_cents: 250000,
    unattributed_line_count: 1,
    draft_unattributed_line_cents: 0,
    draft_unattributed_line_count: 0,
    ...overrides,
  };
}

test("unattributed lines on a clientless invoice do not take the trip P&L down", () => {
  const result = assembleTripPL({
    trips: [],
    unattributed: [unattributedRow()],
    clientNames: new Map(),
  });

  assert.equal(result.ok, true, `the report refused: ${result.reason ?? ""}`);
  const bucket = result.clients.find((c) => c.clientId === null);
  assert.ok(bucket, "the no-client bucket is missing, so the money vanished");
  assert.equal(bucket.clientName, "No client");
  assert.equal(bucket.unattributedLineCents, 250000);
});

test("a SET client_id the clients read did not return still refuses", () => {
  // The refusal discipline this report was built on has to survive the new
  // branch: a short clients read splits one client's revenue across two
  // buckets with nothing on screen saying so, which is worse than no report.
  const result = assembleTripPL({
    trips: [],
    unattributed: [unattributedRow({ client_id: "cccccccc-0000-4000-8000-00000000000a" })],
    clientNames: new Map(),
  });
  assert.equal(result.ok, false);
  assert.match(result.reason, /didn't return it/);
});

test("clientless trips and clientless invoice lines share one no-client bucket", () => {
  const result = assembleTripPL({
    trips: [tripRow({ invoiced_day_money_cents: 90000 })],
    unattributed: [unattributedRow()],
    clientNames: new Map(),
  });

  assert.equal(result.ok, true, `the report refused: ${result.reason ?? ""}`);
  const noClient = result.clients.filter((c) => c.clientId === null);
  assert.equal(noClient.length, 1, "two separate no-client rows would double the reader's work");
  assert.equal(noClient[0].invoicedDayMoneyCents, 90000);
  assert.equal(noClient[0].unattributedLineCents, 250000);
});

test("a named client's rollup is untouched by the new bucket", () => {
  const clientId = "cccccccc-0000-4000-8000-00000000000a";
  const result = assembleTripPL({
    trips: [tripRow({ client_id: clientId, invoiced_day_money_cents: 180000 })],
    unattributed: [unattributedRow({ client_id: clientId, unattributed_line_cents: 20000 })],
    clientNames: new Map([[clientId, "Synthetic Client A"]]),
  });

  assert.equal(result.ok, true, `the report refused: ${result.reason ?? ""}`);
  const row = result.clients.find((c) => c.clientId === clientId);
  assert.ok(row);
  assert.equal(row.clientName, "Synthetic Client A");
  assert.equal(row.invoicedDayMoneyCents, 180000);
  assert.equal(row.unattributedLineCents, 20000);
});

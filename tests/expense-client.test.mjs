import test from "node:test";
import assert from "node:assert/strict";

const { resolveExpenseClient, expenseClientId, clientIdForTrip, clientCostTotals } =
  await import("../lib/expense-client.ts");

/**
 * WHICH CLIENT AN EXPENSE BELONGS TO. All fixtures synthetic.
 *
 * pilot.expenses gained a nullable client_id in 20260815130000, on top of
 * the nullable trip_id it always had. Two columns can now answer one
 * question, which is exactly the "two sources for one number" shape this
 * product treats as a defect -- so there is one reading rule
 * (lib/expense-client.ts) and these tests pin it, including the case where
 * a trip and a client could contradict each other.
 *
 * The disagreement itself is unstorable: the database refuses it with a
 * composite FK to pilot.trips (account_id, id, client_id), so an expense
 * whose client differs from its trip's has no form the app can ever read.
 * What is tested here is the decision the app makes BEFORE the write --
 * that a trip decides the client, so the pair can never be built.
 */

const CLIENT_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const CLIENT_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const TRIP_A = "11111111-1111-1111-1111-111111111111";
const TRIP_NO_CLIENT = "22222222-2222-2222-2222-222222222222";

const TRIP_CLIENTS = new Map([
  [TRIP_A, CLIENT_A],
  [TRIP_NO_CLIENT, null],
]);

test("a direct attribution is the answer, and says so", () => {
  const resolved = resolveExpenseClient({ trip_id: null, client_id: CLIENT_A }, TRIP_CLIENTS);
  assert.equal(resolved.clientId, CLIENT_A);
  assert.equal(resolved.source, "direct");
});

test("a trip-attached expense with no client of its own reads through the trip", () => {
  // This is EVERY expense written before 20260815130000, and every one the
  // bank import confirms. Nothing was backfilled, so if the fallback ever
  // goes away a pilot's whole cost history silently detaches from its
  // clients.
  const resolved = resolveExpenseClient({ trip_id: TRIP_A, client_id: null }, TRIP_CLIENTS);
  assert.equal(resolved.clientId, CLIENT_A);
  assert.equal(resolved.source, "trip");
});

test("no trip and no client is nobody, not an error", () => {
  const resolved = resolveExpenseClient({ trip_id: null, client_id: null }, TRIP_CLIENTS);
  assert.equal(resolved.clientId, null);
  assert.equal(resolved.source, "none");
});

test("a trip with no client does not invent one", () => {
  const resolved = resolveExpenseClient(
    { trip_id: TRIP_NO_CLIENT, client_id: null },
    TRIP_CLIENTS
  );
  assert.equal(resolved.clientId, null);
  assert.equal(resolved.source, "none");
});

test("an unknown trip reads as no client rather than throwing", () => {
  // A truncated or failed trips read must degrade the Client column, not
  // take the page down.
  const resolved = resolveExpenseClient(
    { trip_id: "33333333-3333-3333-3333-333333333333", client_id: null },
    TRIP_CLIENTS
  );
  assert.equal(resolved.clientId, null);
});

test("THE DISAGREEMENT CASE: picking a trip decides the client", () => {
  // The pilot attributed this cost to client B, then filed it against a
  // trip belonging to client A. The trip wins, every time -- it is the
  // stronger statement of who the work was for, and it is the only pairing
  // the database will store.
  assert.equal(clientIdForTrip(CLIENT_A, CLIENT_B, true), CLIENT_A);

  // And a trip with NO client clears the field rather than keeping the
  // pilot's earlier choice. "This trip has no client" together with "this
  // expense is client B's" is precisely the pair the composite FK refuses,
  // so the form must never present it as available.
  assert.equal(clientIdForTrip(null, CLIENT_B, true), null);

  // With no trip in play, the pilot's own choice is the answer.
  assert.equal(clientIdForTrip(null, CLIENT_B, false), CLIENT_B);
  assert.equal(clientIdForTrip(null, null, false), null);
});

test("a resolved expense can never carry a client its trip contradicts", () => {
  // The end-to-end statement of the rule above: whatever the form was
  // showing, what gets stored for a trip-attached expense is the trip's
  // client, so resolveExpenseClient can only ever see an agreeing pair.
  const chosen = CLIENT_B;
  const stored = {
    trip_id: TRIP_A,
    client_id: clientIdForTrip(TRIP_CLIENTS.get(TRIP_A), chosen, true),
  };
  assert.equal(stored.client_id, CLIENT_A);
  assert.equal(expenseClientId(stored, TRIP_CLIENTS), CLIENT_A);
});

test("a client's cost picture counts both paths, and counts each cost once", () => {
  const expenses = [
    // On one of their trips, never attributed directly. The whole history
    // that predates the column looks like this.
    { id: "1", trip_id: TRIP_A, client_id: null, amount_cents: 12_000, treatment: "rebill" },
    // Attributed directly, no trip. The case the column exists for.
    { id: "2", trip_id: null, client_id: CLIENT_A, amount_cents: 45_000, treatment: "deduct" },
    // Both, agreeing. Must not be double counted.
    { id: "3", trip_id: TRIP_A, client_id: CLIENT_A, amount_cents: 3_000, treatment: "unassigned" },
    // Someone else's.
    { id: "4", trip_id: null, client_id: CLIENT_B, amount_cents: 99_000, treatment: "deduct" },
    // Nobody's.
    { id: "5", trip_id: null, client_id: null, amount_cents: 7_000, treatment: "deduct" },
  ];

  const totals = clientCostTotals(expenses, TRIP_CLIENTS, CLIENT_A);
  assert.equal(totals.count, 3);
  assert.equal(totals.rebillCents, 12_000);
  assert.equal(totals.deductCents, 45_000);
  assert.equal(totals.unassignedCents, 3_000);
  assert.equal(totals.totalCents, 60_000);
  // The trip-attached cost is the whole point: a total that only read
  // client_id would report $480.00 and understate this client by $120.00.
  assert.notEqual(totals.totalCents, 48_000);
});

test("an unrecognized treatment is counted as unfiled, not dropped", () => {
  // The money is real whatever the tag says. Losing it from the total
  // because a future treatment value is not one of the three known ones
  // would be a silently wrong figure, which is worse than a mislabeled one.
  const totals = clientCostTotals(
    [{ id: "1", trip_id: null, client_id: CLIENT_A, amount_cents: 500, treatment: "future" }],
    TRIP_CLIENTS,
    CLIENT_A
  );
  assert.equal(totals.totalCents, 500);
  assert.equal(totals.unassignedCents, 500);
});

import test from "node:test";
import assert from "node:assert/strict";

const {
  resolveExpenseClient,
  expenseClientId,
  clientIdForStorage,
  clientCostTotals,
  buildTripClientLookup,
  referencedTripIds,
} = await import("../lib/expense-client.ts");
const { idChunks, ID_CHUNK_SIZE } = await import("../lib/id-chunks.ts");

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

test("THE DISAGREEMENT CASE: a trip decides the client, and stores nothing", () => {
  // The pilot attributed this cost to client B, then filed it against a
  // trip belonging to client A. The trip wins -- it is the stronger
  // statement of who the work was for, and it is the only pairing the
  // database will store. What gets WRITTEN is null, not client A: the
  // column means "attributed directly", and the trip-derived answer is
  // read through the trip rather than copied into the row.
  assert.equal(clientIdForStorage(CLIENT_B, true), null);
  // A trip with no client stores null too, for the same reason.
  assert.equal(clientIdForStorage(CLIENT_B, true), null);
  // With no trip in play, the pilot's own choice is the answer.
  assert.equal(clientIdForStorage(CLIENT_B, false), CLIENT_B);
  assert.equal(clientIdForStorage(null, false), null);
});

test("a resolved expense can never carry a client its trip contradicts", () => {
  // End to end: whatever the form was showing, a trip-attached expense
  // stores null and resolves through the trip, so the pair can never
  // disagree and the row reports itself as trip-derived rather than
  // as something the pilot attributed by hand.
  const stored = { trip_id: TRIP_A, client_id: clientIdForStorage(CLIENT_B, true) };
  assert.equal(stored.client_id, null);
  const resolved = resolveExpenseClient(stored, TRIP_CLIENTS);
  assert.equal(resolved.clientId, CLIENT_A);
  assert.equal(resolved.source, "trip");
});

test("P1: a trip missing from the lookup is refused, never read as no client", () => {
  // The live shape: the trips lookup came back short (capped, paged, or
  // partly failed) and one expense's trip is not in it. Every expense
  // written before 20260815130000 has a null client_id and reaches its
  // client THROUGH the trip, so treating the gap as "no client" would drop
  // a real cost out of its client's filter and total, and wrongly add it to
  // "No client". The lookup has to say it is incomplete instead.
  const needed = [TRIP_A, "44444444-4444-4444-4444-444444444444"];
  const lookup = buildTripClientLookup(needed, [{ id: TRIP_A, client_id: CLIENT_A }]);
  assert.equal(lookup.ok, false);

  // And the naked resolver, used on a map built from that short read,
  // is exactly what would have gone wrong: it answers "nobody" for a
  // cost that has an owner. This is why the caller must check ok first.
  const short = new Map([[TRIP_A, CLIENT_A]]);
  const missing = { trip_id: "44444444-4444-4444-4444-444444444444", client_id: null };
  assert.equal(resolveExpenseClient(missing, short).clientId, null);
});

test("P1: a failed trip lookup is refused, and is not an empty map", () => {
  // A failed read and "this account has no trips" must not produce the
  // same value -- that is the lib/supabase/rows.ts rule applied to a join.
  assert.equal(buildTripClientLookup([TRIP_A], null).ok, false);
  // Nothing needed, nothing read: complete, and legitimately empty.
  const none = buildTripClientLookup([], []);
  assert.equal(none.ok, true);
  assert.equal(none.clientIdByTrip.size, 0);
});

test("a complete lookup carries every trip asked for, clientless ones included", () => {
  const lookup = buildTripClientLookup(
    [TRIP_A, TRIP_NO_CLIENT],
    [
      { id: TRIP_A, client_id: CLIENT_A },
      { id: TRIP_NO_CLIENT, client_id: null },
    ]
  );
  assert.equal(lookup.ok, true);
  // A trip present with a null client is COMPLETE, not missing. Confusing
  // the two would refuse the page for the ordinary case of a trip nobody
  // has assigned a client to yet.
  assert.equal(lookup.clientIdByTrip.get(TRIP_NO_CLIENT), null);
  assert.equal(lookup.clientIdByTrip.get(TRIP_A), CLIENT_A);
});

test("the lookup is asked only for the trips on the page, each once", () => {
  const ids = referencedTripIds([
    { trip_id: TRIP_A, client_id: null },
    { trip_id: TRIP_A, client_id: CLIENT_A },
    { trip_id: null, client_id: CLIENT_B },
    { trip_id: TRIP_NO_CLIENT, client_id: null },
  ]);
  assert.deepEqual(ids.sort(), [TRIP_A, TRIP_NO_CLIENT].sort());
  assert.deepEqual(referencedTripIds([]), []);
});

test("id lists are chunked into requests a URL can carry", () => {
  // 1000 uuids in one .in() is a ~39 KB query string, which a proxy
  // rejects outright -- turning a partial figure into a failed panel.
  const ids = Array.from({ length: 250 }, (_, i) => `id-${i}`);
  const chunks = idChunks(ids);
  assert.equal(chunks.length, Math.ceil(250 / ID_CHUNK_SIZE));
  assert.ok(chunks.every((chunk) => chunk.length <= ID_CHUNK_SIZE));
  // Every id survives, in order, exactly once.
  assert.deepEqual(chunks.flat(), ids);
  assert.deepEqual(idChunks([]), []);
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

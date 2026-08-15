/**
 * WHICH CLIENT AN EXPENSE BELONGS TO. The single definition, so no screen
 * invents a second one.
 *
 * pilot.expenses carries a nullable client_id (20260815130000) alongside
 * its nullable trip_id, so a cost can be attributed to a client that never
 * went through a trip: recurrent training or indoc a client required before
 * they would roster you, a headset adapter for one owner's panel, parking
 * on a day that cancelled before it became a trip.
 *
 * THE RULE IS `client_id, else the trip's client`, and it is safe to state
 * that flatly because the database will not store a disagreement: when an
 * expense has both a trip and a client, the composite FK to pilot.trips
 * (account_id, id, client_id) forces the pair to be one pilot.trips
 * actually holds. So the two sources can never point at different clients,
 * and the only question this function answers is which one has an answer.
 *
 * WHY THE FALLBACK EXISTS AT ALL, given that: no row was backfilled. Every
 * expense written before 20260815130000 has client_id null, including the
 * ones sitting on a trip with a client, and so does every expense the bank
 * import confirms (pilot.bank_transaction_confirm sets trip_id and nothing
 * else). Reading the trip through is what makes a by-client total count
 * those rather than quietly omitting the entire history that predates the
 * column.
 *
 * The `source` is carried out with the answer rather than being recomputed
 * at each call site, because the difference between "the pilot said this
 * cost was theirs" and "it sits on one of their trips" is a real one and
 * the UI should be able to say which it is showing.
 */

export type ExpenseClientSource = "direct" | "trip" | "none";

export type ExpenseClientInput = {
  trip_id: string | null;
  client_id: string | null;
};

export type ExpenseClient = {
  clientId: string | null;
  source: ExpenseClientSource;
};

/**
 * @param tripClientIds trip id to that trip's client id (null for a trip
 *   with no client). A trip missing from the map is treated as a trip whose
 *   client is unknown, which reads as "no client" rather than throwing: a
 *   failed or truncated trips read must not take a page down.
 */
export function resolveExpenseClient(
  expense: ExpenseClientInput,
  tripClientIds: ReadonlyMap<string, string | null>
): ExpenseClient {
  if (expense.client_id) return { clientId: expense.client_id, source: "direct" };
  if (expense.trip_id) {
    const viaTrip = tripClientIds.get(expense.trip_id) ?? null;
    if (viaTrip) return { clientId: viaTrip, source: "trip" };
  }
  return { clientId: null, source: "none" };
}

/** Convenience for the filter path, where only the id matters. */
export function expenseClientId(
  expense: ExpenseClientInput,
  tripClientIds: ReadonlyMap<string, string | null>
): string | null {
  return resolveExpenseClient(expense, tripClientIds).clientId;
}

/**
 * What goes in client_id when the row is written.
 *
 * A TRIP MEANS NULL. Not "the trip's client" -- null. The column means "the
 * pilot attributed this directly", and the trip-derived answer is
 * deliberately not materialised into it. Three things depend on that and
 * break together if this ever starts copying the trip's client in:
 *
 *   * the no-backfill argument (20260815130000). Existing rows keep null
 *     BECAUSE null is the normal, correct state for a trip-attached
 *     expense. Writing the derived value on new rows would leave the table
 *     split between two conventions for the same fact, which is the
 *     "two sources for one number" defect this product treats as a bug.
 *   * the "Via trip" marker. resolveExpenseClient reports `direct` for
 *     anything with a stored client_id, so materialising it would label
 *     every trip expense as a direct attribution and the marker would
 *     never appear.
 *   * ON DELETE SET NULL (trip_id). Deleting a trip is meant to leave a
 *     DIRECT attribution standing and nothing else. A materialised value
 *     would survive the trip it was copied from and become an attribution
 *     the pilot never made, on a trip that no longer exists.
 *
 * Nothing is weakened by storing null: the composite FK on (account_id,
 * trip_id, client_id) is MATCH SIMPLE, so a null client_id satisfies it
 * trivially, and the trip's own FK still proves the trip is in the account.
 */
export function clientIdForStorage(
  chosenClientId: string | null,
  hasTrip: boolean
): string | null {
  return hasTrip ? null : chosenClientId;
}

/**
 * The trip-to-client map the reading rule needs, or a refusal.
 *
 * WHY THIS IS A RESULT TYPE AND NOT A MAP. Every expense written before
 * 20260815130000, and every one the bank import confirms, carries a null
 * client_id and reaches its client THROUGH the trip. So a trip whose client
 * this lookup does not know is not a harmless gap: that expense reads as
 * belonging to nobody. It disappears from its client's filter, appears
 * wrongly under "No client", and drops out of that client's cost total --
 * silently, and in the direction that understates. An incomplete lookup and
 * a complete one must therefore not be the same value, and this is the
 * boundary that keeps them apart (the lib/supabase/rows.ts rule, applied to
 * a join rather than a list).
 *
 * INCOMPLETE HAS TWO CAUSES, both fatal to the same figures:
 *   * the read failed -- `rows` is null;
 *   * the read succeeded but did not return every trip asked for, which
 *     means it was truncated. pilot.expenses.trip_id is a foreign key with
 *     ON DELETE SET NULL, so a referenced trip always exists and always
 *     belongs to the same account; a missing one is never "deleted" or
 *     "not yours", it is only ever "not all of them came back".
 */
export type TripClientLookup =
  | { ok: true; clientIdByTrip: ReadonlyMap<string, string | null> }
  | { ok: false };

export function buildTripClientLookup(
  neededTripIds: readonly string[],
  rows: readonly { id: string; client_id: string | null }[] | null
): TripClientLookup {
  if (rows === null) return { ok: false };
  const clientIdByTrip = new Map(rows.map((trip) => [trip.id, trip.client_id]));
  for (const id of neededTripIds) {
    if (!clientIdByTrip.has(id)) return { ok: false };
  }
  return { ok: true, clientIdByTrip };
}

/** Every distinct trip an expense list refers to. The bound on the lookup. */
export function referencedTripIds(
  expenses: readonly ExpenseClientInput[]
): string[] {
  const ids = new Set<string>();
  for (const expense of expenses) {
    if (expense.trip_id) ids.add(expense.trip_id);
  }
  return [...ids];
}

/**
 * Totals a set of expenses for one client, by treatment.
 *
 * Deliberately NOT a filter plus three reduces at each call site: "what has
 * this client cost me" is a figure that appears on more than one screen,
 * and two screens computing it separately is how they come to disagree.
 * Amounts are integer cents throughout, so the sums are exact.
 */
export type ClientCostTotals = {
  rebillCents: number;
  deductCents: number;
  unassignedCents: number;
  totalCents: number;
  count: number;
};

export function clientCostTotals(
  expenses: readonly (ExpenseClientInput & { amount_cents: number; treatment: string })[],
  tripClientIds: ReadonlyMap<string, string | null>,
  clientId: string
): ClientCostTotals {
  const totals: ClientCostTotals = {
    rebillCents: 0,
    deductCents: 0,
    unassignedCents: 0,
    totalCents: 0,
    count: 0,
  };
  for (const expense of expenses) {
    if (expenseClientId(expense, tripClientIds) !== clientId) continue;
    totals.count += 1;
    totals.totalCents += expense.amount_cents;
    if (expense.treatment === "rebill") totals.rebillCents += expense.amount_cents;
    else if (expense.treatment === "deduct") totals.deductCents += expense.amount_cents;
    else totals.unassignedCents += expense.amount_cents;
  }
  return totals;
}

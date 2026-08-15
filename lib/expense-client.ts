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
 * The client the form must post for a given trip choice.
 *
 * Picking a trip DECIDES the client: the trip is the stronger statement of
 * who the work was for, and the database refuses any other pairing. So the
 * form derives rather than asks, and a client the pilot had chosen before
 * picking a trip is replaced, not merged. Picking a trip with no client on
 * it clears the field too, because "this trip has no client" and "this
 * expense is for client X" is precisely the combination that has no
 * storable form.
 *
 * `null` trip means the pilot's own choice stands.
 */
export function clientIdForTrip(
  tripClientId: string | null | undefined,
  chosenClientId: string | null,
  hasTrip: boolean
): string | null {
  if (!hasTrip) return chosenClientId;
  return tripClientId ?? null;
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

/**
 * The pure layer between pilot.unbilled_* and the Overview module.
 *
 * The DATABASE owns every figure (see
 * supabase/migrations/20260813010000_unbilled_money_reads.sql): the trip
 * rows, the per-client rollup and the account total are one derivation
 * chain, so they cannot disagree. Nothing in this file re-adds money, and
 * nothing in it may. What lives here is the arithmetic the database cannot
 * do for a screen — ordering, labelling, pluralising, and the one CHECK
 * that proves the chain arrived intact.
 *
 * It is a separate file for the reason app/(app)/accounting/ledger-lib.ts
 * is: a server component cannot be unit-tested, and every function below is
 * a place a plausible-looking mistake would be invisible on the screen. "6
 * unbilled trip days" reading 6 when the true figure is 6.5, or a client
 * row linking to a draft flow that silently drops half its trips, are both
 * silent-wrong-number defects, which is the class this product spends its
 * review budget on.
 */

/** One row of pilot.unbilled_by_client. */
export type UnbilledClientRow = {
  /** Null for the no-client bucket — pilot.trips.client_id is nullable. */
  client_id: string | null;
  /** Null when the client id is null, or when the client row is unreadable. */
  client_name: string | null;
  trip_count: number;
  /**
   * Billable day count. `numeric` in Postgres and therefore possibly a
   * string over the wire depending on the serializer — every consumer here
   * runs it through Number() rather than trusting the declared type, the
   * same defensive read app/(app)/overview/page.tsx already applies to
   * pilot.trips.day_count.
   */
  billable_days: number;
  day_value_cents: number;
  rebill_expense_cents: number;
  total_cents: number;
  oldest_ends_on: string | null;
};

/** The single row of pilot.unbilled_summary. */
export type UnbilledSummaryRow = {
  client_count: number;
  trip_count: number;
  billable_days: number;
  day_value_cents: number;
  rebill_expense_cents: number;
  total_cents: number;
  oldest_ends_on: string | null;
};

/** One row of pilot.unbilled_trip_money. */
export type UnbilledTripMoneyRow = {
  trip_id: string;
  client_id: string | null;
  client_name: string | null;
  starts_on: string;
  ends_on: string;
  aircraft_ident: string | null;
  billable_days: number;
  day_value_cents: number;
  rebill_expense_cents: number;
};

/**
 * A day count for display.
 *
 * pilot.trip_days.quantity is numeric(3,1) and pilot.trips.day_count
 * numeric(5,1), so half days are a shipped feature and 6.5 is a real
 * answer — `Math.round` here would print "7 unbilled trip days" for six and
 * a half, which is a lie about money in the pilot's favour and therefore
 * the direction that gets believed. One decimal is the column's own scale;
 * a whole number renders without the trailing ".0" because "6.0 days"
 * reads like a measurement rather than a count.
 *
 * Guards NaN explicitly: a numeric arriving as a string that failed to
 * parse would otherwise render "NaN unbilled trip days".
 */
export function formatDays(days: number): string {
  const value = Number(days);
  if (!Number.isFinite(value)) return "—";
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

/**
 * "1 day" / "6.5 days" — pluralised off the VALUE, not off a rounded copy,
 * and not off the string. A `numeric` arriving as "1" would pass a
 * `count === 1` test in neither direction reliably, so it is coerced first.
 */
export function pluralizeDays(days: number): string {
  const value = Number(days);
  if (!Number.isFinite(value)) return "— days";
  return `${formatDays(value)} ${value === 1 ? "day" : "days"}`;
}

/**
 * Whole days elapsed since a `date` column, or null if there is no date.
 *
 * Parsed as UTC midnight for the reason lib/format.ts's parseCalendarDate
 * documents: a trip date is a calendar fact, not an instant, and
 * `new Date("2026-08-05")` read in local time is August 4th west of
 * Greenwich. Floored, never rounded — a trip that ended 20 hours ago has
 * been waiting 0 days, not 1.
 *
 * `now` is a parameter rather than a call to Date.now() so the behaviour is
 * pinnable in a test; production passes Date.now().
 */
export function daysSince(iso: string | null | undefined, now: number): number | null {
  if (!iso) return null;
  const parsed = Date.parse(`${iso.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(parsed)) return null;
  return Math.max(0, Math.floor((now - parsed) / 86_400_000));
}

/**
 * The label for a client bucket.
 *
 * THREE CASES, and collapsing any two of them loses information a pilot
 * needs:
 *   - a named client                 → its name
 *   - client_id set, name missing    → "Unknown client". The trip points at
 *     a client row this read could not see. Saying "No client" here would
 *     assert the trip is unassigned, which is a different (and fixable-in-a
 *     -different-place) problem.
 *   - client_id null                 → "No client". Real, and real money:
 *     the trip is genuinely unassigned and cannot be drafted until it is.
 *
 * The strings match app/(app)/overview/page.tsx's existing "Ready to
 * invoice" list exactly, so the same trip reads the same way in both
 * panels on the same screen.
 */
export function clientLabel(row: {
  client_id: string | null;
  client_name: string | null;
}): string {
  if (!row.client_id) return "No client";
  return row.client_name ?? "Unknown client";
}

/**
 * Where a client row's one-tap action goes.
 *
 * /invoices/new reads exactly one search param, `client` (see its own
 * `searchParams` type) — there is no `trip=` param, and inventing one here
 * would produce a link that silently ignores half of what it promises.
 * That single-client shape is precisely why this module exists: Overview's
 * older "Invoice N trips" button could only appear when every unbilled trip
 * in the account shared one client, and a row per client dissolves that
 * limitation without the draft flow changing at all.
 *
 * The no-client bucket has no honest draft link — there is no client to
 * draft against — so it goes to the trips list, where the client can be
 * set. Returning /invoices/new bare instead would open a flow that cannot
 * possibly include those trips.
 */
export function draftHref(clientId: string | null): string {
  return clientId ? `/invoices/new?client=${clientId}` : "/trips";
}

/** The verb on that link, matching where it actually goes. */
export function draftAction(clientId: string | null): string {
  return clientId ? "Draft invoice" : "Assign a client";
}

/**
 * Client rows, biggest first.
 *
 * Ordering is not decoration on a module whose job is "what should I bill
 * next": the largest unbilled balance is the answer, so it goes first. Ties
 * break on the oldest work (a stale $2,000 outranks a fresh $2,000), then
 * on the label so the order is stable across renders rather than depending
 * on the planner.
 *
 * The no-client bucket is NOT forced to the bottom. It is real money and
 * sorting it by size keeps the column readable as a ranking; hiding it at
 * the end would understate a problem the pilot has to fix before that money
 * can be invoiced at all.
 *
 * Returns a new array — the caller's read result is not mutated.
 */
export function sortClientRows(rows: UnbilledClientRow[]): UnbilledClientRow[] {
  return [...rows].sort((a, b) => {
    if (b.total_cents !== a.total_cents) return b.total_cents - a.total_cents;
    const aOld = a.oldest_ends_on ?? "";
    const bOld = b.oldest_ends_on ?? "";
    if (aOld !== bOld) return aOld < bOld ? -1 : 1;
    return clientLabel(a).localeCompare(clientLabel(b));
  });
}

/**
 * THE RECONCILIATION CHECK, money half.
 *
 * pilot.unbilled_summary is defined as an aggregate OVER
 * pilot.unbilled_by_client, so in the database these two numbers are the
 * same number. This function exists because they travel to the screen
 * separately: the total arrives as one row, the client rows as a set, and
 * the Data API silently caps a set. A pilot with more than a thousand
 * clients would see a headline total that is correct and a list beneath it
 * that adds up to less, with no error anywhere.
 *
 * So the check is not defensive dressing over an impossible case — it is
 * the ONLY signal that the list was truncated in transit, and it is
 * strictly stronger than the `rows.length === limit` heuristic Overview
 * uses for its other bounded reads, because it compares the actual sums.
 *
 * Returns the shortfall in cents: POSITIVE when the rows add up to less
 * than the total. It can also come back NEGATIVE, which truncation cannot
 * produce — see clientRowsState for what that means and why the caller must
 * not describe it as a capped list.
 */
export function clientRowsShortfallCents(
  summary: UnbilledSummaryRow,
  rows: UnbilledClientRow[]
): number {
  const rowsTotal = rows.reduce((sum, r) => sum + Number(r.total_cents), 0);
  return Number(summary.total_cents) - rowsTotal;
}

/**
 * THE RECONCILIATION CHECK, count half.
 *
 * The money comparison alone is not sufficient, because a dropped row can
 * carry zero money. A client bucket whose trips are all priced at $0 — a
 * grid of entirely non-billable days, or a scalar trip with no rate set yet,
 * and no rebillable receipts — contributes nothing to either sum, so a row
 * set capped exactly where those buckets sit reconciles perfectly while the
 * table is missing rows and the lede's "across N clients" undercounts.
 *
 * Those buckets are not noise worth ignoring: a $0 unbilled client is
 * usually a pilot's own setup gap (no rate captured), which is precisely the
 * thing this module exists to put in front of them.
 *
 * Both counts come from the summary, which is one row and therefore never
 * capped, so this compares the rows against a figure that cannot itself be
 * short. Trips are compared as well as buckets because a bucket can be
 * present while the summary counts more trips inside it.
 */
export function clientRowsShortfallTrips(
  summary: UnbilledSummaryRow,
  rows: UnbilledClientRow[]
): number {
  const rowsTrips = rows.reduce((sum, r) => sum + Number(r.trip_count), 0);
  return Number(summary.trip_count) - rowsTrips;
}

/**
 * What the caller may honestly SAY about the breakdown.
 *
 * "complete"     the rows are the whole total, at every level checked.
 * "partial"      the rows are a strict subset — fewer clients, fewer trips,
 *                or less money than the summary. The Data API's silent row
 *                cap is the cause this can actually have, and the caller
 *                names it.
 * "inconsistent" the rows claim MORE than the total. Truncation cannot do
 *                that, so the cause is not truncation: the summary, the
 *                client rows and the trip rows are three separate PostgREST
 *                requests and therefore three separate transactions, and a
 *                write landing between them (an invoice sent on a phone
 *                while Overview loads on a laptop) leaves the two reads
 *                describing different instants.
 *
 * THE THIRD STATE IS WHY THIS EXISTS. Testing `shortfall !== 0` and calling
 * every non-zero result a capped list produces, on a negative shortfall, the
 * sentence "the rows above account for $900.00 of the $800.00 total" —
 * self-contradicting arithmetic attached to a diagnosis that is also wrong.
 * A caveat a pilot can prove false is worse than no caveat: it teaches them
 * to disbelieve the ones that are true.
 *
 * The three reads could instead be one RPC returning summary and rows
 * together, which would remove the skew rather than describe it. That is the
 * real fix and it is not this one; until then the screen says which of the
 * two things happened rather than guessing.
 */
export type UnbilledBreakdownState = "complete" | "partial" | "inconsistent";

export function clientRowsState(
  summary: UnbilledSummaryRow,
  rows: UnbilledClientRow[]
): UnbilledBreakdownState {
  const cents = clientRowsShortfallCents(summary, rows);
  const trips = clientRowsShortfallTrips(summary, rows);
  const buckets = Number(summary.client_count) - rows.length;
  if (cents < 0 || trips < 0 || buckets < 0) return "inconsistent";
  if (cents > 0 || trips > 0 || buckets > 0) return "partial";
  return "complete";
}

/**
 * The module's opening sentence — the roadmap's own example, computed
 * rather than illustrated: "6.5 unbilled trip days and $840.00 in unbilled
 * reimbursables across 3 clients."
 *
 * TWO THINGS IT REFUSES TO SAY:
 *
 * 1. It never calls the no-client bucket a client. `client_count` from the
 *    database counts BUCKETS, and one of them may be "no client" — a
 *    trip nobody is assigned to. "Across 3 clients" when one of the three
 *    is nothing of the sort is a small lie that a pilot reconciling against
 *    their own client list will catch immediately. `namedClients` is passed
 *    separately and the extra bucket is named in its own clause.
 * 2. It never says "0 days" as though that were news. A caller with nothing
 *    unbilled renders the empty state instead; this returns null so that
 *    branch cannot be forgotten.
 *
 * "TRIP DAYS", not "trip time". They are different quantities to a pilot
 * and the product must not blur them: flight time and block time are hours
 * in a logbook (14 CFR 1.1), while a trip day is a day record under an
 * assignment — the billing unit. This sentence is about the second.
 *
 * `formatMoney` is injected rather than imported so this file stays free of
 * the server-only import graph and the test can pin the exact string
 * without depending on Intl's locale data.
 */
export function unbilledLede(
  summary: UnbilledSummaryRow,
  namedClients: number,
  hasUnassigned: boolean,
  formatMoney: (cents: number) => string
): string | null {
  if (Number(summary.trip_count) <= 0) return null;

  const days = Number(summary.billable_days);
  const daysText = `${formatDays(days)} unbilled trip ${days === 1 ? "day" : "days"}`;
  const reimbursables = formatMoney(Number(summary.rebill_expense_cents));
  const across =
    namedClients > 0
      ? ` across ${namedClients === 1 ? "1 client" : `${namedClients} clients`}`
      : "";
  const unassigned = hasUnassigned
    ? `${namedClients > 0 ? ", plus work with no client assigned" : " on work with no client assigned"}`
    : "";

  return `${daysText} and ${reimbursables} in unbilled reimbursables${across}${unassigned}.`;
}

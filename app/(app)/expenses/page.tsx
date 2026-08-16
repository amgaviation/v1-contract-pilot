import NextLink from "next/link";
import { LAlert, LCard, LEmpty, LPill, LTable, LTd, LTh, lButtonClass } from "@/components/ledger";
import { LPageShell } from "@/components/ledger/page-shell";

import { createClient } from "@/lib/supabase/server";
import { requireAccount } from "@/lib/supabase/account";
import { formatCents, formatDate, formatDateRange } from "@/lib/format";
import { friendlyDbError } from "@/lib/db-errors";
import { loadOptionLabels } from "@/lib/custom-options-read";
import { scheduleCMileageCents, type RatesByYear } from "@/lib/mileage";
import {
  buildTripClientLookup,
  referencedTripIds,
  resolveExpenseClient,
} from "@/lib/expense-client";
import { idChunks } from "@/lib/id-chunks";
import UnassignedQueue, { type QueueRow } from "./unassigned-queue";

export const metadata = { title: "Expenses" };

type ExpenseRow = {
  id: string;
  incurred_on: string;
  category: string;
  vendor: string | null;
  amount_cents: number;
  treatment: string;
  trip_id: string | null;
  client_id: string | null;
  receipt_path: string | null;
};

type TripRow = {
  id: string;
  starts_on: string;
  ends_on: string;
  aircraft_ident: string | null;
  client_id: string | null;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The "not attributed to anyone" filter. A real question with a real
 * answer -- costs sitting against no client at all are the ones a pilot is
 * absorbing without knowing whose work caused them -- so it gets a value
 * rather than being reachable only by elimination. "none" cannot collide
 * with a client id, which is always a uuid.
 */
const NO_CLIENT_FILTER = "none";

type Badge = { tone: "warn" | "accent" | "good"; label: string };
const TREATMENT_FALLBACK: Badge = { tone: "warn", label: "Unassigned" };
const TREATMENT_BADGE: Record<string, Badge> = {
  unassigned: TREATMENT_FALLBACK,
  rebill: { tone: "accent", label: "Rebill" },
  deduct: { tone: "good", label: "Deduct" },
};

// Supabase's Data API caps rows (commonly 1000) and TRUNCATES SILENTLY on
// a plain select — no error, just a shorter array. An explicit .limit
// makes that boundary visible (rows.length === the limit) instead of
// invisible, and the callout below turns it into a caveat rather than a
// quietly wrong "unfiled" total. Same pattern as logbook/page.tsx's
// ENTRIES_LIMIT and page.tsx's AGGREGATE_LIMIT — copied, not reinvented.
const EXPENSES_LIMIT = 1000;

// Mirrors EXPENSES_LIMIT's truncation-visibility reasoning: only the
// mileage TOTAL is shown on this page (the log itself lives at
// /expenses/mileage), but the same silent-truncation hazard applies to it.
const MILEAGE_LIMIT = 1000;

export default async function ExpensesPage({
  searchParams,
}: {
  // ?client= narrows the ledger to one client's costs, and is where a
  // client's own cost panel links to. An unrecognized value is ignored
  // rather than rejected, same as trips/page.tsx: a stale or hand-edited
  // query string should degrade to "show everything", not a page error.
  searchParams: Promise<{ client?: string }>;
}) {
  await requireAccount("/expenses");
  const params = await searchParams;
  // Shape only. Whether the id names a client this account actually has is
  // settled below, against the loaded rows -- a syntactically valid uuid
  // from a stale bookmark or another account would otherwise pass this and
  // replace the whole ledger with an "Unknown client" empty state, which is
  // the opposite of the "unrecognized values are ignored" promise above.
  const requestedClient =
    params.client === NO_CLIENT_FILTER
      ? NO_CLIENT_FILTER
      : params.client && UUID_RE.test(params.client)
        ? params.client
        : null;

  const supabase = await createClient();
  // categoryLabels replaces a hand-written map that lived in this file
  // and had ALREADY fallen behind: it held the travel eight only, so
  // every self-funded category added in 20260810070000 — training,
  // medical, insurance, charts, equipment, uniform, dues — rendered as
  // "Other" on this screen. Resolving through the options table fixes
  // that and picks up the tenant's own renames at the same time, and it
  // includes retired categories, because this is a history screen.
  const [
    { data: expenseData, error },
    { data: tripData, error: tripsError },
    unreviewedCount,
    { data: mileageData, error: mileageError },
    { data: mileageRateData, error: mileageRateError },
    categoryLabels,
    { data: invoicedLinesData },
    { data: clientData, error: clientsError },
  ] = await Promise.all([
    supabase
      .from("expenses")
      .select(
        "id, incurred_on, category, vendor, amount_cents, treatment, trip_id, client_id, receipt_path"
      )
      .order("incurred_on", { ascending: false })
      .limit(EXPENSES_LIMIT),
    supabase
      .from("trips")
      .select("id, starts_on, ends_on, aircraft_ident, client_id")
      .order("starts_on", { ascending: false }),
    // count-only ("head: true" — no rows fetched) — this is a badge, not
    // a list, so nothing from bank_transactions itself needs to reach
    // this page's payload.
    supabase
      .from("bank_transactions")
      .select("id", { count: "exact", head: true })
      .eq("review_state", "unreviewed"),
    // drove_on and miles, not the per-row amount_cents — the deduction is
    // total miles for the year x that year's rate, rounded ONCE. See
    // lib/mileage.ts; this was the third surface computing it differently.
    supabase
      .from("mileage_entries")
      .select("drove_on, miles")
      .limit(MILEAGE_LIMIT),
    supabase.from("mileage_rates").select("tax_year, rate_cents_per_mile"),
    loadOptionLabels("expense_category"),
    // Same "every already-referenced expense_id" read as
    // invoices/[id]/page.tsx's rebillable-expense picker — invoice_lines
    // carries `unique (account_id, expense_id)`, so an expense_id showing
    // up here at all means it is already on an invoice, full stop, no
    // status filter needed. A failed read degrades to "exclude nothing",
    // which is the number this page already showed before this fix — not
    // a new failure mode, just a missed improvement.
    supabase.from("invoice_lines").select("expense_id").not("expense_id", "is", null),
    // Names for the Client column and the filter row. Archived clients are
    // included: this is a history screen, and a cost attributed to a client
    // the pilot has since archived still has to render as that client's.
    supabase.from("clients").select("id, name, archived_at").order("name"),
  ]);

  const allExpenses = (expenseData ?? []) as ExpenseRow[];
  const trips = (tripData ?? []) as TripRow[];
  // Measured BEFORE the client filter is applied, because that filter runs
  // in memory (see clientOf below) and would otherwise mask the cap: 1000
  // expenses narrowed to 12 for one client is not a list of 12 that happens
  // to be short, it is 12 out of an unknown number.
  const truncatedExpenses = allExpenses.length === EXPENSES_LIMIT;

  const clientRows = (clientData ?? []) as {
    id: string;
    name: string;
    archived_at: string | null;
  }[];
  const clientNames = new Map(clientRows.map((c) => [c.id, c.name]));
  // A failed clients read is not "you have no clients" -- the filter row is
  // withheld rather than rendered empty, and the Client column says so.
  const clientsLoadError = Boolean(clientsError);
  const clientChoices = clientRows.filter((c) => !c.archived_at);

  // WHICH TRIPS THIS PAGE NEEDS, and only those.
  //
  // The trips read above is for the LABELS and the filing queue's picker.
  // It cannot also serve the client lookup: it is capped at the Data API's
  // 1000 rows and ordered newest-first, so on a career pilot's account a
  // recent expense attached to an older trip would find no entry and read
  // as belonging to nobody. That is not a cosmetic gap -- every expense
  // written before 20260815130000, and every one the bank import confirms,
  // has a null client_id and reaches its client THROUGH the trip, so those
  // are exactly the rows that would silently leave their client's filter
  // and their client's totals.
  //
  // Asked for by id instead, the read is bounded by the page size rather
  // than by the account's history, and chunked because a thousand uuids in
  // one `.in()` is a ~39 KB URL that a proxy rejects outright. Completeness
  // is then checked, not assumed (buildTripClientLookup).
  const neededTripIds = referencedTripIds(allExpenses);
  let tripClientRows: { id: string; client_id: string | null }[] | null = [];
  if (neededTripIds.length > 0) {
    const chunks = await Promise.all(
      idChunks(neededTripIds).map((chunk) =>
        supabase.from("trips").select("id, client_id").in("id", chunk)
      )
    );
    tripClientRows = chunks.some((chunk) => chunk.error)
      ? null
      : chunks.flatMap((chunk) => (chunk.data ?? []) as { id: string; client_id: string | null }[]);
  }
  const tripClients = buildTripClientLookup(neededTripIds, tripClientRows);

  // The reading rule lives in lib/expense-client.ts so this screen, the
  // client record's cost panel, and anything added later cannot drift into
  // three different answers to "whose cost is this".
  const clientOf = (expense: ExpenseRow) =>
    tripClients.ok
      ? resolveExpenseClient(expense, tripClients.clientIdByTrip)
      : null;

  // A filter is only honoured once it names a client this account has AND
  // the lookup that decides membership is complete. Filtering on a partial
  // lookup would put a real cost under "No client" and drop it from its
  // own client's total, with a figure on screen that looks authoritative.
  const clientFilter =
    !tripClients.ok || clientsLoadError
      ? null
      : requestedClient === NO_CLIENT_FILTER
        ? NO_CLIENT_FILTER
        : requestedClient && clientRows.some((c) => c.id === requestedClient)
          ? requestedClient
          : null;
  // Asked for something, got nothing: say which of the two reasons it was.
  const filterUnavailable = requestedClient !== null && clientFilter === null;

  const expenses = clientFilter
    ? allExpenses.filter((expense) => {
        const resolved = clientOf(expense)?.clientId ?? null;
        return clientFilter === NO_CLIENT_FILTER
          ? resolved === null
          : resolved === clientFilter;
      })
    : allExpenses;

  const mileageRows = (mileageData ?? []) as { drove_on: string; miles: number }[];
  const mileageRatesByYear: RatesByYear = Object.fromEntries(
    ((mileageRateData ?? []) as { tax_year: number; rate_cents_per_mile: number }[]).map(
      (r) => [r.tax_year, r.rate_cents_per_mile]
    )
  );
  const { amountCents: mileageTotalCents, milesWithoutRate } = scheduleCMileageCents(
    mileageRows,
    mileageRatesByYear
  );
  const mileageTotalMiles = mileageRows.reduce((sum, r) => sum + r.miles, 0);
  const mileageTruncated = mileageRows.length === MILEAGE_LIMIT;
  // A failed mileage_rates read must read the same as a failed
  // mileage_entries read, not as "no rate on file" — that day-one wording
  // is only honest when the rates query actually came back empty, not when
  // it errored and ratesByYear was silently built from nothing.
  const mileageFailed = Boolean(mileageError || mileageRateError);

  // U5: the trips read used to destructure `{ data: tripData }` only. On
  // failure `trips` degrades to `[]` exactly like a pilot with no trips
  // logged — every row in the Needs-filing queue below then shows a Trip
  // picker offering just "No trip" with its Rebill button disabled and no
  // explanation, and the Trip column here reads "—" for every trip that
  // does have one on file.
  const tripsLoadError = Boolean(tripsError);

  const tripLabel = (trip: TripRow) =>
    `${formatDateRange(trip.starts_on, trip.ends_on)}${
      trip.aircraft_ident ? ` · ${trip.aircraft_ident}` : ""
    }`;
  const tripLabels = new Map(trips.map((trip) => [trip.id, tripLabel(trip)]));
  const tripOptions = trips.map((trip) => ({ id: trip.id, label: tripLabel(trip) }));

  // The unassigned queue is a first-class surface, not a filter: these
  // receipts are neither billed nor deducted, which is money the pilot is
  // currently losing in both directions. It sits above the ledger.
  const unassigned = expenses.filter((e) => e.treatment === "unassigned");
  const unassignedTotal = unassigned.reduce((sum, e) => sum + e.amount_cents, 0);
  // "$X to rebill" has to mean outstanding, actionable money — not a
  // standing figure that still counts a receipt already sitting on an
  // invoice (drafted, sent, or paid). invoice_lines' unique
  // (account_id, expense_id) makes that state knowable without a join:
  // an expense_id present at all is already spoken for.
  const invoicedExpenseIds = new Set(
    ((invoicedLinesData ?? []) as { expense_id: string | null }[]).map((l) => l.expense_id)
  );
  const rebillTotal = expenses
    .filter((e) => e.treatment === "rebill" && !invoicedExpenseIds.has(e.id))
    .reduce((sum, e) => sum + e.amount_cents, 0);
  const deductTotal = expenses
    .filter((e) => e.treatment === "deduct")
    .reduce((sum, e) => sum + e.amount_cents, 0);

  // U5: this count-only read carried no error binding at all — a failed
  // read and "nothing to review" both collapsed to `count ?? 0`, silently
  // hiding the "Imported transactions to review" nudge on the one queue
  // whose entire point is that nothing sits unreviewed.
  const unreviewedCountError = Boolean(unreviewedCount.error);
  const unreviewedTransactions = unreviewedCount.count ?? 0;

  const filterLabel =
    clientFilter === null
      ? null
      : clientFilter === NO_CLIENT_FILTER
        ? "No client"
        : clientNames.get(clientFilter) ?? "Unknown client";

  /**
   * A /expenses link that sets or clears the client filter. Link-based
   * chips, no client JS, same idiom as trips/page.tsx: re-clicking the
   * active choice is how it clears.
   */
  const clientFilterHref = (next: string | null) =>
    next === null ? "/expenses" : `/expenses?client=${next}`;

  const queueRows: QueueRow[] = unassigned.map((expense) => ({
    id: expense.id,
    label: `${categoryLabels[expense.category] ?? "Other"}${
      expense.vendor ? ` · ${expense.vendor}` : ""
    }`,
    detail: `${formatDate(expense.incurred_on)} · ${formatCents(expense.amount_cents)}`,
    tripId: expense.trip_id,
  }));

  return (
    <LPageShell
      title="Expenses"
      subtitle={
        error
          ? "Couldn't load your expenses."
          : `${filterLabel ? `${filterLabel} · ` : ""}${formatCents(
              rebillTotal
            )} to rebill · ${formatCents(deductTotal)} deductible${
              unassigned.length
                ? ` · ${formatCents(unassignedTotal)} unfiled`
                : ""
            }`
      }
      action={
        <>
          <NextLink href="/expenses/import" className={lButtonClass({ variant: "outline" })}>
            Import statement
          </NextLink>
          <NextLink href="/expenses/mileage" className={lButtonClass({ variant: "outline" })}>
            Mileage log
          </NextLink>
          {/* THE ONE FILLED ACCENT BUTTON on this screen. */}
          <NextLink href="/expenses/new" className={lButtonClass({ variant: "primary" })}>
            Add expense
          </NextLink>
        </>
      }
    >
      {error ? (
        <LCard>
          <LAlert tone="crit" className="flex items-start gap-2">
            <WarningIcon className="mt-0.5 shrink-0 text-crit" />
            <span>{friendlyDbError(error, "expenses.select")}</span>
          </LAlert>
        </LCard>
      ) : (
        <>
          {truncatedExpenses ? (
            <LAlert tone="warn" className="flex items-start gap-2">
              <WarningIcon className="mt-0.5 shrink-0 text-warn" />
              <span>
                {clientFilter
                  ? `Totals above may be partial. This client's costs were picked out of your ${EXPENSES_LIMIT} most recent expenses, and you have more than that.`
                  : `Totals above may be partial. There are more than ${EXPENSES_LIMIT} expenses and only the first ${EXPENSES_LIMIT} were totaled.`}
              </span>
            </LAlert>
          ) : null}

          {/* The lookup that decides whose cost each row is came back
              incomplete. Every figure that depends on it is withheld
              rather than shown wrong: no filter, no Client column. The
              treatment totals above are unaffected -- they never read a
              client. */}
          {!tripClients.ok ? (
            <LAlert tone="crit" className="flex items-start gap-2">
              <WarningIcon className="mt-0.5 shrink-0 text-crit" />
              <span>
                Couldn&rsquo;t work out which client these expenses belong
                to, so the Client column and the client filter are off.
                Every expense is listed. Reload to try again.
              </span>
            </LAlert>
          ) : null}

          {/* Costs by client. A cost reaches a client two ways -- the pilot
              attributed it directly, or it sits on one of that client's
              trips -- and both count here, because a client's cost picture
              that omitted either would be wrong in the direction that
              matters (too low). */}
          {!tripClients.ok ? null : clientsLoadError ? (
            <LAlert tone="warn" className="flex items-start gap-2">
              <WarningIcon className="mt-0.5 shrink-0 text-warn" />
              <span>
                Couldn&rsquo;t load your clients, so you can&rsquo;t filter
                by one right now and the Client column below shows a link
                instead of a name. Reload to try again.
              </span>
            </LAlert>
          ) : clientChoices.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              <NextLink
                href={clientFilterHref(null)}
                className={lButtonClass({
                  variant: clientFilter === null ? "primary" : "outline",
                  size: "sm",
                })}
              >
                Any client
              </NextLink>
              {clientChoices.map((client) => (
                <NextLink
                  key={client.id}
                  href={clientFilterHref(clientFilter === client.id ? null : client.id)}
                  className={lButtonClass({
                    variant: clientFilter === client.id ? "primary" : "outline",
                    size: "sm",
                  })}
                >
                  {client.name}
                </NextLink>
              ))}
              <NextLink
                href={clientFilterHref(
                  clientFilter === NO_CLIENT_FILTER ? null : NO_CLIENT_FILTER
                )}
                className={lButtonClass({
                  variant: clientFilter === NO_CLIENT_FILTER ? "primary" : "outline",
                  size: "sm",
                })}
              >
                No client
              </NextLink>
            </div>
          ) : null}

          {/* A link arrived naming a client this account does not have, or
              naming one while the reads that decide membership were down.
              Showing every expense under a heading that claims one client's
              name would be the wrong kind of quiet. */}
          {filterUnavailable ? (
            <LAlert tone="warn" className="flex items-start gap-2">
              <WarningIcon className="mt-0.5 shrink-0 text-warn" />
              <span>
                {tripClients.ok && !clientsLoadError
                  ? "That link points at a client this account doesn't have, so every expense is shown."
                  : "That client filter couldn't be applied, so every expense is shown."}
              </span>
            </LAlert>
          ) : null}

          {/* U5: a failed count read must not silently look identical to
              "nothing to review" — it used to, because `count ?? 0` cannot
              tell "checked, found none" from "couldn't check" apart. */}
          {unreviewedCountError ? (
            <LAlert tone="warn" className="flex items-start gap-2">
              <WarningIcon className="mt-0.5 shrink-0 text-warn" />
              <span>
                Couldn&rsquo;t check for imported transactions awaiting
                review. This is not a statement that there are none.
                Reload, or check{" "}
                <NextLink href="/expenses/transactions" className="text-accent underline-offset-2 hover:underline">
                  the review queue
                </NextLink>{" "}
                directly.
              </span>
            </LAlert>
          ) : unreviewedTransactions > 0 ? (
            <LCard>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-h3 font-bold">Imported transactions to review</p>
                  <p className="tnum-l text-body-s text-ink-2">
                    {unreviewedTransactions} transaction{unreviewedTransactions === 1 ? "" : "s"} from a bank
                    statement import {unreviewedTransactions === 1 ? "hasn't" : "haven't"} been categorized yet.
                    Nothing here is in your books until you review each one.
                  </p>
                </div>
                <NextLink href="/expenses/transactions" className={lButtonClass({ variant: "outline" })}>
                  Review now
                </NextLink>
              </div>
            </LCard>
          ) : null}

          {queueRows.length > 0 ? (
            <LCard>
              <p className="text-h3 font-bold">Needs filing</p>
              <p className="mb-3 text-body-s text-ink-2">
                {queueRows.length} receipt
                {queueRows.length === 1 ? "" : "s"} that are neither billed
                to a client nor claimed as a deduction.
              </p>
              {/* U5: a failed trips read used to leave every row's Trip
                  picker offering just "No trip" with the Rebill button
                  disabled and no explanation why. */}
              {tripsLoadError ? (
                <LAlert tone="warn" className="mb-3">
                  Couldn&rsquo;t load your trips, so the Trip picker
                  below only offers &ldquo;No trip&rdquo; and
                  Rebill is unavailable. Reload before filing these.
                </LAlert>
              ) : null}
              <UnassignedQueue rows={queueRows} trips={tripOptions} />
            </LCard>
          ) : null}

          <LCard>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-col gap-1">
                <p className="text-h3 font-bold">Mileage</p>
                <p className="text-body-s text-ink-2">
                  {mileageFailed
                    ? "Couldn't load your mileage total."
                    : `${mileageTotalMiles.toFixed(1)} mi logged at the standard mileage rate${
                        mileageTruncated ? " (partial, see the mileage log)" : ""
                      }`}
                </p>
              </div>
              <div className="flex items-center gap-4">
                {!mileageFailed ? (
                  // A rate-less year must never render as a $0.00
                  // deduction — that reads as "your mileage is worth
                  // nothing" to a pilot who logged real drives. Same
                  // "No rate on file" wording as /expenses/mileage's
                  // by-tax-year table, which is the correct handling of
                  // this exact case. A MIXED set (some years priced, some
                  // not) falls through to the total below instead — see
                  // the callout beneath the card for how that case says
                  // so.
                  mileageTotalCents === 0 && milesWithoutRate > 0 ? (
                    <span className="text-body-s text-ink-2">No rate on file</span>
                  ) : (
                    <span className="tnum-l text-figure font-bold tracking-tight">
                      {formatCents(mileageTotalCents)}
                    </span>
                  )
                ) : null}
                <NextLink href="/expenses/mileage" className={lButtonClass({ variant: "outline" })}>
                  Log a drive
                </NextLink>
              </div>
            </div>
            {/* Same wording and shape as /reports/profit-loss's own
                mileageMilesWithoutRate callout — a MIXED set (some tax
                years priced, some not) prints the total above with no
                caveat otherwise, which quietly omits the rate-less
                years' miles from a figure that looks complete. */}
            {!mileageFailed && mileageTotalCents > 0 && milesWithoutRate > 0 ? (
              <LAlert tone="warn" className="mt-3 flex items-start gap-2">
                <WarningIcon className="mt-0.5 shrink-0 text-warn" />
                <span>
                  {`${milesWithoutRate} miles are not in the figure above. There's no IRS standard rate on file for their tax year. Add it in Settings and this recomputes.`}
                </span>
              </LAlert>
            ) : null}
          </LCard>

          <LCard>
            {expenses.length === 0 && clientFilter ? (
              // Filtered to nothing is a third case, distinct from both an
              // empty account and a failed read: the expenses exist, none
              // of them belong to this client.
              <LEmpty
                title={
                  clientFilter === NO_CLIENT_FILTER
                    ? "Every expense is attributed"
                    : "No expenses for this client"
                }
                action={
                  <NextLink href="/expenses" className={lButtonClass({ variant: "outline" })}>
                    Show all expenses
                  </NextLink>
                }
              >
                {clientFilter === NO_CLIENT_FILTER
                  ? "Nothing is sitting against no client at all."
                  : "Nothing here is attributed to them, directly or through one of their trips."}
              </LEmpty>
            ) : expenses.length === 0 ? (
              <LEmpty
                title="No expenses yet"
                action={
                  <NextLink href="/expenses/new" className={lButtonClass({ variant: "primary" })}>
                    Add your first expense
                  </NextLink>
                }
                // No "import a statement" secondary action here on purpose:
                // bank import is Pro-gated (FEATURES.bank_import), and an
                // empty state that offers a Solo pilot a button straight to
                // the upgrade wall is an upsell wearing a first-run
                // instruction's clothes.
              >
                Capture the receipt once and tag it rebill or deduct. It files
                itself against the trip from there.
              </LEmpty>
            ) : (
              <LTable>
                <caption>
                  <span className="sr-only">Expenses</span>
                </caption>
                <thead>
                  <tr>
                    <LTh>Date</LTh>
                    <LTh>Category</LTh>
                    <LTh>Vendor</LTh>
                    <LTh>Trip</LTh>
                    {tripClients.ok ? <LTh>Client</LTh> : null}
                    <LTh numeric>Amount</LTh>
                    <LTh>Treatment</LTh>
                    <LTh>Receipt</LTh>
                  </tr>
                </thead>
                <tbody>
                  {expenses.map((expense) => {
                    const badge = TREATMENT_BADGE[expense.treatment] ?? TREATMENT_FALLBACK;
                    const client = clientOf(expense);
                    return (
                      <tr key={expense.id}>
                        <th
                          scope="row"
                          className="border-b border-hair px-3 py-2.5 text-left align-baseline font-medium text-ink first:pl-0 last:pr-0"
                        >
                          <NextLink
                            href={`/expenses/${expense.id}`}
                            className="text-accent hover:underline"
                          >
                            {formatDate(expense.incurred_on)}
                          </NextLink>
                        </th>
                        <LTd>
                          <span className="text-ink-2">{categoryLabels[expense.category] ?? "Other"}</span>
                        </LTd>
                        <LTd>
                          <span className="text-ink-2">{expense.vendor ?? "—"}</span>
                        </LTd>
                        <LTd>
                          {expense.trip_id ? (
                            <NextLink
                              href={`/trips/${expense.trip_id}`}
                              className="text-ink-2 hover:underline"
                            >
                              {tripLabels.get(expense.trip_id) ?? "View trip"}
                            </NextLink>
                          ) : (
                            <span className="text-ink-3">—</span>
                          )}
                        </LTd>
                        {client === null ? null : (
                          <LTd>
                            {client.clientId === null ? (
                              <span className="text-ink-3">No client</span>
                            ) : (
                              <NextLink
                                href={`/clients/${client.clientId}`}
                                className="text-ink-2 hover:underline"
                              >
                                {clientsLoadError
                                  ? "View client"
                                  : clientNames.get(client.clientId) ?? "View client"}
                              </NextLink>
                            )}
                            {/* Says which of the two answers this is. "Via
                                trip" is not the pilot's own attribution and
                                will follow the trip if its client changes. */}
                            {client.source === "trip" ? (
                              <div className="text-caption text-ink-3">Via trip</div>
                            ) : null}
                          </LTd>
                        )}
                        <LTd numeric>
                          <span className="font-medium">{formatCents(expense.amount_cents)}</span>
                        </LTd>
                        <LTd>
                          <LPill tone={badge.tone}>{badge.label}</LPill>
                        </LTd>
                        <LTd>
                          <span className={expense.receipt_path ? "text-caption text-ink-3" : "text-caption text-crit"}>
                            {expense.receipt_path ? "Attached" : "Missing"}
                          </span>
                        </LTd>
                      </tr>
                    );
                  })}
                </tbody>
              </LTable>
            )}
          </LCard>
        </>
      )}
    </LPageShell>
  );
}

/* ── Inline icon ───────────────────────────────────────────────────────
 * Ledger screens carry no icon dependency — see components/ledger's own
 * header rule. Defined once here, aria-hidden, stroke="currentColor" so it
 * inherits its caller's tone utility (text-warn, text-crit). Same shape as
 * overview/page.tsx's own WarningIcon. */
function WarningIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <path d="M8 2 14.25 13H1.75Z" />
      <path d="M8 6.25v3" />
      <circle cx="8" cy="11.25" r="0.4" fill="currentColor" stroke="none" />
    </svg>
  );
}

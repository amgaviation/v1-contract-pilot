import NextLink from "next/link";
import { LAlert, LCard, LEmpty, LPill, LTable, LTd, LTh, lButtonClass } from "@/components/ledger";
import { LPageShell } from "@/components/ledger/page-shell";

import { createClient } from "@/lib/supabase/server";
import { requireAccount } from "@/lib/supabase/account";
import { formatCents, formatDateRange } from "@/lib/format";
import { friendlyDbError } from "@/lib/db-errors";
import MarkFlownButton from "./mark-flown-button";

export const metadata = { title: "Trips" };

type TripListRow = {
  id: string;
  client_id: string | null;
  trip_kind: string;
  status: string;
  starts_on: string;
  ends_on: string;
  aircraft_ident: string | null;
  day_rate_cents: number;
  day_count: number;
  travel_day_count: number | null;
  travel_day_rate_cents: number | null;
  billing_state: string;
};

/**
 * pilot.trip_list_value's row shape
 * (supabase/migrations/20260814094000_trip_list_value.sql) — one priced row
 * per trip, every status and billing_state, computed in SQL so the Value
 * column can never be truncated by the Data API's 1000-row cap the way a
 * raw `.in("trip_id", tripIds)` read over trip_days could. numeric columns
 * arrive over PostgREST as strings, same as every other RPC in this
 * codebase that returns one (see overview/page.tsx's `Number(row.*)`
 * reads) — `billable_days` is additionally null whenever `has_day_rows` is
 * false, since it is the GRID-derived count only; the scalar fallback is
 * trips.day_count, already on hand from the query above.
 */
type TripListValueRow = {
  trip_id: string;
  has_day_rows: boolean;
  billable_days: number | string | null;
  day_value_cents: number | string;
};

/**
 * A grid-derived day count for display — same one-decimal-place rule as
 * pilot.trip_days.quantity's own scale (numeric(3,1)): a whole number
 * renders without a trailing ".0" (a count, not a measurement), a half day
 * keeps its ".5" rather than getting rounded away in the pilot's favor.
 */
function formatDayCount(days: number): string {
  const rounded = Math.round(days * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

type BadgeInfo = { tone: "neutral" | "accent" | "good" | "warn" | "crit"; label: string };

const STATUS_FALLBACK: BadgeInfo = { tone: "neutral", label: "Scheduled" };
const STATUS_BADGE: Record<string, BadgeInfo> = {
  scheduled: STATUS_FALLBACK,
  in_progress: { tone: "accent", label: "In progress" },
  completed: { tone: "good", label: "Completed" },
  canceled: { tone: "neutral", label: "Canceled" },
  // 20260814094000: warn reads as "needs a decision" — distinct from the
  // neutral of Scheduled/Canceled (settled either way) and from the accent/
  // good of active/confirmed work.
  hold: { tone: "warn", label: "Hold" },
};

const BILLING_FALLBACK: BadgeInfo = { tone: "warn", label: "Unbilled" };
const BILLING_BADGE: Record<string, BadgeInfo> = {
  unbilled: BILLING_FALLBACK,
  invoiced: { tone: "accent", label: "Invoiced" },
  paid: { tone: "good", label: "Paid" },
  written_off: { tone: "neutral", label: "Written off" },
};

/**
 * The Supabase Data API clamps every response to 1000 rows and truncates
 * without an error. Asking for exactly that many and comparing the
 * returned length is the only way to detect it — a limit ABOVE the cap
 * makes the check unfireable, which is how the tax reports came to hand a
 * CPA a figure short by a sixth.
 */
const TRIP_LIMIT = 1000;

const STATUS_FILTERS = ["scheduled", "in_progress", "completed", "canceled", "hold"] as const;
const BILLING_FILTERS = ["unbilled", "invoiced", "paid", "written_off"] as const;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Builds a /trips link that keeps every OTHER active filter and sets (or,
 * for `null`, clears) the one named here — so picking "Unbilled" from the
 * billing row doesn't silently drop a status filter or a client deep link
 * the pilot arrived with, and clicking the already-active choice again is
 * exactly how a filter is cleared.
 */
function tripsFilterHref(
  current: { client?: string; status?: string; billing_state?: string },
  patch: Partial<{ client: string | null; status: string | null; billing_state: string | null }>
): string {
  const merged = { ...current, ...patch };
  const params = new URLSearchParams();
  if (merged.client) params.set("client", merged.client);
  if (merged.status) params.set("status", merged.status);
  if (merged.billing_state) params.set("billing_state", merged.billing_state);
  const qs = params.toString();
  return qs ? `/trips?${qs}` : "/trips";
}

export default async function TripsPage({
  searchParams,
}: {
  // gap S: client/status/billing_state narrowing, and the ?client= deep
  // link clients/[id]/page.tsx's own comment names as missing — that page
  // inlines its own 10-row "Unbilled trips" list specifically because this
  // one couldn't be filtered to a client before now.
  searchParams: Promise<{ client?: string; status?: string; billing_state?: string }>;
}) {
  const { account } = await requireAccount("/trips");
  const params = await searchParams;

  // Unrecognized values are ignored rather than rejected — a stale or
  // hand-edited query string should degrade to "show everything", not a
  // page error, on a screen with no form validation to fail against.
  const clientFilter = params.client && UUID_RE.test(params.client) ? params.client : null;
  const statusFilter =
    params.status && (STATUS_FILTERS as readonly string[]).includes(params.status)
      ? params.status
      : null;
  const billingFilter =
    params.billing_state &&
    (BILLING_FILTERS as readonly string[]).includes(params.billing_state)
      ? params.billing_state
      : null;

  const supabase = await createClient();
  let tripsQuery = supabase
    .from("trips")
    .select(
      "id, client_id, trip_kind, status, starts_on, ends_on, aircraft_ident, day_rate_cents, day_count, travel_day_count, travel_day_rate_cents, billing_state"
    )
    .order("starts_on", { ascending: false })
    .limit(TRIP_LIMIT);
  if (clientFilter) tripsQuery = tripsQuery.eq("client_id", clientFilter);
  if (statusFilter) tripsQuery = tripsQuery.eq("status", statusFilter);
  if (billingFilter) tripsQuery = tripsQuery.eq("billing_state", billingFilter);

  const [{ data: tripData, error }, { data: clientData, error: clientError }] = await Promise.all([
    tripsQuery,
    supabase.from("clients").select("id, name").limit(TRIP_LIMIT),
  ]);

  const trips = (tripData ?? []) as TripListRow[];
  // The Data API clamps a response to 1000 rows and truncates SILENTLY —
  // no error, no flag. Asking for exactly the cap and comparing lengths is
  // the only way to know it happened. A career pilot who quietly stopped
  // seeing their oldest trips would have no reason to suspect the list
  // was incomplete.
  const tripsTruncated = trips.length === TRIP_LIMIT;
  // Resolved in memory rather than as a PostgREST embed: the embed's
  // return type resolves to `never` against the hand-authored types file
  // (same reason account.ts uses two queries), and a pilot's client list
  // is small enough that the join is free.
  const clientNames = new Map(
    ((clientData ?? []) as { id: string; name: string }[]).map((c) => [c.id, c.name])
  );
  // A failed clients read is not "this client has no name" — without this
  // flag every Client cell silently fell back to "—", indistinguishable
  // from a trip with no client_id, and nothing on screen said the lookup
  // had failed.
  const clientNamesError = Boolean(clientError);

  // P2: trip pricing and grid-derived day counts for every trip on this
  // page, computed once in SQL (pilot.trip_list_value) rather than read as
  // raw trip_days and priced here in JavaScript. The old approach read
  // every listed trip's day rows with a single `.in("trip_id", tripIds)`
  // capped at 1000 rows TOTAL across the whole page — a working pilot
  // accrues roughly 300-400 day rows a year, so by year three that cap hit
  // on every visit and the Value column was gone for good, not
  // transiently. The SQL function returns one row per trip regardless of
  // how many trip_days rows back it, so that class of truncation cannot
  // recur here — see the migration's header for the full argument and the
  // arithmetic it mirrors from lib/trip-value.ts.
  const tripValueByTrip = new Map<
    string,
    { hasDayRows: boolean; billableDays: number | null; valueCents: number }
  >();
  // Same H8 reasoning as before: a failed read must not throw and 500 the
  // whole page (the primary `trips` query above degrades to an alert, not
  // a crash), and on failure the Value column is hidden rather than risk
  // showing a wrong number.
  let dayGridError = false;
  if (trips.length > 0) {
    // `as unknown as {...}`: pilot.trip_list_value has no entry in
    // lib/supabase/database.types.ts — that hand-authored file sits
    // outside this fix's file allowlist (flagged for its owner), so this
    // casts the rpc() CALL itself rather than only its args, the way every
    // other rpc() site in this codebase casts once its function IS listed
    // there. The function is real (20260814094000_trip_list_value.sql);
    // only the local TypeScript description of it is missing upstream.
    const { data: valueData, error: valueError } = await (
      supabase as unknown as {
        rpc: (
          fn: string,
          args: Record<string, unknown>
        ) => Promise<{
          data: TripListValueRow[] | null;
          error: { message: string } | null;
        }>;
      }
    ).rpc("trip_list_value", { target_account_id: account.id });

    if (valueError) {
      dayGridError = true;
    } else {
      for (const row of valueData ?? []) {
        tripValueByTrip.set(row.trip_id, {
          hasDayRows: row.has_day_rows,
          billableDays: row.billable_days === null ? null : Number(row.billable_days),
          valueCents: Number(row.day_value_cents),
        });
      }
    }
  }

  const unbilled = trips.filter(
    (trip) => trip.billing_state === "unbilled" && trip.status === "completed"
  ).length;

  const filtersActive = Boolean(clientFilter || statusFilter || billingFilter);
  const filterHrefBase = { client: clientFilter ?? undefined, status: statusFilter ?? undefined, billing_state: billingFilter ?? undefined };

  return (
    <LPageShell
      title="Trips"
      subtitle={
        error
          ? "Couldn't load your trips."
          : `${trips.length} trip${trips.length === 1 ? "" : "s"}${
              filtersActive ? " matching these filters" : ""
            }${unbilled ? ` · ${unbilled} flown but not yet invoiced` : ""}`
      }
      action={
        <NextLink href="/trips/new" className={lButtonClass({ variant: "primary" })}>
          Log a trip
        </NextLink>
      }
    >
      {tripsTruncated ? (
        <LAlert tone="warn">
          {`Showing your ${TRIP_LIMIT} most recent trips. Older ones aren't on this
            screen, but they're still in your account, and your invoices and reports
            still count them.`}
        </LAlert>
      ) : null}

      {/* gap S: status and billing filters, plus the ?client= deep link
          clients/[id]/page.tsx now sends its "Showing the 10 most recent"
          overflow notice to. Link-based chips (no client JS), same idiom
          as invoices/page.tsx's FILTERS row — each link keeps every OTHER
          active filter via tripsFilterHref, and re-clicking the active
          choice clears just that one. The active state is a state
          indicator, not a second call to action, so it's fine alongside
          the one filled "Log a trip" button above. */}
      <div className="flex flex-col gap-2">
        {clientFilter ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-body-s text-ink-2">
              Client:{" "}
              <span className="font-medium text-ink">
                {clientNames.get(clientFilter) ?? "Unknown client"}
              </span>
            </span>
            <NextLink
              href={tripsFilterHref(filterHrefBase, { client: null })}
              className="text-body-s text-accent hover:underline"
            >
              Clear
            </NextLink>
          </div>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <NextLink
            href={tripsFilterHref(filterHrefBase, { status: null })}
            className={lButtonClass({ variant: statusFilter === null ? "primary" : "outline", size: "sm" })}
          >
            Any status
          </NextLink>
          {STATUS_FILTERS.map((s) => (
            <NextLink
              key={s}
              href={tripsFilterHref(filterHrefBase, {
                status: statusFilter === s ? null : s,
              })}
              className={lButtonClass({ variant: statusFilter === s ? "primary" : "outline", size: "sm" })}
            >
              {(STATUS_BADGE[s] ?? STATUS_FALLBACK).label}
            </NextLink>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          <NextLink
            href={tripsFilterHref(filterHrefBase, { billing_state: null })}
            className={lButtonClass({ variant: billingFilter === null ? "primary" : "outline", size: "sm" })}
          >
            Any billing
          </NextLink>
          {BILLING_FILTERS.map((b) => (
            <NextLink
              key={b}
              href={tripsFilterHref(filterHrefBase, {
                billing_state: billingFilter === b ? null : b,
              })}
              className={lButtonClass({ variant: billingFilter === b ? "primary" : "outline", size: "sm" })}
            >
              {(BILLING_BADGE[b] ?? BILLING_FALLBACK).label}
            </NextLink>
          ))}
        </div>
      </div>

      <LCard>
        {error ? (
          <LAlert tone="crit">{friendlyDbError(error, "trips.select")}</LAlert>
        ) : trips.length === 0 ? (
          // The shared primitive (components/ledger's LEmpty). The words
          // stay here — they are about trips — and only the shape is
          // shared. The error branch above deliberately does NOT route
          // through it: "couldn't load" is not "you have none". Filtered-
          // to-nothing is a third case, distinct from both — the account
          // has trips, this combination of filters just doesn't match any
          // of them.
          filtersActive ? (
            <LEmpty
              title="No trips match these filters"
              action={
                <NextLink href="/trips" className={lButtonClass({ variant: "outline" })}>
                  Clear filters
                </NextLink>
              }
            >
              Nothing in your account matches this combination right now.
            </LEmpty>
          ) : (
            <LEmpty
              title="No trips yet"
              action={
                <NextLink href="/trips/new" className={lButtonClass({ variant: "primary" })}>
                  Log your first trip
                </NextLink>
              }
            >
              Start with the trip you flew: its legs feed your logbook drafts,
              its days feed the invoice lines, and the receipts you scan attach
              to it.
            </LEmpty>
          )
        ) : (
          <>
            {clientNamesError ? (
              <LAlert tone="warn" className="mb-3">
                Couldn&rsquo;t load client names, so the Client column
                below reads &ldquo;—&rdquo; for trips that do have a
                client on file.
              </LAlert>
            ) : null}
            {dayGridError ? (
              <LAlert tone="warn" className="mb-3">
                Couldn&rsquo;t load day grids for these trips, so the Value
                column is hidden rather than risk showing a wrong number.
              </LAlert>
            ) : null}
            <LTable>
              <caption>
                <span className="sr-only">Trips</span>
              </caption>
              <thead>
                <tr>
                  <LTh>Dates</LTh>
                  <LTh>Client</LTh>
                  <LTh>Aircraft</LTh>
                  <LTh numeric>Days</LTh>
                  {dayGridError ? null : <LTh numeric>Value</LTh>}
                  <LTh>Status</LTh>
                  <LTh>Billing</LTh>
                </tr>
              </thead>
              <tbody>
                {trips.map((trip) => {
                  const status = STATUS_BADGE[trip.status] ?? STATUS_FALLBACK;
                  const billing =
                    BILLING_BADGE[trip.billing_state] ?? BILLING_FALLBACK;
                  return (
                    <tr key={trip.id}>
                      <th
                        scope="row"
                        className="border-b border-hair px-3 py-2.5 text-left align-baseline font-medium text-ink first:pl-0 last:pr-0"
                      >
                        <NextLink
                          href={`/trips/${trip.id}`}
                          className="text-accent hover:underline"
                        >
                          {formatDateRange(trip.starts_on, trip.ends_on)}
                        </NextLink>
                      </th>
                      <LTd>
                        <span className="text-ink-2">
                          {trip.client_id
                            ? clientNames.get(trip.client_id) ?? "—"
                            : "No client"}
                        </span>
                      </LTd>
                      <LTd>
                        <span className="text-ink-2">{trip.aircraft_ident ?? "—"}</span>
                      </LTd>
                      <LTd numeric>
                        {/* P2: once the grid has rows, it is what bills
                            (see the Value cell below) and it must also be
                            what this COUNTS — printing a grid-priced
                            Value next to a day count still read from the
                            legacy scalar columns is the same
                            "two sources for one number" defect this
                            product eradicated for money, just for days.
                            Falls back to the scalar day_count only when
                            the trip truly has no day rows yet. */}
                        {tripValueByTrip.get(trip.id)?.hasDayRows
                          ? formatDayCount(tripValueByTrip.get(trip.id)!.billableDays ?? 0)
                          : trip.day_count}
                      </LTd>
                      {dayGridError ? null : (
                        <LTd numeric>
                          <span className="font-medium">
                            {formatCents(tripValueByTrip.get(trip.id)?.valueCents ?? 0)}
                          </span>
                        </LTd>
                      )}
                      <LTd>
                        {/* The badge and the way to change it, together.
                            A pilot scanning a month of flying can mark
                            each trip flown from here without opening it —
                            which is the difference between billing a
                            month in a minute and not billing it at all. */}
                        <div className="flex flex-wrap items-center gap-2">
                          <LPill tone={status.tone}>{status.label}</LPill>
                          {trip.status === "scheduled" || trip.status === "in_progress" ? (
                            <MarkFlownButton id={trip.id} size="sm" variant="outline" />
                          ) : null}
                        </div>
                      </LTd>
                      <LTd>
                        <LPill tone={billing.tone}>{billing.label}</LPill>
                      </LTd>
                    </tr>
                  );
                })}
              </tbody>
            </LTable>
          </>
        )}
      </LCard>
    </LPageShell>
  );
}

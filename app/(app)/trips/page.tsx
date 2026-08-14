import NextLink from "next/link";
import {
  Badge,
  Button,
  Callout,
  Card,
  Flex,
  Link as RadixLink,
  Table,
  Text,
} from "@/components/ui";

import { createClient } from "@/lib/supabase/server";
import { requireAccount } from "@/lib/supabase/account";
import { formatCents, formatDateRange } from "@/lib/format";
import { friendlyDbError } from "@/lib/db-errors";
import EmptyState from "@/components/ui/empty-state";
import PageShell from "../page-shell";
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

type BadgeInfo = { color: "gray" | "blue" | "green" | "red" | "amber"; label: string };

const STATUS_FALLBACK: BadgeInfo = { color: "gray", label: "Scheduled" };
const STATUS_BADGE: Record<string, BadgeInfo> = {
  scheduled: STATUS_FALLBACK,
  in_progress: { color: "blue", label: "In progress" },
  completed: { color: "green", label: "Completed" },
  canceled: { color: "gray", label: "Canceled" },
  // 20260814094000: amber reads as "needs a decision" — distinct from the
  // gray of Scheduled/Canceled (settled either way) and from the blue/
  // green of active/confirmed work.
  hold: { color: "amber", label: "Hold" },
};

const BILLING_FALLBACK: BadgeInfo = { color: "amber", label: "Unbilled" };
const BILLING_BADGE: Record<string, BadgeInfo> = {
  unbilled: BILLING_FALLBACK,
  invoiced: { color: "blue", label: "Invoiced" },
  paid: { color: "green", label: "Paid" },
  written_off: { color: "gray", label: "Written off" },
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
  // whole page (the primary `trips` query above degrades to a Callout, not
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
    <PageShell
      title="Trips"
      subtitle={
        error
          ? "Couldn't load your trips."
          : `${trips.length} trip${trips.length === 1 ? "" : "s"}${
              filtersActive ? " matching these filters" : ""
            }${unbilled ? ` · ${unbilled} flown but not yet invoiced` : ""}`
      }
      action={
        <Button asChild>
          <NextLink href="/trips/new">Log a trip</NextLink>
        </Button>
      }
    >
      {tripsTruncated ? (
        <Callout.Root color="amber" mb="3">
          <Callout.Text>
            {`Showing your ${TRIP_LIMIT} most recent trips. Older ones aren't on this
              screen — they're still in your account, and your invoices and reports
              still count them.`}
          </Callout.Text>
        </Callout.Root>
      ) : null}

      {/* gap S: status and billing filters, plus the ?client= deep link
          clients/[id]/page.tsx now sends its "Showing the 10 most recent"
          overflow notice to. Link-based chips (no client JS), same idiom
          as invoices/page.tsx's FILTERS row — each link keeps every OTHER
          active filter via tripsFilterHref, and re-clicking the active
          choice clears just that one. */}
      <Flex direction="column" gap="2" mb="3">
        {clientFilter ? (
          <Flex gap="2" align="center" wrap="wrap">
            <Text size="2" color="gray">
              Client:{" "}
              <Text as="span" weight="medium" color="gray">
                {clientNames.get(clientFilter) ?? "Unknown client"}
              </Text>
            </Text>
            <RadixLink asChild size="1">
              <NextLink href={tripsFilterHref(filterHrefBase, { client: null })}>
                Clear
              </NextLink>
            </RadixLink>
          </Flex>
        ) : null}
        <Flex gap="2" wrap="wrap">
          <Button asChild size="1" variant={statusFilter === null ? "solid" : "soft"}>
            <NextLink href={tripsFilterHref(filterHrefBase, { status: null })}>
              Any status
            </NextLink>
          </Button>
          {STATUS_FILTERS.map((s) => (
            <Button key={s} asChild size="1" variant={statusFilter === s ? "solid" : "soft"}>
              <NextLink
                href={tripsFilterHref(filterHrefBase, {
                  status: statusFilter === s ? null : s,
                })}
              >
                {(STATUS_BADGE[s] ?? STATUS_FALLBACK).label}
              </NextLink>
            </Button>
          ))}
        </Flex>
        <Flex gap="2" wrap="wrap">
          <Button asChild size="1" variant={billingFilter === null ? "solid" : "soft"}>
            <NextLink href={tripsFilterHref(filterHrefBase, { billing_state: null })}>
              Any billing
            </NextLink>
          </Button>
          {BILLING_FILTERS.map((b) => (
            <Button key={b} asChild size="1" variant={billingFilter === b ? "solid" : "soft"}>
              <NextLink
                href={tripsFilterHref(filterHrefBase, {
                  billing_state: billingFilter === b ? null : b,
                })}
              >
                {(BILLING_BADGE[b] ?? BILLING_FALLBACK).label}
              </NextLink>
            </Button>
          ))}
        </Flex>
      </Flex>

      <Card>
        {error ? (
          <Callout.Root color="red" m="3">
            <Callout.Text>{friendlyDbError(error, "trips.select")}</Callout.Text>
          </Callout.Root>
        ) : trips.length === 0 ? (
          // The shared primitive (components/ui/empty-state.tsx). The words
          // stay here — they are about trips — and only the shape is shared.
          // The error branch above deliberately does NOT route through it:
          // "couldn't load" is not "you have none". Filtered-to-nothing is
          // a third case, distinct from both — the account has trips, this
          // combination of filters just doesn't match any of them.
          filtersActive ? (
            <EmptyState
              title="No trips match these filters"
              action={
                <Button asChild variant="soft">
                  <NextLink href="/trips">Clear filters</NextLink>
                </Button>
              }
            >
              Nothing in your account matches this combination right now.
            </EmptyState>
          ) : (
            <EmptyState
              title="No trips yet"
              action={
                <Button asChild>
                  <NextLink href="/trips/new">Log your first trip</NextLink>
                </Button>
              }
            >
              Log the trip once. Its legs feed your logbook, its days feed the
              invoice, and its expenses file themselves against it.
            </EmptyState>
          )
        ) : (
          <>
            {clientNamesError ? (
              <Callout.Root color="amber" m="3">
                <Callout.Text>
                  Couldn&rsquo;t load client names, so the Client column
                  below reads &ldquo;—&rdquo; for trips that do have a
                  client on file.
                </Callout.Text>
              </Callout.Root>
            ) : null}
            {dayGridError ? (
              <Callout.Root color="amber" m="3">
                <Callout.Text>
                  Couldn&rsquo;t load day grids for these trips, so the Value
                  column is hidden rather than risk showing a wrong number.
                </Callout.Text>
              </Callout.Root>
            ) : null}
            <Table.Root>
              <Table.Header>
                <Table.Row>
                  <Table.ColumnHeaderCell>Dates</Table.ColumnHeaderCell>
                  <Table.ColumnHeaderCell>Client</Table.ColumnHeaderCell>
                  <Table.ColumnHeaderCell>Aircraft</Table.ColumnHeaderCell>
                  <Table.ColumnHeaderCell justify="end">Days</Table.ColumnHeaderCell>
                  {dayGridError ? null : (
                    <Table.ColumnHeaderCell justify="end">Value</Table.ColumnHeaderCell>
                  )}
                  <Table.ColumnHeaderCell>Status</Table.ColumnHeaderCell>
                  <Table.ColumnHeaderCell>Billing</Table.ColumnHeaderCell>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {trips.map((trip) => {
                  const status = STATUS_BADGE[trip.status] ?? STATUS_FALLBACK;
                  const billing =
                    BILLING_BADGE[trip.billing_state] ?? BILLING_FALLBACK;
                  return (
                    <Table.Row key={trip.id}>
                      <Table.RowHeaderCell>
                        <RadixLink asChild weight="medium">
                          <NextLink href={`/trips/${trip.id}`}>
                            {formatDateRange(trip.starts_on, trip.ends_on)}
                          </NextLink>
                        </RadixLink>
                      </Table.RowHeaderCell>
                      <Table.Cell>
                        <Text size="2" color="gray">
                          {trip.client_id
                            ? clientNames.get(trip.client_id) ?? "—"
                            : "No client"}
                        </Text>
                      </Table.Cell>
                      <Table.Cell>
                        <Text size="2" color="gray">
                          {trip.aircraft_ident ?? "—"}
                        </Text>
                      </Table.Cell>
                      <Table.Cell justify="end">
                        <Text size="2" className="tnum">
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
                        </Text>
                      </Table.Cell>
                      {dayGridError ? null : (
                        <Table.Cell justify="end">
                          <Text size="2" weight="medium" className="tnum">
                            {formatCents(tripValueByTrip.get(trip.id)?.valueCents ?? 0)}
                          </Text>
                        </Table.Cell>
                      )}
                      <Table.Cell>
                        {/* The badge and the way to change it, together.
                            A pilot scanning a month of flying can mark
                            each trip flown from here without opening it —
                            which is the difference between billing a
                            month in a minute and not billing it at all. */}
                        <Flex gap="2" align="center" wrap="wrap">
                          <Badge color={status.color}>{status.label}</Badge>
                          {trip.status === "scheduled" || trip.status === "in_progress" ? (
                            <MarkFlownButton id={trip.id} size="1" variant="soft" />
                          ) : null}
                        </Flex>
                      </Table.Cell>
                      <Table.Cell>
                        <Badge color={billing.color}>{billing.label}</Badge>
                      </Table.Cell>
                    </Table.Row>
                  );
                })}
              </Table.Body>
            </Table.Root>
          </>
        )}
      </Card>
    </PageShell>
  );
}

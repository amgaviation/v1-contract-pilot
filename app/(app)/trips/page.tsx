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
import { tripValueCents, type TripDayValueRow } from "@/lib/trip-value";
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

type BadgeInfo = { color: "gray" | "blue" | "green" | "red" | "amber"; label: string };

const STATUS_FALLBACK: BadgeInfo = { color: "gray", label: "Scheduled" };
const STATUS_BADGE: Record<string, BadgeInfo> = {
  scheduled: STATUS_FALLBACK,
  in_progress: { color: "blue", label: "In progress" },
  completed: { color: "green", label: "Completed" },
  canceled: { color: "gray", label: "Canceled" },
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
const DAY_ROW_LIMIT = 1000;

export default async function TripsPage() {
  await requireAccount("/trips");

  const supabase = await createClient();
  const [{ data: tripData, error }, { data: clientData, error: clientError }] = await Promise.all([
    supabase
      .from("trips")
      .select(
        "id, client_id, trip_kind, status, starts_on, ends_on, aircraft_ident, day_rate_cents, day_count, travel_day_count, travel_day_rate_cents, billing_state"
      )
      .order("starts_on", { ascending: false })
      .limit(TRIP_LIMIT),
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

  // F3: day rows for exactly the trips just listed, plus the account's
  // day-type taxonomy to know which of them are billable. Skipped
  // entirely when there are no trips — an empty `.in()` list is a query
  // with nothing to answer.
  const dayRowsByTrip = new Map<string, TripDayValueRow[]>();
  const billableByDayType = new Map<string, boolean>();
  const tripIds = trips.map((t) => t.id);
  // H8: this read used to throw and 500 the whole page on a transient
  // failure — harsher than the primary `trips` query below, which
  // degrades to a Callout instead. Can't safely tell which trips have day
  // rows without both queries succeeding (guessing "no day rows, use the
  // scalar fallback" could understate a trip that actually bills more
  // through its grid), so on failure the Value column itself is hidden
  // rather than risk showing a wrong number.
  let dayGridError = false;
  if (tripIds.length > 0) {
    const [{ data: dayRowsData, error: dayRowsError }, { data: dayTypeData, error: dayTypeError }] =
      await Promise.all([
        supabase
          .from("trip_days")
          .select("trip_id, day_type_id, rate_cents, quantity, units")
          .in("trip_id", tripIds)
          .limit(DAY_ROW_LIMIT),
        supabase.from("day_types").select("id, billable").limit(DAY_ROW_LIMIT),
      ]);

    // A TRUNCATED day-grid read is exactly as dangerous as a failed one,
    // and used to be invisible: the missing rows would simply not be
    // counted, so the Value column would show a number lower than the
    // trip actually bills. Same treatment as an error — hide the column
    // rather than print a wrong figure.
    const dayRowsTruncated = (dayRowsData?.length ?? 0) === DAY_ROW_LIMIT;
    if (dayRowsError || dayTypeError || dayRowsTruncated) {
      dayGridError = true;
    } else {
      for (const row of (dayRowsData ?? []) as (TripDayValueRow & { trip_id: string })[]) {
        const forTrip = dayRowsByTrip.get(row.trip_id) ?? [];
        forTrip.push(row);
        dayRowsByTrip.set(row.trip_id, forTrip);
      }
      for (const t of (dayTypeData ?? []) as { id: string; billable: boolean }[]) {
        billableByDayType.set(t.id, t.billable);
      }
    }
  }

  const unbilled = trips.filter(
    (trip) => trip.billing_state === "unbilled" && trip.status === "completed"
  ).length;

  return (
    <PageShell
      title="Trips"
      subtitle={
        error
          ? "Couldn't load your trips."
          : `${trips.length} trip${trips.length === 1 ? "" : "s"}${
              unbilled ? ` · ${unbilled} flown but not yet invoiced` : ""
            }`
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
      <Card>
        {error ? (
          <Callout.Root color="red" m="3">
            <Callout.Text>{friendlyDbError(error, "trips.select")}</Callout.Text>
          </Callout.Root>
        ) : trips.length === 0 ? (
          // The shared primitive (components/ui/empty-state.tsx). The words
          // stay here — they are about trips — and only the shape is shared.
          // The error branch above deliberately does NOT route through it:
          // "couldn't load" is not "you have none".
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
                          {trip.day_count}
                        </Text>
                      </Table.Cell>
                      {dayGridError ? null : (
                        <Table.Cell justify="end">
                          <Text size="2" weight="medium" className="tnum">
                            {formatCents(
                              tripValueCents(trip, dayRowsByTrip.get(trip.id), billableByDayType)
                            )}
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

import NextLink from "next/link";
import {
  Badge,
  Button,
  Callout,
  Card,
  Flex,
  Heading,
  Link as RadixLink,
  Table,
  Text,
} from "@/components/ui";

import { createClient } from "@/lib/supabase/server";
import { requireAccount } from "@/lib/supabase/account";
import { formatCents, formatDateRange } from "@/lib/format";
import { friendlyDbError } from "@/lib/db-errors";
import { tripValueCents, type TripDayValueRow } from "@/lib/trip-value";
import PageShell from "../page-shell";

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

export default async function TripsPage() {
  await requireAccount("/trips");

  const supabase = await createClient();
  const [{ data: tripData, error }, { data: clientData }] = await Promise.all([
    supabase
      .from("trips")
      .select(
        "id, client_id, trip_kind, status, starts_on, ends_on, aircraft_ident, day_rate_cents, day_count, travel_day_count, travel_day_rate_cents, billing_state"
      )
      .order("starts_on", { ascending: false }),
    supabase.from("clients").select("id, name"),
  ]);

  const trips = (tripData ?? []) as TripListRow[];
  // Resolved in memory rather than as a PostgREST embed: the embed's
  // return type resolves to `never` against the hand-authored types file
  // (same reason account.ts uses two queries), and a pilot's client list
  // is small enough that the join is free.
  const clientNames = new Map(
    ((clientData ?? []) as { id: string; name: string }[]).map((c) => [c.id, c.name])
  );

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
          .select("trip_id, day_type_id, rate_cents, quantity")
          .in("trip_id", tripIds),
        supabase.from("day_types").select("id, billable"),
      ]);

    if (dayRowsError || dayTypeError) {
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
      <Card>
        {error ? (
          <Callout.Root color="red" m="3">
            <Callout.Text>{friendlyDbError(error, "trips.select")}</Callout.Text>
          </Callout.Root>
        ) : trips.length === 0 ? (
          <Flex direction="column" align="center" gap="3" py="6" px="3">
            <Heading as="h3" size="4">No trips yet</Heading>
            <Text size="2" color="gray" align="center">
              Log the trip once. Its legs feed your logbook, its days feed
              the invoice, and its expenses file themselves against it.
            </Text>
            <Button asChild>
              <NextLink href="/trips/new">Log your first trip</NextLink>
            </Button>
          </Flex>
        ) : (
          <>
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
                        <Badge color={status.color}>{status.label}</Badge>
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

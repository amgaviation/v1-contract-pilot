import { Callout, Card, Flex, Heading, Text } from "@/components/ui";
import { ExclamationTriangleIcon } from "@radix-ui/react-icons";

import { createClient } from "@/lib/supabase/server";
import { requireAccount } from "@/lib/supabase/account";
import { friendlyDbError } from "@/lib/db-errors";
import PageShell from "../../page-shell";
import { logbookFrom, type DraftLegRow, type DraftTripRow } from "../db";
import TripDraftCard from "./trip-draft-card";

export const metadata = { title: "Trip drafts" };

/**
 * Completing a trip PROPOSES logbook entries from its legs; nothing lands
 * in logbook_entries until the pilot confirms here (docs/PLAN.md "Trip →
 * logbook is a confirmed draft"). There is no stored draft/proposal row —
 * this page computes "unconfirmed" at read time as "a completed trip's
 * leg that no logbook_entries row yet references via trip_leg_id", and
 * app/(app)/logbook/actions.ts's confirmLegDraft/confirmTripDrafts are the
 * only code paths that ever turn one into a real row. See the Phase 6
 * migration's file header for the full reasoning, including why this is a
 * deliberate departure from the house "derived state is a trigger" rule.
 */
export default async function LogbookDraftsPage() {
  const { account } = await requireAccount("/logbook/drafts");

  const supabase = await createClient();
  const { data: tripData, error: tripError } = await supabase
    .from("trips")
    .select("id, starts_on, ends_on, aircraft_ident, aircraft_type, status")
    .eq("status", "completed")
    .order("starts_on", { ascending: false });

  // friendlyDbError throughout this file — see confirmedError below; a raw
  // error.message carries internal schema (table/constraint names) that
  // isn't useful to a pilot, so it never belongs on screen.
  if (tripError) {
    return (
      <PageShell title="Trip drafts" subtitle="Legs from completed trips, waiting on your review.">
        <Callout.Root color="red">
          <Callout.Icon>
            <ExclamationTriangleIcon />
          </Callout.Icon>
          <Callout.Text>{friendlyDbError(tripError, "trips.select")}</Callout.Text>
        </Callout.Root>
      </PageShell>
    );
  }

  const trips = (tripData ?? []) as DraftTripRow[];
  const tripIds = trips.map((trip) => trip.id);

  const [{ data: legData, error: legsError }, { data: confirmedData, error: confirmedError }] =
    tripIds.length === 0
      ? [{ data: [], error: null }, { data: [], error: null }]
      : await Promise.all([
          supabase
            .from("trip_legs")
            .select(
              "id, trip_id, leg_date, from_icao, to_icao, block_hours, night_hours, instrument_hours, day_landings, night_takeoffs, night_landings_full_stop, night_landings_touch_go, approaches, holds"
            )
            .in("trip_id", tripIds)
            .order("leg_date", { ascending: true }),
          logbookFrom(supabase, "logbook_entries")
            .select("trip_leg_id")
            .eq("account_id", account.id)
            .in("trip_id", tripIds)
            .not("trip_leg_id", "is", null),
        ]);

  if (legsError) {
    return (
      <PageShell title="Trip drafts" subtitle="Legs from completed trips, waiting on your review.">
        <Callout.Root color="red">
          <Callout.Icon>
            <ExclamationTriangleIcon />
          </Callout.Icon>
          <Callout.Text>{friendlyDbError(legsError, "trip_legs.select")}</Callout.Text>
        </Callout.Root>
      </PageShell>
    );
  }
  if (confirmedError) {
    return (
      <PageShell title="Trip drafts" subtitle="Legs from completed trips, waiting on your review.">
        <Callout.Root color="red">
          <Callout.Icon>
            <ExclamationTriangleIcon />
          </Callout.Icon>
          <Callout.Text>{friendlyDbError(confirmedError, "logbook_entries.select")}</Callout.Text>
        </Callout.Root>
      </PageShell>
    );
  }

  const legs = (legData ?? []) as DraftLegRow[];
  const confirmedLegIds = new Set(
    ((confirmedData ?? []) as { trip_leg_id: string }[]).map((row) => row.trip_leg_id)
  );

  const legsByTrip = new Map<string, DraftLegRow[]>();
  for (const leg of legs) {
    if (confirmedLegIds.has(leg.id)) continue;
    const bucket = legsByTrip.get(leg.trip_id) ?? [];
    bucket.push(leg);
    legsByTrip.set(leg.trip_id, bucket);
  }

  const pendingTrips = trips
    .map((trip) => ({ trip, legs: legsByTrip.get(trip.id) ?? [] }))
    .filter((entry) => entry.legs.length > 0);

  return (
    <PageShell
      title="Trip drafts"
      subtitle={
        pendingTrips.length === 0
          ? "Nothing waiting — every completed trip's legs are already in your logbook."
          : `${pendingTrips.length} completed trip${pendingTrips.length === 1 ? "" : "s"} with unconfirmed legs`
      }
    >
      {pendingTrips.length === 0 ? (
        <Card>
          <Flex direction="column" align="center" gap="2" py="6">
            <Heading as="h3" size="4">Nothing to review</Heading>
            <Text size="2" color="gray" align="center">
              Complete a trip with legs and its proposed entries will show up here for you to
              confirm — nothing reaches your logbook automatically.
            </Text>
          </Flex>
        </Card>
      ) : (
        <Flex direction="column" gap="4">
          {pendingTrips.map(({ trip, legs: tripLegs }) => (
            <TripDraftCard key={trip.id} trip={trip} legs={tripLegs} />
          ))}
        </Flex>
      )}
    </PageShell>
  );
}

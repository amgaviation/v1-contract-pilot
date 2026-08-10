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

/**
 * The Supabase Data API clamps every response to 1000 rows and truncates
 * without an error — the same cap app/(app)/trips/page.tsx guards against.
 * Asking for exactly that many and comparing the returned length is the
 * only way to detect it; a limit ABOVE the cap makes the check unfireable.
 * Every query below orders newest-first before capping, so if a pilot's
 * history is deep enough to hit the cap, it's the trips/legs they just
 * flew — the ones an unconfirmed draft is actually for — that survive,
 * not the ones from years ago they'd have no reason to go looking for.
 */
const TRIP_LIMIT = 1000;
const LEG_LIMIT = 1000;
const CONFIRMED_LIMIT = 1000;

export default async function LogbookDraftsPage() {
  const { account } = await requireAccount("/logbook/drafts");

  const supabase = await createClient();
  const [
    { data: tripData, error: tripError },
    { count: notYetFlownCount },
  ] = await Promise.all([
    supabase
      .from("trips")
      .select("id, starts_on, ends_on, aircraft_ident, aircraft_type, status")
      .eq("status", "completed")
      .order("starts_on", { ascending: false })
      .limit(TRIP_LIMIT),
    // Trips the pilot has logged but not yet marked flown. Without this,
    // an empty queue told them "every completed trip's legs are already in
    // your logbook" — true, and deeply misleading, when the real answer
    // was that none of their trips had been marked completed yet.
    supabase
      .from("trips")
      .select("id", { count: "exact", head: true })
      .in("status", ["scheduled", "in_progress"]),
  ]);

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
  // Same silent-truncation hazard as trips/page.tsx's TRIP_LIMIT check —
  // ordered newest-first above, so a cap here drops the OLDEST completed
  // trips, not the ones a pilot just flew and is most likely checking for.
  const tripsTruncated = trips.length === TRIP_LIMIT;
  const tripIds = trips.map((trip) => trip.id);

  const [{ data: legData, error: legsError }, { data: confirmedData, error: confirmedError }] =
    tripIds.length === 0
      ? [{ data: [], error: null }, { data: [], error: null }]
      : await Promise.all([
          supabase
            .from("trip_legs")
            .select(
              "id, trip_id, leg_date, from_icao, to_icao, block_hours, night_hours, instrument_hours, instrument_actual_hours, instrument_simulated_hours, cross_country_hours, day_takeoffs, day_landings, day_landings_full_stop, night_takeoffs, night_landings_full_stop, night_landings_touch_go, approaches, holds"
            )
            .in("trip_id", tripIds)
            // Newest-first, not the chronological-ascending this table used
            // to fetch: if LEG_LIMIT truncates, it's the legs the pilot
            // JUST flew that need to survive — a two-year-old leg going
            // missing from this screen is invisible; a leg from last week
            // going missing is the whole draft queue looking empty. Sorted
            // back to chronological order per-trip below, for display only.
            .order("leg_date", { ascending: false })
            .limit(LEG_LIMIT),
          // Bounds which already-confirmed legs this page knows about, so
          // it can exclude them from the draft list. Newest confirmations
          // first: if this truncates, an old confirmed leg can reappear as
          // an "unconfirmed" draft, but confirming it again is a no-op —
          // confirmLegDraft/confirmTripDrafts turn the unique-constraint
          // hit into "That leg was already confirmed to your logbook.",
          // never a duplicate entry — so bounding this one the same way
          // degrades to a clear message rather than corrupting the logbook.
          logbookFrom(supabase, "logbook_entries")
            .select("trip_leg_id")
            .eq("account_id", account.id)
            .in("trip_id", tripIds)
            .not("trip_leg_id", "is", null)
            .order("created_at", { ascending: false })
            .limit(CONFIRMED_LIMIT),
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
  // tripIds.length === 0 short-circuits to an empty array above, so a
  // length exactly at the cap here always means a real fetch hit it.
  const legsTruncated = legs.length === LEG_LIMIT;
  const confirmedRows = (confirmedData ?? []) as { trip_leg_id: string }[];
  const confirmedTruncated = confirmedRows.length === CONFIRMED_LIMIT;
  const confirmedLegIds = new Set(confirmedRows.map((row) => row.trip_leg_id));

  const legsByTrip = new Map<string, DraftLegRow[]>();
  for (const leg of legs) {
    if (confirmedLegIds.has(leg.id)) continue;
    const bucket = legsByTrip.get(leg.trip_id) ?? [];
    bucket.push(leg);
    legsByTrip.set(leg.trip_id, bucket);
  }
  // Fetched newest-first so LEG_LIMIT keeps the right legs (see above);
  // put each trip's legs back in flying order for the table, since that
  // ordering is a display concern the cap doesn't need to care about.
  for (const bucket of legsByTrip.values()) {
    bucket.sort((a, b) => a.leg_date.localeCompare(b.leg_date));
  }

  const pendingTrips = trips
    .map((trip) => ({ trip, legs: legsByTrip.get(trip.id) ?? [] }))
    .filter((entry) => entry.legs.length > 0);

  return (
    <PageShell
      title="Trip drafts"
      subtitle={
        pendingTrips.length === 0
          ? notYetFlownCount
            ? `Nothing waiting here — but ${notYetFlownCount} trip${
                notYetFlownCount === 1 ? " is" : "s are"
              } still marked Scheduled. Mark a trip flown and its legs show up here.`
            : "Nothing waiting — every completed trip's legs are already in your logbook."
          : `${pendingTrips.length} completed trip${pendingTrips.length === 1 ? "" : "s"} with unconfirmed legs`
      }
    >
      {tripsTruncated ? (
        <Callout.Root color="amber" mb="3">
          <Callout.Text>
            {`Showing drafts for your ${TRIP_LIMIT} most recently completed
              trips. Older completed trips aren't checked for drafts on
              this screen — they're still in your account, but an
              unconfirmed leg on one of them won't show up here.`}
          </Callout.Text>
        </Callout.Root>
      ) : null}
      {legsTruncated ? (
        <Callout.Root color="amber" mb="3">
          <Callout.Text>
            {`Showing your ${LEG_LIMIT} most recently flown unconfirmed
              legs. Older legs on these trips aren't on this screen — they're
              still in your account, but this list can't reach that far back.`}
          </Callout.Text>
        </Callout.Root>
      ) : null}
      {confirmedTruncated ? (
        <Callout.Root color="amber" mb="3">
          <Callout.Text>
            {`Only checked your ${CONFIRMED_LIMIT} most recently confirmed
              legs against this list, so an older leg that's already in
              your logbook could still show up below as a draft.
              Confirming it again is safe — you'll see "already confirmed"
              instead of a duplicate entry.`}
          </Callout.Text>
        </Callout.Root>
      ) : null}
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

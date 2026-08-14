import NextLink from "next/link";
import { Button, Callout, Card, Flex, Heading, Text } from "@/components/ui";
import { ExclamationTriangleIcon } from "@radix-ui/react-icons";

import { createClient } from "@/lib/supabase/server";
import { requireAccount } from "@/lib/supabase/account";
import { friendlyDbError } from "@/lib/db-errors";
import { countOf } from "@/lib/supabase/rows";
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
 * The trips and trip_legs queries below order newest-first before
 * capping, so if a pilot's history is deep enough to hit the cap, it's
 * the trips/legs they just flew — the ones an unconfirmed draft is
 * actually for — that survive, not the ones from years ago they'd have
 * no reason to go looking for.
 *
 * The already-confirmed-legs read (fetchAllConfirmedLegIds, below) is NOT
 * part of that "cap + callout" group — it needs to be COMPLETE, not just
 * recent, so it pages with .range() the way
 * app/(app)/logbook/export/route.ts pages logbook_entries, instead of
 * capping and disclosing.
 *
 * notYetFlownCount, further down, is exempt from the row-cap concern above
 * for a third reason: it's a head:true exact count, not a row fetch, so
 * the row cap and the silent truncation this comment is about don't apply
 * to it. That exemption is about truncation ONLY — the count still binds
 * and checks its own error via countOf (lib/supabase/rows.ts), the same as
 * tripError/legsError/confirmedError above, because a failed count and a
 * genuine zero are a different pair of facts than a capped read and a
 * complete one.
 */
const TRIP_LIMIT = 1000;
const LEG_LIMIT = 1000;
// Page size for fetchAllConfirmedLegIds — unrelated to the 1000-row cap
// above; this is a normal, unbounded .range() page like export/route.ts
// uses, sized for round trips rather than tuned to any API limit.
const CONFIRMED_PAGE_SIZE = 500;

/**
 * Every already-confirmed trip_leg_id for these trips, unbounded. A
 * pilot's confirmed-legs set is exactly the exclusion list this page uses
 * to decide what's still a draft — capping it (the earlier version of
 * this fix used a 1000-row cap here) means legs past the cap silently
 * drop out of the exclusion set and get re-proposed as drafts. That is
 * the confirmed-ids half of the original defect report's REPRO, and a
 * cap-and-disclose Callout would only describe the bug, not close it.
 * Paged with .range() until a short page comes back, same as
 * app/(app)/logbook/export/route.ts does for the CSV export — the one
 * other read in this feature directory that has to be complete rather
 * than merely recent.
 */
async function fetchAllConfirmedLegIds(
  supabase: Awaited<ReturnType<typeof createClient>>,
  accountId: string,
  tripIds: string[]
): Promise<{ ids: Set<string>; error: { code?: string | null; message?: string | null } | null }> {
  const ids = new Set<string>();
  let offset = 0;
  for (;;) {
    const { data, error } = await logbookFrom(supabase, "logbook_entries")
      .select("trip_leg_id")
      .eq("account_id", accountId)
      .in("trip_id", tripIds)
      .not("trip_leg_id", "is", null)
      // id is the primary key, so ordering by it alone gives .range() a
      // stable total order — without an .order() here, Postgres can
      // return the same row on two pages or skip one across pages.
      .order("id", { ascending: true })
      .range(offset, offset + CONFIRMED_PAGE_SIZE - 1);
    if (error) return { ids, error };
    const rows = (data ?? []) as { trip_leg_id: string }[];
    for (const row of rows) ids.add(row.trip_leg_id);
    if (rows.length < CONFIRMED_PAGE_SIZE) break;
    offset += rows.length;
  }
  return { ids, error: null };
}

export default async function LogbookDraftsPage() {
  const { account } = await requireAccount("/logbook/drafts");

  const supabase = await createClient();
  const [
    { data: tripData, error: tripError },
    notYetFlownCountRes,
  ] = await Promise.all([
    supabase
      .from("trips")
      .select("id, starts_on, ends_on, aircraft_ident, aircraft_type, status")
      .eq("account_id", account.id)
      .eq("status", "completed")
      .order("starts_on", { ascending: false })
      .limit(TRIP_LIMIT),
    // Trips the pilot has logged but not yet marked flown. Without this,
    // an empty queue told them "every completed trip's legs are already in
    // your logbook" — true, and deeply misleading, when the real answer
    // was that none of their trips had been marked completed yet.
    //
    // .eq on account_id, not just RLS: current_account_ids() spans every
    // account a user belongs to, and this whole page's job is per-account
    // drafts (see /logbook/page.tsx and the aircraft page for the same
    // documented hazard). Without it, a user with two memberships sees the
    // other account's completed trips proposed as drafts here.
    supabase
      .from("trips")
      .select("id", { count: "exact", head: true })
      .eq("account_id", account.id)
      .in("status", ["scheduled", "in_progress"]),
  ]);
  // A failed count here must not fall to 0 — that's the exact value that
  // makes the subtitle below print the reassuring "every completed trip's
  // legs are already in your logbook" claim instead of admitting it
  // couldn't check.
  const notYetFlownResult = countOf(notYetFlownCountRes);
  const notYetFlownCount = notYetFlownResult.ok ? notYetFlownResult.count : 0;
  const notYetFlownCountFailed = !notYetFlownResult.ok;

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

  const [{ data: legData, error: legsError }, { ids: confirmedLegIds, error: confirmedError }] =
    tripIds.length === 0
      ? [{ data: [], error: null }, { ids: new Set<string>(), error: null }]
      : await Promise.all([
          supabase
            .from("trip_legs")
            .select(
              "id, trip_id, leg_date, from_icao, to_icao, block_hours, night_hours, instrument_hours, instrument_actual_hours, instrument_simulated_hours, cross_country_hours, day_takeoffs, day_landings, day_landings_full_stop, night_takeoffs, night_landings_full_stop, night_landings_touch_go, approaches, holds"
            )
            // tripIds is already account-scoped (the trips query above
            // filters on account_id), so this is redundant given RLS and
            // that upstream filter alone — added anyway to match the
            // documented, defence-in-depth pattern every sibling read in
            // this feature directory uses rather than relying on RLS by
            // itself.
            .eq("account_id", account.id)
            .in("trip_id", tripIds)
            // Newest-first, not the chronological-ascending this table used
            // to fetch: if LEG_LIMIT truncates, it's the legs the pilot
            // JUST flew that need to survive — a two-year-old leg going
            // missing from this screen is invisible; a leg from last week
            // going missing is the whole draft queue looking empty. Sorted
            // back to chronological order per-trip below, for display only.
            .order("leg_date", { ascending: false })
            .limit(LEG_LIMIT),
          // Which already-confirmed legs this page knows about, so it can
          // exclude them from the draft list — read to completion, not
          // capped. See fetchAllConfirmedLegIds's own comment for why a
          // cap here is unsafe in a way the trips/legs caps above aren't.
          fetchAllConfirmedLegIds(supabase, account.id, tripIds),
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

  // Whether the "every completed trip's legs are already in your logbook"
  // claim below is actually true. It's true only if this page looked at
  // every completed trip's every leg — if either query got capped, an
  // empty pendingTrips list means "nothing found in what was checked," not
  // "there is nothing." fetchAllConfirmedLegIds isn't part of this check
  // — its own comment above covers why, and confirmedError above already
  // turns any of its failures into a visible red Callout.
  const draftCheckIncomplete = tripsTruncated || legsTruncated;

  return (
    <PageShell
      title="Trip drafts"
      subtitle={
        pendingTrips.length === 0
          ? draftCheckIncomplete
            ? "Nothing waiting in what this screen checked — see the note below before assuming your logbook is fully caught up."
            : notYetFlownCount
              ? `Nothing waiting here — but ${notYetFlownCount} trip${
                  notYetFlownCount === 1 ? " is" : "s are"
                } still marked Scheduled. Mark a trip flown and its legs show up here.`
              : notYetFlownCountFailed
                ? "Nothing waiting here — but this screen couldn't check whether any trips are still marked Scheduled, so that isn't confirmed either."
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
            {`Checked your ${LEG_LIMIT} most recently flown legs on these
              trips for unconfirmed ones. Older legs aren't checked by this
              screen — they're still in your account, but this list can't
              reach that far back.`}
          </Callout.Text>
        </Callout.Root>
      ) : null}
      {pendingTrips.length === 0 ? (
        <Card>
          <Flex direction="column" align="center" gap="2" py="6">
            <Heading as="h3" size="4">
              {draftCheckIncomplete ? "Nothing found in what could be checked" : "Nothing to review"}
            </Heading>
            <Text size="2" color="gray" align="center">
              {draftCheckIncomplete
                ? "This screen only checked your most recent completed trips and legs (see the note above) — an older unconfirmed leg could still be out there."
                : notYetFlownCount
                  ? "Marking a trip flown proposes a logbook entry for each of its legs, and they wait here for you to confirm — nothing reaches your logbook automatically."
                  : "Complete a trip with legs and its proposed entries will show up here for you to confirm — nothing reaches your logbook automatically."}
            </Text>
            {/* A primary action rather than a dead end, and which one is
                useful depends on why the queue is empty: mark a trip
                flown if any are still Scheduled, otherwise log one. */}
            <Flex gap="3" mt="2" wrap="wrap">
              <Button asChild>
                <NextLink href={notYetFlownCount ? "/trips" : "/trips/new"}>
                  {notYetFlownCount ? "Mark a trip flown" : "Log a trip"}
                </NextLink>
              </Button>
              <Button asChild variant="outline">
                <NextLink href="/logbook">Open your logbook</NextLink>
              </Button>
            </Flex>
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

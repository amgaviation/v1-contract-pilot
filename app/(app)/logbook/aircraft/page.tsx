import NextLink from "next/link";
import { Button, Callout, Flex } from "@/components/ui";
import { ExclamationTriangleIcon } from "@radix-ui/react-icons";

import { createClient } from "@/lib/supabase/server";
import { requireAccount } from "@/lib/supabase/account";
import { friendlyDbError } from "@/lib/db-errors";
import PageShell from "../../page-shell";
import { logbookFrom } from "../db";
import type { AircraftRow, TimeByTailRow, UnregisteredIdentRow } from "./db";
import FleetPanel, { type FleetAircraft, type Suggestion } from "./fleet-panel";

export const metadata = { title: "Your aircraft" };

/**
 * The pilot's fleet.
 *
 * Lives under /logbook rather than in the nav rail on purpose: an airframe
 * is something a pilot thinks about while looking at their hours, and the
 * rail's eight sections are fixed by docs/PLAN.md. The link sits beside
 * "Trip drafts" and "Import CSV" on the logbook page.
 *
 * Nothing here writes to pilot.logbook_entries. The registry annotates
 * history by matching a normalised tail key at read time; the entries
 * themselves are a legal record under 61.51 and stay exactly as the pilot
 * wrote them. See the migration header.
 */

/** A pilot who flies 40 airframes has an unusual career, not a paging problem. */
const FLEET_LIMIT = 500;
/** Enough suggestions to build a real fleet from; more would be a wall of buttons. */
const SUGGESTION_LIMIT = 24;

export default async function AircraftPage() {
  await requireAccount("/logbook/aircraft");
  const supabase = await createClient();

  const [{ data: fleetData, error }, { data: timeData }, { data: suggestionData }] =
    await Promise.all([
      logbookFrom(supabase, "aircraft")
        .select("*")
        .order("archived_at", { ascending: true, nullsFirst: true })
        .order("tail_key", { ascending: true })
        .limit(FLEET_LIMIT),
      logbookFrom(supabase, "aircraft_time_by_tail").select("*").limit(FLEET_LIMIT),
      logbookFrom(supabase, "aircraft_unregistered_idents")
        .select("*")
        .order("total_time", { ascending: false })
        .limit(SUGGESTION_LIMIT),
    ]);

  const rows = (fleetData ?? []) as AircraftRow[];
  const timeRows = (timeData ?? []) as TimeByTailRow[];
  const byId = new Map(timeRows.map((row) => [row.aircraft_id, row]));

  const aircraft: FleetAircraft[] = rows.map((row) => {
    const time = byId.get(row.id);
    return {
      id: row.id,
      tail_number: row.tail_number,
      type_designator: row.type_designator,
      make_model: row.make_model,
      gear: row.gear,
      category_class: row.category_class,
      notes: row.notes,
      archived_at: row.archived_at,
      // A failed or missing hours read is zero HOURS, not a missing
      // aircraft — the fleet list is the registry, and it renders whether
      // or not the rollup answered.
      entryCount: Number(time?.entry_count ?? 0),
      totalTime: Number(time?.total_time ?? 0),
      lastFlownOn: time?.last_flown_on ?? null,
    };
  });

  const suggestions: Suggestion[] = ((suggestionData ?? []) as UnregisteredIdentRow[]).map(
    (row) => ({
      tailKey: row.tail_key,
      aircraftIdent: row.aircraft_ident,
      aircraftType: row.aircraft_type,
      entryCount: Number(row.entry_count),
      totalTime: Number(row.total_time),
      lastFlownOn: row.last_flown_on,
    })
  );

  return (
    <PageShell
      title="Your aircraft"
      subtitle="The airframes behind your hours — so your logbook can answer “how much time in type?”"
      action={
        <Button asChild variant="outline">
          <NextLink href="/logbook">Back to logbook</NextLink>
        </Button>
      }
    >
      {error ? (
        <Callout.Root color="red">
          <Callout.Icon>
            <ExclamationTriangleIcon />
          </Callout.Icon>
          <Callout.Text>{friendlyDbError(error, "aircraft.select")}</Callout.Text>
        </Callout.Root>
      ) : (
        <Flex direction="column" gap="4">
          <FleetPanel aircraft={aircraft} suggestions={suggestions} />
        </Flex>
      )}
    </PageShell>
  );
}

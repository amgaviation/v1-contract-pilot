import NextLink from "next/link";
import { Badge, Button, Callout, Card, Flex, Heading, Table, Text } from "@/components/ui";
import { ExclamationTriangleIcon } from "@radix-ui/react-icons";

import { createClient } from "@/lib/supabase/server";
import { requireAccount } from "@/lib/supabase/account";
import { friendlyDbError } from "@/lib/db-errors";
import PageShell from "../../page-shell";
import { logbookFrom } from "../db";
import type {
  AircraftRow,
  TimeByTailRow,
  TimeByTypeRow,
  UnregisteredIdentRow,
} from "./db";
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
/**
 * EVERY type, not a summary. The logbook page shows the top twelve and
 * links here for the rest, so this is the one place the number has to be
 * complete — a pilot-history form is not a highlights reel.
 */
const TYPE_LIMIT = 500;

export default async function AircraftPage() {
  const { account } = await requireAccount("/logbook/aircraft");
  const supabase = await createClient();
  if (!account) return null;

  // Every read below carries .eq("account_id", …) even though RLS already
  // confines it. current_account_ids() returns EVERY account a user
  // belongs to, and createAircraft writes to exactly one of them — so on
  // the day a business account has two members, reads that trusted RLS
  // alone would show a merged fleet while "Add an aircraft" quietly filed
  // into a single account. Reads match writes.
  const [
    { data: fleetData, error },
    { data: timeData, error: timeError },
    { data: suggestionData, error: suggestionError },
    { data: byTypeData, error: byTypeError },
  ] = await Promise.all([
    logbookFrom(supabase, "aircraft")
      .select("*")
      .eq("account_id", account.id)
      .order("archived_at", { ascending: true, nullsFirst: true })
      .order("tail_key", { ascending: true })
      .limit(FLEET_LIMIT),
    logbookFrom(supabase, "aircraft_time_by_tail")
      .select("*")
      .eq("account_id", account.id)
      .limit(FLEET_LIMIT),
    // One more than we show, so "and 39 more" is a fact rather than a
    // guess. A heading that says "24 tails" when there are 63 is a wrong
    // number presented as a certainty.
    logbookFrom(supabase, "aircraft_unregistered_idents")
      .select("*")
      .eq("account_id", account.id)
      .order("total_time", { ascending: false })
      .order("tail_key", { ascending: true })
      .limit(SUGGESTION_LIMIT + 1),
    logbookFrom(supabase, "logbook_time_by_type")
      .select("*")
      .eq("account_id", account.id)
      .order("total_time", { ascending: false })
      .order("type_label", { ascending: true })
      .limit(TYPE_LIMIT),
  ]);

  const rows = (fleetData ?? []) as AircraftRow[];
  const timeRows = (timeData ?? []) as TimeByTailRow[];
  const byId = new Map(timeRows.map((row) => [row.aircraft_id, row]));
  // A FAILED hours read is not zero hours. Rendering 0.0 next to an
  // airframe with three years of history reads as "the match broke" and
  // sends a pilot off editing tail numbers that were never wrong. Same
  // rule the logbook page already applies to career totals.
  const hoursUnavailable = Boolean(timeError);

  const aircraft: FleetAircraft[] = rows.map((row) => {
    const time = byId.get(row.id);
    return {
      id: row.id,
      tail_number: row.tail_number,
      type_designator: row.type_designator,
      type_rating: row.type_rating,
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
      picTime: Number(time?.pic_time ?? 0),
      simulatorTime: Number(time?.simulator_time ?? 0),
      lastFlownOn: time?.last_flown_on ?? null,
    };
  });

  const suggestionRows = (suggestionData ?? []) as UnregisteredIdentRow[];
  const moreSuggestions = suggestionRows.length > SUGGESTION_LIMIT;
  const suggestions: Suggestion[] = suggestionRows.slice(0, SUGGESTION_LIMIT).map(
    (row) => ({
      tailKey: row.tail_key,
      aircraftIdent: row.aircraft_ident,
      aircraftType: row.aircraft_type,
      entryCount: Number(row.entry_count),
      totalTime: Number(row.total_time),
      lastFlownOn: row.last_flown_on,
    })
  );

  const byType = ((byTypeData ?? []) as TimeByTypeRow[]).map((row) => ({
    label: row.type_label,
    total: Number(row.total_time),
    pic: Number(row.pic_time),
    sic: Number(row.sic_time),
    night: Number(row.night_time),
    simulator: Number(row.simulator_time),
    entries: Number(row.entry_count),
    registered: row.has_registered_aircraft === true,
  }));

  return (
    <PageShell
      title="Your aircraft"
      subtitle="The airframes behind your hours, so your logbook can answer “how much time in type?”"
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
          {hoursUnavailable ? (
            <Callout.Root color="amber">
              <Callout.Icon>
                <ExclamationTriangleIcon />
              </Callout.Icon>
              <Callout.Text>
                Your hours couldn&rsquo;t be loaded just now, so the Hours and Last
                flown columns are blank rather than wrong. Your fleet and your
                logbook are both fine.
              </Callout.Text>
            </Callout.Root>
          ) : null}
          {suggestionError ? (
            <Callout.Root color="amber">
              <Callout.Icon>
                <ExclamationTriangleIcon />
              </Callout.Icon>
              <Callout.Text>
                We couldn&rsquo;t check which tails you&rsquo;ve flown but not added
                yet — so this page isn&rsquo;t offering any. You can still add one by
                hand.
              </Callout.Text>
            </Callout.Root>
          ) : null}
          <FleetPanel
            aircraft={aircraft}
            suggestions={suggestions}
            moreSuggestions={moreSuggestions}
            hoursUnavailable={hoursUnavailable}
          />

          <Card>
            <Flex direction="column" gap="3" p="1">
              <Flex direction="column" gap="1">
                <Heading as="h2" size="4">
                  Every type you have time in
                </Heading>
              </Flex>

              {byTypeError ? (
                <Callout.Root color="amber" size="1">
                  <Callout.Icon>
                    <ExclamationTriangleIcon />
                  </Callout.Icon>
                  <Callout.Text>
                    This couldn&rsquo;t be loaded just now. Nothing is wrong with
                    your entries.
                  </Callout.Text>
                </Callout.Root>
              ) : byType.length === 0 ? (
                <Text size="2" color="gray">
                  Nothing to group yet — log a flight, or import your logbook.
                </Text>
              ) : (
                <Table.Root variant="ghost">
                  <Table.Header>
                    <Table.Row>
                      <Table.ColumnHeaderCell>Type</Table.ColumnHeaderCell>
                      <Table.ColumnHeaderCell justify="end">Total</Table.ColumnHeaderCell>
                      <Table.ColumnHeaderCell justify="end">PIC</Table.ColumnHeaderCell>
                      <Table.ColumnHeaderCell justify="end">SIC</Table.ColumnHeaderCell>
                      <Table.ColumnHeaderCell justify="end">Night</Table.ColumnHeaderCell>
                      <Table.ColumnHeaderCell justify="end">Sim</Table.ColumnHeaderCell>
                      <Table.ColumnHeaderCell justify="end">Entries</Table.ColumnHeaderCell>
                    </Table.Row>
                  </Table.Header>
                  <Table.Body>
                    {byType.map((row) => (
                      <Table.Row key={row.label}>
                        <Table.RowHeaderCell>
                          <Flex align="center" gap="2">
                            <Text weight="medium">{row.label}</Text>
                            {row.registered ? null : (
                              <Badge color="gray" variant="outline">
                                No aircraft on file
                              </Badge>
                            )}
                          </Flex>
                        </Table.RowHeaderCell>
                        <Table.Cell justify="end">
                          <Text weight="medium" className="tnum">
                            {row.total.toFixed(1)}
                          </Text>
                        </Table.Cell>
                        <Table.Cell justify="end">
                          <Text color="gray" className="tnum">{row.pic.toFixed(1)}</Text>
                        </Table.Cell>
                        <Table.Cell justify="end">
                          <Text color="gray" className="tnum">{row.sic.toFixed(1)}</Text>
                        </Table.Cell>
                        <Table.Cell justify="end">
                          <Text color="gray" className="tnum">{row.night.toFixed(1)}</Text>
                        </Table.Cell>
                        <Table.Cell justify="end">
                          <Text color="gray" className="tnum">
                            {row.simulator.toFixed(1)}
                          </Text>
                        </Table.Cell>
                        <Table.Cell justify="end">
                          <Text color="gray" className="tnum">{row.entries}</Text>
                        </Table.Cell>
                      </Table.Row>
                    ))}
                  </Table.Body>
                </Table.Root>
              )}
            </Flex>
          </Card>
        </Flex>
      )}
    </PageShell>
  );
}

import NextLink from "next/link";
import {
  Badge,
  Button,
  Callout,
  Card,
  Flex,
  Grid,
  Heading,
  Link,
  Table,
  Text,
} from "@/components/ui";
import { ExclamationTriangleIcon } from "@radix-ui/react-icons";

import { createClient } from "@/lib/supabase/server";
import { requireAccount } from "@/lib/supabase/account";
import { formatDate } from "@/lib/format";
import { friendlyDbError } from "@/lib/db-errors";
import PageShell from "../page-shell";
import { logbookFrom, type LogbookEntryRow, type LogbookSource } from "./db";

export const metadata = { title: "Logbook" };

type SourceBadge = { tone: React.ComponentProps<typeof Badge>["color"]; label: string };

const SOURCE_FALLBACK: SourceBadge = { tone: "gray", label: "Manual" };
const SOURCE_BADGE: Record<LogbookSource, SourceBadge> = {
  manual: SOURCE_FALLBACK,
  trip: { tone: "blue", label: "From trip" },
  import: { tone: "gray", label: "Imported" },
  foreflight_sync: { tone: "gray", label: "ForeFlight sync" },
};

// logbookFrom() returns `any` (see its own comment), so nothing type-checks
// these numeric(4,1) columns before they reach here — if one ever arrives
// as a string, `+` concatenates instead of adding and `.toFixed` throws a
// 500. Number() coerces the same way trips/invoices/page.tsx already does
// for their own numerics, so a string doesn't silently become NaN-shaped
// arithmetic three renders downstream.

/** total_time is NOT NULL; every other time column can be null. */
function sum(entries: LogbookEntryRow[], pick: (e: LogbookEntryRow) => number | null): number {
  return entries.reduce((total, entry) => total + Number(pick(entry) ?? 0), 0);
}

function landings(entry: LogbookEntryRow): number {
  return (
    Number(entry.day_landings_full_stop) +
    Number(entry.day_landings_touch_go) +
    Number(entry.night_landings_full_stop) +
    Number(entry.night_landings_touch_go)
  );
}

// Supabase's Data API caps rows (commonly 1000) and TRUNCATES SILENTLY —
// an explicit .limit makes that boundary visible instead of invisible, and
// truncatedEntries below turns it into a caveat rather than a quietly
// wrong sum. The real fix is a server-side aggregate (an RPC or a view),
// deferred to a later pass.
const ENTRIES_LIMIT = 1000;

export default async function LogbookPage() {
  await requireAccount("/logbook");

  const supabase = await createClient();
  const { data, error } = await logbookFrom(supabase, "logbook_entries")
    .select("*")
    .order("entry_date", { ascending: false })
    .limit(ENTRIES_LIMIT);

  const entries = (data ?? []) as LogbookEntryRow[];
  const truncatedEntries = entries.length === ENTRIES_LIMIT;

  const totals = {
    total: sum(entries, (e) => e.total_time),
    pic: sum(entries, (e) => e.pic_time),
    night: sum(entries, (e) => e.night_time),
    instrument: sum(entries, (e) => (e.instrument_actual_time ?? 0) + (e.instrument_simulated_time ?? 0)),
    landings: entries.reduce((total, e) => total + landings(e), 0),
  };

  return (
    <PageShell
      title="Logbook"
      subtitle={
        error
          ? "Couldn't load your logbook."
          : `${entries.length} entr${entries.length === 1 ? "y" : "ies"}`
      }
      action={
        <>
          <Button asChild variant="outline">
            <NextLink href="/logbook/drafts">Trip drafts</NextLink>
          </Button>
          <Button asChild>
            <NextLink href="/logbook/new">Log an entry</NextLink>
          </Button>
        </>
      }
    >
      {error ? (
        <Callout.Root color="red">
          <Callout.Icon>
            <ExclamationTriangleIcon />
          </Callout.Icon>
          <Callout.Text>{friendlyDbError(error, "logbook_entries.select")}</Callout.Text>
        </Callout.Root>
      ) : (
        <Flex direction="column" gap="4">
          {truncatedEntries ? (
            <Callout.Root color="amber">
              <Callout.Icon>
                <ExclamationTriangleIcon />
              </Callout.Icon>
              <Callout.Text>
                {`Totals below may be partial — there are more than ${ENTRIES_LIMIT} entries and only the first ${ENTRIES_LIMIT} were totaled.`}
              </Callout.Text>
            </Callout.Root>
          ) : null}

          <Grid columns={{ initial: "2", md: "5" }} gap="3">
            {[
              { label: "Total time", value: totals.total, decimals: 1 },
              { label: "PIC", value: totals.pic, decimals: 1 },
              { label: "Night", value: totals.night, decimals: 1 },
              { label: "Instrument", value: totals.instrument, decimals: 1 },
              { label: "Landings", value: totals.landings, decimals: 0 },
            ].map((stat) => (
              <Card key={stat.label}>
                <Flex direction="column" align="center" gap="1" p="1">
                  <Text size="1" color="gray" weight="bold" style={{ textTransform: "uppercase" }}>
                    {stat.label}
                  </Text>
                  <Text size="6" weight="bold" className="tnum">
                    {stat.decimals === 0 ? stat.value : stat.value.toFixed(1)}
                  </Text>
                </Flex>
              </Card>
            ))}
          </Grid>

          <Card>
            {entries.length === 0 ? (
              <Flex direction="column" align="center" gap="3" py="6">
                <Heading as="h2" size="4">No logbook entries yet</Heading>
                <Text size="2" color="gray" align="center">
                  Log a flight by hand, or confirm the entries a completed trip proposes.
                </Text>
                <Flex gap="3" mt="2">
                  <Button asChild>
                    <NextLink href="/logbook/new">Log your first entry</NextLink>
                  </Button>
                  <Button asChild variant="outline">
                    <NextLink href="/logbook/drafts">Review trip drafts</NextLink>
                  </Button>
                </Flex>
              </Flex>
            ) : (
              <Table.Root variant="ghost">
                <Table.Header>
                  <Table.Row>
                    <Table.ColumnHeaderCell>Date</Table.ColumnHeaderCell>
                    <Table.ColumnHeaderCell>Route</Table.ColumnHeaderCell>
                    <Table.ColumnHeaderCell>Aircraft</Table.ColumnHeaderCell>
                    <Table.ColumnHeaderCell>Role</Table.ColumnHeaderCell>
                    <Table.ColumnHeaderCell justify="end">Total</Table.ColumnHeaderCell>
                    <Table.ColumnHeaderCell justify="end">Night</Table.ColumnHeaderCell>
                    <Table.ColumnHeaderCell justify="end">Instrument</Table.ColumnHeaderCell>
                    <Table.ColumnHeaderCell justify="end">Landings</Table.ColumnHeaderCell>
                    <Table.ColumnHeaderCell justify="end">Source</Table.ColumnHeaderCell>
                  </Table.Row>
                </Table.Header>
                <Table.Body>
                  {entries.map((entry) => {
                    const source = SOURCE_BADGE[entry.source] ?? SOURCE_FALLBACK;
                    return (
                      <Table.Row key={entry.id}>
                        <Table.RowHeaderCell>
                          <Link asChild weight="medium">
                            <NextLink href={`/logbook/${entry.id}`}>{formatDate(entry.entry_date)}</NextLink>
                          </Link>
                        </Table.RowHeaderCell>
                        <Table.Cell>
                          <Text size="2" color="gray">
                            {entry.from_icao ?? "—"} → {entry.to_icao ?? "—"}
                          </Text>
                        </Table.Cell>
                        <Table.Cell>
                          <Text size="2" color="gray">
                            {entry.aircraft_ident ?? "—"}
                          </Text>
                        </Table.Cell>
                        <Table.Cell>
                          <Text size="2" color="gray">
                            {entry.role}
                          </Text>
                        </Table.Cell>
                        <Table.Cell justify="end">
                          <Text size="2" weight="medium" className="tnum">
                            {Number(entry.total_time).toFixed(1)}
                          </Text>
                        </Table.Cell>
                        <Table.Cell justify="end">
                          <Text size="2" color="gray" className="tnum">
                            {Number(entry.night_time ?? 0).toFixed(1)}
                          </Text>
                        </Table.Cell>
                        <Table.Cell justify="end">
                          <Text size="2" color="gray" className="tnum">
                            {(Number(entry.instrument_actual_time ?? 0) + Number(entry.instrument_simulated_time ?? 0)).toFixed(1)}
                          </Text>
                        </Table.Cell>
                        <Table.Cell justify="end">
                          <Text size="2" color="gray" className="tnum">
                            {landings(entry)}
                          </Text>
                        </Table.Cell>
                        <Table.Cell justify="end">
                          <Badge color={source.tone}>{source.label}</Badge>
                        </Table.Cell>
                      </Table.Row>
                    );
                  })}
                </Table.Body>
              </Table.Root>
            )}
          </Card>
        </Flex>
      )}
    </PageShell>
  );
}

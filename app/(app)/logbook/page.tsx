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
import type { TimeByTypeRow } from "./aircraft/db";

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


function landings(entry: LogbookEntryRow): number {
  return (
    Number(entry.day_landings_full_stop) +
    Number(entry.day_landings_touch_go) +
    Number(entry.night_landings_full_stop) +
    Number(entry.night_landings_touch_go)
  );
}

/** One screenful. Entries beyond it are a page away, not unreachable. */
const PAGE_SIZE = 200;

/**
 * Types shown in the hours-by-type panel. A career pilot might hold time in
 * a couple of dozen; past that the panel stops being a summary, and the
 * fleet screen is the place to go through them one at a time.
 */
const TYPE_ROW_LIMIT = 12;

export default async function LogbookPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const { account } = await requireAccount("/logbook");
  const { page: pageParam } = await searchParams;
  const parsed = Number(pageParam ?? "1");
  const page = Number.isInteger(parsed) && parsed >= 1 ? parsed : 1;
  const from = (page - 1) * PAGE_SIZE;

  const supabase = await createClient();
  const [
    { data, error, count },
    { data: totalsData, error: totalsError },
    { data: byTypeData },
  ] = await Promise.all([
    logbookFrom(supabase, "logbook_entries")
      .select("*", { count: "exact" })
      .order("entry_date", { ascending: false })
      .range(from, from + PAGE_SIZE - 1),
    // TOTALS COME FROM THE DATABASE, over every entry the pilot owns.
    // Summing the page would make total time — the number an employer
    // and an underwriter ask for — a function of pagination. A career
    // pilot with 8,000 entries used to see a figure computed from the
    // most recent 1,000.
    logbookFrom(supabase, "logbook_totals").select("*").maybeSingle(),
    // Time in type, from the same database rollup for the same reason.
    // See supabase/migrations/20260810110000_aircraft_registry.sql: it
    // matches the entry's free-text ident to the aircraft registry on a
    // normalised key at READ time, and still counts entries that match
    // nothing rather than dropping them.
    // .eq on account_id as well as RLS: current_account_ids() spans every
    // account a user belongs to, and this view groups by account_id — so a
    // future two-account membership would produce two rows with the same
    // type_label, a duplicate React key, and two half-totals presented as
    // if they were the whole career.
    logbookFrom(supabase, "logbook_time_by_type")
      .select("*")
      .eq("account_id", account?.id ?? "")
      .order("total_time", { ascending: false })
      .limit(TYPE_ROW_LIMIT),
  ]);

  const entries = (data ?? []) as LogbookEntryRow[];
  const totalCount = count ?? entries.length;
  const pageCount = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const totalsRow = totalsData as {
    entry_count: number;
    total_time: number;
    pic_time: number;
    night_time: number;
    instrument_time: number;
    landings: number;
  } | null;

  // A failed totals read is NOT zero hours. Falling back to the page's own
  // sum would be worse than showing nothing — it would look authoritative
  // and be wrong by however much did not fit.
  const totals = totalsRow
    ? {
        total: Number(totalsRow.total_time),
        pic: Number(totalsRow.pic_time),
        night: Number(totalsRow.night_time),
        instrument: Number(totalsRow.instrument_time),
        landings: Number(totalsRow.landings),
      }
    : null;

  const byType = ((byTypeData ?? []) as TimeByTypeRow[]).map((row) => ({
    label: row.type_label,
    total: Number(row.total_time),
    pic: Number(row.pic_time),
    night: Number(row.night_time),
    entries: Number(row.entry_count),
    registered: row.has_registered_aircraft === true,
  }));
  // "Unspecified" only earns a row when it is not the ONLY row. A pilot who
  // has never registered an airframe would otherwise get a table with one
  // line reading "Unspecified — all your hours", which is noise dressed as
  // a report; the prompt to build a fleet is the useful thing there.
  const hasTypeBreakdown = byType.some((row) => row.label !== "Unspecified");

  return (
    <PageShell
      title="Logbook"
      subtitle={
        error
          ? "Couldn't load your logbook."
          : `${totalCount} entr${totalCount === 1 ? "y" : "ies"}${
              pageCount > 1 ? ` · page ${page} of ${pageCount}` : ""
            }`
      }
      action={
        <>
          {/* This product is never the only copy of a pilot's legal
              record (61.51) — this is that pilot's own copy to keep,
              regardless of what happens to this account. Plain <a>, not
              a client-side link: it's a file download from
              /logbook/export, same pattern as the invoice PDF link. */}
          <Button asChild variant="outline">
            <a href="/logbook/export" download>
              Download your logbook (CSV)
            </a>
          </Button>
          <Button asChild variant="outline">
            <NextLink href="/logbook/drafts">Trip drafts</NextLink>
          </Button>
          {/* ForeFlight / LogTen Pro / generic CSV import — see
              app/(app)/logbook/import. Same draft-confirm boundary as
              Trip drafts: nothing lands here without the pilot reviewing
              a preview and confirming. */}
          <Button asChild variant="outline">
            <NextLink href="/logbook/import">Import CSV</NextLink>
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
          {totalsError ? (
            <Callout.Root color="amber">
              <Callout.Icon>
                <ExclamationTriangleIcon />
              </Callout.Icon>
              <Callout.Text>
                Your career totals couldn&rsquo;t be loaded, so they aren&rsquo;t
                shown — the entries below are still complete and correct.
              </Callout.Text>
            </Callout.Root>
          ) : null}

          <Grid columns={{ initial: "2", md: "5" }} gap="3">
            {(totals
              ? [
                  { label: "Total time", value: totals.total, decimals: 1 },
                  { label: "PIC", value: totals.pic, decimals: 1 },
                  { label: "Night", value: totals.night, decimals: 1 },
                  { label: "Instrument", value: totals.instrument, decimals: 1 },
                  { label: "Landings", value: totals.landings, decimals: 0 },
                ]
              : []
            ).map((stat) => (
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

          {entries.length > 0 ? (
            <Card>
              <Flex direction="column" gap="3" p="1">
                <Flex justify="between" align="center" gap="3" wrap="wrap">
                  <Flex direction="column" gap="1">
                    <Heading as="h2" size="4">
                      Hours by type
                    </Heading>
                    <Text size="2" color="gray">
                      What an insurance pilot-history form asks for, and what a chief
                      pilot asks on the phone.
                    </Text>
                  </Flex>
                  <Button asChild variant="outline">
                    <NextLink href="/logbook/aircraft">Your aircraft</NextLink>
                  </Button>
                </Flex>

                {hasTypeBreakdown ? (
                  <Table.Root variant="ghost">
                    <Table.Header>
                      <Table.Row>
                        <Table.ColumnHeaderCell>Type</Table.ColumnHeaderCell>
                        <Table.ColumnHeaderCell justify="end">Total</Table.ColumnHeaderCell>
                        <Table.ColumnHeaderCell justify="end">PIC</Table.ColumnHeaderCell>
                        <Table.ColumnHeaderCell justify="end">Night</Table.ColumnHeaderCell>
                        <Table.ColumnHeaderCell justify="end">Entries</Table.ColumnHeaderCell>
                      </Table.Row>
                    </Table.Header>
                    <Table.Body>
                      {byType.map((row) => (
                        <Table.Row key={row.label}>
                          <Table.RowHeaderCell>
                            <Flex align="center" gap="2">
                              <Text weight="medium">{row.label}</Text>
                              {/* Says WHY a row reads the way it does: these
                                  hours are grouped by what the pilot typed on
                                  each entry, not by a registered airframe, so
                                  the same aeroplane spelled two ways is still
                                  two rows here. */}
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
                            <Text color="gray" className="tnum">
                              {row.pic.toFixed(1)}
                            </Text>
                          </Table.Cell>
                          <Table.Cell justify="end">
                            <Text color="gray" className="tnum">
                              {row.night.toFixed(1)}
                            </Text>
                          </Table.Cell>
                          <Table.Cell justify="end">
                            <Text color="gray" className="tnum">
                              {row.entries}
                            </Text>
                          </Table.Cell>
                        </Table.Row>
                      ))}
                    </Table.Body>
                  </Table.Root>
                ) : (
                  <Text size="2" color="gray">
                    Your entries aren&rsquo;t grouped by type yet. Add the airframes you
                    fly and every hour you&rsquo;ve already logged in them gets counted
                    under a make and model — including entries where you wrote the
                    registration differently.
                  </Text>
                )}
              </Flex>
            </Card>
          ) : null}

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
                            {/* A wholly-simulator entry carries no crew role
                                (20260810020000). Showing the device says WHY
                                the role is absent, which is more use to a
                                pilot scanning the column than a bare dash. */}
                            {entry.role ??
                              (entry.simulator_device_type
                                ? entry.simulator_device_type.toUpperCase()
                                : "—")}
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

          {/* Entries past the first page used to be unreachable — not
              merely un-totalled, but unviewable, in the product's copy of
              a record 61.51 makes the pilot responsible for keeping.
              Plain links so a page is bookmarkable and the browser's back
              button behaves. */}
          {pageCount > 1 ? (
            <Flex justify="between" align="center" gap="3" wrap="wrap">
              <Button asChild variant="soft" disabled={page <= 1}>
                <NextLink href={page <= 2 ? "/logbook" : `/logbook?page=${page - 1}`}>
                  Newer
                </NextLink>
              </Button>
              <Text size="2" color="gray">
                {`Showing ${from + 1}–${Math.min(from + PAGE_SIZE, totalCount)} of ${totalCount}`}
              </Text>
              <Button asChild variant="soft" disabled={page >= pageCount}>
                <NextLink href={`/logbook?page=${Math.min(page + 1, pageCount)}`}>
                  Older
                </NextLink>
              </Button>
            </Flex>
          ) : null}
        </Flex>
      )}
    </PageShell>
  );
}

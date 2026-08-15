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
import EmptyState from "@/components/ui/empty-state";
import { loadPreferences } from "@/lib/preferences";
import {
  describeLogbookFilter,
  logbookFilterFromSearchParams,
  logbookFilterHref,
  logbookFilterIsEmpty,
  MAX_TYPE_LABEL,
} from "@/lib/logbook-views";
import PageShell from "../page-shell";
import {
  logbookFrom,
  logbookRpc,
  type LogbookEntryRow,
  type LogbookFilterArgs,
  type LogbookFilteredTotalsRow,
  type LogbookSource,
} from "./db";
import type { AircraftRow, TimeByTypeRow } from "./aircraft/db";
import SavedViews, { type TailOption } from "./saved-views";
import { deleteLogbookViewAction, saveLogbookViewAction } from "./views-actions";

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
 * Types shown in the hours-by-type panel. A career pilot who imported
 * twenty years of history can hold time in forty, and a panel with forty
 * rows stops being a summary — but a panel that shows twelve of forty and
 * says nothing is a pilot transcribing an incomplete pilot-history form.
 * One more than this is fetched so the shortfall can be STATED, and the
 * full table lives on the fleet screen.
 */
const TYPE_ROW_LIMIT = 12;

/** Aircraft offered in the filter's picker. A fleet is dozens at most. */
const FLEET_PICKER_LIMIT = 500;

/** Type labels offered in the filter's picker. Deliberately larger than
 *  the summary panel's TYPE_ROW_LIMIT: a picker that silently omitted the
 *  type a pilot wanted to filter by would be worse than a long list. */
const TYPE_PICKER_LIMIT = 200;

export default async function LogbookPage({
  searchParams,
}: {
  searchParams: Promise<{
    page?: string;
    tail?: string;
    type?: string;
    role?: string;
    from?: string;
    to?: string;
  }>;
}) {
  const { account } = await requireAccount("/logbook");
  const params = await searchParams;
  const parsed = Number(params.page ?? "1");
  const page = Number.isInteger(parsed) && parsed >= 1 ? parsed : 1;
  const from = (page - 1) * PAGE_SIZE;

  // THE URL IS THE FILTER. Resolved through the same total function the
  // stored views go through (lib/logbook-views.ts), so a hand-edited link
  // and a saved view behave identically and neither can express a filter
  // the query layer cannot run. An unrecognised facet is DROPPED, which
  // widens the result set — a logbook screen must fail toward showing more
  // of the pilot's record, never less.
  const filter = logbookFilterFromSearchParams(params);
  const filtered = !logbookFilterIsEmpty(filter);
  const filterArgs: LogbookFilterArgs = {
    p_account_id: account.id,
    p_tail_key: filter.tailKey,
    p_type_label: filter.typeLabel,
    p_role: filter.role,
    p_from: filter.dateFrom,
    p_to: filter.dateTo,
  };

  const supabase = await createClient();
  const [
    { data, error, count },
    { data: totalsData, error: totalsError },
    { data: byTypeData, error: byTypeError },
    { data: fleetData, error: fleetError },
    preferences,
  ] = await Promise.all([
    // ONE READ PATH, FILTERED OR NOT. The all-null argument set means "no
    // facet is filtered", so this is the whole logbook when nothing is
    // selected — which is what makes the unfiltered totals below agree
    // with pilot.logbook_totals by construction rather than by
    // coincidence. See 20260813110000_pilot_history.sql.
    logbookRpc(supabase, "logbook_filtered", filterArgs, { count: "exact" })
      .order("entry_date", { ascending: false })
      // A unique tiebreak, so a page boundary between two entries on the
      // same date is deterministic rather than duplicating one row and
      // dropping another between requests.
      .order("id", { ascending: false })
      .range(from, from + PAGE_SIZE - 1),
    // TOTALS COME FROM THE DATABASE, over every entry the filter admits.
    // Summing the page would make total time — the number an employer
    // and an underwriter ask for — a function of pagination. A career
    // pilot with 8,000 entries used to see a figure computed from the
    // most recent 1,000, and a filtered view narrow enough to feel small
    // is exactly where that mistake would look plausible.
    logbookRpc(supabase, "logbook_filtered_totals", filterArgs).maybeSingle(),
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
    // Fetched one past the summary panel's limit, AND far enough for the
    // filter's own picker — the panel still shows TYPE_ROW_LIMIT rows and
    // says so, but a picker that omitted a type would leave a pilot unable
    // to ask a question about hours they can see on the same screen.
    logbookFrom(supabase, "logbook_time_by_type")
      .select("*")
      .eq("account_id", account?.id ?? "")
      .order("total_time", { ascending: false })
      .order("type_label", { ascending: true })
      .limit(TYPE_PICKER_LIMIT),
    // The fleet, for the filter's aircraft picker. Archived airframes are
    // INCLUDED and marked: retiring an aeroplane takes it out of the
    // pickers for new work, it does not unfly the hours, and a pilot
    // asking "how much time did I have in the one I gave back" is exactly
    // the question a saved view is for.
    logbookFrom(supabase, "aircraft")
      .select("tail_number, tail_key, archived_at")
      .eq("account_id", account?.id ?? "")
      .order("tail_number", { ascending: true })
      .limit(FLEET_PICKER_LIMIT),
    loadPreferences(account.id),
  ]);

  const entries = (data ?? []) as LogbookEntryRow[];
  const totalsRow = totalsData as LogbookFilteredTotalsRow | null;
  // The RPC's own entry_count is preferred over the response's Content-Range
  // count: both are computed over the same filtered set, but the RPC's is
  // the figure the totals beside it were summed from, so the two can never
  // caption a page the other disagrees with. `count` is the fallback for a
  // failed totals read, and the page length is the last resort.
  const totalCount =
    totalsRow !== null ? Number(totalsRow.entry_count) : (count ?? entries.length);
  const pageCount = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  const filterLabel = describeLogbookFilter(
    filter,
    ((fleetData ?? []) as Pick<AircraftRow, "tail_number" | "tail_key">[]).find(
      (row) => row.tail_key === filter.tailKey
    )?.tail_number
  );

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
        // Its own figure, never folded into Total. The by-type table
        // below already reports it separately; the career cards used to
        // disagree with it by however many hours the pilot had in a box.
        simulator: Number(totalsRow.simulator_time),
      }
    : null;

  const byTypeRows = (byTypeData ?? []) as TimeByTypeRow[];
  const moreTypes = byTypeRows.length > TYPE_ROW_LIMIT;
  const byType = byTypeRows.slice(0, TYPE_ROW_LIMIT).map((row) => ({
    label: row.type_label,
    // AIRCRAFT time. The view reports simulator hours in their own column
    // and never adds them here — a pilot-history form asks for the two
    // separately, and a C560 credited with a recurrent session is the one
    // number this panel must not get wrong.
    total: Number(row.total_time),
    pic: Number(row.pic_time),
    sic: Number(row.sic_time),
    night: Number(row.night_time),
    simulator: Number(row.simulator_time),
    entries: Number(row.entry_count),
    registered: row.has_registered_aircraft === true,
  }));
  // "Unspecified" only earns a row when it is not the ONLY row. A pilot who
  // has never registered an airframe would otherwise get a table with one
  // line reading "Unspecified — all your hours", which is noise dressed as
  // a report; the prompt to build a fleet is the useful thing there.
  const hasTypeBreakdown = byType.some((row) => row.label !== "Unspecified");

  const tailOptions: TailOption[] = (
    (fleetData ?? []) as Pick<AircraftRow, "tail_number" | "tail_key" | "archived_at">[]
  ).map((row) => ({
    tailKey: row.tail_key,
    tailNumber: row.tail_number,
    archived: row.archived_at !== null,
  }));
  // Every type the pilot HAS hours in, not just the twelve the panel shows.
  // "Unspecified" is excluded from the picker: it is a bucket, not a type,
  // and a filter for it would ask a question ("show me the entries I never
  // labelled") that the aircraft screen answers far better.
  //
  // AND NOTHING THE RESOLVER WOULD REFUSE. logbook_entries.aircraft_type is
  // unconstrained text, so an imported logbook can carry a label longer
  // than resolveLogbookFilter accepts (MAX_TYPE_LABEL). Offering one would
  // mean the pilot picks a type, clicks "Show these entries", and gets the
  // whole logbook under career totals with the picker back on "Any type"
  // and nothing said — the question silently un-asked. Better the option is
  // absent than present and inert.
  const typeLabels = byTypeRows
    .map((row) => row.type_label)
    .filter(
      (label) => label !== "Unspecified" && label.trim().length <= MAX_TYPE_LABEL
    );

  return (
    <PageShell
      title="Logbook"
      subtitle={
        error
          ? "Couldn't load your logbook."
          : `${totalCount} entr${totalCount === 1 ? "y" : "ies"}${
              filtered ? ` matching ${filterLabel}` : ""
            }${pageCount > 1 ? ` · page ${page} of ${pageCount}` : ""}`
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
          <SavedViews
            views={preferences.logbookViews}
            activeFilter={filter}
            tails={tailOptions}
            typeLabels={typeLabels}
            saveAction={saveLogbookViewAction}
            deleteAction={deleteLogbookViewAction}
          />

          {/* A FAILED FLEET READ IS NOT AN EMPTY FLEET. Every other read on
              this screen says so when it fails; this one used to render as
              an aircraft picker with nothing in it and — with a tail filter
              active — a caption showing the normalised key instead of the
              registration, which reads exactly like an aeroplane that was
              deleted. */}
          {fleetError ? (
            <Callout.Root color="amber">
              <Callout.Icon>
                <ExclamationTriangleIcon />
              </Callout.Icon>
              <Callout.Text>
                Your aircraft couldn&rsquo;t be loaded, so the Aircraft
                picker above is empty and a tail filter shows as its plain
                key. Nothing has been removed from your fleet. Reload to
                try again.
              </Callout.Text>
            </Callout.Root>
          ) : null}

          {totalsError ? (
            <Callout.Root color="amber">
              <Callout.Icon>
                <ExclamationTriangleIcon />
              </Callout.Icon>
              <Callout.Text>
                {filtered
                  ? "The totals for this view couldn't be loaded, so they aren't shown. The entries below are still complete and correct."
                  : "Your career totals couldn't be loaded, so they aren't shown. The entries below are still complete and correct."}
              </Callout.Text>
            </Callout.Root>
          ) : null}

          {/* SAYS WHAT THE FIGURES BELOW ARE A TOTAL OF. A filtered set of
              stat cards that looks exactly like the career cards is the one
              way this feature could put a wrong number in front of a pilot
              about to fill in a form — the caption is what makes the two
              impossible to confuse. Totals only; nothing on this screen
              draws a conclusion from them. */}
          {filtered ? (
            <Text size="2" color="gray">
              {`Totals below cover ${filterLabel}: ${totalCount} entr${
                totalCount === 1 ? "y" : "ies"
              }, not your whole logbook.`}
            </Text>
          ) : null}

          <Grid columns={{ initial: "2", md: "6" }} gap="3">
            {(totals
              ? [
                  { label: "Total time", value: totals.total, decimals: 1 },
                  { label: "PIC", value: totals.pic, decimals: 1 },
                  { label: "Night", value: totals.night, decimals: 1 },
                  { label: "Instrument", value: totals.instrument, decimals: 1 },
                  { label: "Simulator", value: totals.simulator, decimals: 1 },
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

          {/* HIDDEN WHILE A FILTER IS ON. This panel is account-global —
              pilot.logbook_time_by_type takes no arguments — so leaving it
              up beside filtered stat cards would put two differently-scoped
              sets of hours on one screen with nothing but a caption
              between them. The pilot-history report is where the full
              breakdown belongs anyway. */}
          {entries.length > 0 && !filtered ? (
            <Card>
              <Flex direction="column" gap="3" p="1">
                <Flex justify="between" align="center" gap="3" wrap="wrap">
                  <Flex direction="column" gap="1">
                    <Heading as="h2" size="4">
                      Hours by type
                    </Heading>
                  </Flex>
                  <Button asChild variant="outline">
                    <NextLink href="/logbook/aircraft">Your aircraft</NextLink>
                  </Button>
                </Flex>

                {byTypeError ? (
                  <Callout.Root color="amber" size="1">
                    <Callout.Icon>
                      <ExclamationTriangleIcon />
                    </Callout.Icon>
                    <Callout.Text>
                      Your time in type couldn&rsquo;t be loaded just now, so
                      it isn&rsquo;t shown. Nothing is wrong with your entries.
                    </Callout.Text>
                  </Callout.Root>
                ) : hasTypeBreakdown ? (
                  <Table.Root variant="ghost">
                    <Table.Header>
                      <Table.Row>
                        <Table.ColumnHeaderCell>Type</Table.ColumnHeaderCell>
                        <Table.ColumnHeaderCell justify="end">Total</Table.ColumnHeaderCell>
                        <Table.ColumnHeaderCell justify="end">PIC</Table.ColumnHeaderCell>
                        <Table.ColumnHeaderCell justify="end">SIC</Table.ColumnHeaderCell>
                        <Table.ColumnHeaderCell justify="end">Night</Table.ColumnHeaderCell>
                        <Table.ColumnHeaderCell justify="end">Sim</Table.ColumnHeaderCell>
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
                              {row.sic.toFixed(1)}
                            </Text>
                          </Table.Cell>
                          <Table.Cell justify="end">
                            <Text color="gray" className="tnum">
                              {row.night.toFixed(1)}
                            </Text>
                          </Table.Cell>
                          {/* Its own column, never folded into Total. An
                              underwriter's pilot-history form asks for
                              simulator time separately, because it is not
                              time in the aircraft. */}
                          <Table.Cell justify="end">
                            <Text color="gray" className="tnum">
                              {row.simulator.toFixed(1)}
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

                {/* Said out loud rather than left to be noticed. Twelve rows
                    of forty, with the career total sitting directly above,
                    is how a pilot copies an incomplete pilot-history form
                    without ever seeing anything was missing. */}
                {moreTypes && !byTypeError ? (
                  <Text size="1" color="gray">
                    {`Showing the ${TYPE_ROW_LIMIT} types you have the most time in. `}
                    <Link asChild>
                      <NextLink href="/logbook/aircraft">See every type</NextLink>
                    </Link>
                  </Text>
                ) : null}
              </Flex>
            </Card>
          ) : null}

          <Card>
            {entries.length === 0 && totalCount === 0 && filtered ? (
              // Empty because of WHAT YOU ASKED FOR, which is a third
              // distinct state alongside "past the last page" and "no
              // entries at all". Telling a pilot with 8,000 entries "No
              // logbook entries yet" because they filtered to a tail they
              // have not flown would be the same class of false claim as
              // saying it after a failed read.
              <EmptyState
                as="h2"
                title="No entries match this view"
                action={
                  <Button asChild>
                    <NextLink href="/logbook">Show every entry</NextLink>
                  </Button>
                }
              >
                {`Nothing in your logbook matches ${filterLabel}. Your other entries are still there. This view just doesn't include any of them.`}
              </EmptyState>
            ) : entries.length === 0 && totalCount > 0 ? (
              // Empty because of WHERE YOU ARE, not because there is
              // nothing on file: ?page= is past the last page. Telling a
              // pilot with 8,000 entries "No logbook entries yet" here is
              // the same class of claim as saying it after a failed read.
              // `as="h2"`: on this screen the empty state IS the panel
              // heading, so it must not drop to h3 and skip a level.
              <EmptyState
                as="h2"
                title="Nothing on this page"
                action={
                  <Button asChild>
                    <NextLink href={logbookFilterHref(filter)}>
                      Back to the first page
                    </NextLink>
                  </Button>
                }
              >
                {`${
                  filtered ? `${totalCount} entr${totalCount === 1 ? "y" : "ies"} match this view` : `You have ${totalCount} entr${totalCount === 1 ? "y" : "ies"} on file`
                }. Page ${page} is past the last one, which is page ${pageCount}.`}
              </EmptyState>
            ) : entries.length === 0 ? (
              <EmptyState
                as="h2"
                title="No logbook entries yet"
                action={
                  <Button asChild>
                    <NextLink href="/logbook/new">Log your first entry</NextLink>
                  </Button>
                }
                secondaryAction={
                  <>
                    <Button asChild variant="outline">
                      <NextLink href="/logbook/drafts">Review trip drafts</NextLink>
                    </Button>
                    {/* Reachable before the first entry exists. The Hours by
                        type panel is the only other link to the fleet screen
                        and it renders only when there ARE entries, so a pilot
                        who wanted to set their aircraft up first had no path
                        to it at all. */}
                    <Button asChild variant="outline">
                      <NextLink href="/logbook/aircraft">Your aircraft</NextLink>
                    </Button>
                  </>
                }
              >
                This is your own copy of the 61.51 record: flight time, PIC and
                SIC, night, instrument and landings, per entry and totalled for a
                career. Log a flight by hand, or confirm the entries a completed
                trip proposes.
              </EmptyState>
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
              {/* THE FILTER TRAVELS WITH THE PAGE. Built through the same
                  pure helper the saved views and the picker use, so
                  paginating a view cannot silently drop back to the whole
                  logbook — which would show a pilot rows they did not ask
                  for under a caption saying otherwise. */}
              <Button asChild variant="soft" disabled={page <= 1}>
                <NextLink
                  href={logbookFilterHref(filter, page <= 2 ? undefined : page - 1)}
                >
                  Newer
                </NextLink>
              </Button>
              <Text size="2" color="gray">
                {`Showing ${from + 1} to ${Math.min(from + PAGE_SIZE, totalCount)} of ${totalCount}`}
              </Text>
              <Button asChild variant="soft" disabled={page >= pageCount}>
                <NextLink
                  href={logbookFilterHref(filter, Math.min(page + 1, pageCount))}
                >
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

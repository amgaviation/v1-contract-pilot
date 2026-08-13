import NextLink from "next/link";
import {
  Badge,
  Box,
  Button,
  Callout,
  Card,
  Flex,
  Heading,
  Link as RadixLink,
  Table,
  Text,
} from "@/components/ui";
import {
  ExclamationTriangleIcon,
  InfoCircledIcon,
} from "@radix-ui/react-icons";

import { createClient } from "@/lib/supabase/server";
import { requireAccount } from "@/lib/supabase/account";
import { formatDate } from "@/lib/format";
import { loadOptionLabels } from "@/lib/custom-options-read";
import { BRAND } from "@/lib/brand";
import PageShell from "../../page-shell";
import {
  compiledFromFooter,
  flagIsAnswerable,
  futureDatedNote,
  mixedProvenanceNote,
  todayIso,
  totalInstrument,
  totalLandings,
  totalTakeoffs,
  unattributedEntriesNote,
  unrecordedHoursNote,
  type BreakdownRow,
  type FlaggedHours,
  type PilotHistoryFigures,
} from "./report-lib";
import { loadPilotHistoryReport } from "./queries";

export const metadata = { title: "Pilot history" };

/**
 * The pilot-history report: the numbers an underwriter, a management
 * company or a chief pilot asks a contract pilot for, compiled from the
 * pilot's own logbook and their own documents.
 *
 * THE LINE, verbatim, and it governs every string on this page: pure
 * arithmetic over what the pilot logged and recorded; NO currency or
 * legality conclusion anywhere, no regulation references in user-facing
 * copy, no "current" or "qualified" wording. See report-lib.ts's header
 * for what that rules out concretely and why the currency engine — which
 * DOES reason about eligibility — ships dark behind its own gate rather
 * than leaking into a totals page.
 */
export default async function PilotHistoryReportPage() {
  const { account, user } = await requireAccount("/reports/pilot-history");

  const today = todayIso();
  const supabase = await createClient();
  const [report, kindLabels] = await Promise.all([
    loadPilotHistoryReport(supabase, account.id, user.id, today),
    // A tenant who renamed a document kind sees their own word here, the
    // same as on /documents — a report that disagreed with the screen it
    // was compiled from would be its own bug.
    loadOptionLabels("document_kind"),
  ]);

  const data = report.data;

  return (
    <PageShell
      title="Pilot history"
      subtitle="Your hours and your recorded dates, in the shape a history form asks for"
      action={
        data && data.ok ? (
          <>
            {/* Plain <a>, not a client-side link: these are file
                downloads, the same pattern as the logbook export and the
                invoice PDF. */}
            <Button asChild variant="outline">
              <a href="/reports/pilot-history/export?section=summary" download>
                Download (CSV)
              </a>
            </Button>
            <Button asChild>
              <a href="/reports/pilot-history/pdf">Download (PDF)</a>
            </Button>
          </>
        ) : null
      }
    >
      {/* LOAD-BEARING, and deliberately first — the same placement as the
          year-end and flight-time reports' framing callouts: what this
          page is and is not, above every figure on it. */}
      <Callout.Root color="blue" mb="4">
        <Callout.Icon>
          <InfoCircledIcon />
        </Callout.Icon>
        <Callout.Text>
          <Text as="div" weight="medium">
            Arithmetic on your own records — nothing more.
          </Text>
          <Text as="div" size="2">
            Every figure below is a sum of the hours you logged and a
            restatement of the dates you entered. This page draws no
            conclusion from them: it does not assess your experience
            against anyone&rsquo;s minimums, an insurer&rsquo;s, an
            operator&rsquo;s or anybody else&rsquo;s, and it does not tell
            you what you may or may not fly. Those judgements belong to
            whoever is asking for this form, under the certificate or the
            policy that governs. What this page is for is answering their
            questions from one place instead of a calculator and an evening
            with your logbook — and the numbers are exactly as complete as
            the records behind them.
          </Text>
        </Callout.Text>
      </Callout.Root>

      {report.error ? (
        <Card size="3">
          <Callout.Root color="red">
            <Callout.Icon>
              <ExclamationTriangleIcon />
            </Callout.Icon>
            {/* THE LOADER'S OWN SENTENCE, verbatim. Every value `error`
                can hold is written for the pilot (queries.ts logs the raw
                database detail and never passes it up), and each says which
                refusal this is: a fleet past its cap, a career past its
                cap, a read that could not be proven complete. Running them
                through friendlyDbError collapsed all of them to "Couldn't
                save that. Try again." — a sentence about writing, on a page
                that only reads, that threw away the one thing the pilot
                needed to know. */}
            <Callout.Text>{`Sorry — ${report.error}.`}</Callout.Text>
          </Callout.Root>
        </Card>
      ) : data && !data.ok ? (
        <Card size="3">
          <Heading as="h2" size="4" mb="2">
            No figures to state yet
          </Heading>
          <Text as="p" size="2" color="gray">
            Your logbook has no entries, so this page shows no totals — a
            column of 0.0-hour figures would be a claim about your flying
            that there is no record behind. Log a flight or import your
            history in{" "}
            <RadixLink asChild>
              <NextLink href="/logbook">Logbook</NextLink>
            </RadixLink>{" "}
            and the figures appear.
          </Text>
        </Card>
      ) : data ? (
        <Flex direction="column" gap="4">
          <Card size="3">
            <Box mb="3">
              <Heading as="h2" size="4">
                Flight time
              </Heading>
              <Text as="div" size="2" color="gray">
                {`Compiled ${formatDate(data.compiledOn)}. Your logbook runs from ${formatDate(
                  data.earliestEntryDate
                )} to ${formatDate(data.latestEntryDate)}. Simulator time is on its own line and is never added to a total — every hour above it is time in an aircraft.`}
              </Text>
              {/* Almost always a mistyped year. Said out loud, because the
                  entry is in the pilot's logbook and in none of these
                  figures, and they are the only person who can reconcile
                  the two. The wording is report-lib's, so the PDF and the
                  CSV carry the identical sentence — a caveat that appears
                  on the screen and not on the document that travels is the
                  discrepancy, not the fix. */}
              <Caveat text={futureDatedNote(data.futureDatedEntryCount)} />
              <Caveat
                text={unattributedEntriesNote(data.unattributedEntryCount)}
              />
            </Box>

            <Table.Root variant="ghost">
              <Table.Header>
                <Table.Row>
                  <Table.ColumnHeaderCell />
                  <Table.ColumnHeaderCell justify="end">
                    All time
                  </Table.ColumnHeaderCell>
                  <Table.ColumnHeaderCell justify="end">
                    <Text as="div">Last 12 months</Text>
                    <Text as="div" size="1" weight="regular" color="gray">
                      {data.lastTwelveMonths.window.label}
                    </Text>
                  </Table.ColumnHeaderCell>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {hourRows(data.allTime, data.lastTwelveMonths).map((row) => (
                  <Table.Row key={row.label}>
                    <Table.RowHeaderCell>
                      <Text as="div" weight={row.strong ? "medium" : "regular"}>
                        {row.label}
                      </Text>
                      {row.note ? (
                        <Text as="div" size="1" color="gray">
                          {row.note}
                        </Text>
                      ) : null}
                    </Table.RowHeaderCell>
                    <Table.Cell justify="end">
                      <Text
                        className="tnum"
                        weight={row.strong ? "medium" : "regular"}
                      >
                        {row.decimals === 0
                          ? row.allTime
                          : row.allTime.toFixed(1)}
                      </Text>
                    </Table.Cell>
                    <Table.Cell justify="end">
                      <Text className="tnum" color={row.strong ? undefined : "gray"}>
                        {row.decimals === 0
                          ? row.recent
                          : row.recent.toFixed(1)}
                      </Text>
                    </Table.Cell>
                  </Table.Row>
                ))}
              </Table.Body>
            </Table.Root>
          </Card>

          <Card size="3">
            <Box mb="3">
              <Heading as="h2" size="4">
                Turbine and retractable gear
              </Heading>
              <Text as="div" size="2" color="gray">
                Two lines rated separately on most history forms. Both come
                from what you recorded about each airframe in{" "}
                <RadixLink asChild>
                  <NextLink href="/logbook/aircraft">your aircraft</NextLink>
                </RadixLink>
                , so an aeroplane you have not annotated yet is counted as
                unrecorded rather than as a no.
              </Text>
            </Box>
            <Flex direction="column" gap="3">
              <FlagFigureRow
                label="Turbine time"
                figure={data.allTime.turbine}
                recentFigure={data.lastTwelveMonths.turbine}
              />
              <FlagFigureRow
                label="Retractable-gear time"
                figure={data.allTime.retractable}
                recentFigure={data.lastTwelveMonths.retractable}
              />
            </Flex>
          </Card>

          <BreakdownCard
            title="By category and class"
            caption="From the category and class you recorded against each airframe."
            rows={data.allTime.byCategoryClass}
            withheld={
              data.allTime.categoryClassUnrecorded
                ? "None of your aircraft has a category and class recorded, so there is nothing to break your hours down by yet. Add it on an aircraft and every hour already logged in it is counted under that class."
                : null
            }
          />

          <BreakdownCard
            title="By type"
            caption="Grouped by type rating where you have recorded one, so a rating that covers several models reads as one figure rather than as several short ones."
            rows={data.allTime.byType}
            withheld={null}
          />

          <BreakdownCard
            title="By aircraft"
            /* Per-airframe time answers "how much time do you have in MY
               aeroplane" — an owner's question, and their insurer's. It is
               NOT what an open-pilot warranty is written against: those
               clauses state minimums in total time, in make and model, and
               in turbine/retractable/multi time, none of which is time in
               one registration. Naming the wrong instrument beside a figure
               is the kind of error a professional reader spots instantly. */
            caption={`Per registered airframe — the figure an owner, or their insurer, asks for a specific aeroplane. ${
              data.registeredAircraftCount === 0
                ? "You have no aircraft on file yet."
                : `${data.registeredAircraftCount} aircraft on file.`
            }`}
            rows={data.allTime.byTail}
            withheld={null}
            showLastFlown
          />

          <Card size="3">
            <Box mb="3">
              <Heading as="h2" size="4">
                Recorded dates
              </Heading>
              <Text as="div" size="2" color="gray">
                Exactly as you entered them in{" "}
                <RadixLink asChild>
                  <NextLink href="/documents">Documents</NextLink>
                </RadixLink>
                . Nothing here is derived, checked against a registry, or
                calculated from another date — an expiry shown is one you
                typed, not one this page worked out.
              </Text>
            </Box>

            {data.recordedDates.length === 0 ? (
              <Text as="p" size="2" color="gray">
                You have no medical, flight review, proficiency check or
                certificate on file with a date on it. Add one and it
                appears here and on the downloads.
              </Text>
            ) : (
              <>
                <Table.Root variant="ghost">
                  <Table.Header>
                    <Table.Row>
                      <Table.ColumnHeaderCell>Document</Table.ColumnHeaderCell>
                      <Table.ColumnHeaderCell>Completed</Table.ColumnHeaderCell>
                      <Table.ColumnHeaderCell>Issued</Table.ColumnHeaderCell>
                      <Table.ColumnHeaderCell>
                        Expires (as you entered it)
                      </Table.ColumnHeaderCell>
                    </Table.Row>
                  </Table.Header>
                  <Table.Body>
                    {data.recordedDates.map((date, index) => (
                      <Table.Row key={`${date.kind}-${date.label}-${index}`}>
                        <Table.RowHeaderCell>
                          <Flex align="center" gap="2" wrap="wrap">
                            <Text weight="medium">{date.label}</Text>
                            <Badge color="gray" variant="outline">
                              {kindLabels[date.kind] ?? date.kind}
                            </Badge>
                            {date.attribution === "unattributed" ? (
                              <Badge color="amber" variant="outline">
                                No airman recorded
                              </Badge>
                            ) : null}
                          </Flex>
                        </Table.RowHeaderCell>
                        <Table.Cell>
                          <Text size="2" color="gray">
                            {formatDate(date.completedOn)}
                          </Text>
                        </Table.Cell>
                        <Table.Cell>
                          <Text size="2" color="gray">
                            {formatDate(date.issuedOn)}
                          </Text>
                        </Table.Cell>
                        <Table.Cell>
                          <Text size="2" color="gray">
                            {formatDate(date.expiresOn)}
                          </Text>
                        </Table.Cell>
                      </Table.Row>
                    ))}
                  </Table.Body>
                </Table.Root>
                {data.hasUnattributedDates ? (
                  <Text as="p" size="1" color="gray" mt="2">
                    A document marked &ldquo;No airman recorded&rdquo; is on
                    this account without saying whose it is. It is listed
                    because it is almost certainly yours on a single-pilot
                    account — but this page will not assert that for you.
                    Open the document and record the airman to remove the
                    mark.
                  </Text>
                ) : null}
              </>
            )}
          </Card>

          <Text as="p" size="1" color="gray">
            {compiledFromFooter(BRAND.name)}
          </Text>
        </Flex>
      ) : null}
    </PageShell>
  );
}

// ---------------------------------------------------------------------------
// Presentation helpers. No arithmetic beyond report-lib's own exports —
// a figure computed here would be a figure the tests never see.
// ---------------------------------------------------------------------------

/**
 * A caveat that qualifies a figure — rendered only when report-lib has one
 * to make, so a page with nothing to caveat carries no empty apologies.
 * The sentences themselves live in report-lib.ts, beside the arithmetic,
 * because the PDF and the CSV print the identical ones.
 */
function Caveat({
  text,
  color = "amber",
}: {
  text: string | null;
  color?: React.ComponentProps<typeof Text>["color"];
}) {
  if (text === null) return null;
  return (
    <Text as="div" size="1" color={color}>
      {text}
    </Text>
  );
}

type HourRow = {
  label: string;
  note?: string;
  allTime: number;
  recent: number;
  decimals: 0 | 1;
  strong?: boolean;
};

function hourRows(
  allTime: PilotHistoryFigures,
  recent: PilotHistoryFigures
): HourRow[] {
  const a = allTime.hours;
  const r = recent.hours;
  return [
    {
      label: "Total time",
      note: "Time in an aircraft. Simulator hours are below, never in here.",
      allTime: a.total,
      recent: r.total,
      decimals: 1,
      strong: true,
    },
    { label: "PIC", allTime: a.pic, recent: r.pic, decimals: 1, strong: true },
    { label: "SIC", allTime: a.sic, recent: r.sic, decimals: 1, strong: true },
    { label: "Solo", allTime: a.solo, recent: r.solo, decimals: 1 },
    {
      label: "Dual received",
      allTime: a.dualReceived,
      recent: r.dualReceived,
      decimals: 1,
    },
    {
      label: "Instructor given",
      allTime: a.instructorGiven,
      recent: r.instructorGiven,
      decimals: 1,
    },
    {
      label: "Cross country",
      allTime: a.crossCountry,
      recent: r.crossCountry,
      decimals: 1,
    },
    { label: "Night", allTime: a.night, recent: r.night, decimals: 1 },
    {
      label: "Instrument — actual",
      allTime: a.instrumentActual,
      recent: r.instrumentActual,
      decimals: 1,
    },
    {
      label: "Instrument — simulated",
      allTime: a.instrumentSimulated,
      recent: r.instrumentSimulated,
      decimals: 1,
    },
    {
      label: "Instrument — total",
      note: "Actual and simulated added together, for a form that asks for one figure.",
      allTime: totalInstrument(a),
      recent: totalInstrument(r),
      decimals: 1,
    },
    {
      label: "Simulator",
      note: "Its own line. Time in a training device is not time in an aircraft, and every form asks for the two separately.",
      allTime: a.simulator,
      recent: r.simulator,
      decimals: 1,
      strong: true,
    },
    {
      label: "Takeoffs",
      allTime: totalTakeoffs(a),
      recent: totalTakeoffs(r),
      decimals: 0,
    },
    {
      label: "Landings",
      allTime: totalLandings(a),
      recent: totalLandings(r),
      decimals: 0,
    },
    {
      label: "Night landings",
      allTime: a.nightLandingsFullStop + a.nightLandingsTouchGo,
      recent: r.nightLandingsFullStop + r.nightLandingsTouchGo,
      decimals: 0,
    },
    {
      label: "Logbook entries",
      allTime: a.entryCount,
      recent: r.entryCount,
      decimals: 0,
    },
  ];
}

/**
 * A three-state figure rendered as three states.
 *
 * The withheld case is the point of this component: when no airframe in
 * the fleet records the flag, `hours` is arithmetically 0.0 and printing
 * it would be a confident, wrong answer on a form. It says so instead.
 */
function FlagFigureRow({
  label,
  figure,
  recentFigure,
}: {
  label: string;
  figure: FlaggedHours;
  recentFigure: FlaggedHours;
}) {
  if (!flagIsAnswerable(figure)) {
    return (
      <Box>
        <Text as="div" weight="medium">
          {label}
        </Text>
        <Text as="div" size="2" color="gray">
          Not recorded. None of your aircraft says one way or the other, so
          there is no figure to give — and a 0.0 here would read as an
          answer rather than as a blank.
        </Text>
      </Box>
    );
  }
  return (
    <Box>
      <Flex align="baseline" gap="3" wrap="wrap">
        <Text as="span" weight="medium">
          {label}
        </Text>
        <Text as="span" size="5" weight="bold" className="tnum">
          {figure.hours.toFixed(1)}
        </Text>
        <Text as="span" size="2" color="gray" className="tnum">
          {`${recentFigure.hours.toFixed(1)} in the last 12 months`}
        </Text>
      </Flex>
      {/* THE SHORTFALL NAMES ITS WINDOW. Beside a last-12-months figure, an
          unlabelled all-time shortfall qualifies a number the reader is not
          looking at. */}
      <Caveat text={unrecordedHoursNote(figure, recentFigure)} />
    </Box>
  );
}

function BreakdownCard({
  title,
  caption,
  rows,
  withheld,
  showLastFlown,
}: {
  title: string;
  caption: string;
  rows: BreakdownRow[];
  /** Non-null → the section has nothing honest to say; this sentence is
   *  rendered instead of a table of one meaningless row. */
  withheld: string | null;
  showLastFlown?: boolean;
}) {
  return (
    <Card size="3">
      <Box mb="3">
        <Heading as="h2" size="4">
          {title}
        </Heading>
        <Text as="div" size="2" color="gray">
          {caption}
        </Text>
      </Box>

      {withheld !== null ? (
        <Text as="p" size="2" color="gray">
          {withheld}
        </Text>
      ) : rows.length === 0 ? (
        <Text as="p" size="2" color="gray">
          Nothing to show here yet.
        </Text>
      ) : (
        <Table.Root variant="ghost">
          <Table.Header>
            <Table.Row>
              <Table.ColumnHeaderCell>{title.replace("By ", "")}</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell justify="end">Total</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell justify="end">PIC</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell justify="end">SIC</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell justify="end">Night</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell justify="end">Sim</Table.ColumnHeaderCell>
              {showLastFlown ? (
                <Table.ColumnHeaderCell justify="end">
                  Last flown
                </Table.ColumnHeaderCell>
              ) : null}
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {rows.map((row) => (
              <Table.Row key={row.label}>
                <Table.RowHeaderCell>
                  <Flex align="center" gap="2" wrap="wrap">
                    <Text weight="medium">{row.label}</Text>
                    {/* Says WHY a row reads the way it does. Hours logged
                        against an aeroplane that is not on file are still
                        counted — they are just grouped by what was typed
                        on the entry rather than by an airframe. A row can
                        hold both kinds, so the badge marks the rows with
                        NO airframe behind them and the note below marks
                        the mixed ones. */}
                    {row.registered ? null : (
                      <Badge color="gray" variant="outline">
                        No aircraft on file
                      </Badge>
                    )}
                  </Flex>
                  {row.sublabel ? (
                    <Text as="div" size="1" color="gray">
                      {row.sublabel}
                    </Text>
                  ) : null}
                  <Caveat text={mixedProvenanceNote(row)} color="gray" />
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
                <Table.Cell justify="end">
                  <Text color="gray" className="tnum">
                    {row.simulator.toFixed(1)}
                  </Text>
                </Table.Cell>
                {showLastFlown ? (
                  <Table.Cell justify="end">
                    <Text color="gray" size="2">
                      {formatDate(row.lastFlownOn)}
                    </Text>
                  </Table.Cell>
                ) : null}
              </Table.Row>
            ))}
          </Table.Body>
        </Table.Root>
      )}
    </Card>
  );
}

import NextLink from "next/link";
import {
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
import { friendlyDbError } from "@/lib/db-errors";
import PageShell from "../../page-shell";
import { flightTimeWindows, todayIso } from "./report-lib";
import { loadFlightTimeReport } from "./queries";

export const metadata = { title: "Flight time" };

/**
 * Cross-operator flight-time totals in 14 CFR 135.267's own windows.
 * TOTALS ONLY — no legality verdicts, no remaining-hours math; see
 * report-lib.ts's header for the verified reg text (retrieved 2026-08-11)
 * and the design decisions, and docs/LAUNCH-GATES.md for why verdict
 * wording sits behind the counsel gate.
 */
export default async function FlightTimeReportPage() {
  const { account } = await requireAccount("/reports/flight-time");

  const windows = flightTimeWindows(todayIso());
  const supabase = await createClient();
  const report = await loadFlightTimeReport(supabase, account.id, windows);

  // Only offered once there are figures to hand someone — an empty logbook
  // has nothing this report can honestly export, matching the "no
  // figures, never a page of 0.0s" rule the screen itself follows.
  const canExport = report.data && report.data.ok;

  return (
    <PageShell
      title="Flight time"
      subtitle="Cross-operator totals · 14 CFR 135.267"
      action={
        canExport ? (
          <Button asChild variant="outline" size="2">
            <a href="/reports/flight-time/export" download>
              Download CSV
            </a>
          </Button>
        ) : undefined
      }
    >
      {/* LOAD-BEARING, deliberately first — the same placement as the
          year-end report's framing callout: what this page is and is not,
          above every figure on it. */}
      <Callout.Root color="blue" mb="4">
        <Callout.Icon>
          <InfoCircledIcon />
        </Callout.Icon>
        <Callout.Text>
          <Text as="div" weight="medium">
            Your own cross-operator picture: totals, not a legality call.
          </Text>
          <Text as="div" size="2">
            14 CFR 135.267 limits how much a flight crewmember can fly
            commercially, counting every operator together: 500 hours in
            any calendar quarter, 800 hours in any two consecutive
            calendar quarters, 1,400 hours in any calendar year, and a
            separate limit on hours in any 24 consecutive hours on the
            day of flight. (135.267(a), (b), current text retrieved 11
            AUG 2026) Because those limits count your flying for every
            operator, plus any other commercial flying, no single
            operator can see the whole picture from their own records.
            This page computes it from your own logbook, so you can
            answer the &ldquo;what else have you flown&rdquo; question a
            certificate holder must ask before assigning you. Whether an
            assignment may be accepted is decided under the assigning
            operator&rsquo;s certificate and the regulation, never by
            this page. This page states totals only.
          </Text>
        </Callout.Text>
      </Callout.Root>

      {report.error ? (
        <Card size="3">
          <Callout.Root color="red">
            <Callout.Icon>
              <ExclamationTriangleIcon />
            </Callout.Icon>
            <Callout.Text>
              {friendlyDbError({ message: report.error }, "flight-time.load")}
            </Callout.Text>
          </Callout.Root>
        </Card>
      ) : report.data && !report.data.ok ? (
        <Card size="3">
          <Heading as="h2" size="4" mb="2">
            No figures to state yet
          </Heading>
          <Text as="p" size="2" color="gray">
            Your logbook has no entries, so this page shows no totals. A
            row of 0.0-hour figures would claim something about your
            flying with no record behind it. Log a flight or import your
            history in{" "}
            <RadixLink asChild>
              <NextLink href="/logbook">Logbook</NextLink>
            </RadixLink>{" "}
            and the totals appear.
          </Text>
        </Card>
      ) : report.data ? (
        <Flex direction="column" gap="4">
          <Card size="3">
            <Flex justify="between" align="start" mb="3" wrap="wrap" gap="2">
              <Box>
                <Heading as="h2" size="4">
                  Logged flight time, by 135.267 window
                </Heading>
                <Text as="div" size="2" color="gray">
                  Every logbook entry&rsquo;s aircraft time, by the
                  entry&rsquo;s own date. Simulator sessions are excluded.
                  Your logbook covers{" "}
                  {formatDate(report.data.earliestEntryDate)} to today.
                </Text>
              </Box>
            </Flex>

            <Table.Root variant="ghost">
              <Table.Header>
                <Table.Row>
                  <Table.ColumnHeaderCell>Window</Table.ColumnHeaderCell>
                  <Table.ColumnHeaderCell>Dates</Table.ColumnHeaderCell>
                  <Table.ColumnHeaderCell justify="end">
                    Hours
                  </Table.ColumnHeaderCell>
                  <Table.ColumnHeaderCell justify="end">
                    Entries
                  </Table.ColumnHeaderCell>
                  <Table.ColumnHeaderCell>Coverage</Table.ColumnHeaderCell>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {report.data.figures.map((figure) => (
                  <Table.Row key={figure.window.key}>
                    <Table.RowHeaderCell>
                      <Text as="div">{figure.window.label}</Text>
                      <Text as="div" size="1" color="gray">
                        {figure.window.citation}
                      </Text>
                    </Table.RowHeaderCell>
                    <Table.Cell>
                      <Text color="gray" size="2">
                        {formatDate(figure.window.from)} to{" "}
                        {formatDate(figure.window.to)}
                      </Text>
                    </Table.Cell>
                    <Table.Cell justify="end">
                      <Text className="tnum" weight="medium">
                        {figure.hours.toFixed(1)}
                      </Text>
                    </Table.Cell>
                    <Table.Cell justify="end">
                      <Text className="tnum" color="gray">
                        {figure.entryCount}
                      </Text>
                    </Table.Cell>
                    <Table.Cell>
                      {figure.coverageGapFrom ? (
                        <Text size="1" color="amber">
                          Your logbook&rsquo;s earliest entry is{" "}
                          {formatDate(figure.coverageGapFrom)}. Flying
                          before that isn&rsquo;t in this figure, so it
                          can&rsquo;t be read as the window&rsquo;s full
                          total.
                        </Text>
                      ) : (
                        <Text size="1" color="gray">
                          Logbook coverage spans the full window.
                        </Text>
                      )}
                    </Table.Cell>
                  </Table.Row>
                ))}
              </Table.Body>
            </Table.Root>
          </Card>

          <Card size="3">
            <Heading as="h2" size="4" mb="2">
              How to read these figures
            </Heading>
            <Flex direction="column" gap="2">
              <Text as="p" size="2" color="gray">
                <Text as="span" size="2" weight="medium">
                  Block time, counted whole.
                </Text>{" "}
                Trip-derived entries log block time (out to in), which runs
                equal to or slightly longer than flight time as 14 CFR 1.1
                defines it. Your logbook also doesn&rsquo;t separate
                commercial from personal flying, so both are included. Each
                approximation pushes these totals higher, never lower, than
                the regulation&rsquo;s own basis.
              </Text>
              <Text as="p" size="2" color="gray">
                <Text as="span" size="2" weight="medium">
                  The three-calendar-day row stands in for the 24-hour
                  window.
                </Text>{" "}
                Logbook entries carry a date, not takeoff and landing
                times, so a clock-exact 24-consecutive-hour total
                can&rsquo;t be computed from them. The first row totals
                your last three calendar days instead. That span contains
                every 24-hour window ending now, no matter which timezone
                you log dates in, so it can only over-cover flying, never
                miss it.
              </Text>
              <Text as="p" size="2" color="gray">
                <Text as="span" size="2" weight="medium">
                  Keep the logbook current to keep this current.
                </Text>{" "}
                These totals are exactly as complete as your logbook.
                Flying you haven&rsquo;t logged yet isn&rsquo;t in them.
              </Text>
            </Flex>
          </Card>
        </Flex>
      ) : null}
    </PageShell>
  );
}

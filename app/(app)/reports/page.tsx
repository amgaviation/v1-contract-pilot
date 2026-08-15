import NextLink from "next/link";
import { Card, Flex, Heading, Link as RadixLink, Text } from "@/components/ui";
import { requireAccount } from "@/lib/supabase/account";
import PageShell from "../page-shell";

export const metadata = { title: "Reports" };

// An index of the product's reports. Previously this redirected straight
// to /reports/year-end, the only report that existed; now that
// /reports/quarterly exists too, /reports has to actually list both
// rather than pick one for the pilot.
export default async function ReportsIndexPage() {
  await requireAccount("/reports");

  return (
    <PageShell title="Reports">
      {/* Three groups, same label idiom as overview/page.tsx's KPI rows
          (<Text size="1" color="gray" weight="medium"> over a <section
          aria-label>): nine identical cards in one column read as a wall
          rather than a menu, and a pilot reaching for "what do I owe this
          quarter" had to read past a balance sheet to find it. */}
      <Flex direction="column" gap="5">
        <Flex direction="column" gap="3" asChild>
          <section aria-label="Tax">
            <Text size="1" color="gray" weight="medium">
              Tax
            </Text>
            <Card size="3">
              <Heading as="h2" size="4" mb="1">
                <RadixLink asChild>
                  <NextLink href="/reports/year-end">Year-end report</NextLink>
                </RadixLink>
              </Heading>
              <Text as="div" size="2" color="gray">
                Income, deductions, and 1099 reconciliation for a full tax year.
              </Text>
            </Card>
            <Card size="3">
              <Heading as="h2" size="4" mb="1">
                <RadixLink asChild>
                  <NextLink href="/reports/quarterly">
                    Quarterly estimated tax
                  </NextLink>
                </RadixLink>
              </Heading>
              <Text as="div" size="2" color="gray">
                Cash-basis profit for each IRS estimated-tax period, with a
                set-aside planner.
              </Text>
            </Card>
            <Card size="3">
              <Heading as="h2" size="4" mb="1">
                <RadixLink asChild>
                  <NextLink href="/reports/sales-tax">Sales tax</NextLink>
                </RadixLink>
              </Heading>
              <Text as="div" size="2" color="gray">
                Tax charged on your invoices and collected in a period, for
                whoever prepares your filings.
              </Text>
            </Card>
          </section>
        </Flex>

        <Flex direction="column" gap="3" asChild>
          <section aria-label="Money">
            <Text size="1" color="gray" weight="medium">
              Money
            </Text>
            <Card size="3">
              <Heading as="h2" size="4" mb="1">
                <RadixLink asChild>
                  <NextLink href="/reports/profit-loss">Profit &amp; loss</NextLink>
                </RadixLink>
              </Heading>
              <Text as="div" size="2" color="gray">
                Income and expenses by year, quarter, or month, compared
                against the prior period.
              </Text>
            </Card>
            <Card size="3">
              <Heading as="h2" size="4" mb="1">
                <RadixLink asChild>
                  <NextLink href="/reports/trip-pl">Trip profitability</NextLink>
                </RadixLink>
              </Heading>
              <Text as="div" size="2" color="gray">
                What each trip and each client billed, what it cost you, and
                the margin per day. Invoiced, not collected.
              </Text>
            </Card>
            <Card size="3">
              <Heading as="h2" size="4" mb="1">
                <RadixLink asChild>
                  <NextLink href="/reports/balance-sheet">Balance sheet</NextLink>
                </RadixLink>
              </Heading>
              <Text as="div" size="2" color="gray">
                What you own and owe as of a date: cash, receivables, tax
                collected, and owner equity, from your ledger.
              </Text>
            </Card>
            <Card size="3">
              <Heading as="h2" size="4" mb="1">
                <RadixLink asChild>
                  <NextLink href="/reports/cash-flow">Cash flow</NextLink>
                </RadixLink>
              </Heading>
              <Text as="div" size="2" color="gray">
                Where cash actually came from and went in a period, derived from
                your ledger&rsquo;s Cash &amp; bank account.
              </Text>
            </Card>
          </section>
        </Flex>

        <Flex direction="column" gap="3" asChild>
          <section aria-label="Flying">
            <Text size="1" color="gray" weight="medium">
              Flying
            </Text>
            <Card size="3">
              <Heading as="h2" size="4" mb="1">
                <RadixLink asChild>
                  <NextLink href="/reports/flight-time">Flight time</NextLink>
                </RadixLink>
              </Heading>
              <Text as="div" size="2" color="gray">
                Cross-operator flight-time totals in 14 CFR 135.267&rsquo;s
                windows: the picture no single operator can see.
              </Text>
            </Card>
            {/* Sits beside Flight time as the second logbook-derived report.
                The two answer different questions from the same record: that
                one totals a regulation's windows for an operator about to
                assign a trip, this one fills in the form an underwriter or a
                chief pilot hands over before any of that. */}
            <Card size="3">
              <Heading as="h2" size="4" mb="1">
                <RadixLink asChild>
                  <NextLink href="/reports/pilot-history">Pilot history</NextLink>
                </RadixLink>
              </Heading>
              <Text as="div" size="2" color="gray">
                Total time, PIC and SIC, time by type and by airframe, and the
                dates on your paperwork: what an insurance or operator history
                form asks for, ready to download.
              </Text>
            </Card>
          </section>
        </Flex>
      </Flex>
    </PageShell>
  );
}

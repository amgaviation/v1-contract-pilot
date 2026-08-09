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
      <Flex direction="column" gap="3">
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
              <NextLink href="/reports/profit-loss">Profit &amp; loss</NextLink>
            </RadixLink>
          </Heading>
          <Text as="div" size="2" color="gray">
            Income and expenses by year, quarter, or month, compared
            against the prior period.
          </Text>
        </Card>
      </Flex>
    </PageShell>
  );
}

import { redirect } from "next/navigation";
import NextLink from "next/link";
import { Box, Button, Card, Container, Flex, Grid, Heading, Section, Text } from "@/components/ui";
import { BRAND } from "@/lib/brand";
import { getSessionContext } from "@/lib/supabase/account";

// Kept in sync by hand with app/(auth)/welcome/page.tsx's PRICE_LABEL and
// app/(auth)/welcome/welcome-actions.tsx's trial copy — the Stripe Price
// behind STRIPE_PRICE_ID_SOLO is what actually charges the card, and
// docs/LAUNCH-GATES.md G2 already tracks these hand-synced strings as a
// named table (three entries; this file and pricing/page.tsx make five).
// docs/PRICING.md proposes a different number, $39, but it is explicitly
// unconfirmed ("PROPOSAL. Nothing here is decided.") — this page prints
// only the number the product is actually configured and wired to charge
// today, never the proposal.
const PRICE_LABEL = "$29/month";
const TRIAL_LABEL = "7-day free trial";

const FEATURES: { title: string; body: string }[] = [
  {
    title: "Trips",
    body: "Every job is one trip record — flight days, travel days, and the client attached to it. Your logbook entries, your invoice, and your expenses all draw from the same trip instead of three separate re-entries of the same dates.",
  },
  {
    title: "Invoicing",
    body: "Build an invoice straight from the trips you've flown. Flight days, travel days, and rebilled expenses become line items automatically, and a payment link lets your client pay online. Recurring invoices are there for standing clients.",
  },
  {
    title: "Expenses",
    body: "Scan a receipt right in your browser — nothing leaves your device until you save it — or import a bank or card statement and tag each line rebill or deduct.",
  },
  {
    title: "Logbook",
    body: "Log a flight by hand, or import your history from ForeFlight, LogTen Pro, or any CSV export. Legs from trips you've flown draft themselves, ready for your review before anything is saved.",
  },
  {
    title: "Clients & documents",
    body: "Keep your client roster and W-9 status in one place, and track the dates you enter for your certificates, medical, flight reviews, and insurance — with a reminder as each one approaches.",
  },
  {
    title: "Reports",
    body: "Profit & loss, a quarterly estimated-tax summary, and a year-end report, built from what you've actually recorded — for you or for whoever does your taxes.",
  },
];

/**
 * The public front door. "/" moved here from app/(app)/page.tsx (now
 * app/(app)/overview/page.tsx) because that file's route group is wrapped,
 * unconditionally, by app/(app)/layout.tsx's requireAccount() — there is
 * no way to make one route inside a gated layout render for a signed-out
 * visitor, so the only page that CAN be public at "/" is one that lives
 * outside that group entirely. This is that page.
 *
 * A signed-in visitor should still land on the Overview dashboard they get
 * today, so that case is handled here explicitly, before any marketing
 * copy renders: provisioned account -> /overview (the same screen, new
 * URL); signed in with no account yet -> /welcome, exactly what
 * requireAccount() would have done. Only a genuinely signed-out visitor
 * reaches the return below.
 */
export default async function LandingPage() {
  const ctx = await getSessionContext();
  if (ctx?.account) redirect("/overview");
  if (ctx) redirect("/welcome");

  return (
    <>
      <Section size="3">
        <Container size="3" px="4">
          <Flex direction="column" gap="5" align="start">
            <Flex direction="column" gap="3">
              <Heading size="8" trim="start">
                {BRAND.tagline}
              </Heading>
              <Text size="4" color="gray" style={{ maxWidth: "38rem" }}>
                {BRAND.name} turns a flown trip into your logbook entry, your
                invoice, and your expense records — one entry, three
                outputs. Built for the independent contract pilot who
                currently keeps this in a logbook app, a spreadsheet, and
                QuickBooks.
              </Text>
            </Flex>

            <Flex gap="3" wrap="wrap">
              <Button asChild size="3">
                <NextLink href="/signup">Start your {TRIAL_LABEL}</NextLink>
              </Button>
              <Button asChild size="3" variant="outline" color="gray">
                <NextLink href="/pricing">See pricing</NextLink>
              </Button>
            </Flex>

            <Text size="1" color="gray">
              {PRICE_LABEL} after the trial. Card required to start.
            </Text>
          </Flex>
        </Container>
      </Section>

      <Section size="3" style={{ borderTop: "1px solid var(--gray-a5)" }}>
        <Container size="3" px="4">
          <Flex direction="column" gap="5">
            <Heading size="5" trim="start">
              What's built
            </Heading>
            <Grid columns={{ initial: "1", sm: "2" }} gap="4">
              {FEATURES.map((feature) => (
                <Card key={feature.title} size="3">
                  <Flex direction="column" gap="2">
                    <Text size="3" weight="medium">
                      {feature.title}
                    </Text>
                    <Text size="2" color="gray">
                      {feature.body}
                    </Text>
                  </Flex>
                </Card>
              ))}
            </Grid>
          </Flex>
        </Container>
      </Section>

      <Section size="3">
        <Container size="3" px="4">
          <Box
            p={{ initial: "5", sm: "7" }}
            style={{ background: "var(--v1-marketing-navy)" }}
          >
            <Flex
              direction={{ initial: "column", sm: "row" }}
              align={{ initial: "start", sm: "center" }}
              justify="between"
              gap="4"
            >
              <Flex direction="column" gap="1">
                <Text size="5" weight="medium" style={{ color: "var(--v1-marketing-navy-ink)" }}>
                  Ready to try it on your next trip?
                </Text>
                <Text size="2" style={{ color: "var(--v1-marketing-navy-ink)" }}>
                  {TRIAL_LABEL}, {PRICE_LABEL} after. Card required to start.
                </Text>
              </Flex>
              <Button asChild size="3">
                <NextLink href="/signup">Start free trial</NextLink>
              </Button>
            </Flex>
          </Box>
        </Container>
      </Section>
    </>
  );
}

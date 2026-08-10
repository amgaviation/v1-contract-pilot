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
    // "Your dashboard shows" and not "we remind you", deliberately. The
    // 30/14/7/1/overdue ladder is real — pilot.expirations computes it once and
    // both the dashboard and the documents screen badge from it — but there is
    // no scheduler, no mailer and no push anywhere in this product, so nothing
    // REACHES a pilot who has not opened the app. A review caught the earlier
    // wording promising "a reminder as each one approaches": the kind of claim
    // a pilot only discovers is false by missing a medical.
    // The dashboard panel is filtered to medical, flight review and passport,
    // so naming four kinds and then saying "your dashboard shows what is
    // coming due" was true of two of them. The documents screen carries every
    // kind; only the dashboard summary is narrower. Both facts, stated
    // separately, because a pilot who takes the wider claim at face value
    // finds out by missing an insurance renewal.
    body: "Keep your client roster and W-9 status in one place, and record expiry dates for the documents you carry — certificates, medical, flight reviews, insurance. The documents screen tracks them all; your dashboard summarises medical, flight review and passport, from a month out down to overdue.",
  },
  {
    title: "Reports",
    // No directional tax claim, and nothing implying the output is a filing or
    // a substitute for one. It summarises what the pilot recorded; what that
    // means for their return is between them and whoever prepares it.
    // "Each IRS estimated-tax period" rather than "quarterly": the periods are
    // Jan-Mar, Apr-May, Jun-Aug and Sep-Dec, which is a 3/2/3/4 split, and two
    // of them are not quarters. The report follows the real periods; the copy
    // should say so, since an accountant reads this and notices.
    body: "Profit & loss, a summary of income and deductible expenses for each IRS estimated-tax period, and a year-end report, built from what you've actually recorded — for you or for whoever prepares your taxes.",
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
      <Section size="2">
        <Container size="3" px="4">
          <Flex direction="column" gap="4" align="start">
            <Flex direction="column" gap="3">
              <Heading size="8" trim="start">
                {BRAND.tagline}
              </Heading>
              {/*
                The earlier line said "one entry, three outputs", counting
                expense records as the third. A review checked and nothing in
                this product creates an expense from a trip: expenses come from
                the pilot, a scanned receipt, or a bank import, and the trip is
                what they ATTACH to. Two things are generated and one is
                organised, so that is what this says. The honest version is
                still the whole pitch — it is the re-typing that goes away.
              */}
              <Text size="4" color="gray" style={{ maxWidth: "38rem" }}>
                {BRAND.name} makes the trip the record everything else hangs
                off. Your logbook draft and your invoice lines both come from
                it, and your receipts attach to it, so the dates and the tail
                number get typed once instead of three times. Built for the
                independent contract pilot who currently keeps this in a
                logbook app, a spreadsheet, and QuickBooks.
              </Text>
            </Flex>

            {/* Navy, not the Theme's accent blue: this brand colour isn't
                one of Radix's accentColor scale names, so the primary
                action is set directly through --v1-marketing-navy and
                --v1-marketing-navy-ink, the same pair the CTA band below
                uses for its own panel. */}
            <Flex gap="3" wrap="wrap">
              <Button
                asChild
                size="3"
                style={{ background: "var(--v1-marketing-navy)", color: "var(--v1-marketing-navy-ink)" }}
              >
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

      <Section size="2" style={{ borderTop: "1px solid var(--gray-a5)" }}>
        <Container size="3" px="4">
          <Flex direction="column" gap="4">
            <Heading size="5" trim="start">
              What's built
            </Heading>
            <Grid columns={{ initial: "1", sm: "2" }} gap="4">
              {FEATURES.map((feature) => (
                <Card key={feature.title} size="2">
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

      <Section size="2">
        <Container size="3" px="4">
          <Box
            p={{ initial: "4", sm: "5" }}
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
              {/* Inverted from the hero/header/pricing buttons: this one
                  sits on the navy Box itself, so the fill is navy-ink
                  (white) and the text is navy, not navy on navy. */}
              <Button
                asChild
                size="3"
                style={{ background: "var(--v1-marketing-navy-ink)", color: "var(--v1-marketing-navy)" }}
              >
                <NextLink href="/signup">Start free trial</NextLink>
              </Button>
            </Flex>
          </Box>
        </Container>
      </Section>
    </>
  );
}

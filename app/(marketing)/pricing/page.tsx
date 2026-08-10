import NextLink from "next/link";
import { Button, Card, Container, Flex, Heading, Section, Text } from "@/components/ui";

export const metadata = { title: "Pricing" };

// Kept in sync by hand with app/(auth)/welcome/page.tsx's PRICE_LABEL and
// app/(marketing)/page.tsx's copy of the same string — see that file's
// comment for why this page prints $29, not the $39 docs/PRICING.md
// proposes. docs/LAUNCH-GATES.md G2 is the standing record of which price
// is actually confirmed; this string does not move until that gate does,
// and the Stripe Price behind STRIPE_PRICE_ID_SOLO remains the number
// that's actually charged either way.
const PRICE_LABEL = "$29";
const TRIAL_DAYS = 7;

const INCLUDED = [
  "Trips — flight days, travel days, and the client attached to each one",
  "Invoicing from your trips, plus recurring invoices and an online payment link for your client",
  "Receipt capture in your browser and bank/card statement import",
  "Logbook entry, by hand or imported from ForeFlight, LogTen Pro, or CSV",
  "Client roster, W-9 status, and expiry tracking for the dates you enter on your documents",
  "Profit & loss, quarterly estimated-tax summary, and year-end reports",
];

export default function PricingPage() {
  return (
    <Section size="3">
      <Container size="2" px="4">
        <Flex direction="column" gap="6">
          <Flex direction="column" gap="2">
            <Heading size="7" trim="start">
              Pricing
            </Heading>
            <Text size="3" color="gray">
              One plan. Everything the product does is in it — there is no
              feature paywalled behind a higher tier to find later.
            </Text>
          </Flex>

          <Card size="4">
            <Flex direction="column" gap="4">
              <Flex direction="column" gap="1">
                <Text size="2" color="gray">
                  Solo
                </Text>
                <Flex align="baseline" gap="2">
                  <Text size="8" weight="bold" className="tnum">
                    {PRICE_LABEL}
                  </Text>
                  <Text size="3" color="gray">
                    / month
                  </Text>
                </Flex>
                <Text size="2" color="gray">
                  {TRIAL_DAYS}-day free trial, card required to start. The
                  card is charged {PRICE_LABEL}/month once the trial ends.
                </Text>
              </Flex>

              <Button asChild size="3">
                <NextLink href="/signup">Start your free trial</NextLink>
              </Button>

              <Flex direction="column" gap="2">
                {INCLUDED.map((line) => (
                  <Text key={line} size="2" color="gray">
                    · {line}
                  </Text>
                ))}
              </Flex>
            </Flex>
          </Card>

          <Text size="1" color="gray">
            A per-seat plan for businesses running more than one pilot is
            planned but not yet available — the Solo plan above is what's
            actually purchasable today.
          </Text>
        </Flex>
      </Container>
    </Section>
  );
}

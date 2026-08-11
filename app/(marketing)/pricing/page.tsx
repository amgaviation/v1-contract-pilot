import NextLink from "next/link";
import {
  Badge,
  Box,
  Button,
  Card,
  Container,
  Flex,
  Grid,
  Heading,
  Section,
  Separator,
  Text,
} from "@/components/ui";
import { BRAND } from "@/lib/brand";
import { NAVY_INK, NAVY_INK_MUTED, NAVY_SURFACE_INVERSE } from "../marketing-style";

export const metadata = { title: "Pricing" };

// Kept in sync by hand with app/(auth)/welcome/page.tsx's PRICE_LABEL and
// app/(marketing)/page.tsx's copy of the same string — see that file's
// comment for why this page prints $29, not the $39 docs/PRICING.md
// proposes. docs/LAUNCH-GATES.md G2 is the standing record of which price
// is actually confirmed; this string does not move until that gate does,
// and the Stripe Price behind STRIPE_PRICE_ID_SOLO remains the number
// that's actually charged either way. The visual rebuild of this page did
// not touch it.
const PRICE_LABEL = "$29";
const TRIAL_DAYS = 7;

/**
 * What the one plan contains, grouped only so the list is readable — the
 * groups are NOT tiers and must never be presented as any. Every line maps
 * to something built; nothing gated (currency) or in flight (invoice
 * email) appears here.
 */
const INCLUDED: { group: string; items: string[] }[] = [
  {
    group: "Trips & logbook",
    items: [
      "Trips with legs, and day records typed flight, travel, standby or off",
      "Logbook entry by hand, with PIC and SIC time kept distinct",
      "Trip-derived logbook drafts you confirm before anything is saved",
      "CSV import from ForeFlight, LogTen Pro, or any export via a generic column mapper",
    ],
  },
  {
    group: "Getting paid",
    items: [
      "Invoices drafted from the trips you've flown, with sequential numbering and a PDF",
      // "once you connect Stripe" is load-bearing: generating a link refuses
      // with "Connect Stripe from Settings before generating a payment link"
      // until the pilot completes Connect onboarding, so listing it
      // unqualified would read as something that works out of the box.
      "An online payment link for your client — once you connect Stripe",
      "Recurring invoices for standing clients",
      "Client roster with W-9 status",
    ],
  },
  {
    group: "Money in, money out",
    items: [
      "Receipt scanning that runs in your own browser",
      "Bank and card statement import",
      "Every expense tagged rebill or deduct and attached to its trip",
    ],
  },
  {
    group: "Tax time",
    items: [
      // "IRS estimated-tax period", not "quarterly" — the periods are
      // Jan-Mar, Apr-May, Jun-Aug, Sep-Dec, and two of them are not quarters.
      "Profit & loss, and an income and deductible-expense summary for each IRS estimated-tax period",
      "A year-end packet for whoever prepares your return",
      "Expiry tracking for the dates you record on your documents",
    ],
  },
];

const FAQ: { q: string; a: string }[] = [
  {
    q: "What happens when the trial ends?",
    a: `The card you started with is charged ${PRICE_LABEL} a month. There is nothing to choose at that point — there is only one plan.`,
  },
  {
    q: "Can I get my data out?",
    a: "Your logbook exports to CSV in full, and profit & loss, the estimated-tax-period summaries and the year-end packet all download — whether or not you keep subscribing. An account-wide export covering trips, invoices, expenses and clients is not built yet.",
  },
  {
    q: "Is there a cheaper tier with fewer features?",
    a: "No. Splitting a single-operator tool into tiers means a pilot discovers at tax time that reports were the expensive plan. Everything is in the one price.",
  },
];

export default function PricingPage() {
  return (
    <>
      <Box className="v1-m-dark">
        <Section size={{ initial: "3", md: "4" }}>
          <Container size="4" px="4">
            <Flex direction="column" gap="6">
              <Flex direction="column" gap="3" align="start">
                <Text size="1" weight="medium" className="v1-m-eyebrow" style={NAVY_INK_MUTED}>
                  One plan
                </Text>
                <Heading size={{ initial: "8", sm: "9" }} trim="start" style={NAVY_INK}>
                  {PRICE_LABEL} a month.
                </Heading>
                <Text size="4" style={{ ...NAVY_INK_MUTED, maxWidth: "36rem" }}>
                  Everything {BRAND.name} does is in it. No feature paywalled
                  behind a higher tier for you to find later, and no per-invoice
                  or per-trip charge.
                </Text>
              </Flex>

              <Card variant="surface" size="4" style={{ maxWidth: "30rem" }}>
                <Flex direction="column" gap="4">
                  <Flex justify="between" align="center" gap="3">
                    <Text size="2" color="gray">
                      Solo
                    </Text>
                    <Badge color="blue" variant="soft" size="2">
                      {TRIAL_DAYS}-day free trial
                    </Badge>
                  </Flex>

                  <Flex align="baseline" gap="2">
                    <Text size="9" weight="bold" className="tnum">
                      {PRICE_LABEL}
                    </Text>
                    <Text size="4" color="gray">
                      / month
                    </Text>
                  </Flex>

                  <Separator size="4" />

                  <Text size="2" color="gray">
                    Card required to start the trial. It is charged{" "}
                    {PRICE_LABEL}/month once the {TRIAL_DAYS} days are up, and
                    your logbook and reports export from the day you put them in.
                  </Text>

                  <Button asChild size="4">
                    <NextLink href="/signup">Start your free trial</NextLink>
                  </Button>
                </Flex>
              </Card>
            </Flex>
          </Container>
        </Section>
      </Box>

      <Section size={{ initial: "3", md: "4" }}>
        <Container size="4" px="4">
          <Flex direction="column" gap="6">
            <Heading size={{ initial: "6", sm: "7" }} trim="start">
              What&rsquo;s in it
            </Heading>
            <Grid columns={{ initial: "1", sm: "2" }} gap="4">
              {INCLUDED.map((section) => (
                <Card key={section.group} variant="surface" size="3">
                  <Flex direction="column" gap="3">
                    <Text size="1" weight="medium" color="blue">
                      {section.group.toUpperCase()}
                    </Text>
                    {section.items.map((item, index) => (
                      <Box key={item}>
                        {index > 0 ? <Separator size="4" mb="3" /> : null}
                        <Flex gap="3" align="start">
                          <Text size="2" color="blue" weight="medium">
                            —
                          </Text>
                          <Text size="2">{item}</Text>
                        </Flex>
                      </Box>
                    ))}
                  </Flex>
                </Card>
              ))}
            </Grid>
          </Flex>
        </Container>
      </Section>

      <Section size={{ initial: "3", md: "4" }} style={{ borderTop: "1px solid var(--gray-a5)" }}>
        <Container size="2" px="4">
          <Flex direction="column" gap="5">
            <Heading size={{ initial: "6", sm: "7" }} trim="start">
              Before you enter a card
            </Heading>
            <Box>
              {FAQ.map((item) => (
                <details key={item.q} className="v1-m-faq">
                  <summary>
                    <Text size="3" weight="medium">
                      {item.q}
                    </Text>
                  </summary>
                  <Box pb="4" pr="5">
                    <Text size="2" color="gray">
                      {item.a}
                    </Text>
                  </Box>
                </details>
              ))}
            </Box>

            <Text size="1" color="gray">
              A per-seat plan for businesses running more than one pilot is
              planned but not yet available — the Solo plan above is what&rsquo;s
              actually purchasable today.
            </Text>
          </Flex>
        </Container>
      </Section>

      <Section size="3" px="4">
        <Container size="4" px="4">
          <Box className="v1-m-dark" p={{ initial: "5", sm: "8" }}>
            <Flex
              direction={{ initial: "column", md: "row" }}
              align={{ initial: "start", md: "center" }}
              justify="between"
              gap="5"
            >
              <Flex direction="column" gap="2" style={{ maxWidth: "34rem" }}>
                <Heading size={{ initial: "6", sm: "7" }} trim="start" style={NAVY_INK}>
                  Start with your next trip.
                </Heading>
                <Text size="3" style={NAVY_INK_MUTED}>
                  {TRIAL_DAYS} days free, then {PRICE_LABEL} a month.
                </Text>
              </Flex>
              <Button asChild size="4" style={NAVY_SURFACE_INVERSE}>
                <NextLink href="/signup">Start free trial</NextLink>
              </Button>
            </Flex>
          </Box>
        </Container>
      </Section>
    </>
  );
}

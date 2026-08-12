import NextLink from "next/link";
import {
  Box,
  Button,
  Card,
  Container,
  Flex,
  Grid,
  Heading,
  Section,
  Separator,
  Table,
  Text,
} from "@/components/ui";
import { BRAND } from "@/lib/brand";
import { TRIAL_PERIOD_DAYS } from "@/lib/stripe/server";
import {
  GRAY_BAND,
  HAIRLINE_TOP,
  NAVY_INK,
  NAVY_INK_MUTED,
  NAVY_SURFACE_INVERSE,
} from "../marketing-style";
import {
  BUSINESS_MINIMUM_MONTHLY,
  BUSINESS_MINIMUM_ANNUAL,
  TIER_DISPLAY,
  TIER_ORDER,
  TIER_PRICE_COPY,
  publicCoreFeatures,
  publicMatrix,
  publicTierAdds,
  type PlanTier,
} from "./pricing-model";

/**
 * THE THREE-TIER PRICING PAGE.
 *
 * Feature split, tier names and blurbs render from lib/entitlements.ts
 * (via ./pricing-model — see that file for the one public-claim filter it
 * adds), so this page and the product's own gating can never disagree
 * about what a plan includes. Amounts are the docs/PRICING.md §3.2
 * numbers, defined once in ./pricing-model and shared with the landing
 * page. The trial figure is the SAME constant the checkout actually
 * passes to Stripe (lib/stripe/server.ts TRIAL_PERIOD_DAYS) — this page
 * claims the trial the code enforces, not a proposal.
 *
 * Standing claim rules, inherited from the old one-plan page and still
 * absolute: nothing here may imply an unshipped feature exists (rows the
 * entitlements table marks comingSoon are rendered AS coming soon, and
 * the counsel-gated currency board is absent entirely), and no copy may
 * state or imply the product determines whether a pilot is legal to fly.
 */

export const metadata = {
  title: "Pricing",
  description:
    `Three plans for the independent contract pilot — Solo, Pro and Business. ` +
    `Your own records are in every plan, and every plan starts with a ` +
    `${TRIAL_PERIOD_DAYS}-day free trial.`,
};

/** Per-tier price presentation, derived from the shared copy table. */
function priceLine(tier: PlanTier): {
  amount: string;
  per: string;
  annual: string;
} {
  const copy = TIER_PRICE_COPY[tier];
  if (copy.unit === "per seat") {
    return {
      amount: copy.monthly,
      per: "/seat/month",
      annual: `${copy.annual}/seat/year on annual — two months free`,
    };
  }
  return {
    amount: copy.monthly,
    per: "/month",
    annual: `${copy.annual}/year on annual — two months free`,
  };
}

/** What each card lists, and the line that introduces the list. */
function cardFeatures(tier: PlanTier) {
  if (tier === "solo") {
    return { intro: "The whole working core:", items: publicCoreFeatures() };
  }
  if (tier === "pro") {
    return { intro: "Everything in Solo, plus:", items: publicTierAdds("pro") };
  }
  return { intro: "Everything in Pro, plus:", items: publicTierAdds("business") };
}

export default function PricingPage() {
  const matrix = publicMatrix();

  return (
    <>
      {/* ---------------------------------------------------------------
          NAVY HERO — brand ground, per the rebuild brief the navy stays.
          --------------------------------------------------------------- */}
      <Box className="v1-m-dark">
        <Section size={{ initial: "3", md: "4" }}>
          <Container size="4" px="4">
            <Flex direction="column" gap="4" align="start">
              <Text size="1" weight="medium" className="v1-m-eyebrow" style={NAVY_INK_MUTED}>
                Pricing
              </Text>
              <Heading size={{ initial: "8", sm: "9" }} trim="start" style={NAVY_INK}>
                Three plans. One record.
              </Heading>
              <Text size="4" style={{ ...NAVY_INK_MUTED, maxWidth: "40rem" }}>
                Every plan is built on the same trip record, and your own
                records — the logbook, your documents, the dates each operator
                asks you to keep — are in all three. The higher plans add
                business depth, never access to what is already yours.
              </Text>
              <Text size="2" style={NAVY_INK_MUTED}>
                {TRIAL_PERIOD_DAYS}-day free trial on every plan. Card required
                to start; nothing is charged until the trial ends.
              </Text>
            </Flex>
          </Container>
        </Section>
      </Box>

      {/* ---------------------------------------------------------------
          THE THREE CARDS. Names, blurbs and feature lists come from
          lib/entitlements.ts via the view-model — not a hand-kept list.
          --------------------------------------------------------------- */}
      <Section size={{ initial: "3", md: "4" }}>
        <Container size="4" px="4">
          <Grid columns={{ initial: "1", md: "3" }} gap="4" align="stretch">
            {TIER_ORDER.map((tier) => {
              const display = TIER_DISPLAY[tier];
              const price = priceLine(tier);
              const features = cardFeatures(tier);
              return (
                <Card key={tier} size="3">
                  <Flex direction="column" gap="4" height="100%">
                    <Flex direction="column" gap="2">
                      <Heading size="5" trim="start">
                        {display.name}
                      </Heading>
                      <Text size="2" color="gray">
                        {display.blurb}
                      </Text>
                    </Flex>

                    <Flex direction="column" gap="1">
                      <Flex align="baseline" gap="1">
                        <Text size="8" weight="bold" className="tnum">
                          {price.amount}
                        </Text>
                        <Text size="3" color="gray">
                          {price.per}
                        </Text>
                      </Flex>
                      <Text size="1" color="gray">
                        {price.annual}
                      </Text>
                      {tier === "business" ? (
                        <Text size="1" color="gray">
                          Two-seat minimum — {BUSINESS_MINIMUM_MONTHLY}/month
                          covers both seats.
                        </Text>
                      ) : null}
                    </Flex>

                    <Separator size="4" />

                    <Flex direction="column" gap="2" flexGrow="1">
                      <Text size="1" weight="medium" color="gray">
                        {features.intro.toUpperCase()}
                      </Text>
                      {features.items.map((item) => (
                        <Flex key={item.id} gap="2" align="start">
                          <Text size="2" color="indigo" weight="medium" aria-hidden>
                            —
                          </Text>
                          <Text size="2">
                            {item.label}
                            {item.comingSoon ? (
                              <Text size="1" color="gray">
                                {" "}
                                (coming soon)
                              </Text>
                            ) : null}
                          </Text>
                        </Flex>
                      ))}
                    </Flex>

                    <Button asChild size="3">
                      <NextLink href="/signup">
                        Start your {TRIAL_PERIOD_DAYS}-day free trial
                      </NextLink>
                    </Button>
                  </Flex>
                </Card>
              );
            })}
          </Grid>
        </Container>
      </Section>

      {/* ---------------------------------------------------------------
          FULL COMPARISON MATRIX — rendered row by row from the same
          entitlements source the product enforces with.
          --------------------------------------------------------------- */}
      <Section size={{ initial: "3", md: "4" }} style={GRAY_BAND}>
        <Container size="4" px="4">
          <Flex direction="column" gap="5">
            <Flex direction="column" gap="2">
              <Heading size={{ initial: "6", sm: "7" }} trim="start">
                Every feature, every plan
              </Heading>
              <Text size="2" color="gray" style={{ maxWidth: "40rem" }}>
                This table is generated from the same plan definitions the
                product enforces with, so the page and the software cannot
                disagree. Everything unmarked is live today; the one thing not
                yet shipped says so in its row.
              </Text>
            </Flex>

            <Card size="2">
              <Box style={{ overflowX: "auto" }}>
                <Table.Root size="2" style={{ minWidth: "40rem" }}>
                  <Table.Header>
                    <Table.Row>
                      <Table.ColumnHeaderCell>Feature</Table.ColumnHeaderCell>
                      {TIER_ORDER.map((tier) => (
                        <Table.ColumnHeaderCell key={tier} justify="center">
                          {TIER_DISPLAY[tier].name}
                        </Table.ColumnHeaderCell>
                      ))}
                    </Table.Row>
                  </Table.Header>
                  <Table.Body>
                    {matrix.map((row) => (
                      <Table.Row key={row.feature}>
                        <Table.RowHeaderCell>
                          <Text size="2">
                            {row.label}
                            {row.comingSoon ? (
                              <Text size="1" color="gray">
                                {" "}
                                (coming soon)
                              </Text>
                            ) : null}
                          </Text>
                        </Table.RowHeaderCell>
                        {TIER_ORDER.map((tier) => (
                          <Table.Cell key={tier} justify="center">
                            {row.availability[tier] ? (
                              <Text size="2" color="indigo" weight="medium" aria-label="Included">
                                ✓
                              </Text>
                            ) : (
                              <Text size="2" color="gray" aria-label="Not included">
                                —
                              </Text>
                            )}
                          </Table.Cell>
                        ))}
                      </Table.Row>
                    ))}
                  </Table.Body>
                </Table.Root>
              </Box>
            </Card>
          </Flex>
        </Container>
      </Section>

      {/* ---------------------------------------------------------------
          SEAT MECHANICS + THE PRINCIPLE, side by side.
          --------------------------------------------------------------- */}
      <Section size={{ initial: "3", md: "4" }}>
        <Container size="4" px="4">
          <Grid columns={{ initial: "1", md: "2" }} gap="4">
            <Card size="3">
              <Flex direction="column" gap="3">
                <Heading size="4" trim="start">
                  How Business seats work
                </Heading>
                <Text size="2" color="gray">
                  Business is billed per seat: {TIER_PRICE_COPY.business.monthly}
                  /seat/month, with a two-seat minimum — so the plan starts at{" "}
                  {BUSINESS_MINIMUM_MONTHLY}/month ({BUSINESS_MINIMUM_ANNUAL}
                  /year on annual). Each seat is a full login on the same
                  account: a second pilot, or the bookkeeper who has been
                  asking for one. Records a seat creates stay in the account,
                  attributed, even if that seat is later removed.
                </Text>
                <Text size="1" color="gray">
                  Seat invitations are still rolling out — the plan table above
                  marks them honestly.
                </Text>
              </Flex>
            </Card>

            <Card size="3">
              <Flex direction="column" gap="3">
                <Heading size="4" trim="start">
                  Your records are never the upsell
                </Heading>
                <Text size="2" color="gray">
                  A pricing page that read &ldquo;pay more to see your own
                  records&rdquo; would poison the trust a tool like this runs
                  on. So the split is drawn the other way: the logbook, your
                  documents and their expiry dates, and the per-operator
                  records live in every plan, and no downgrade between plans
                  ever touches them. Your logbook and every report export from
                  the day you put them in.
                </Text>
              </Flex>
            </Card>
          </Grid>
        </Container>
      </Section>

      {/* ---------------------------------------------------------------
          FAQ — trial, downgrade, cancellation, seats, data egress.
          --------------------------------------------------------------- */}
      <Section size={{ initial: "3", md: "4" }} style={{ ...GRAY_BAND, ...HAIRLINE_TOP }}>
        <Container size="2" px="4">
          <Flex direction="column" gap="5">
            <Heading size={{ initial: "6", sm: "7" }} trim="start">
              Before you enter a card
            </Heading>
            <Box>
              {buildFaq().map((item) => (
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
          </Flex>
        </Container>
      </Section>

      {/* ---------------------------------------------------------------
          CLOSING CTA BAND.
          --------------------------------------------------------------- */}
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
                  {TRIAL_PERIOD_DAYS} days free on any plan, from{" "}
                  {TIER_PRICE_COPY.solo.monthly} a month after.
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

/**
 * FAQ copy. The downgrade and cancellation answers carry the memo's own
 * commitments (docs/PRICING.md §5): data is never deleted, read-only with
 * export working is the norm, and no plan change touches the records that
 * live in every tier.
 */
function buildFaq(): { q: string; a: string }[] {
  return [
    {
      q: "What happens when the trial ends?",
      a: `After ${TRIAL_PERIOD_DAYS} days, the card you started with is charged for the plan you picked — ${TIER_PRICE_COPY.solo.monthly}, ${TIER_PRICE_COPY.pro.monthly}, or ${TIER_PRICE_COPY.business.monthly} per seat a month. Cancel before the trial ends and nothing is charged.`,
    },
    {
      q: "What happens if I downgrade?",
      a: "Nothing is deleted — ever. Everything you created on the higher plan stays visible and exportable; what stops is creating new records on the screens your new plan doesn't include, and those screens come straight back the moment you upgrade again. A downgrade never touches your logbook, your documents, or your per-operator records, because those live in every plan.",
    },
    {
      q: "What happens if I cancel?",
      a: `Your account goes read-only with export still working: logbook, invoices, documents, reports — all of it viewable and downloadable, deleted never. A pilot's logbook is a legal record, and a lapsed subscription is not going to be the thing that destroys one.`,
    },
    {
      q: "Can I get my data out?",
      a: "On every plan, your logbook exports to CSV in full and every report downloads. Pro and Business add the account-wide export in Settings: one CSV per record type — clients, trips, trip days, trip legs, estimates, invoices, payments, expenses, mileage and documents. Uploaded receipt and document files download from their own pages.",
    },
    {
      q: "I subscribed when there was one plan. What changes for me?",
      a: `Nothing you didn't ask for. Existing accounts keep their ${TIER_PRICE_COPY.solo.monthly} price — the ladder is additive, and nobody is migrated, re-papered, or asked to choose again. If ${BRAND.name}'s newer business surfaces are worth it to you, upgrading is there; if not, ignore this page.`,
    },
    {
      q: "Do the higher plans decide whether I'm current or legal to fly?",
      a: "No plan does, and none will ever present itself that way. The product tracks dates you entered from your own documents so you can see what's coming due. Currency and airworthiness decisions remain yours.",
    },
  ];
}

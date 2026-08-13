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
  NAVY_INK,
  NAVY_INK_MUTED,
  NAVY_SURFACE_INVERSE,
} from "@/lib/surface-style";
import {
  BUSINESS_MINIMUM_MONTHLY,
  TIER_DISPLAY,
  TIER_ORDER,
  TIER_PRICE_COPY,
  publicCoreFeatures,
  publicMatrix,
  publicTierAdds,
  type PlanTier,
} from "./pricing-model";

/**
 * THE THREE-TIER PRICING PAGE, cut to the same discipline as the landing
 * page in the 2026-08 rewrite (docs/MARKETING.md): the depth on this page
 * is the MATRIX, which is generated, so the prose around it earns nothing
 * by being long. Gone from the previous version: two side-by-side essay
 * cards restating promises the FAQ already makes, and a "Can I get my data
 * out?" answer that was factually wrong (see below).
 *
 * Feature split, tier names and blurbs render from lib/entitlements.ts (via
 * ./pricing-model — see that file for the one public-claim filter it adds),
 * so this page and the product's own gating can never disagree about what a
 * plan includes.
 *
 * AMOUNTS. No dollar figure is typed on this page: they come from
 * ./pricing-model's TIER_PRICE_COPY, which is also what the landing page
 * renders, so the two public pages cannot drift. This page deliberately
 * does NOT read the live Stripe Price objects the way the welcome picker
 * and settings/billing do (lib/stripe/prices.ts) — read pricing-model.ts's
 * header for why: a public page has to render at build time, on a preview
 * deployment, and on a machine with no Stripe key, and a pricing page that
 * says "unavailable" to a stranger is worse than one rendering the signed
 * docs/PRICING.md §3.2 numbers. The Stripe Price object remains what
 * actually charges the card, and every PRE-PURCHASE surface — where the
 * figure shown must equal the charge — reads it live.
 *
 * Standing claim rules, absolute: nothing here may imply an unshipped
 * feature exists (rows entitlements marks comingSoon render AS coming soon,
 * and the counsel-gated currency board is absent entirely), and no copy may
 * state or imply the product determines whether a pilot is legal to fly.
 */

export const metadata = {
  title: "Pricing",
  description:
    `Three plans for the independent contract pilot — Solo, Pro and ` +
    `Business. Your own records are in every plan, and every plan starts ` +
    `with a ${TRIAL_PERIOD_DAYS}-day free trial.`,
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
          HERO — brand ground, per the rebuild brief the navy stays.
          --------------------------------------------------------------- */}
      <Box className="v1-m-dark">
        <Section size={{ initial: "3", md: "4" }}>
          {/* size="4" like every band below it — see the landing page's hero
              note. The copy's measure is a maxWidth on the column, not a
              narrower container, so the hero shares a left edge with the
              plan cards and the matrix. */}
          <Container size="4" px="4">
            <Flex
              direction="column"
              gap="4"
              align="start"
              style={{ maxWidth: "48rem" }}
            >
              <Text size="1" weight="medium" className="v1-m-eyebrow" style={NAVY_INK_MUTED}>
                Pricing
              </Text>
              {/* Radix's Heading defaults to as="h1"; every heading on this
                  page states its level so the outline is one h1, sections at
                  h2 and the plan names at h3, rather than ten h1s. */}
              <Heading as="h1" size={{ initial: "8", sm: "9" }} trim="start" style={NAVY_INK}>
                Three plans. One record.
              </Heading>
              <Text as="p" size={{ initial: "4", sm: "5" }} style={NAVY_INK_MUTED}>
                The higher plans add business depth. Your logbook, your
                documents and your export are in all three.
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
                      <Heading as="h3" size="5" trim="start">
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
                        Start the {TRIAL_PERIOD_DAYS}-day trial
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
          <Flex direction="column" gap="4">
            <Flex direction="column" gap="2">
              <Heading as="h2" size={{ initial: "6", sm: "7" }} trim="start">
                Every feature, every plan
              </Heading>
              <Text size="2" color="gray">
                Generated from the plan definitions the product enforces with.
                Everything unmarked is live today; anything not yet shipped
                says so in its row.
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
          FAQ — the questions a card is entered against, and nothing else.
          --------------------------------------------------------------- */}
      <Section size={{ initial: "3", md: "4" }}>
        <Container size="2" px="4">
          <Flex direction="column" gap="4">
            <Heading as="h2" size={{ initial: "6", sm: "7" }} trim="start">
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
      {/* No px on the Section — see the note on the landing page's CTA band:
          px on both Section and Container double-inset this one band. */}
      <Section size="3">
        <Container size="4" px="4">
          <Box className="v1-m-dark" p={{ initial: "5", sm: "8" }}>
            <Flex
              direction={{ initial: "column", md: "row" }}
              align={{ initial: "start", md: "center" }}
              justify="between"
              gap="5"
            >
              <Heading as="h2" size={{ initial: "6", sm: "7" }} trim="start" style={NAVY_INK}>
                Start with your next trip.
              </Heading>
              <Box flexShrink="0">
                <Button asChild size="4" style={NAVY_SURFACE_INVERSE}>
                  <NextLink href="/signup">
                    Start the {TRIAL_PERIOD_DAYS}-day trial
                  </NextLink>
                </Button>
              </Box>
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
 * live in every tier. Four questions, down from six — "What happens if I
 * downgrade?" and "What happens if I cancel?" made the same promise twice,
 * so they are one answer now.
 *
 * THE EXPORT ANSWER WAS WRONG AND IS FIXED HERE. It read "Pro and Business
 * add the account-wide export", which contradicts lib/entitlements.ts,
 * where account_export is minTier "solo" with an explicit comment recording
 * that it was moved there deliberately: "Gating export is the one upsell
 * this product refuses." The page was understating its own strongest trust
 * claim. Do not port that sentence back.
 */
function buildFaq(): { q: string; a: string }[] {
  return [
    {
      q: "What happens when the trial ends?",
      a: `After ${TRIAL_PERIOD_DAYS} days the card you started with is charged for the plan you picked — ${TIER_PRICE_COPY.solo.monthly}, ${TIER_PRICE_COPY.pro.monthly}, or ${TIER_PRICE_COPY.business.monthly} per seat a month. Cancel before it ends and nothing is charged.`,
    },
    {
      q: "What happens if I downgrade or cancel?",
      a: "Nothing is deleted. Downgrading stops new work on the screens your new plan doesn't include; everything already created stays visible and exportable, and those screens come straight back if you upgrade. Cancelling puts the account in read-only. A pilot's logbook is a legal record; a lapsed card will never be the thing that destroys one.",
    },
    {
      q: "Can I get my data out?",
      a: "On every plan. The account-wide export in Settings writes one CSV per record type — clients, trips, trip days, trip legs, estimates, invoices, payments, expenses, mileage and documents — the logbook exports in full, every report downloads, and uploaded receipt and document files download from their own pages.",
    },
    {
      q: "I subscribed when there was one plan. What changes for me?",
      a: `Nothing you didn't ask for. Existing accounts keep their ${TIER_PRICE_COPY.solo.monthly} price — the ladder is additive, and nobody is migrated or asked to choose again. If ${BRAND.name}'s newer business surfaces are worth it to you, upgrading is there; if not, ignore this page.`,
    },
    {
      q: "Do the higher plans decide whether I'm current or legal to fly?",
      a: "No plan does, and none will ever present itself that way. The product tracks dates you entered from your own documents so you can see what's coming due. Currency and airworthiness decisions remain yours.",
    },
  ];
}

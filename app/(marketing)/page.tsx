import { redirect } from "next/navigation";
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
  Table,
  Text,
} from "@/components/ui";
import { BRAND } from "@/lib/brand";
import { DASHBOARD_PATH } from "@/lib/nav";
import { getSessionContext } from "@/lib/supabase/account";
import { TRIAL_PERIOD_DAYS } from "@/lib/stripe/server";
import {
  FEATURES,
  TIER_RANK,
  type FeatureId,
  type PlanTier,
} from "@/lib/entitlements";
import {
  GRAY_BAND,
  HAIRLINE_TOP,
  NAVY_INK,
  NAVY_INK_MUTED,
  NAVY_SURFACE_INVERSE,
} from "@/lib/surface-style";
import ProductMock from "./product-mock";
import {
  TIER_DISPLAY,
  TIER_ORDER,
  TIER_PRICE_COPY,
  isPubliclyClaimable,
} from "./pricing/pricing-model";

/**
 * THE PUBLIC FRONT DOOR, rewritten 2026-08 against the approved strategy
 * in docs/MARKETING.md. Read that file before changing a word here: it
 * carries the positioning, the message hierarchy, the claim rules, and a
 * per-section word budget this page is written to (~490 visible words,
 * down from ~1,600).
 *
 * The three standing rules that bind the copy, restated because they are
 * the ones a well-meaning edit breaks:
 *
 *   TWO GENERATED, ONE ORGANISED. A trip GENERATES invoice lines and a
 *   logbook draft. Receipts are ORGANISED by it — nothing in this product
 *   creates an expense from a trip. Never claim three generated.
 *
 *   NOTHING BEYOND SHIPPED CODE. Every feature line below is tied to a
 *   FeatureId in lib/entitlements.ts, so its tier tag is derived rather
 *   than typed, and anything the public-claim filter removes (the
 *   counsel-gated currency board) or entitlements marks comingSoon (seats)
 *   disappears from this page mechanically. See specGroups() below.
 *
 *   ONE TAGLINE, ONCE. BRAND.tagline appears in body copy exactly once —
 *   the first comparison row — plus the footer and metadata, which read it
 *   from lib/brand.ts. It is deliberately NOT the H1: the H1 shows the
 *   mechanic instead of asserting it.
 *
 * Figures are interpolated, never typed: the trial is the SAME constant the
 * checkout passes to Stripe (lib/stripe/server.ts), and the amounts come
 * from ./pricing/pricing-model, the one marketing source for the
 * docs/PRICING.md §3.2 numbers.
 */

/**
 * WHAT ONE TRIP PRODUCES. Two generated, one organised — see the header.
 * The input card that feeds these three is rendered inline below; it is
 * the source, so it is the one card on the page with its own ground.
 */
const OUTPUTS: { step: string; title: string; body: string }[] = [
  {
    step: "01",
    title: "Invoice lines",
    body: "Billable days price themselves off that client's rate card, with anything you tagged rebill. Sequential number, PDF, email delivery, and a payment link once you connect Stripe.",
  },
  {
    step: "02",
    title: "A logbook draft",
    // ONE DRAFT PER LEG, not one per trip: draftPayloadForLeg() in
    // app/(app)/logbook/db.ts is per-leg, the queue is titled "Trip drafts —
    // legs from completed trips", and one entry per flight is the only form
    // 14 CFR 61.51 recognises. "The legs … a draft entry" read as a merge.
    body: "Each leg comes back as a draft entry, PIC and SIC kept distinct. Nothing saves until you confirm it.",
  },
  {
    step: "03",
    title: "Receipts, already filed",
    // "lands in the year's deductible total" DESCRIBES THE SOFTWARE. It
    // must never become "lowers your taxable income" or "is deductible":
    // `deduct` is an expense treatment enum (app/(app)/expenses/actions.ts),
    // and the product's own mileage screen says in as many words that it
    // records drives rather than determining what is deductible. The front
    // door is the one signed-out surface with no disclaimer on it, so a tax
    // outcome asserted here is asserted naked. See docs/MARKETING.md §5
    // rule 10.
    body: "Scan it in the FBO, assign it to the trip. Tag it rebill and it bills the client; tag it deduct and it lands in the year's deductible total.",
  },
];

/**
 * THE SPEC BLOCK — one three-column list, grouped by the pilot's job
 * rather than by tier, replacing the seven-block feature band that was 40%
 * of the old page.
 *
 * Each line declares the FeatureId(s) it describes, and that is what makes
 * the block honest without hand-maintenance:
 *
 *   - the tier tag is DERIVED from FEATURES[id].minTier, so a line can
 *     never read as included when the code gates it (five of the seven old
 *     blocks silently mixed Solo, Pro and Business);
 *   - a line whose feature is not publicly claimable is dropped, so the
 *     counsel-gated currency board can never reappear here by edit;
 *   - a line whose feature entitlements marks comingSoon is dropped, which
 *     is why multi_seat appears nowhere on this page. The Business per-seat
 *     PRICE is a billing fact and may be stated (see the plans line);
 *     inviting a bookkeeper is not shipped and is claimed nowhere.
 *
 * The prose is written for the reader; the gating is read from the code.
 */
type SpecItem = { text: string; features: readonly FeatureId[] };
type SpecGroup = { title: string; items: readonly SpecItem[] };

const SPEC: readonly SpecGroup[] = [
  {
    title: "The trip",
    items: [
      { text: "Legs, aircraft and client on one record", features: ["trips"] },
      {
        text: "Per-client day rates; W-9 status on every client",
        features: ["clients"],
      },
      {
        text: "Invoices: sequential numbers, a PDF with the trip's receipts attached, email delivery, view tracking",
        features: ["invoices"],
      },
      {
        text: "Estimates, recurring invoices, client statements",
        features: ["estimates", "recurring_invoices", "client_statements"],
      },
    ],
  },
  {
    title: "Your records",
    items: [
      {
        text: "Logbook: manual entry, PIC and SIC distinct, CSV import from ForeFlight or LogTen Pro, export any time",
        features: ["logbook"],
      },
      {
        // "the rate you set" is load-bearing. lib/mileage.ts stores
        // "that year's rate in cents per mile, AS THE PILOT ENTERED IT", and
        // a year with no rate on file renders miles with no dollar figure
        // ("no IRS rate on file for {year}", reports/quarterly). The product
        // ships no rate table; dropping the qualifier turned an input field
        // into an advertised capability.
        text: "Receipt scanning in your own browser; mileage priced at the standard rate you set for each tax year",
        features: ["expenses"],
      },
      {
        text: "Certificate, medical, flight review and insurance expiry dates, shareable with a client as a link",
        features: ["documents"],
      },
      {
        text: "Bank and card statement import, CSV or OFX",
        features: ["bank_import"],
      },
    ],
  },
  {
    title: "The year",
    items: [
      {
        text: "Profit & loss, IRS estimated-tax-period summaries, a year-end packet for your CPA",
        features: ["reports_core"],
      },
      {
        // account_export is minTier "solo" DELIBERATELY — read the comment
        // on that row in lib/entitlements.ts. The old page's FAQ said "Pro
        // and Business add the account-wide export", which contradicted the
        // code and understated this product's strongest trust claim. This
        // line is the correction, and its tag is derived, so it cannot
        // drift back.
        text: "Account-wide CSV export — every record type, on every plan",
        features: ["account_export"],
      },
      { text: "Sales tax report", features: ["sales_tax_report"] },
      {
        text: "Double-entry books with reconciliation",
        features: ["accounting"],
      },
    ],
  },
];

/** The highest tier any of a line's features needs, or null for Solo. */
function tagFor(features: readonly FeatureId[]): PlanTier | null {
  let top: PlanTier = "solo";
  for (const id of features) {
    const min = FEATURES[id].minTier;
    if (TIER_RANK[min] > TIER_RANK[top]) top = min;
  }
  return top === "solo" ? null : top;
}

/** The spec block as rendered: unclaimable and unshipped lines removed. */
function specGroups(): { title: string; items: { text: string; tag: string | null }[] }[] {
  return SPEC.map((group) => ({
    title: group.title,
    items: group.items
      .filter((item) =>
        item.features.every(
          (id) => isPubliclyClaimable(id) && !FEATURES[id].comingSoon
        )
      )
      .map((item) => {
        const tier = tagFor(item.features);
        return { text: item.text, tag: tier ? TIER_DISPLAY[tier].name : null };
      }),
  }));
}

/**
 * THE COMPARISON. WORKFLOW ONLY — no competitor pricing, and no claim that
 * any of these tools is bad at its own job. A logbook app is good at
 * logbooks; the cost named here is the seam between three tools that do not
 * know about each other, which is a real and specific cost to the person
 * doing the typing. This editorial constraint predates the rewrite and
 * survives it intact.
 *
 * Row one's second cell is the ONE place BRAND.tagline appears in body copy
 * on this page.
 */
const COMPARISON: { step: string; today: string; here: string }[] = [
  {
    step: "After the trip",
    today: "Legs typed into the logbook app",
    here: BRAND.tagline,
  },
  {
    step: "Billing the client",
    today: "The same dates retyped in a spreadsheet to get the day count",
    here: "The days are already there",
  },
  {
    step: "Tax time",
    today: "Three sources that disagree, reconciled by you",
    here: "One set of numbers, already built",
  },
];

/**
 * THREE QUESTIONS, down from six. Only the ones that remove a real barrier
 * and are answered nowhere else on the page. The second is non-negotiable:
 * it carries the substance of lib/brand.ts's counsel-reviewed
 * CURRENCY_DISCLAIMER — this product never presents itself as deciding
 * whether a pilot is legal to fly.
 */
const FAQ: { q: string; a: string }[] = [
  {
    q: "I already keep a logbook. Do I have to start over?",
    a: "No. Import a ForeFlight or LogTen Pro export, or any CSV through the column mapper, and carry on from there.",
  },
  {
    q: "Does it decide whether I'm current or legal to fly?",
    a: "No, and it will never present itself that way. It tracks the expiry dates you entered off your own documents so you can see what's coming. Currency and airworthiness decisions stay yours.",
  },
  {
    q: "What happens if I cancel or downgrade?",
    // The export sentence that used to sit third is gone, not moved: the
    // spec line "Account-wide CSV export — every record type, on every plan"
    // makes that promise on this same page, and docs/MARKETING.md §6's rule
    // is that a body restating something the page already says is deleted
    // rather than trimmed. What is left is the two claims nothing else here
    // carries: what a downgrade stops, and that the records survive.
    a: "Nothing is deleted. Downgrading stops new work on the screens your plan no longer includes; cancelling puts the account in read-only. A pilot's logbook is a legal record; a lapsed card will never be the thing that destroys one.",
  },
];

/**
 * "/" moved here from app/(app)/page.tsx because that route group is
 * wrapped, unconditionally, by app/(app)/layout.tsx's requireAccount() —
 * there is no way to make one route inside a gated layout render for a
 * signed-out visitor. A signed-in visitor is bounced before any marketing
 * copy renders: provisioned account -> the dashboard, signed in with no
 * account yet -> /welcome, exactly what requireAccount() would have done.
 */
export default async function LandingPage() {
  const ctx = await getSessionContext();
  if (ctx?.account) redirect(DASHBOARD_PATH);
  if (ctx) redirect("/welcome");

  const groups = specGroups();

  return (
    <>
      {/* ---------------------------------------------------------------
          1. HERO. Ten seconds: what it is, what it does, who it's for,
          what it costs — then the mock, which does the explaining the old
          65-word paragraph did badly.

          ONE MEASURE FOR THE WHOLE PAGE — Container size="4", the same
          wrapper every band below uses. The hero was size="3" (880px) over
          sections at size="4" (1136px), which put a 128px stair-step
          between the H1 and every heading under it: the page had no
          established left edge at all. The measure that a paragraph
          actually needs is a property of the TEXT, not of the band, so it
          is a maxWidth on the copy column and the mock gets the full
          width. --------------------------------------------------------- */}
      <Box className="v1-m-dark">
        <Section size={{ initial: "3", md: "4" }}>
          <Container size="4" px="4">
            <Flex direction="column" gap="6">
              <Flex
                direction="column"
                gap="4"
                align="start"
                style={{ maxWidth: "48rem" }}
              >
                <Text size="1" weight="medium" className="v1-m-eyebrow" style={NAVY_INK_MUTED}>
                  For the contract pilot — day rates, several operators,
                  one-person business
                </Text>

                {/* THE page's only h1. Radix's Heading defaults to as="h1",
                    so every heading below states its level explicitly rather
                    than inheriting one — the page used to render ten h1s and
                    no h2, which flattens the rotor and the crawl to a single
                    rank. */}
                <Heading as="h1" size={{ initial: "8", sm: "9" }} trim="start" style={NAVY_INK}>
                  One trip in. Invoice out. Logbook out. Receipts filed.
                </Heading>

                {/* Its own element, not a <Text> nested inside the
                    <Heading> — which is what the old sub-line was. */}
                <Text as="p" size={{ initial: "4", sm: "5" }} style={NAVY_INK_MUTED}>
                  Type the dates, the legs and the tail number once — on the
                  trip. Everything after comes off that record.
                </Text>

                <Flex gap="3" wrap="wrap" mt="1">
                  <Button asChild size="4" style={NAVY_SURFACE_INVERSE}>
                    <NextLink href="/signup">
                      Start the {TRIAL_PERIOD_DAYS}-day trial
                    </NextLink>
                  </Button>
                  <Button asChild size="4" variant="outline" style={NAVY_INK}>
                    <NextLink href="/pricing">See pricing</NextLink>
                  </Button>
                </Flex>

                <Text size="2" style={NAVY_INK_MUTED}>
                  From {TIER_PRICE_COPY.solo.monthly}/month after the trial.
                  Card required to start.
                </Text>
              </Flex>

              {/* THE PRODUCT VISUAL, above the fold. Built from the
                  product's own components with invented data — see
                  product-mock.tsx. */}
              <ProductMock />

              <Text size="1" style={NAVY_INK_MUTED}>
                Illustrative data.
              </Text>
            </Flex>
          </Container>
        </Section>
      </Box>

      {/* ---------------------------------------------------------------
          2. WHAT ONE TRIP PRODUCES. The proof, immediately: one input
          card feeding three numbered outputs. No intro paragraph — the
          heading is the intro. Anchor target for the header's link.
          --------------------------------------------------------------- */}
      <Section size={{ initial: "3", md: "4" }} id="how-it-works">
        <Container size="4" px="4">
          <Flex direction="column" gap="5">
            <Heading as="h2" size={{ initial: "7", sm: "8" }} trim="start">
              What one trip produces
            </Heading>

            {/* Input, connector, outputs. The gap goes to zero where the
                connector is drawn, because the connector IS the spacing
                there; below that breakpoint it is display:none and the
                cards need a gap of their own. */}
            <Flex direction="column" gap={{ initial: "4", md: "0" }}>
            {/* The source record. Its own ground, because the three cards
                below come off it. */}
            <Card size="3" style={{ background: "var(--accent-2)" }}>
              <Flex direction="column" gap="2">
                <Text size="1" weight="medium" color="indigo">
                  YOU TYPE — THE TRIP
                </Text>
                <Text size="3">
                  The client, the aircraft, the legs, and each day as flight,
                  travel, standby or off.
                </Text>
              </Flex>
            </Card>

            {/* A real one-to-three connector — stem, crossbar, three legs —
                drawn only where the outputs sit side by side. It replaces a
                lone hairline that used to render across the TOP EDGE of the
                three cards and read as a stray floating rule. */}
            <Box className="v1-m-flow-connector" aria-hidden>
              <Box className="v1-m-flow-leg v1-m-flow-leg-1" />
              <Box className="v1-m-flow-leg v1-m-flow-leg-2" />
              <Box className="v1-m-flow-leg v1-m-flow-leg-3" />
            </Box>

            <Grid columns={{ initial: "1", md: "3" }} gap="4">
              {OUTPUTS.map((output) => (
                <Card key={output.title} size="3">
                  <Flex direction="column" gap="3">
                    <Flex align="center" gap="2">
                      <Text size="4" weight="bold" color="indigo" className="tnum">
                        {output.step}
                      </Text>
                      <Heading as="h3" size="4" trim="start">
                        {output.title}
                      </Heading>
                    </Flex>
                    <Text size="2" color="gray">
                      {output.body}
                    </Text>
                  </Flex>
                </Card>
              ))}
            </Grid>
            </Flex>
          </Flex>
        </Container>
      </Section>

      {/* ---------------------------------------------------------------
          3. WHAT'S IN IT. One three-column spec block, grouped by the
          pilot's job, every Pro/Business line tagged from the code.
          --------------------------------------------------------------- */}
      <Section size={{ initial: "3", md: "4" }} style={GRAY_BAND}>
        <Container size="4" px="4">
          <Flex direction="column" gap="5">
            <Heading as="h2" size={{ initial: "7", sm: "8" }} trim="start">
              Everything the day rate doesn&rsquo;t cover.
            </Heading>

            <Grid columns={{ initial: "1", md: "3" }} gap="4">
              {groups.map((group) => (
                <Card key={group.title} size="3">
                  <Flex direction="column" gap="3">
                    <Text size="1" weight="medium" color="indigo">
                      {group.title.toUpperCase()}
                    </Text>
                    <Flex direction="column" gap="3" asChild>
                      <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
                        {group.items.map((item) => (
                          <li key={item.text}>
                            <Flex gap="2" align="start">
                              <Text size="2" color="indigo" weight="medium" aria-hidden>
                                —
                              </Text>
                              <Text size="2">
                                {item.text}
                                {/* The tier tag is a Badge, not a suffix in
                                    gray: a reader scanning for what their
                                    plan includes has to be able to find it
                                    without reading the line. Its VALUE is
                                    derived from entitlements — see
                                    specGroups() — so it cannot claim the
                                    wrong tier. */}
                                {item.tag ? (
                                  <>
                                    {" "}
                                    <Badge color="gray" variant="soft" size="1">
                                      {item.tag}
                                    </Badge>
                                  </>
                                ) : null}
                              </Text>
                            </Flex>
                          </li>
                        ))}
                      </ul>
                    </Flex>
                  </Flex>
                </Card>
              ))}
            </Grid>
          </Flex>
        </Container>
      </Section>

      {/* ---------------------------------------------------------------
          4. THE SAME TRIP, THREE TIMES. Shared row labels in one table
          instead of two cards the eye has to scan between.
          --------------------------------------------------------------- */}
      <Section size={{ initial: "3", md: "4" }} style={HAIRLINE_TOP}>
        <Container size="4" px="4">
          <Flex direction="column" gap="5">
            <Heading as="h2" size={{ initial: "7", sm: "8" }} trim="start">
              The same trip, three times.
            </Heading>

            <Card size="2">
              <Box style={{ overflowX: "auto" }}>
                <Table.Root size="2" style={{ minWidth: "36rem" }}>
                  <Table.Header>
                    <Table.Row>
                      <Table.ColumnHeaderCell>
                        <Text size="1" color="gray">
                          Step
                        </Text>
                      </Table.ColumnHeaderCell>
                      <Table.ColumnHeaderCell>
                        A logbook app + a spreadsheet + accounting software
                      </Table.ColumnHeaderCell>
                      <Table.ColumnHeaderCell>
                        {BRAND.name}
                      </Table.ColumnHeaderCell>
                    </Table.Row>
                  </Table.Header>
                  <Table.Body>
                    {COMPARISON.map((row) => (
                      <Table.Row key={row.step}>
                        <Table.RowHeaderCell>
                          <Text size="2" weight="medium">
                            {row.step}
                          </Text>
                        </Table.RowHeaderCell>
                        <Table.Cell>
                          <Text size="2" color="gray">
                            {row.today}
                          </Text>
                        </Table.Cell>
                        <Table.Cell>
                          <Text size="2">{row.here}</Text>
                        </Table.Cell>
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
          5. PLANS. One line and a link — /pricing is one click away and
          rebuilding it here at lower fidelity helps nobody. Amounts and
          names render from the shared model so they cannot drift.
          --------------------------------------------------------------- */}
      <Section size={{ initial: "3", md: "4" }} style={GRAY_BAND}>
        <Container size="4" px="4">
          <Flex
            direction={{ initial: "column", sm: "row" }}
            align={{ initial: "start", sm: "center" }}
            justify="between"
            gap="4"
          >
            <Text size="3" style={{ maxWidth: "44rem" }}>
              {TIER_ORDER.map((tier) => (
                <span key={tier}>
                  {TIER_DISPLAY[tier].name} {TIER_PRICE_COPY[tier].monthly}
                  {TIER_PRICE_COPY[tier].unit === "per seat"
                    ? ` per seat, ${TIER_PRICE_COPY[tier].seatMinimum}-seat minimum`
                    : "/month"}
                  .{" "}
                </span>
              ))}
              {TRIAL_PERIOD_DAYS}-day free trial on every plan; annual is two
              months free.
            </Text>
            <Box flexShrink="0">
              <Button asChild size="3" variant="outline">
                <NextLink href="/pricing">Compare plans →</NextLink>
              </Button>
            </Box>
          </Flex>
        </Container>
      </Section>

      {/* ---------------------------------------------------------------
          6. BEFORE YOU SIGN UP. Native <details>/<summary> — works with
          no JavaScript, keyboard- and screen-reader-correct for free.
          --------------------------------------------------------------- */}
      <Section size={{ initial: "3", md: "4" }}>
        <Container size="2" px="4">
          <Flex direction="column" gap="4">
            <Heading as="h2" size={{ initial: "7", sm: "8" }} trim="start">
              Before you sign up
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
          </Flex>
        </Container>
      </Section>

      {/* ---------------------------------------------------------------
          7. CLOSING CTA. One line, two buttons. Trial length, price and
          card-required were stated in the hero and again in plans; a
          fourth statement is not persuasion, it is noise.
          --------------------------------------------------------------- */}
      {/* No px on the Section: Section and Container each render their own
          element, so px on both inset this band 28.8px a side while every
          other section on the page is inset 14.4px — a navy block visibly
          narrower than the cards above it, with nothing (no radius, no
          shadow) to read as deliberate. The Container owns horizontal
          padding here exactly as it does everywhere else. */}
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
                Try it on your next trip.
              </Heading>
              <Flex gap="3" wrap="wrap" flexShrink="0">
                <Button asChild size="4" style={NAVY_SURFACE_INVERSE}>
                  <NextLink href="/signup">
                    Start the {TRIAL_PERIOD_DAYS}-day trial
                  </NextLink>
                </Button>
                <Button asChild size="4" variant="outline" style={NAVY_INK}>
                  <NextLink href="/pricing">Compare plans</NextLink>
                </Button>
              </Flex>
            </Flex>
          </Box>
        </Container>
      </Section>
    </>
  );
}

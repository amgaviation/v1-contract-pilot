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
  Separator,
  Text,
} from "@/components/ui";
import { BRAND } from "@/lib/brand";
import { DASHBOARD_PATH } from "@/lib/nav";
import { getSessionContext } from "@/lib/supabase/account";
import ProductMock from "./product-mock";
import {
  NAVY_INK,
  NAVY_INK_MUTED,
  NAVY_SURFACE_INVERSE,
} from "./marketing-style";

// Kept in sync by hand with app/(auth)/welcome/page.tsx's PRICE_LABEL and
// app/(auth)/welcome/welcome-actions.tsx's trial copy — the Stripe Price
// behind STRIPE_PRICE_ID_SOLO is what actually charges the card, and
// docs/LAUNCH-GATES.md G2 already tracks these hand-synced strings as a
// named table (three entries; this file and pricing/page.tsx make five).
// docs/PRICING.md proposes a different number, $39, but it is explicitly
// unconfirmed ("PROPOSAL. Nothing here is decided.") — this page prints
// only the number the product is actually configured and wired to charge
// today, never the proposal. THE NUMBER BELOW IS UNCHANGED by the visual
// rebuild of this page; it moves only when that gate moves.
const PRICE_LABEL = "$29/month";
const TRIAL_DAYS = 7;
const TRIAL_LABEL = `${TRIAL_DAYS}-day free trial`;

/**
 * THE ONE IDEA, as three outputs of a single trip record.
 *
 * Worded against what the product actually does, which is narrower than
 * the tempting version: two things are GENERATED from a trip (a logbook
 * draft, invoice lines) and one is ORGANISED by it (expenses attach to the
 * trip; nothing in this product creates an expense from one). The earlier
 * copy on this page carried a comment saying exactly that, and it survives
 * the redesign because the fact did.
 */
const OUTPUTS = [
  {
    step: "01",
    title: "Invoice lines",
    body: "Flight days, travel days, and any expense you tagged rebill become line items on an invoice with its own sequential number, a PDF, and — once you've connected Stripe — a link your client can pay online.",
  },
  {
    step: "02",
    title: "A logbook draft",
    body: "The legs you flew come back as a drafted logbook entry. You confirm it before anything is saved; nothing writes itself into your logbook behind you.",
  },
  {
    step: "03",
    title: "Receipts, already filed",
    body: "Every receipt you scan or import attaches to the trip, so it lands against the right client, the right invoice, and the right tax year without you filing it twice.",
  },
];

/**
 * Feature sections. Each `points` entry maps to something that exists in
 * the product today — nothing here describes planned work, and the two
 * features under an owner/counsel gate (currency, invoice email) are
 * deliberately absent rather than hedged.
 */
const FEATURES: {
  eyebrow: string;
  title: string;
  body: string;
  points: string[];
}[] = [
  {
    eyebrow: "Trips",
    title: "The trip is the record. Everything else hangs off it.",
    body: "One job is one trip: its legs, its typed day records — flight, travel, standby, off — the aircraft, and the client it was flown for. Type the dates and the tail number there, and you are done typing them.",
    points: [
      "Legs with departure and destination, and the route they add up to",
      "Day records typed flight, travel, standby or off, so the billable ones price themselves",
      "The client attached to the trip, carried through to the invoice",
    ],
  },
  {
    eyebrow: "Invoicing",
    title: "Bill the trip you already logged, and get paid for it online.",
    body: "Draft an invoice straight from the trips you've flown. Numbering is sequential, the PDF is the document your client sees, and a payment link means they don't have to be chased with an ACH form.",
    points: [
      "Sequential invoice numbers and a PDF for every invoice",
      "A Stripe payment link so the client pays online — connect Stripe once from Settings",
      "Recurring invoices for standing clients",
    ],
  },
  {
    eyebrow: "Expenses",
    title: "Scan the receipt in the hotel lobby, not in April.",
    body: "Receipt scanning runs in your own browser — the image doesn't leave your device until you save it. Or import a bank or card statement and work down the list.",
    points: [
      "In-browser receipt scanning",
      "Bank and card statement import",
      "Every line tagged rebill or deduct, so it either bills the client or lowers your taxable income",
    ],
  },
  {
    eyebrow: "Logbook",
    title: "One logbook, and your history comes with you.",
    body: "Enter a flight by hand, confirm the draft a trip produced, or bring years of history in from the app you keep it in now.",
    points: [
      "Manual entry, with PIC and SIC time kept distinct",
      "Trip-derived drafts you review before they're saved",
      "CSV import from ForeFlight, LogTen Pro, or any export, through a generic column mapper",
    ],
  },
  {
    eyebrow: "Clients, documents & reports",
    title: "The paperwork the day rate doesn't cover.",
    body: "Who you fly for, what they still owe you a W-9 for, which of your own documents is closest to expiring, and what the year actually looks like.",
    points: [
      "Client roster with W-9 status",
      "Expiry tracking for the documents you carry — certificates, medical, flight reviews, insurance",
      "Profit & loss, a summary for each IRS estimated-tax period, and a year-end packet for whoever prepares your return",
    ],
  },
];

/**
 * The comparison. WORKFLOW ONLY — no competitor pricing, no claim that any
 * of these tools is bad at its own job. A logbook app is good at logbooks;
 * the cost being named here is the seam between three tools that don't
 * know about each other, which is a real and specific cost to the person
 * doing the typing.
 */
const COMPARISON: { step: string; today: string; here: string }[] = [
  {
    step: "After the trip",
    today: "Type the legs into a logbook app.",
    here: "Log the trip — legs and day records — once.",
  },
  {
    step: "Billing the client",
    today: "Retype the same dates into a spreadsheet to work out the day count and the rate.",
    here: "Draft the invoice from the trip; the days are already there.",
  },
  {
    step: "Getting paid",
    today: "Rebuild the invoice in accounting software, export a PDF, email it, wait.",
    here: "Sequential number, PDF, and a payment link your client can settle online.",
  },
  {
    step: "Receipts",
    today: "A folder, a shoebox, or a photo roll — matched to trips at tax time, if at all.",
    here: "Scanned or imported, attached to the trip, tagged rebill or deduct as you go.",
  },
  {
    step: "Tax time",
    today: "Reconcile three sources that disagree, then hand your CPA the mess.",
    here: "Profit & loss, estimated-tax-period summaries, and a year-end packet built from what you recorded.",
  },
];

const FAQ: { q: string; a: string }[] = [
  {
    q: "What happens after the free trial?",
    a: `The trial runs ${TRIAL_DAYS} days and a card is required to start it. When it ends, that card is charged ${PRICE_LABEL}. There is one plan, and everything the product does is in it.`,
  },
  {
    q: "Do I own my data?",
    a: "Yes. Your trips, logbook, invoices, expenses and clients are yours, and there is a full export — nothing here is designed to be hard to leave with.",
  },
  {
    q: "Is this accounting software?",
    a: "No. It is trip-native: it records the work you actually did and produces profit & loss, estimated-tax-period summaries, and a year-end packet from it. Filing your return, and any advice about it, stays with your CPA.",
  },
  {
    q: "I already keep a logbook. Do I have to start over?",
    a: "No. Import your history from a ForeFlight or LogTen Pro export, or from any CSV through the generic column mapper, and carry on from there.",
  },
  {
    q: "Who is this for?",
    a: "The independent contract pilot running as a one-person business — flying for several owners or operators on a day rate, invoicing them, and filing the taxes on it. It is not a crew-scheduling system for a flight department.",
  },
  {
    q: "Does it decide whether I'm current or legal to fly?",
    a: "No, and it never will present itself that way. It tracks expiry dates you entered off your own documents so you can see what's coming. Currency and airworthiness decisions remain yours.",
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
  if (ctx?.account) redirect(DASHBOARD_PATH);
  if (ctx) redirect("/welcome");

  return (
    <>
      {/* ---------------------------------------------------------------
          HERO. The one full-bleed navy panel on the site, plus the
          product mock sitting on it — see app/globals.css's .v1-m-dark.
          --------------------------------------------------------------- */}
      <Box className="v1-m-dark">
        <Section size={{ initial: "3", md: "4" }}>
          <Container size="4" px="4">
            <Flex direction="column" gap="6">
              <Flex direction="column" gap="4" align="start">
                <Text size="1" weight="medium" className="v1-m-eyebrow" style={NAVY_INK_MUTED}>
                  For the independent contract pilot
                </Text>

                <Heading size={{ initial: "8", sm: "9" }} trim="start" style={NAVY_INK}>
                  {BRAND.tagline}
                  <br />
                  <Text size={{ initial: "6", sm: "8" }} weight="light" style={NAVY_INK_MUTED}>
                    Bill it, log it, and file the receipts from that one record.
                  </Text>
                </Heading>

                {/*
                  "Two generated, one organised" — the honest count. Nothing
                  in this product creates an expense from a trip: expenses
                  come from the pilot, a scanned receipt, or a bank import,
                  and the trip is what they ATTACH to. The re-typing is
                  still the whole pitch.
                */}
                <Text size="4" style={{ ...NAVY_INK_MUTED, maxWidth: "40rem" }}>
                  {BRAND.name} makes the trip the record everything else hangs
                  off. Your logbook draft and your invoice lines both come from
                  it, and your receipts attach to it — so the dates and the
                  tail number get typed once instead of three times. Built for
                  the pilot who keeps this in a logbook app, a spreadsheet, and
                  accounting software that has never heard of a leg.
                </Text>

                <Flex gap="3" wrap="wrap" mt="1">
                  <Button asChild size="4" style={NAVY_SURFACE_INVERSE}>
                    <NextLink href="/signup">Start your {TRIAL_LABEL}</NextLink>
                  </Button>
                  <Button asChild size="4" variant="outline" style={NAVY_INK}>
                    <NextLink href="/pricing">See pricing</NextLink>
                  </Button>
                </Flex>

                <Text size="2" style={NAVY_INK_MUTED}>
                  {PRICE_LABEL} after the trial. Card required to start. One
                  plan, everything included.
                </Text>
              </Flex>

              {/* THE PRODUCT VISUAL. Built from the product's own
                  components with invented data — see product-mock.tsx. */}
              <ProductMock />

              <Text size="1" style={NAVY_INK_MUTED}>
                Illustration of the Overview screen. Pilot, client names, tail
                numbers and figures are invented for this page.
              </Text>
            </Flex>
          </Container>
        </Section>
      </Box>

      {/* ---------------------------------------------------------------
          ONE TRIP IN, THREE OUTPUTS.
          --------------------------------------------------------------- */}
      <Section size={{ initial: "3", md: "4" }}>
        <Container size="4" px="4">
          <Flex direction="column" gap="6">
            <Flex direction="column" gap="3" align="center">
              <Badge color="blue" variant="soft" size="2">
                One trip in
              </Badge>
              <Heading size={{ initial: "7", sm: "8" }} align="center" trim="start">
                Enter it once. Three things come out.
              </Heading>
              <Text size="3" color="gray" align="center" style={{ maxWidth: "34rem" }}>
                A trip carries the dates, the aircraft, the legs and the client.
                Everything downstream reads from it instead of asking you again.
              </Text>
            </Flex>

            <Box className="v1-m-flow-rail">
              <Grid columns={{ initial: "1", md: "3" }} gap="4">
                {OUTPUTS.map((output) => (
                  <Card key={output.title} variant="surface" size="3">
                    <Flex direction="column" gap="3">
                      <Text size="6" weight="bold" color="blue" className="tnum">
                        {output.step}
                      </Text>
                      <Heading size="4" trim="start">
                        {output.title}
                      </Heading>
                      <Text size="2" color="gray">
                        {output.body}
                      </Text>
                    </Flex>
                  </Card>
                ))}
              </Grid>
            </Box>
          </Flex>
        </Container>
      </Section>

      {/* ---------------------------------------------------------------
          FEATURES. Alternating two-column blocks, not a uniform grid —
          each one leads with its own eyebrow and headline so the page has
          a rhythm to read down.
          --------------------------------------------------------------- */}
      <Section size={{ initial: "3", md: "4" }} style={{ borderTop: "1px solid var(--gray-a5)" }}>
        <Container size="4" px="4">
          <Flex direction="column" gap="8">
            {FEATURES.map((feature, index) => (
              <Grid
                key={feature.title}
                columns={{ initial: "1", md: "2" }}
                gap={{ initial: "4", md: "7" }}
                align="center"
                width="100%"
                className={index % 2 === 1 ? "v1-m-flip" : undefined}
              >
                <Flex direction="column" gap="3">
                  <Text size="1" weight="medium" color="blue">
                    {feature.eyebrow.toUpperCase()}
                  </Text>
                  <Heading size={{ initial: "6", sm: "7" }} trim="start">
                    {feature.title}
                  </Heading>
                  <Text size="3" color="gray">
                    {feature.body}
                  </Text>
                </Flex>

                <Card variant="surface" size="3">
                  <Flex direction="column" gap="3">
                    {feature.points.map((point, pointIndex) => (
                      <Box key={point}>
                        {pointIndex > 0 ? <Separator size="4" mb="3" /> : null}
                        <Flex gap="3" align="start">
                          <Text size="2" color="blue" weight="medium">
                            —
                          </Text>
                          <Text size="2">{point}</Text>
                        </Flex>
                      </Box>
                    ))}
                  </Flex>
                </Card>
              </Grid>
            ))}
          </Flex>
        </Container>
      </Section>

      {/* ---------------------------------------------------------------
          COMPARISON. Workflow, not competitor pricing, and no claim that
          any of those tools is bad at its own job.
          --------------------------------------------------------------- */}
      <Section size={{ initial: "3", md: "4" }} style={{ borderTop: "1px solid var(--gray-a5)" }}>
        <Container size="4" px="4">
          <Flex direction="column" gap="6">
            <Flex direction="column" gap="3">
              <Text size="1" weight="medium" color="blue">
                THE SAME TRIP, THREE TIMES
              </Text>
              <Heading size={{ initial: "7", sm: "8" }} trim="start">
                What this replaces
              </Heading>
              <Text size="3" color="gray" style={{ maxWidth: "40rem" }}>
                A logbook app, a spreadsheet and accounting software each do
                their own job well. None of them knows what a trip is, so you
                are the integration between them — entering the same three days
                in three places and reconciling them later.
              </Text>
            </Flex>

            <Grid columns={{ initial: "1", md: "2" }} gap="4">
              <Card variant="surface" size="3">
                <Flex direction="column" gap="3">
                  <Badge color="gray" variant="soft" size="2">
                    Logbook app + spreadsheet + accounting software
                  </Badge>
                  {COMPARISON.map((row, index) => (
                    <Box key={row.step}>
                      {index > 0 ? <Separator size="4" mb="3" /> : null}
                      <Flex direction="column" gap="1">
                        <Text size="1" color="gray">
                          {row.step}
                        </Text>
                        <Text size="2">{row.today}</Text>
                      </Flex>
                    </Box>
                  ))}
                </Flex>
              </Card>

              <Card variant="surface" size="3">
                <Flex direction="column" gap="3">
                  <Badge color="blue" size="2">
                    {BRAND.name}
                  </Badge>
                  {COMPARISON.map((row, index) => (
                    <Box key={row.step}>
                      {index > 0 ? <Separator size="4" mb="3" /> : null}
                      <Flex direction="column" gap="1">
                        <Text size="1" color="gray">
                          {row.step}
                        </Text>
                        <Text size="2">{row.here}</Text>
                      </Flex>
                    </Box>
                  ))}
                </Flex>
              </Card>
            </Grid>
          </Flex>
        </Container>
      </Section>

      {/* ---------------------------------------------------------------
          FAQ. Native <details>/<summary> — see .v1-m-faq in globals.css.
          --------------------------------------------------------------- */}
      <Section size={{ initial: "3", md: "4" }} style={{ borderTop: "1px solid var(--gray-a5)" }}>
        <Container size="2" px="4">
          <Flex direction="column" gap="5">
            <Heading size={{ initial: "7", sm: "8" }} trim="start">
              Questions worth asking first
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
                  Try it on your next trip.
                </Heading>
                <Text size="3" style={NAVY_INK_MUTED}>
                  {TRIAL_LABEL}, {PRICE_LABEL} after. Card required to start,
                  and your data is exportable from the day you put it in.
                </Text>
              </Flex>
              <Flex gap="3" wrap="wrap" flexShrink="0">
                <Button asChild size="4" style={NAVY_SURFACE_INVERSE}>
                  <NextLink href="/signup">Start free trial</NextLink>
                </Button>
                <Button asChild size="4" variant="outline" style={NAVY_INK}>
                  <NextLink href="/pricing">See what's included</NextLink>
                </Button>
              </Flex>
            </Flex>
          </Box>
        </Container>
      </Section>
    </>
  );
}

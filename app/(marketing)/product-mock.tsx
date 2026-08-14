import { Badge, Box, Button, Card, Flex, Grid, Separator, Table, Text } from "@/components/ui";
import { BRAND } from "@/lib/brand";
import { formatDate, formatDateRange } from "@/lib/format";
import { visibleNavSections } from "@/lib/nav";

/**
 * The mock's rail shows the FLAG-OFF nav — visibleNavSections(false), the
 * same helper the real rail renders from when the currency engine is
 * disabled. The public page must advertise exactly what a new signup's
 * deployment shows, and the counsel-gated section may appear on no public
 * surface until its gate clears (docs/PRICING.md §4) — so the marketing
 * mock is pinned to the flag-off view rather than the raw NAV_SECTIONS
 * list, which deliberately includes gated entries for robots.txt's sake.
 */
const MOCK_NAV_SECTIONS = visibleNavSections(false);

/**
 * A HAND-BUILT MOCK OF THE OVERVIEW DASHBOARD, for the marketing page only.
 *
 * The real screen is behind requireAccount() (app/(app)/layout.tsx), so it
 * cannot be screenshotted for a signed-out visitor and a screenshot would
 * go stale the first time the dashboard changed. This is the honest
 * alternative: the same Radix components from "@/components/ui", the same
 * Theme (radius, scaling, panelBackground all inherited from the one
 * <Theme> in app/layout.tsx), the same section names from lib/nav.ts, and
 * the same panel structure the real app/(app)/overview/page.tsx renders —
 * KPI row, document expirations, ready-to-invoice — so it looks like the
 * product because it is built out of the product's own parts.
 *
 * EVERY FIGURE, NAME AND TAIL NUMBER BELOW IS INVENTED. There is no
 * customer here and nothing on this component may ever be presented as
 * one: the pilot, the three client names and the registrations are
 * synthetic, chosen to be plausible rather than real. Airports are real
 * ICAO identifiers because a made-up identifier would read as wrong to the
 * only audience this page has.
 *
 * It is deliberately static markup — no state, no props, no data — so it
 * can never drift into being mistaken for a live view of anything.
 */

const KPIS = [
  { label: "Unbilled work", value: "$18,400.00", sub: "3 trips · oldest 11 days" },
  { label: "Awaiting payment", value: "$9,150.00", sub: "2 invoices" },
  { label: "Paid this year", value: "$146,900.00", sub: "24 payments" },
  { label: "Deductible expenses", value: "$12,865.40", sub: "38 receipts filed" },
];

// Dates below are ISO ("YYYY-MM-DD") and rendered through lib/format.ts's
// own formatDate/formatDateRange — the same functions the real screens
// call — so this mock's date STRINGS cannot drift from the product's
// ("Apr 30, 2026", not a hand-typed "30 Apr 2026") even though its data is
// invented. See the file header: EVERY figure below is still synthetic.
const READY_TO_INVOICE = [
  {
    client: "Northlight Air Partners",
    route: "KBED → KTEB → KBED",
    tailNumber: "N412SP",
    days: 3,
    startsOn: "2026-03-04",
    endsOn: "2026-03-06",
    amount: "$7,350.00",
  },
  {
    client: "Cardinal Ridge Aviation",
    route: "KHPN → KPBI",
    tailNumber: "N778QC",
    days: 2,
    startsOn: "2026-03-11",
    endsOn: "2026-03-12",
    amount: "$5,900.00",
  },
  {
    client: "Harbor Rock Holdings",
    route: "KTEB → KASE → KTEB",
    tailNumber: "N219DL",
    days: 2,
    startsOn: "2026-03-18",
    endsOn: "2026-03-19",
    amount: "$5,150.00",
  },
];

const EXPIRATIONS: { label: string; date: string; tone: "amber" | "gray"; badge: string }[] = [
  // 61.23: medical validity always runs through the LAST DAY of a
  // calendar month, so a mid-month date here would read as wrong to the
  // only audience this page has — see the file header's own standard.
  { label: "First-class medical", date: "2026-04-30", tone: "amber", badge: "30 days" },
  { label: "Flight review", date: "2026-09-30", tone: "gray", badge: "OK" },
  { label: "Passport", date: "2028-06-14", tone: "gray", badge: "OK" },
];

export default function ProductMock() {
  return (
    <Box className="v1-m-mock-scroll">
      <Box className="v1-m-mock-inner">
        {/* color re-established explicitly: the mock sits inside the navy
            hero (.v1-m-dark), whose white ink otherwise INHERITS into any
            Text that doesn't set a color prop — the rail's current item
            and the mock's page title were rendering white-on-white. The
            frame paints the app's light ground, so it must also restore
            the app's default ink (--ink, the app's ink token
            sets). Caught by the rebuild QA pass, rule 12. */}
        <Box className="v1-m-mock-frame" style={{ color: "var(--ink)" }}>
          {/* Window chrome, so this reads as a screen rather than a card. */}
          <Flex align="center" gap="2" px="3" py="2" className="v1-m-mock-chrome">
            <Box className="v1-m-mock-dot" />
            <Box className="v1-m-mock-dot" />
            <Box className="v1-m-mock-dot" />
            <Text size="1" color="gray" ml="2">
              {BRAND.name} — Overview
            </Text>
          </Flex>

          <Flex>
            {/* Nav rail, labelled from lib/nav.ts so it can never name a
                section the product does not have. */}
            <Box
              p="3"
              width="9rem"
              flexShrink="0"
              display={{ initial: "none", sm: "block" }}
              style={{ borderRight: "1px solid var(--edge)" }}
            >
              <Flex direction="column" gap="2">
                {MOCK_NAV_SECTIONS.map((item, index) => (
                  <Text
                    key={item.href}
                    size="1"
                    color={index === 0 ? undefined : "gray"}
                    weight={index === 0 ? "medium" : "light"}
                  >
                    {item.label}
                  </Text>
                ))}
              </Flex>
            </Box>

            <Box p="4" flexGrow="1">
              <Flex direction="column" gap="4">
                <Flex justify="between" align="start" gap="3">
                  <Flex direction="column" gap="1">
                    <Text size="4" weight="medium">
                      Overview
                    </Text>
                    <Text size="1" color="gray">
                      3 trips flown and logged but not yet invoiced. No invoices
                      past due.
                    </Text>
                  </Flex>
                  <Flex gap="2" flexShrink="0">
                    <Button size="1" variant="outline" tabIndex={-1}>
                      Log a trip
                    </Button>
                    <Button size="1" tabIndex={-1}>
                      Create invoice
                    </Button>
                  </Flex>
                </Flex>

                <Grid columns={{ initial: "2", md: "4" }} gap="3">
                  {KPIS.map((kpi) => (
                    <Card key={kpi.label} variant="surface" size="1">
                      <Flex direction="column" gap="1">
                        <Text size="1" color="gray">
                          {kpi.label}
                        </Text>
                        <Text size="5" weight="bold" className="tnum">
                          {kpi.value}
                        </Text>
                        <Text size="1" color="gray">
                          {kpi.sub}
                        </Text>
                      </Flex>
                    </Card>
                  ))}
                </Grid>

                <Grid columns={{ initial: "1", md: "2" }} gap="3">
                  <Card variant="surface" size="1">
                    <Flex direction="column" gap="1" mb="2">
                      <Text size="2" weight="medium">
                        Ready to invoice
                      </Text>
                      <Text size="1" color="gray">
                        3 trips
                      </Text>
                    </Flex>
                    <Flex direction="column">
                      {READY_TO_INVOICE.map((trip, index) => (
                        <Box key={trip.client}>
                          {index > 0 ? <Separator size="4" /> : null}
                          <Flex justify="between" align="start" gap="3" py="2">
                            <Flex direction="column">
                              <Text size="1" weight="medium">
                                {trip.client}
                              </Text>
                              <Text size="1" color="gray">
                                {trip.route}
                              </Text>
                              <Text size="1" color="gray">
                                {trip.tailNumber} · {trip.days} days ·{" "}
                                {formatDateRange(trip.startsOn, trip.endsOn)}
                              </Text>
                            </Flex>
                            <Text size="1" weight="medium" className="tnum">
                              {trip.amount}
                            </Text>
                          </Flex>
                        </Box>
                      ))}
                    </Flex>
                  </Card>

                  <Card variant="surface" size="1">
                    <Flex direction="column" gap="1" mb="2">
                      <Text size="2" weight="medium">
                        Document expirations
                      </Text>
                      <Text size="1" color="gray">
                        Medical, flight review, and passport dates from your
                        documents
                      </Text>
                    </Flex>
                    <Table.Root variant="surface" size="1">
                      <Table.Header>
                        <Table.Row>
                          <Table.ColumnHeaderCell>Document</Table.ColumnHeaderCell>
                          <Table.ColumnHeaderCell>Expires</Table.ColumnHeaderCell>
                          <Table.ColumnHeaderCell justify="end">
                            Status
                          </Table.ColumnHeaderCell>
                        </Table.Row>
                      </Table.Header>
                      <Table.Body>
                        {EXPIRATIONS.map((row) => (
                          <Table.Row key={row.label}>
                            <Table.Cell>
                              <Text size="1" weight="medium">
                                {row.label}
                              </Text>
                            </Table.Cell>
                            <Table.Cell>
                              <Text size="1" color="gray">
                                {formatDate(row.date)}
                              </Text>
                            </Table.Cell>
                            <Table.Cell justify="end">
                              <Badge color={row.tone} size="1">
                                {row.badge}
                              </Badge>
                            </Table.Cell>
                          </Table.Row>
                        ))}
                      </Table.Body>
                    </Table.Root>
                  </Card>
                </Grid>
              </Flex>
            </Box>
          </Flex>
        </Box>
      </Box>
    </Box>
  );
}

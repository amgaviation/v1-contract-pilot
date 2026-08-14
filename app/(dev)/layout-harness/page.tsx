import { notFound } from "next/navigation";
import {
  Badge,
  Box,
  Button,
  Card,
  Flex,
  Grid,
  Heading,
  Table,
  Text,
  TextField,
} from "@/components/ui";
import { NAV_SECTIONS } from "@/lib/nav";
import { themeForSlots, DEFAULT_THEME_SLOTS } from "@/lib/theme-slots";
import { AppShell } from "../../(app)/app-shell";

/**
 * THE LAYOUT HARNESS — development only, 404 everywhere else.
 *
 * It renders the real <AppShell> (the same component app/(app)/layout.tsx
 * renders) around content chosen to be the WORST CASE the product
 * actually contains, so scripts/layout-verify.mjs can measure the shell
 * across a viewport matrix without a session, a tenant, or a row of live
 * data. Nothing here reads the database; every string is a fixture.
 *
 * Why a harness at all: the shell is behind requireAccount(), so until
 * this existed the responsive behaviour of every page in the product was
 * the only part of it with no automated check. It got eyeballed at
 * whatever width the last person had their window, and it drifted — a
 * fixed rail crushing the canvas between 768 and 1023px, a header whose
 * Sign out button a long email address pushed off the right edge, and a
 * 1136px cap that wasted half a large monitor, all shipped.
 *
 * The content below is deliberately hostile, and each piece is here
 * because it is a real shape from a real screen:
 *
 *   - a 12-column table            the year-end packet and trip P&L
 *   - a 4-up KPI grid              Overview's money row
 *   - an unbroken 46-char token    a Stripe payment-intent id, rendered
 *                                  on the invoice payment panel
 *   - a 44-char email              the header's unbounded user string
 *   - a long unbroken account name a tenant-supplied value in the rail
 *   - a form row of inputs         every settings panel
 *
 * If you add a shape to the product that the shell has to survive, add it
 * here too — the verify script is only as good as what it is pointed at.
 */

const FIXTURE_EMAIL = "operations.department@meridian-air-charter.com";
const FIXTURE_ACCOUNT = "Meridian Air Charter Holdings LLC";
const FIXTURE_INTENT = "pi_3PxQ7bK2eZvKYlo2C9tRfWq8_secret_aB9";

const COLUMNS = [
  "Date",
  "Trip",
  "Client",
  "Tail",
  "Route",
  "Days",
  "Day rate",
  "Travel",
  "Per diem",
  "Expenses",
  "Invoiced",
  "Margin",
];

const ROW = [
  "2026-08-14",
  "TRP-1042",
  "Meridian Air Charter",
  "N512QS",
  "KTEB–KASE–KTEB",
  "3",
  "$1,350.00",
  "$675.00",
  "$225.00",
  "$1,184.20",
  "$4,634.20",
  "$3,450.00",
];

export default async function LayoutHarnessPage() {
  // Belt and braces. The route group is not excluded from the production
  // build, so the guard — not the absence of a link to it — is what keeps
  // this off the live site.
  if (process.env.NODE_ENV !== "development") notFound();

  const theme = themeForSlots(DEFAULT_THEME_SLOTS);

  return (
    <AppShell
      userEmail={FIXTURE_EMAIL}
      accountName={FIXTURE_ACCOUNT}
      sections={NAV_SECTIONS}
      theme={theme}
      readOnly={false}
      // The real shell takes a server action here. The harness never
      // submits it; it exists so the button renders at its true size.
      signOutAction={async () => {
        "use server";
      }}
    >
      <Flex direction="column" gap="4">
        <Heading size="6">Layout harness</Heading>

        {/* Overview's money row. `initial: 1` matters: four KPI cards
            side by side at 320px is four illegible slivers. */}
        <Grid columns={{ initial: "1", xs: "2", lg: "4" }} gap="3">
          {[
            ["Unbilled work", "$18,420.00"],
            ["Awaiting payment", "$32,905.50"],
            ["Paid this year", "$214,338.75"],
            ["Deductible expenses", "$9,881.40"],
          ].map(([label, figure]) => (
            <Card key={label}>
              <Text as="div" size="1" color="gray">
                {label}
              </Text>
              <Text as="div" size="6" className="tnum">
                {figure}
              </Text>
            </Card>
          ))}
        </Grid>

        {/* The unbounded-token case. A payment-intent id has no spaces to
            break at, so without wrapAnywhere it is a single 46px-wide
            word that sets its container's min-content width and pushes
            the page sideways at every viewport narrower than it. */}
        <Card>
          <Text as="div" size="1" color="gray">
            Payment reference
          </Text>
          {/* overflowWrap anywhere, not just wrap="wrap": text-wrap only
              breaks at spaces and this token has none. This mattered from
              the day .tnum came back to life — the class now really applies
              JetBrains Mono, whose wider advance pushed this card past a
              320px viewport by 13px, which is exactly the sideways-scroll
              failure this harness exists to catch. */}
          <Text
            as="div"
            size="2"
            wrap="wrap"
            className="tnum"
            style={{ overflowWrap: "anywhere" }}
          >
            {FIXTURE_INTENT}
          </Text>
        </Card>

        {/* A settings form row. */}
        <Card>
          <Flex gap="3" wrap="wrap" align="end">
            <Box minWidth="0" flexGrow="1">
              <Text as="label" size="1" color="gray">
                Default day rate
              </Text>
              <TextField.Root placeholder="1350.00" />
            </Box>
            <Box minWidth="0" flexGrow="1">
              <Text as="label" size="1" color="gray">
                Payment terms
              </Text>
              <TextField.Root placeholder="Net 30" />
            </Box>
            <Button>Save</Button>
          </Flex>
        </Card>

        {/* The 12-column table. Radix's Table.Root already wraps its
            <table> in a ScrollArea, so the correct behaviour is for THIS
            to scroll inside its own frame while the page does not move —
            which is exactly what the verify script asserts. */}
        <Card>
          <Table.Root variant="surface" size="1">
            <Table.Header>
              <Table.Row>
                {COLUMNS.map((c) => (
                  <Table.ColumnHeaderCell key={c}>{c}</Table.ColumnHeaderCell>
                ))}
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {[0, 1, 2, 3].map((i) => (
                <Table.Row key={i}>
                  {ROW.map((cell, j) => (
                    <Table.Cell key={j} className={j >= 5 ? "tnum" : undefined}>
                      {j === 1 ? <Badge color="green">{cell}</Badge> : cell}
                    </Table.Cell>
                  ))}
                </Table.Row>
              ))}
            </Table.Body>
          </Table.Root>
        </Card>
      </Flex>
    </AppShell>
  );
}

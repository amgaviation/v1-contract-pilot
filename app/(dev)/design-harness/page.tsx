import { notFound } from "next/navigation";
import "@/app/design/tokens.css";
import "@/app/design/system.generated.css";
import { Box, Flex, Grid, Measure, Stack } from "@/components/ds/layout";
import { Caps, Figure, Heading, Link, Text } from "@/components/ds/type";
import {
  Badge,
  Button,
  Checkbox,
  FieldError,
  Hint,
  Input,
  Label,
  Note,
  Panel,
  Select,
  Separator,
  Spinner,
  Table,
  Textarea,
} from "@/components/ds/surface";
import { TONE } from "@/lib/ds/scales";

/**
 * INSTRUMENT — the specimen sheet. Development only; 404s elsewhere.
 *
 * Every primitive in the system rendered at every tone and size, on real
 * product content rather than lorem ipsum, so the system can be LOOKED AT and
 * MEASURED rather than argued about. It is also what scripts/layout-verify.mjs
 * points at to prove the new components satisfy the responsive contract.
 *
 * The content is deliberately the product's own worst cases — a twelve-column
 * table, money columns, a tail number, an unbroken payment reference — for the
 * same reason the layout harness uses them: a specimen sheet of short happy
 * strings proves nothing about a system that has to hold a year of logbook
 * entries.
 */

const TRIP_COLUMNS = [
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

const TRIP_ROWS = [
  ["2026-08-11", "TRP-1042", "Meridian Air Charter", "N512QS", "KTEB–KASE–KTEB", "3", "4,050.00", "675.00", "225.00", "1,184.20", "6,134.20", "4,950.00"],
  ["2026-08-04", "TRP-1041", "Cardinal Aviation LLC", "N880CT", "KHPN–KMIA", "2", "2,700.00", "0.00", "150.00", "412.65", "3,262.65", "2,850.00"],
  ["2026-07-28", "TRP-1039", "Sterling Jet Partners", "N147SJ", "KBED–KLAS–KBED", "4", "5,400.00", "1,350.00", "300.00", "2,038.90", "9,088.90", "6,750.00"],
];

export default async function DesignHarnessPage() {
  if (process.env.NODE_ENV !== "development") notFound();

  return (
    <Measure p={{ initial: "4", md: "6" }}>
      <Stack gap="6">
        <Box>
          <Caps>Design system</Caps>
          <Heading size="6" as="h1">
            INSTRUMENT
          </Heading>
          <Text tone="muted" as="p" mt="2">
            Every primitive, every tone. See{" "}
            <Link href="/design-harness">docs/design/INSTRUMENT.md</Link> for the
            reasoning. Rendered at density{" "}
            <Figure>default</Figure>.
          </Text>
        </Box>

        <Separator />

        {/* ── TYPE ── */}
        <Panel title="Type scale">
          <Stack gap="3">
            {(["1", "2", "3", "4", "5", "6", "7"] as const).map((s) => (
              <Flex key={s} gap="4" align="baseline" wrap="wrap">
                <Figure size="1" tone="faint" style={{ width: "3ch" }}>
                  {s}
                </Figure>
                <Text size={s}>Log the trip once — Inter body</Text>
                <Heading size={s}>Archivo display</Heading>
                <Figure size={s}>1,234.56</Figure>
              </Flex>
            ))}
          </Stack>
        </Panel>

        {/* ── TONES ── */}
        <Panel title="Tones" aside={<Caps>named by meaning, never by hue</Caps>}>
          <Grid columns={{ initial: "1", xs: "2", md: "4" }} gap="3">
            {TONE.map((t) => (
              <Box key={t}>
                <Text tone={t} weight="semibold" as="div">
                  {t}
                </Text>
                <Badge tone={t}>{t}</Badge>
              </Box>
            ))}
          </Grid>
        </Panel>

        {/* ── BUTTONS ── */}
        <Panel title="Buttons" aside={<Caps>primary is ink, not accent</Caps>}>
          <Stack gap="4">
            {(["1", "2", "3"] as const).map((size) => (
              <Flex key={size} gap="2" wrap="wrap" align="center">
                <Figure size="1" tone="faint" style={{ width: "3ch" }}>
                  {size}
                </Figure>
                <Button variant="primary" size={size}>
                  Create invoice
                </Button>
                <Button variant="outline" size={size}>
                  Save draft
                </Button>
                <Button variant="quiet" size={size}>
                  Cancel
                </Button>
                <Button variant="danger" size={size}>
                  Void
                </Button>
                <Button variant="outline" size={size} disabled>
                  Disabled
                </Button>
              </Flex>
            ))}
          </Stack>
        </Panel>

        {/* ── NOTES ── */}
        <Panel title="Notes">
          <Stack gap="3">
            <Note tone="signal">
              This invoice was viewed by the client on 12 August.
            </Note>
            <Note tone="ok">Payment of $6,134.20 received and reconciled.</Note>
            <Note tone="caution">
              Your medical certificate expires in 21 days.
            </Note>
            <Note tone="warn">
              Invoice INV-2044 is 34 days overdue. A reminder was sent on 9 August.
            </Note>
          </Stack>
        </Panel>

        {/* ── FORM ── */}
        <Panel title="Form controls">
          <Grid columns={{ initial: "1", sm: "2" }} gap="4">
            <Box>
              <Label htmlFor="h-rate">Default day rate</Label>
              <Input id="h-rate" defaultValue="1350.00" inputMode="decimal" />
              <Hint>Applied to new trips for this client.</Hint>
            </Box>
            <Box>
              <Label htmlFor="h-terms">Payment terms</Label>
              <Select id="h-terms" defaultValue="30">
                <option value="0">Due on receipt</option>
                <option value="15">Net 15</option>
                <option value="30">Net 30</option>
              </Select>
              <Hint>Native select — opens the OS picker on a phone.</Hint>
            </Box>
            <Box>
              <Label htmlFor="h-tail">Tail number</Label>
              <Input id="h-tail" defaultValue="N512Q" aria-invalid="true" />
              <FieldError>
                A US registration is N followed by 1–5 characters.
              </FieldError>
            </Box>
            <Box>
              <Label htmlFor="h-notes">Notes</Label>
              <Textarea id="h-notes" defaultValue="Repositioned KTEB→KASE empty." />
            </Box>
            <Flex gap="2" align="center">
              <Checkbox id="h-rebill" defaultChecked />
              <Text as="label" size="2" htmlFor="h-rebill">
                Rebill expenses to the client
              </Text>
            </Flex>
            <Flex gap="3" align="center">
              <Spinner size="1" />
              <Spinner size="2" />
              <Spinner size="3" />
              <Text size="2" tone="muted">
                Loading states
              </Text>
            </Flex>
          </Grid>
        </Panel>

        {/* ── TABLE ── */}
        <Panel
          title="Trips"
          aside={<Caps>12 columns — scrolls inside its own frame</Caps>}
          flush
        >
          <Table.Root>
            <Table.Header>
              <Table.Row>
                {TRIP_COLUMNS.map((c, i) => (
                  <Table.ColumnHead key={c} numeric={i >= 5}>
                    {c}
                  </Table.ColumnHead>
                ))}
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {TRIP_ROWS.map((row, r) => (
                <Table.Row key={row[1]} selected={r === 1}>
                  {row.map((cell, i) => (
                    <Table.Cell key={i} numeric={i >= 5}>
                      {i === 1 ? (
                        <Badge tone={r === 0 ? "ok" : r === 1 ? "caution" : "warn"}>
                          {cell}
                        </Badge>
                      ) : i >= 3 ? (
                        <Figure>{cell}</Figure>
                      ) : (
                        cell
                      )}
                    </Table.Cell>
                  ))}
                </Table.Row>
              ))}
            </Table.Body>
            <Table.Foot>
              <Table.Row>
                <Table.Cell colSpan={6}>Total</Table.Cell>
                <Table.Cell numeric>
                  <Figure weight="semibold">12,150.00</Figure>
                </Table.Cell>
                <Table.Cell numeric>
                  <Figure weight="semibold">2,025.00</Figure>
                </Table.Cell>
                <Table.Cell numeric>
                  <Figure weight="semibold">675.00</Figure>
                </Table.Cell>
                <Table.Cell numeric>
                  <Figure weight="semibold">3,635.75</Figure>
                </Table.Cell>
                <Table.Cell numeric>
                  <Figure weight="semibold">18,485.75</Figure>
                </Table.Cell>
                <Table.Cell numeric>
                  <Figure weight="semibold">14,550.00</Figure>
                </Table.Cell>
              </Table.Row>
            </Table.Foot>
          </Table.Root>
        </Panel>

        {/* ── UNBROKEN TOKEN ── */}
        <Panel title="Unbounded strings">
          <Stack gap="2">
            <Caps>Payment reference</Caps>
            <Figure style={{ overflowWrap: "anywhere" }}>
              pi_3PxQ7bK2eZvKYlo2C9tRfWq8_secret_aB9xKq2mZ
            </Figure>
            <Caps>Account</Caps>
            <Text truncate title="Meridian Air Charter Holdings LLC">
              Meridian Air Charter Holdings LLC
            </Text>
          </Stack>
        </Panel>
      </Stack>
    </Measure>
  );
}

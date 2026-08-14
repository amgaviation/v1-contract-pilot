import { notFound } from "next/navigation";
import {
  AlertDialog,
  Badge,
  Box,
  Button,
  Callout,
  Card,
  Checkbox,
  Code,
  DataList,
  Flex,
  Grid,
  Heading,
  Link,
  RadioGroup,
  SegmentedControl,
  Select,
  Separator,
  Switch,
  Table,
  Tabs,
  Text,
  TextArea,
  TextField,
} from "@/components/ui";

/**
 * THE SEAM HARNESS — development only, 404s elsewhere.
 *
 * The authenticated screens cannot be rendered here: they are behind
 * requireAccount() and every one of them queries Supabase, so exercising them
 * needs a seeded tenant, which needs a Supabase branch or a local stack. What
 * CAN be exercised is the thing that actually changed underneath them — the
 * compatibility seam in components/ui — and that is what this page is.
 *
 * Every component below is called with the PROP SHAPES the authenticated
 * screens really use, extracted by walking app/(app) and counting them rather
 * than imagined. So `justify="between"` appears here because 55 table cells
 * pass it, `Select.Trigger id=` appears because 20 fields do, and a Separator
 * carries `my` because twelve of them do.
 *
 * That extraction is what this page is for, and it earned its place
 * immediately: comparing the props the screens PASS against the props the seam
 * FORWARDS turned up three silent drops that no type-check or build could see
 * — a Separator swallowing its margins, table cells losing every alignment
 * except "end", and Select.Trigger dropping the `id` that twenty <label
 * htmlFor> attributes point at.
 *
 * If you widen the seam, add the shape here. A seam is only as verified as
 * the shapes something actually renders.
 */

const COLUMNS = ["Date", "Invoice", "Client", "Status", "Due", "Amount", "Balance"];
const ROWS = [
  ["2026-08-11", "INV-2044", "Meridian Air Charter", "Paid", "2026-09-10", "6,134.20", "0.00"],
  ["2026-08-04", "INV-2043", "Cardinal Aviation LLC", "Sent", "2026-09-03", "3,262.65", "3,262.65"],
  ["2026-07-28", "INV-2041", "Sterling Jet Partners", "Overdue", "2026-08-27", "9,088.90", "9,088.90"],
];

export default async function SeamHarnessPage() {
  if (process.env.NODE_ENV !== "development") notFound();

  return (
    <Box p={{ initial: "4", md: "6" }}>
      <Flex direction="column" gap="5">
        <Box>
          <Heading size="6" as="h1" mb="2">
            Seam harness
          </Heading>
          <Text size="2" color="gray">
            Every shimmed component, called with the prop shapes the
            authenticated screens actually use.
          </Text>
        </Box>

        <Separator size="4" my="3" />

        {/* Text: the highest-traffic component in the product, 1106 size and
            859 color props across the authenticated screens. */}
        <Card size="2">
          <Heading size="4" as="h2" mb="3">
            Text and headings
          </Heading>
          <Flex direction="column" gap="1">
            <Text size="1" color="gray">
              size 1, gray — the meta line under a figure
            </Text>
            <Text size="2">size 2 — the table and form default</Text>
            <Text size="3" weight="medium">
              size 3, medium
            </Text>
            <Text size="2" color="red" role="alert">
              size 2, red, role=alert — a field error
            </Text>
            <Text size="2" color="amber">
              size 2, amber — needs attention
            </Text>
            <Text size="2" color="green">
              size 2, green — reconciled
            </Text>
            <Text size="2" color="gray" highContrast>
              size 2, gray + highContrast — primary copy after all
            </Text>
            <Text size="2" align="center">
              align=center
            </Text>
            <Text asChild size="2" color="gray">
              <a href="/seam-harness">Text asChild wrapping an anchor</a>
            </Text>
            <Code variant="ghost" size="2" color="gray">
              pi_3PxQ7bK2eZvKYlo2C9tRfWq8
            </Code>
          </Flex>
        </Card>

        {/* Buttons: 242 variant props, 86 color props. */}
        <Card size="2">
          <Heading size="4" as="h2" mb="3">
            Buttons
          </Heading>
          <Flex gap="2" wrap="wrap" align="center">
            <Button>no variant (Radix default was solid)</Button>
            <Button variant="solid">solid</Button>
            <Button variant="outline">outline</Button>
            <Button variant="soft" color="gray">
              soft gray
            </Button>
            <Button variant="ghost">ghost</Button>
            <Button variant="outline" color="red">
              outline red
            </Button>
            <Button size="1">size 1</Button>
            <Button size="3">size 3</Button>
            <Button disabled>disabled</Button>
          </Flex>
        </Card>

        {/* Callout: 163 color props, and every call site passes an Icon. */}
        <Card size="2">
          <Heading size="4" as="h2" mb="3">
            Callouts
          </Heading>
          <Flex direction="column" gap="2">
            {(["red", "amber", "green", "blue"] as const).map((c) => (
              <Callout.Root key={c} color={c} size="1">
                <Callout.Icon>
                  <span aria-hidden>!</span>
                </Callout.Icon>
                <Callout.Text>
                  color={c} — with the Icon slot every call site passes
                </Callout.Text>
              </Callout.Root>
            ))}
          </Flex>
        </Card>

        {/* Fields. Select.Trigger carries id on 20 real fields — dropping it
            breaks the <label htmlFor> pointing at it. */}
        <Card size="2">
          <Heading size="4" as="h2" mb="3">
            Fields
          </Heading>
          <Grid columns={{ initial: "1", sm: "2" }} gap="4">
            <Box>
              <Text as="label" size="2" htmlFor="seam-rate" mb="1">
                Day rate (TextField)
              </Text>
              <TextField.Root
                id="seam-rate"
                name="rate"
                defaultValue="1350.00"
                inputMode="decimal"
                placeholder="0.00"
              >
                <TextField.Slot side="right">USD</TextField.Slot>
              </TextField.Root>
            </Box>
            <Box>
              <Text as="label" size="2" htmlFor="seam-terms" mb="1">
                Terms (Select with id + aria-labelledby)
              </Text>
              <Select.Root defaultValue="30" name="terms">
                <Select.Trigger id="seam-terms" aria-labelledby="seam-terms-label" />
                <Select.Content>
                  <Select.Item value="0">Due on receipt</Select.Item>
                  <Select.Item value="15">Net 15</Select.Item>
                  <Select.Item value="30">Net 30</Select.Item>
                </Select.Content>
              </Select.Root>
            </Box>
            <Box>
              <Text as="label" size="2" htmlFor="seam-notes" mb="1">
                Notes (TextArea)
              </Text>
              <TextArea id="seam-notes" name="notes" rows={3} defaultValue="Repositioned empty." />
            </Box>
            <Flex direction="column" gap="2">
              <Flex gap="2" align="center">
                <Checkbox id="seam-rebill" defaultChecked aria-label="Rebill" />
                <Text as="label" size="2" htmlFor="seam-rebill">
                  Checkbox
                </Text>
              </Flex>
              <Flex gap="2" align="center">
                <Switch name="reminders" defaultChecked aria-label="Reminders" />
                <Text size="2">Switch</Text>
              </Flex>
              <RadioGroup.Root defaultValue="a" aria-labelledby="seam-radio">
                <RadioGroup.Item value="a">Radio A</RadioGroup.Item>
                <RadioGroup.Item value="b">Radio B</RadioGroup.Item>
              </RadioGroup.Root>
              <SegmentedControl.Root defaultValue="m">
                <SegmentedControl.Item value="m">Month</SegmentedControl.Item>
                <SegmentedControl.Item value="q">Quarter</SegmentedControl.Item>
              </SegmentedControl.Root>
            </Flex>
          </Grid>
        </Card>

        {/* Table: justify appears as end (302), between (55) and center (8). */}
        <Card size="2">
          <Heading size="4" as="h2" mb="3">
            Table — all three justify values
          </Heading>
          <Table.Root variant="surface" size="1">
            <Table.Header>
              <Table.Row>
                {COLUMNS.map((c, i) => (
                  <Table.ColumnHeaderCell key={c} justify={i >= 5 ? "end" : i === 3 ? "center" : undefined}>
                    {c}
                  </Table.ColumnHeaderCell>
                ))}
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {ROWS.map((row) => (
                <Table.Row key={row[1]}>
                  {row.map((cell, i) => (
                    <Table.Cell
                      key={i}
                      justify={i >= 5 ? "end" : i === 3 ? "center" : undefined}
                    >
                      {i === 3 ? (
                        <Badge color={cell === "Paid" ? "green" : cell === "Sent" ? "blue" : "red"}>
                          {cell}
                        </Badge>
                      ) : (
                        cell
                      )}
                    </Table.Cell>
                  ))}
                </Table.Row>
              ))}
              <Table.Row>
                <Table.Cell colSpan={4} justify="between">
                  <Text size="2">justify=&quot;between&quot; spreads its children</Text>
                  <Text size="2" color="gray">
                    right side
                  </Text>
                </Table.Cell>
                <Table.Cell colSpan={3} justify="end">
                  18,485.75
                </Table.Cell>
              </Table.Row>
            </Table.Body>
          </Table.Root>
        </Card>

        {/* DataList + Tabs + AlertDialog. */}
        <Card size="2">
          <Heading size="4" as="h2" mb="3">
            DataList, Tabs, AlertDialog
          </Heading>
          <DataList.Root size="2" orientation="vertical">
            <DataList.Item>
              <DataList.Label minWidth="88px">Tail number</DataList.Label>
              <DataList.Value>N512QS</DataList.Value>
            </DataList.Item>
            <DataList.Item>
              <DataList.Label minWidth="88px">Route</DataList.Label>
              <DataList.Value>KTEB–KASE–KTEB</DataList.Value>
            </DataList.Item>
          </DataList.Root>

          <Separator size="4" my="4" />

          <Tabs.Root defaultValue="one">
            <Tabs.List aria-label="Seam tabs">
              <Tabs.Trigger value="one">Business</Tabs.Trigger>
              <Tabs.Trigger value="two">Day types</Tabs.Trigger>
            </Tabs.List>
            <Tabs.Content value="one">
              <Text size="2" color="gray">
                Panel one
              </Text>
            </Tabs.Content>
            <Tabs.Content value="two">
              <Text size="2" color="gray">
                Panel two
              </Text>
            </Tabs.Content>
          </Tabs.Root>

          <Separator size="4" my="4" />

          <AlertDialog.Root>
            <AlertDialog.Trigger>
              <Button variant="outline" color="red">
                Delete trip
              </Button>
            </AlertDialog.Trigger>
            <AlertDialog.Content maxWidth="420px">
              <AlertDialog.Title>Delete this trip?</AlertDialog.Title>
              <AlertDialog.Description size="2">
                This deletes the trip and its legs. This can&rsquo;t be undone.
              </AlertDialog.Description>
              <Flex gap="3" mt="4" justify="end">
                <AlertDialog.Cancel>
                  <Button variant="soft" color="gray">
                    Cancel
                  </Button>
                </AlertDialog.Cancel>
                <Button variant="solid" color="red">
                  Delete trip
                </Button>
              </Flex>
            </AlertDialog.Content>
          </AlertDialog.Root>
        </Card>

        <Card size="2">
          <Heading size="4" as="h2" mb="3">
            Link — asChild is the dominant shape
          </Heading>
          <Flex gap="4" wrap="wrap">
            <Link href="/seam-harness">plain href</Link>
            <Link asChild weight="medium">
              <a href="/seam-harness">asChild + weight</a>
            </Link>
            <Link asChild size="2">
              <a href="/seam-harness">asChild + size</a>
            </Link>
          </Flex>
        </Card>
      </Flex>
    </Box>
  );
}

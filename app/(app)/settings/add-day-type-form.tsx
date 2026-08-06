"use client";

import { useActionState, useEffect, useState } from "react";
import { Button, Card, Flex, Grid, Heading, Select, Switch, Text, TextField } from "@radix-ui/themes";
import { createDayType, type DayTypeFormState } from "./day-types-actions";

const initialState: DayTypeFormState = { error: null };

const LINE_TYPE_OPTIONS = [
  { value: "flight_day", label: "Flight day line" },
  { value: "travel_day", label: "Travel day line" },
  { value: "other", label: "Other line" },
] as const;

export default function AddDayTypeForm() {
  const [state, formAction, pending] = useActionState(createDayType, initialState);

  // On success no `values` are echoed, so React 19's per-dispatch form
  // reset clears the fields for the next entry. On error they ARE
  // echoed, so a rejected add doesn't lose what was typed.
  const submitted = state.values;
  const initial = (key: string, fallback = "") => submitted?.[key] ?? fallback;
  const checked = (key: string, fallback: boolean) => {
    const echoed = submitted?.[key];
    return echoed === undefined ? fallback : echoed === "on";
  };

  // See the fix note in day-type-row.tsx: Select.Root's posting <select>
  // is always uncontrolled from React's point of view, so `name` is
  // dropped here too and the real value posts from a controlled hidden
  // input, re-seeded from the echoed submission on a rejected add.
  const [invoiceLineType, setInvoiceLineType] = useState(() =>
    initial("invoice_line_type", "flight_day")
  );
  useEffect(() => {
    if (submitted?.invoice_line_type !== undefined) {
      setInvoiceLineType(String(submitted.invoice_line_type));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [submitted]);

  return (
    <Card>
      <form action={formAction}>
        <Flex direction="column" gap="4" p="1">
          <Flex direction="column" gap="1">
            <Heading as="h2" size="4">Add a day type</Heading>
            <Text size="2" color="gray">
              Give it a name your trips and invoices will use. You choose which invoice line it
              bills as; that part is fixed.
            </Text>
          </Flex>

          <Grid columns={{ initial: "2", md: "10" }} gap="3" align="start">
            <Flex direction="column" gap="1" style={{ gridColumn: "span 4" }}>
              <Text size="1" color="gray">
                Label
              </Text>
              <TextField.Root name="label" required defaultValue={initial("label")} />
              <Text size="1" color="gray">
                Ground school day, for example
              </Text>
            </Flex>
            <Flex direction="column" gap="1" style={{ gridColumn: "span 2" }}>
              <Text as="label" size="2" color="gray">
                <Flex gap="2" align="center" mt="4">
                  <Switch
                    name="billable"
                    value="on"
                    defaultChecked={checked("billable", true)}
                    aria-label="Billable"
                  />
                  Billable
                </Flex>
              </Text>
            </Flex>
            <Flex direction="column" gap="1" style={{ gridColumn: "span 2" }}>
              <Text as="label" size="2" color="gray">
                <Flex gap="2" align="center" mt="4">
                  <Switch
                    name="counts_for_per_diem"
                    value="on"
                    defaultChecked={checked("counts_for_per_diem", true)}
                    aria-label="Counts for per diem"
                  />
                  Per diem
                </Flex>
              </Text>
            </Flex>
            <Flex direction="column" gap="1" style={{ gridColumn: "span 2" }}>
              <Text size="1" color="gray">
                Default rate (USD)
              </Text>
              <TextField.Root name="default_rate" inputMode="decimal" defaultValue={initial("default_rate")} />
              <Text size="1" color="gray">
                Optional
              </Text>
            </Flex>
            <Flex direction="column" gap="1" style={{ gridColumn: "span 2" }}>
              <Text as="label" size="1" color="gray" id="add-bills-as-label">
                Bills as
              </Text>
              <Select.Root value={invoiceLineType} onValueChange={setInvoiceLineType}>
                <Select.Trigger aria-labelledby="add-bills-as-label" />
                <Select.Content>
                  {LINE_TYPE_OPTIONS.map((option) => (
                    <Select.Item key={option.value} value={option.value}>
                      {option.label}
                    </Select.Item>
                  ))}
                </Select.Content>
              </Select.Root>
              <input type="hidden" name="invoice_line_type" value={invoiceLineType} />
            </Flex>
          </Grid>

          <div role="alert" aria-live="polite">
            {state.error ? (
              <Text size="1" color="red">
                {state.error}
              </Text>
            ) : state.saved ? (
              <Text size="1" color="green">
                Added.
              </Text>
            ) : null}
          </div>

          <Flex>
            <Button type="submit" disabled={pending}>
              {pending ? "Adding…" : "Add day type"}
            </Button>
          </Flex>
        </Flex>
      </form>
    </Card>
  );
}

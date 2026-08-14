"use client";

import { useActionState, useState, useTransition } from "react";
import NextLink from "next/link";
import {
  Button,
  Callout,
  Card,
  Flex,
  Heading,
  Link as RadixLink,
  Table,
  Text,
  TextField,
} from "@/components/ui";
import EmptyState from "@/components/ui/empty-state";
import { InfoCircledIcon } from "@radix-ui/react-icons";
import type { Database } from "@/lib/supabase/database.types";
import { saveMileageRate, deleteMileageRate, type MileageRateFormState } from "./mileage-rates-actions";

type MileageRateRow = Database["pilot"]["Tables"]["mileage_rates"]["Row"];

const initialState: MileageRateFormState = { error: null };

/** cents-per-mile with up to 3 fractional-cent digits → a display string. */
function formatRate(rate: number): string {
  // Trim trailing zeros beyond what was actually entered, but keep at
  // least one digit after the point when there is a fraction — this is
  // display only, never fed back into a form or a computation.
  return `${rate.toFixed(3).replace(/0+$/, "").replace(/\.$/, "")}¢/mi`;
}

/**
 * Lets the pilot record the standard mileage rate for each tax year, so
 * pilot.mileage_entries has something to snapshot at capture. This panel
 * NEVER shows a pre-filled or suggested figure — see mileage-rates-
 * actions.ts and the migration header for why a hardcoded or guessed rate
 * is worse than an empty field. The IRS publishes the current and historical
 * rates at the link below.
 */
export default function MileageRatesPanel({
  rates,
  canEdit,
}: {
  rates: MileageRateRow[];
  canEdit: boolean;
}) {
  const [state, formAction, pending] = useActionState(saveMileageRate, initialState);
  const [removing, startRemove] = useTransition();
  const [rowError, setRowError] = useState<string | null>(null);

  const submitted = state.values;
  const initial = (key: string, fallback = "") => {
    const echoed = submitted?.[key];
    return echoed === undefined ? fallback : echoed;
  };

  const currentYear = new Date().getUTCFullYear();
  const sorted = [...rates].sort((a, b) => b.tax_year - a.tax_year);

  return (
    <Card>
      <Flex direction="column" gap="4" p="2">
        <Flex direction="column" gap="1">
          <Heading as="h3" size="4">
            Mileage rates
          </Heading>
        </Flex>

        <Callout.Root color="blue">
          <Callout.Icon>
            <InfoCircledIcon />
          </Callout.Icon>
          <Callout.Text>
            <Text as="div" size="2">
              Look up the current and historical rates at{" "}
              <RadixLink asChild>
                <a
                  href="https://www.irs.gov/tax-professionals/standard-mileage-rates"
                  target="_blank"
                  rel="noreferrer"
                >
                  irs.gov/tax-professionals/standard-mileage-rates
                </a>
              </RadixLink>
              . This product never fills in a figure for you — a stale or guessed rate would
              silently misstate a real deduction.
            </Text>
          </Callout.Text>
        </Callout.Root>

        {/* EmptyState, like every other empty region in the product. No
            action button here on purpose: the add form is already the
            next thing on the screen, and the Callout above it is the one
            that must be read first — this product never fills in a
            mileage rate for you. */}
        {sorted.length === 0 ? (
          <EmptyState title="No rates recorded yet">
            Add the IRS standard mileage rate for each tax year you claim, and every
            mileage entry from that year is priced from it. Nothing is calculated
            until a rate for the year exists.
          </EmptyState>
        ) : (
          <Table.Root variant="ghost">
            <Table.Header>
              <Table.Row>
                <Table.ColumnHeaderCell>Tax year</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell justify="end">Rate</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell>Notes</Table.ColumnHeaderCell>
                {canEdit ? <Table.ColumnHeaderCell /> : null}
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {sorted.map((rate) => (
                <Table.Row key={rate.id}>
                  <Table.RowHeaderCell>
                    <Text weight="medium" className="tnum">
                      {rate.tax_year}
                    </Text>
                  </Table.RowHeaderCell>
                  <Table.Cell justify="end">
                    <Text className="tnum">{formatRate(rate.rate_cents_per_mile)}</Text>
                  </Table.Cell>
                  <Table.Cell>
                    <Text color="gray">{rate.notes ?? "—"}</Text>
                  </Table.Cell>
                  {canEdit ? (
                    <Table.Cell>
                      <Button
                        type="button"
                        variant="ghost"
                        color="red"
                        size="1"
                        disabled={removing}
                        onClick={() =>
                          startRemove(async () => {
                            setRowError(null);
                            const result = await deleteMileageRate(rate.id);
                            if (result.error) setRowError(result.error);
                          })
                        }
                      >
                        {removing ? "Removing…" : "Remove"}
                      </Button>
                    </Table.Cell>
                  ) : null}
                </Table.Row>
              ))}
            </Table.Body>
          </Table.Root>
        )}

        {rowError ? (
          <Text size="1" color="red" role="alert">
            {rowError}
          </Text>
        ) : null}

        {canEdit ? (
          <form action={formAction}>
            <Flex direction="column" gap="3" p="1">
              <Flex gap="3" wrap="wrap" align="end">
                <Flex direction="column" gap="1" style={{ width: "8rem" }}>
                  <Text as="label" size="1" weight="medium" htmlFor="mileage-tax-year">
                    Tax year
                  </Text>
                  <TextField.Root
                    id="mileage-tax-year"
                    name="tax_year"
                    type="number"
                    required
                    placeholder={String(currentYear)}
                    defaultValue={initial("tax_year")}
                  />
                </Flex>
                <Flex direction="column" gap="1" style={{ width: "10rem" }}>
                  <Text as="label" size="1" weight="medium" htmlFor="mileage-rate">
                    Rate (cents/mile)
                  </Text>
                  {/* The placeholder carries NO example figure, deliberately.
                      Any plausible number sitting in this box reads as a
                      suggested rate, and the IRS rate changes every year — a
                      stale one that looks authoritative is the exact failure
                      this pilot-entered field exists to avoid. The unit is
                      stated in the label above instead. */}
                  <TextField.Root
                    id="mileage-rate"
                    name="rate_cents_per_mile"
                    inputMode="decimal"
                    required
                    placeholder="cents per mile"
                    defaultValue={initial("rate_cents_per_mile")}
                  />
                </Flex>
                <Flex direction="column" gap="1" style={{ flex: 1, minWidth: "12rem" }}>
                  <Text as="label" size="1" weight="medium" htmlFor="mileage-notes">
                    Notes
                  </Text>
                  <TextField.Root
                    id="mileage-notes"
                    name="notes"
                    placeholder="Optional"
                    defaultValue={initial("notes")}
                  />
                </Flex>
                <Button type="submit" disabled={pending}>
                  {pending ? "Saving…" : "Save rate"}
                </Button>
              </Flex>

              <div role="alert" aria-live="polite">
                {state.error ? (
                  <Text size="1" color="red">
                    {state.error}
                  </Text>
                ) : state.saved ? (
                  <Text size="1" color="green">
                    Saved.
                  </Text>
                ) : null}
              </div>

              <Text size="1" color="gray">
                Saving a year that already has a rate replaces it. Drives already logged keep the
                rate they were captured with — see the{" "}
                <RadixLink asChild>
                  <NextLink href="/expenses/mileage">mileage log</NextLink>
                </RadixLink>
                .
              </Text>
            </Flex>
          </form>
        ) : (
          <Text size="1" color="gray">
            Only the account owner can change mileage rates.
          </Text>
        )}
      </Flex>
    </Card>
  );
}

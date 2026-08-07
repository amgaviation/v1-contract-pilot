"use client";

import { useActionState } from "react";
import { Box, Button, Flex, Text, TextField } from "@/components/ui";
import { centsToInput, formatCents } from "@/lib/format";
import { setClientRateOverride, type RateOverrideFormState } from "./rate-overrides-actions";

const initialState: RateOverrideFormState = { error: null };

export default function RateOverrideRow({
  clientId,
  dayTypeId,
  label,
  archived = false,
  defaultRateCents,
  overrideRateCents,
}: {
  clientId: string;
  dayTypeId: string;
  label: string;
  /** F10: this day type is archived but kept visible because an override
   * on it still exists — see RateOverridesPanel's filtering note. */
  archived?: boolean;
  defaultRateCents: number | null;
  overrideRateCents: number | null;
}) {
  const [state, formAction, pending] = useActionState(setClientRateOverride, initialState);

  // React 19 resets an uncontrolled form on every action dispatch, error
  // path included — echo the submitted rate back so a rejected save
  // doesn't blank what was typed.
  const rateValue =
    state.values?.rate !== undefined ? state.values.rate : centsToInput(overrideRateCents);

  return (
    <Flex asChild align="start" wrap="wrap" gap="4" py="3">
      <form action={formAction}>
        <input type="hidden" name="client_id" value={clientId} />
        <input type="hidden" name="day_type_id" value={dayTypeId} />

        <Box minWidth="180px" style={{ flex: "1 1 180px" }} pt="1">
          <Text as="div" size="2" weight="medium">
            {label}
          </Text>
          <Text as="div" size="1" color="gray">
            Default: {defaultRateCents === null ? "no rate agreed" : formatCents(defaultRateCents)}
          </Text>
          {archived ? (
            <Text as="div" size="1" color="amber">
              Archived — kept here only because this client still has an
              override on it
            </Text>
          ) : null}
        </Box>

        <Flex direction="column" gap="1">
          <Text as="label" size="2" weight="medium" htmlFor={`rate-${dayTypeId}`}>
            Override (USD)
          </Text>
          <TextField.Root
            id={`rate-${dayTypeId}`}
            name="rate"
            inputMode="decimal"
            size="2"
            defaultValue={rateValue}
          />
          <Text size="1" color="gray">
            Blank uses the default
          </Text>
        </Flex>

        <Box pt="6">
          <Button type="submit" variant="outline" size="2" disabled={pending}>
            {pending ? "Saving…" : "Save"}
          </Button>
        </Box>

        <Box role="alert" aria-live="polite" minWidth="80px" pt="6">
          {state.error ? (
            <Text size="1" color="red">
              {state.error}
            </Text>
          ) : state.saved ? (
            <Text size="1" color="green">
              Saved.
            </Text>
          ) : null}
        </Box>
      </form>
    </Flex>
  );
}

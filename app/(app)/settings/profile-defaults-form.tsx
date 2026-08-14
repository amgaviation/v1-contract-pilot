"use client";

import { useActionState, useId, useState } from "react";
import {
  Box,
  Button,
  Card,
  Flex,
  Grid,
  Heading,
  Select,
  Text,
  TextField,
} from "@/components/ui";
import { CERTIFICATE_OPTIONS, NO_CERTIFICATE } from "@/lib/airman";
import { updateProfileDefaults, type SettingsFormState } from "./actions";

/**
 * All plain strings, built server-side by settings/page.tsx exactly the
 * way onboarding/page.tsx builds OnboardingValues: money already through
 * centsToInput, terms already String()ed. Passing raw cents here and
 * letting a generic initial() String()-coerce them would render a $1,200
 * day rate as "120000" — the field names carry no _cents suffix because
 * they hold dollar TEXT; the action maps them onto the *_cents columns.
 */
export type ProfileDefaultsValues = {
  dba_name: string;
  phone: string;
  home_base: string;
  certificate_type: string;
  certificate_number: string;
  ratings: string;
  default_day_rate: string;
  default_travel_day_rate: string;
  default_per_diem: string;
  default_payment_terms_days: string;
};

const initialState: SettingsFormState = { error: null };

/**
 * The rest of what the onboarding wizard collects — airman profile and the
 * account-level billing defaults — editable after first run, honoring the
 * wizard's "everything here is editable later in Settings" promise.
 * Mirrors settings-form.tsx: echoed submit wins over stored values (React
 * 19 resets uncontrolled forms on every dispatch, error path included),
 * owner-gated with the same non-owner sentence.
 */
export default function ProfileDefaultsForm({
  values,
  canEdit,
}: {
  values: ProfileDefaultsValues;
  canEdit: boolean;
}) {
  const [state, formAction, pending] = useActionState(
    updateProfileDefaults,
    initialState
  );

  const submitted = state.values;
  const initial = (key: keyof ProfileDefaultsValues) => {
    const echoed = submitted?.[key];
    if (echoed !== undefined) return echoed;
    return values[key];
  };

  // The wizard's hidden-input pattern for Radix Select (onboarding-
  // wizard.tsx): Select.Root is not a native form control, so a hidden
  // input synced to React state carries the value, with NO_CERTIFICATE as
  // the UI-only "prefer not to say" that posts as "". React state survives
  // the React-19 form reset on its own, so no echo wiring is needed here —
  // the hidden input always tracks live state.
  const [certType, setCertType] = useState(
    values.certificate_type === "" ? NO_CERTIFICATE : values.certificate_type
  );
  const certTypeId = useId();

  return (
    <Card>
      <form action={formAction}>
        <Flex direction="column" gap="4" p="2">
          <Flex direction="column" gap="1">
            <Heading as="h2" size="4">Profile &amp; billing defaults</Heading>
          </Flex>

          <Grid columns={{ initial: "1", md: "12" }} gap="3">
            <Flex direction="column" gap="1" gridColumn={{ md: "span 6" }}>
              <Text as="label" size="1" weight="medium" htmlFor="dba_name">
                Doing business as
              </Text>
              <TextField.Root
                id="dba_name"
                name="dba_name"
                disabled={!canEdit}
                defaultValue={initial("dba_name")}
              />
              <Text size="1" color="gray" style={{ fontStyle: "italic" }}>
                Only if it differs from your business name
              </Text>
            </Flex>
            <Flex direction="column" gap="1" gridColumn={{ md: "span 3" }}>
              <Text as="label" size="1" weight="medium" htmlFor="phone">
                Phone
              </Text>
              <TextField.Root
                id="phone"
                name="phone"
                type="tel"
                autoComplete="tel"
                disabled={!canEdit}
                defaultValue={initial("phone")}
              />
            </Flex>
            <Flex direction="column" gap="1" gridColumn={{ md: "span 3" }}>
              <Text as="label" size="1" weight="medium" htmlFor="home_base">
                Based airport
              </Text>
              <TextField.Root
                id="home_base"
                name="home_base"
                placeholder="e.g. KTEB"
                disabled={!canEdit}
                defaultValue={initial("home_base")}
              />
            </Flex>

            <Flex direction="column" gap="1" gridColumn={{ md: "span 6" }}>
              <Text as="label" size="1" weight="medium" id={`${certTypeId}-label`}>
                Certificate held
              </Text>
              <input
                type="hidden"
                name="certificate_type"
                value={certType === NO_CERTIFICATE ? "" : certType}
              />
              <Select.Root
                value={certType}
                onValueChange={setCertType}
                disabled={!canEdit}
              >
                <Select.Trigger id={certTypeId} aria-labelledby={`${certTypeId}-label`} />
                <Select.Content>
                  {CERTIFICATE_OPTIONS.map((c) => (
                    <Select.Item key={c.value} value={c.value}>
                      {c.label}
                    </Select.Item>
                  ))}
                </Select.Content>
              </Select.Root>
            </Flex>
            <Flex direction="column" gap="1" gridColumn={{ md: "span 6" }}>
              <Text as="label" size="1" weight="medium" htmlFor="certificate_number">
                Certificate number
              </Text>
              <TextField.Root
                id="certificate_number"
                name="certificate_number"
                disabled={!canEdit}
                defaultValue={initial("certificate_number")}
              />
            </Flex>
            <Flex direction="column" gap="1" gridColumn={{ md: "span 12" }}>
              <Text as="label" size="1" weight="medium" htmlFor="ratings">
                Ratings &amp; type ratings
              </Text>
              <TextField.Root
                id="ratings"
                name="ratings"
                disabled={!canEdit}
                defaultValue={initial("ratings")}
              />
              <Text size="1" color="gray" style={{ fontStyle: "italic" }}>
                As written on your certificate, e.g. AMEL, Instrument
                Airplane, CE-525S
              </Text>
            </Flex>

            <Flex direction="column" gap="1" gridColumn={{ md: "span 3" }}>
              <Text as="label" size="1" weight="medium" htmlFor="default_day_rate">
                Default day rate
              </Text>
              <TextField.Root
                id="default_day_rate"
                name="default_day_rate"
                inputMode="decimal"
                disabled={!canEdit}
                defaultValue={initial("default_day_rate")}
              >
                <TextField.Slot>$</TextField.Slot>
              </TextField.Root>
              <Text size="1" color="gray" style={{ fontStyle: "italic" }}>
                Per duty day flown
              </Text>
            </Flex>
            <Flex direction="column" gap="1" gridColumn={{ md: "span 3" }}>
              <Text as="label" size="1" weight="medium" htmlFor="default_travel_day_rate">
                Travel day rate
              </Text>
              <TextField.Root
                id="default_travel_day_rate"
                name="default_travel_day_rate"
                inputMode="decimal"
                disabled={!canEdit}
                defaultValue={initial("default_travel_day_rate")}
              >
                <TextField.Slot>$</TextField.Slot>
              </TextField.Root>
              <Text size="1" color="gray" style={{ fontStyle: "italic" }}>
                Often half to full day rate — your call
              </Text>
            </Flex>
            <Flex direction="column" gap="1" gridColumn={{ md: "span 3" }}>
              <Text as="label" size="1" weight="medium" htmlFor="default_per_diem">
                Per diem
              </Text>
              <TextField.Root
                id="default_per_diem"
                name="default_per_diem"
                inputMode="decimal"
                disabled={!canEdit}
                defaultValue={initial("default_per_diem")}
              >
                <TextField.Slot>$</TextField.Slot>
              </TextField.Root>
              <Text size="1" color="gray" style={{ fontStyle: "italic" }}>
                Daily, when you bill per diem instead of receipts
              </Text>
            </Flex>
            <Flex direction="column" gap="1" gridColumn={{ md: "span 3" }}>
              <Text as="label" size="1" weight="medium" htmlFor="default_payment_terms_days">
                Payment terms
              </Text>
              <TextField.Root
                id="default_payment_terms_days"
                name="default_payment_terms_days"
                inputMode="numeric"
                disabled={!canEdit}
                defaultValue={initial("default_payment_terms_days")}
              >
                <TextField.Slot side="right">days</TextField.Slot>
              </TextField.Root>
              <Text size="1" color="gray" style={{ fontStyle: "italic" }}>
                Net days on new clients
              </Text>
            </Flex>
          </Grid>

          <Box>
            <Text size="1" color="gray">
              These seed new clients and new trips — records you&rsquo;ve
              already created keep the rates they were saved with.
            </Text>
          </Box>

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

          {canEdit ? (
            <Flex>
              <Button type="submit" disabled={pending}>
                {pending ? "Saving…" : "Save changes"}
              </Button>
            </Flex>
          ) : (
            <Text size="1" color="gray">
              Only the account owner can change these.
            </Text>
          )}
        </Flex>
      </form>
    </Card>
  );
}

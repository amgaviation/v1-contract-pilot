"use client";

import { useActionState, useState } from "react";
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
import { BRAND } from "@/lib/brand";
import { CERTIFICATE_OPTIONS, NO_CERTIFICATE } from "@/lib/airman";
import { completeOnboarding, type OnboardingState } from "./actions";

export type OnboardingValues = {
  legal_name: string;
  dba_name: string;
  phone: string;
  home_base: string;
  address_line1: string;
  address_line2: string;
  city: string;
  state: string;
  postal_code: string;
  country: string;
  certificate_type: string;
  certificate_number: string;
  ratings: string;
  default_day_rate: string;
  default_travel_day_rate: string;
  default_per_diem: string;
  default_payment_terms_days: string;
  invoice_prefix: string;
};

const initialState: OnboardingState = { error: null };

const STEPS = [
  { title: "Your business", hint: "What prints on the invoices your clients receive." },
  { title: "Your certificate", hint: "For your own records — never shared or shown to clients." },
  { title: "Rates & billing", hint: "Defaults that pre-fill each new trip and invoice. Change any of them per client later." },
] as const;

export default function OnboardingWizard({
  values,
  kind,
}: {
  values: OnboardingValues;
  kind: "solo" | "business";
}) {
  const [state, formAction, pending] = useActionState(
    completeOnboarding,
    initialState
  );
  const [step, setStep] = useState(0);

  // Uncontrolled text inputs reset to defaultValue on every dispatch (React
  // 19), so defaultValue must prefer the echoed submit — same pattern as
  // settings-form. React state (step, certificate) is NOT reset by that form
  // reset, so it survives an error re-render on its own.
  const echoed = state.values;
  const initial = (key: keyof OnboardingValues) => {
    const fromSubmit = echoed?.[key];
    if (fromSubmit !== undefined) return fromSubmit;
    return values[key];
  };

  const [certType, setCertType] = useState(
    values.certificate_type === "" ? NO_CERTIFICATE : values.certificate_type
  );

  const isLast = step === STEPS.length - 1;
  const current = STEPS[step] ?? STEPS[0];

  return (
    <Card size="4">
      <form action={formAction}>
        <Flex direction="column" gap="4">
          <Flex direction="column" gap="1">
            <Text size="1" color="gray">
              {BRAND.name} — {BRAND.descriptor} · Step {step + 1} of {STEPS.length}
            </Text>
            <Heading as="h1" size="6">
              {current.title}
            </Heading>
            <Text size="2" color="gray">
              {current.hint}
            </Text>
          </Flex>

          {/* All three panels stay mounted (display toggles only) so a single
              submit carries every field regardless of which step is showing. */}

          {/* Step 1 — Business identity */}
          <Box display={step === 0 ? "block" : "none"}>
            <Grid columns={{ initial: "1", sm: "12" }} gap="3">
              <Field span={8} id="legal_name" label={kind === "business" ? "Business name" : "Your name / business name"} hint="Appears as the payee on every invoice">
                <TextField.Root id="legal_name" name="legal_name" required defaultValue={initial("legal_name")} />
              </Field>
              <Field span={4} id="dba_name" label="Doing business as" hint="Only if it differs from above">
                <TextField.Root id="dba_name" name="dba_name" defaultValue={initial("dba_name")} />
              </Field>
              <Field span={6} id="phone" label="Phone">
                <TextField.Root id="phone" name="phone" type="tel" autoComplete="tel" defaultValue={initial("phone")} />
              </Field>
              <Field span={6} id="home_base" label="Based airport">
                <TextField.Root id="home_base" name="home_base" placeholder="e.g. KTEB" defaultValue={initial("home_base")} />
              </Field>
              <Field span={12} id="address_line1" label="Address">
                <TextField.Root id="address_line1" name="address_line1" autoComplete="address-line1" defaultValue={initial("address_line1")} />
              </Field>
              <Field span={12} id="address_line2" label="Address line 2">
                <TextField.Root id="address_line2" name="address_line2" autoComplete="address-line2" defaultValue={initial("address_line2")} />
              </Field>
              <Field span={5} id="city" label="City">
                <TextField.Root id="city" name="city" autoComplete="address-level2" defaultValue={initial("city")} />
              </Field>
              <Field span={3} id="state" label="State">
                <TextField.Root id="state" name="state" autoComplete="address-level1" defaultValue={initial("state")} />
              </Field>
              <Field span={4} id="postal_code" label="Postal code">
                <TextField.Root id="postal_code" name="postal_code" autoComplete="postal-code" defaultValue={initial("postal_code")} />
              </Field>
              <Field span={12} id="country" label="Country">
                <TextField.Root id="country" name="country" autoComplete="country-name" defaultValue={initial("country")} />
              </Field>
            </Grid>
          </Box>

          {/* Step 2 — Airman profile */}
          <Box display={step === 1 ? "block" : "none"}>
            <Grid columns={{ initial: "1", sm: "12" }} gap="3">
              <Box gridColumn={{ sm: "span 6" }}>
                <Text as="label" size="1" weight="medium">Certificate held</Text>
                {/* Radix Select isn't a native control; a hidden input carries
                    its value into the form. NO_CERTIFICATE → "" (prefer not to
                    say). Options come from lib/airman.ts — the one 14 CFR
                    61.5(a)(1) list, shared with the action's membership check
                    and the Settings panel. */}
                <input
                  type="hidden"
                  name="certificate_type"
                  value={certType === NO_CERTIFICATE ? "" : certType}
                />
                <Select.Root value={certType} onValueChange={setCertType}>
                  <Box mt="1">
                    <Select.Trigger style={{ width: "100%" }} />
                  </Box>
                  <Select.Content>
                    {CERTIFICATE_OPTIONS.map((c) => (
                      <Select.Item key={c.value} value={c.value}>
                        {c.label}
                      </Select.Item>
                    ))}
                  </Select.Content>
                </Select.Root>
              </Box>
              <Field span={6} id="certificate_number" label="Certificate number">
                <TextField.Root id="certificate_number" name="certificate_number" defaultValue={initial("certificate_number")} />
              </Field>
              <Field span={12} id="ratings" label="Ratings & type ratings" hint="As written on your certificate, e.g. AMEL, Instrument Airplane, CE-525S">
                <TextField.Root id="ratings" name="ratings" defaultValue={initial("ratings")} />
              </Field>
            </Grid>
          </Box>

          {/* Step 3 — Rates & billing defaults */}
          <Box display={step === 2 ? "block" : "none"}>
            <Grid columns={{ initial: "1", sm: "12" }} gap="3">
              <Field span={6} id="default_day_rate" label="Default day rate" hint="Per duty day flown">
                <TextField.Root id="default_day_rate" name="default_day_rate" inputMode="decimal" placeholder="1,200" defaultValue={initial("default_day_rate")}>
                  <TextField.Slot>$</TextField.Slot>
                </TextField.Root>
              </Field>
              <Field span={6} id="default_travel_day_rate" label="Travel day rate" hint="Often half to full day rate — your call">
                <TextField.Root id="default_travel_day_rate" name="default_travel_day_rate" inputMode="decimal" placeholder="600" defaultValue={initial("default_travel_day_rate")}>
                  <TextField.Slot>$</TextField.Slot>
                </TextField.Root>
              </Field>
              <Field span={6} id="default_per_diem" label="Per diem" hint="Daily, when you bill per diem instead of receipts">
                <TextField.Root id="default_per_diem" name="default_per_diem" inputMode="decimal" placeholder="75" defaultValue={initial("default_per_diem")}>
                  <TextField.Slot>$</TextField.Slot>
                </TextField.Root>
              </Field>
              <Field span={3} id="default_payment_terms_days" label="Payment terms" hint="Net days">
                <TextField.Root id="default_payment_terms_days" name="default_payment_terms_days" inputMode="numeric" placeholder="30" defaultValue={initial("default_payment_terms_days")}>
                  <TextField.Slot side="right">days</TextField.Slot>
                </TextField.Root>
              </Field>
              <Field span={3} id="invoice_prefix" label="Invoice prefix">
                <TextField.Root id="invoice_prefix" name="invoice_prefix" placeholder="INV" defaultValue={initial("invoice_prefix")} />
              </Field>
            </Grid>
          </Box>

          <div role="alert" aria-live="polite">
            {state.error ? (
              <Text size="1" color="red">
                {state.error}
              </Text>
            ) : null}
          </div>

          <Flex justify="between" align="center" gap="3" wrap="wrap">
            <Button
              type="button"
              variant="soft"
              color="gray"
              disabled={step === 0 || pending}
              onClick={() => setStep((s) => Math.max(0, s - 1))}
            >
              Back
            </Button>

            <Flex gap="3" align="center">
              {/* Skip is a real submit (intent=skip): it marks onboarding done
                  and drops the pilot into the app without collecting anything.
                  Everything here is editable later in Settings. */}
              <Button
                type="submit"
                name="intent"
                value="skip"
                variant="ghost"
                color="gray"
                disabled={pending}
              >
                Skip for now
              </Button>

              {isLast ? (
                <Button type="submit" name="intent" value="finish" disabled={pending}>
                  {pending ? "Finishing…" : "Finish setup"}
                </Button>
              ) : (
                <Button
                  type="button"
                  disabled={pending}
                  onClick={() => setStep((s) => Math.min(STEPS.length - 1, s + 1))}
                >
                  Next
                </Button>
              )}
            </Flex>
          </Flex>
        </Flex>
      </form>
    </Card>
  );
}

/** A labelled grid cell — collapses the repeated column/label/hint markup. */
function Field({
  span,
  id,
  label,
  hint,
  children,
}: {
  span: number;
  id: string;
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <Flex direction="column" gap="1" gridColumn={{ sm: `span ${span}` }}>
      <Text as="label" size="1" weight="medium" htmlFor={id}>
        {label}
      </Text>
      <Box mt="1">{children}</Box>
      {hint ? (
        <Text size="1" color="gray" style={{ fontStyle: "italic" }}>
          {hint}
        </Text>
      ) : null}
    </Flex>
  );
}

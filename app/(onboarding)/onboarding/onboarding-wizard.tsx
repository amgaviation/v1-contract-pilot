"use client";

import { useActionState, useState } from "react";
import { CheckIcon, ExclamationTriangleIcon } from "@radix-ui/react-icons";
import {
  Box,
  Button,
  Callout,
  Card,
  Flex,
  Grid,
  Heading,
  Select,
  Separator,
  Text,
  TextField,
} from "@/components/ui";
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

/**
 * `short` is the stepper's label; `title`/`hint` head the panel. The
 * stepper needs two words, the panel needs a sentence, and cramming both
 * jobs into one string is what made the old header read as a breadcrumb.
 */
const STEPS = [
  {
    short: "Business",
    title: "Your business",
    hint: "What prints on the invoices your clients receive.",
  },
  {
    short: "Certificate",
    title: "Your certificate",
    hint: "For your own records — never shared or shown to clients.",
  },
  {
    short: "Rates",
    title: "Rates & billing",
    hint: "Defaults that pre-fill each new trip and invoice. Change any of them per client later.",
  },
] as const;

/**
 * THE 2026-08 PASS OVER THIS FILE WAS VISUAL AND STRUCTURAL ONLY. It
 * collects exactly the same fields, under exactly the same names, and the
 * server action (./actions.ts) and its validation are untouched. What
 * changed: a real stepper replaced the "Step 2 of 3" caption, the taller
 * steps are grouped under sub-headings instead of running as one
 * eighteen-cell grid, and every control now has an explicit disabled state
 * while the action is in flight.
 *
 * The two mechanics that must survive any future pass are both here:
 *
 *   ALL THREE PANELS STAY MOUNTED (display toggles only), so one submit
 *   carries every field regardless of which step is showing. Unmounting
 *   the hidden steps would silently post empty strings over them.
 *
 *   defaultValue PREFERS THE ECHOED SUBMIT. React 19 resets an
 *   uncontrolled form on every action dispatch, including the error path,
 *   so a rejected submit would blank eighteen fields if `initial()` read
 *   from props alone. React state (step, certificate) is not touched by
 *   that reset and survives on its own.
 */
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
    <Flex direction="column" gap="4">
      <Stepper current={step} onSelect={setStep} disabled={pending} />

      <Card size="4">
        <form action={formAction}>
          <Flex direction="column" gap="5">
            <Flex direction="column" gap="1">
              <Heading as="h1" size="6" trim="start">
                {current.title}
              </Heading>
              <Text size="2" color="gray">
                {current.hint}
              </Text>
            </Flex>

            {/* All three panels stay mounted (display toggles only) so a
                single submit carries every field regardless of which step
                is showing. */}

            {/* Step 1 — Business identity */}
            <Box display={step === 0 ? "block" : "none"}>
              <Flex direction="column" gap="5">
                <Grid columns={{ initial: "1", sm: "12" }} gap="3">
                  <Field
                    span={8}
                    id="legal_name"
                    label={kind === "business" ? "Business name" : "Your name / business name"}
                    hint="Appears as the payee on every invoice"
                  >
                    <TextField.Root id="legal_name" name="legal_name" required disabled={pending} defaultValue={initial("legal_name")} />
                  </Field>
                  <Field span={4} id="dba_name" label="Doing business as" hint="Only if it differs from above">
                    <TextField.Root id="dba_name" name="dba_name" disabled={pending} defaultValue={initial("dba_name")} />
                  </Field>
                  <Field span={6} id="phone" label="Phone">
                    <TextField.Root id="phone" name="phone" type="tel" autoComplete="tel" disabled={pending} defaultValue={initial("phone")} />
                  </Field>
                  <Field span={6} id="home_base" label="Based airport">
                    <TextField.Root id="home_base" name="home_base" placeholder="KTEB" disabled={pending} defaultValue={initial("home_base")} />
                  </Field>
                </Grid>

                <GroupHeading>Address</GroupHeading>

                <Grid columns={{ initial: "1", sm: "12" }} gap="3">
                  <Field span={12} id="address_line1" label="Address">
                    <TextField.Root id="address_line1" name="address_line1" autoComplete="address-line1" disabled={pending} defaultValue={initial("address_line1")} />
                  </Field>
                  <Field span={12} id="address_line2" label="Address line 2">
                    <TextField.Root id="address_line2" name="address_line2" autoComplete="address-line2" disabled={pending} defaultValue={initial("address_line2")} />
                  </Field>
                  <Field span={5} id="city" label="City">
                    <TextField.Root id="city" name="city" autoComplete="address-level2" disabled={pending} defaultValue={initial("city")} />
                  </Field>
                  <Field span={3} id="state" label="State">
                    <TextField.Root id="state" name="state" autoComplete="address-level1" disabled={pending} defaultValue={initial("state")} />
                  </Field>
                  <Field span={4} id="postal_code" label="Postal code">
                    <TextField.Root id="postal_code" name="postal_code" autoComplete="postal-code" disabled={pending} defaultValue={initial("postal_code")} />
                  </Field>
                  <Field span={12} id="country" label="Country">
                    <TextField.Root id="country" name="country" autoComplete="country-name" disabled={pending} defaultValue={initial("country")} />
                  </Field>
                </Grid>
              </Flex>
            </Box>

            {/* Step 2 — Airman profile */}
            <Box display={step === 1 ? "block" : "none"}>
              <Grid columns={{ initial: "1", sm: "12" }} gap="3">
                <Flex direction="column" gap="1" gridColumn={{ sm: "span 6" }}>
                  {/* NOT a <label>: Select.Trigger is a button, not a native
                      control, so a <label> with no htmlFor and nothing wrapped
                      names nothing in the accessibility tree. aria-labelledby
                      on the trigger is the only wiring that reaches it —
                      Field() below does the native equivalent with htmlFor.
                      Same defect, same fix as /signup's account-type control. */}
                  <Text as="div" id="certificate-type-label" size="2" weight="medium">
                    Certificate held
                  </Text>
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
                  <Select.Root value={certType} onValueChange={setCertType} disabled={pending}>
                    <Select.Trigger
                      aria-labelledby="certificate-type-label"
                      style={{ width: "100%" }}
                    />
                    <Select.Content>
                      {CERTIFICATE_OPTIONS.map((c) => (
                        <Select.Item key={c.value} value={c.value}>
                          {c.label}
                        </Select.Item>
                      ))}
                    </Select.Content>
                  </Select.Root>
                </Flex>
                <Field span={6} id="certificate_number" label="Certificate number">
                  <TextField.Root id="certificate_number" name="certificate_number" disabled={pending} defaultValue={initial("certificate_number")} />
                </Field>
                <Field
                  span={12}
                  id="ratings"
                  label="Ratings & type ratings"
                  hint="As written on your certificate, e.g. AMEL, Instrument Airplane, CE-525S"
                >
                  <TextField.Root id="ratings" name="ratings" disabled={pending} defaultValue={initial("ratings")} />
                </Field>
              </Grid>
            </Box>

            {/* Step 3 — Rates & billing defaults */}
            <Box display={step === 2 ? "block" : "none"}>
              <Flex direction="column" gap="5">
                <Grid columns={{ initial: "1", sm: "12" }} gap="3">
                  <Field span={6} id="default_day_rate" label="Default day rate" hint="Per duty day flown">
                    <TextField.Root id="default_day_rate" name="default_day_rate" inputMode="decimal" placeholder="1,200" disabled={pending} defaultValue={initial("default_day_rate")}>
                      <TextField.Slot>$</TextField.Slot>
                    </TextField.Root>
                  </Field>
                  <Field span={6} id="default_travel_day_rate" label="Travel day rate" hint="Often half to full day rate — your call">
                    <TextField.Root id="default_travel_day_rate" name="default_travel_day_rate" inputMode="decimal" placeholder="600" disabled={pending} defaultValue={initial("default_travel_day_rate")}>
                      <TextField.Slot>$</TextField.Slot>
                    </TextField.Root>
                  </Field>
                  <Field span={6} id="default_per_diem" label="Per diem" hint="Daily, when you bill per diem instead of receipts">
                    <TextField.Root id="default_per_diem" name="default_per_diem" inputMode="decimal" placeholder="75" disabled={pending} defaultValue={initial("default_per_diem")}>
                      <TextField.Slot>$</TextField.Slot>
                    </TextField.Root>
                  </Field>
                </Grid>

                <GroupHeading>Invoicing</GroupHeading>

                <Grid columns={{ initial: "1", sm: "12" }} gap="3">
                  <Field span={4} id="default_payment_terms_days" label="Payment terms" hint="Net days">
                    <TextField.Root id="default_payment_terms_days" name="default_payment_terms_days" inputMode="numeric" placeholder="30" disabled={pending} defaultValue={initial("default_payment_terms_days")}>
                      <TextField.Slot side="right">days</TextField.Slot>
                    </TextField.Root>
                  </Field>
                  <Field span={4} id="invoice_prefix" label="Invoice prefix" hint="Leads every invoice number">
                    <TextField.Root id="invoice_prefix" name="invoice_prefix" placeholder="INV" disabled={pending} defaultValue={initial("invoice_prefix")} />
                  </Field>
                </Grid>

                <Text size="2" color="gray">
                  That&rsquo;s everything. All of it is editable later in
                  Settings.
                </Text>
              </Flex>
            </Box>

            {/* The live region is always present, so its first message is
                announced; only the contents change. */}
            <div role="alert" aria-live="polite">
              {state.error ? (
                <Callout.Root color="red" size="1">
                  <Callout.Icon>
                    <ExclamationTriangleIcon />
                  </Callout.Icon>
                  <Callout.Text>{state.error}</Callout.Text>
                </Callout.Root>
              ) : null}
            </div>

            <Separator size="4" />

            <Flex justify="between" align="center" gap="3" wrap="wrap">
              <Button
                type="button"
                variant="soft"
                color="gray"
                size="3"
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
                  size="3"
                  disabled={pending}
                >
                  Skip for now
                </Button>

                {isLast ? (
                  <Button
                    type="submit"
                    name="intent"
                    value="finish"
                    size="3"
                    disabled={pending}
                    loading={pending}
                  >
                    {pending ? "Finishing…" : "Finish setup"}
                  </Button>
                ) : (
                  <Button
                    type="button"
                    size="3"
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
    </Flex>
  );
}

/**
 * The stepper. It shows all three steps, which one is current, and which
 * are already behind — the thing "Step 2 of 3" as a caption never did.
 *
 * The steps are navigable in both directions, and that costs nothing:
 * every panel is mounted the whole time and there is exactly one submit at
 * the end, so jumping between them cannot lose a field or skip a
 * validation. It is a view switch, not a wizard state machine.
 */
function Stepper({
  current,
  onSelect,
  disabled,
}: {
  current: number;
  onSelect: (index: number) => void;
  disabled: boolean;
}) {
  return (
    <Flex asChild align="center" gap="2" width="100%">
      <ol style={{ listStyle: "none", margin: 0, padding: 0 }}>
        {STEPS.map((s, index) => {
          const done = index < current;
          const active = index === current;
          return (
            <Flex
              asChild
              key={s.short}
              align="center"
              gap="2"
              flexGrow={index === STEPS.length - 1 ? "0" : "1"}
            >
              <li>
                {/* NO color="gray" ON THE BUTTON. Radix's BaseButton stamps
                    data-accent-color on the rendered <button>, and
                    [data-accent-color='gray'] remaps the whole --accent-*
                    ramp to the gray scale for everything inside it — so the
                    step circle's var(--accent-9) resolved to gray-9 while the
                    connector Box beside it (a sibling, outside the button)
                    resolved to the theme's indigo-9. The current step read as
                    one more inactive chip joined to an accent-coloured line.
                    The gray now sits on the LABEL, where it was actually
                    wanted, and the circle keeps the theme accent.

                    minHeight/boxSizing: the ghost variant is content-box with
                    height:fit-content, so a size-2 ghost button is the 24px
                    indicator plus 2 × --space-1 (3.6px at 90% scaling) — a
                    ~31px target, well under the 44px minimum, and it is the
                    only way to jump back more than one step. */}
                <Button
                  type="button"
                  variant="ghost"
                  size="2"
                  disabled={disabled}
                  onClick={() => onSelect(index)}
                  aria-current={active ? "step" : undefined}
                  style={{ minHeight: "44px", boxSizing: "border-box" }}
                >
                  <Flex
                    align="center"
                    justify="center"
                    width="1.5rem"
                    height="1.5rem"
                    flexShrink="0"
                    style={{
                      borderRadius: "var(--radius-full)",
                      background:
                        done || active ? "var(--signal)" : "var(--sunk)",
                      color:
                        done || active
                          ? "var(--signal-ink)"
                          : "var(--ink-2)",
                    }}
                  >
                    {done ? (
                      <CheckIcon aria-hidden />
                    ) : (
                      <Text size="1" weight="bold">
                        {index + 1}
                      </Text>
                    )}
                  </Flex>
                  {/* color only while interactive: with none, the label
                      inherits the button's own colour, which Radix's ghost
                      [data-disabled] rule sets to --gray-a8 — the dim that
                      used to come free when color="gray" sat on the Button. */}
                  <Text
                    size="2"
                    color={disabled ? undefined : "gray"}
                    weight={active ? "medium" : "regular"}
                  >
                    {s.short}
                  </Text>
                </Button>

                {index < STEPS.length - 1 ? (
                  <Box
                    flexGrow="1"
                    aria-hidden
                    style={{
                      height: "1px",
                      background: done ? "var(--signal)" : "var(--hair)",
                    }}
                  />
                ) : null}
              </li>
            </Flex>
          );
        })}
      </ol>
    </Flex>
  );
}

/** A rule with a label on it — what separates one group of fields from the
 *  next inside a step that is too tall to read as a single list. */
function GroupHeading({ children }: { children: React.ReactNode }) {
  return (
    <Flex align="center" gap="3">
      <Text size="1" weight="medium" color="gray">
        {String(children).toUpperCase()}
      </Text>
      <Box flexGrow="1">
        <Separator size="4" />
      </Box>
    </Flex>
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
      <Text as="label" size="2" weight="medium" htmlFor={id}>
        {label}
      </Text>
      {children}
      {hint ? (
        <Text size="1" color="gray">
          {hint}
        </Text>
      ) : null}
    </Flex>
  );
}

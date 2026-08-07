"use client";

import { useActionState, useEffect, useId, useState } from "react";
import NextLink from "next/link";
import {
  Button,
  Callout,
  Card,
  Flex,
  Grid,
  Heading,
  Select,
  Text,
  TextArea,
  TextField,
} from "@/components/ui";
import { centsToInput } from "@/lib/format";
import type { ClientFormState } from "./actions";

export type ClientFormValues = {
  id?: string;
  name?: string | null;
  contact_name?: string | null;
  contact_email?: string | null;
  contact_phone?: string | null;
  address_line1?: string | null;
  address_line2?: string | null;
  city?: string | null;
  state?: string | null;
  postal_code?: string | null;
  country?: string | null;
  default_day_rate_cents?: number | null;
  default_per_diem_cents?: number | null;
  default_travel_day_rate_cents?: number | null;
  payment_terms_days?: number | null;
  default_expense_treatment?: string | null;
  per_diem_mode?: string | null;
  minimum_days?: number | null;
  cancellation_policy_note?: string | null;
  w9_status?: string | null;
  notes?: string | null;
};

const TREATMENTS = [
  { value: "unassigned", label: "Decide per expense" },
  { value: "rebill", label: "Rebill to the client" },
  { value: "deduct", label: "Keep as a deduction" },
];

const PER_DIEM_MODES = [
  { value: "receipts", label: "Itemised meal receipts" },
  { value: "per_diem", label: "Per diem" },
];

const W9_STATUSES = [
  { value: "not_requested", label: "Not requested" },
  { value: "requested", label: "Requested" },
  { value: "on_file", label: "On file" },
];

const initialState: ClientFormState = { error: null };

export default function ClientForm({
  action,
  values = {},
  submitLabel,
}: {
  action: (
    state: ClientFormState,
    formData: FormData
  ) => Promise<ClientFormState>;
  values?: ClientFormValues;
  submitLabel: string;
}) {
  const [state, formAction, pending] = useActionState(action, initialState);

  // Echoed submission wins over the stored row, so a rejected submit
  // shows what the pilot typed rather than blanking every field — React
  // 19 resets an uncontrolled form on every action dispatch, error path
  // included.
  const submitted = state.values;
  const initial = (key: string, stored: unknown, fallback = "") => {
    const echoed = submitted?.[key];
    if (echoed !== undefined) return echoed;
    return stored === null || stored === undefined ? fallback : String(stored);
  };

  // Radix's Select.Root always renders its posting <select> with
  // `defaultValue`, never `value` (@radix-ui/react-select's
  // SelectBubbleInput) — so it is uncontrolled from React's point of view
  // no matter what Select.Root is given, and keeping `name` on it means
  // THAT stale, mount-time-pinned <select> is what the browser posts.
  // React 19's post-action form.reset() restores it to its mount-time
  // option even on a rejected submit. Fix: drop `name` from every
  // Select.Root below and post from our own controlled hidden input
  // instead, which React re-asserts after a reset. The generation-keyed
  // `key` on each Select.Root additionally forces a remount on every
  // dispatch, so a stray reset-driven onValueChange never has a stale
  // instance left to fire against.
  const [genTick, setGenTick] = useState(0);
  useEffect(() => {
    setGenTick((g) => g + 1);
  }, [state]);
  const [expenseTreatment, setExpenseTreatment] = useState(() =>
    initial("default_expense_treatment", values.default_expense_treatment, "unassigned")
  );
  const [w9Status, setW9Status] = useState(() =>
    initial("w9_status", values.w9_status, "not_requested")
  );
  const [perDiemMode, setPerDiemMode] = useState(() =>
    initial("per_diem_mode", values.per_diem_mode, "receipts")
  );
  useEffect(() => {
    if (submitted?.default_expense_treatment !== undefined) {
      setExpenseTreatment(String(submitted.default_expense_treatment || "unassigned"));
    }
    if (submitted?.w9_status !== undefined) {
      setW9Status(String(submitted.w9_status || "not_requested"));
    }
    if (submitted?.per_diem_mode !== undefined) {
      setPerDiemMode(String(submitted.per_diem_mode || "receipts"));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [submitted]);
  const expenseTreatmentId = useId();
  const w9StatusId = useId();
  const perDiemModeId = useId();

  return (
    <Card size="3">
      <form action={formAction}>
        {values.id ? <input type="hidden" name="id" value={values.id} /> : null}

        <Heading as="h2" size="4" mb="3">
          Who they are
        </Heading>
        <Grid columns={{ initial: "1", md: "2" }} gap="3">
          <Flex direction="column" gap="1">
            <Text as="label" size="2" weight="medium" htmlFor="name">
              Client name
            </Text>
            <TextField.Root
              id="name"
              name="name"
              required
              defaultValue={initial("name", values.name)}
            />
            <Text size="1" color="gray">
              The name that prints on their invoices
            </Text>
          </Flex>
          <Flex direction="column" gap="1">
            <Text as="label" size="2" weight="medium" htmlFor="contact_name">
              Contact
            </Text>
            <TextField.Root
              id="contact_name"
              name="contact_name"
              defaultValue={initial("contact_name", values.contact_name)}
            />
          </Flex>
          <Flex direction="column" gap="1">
            <Text as="label" size="2" weight="medium" htmlFor="contact_email">
              Contact email
            </Text>
            <TextField.Root
              id="contact_email"
              type="email"
              name="contact_email"
              defaultValue={initial("contact_email", values.contact_email)}
            />
            <Text size="1" color="gray">
              Where a platform-sent invoice goes
            </Text>
          </Flex>
          <Flex direction="column" gap="1">
            <Text as="label" size="2" weight="medium" htmlFor="contact_phone">
              Contact phone
            </Text>
            <TextField.Root
              id="contact_phone"
              name="contact_phone"
              defaultValue={initial("contact_phone", values.contact_phone)}
            />
          </Flex>
        </Grid>

        <Heading as="h2" size="4" mt="5" mb="3">
          Billing address
        </Heading>
        <Grid columns={{ initial: "1", md: "6" }} gap="3">
          <Flex direction="column" gap="1" gridColumn={{ md: "span 3" }}>
            <Text as="label" size="2" weight="medium" htmlFor="address_line1">
              Address
            </Text>
            <TextField.Root
              id="address_line1"
              name="address_line1"
              defaultValue={initial("address_line1", values.address_line1)}
            />
          </Flex>
          <Flex direction="column" gap="1" gridColumn={{ md: "span 3" }}>
            <Text as="label" size="2" weight="medium" htmlFor="address_line2">
              Address line 2
            </Text>
            <TextField.Root
              id="address_line2"
              name="address_line2"
              defaultValue={initial("address_line2", values.address_line2)}
            />
          </Flex>
          <Flex direction="column" gap="1" gridColumn={{ md: "span 2" }}>
            <Text as="label" size="2" weight="medium" htmlFor="city">
              City
            </Text>
            <TextField.Root
              id="city"
              name="city"
              defaultValue={initial("city", values.city)}
            />
          </Flex>
          <Flex direction="column" gap="1" gridColumn={{ md: "span 1" }}>
            <Text as="label" size="2" weight="medium" htmlFor="state">
              State
            </Text>
            <TextField.Root
              id="state"
              name="state"
              defaultValue={initial("state", values.state)}
            />
          </Flex>
          <Flex direction="column" gap="1" gridColumn={{ md: "span 2" }}>
            <Text as="label" size="2" weight="medium" htmlFor="postal_code">
              Postal code
            </Text>
            <TextField.Root
              id="postal_code"
              name="postal_code"
              defaultValue={initial("postal_code", values.postal_code)}
            />
          </Flex>
          <Flex direction="column" gap="1" gridColumn={{ md: "span 1" }}>
            <Text as="label" size="2" weight="medium" htmlFor="country">
              Country
            </Text>
            <TextField.Root
              id="country"
              name="country"
              defaultValue={initial("country", values.country)}
            />
          </Flex>
        </Grid>

        <Flex direction="column" gap="1" mt="5" mb="3">
          <Heading as="h2" size="4">Rate agreement</Heading>
          <Text size="2" color="gray">
            Defaults only — every trip can override them.
          </Text>
        </Flex>
        <Grid columns={{ initial: "1", md: "3" }} gap="3">
          <Flex direction="column" gap="1">
            <Text as="label" size="2" weight="medium" htmlFor="default_day_rate">
              Day rate (USD)
            </Text>
            <TextField.Root
              id="default_day_rate"
              name="default_day_rate"
              inputMode="decimal"
              defaultValue={initial(
                "default_day_rate",
                centsToInput(values.default_day_rate_cents)
              )}
            />
          </Flex>
          <Flex direction="column" gap="1">
            <Text as="label" size="2" weight="medium" htmlFor="default_per_diem">
              Per diem (USD)
            </Text>
            <TextField.Root
              id="default_per_diem"
              name="default_per_diem"
              inputMode="decimal"
              defaultValue={initial(
                "default_per_diem",
                centsToInput(values.default_per_diem_cents)
              )}
            />
          </Flex>
          <Flex direction="column" gap="1">
            <Text as="label" size="2" weight="medium" htmlFor="default_travel_day_rate">
              Travel day rate (USD)
            </Text>
            <TextField.Root
              id="default_travel_day_rate"
              name="default_travel_day_rate"
              inputMode="decimal"
              defaultValue={initial(
                "default_travel_day_rate",
                centsToInput(values.default_travel_day_rate_cents)
              )}
            />
            <Text size="1" color="gray">
              Days getting to or from the aircraft
            </Text>
          </Flex>
          <Flex direction="column" gap="1">
            <Text as="label" size="2" weight="medium" htmlFor="payment_terms_days">
              Payment terms (days)
            </Text>
            <TextField.Root
              id="payment_terms_days"
              type="number"
              name="payment_terms_days"
              defaultValue={initial("payment_terms_days", values.payment_terms_days, "30")}
            />
            <Text size="1" color="gray">
              Net 30 unless you agreed otherwise
            </Text>
          </Flex>
          <Flex direction="column" gap="1" gridColumn={{ md: "span 2" }}>
            <Text as="label" size="2" weight="medium" id={`${expenseTreatmentId}-label`}>
              Expenses on this client&rsquo;s trips
            </Text>
            <Select.Root
              key={`expense-treatment-${genTick}`}
              value={expenseTreatment}
              onValueChange={setExpenseTreatment}
            >
              <Select.Trigger
                id={expenseTreatmentId}
                aria-labelledby={`${expenseTreatmentId}-label`}
              />
              <Select.Content>
                {TREATMENTS.map((option) => (
                  <Select.Item key={option.value} value={option.value}>
                    {option.label}
                  </Select.Item>
                ))}
              </Select.Content>
            </Select.Root>
            <input type="hidden" name="default_expense_treatment" value={expenseTreatment} />
          </Flex>
          <Flex direction="column" gap="1" gridColumn={{ md: "span 3" }}>
            <Text as="label" size="2" weight="medium" id={`${w9StatusId}-label`}>
              W-9
            </Text>
            <Select.Root key={`w9-status-${genTick}`} value={w9Status} onValueChange={setW9Status}>
              <Select.Trigger id={w9StatusId} aria-labelledby={`${w9StatusId}-label`} />
              <Select.Content>
                {W9_STATUSES.map((option) => (
                  <Select.Item key={option.value} value={option.value}>
                    {option.label}
                  </Select.Item>
                ))}
              </Select.Content>
            </Select.Root>
            <input type="hidden" name="w9_status" value={w9Status} />
          </Flex>
          <Flex direction="column" gap="1" gridColumn={{ md: "span 3" }}>
            <Text as="label" size="2" weight="medium" htmlFor="notes">
              Notes
            </Text>
            <TextArea id="notes" name="notes" rows={3} defaultValue={initial("notes", values.notes)} />
          </Flex>
        </Grid>

        <Flex direction="column" gap="1" mt="5" mb="3">
          <Heading as="h2" size="4">Contract terms</Heading>
          <Text size="2" color="gray">
            What this client&rsquo;s agreement says beyond the rates above.
          </Text>
        </Flex>
        <Grid columns={{ initial: "1", md: "2" }} gap="3">
          <Flex direction="column" gap="1">
            <Text as="label" size="2" weight="medium" id={`${perDiemModeId}-label`}>
              Meals
            </Text>
            <Select.Root
              key={`per-diem-mode-${genTick}`}
              value={perDiemMode}
              onValueChange={setPerDiemMode}
            >
              <Select.Trigger id={perDiemModeId} aria-labelledby={`${perDiemModeId}-label`} />
              <Select.Content>
                {PER_DIEM_MODES.map((option) => (
                  <Select.Item key={option.value} value={option.value}>
                    {option.label}
                  </Select.Item>
                ))}
              </Select.Content>
            </Select.Root>
            <input type="hidden" name="per_diem_mode" value={perDiemMode} />
            {/* F3: the old copy read as unconditional. Per diem only
                reaches the invoice draft for a trip whose day grid has
                been filled in and saved — createInvoiceDraft has no
                per-diem count to draw on otherwise, so a trip without one
                still falls back to expecting meal receipts regardless of
                this setting. */}
            <Text size="1" color="gray">
              Adds a per-diem line on trips whose day grid has been filled
              in. A trip without one still expects meal receipts.
            </Text>
          </Flex>
          <Flex direction="column" gap="1">
            {/* F4: "Contract minimum" reads, to most pilots, as the OTHER
                minimum this industry uses — a full day rate regardless of
                hours flown — which this product already honors for free
                by billing in whole days. What this field actually sets is
                the other one: a floor on the total days a short TRIP
                bills. "Trip minimum" is the unambiguous name for that. */}
            <Text as="label" size="2" weight="medium" htmlFor="minimum_days">
              Trip minimum (days)
            </Text>
            <TextField.Root
              id="minimum_days"
              name="minimum_days"
              inputMode="decimal"
              defaultValue={initial("minimum_days", values.minimum_days)}
            />
            {/* F3 + F4: names the behavior in the same terms a pilot
                reads their own invoice in, and states the gate — this
                only bites once the trip's day grid has been filled in
                and saved; a trip without one isn't held to it. */}
            <Text size="1" color="gray">
              A 1-day trip for a client with a 2-day minimum bills 2 days —
              once the trip&rsquo;s day grid has been filled in.
            </Text>
          </Flex>
          <Flex direction="column" gap="1" gridColumn={{ md: "span 2" }}>
            <Text as="label" size="2" weight="medium" htmlFor="cancellation_policy_note">
              Cancellation terms
            </Text>
            <TextArea
              id="cancellation_policy_note"
              name="cancellation_policy_note"
              rows={2}
              defaultValue={initial("cancellation_policy_note", values.cancellation_policy_note)}
            />
            <Text size="1" color="gray">
              Recorded for reference only — not applied automatically. Add
              the fee line yourself if the client owes one.
            </Text>
          </Flex>
        </Grid>

        {/* role="alert" so a screen reader hears the rejection; without it
            the form silently resets and nothing is announced. */}
        <Flex mt="4" role="alert" aria-live="polite">
          {state.error ? (
            <Callout.Root color="red" size="1">
              <Callout.Text>{state.error}</Callout.Text>
            </Callout.Root>
          ) : null}
        </Flex>

        <Flex mt="5" gap="3">
          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : submitLabel}
          </Button>
          <Button asChild variant="outline">
            <NextLink href="/clients">Cancel</NextLink>
          </Button>
        </Flex>
      </form>
    </Card>
  );
}

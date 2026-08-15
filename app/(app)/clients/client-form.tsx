"use client";

import { useActionState, useEffect, useId, useState } from "react";
import NextLink from "next/link";
import {
  Button,
  Callout,
  Card,
  Checkbox,
  Flex,
  Grid,
  Heading,
  Select,
  Separator,
  Text,
  TextArea,
  TextField,
} from "@/components/ui";
import { centsToInput } from "@/lib/format";
import { COUNTERPARTY_COPY } from "@/lib/counterparty";
import { CLIENT_OPERATING_RULES } from "@/lib/operating-rule";
import {
  REMINDER_AFTER_DAYS,
  REMINDER_BEFORE_DAYS,
} from "@/lib/reminders/policy";
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
  minimum_basis?: string | null;
  cancellation_policy_note?: string | null;
  w9_status?: string | null;
  notes?: string | null;
  operating_rule?: string | null;
  // 20260813130000 — the chase schedule and the agreed late fee. Every one
  // of them is off/empty for a client that has never been given one, which
  // is every client until a pilot decides otherwise.
  reminder_before_due?: number[] | null;
  reminder_on_due?: boolean | null;
  reminder_after_due?: number[] | null;
  late_fee_flat_cents?: number | null;
  late_fee_bps_per_month?: number | null;
  late_fee_grace_days?: number | null;
  late_fee_note_on_reminders?: boolean | null;
  /**
   * 20260815120000. Absent (a brand new client) reads as TRUE, matching
   * the column default. Only an explicit false is "you do not bill them".
   */
  you_invoice?: boolean | null;
};

const LATE_FEE_KINDS = [
  { value: "none", label: "No late fee" },
  { value: "flat", label: "A flat amount" },
  { value: "rate", label: "A percentage per month" },
];

const TREATMENTS = [
  { value: "unassigned", label: "Decide per expense" },
  { value: "rebill", label: "Rebill to the client" },
  { value: "deduct", label: "Keep as a deduction" },
];

const PER_DIEM_MODES = [
  { value: "receipts", label: "Itemised meal receipts" },
  { value: "per_diem", label: "Per diem" },
];

// Bug fix, not a style choice: the trip minimum used to apply per trip
// unconditionally, because that was the only basis the product could
// express. A pilot on a monthly guarantee ("10 days a month, whatever the
// mix of trips") had no way to say so and got billed as if every short
// trip individually carried the full minimum — see
// supabase/migrations/20260807040000_client_minimum_basis.sql. Worded for
// how a pilot describes the deal, not the column name.
const MINIMUM_BASES = [
  { value: "per_trip", label: "Per trip" },
  { value: "per_month", label: "Per calendar month" },
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
  const [minimumBasis, setMinimumBasis] = useState(() =>
    initial("minimum_basis", values.minimum_basis, "per_trip")
  );
  const [operatingRule, setOperatingRule] = useState(() =>
    initial("operating_rule", values.operating_rule, "unspecified")
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
    if (submitted?.minimum_basis !== undefined) {
      setMinimumBasis(String(submitted.minimum_basis || "per_trip"));
    }
    if (submitted?.operating_rule !== undefined) {
      setOperatingRule(String(submitted.operating_rule || "unspecified"));
    }
    if (submitted?.late_fee_kind !== undefined) {
      setLateFeeKind(String(submitted.late_fee_kind || "none"));
    }
    if (submitted?.reminder_before_due !== undefined) {
      setBeforeDue(initialDays("reminder_before_due", null));
    }
    if (submitted?.reminder_after_due !== undefined) {
      setAfterDue(initialDays("reminder_after_due", null));
    }
    if (submitted?.reminder_on_due !== undefined) {
      setOnDue(submitted.reminder_on_due === "1");
    }
    if (submitted?.late_fee_note_on_reminders !== undefined) {
      setLateFeeNote(submitted.late_fee_note_on_reminders === "1");
    }
    if (submitted?.you_invoice !== undefined) {
      setYouInvoice(submitted.you_invoice === "1");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [submitted]);
  const expenseTreatmentId = useId();
  const w9StatusId = useId();
  const perDiemModeId = useId();
  const minimumBasisId = useId();
  const operatingRuleId = useId();
  const lateFeeKindId = useId();

  // THE CHASE SCHEDULE. Held as controlled state and posted through hidden
  // inputs as comma-separated day lists, for the same React-19 reason the
  // Selects above are: an uncontrolled control loses its state on every action
  // dispatch, the rejected one included, so a pilot who mis-typed a rate would
  // also silently lose the schedule they had just ticked.
  //
  // EVERY BOX STARTS UNTICKED for a client that has never had a schedule.
  // Shipping a default cadence would be this product deciding, on a pilot's
  // behalf and in their name, how often to chase somebody they have a
  // commercial relationship with.
  const [beforeDue, setBeforeDue] = useState<number[]>(
    () => initialDays("reminder_before_due", values.reminder_before_due)
  );
  const [onDue, setOnDue] = useState<boolean>(
    () => initialFlag("reminder_on_due", values.reminder_on_due)
  );
  const [afterDue, setAfterDue] = useState<number[]>(
    () => initialDays("reminder_after_due", values.reminder_after_due)
  );
  const [lateFeeKind, setLateFeeKind] = useState(() =>
    initial(
      "late_fee_kind",
      values.late_fee_flat_cents != null
        ? "flat"
        : values.late_fee_bps_per_month != null
          ? "rate"
          : "none",
      "none"
    )
  );
  const [lateFeeNote, setLateFeeNote] = useState<boolean>(
    () => initialFlag("late_fee_note_on_reminders", values.late_fee_note_on_reminders)
  );

  // you_invoice defaults ON, which is why it cannot use initialFlag: that
  // helper reads an absent stored value as false, correct for the reminder
  // and late-fee flags (a client has no chase schedule until a pilot sets
  // one) and wrong here. A NEW client is one you bill unless the pilot
  // says otherwise, matching the column's own `not null default true`, so
  // only an explicit stored `false` turns it off.
  const [youInvoice, setYouInvoice] = useState<boolean>(() => {
    const echoed = submitted?.you_invoice;
    if (echoed !== undefined) return echoed === "1";
    return values.you_invoice !== false;
  });

  function initialDays(key: string, stored: number[] | null | undefined): number[] {
    const echoed = submitted?.[key];
    const source =
      echoed !== undefined ? echoed.split(",") : (stored ?? []).map(String);
    return source
      .map((part) => Number(String(part).trim()))
      .filter((day) => Number.isInteger(day));
  }

  function initialFlag(key: string, stored: boolean | null | undefined): boolean {
    const echoed = submitted?.[key];
    if (echoed !== undefined) return echoed === "1";
    return stored === true;
  }

  function toggleDay(
    day: number,
    current: number[],
    set: (next: number[]) => void
  ) {
    set(
      current.includes(day)
        ? current.filter((d) => d !== day)
        : [...current, day].sort((a, b) => a - b)
    );
  }

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
          <Flex direction="column" gap="1" gridColumn={{ md: "span 2" }}>
            <Text as="label" size="2" weight="medium" id={`${operatingRuleId}-label`}>
              Operating rule
            </Text>
            <Select.Root
              key={`operating-rule-${genTick}`}
              value={operatingRule}
              onValueChange={setOperatingRule}
            >
              <Select.Trigger
                id={operatingRuleId}
                aria-labelledby={`${operatingRuleId}-label`}
              />
              <Select.Content>
                {CLIENT_OPERATING_RULES.map((option) => (
                  <Select.Item key={option.value} value={option.value}>
                    {option.label}
                  </Select.Item>
                ))}
              </Select.Content>
            </Select.Root>
            <input type="hidden" name="operating_rule" value={operatingRule} />
            <Text size="1" color="gray">
              Which 14 CFR part this client&rsquo;s work is flown under. Controls whether the
              Part 135 checks (135.293/.297/.299) below show up for this client, and seeds
              (but doesn&rsquo;t fix) the operating rule on every new trip for them.
            </Text>
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
          {/* 20260815120000. Sits in the rate agreement block because that
              is the block about money, and this is the switch that says
              whether there is any. Posted through a controlled hidden
              input for the same React 19 reason every other control on
              this form is: an uncontrolled checkbox loses its state on
              every action dispatch, the rejected one included. */}
          <Flex direction="column" gap="1" gridColumn={{ md: "span 3" }}>
            <Text as="label" size="2" weight="medium">
              <Flex align="center" gap="2">
                <Checkbox
                  checked={youInvoice}
                  onCheckedChange={(value) => setYouInvoice(value === true)}
                />
                {COUNTERPARTY_COPY.toggleLabel}
              </Flex>
            </Text>
            <input type="hidden" name="you_invoice" value={youInvoice ? "1" : ""} />
            <Text size="1" color="gray">
              {COUNTERPARTY_COPY.toggleHelp}
            </Text>
          </Flex>
        </Grid>

        <Flex direction="column" gap="1" mt="5" mb="3">
          <Heading as="h2" size="4">Contract terms</Heading>
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
                the other one: a floor on the total days billed. Which
                total it's a floor ON is minimum_basis, right below. */}
            <Text as="label" size="2" weight="medium" htmlFor="minimum_days">
              Minimum (days)
            </Text>
            <TextField.Root
              id="minimum_days"
              name="minimum_days"
              inputMode="decimal"
              defaultValue={initial("minimum_days", values.minimum_days)}
            />
          </Flex>
          <Flex direction="column" gap="1">
            {/* Bug fix (see MINIMUM_BASES above): this used to be an
                unstated assumption, always "per trip" because that was
                the only thing createInvoiceDraft could do with the number
                above. Now it's an explicit choice, worded the way a pilot
                describes their own deal rather than the schema's
                vocabulary. */}
            <Text as="label" size="2" weight="medium" htmlFor={minimumBasisId}>
              Applies
            </Text>
            <Select.Root
              key={`minimum_basis-${genTick}`}
              value={minimumBasis}
              onValueChange={setMinimumBasis}
            >
              <Select.Trigger id={minimumBasisId} />
              <Select.Content>
                {MINIMUM_BASES.map((o) => (
                  <Select.Item key={o.value} value={o.value}>
                    {o.label}
                  </Select.Item>
                ))}
              </Select.Content>
            </Select.Root>
            <input type="hidden" name="minimum_basis" value={minimumBasis} />
            {/* F3 + F4, extended: names the behavior in the same terms a
                pilot reads their own invoice in, and states the gate —
                this only bites once a trip's day grid has been filled in
                and saved; a trip without one isn't held to it. The two
                readings genuinely differ: "per trip" tops up EVERY short
                trip on the invoice; "per calendar month" tops up the
                month at most once, across however many trips it took —
                see the invoice draft's own line descriptions for exactly
                which month got topped up and by how much. */}
            <Text size="1" color="gray">
              {minimumBasis === "per_month"
                ? "Four 3-day trips in a month for a client with a 10-day monthly guarantee bill one top-up line for the month, not four."
                : "A 1-day trip for a client with a 2-day minimum bills 2 days, on every trip that falls short."}
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
              Recorded for reference only, not applied automatically. Add
              the fee line yourself if the client owes one.
            </Text>
          </Flex>
        </Grid>

        <Flex direction="column" gap="1" mt="5" mb="3">
          <Heading as="h2" size="4">Chasing this client</Heading>
          {/* SAYS PLAINLY THAT MAIL LEAVES THE BUILDING. This is the only
              screen in the product where a pilot arms something that emails
              their client without them, so it names the client, says nothing
              is on by default, and says where to stop it. */}
          <Text size="2" color="gray">
            Reminders go out on their own, in your name, to the contact above.
            They&rsquo;re the same follow-up you could send by hand from an
            invoice, with the invoice attached. Nothing is on until you tick
            it, and you can switch reminders off for any single invoice from
            that invoice&rsquo;s page.
          </Text>
        </Flex>
        <Grid columns={{ initial: "1", md: "3" }} gap="3">
          <Flex direction="column" gap="1">
            <Text as="div" size="2" weight="medium">
              Before it&rsquo;s due
            </Text>
            <Flex direction="column" gap="1" mt="1">
              {REMINDER_BEFORE_DAYS.map((day) => (
                <Text as="label" size="2" key={`before-${day}`}>
                  <Flex gap="2" align="center">
                    <Checkbox
                      checked={beforeDue.includes(day)}
                      onCheckedChange={() =>
                        toggleDay(day, beforeDue, setBeforeDue)
                      }
                    />
                    {day} days before
                  </Flex>
                </Text>
              ))}
            </Flex>
            <input
              type="hidden"
              name="reminder_before_due"
              value={beforeDue.join(",")}
            />
            <Text size="1" color="gray">
              A courtesy note while there is still time to pay it.
            </Text>
          </Flex>

          <Flex direction="column" gap="1">
            <Text as="div" size="2" weight="medium">
              On the due date
            </Text>
            <Text as="label" size="2" mt="1">
              <Flex gap="2" align="center">
                <Checkbox
                  checked={onDue}
                  onCheckedChange={(value) => setOnDue(value === true)}
                />
                Send one on the day
              </Flex>
            </Text>
            <input type="hidden" name="reminder_on_due" value={onDue ? "1" : ""} />
          </Flex>

          <Flex direction="column" gap="1">
            <Text as="div" size="2" weight="medium">
              After it&rsquo;s due
            </Text>
            <Flex direction="column" gap="1" mt="1">
              {REMINDER_AFTER_DAYS.map((day) => (
                <Text as="label" size="2" key={`after-${day}`}>
                  <Flex gap="2" align="center">
                    <Checkbox
                      checked={afterDue.includes(day)}
                      onCheckedChange={() => toggleDay(day, afterDue, setAfterDue)}
                    />
                    {day} days past due
                  </Flex>
                </Text>
              ))}
            </Flex>
            <input
              type="hidden"
              name="reminder_after_due"
              value={afterDue.join(",")}
            />
          </Flex>

          <Flex direction="column" gap="1" gridColumn={{ md: "span 3" }}>
            {/* THE THREE THINGS A PILOT WOULD OTHERWISE FIND OUT BY WATCHING.
                Each is a real rule in lib/reminders/policy.ts, not a
                reassurance: one send per invoice per run, a quiet period after
                any chase (yours included), and a pause when the client has
                just opened the link. */}
            <Text size="1" color="gray">
              Only one reminder ever goes out per invoice per day. If you tick
              several and an invoice is already well past due, the most recent
              one is sent and the earlier ones are skipped, not queued up.
              Nothing goes out within five days of any reminder, including one
              you sent by hand, or while the client has just opened the invoice
              link. Paid and voided invoices are never chased.
            </Text>
          </Flex>
        </Grid>

        <Flex direction="column" gap="1" mt="5" mb="3">
          <Heading as="h2" size="4">Late fee</Heading>
          {/* THE DOMAIN RULE, IN THE COPY. A late fee is a term the pilot
              negotiated, not something this product works out they are owed —
              so the heading is neutral, the wording says "you agreed", and the
              default is none. */}
          <Text size="2" color="gray">
            Only if you agreed one with this client. This product never adds a
            fee on its own: when one is due it offers you a separate draft
            invoice, which you review and send like any other.
          </Text>
        </Flex>
        <Grid columns={{ initial: "1", md: "3" }} gap="3">
          <Flex direction="column" gap="1">
            <Text as="label" size="2" weight="medium" htmlFor={lateFeeKindId}>
              What you agreed
            </Text>
            <Select.Root
              key={`late-fee-kind-${genTick}`}
              value={lateFeeKind}
              onValueChange={setLateFeeKind}
            >
              <Select.Trigger id={lateFeeKindId} />
              <Select.Content>
                {LATE_FEE_KINDS.map((option) => (
                  <Select.Item key={option.value} value={option.value}>
                    {option.label}
                  </Select.Item>
                ))}
              </Select.Content>
            </Select.Root>
            <input type="hidden" name="late_fee_kind" value={lateFeeKind} />
          </Flex>

          {lateFeeKind === "flat" ? (
            <Flex direction="column" gap="1">
              <Text as="label" size="2" weight="medium" htmlFor="late_fee_flat">
                Amount (USD)
              </Text>
              <TextField.Root
                id="late_fee_flat"
                name="late_fee_flat"
                inputMode="decimal"
                defaultValue={initial(
                  "late_fee_flat",
                  centsToInput(values.late_fee_flat_cents)
                )}
              />
              <Text size="1" color="gray">
                Charged once, not every month.
              </Text>
            </Flex>
          ) : null}

          {lateFeeKind === "rate" ? (
            <Flex direction="column" gap="1">
              <Text as="label" size="2" weight="medium" htmlFor="late_fee_rate_percent">
                Percent per month
              </Text>
              <TextField.Root
                id="late_fee_rate_percent"
                name="late_fee_rate_percent"
                inputMode="decimal"
                defaultValue={initial(
                  "late_fee_rate_percent",
                  values.late_fee_bps_per_month == null
                    ? ""
                    : String(values.late_fee_bps_per_month / 100)
                )}
              />
              <Text size="1" color="gray">
                1.5% is the common convention. The fee applies to the balance
                still outstanding, charged per complete month, up to a cap of 5%.
              </Text>
            </Flex>
          ) : null}

          <Flex direction="column" gap="1">
            <Text as="label" size="2" weight="medium" htmlFor="late_fee_grace_days">
              Grace period (days)
            </Text>
            <TextField.Root
              id="late_fee_grace_days"
              type="number"
              name="late_fee_grace_days"
              defaultValue={initial(
                "late_fee_grace_days",
                values.late_fee_grace_days,
                "0"
              )}
            />
            <Text size="1" color="gray">
              Days past due before anything starts running.
            </Text>
          </Flex>

          {lateFeeKind !== "none" ? (
            <Flex direction="column" gap="1" gridColumn={{ md: "span 3" }}>
              <Separator size="4" my="1" />
              <Text as="label" size="2">
                <Flex gap="2" align="center">
                  <Checkbox
                    checked={lateFeeNote}
                    onCheckedChange={(value) => setLateFeeNote(value === true)}
                  />
                  Mention it in reminders to this client
                </Flex>
              </Text>
              <input
                type="hidden"
                name="late_fee_note_on_reminders"
                value={lateFeeNote ? "1" : ""}
              />
              {/* SAYS EXACTLY WHAT THE CLIENT WOULD READ, because "mention it"
                  could mean anything and this is a sentence going to somebody
                  else's accounts department in the pilot's name. */}
              <Text size="1" color="gray">
                Adds one line to reminders: &ldquo;Per our agreement, a late fee
                of {lateFeeKind === "flat" ? "$X" : "X% per month"} applies on
                balances more than N days past their due date.&rdquo; It states
                the term only. There is no running total, and it is never
                shown as part of the amount due.
              </Text>
            </Flex>
          ) : null}
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

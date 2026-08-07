"use client";

import { useActionState, useState } from "react";
import NextLink from "next/link";
import { Box, Button, Card, Flex, Grid, Text, TextField, Select, TextArea } from "@/components/ui";
import { centsToInput } from "@/lib/format";
import type { ExpenseFormState } from "./actions";

export type ExpenseFormValues = {
  id?: string;
  incurred_on?: string | null;
  category?: string | null;
  vendor?: string | null;
  amount_cents?: number | null;
  treatment?: string | null;
  trip_id?: string | null;
  notes?: string | null;
  receipt_path?: string | null;
};

export type TripOption = {
  id: string;
  label: string;
  clientName: string | null;
  defaultTreatment: string | null;
};

/** Ported verbatim from the schema's vocabulary; labels are the pilot's. */
const CATEGORIES = [
  { value: "airline", label: "Airline" },
  { value: "hotel", label: "Hotel" },
  { value: "rental_car", label: "Rental car" },
  { value: "rideshare", label: "Rideshare" },
  { value: "fuel", label: "Fuel" },
  { value: "meals", label: "Meals" },
  { value: "parking", label: "Parking" },
  { value: "other", label: "Other" },
];

const TREATMENTS = [
  { value: "unassigned", label: "Decide later" },
  { value: "rebill", label: "Rebill to the client" },
  { value: "deduct", label: "Keep as a deduction" },
];

// Radix Select forbids an item with value="" — "No trip" uses this
// sentinel and is translated back to "" on submit, so the FormData field
// name (`trip_id`) never changes and actions.ts's optionalUuid() still
// reads a blank trip exactly as before.
const NO_TRIP = "none";

const initialState: ExpenseFormState = { error: null };

export default function ExpenseForm({
  action,
  trips,
  values = {},
  submitLabel,
}: {
  action: (
    state: ExpenseFormState,
    formData: FormData
  ) => Promise<ExpenseFormState>;
  trips: TripOption[];
  values?: ExpenseFormValues;
  submitLabel: string;
}) {
  const [state, formAction, pending] = useActionState(action, initialState);

  const submitted = state.values;
  const initial = (key: string, stored: unknown, fallback = "") => {
    const echoed = submitted?.[key];
    if (echoed !== undefined) return echoed;
    return stored === null || stored === undefined ? fallback : String(stored);
  };

  // Treatment and trip are controlled together: "rebill" is only
  // meaningful with a trip attached (the database refuses the pair), so
  // the trip field becomes required in front of the pilot rather than
  // after a round trip.
  //
  // Radix's Select.Root always renders its posting <select> with
  // `defaultValue`, never `value` (@radix-ui/react-select's
  // SelectBubbleInput) — so it's uncontrolled from React's point of view
  // regardless of what Select.Root gets passed, and React 19's post-action
  // form.reset() restores it to its mount-time option even on a rejected
  // submit. The wrapped submit handler below (already relied on for
  // tripId) sidesteps this for every Select value by overwriting the
  // FormData entry from React state at dispatch time, so the state the
  // pilot actually sees is what's actually posted, regardless of what the
  // native <select> reverted to.
  const [category, setCategory] = useState(() => initial("category", values.category, "other"));
  const tripsById = new Map(trips.map((trip) => [trip.id, trip]));

  // H7: the client already answers "rebill or deduct?" on its own record
  // (default_expense_treatment) — a brand-new expense that arrives with a
  // trip already picked (preselected via ?trip=, or the pilot's own first
  // choice) should DEFAULT to that answer instead of hardcoding
  // "unassigned" and making the pilot re-decide something the product
  // already knows. `treatmentTouched` is what keeps it a default rather
  // than a forced value: once the pilot changes the Treatment select
  // themselves, the trip-driven default stops overwriting it, including
  // if they go on to change the trip again.
  const isNew = !values.id;
  const [treatment, setTreatment] = useState(() => {
    if (submitted?.treatment !== undefined) return submitted.treatment;
    if (values.treatment !== undefined && values.treatment !== null) {
      return values.treatment;
    }
    if (isNew && values.trip_id) {
      const preselected = tripsById.get(values.trip_id);
      if (preselected?.defaultTreatment) return preselected.defaultTreatment;
    }
    return "unassigned";
  });
  const [treatmentTouched, setTreatmentTouched] = useState(
    () => submitted?.treatment !== undefined
  );
  const [tripId, setTripId] = useState(() => {
    const stored = submitted?.trip_id ?? values.trip_id ?? "";
    return stored === "" ? NO_TRIP : stored;
  });
  const rebilling = treatment === "rebill";
  const selectedTrip = tripId === NO_TRIP ? null : tripsById.get(tripId) ?? null;

  const handleTreatmentChange = (next: string) => {
    setTreatment(next);
    setTreatmentTouched(true);
  };

  const handleTripChange = (next: string) => {
    setTripId(next);
    if (!isNew || treatmentTouched) return;
    const trip = next === NO_TRIP ? null : tripsById.get(next) ?? null;
    if (trip?.defaultTreatment) setTreatment(trip.defaultTreatment);
  };

  // True only while the currently-shown treatment IS the untouched
  // default this trip's client supplied — the visible "why" behind the
  // value, so the pilot isn't surprised by a select that didn't start on
  // "Decide later" and never told them why.
  const defaultedFromClient =
    isNew && !treatmentTouched && selectedTrip?.defaultTreatment === treatment
      ? selectedTrip?.clientName ?? null
      : null;

  return (
    <Card size="3">
      <form
        action={(formData) => {
          formData.set("trip_id", tripId === NO_TRIP ? "" : tripId);
          formData.set("category", category);
          formData.set("treatment", treatment);
          return formAction(formData);
        }}
      >
        {values.id ? <input type="hidden" name="id" value={values.id} /> : null}

        <Text as="div" size="4" weight="bold" mb="3">
          The receipt
        </Text>
        <Grid columns={{ initial: "1", md: "4" }} gap="3">
          <Flex direction="column" gap="1">
            <Text as="label" size="2" weight="medium" htmlFor="incurred_on">
              Date
            </Text>
            <TextField.Root
              id="incurred_on"
              type="date"
              name="incurred_on"
              required
              defaultValue={initial("incurred_on", values.incurred_on)}
            />
          </Flex>
          <Flex direction="column" gap="1">
            <Text as="label" size="2" weight="medium" id="category-label">
              Category
            </Text>
            <Select.Root value={category} onValueChange={setCategory}>
              <Select.Trigger aria-labelledby="category-label" />
              <Select.Content>
                {CATEGORIES.map((option) => (
                  <Select.Item key={option.value} value={option.value}>
                    {option.label}
                  </Select.Item>
                ))}
              </Select.Content>
            </Select.Root>
          </Flex>
          <Flex direction="column" gap="1">
            <Text as="label" size="2" weight="medium" htmlFor="vendor">
              Vendor
            </Text>
            <TextField.Root id="vendor" name="vendor" defaultValue={initial("vendor", values.vendor)} />
            <Text size="1" color="gray">
              Who you paid
            </Text>
          </Flex>
          <Flex direction="column" gap="1">
            <Text as="label" size="2" weight="medium" htmlFor="amount">
              Amount (USD)
            </Text>
            <TextField.Root
              id="amount"
              name="amount"
              required
              inputMode="decimal"
              defaultValue={initial(
                "amount",
                values.amount_cents === null || values.amount_cents === undefined
                  ? null
                  : centsToInput(values.amount_cents)
              )}
            />
          </Flex>
        </Grid>

        <Box mt="6" mb="3">
          <Text as="div" size="4" weight="bold">
            How it&rsquo;s treated
          </Text>
          <Text as="div" size="2" color="gray">
            Set once, here. Nothing downstream asks again.
          </Text>
        </Box>
        <Grid columns={{ initial: "1", md: "2" }} gap="3">
          <Flex direction="column" gap="1">
            <Text as="label" size="2" weight="medium" id="treatment-label">
              Treatment
            </Text>
            <Select.Root value={treatment} onValueChange={handleTreatmentChange}>
              <Select.Trigger aria-labelledby="treatment-label" />
              <Select.Content>
                {TREATMENTS.map((option) => (
                  <Select.Item key={option.value} value={option.value}>
                    {option.label}
                  </Select.Item>
                ))}
              </Select.Content>
            </Select.Root>
            {defaultedFromClient ? (
              <Text size="1" color="gray">
                {`Defaulted from ${defaultedFromClient}'s billing preference — change it anytime.`}
              </Text>
            ) : null}
          </Flex>
          <Flex direction="column" gap="1">
            <Text as="label" size="2" weight="medium" id="trip-label">
              Trip
            </Text>
            <Select.Root value={tripId} onValueChange={handleTripChange}>
              <Select.Trigger aria-labelledby="trip-label" />
              <Select.Content>
                <Select.Item value={NO_TRIP}>No trip</Select.Item>
                {trips.map((trip) => (
                  <Select.Item key={trip.id} value={trip.id}>
                    {trip.label}
                  </Select.Item>
                ))}
              </Select.Content>
            </Select.Root>
            <Text size="1" color={rebilling ? "amber" : "gray"}>
              {rebilling
                ? "Required — a rebilled expense has to land on an invoice"
                : "Optional. Leave blank and it waits in the unassigned queue."}
            </Text>
          </Flex>
          <Box style={{ gridColumn: "1 / -1" }}>
            <Flex direction="column" gap="1">
              <Text as="label" size="2" weight="medium" htmlFor="notes">
                Notes
              </Text>
              <TextArea id="notes" name="notes" rows={2} defaultValue={initial("notes", values.notes)} />
            </Flex>
          </Box>
        </Grid>

        <Box mt="6" mb="3">
          <Text as="div" size="4" weight="bold">
            Receipt image
          </Text>
        </Box>
        <Box>
          {/* A plain file input: the receipt is stored privately and read
              back through a short-lived signed URL, never a public URL. */}
          <input
            type="file"
            name="receipt"
            accept="image/jpeg,image/png,image/heic,image/webp,application/pdf"
            aria-label="Receipt image or PDF"
          />
          <Text as="div" size="1" color="gray" mt="2">
            {values.receipt_path
              ? "A receipt is already attached. Choosing a file replaces it."
              : "JPEG, PNG, HEIC, WebP or PDF, up to 10 MB. Optional."}
          </Text>
        </Box>

        <Flex mt="4" role="alert" aria-live="polite">
          {state.error ? (
            <Text size="1" color="red">
              {state.error}
            </Text>
          ) : null}
        </Flex>

        <Flex mt="4" gap="3">
          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : submitLabel}
          </Button>
          <Button asChild variant="outline">
            <NextLink href="/expenses">Cancel</NextLink>
          </Button>
        </Flex>
      </form>
    </Card>
  );
}

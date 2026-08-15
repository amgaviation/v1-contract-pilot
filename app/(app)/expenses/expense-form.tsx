"use client";

import { useActionState, useState } from "react";
import NextLink from "next/link";
import { Box, Button, Callout, Card, Flex, Grid, Text, TextField, Select, TextArea } from "@/components/ui";
import { centsToInput } from "@/lib/format";
import { matchTrip } from "@/lib/receipt-ocr/match-trip";
import ReceiptScan, { type ScanOutcome } from "./receipt-scan";
import type { OptionChoice } from "@/lib/custom-options";
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
  /** For matching a scanned receipt's tail number to the trip it belongs to. */
  aircraftIdent: string | null;
  startsOn: string;
  endsOn: string;
};

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

/** A field the scan read but did not overwrite, because the pilot had typed one. */
type ScanConflict = { field: "incurred_on" | "vendor" | "amount"; label: string; scanned: string };

export default function ExpenseForm({
  action,
  trips,
  categories,
  values = {},
  submitLabel,
}: {
  action: (
    state: ExpenseFormState,
    formData: FormData
  ) => Promise<ExpenseFormState>;
  trips: TripOption[];
  /**
   * The tenant's own expense-category vocabulary — their labels, their
   * order, retired categories already dropped. Read server-side by the
   * page (lib/custom-options-read.ts) and passed in: this is a client
   * component and the options table is only readable on the server.
   * REQUIRED, not optional, so a new screen rendering this form cannot
   * quietly fall back to the stock list.
   */
  categories: readonly OptionChoice[];
  values?: ExpenseFormValues;
  submitLabel: string;
}) {
  const [state, formAction, pending] = useActionState(action, initialState);

  const submitted = state.values;
  // Reads the echoed value from a rejected submit if there is one, else
  // the stored row. Only meaningful for fields that are UNCONTROLLED
  // (`notes`, below) and for the mount-time seed of the controlled ones:
  // a useState initialiser runs once, at mount, when `submitted` is always
  // undefined. For a controlled field the state IS the echo — it survives
  // the action dispatch because React re-renders rather than remounting.
  // Kept explicit because the next reader will otherwise "fix" this into
  // an effect and reintroduce the reset bug it exists to avoid.
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
  // "other" is not a proxy for "untouched" — it is a real answer a pilot
  // picks deliberately, and a Signature Flight Support HANGAR RENTAL filed
  // as Other used to flip silently to Fuel the moment they scanned it.
  // Tracked the same way `treatmentTouched` already is.
  const [categoryTouched, setCategoryTouched] = useState(
    () => submitted?.category !== undefined
  );
  const tripsById = new Map(trips.map((trip) => [trip.id, trip]));

  // The three free-text fields are controlled for the same reason the
  // selects are steered by hand, plus one more: receipt scanning writes
  // into them. A `defaultValue` input cannot be filled from outside after
  // mount without reaching into the DOM, and React 19's post-action reset
  // would then discard whatever was written on a rejected submit. Held in
  // state, the scanned value survives an error round trip and is what
  // actually posts.
  const [incurredOn, setIncurredOn] = useState(() => initial("incurred_on", values.incurred_on));
  const [vendor, setVendor] = useState(() => initial("vendor", values.vendor));
  const [amount, setAmount] = useState(() =>
    initial(
      "amount",
      values.amount_cents === null || values.amount_cents === undefined
        ? null
        : centsToInput(values.amount_cents)
    )
  );

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
  const [conflicts, setConflicts] = useState<ScanConflict[]>([]);
  const [tripHint, setTripHint] = useState<string | null>(null);
  const rebilling = treatment === "rebill";
  const selectedTrip = tripId === NO_TRIP ? null : tripsById.get(tripId) ?? null;

  const handleTreatmentChange = (next: string) => {
    setTreatment(next);
    setTreatmentTouched(true);
  };

  const applyTripDefault = (next: string) => {
    if (!isNew || treatmentTouched) return;
    const trip = next === NO_TRIP ? null : tripsById.get(next) ?? null;
    if (trip?.defaultTreatment) setTreatment(trip.defaultTreatment);
  };

  const handleTripChange = (next: string) => {
    setTripId(next);
    setTripHint(null);
    applyTripDefault(next);
  };

  /**
   * What a finished scan does to the form.
   *
   * The governing rule is that a scan never overwrites something the pilot
   * typed. An empty field is a field they haven't answered, so filling it
   * saves them work; a filled field is an answer, and replacing it with a
   * machine's reading of a photograph is how a pilot loses trust in the
   * feature permanently. Conflicts are surfaced with the scanned value and
   * a one-tap "use it" instead, so nothing the scan read is thrown away —
   * the pilot just stays the one who decides.
   */
  const handleScan = ({ extraction }: ScanOutcome) => {
    const found: ScanConflict[] = [];

    if (extraction.date) {
      if (incurredOn === "") setIncurredOn(extraction.date);
      else if (incurredOn !== extraction.date)
        found.push({ field: "incurred_on", label: "Date", scanned: extraction.date });
    }
    if (extraction.vendor) {
      if (vendor.trim() === "") setVendor(extraction.vendor);
      else if (vendor.trim() !== extraction.vendor)
        found.push({ field: "vendor", label: "Vendor", scanned: extraction.vendor });
    }
    if (extraction.amountCents !== null) {
      const scanned = centsToInput(extraction.amountCents);
      if (amount.trim() === "") setAmount(scanned);
      else if (amount.trim() !== scanned)
        found.push({ field: "amount", label: "Amount", scanned });
    }
    // Category always has a value ("other" by default), so "untouched"
    // rather than "empty" is the test: overwriting a real choice would be
    // wrong, but leaving a receipt that plainly says Signature Flight
    // Support filed as Other would be worse.
    if (extraction.category && !categoryTouched && category === "other") {
      setCategory(extraction.category);
    }

    setConflicts(found);

    // The tail number is the strongest signal a receipt carries about
    // WHICH trip it belongs to, and that association is what decides
    // whether the charge gets rebilled. Only offered when the pilot hasn't
    // already picked a trip.
    if (tripId === NO_TRIP) {
      const match = matchTrip(trips, {
        aircraftIdent: extraction.aircraftIdent,
        date: extraction.date,
      });
      if (match.kind === "one") {
        setTripId(match.trip.id);
        applyTripDefault(match.trip.id);
        setTripHint(match.because);
      } else if (match.kind === "several") {
        setTripHint(match.because);
      }
    }
  };

  const takeConflict = (conflict: ScanConflict) => {
    if (conflict.field === "incurred_on") setIncurredOn(conflict.scanned);
    if (conflict.field === "vendor") setVendor(conflict.scanned);
    if (conflict.field === "amount") setAmount(conflict.scanned);
    setConflicts((current) => current.filter((c) => c.field !== conflict.field));
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

        <Text as="div" size="4" weight="bold" mb="1">
          The receipt
        </Text>
        <Text as="div" size="2" color="gray" mb="3">
          Attach the photo first and the fields below fill themselves in.
        </Text>

        <ReceiptScan
          hasExistingReceipt={Boolean(values.receipt_path)}
          onExtracted={handleScan}
          // Swapping the file makes everything the last scan said describe
          // a different receipt. The values it wrote stay — they may be
          // right, and silently blanking a pilot's form is its own defect —
          // but the explanations attached to them do not.
          onFileChanged={() => {
            setConflicts([]);
            setTripHint(null);
          }}
        />

        {conflicts.length > 0 ? (
          <Box mt="3">
            <Callout.Root color="amber" size="1">
              <Callout.Text>
                The scan read these differently from what you have. Yours is kept unless you say
                otherwise.
              </Callout.Text>
              <Flex mt="2" direction="column" gap="2">
                {conflicts.map((conflict) => (
                  <Flex key={conflict.field} gap="3" align="center" wrap="wrap">
                    <Text size="1">{`${conflict.label}: ${conflict.scanned}`}</Text>
                    <Button
                      type="button"
                      size="1"
                      variant="soft"
                      onClick={() => takeConflict(conflict)}
                    >
                      Use this
                    </Button>
                  </Flex>
                ))}
              </Flex>
            </Callout.Root>
          </Box>
        ) : null}

        <Grid columns={{ initial: "1", md: "4" }} gap="3" mt="4">
          <Flex direction="column" gap="1">
            <Text as="label" size="2" weight="medium" htmlFor="incurred_on">
              Date
            </Text>
            <TextField.Root
              id="incurred_on"
              type="date"
              name="incurred_on"
              required
              value={incurredOn}
              onChange={(event) => setIncurredOn(event.currentTarget.value)}
            />
          </Flex>
          <Flex direction="column" gap="1">
            <Text as="label" size="2" weight="medium" id="category-label">
              Category
            </Text>
            <Select.Root
              value={category}
              onValueChange={(next) => {
                setCategory(next);
                setCategoryTouched(true);
              }}
            >
              <Select.Trigger aria-labelledby="category-label" />
              <Select.Content>
                {categories.map((option) => (
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
            <TextField.Root
              id="vendor"
              name="vendor"
              value={vendor}
              onChange={(event) => setVendor(event.currentTarget.value)}
            />
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
              value={amount}
              onChange={(event) => setAmount(event.currentTarget.value)}
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
                {`Defaulted from ${defaultedFromClient}'s billing preference. Change it anytime.`}
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
            {tripHint ? (
              <Text size="1" color="gray">
                {tripHint}
              </Text>
            ) : null}
            <Text size="1" color={rebilling ? "amber" : "gray"}>
              {trips.length === 0
                ? "No trips yet. Log one first if this expense should be rebilled."
                : rebilling
                  ? "Required. A rebilled expense has to land on an invoice"
                  : "Optional. Leave blank and it waits in the unassigned queue."}
            </Text>
          </Flex>
          <Box gridColumn="1 / -1">
            <Flex direction="column" gap="1">
              <Text as="label" size="2" weight="medium" htmlFor="notes">
                Notes
              </Text>
              <TextArea id="notes" name="notes" rows={2} defaultValue={initial("notes", values.notes)} />
            </Flex>
          </Box>
        </Grid>

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

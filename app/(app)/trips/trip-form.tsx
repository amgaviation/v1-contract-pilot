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
import type { TripFormState } from "./actions";

export type TripFormValues = {
  id?: string;
  client_id?: string | null;
  trip_kind?: string | null;
  status?: string | null;
  starts_on?: string | null;
  ends_on?: string | null;
  aircraft_ident?: string | null;
  aircraft_type?: string | null;
  day_rate_cents?: number | null;
  day_count?: number | null;
  travel_day_count?: number | null;
  travel_day_rate_cents?: number | null;
  cancellation_notice_from?: string | null;
  /** 20260807070000: trigger-owned, read-only display only — never posted
   * by this form (there is no name attribute for it below). */
  canceled_at?: string | null;
  notes?: string | null;
};

export type ClientOption = {
  id: string;
  name: string;
  default_day_rate_cents: number | null;
  default_travel_day_rate_cents: number | null;
};

/**
 * Labels use the industry's words, not the database's. `owner_trip` is
 * what an aircraft owner's own flight is called; "repositioning" and
 * "ferry" are distinct operations and a pilot will notice if they're
 * collapsed.
 */
const TRIP_KINDS = [
  { value: "contract_pilot", label: "Contract pilot" },
  { value: "owner_trip", label: "Owner trip" },
  { value: "repositioning", label: "Repositioning" },
  { value: "ferry", label: "Ferry" },
  { value: "maintenance_flight", label: "Maintenance flight" },
  { value: "delivery_flight", label: "Delivery flight" },
  { value: "other", label: "Other" },
];

const STATUSES = [
  { value: "scheduled", label: "Scheduled" },
  { value: "in_progress", label: "In progress" },
  { value: "completed", label: "Completed" },
  { value: "canceled", label: "Canceled" },
];

/** 20260807070000_trip_day_units_away_cancel.sql — who the cancellation
 * notice came from. Only meaningful once status is 'canceled', but left
 * editable regardless of the current status: a pilot may fill it in
 * moments before switching status to canceled in the same submit. */
const CANCELLATION_NOTICE_FROM_OPTIONS = [
  { value: "client", label: "Client" },
  { value: "pilot", label: "Pilot" },
  { value: "weather", label: "Weather" },
  { value: "maintenance", label: "Maintenance" },
  { value: "other", label: "Other" },
];
/** Radix forbids an empty-string Select.Item value — see NO_CLIENT below
 * for the same reason. "Not recorded" is the real, postable null choice. */
const NO_NOTICE_FROM = "__none__";

/** Radix forbids an empty-string Select.Item value. "No client yet" is a
 * real, postable choice (client_id is optional), so it gets a sentinel
 * that never leaves this component — the hidden input below always posts
 * the real client_id, translating the sentinel back to "". */
const NO_CLIENT = "__none__";

const initialState: TripFormState = { error: null };

export default function TripForm({
  action,
  clients,
  values = {},
  submitLabel,
  cancelHref = "/trips",
  locked = false,
  hasDayRows = false,
}: {
  action: (state: TripFormState, formData: FormData) => Promise<TripFormState>;
  clients: ClientOption[];
  values?: TripFormValues;
  submitLabel: string;
  cancelHref?: string;
  /** The trip is on an invoice: its money and dates are frozen. */
  locked?: boolean;
  /**
   * F3: once the trip's day grid has rows, createInvoiceDraft prices the
   * trip from THEM and ignores this section's four columns entirely — so
   * the fields below stop being "what it bills" and become the day
   * grid's own seed input. Only ever true on the edit screen (a new trip
   * has no day grid yet); defaults false so trips/new's form reads
   * exactly as it always has.
   */
  hasDayRows?: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, initialState);

  // Echoed submission wins over the row's stored values, so a rejected
  // submit shows what the pilot typed rather than silently reverting to
  // what was there before (React 19 resets the form on every dispatch).
  const submitted = state.values;
  const initial = (key: keyof TripFormValues, fallback = "") => {
    const echoed = submitted?.[key as string];
    if (echoed !== undefined) return echoed;
    const stored = values[key];
    return stored === null || stored === undefined ? fallback : String(stored);
  };

  // The rate fields are controlled ONLY so picking a client can fill them
  // in — the "defaults from the client's rate agreement" the helper text
  // promises. Without this the day rate silently posts as 0 and the trip
  // is worth nothing.
  const [clientId, setClientId] = useState(() =>
    submitted?.client_id ?? (values.client_id ?? "")
  );
  const [dayRate, setDayRate] = useState(() =>
    submitted?.day_rate ?? centsToInput(values.day_rate_cents)
  );
  const [travelRate, setTravelRate] = useState(() =>
    submitted?.travel_day_rate ?? centsToInput(values.travel_day_rate_cents)
  );
  // Radix's Select.Root always renders its posting <select> with
  // `defaultValue`, never `value` (@radix-ui/react-select's
  // SelectBubbleInput) — so it is uncontrolled from React's point of view
  // regardless of what Select.Root is given, and it is what the browser
  // actually posts if `name` stays on it. React 19's post-action
  // form.reset() restores it to its mount-time option even on a rejected
  // submit, silently discarding the pilot's pick. Fix: no `name` on any
  // Select.Root here — the real value is posted from a controlled hidden
  // input instead, which React re-asserts after a reset. `genTick` forces
  // a remount of every Select on each dispatch so a stray reset-driven
  // onValueChange has no stale instance left to fire against.
  const [genTick, setGenTick] = useState(0);
  useEffect(() => {
    setGenTick((g) => g + 1);
  }, [state]);
  const [tripKind, setTripKind] = useState(() => initial("trip_kind", "contract_pilot"));
  const [status, setStatus] = useState(() => initial("status", "scheduled"));
  const [cancellationNoticeFrom, setCancellationNoticeFrom] = useState(() =>
    initial("cancellation_notice_from", "")
  );
  useEffect(() => {
    if (submitted?.trip_kind !== undefined) setTripKind(String(submitted.trip_kind || "contract_pilot"));
    if (submitted?.status !== undefined) setStatus(String(submitted.status || "scheduled"));
    if (submitted?.cancellation_notice_from !== undefined) {
      setCancellationNoticeFrom(String(submitted.cancellation_notice_from || ""));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [submitted]);
  const clientLabelId = useId();
  const tripKindId = useId();
  const statusId = useId();
  const noticeFromId = useId();

  function pickClient(nextId: string) {
    setClientId(nextId);
    const picked = clients.find((c) => c.id === nextId);
    if (!picked) return;
    // Only fills a blank field. A rate typed by hand for this specific
    // trip is a deliberate override and must not be clobbered by
    // switching the client — the schema's own comment calls the trip rate
    // "snapshotted from the client, then independently editable".
    if (dayRate.trim() === "" && picked.default_day_rate_cents !== null) {
      setDayRate(centsToInput(picked.default_day_rate_cents));
    }
    if (
      travelRate.trim() === "" &&
      picked.default_travel_day_rate_cents !== null
    ) {
      setTravelRate(centsToInput(picked.default_travel_day_rate_cents));
    }
  }

  return (
    <Card size="3">
      <form action={formAction}>
        {values.id ? <input type="hidden" name="id" value={values.id} /> : null}
        {/* The real client_id, always in sync with clientId — see NO_CLIENT
            above for why the Select itself can't post this directly. */}
        <input type="hidden" name="client_id" value={clientId} />

        <Heading as="h2" size="4" mb="3">
          The job
        </Heading>
        <Grid columns={{ initial: "1", md: "2" }} gap="3">
          <Flex direction="column" gap="1" gridColumn={{ md: "span 2" }}>
            <Text as="label" size="2" weight="medium" id={`${clientLabelId}-label`}>
              Client
            </Text>
            <Select.Root
              key={`client-${genTick}`}
              value={clientId === "" ? NO_CLIENT : clientId}
              onValueChange={(next) => pickClient(next === NO_CLIENT ? "" : next)}
              disabled={locked}
            >
              <Select.Trigger
                id={clientLabelId}
                aria-labelledby={`${clientLabelId}-label`}
                placeholder="No client yet"
              />
              <Select.Content>
                <Select.Item value={NO_CLIENT}>No client yet</Select.Item>
                {clients.map((client) => (
                  <Select.Item key={client.id} value={client.id}>
                    {client.name}
                  </Select.Item>
                ))}
              </Select.Content>
            </Select.Root>
            <Text size="1" color="gray">
              {clients.length === 0
                ? "No active clients yet — you can add one later."
                : "Who you're billing for this trip"}
            </Text>
          </Flex>

          <Flex direction="column" gap="1">
            <Text as="label" size="2" weight="medium" id={`${tripKindId}-label`}>
              Trip kind
            </Text>
            <Select.Root key={`trip-kind-${genTick}`} value={tripKind} onValueChange={setTripKind}>
              <Select.Trigger id={tripKindId} aria-labelledby={`${tripKindId}-label`} />
              <Select.Content>
                {TRIP_KINDS.map((option) => (
                  <Select.Item key={option.value} value={option.value}>
                    {option.label}
                  </Select.Item>
                ))}
              </Select.Content>
            </Select.Root>
            <input type="hidden" name="trip_kind" value={tripKind} />
          </Flex>

          <Flex direction="column" gap="1">
            <Text as="label" size="2" weight="medium" id={`${statusId}-label`}>
              Status
            </Text>
            <Select.Root key={`status-${genTick}`} value={status} onValueChange={setStatus}>
              <Select.Trigger id={statusId} aria-labelledby={`${statusId}-label`} />
              <Select.Content>
                {STATUSES.map((option) => (
                  <Select.Item key={option.value} value={option.value}>
                    {option.label}
                  </Select.Item>
                ))}
              </Select.Content>
            </Select.Root>
            <input type="hidden" name="status" value={status} />
            {values.canceled_at ? (
              <Text size="1" color="gray">
                Canceled {formatCancelledAt(values.canceled_at)}
              </Text>
            ) : null}
          </Flex>

          <Flex direction="column" gap="1">
            <Text as="label" size="2" weight="medium" id={`${noticeFromId}-label`}>
              Cancellation notice from
            </Text>
            <Select.Root
              key={`notice-from-${genTick}`}
              value={cancellationNoticeFrom === "" ? NO_NOTICE_FROM : cancellationNoticeFrom}
              onValueChange={(next) =>
                setCancellationNoticeFrom(next === NO_NOTICE_FROM ? "" : next)
              }
            >
              <Select.Trigger
                id={noticeFromId}
                aria-labelledby={`${noticeFromId}-label`}
                placeholder="Not recorded"
              />
              <Select.Content>
                <Select.Item value={NO_NOTICE_FROM}>Not recorded</Select.Item>
                {CANCELLATION_NOTICE_FROM_OPTIONS.map((option) => (
                  <Select.Item key={option.value} value={option.value}>
                    {option.label}
                  </Select.Item>
                ))}
              </Select.Content>
            </Select.Root>
            <input
              type="hidden"
              name="cancellation_notice_from"
              value={cancellationNoticeFrom}
            />
            <Text size="1" color="gray">
              Who called off the trip — supports a cancellation fee line if
              this contract has one. The cancellation timestamp itself is
              recorded automatically when status is set to Canceled.
            </Text>
          </Flex>

          <Flex direction="column" gap="1">
            <Text as="label" size="2" weight="medium" htmlFor="starts_on">
              Starts
            </Text>
            <TextField.Root
              id="starts_on"
              type="date"
              name="starts_on"
              required
              disabled={locked}
              defaultValue={initial("starts_on")}
            />
          </Flex>
          <Flex direction="column" gap="1">
            <Text as="label" size="2" weight="medium" htmlFor="ends_on">
              Ends
            </Text>
            <TextField.Root
              id="ends_on"
              type="date"
              name="ends_on"
              required
              disabled={locked}
              defaultValue={initial("ends_on")}
            />
          </Flex>

          <Flex direction="column" gap="1">
            <Text as="label" size="2" weight="medium" htmlFor="aircraft_ident">
              Tail number
            </Text>
            <TextField.Root
              id="aircraft_ident"
              name="aircraft_ident"
              defaultValue={initial("aircraft_ident")}
            />
          </Flex>
          <Flex direction="column" gap="1">
            <Text as="label" size="2" weight="medium" htmlFor="aircraft_type">
              Aircraft type
            </Text>
            <TextField.Root
              id="aircraft_type"
              name="aircraft_type"
              defaultValue={initial("aircraft_type")}
            />
            <Text size="1" color="gray">
              e.g. CE-560XL
            </Text>
          </Flex>
        </Grid>

        <Flex direction="column" gap="1" mt="5" mb="3">
          <Heading as="h2" size="4" color={hasDayRows ? "gray" : undefined}>
            {hasDayRows ? "What it bills (legacy)" : "What it bills"}
          </Heading>
          <Text size="1" color="gray">
            {hasDayRows
              ? "The day grid below now sets what's actually billed — these fields are the old scalar input, kept only as the day grid's original seed. Editing them does not change the invoice."
              : "Seeds the day grid below the first time it's opened. Once that grid has rows, they — not these fields — are what's actually billed."}
          </Text>
        </Flex>
        <Grid columns={{ initial: "1", md: "2" }} gap="3">
          <Flex direction="column" gap="1">
            <Text as="label" size="2" weight="medium" htmlFor="day_rate">
              Day rate (USD)
            </Text>
            <TextField.Root
              id="day_rate"
              name="day_rate"
              required
              inputMode="decimal"
              value={dayRate}
              onChange={(event) => setDayRate(event.target.value)}
              disabled={locked}
            />
            <Text size="1" color="gray">
              Fills in from the client's rate agreement
            </Text>
          </Flex>
          <Flex direction="column" gap="1">
            <Text as="label" size="2" weight="medium" htmlFor="day_count">
              Days
            </Text>
            <TextField.Root
              id="day_count"
              type="number"
              name="day_count"
              step="0.5"
              min="0"
              defaultValue={initial("day_count")}
              disabled={locked}
            />
            <Text size="1" color="gray">
              Half days are allowed
            </Text>
          </Flex>
          <Flex direction="column" gap="1">
            <Text as="label" size="2" weight="medium" htmlFor="travel_day_rate">
              Travel day rate (USD)
            </Text>
            <TextField.Root
              id="travel_day_rate"
              name="travel_day_rate"
              inputMode="decimal"
              value={travelRate}
              onChange={(event) => setTravelRate(event.target.value)}
              disabled={locked}
            />
          </Flex>
          <Flex direction="column" gap="1">
            <Text as="label" size="2" weight="medium" htmlFor="travel_day_count">
              Travel days
            </Text>
            <TextField.Root
              id="travel_day_count"
              type="number"
              name="travel_day_count"
              step="1"
              min="0"
              defaultValue={initial("travel_day_count", "0")}
              disabled={locked}
            />
            <Text size="1" color="gray">
              Days to and from the aircraft
            </Text>
          </Flex>
          <Flex direction="column" gap="1" gridColumn={{ md: "span 2" }}>
            <Text as="label" size="2" weight="medium" htmlFor="notes">
              Notes
            </Text>
            <TextArea id="notes" name="notes" rows={3} defaultValue={initial("notes")} />
          </Flex>
        </Grid>

        {/* role="alert" so a screen reader hears the rejection; without it
            the form silently resets and nothing is announced. */}
        <Flex mt="4" role="alert" aria-live="polite">
          {state.error ? (
            <Callout.Root color="red" size="1">
              <Callout.Text>{state.error}</Callout.Text>
            </Callout.Root>
          ) : state.saved ? (
            <Callout.Root color="green" size="1">
              <Callout.Text>
                {state.daysRemoved
                  ? `Trip saved. Removed ${state.daysRemoved} day row${
                      state.daysRemoved === 1 ? "" : "s"
                    } that fell outside the new dates.`
                  : "Trip saved."}
              </Callout.Text>
            </Callout.Root>
          ) : null}
        </Flex>

        <Flex mt="4" gap="3">
          <Button
            type="submit"
            disabled={pending || locked}
            title={
              locked ? "This trip is on an invoice and can't be changed." : undefined
            }
          >
            {pending ? "Saving…" : submitLabel}
          </Button>
          <Button asChild variant="outline">
            <NextLink href={cancelHref}>Cancel</NextLink>
          </Button>
        </Flex>
      </form>
    </Card>
  );
}

/**
 * `canceled_at` (a timestamptz) rendered for the pilot next to the Status
 * field — display only, never posted by this form. A local formatter
 * rather than a lib/format.ts addition: that file's date formatters are
 * all `date`-typed ("YYYY-MM-DD"), parsed at UTC midnight on purpose
 * (lib/format.ts's own parseCalendarDate comment) — a real instant like
 * this one needs the actual time-of-day shown too, which is a different
 * formatting job, not an extension of that one.
 */
function formatCancelledAt(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "at an unknown time";
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

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
import { TRIP_OPERATING_RULES } from "@/lib/operating-rule";
import TailNumberField from "@/components/tail-number-field";
import type { FleetOption } from "@/lib/fleet";
import type { OptionChoice } from "@/lib/custom-options";
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
  operating_rule?: string | null;
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
  /** 20260807130000 — used only to SEED a new trip's operating_rule when
   * a client is picked; see pickClient below. REQUIRED, not optional:
   * both screens that render this form select the column (trips/new and
   * trips/[id]), and a caller that forgot it would silently leave every
   * new trip on the form's own 'part_91' default no matter which client
   * was picked. For a Part 135 operator that is the wrong part on the
   * one field gating the 135.301(a) grace, so this is deliberately a
   * type error rather than a quiet wrong answer. */
  operating_rule: string | null;
};

const STATUSES = [
  { value: "scheduled", label: "Scheduled" },
  { value: "in_progress", label: "In progress" },
  { value: "completed", label: "Completed" },
  { value: "canceled", label: "Canceled" },
  // 20260814094000: a tentative hold — blocks the calendar without being
  // confirmed work. Deliberately excluded from every revenue path the same
  // way 'canceled' is; promote it to Scheduled once the job is confirmed.
  { value: "hold", label: "Hold (tentative)" },
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

/**
 * The account-level rate defaults collected by the onboarding wizard
 * (pilot.accounts.default_day_rate_cents / default_travel_day_rate_cents,
 * migration 20260812400000). Passed ONLY by trips/new: they seed a brand-
 * new trip's blank rate fields, and sit beneath a picked client's own
 * defaults. The edit screen must never pass them — an existing trip's
 * stored rates are a recorded fact, and a legitimately blank rate on a
 * saved trip must not get silently re-priced on open.
 */
export type AccountRateDefaults = {
  day_rate_cents: number | null;
  travel_day_rate_cents: number | null;
};

export default function TripForm({
  action,
  clients,
  values = {},
  submitLabel,
  tripKinds,
  cancelHref = "/trips",
  locked = false,
  hasDayRows = false,
  fleet = [],
  accountDefaults = null,
}: {
  action: (state: TripFormState, formData: FormData) => Promise<TripFormState>;
  clients: ClientOption[];
  /**
   * The tenant's own trip-kind vocabulary — their labels (an operator
   * that says "positioning" rather than "repositioning" should see their
   * word), their order, retired kinds already dropped. Read server-side
   * (lib/custom-options-read.ts) and passed in, because the options table
   * is only readable on the server and this is a client component.
   * REQUIRED, so a new screen cannot silently fall back to the stock list.
   */
  tripKinds: readonly OptionChoice[];
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
  /**
   * The pilot's registered airframes, offered as suggestions on the tail
   * number. Defaults to none so the field degrades to the plain text box
   * it was before pilot.aircraft existed.
   */
  fleet?: FleetOption[];
  /** See AccountRateDefaults above. Defaults null — the edit screen and
   *  any caller that predates account defaults behave exactly as before. */
  accountDefaults?: AccountRateDefaults | null;
}) {
  const [state, formAction, pending] = useActionState(action, initialState);

  // Belt-and-braces on top of "only trips/new passes the prop": even a
  // caller that passed accountDefaults on the edit screen must not have a
  // stored trip's legitimately blank rate re-priced on open — new-vs-edit
  // is values.id, the same discriminator the hidden id input uses.
  const seedDefaults = values.id ? null : accountDefaults;

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
  // Initializer precedence: echoed submit → stored trip value → account
  // default (new trips only, via seedDefaults). The echo MUST stay first:
  // a rejected submit where the pilot deliberately cleared a rate echoes
  // "" — a defined value — and the `!== undefined` check preserves that
  // emptiness instead of re-stuffing the default over their intent.
  // centsToInput renders null/undefined as "", so an account with no
  // default (all four columns are nullable, no DB default) still starts
  // blank rather than at a false $0.00.
  const [dayRate, setDayRate] = useState(() => {
    if (submitted?.day_rate !== undefined) return submitted.day_rate;
    if (values.day_rate_cents !== null && values.day_rate_cents !== undefined) {
      return centsToInput(values.day_rate_cents);
    }
    return centsToInput(seedDefaults?.day_rate_cents);
  });
  const [travelRate, setTravelRate] = useState(() => {
    if (submitted?.travel_day_rate !== undefined) return submitted.travel_day_rate;
    if (
      values.travel_day_rate_cents !== null &&
      values.travel_day_rate_cents !== undefined
    ) {
      return centsToInput(values.travel_day_rate_cents);
    }
    return centsToInput(seedDefaults?.travel_day_rate_cents);
  });
  // Whether the rate field still holds the untouched, machine-written
  // account seed from the initializers above. pickClient's blank-only
  // guard rests on the premise that a non-empty rate was typed by the
  // pilot as a deliberate per-trip override — mount-time seeding breaks
  // that premise, and without these flags an account default would
  // permanently block a picked client's own negotiated rate from ever
  // filling in, inverting the "client default ?? account default"
  // precedence documented in pickClient. Same touched-state pattern as
  // operatingRuleTouched below. True only when the initializer actually
  // fell through to the seed (no echo, no stored trip value, a real
  // account default); cleared forever the moment the pilot edits the
  // field, at which point the value is theirs and the blank-only rule
  // takes back over.
  const [dayRateIsAccountSeed, setDayRateIsAccountSeed] = useState(
    () =>
      submitted?.day_rate === undefined &&
      (values.day_rate_cents === null || values.day_rate_cents === undefined) &&
      seedDefaults?.day_rate_cents !== null &&
      seedDefaults?.day_rate_cents !== undefined
  );
  const [travelRateIsAccountSeed, setTravelRateIsAccountSeed] = useState(
    () =>
      submitted?.travel_day_rate === undefined &&
      (values.travel_day_rate_cents === null ||
        values.travel_day_rate_cents === undefined) &&
      seedDefaults?.travel_day_rate_cents !== null &&
      seedDefaults?.travel_day_rate_cents !== undefined
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
  const [operatingRule, setOperatingRule] = useState(() =>
    initial("operating_rule", "part_91")
  );
  // Whether the pilot has deliberately touched this select — once true,
  // picking a client no longer overwrites it. Starts true on the edit
  // screen (values.id set): an existing trip's operating_rule is a fact
  // already recorded, not something a client re-pick should silently
  // change out from under it.
  const [operatingRuleTouched, setOperatingRuleTouched] = useState(() => Boolean(values.id));
  const [cancellationNoticeFrom, setCancellationNoticeFrom] = useState(() =>
    initial("cancellation_notice_from", "")
  );
  // formatCancelledAt renders canceled_at (a timestamptz) in the DEVICE'S
  // local zone, which the server cannot know at render time — Vercel's SSR
  // pass runs in UTC. Computing it during render would make the server's
  // markup disagree with the client's on hydration, and for however many
  // hours UTC and the pilot's zone disagree, a page load before hydration
  // finishes would flash the wrong time. Deferred to a client-only effect
  // instead: both the SSR pass and React's first client render show no
  // time (matching each other exactly, so nothing to reconcile), and the
  // real local time fills in immediately after mount.
  const [canceledLabel, setCanceledLabel] = useState<string | null>(null);
  useEffect(() => {
    setCanceledLabel(values.canceled_at ? formatCancelledAt(values.canceled_at) : null);
  }, [values.canceled_at]);
  useEffect(() => {
    if (submitted?.trip_kind !== undefined) setTripKind(String(submitted.trip_kind || "contract_pilot"));
    if (submitted?.status !== undefined) setStatus(String(submitted.status || "scheduled"));
    if (submitted?.cancellation_notice_from !== undefined) {
      setCancellationNoticeFrom(String(submitted.cancellation_notice_from || ""));
    }
    if (submitted?.operating_rule !== undefined) {
      setOperatingRule(String(submitted.operating_rule || "part_91"));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [submitted]);
  const clientLabelId = useId();
  const tripKindId = useId();
  const statusId = useId();
  const noticeFromId = useId();
  const operatingRuleId = useId();

  function pickClient(nextId: string) {
    setClientId(nextId);
    const picked = clients.find((c) => c.id === nextId);
    if (!picked) return;
    // Only fills a blank field. A rate typed by hand for this specific
    // trip is a deliberate override and must not be clobbered by
    // switching the client — the schema's own comment calls the trip rate
    // "snapshotted from the client, then independently editable".
    //
    // The fill value is client default ?? account default (20260812400000,
    // new trips only via seedDefaults): a client with no agreed rate falls
    // back to the pilot's own standing rate. `??`, never `||` — a client
    // default of 0 cents is a real negotiated $0.00 (e.g. flying for the
    // aircraft's owner at no charge) and must win over the account rate.
    //
    // "Blank" for this purpose includes a field still holding the untouched
    // account seed (dayRateIsAccountSeed / travelRateIsAccountSeed): that
    // value is machine-written, not a pilot override, so the more specific
    // client rate must be allowed to replace it — otherwise an account
    // default would make the client half of `??` unreachable in exactly
    // the case it exists for.
    const dayFill =
      picked.default_day_rate_cents ?? seedDefaults?.day_rate_cents ?? null;
    if ((dayRate.trim() === "" || dayRateIsAccountSeed) && dayFill !== null) {
      setDayRate(centsToInput(dayFill));
      // After the fill the field holds either the client's own rate (no
      // longer the seed — a later client swap follows the blank-only rule
      // like any other machine fill always has) or, when this client has
      // no agreed rate, the account default again — still the seed, still
      // replaceable by a later pick of a client that does have one.
      setDayRateIsAccountSeed(picked.default_day_rate_cents === null);
    }
    const travelFill =
      picked.default_travel_day_rate_cents ??
      seedDefaults?.travel_day_rate_cents ??
      null;
    if (
      (travelRate.trim() === "" || travelRateIsAccountSeed) &&
      travelFill !== null
    ) {
      setTravelRate(centsToInput(travelFill));
      setTravelRateIsAccountSeed(picked.default_travel_day_rate_cents === null);
    }
    // 20260807130000: seeds operating_rule from the client's, same "fills
    // in, then independently editable" treatment as the rates above —
    // gated on `!operatingRuleTouched` rather than a blank check, because
    // this field (unlike the rate text fields) never has a blank state to
    // test for. Only seeds when the client has a SINGLE determinable part
    // ('part_91' or 'part_135') — a client of 'both' or 'unspecified'
    // gives no one answer to seed, so the trip keeps whatever it already
    // had (the 'part_91' form default on a brand-new trip).
    if (
      !operatingRuleTouched &&
      (picked.operating_rule === "part_91" || picked.operating_rule === "part_135")
    ) {
      setOperatingRule(picked.operating_rule);
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
                {tripKinds.map((option) => (
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
                Canceled{canceledLabel ? ` ${canceledLabel}` : ""}
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
            <Text as="label" size="2" weight="medium" id={`${operatingRuleId}-label`}>
              Operating rule
            </Text>
            <Select.Root
              key={`operating-rule-${genTick}`}
              value={operatingRule}
              onValueChange={(next) => {
                setOperatingRuleTouched(true);
                setOperatingRule(next);
              }}
              disabled={locked}
            >
              <Select.Trigger
                id={operatingRuleId}
                aria-labelledby={`${operatingRuleId}-label`}
              />
              <Select.Content>
                {TRIP_OPERATING_RULES.map((option) => (
                  <Select.Item key={option.value} value={option.value}>
                    {option.label}
                  </Select.Item>
                ))}
              </Select.Content>
            </Select.Root>
            <input type="hidden" name="operating_rule" value={operatingRule} />
            <Text size="1" color="gray">
              Which part this specific trip is flown under — fills in from the client, always
              overridable per trip.
            </Text>
          </Flex>

          <Flex direction="column" gap="1">
            <Text as="label" size="2" weight="medium" htmlFor="aircraft_ident">
              Tail number
            </Text>
            <TailNumberField
              id="aircraft_ident"
              name="aircraft_ident"
              fleet={fleet}
              defaultValue={initial("aircraft_ident")}
              typeFieldId="aircraft_type"
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
              onChange={(event) => {
                // The pilot has typed: the value is theirs now, never the
                // account seed again — see dayRateIsAccountSeed above.
                setDayRateIsAccountSeed(false);
                setDayRate(event.target.value);
              }}
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
              onChange={(event) => {
                setTravelRateIsAccountSeed(false);
                setTravelRate(event.target.value);
              }}
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
        {/* gap S: overlapping-trip warning — NEVER a hard block, since
            split-duty and same-day positioning work are real. Only shown
            alongside a successful save: this is a heads-up about the
            calendar, not a reason to withhold the write. */}
        {state.saved && state.overlapWarning ? (
          <Flex mt="2">
            <Callout.Root color="amber" size="1">
              <Callout.Text>{state.overlapWarning}</Callout.Text>
            </Callout.Root>
          </Flex>
        ) : null}

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

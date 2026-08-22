"use client";

import { useActionState, useEffect, useId, useRef, useState } from "react";
import NextLink from "next/link";
import { LAlert, LButton, LCard, lButtonClass } from "@/components/ledger";
import { LField, LInput, LSelect, LTextarea } from "@/components/ledger/forms";
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
/** "Not recorded" is the real, postable null choice — a leftover sentinel
 * from this form's Radix Select days (a native <select> has no trouble
 * with an empty-string option value), kept so the value posted through
 * the hidden input below is unchanged. */
const NO_NOTICE_FROM = "__none__";

/** "No client yet" is a real, postable choice (client_id is optional) —
 * same leftover-sentinel note as NO_NOTICE_FROM above. */
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
  const formRef = useRef<HTMLFormElement>(null);

  // F: focus + scroll the first invalid control whenever a fresh
  // fieldErrors map arrives. Queried in DOCUMENT order (first
  // aria-invalid control in the form), not by iterating fieldErrors'
  // keys — object key order is parseTripForm's check order, not the
  // field's position on the page, and getElementById(key) never worked
  // for client_id/cancellation_notice_from anyway (their visible
  // controls are useId()-generated selects; only a hidden input carries
  // the literal name). Every field error above already sets aria-invalid
  // on the real, visible control, so this reaches all of them.
  useEffect(() => {
    if (!state.fieldErrors) return;
    const el = formRef.current?.querySelector('[aria-invalid="true"]');
    if (!(el instanceof HTMLElement)) return;
    el.focus();
    el.scrollIntoView({ block: "center" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.fieldErrors]);

  // F: unsaved-changes protection, same shape as client-form.tsx. Cleared
  // once an in-place edit saves (updateTrip returns saved:true rather than
  // redirecting); a create redirects away, so there's nothing left to warn
  // about by the time this could matter.
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    if (state.saved) setDirty(false);
  }, [state.saved]);
  useEffect(() => {
    if (!dirty) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

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
  // React 19's post-action form.reset() restores every listed element to
  // its mount-time state, including a plain, controlled native <select> —
  // this form keeps NO `name` on any visible select and posts the real
  // value through a controlled hidden input instead (React re-asserts a
  // hidden input's controlled value on every render, reset or not), the
  // same defense-in-depth this form used under Radix's Select. `genTick`
  // still forces a remount of every select on each dispatch, preserved
  // exactly rather than removed now that the control itself is native.
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
  // F: controlled so ends_on can carry a `min` that tracks starts_on —
  // native constraint validation then catches end-before-start before the
  // form ever posts. The server check (parseTripForm) is unchanged and
  // stays the real boundary; this only saves the round trip for the
  // common typo.
  const [startsOn, setStartsOn] = useState(() => initial("starts_on"));
  const [endsOn, setEndsOn] = useState(() => initial("ends_on"));
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
    if (submitted?.starts_on !== undefined) setStartsOn(String(submitted.starts_on || ""));
    if (submitted?.ends_on !== undefined) setEndsOn(String(submitted.ends_on || ""));
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
    <LCard>
      <form ref={formRef} action={formAction} onChange={() => setDirty(true)}>
        {values.id ? <input type="hidden" name="id" value={values.id} /> : null}
        {/* The real client_id, always in sync with clientId — see NO_CLIENT
            above for why the visible select doesn't post it directly. */}
        <input type="hidden" name="client_id" value={clientId} />

        <h2 className="mb-3 text-h3 font-semibold">The job</h2>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div className="flex flex-col gap-1 md:col-span-2">
            <LField
              label="Client"
              htmlFor={clientLabelId}
              hint={
                clients.length === 0 ? (
                  <>
                    No clients yet. A trip without a client can&rsquo;t be invoiced —{" "}
                    <NextLink href="/clients/new" className="text-accent underline">
                      add the client first
                    </NextLink>
                    .
                  </>
                ) : (
                  "Who you're billing for this trip"
                )
              }
              error={state.fieldErrors?.client_id}
              errorId="client_id-error"
            >
              <LSelect
                key={`client-${genTick}`}
                id={clientLabelId}
                value={clientId === "" ? NO_CLIENT : clientId}
                onChange={(e) =>
                  pickClient(e.target.value === NO_CLIENT ? "" : e.target.value)
                }
                disabled={locked}
                aria-invalid={state.fieldErrors?.client_id ? true : undefined}
                aria-describedby={state.fieldErrors?.client_id ? "client_id-error" : undefined}
              >
                <option value={NO_CLIENT}>No client yet</option>
                {clients.map((client) => (
                  <option key={client.id} value={client.id}>
                    {client.name}
                  </option>
                ))}
              </LSelect>
            </LField>
          </div>

          <div className="flex flex-col gap-1">
            <LField label="Trip kind" htmlFor={tripKindId}>
              <LSelect
                key={`trip-kind-${genTick}`}
                id={tripKindId}
                value={tripKind}
                onChange={(e) => setTripKind(e.target.value)}
              >
                {tripKinds.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </LSelect>
            </LField>
            <input type="hidden" name="trip_kind" value={tripKind} />
          </div>

          <div className="flex flex-col gap-1">
            <LField label="Status" htmlFor={statusId}>
              <LSelect
                key={`status-${genTick}`}
                id={statusId}
                value={status}
                onChange={(e) => setStatus(e.target.value)}
              >
                {STATUSES.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </LSelect>
            </LField>
            <input type="hidden" name="status" value={status} />
            {values.canceled_at ? (
              <p className="text-caption text-ink-3">
                Canceled{canceledLabel ? ` ${canceledLabel}` : ""}
              </p>
            ) : null}
          </div>

          <div className="flex flex-col gap-1">
            <LField
              label="Cancellation notice from"
              htmlFor={noticeFromId}
              hint="Who called off the trip. Supports a cancellation fee line if this contract has one. The cancellation timestamp itself is recorded automatically when status is set to Canceled."
              error={state.fieldErrors?.cancellation_notice_from}
              errorId="cancellation_notice_from-error"
            >
              <LSelect
                key={`notice-from-${genTick}`}
                id={noticeFromId}
                value={cancellationNoticeFrom === "" ? NO_NOTICE_FROM : cancellationNoticeFrom}
                onChange={(e) =>
                  setCancellationNoticeFrom(
                    e.target.value === NO_NOTICE_FROM ? "" : e.target.value
                  )
                }
                aria-invalid={state.fieldErrors?.cancellation_notice_from ? true : undefined}
                aria-describedby={
                  state.fieldErrors?.cancellation_notice_from
                    ? "cancellation_notice_from-error"
                    : undefined
                }
              >
                <option value={NO_NOTICE_FROM}>Not recorded</option>
                {CANCELLATION_NOTICE_FROM_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </LSelect>
            </LField>
            <input
              type="hidden"
              name="cancellation_notice_from"
              value={cancellationNoticeFrom}
            />
          </div>

          <div className="flex flex-col gap-1">
            <LField
              label="Starts"
              htmlFor="starts_on"
              error={state.fieldErrors?.starts_on}
              errorId="starts_on-error"
            >
              <LInput
                id="starts_on"
                type="date"
                name="starts_on"
                required
                disabled={locked}
                value={startsOn}
                onChange={(e) => {
                  const next = e.target.value;
                  setStartsOn(next);
                  // F: never leave ends_on stranded before the new start —
                  // the pilot picked a later start on purpose; bumping the
                  // end to match keeps the range valid without a round trip.
                  if (endsOn && next > endsOn) setEndsOn(next);
                }}
                aria-invalid={state.fieldErrors?.starts_on ? true : undefined}
                aria-describedby={state.fieldErrors?.starts_on ? "starts_on-error" : undefined}
              />
            </LField>
          </div>
          <div className="flex flex-col gap-1">
            <LField
              label="Ends"
              htmlFor="ends_on"
              error={state.fieldErrors?.ends_on}
              errorId="ends_on-error"
            >
              <LInput
                id="ends_on"
                type="date"
                name="ends_on"
                required
                disabled={locked}
                min={startsOn || undefined}
                value={endsOn}
                onChange={(e) => setEndsOn(e.target.value)}
                aria-invalid={state.fieldErrors?.ends_on ? true : undefined}
                aria-describedby={state.fieldErrors?.ends_on ? "ends_on-error" : undefined}
              />
            </LField>
          </div>

          <div className="flex flex-col gap-1">
            <LField
              label="Operating rule"
              htmlFor={operatingRuleId}
              hint="Which part this specific trip is flown under. Fills in from the client, always overridable per trip."
            >
              <LSelect
                key={`operating-rule-${genTick}`}
                id={operatingRuleId}
                value={operatingRule}
                onChange={(e) => {
                  setOperatingRuleTouched(true);
                  setOperatingRule(e.target.value);
                }}
                disabled={locked}
              >
                {TRIP_OPERATING_RULES.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </LSelect>
            </LField>
            <input type="hidden" name="operating_rule" value={operatingRule} />
          </div>

          <div className="flex flex-col gap-1">
            <LField label="Tail number" htmlFor="aircraft_ident">
              <TailNumberField
                id="aircraft_ident"
                name="aircraft_ident"
                fleet={fleet}
                defaultValue={initial("aircraft_ident")}
                typeFieldId="aircraft_type"
              />
            </LField>
          </div>
          <div className="flex flex-col gap-1">
            <LField label="Aircraft type" htmlFor="aircraft_type" hint="e.g. CE-560XL">
              <LInput
                id="aircraft_type"
                name="aircraft_type"
                defaultValue={initial("aircraft_type")}
              />
            </LField>
          </div>
        </div>

        <div className="mt-5 mb-3 flex flex-col gap-1">
          <h2 className={hasDayRows ? "text-h3 font-semibold text-ink-3" : "text-h3 font-semibold"}>
            {hasDayRows ? "What it bills (legacy)" : "What it bills"}
          </h2>
          <p className="text-caption text-ink-3">
            {hasDayRows
              ? "The day grid below now sets what's actually billed. These fields are the old scalar input, kept only as the day grid's original seed. Editing them does not change the invoice."
              : "Seeds the day grid below the first time it's opened. Once that grid has rows, they, not these fields, are what's actually billed."}
          </p>
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div className="flex flex-col gap-1">
            <LField
              label="Day rate (USD)"
              htmlFor="day_rate"
              hint="Fills in from the client's rate agreement"
              error={state.fieldErrors?.day_rate}
              errorId="day_rate-error"
            >
              <LInput
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
                aria-invalid={state.fieldErrors?.day_rate ? true : undefined}
                aria-describedby={state.fieldErrors?.day_rate ? "day_rate-error" : undefined}
              />
            </LField>
          </div>
          <div className="flex flex-col gap-1">
            <LField
              label="Days"
              htmlFor="day_count"
              hint="Half days are allowed"
              error={state.fieldErrors?.day_count}
              errorId="day_count-error"
            >
              <LInput
                id="day_count"
                type="number"
                name="day_count"
                step="0.5"
                min="0"
                defaultValue={initial("day_count")}
                disabled={locked}
                aria-invalid={state.fieldErrors?.day_count ? true : undefined}
                aria-describedby={state.fieldErrors?.day_count ? "day_count-error" : undefined}
              />
            </LField>
          </div>
          <div className="flex flex-col gap-1">
            <LField
              label="Travel day rate (USD)"
              htmlFor="travel_day_rate"
              error={state.fieldErrors?.travel_day_rate}
              errorId="travel_day_rate-error"
            >
              <LInput
                id="travel_day_rate"
                name="travel_day_rate"
                inputMode="decimal"
                value={travelRate}
                onChange={(event) => {
                  setTravelRateIsAccountSeed(false);
                  setTravelRate(event.target.value);
                }}
                disabled={locked}
                aria-invalid={state.fieldErrors?.travel_day_rate ? true : undefined}
                aria-describedby={
                  state.fieldErrors?.travel_day_rate ? "travel_day_rate-error" : undefined
                }
              />
            </LField>
          </div>
          <div className="flex flex-col gap-1">
            <LField
              label="Travel days"
              htmlFor="travel_day_count"
              hint="Days to and from the aircraft"
              error={state.fieldErrors?.travel_day_count}
              errorId="travel_day_count-error"
            >
              <LInput
                id="travel_day_count"
                type="number"
                name="travel_day_count"
                step="1"
                min="0"
                defaultValue={initial("travel_day_count", "0")}
                disabled={locked}
                aria-invalid={state.fieldErrors?.travel_day_count ? true : undefined}
                aria-describedby={
                  state.fieldErrors?.travel_day_count ? "travel_day_count-error" : undefined
                }
              />
            </LField>
          </div>
          <div className="flex flex-col gap-1 md:col-span-2">
            <LField label="Notes" htmlFor="notes">
              <LTextarea id="notes" name="notes" rows={3} defaultValue={initial("notes")} />
            </LField>
          </div>
        </div>

        {/* role="alert" so a screen reader hears the rejection; without it
            the form silently resets and nothing is announced. */}
        <div className="mt-4" role="alert" aria-live="polite">
          {state.error ? (
            <LAlert tone="crit">{state.error}</LAlert>
          ) : state.saved ? (
            <LAlert tone="good">
              {state.daysRemoved
                ? `Trip saved. Removed ${state.daysRemoved} day row${
                    state.daysRemoved === 1 ? "" : "s"
                  } that fell outside the new dates.`
                : "Trip saved."}
            </LAlert>
          ) : null}
        </div>
        {/* gap S: overlapping-trip warning — NEVER a hard block, since
            split-duty and same-day positioning work are real. Only shown
            alongside a successful save: this is a heads-up about the
            calendar, not a reason to withhold the write. */}
        {state.saved && state.overlapWarning ? (
          <div className="mt-2">
            <LAlert tone="warn">{state.overlapWarning}</LAlert>
          </div>
        ) : null}

        <div className="mt-4 flex gap-3">
          {/* THE ONE FILLED ACCENT ACTION in this form — the persistence
              move a pilot came here to make. See mark-flown-button.tsx and
              [id]/page.tsx for why the header's "Mark flown" action (when
              shown) takes outline instead, so the two never compete. */}
          <LButton
            type="submit"
            disabled={pending || locked}
            title={
              locked ? "This trip is on an invoice and can't be changed." : undefined
            }
          >
            {pending ? "Saving…" : submitLabel}
          </LButton>
          <NextLink href={cancelHref} className={lButtonClass({ variant: "outline" })}>
            Cancel
          </NextLink>
        </div>
      </form>
    </LCard>
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
